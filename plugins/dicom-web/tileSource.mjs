// tileSource.mjs — robust DICOMweb TileSource for xOpat/OSD
// - Works with Google Cloud Healthcare, Orthanc (DICOMweb), etc.
// - Discovery paths: patientID | studyUID | seriesUID | instanceUID
// - Prefers instances that contain Per-Frame Functional Groups (5200,9230)
// - Fallback for single-resolution TILED_FULL without per-frame FG (row-major map)
// - Forwards Authorization: Bearer ... from XOpatUser (both 'jwt' and 'bearer' events)

export class DICOMWebTileSource extends OpenSeadragon.TileSource {
    constructor(options) {
        // Make OSD call getImageInfo
        options.url = options.baseUrl || "localhost";
        options.baseUrl = options.baseUrl?.replace(/\/+$/, "");
        super(options);

        this.baseUrl = options.baseUrl; // IMPORTANT: store

        // network/auth
        this.ajaxHeaders = this.ajaxHeaders || {};
        const user = XOpatUser.instance();
        const secret = user.getSecret();
        if (secret) this.ajaxHeaders["Authorization"] = secret;
        user.addHandler("secret-updated", e => e.type === "jwt" && (this.ajaxHeaders["Authorization"] = e.secret));
        user.addHandler("secret-removed", e => e.type === "jwt" && (this.ajaxHeaders["Authorization"] = null));
        user.addHandler("logout", () => (this.ajaxHeaders["Authorization"] = null));

        // viewer/pyramid state
        this.levels = []; // [{downsample,width,height,spacing?}]
        this.framesByLevel = {}; // levelIndex -> {"x_y": frameNumber}
        this.tileOverlap = 0;

        // constants
        this.WSI_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.77.1.6"; // VL WSI
    }

    supports(data) {
        return data && data.type === "dicomweb";
    }

    /* ------------------------ QIDO/WADO helpers ------------------------ */
    async _qido(path, params = {}) {
        const qs = new URLSearchParams(params);
        const url = `${this.baseUrl}${path}${qs.toString() ? "?" + qs.toString() : ""}`;
        const res = await fetch(url, {
            headers: { Accept: "application/dicom+json", ...this.ajaxHeaders },
            // never send cookies to Google APIs
            credentials: "omit",
        });
        if (res.status === 204) return [];
        const text = await res.text();
        if (res.status === 404 && /Unknown resource/i.test(text)) {
            throw new Error(`QIDO endpoint missing at ${path}`);
        }
        if (res.status === 404) return [];
        if (!res.ok) throw new Error(`QIDO ${res.status}: ${text}`);
        return text ? JSON.parse(text) : [];
    }

    async _wadoMetadata(studyUID, seriesUID, instanceUID) {
        const url = `${this.baseUrl}/studies/${studyUID}/series/${seriesUID}/instances/${instanceUID}/metadata`;
        const res = await fetch(url, {
            headers: { Accept: "application/dicom+json", ...this.ajaxHeaders },
            credentials: "omit",
        });
        const text = await res.text();
        let json; try { json = JSON.parse(text); } catch {}
        if (!res.ok || !json) throw new Error(`WADO metadata ${res.status}: ${text}`);
        return json;
    }

    _first(a) { return Array.isArray(a) && a.length ? a[0] : null; }

    _acceptHeader() {
        // Prefer lossless PNG from /rendered; otherwise ask for JPEG directly from /frames
        return this.useRendered ? 'multipart/related; type="image/png", multipart/related; type="image/jpeg"'
            : 'multipart/related; type="image/jpeg"; transfer-syntax=1.2.840.10008.1.2.4.50, multipart/related; type="application/octet-stream"; transfer-syntax=*';
    }

    async _readMultipart(res) {
        // todo worker?
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        const m = ct.match(/boundary="?([^";]+)"?/);
        if (!m) throw new Error('multipart response missing boundary');
        const boundary = '--' + m[1];

        // Read as text once to split parts; then base64 decode the part if needed
        // (For binary-safe, you could stream; for single-tile responses this is fine.)
        const raw = await res.arrayBuffer();
        const txt = new TextDecoder('utf-8').decode(raw);

