import {
    canDeferVoiToShader,
    isMonochrome as isMonochromePixel,
    parseImagePixel,
    parseModalityLut,
    parseVoiLut,
    parsePaletteLut,
    parseRealWorldRange,
    storedValueRange,
    cielabToSrgb,
    hueForIndex,
} from './pixel-pipeline.mjs';
import {
    buildPlaneModel,
    chooseValueRange,
    planeCandidateFromInstance,
    planeCandidatesFromMultiframe,
} from './radiology-geometry.mjs';
import { parseOrientation } from './slide-orientation.mjs';

/**
 * Cap on memoized WADO metadata responses per client. A slide open touches a
 * handful of instances; this only exists so a long browsing session cannot grow
 * the map without bound.
 */
const META_CACHE_MAX = 256;

/**
 * Cap on memoized QIDO responses per client. See {@link DicomTools._memoQuery}.
 */
const QIDO_CACHE_MAX = 128;

/**
 * How long a QIDO answer may be reused.
 *
 * Unlike instance metadata, a query result is NOT immutable — a store can gain
 * instances (a freshly STOW-ed SR is the case that matters) while the session is
 * open. So this is a short coalescing window, not a session cache: it exists to
 * collapse the burst of identical queries several independent consumers fire
 * during one slide open, not to remember anything. A write through `stow`
 * invalidates the client's window outright.
 */
const QIDO_TTL_MS = 30000;

/**
 * How many metadata requests to keep in flight when walking independent
 * instances. Enough to hide a remote store's latency, low enough not to crowd
 * out the tile requests that are the point of the open.
 */
const METADATA_CONCURRENCY = 6;

export default class DicomTools {

    /** client -> Map(path -> Promise<metadata>). See `wadoMetadata`. */
    static _metaCaches = new WeakMap();

    /** client -> Map(key -> {at, promise}). See `_memoQuery`. */
    static _qidoCaches = new WeakMap();

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

    /**
     * @param {object} [options]
     * @param {"normal"|"background"} [options.priority] Connection-pool hint,
     *   NOT a security or correctness knob. `"background"` routes through
     *   `APPLICATION_CONTEXT.requestScheduler`, which admits zero background
     *   requests while any viewer is loading tiles (with a starvation escape).
     *   Use it for anything the user is not waiting on — browser listings,
     *   previews, annotation discovery. Do NOT use it for a query the first
     *   tile depends on: the pyramid scan is the slide open.
     *
     *   The priority is deliberately absent from the memo key. It describes how
     *   urgently to fetch, not what comes back, so a background caller happily
     *   reuses an answer a foreground caller already paid for.
     */
    static async qido(client, path, options = {}) {
        // Memoized on the composed path, so `qidoSafe`'s `includefield` variants
        // are distinct keys and are covered without its own cache.
        return this._memoQuery(client, `q:${path}`, () => this._fetchQido(client, path, options));
    }

