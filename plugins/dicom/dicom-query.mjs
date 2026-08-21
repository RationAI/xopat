import {
    parseImagePixel,
    parseModalityLut,
    parseVoiLut,
    parsePaletteLut,
    parseRealWorldRange,
    cielabToSrgb,
    hueForIndex,
} from './pixel-pipeline.mjs';

/**
 * Cap on memoized WADO metadata responses per client. A slide open touches a
 * handful of instances; this only exists so a long browsing session cannot grow
 * the map without bound.
 */
const META_CACHE_MAX = 256;

/**
 * How many metadata requests to keep in flight when walking independent
 * instances. Enough to hide a remote store's latency, low enough not to crowd
 * out the tile requests that are the point of the open.
 */
const METADATA_CONCURRENCY = 6;

export default class DicomTools {

    /** client -> Map(path -> Promise<metadata>). See `wadoMetadata`. */
    static _metaCaches = new WeakMap();

    /**
     * Helper to extract DICOM JSON tag values.
     */
    static tag(ds, tag, defaultValue=null) {
        return ds?.[tag]?.Value || defaultValue;
    }
    static v(ds, tag) {
        const x = this.tag(ds, tag);
        return Array.isArray(x) ? x[0] : (x ?? null);
    };
    static iv(ds, tag) {
        const v = this.tag(ds, tag);
        if (v == null) return undefined;
        const x = Array.isArray(v) ? v[0] : v;
        return typeof x === "string" ? parseInt(x, 10) : (x|0);
    };
    static fv(ds, tag) {
        const v = this.tag(ds, tag);
        if (v == null) return undefined;
        const x = Array.isArray(v) ? v[0] : v;
        return typeof x === "string" ? parseFloat(x) : +x;
    };


    /* BASE QUERIES */

    // All HTTP goes through `client: HttpClient` — auth, retries, CSRF and
    // 401-refresh are handled there. Callers pass relative paths (`/studies/...`);
    // the client's `baseURL` carries the DICOMweb service URL or proxy prefix.

    static async qido(client, path) {
        try {
            const res = await client.fetchRaw(path, { headers: { Accept: 'application/dicom+json' } });
            if (res.status === 204) return undefined;
            const text = await res.text();
            try { return JSON.parse(text); } catch (e) { throw new Error(`Bad DICOM JSON: ${e.message} - body: ${text}`); }
        } catch (e) {
            if (e instanceof HTTPError) {
                const body = e.textData || '';
                if (e.statusCode === 404 && /Unknown resource/i.test(body)) throw new Error(`QIDO endpoint missing at ${path}`);
                if (e.statusCode === 404) return undefined;
                throw new Error(`QIDO ${path} failed: ${e.statusCode} ${body}`);
            }
            throw e;
        }
    }

    // Safe QIDO wrapper: try with includefield, retry without if server rejects that param
    static async qidoSafe(client, path, includefield) {
        const sep = path.includes('?') ? '&' : '?';
        const pathWithField = includefield ? `${path}${sep}includefield=${encodeURIComponent(includefield)}` : path;
        try {
            return await this.qido(client, pathWithField);
        } catch (e) {
            const msg = String(e?.message || '');
            if (includefield && (msg.includes('includefield') || msg.includes('Invalid JSON payload'))) {
                return await this.qido(client, path);
            }
            throw e;
        }
    }

    /**
     * QIDO with the `x-total-count` header preserved.
     *
     * Mirrors `qido`'s status handling — that symmetry is load-bearing. DICOMweb
     * answers a query matching nothing with `204 No Content` and an EMPTY body,
     * so a version of this that goes straight to JSON.parse turns every
     * zero-result search into "Bad DICOM JSON: Unexpected end of JSON input".
     *
     * `rows` is always an array; callers `.map()` it directly.
     *
     * @returns {Promise<{rows: object[], total: (number|null)}>}
     */
    static async qidoSafeWithMeta(client, path, includefield) {
        const sep = path.includes('?') ? '&' : '?';
        const make = (withFields) => withFields && includefield ? `${path}${sep}includefield=${encodeURIComponent(includefield)}` : path;

        const tryFetch = (p) => client.fetchRaw(p, { headers: { Accept: 'application/dicom+json' } });

        let url = make(true);
        let res;
        try {
            res = await tryFetch(url);
        } catch (e) {
            if (!(e instanceof HTTPError)) throw e;
            const msg = e.textData || '';

            // Status handling first — an `includefield` retry must not be able
            // to swallow a 404 and report it as a generic query failure.
            if (e.statusCode === 404) {
                // Same split as `qido`: a missing *endpoint* is a real error,
                // a missing *collection* is simply an empty result.
                if (/Unknown resource/i.test(msg)) throw new Error(`QIDO endpoint missing at ${url}`);
                return { rows: [], total: 0 };
            }

            // Retry without includefield if the server rejects it (e.g., GCP)
            if (includefield && (msg.includes('includefield') || msg.includes('Invalid JSON payload'))) {
                url = make(false);
                res = await tryFetch(url);
            } else {
                throw new Error(`QIDO ${url} failed: ${e.statusCode} ${msg}`);
            }
        }

        // No content — the query is valid and simply matched nothing.
        if (res.status === 204) return { rows: [], total: 0 };

        const total = this._readTotalHeader(res.headers);
        const text = await res.text();
        // Some servers answer an empty result set with 200 + empty body rather
        // than 204; treat both the same.
        if (!text || !text.trim()) return { rows: [], total: total ?? 0 };

        let rows;
        try { rows = JSON.parse(text); } catch (e) { throw new Error(`Bad DICOM JSON: ${e.message} - body: ${text}`); }
        return { rows: Array.isArray(rows) ? rows : [], total };
    }

    /**
     * WADO-RS metadata fetch for richer details when QIDO filters are blocked.
     *
     * Memoized. An instance's metadata is immutable for its SOP Instance UID, and
     * several independent consumers walk the same instances during one slide open
     * — the pyramid scan, the ICC profile probe, derived-object discovery — so the
     * same path was being fetched two and three times over a remote link.
     *
     * In-flight requests are shared, not just completed ones: the duplicate calls
     * frequently overlap.
     *
     * Cached per client. Two `HttpClient`s can carry different auth contexts, and
     * one caller's metadata must never be served to another.
     */
    static async wadoMetadata(client, path) {
        const cache = this._metaCacheFor(client);
        const hit = cache.get(path);
        if (hit) {
            // Refresh recency — a slide open touches a small working set of paths
            // repeatedly and they should outlive an unrelated sweep.
            cache.delete(path);
            cache.set(path, hit);
            return hit;
        }

        const promise = (async () => {
            try {
                const res = await client.fetchRaw(path, { headers: { Accept: 'application/dicom+json' } });
                const text = await res.text();
                try { return JSON.parse(text); } catch (e) { throw new Error(`Bad DICOM JSON: ${e.message} - body: ${text}`); }
            } catch (e) {
                if (e instanceof HTTPError) throw new Error(`WADO ${path} failed: ${e.statusCode} ${e.textData || ''}`);
                throw e;
            }
        })();

        // A failure must not be remembered — the next caller has to be able to retry.
        promise.catch(() => cache.delete(path));

        cache.set(path, promise);
        while (cache.size > META_CACHE_MAX) cache.delete(cache.keys().next().value);
        return promise;
    }

    /**
     * The metadata cache belonging to one client. Held weakly: it must die with
     * the client rather than outlive the session, because DICOM metadata is
     * patient data and has no business persisting anywhere.
     */
    static _metaCacheFor(client) {
        let cache = this._metaCaches.get(client);
        if (!cache) {
            cache = new Map();   // insertion-ordered ⇒ usable as an LRU
            this._metaCaches.set(client, cache);
        }
        return cache;
    }

    /** Drop the memoized metadata for one client (or all of them). */
    static clearMetadataCache(client = null) {
        if (client) this._metaCaches.delete(client);
        else this._metaCaches = new WeakMap();
    }

    /**
     * Map items through an async fn with a fixed concurrency cap, preserving
     * result order. Used wherever a metadata walk is over independent items —
     * several of those loops used to `await` one request at a time across a
     * high-latency link.
     */
    static async mapConcurrent(items, cap, fn) {
        const results = new Array(items.length);
        let next = 0;
        const workers = Array.from(
            { length: Math.max(1, Math.min(cap, items.length)) },
            async () => {
                while (next < items.length) {
                    const idx = next++;
                    results[idx] = await fn(items[idx], idx);
                }
            }
        );
        await Promise.all(workers);
        return results;
    }