        const sections = txt.split(boundary).filter(s => s.trim() && !s.includes('--\r\n--'));
        // take the first part
        const headBody = sections[0];
        const [rawHeaders, rawBody] = headBody.split(/\r\n\r\n/);
        const headers = {};
        rawHeaders.split(/\r\n/).forEach(h => {
            const i = h.indexOf(':');
            if (i>0) headers[h.slice(0,i).trim().toLowerCase()] = h.slice(i+1).trim();
        });
        const partType = (headers['content-type'] || '').toLowerCase();

        // Body ends with CRLF; it is raw bytes (not base64) per WADO-RS
        // Re-extract bytes from the original buffer to avoid re-encoding issues:
        // Find start offset of rawBody within txt and map to raw
        const pre = txt.split(rawBody)[0];
        const startBytes = new TextEncoder().encode(pre).length;
        const bodyBytes  = new TextEncoder().encode(rawBody).length;
        const bytes = new Uint8Array(raw, startBytes, bodyBytes);

        return { contentType: partType, bytes };
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

        // RFC 2387 style delimiters
        const bStart = enc.encode(`--${boundary}\r\n`);
        const bMid   = enc.encode(`\r\n--${boundary}\r\n`);
        const bEnd   = enc.encode(`\r\n--${boundary}--`);

        // Find first start
        let start = this.indexOfBytes(data, bStart, 0);
        if (start < 0) throw new Error('boundary start not found');

        const parts = [];
        while (true) {
            // Find next boundary (either mid or end)
            const nextMid = this.indexOfBytes(data, bMid, start + bStart.length);
            const nextEnd = this.indexOfBytes(data, bEnd, start + bStart.length);
            const next = (nextMid >= 0 && (nextMid < nextEnd || nextEnd < 0)) ? nextMid : nextEnd;

            const partStart = start + bStart.length;
            const partEnd = next >= 0 ? next : data.length; // in case server omits trailing CRLF

            // Split headers/body at first CRLFCRLF within this part
            const hdrSep = enc.encode('\r\n\r\n');
            const headersEnd = this.indexOfBytes(data, hdrSep, partStart);
            if (headersEnd < 0 || headersEnd > partEnd) throw new Error('header/body separator not found');

            const headerBytes = data.subarray(partStart, headersEnd);
            const bodyStart = headersEnd + hdrSep.length;
            const bodyBytes = data.subarray(bodyStart, partEnd); // <-- raw body (no text roundtrip)

            // Parse headers as text
            const headerText = dec.decode(headerBytes);
            const headers = {};
            headerText.split('\r\n').forEach(line => {
                const i = line.indexOf(':');
                if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
            });

            parts.push({ headers, bytes: bodyBytes });

            if (next === nextEnd || next < 0) break; // reached final boundary
            start = next; // continue to next part (note: next already points at \r\n--boundary\r\n)
        }

