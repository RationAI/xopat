import DicomQuery from './dicom-query.mjs';

// tileSource.mjs — dynamic multi‑instance DICOMweb TileSource for xOpat/OSD
// - Builds on the working shared implementation, adding:
//   • dynamic instance resolution (no hardcoded SOPInstanceUID)
//   • merges multi‑instance pyramids (levels may live in different instances)
//   • detects preview/overview (thumbnail) and label/macro images
//   • keeps per‑level instance ownership + per‑tile frame mapping
//   • adds downloadPreviewImage() and downloadMacroImage() helpers
// - Tested against Google Cloud Healthcare + Orthanc DICOMweb
// - Still honors partial, not‑yet‑published OSD TileSource init flow in v3
export class DICOMWebTileSource extends OpenSeadragon.TileSource {
    constructor(options) {
        // OSD expects a URL and will call getImageInfo; we proxy to _initializeFromServer.
        options.url = options.baseUrl || "localhost";
        options.baseUrl = options.baseUrl?.replace(/\/+$/, "");
        options.ready = !!options.wsi;
        super(options);

        // HttpClient owns auth (JWT injection, 401-refresh, CSRF, proxy routing).
        // The slide-protocol registry stamps the same client on `__xopatHttpClient`
        // for OSD's metadata-fetch path. When `options.client` is absent (e.g. a
        // standalone construction without going through SLIDE_PROTOCOLS), the
        // legacy bare-fetch branches below preserve today's behavior.
        this.client = options.client || null;
        this.ajaxHeaders = this.ajaxHeaders || {};

        this.frameOrder = options.frameOrder || null;
        this.frameOrderBySeries = options.frameOrderBySeries || null;
        this.frameOrderByInstance = options.frameOrderByInstance || null;
        this._hasWarnedFrameMismatch = false;

        this._initializeCornerstoneLoader();
    }

    /**
     * Stable identifier scoped to this slide's DICOM identity. Used by
     * subsystems (e.g. the ICC profile module) that need to cache per-source
     * state. `options.url` is the DICOMweb base URL and is shared across all
     * slides served by the same endpoint, so it cannot be used as an identity
     * key — it produces silent collisions where slide A's cached state is
     * served to slide B.
     */
    get tileSourceId() {
        if (!this.studyUID || !this.seriesUID) return null;
        return `dicom:${this.baseUrl}#${this.studyUID}/${this.seriesUID}`;
    }

    _initializeCornerstoneLoader() {
        if (typeof cornerstoneWADOImageLoader === 'undefined' || DICOMWebTileSource._cwilInitialized) return;

        // 1. Manually link a dummy/core object if 'cornerstone' isn't global
        // WADO Loader 1.4.x often checks 'cornerstone.enabled' or internal config
        if (typeof cornerstone !== 'undefined') {
            cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
        }

        // 2. Force the internal config to have an 'enabled' state
        cornerstoneWADOImageLoader.configure({
            useWebWorkers: true,
            decodeConfig: {
                usePDFJS: false,
            }
        });

        // 3. Set the worker path (ensure this matches your dist folder)
        const workerPath = 'dist/index.worker.bundle.min.worker.js';
        cornerstoneWADOImageLoader.webWorkerManager.initialize({
            maxWebWorkers: navigator.hardwareConcurrency || 4,
            startWebWorkersOnDemand: true,
            webWorkerPath: workerPath,
            taskConfiguration: {
                'decodeTask': {
                    loadCodecsOnStartup: true,
                    initializeCodecsOnStartup: true,
                    usePDFJS: false,
                    strict: false
                }
            }
        });

        DICOMWebTileSource._cwilInitialized = true;
    }

    supports(data) { return data && data.type === "dicomweb"; }

