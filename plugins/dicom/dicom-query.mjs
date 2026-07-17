export default class DicomTools {

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

    static async qidoSafeWithMeta(client, path, includefield) {
        const sep = path.includes('?') ? '&' : '?';
        const make = (withFields) => withFields && includefield ? `${path}${sep}includefield=${encodeURIComponent(includefield)}` : path;

        const tryFetch = (p) => client.fetchRaw(p, { headers: { Accept: 'application/dicom+json' } });

        let url = make(true);
        let res;
        try {
            res = await tryFetch(url);
        } catch (e) {
            // Retry without includefield if the server rejects it (e.g., GCP)
            if (e instanceof HTTPError && includefield) {
                const msg = e.textData || '';
                if (msg.includes('includefield') || msg.includes('Invalid JSON payload')) {
                    url = make(false);
                    res = await tryFetch(url);
                } else {
                    throw new Error(`QIDO ${url} failed: ${e.statusCode} ${msg}`);
                }
            } else {
                throw e;
            }
        }
        const total = this._readTotalHeader(res.headers);
        const text = await res.text();
        let rows;
        try { rows = JSON.parse(text); } catch (e) { throw new Error(`Bad DICOM JSON: ${e.message} - body: ${text}`); }
        return { rows, total };
    }

    // WADO-RS metadata fetch for richer details when QIDO filters are blocked
    static async wadoMetadata(client, path) {
        try {
            const res = await client.fetchRaw(path, { headers: { Accept: 'application/dicom+json' } });
            const text = await res.text();
            try { return JSON.parse(text); } catch (e) { throw new Error(`Bad DICOM JSON: ${e.message} - body: ${text}`); }
        } catch (e) {
            if (e instanceof HTTPError) throw new Error(`WADO ${path} failed: ${e.statusCode} ${e.textData || ''}`);
            throw e;
        }
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

            for (let instance of wsi.pyramidInstances) {
                const uid = this.v(instance, "00080018");
                const meta = await this.wadoMetadata(client, `/studies/${studyUID}/series/${seriesUID}/instances/${uid}/metadata`);
                // Pass the string default (options.frameOrder), not the whole
                // options object — the per-instance / per-series overrides are
                // already stashed on `wsi` above.
                this._ingestInstanceMetadata(uid, instance, meta, wsi, options.frameOrder || null);
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

    /** Byte-wise indexOf for multipart boundary scanning. */
    static indexOfBytes(hay, needle, from = 0) {
        outer: for (let i = from; i <= hay.length - needle.length; i++) {
            for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
            return i;
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

            // With seriesUID, walk newest-first and fetch each SR's metadata
            // to read its ReferencedSeriesSequence (tag 0008,1115 →
            // SeriesInstanceUID 0020,000E). Return on the first match.
            for (const cand of allCandidates) {
                const sopUID = this.v(cand, '00080018');
                if (!sopUID) continue;
                try {
                    const meta = await this.wadoMetadata(
                        client,
                        `/studies/${studyUID}/series/${cand._parentSeriesUID}/instances/${sopUID}/metadata`,
                    );
                    const refSeriesUID = meta?.[0]?.['00081115']?.Value?.[0]?.['0020000E']?.Value?.[0];
                    if (refSeriesUID !== seriesUID) continue;
                    return { seriesUID: cand._parentSeriesUID, sopUID };
                } catch (e) {
                    console.warn('[DICOM] SR metadata fetch failed; skipping candidate', sopUID, e?.message ?? e);
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

        // Only attempt mapping for multi-frame tiled instances
        if (!(totalWidth && totalHeight && tileWidth && tileHeight && numberOfFrames > 1)) return;

        const tilesX = Math.ceil(totalWidth / tileWidth);
        const tilesY = Math.ceil(totalHeight / tileHeight);
        const expected = tilesX * tilesY;

        const level = this._injectLevelByDims(wsiInstance, totalWidth, totalHeight, tileWidth, tileHeight);
        level.instanceUID = instanceUID;
        level.frames = level.frames || Object.create(null);
        applySpacingToLevel(level);

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