    static async _fetchQido(client, path, options = {}) {
        try {
            const res = await client.fetchRaw(path, {
                headers: { Accept: 'application/dicom+json' },
                priority: options.priority,
            });
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
    static async qidoSafe(client, path, includefield, options = {}) {
        const sep = path.includes('?') ? '&' : '?';
        const pathWithField = includefield ? `${path}${sep}includefield=${encodeURIComponent(includefield)}` : path;
        try {
            return await this.qido(client, pathWithField, options);
        } catch (e) {
            const msg = String(e?.message || '');
            if (includefield && (msg.includes('includefield') || msg.includes('Invalid JSON payload'))) {
                return await this.qido(client, path, options);
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
    static async qidoSafeWithMeta(client, path, includefield, options = {}) {
        return this._memoQuery(client, `m:${path}|${includefield ?? ""}`,
            () => this._fetchQidoWithMeta(client, path, includefield, options));
    }

    static async _fetchQidoWithMeta(client, path, includefield, options = {}) {
        const sep = path.includes('?') ? '&' : '?';
        const make = (withFields) => withFields && includefield ? `${path}${sep}includefield=${encodeURIComponent(includefield)}` : path;

        const tryFetch = (p) => client.fetchRaw(p, {
            headers: { Accept: 'application/dicom+json' },
            priority: options.priority,
        });

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
    static async wadoMetadata(client, path, options = {}) {
        // An enhanced multi-frame instance carries one Per-Frame Functional
        // Groups item per frame, so a 300-slice CT's `/metadata` can be tens of
        // megabytes of JSON. Callers that read it once and keep only a derived
        // summary opt out rather than pinning that in the cache for the session.
        if (options.memoize === false) return this._fetchWadoMetadata(client, path, options);

        const cache = this._metaCacheFor(client);
        const hit = cache.get(path);
        if (hit) {
            // Refresh recency — a slide open touches a small working set of paths
            // repeatedly and they should outlive an unrelated sweep.
            cache.delete(path);
            cache.set(path, hit);
            return hit;
        }

        const promise = this._fetchWadoMetadata(client, path, options);

        // A failure must not be remembered — the next caller has to be able to retry.
        promise.catch(() => cache.delete(path));

        cache.set(path, promise);
        while (cache.size > META_CACHE_MAX) cache.delete(cache.keys().next().value);
        return promise;
    }

    static async _fetchWadoMetadata(client, path, options = {}) {
        try {
            const res = await client.fetchRaw(path, {
                headers: { Accept: 'application/dicom+json' },
                priority: options.priority,
            });
            const text = await res.text();
            try { return JSON.parse(text); } catch (e) { throw new Error(`Bad DICOM JSON: ${e.message} - body: ${text}`); }
        } catch (e) {
            if (e instanceof HTTPError) throw new Error(`WADO ${path} failed: ${e.statusCode} ${e.textData || ''}`);
            throw e;
        }
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
     * Short-window memo for QIDO, shared in flight.
     *
     * QIDO had no caching at all, and several consumers legitimately ask the
     * same question during one slide open — the tile source builds its pyramid
     * from a series' instances, the browser lists the same series, the
     * capability probe re-runs per consumer. In a measured Google Healthcare
     * open the 16-field `…/instances` query went out **four** times and
     * `/patients?limit=1` **four** times, each ~0.7-3 s and each with its own
     * CORS preflight.
     *
     * Deliberately NOT the same policy as `wadoMetadata`: instance metadata is
     * immutable for its SOP Instance UID and is cached for the session, whereas
     * a query answer can go stale the moment anything is written. Hence
     * {@link QIDO_TTL_MS} and the explicit invalidation in `stow`.
     *
     * Cached per client — two `HttpClient`s can carry different auth contexts,
     * and one caller's results must never be served to another.
     */
    static async _memoQuery(client, key, factory) {
        let cache = this._qidoCaches.get(client);
        if (!cache) {
            cache = new Map();   // insertion-ordered ⇒ usable as an LRU
            this._qidoCaches.set(client, cache);
        }

        const hit = cache.get(key);
        if (hit && (Date.now() - hit.at) < QIDO_TTL_MS) {
            // Refresh recency, not the timestamp: a hot key must still expire
            // on schedule, otherwise a repeatedly-polled query never refetches.
            cache.delete(key);
            cache.set(key, hit);
            return hit.promise;
        }
        if (hit) cache.delete(key);

        const promise = factory();
        // A failure must not be remembered — the next caller has to be able to retry.
        promise.catch(() => {
            if (cache.get(key)?.promise === promise) cache.delete(key);
        });

        cache.set(key, { at: Date.now(), promise });
        while (cache.size > QIDO_CACHE_MAX) cache.delete(cache.keys().next().value);
        return promise;
    }

    /**
     * Drop memoized QIDO answers for one client (or all of them). Called after
     * any write that can change what a query returns.
     */
    static clearQueryCache(client = null) {
        if (client) this._qidoCaches.delete(client);
        else this._qidoCaches = new WeakMap();
    }

    /** client -> Promise<boolean>. See `supportsPatients`. */
    static _patientsProbes = new WeakMap();

    /**
     * Whether the store implements the (non-standard) `/patients` QIDO resource.
     *
     * Keyed by **client**, not by plugin instance. The plugin used to memoize
     * this on `this`, and it still went out four times in one session — so the
     * instance is not a reliable identity for it. The client is: it is what the
     * answer is actually a property of.
     *
     * Never re-probed once answered, including a negative answer. On a store
     * without `/patients` (Google Healthcare) the CORS *preflight* is what 404s,
     * so each attempt is two failed requests and a console error that looks like
     * a bug to whoever is reading the log.
     */
    static supportsPatients(client) {
        let probe = this._patientsProbes.get(client);
        if (!probe) {
            probe = (async () => {
                try {
                    await client.fetchRaw('/patients?limit=1', { headers: { Accept: 'application/dicom+json' } });
                    return true;
                } catch (e) {
                    // Any HTTPError (or network/CORS error) → treat as unsupported.
                    return false;
                }
            })();
            this._patientsProbes.set(client, probe);
        }
        return probe;
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

        // The store now holds an instance it did not hold a moment ago, so every
        // memoized query answer for this client is potentially stale — most
        // importantly the SR listing that `findLatestAnnotation` reads back
        // right after a save. Metadata is keyed by SOP Instance UID and stays
        // valid, so only the query window is dropped.
        this.clearQueryCache(client);

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

    /* RADIOLOGY (CT / MR / PT / CR / DX / NM) */

    /**
     * SOP classes we can render as a windowed intensity stack, and the modality
     * each implies. Deliberately absent, and not oversights:
     *
     * - `…1.1.4.2` MR Spectroscopy — the "pixels" are spectra, not an image.
     * - `…1.1.7`   Secondary Capture — a screenshot; no reliable geometry and
     *              often already windowed and burned to 8 bits.
     * - `…1.1.6.1` Ultrasound — frames are *time*, not depth, and the sector
     *              geometry is not a stack.
     *
     * See `radiology-geometry.mjs` for the rest of the refusal list.
     */
    static RADIOLOGY_SOP_CLASSES = new Map([
        ["1.2.840.10008.5.1.4.1.1.2",     "CT"],   // CT Image
        ["1.2.840.10008.5.1.4.1.1.2.1",   "CT"],   // Enhanced CT
        ["1.2.840.10008.5.1.4.1.1.2.2",   "CT"],   // Legacy Converted Enhanced CT
        ["1.2.840.10008.5.1.4.1.1.4",     "MR"],   // MR Image
        ["1.2.840.10008.5.1.4.1.1.4.1",   "MR"],   // Enhanced MR
        ["1.2.840.10008.5.1.4.1.1.4.3",   "MR"],   // Enhanced MR Colour (monochrome subset only)
        ["1.2.840.10008.5.1.4.1.1.4.4",   "MR"],   // Legacy Converted Enhanced MR
        ["1.2.840.10008.5.1.4.1.1.128",   "PT"],   // PET Image
        ["1.2.840.10008.5.1.4.1.1.128.1", "PT"],   // Legacy Converted Enhanced PET
        ["1.2.840.10008.5.1.4.1.1.130",   "PT"],   // Enhanced PET
        ["1.2.840.10008.5.1.4.1.1.1",     "CR"],   // Computed Radiography
        ["1.2.840.10008.5.1.4.1.1.1.1",   "DX"],   // Digital X-Ray (for presentation)
        ["1.2.840.10008.5.1.4.1.1.1.1.1", "DX"],   // Digital X-Ray (for processing)
        ["1.2.840.10008.5.1.4.1.1.20",    "NM"],   // Nuclear Medicine
    ]);

    static RADIOLOGY_MODALITIES = new Set(["CT", "MR", "PT", "CR", "DX", "NM"]);

    /**
     * True for an instance the radiology tile source can render.
     *
     * Exclusive by construction: WSI and derived objects are tested first and
     * always win, so this can never claim a slide or a segmentation even when a
     * store reports an ambiguous Modality. `isWSIInstance` is untouched by this
     * and stays the sole authority on what a slide is.
     */
    static isRadiologyInstance(ds) {
        if (!ds) return false;
        if (this.isWSIInstance(ds)) return false;
        if (this.isSegInstance(ds) || this.isParametricMapInstance(ds)) return false;

        if (this.RADIOLOGY_SOP_CLASSES.has(this.v(ds, "00080016"))) return true;
        return this.RADIOLOGY_MODALITIES.has(this.v(ds, "00080060"));
    }

    /**
     * `"volume"` for modalities whose instances stack along a depth axis,
     * `"projection"` for the ones that produce a single image (CR/DX), `null`
     * for anything this reader does not own.
     */
    static radiologyGeometryOf(ds) {
        if (!this.isRadiologyInstance(ds)) return null;
        const modality = this.RADIOLOGY_SOP_CLASSES.get(this.v(ds, "00080016"))
            ?? this.v(ds, "00080060");
        return (modality === "CR" || modality === "DX") ? "projection" : "volume";
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

        // Candidates are independent of one another, so they are probed
        // concurrently. This runs inside `before-open`, which the open pipeline
        // AWAITS — the tile source is not even constructed until it returns — so
        // a serial walk here is time the slide spends showing nothing. Order is
        // preserved by `mapConcurrent`, so the resulting index is identical to
        // the one the serial loop produced.
        const probed = await this.mapConcurrent(candidates, METADATA_CONCURRENCY, async (s) => {
            const seriesUID = this.v(s, "0020000E");
            if (!seriesUID) return null;

            let instances;
            try {
                instances = await this.qidoSafe(client,
                    `/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}/instances`,
                    "00080016,00080018");
            } catch (e) {
                console.warn(`[DICOM] derived-series probe failed for ${seriesUID}:`, e?.message ?? e);
                return null;
            }
            const first = (instances || [])[0];
            const instanceUID = this.v(first, "00080018");
            if (!instanceUID) return null;

            let sopClass = this.v(first, "00080016");
            let meta = null;
            if (!sopClass || sopClass === this.SOP_SEGMENTATION || sopClass === this.SOP_PARAMETRIC_MAP) {
                try {
                    meta = (await this.wadoMetadata(client,
                        `/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}` +
                        `/instances/${encodeURIComponent(instanceUID)}/metadata`))?.[0] || null;
                } catch (e) {
                    console.warn(`[DICOM] derived-series metadata failed for ${seriesUID}:`, e?.message ?? e);
                    return null;
                }
                sopClass = sopClass || this.v(meta, "00080016");
            }
            if (!meta) return null;

            const kind = sopClass === this.SOP_SEGMENTATION ? "seg"
                : (sopClass === this.SOP_PARAMETRIC_MAP ? "pmap" : null);
            if (!kind) return null;

            // The probe already holds one instance's metadata, so the segment
            // list (and therefore the overlay's colours and labels) is free
            // here. Deferring it to tile-source init would mean the shader
            // config is assembled before the segments are known.
            return {
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
            };
        });

        return { derived: probed.filter(Boolean), smSeriesCount };
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
        // The grid this level actually has, as decided above — including the
        // collapse to 1×1. Read by the tile source's `getNumTiles`, which must
        // not re-derive it: OSD would otherwise infer the row/column count from
        // the base level's scale and invent cells nothing maps to.
        level.tilesX = tilesX;
        level.tilesY = tilesY;
        // A derived object shares its slide's frame of reference, so it must
        // carry the same orientation — otherwise the overlay and the slide it
        // annotates would be placed differently.
        if (!level.slide) {
            const slide = this._parseSlideDescriptor(attrs);
            if (slide) level.slide = slide;
        }
        // Spacing says how much of the slide one of THIS object's pixels covers,
        // which is the only way to know whether its raster spans the declared
        // TotalPixelMatrix or stops short of it. Without it the collapsed level
        // below is stretched across the whole matrix on faith.
        //
        // `_parseSpacing`, not `_applySpacingToLevel`: the latter falls back to
        // 0.25 um so a slide with no spacing still renders at a plausible scale.
        // Here the value is not cosmetic — it decides geometry — so an undeclared
        // spacing must stay undefined and let the caller degrade, rather than
        // become a made-up number that silently crops the overlay.
        if (!level.micronsX || !level.micronsY) {
            const spacing = this._parseSpacing(attrs);
            if (spacing) {
                level.micronsX = spacing.micronsX;
                level.micronsY = spacing.micronsY;
            }
        }

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
        // EXACTLY the attributes `groupSeriesInstances` reads, and nothing else.
        //
        // This projection used to ask for the geometry sequences as well —
        // Per-Frame Functional Groups (52009230), Shared FG, DimensionIndex*,
        // plane positions. None of them were ever read from these rows:
        // `_ingestInstanceMetadata` takes every one of them from the instance's
        // own `/metadata`, and ignores the QIDO row entirely. On a store that
        // honours sequence `includefield` at query level, 52009230 alone means
        // one functional-group item PER FRAME PER INSTANCE in this single
        // response — for a base level with 100k frames that is an enormous
        // payload fetched to be thrown away.
        //
        // Two attributes the grouping DOES read were missing, so every instance
        // fell back to "UNKNOWN_CONTAINER"/"DEFAULT_PATH" and a series holding
        // several specimens or optical paths collapsed into one group.
        const { rows, total } = await this.qidoSafeWithMeta(client, base,
            [
                "00080018",             // SOPInstanceUID
                "00080016",             // SOPClassUID    ) what `isWSIInstance`
                "00080060",             // Modality       ) classifies on
                "00080008",             // ImageType (ORIGINAL vs DERIVED pyramid)
                "00280008",             // NumberOfFrames
                "00280010", "00280011", // Rows/Columns (tile size)
                "00480006", "00480007", // TotalPixelMatrix
                "00400512",             // ContainerIdentifier (groups by specimen)
                "00480106",             // OpticalPathIdentifier (groups by channel)
                // ConcatenationUID. Single-valued and not a sequence, so it costs
                // one string per row. It is what lets the grouping tell "two parts
                // of one level" apart from "a duplicate size" and keeps the
                // level-count ranking honest; a store that ignores the includefield
                // simply gets the previous behaviour back.
                "00209161",
            ].join(',')
        );
        // rows are already instance objects; pass through or normalize if needed.
        // Series-level metadata (description / modality / bodyPart / number) is
        // forwarded via options.seriesMeta so groupSeriesInstances can build a
        // human-readable label instead of a bare UID tail.
        const seriesObject = { studyUID, seriesUID, ...(options.seriesMeta || null) };
        const wsiInstances = await this.groupSeriesInstances(rows, seriesObject);

        // The tile source keeps ONE group (the deepest pyramid, then the widest)
        // and discards the rest — but the metadata for every group was fetched
        // first, and fetched in a serial `for` loop, so a series holding several
        // WSI items paid a full round-trip walk per item before the slide could
        // open. `options.only: "best"` ranks the groups from the QIDO rows,
        // which already carry the instance counts and TotalPixelMatrix, and
        // walks metadata for the winner alone.
        const groups = options.only === "best" ? this._bestWsiGroup(wsiInstances) : wsiInstances;

        for (let wsi of groups) {
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
            // Ingest only maps each instance against its own frame space. Merging
            // the parts of a level, resolving concatenation offsets and running the
            // sequential fallback are level-wide decisions, so they happen here —
            // before inference, which reads the finished maps.
            this._finalizeWsiLevels(wsi);
            this._inferSequentialLayoutForWsi(wsi);
        }
        return groups;
    }

    /**
     * The one WSI group worth building a pyramid for, chosen WITHOUT metadata.
     *
     * Mirrors the ranking `DICOMWebTileSource._initializeFromServer` applies
     * after the fact — most levels first, then largest — but reads it off the
     * QIDO rows (`pyramidInstances`, TotalPixelMatrix/Columns) instead of off
     * `levels`, which only exists once the metadata walk has already run. That
     * is the whole point: ranking first is what makes the walk cost one group
     * instead of all of them.
     *
     * Depth is counted in DISTINCT TotalPixelMatrix sizes, not in instances,
     * because that is what "levels" means after the walk. Counting instances made
     * a three-level pyramid split into six concatenation parts outrank a genuine
     * five-level one — and then the metadata walk paid for the wrong group.
     *
     * @returns {object[]} a single-element array, or empty if there is nothing.
     */
    static _bestWsiGroup(wsiInstances) {
        if (!wsiInstances?.length) return [];
        const dimsOf = (ds) => `${Number(this.v(ds, "00480006")) || Number(this.v(ds, "00280011")) || 0}` +
            `x${Number(this.v(ds, "00480007")) || Number(this.v(ds, "00280010")) || 0}`;
        const depthOf = (wsi) => new Set((wsi.pyramidInstances || []).map(dimsOf)).size;
        const widthOf = (wsi) => Math.max(0, ...(wsi.pyramidInstances || []).map(ds =>
            Number(this.v(ds, "00480006")) || Number(this.v(ds, "00280011")) || 0));

        return [wsiInstances.slice().sort((a, b) => {
            const an = depthOf(a);
            const bn = depthOf(b);
            if (bn !== an) return bn - an;
            return widthOf(b) - widthOf(a);
        })[0]];
    }

    /**
     * Describe a **monochrome slide** well enough to give it a `dicom-window`
     * layer, or `null` when this series is not one.
     *
     * The DICOM analogue of `describeRadiologySeries`, but for `SM`: a monochrome
     * slide — a fluorescence or multiplex-IHC optical path, most often — carries
     * intensity, not colour, and its stored values are frequently confined to a
     * narrow part of the 8-bit range. Rendered through the implicit identity
     * layer that is a flat, washed-out picture with no way for the user to say
     * otherwise. `dicom-window` is the layer that already knows how to window it;
     * this is the descriptor that layer's params are built from.
     *
     * `null` for every series whose window cannot honestly be moved into a shader
     * — see {@link canDeferVoiToShader}, which is also what the tile source asks
     * before it stops baking. Every *monochrome* level must qualify, not just the
     * finest: the tile source decides per level, and a level that still bakes
     * under a layer that also windows would be windowed twice.
     *
     * ## Request budget: 0 beyond the open
     *
     * It calls `findWSIItems(only: "best")` — the very call the tile source makes
     * at init, with the same arguments — and both the QIDO and the per-level WADO
     * `/metadata` are memoized per client. So on the open path this costs one
     * cache lookup, and it is deliberately NOT wired into `get-preview-shader`:
     * a slide-switcher card would pay the metadata walk for a series nobody
     * opened, and the default window here is the identity anyway, so a preview
     * rendered without the layer is the same picture.
     *
     * @param {object} client HttpClient
     * @param {string} studyUID
     * @param {string} seriesUID
     * @param {object} [options] forwarded to `findWSIItems` (`seriesMeta`, frame order)
     * @returns {Promise<object|null>}
     */
    static async describeMonochromeSlide(client, studyUID, seriesUID, options = {}) {
        const items = await this.findWSIItems(client, studyUID, seriesUID, { ...options, only: "best" });
        const wsi = (items || []).find(w => w?.levels?.length);
        if (!wsi) return null;

        const chainOf = (level) => ({
            pixel: level?.pixel ?? wsi.pixel ?? null,
            modalityLut: level?.modalityLut ?? wsi.modalityLut ?? null,
            voiLut: level?.voiLut ?? wsi.voiLut ?? null,
        });

        // Levels are not sorted yet — `_normalizeLevels` in the tile source does
        // that — so the finest is the widest, not the first.
        const finest = wsi.levels.slice().sort((a, b) => (Number(b?.width) || 0) - (Number(a?.width) || 0))[0];
        const chain = chainOf(finest);
        if (!canDeferVoiToShader(chain.pixel, chain)) return null;

        const inconsistent = wsi.levels.some(level => {
            const c = chainOf(level);
            return isMonochromePixel(c.pixel) && !canDeferVoiToShader(c.pixel, c);
        });
        if (inconsistent) {
            console.debug(`[DICOM] series ${seriesUID} mixes monochrome levels with and without a baked ` +
                "window; leaving the window baked so it is never applied twice.");
            return null;
        }

        return {
            studyUID,
            seriesUID,
            modality: options.seriesMeta?.modality ?? "SM",
            pixel: chain.pixel,
            // Derived, not the literal `{0, 255}` the predicate currently implies:
            // the descriptor stays correct if the predicate ever widens.
            valueRange: storedValueRange(chain.pixel, chain.modalityLut),
            voiPresets: chain.voiLut?.presets ?? [],
            units: chain.modalityLut?.units ?? null,
            invert: chain.pixel.photometricInterpretation === "MONOCHROME1",
        };
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
            // This variant exists FOR listings, so it defaults to the background
            // lane: a browser sweep is one query per series and must not compete
            // with the tiles of whatever slide is already open. A caller that
            // needs it foreground passes `priority: "normal"`.
        ].join(','), { priority: options.priority ?? "background" });
        const seriesObject = { studyUID, seriesUID, ...(options.seriesMeta || null) };
        const wsiInstances = await this.groupSeriesInstances(rows, seriesObject);
        for (const wsi of wsiInstances) {
            wsi.seriesUID = seriesUID;
            wsi.studyUID = studyUID;
            wsi.shallow = true;
        }
        return wsiInstances;
    }

    /* RADIOLOGY SERIES DESCRIPTION */

    /**
     * One `includefield` list covering everything the plane model needs:
     * identity, geometry, the raster, the whole display chain, and every
     * attribute that can distinguish two co-located planes.
     *
     * Asking for all of it in one query is the point — see the request budget on
     * `describeRadiologySeries`.
     */
    static RADIOLOGY_INSTANCE_FIELDS = [
        "00080016", "00080018", "00080060", "00080008",  // SOPClass/Instance, Modality, ImageType
        "00200013", "00200032", "00200037", "00201041",  // InstanceNumber, IPP, IOP, SliceLocation
        "00200052",                                      // FrameOfReferenceUID
        "00180050", "00180088", "00280030",              // SliceThickness, SpacingBetweenSlices, PixelSpacing
        "00181164",                                      // ImagerPixelSpacing (CR/DX carry only this)
        "00280010", "00280011", "00280008",              // Rows, Columns, NumberOfFrames
        "00280002", "00280004",                          // SamplesPerPixel, PhotometricInterpretation
        "00280100", "00280101", "00280102", "00280103",  // Bits*, PixelRepresentation
        "00281052", "00281053", "00281054",              // Rescale intercept/slope/type
        "00281050", "00281051", "00281055", "00281056",  // Window centre/width/explanation/function
        "00180086", "00180081", "00200100", "00200012",  // Echo, TemporalPosition, AcquisitionNumber
        "00189087", "00209056",                          // DiffusionBValue, StackID
    ].join(",");

    /**
     * Describe a CT/MR/PT/CR/DX/NM series as an ordered plane stack.
     *
     * This is a peer of `findWSIItems`, not a variant of it. It shares the HTTP
     * and parsing helpers but calls none of `groupSeriesInstances` /
     * `_ingestInstanceMetadata` / the frame-order strategies: those interpret a
     * series' instances as *pyramid levels of one image* and its frames as *tile
     * positions*, which is precisely the interpretation that does not apply
     * here. The plane maths itself lives in `radiology-geometry.mjs`, which is
     * pure; this function is only the I/O around it.
     *
     * ## Request budget: 2, worst case 4 — never N
     *
     * 1. One instance-level QIDO carrying `RADIOLOGY_INSTANCE_FIELDS`. One round
     *    trip returns all 300 rows of a 300-slice series (one row for an
     *    enhanced multi-frame instance).
     * 2. One WADO `/metadata` for the geometric middle instance — the full
     *    display chain, plus the Per-Frame Functional Groups when multi-frame.
     * 3. Optional: a retry with `includefield=all` when the store silently
     *    dropped the field list (`qidoSafeWithMeta` falls back to a bare query),
     *    detected by the geometry simply not being there.
     * 4. Optional: the series-level QIDO row, skipped when the caller already
     *    has it (`options.seriesMeta`).
     *
     * A per-instance metadata walk is deliberately refused. `findWSIItems` can
     * afford `mapConcurrent` over its instances because a pyramid has ~5 levels;
     * doing the same over 300 CT slices is 300 requests and tens of megabytes of
     * JSON — the exact N+1 `findWSIItemsShallow` exists to avoid.
     *
     * @param {object} client HttpClient
     * @param {string} studyUID
     * @param {string} seriesUID
     * @param {object} [options]
     * @param {string} [options.subVolume] pick an interleaved sub-volume by key
     * @param {object} [options.seriesMeta] series-level row the caller already has
     * @returns {Promise<object|null>} the descriptor, `{error}` when the series is
     *   refused, or `null` when the series holds no radiology instances at all
     */
    static async describeRadiologySeries(client, studyUID, seriesUID, options = {}) {
        const base = `/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}/instances`;

        let { rows } = await this.qidoSafeWithMeta(client, base, this.RADIOLOGY_INSTANCE_FIELDS);
        if (!rows.length) return null;

        // `qidoSafeWithMeta` retries without `includefield` when a store rejects
        // it (GCP does), and reports that as an ordinary success. The only way
        // to notice is that the geometry is missing from every row.
        if (!this._rowsCarryGeometry(rows)) {
            const retry = await this.qidoSafeWithMeta(client, base, "all").catch(() => null);
            if (retry?.rows?.length && this._rowsCarryGeometry(retry.rows)) rows = retry.rows;
        }

        const radiologyRows = rows.filter(row => this.isRadiologyInstance(row));
        if (!radiologyRows.length) return null;

        const modality = this.RADIOLOGY_SOP_CLASSES.get(this.v(radiologyRows[0], "00080016"))
            ?? this.v(radiologyRows[0], "00080060")
            ?? null;
        const sopClass = this.v(radiologyRows[0], "00080016") ?? null;
        const multiframe = radiologyRows.length === 1 && (this.iv(radiologyRows[0], "00280008") ?? 1) > 1;

        const metaPath = (uid) => `/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}/instances/${encodeURIComponent(uid)}/metadata`;

        let candidates;
        let representative = null;

        if (multiframe) {
            const uid = this.v(radiologyRows[0], "00080018");
            // Not memoized: the Per-Frame Functional Groups of a 300-frame
            // instance are the bulk of this payload and nothing reads them again.
            const meta = await this.wadoMetadata(client, metaPath(uid), { memoize: false });
            representative = Array.isArray(meta) ? meta[0] : meta;
            candidates = planeCandidatesFromMultiframe(representative);
            if (!candidates.length) {
                // A single-frame-per-instance reading of a NumberOfFrames > 1
                // object would render frame 1 and call it the whole series.
                return { error: "multi-frame instance carries no Per-Frame Functional Groups" };
            }
        } else {
            candidates = radiologyRows.map(row => planeCandidateFromInstance(row)).filter(Boolean);
        }

        const model = buildPlaneModel(candidates, { subVolume: options.subVolume });
        if (model.error) return { error: model.error, modality, sopClass };

        if (!representative) {
            // The middle plane, not the first: on a series whose ends are
            // partially outside the patient it is the one most likely to carry a
            // representative window.
            const middle = model.planes[model.planes.length >> 1];
            const meta = await this.wadoMetadata(client, metaPath(middle.instanceUID));
            representative = Array.isArray(meta) ? meta[0] : meta;
        }

        const chain = this.parsePixelChain(representative);
        const realWorldRange = parseRealWorldRange(representative);
        const seriesModalityLut = chain.modalityLut;

        const byCandidate = new Map(candidates.map(c => [`${c.instanceUID}#${c.frame}`, c]));
        const planes = model.planes.map(p => {
            const candidate = byCandidate.get(`${p.instanceUID}#${p.frame}`);
            return {
                ...p,
                modalityLut: this._planeModalityLut(candidate, seriesModalityLut),
            };
        });

        const extraRanges = this._perPlaneValueRanges(planes, chain.pixel, seriesModalityLut);
        const valueRange = chooseValueRange({
            modality,
            pixel: chain.pixel,
            modalityLut: seriesModalityLut,
            voiLut: chain.voiLut,
            realWorldRange,
            extraRanges,
        });

        const pixelSpacing = model.raster.pixelSpacing;
        const seriesMeta = options.seriesMeta ?? await this._radiologySeriesMeta(client, studyUID, seriesUID);

        return {
            studyUID,
            seriesUID,
            modality,
            sopClass,
            geometry: (modality === "CR" || modality === "DX") ? "projection" : "volume",
            multiframe,

            width: model.raster.cols,
            height: model.raster.rows,
            // DICOM PixelSpacing is [row spacing (Y), column spacing (X)] in
            // MILLIMETRES; `micronsX/Y` are micrometres (src/README.md).
            micronsX: Array.isArray(pixelSpacing) ? pixelSpacing[1] * 1000 : undefined,
            micronsY: Array.isArray(pixelSpacing) ? pixelSpacing[0] * 1000 : undefined,
            frameOfReferenceUID: this.v(representative, "00200052")
                ?? this.v(radiologyRows[0], "00200052") ?? null,

            pixel: chain.pixel,
            photometricInterpretation: chain.pixel.photometricInterpretation,
            // MONOCHROME1 is "higher value = darker". That is a PRESENTATION
            // property, so it travels to the shader rather than being baked into
            // the samples — the stored values must stay quantitative.
            invert: chain.pixel.photometricInterpretation === "MONOCHROME1",

            planes,
            spacingUm: model.spacingUm,
            spacingSource: model.spacingSource,
            irregular: model.irregular,
            orderStrategy: model.orderStrategy,
            subVolumes: model.subVolumes,
            activeSubVolume: model.activeSubVolume,
            rejected: model.rejected,
            warnings: model.warnings,

            modalityLut: seriesModalityLut,
            voiLut: chain.voiLut,
            voiPresets: chain.voiLut?.presets ?? [],
            valueRange,
            units: seriesModalityLut?.units ?? null,

            seriesMeta,
        };
    }

    /** Whether a QIDO instance listing actually came back with plane geometry. */
    static _rowsCarryGeometry(rows) {
        return rows.some(row => row?.["00200032"] || row?.["00201041"] || row?.["00200037"]);
    }

    /**
     * A plane's own Modality LUT.
     *
     * PET series routinely carry a per-frame rescale (decay correction differs
     * between acquisitions), and applying the series-level one to every plane
     * would report the wrong activity on most of them. The candidate's `rescale`
     * discriminator already holds the pair, so this costs no extra request.
     */
    static _planeModalityLut(candidate, seriesModalityLut) {
        const rescale = candidate?.keys?.rescale;
        if (!rescale) return seriesModalityLut;

        const [slope, intercept] = rescale.split("/").map(Number);
        if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return seriesModalityLut;

        // A LUT-kind or Real World Value transform is not expressible as a pair,
        // and the series-level one is then the only correct answer.
        if (seriesModalityLut && seriesModalityLut.kind !== "linear") return seriesModalityLut;
        if (seriesModalityLut
            && seriesModalityLut.slope === slope && seriesModalityLut.intercept === intercept) {
            return seriesModalityLut;
        }

        return { kind: "linear", slope, intercept, units: seriesModalityLut?.units ?? null, explanation: null };
    }

    /**
     * One value range per distinct plane transform. The normalization range is
     * baked into the shader as GLSL literals, so it must cover every plane —
     * otherwise the planes whose rescale differs clip.
     */
    static _perPlaneValueRanges(planes, pixel, seriesModalityLut) {
        const seen = new Set();
        const out = [];
        for (const plane of planes) {
            const lut = plane.modalityLut;
            if (!lut || lut === seriesModalityLut) continue;
            const key = lut.kind === "linear" ? `${lut.slope}/${lut.intercept}` : "lut";
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(storedValueRange(pixel, lut));
        }
        return out;
    }

    /** The series row, for a human-readable name. Skipped when the caller has it. */
    static async _radiologySeriesMeta(client, studyUID, seriesUID) {
        try {
            const { rows } = await this.qidoSafeWithMeta(
                client,
                `/studies/${encodeURIComponent(studyUID)}/series?SeriesInstanceUID=${encodeURIComponent(seriesUID)}`,
                "0008103E,00200011,00180015,00080060"
            );
            const row = rows[0];
            if (!row) return null;
            return {
                description: this.v(row, "0008103E") ?? null,
                seriesNumber: this.iv(row, "00200011"),
                bodyPart: this.v(row, "00180015") ?? null,
                modality: this.v(row, "00080060") ?? null,
            };
        } catch (e) {
            // A missing series row costs a nicer label, nothing more.
            return null;
        }
    }

    /**
     * Fetch a single instance's `/rendered` representation as an image Blob
     * (JPEG/PNG). Handles both single-part image responses and multipart
     * envelopes. Used for listing thumbnails (OVERVIEW/LABEL instances) —
     * the tile source's own preview path stays instance-side.
     */
    static async fetchRenderedInstance(client, studyUID, seriesUID, instanceUID, { preferPng = false, window = null } = {}) {
        if (!client || !studyUID || !seriesUID || !instanceUID) return null;
        // `window` overrides the store's own VOI. Left null by default: an
        // instance that carries WindowCenter/WindowWidth already renders sensibly,
        // and a store that does not honour the parameter would otherwise refuse
        // the whole request rather than ignore it.
        const query = window && Number.isFinite(window.center) && Number.isFinite(window.width)
            ? `?window=${encodeURIComponent(`${window.center},${window.width},LINEAR`)}` : "";
        const path = `/studies/${encodeURIComponent(studyUID)}` +
            `/series/${encodeURIComponent(seriesUID)}` +
            `/instances/${encodeURIComponent(instanceUID)}/rendered${query}`;
        const accept = preferPng ? 'image/png, image/jpeg;q=0.9' : 'image/jpeg, image/png;q=0.9';
        // A browser thumbnail. It is decoration on a list the user is scrolling;
        // a tile is the slide they are looking at. `/rendered` is also the
        // single most expensive thing a store does per request — two of these
        // cost 8.7 s of connection time in the measured session.
        const res = await client.fetchRaw(path, {
            headers: { Accept: accept },
            priority: "background",
        });
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
     * Pick an instance worth rendering as a series thumbnail.
     *
     * `previewInstanceUID` only ever exists for a WSI series that ships an
     * OVERVIEW/THUMBNAIL instance (`_ingestInstanceMetadata`). A radiology series
     * has none, and a background restored from a session carries none either — in
     * both cases the card used to render as an empty box. Any instance of the
     * series is a better thumbnail than nothing.
     *
     * The geometric middle, not the first: the ends of a CT stack are frequently
     * outside the patient, and "the first slice" of a chest scan is often pure
     * air. Same reasoning `describeRadiologySeries` records for its representative
     * instance.
     *
     * One QIDO, and `qidoSafeWithMeta` memoizes it, so repeatedly scrolling a
     * card in and out of view costs one request per series for the session.
     *
     * @returns {Promise<string|null>} SOPInstanceUID, or null
     */
    static async pickPreviewInstance(client, studyUID, seriesUID) {
        if (!client || !studyUID || !seriesUID) return null;
        const path = `/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}/instances`;
        let rows;
        try {
            ({ rows } = await this.qidoSafeWithMeta(client, path, "00080018,00200013",
                { priority: "background" }));
        } catch (e) {
            // A thumbnail is decoration on a list; a failure here must cost the
            // card its picture and nothing else.
            console.debug(`[dicom] preview instance lookup failed for ${seriesUID}:`, e?.message ?? e);
            return null;
        }
        if (!rows?.length) return null;

        // Sorted by InstanceNumber where present; rows without one keep the
        // store's order behind those with one, rather than jumping to the front.
        const sorted = rows.slice().sort((a, b) => {
            const na = this.iv(a, "00200013"), nb = this.iv(b, "00200013");
            if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
            if (Number.isFinite(na)) return -1;
            if (Number.isFinite(nb)) return 1;
            return 0;
        });
        return this.v(sorted[sorted.length >> 1], "00080018") ?? null;
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
     * Every SR instance in a study, each tagged with the series it belongs to.
     *
     * One study-level QIDO, not one per SR series. The per-series walk this
     * replaces was a strictly serial `for` loop, and it dominated a measured
     * slide open: 48 queries of 1-4 s each, spread across the whole 80 s the
     * slide took to fill, every one of them competing with tile requests on the
     * same connection.
     *
     * A store that cannot answer `/studies/{uid}/instances` (the resource is
     * optional in PS3.18) falls back to the old shape — but concurrently, via
     * `mapConcurrent`, never serially.
     *
     * Rows are copied before being tagged: QIDO answers are memoized now, so
     * writing `_parentSeriesUID` onto the row itself would scribble on a shared
     * cache entry.
     */
    static async _srCandidates(client, studyUID) {
        // Nobody is staring at a spinner for this: annotations hydrate into a
        // slide that is already rendering. It used to run at full priority for
        // the entire 80 s a slide took to fill, on the same connection as the
        // tiles. The scheduler admits none of it while tiles are in flight.
        const bg = { priority: "background" };

        // 0020000E SeriesInstanceUID (which series the SR lives in),
        // 00080018 SOPInstanceUID, 00080060 Modality (to verify the server
        // honoured the filter), plus the date/time tags `datetimeOf` ranks by.
        const SR_FIELDS = '0020000E,00080018,00080060,00080023,00080033,00080012,00080013,00080021,00080031';

        const tag = (rows, uidOf) => (rows || []).reduce((out, row) => {
            const parent = uidOf(row);
            if (parent) out.push({ ...row, _parentSeriesUID: parent });
            return out;
        }, []);

        try {
            const rows = await this.qidoSafe(
                client, `/studies/${encodeURIComponent(studyUID)}/instances?Modality=SR`, SR_FIELDS, bg);
            // Never trust the server-side filter. A store that silently drops
            // an unsupported query parameter answers this with every instance
            // in the study, which would hand the ranking step a pile of images
            // to treat as reports. Re-check whenever the rows actually carry
            // Modality; when none of them do, the filter is all we have.
            if (rows && rows.length) {
                const typed = rows.filter(r => this.v(r, '00080060') != null);
                if (!typed.length) return tag(rows, r => this.v(r, '0020000E'));

                const sr = typed.filter(r => this.v(r, '00080060') === 'SR');
                if (sr.length) return tag(sr, r => this.v(r, '0020000E'));

                // Rows carry a modality and none of it is SR: the filter was
                // ignored. Say nothing about this study yet — fall through to
                // the per-series walk, which cannot be fooled the same way.
                console.debug('[DICOM] store ignored Modality=SR; falling back to per-series SR walk');
            } else if (Array.isArray(rows)) {
                // The endpoint exists and understood the filter (`qido` maps a
                // missing collection to undefined and a dead endpoint to a
                // throw), so an empty array means this study holds no SR.
                return [];
            }
        } catch (e) {
            console.debug('[DICOM] study-level SR query unavailable, falling back to per-series:', e?.message ?? e);
        }

        // Fallback: list the study's series, then query the SR ones concurrently.
        const seriesList = await this.qidoSafe(
            client, `/studies/${encodeURIComponent(studyUID)}/series`,
            '00080060,0020000E,00080021,00080031', bg);
        const srSeries = (seriesList || [])
            .filter(s => this.v(s, '00080060') === 'SR')
            .map(s => this.v(s, '0020000E'))
            .filter(Boolean);
        if (!srSeries.length) return [];

        const perSeries = await this.mapConcurrent(srSeries, METADATA_CONCURRENCY, async (srSeriesUID) => {
            const path = `/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(srSeriesUID)}/instances`;
            const rows = await this.qidoSafe(client, path, SR_FIELDS, bg);
            return tag(rows, () => srSeriesUID);
        });
        return perSeries.flat();
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
        try {
            const allCandidates = await this._srCandidates(client, studyUID);
            if (!allCandidates.length) return null;

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
                // Count only. The row carries SOP/Series Instance UIDs, which
                // this codebase classifies as opaque PHI identifiers
                // (see `getSensitiveMetadata`), and they have no business in a
                // console the user may paste into a bug report.
                console.debug(`[DICOM] ${allCandidates.length} SR candidate(s); taking the newest.`);
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
                            // Same lane as the listing that produced these
                            // candidates: annotation hydration must never
                            // compete with the tiles it will be drawn over.
                            { priority: "background" },
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

            // only consider multi-frame tiled instances as pyramid candidates.
            // A concatenation part (0020,9161) is the one legitimate single-frame
            // pyramid instance: the level's frames are split across siblings, and
            // one of them may hold exactly one.
            const frames = Number(ds?.["00280008"]?.Value?.[0] ?? 0);
            const isConcatPart = !!ds?.["00209161"]?.Value?.[0];
            const minFrames = isConcatPart ? 1 : 2;
            if (!(frames >= minFrames && rows > 0 && cols > 0 && rows <= 1024 && cols <= 1024)) { // Increased to 1024
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
                // With no ORIGINAL instance at all, the largest DERIVED one IS the
                // base level and must be ADOPTED, not merely used as a yardstick.
                // It used to be measured and then dropped by the `d.w >= refDims.w`
                // test below — the reference can never be smaller than itself — so
                // every all-DERIVED pyramid silently started one level down and
                // rendered at half the available resolution. That is most converted
                // data: `com.pixelmed.convert.TIFFToDicom` marks every level
                // `DERIVED\PRIMARY\VOLUME\RESAMPLED`, which is what all of IDC is.
                const skipFirstDerived = chosen.length === 0;
                if (skipFirstDerived) chosen.push(derived[0]);

                // Reference dims: use ORIGINAL dims if present; else the biggest derived.
                const refDims = dimsOf(chosen[0]);

                // Take derived levels that:
                // - are smaller than the reference
                // - have ~same aspect ratio (so they are true downsample versions)
                // - are not duplicates of existing sizes
                //
                // "Same size" is not the same claim as "duplicate": the parts of a
                // concatenated level share TotalPixelMatrix dimensions by
                // definition, and dropping all but the first left that level with a
                // fraction of its frames. So the key remembers WHICH concatenation
                // a size belongs to, and a second instance survives when it names
                // the same one. With no ConcatenationUID in the row (a store that
                // dropped the includefield) this is exactly the old rule.
                const concatOf = (ds) => ds?.["00209161"]?.Value?.[0] || null;
                const seen = new Map(chosen.map(ds => {
                    const d = dimsOf(ds);
                    return [`${d.w}x${d.h}`, concatOf(ds)];
                }));

                for (let di = skipFirstDerived ? 1 : 0; di < derived.length; di++) {
                    const ds = derived[di];
                    const d = dimsOf(ds);
                    if (!d.w || !d.h) continue;
                    if (d.w >= refDims.w || d.h >= refDims.h) continue;
                    if (!aspectOK(d, refDims)) continue;

                    const key = `${d.w}x${d.h}`;
                    const concatUID = concatOf(ds);
                    if (seen.has(key) && !(concatUID && seen.get(key) === concatUID)) continue;
                    seen.set(key, concatUID);

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

    /**
     * Where the total pixel matrix sits on the glass.
     *
     * `ImageOrientationSlide` (0048,0102) gives the direction cosines of the
     * matrix's first row and first column in the slide frame of reference, and
     * `TotalPixelMatrixOriginSequence` (0048,0008) gives that matrix's origin in
     * millimetres.
     *
     * Returns `null` rather than a partial record: half an orientation renders as
     * a *different* orientation, which is worse than not honouring the tag.
     *
     * @param {object} attrs one instance's DICOM JSON attributes
     * @returns {{orientation: number[], originX: number, originY: number}|null}
     */
    static _parseSlideDescriptor(attrs) {
        // A Whole Slide Microscopy Image carries these at the top level. A
        // Segmentation or Parametric Map is a multi-frame functional-groups
        // object and puts its slide geometry inside the Shared Functional Groups
        // Sequence instead — which is why reading only the top level found
        // nothing on a SEG and drew it unrotated under a rotated slide.
        //
        // Shared only, never Per-Frame (52009230): a per-frame value describes
        // one frame, and adopting frame 0's as the whole object's is the kind of
        // guess this function exists to avoid.
        const shared = attrs?.["52009229"]?.Value?.[0] || null;
        const holding = (tag) => (attrs?.[tag] ? attrs : this._datasetHolding(shared, tag));

        // `tag`, not `v`: the six cosines are the whole Value array, and `v`
        // would hand back only the first one.
        const orientation = parseOrientation(this.tag(holding("00480102"), "00480102"));
        if (!orientation) return null;
        // TotalPixelMatrixOriginSequence
        const origin = this.tag(holding("00480008"), "00480008")?.[0] || null;
        const ox = this.fv(origin, "0040072A");                   // XOffsetInSlideCoordinateSystem
        const oy = this.fv(origin, "0040073A");                   // YOffsetInSlideCoordinateSystem
        return {
            orientation,
            originX: Number.isFinite(ox) ? ox : 0,
            originY: Number.isFinite(oy) ? oy : 0,
        };
    }

    /**
     * Pixel spacing of one instance, in micrometres, as `{micronsX, micronsY}`.
     *
     * Four declarations, in falling order of authority. The Shared Functional
     * Groups entry is not a nicety: a Segmentation or Parametric Map keeps its
     * spacing *only* there, which is why the derived ingest — which did not read
     * spacing at all — could not tell how much of the slide its raster covered.
     *
     * @returns {{micronsX: number, micronsY: number}|null} null when nothing declared it
     */
    static _parseSpacing(attrs) {
        let spacingArr = attrs?.["00280030"]?.Value;                    // PixelSpacing
        if (!spacingArr) {
            const pms = this._datasetHolding(
                attrs?.["52009229"]?.Value?.[0] || null, "00280030");   // Shared FG > Pixel Measures
            spacingArr = pms?.["00280030"]?.Value;
        }
        if (!spacingArr) {
            const nominal = this.fv(attrs, "00182010");                 // Nominal Scanned Pixel Spacing
            if (nominal) spacingArr = [nominal, nominal];
        }
        if (!spacingArr) {
            const imager = this.fv(attrs, "00181164");                  // Imager Pixel Spacing
            if (imager) spacingArr = [imager, imager];
        }
        if (!spacingArr) return null;

        // Every source above is in MILLIMETRES; `micronsX/Y` are micrometres, the
        // unit the core scalebar and the annotation exporters expect. This used to
        // store the millimetre value verbatim, which is why the default read as the
        // nonsensical `0.00025` — 0.25 um written in mm.
        //
        // PixelSpacing is [row spacing (Y), column spacing (X)] — the same ordering
        // `describeRadiologySeries` documents. A scalar (the two scalar-valued
        // fallbacks above) is isotropic.
        const micronsX = Number(spacingArr[1] ?? spacingArr[0]) * 1000;
        const micronsY = Number(spacingArr[0]) * 1000;
        if (!Number.isFinite(micronsX) || !Number.isFinite(micronsY)) return null;
        if (micronsX <= 0 || micronsY <= 0) return null;
        return { micronsX, micronsY };
    }

    /**
     * The instance of a WSI series that carries the base (largest) level.
     *
     * `instances[0]` is not it — QIDO returns a pyramid in whatever order it likes.
     *
     * @param {object[]} instances QIDO records with 00480006/00480007 included
     * @param {?{width:number, height:number}} expectedMatrix
     */
    static _pickBaseInstance(instances, expectedMatrix = null) {
        if (expectedMatrix?.width > 0 && expectedMatrix?.height > 0) {
            const exact = instances.find(inst =>
                this.iv(inst, "00480006") === expectedMatrix.width &&
                this.iv(inst, "00480007") === expectedMatrix.height);
            if (exact) return exact;
        }
        let best = null, bestWidth = -1;
        for (const inst of instances) {
            const width = this.iv(inst, "00480006");
            if (Number.isFinite(width) && width > bestWidth) { best = inst; bestWidth = width; }
        }
        // No dimensions at all: the store told us nothing to rank by, so the first
        // instance is as good an answer as exists.
        return best || instances[0];
    }

    /** Stamp {@link _parseSpacing} onto a level, never overwriting what it already has. */
    static _applySpacingToLevel(level, attrs) {
        const spacing = this._parseSpacing(attrs);
        if (spacing && (!level.micronsX || !level.micronsY)) {
            level.micronsX = spacing.micronsX;
            level.micronsY = spacing.micronsY;
        }
        // The historical default, kept: a slide that declares nothing still has to
        // render, and 0.25 um is the common scanner pitch.
        if (!level.micronsX || !level.micronsY) {
            level.micronsX = level.micronsX || 0.25;
            level.micronsY = level.micronsY || 0.25;
        }
    }

    /**
     * The dataset that directly holds `tag`, searching nested sequences.
     *
     * DICOM JSON nests a sequence as `{Value: [ {…dataset}, … ]}`, and which
     * sequence a functional-groups object uses for slide geometry varies by IOD.
     * Searching rather than naming one keeps this from being a list of tag paths
     * that has to grow every time a new object type shows up.
     *
     * @returns {object|null} the dataset, so the ordinary accessors still apply
     */
    static _datasetHolding(root, tag, maxDepth = 3) {
        if (!root || typeof root !== "object") return null;
        if (root[tag]) return root;
        if (maxDepth <= 0) return null;
        for (const key of Object.keys(root)) {
            const items = root[key]?.Value;
            if (!Array.isArray(items)) continue;
            for (const item of items) {
                if (!item || typeof item !== "object") continue;
                const found = this._datasetHolding(item, tag, maxDepth - 1);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * The slide descriptor of a series, without building its pyramid.
     *
     * A derived object shares its slide's frame of reference, so when the file
     * declares no orientation of its own the slide's is the answer — not a
     * guess, whereas drawing it unrotated under a rotated slide is one.
     *
     * Spacing rides along from the same instance because the second caller needs
     * it and a second fetch for one number would be absurd: a derived object's
     * spacing is only meaningful as a RATIO against the slide's.
     *
     * **WHICH instance matters, and it used to be `instances[0]`.** Orientation is a
     * property of the series, so any instance answers it — but spacing is a property
     * of the LEVEL, and a WSI series is a whole pyramid. QIDO promises no ordering,
     * and on the measured store the first listed instance was the 4625-wide level of
     * a 74003-wide slide: exactly 16x too coarse, which scaled a Parametric Map that
     * covers 92.7% of the slide down to a 5.8% sliver in the corner.
     *
     * `expectedMatrix` is how the caller says which level it means. A derived object
     * declares its slide's own TotalPixelMatrix, so matching on it is self-validating
     * rather than a heuristic — a match IS the base level. Failing that, the largest
     * matrix, and failing that the first instance, which is all a store that returns
     * no dimensions allows.
     *
     * @param {?{width:number, height:number}} expectedMatrix the base level to find
     * @returns {Promise<{orientation:number[], originX:number, originY:number,
     *                    micronsX:?number, micronsY:?number,
     *                    matrixWidth:?number, matrixHeight:?number}|null>}
     */
    static async slideDescriptorForSeries(client, studyUID, seriesUID, expectedMatrix = null) {
        if (!client || !studyUID || !seriesUID) return null;
        try {
            const base = `/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}`;
            const instances = await this.qidoSafe(client, `${base}/instances`,
                "00080018,00480006,00480007");
            if (!Array.isArray(instances) || !instances.length) return null;

            const chosen = this._pickBaseInstance(instances, expectedMatrix);
            const uid = this.v(chosen, "00080018");
            if (!uid) return null;

            const meta = await this.wadoMetadata(client, `${base}/instances/${encodeURIComponent(uid)}/metadata`);
            const attrs = meta?.[0] || {};
            const descriptor = this._parseSlideDescriptor(attrs);
            const spacing = this._parseSpacing(attrs);
            // Either half may be absent, and they are independently useful — an
            // object can inherit an orientation without a spacing, or the reverse.
            if (!descriptor && !spacing) return null;
            // Published so the caller can verify it got the level it asked for. A
            // spacing from the wrong level is not a smaller error than no spacing.
            const matrixWidth = this.iv(chosen, "00480006") ?? this.iv(attrs, "00480006");
            const matrixHeight = this.iv(chosen, "00480007") ?? this.iv(attrs, "00480007");
            return { ...(descriptor || {}), ...(spacing || {}), matrixWidth, matrixHeight };
        } catch (e) {
            // A missing parent orientation is a diagnostic, never a failed open.
            console.warn(`[DICOM] could not read slide orientation of series ${seriesUID}:`, e?.message ?? e);
            return null;
        }
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

        const applySpacingToLevel = (level) => this._applySpacingToLevel(level, attrs);

        // Image Pixel module + display chain. Read once per instance here so the
        // tile source never has to guess: before this existed the decoder was
        // handed a hardcoded 8-bit RGB descriptor, which silently corrupted
        // every monochrome, palette or >8-bit instance.
        const pixelChain = this.parsePixelChain(attrs);
        if (!wsiInstance.pixel) {
            wsiInstance.pixel = pixelChain.pixel;
            wsiInstance.photometricInterpretation = pixelChain.pixel.photometricInterpretation;
        }

        // Concatenation (PS3.3 C.7.6.16). One logical level may be split across
        // several SOP Instances: they share TotalPixelMatrix dimensions, each
        // carries a slice of the level's frame space, and
        // ConcatenationFrameOffsetNumber says where that slice starts.
        // `_injectLevelByDims` matches on dimensions, so all parts land on ONE
        // level record — which is why everything below is computed per part and
        // merged later in `_finalizeWsiLevel`. The offsets (derivable from the
        // siblings' frame counts when 0020,9228 is absent) and the level's total
        // frame count are not knowable from one instance.
        const concatUID = this.v(attrs, "00209161");        // ConcatenationUID
        const inConcatRaw = this.iv(attrs, "00209162");     // InConcatenationNumber
        const frameOffsetRaw = this.iv(attrs, "00209228");  // ConcatenationFrameOffsetNumber
        const inConcatNumber = Number.isFinite(inConcatRaw) ? inConcatRaw : null;
        // 0 is a legal offset, so this is a finiteness test, not a truthiness one.
        const frameOffset = Number.isFinite(frameOffsetRaw) ? frameOffsetRaw : null;

        // Only attempt mapping for tiled instances. A concatenation part may
        // legally hold a single frame, so the multi-frame requirement is relaxed
        // for an instance that declares itself part of one.
        if (!(totalWidth && totalHeight && tileWidth && tileHeight)) return;
        if (!(numberOfFrames > 1 || (numberOfFrames === 1 && concatUID))) return;

        const tilesX = Math.ceil(totalWidth / tileWidth);
        const tilesY = Math.ceil(totalHeight / tileHeight);
        const expected = tilesX * tilesY;

        const level = this._injectLevelByDims(wsiInstance, totalWidth, totalHeight, tileWidth, tileHeight);
        level.parts = level.parts || [];
        level.frames = level.frames || Object.create(null);
        applySpacingToLevel(level);
        // First part wins, like the pixel chain below: every instance of a level
        // describes the same physical slide, so a later disagreement is a signal,
        // not a value to overwrite with.
        if (!level.slide) {
            const slide = this._parseSlideDescriptor(attrs);
            if (slide) level.slide = slide;
        }
        // Per-level, because a DICOM pyramid may mix instances that differ in
        // bit depth or photometric interpretation (a DERIVED thumbnail level is
        // frequently 8-bit RGB over a 16-bit monochrome base).
        //
        // Only the FIRST part of a level defines the chain. A later part that
        // disagrees is a signal, not a value to overwrite with: `_injectLevelByDims`
        // matches dimensions within ±1 px, so a disagreement means two unrelated
        // instances were merged onto one level.
        if (!level.parts.length) {
            Object.assign(level, pixelChain);
        } else if (
            level.pixel?.photometricInterpretation !== pixelChain.pixel?.photometricInterpretation ||
            level.pixel?.bitsAllocated !== pixelChain.pixel?.bitsAllocated
        ) {
            console.warn(
                `[DICOM] Instance ${instanceUID} shares level ${tilesX}×${tilesY} with ` +
                `${level.parts[0].instanceUID} but declares a different Image Pixel module ` +
                `(${pixelChain.pixel?.photometricInterpretation}/${pixelChain.pixel?.bitsAllocated}b vs ` +
                `${level.pixel?.photometricInterpretation}/${level.pixel?.bitsAllocated}b). ` +
                "They may be unrelated images matched only on dimensions; keeping the first."
            );
        }

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
        // Returns { frames, mapped, collisions, oob, unresolved, frameCount } for
        // a per-frame mapper that, given (frameIndex, fg), produces tileX/tileY
        // (or null). Every frame lands in exactly one bucket, so
        // mapped + collisions + oob + unresolved === frameCount.
        const buildFrameMap = (resolver) => {
            const frames = Object.create(null);
            let mapped = 0, collisions = 0, oob = 0, unresolved = 0;

            if (!Array.isArray(perFrameFG) || !perFrameFG.length) {
                return { frames, mapped, collisions, oob, unresolved, frameCount: numberOfFrames, supported: false };
            }

            for (let frameIndex = 0; frameIndex < numberOfFrames; frameIndex++) {
                const fg = perFrameFG[frameIndex];
                if (!fg) { unresolved++; continue; }

                const pos = resolver(frameIndex, fg);
                if (!pos) { unresolved++; continue; }
                const { tileX, tileY } = pos;
                if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) { unresolved++; continue; }
                if (tileX < 0 || tileY < 0 || tileX >= tilesX || tileY >= tilesY) { oob++; continue; }

                const k = `${tileX}_${tileY}`;
                if (frames[k] == null) mapped++;
                else collisions++;
                frames[k] = frameIndex + 1;
            }
            return { frames, mapped, collisions, oob, unresolved, frameCount: numberOfFrames, supported: true };
        };

        // Two ways a candidate can be right, and they are not the same claim.
        //
        // DENSE is the historical rule, unchanged: every cell of the grid is
        // uniquely populated. `oob` is deliberately not part of it — a file whose
        // in-bounds frames tile the grid exactly renders correctly no matter how
        // many strays it also carries, and that has always been accepted.
        //
        // SPARSE is what PS3.3 permits and what this ladder used to reject: "the
        // level may be sparse and any number of tiles may be absent". There is no
        // coverage to check, so the proof is the other direction — every frame the
        // instance carries was consumed, in bounds, without collision. A partial
        // map is then the correct map, not a failed one.
        const acceptsDense = (cand) => cand.supported && cand.collisions === 0 && cand.mapped === expected;
        const acceptsSparse = (cand) => cand.supported && cand.collisions === 0 && cand.oob === 0
            && cand.mapped === cand.frameCount;

        // This instance's contribution to the level. `frames` is in the part's
        // LOCAL frame space (1-based within this instance); `_finalizeWsiLevel`
        // shifts it by `frameOffset` into the level's logical space.
        const part = {
            instanceUID,
            numberOfFrames,
            concatUID: concatUID || null,
            inConcatNumber,
            frameOffset,
            dimOrgType,
            overrideOrder,
            tilesX, tilesY, expected,
            frames: null,
            strategy: null,
            stats: null,
            best: null,     // best rejected candidate, kept for the diagnostic log
        };
        level.parts.push(part);

        // A rejected candidate is the only evidence an operator has about WHY a
        // level went unmapped, so keep the one that got furthest.
        const trackBest = (name, cand) => {
            if (!cand.supported) return;
            if (!part.best || cand.mapped > part.best.stats.mapped) part.best = { strategy: name, stats: cand };
        };

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
        trackBest("pixel-pos", pixelMap);
        if (acceptsDense(pixelMap) || acceptsSparse(pixelMap)) {
            part.frames = pixelMap.frames;
            part.strategy = "pixel-pos";
            part.stats = pixelMap;
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
            trackBest("div-dis", disMap);
            if (acceptsDense(disMap) || acceptsSparse(disMap)) {
                part.frames = disMap.frames;
                part.strategy = "div-dis";
                part.stats = disMap;
                return;
            }
        }

        // ---------- Strategy 3: heuristic DIV (legacy) ----------------------
        // Try both axis assignments; accept ONLY if exactly one is full+clean.
        // Refuse to silently pick when both are full — that's the documented
        // source of the high-res striping bug.
        //
        // DENSE ONLY, deliberately. Tiers 1-2 read what the standard defines the
        // position to be, so consuming every frame cleanly proves them right over
        // a sparse subset too. This tier only guesses which DIV axis is X, and its
        // sole evidence is that the guess uniquely tiles the WHOLE grid. Over a
        // sparse subset that evidence is worth nothing — and the both-orders guard
        // below cannot save it either, since on a non-square grid the transposed
        // order simply falls out of bounds instead of colliding. A sparse level
        // whose only positional data is a bare DimensionIndexValues is therefore
        // refused (frameOrder* overrides steer the sequential tier, not this one).
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
        trackBest("div-heuristic-xy", heurXY);
        trackBest("div-heuristic-yx", heurYX);
        const okXY = acceptsDense(heurXY);
        const okYX = acceptsDense(heurYX);
        if (okXY && !okYX) {
            part.frames = heurXY.frames;
            part.strategy = "div-heuristic-xy";
            part.stats = heurXY;
            return;
        }
        if (okYX && !okXY) {
            part.frames = heurYX.frames;
            part.strategy = "div-heuristic-yx";
            part.stats = heurYX;
            return;
        }
        if (okXY && okYX) {
            console.warn(
                `[DICOM] Ambiguous DIV axes for instance ${instanceUID} (level ${tilesX}×${tilesY}, ${numberOfFrames} frames): ` +
                "both div_xy and div_yx fully map the grid. Falling back to sequential layout. " +
                "Override with frameOrderByInstance / frameOrderBySeries in plugin options if the result is wrong."
            );
        }

        // Strategy 4 — the DimensionOrganizationType-informed sequential fallback —
        // is level-wide, not per-instance: for one part of a concatenation the
        // frame count never covers the grid, and the layout has to be laid over the
        // merged logical frame space. It runs in `_finalizeWsiLevel`, which is also
        // where an unmapped part is reported.
    }

    /**
     * Complete every level of a WSI group once all its instances are ingested.
     *
     * A level is not finished when its instance is: two facts are level-wide and
     * unknowable from a single SOP Instance. A concatenation part's frame offset
     * may only be derivable from its siblings' frame counts (0020,9228 absent but
     * 0020,9162 present), and whether the frame total covers the grid is a
     * question about the whole level — for one part of a concatenation the answer
     * is always "no", which is exactly what used to make such a level render
     * nothing at all.
     *
     * @param {object} wsi the WSI group, with `levels[]` carrying `parts[]`
     */
    static _finalizeWsiLevels(wsi) {
        if (!wsi?.levels?.length) return;
        for (const level of wsi.levels) this._finalizeWsiLevel(wsi, level);
    }

    static _finalizeWsiLevel(wsi, level) {
        if (!Array.isArray(level?.parts) || !level.parts.length) return;

        let parts = level.parts;
        const { tilesX, tilesY, expected } = parts[0];
        const where = parts.length === 1
            ? `instance ${parts[0].instanceUID}`
            : `level ${tilesX}×${tilesY} (${parts.length} concatenation parts)`;

        // --- 1. Frame offsets ------------------------------------------------
        // Explicit ConcatenationFrameOffsetNumber is authoritative. Failing that,
        // InConcatenationNumber orders the parts and their frame counts accumulate.
        // A lone instance trivially starts at 0.
        let offsetsResolved = true;
        if (parts.length === 1) {
            if (!Number.isFinite(parts[0].frameOffset)) parts[0].frameOffset = 0;
        } else if (parts.every(p => Number.isFinite(p.frameOffset))) {
            // as declared
        } else if (parts.every(p => Number.isFinite(p.inConcatNumber))) {
            let acc = 0;
            for (const p of parts.slice().sort((a, b) => a.inConcatNumber - b.inConcatNumber)) {
                p.frameOffset = acc;
                acc += p.numberOfFrames;
            }
        } else {
            offsetsResolved = false;
        }

        if (!offsetsResolved) {
            // Guessing an order here would silently misplace whole regions of the
            // slide. Keep the part that covers the most and say so.
            const largest = parts.slice().sort((a, b) => b.numberOfFrames - a.numberOfFrames)[0];
            console.error(
                `[DICOM] Cannot order the ${parts.length} instances sharing level ${tilesX}×${tilesY}: ` +
                "neither ConcatenationFrameOffsetNumber (0020,9228) nor InConcatenationNumber (0020,9162) " +
                `is present on all of them. Keeping ${largest.instanceUID} only.`
            );
            largest.frameOffset = 0;
            parts = level.parts = [largest];
        }

        parts.sort((a, b) => a.frameOffset - b.frameOffset);

        if (parts.length > 1) {
            let cursor = 0, contiguous = true;
            for (const p of parts) {
                if (p.frameOffset !== cursor) contiguous = false;
                cursor += p.numberOfFrames;
            }
            if (!contiguous) {
                console.warn(
                    `[DICOM] Concatenation parts of level ${tilesX}×${tilesY} do not tile the frame space ` +
                    `contiguously: ${parts.map(p => `${p.instanceUID}@${p.frameOffset}+${p.numberOfFrames}`).join(", ")}. ` +
                    "Frames in a gap resolve to no instance; frames in an overlap resolve to the earlier part."
                );
            }

            // `_injectLevelByDims` matches dimensions within ±1 px. That is the
            // right rule for a concatenation and the wrong one for two unrelated
            // images that happen to be the same size, and the ConcatenationUID is
            // the only thing that tells them apart.
            const concatUIDs = new Set(parts.map(p => p.concatUID || null));
            if (concatUIDs.size > 1 || concatUIDs.has(null)) {
                console.warn(
                    `[DICOM] Level ${tilesX}×${tilesY} was assembled from instances that do not share one ` +
                    `ConcatenationUID (0020,9161): ${parts.map(p => `${p.instanceUID}=${p.concatUID || "none"}`).join(", ")}. ` +
                    "They match on dimensions only, so they may be unrelated images."
                );
            }
        }

        // --- 2. Merge, or fall back --------------------------------------------
        const mapped = parts.filter(p => p.frames);
        const totalFrames = parts.reduce((sum, p) => sum + p.numberOfFrames, 0);
        const dimOrgType = parts.find(p => p.dimOrgType)?.dimOrgType || null;
        const overrideOrder = parts.find(p => p.overrideOrder)?.overrideOrder || null;
        let strategy = null, reason = null;
        let collisions = 0, oob = 0, unresolved = 0;

        const mergeMaps = (list) => {
            if (list.length === 1 && list[0].frameOffset === 0) return list[0].frames;
            const merged = Object.create(null);
            for (const p of list) {
                for (const key in p.frames) {
                    // First-wins, so the part with the lower offset owns a
                    // contested cell. (Within one part a collision is impossible —
                    // acceptance rejects any candidate that has one.)
                    if (merged[key] != null) { collisions++; continue; }
                    merged[key] = p.frames[key] + p.frameOffset;
                }
            }
            return merged;
        };

        if (mapped.length === parts.length) {
            level.frames = mergeMaps(parts);
            for (const p of parts) {
                oob += p.stats?.oob || 0;
                unresolved += p.stats?.unresolved || 0;
            }
            const names = Array.from(new Set(parts.map(p => p.strategy)));
            strategy = names.length === 1 ? names[0] : `mixed:${names.join("+")}`;
            if (names.length > 1) {
                console.warn(
                    `[DICOM] Concatenation parts of level ${tilesX}×${tilesY} resolved by different strategies ` +
                    `(${parts.map(p => `${p.instanceUID}=${p.strategy}`).join(", ")}). The merged map is still ` +
                    "positional, but the parts disagree about which metadata is authoritative."
                );
            }
            if (collisions) {
                console.warn(
                    `[DICOM] ${collisions} tile position(s) of level ${tilesX}×${tilesY} are claimed by more than ` +
                    "one concatenation part; the lowest frame offset wins."
                );
            }
        } else if (mapped.length === 0) {
            // ---------- Strategy 4: DimensionOrganizationType-informed sequential
            // Only bail on TILED_SPARSE when the frame count genuinely can't tile
            // the grid. When expected === totalFrames, the SPARSE label is
            // effectively misleading metadata — fall through to the sequential
            // assignment block, and let post-loop inference rewrite the layout
            // using truth levels from the same WSI if any exist.
            if (dimOrgType === "TILED_SPARSE" && !overrideOrder && expected !== totalFrames) {
                console.error(
                    `[DICOM] Malformed TILED_SPARSE ${where}: ` +
                    `frame count ${totalFrames} does not cover grid ${tilesX}×${tilesY} (${expected} tiles) ` +
                    "and no per-frame positions are present. Tiles will fail-fast. " +
                    "Provide frameOrderByInstance in plugin options if you know the layout."
                );
                reason = "tiled-sparse-no-positions";
            } else if (expected === totalFrames) {
                // TILED_FULL standard layout is row-major; honor explicit user overrides above all.
                // Inference (post-loop) may rewrite this map when no user override
                // was supplied and other levels carry per-frame truth.
                const resolved = overrideOrder || "row-major";
                level.frames = this._buildSequentialFrames(tilesX, tilesY, resolved);
                level._overrideApplied = !!overrideOrder;
                strategy = overrideOrder
                    ? `sequential-${String(resolved).toLowerCase()}`
                    : (dimOrgType === "TILED_FULL" ? "sequential-tiled-full-row-major" : "sequential-row-major-legacy");
            } else {
                console.warn(
                    `[DICOM] WSI frame-map mismatch for ${where}: ` +
                    `grid ${tilesX}×${tilesY} (${expected} tiles) vs ${totalFrames} frames, ` +
                    `dimOrgType=${dimOrgType || "unknown"}. Tiles will fail-fast.`
                );
                reason = "frame-count-mismatch";
            }
        } else {
            // Some parts positioned, some not. The sequential fallback cannot
            // complete this: it would have to invent frame numbers for cells the
            // positioned parts already own. Keep what is known — a partial level
            // renders its real tiles and lets the coarser level show through the
            // rest, which beats rendering nothing.
            level.frames = mergeMaps(mapped);
            for (const p of mapped) {
                oob += p.stats?.oob || 0;
                unresolved += p.stats?.unresolved || 0;
            }
            strategy = Array.from(new Set(mapped.map(p => p.strategy))).join("+");
            reason = "mixed-parts";
            console.warn(
                `[DICOM] Only ${mapped.length} of ${parts.length} instances sharing level ${tilesX}×${tilesY} carry ` +
                `usable per-frame positions; no map for ${parts.filter(p => !p.frames).map(p => p.instanceUID).join(", ")}. ` +
                "Those tiles will be absent."
            );
        }

        // --- 3. Publish --------------------------------------------------------
        const present = Object.keys(level.frames || {}).length;
        // Read by `tileExists` in the tile source: a cell with no frame is a legal
        // absent tile, not a failed request. Only the WSI ingest sets this, which
        // is what keeps the derived and radiology sources on their own paths.
        level.sparse = present < expected;
        level._strategy = strategy || undefined;
        level.instanceUID = parts[0].instanceUID;
        // The level's real grid. `getNumTiles` in the tile source reports this
        // instead of letting OSD infer the row/column count from the base
        // level's scale — the two disagree whenever a level's own height is not
        // exactly `baseHeight × (levelWidth / baseWidth)`, which is routine
        // because a pyramid rounds each axis independently.
        level.tilesX = tilesX;
        level.tilesY = tilesY;

        this._logFrameStrategy(wsi, level, {
            tilesX, tilesY, expected, present, totalFrames,
            parts: parts.length, strategy, reason,
            collisions, oob, unresolved,
            best: parts.find(p => p.best)?.best || null,
        });
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
     *
     * Why sparse levels are not truth: their frames are numbered over the cells
     * that exist, so no dense pattern can reproduce them and every candidate
     * scores near zero. Because the score is a per-level MINIMUM, one sparse
     * level in the series would drag every candidate below the threshold and
     * kill inference for the whole group.
     */
    static _inferSequentialLayoutForWsi(wsi) {
        if (!wsi?.levels?.length) return;

        const truthLevels = wsi.levels.filter(L =>
            L?._strategy && /^(pixel-pos|div-)/.test(L._strategy) && L.frames && !L.sparse
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

    /**
     * One concise line per level — searchable, single-grep diagnostic.
     *
     * An unmapped level prints `strategy=none reason=<why>` plus the rejected
     * candidate that got furthest, because "this level is blank" is otherwise
     * indistinguishable from "this level is absent" in an operator's console.
     */
    static _logFrameStrategy(wsiInstance, level, info) {
        const { tilesX, tilesY, expected, present, totalFrames, parts, strategy, reason,
            collisions, oob, unresolved, best } = info;
        const coverage = expected > 0 ? ((present / expected) * 100).toFixed(1) : "0.0";
        const idx = wsiInstance?.levels ? wsiInstance.levels.indexOf(level) : -1;
        const dims = level.width != null ? `${level.width}×${level.height}` : "?";

        let tail = `collisions=${collisions || 0} oob=${oob || 0} unresolved=${unresolved || 0}`;
        if (!strategy && best) {
            tail += ` best=${best.strategy}(mapped=${best.stats.mapped}/${expected},` +
                `collisions=${best.stats.collisions},oob=${best.stats.oob},unresolved=${best.stats.unresolved})`;
        }

        console.info(
            `[DICOM] level=${idx >= 0 ? idx : "?"} dims=${dims} grid=${tilesX}×${tilesY} frames=${totalFrames} ` +
            `parts=${parts} strategy=${strategy || `none reason=${reason || "unknown"}`} coverage=${coverage}% ` +
            `sparse=${level.sparse ? "yes" : "no"} ${tail} instance=${level.instanceUID}`
        );
    }

    /**
     * Resolve a level-logical frame number to the SOP Instance that holds it.
     *
     * `level.frames` is numbered over the level's whole frame space, which for a
     * concatenation spans several instances (ConcatenationFrameOffsetNumber says
     * where each one starts). This is the only place that mapping lives: the tile
     * source asks for a logical frame and gets back the instance plus the local,
     * 1-based frame number a WADO-RS URL needs.
     *
     * @param {object} level a level record
     * @param {number} logicalFrame 1-based frame number in the level's space
     * @returns {?{instanceUID: string, frame: number}} null when unresolvable
     */
    static resolveFrameRef(level, logicalFrame) {
        if (!Number.isFinite(logicalFrame) || logicalFrame <= 0) return null;

        const parts = level?.parts;
        // Hand-built levels (the radiology source) carry no parts table, and a
        // single-instance level needs no arithmetic.
        if (!Array.isArray(parts) || !parts.length) {
            return level?.instanceUID ? { instanceUID: level.instanceUID, frame: logicalFrame } : null;
        }
        if (parts.length === 1 && !parts[0].frameOffset) {
            return parts[0].instanceUID ? { instanceUID: parts[0].instanceUID, frame: logicalFrame } : null;
        }

        // Parts are sorted by offset, and the scan runs forward so that a frame
        // inside a declared overlap resolves to the earlier part — the same
        // tie-break the map merge uses.
        for (const p of parts) {
            const local = logicalFrame - (p.frameOffset || 0);
            if (local >= 1 && local <= p.numberOfFrames) {
                return p.instanceUID ? { instanceUID: p.instanceUID, frame: local } : null;
            }
        }
        return null;
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
            // A level can be assembled from several instances (concatenation), so
            // these are containers from the start rather than fields a later
            // ingest overwrites. This function stays a pure dimension lookup —
            // the union semantics live in `_finalizeWsiLevel`.
            parts: [],
            frames: Object.create(null),
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