    _acceptHeader(useRendered = this.useRendered, preferPng = false) {
        if (useRendered) {
            // The /rendered endpoint on standards-conformant DICOMweb servers
            // (including Google Cloud Healthcare) returns a single-part image
            // and rejects `multipart/related` with HTTP 406. Send a simple
            // image accept header; _downloadImage handles the response as
            // either a raw image blob or a multipart envelope, so either
            // server contract continues to work.
            return preferPng
                ? 'image/png, image/jpeg;q=0.9'
                : 'image/jpeg, image/png;q=0.9';
        }

        // Force the server to send the original compressed bitstream (J2K)
        // instead of trying to transcode it to baseline JPEG.
        return [
            'multipart/related; type="application/octet-stream"; transfer-syntax=1.2.840.10008.1.2.4.90',
            'multipart/related; type="application/octet-stream"; transfer-syntax=1.2.840.10008.1.2.4.91',
            'multipart/related; type="application/octet-stream"; transfer-syntax=*'
        ].join(', ');
    }

    indexOfBytes(hay, needle, from = 0) {
        outer: for (let i = from; i <= hay.length - needle.length; i++) {
            for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
            return i;
        }
        return -1;
    }

    async parseMultipartRelated(res) {
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

                    // FIX: Extract transfer-syntax if it's hidden inside Content-Type
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

    /* -------------------------- OSD integration -------------------------- */
    getImageInfo(url) {
        this._initializeFromServer()
            .then(() => {
                this.dimensions = new OpenSeadragon.Point(this.width, this.height);
                this.aspectRatio = this.width / this.height;
                this.ready = true;
                this.raiseEvent("ready", { tileSource: this });
            })
            .catch((e) => {
                console.error("Failed to initialize DICOM Web TileSource!", e);
                this.raiseEvent("open-failed", { message: e, source: url, postData: null });
            });
    }

    async _initializeFromServer() {
        if (!this.seriesUID || !this.studyUID) {
            throw new Error('DICOM TileSource needs seriesUID and studyUID to be set before initialization!');
        }
        if (!this.client) {
            throw new Error('DICOM TileSource needs an HttpClient (options.client) to initialize.');
        }

        const wsiList = await DicomQuery.findWSIItems(
            this.client,
            this.studyUID,
            this.seriesUID,
            {
                frameOrder: this.frameOrder,
                frameOrderBySeries: this.frameOrderBySeries,
                frameOrderByInstance: this.frameOrderByInstance
            }
        );

        this.wsi = (wsiList || [])
            .slice()
            .sort((a, b) => {
                const aLevels = a?.levels?.length ?? 0;
                const bLevels = b?.levels?.length ?? 0;
                if (bLevels !== aLevels) return bLevels - aLevels;

                const maxW = (w) => Math.max(0, ...((w?.levels || []).map(L => Number(L?.width) || 0)));
                return maxW(b) - maxW(a);
                return bW - aW;
            })[0];

        // Validate we have at least one pyramid level
        if (!this.wsi?.levels?.length) {
            throw new Error("No pyramid levels discovered in series (missing Per-Frame FG or TILED_FULL fallback)");
        }

// Normalize levels:
// - drop incomplete entries
// - sort so levels[0] is ALWAYS highest-res (max width)
        const normalized = this.wsi.levels
            .filter(l =>
                l &&
                Number.isFinite(l.width) &&
                Number.isFinite(l.height) &&
                Number.isFinite(l.tileWidth) &&
                Number.isFinite(l.tileHeight) &&
                l.instanceUID
            )
            .slice()
            .sort((a, b) => {
                // biggest first
                if (b.width !== a.width) return b.width - a.width;
                return (b.height ?? 0) - (a.height ?? 0);
            });

        if (!normalized.length) {
            throw new Error("WSI levels exist but none are usable (missing width/height/tile sizes/instanceUID).");
        }

        this.wsi.levels = normalized;

        this.minLevel = 0;
        this.maxLevel = this.wsi.levels.length - 1;

// width/height/tile size — always from highest-res level (levels[0])
        const topLevel = this.wsi.levels[0];
        this.width  = topLevel.width;
        this.height = topLevel.height;

// Tile sizes: use highest-res tile size as canonical for OSD
        this.tileWidth  = topLevel.tileWidth  || 512;
        this.tileHeight = topLevel.tileHeight || 512;

        // build pyramid downsacle info
        if (!this.wsi.levels.length) {
            throw new Error('No levels were found!');
        }

        if (this.wsi.levels[0].instanceUID) {
            // You might need to fetch metadata for the first instance if you haven't already
            // or rely on DicomQuery to have stored it.
            // For now, let's assume you can access the instance metadata.
            // The tag is 0028,0004.
            this.photometricInterpretation = this.wsi.photometricInterpretation || "RGB";
        }
    }

    configure() { }

    /* -------------------------- Metadata -> Pyramid -------------------------- */
    getMetadata() {
        // todo if error return error data
        // {
        //   error: ....
        //  }

        if (!this.wsi || !this.wsi.levels) {
            return { error: "Metadata missing", imageInfo: {} };
        }

        const level0 = this.wsi.levels[0] || {};

        // --- DEFAULTS --- todo show warning if used
        const safeFrameOfRef = this.wsi.frameOfReferenceUID || `${this.seriesUID}.999`;
        const safeMicronsX = level0.micronsX || 0.00025;
        const safeMicronsY = level0.micronsY || 0.00025;

        return {
            imageInfo: {
                studyUID: this.studyUID,
                seriesUID: this.seriesUID,
                frameOfReferenceUID: safeFrameOfRef,
                previewInstanceUID: this.wsi?.previewInstanceUID,
                macroInstanceUID: this.wsi?.macroInstanceUID,
                levels: this.wsi.levels,
                tileWidth: this.tileWidth,
                tileHeight: this.tileHeight,
                micronsX: safeMicronsX,
                micronsY: safeMicronsY,
            },
        }
    }

    /**
     * Identifying / patient-sensitive metadata, kept strictly separate from
     * getMetadata() (which stays technical). Reachable only through the isolated
     * `patient` scripting namespace. `patientDetails` is the plugin's live
     * activePatientDetails ({ patientID, name, sex, birthDate }) captured on the
     * source options; the protocol UIDs are opaque PHI identifiers surfaced here
     * for the sensitive-classification boundary (they also remain in getMetadata
     * for the internal DICOM/SR pipeline).
     */
    getSensitiveMetadata() {
        const p = this.patientDetails || {};
        return {
            patient: {
                patientID: p.patientID ?? null,
                name: p.name ?? null,
                sex: p.sex ?? null,
                birthDate: p.birthDate ?? null,
            },
            studyUID: this.studyUID ?? null,
            seriesUID: this.seriesUID ?? null,
            frameOfReferenceUID: this.wsi?.frameOfReferenceUID ?? null,
        };
    }

    /* ------------------------------ OSD hooks ------------------------------ */
    getLevelScale(level) {
        level = this.maxLevel-level;
        const levels = this.wsi.levels;
        return levels[level].width / levels[0].width;
    }

    // Per-level tile dimensions. DICOMweb pyramids may have different tile
    // sizes per level (e.g. 512×512 high-res + 256×256 thumb). OSD calls these
    // from getNumTiles(level) / getTileAtPoint(level), so overriding them is
    // sufficient to make the grid math correct end-to-end.
    getTileWidth(level) {
        const L = this.wsi?.levels?.[this.maxLevel - level];
        return L?.tileWidth || this._tileWidth || this.tileWidth || 256;
    }

    getTileHeight(level) {
        const L = this.wsi?.levels?.[this.maxLevel - level];
        return L?.tileHeight || this._tileHeight || this.tileHeight || 256;
    }

    getTileUrl(level, x, y) {
        level = this.wsi.levels[this.maxLevel - level];
        const frame = level?.frames?.[`${x}_${y}`];

        // Guard: if frame mapping is missing, return a URL that will fail fast but never "frames/undefined"
        if (!Number.isFinite(frame) || frame <= 0) {
            // Return an invalid frame index so the tile fails fast (better than showing the wrong/blank frame 1)
            return `${this.baseUrl}/studies/${this.studyUID}/series/${this.seriesUID}/instances/${level.instanceUID}/frames/0`;
        }

        const tail = this.useRendered ? `frames/${frame}/rendered` : `frames/${frame}`;
        return `${this.baseUrl}/studies/${this.studyUID}/series/${this.seriesUID}/instances/${level.instanceUID}/${tail}`;
    }

    async _getTile(context) {
        let res;
        try {
            if (this.client) {
                res = await this.client.fetchRaw(context.src, {
                    headers: { Accept: this._acceptHeader(this.useRendered) }
                });
            } else {
                res = await fetch(context.src, {
                    headers: { ...this.ajaxHeaders, 'Accept': this._acceptHeader(this.useRendered) },
                    mode: 'cors', cache: 'no-store',
                });
                if (!res.ok) return context.fail(`Failed to fetch DICOM frame (HTTP ${res.status}).`, res);
            }
        } catch (e) {
            return context.fail(`Failed to fetch DICOM frame: ${e?.message ?? e}`, null);
        }

        // Tile dimensions for this specific level — DICOM pyramids can have
        // different tile sizes per level, so use the tile's own level rather
        // than the source's top-level dimensions.
        const level = context.tile?.level;
        const tileW = level != null ? this.getTileWidth(level) : (this.tileWidth || 256);
        const tileH = level != null ? this.getTileHeight(level) : (this.tileHeight || 256);

        // 1. Check for native browser formats (Rendered JPEG/PNG)
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.startsWith('image/jpeg') || ct.startsWith('image/png')) {
            const blob = await res.blob();
            return context.finish(blob, res, "rasterBlob");
        }

        // 2. Extract frame from Multipart response
        const parts = await this.parseMultipartRelated(res);
        if (!parts.length) return context.fail("DICOM response carries no frames!", res);

        const { headers, bytes } = parts[0];
        let transferSyntax = (headers['transfer-syntax'] || '').trim();

        if (!transferSyntax) {
            const ct = headers['content-type'] || "";
            if (ct.includes('image/jp2')) transferSyntax = "1.2.840.10008.1.2.4.91"; // Assume J2K Lossy
            else if (ct.includes('image/jpeg')) transferSyntax = "1.2.840.10008.1.2.4.50"; // Assume Baseline
        }

        // 3. Use Cornerstone WADO Loader for J2K or Uncompressed bitstreams
        try {
            const bmp = await this._decodeWithCornerstone(bytes, transferSyntax, tileW, tileH);
            return context.finish(bmp, res, "imageBitmap");
        } catch (err) {
            console.error("[DICOM] Cornerstone decoding failed", err);
            return context.fail("Cornerstone Decode failure", res);
        }
    }