    static async stow(client, studyUID, dicomData) {
        const path = `/studies/${studyUID}`;
        const boundary = 'DICOM_STOW_BOUNDARY';

        // 1. Construct Body
        const header =
            `--${boundary}\r\n` +
            `Content-Type: application/dicom\r\n` +
            `\r\n`;
        const footer = `\r\n--${boundary}--`;

        const headerBuf = new TextEncoder().encode(header);
        const footerBuf = new TextEncoder().encode(footer);

        const body = new Uint8Array(headerBuf.length + dicomData.byteLength + footerBuf.length);
        body.set(headerBuf, 0);
        body.set(new Uint8Array(dicomData), headerBuf.length);
        body.set(footerBuf, headerBuf.length + dicomData.byteLength);

        let res;
        try {
            res = await client.fetchRaw(path, {
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/related; type="application/dicom"; boundary=${boundary}`,
                    'Accept': 'application/dicom+json'
                },
                body
            });
        } catch (e) {
            if (e instanceof HTTPError) throw new Error(`STOW-RS failed (${e.statusCode}): ${e.textData || ''}`);
            throw e;
        }

        // Verify response is actually JSON before parsing
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("json")) {
            return await res.json();
        } else {
            return { status: "success", message: "Upload complete (non-JSON response)" };
        }
    }

    /* WSI TOOLS */

    static isWSIInstance(ds) {
        // 1) Modality present
        const modality = this.v(ds, "00080060");
        if (modality === "SM") return true;

        // 2) SOP Class UID matches known WSI SOPs
        // todo try: 1.2.840.10008.5.1.4.1.1.77 prefix for all, see https://dicom.nema.org/medical/dicom/current/output/chtml/part04/sect_b.5.html
        const sopClass = this.v(ds, "00080016");
        const wsiSOPs = [
            "1.2.840.10008.5.1.4.1.1.77.1.6"
        ];
        if (wsiSOPs.includes(sopClass)) return true;

        // 3) ImageType contains WSI keyword
        const imageType = (this.tag(ds, "00080008") || []).join("\\");
        return (/WSI/i.test(imageType) || /LABEL|OVERVIEW/i.test(imageType));
    }

    /* DERIVED OBJECTS: SEGMENTATION + PARAMETRIC MAP */

    static SOP_SEGMENTATION   = "1.2.840.10008.5.1.4.1.1.66.4";
    static SOP_PARAMETRIC_MAP = "1.2.840.10008.5.1.4.1.1.30";

    static isSegInstance(ds) {
        if (this.v(ds, "00080016") === this.SOP_SEGMENTATION) return true;
        return this.v(ds, "00080060") === "SEG";
    }

    static isParametricMapInstance(ds) {
        return this.v(ds, "00080016") === this.SOP_PARAMETRIC_MAP;
    }

    /**
     * Every SeriesInstanceUID this dataset says it was derived from.
     *
     * Three routes exist and servers populate different subsets, so all are
     * checked: the instance-level ReferencedSeriesSequence, the study-level
     * ReferencedImageEvidenceSequence, and the per-frame SourceImageSequence
     * (which carries only SOP references, so it contributes nothing here but is
     * checked for presence to avoid falsely reporting "unlinked").
     *
     * @returns {string[]}
     */
    static referencedSeriesUIDs(ds) {
        const out = new Set();

        for (const item of (this.tag(ds, "00081115") || [])) {         // ReferencedSeriesSequence
            const uid = this.v(item, "0020000E");
            if (uid) out.add(uid);
        }

        for (const study of (this.tag(ds, "00089092") || [])) {        // ReferencedImageEvidenceSequence
            for (const series of (this.tag(study, "00081115") || [])) {
                const uid = this.v(series, "0020000E");
                if (uid) out.add(uid);
            }
        }

        return Array.from(out);
    }

    /**
     * @typedef {object} DerivedSeriesRecord
     * @property {string} seriesUID
     * @property {"seg"|"pmap"} kind
     * @property {string} sopClass
     * @property {string} instanceUID
     * @property {?string} label
     * @property {string[]} referencedSeries series this object declares it derives from
     * @property {Array} segments
     * @property {?string} units
     * @property {?{min:number,max:number}} valueRange
     * @property {Array} voiPresets
     */

    /**
     * Index every SEG / Parametric Map series in a study, once.
     *
     * Series-level QIDO carries Modality but not SOPClassUID, so candidates are
     * pre-filtered by modality and then confirmed against one instance's
     * metadata — one instance listing plus one WADO metadata fetch per
     * candidate. In a study with a dozen segmentations that is ~25 requests, so
     * it must be done once per study and filtered locally afterwards, never
     * re-probed per opened slide.
     *
     * `smSeriesCount` rides along because the attribution rule needs it and the
     * series listing is already in hand.
     *
     * @param {HttpClient} client
     * @param {string} studyUID
     * @returns {Promise<{derived: DerivedSeriesRecord[], smSeriesCount: number}>}
     */
    static async getStudyDerivedIndex(client, studyUID) {
        const empty = { derived: [], smSeriesCount: 0 };

        const seriesList = await this.qidoSafe(client,
            `/studies/${encodeURIComponent(studyUID)}/series`,
            "00080060,0008103E,00200011");
        if (!Array.isArray(seriesList) || !seriesList.length) return empty;

        const smSeriesCount = seriesList.filter(s => this.v(s, "00080060") === "SM").length;

        // SEG declares Modality "SEG". Parametric Maps have no modality of their
        // own and appear as "OT" (or, non-conformantly, as the source modality),
        // so both are probed and the SOP Class decides.
        const candidates = seriesList.filter(s => {
            const mod = this.v(s, "00080060");
            return mod === "SEG" || mod === "OT";
        });

        const derived = [];
        for (const s of candidates) {
            const seriesUID = this.v(s, "0020000E");
            if (!seriesUID) continue;

            let instances;
            try {
                instances = await this.qidoSafe(client,
                    `/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}/instances`,
                    "00080016,00080018");
            } catch (e) {
                console.warn(`[DICOM] derived-series probe failed for ${seriesUID}:`, e?.message ?? e);
                continue;
            }
            const first = (instances || [])[0];
            const instanceUID = this.v(first, "00080018");
            if (!instanceUID) continue;

            let sopClass = this.v(first, "00080016");
            let meta = null;
            if (!sopClass || sopClass === this.SOP_SEGMENTATION || sopClass === this.SOP_PARAMETRIC_MAP) {
                try {
                    meta = (await this.wadoMetadata(client,
                        `/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}` +
                        `/instances/${encodeURIComponent(instanceUID)}/metadata`))?.[0] || null;
                } catch (e) {
                    console.warn(`[DICOM] derived-series metadata failed for ${seriesUID}:`, e?.message ?? e);
                    continue;
                }
                sopClass = sopClass || this.v(meta, "00080016");
            }
            if (!meta) continue;

            const kind = sopClass === this.SOP_SEGMENTATION ? "seg"
                : (sopClass === this.SOP_PARAMETRIC_MAP ? "pmap" : null);
            if (!kind) continue;

            // The probe already holds one instance's metadata, so the segment
            // list (and therefore the overlay's colours and labels) is free
            // here. Deferring it to tile-source init would mean the shader
            // config is assembled before the segments are known.
            derived.push({
                seriesUID,
                kind,
                sopClass,
                instanceUID,
                label: this.v(s, "0008103E") || null,
                referencedSeries: this.referencedSeriesUIDs(meta),
                segments: kind === "seg" ? this.parseSegments(meta) : [],
                units: kind === "pmap" ? (parseModalityLut(meta)?.units ?? null) : null,
                // Whether the object carries its OWN colour map. When it does,
                // that palette is the authored appearance and replaces the
                // user-selectable colour map — the overlay builder picks a
                // different shader for it.
                hasPalette: parseImagePixel(meta).photometricInterpretation === "PALETTE COLOR",
                // The parametric shader needs the value range and the object's
                // own window before the first tile arrives, so it can seed its
                // controls in real-world units.
                valueRange: kind === "pmap" ? parseRealWorldRange(meta) : null,
                voiPresets: kind === "pmap" ? (parseVoiLut(meta)?.presets ?? []) : [],
            });
        }

        return { derived, smSeriesCount };
    }

    /**
     * Which derived series belong to one slide. Pure — no network.
     *
     * Attribution rules:
     *   1. An object that declares its source (ReferencedSeriesSequence, or
     *      ReferencedImageEvidenceSequence) attaches to exactly what it names.
     *   2. An object that declares nothing attaches only when the study holds a
     *      single SM series, i.e. when there is nothing to get wrong.
     *
     * Rule 2 is deliberately strict. A study with six slides and twelve
     * segmentations is normal in public archives, and attaching an unlinked mask
     * to every slide would render one slide's nuclei over another — wrong in a
     * way that looks entirely plausible on screen.
     *
     * @param {{derived: DerivedSeriesRecord[], smSeriesCount: number}} index
     * @param {string} sourceSeriesUID
     * @returns {DerivedSeriesRecord[]}
     */
    static derivedSeriesForSlide(index, sourceSeriesUID) {
        const { derived = [], smSeriesCount = 0 } = index || {};
        const out = [];

        for (const record of derived) {
            if (record.seriesUID === sourceSeriesUID) continue;

            if (record.referencedSeries.length) {
                if (record.referencedSeries.includes(sourceSeriesUID)) out.push(record);
                continue;
            }

            if (smSeriesCount === 1) {
                out.push(record);
            } else {
                console.info(
                    `[DICOM] derived series ${record.seriesUID} declares no source series and the study ` +
                    `holds ${smSeriesCount} slides — cannot attribute it, skipping.`);
            }
        }
        return out;
    }

    /**
     * Convenience wrapper: index the study, then filter to one slide.
     *
     * Callers that open several slides from the same study should hold the index
     * themselves (see `getStudyDerivedIndex`) rather than calling this per slide.
     *
     * @returns {Promise<DerivedSeriesRecord[]>}
     */
    static async findDerivedSeriesFor(client, studyUID, sourceSeriesUID) {
        const index = await this.getStudyDerivedIndex(client, studyUID);
        return this.derivedSeriesForSlide(index, sourceSeriesUID);
    }

    /**
     * Read the Segment Sequence (0062,0002) into a renderable description.
     *
     * `RecommendedDisplayCIELabValue` is converted to sRGB here so the shader
     * layer and the legend UI share one colour source of truth. When a segment
     * omits it, a deterministic hue is derived from the segment number — stable
     * across reloads, unlike a random palette.
     *
     * @returns {Array<{number:number, label:string, algorithm:?string,
     *                  category:?string, type:?string, color:[number,number,number]}>}
     */
    static parseSegments(ds) {
        const items = this.tag(ds, "00620002") || [];
        const segments = [];

        for (const item of items) {
            const number = this.iv(item, "00620004");
            if (!Number.isFinite(number)) continue;

            const lab = this.tag(item, "0062000D");
            // Key the fallback hue off SegmentNumber, not the position in the
            // sequence: servers are free to return the items in any order, and a
            // position-derived colour would then differ between two reads of the
            // same object.
            const color = lab && lab.length >= 3
                ? cielabToSrgb(lab.map(Number))
                : hueForIndex(Math.max(0, number - 1));

            const codeMeaning = (seqTag) => {
                const code = this.tag(item, seqTag)?.[0];
                return code ? (this.v(code, "00080104") || this.v(code, "00080100") || null) : null;
            };

            segments.push({
                number,
                label: this.v(item, "00620005") || `Segment ${number}`,
                algorithm: this.v(item, "00620008") || null,
                category: codeMeaning("00620003"),   // SegmentedPropertyCategoryCodeSequence
                type: codeMeaning("0062000F"),       // SegmentedPropertyTypeCodeSequence
                color,
            });
        }

        segments.sort((a, b) => a.number - b.number);
        return segments;
    }

    /**
     * Build the tiled geometry of a SEG / Parametric Map series.
     *
     * Mirrors findWSIItems for derived objects: one QIDO for the instance list,
     * one WADO metadata fetch per instance, producing levels whose frame map is
     * keyed by tile AND segment.
     *
     * @returns {Promise<{levels:Array, segments:Array, pixel:object, kind:string,
     *                    segmentationType:?string, maximumFractionalValue:number,
     *                    modalityLut:?object, voiLut:?object, paletteLut:?object,
     *                    studyUID:string, seriesUID:string}|null>}
     */
    static async findDerivedItem(client, studyUID, seriesUID, kind = "seg") {
        const instances = await this.qidoSafe(client,
            `/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}/instances`,
            "00080018,00280008,00480006,00480007,00280010,00280011");
        if (!Array.isArray(instances) || !instances.length) return null;

        const item = {
            studyUID,
            seriesUID,
            kind,
            levels: [],
            segments: [],
            pixel: null,
            segmentationType: null,
            fractionalType: null,
            valueRange: null,
            maximumFractionalValue: 255,
            modalityLut: null,
            voiLut: null,
            paletteLut: null,
        };

        for (const inst of instances) {
            const uid = this.v(inst, "00080018");
            if (!uid) continue;
            let meta;
            try {
                meta = await this.wadoMetadata(client,
                    `/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}` +
                    `/instances/${encodeURIComponent(uid)}/metadata`);
            } catch (e) {
                console.warn(`[DICOM] derived instance metadata failed (${uid}):`, e?.message ?? e);
                continue;
            }
            this._ingestDerivedInstanceMetadata(uid, meta?.[0] || {}, item);
        }

        item.levels = item.levels.filter(L =>
            Number.isFinite(L.width) && Number.isFinite(L.height) &&
            Number.isFinite(L.tileWidth) && Number.isFinite(L.tileHeight) && L.instanceUID);
        item.levels.sort((a, b) => (b.width - a.width) || (b.height - a.height));

        if (!item.levels.length) return null;
        if (!item.segments.length && kind === "seg") {
            console.warn(`[DICOM] SEG series ${seriesUID} declares no Segment Sequence; nothing to render.`);
            return null;
        }
        return item;
    }

    /**
     * Ingest one SEG / PMAP instance into the shared item.
     *
     * The frame map differs from the WSI one in a way that matters: a single
     * tile position holds one frame *per segment*, so `frames[x_y]` is a
     * segment-number -> frame-index map rather than a bare index. Positions the
     * object does not encode stay absent and render transparent — SEG objects
     * are routinely sparse, and filling gaps with frame 1 would paint the whole
     * slide with whatever the first tile happens to contain.
     */
    static _ingestDerivedInstanceMetadata(instanceUID, attrs, item) {
        if (!item.pixel) {
            const chain = this.parsePixelChain(attrs);
            item.pixel = chain.pixel;
            item.modalityLut = chain.modalityLut;
            item.voiLut = chain.voiLut;
            item.paletteLut = chain.paletteLut;
        }
        if (!item.segments.length) {
            item.segments = this.parseSegments(attrs);
        }
        // SegmentationType is (0062,0001) — BINARY | FRACTIONAL. (0062,0010) is
        // SegmentationFractionalType (OCCUPANCY | PROBABILITY), a different
        // attribute entirely; confusing the two mislabels every probability map.
        item.segmentationType = item.segmentationType || this.v(attrs, "00620001") || null;
        item.fractionalType = item.fractionalType || this.v(attrs, "00620010") || null;
        const maxFrac = this.iv(attrs, "0062000E");
        if (Number.isFinite(maxFrac) && maxFrac > 0) item.maximumFractionalValue = maxFrac;
        item.valueRange = item.valueRange || parseRealWorldRange(attrs);

        const numberOfFrames = this.iv(attrs, "00280008") || 0;
        const totalWidth  = this.iv(attrs, "00480006");
        const totalHeight = this.iv(attrs, "00480007");
        // Columns/Rows are the *decoded frame* size. For a tiled object they are
        // also the tile size, but a single-frame Parametric Map keeps its own
        // (much smaller) raster here while TotalPixelMatrix describes the slide
        // area it covers — the two must not be conflated.
        const frameWidth  = this.iv(attrs, "00280011");
        const frameHeight = this.iv(attrs, "00280010");

        if (!(totalWidth && totalHeight && frameWidth && frameHeight && numberOfFrames >= 1)) {
            console.warn(`[DICOM] derived instance ${instanceUID} is not renderable ` +
                `(${totalWidth}×${totalHeight}, frame ${frameWidth}×${frameHeight}, ${numberOfFrames} frames); skipped.`);
            return;
        }

        const segCount = Math.max(item.segments.length, 1);
        let tilesX = Math.ceil(totalWidth / frameWidth);
        let tilesY = Math.ceil(totalHeight / frameHeight);
        const perFrameFG = attrs["52009230"]?.Value || null;

        // A single frame that cannot possibly tile the declared matrix is a
        // whole-slide raster at reduced resolution (the usual Parametric Map
        // shape). Model it as one logical tile spanning the full extent: OSD
        // stretches the small bitmap over the tile's bounds, which keeps the
        // overlay aligned with the slide instead of shrinking it into a corner.
        let tileWidth = frameWidth;
        let tileHeight = frameHeight;
        if (numberOfFrames === segCount && tilesX * tilesY > 1 && !perFrameFG) {
            tileWidth = totalWidth;
            tileHeight = totalHeight;
            tilesX = 1;
            tilesY = 1;
        }

        const level = this._injectLevelByDims(item, totalWidth, totalHeight, tileWidth, tileHeight);
        level.instanceUID = instanceUID;
        level.frames = level.frames || Object.create(null);
        level.pixel = item.pixel;
        level.frameWidth = frameWidth;
        level.frameHeight = frameHeight;

        const put = (tileX, tileY, segNumber, frameIndex) => {
            if (tileX < 0 || tileY < 0 || tileX >= tilesX || tileY >= tilesY) return false;
            const k = `${tileX}_${tileY}`;
            const cell = level.frames[k] || (level.frames[k] = Object.create(null));
            cell[segNumber] = frameIndex;
            return true;
        };

        let mapped = 0;
        if (Array.isArray(perFrameFG) && perFrameFG.length) {
            for (let i = 0; i < numberOfFrames; i++) {
                const fg = perFrameFG[i];
                if (!fg) continue;

                const planePos = fg["0048021A"]?.Value?.[0] || fg["00209113"]?.Value?.[0] || null;
                const colOff = this.fv(fg, "0048021E") ?? this.fv(planePos, "0048021E");
                const rowOff = this.fv(fg, "0048021F") ?? this.fv(planePos, "0048021F");
                if (!Number.isFinite(colOff) || !Number.isFinite(rowOff)) continue;

                // SegmentIdentificationSequence -> ReferencedSegmentNumber
                const segId = fg["0062000A"]?.Value?.[0] || null;
                const segNumber = this.iv(segId, "0062000B") ?? 1;

                // Positions are 1-based pixel offsets into the total matrix.
                if (put(Math.floor((colOff - 1) / tileWidth), Math.floor((rowOff - 1) / tileHeight), segNumber, i + 1)) {
                    mapped++;
                }
            }
        }

        if (mapped === 0) {
            // TILED_FULL: PS3.3 C.7.6.17.3 orders frames with the segment as the
            // slowest-varying dimension, then row-major tile position. Real SEG
            // objects (IDC's whole corpus included) ship no per-frame groups at
            // all, so this is the primary path, not a fallback.
            const perSegment = tilesX * tilesY;
            if (segCount * perSegment !== numberOfFrames) {
                console.error(
                    `[DICOM] derived instance ${instanceUID}: cannot map frames — ` +
                    `no per-frame positions and ${numberOfFrames} frames does not equal ` +
                    `${segCount} segment(s) × ${tilesX}×${tilesY} tiles. Overlay will be empty.`);
                return;
            }
            for (let s = 0; s < segCount; s++) {
                const segNumber = item.segments[s]?.number ?? (s + 1);
                for (let y = 0; y < tilesY; y++) {
                    for (let x = 0; x < tilesX; x++) {
                        put(x, y, segNumber, s * perSegment + y * tilesX + x + 1);
                        mapped++;
                    }
                }
            }
            level._strategy = "tiled-full-segment-major";
        } else {
            level._strategy = "per-frame-position";
        }

        console.info(`[DICOM] derived level dims=${totalWidth}×${totalHeight} grid=${tilesX}×${tilesY} ` +
            `frames=${numberOfFrames} segments=${item.segments.length} strategy=${level._strategy} ` +
            `mapped=${mapped} instance=${instanceUID}`);
    }

    /**
     * Read the Image Pixel module and the full display chain (Modality LUT,
     * VOI LUT, Palette Color LUT) off an instance-level dataset.
     *
     * The palette is only parsed for PALETTE COLOR instances — it can be a
     * 3×65536-entry payload and parsing it for every ordinary RGB pyramid level
     * would be pure waste.
     *
     * @param {object} attrs instance-level DICOM-JSON dataset
     * @returns {{pixel: object, modalityLut: ?object, voiLut: ?object, paletteLut: ?object}}
     */
    static parsePixelChain(attrs) {
        const pixel = parseImagePixel(attrs);
        return {
            pixel,
            modalityLut: parseModalityLut(attrs),
            voiLut: parseVoiLut(attrs),
            paletteLut: pixel.photometricInterpretation === "PALETTE COLOR"
                ? parsePaletteLut(attrs)
                : null,
        };
    }

    static async findWSIItems(client, studyUID, seriesUID, options = {}) {
        const base = `/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}/instances`;
        const { rows, total } = await this.qidoSafeWithMeta(client, base,
            //'00080018,00080008,00280010,00280011,00400512,00480106,00480006,00480007'
            [
                "52009230", // Per-Frame FG
                "00209157", // DimensionIndexValues
                "0048021E", // Column position (preferred ground truth)
                "0048021F", // Row position (preferred ground truth)
                "00209113", // PlanePosition(Slide) (fallback)
                "52009229", // Shared FG (carries DimensionIndexSequence)
                "00209222", // DimensionIndexSequence
                "00209165", // DimensionIndexPointer (resolves DIV axes)
                "00209311", // DimensionOrganizationType (TILED_FULL / TILED_SPARSE)
                "00480006", "00480007", // TotalPixelMatrix
                "00280010", "00280011", // Rows/Cols
                "00280008",             // NumberOfFrames
                "00080008",             // ImageType
                "00080018",             // SOPInstanceUID
            ].join(',')
        );
        // rows are already instance objects; pass through or normalize if needed.
        // Series-level metadata (description / modality / bodyPart / number) is
        // forwarded via options.seriesMeta so groupSeriesInstances can build a
        // human-readable label instead of a bare UID tail.
        const seriesObject = { studyUID, seriesUID, ...(options.seriesMeta || null) };
        const wsiInstances = await this.groupSeriesInstances(rows, seriesObject);

        for (let wsi of wsiInstances) {
            wsi.levels = [];
            // Persist series context + ordering overrides on the WSI object
            wsi.seriesUID = seriesUID;
            wsi.studyUID = studyUID;

// ordering controls (can be null)
            wsi.frameOrder = options.frameOrder || null;
            wsi.frameOrderBySeries = options.frameOrderBySeries || null;
            wsi.frameOrderByInstance = options.frameOrderByInstance || null;

            // Fetch every pyramid instance's metadata at once — the requests are
            // independent, and one round trip per level in series is most of a
            // slow open over a remote store. Ingest is kept strictly sequential
            // and in the original order: `_ingestInstanceMetadata` appends to
            // `wsi.levels`, so the pyramid ordering depends on it.
            const uids = wsi.pyramidInstances.map(instance => this.v(instance, "00080018"));
            const metas = await this.mapConcurrent(uids, METADATA_CONCURRENCY, uid =>
                this.wadoMetadata(client, `/studies/${studyUID}/series/${seriesUID}/instances/${uid}/metadata`));

            for (let i = 0; i < wsi.pyramidInstances.length; i++) {
                // Pass the string default (options.frameOrder), not the whole
                // options object — the per-instance / per-series overrides are
                // already stashed on `wsi` above.
                this._ingestInstanceMetadata(uids[i], wsi.pyramidInstances[i], metas[i], wsi,
                    options.frameOrder || null);
            }
            this._inferSequentialLayoutForWsi(wsi);
        }
        return wsiInstances;
    }

    /**
     * Listing-grade variant of findWSIItems: one QIDO instances call, grouped
     * into WSI items (label, previewInstanceUID, instance counts, series
     * context) — but WITHOUT the per-pyramid-instance WADO `/metadata`
     * ingestion. That loop is only needed to build actual pyramid geometry
     * for tile-source initialization and is the N+1 that made browser
     * listings crawl. Shallow items carry no `levels`; they are for display
     * and for handing (studyUID, seriesUID) to the open pipeline, which does
     * its own deep findWSIItems at TileSource init.
     */
    static async findWSIItemsShallow(client, studyUID, seriesUID, options = {}) {
        const base = `/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}/instances`;
        const { rows } = await this.qidoSafeWithMeta(client, base, [
            "00480006", "00480007", // TotalPixelMatrix
            "00280010", "00280011", // Rows/Cols
            "00280008",             // NumberOfFrames
            "00080008",             // ImageType
            "00080018",             // SOPInstanceUID
        ].join(','));
        const seriesObject = { studyUID, seriesUID, ...(options.seriesMeta || null) };
        const wsiInstances = await this.groupSeriesInstances(rows, seriesObject);
        for (const wsi of wsiInstances) {
            wsi.seriesUID = seriesUID;
            wsi.studyUID = studyUID;
            wsi.shallow = true;
        }
        return wsiInstances;
    }

    /**
     * Fetch a single instance's `/rendered` representation as an image Blob
     * (JPEG/PNG). Handles both single-part image responses and multipart
     * envelopes. Used for listing thumbnails (OVERVIEW/LABEL instances) —
     * the tile source's own preview path stays instance-side.
     */
    static async fetchRenderedInstance(client, studyUID, seriesUID, instanceUID, { preferPng = false } = {}) {
        if (!client || !studyUID || !seriesUID || !instanceUID) return null;
        const path = `/studies/${encodeURIComponent(studyUID)}` +
            `/series/${encodeURIComponent(seriesUID)}` +
            `/instances/${encodeURIComponent(instanceUID)}/rendered`;
        const accept = preferPng ? 'image/png, image/jpeg;q=0.9' : 'image/jpeg, image/png;q=0.9';
        const res = await client.fetchRaw(path, { headers: { Accept: accept } });
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.startsWith('image/jpeg') || ct.startsWith('image/png')) {
            return await res.blob();
        }
        const parts = await this.parseMultipartRelated(res);
        if (!parts.length) throw new Error("Rendered response missing");
        const { headers, bytes } = parts[0];
        const type = (headers['content-type'] || '').toLowerCase();
        const mime = type.includes('image/png') ? 'image/png'
            : (type.includes('image/jpeg') ? 'image/jpeg' : 'application/octet-stream');
        return new Blob([bytes], { type: mime });
    }

    /**
     * Byte-wise indexOf for multipart boundary scanning.
     *
     * Candidate positions come from the typed array's own `indexOf`, which is
     * native, instead of stepping one byte at a time from JS. A frame response is
     * hundreds of kilobytes and gets scanned several times per tile, so the naive
     * O(n·m) walk was several megabytes of comparisons per tile.
     */
    static indexOfBytes(hay, needle, from = 0) {
        if (!needle.length) return from;
        const last = hay.length - needle.length;
        const first = needle[0];

        for (let i = hay.indexOf(first, from); i >= 0 && i <= last; i = hay.indexOf(first, i + 1)) {
            let j = 1;
            while (j < needle.length && hay[i + j] === needle[j]) j++;
            if (j === needle.length) return i;
        }
        return -1;
    }

    /**
     * Parse a `multipart/related` Response into `[{ headers, bytes }]` parts.
     * Shared by the tile source (frames, rendered previews) and the listing
     * thumbnail path above.
     */
    static async parseMultipartRelated(res) {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        const m = ct.match(/boundary="?([^";]+)"?/);
        if (!m) throw new Error('multipart response missing boundary');
        const boundary = m[1];

        const data = new Uint8Array(await res.arrayBuffer());
        const enc = new TextEncoder();
        const dec = new TextDecoder('utf-8');

        const bStart = enc.encode(`--${boundary}\r\n`);
        const bMid   = enc.encode(`\r\n--${boundary}\r\n`);
        const bEnd   = enc.encode(`\r\n--${boundary}--`);

        let start = this.indexOfBytes(data, bStart, 0);
        if (start < 0) throw new Error('boundary start not found');

        const parts = [];
        while (true) {
            const nextMid = this.indexOfBytes(data, bMid, start + bStart.length);
            const nextEnd = this.indexOfBytes(data, bEnd, start + bStart.length);
            const next = (nextMid >= 0 && (nextMid < nextEnd || nextEnd < 0)) ? nextMid : nextEnd;

            const partStart = start + bStart.length;
            const partEnd = next >= 0 ? next : data.length;

            const hdrSep = enc.encode('\r\n\r\n');
            const headersEnd = this.indexOfBytes(data, hdrSep, partStart);
            if (headersEnd < 0 || headersEnd > partEnd) throw new Error('header/body separator not found');

            const headerBytes = data.subarray(partStart, headersEnd);
            const bodyStart = headersEnd + hdrSep.length;
            let bodyBytes = data.subarray(bodyStart, partEnd);

            // trim trailing CRLF before boundary
            const n = bodyBytes.length;
            if (n >= 2 && bodyBytes[n-2] === 0x0d && bodyBytes[n-1] === 0x0a) {
                bodyBytes = bodyBytes.subarray(0, n-2);
            }

            const headerText = dec.decode(headerBytes);
            const headers = {};
            headerText.split('\r\n').forEach(line => {
                const i = line.indexOf(':');
                if (i > 0) {
                    const key = line.slice(0, i).trim().toLowerCase();
                    const value = line.slice(i + 1).trim();
                    headers[key] = value;

                    // Extract transfer-syntax if it's hidden inside Content-Type
                    if (key === 'content-type' && value.includes('transfer-syntax=')) {
                        const tsMatch = value.match(/transfer-syntax=([^; ]+)/);
                        if (tsMatch) headers['transfer-syntax'] = tsMatch[1].replace(/['"]/g, "");
                    }
                }
            });
            parts.push({ headers, bytes: bodyBytes });

            if (next === nextEnd || next < 0) break;
            start = next;
        }

        return parts;
    }

    static toISODateTime(yyyymmdd, hhmmss) {
        const d = yyyymmdd || '';
        const t = hhmmss || '';
        const yyyy = d.slice(0,4), mm = d.slice(4,6), dd = d.slice(6,8);
        const HH = t.slice(0,2), MM = t.slice(2,4), SS = t.slice(4,6);
        if (!yyyy || !mm || !dd) return '';
        const timePart = (HH && MM) ? `T${HH}:${MM}:${SS || '00'}` : '';
        return `${yyyy}-${mm}-${dd}${timePart}`;
    }

    /**
     * Find the latest DICOM SR that references the given imaging series.
     *
     * @param {HttpClient} client
     * @param {string} studyUID — the study to search.
     * @param {string} [seriesUID] — when provided, only SR instances whose
     *   `ReferencedSeriesSequence[0].SeriesInstanceUID` matches are returned.
     *   Without this filter, opening different series from the same study would
     *   hydrate the same SR into both viewers (the encode side records the
     *   referenced series on every SR via annotation-convertor.mjs:332-335).
     *   Omit to keep the legacy "any latest SR in study" behavior.
     */
    static async findLatestAnnotation(client, studyUID, seriesUID) {
        // Request Modality (00080060) and Dates explicitly
        const seriesPath = `/studies/${studyUID}/series?includefield=00080060&includefield=00080021&includefield=00080031`;

        try {
            const seriesList = await this.qidoSafe(client, seriesPath);
            if (!seriesList || !seriesList.length) return null;

            // Filter for SR (Structured Report) series client-side
            const srSeriesList = seriesList.filter(s => this.v(s, '00080060') === 'SR');

            if (srSeriesList.length === 0) {
                console.log("No SR series found in this study.");
                return null;
            }

            const allCandidates = [];

            // Check every SR series for instances
            for (const series of srSeriesList) {
                const srSeriesUID = this.v(series, '0020000E');

                // Fetch instances with date tags
                const instancesPath = `/studies/${studyUID}/series/${srSeriesUID}/instances?includefield=00080023&includefield=00080033&includefield=00080012&includefield=00080013`;

                const instances = await this.qidoSafe(client, instancesPath);
                if (instances && instances.length) {
                    // Attach SeriesUID so we can use it later
                    instances.forEach(i => { i._parentSeriesUID = srSeriesUID; });
                    allCandidates.push(...instances);
                }
            }

            if (allCandidates.length === 0) return null;

            // Sort newest-first. Walking in this order lets the
            // `ReferencedSeriesSequence` filter short-circuit on the first
            // matching SR rather than fetching every candidate's metadata.
            const datetimeOf = (item) => {
                const clean = (val) => (val || '').replace(/[^0-9]/g, '');
                const date = clean(this.v(item, '00080023')) ||
                    clean(this.v(item, '00080012')) ||
                    clean(this.v(item, '00080021')) || '00000000';
                const time = clean(this.v(item, '00080033')) ||
                    clean(this.v(item, '00080013')) ||
                    clean(this.v(item, '00080031')) || '000000';
                return Number(date + time);
            };
            allCandidates.sort((a, b) => datetimeOf(b) - datetimeOf(a));

            // Without a seriesUID constraint, keep legacy behavior — return
            // the absolute newest SR in the study without touching metadata.
            if (!seriesUID) {
                const latest = allCandidates[0];
                const sopUID = this.v(latest, '00080018');
                console.log(`Found ${allCandidates.length} annotations. Newest:`, latest);
                return { seriesUID: latest._parentSeriesUID, sopUID };
            }

            // With seriesUID, fetch the candidates' metadata to read each
            // ReferencedSeriesSequence (tag 0008,1115 → SeriesInstanceUID
            // 0020,000E) and take the first match.
            //
            // Fetched a batch at a time rather than one candidate at a time: the
            // requests within a batch overlap, but the walk still short-circuits
            // on the first match, so a study with many SRs does not pay for all
            // of them. Order within a batch is preserved, so the winner is the
            // same one the fully serial walk picked.
            const withUid = allCandidates.filter(c => this.v(c, '00080018'));

            for (let start = 0; start < withUid.length; start += METADATA_CONCURRENCY) {
                const batch = withUid.slice(start, start + METADATA_CONCURRENCY);
                const metas = await this.mapConcurrent(batch, METADATA_CONCURRENCY, async (cand) => {
                    const sopUID = this.v(cand, '00080018');
                    try {
                        return await this.wadoMetadata(
                            client,
                            `/studies/${studyUID}/series/${cand._parentSeriesUID}/instances/${sopUID}/metadata`,
                        );
                    } catch (e) {
                        console.warn('[DICOM] SR metadata fetch failed; skipping candidate', sopUID, e?.message ?? e);
                        return null;
                    }
                });

                for (let i = 0; i < batch.length; i++) {
                    const refSeriesUID = metas[i]?.[0]?.['00081115']?.Value?.[0]?.['0020000E']?.Value?.[0];
                    if (refSeriesUID !== seriesUID) continue;
                    return { seriesUID: batch[i]._parentSeriesUID, sopUID: this.v(batch[i], '00080018') };
                }
            }
            return null;

        } catch (e) {
            console.warn("Error finding annotations:", e);
            return null;
        }
    }
    /* PRIVATE */

    static async groupSeriesInstances(instancesObject, seriesObject) {
        const _best = (v) => (typeof v === "string" && v.trim()) ? v.trim() : null;
        const _tail = (uid, n = 6) => (uid ? uid.slice(-n) : null);
        const _makeSeriesLabel = (group, seriesObject) => {
            const container = _best(group.containerIdentifier);
            const pathId    = _best(group.opticalPathId);
            const dims      = _best(group.totalPixelMatrix);
            const sDesc     = _best(seriesObject?.description);
            const sTail     = _tail(seriesObject?.seriesUID);
            const sNum      = seriesObject?.seriesNumber;
            const modality  = _best(seriesObject?.modality);
            const bodyPart  = _best(seriesObject?.bodyPart);

            // Pick the most informative primary name. Prefer ContainerIdentifier
            // (a real specimen ID), then SeriesDescription, then a friendly
            // "Series #N …<tail>" fallback. If we have both a container and a
            // description that says something different, combine them so the
            // operator sees the protocol context as well as the slot.
            let base;
            if (container && sDesc && container.toLowerCase() !== sDesc.toLowerCase()) {
                base = `${container} · ${sDesc}`;
            } else {
                base = container || sDesc || (sNum != null
                    ? $.t('series.fallbackNumbered', { ns: 'dicom', number: sNum, tail: sTail ?? "" })
                    : $.t('series.fallbackTail', { ns: 'dicom', tail: sTail ?? "" }));
            }

            const parts = [base];

            if (pathId && pathId !== "DEFAULT_PATH") parts.push(`[${pathId}]`);
            if (dims) parts.push(`• ${dims}`);

            // Modality + body-part are tiny but identify the slide type at a
            // glance. Only append when meaningful (skip the obvious "SM" if
            // nothing else differentiates the row).
            const tail = [];
            if (bodyPart) tail.push(bodyPart);
            if (modality && modality !== "SM") tail.push(modality);
            if (tail.length) parts.push(`(${tail.join(", ")})`);

            return parts.join(" ");
        };


        const groups = new Map();
        for (const ds of instancesObject) {
            if (!this.isWSIInstance(ds)) continue;

            const sopInstanceUID    = this.v(ds, "00080018");
            const rows      = Number(this.v(ds, "00280010")) || 0;
            const cols      = Number(this.v(ds, "00280011")) || 0;

            const container = this.v(ds, "00400512") || "UNKNOWN_CONTAINER"; // ContainerIdentifier
            const pathId    = this.v(ds, "00480106") || "DEFAULT_PATH";      // OpticalPathIdentifier
            const tpmC      = this.v(ds, "00480006"); // TotalPixelMatrixColumns
            const tpmR      = this.v(ds, "00480007"); // TotalPixelMatrixRows
            // todo better logics
            const key       = `${container}|${pathId}`;

            let g;
            if (!groups.has(key)) {
                g = {
                    containerIdentifier: container,
                    opticalPathId: pathId,
                    totalPixelMatrix: (tpmC && tpmR) ? `${tpmC}×${tpmR}` : null,
                    // wsi name
                    label: null,
                    // label item (image)
                    labelInstance: null,
                    overviewInstance: null,
                    pyramidInstances: [],
                    studyUID: seriesObject.studyUID,
                    seriesUID: seriesObject.seriesUID,
                    _bestSop: null, _bestArea: Infinity,
                    // SOPInstanceUIDs of the LABEL/OVERVIEW instances are filled
                    // in during the post-grouping loop below. The TileSource
                    // reads them via `wsi.previewInstanceUID` / `macroInstanceUID`
                    // and routes through `/rendered` (broadly supported,
                    // unlike `/thumbnail` which 404s on GCS Healthcare).
                    previewInstanceUID: null,
                    macroInstanceUID: null,
                };
                g.label = _makeSeriesLabel(g, seriesObject);
                groups.set(key, g);
            } else {
                g = groups.get(key);
            }

            // todo duplicate logics on the ingest metadata level
            const imageTypeRaw = (ds?.["00080008"]?.Value || []).map(x => String(x).toUpperCase());
            const imageType = imageTypeRaw.join("\\");

// classify special single-image instances
            if (/LABEL|MACRO/.test(imageType)) {
                g.labelInstance = ds;
                continue;
            }
            if (/OVERVIEW|THUMBNAIL/.test(imageType)) {
                g.overviewInstance = ds;
                continue;
            }

            // only consider multi-frame tiled instances as pyramid candidates
            const frames = Number(ds?.["00280008"]?.Value?.[0] ?? 0);
            if (!(frames > 1 && rows > 0 && cols > 0 && rows <= 1024 && cols <= 1024)) { // Increased to 1024
                continue;
            }

            // Prefer ORIGINAL pyramids. Keep DERIVED/RESAMPLED only as fallback.
            const isOriginal = imageTypeRaw.includes("ORIGINAL");
            const isDerived  = imageTypeRaw.includes("DERIVED") || imageTypeRaw.includes("RESAMPLED");

            g._pyrOriginal = g._pyrOriginal || [];
            g._pyrDerived  = g._pyrDerived  || [];

            if (isOriginal && !isDerived) g._pyrOriginal.push(ds);
            else g._pyrDerived.push(ds);
        }

        for (const g of groups.values()) {
            // Promote the LABEL/OVERVIEW SOPInstanceUIDs discovered above to
            // canonical fields on the WSI group. The TileSource's
            // getThumbnail / downloadMacroImage paths route these through
            // `/rendered`, which works on GCS Healthcare. Previously we
            // synthesized a `/thumbnail` URL on top of these instance UIDs,
            // which GCS returns 404 on — and the 404 carries no
            // `Access-Control-Allow-Origin`, so Chrome surfaces it as a loud
            // `CORS error`. Using `/rendered` via the existing
            // `previewInstanceUID` path avoids the failure entirely.
            const overviewUid = this.v(g.overviewInstance, "00080018");
            const labelUid    = this.v(g.labelInstance, "00080018");
            if (overviewUid) g.previewInstanceUID = overviewUid;
            if (labelUid)    g.macroInstanceUID   = labelUid;
            const originals = (g._pyrOriginal || []).slice();
            const derived   = (g._pyrDerived  || []).slice();

            const dimsOf = (ds) => {
                const tpmC = Number(this.v(ds, "00480006") ?? 0);
                const tpmR = Number(this.v(ds, "00480007") ?? 0);
                if (tpmC > 0 && tpmR > 0) return { w: tpmC, h: tpmR };

                const cols = Number(this.v(ds, "00280011") ?? 0);
                const rows = Number(this.v(ds, "00280010") ?? 0);
                return { w: cols, h: rows };
            };

            const aspectOK = (a, b, tol = 0.02) => {
                if (!a.w || !a.h || !b.w || !b.h) return false;
                const ra = a.w / a.h;
                const rb = b.w / b.h;
                return Math.abs(ra - rb) <= tol * Math.max(ra, rb);
            };

            originals.sort((A, B) => dimsOf(B).w - dimsOf(A).w);
            derived.sort((A, B) => dimsOf(B).w - dimsOf(A).w);

            let chosen = originals.length ? originals.slice() : [];

            if (chosen.length <= 1 && derived.length) {
                // Reference dims: use ORIGINAL dims if present; else use biggest derived dims
                const refDims = chosen.length ? dimsOf(chosen[0]) : dimsOf(derived[0]);

                // Take derived levels that:
                // - are smaller than the reference
                // - have ~same aspect ratio (so they are true downsample versions)
                // - are not duplicates of existing sizes
                const seen = new Set(chosen.map(ds => {
                    const d = dimsOf(ds);
                    return `${d.w}x${d.h}`;
                }));

                for (const ds of derived) {
                    const d = dimsOf(ds);
                    if (!d.w || !d.h) continue;
                    if (d.w >= refDims.w || d.h >= refDims.h) continue;
                    if (!aspectOK(d, refDims)) continue;

                    const key = `${d.w}x${d.h}`;
                    if (seen.has(key)) continue;
                    seen.add(key);

                    chosen.push(ds);
                }

                // Re-sort chosen (largest first)
                chosen.sort((A, B) => dimsOf(B).w - dimsOf(A).w);
            }

            // Final chosen pyramid instances
            g.pyramidInstances = chosen;
        }
        return Array.from(groups.values());
    }

    static _ingestInstanceMetadata(instanceUID, instance, metadata, wsiInstance, frameOrder) {
        const attrs = metadata?.[0] || {};

        // Frame of Reference (optional)
        if (!wsiInstance.frameOfReferenceUID) {
            wsiInstance.frameOfReferenceUID = this.v(attrs, "00200052");
        }

        const numberOfFrames = this.iv(attrs, "00280008") || 0;

        // --- Keep existing role detection logic (OVERVIEW / THUMBNAIL / LABEL / MACRO) ---
        const imageType = this.tag(attrs, "00080008")?.map(x => String(x).toUpperCase());
        const isSingleFrame = (numberOfFrames || 1) === 1;
        if (isSingleFrame && imageType?.length) {
            const tag = imageType.join("\\");
            if (!wsiInstance.previewInstanceUID && /OVERVIEW|THUMBNAIL/.test(tag)) wsiInstance.previewInstanceUID = instanceUID;
            if (!wsiInstance.macroInstanceUID && /LABEL|MACRO/.test(tag)) wsiInstance.macroInstanceUID = instanceUID;
        }

        // Dimensions
        const totalWidth  = this.iv(attrs, "00480006");  // TotalPixelMatrixColumns
        const totalHeight = this.iv(attrs, "00480007");  // TotalPixelMatrixRows
        const tileWidth   = this.iv(attrs, "00280011");  // Columns (tile)
        const tileHeight  = this.iv(attrs, "00280010");  // Rows (tile)

        // Per-frame functional groups
        const perFrameFG = attrs["52009230"]?.Value || null;

        // --- Robust PixelSpacing finder ---
        let spacingArr = attrs["00280030"]?.Value; // PixelSpacing
        if (!spacingArr) {
            const sfg = attrs["52009229"]?.Value?.[0];           // Shared FG
            const pms = sfg?.["00289110"]?.Value?.[0];           // Pixel Measures
            spacingArr = pms?.["00280030"]?.Value;
        }
        if (!spacingArr) {
            const nominal = this.fv(attrs, "00182010");          // Nominal Scanned Pixel Spacing
            if (nominal) spacingArr = [nominal, nominal];
        }
        if (!spacingArr) {
            const imager = this.fv(attrs, "00181164");           // Imager Pixel Spacing
            if (imager) spacingArr = [imager, imager];
        }

        const applySpacingToLevel = (level) => {
            const m = spacingArr || null;
            if (m && (!level.micronsX || !level.micronsY)) {
                level.micronsX = Number(m[0]);
                level.micronsY = Number(m[1] ?? m[0]);
            }
            if (!level.micronsX || !level.micronsY) {
                level.micronsX = level.micronsX || 0.00025;
                level.micronsY = level.micronsY || 0.00025;
            }
        };

        // Image Pixel module + display chain. Read once per instance here so the
        // tile source never has to guess: before this existed the decoder was
        // handed a hardcoded 8-bit RGB descriptor, which silently corrupted
        // every monochrome, palette or >8-bit instance.
        const pixelChain = this.parsePixelChain(attrs);
        if (!wsiInstance.pixel) {
            wsiInstance.pixel = pixelChain.pixel;
            wsiInstance.photometricInterpretation = pixelChain.pixel.photometricInterpretation;
        }

        // Only attempt mapping for multi-frame tiled instances
        if (!(totalWidth && totalHeight && tileWidth && tileHeight && numberOfFrames > 1)) return;

        const tilesX = Math.ceil(totalWidth / tileWidth);
        const tilesY = Math.ceil(totalHeight / tileHeight);
        const expected = tilesX * tilesY;

        const level = this._injectLevelByDims(wsiInstance, totalWidth, totalHeight, tileWidth, tileHeight);
        level.instanceUID = instanceUID;
        level.frames = level.frames || Object.create(null);
        applySpacingToLevel(level);
        // Per-level, because a DICOM pyramid may mix instances that differ in
        // bit depth or photometric interpretation (a DERIVED thumbnail level is
        // frequently 8-bit RGB over a 16-bit monochrome base).
        Object.assign(level, pixelChain);

        // Resolve user-provided ordering override once (applies only to the
        // sequential fallback path; never overrides explicit per-frame data).
        const overrideOrder =
            (wsiInstance.frameOrderByInstance && wsiInstance.frameOrderByInstance[instanceUID]) ||
            (wsiInstance.frameOrderBySeries && wsiInstance.frameOrderBySeries[wsiInstance.seriesUID]) ||
            frameOrder ||
            wsiInstance.frameOrder ||
            null;

        // Detect TILED_FULL vs TILED_SPARSE. Used to bound the sequential
        // fallback (TILED_SPARSE without per-frame data is a malformed file).
        const dimOrgType = String(this.v(attrs, "00209311") || "").toUpperCase().trim() || null;

        // --- Build one candidate map ----------------------------------------
        // Returns { frames, mapped, collisions, oob } for a per-frame mapper
        // that, given (frameIndex, fg), produces tileX/tileY (or null).
        const buildFrameMap = (resolver) => {
            const frames = Object.create(null);
            let mapped = 0, collisions = 0, oob = 0;

            if (!Array.isArray(perFrameFG) || !perFrameFG.length) {
                return { frames, mapped, collisions, oob, supported: false };
            }

            for (let frameIndex = 0; frameIndex < numberOfFrames; frameIndex++) {
                const fg = perFrameFG[frameIndex];
                if (!fg) continue;

                const pos = resolver(frameIndex, fg);
                if (!pos) continue;
                const { tileX, tileY } = pos;
                if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) continue;
                if (tileX < 0 || tileY < 0 || tileX >= tilesX || tileY >= tilesY) { oob++; continue; }

                const k = `${tileX}_${tileY}`;
                if (frames[k] == null) mapped++;
                else collisions++;
                frames[k] = frameIndex + 1;
            }
            return { frames, mapped, collisions, oob, supported: true };
        };

        // Strict acceptance: every cell of the grid must be uniquely populated.
        const accepts = (cand) => cand.supported && cand.mapped === expected && cand.collisions === 0;

        // ---------- Strategy 1: pixel positions (unambiguous ground truth) --
        const pixelPosResolver = (_idx, fg) => {
            const planePos =
                fg["0048021A"]?.Value?.[0] ||
                fg["00209113"]?.Value?.[0] ||
                null;
            const colOff =
                this.fv(fg, "0048021E") ??
                this.fv(planePos, "0048021E");
            const rowOff =
                this.fv(fg, "0048021F") ??
                this.fv(planePos, "0048021F");
            if (!Number.isFinite(colOff) || !Number.isFinite(rowOff)) return null;
            return { tileX: Math.floor(colOff / tileWidth), tileY: Math.floor(rowOff / tileHeight) };
        };

        const pixelMap = buildFrameMap(pixelPosResolver);
        if (accepts(pixelMap)) {
            level.frames = pixelMap.frames;
            level._strategy = "pixel-pos";
            this._logFrameStrategy(wsiInstance, instanceUID, level, tilesX, tilesY, numberOfFrames, "pixel-pos", pixelMap);
            return;
        }

        // ---------- Strategy 2: DimensionIndexSequence-resolved DIV ---------
        // DIS lives in the Shared Functional Groups (52009229).
        const sharedFG = attrs["52009229"]?.Value?.[0] || null;
        const dis = sharedFG?.["00209222"]?.Value || attrs["00209222"]?.Value || null;
        let xSlot = -1, ySlot = -1;
        if (Array.isArray(dis)) {
            for (let i = 0; i < dis.length; i++) {
                const ptr = this.v(dis[i], "00209165"); // DimensionIndexPointer
                const ptrTag = String(ptr || "").replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
                if (ptrTag === "0048021E") xSlot = i;
                else if (ptrTag === "0048021F") ySlot = i;
            }
        }

        if (xSlot >= 0 && ySlot >= 0 && xSlot !== ySlot) {
            const disResolver = (_idx, fg) => {
                const div = fg["00209157"]?.Value;
                if (!Array.isArray(div)) return null;
                const xRaw = Number(div[xSlot]);
                const yRaw = Number(div[ySlot]);
                if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) return null;
                return { tileX: xRaw - 1, tileY: yRaw - 1 };
            };
            const disMap = buildFrameMap(disResolver);
            if (accepts(disMap)) {
                level.frames = disMap.frames;
                level._strategy = "div-dis";
                this._logFrameStrategy(wsiInstance, instanceUID, level, tilesX, tilesY, numberOfFrames, "div-dis", disMap);
                return;
            }
        }

        // ---------- Strategy 3: heuristic DIV (legacy) ----------------------
        // Try both axis assignments; accept ONLY if exactly one is full+clean.
        // Refuse to silently pick when both are full — that's the documented
        // source of the high-res striping bug.
        const mkHeuristic = (mode) => (_idx, fg) => {
            const div = fg["00209157"]?.Value;
            if (!Array.isArray(div) || div.length < 2) return null;
            const a = Number(div[0]) - 1;
            const b = Number(div[1]) - 1;
            if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
            return mode === "xy" ? { tileX: a, tileY: b } : { tileX: b, tileY: a };
        };
        const heurXY = buildFrameMap(mkHeuristic("xy"));
        const heurYX = buildFrameMap(mkHeuristic("yx"));
        const okXY = accepts(heurXY);
        const okYX = accepts(heurYX);
        if (okXY && !okYX) {
            level.frames = heurXY.frames;
            level._strategy = "div-heuristic-xy";
            this._logFrameStrategy(wsiInstance, instanceUID, level, tilesX, tilesY, numberOfFrames, "div-heuristic-xy", heurXY);
            return;
        }
        if (okYX && !okXY) {
            level.frames = heurYX.frames;
            level._strategy = "div-heuristic-yx";
            this._logFrameStrategy(wsiInstance, instanceUID, level, tilesX, tilesY, numberOfFrames, "div-heuristic-yx", heurYX);
            return;
        }
        if (okXY && okYX) {
            console.warn(
                `[DICOM] Ambiguous DIV axes for instance ${instanceUID} (level ${tilesX}×${tilesY}, ${numberOfFrames} frames): ` +
                "both div_xy and div_yx fully map the grid. Falling back to sequential layout. " +
                "Override with frameOrderByInstance / frameOrderBySeries in plugin options if the result is wrong."
            );
        }

        // ---------- Strategy 4: DimensionOrganizationType-informed sequential
        // Only bail on TILED_SPARSE when the frame count genuinely can't tile
        // the grid. When expected === numberOfFrames, the SPARSE label is
        // effectively misleading metadata — fall through to the sequential
        // assignment block, and let post-loop inference rewrite the layout
        // using truth levels from the same WSI if any exist.
        if (dimOrgType === "TILED_SPARSE" && !overrideOrder && expected !== numberOfFrames) {
            console.error(
                `[DICOM] Malformed TILED_SPARSE instance ${instanceUID}: ` +
                `frame count ${numberOfFrames} does not cover grid ${tilesX}×${tilesY} (${expected} tiles) ` +
                "and no per-frame positions are present. Tiles will fail-fast. " +
                "Provide frameOrderByInstance in plugin options if you know the layout."
            );
            return;
        }

        if (expected === numberOfFrames) {
            // TILED_FULL standard layout is row-major; honor explicit user overrides above all.
            // Inference (post-loop) may rewrite this map when no user override
            // was supplied and other levels carry per-frame truth.
            const resolved = overrideOrder || "row-major";
            level.frames = this._buildSequentialFrames(tilesX, tilesY, resolved);
            level._overrideApplied = !!overrideOrder;
            level._strategy = overrideOrder
                ? `sequential-${String(resolved).toLowerCase()}`
                : (dimOrgType === "TILED_FULL" ? "sequential-tiled-full-row-major" : "sequential-row-major-legacy");
            this._logFrameStrategy(wsiInstance, instanceUID, level, tilesX, tilesY, numberOfFrames, level._strategy,
                { mapped: expected, collisions: 0, oob: 0 });
            return;
        }

        // Out of options.
        console.warn(
            `[DICOM] WSI frame-map mismatch for instance ${instanceUID}: ` +
            `grid ${tilesX}×${tilesY} (${expected} tiles) vs ${numberOfFrames} frames, ` +
            `dimOrgType=${dimOrgType || "unknown"}. Tiles will fail-fast.`
        );
    }

    /**
     * The 8 sequential layout patterns the plugin understands.
     * row/col-major × {plain, serpentine} × {flipY off, flipY on}.
     */
    static SEQUENTIAL_LAYOUTS = [
        "row-major",
        "row-major-flipY",
        "row-major-serpentine",
        "row-major-serpentine-flipY",
        "col-major",
        "col-major-flipY",
        "col-major-serpentine",
        "col-major-serpentine-flipY",
    ];

    /**
     * Return the 1-based frame index that the named layout places at tile
     * coordinate (x, y) inside a tilesX × tilesY grid.
     */
    static _sequentialFrameAt(x, y, tilesX, tilesY, orderName) {
        const o = String(orderName).toLowerCase();
        const flipY = o.includes("flipy");
        const serp = o.includes("serpentine");
        const colMajor = o.startsWith("col-major");
        const yy = flipY ? (tilesY - 1 - y) : y;
        if (!colMajor) {
            const base = yy * tilesX;
            if (!serp) return base + x + 1;
            const xx = (yy % 2 === 1) ? (tilesX - 1 - x) : x;
            return base + xx + 1;
        }
        const base = x * tilesY;
        if (!serp) return base + yy + 1;
        const yyy = (x % 2 === 1) ? (tilesY - 1 - yy) : yy;
        return base + yyy + 1;
    }

    static _buildSequentialFrames(tilesX, tilesY, orderName) {
        const frames = Object.create(null);
        for (let y = 0; y < tilesY; y++) {
            for (let x = 0; x < tilesX; x++) {
                frames[`${x}_${y}`] = this._sequentialFrameAt(x, y, tilesX, tilesY, orderName);
            }
        }
        return frames;
    }

    /**
     * After every instance in a WSI group has been ingested, look at the
     * levels that resolved from explicit per-frame metadata (pixel-pos,
     * div-dis, unambiguous div-heuristic) and see whether any of the eight
     * sequential layout patterns reproduces those ground-truth maps. If one
     * pattern fits *every* truth level (≥99% per level), apply it to the
     * sequential levels that did not have an explicit user override.
     *
     * Why per-level min-score (not average): a sequential layout claim is
     * only credible if it explains the data on every truth level. A pattern
     * that fits one level perfectly and another not at all is not the
     * scanner's canonical layout — it's a coincidence on a single grid size.
     */
    static _inferSequentialLayoutForWsi(wsi) {
        if (!wsi?.levels?.length) return;

        const truthLevels = wsi.levels.filter(L =>
            L?._strategy && /^(pixel-pos|div-)/.test(L._strategy) && L.frames
        );
        const targets = wsi.levels.filter(L =>
            L?._strategy?.startsWith("sequential-") && !L._overrideApplied && L.width && L.height && L.tileWidth && L.tileHeight
        );

        if (!truthLevels.length || !targets.length) return;

        // Score each candidate against every truth level; track the minimum.
        let best = null;
        for (const name of this.SEQUENTIAL_LAYOUTS) {
            let minScore = 1.0;
            for (const T of truthLevels) {
                const tilesX = Math.ceil(T.width / T.tileWidth);
                const tilesY = Math.ceil(T.height / T.tileHeight);
                const cells = tilesX * tilesY;
                if (cells <= 0) { minScore = 0; break; }

                let hits = 0;
                for (let y = 0; y < tilesY; y++) {
                    for (let x = 0; x < tilesX; x++) {
                        const want = T.frames[`${x}_${y}`];
                        if (want == null) continue;
                        if (this._sequentialFrameAt(x, y, tilesX, tilesY, name) === want) hits++;
                    }
                }
                const score = hits / cells;
                if (score < minScore) minScore = score;
                if (minScore < (best?.minScore ?? 0)) break;
            }
            if (!best || minScore > best.minScore) best = { name, minScore };
        }

        const truthDims = truthLevels.map(L => `${L.width}×${L.height}`).join(", ");

        if (best && best.minScore >= 0.99 && best.name !== "row-major") {
            // Apply the inferred pattern to all sequential targets.
            for (const T of targets) {
                const tilesX = Math.ceil(T.width / T.tileWidth);
                const tilesY = Math.ceil(T.height / T.tileHeight);
                T.frames = this._buildSequentialFrames(tilesX, tilesY, best.name);
                T._strategy = `sequential-inferred-${best.name}`;
            }
            console.info(
                `[DICOM] inferred sequential layout=${best.name} ` +
                `(min truth-level match=${(best.minScore * 100).toFixed(1)}%, ` +
                `truth dims=[${truthDims}]); applied to ${targets.length} level(s)`
            );
            return;
        }

        if (best && best.minScore >= 0.99 && best.name === "row-major") {
            // Default row-major already in place — confirm in logs for traceability.
            console.info(
                `[DICOM] inferred sequential layout=row-major confirmed by truth levels [${truthDims}]; ` +
                `${targets.length} target level(s) already row-major`
            );
            return;
        }

        const bestScore = best ? (best.minScore * 100).toFixed(1) : "0";
        console.warn(
            `[DICOM] could not infer sequential layout from truth levels [${truthDims}] ` +
            `(best candidate=${best?.name ?? "n/a"}, min-match=${bestScore}%). ` +
            `${targets.length} level(s) remain row-major. ` +
            "Set frameOrderByInstance / frameOrderBySeries in plugin options if tiles look misaligned."
        );
    }

    static _logFrameStrategy(wsiInstance, instanceUID, level, tilesX, tilesY, numberOfFrames, strategy, stats) {
        const expected = tilesX * tilesY;
        const coverage = expected > 0 ? ((stats.mapped / expected) * 100).toFixed(1) : "0.0";
        const idx = wsiInstance?.levels ? wsiInstance.levels.indexOf(level) : -1;
        const dims = level.width != null ? `${level.width}×${level.height}` : "?";
        // One concise line per level — searchable, single-grep diagnostic.
        console.info(
            `[DICOM] level=${idx >= 0 ? idx : "?"} dims=${dims} grid=${tilesX}×${tilesY} frames=${numberOfFrames} ` +
            `strategy=${strategy} coverage=${coverage}% collisions=${stats.collisions || 0} oob=${stats.oob || 0} ` +
            `instance=${instanceUID}`
        );
    }

    static _injectLevelByDims(wsiInstance, totalWidth, totalHeight, tileWidth, tileHeight) {
        const levels = wsiInstance.levels;

        for (let i = 0; i < wsiInstance.levels.length; i++) {
            const L = levels[i];
            if (L.width != null && L.height != null &&
                Math.abs(L.width - totalWidth) <= 1 && Math.abs(L.height - totalHeight) <= 1) {

                if (L.tileWidth == null && tileWidth != null)  L.tileWidth  = tileWidth;
                if (L.tileHeight == null && tileHeight != null) L.tileHeight = tileHeight;

                return L;
            }
        }

        let insertIdx = levels.length;
        for (let i = 0; i < levels.length; i++) {
            const L = levels[i];
            if (L.width != null && L.height != null) {
                if (totalWidth > L.width) { insertIdx = i; break; } // bigger => more detailed => earlier
            } else {
                insertIdx = i; break;
            }
        }
        const newLevel = {
            width: totalWidth ?? null,
            height: totalHeight ?? null,
            tileWidth: tileWidth ?? null,
            tileHeight: tileHeight ?? null,
        };

        levels.splice(insertIdx, 0, newLevel);
        return newLevel;
    }

    static _readTotalHeader(h) {
        // Lower-case header names – fetch() Headers is case-insensitive
        return ['x-total-count', 'total-count', 'dicom-total', 'x-total']
            .map(k => h.get(k))
            .filter(Boolean)
            .map(x => Number(x))
            .find(n => Number.isFinite(n)) ?? null;
    }
}