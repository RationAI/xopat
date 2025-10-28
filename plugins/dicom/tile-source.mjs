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
    }

    supports(data) { return data && data.type === "dicomweb"; }

    // _acceptHeader() {
    //     // todo support more transfer syntaxes...
    //     return this.useRendered
    //         ? 'multipart/related; type="image/png", multipart/related; type="image/jpeg"'
    //         : 'multipart/related; type="image/jpeg"; transfer-syntax=1.2.840.10008.1.2.4.50, multipart/related; type="application/octet-stream"; transfer-syntax=*';
    // }

    _acceptHeader(useRendered = this.useRendered, preferPng = false) {
        if (useRendered) {
            // Rendered: NEVER add transfer-syntax here.
            // Prefer JPEG (smaller/faster) with PNG as fallback, or flip with preferPng=true.
            return preferPng
                ? 'image/png, image/jpeg'
                : 'image/jpeg, image/png';
        }

        // Native (non-rendered): request bulk pixel data with TS wildcard.
        // (Server may respond multipart/related; type="application/octet-stream")
        return 'multipart/related; type="application/octet-stream"; transfer-syntax=*';
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
            const bodyBytes = data.subarray(bodyStart, partEnd);

            const headerText = dec.decode(headerBytes);
            const headers = {};
            headerText.split('\r\n').forEach(line => { const i = line.indexOf(':'); if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); });

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
                this.raiseEvent("open-failed", { message: e, source: url, postData: null });
            });
    }

    async _initializeFromServer() {
        if (!this.seriesUID || !this.studyUID) {
            throw new Error('DICOM TileSource needs seriesUID and studyUID to be set before initialization!');
        }

        // if not provided, fetch
        this.wsi = await DicomQuery.findWSIItems(this.baseUrl, this.ajaxHeaders["Authorization"], this.studyUID, this.seriesUID);
        this.wsi = this.wsi[0]; // parses series for potential wsi set, take first found

        // Validate we have at least one pyramid level
        if (!this.wsi?.levels.length) throw new Error("No pyramid levels discovered in series (missing Per‑Frame FG or TILED_FULL fallback)");

        this.minLevel = 0;
        this.maxLevel = this.wsi.levels.length - 1;

        // width/height/tile size — take from best available (first owner that provided them)
        const topLevel = this.wsi.levels[0];
        this.width  = topLevel.width;
        this.height = topLevel.height;
        // Tile sizes: prefer those from an instance that provided this level
        this.tileWidth  = this.tileWidth  || topLevel.tileWidth  || 512;
        this.tileHeight = this.tileHeight || topLevel.tileHeight || 512;

        // build pyramid downsacle info
        if (!this.wsi.levels.length) {
            throw new Error('No levels were found!');
        }
    }

    configure() { }

    /* -------------------------- Metadata -> Pyramid -------------------------- */
    getMetadata() {
        // todo if error return error data
        // {
        //   error: ....
        //  }
        return {
            imageInfo: {
                studyUID: this.studyUID,
                seriesUID: this.seriesUID,
                previewInstanceUID: this.previewInstanceUID,
                macroInstanceUID: this.macroInstanceUID,
                levels: this.wsi.levels,
                tileWidth: this.tileWidth,
                tileHeight: this.tileHeight,
                micronsX: this.wsi.levels[0].micronsX,
                micronsY: this.wsi.levels[0].micronsY,
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
        const frame = level?.frames[`${x}_${y}`];
        const tail = this.useRendered ? `frames/${frame}/rendered` : `frames/${frame}`;
        return `${this.baseUrl}/studies/${this.studyUID}/series/${this.seriesUID}/instances/${level.instanceUID}/${tail}`;
    }

    async _getTile(context) {
        const res = await fetch(context.src, {
            headers: { ...this.ajaxHeaders, 'Accept': this._acceptHeader() },
            mode: 'cors', cache: 'no-store',
        });

        if (!res.ok) return context.fail("Failed to fetch DICOM frame.", res);

        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.startsWith('image/jpeg') || ct.startsWith('image/png')) {
            const blob = await res.blob();
            return context.finish(blob, res, "rasterBlob");
        }

        const parts = await this.parseMultipartRelated(res);
        if (!parts.length) return context.fail("DICOM response carries no frames!", res);
        const { headers, bytes } = parts[0];
        const type = (headers['content-type'] || '').toLowerCase() || 'application/octet-stream';
        if (parts.length > 2) console.warn("DICOM response carries multiple frames!", res);

        if (type.includes('image/png'))  return context.finish(new Blob([bytes], { type: 'image/png'  }), res, "rasterBlob");
        if (type.includes('image/jpeg')) return context.finish(new Blob([bytes], { type: 'image/jpeg' }), res, "rasterBlob");

        return context.fail("DICOM tile format unsupported.", res);
    }

    downloadTileStart(context) { this._getTile(context); }

    /* ------------------------- Preview/Macro fetch ------------------------- */
    async _downloadWholeInstanceImage(instanceUID) {
        if (!instanceUID) throw new Error("No instance selected");
        const url = `${this.baseUrl}/studies/${this.studyUID}/series/${this.seriesUID}/instances/${instanceUID}/rendered`;

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
    async getThumbnail() { return this._downloadWholeInstanceImage(this.wsi.previewInstanceUID); }

    /** Download label/macro image as a Blob (PNG or JPEG). */
    async downloadMacroImage() { return this._downloadWholeInstanceImage(this.wsi.macroInstanceUID); }
}