    // tile-source.mjs
    async _decodeWithCornerstone(pixelData, transferSyntax, tileWidth, tileHeight) {
        const ts = (transferSyntax || "").replace(/['"]/g, "").trim();
        let data = pixelData;

        if (data[0] === 0xFE && data[1] === 0xFF && data[2] === 0x00 && data[3] === 0xE0) {
            data = data.subarray(8);
        }

        const rows = tileHeight || this.tileHeight || 256;
        const cols = tileWidth || this.tileWidth || 256;

        const pi0 = (this.photometricInterpretation || "RGB").toUpperCase();

        const spp0 = (pi0 === "YBR_FULL_422") ? 2 : (this.samplesPerPixel || 3);

        const metadata = {
            rows,
            columns: cols,
            bitsAllocated: 8,
            bitsStored: 8,
            highBit: 7,
            pixelRepresentation: 0,
            planarConfiguration: 0,
            samplesPerPixel: spp0,
            photometricInterpretation: pi0,
        };

        const options = {
            preScale: { enabled: false },
            decodeConfig: { isJP2: false },
        };

        const decodeCanvas = document.createElement("canvas");

        const decodedFrame = await cornerstoneWADOImageLoader.decodeImageFrame(
            metadata, ts, data, decodeCanvas, options
        );
        const w = decodedFrame.columns || cols;
        const h = decodedFrame.rows || rows;
        const pi = (decodedFrame.photometricInterpretation || metadata.photometricInterpretation || "").toUpperCase();

        if (pi.startsWith("YBR")) {
            if (ts === "1.2.840.10008.1.2.4.50") {
                // Baseline JPEG – browser always returns RGB - nothing to do
                decodedFrame.samplesPerPixel = 3;
            } else {
                // Output buffer: RGBA
                const rgba = new Uint8ClampedArray(w * h * 4);
                // Correct signature: (imageFrame, outputBuffer, useAlpha)
                cornerstoneWADOImageLoader.convertColorSpace(decodedFrame, rgba, true);
                decodedFrame.pixelData = rgba;
                decodedFrame.samplesPerPixel = 4;     // matches RGBA buffer
            }

            decodedFrame.photometricInterpretation = "RGB";
            decodedFrame.planarConfiguration = 0; // interleaved
        }

        // Test if 4 channels -> RGBA
        if (decodedFrame.imageData && decodedFrame.imageData.data?.length === w * h * 4) {
            return await createImageBitmap(decodedFrame.imageData);
        }

        decodedFrame.width = decodedFrame.width || decodedFrame.columns || cols;
        decodedFrame.height = decodedFrame.height || decodedFrame.rows || rows;

        if (!decodedFrame.width || !decodedFrame.height) {
            throw new Error(`Invalid dimensions: ${decodedFrame.width}x${decodedFrame.height}`);
        }

        return await this._decodedToBitmap(decodedFrame);
    }

    // todo move this to webassembly or a worker
    async _decodedToBitmap(decodedData) {
        const w = decodedData.width;
        const h = decodedData.height;

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext("2d");
        const imgData = ctx.createImageData(w, h);

        // ---- normalize pixelData to a TypedArray ----
        let pixels = decodedData.pixelData;
        if (!pixels) throw new Error("Decoder result is missing pixelData.");

        // Some CWIL paths return ArrayBuffer instead of TypedArray -> length is undefined -> black tiles
        const bits = decodedData.bitsAllocated || decodedData.bitsPerSample || 8;

        if (pixels instanceof ArrayBuffer) {
            pixels = (bits > 8) ? new Uint16Array(pixels) : new Uint8Array(pixels);
        } else if (pixels.buffer instanceof ArrayBuffer && typeof pixels.length !== "number") {
            // very defensive: if something array-buffer-like without length
            pixels = (bits > 8)
                ? new Uint16Array(pixels.buffer, pixels.byteOffset || 0, (pixels.byteLength || pixels.buffer.byteLength) / 2)
                : new Uint8Array(pixels.buffer, pixels.byteOffset || 0, pixels.byteLength || pixels.buffer.byteLength);
        }

        const numPx = w * h;
        const spp = decodedData.samplesPerPixel ?? 1;
        const planar = decodedData.planarConfiguration ?? 0;

        // helper for 16-bit -> 8-bit display
        const to8 = (v) => (bits > 8 ? (v >> 8) : v) & 0xff;

        // ---- map to RGBA ----
        if (spp === 1) {
            for (let i = 0; i < numPx; i++) {
                const v = to8(pixels[i] ?? 0);
                const o = i * 4;
                imgData.data[o] = v;
                imgData.data[o + 1] = v;
                imgData.data[o + 2] = v;
                imgData.data[o + 3] = 255;
            }
        } else if (spp >= 3) {
            if (planar === 1) {
                // planar: R plane, then G, then B
                const planeSize = numPx;
                const rOff = 0;
                const gOff = planeSize;
                const bOff = planeSize * 2;

                for (let i = 0; i < numPx; i++) {
                    const o = i * 4;
                    imgData.data[o]     = to8(pixels[rOff + i] ?? 0);
                    imgData.data[o + 1] = to8(pixels[gOff + i] ?? 0);
                    imgData.data[o + 2] = to8(pixels[bOff + i] ?? 0);
                    imgData.data[o + 3] = 255;
                }
            } else {
                // interleaved: RGBRGB...
                for (let i = 0; i < numPx; i++) {
                    const s = i * spp; // supports spp=3 or spp=4
                    const o = i * 4;
                    imgData.data[o]     = to8(pixels[s] ?? 0);
                    imgData.data[o + 1] = to8(pixels[s + 1] ?? 0);
                    imgData.data[o + 2] = to8(pixels[s + 2] ?? 0);
                    imgData.data[o + 3] = 255;
                }
            }
        }

        ctx.putImageData(imgData, 0, 0);
        return await createImageBitmap(canvas);
    }


    async getLabel() {
        if (!this.wsi?.macroInstanceUID) return null;
        return this._downloadWholeInstanceImage(this.wsi.macroInstanceUID);
    }

    downloadTileStart(context) { this._getTile(context); }

    /* ------------------------- Preview/Macro fetch ------------------------- */
    async _downloadWholeInstanceImage(instanceUID) {
        if (!instanceUID) throw new Error("No instance selected");
        const path = `/studies/${this.studyUID}/series/${this.seriesUID}/instances/${instanceUID}/rendered`;
        return this._downloadImage(path);
    }

    async _downloadImage(pathOrUrl) {
        let res;
        if (this.client) {
            res = await this.client.fetchRaw(pathOrUrl, {
                headers: { Accept: this._acceptHeader(true, false) }
            });
        } else {
            res = await fetch(pathOrUrl, {
                headers: { ...this.ajaxHeaders, Accept: this._acceptHeader(true, false) },
                mode: 'cors', cache: 'no-store'
            });
            if (!res.ok) throw new Error(`Failed to download rendered image (${res.status})`);
        }

        const ct = (res.headers.get('content-type') || '').toLowerCase();
        // Many servers return a single-part image for /rendered
        if (ct.startsWith('image/jpeg') || ct.startsWith('image/png')) {
            return await res.blob();
        }

        const parts = await this.parseMultipartRelated(res);
        if (!parts.length) throw new Error("Rendered response missing");
        const { headers, bytes } = parts[0];
        const type = (headers['content-type'] || '').toLowerCase();
        const mime = type.includes('image/png') ? 'image/png' : (type.includes('image/jpeg') ? 'image/jpeg' : 'application/octet-stream');
        return new Blob([bytes], { type: mime });
    }

    /** Download preview/overview (thumbnail) image as a Blob (PNG or JPEG). */
    async getThumbnail({ targetWidth = 512 } = {}) {
        // Always route via the OVERVIEW/THUMBNAIL instance's `/rendered`
        // endpoint — works on GCS Healthcare and standards-conformant
        // servers alike. The `previewInstanceUID` is populated by
        // groupSeriesInstances when a LABEL/OVERVIEW instance exists.
        try {
            if (this.wsi?.previewInstanceUID) {
                return await this._downloadWholeInstanceImage(this.wsi.previewInstanceUID);
            }
        } catch (e) {
            console.debug("[DICOM] thumbnail unavailable:", e?.message ?? e);
        }
        return null;
    }

    /** Download label/macro image as a Blob (PNG or JPEG). */
    async downloadMacroImage() { return this._downloadWholeInstanceImage(this.wsi.macroInstanceUID); }


    _iccProfileCache = undefined;

    /**
     * Download ICC profile from DICOM instance metadata.
     * The ICC module expects this method to exist and return an ArrayBuffer. :contentReference[oaicite:3]{index=3}
     */
    async downloadICCProfile() {
        if (this.useRendered) return null;
        if (this._iccProfileCache === null) return null;
        if (this._iccProfileCache instanceof ArrayBuffer) return this._iccProfileCache;
        if (!this.client) return null; // HttpClient required for ICC bulk fetch

        const studyUID = this.studyUID;
        const seriesUID = this.seriesUID;

        // Candidate instances to probe
        const candidates = [];
        if (this.wsi?.levels?.[0]?.instanceUID) candidates.push(this.wsi.levels[0].instanceUID);
        if (this.wsi?.previewInstanceUID) candidates.push(this.wsi.previewInstanceUID);
        if (this.wsi?.macroInstanceUID) candidates.push(this.wsi.macroInstanceUID);
        for (const lvl of (this.wsi?.levels || [])) if (lvl?.instanceUID) candidates.push(lvl.instanceUID);

        const uniq = Array.from(new Set(candidates));
        if (!uniq.length) {
            this._iccProfileCache = null;
            return null;
        }

        for (const instanceUID of uniq) {
            const metaPath =
                `/studies/${encodeURIComponent(studyUID)}` +
                `/series/${encodeURIComponent(seriesUID)}` +
                `/instances/${encodeURIComponent(instanceUID)}/metadata`;

            let meta;
            try {
                meta = await DicomQuery.wadoMetadata(this.client, metaPath);
            } catch (e) {
                console.warn("[ICC] metadata fetch failed", { instanceUID, metaPath, error: String(e?.message || e) });
                continue;
            }

            const ds = meta?.[0];
            if (!ds) continue;

            // Deep search for the ICC tag anywhere in the dataset tree
            const tag = findTagDeep(ds, "00282000");
            if (!tag) continue;

            // Handle common shapes:
            //  - tag.InlineBinary / tag.BulkDataURI
            //  - tag.Value[0].InlineBinary / tag.Value[0].BulkDataURI
            const inline = tag.InlineBinary ?? tag?.Value?.[0]?.InlineBinary;
            const bulk   = tag.BulkDataURI  ?? tag?.Value?.[0]?.BulkDataURI;

            if (inline) {
                const buf = this._base64ToArrayBuffer(inline);
                this._iccProfileCache = buf;
                return buf;
            }

            if (bulk) {
                // Resolve the BulkDataURI against the absolute metadata URL.
                // BulkDataURI may itself be absolute, in which case fetchRaw
                // passes it through unchanged.
                const metaAbs = this.client.resolveUrl(metaPath);
                const bulkUrl = new URL(bulk, metaAbs).toString();
                try {
                    const res = await this.client.fetchRaw(bulkUrl, {
                        headers: { Accept: "application/octet-stream" }
                    });
                    const buf = await res.arrayBuffer();
                    this._iccProfileCache = buf;
                    return buf;
                } catch (e) {
                    console.warn("[ICC] bulk fetch failed", { bulkUrl, error: String(e?.message || e) });
                    continue;
                }
            }

            // Tag exists but has no bytes — treat as missing and stop scanning
            console.warn("[ICC] ICC tag found but contains no InlineBinary/BulkDataURI", { instanceUID, metaUrl, tag });
            break;
        }

        this._iccProfileCache = null;
        return null;

        // ---- helpers ----

        function findTagDeep(node, tagKey) {
            if (!node || typeof node !== "object") return null;

            // Direct hit
            if (node[tagKey]) return node[tagKey];

            // Walk all DICOM JSON elements; recurse into sequences:
            // In DICOM JSON, sequences are usually { vr: "SQ", Value: [ { ... }, ... ] }
            for (const k of Object.keys(node)) {
                const el = node[k];
                if (!el || typeof el !== "object") continue;

                const value = el.Value;
                if (Array.isArray(value)) {
                    for (const item of value) {
                        if (item && typeof item === "object") {
                            const hit = findTagDeep(item, tagKey);
                            if (hit) return hit;
                        }
                    }
                }
            }
            return null;
        }
    }

    _base64ToArrayBuffer(b64) {
        const binStr = atob(b64);
        const len = binStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
        return bytes.buffer;
    }
}