        return parts;
    }

    _looksJPEG(u8) {
        return u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xD8; // SOI
    }
    _looksPNG(u8) {
        return u8.length >= 8 &&
            u8[0]==0x89 && u8[1]==0x50 && u8[2]==0x4E && u8[3]==0x47 &&
            u8[4]==0x0D && u8[5]==0x0A && u8[6]==0x1A && u8[7]==0x0A;
    }
    _looksJ2K(u8) {
        // JP2 signature box or raw codestream magic
        const isJP2 = u8.length >= 12 &&
            u8[0]==0x00 && u8[1]==0x00 && u8[2]==0x00 && u8[3]==0x0C &&
            u8[4]==0x6A && u8[5]==0x50 && u8[6]==0x20 && u8[7]==0x20 &&
            u8[8]==0x0D && u8[9]==0x0A && u8[10]==0x87 && u8[11]==0x0A;
        const isJ2C = u8.length >= 4 && u8[0]==0xFF && u8[1]==0x4F && u8[2]==0xFF && u8[3]==0x51;
        return isJP2 || isJ2C;
    }

    async decodeJ2KToImageBitmap(u8 /*, opts */) {
        // TODO: call your WASM decoder here and return ImageBitmap
        throw new Error('decodeJ2KToImageBitmap() not implemented yet');
    }

    async _resolveByPatient() {
        const studies = await this._qido("/studies", { PatientID: this.patientID });
        const study = this._first(studies);
        if (!study) throw new Error(`No studies for PatientID=${this.patientID}`);
        this.studyUID = study["0020000D"].Value[0];
        return this._resolveByStudy();
    }

    async _resolveByStudy() {
        // Prefer VL WSI in the study; fallback to Modality=SM
        const wsi = await this._qido(`/studies/${this.studyUID}/series`, { SOPClassUID: this.WSI_SOP_CLASS });
        const series = wsi.length ? wsi : await this._qido(`/studies/${this.studyUID}/series`, { Modality: "SM" });
        const s = this._first(series);
        if (!s) throw new Error(`No WSI series in study ${this.studyUID}`);
        this.seriesUID = s["0020000E"].Value[0];
        return this._resolveBySeries();
    }

    async _resolveBySeries() {
        // Try to pick an instance with Per-Frame FG; otherwise first instance
        let instances = await this._qido(
            `/studies/${this.studyUID}/series/${this.seriesUID}/instances`
        );
        if (!instances.length) throw new Error(`No instances in series ${this.seriesUID}`);

        // Probe (at most) first few for 5200,9230 to find a pyramid
        const probeCount = Math.min(5, instances.length);
        for (let k = 0; k < probeCount; k++) {
            const uid = instances[k]["00080018"].Value[0];
            const meta = await this._wadoMetadata(this.studyUID, this.seriesUID, uid);
            if (meta?.[0]?.["52009230"]) { // Per-Frame Functional Groups present
                this.instanceUID = uid;
                return { studyUID: this.studyUID, seriesUID: this.seriesUID, instanceUID: this.instanceUID };
            }
        }
        // else: accept the first; we'll TILED_FULL-fallback
        this.instanceUID = instances[0]["00080018"].Value[0];
        return { studyUID: this.studyUID, seriesUID: this.seriesUID, instanceUID: this.instanceUID };
    }

    async _resolveByInstanceUID() {
        if (this.studyUID && this.seriesUID) {
            return { studyUID: this.studyUID, seriesUID: this.seriesUID, instanceUID: this.instanceUID };
        }
        const inst = await this._qido("/instances", { SOPInstanceUID: this.instanceUID });
        const i = this._first(inst);
        if (!i) throw new Error(`Instance not found by QIDO: ${this.instanceUID}`);
        this.studyUID = i["0020000D"].Value[0];
        this.seriesUID = i["0020000E"].Value[0];
        return { studyUID: this.studyUID, seriesUID: this.seriesUID, instanceUID: this.instanceUID };
    }

    async _resolveTarget() {
        if (this.instanceUID && this.seriesUID && this.studyUID) return;
        if (this.instanceUID && (!this.seriesUID || !this.studyUID)) return this._resolveByInstanceUID();
        if (this.seriesUID && !this.instanceUID) {
            if (!this.studyUID) throw new Error("seriesUID provided but studyUID missing");
            return this._resolveBySeries();
        }
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
        const meta = await this._wadoMetadata(this.studyUID, this.seriesUID, this.instanceUID);
        this._configureFromDICOM(meta);
    }

    configure() { /* OSD legacy hook — no-op; we configure from metadata */ }

    /* -------------------------- Metadata -> Pyramid -------------------------- */
    _iv(v) { // extract int from JSON VR Value or string
        if (v == null) return undefined;
        const x = Array.isArray(v) ? v[0] : v;
        return typeof x === "string" ? parseInt(x, 10) : (x|0);
    }

    _fv(v) { // extract float
        if (v == null) return undefined;
        const x = Array.isArray(v) ? v[0] : v;
        return typeof x === "string" ? parseFloat(x) : +x;
    }

    _configureFromDICOM(metadata) {
        const attrs = metadata[0];

        const totalWidth  = this._iv(attrs["00480006"]?.Value); // TotalPixelMatrixColumns
        const totalHeight = this._iv(attrs["00480007"]?.Value); // TotalPixelMatrixRows
        const numberOfFrames = this._iv(attrs["00280008"]?.Value);

        const tileWidth  = this._iv(attrs["00280011"]?.Value); // Columns (tile width)
        const tileHeight = this._iv(attrs["00280010"]?.Value); // Rows (tile height)

        const perFrameFG = attrs["52009230"]?.Value || null; // Per-Frame Functional Groups

        this.levels = [];
        this.framesByLevel = {};

        if (perFrameFG && perFrameFG.length === numberOfFrames) {
            // ---- Multi-level pyramid path ----
            const levelIndexByDownsample = new Map();

            for (let frameIndex = 0; frameIndex < numberOfFrames; frameIndex++) {
                const fg = perFrameFG[frameIndex];
                const pixelMeasures = fg["00289110"]?.Value?.[0]; // PixelMeasuresSequence
                const planePos      = fg["0048021A"]?.Value?.[0]; // PlanePositionSlideSequence
                if (!pixelMeasures || !planePos) continue;

                const spacingArr = pixelMeasures["00280030"].Value; // [rowSpacing, colSpacing]
                const rowSpacing = parseFloat(spacingArr[0]);
                const colSpacing = parseFloat(spacingArr[1]);
                const ds = colSpacing || 1; // isotropic typical

                let levelIdx;
                if (levelIndexByDownsample.has(ds)) {
                    levelIdx = levelIndexByDownsample.get(ds);
                } else {
                    levelIdx = this.levels.length;
                    levelIndexByDownsample.set(ds, levelIdx);
                    this.levels.push({
                        downsample: ds,
                        width: Math.max(1, Math.round(totalWidth / ds)),
                        height: Math.max(1, Math.round(totalHeight / ds)),
                        spacing: spacingArr,
                    });
                    this.framesByLevel[levelIdx] = {};
                }

                const row = this._iv(fg["0048021E"]?.Value) || this._iv(planePos["0048021E"]?.Value);
                const col = this._iv(fg["0048021F"]?.Value) || this._iv(planePos["0048021F"]?.Value);
                const tileX = Math.floor((col ?? 0) / tileWidth);
                const tileY = Math.floor((row ?? 0) / tileHeight);
                this.framesByLevel[levelIdx][`${tileX}_${tileY}`] = frameIndex + 1; // 1-based
            }

            // sort by downsample ascending (0 == highest-res)
            this.levels.sort((a, b) => a.downsample - b.downsample);
            // normalize indices
            const remap = {};
            this.levels.forEach((_, idx) => (remap[idx] = idx));

            this.minLevel = 0;
            this.maxLevel = this.levels.length - 1;
        } else {
            // ---- Fallback: single-resolution TILED_FULL (row-major mapping) ----
            const tilesX = Math.ceil(totalWidth / tileWidth);
            const tilesY = Math.ceil(totalHeight / tileHeight);
            if (tilesX * tilesY !== numberOfFrames) {
                throw new Error("TILED_FULL fallback: tile grid mismatch with NumberOfFrames");
            }
            this.levels = [{ downsample: 1, width: totalWidth, height: totalHeight }];
            const map = (this.framesByLevel[0] = {});
            for (let y = 0; y < tilesY; y++) {
                for (let x = 0; x < tilesX; x++) {
                    const frameNumber = y * tilesX + x + 1; // 1-based
                    map[`${x}_${y}`] = frameNumber;
                }
            }
            this.minLevel = 0;
            this.maxLevel = 0;
        }

        // OSD core fields
        this.width = totalWidth;
        this.height = totalHeight;
        this.tileWidth = tileWidth;
        this.tileHeight = tileHeight;
    }

    getLevelScale(level) {
        const ds = this.levels[level]?.downsample || 1;
        return 1 / ds; // scale relative to max resolution
    }

    getTileUrl(level, x, y) {
        const frameNumber = this.framesByLevel[level]?.[`${x}_${y}`];
        if (!frameNumber) return null; // todo some event support?
        const tail = this.useRendered ? `frames/${frameNumber}/rendered` : `frames/${frameNumber}`;
        // this.instanceUID
        return `${this.baseUrl}/studies/${this.studyUID}/series/${this.seriesUID}/instances/${this.instanceUID}/${tail}`;
    }

    async _getTile(context) {
        const res = await fetch(context.src, {
            headers: {
                ...this.ajaxHeaders,
                'Accept': this._acceptHeader(),
            },
            mode: 'cors',
            cache: 'no-store',
        });

        if (!res.ok) {
            // Todo consider
            // if (useRendered) {
            //     console.warn(...)
            //     return await fetchFrameBitmap({baseUrl, studyUID, seriesUID, sop, frameNo, headers, useRendered: false});
            // }
            return context.fail("Failed to fetch dicom frame.", res);
        }

        const parts = await this.parseMultipartRelated(res);
        if (!parts.length) {
            return context.fail("DICOM Response carries no frames!.", res);
        }
        const { headers, bytes } = parts[0];              // bytes is a Uint8Array
        const type = (headers['content-type'] || '').toLowerCase() || 'application/octet-stream';
        if (parts.length > 2) {
            console.warn("DICOM Response carries multiple frames!.", res);
        }


        if (type.includes('image/png')) {
            return context.finish(new Blob([bytes], { type: 'image/png' }), res, "rasterBlob");
        }
        if (type.includes('image/jpeg')) {
            return context.finish(new Blob([bytes], { type: 'image/jpeg' }), res, "rasterBlob");
        }

        // octet-stream: sniff magic to decide PNG/JPEG vs J2K, then WASM if needed
        return context.fail("DICOM Response unsupported format!.", res);


        // let u8 ;
        // let ctype;
        //
        // const topType = (res.headers.get('content-type') || '').toLowerCase();
        // if (topType.startsWith('multipart/related')) {
        //     const part = await this._readMultipart(res);
        //     u8 = part.bytes; ctype = part.contentType;
        // } else {
        //     const buf = await res.arrayBuffer();
        //     u8  = new Uint8Array(buf);
        //     ctype = topType;
        // }
        //
        // // Browser-friendly cases
        // if (this._looksPNG(u8) || ctype.includes('image/png')) {
        //     return await createImageBitmap(new Blob([u8], { type: 'image/png' }));
        // }
        // if (this._looksJPEG(u8) || ctype.includes('image/jpeg')) {
        //     context.finish(blb, request, "rasterBlob");
        //     return await createImageBitmap(new Blob([u8], { type: 'image/jpeg' }));
        // }
        //
        // // If we got JP2/J2C (or octet-stream), try WASM
        // if (this._looksJ2K(u8) || ctype.includes('image/jp2') || ctype.includes('image/j2k') || ctype.includes('application/octet-stream')) {
        //     return await this.decodeJ2KToImageBitmap(u8);
        // }
        //
        // // Last resort: try to hand to the browser as-is (may still fail)
        // try {
        //     return await createImageBitmap(new Blob([u8], { type: ctype || 'application/octet-stream' }));
        // } catch (e) {
        //     // todo consider
        //     // if (!useRendered) {
        //     //     console.warn(...)
        //     //     return await this._getTile(context);
        //     // }
        //     return context.fail(`Unsupported tile content-type "${ctype}" and magic bytes not recognized.`, res);
        // }
    }

    downloadTileStart(context) {
        // context.ajaxWithCredentials = false; // important for Google APIs
        // context.ajaxHeaders = context.ajaxHeaders || {};
        // if (this.ajaxHeaders?.Authorization) {
        //     context.ajaxHeaders.Authorization = this.ajaxHeaders.Authorization;
        // }
        // if (!context.ajaxHeaders.Accept) {
        //     context.ajaxHeaders.Accept = "image/jpeg, image/png;q=0.9,*/*;q=0.8";
        // }
        this._getTile(context);
    }
}
