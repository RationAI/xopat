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
        super(options);

        this.baseUrl = options.baseUrl; // keep

        // auth propagation
        this.ajaxHeaders = this.ajaxHeaders || {};
        const user = XOpatUser.instance();
        const secret = user.getSecret();
        if (secret) this.ajaxHeaders["Authorization"] = `Bearer ${secret}`;
        user.addHandler("secret-updated", e => e.type === "jwt" && (this.ajaxHeaders["Authorization"] = `Bearer ${e.secret}`));
        user.addHandler("secret-removed", e => e.type === "jwt" && (this.ajaxHeaders["Authorization"] = null));
        user.addHandler("logout", () => (this.ajaxHeaders["Authorization"] = null));

        // viewer/pyramid state
        this.levels = [];
        this.framesByLevel = [];
        this.instancesSeen = new Set();

        // optional roles
        this.previewInstanceUID = null;   // THUMBNAIL/OVERVIEW single‑frame
        this.macroInstanceUID = null;     // LABEL/MACRO single‑frame

        // general SOPs
        this.WSI_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.77.1.6"; // VL WSI
    }

    supports(data) { return data && data.type === "dicomweb"; }

    /* ------------------------ QIDO/WADO helpers ------------------------ */
    async _qido(path, params = {}) {
        const qs = new URLSearchParams(params);
        const url = `${this.baseUrl}${path}${qs.toString() ? "?" + qs.toString() : ""}`;
        const res = await fetch(url, {
            headers: { Accept: "application/dicom+json", ...this.ajaxHeaders },
            credentials: "omit",
        });
        if (res.status === 204) return [];
        const text = await res.text();
        if (res.status === 404 && /Unknown resource/i.test(text)) throw new Error(`QIDO endpoint missing at ${path}`);
        if (res.status === 404) return [];
        if (!res.ok) throw new Error(`QIDO ${res.status}: ${text}`);
        return text ? JSON.parse(text) : [];
    }

    async _wadoMetadata(studyUID, seriesUID, instanceUID) {
        const url = `${this.baseUrl}/studies/${studyUID}/series/${seriesUID}/instances/${instanceUID}/metadata`;
        const res = await fetch(url, { headers: { Accept: "application/dicom+json", ...this.ajaxHeaders }, credentials: "omit" });
        const text = await res.text();
        let json; try { json = JSON.parse(text); } catch {}
        if (!res.ok || !json) throw new Error(`WADO metadata ${res.status}: ${text}`);
        return json;
    }

    _first(a) { return Array.isArray(a) && a.length ? a[0] : null; }

    _acceptHeader() {
        return this.useRendered
            ? 'multipart/related; type="image/png", multipart/related; type="image/jpeg"'
            : 'multipart/related; type="image/jpeg"; transfer-syntax=1.2.840.10008.1.2.4.50, multipart/related; type="application/octet-stream"; transfer-syntax=*';
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

    async _resolveByPatient() {
        const studies = await this._qido("/studies", { PatientID: this.patientID });
        const study = this._first(studies);
        if (!study) throw new Error(`No studies for PatientID=${this.patientID}`);
        this.studyUID = study["0020000D"].Value[0];
        return this._resolveByStudy();
    }

    async _resolveByStudy() {
        const wsi = await this._qido(`/studies/${this.studyUID}/series`, { SOPClassUID: this.WSI_SOP_CLASS });
        const series = wsi.length ? wsi : await this._qido(`/studies/${this.studyUID}/series`, { Modality: "SM" });
        const s = this._first(series);
        if (!s) throw new Error(`No WSI series in study ${this.studyUID}`);
        this.seriesUID = s["0020000E"].Value[0];
        return this._resolveBySeries();
    }

    async _resolveBySeries() {
        // Pull ALL instances; levels/roles may be split across them.
        const instances = await this._qido(`/studies/${this.studyUID}/series/${this.seriesUID}/instances`);
        if (!instances.length) throw new Error(`No instances in series ${this.seriesUID}`);

        // Iterate and ingest metadata to build pyramid + roles.
        for (const it of instances) {
            const uid = it["00080018"].Value[0];
            try {
                const meta = await this._wadoMetadata(this.studyUID, this.seriesUID, uid);
                this._ingestInstanceMetadata(uid, meta);
            } catch (e) {
                console.warn("Skip instance (metadata error)", uid, e);
            }
        }

        // Validate we have at least one pyramid level
        if (!this.levels.length) throw new Error("No pyramid levels discovered in series (missing Per‑Frame FG or TILED_FULL fallback)");

        this.minLevel = 0;
        this.maxLevel = this.levels.length - 1;

        // width/height/tile size — take from best available (first owner that provided them)
        const topLevel = this.levels[0];
        this.width  = topLevel.width;
        this.height = topLevel.height;
        // Tile sizes: prefer those from an instance that provided this level
        this.tileWidth  = this.tileWidth  || topLevel.tileWidth  || 512;
        this.tileHeight = this.tileHeight || topLevel.tileHeight || 512;
    }

    async _resolveTarget() {
        if (this.seriesUID && this.studyUID) return this._resolveBySeries();
        if (this.studyUID && !this.seriesUID) return this._resolveByStudy();
        if (this.patientID) return this._resolveByPatient();
        throw new Error("No access path provided. Supply one of: patientID | studyUID | (studyUID+seriesUID) | instanceUID.");
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
        await this._resolveTarget();
        // build pyramid downsacle info
        if (!this.levels.length) {
            throw new Error('No levels were found!');
        }
    }

    configure() { }

    /* -------------------------- Metadata -> Pyramid -------------------------- */
    _iv(v) { if (v == null) return undefined; const x = Array.isArray(v) ? v[0] : v; return typeof x === "string" ? parseInt(x, 10) : (x|0); }
    _fv(v) { if (v == null) return undefined; const x = Array.isArray(v) ? v[0] : v; return typeof x === "string" ? parseFloat(x) : +x; }

    _ingestInstanceMetadata(instanceUID, metadata) {
        const attrs = metadata[0] || {};
        const numberOfFrames = this._iv(attrs["00280008"]?.Value);

        // Heuristics for role detection (single frame, specialized ImageType)
        const imageType = (attrs["00080008"]?.Value || []).map(x => x.toUpperCase());
        const isSingleFrame = (numberOfFrames || 1) === 1;
        if (isSingleFrame && imageType.length) {
            const tag = imageType.join("\\");
            if (!this.previewInstanceUID && /OVERVIEW|THUMBNAIL/.test(tag)) this.previewInstanceUID = instanceUID;
            if (!this.macroInstanceUID && /LABEL|MACRO/.test(tag)) this.macroInstanceUID = instanceUID;
        }

        // Try to read pyramid definition
        const totalWidth  = this._iv(attrs["00480006"]?.Value);
        const totalHeight = this._iv(attrs["00480007"]?.Value);
        const tileWidth   = this._iv(attrs["00280011"]?.Value);
        const tileHeight  = this._iv(attrs["00280010"]?.Value);

        const perFrameFG = attrs["52009230"]?.Value || null; // Per‑Frame Functional Groups

        let spacingArr = attrs["00280030"]?.Value;
        if (!spacingArr) {
            // Enhanced/WSI: Shared Functional Groups -> Pixel Measures -> PixelSpacing
            const sfg = attrs["52009229"]?.Value?.[0];
            const pms = sfg?.["00289110"]?.Value?.[0];
            spacingArr = pms?.["00280030"]?.Value;                 // PixelSpacing
        }

        if (perFrameFG && numberOfFrames) {
            for (let frameIndex = 0; frameIndex < numberOfFrames; frameIndex++) {
                const fg = perFrameFG[frameIndex];
                const planePos      = fg["0048021A"]?.Value?.[0]; // PlanePositionSlideSequence
                if (!planePos) continue;
                const pixelMeasures = fg["00289110"]?.Value?.[0]; // PixelMeasuresSequence
                let measures = pixelMeasures?.["00280030"]?.Value || spacingArr;
                if (!measures) {
                    console.warn("No pixel measures found for frame", frameIndex);
                    const pixelSpacing = this._fv(attrs["00181164"]?.Value);  // or ImagerPixelSpacing at worst
                    measures = [pixelSpacing, pixelSpacing];
                }

                let levelIdx = this._ensureLevelByDims(totalWidth, totalHeight, tileWidth, tileHeight);

                // Map tile (x,y) -> { frameNumber, instanceUID }
                const row = this._iv(fg["0048021E"]?.Value) || this._iv(planePos["0048021E"]?.Value);
                const col = this._iv(fg["0048021F"]?.Value) || this._iv(planePos["0048021F"]?.Value);
                const tileX = Math.floor((col ?? 0) / (tileWidth || 1));
                const tileY = Math.floor((row ?? 0) / (tileHeight || 1));
                if (!this.framesByLevel[levelIdx]) this.framesByLevel[levelIdx] = {};
                this.framesByLevel[levelIdx][`${tileX}_${tileY}`] = { frameNumber: frameIndex + 1, instanceUID, micronsX: measures[0], micronsY: measures[1] };
            }

            // remember tile sizes if not set yet
            this.tileWidth  = this.tileWidth  || tileWidth;
            this.tileHeight = this.tileHeight || tileHeight;
            this.instancesSeen.add(instanceUID);
            return;
        }

        // Fallback: a single‑resolution tiled instance without per‑frame FG (row‑major)
        if (totalWidth && totalHeight && tileWidth && tileHeight && numberOfFrames > 1) {
            const levelIdx = this._ensureLevelByDims(totalWidth, totalHeight, tileWidth, tileHeight);

            const tilesX = Math.ceil(totalWidth / tileWidth);
            const tilesY = Math.ceil(totalHeight / tileHeight);
            if (tilesX * tilesY === numberOfFrames) {
                const map = (this.framesByLevel[levelIdx] = this.framesByLevel[levelIdx] || {});
                for (let y = 0; y < tilesY; y++) for (let x = 0; x < tilesX; x++) {
                    const frameNumber = y * tilesX + x + 1;
                    map[`${x}_${y}`] = { frameNumber, instanceUID };
                }
                this.tileWidth  = this.tileWidth  || tileWidth;
                this.tileHeight = this.tileHeight || tileHeight;
                this.instancesSeen.add(instanceUID);
            }
        }
    }

    _dimsEqual(w1, h1, w2, h2) {
        return Math.abs(w1 - w2) <= 1 && Math.abs(h1 - h2) <= 1; // tolerate off-by-one
    }

    _ensureLevelByDims(totalWidth, totalHeight, tileWidth, tileHeight) {
        // 0) Reuse existing level if same dimensions
        for (let i = 0; i < this.levels.length; i++) {
            const L = this.levels[i];
            if (L.width != null && L.height != null &&
                this._dimsEqual(L.width, L.height, totalWidth, totalHeight)) {
                if (L.tileWidth == null && tileWidth != null)  L.tileWidth  = tileWidth;
                if (L.tileHeight == null && tileHeight != null) L.tileHeight = tileHeight;
                return i;
            }
        }

        let insertIdx = this.levels.length;
        for (let i = 0; i < this.levels.length; i++) {
            const L = this.levels[i];
            if (L.width != null && L.height != null) {
                if (totalWidth > L.width) { insertIdx = i; break; } // bigger => more detailed => earlier
            } else {
                // If existing level lacks dims, put known-dim level ahead of it
                insertIdx = i; break;
            }
        }

        const newLevel = {
            width: totalWidth ?? null,
            height: totalHeight ?? null,
            tileWidth: tileWidth ?? null,
            tileHeight: tileHeight ?? null,
        };

        this.levels.splice(insertIdx, 0, newLevel);
        this.framesByLevel.splice(insertIdx, 0, {});
        return insertIdx;
    }

    getMetadata() {
        // todo if error return error data
        return {
            imageInfo: {
                studyUID: this.studyUID,
                seriesUID: this.seriesUID,
                previewInstanceUID: this.previewInstanceUID,
                macroInstanceUID: this.macroInstanceUID,
                levels: this.levels,
                tileWidth: this.tileWidth,
                tileHeight: this.tileHeight,
                micronsX: this.framesByLevel[0].micronsX,
                micronsY: this.framesByLevel[0].micronsY,
            },
            patientInfo: this.patientDetails
        }
    }

    /* ------------------------------ OSD hooks ------------------------------ */
    getLevelScale(level) {
        level = this.maxLevel-level;
        const levels = this.levels;
        return levels[level].width / levels[0].width;
    }

    getTileUrl(level, x, y) {
        const rec = this.framesByLevel[this.maxLevel - level]?.[`${x}_${y}`];
        if (!rec) return null;
        const { frameNumber, instanceUID } = rec;
        const tail = this.useRendered ? `frames/${frameNumber}/rendered` : `frames/${frameNumber}`;
        return `${this.baseUrl}/studies/${this.studyUID}/series/${this.seriesUID}/instances/${instanceUID}/${tail}`;
    }

    async _getTile(context) {
        const res = await fetch(context.src, {
            headers: { ...this.ajaxHeaders, 'Accept': this._acceptHeader() },
            mode: 'cors', cache: 'no-store',
        });

        if (!res.ok) return context.fail("Failed to fetch DICOM frame.", res);

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
        const res = await fetch(url, { headers: { ...this.ajaxHeaders, 'Accept': this._acceptHeader() }, mode: 'cors', cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to download rendered image (${res.status})`);

        const parts = await this.parseMultipartRelated(res);
        if (!parts.length) throw new Error("Rendered response missing");
        const { headers, bytes } = parts[0];
        const type = (headers['content-type'] || '').toLowerCase();
        const mime = type.includes('image/png') ? 'image/png' : (type.includes('image/jpeg') ? 'image/jpeg' : 'application/octet-stream');
        return new Blob([bytes], { type: mime });
    }

    /** Download preview/overview (thumbnail) image as a Blob (PNG or JPEG). */
    async downloadPreviewImage() { return this._downloadWholeInstanceImage(this.previewInstanceUID); }

    /** Download label/macro image as a Blob (PNG or JPEG). */
    async downloadMacroImage() { return this._downloadWholeInstanceImage(this.macroInstanceUID); }
}