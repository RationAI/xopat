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

        // auth propagation
        this.ajaxHeaders = this.ajaxHeaders || {};
        const user = XOpatUser.instance();
        const secret = user.getSecret();
        if (secret) this.ajaxHeaders["Authorization"] = `Bearer ${secret}`;
        user.addHandler("secret-updated", e => e.type === "jwt" && (this.ajaxHeaders["Authorization"] = `Bearer ${e.secret}`));
        user.addHandler("secret-removed", e => e.type === "jwt" && (this.ajaxHeaders["Authorization"] = null));
        user.addHandler("logout", () => (this.ajaxHeaders["Authorization"] = null));

        this.frameOrder = options.frameOrder || null;
        this.frameOrderBySeries = options.frameOrderBySeries || null;
        this.frameOrderByInstance = options.frameOrderByInstance || null;
        this._hasWarnedFrameMismatch = false;

        this._initializeCornerstoneLoader();
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
            // Google DICOMweb often requires multipart/related for rendered endpoints.
            // Prefer JPEG (smaller) with PNG fallback, or flip with preferPng=true.
            return preferPng
                ? 'multipart/related; type="image/png", multipart/related; type="image/jpeg"'
                : 'multipart/related; type="image/jpeg", multipart/related; type="image/png"';
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

        // if not provided, fetch
        const wsiList = await DicomQuery.findWSIItems(
            this.baseUrl,
            XOpatUser.instance().getSecret(),
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
            // todo patientInfo: this.patientDetails
        }
    }

    /* ------------------------------ OSD hooks ------------------------------ */
    getLevelScale(level) {
        level = this.maxLevel-level;
        const levels = this.wsi.levels;
        return levels[level].width / levels[0].width;
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
        const res = await fetch(context.src, {
            headers: { ...this.ajaxHeaders, 'Accept': this._acceptHeader(this.useRendered) },
            mode: 'cors', cache: 'no-store',
        });

        if (!res.ok) return context.fail("Failed to fetch DICOM frame.", res);

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
            const bmp = await this._decodeWithCornerstone(bytes, transferSyntax);
            return context.finish(bmp, res, "imageBitmap");
        } catch (err) {
            console.error("[DICOM] Cornerstone decoding failed", err);
            return context.fail("Cornerstone Decode failure", res);
        }
    }

    // tile-source.mjs
    async _decodeWithCornerstone(pixelData, transferSyntax) {
        const ts = (transferSyntax || "").replace(/['"]/g, "").trim();
        let data = pixelData;

        // Strip DICOM Item Tag if present (FE FF 00 E0)
        if (data[0] === 0xFE && data[1] === 0xFF && data[2] === 0x00 && data[3] === 0xE0) {
            data = data.subarray(8);
        }

        const metadata = {
            rows: this.tileHeight,
            columns: this.tileWidth,
            bitsAllocated: 8,
            samplesPerPixel: 3,              // used as a fallback only
            pixelRepresentation: 0,
            planarConfiguration: 0,
            photometricInterpretation: this.photometricInterpretation || "RGB",
        };

        const options = {
            preScale: { enabled: false },
            decodeConfig: { isJP2: false }
        };

        // IMPORTANT: CWIL 1.4.x JPEG path needs a canvas object
        const decodeCanvas = document.createElement("canvas");

        const decodedFrame = await cornerstoneWADOImageLoader.decodeImageFrame(
            metadata, ts, data, decodeCanvas, options
        );

        if (decodedFrame.photometricInterpretation === 'YBR_FULL') {
            cornerstoneWADOImageLoader.convertYBRFullByPixel(decodedFrame);
        }

        decodedFrame.width = decodedFrame.width || decodedFrame.columns || this.tileWidth;
        decodedFrame.height = decodedFrame.height || decodedFrame.rows || this.tileHeight;
        decodedFrame.samplesPerPixel = decodedFrame.samplesPerPixel || 3;

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
        const url = `${this.baseUrl}/studies/${this.studyUID}/series/${this.seriesUID}/instances/${instanceUID}/rendered`;
        return this._downloadImage(url);
    }

    async _downloadImage(url) {
        const res = await fetch(url, {
            headers: { ...this.ajaxHeaders, Accept: this._acceptHeader(true, false) },
            mode: 'cors', cache: 'no-store'
        });

        if (!res.ok) throw new Error(`Failed to download rendered image (${res.status})`);

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
        // 1) Use dedicated single-frame preview instance if available
        if (this.wsi?.previewInstanceUID) {
            return this._downloadWholeInstanceImage(this.wsi.previewInstanceUID);
        }

        if (this.wsi?.thumbUrl) {
            return this._downloadImage(this.wsi.thumbUrl);
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

        const base = (this.baseUrl || "").replace(/\/+$/, "");
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

        const authToken = this.ajaxHeaders?.Authorization?.replace(/^Bearer\s+/i, "") || null;

        for (const instanceUID of uniq) {
            const metaUrl =
                `${base}/studies/${encodeURIComponent(studyUID)}` +
                `/series/${encodeURIComponent(seriesUID)}` +
                `/instances/${encodeURIComponent(instanceUID)}/metadata`;

            let meta;
            try {
                meta = await DicomQuery.wadoMetadata(metaUrl, authToken); // Accept: application/dicom+json :contentReference[oaicite:2]{index=2}
            } catch (e) {
                console.warn("[ICC] metadata fetch failed", { instanceUID, metaUrl, error: String(e?.message || e) });
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
                const bulkUrl = new URL(bulk, metaUrl).toString();
                const res = await fetch(bulkUrl, {
                    headers: {
                        Accept: "application/octet-stream",
                        ...(this.ajaxHeaders || {}),
                    },
                    mode: "cors",
                    cache: "no-store",
                });

                if (!res.ok) {
                    console.warn("[ICC] bulk fetch failed", { bulkUrl, status: res.status });
                    continue;
                }

                const buf = await res.arrayBuffer();
                this._iccProfileCache = buf;
                return buf;
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