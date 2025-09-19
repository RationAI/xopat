// tileSource.mjs
// DICOMweb TileSource with flexible discovery (PatientID optional)

export class DICOMWebTileSource extends OpenSeadragon.TileSource {
    // todo re-design OSD tilesource init flow
    constructor(options) {
        options.url = options.baseUrl || "localhost"; // hack, this makes OSD fire getImageInfo
        options.baseUrl = options.baseUrl?.replace(/\/+$/, "");
        super(options);

        this.ajaxHeaders = this.ajaxHeaders || {};

        // Hook into xOpat user handling (JWT/Bearer)
        const user = XOpatUser.instance();
        const secret = user.getSecret();
        if (secret) this.ajaxHeaders["Authorization"] = secret;
        user.addHandler("secret-updated", e => e.type === "jwt" && (this.ajaxHeaders["Authorization"] = e.secret));
        user.addHandler("secret-removed", e => e.type === "jwt" && (this.ajaxHeaders["Authorization"] = null));
        user.addHandler("logout", () => (this.ajaxHeaders["Authorization"] = null));

        // Pyramid info
        this.levels = [];
        this.framesByLevel = {}; // {level: { "x_y": frameNumber }}
        this.tileOverlap = 0;

        // constant SOP Class for VL Whole Slide Microscopy Image
        this.WSI_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.77.1.6";
    }

    // keep “supports” minimal; we initialize by passing {type:"dicomweb", ...}
    supports(data, url) {
        return data && data.type === "dicomweb";
    }

    /* ------------------------ Discovery helpers (QIDO-RS) ------------------------ */

    async _qido(path, params = {}) {
        const qs = new URLSearchParams(params);
        const url = `${this.baseUrl}${path}${qs.toString() ? "?" + qs : ""}`;
        const res = await fetch(url, { headers: { Accept: "application/dicom+json", ...this.ajaxHeaders } });
        if (res.status === 204) return []; // no matches
        const text = await res.text();
        if (res.status === 404 && /Unknown resource/i.test(text)) {
            throw new Error(`QIDO endpoint missing at ${path} (EnableQido? wrong Root?)`);
        }
        if (res.status === 404) return []; // no matches
        if (!res.ok) throw new Error(`QIDO failed: ${res.status} ${text}`);
        return text ? JSON.parse(text) : [];
    }

    _wadoMetadata(studyUID, seriesUID, instanceUID) {
        const url = `${this.baseUrl}/studies/${studyUID}/series/${seriesUID}/instances/${instanceUID}/metadata`;
        return fetch(url, { headers: this.ajaxHeaders }).then(async (res) => {
            const text = await res.text();
            let json; try { json = JSON.parse(text); } catch { /* ignore */ }
            if (!res.ok || !json) throw new Error(`WADO metadata failed: ${res.status} ${text}`);
            return json;
        });
    }

    // choose first item; override if you want smarter strategies
    _first(arr) { return Array.isArray(arr) && arr.length ? arr[0] : null; }

    async _resolveByPatient() {
        // 1) Studies for patient
        const studies = await this._qido("/studies", { PatientID: this.patientID });
        const study = this._first(studies);
        if (!study) throw new Error(`No studies for PatientID=${this.patientID}`);
        this.studyUID = study["0020000D"].Value[0]; // StudyInstanceUID

        return this._resolveByStudy();
    }

    async _resolveByStudy() {
        // 2) Series in study — prefer WSI SOP class or Modality=SM
        const series = await this._qido(`/studies/${this.studyUID}/series`, {
            SOPClassUID: this.WSI_SOP_CLASS
        }).then(s => s.length ? s : this._qido(`/studies/${this.studyUID}/series`, { Modality: "SM" }));
        const s = this._first(series);
        if (!s) throw new Error(`No WSI series in study ${this.studyUID}`);
        this.seriesUID = s["0020000E"].Value[0]; // SeriesInstanceUID

        return this._resolveBySeries();
    }

    async _resolveBySeries() {
        // 3) Instances in series — pick the first (WSI is typically single-instance)
        const instances = await this._qido(`/studies/${this.studyUID}/series/${this.seriesUID}/instances`, {
            SOPClassUID: this.WSI_SOP_CLASS
        }).then(r => r.length ? r : this._qido(`/studies/${this.studyUID}/series/${this.seriesUID}/instances`, {}));

        const i = this._first(instances);
        if (!i) throw new Error(`No instances in series ${this.seriesUID}`);
        this.instanceUID = i["00080018"].Value[0]; // SOPInstanceUID
        return { studyUID: this.studyUID, seriesUID: this.seriesUID, instanceUID: this.instanceUID };
    }

    async _resolveByInstanceUID() {
        // If caller already provided Study+Series, we can skip QIDO entirely
        if (this.studyUID && this.seriesUID) {
            return { studyUID: this.studyUID, seriesUID: this.seriesUID, instanceUID: this.instanceUID };
        }
        // Otherwise: one QIDO to discover Study/Series for this InstanceUID
        const inst = await this._qido("/instances", { SOPInstanceUID: this.instanceUID });
        const i = this._first(inst);
        if (!i) throw new Error(`Instance not found by QIDO: ${this.instanceUID}`);
        this.studyUID  = i["0020000D"].Value[0];
        this.seriesUID = i["0020000E"].Value[0];
        return { studyUID: this.studyUID, seriesUID: this.seriesUID, instanceUID: this.instanceUID };
    }

    async _resolveTarget() {
        if (this.instanceUID && this.seriesUID && this.studyUID) return;
        if (this.instanceUID && (!this.seriesUID || !this.studyUID)) {
            await this._resolveByInstanceUID();
            return;
        }
        if (this.seriesUID && !this.instanceUID) {
            if (!this.studyUID) throw new Error("seriesUID provided but studyUID missing");
            await this._resolveBySeries();
            return;
        }
        if (this.studyUID && !this.seriesUID) {
            await this._resolveByStudy();
            return;
        }
        if (this.patientID) {
            await this._resolveByPatient();
            return;
        }
        throw new Error("No access path provided. Supply one of: patientID | studyUID | (studyUID+seriesUID) | instanceUID.");
    }

    /* -------------------------- OSD integration points -------------------------- */

    getImageInfo(url) {
        // mirror your RationaiStandaloneV3 style: do our own fetch & then call ready
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

    configure(data/*unused*/, url/*unused*/, postData/*unused*/) {
        // nothing here; we do metadata-driven config
        return;
    }

    _configureFromDICOM(metadata) {
        // Orthanc returns an array with a single object
        const attrs = metadata[0];

        const totalWidth  = parseInt(attrs["00480006"].Value[0]); // TotalPixelMatrixColumns
        const totalHeight = parseInt(attrs["00480007"].Value[0]); // TotalPixelMatrixRows
        const numberOfFrames = parseInt(attrs["00280008"].Value[0]);

        const tileWidth  = parseInt(attrs["00280011"].Value[0]); // Columns (tile width)
        const tileHeight = parseInt(attrs["00280010"].Value[0]); // Rows (tile height)

        // Per-Frame Functional Groups
        const perFrameFG = (attrs["52009230"] && attrs["52009230"].Value) || null;
        if (!perFrameFG) throw new Error("No Per-Frame Functional Groups found, cannot build pyramid.");

        // Build levels by pixel spacing (downsample factor)
        const levelIndexByDownsample = new Map();
        this.levels = [];
        this.framesByLevel = {};

        for (let frameIndex = 0; frameIndex < numberOfFrames; frameIndex++) {
            const fg = perFrameFG[frameIndex];

            const pixelMeasures = fg["00289110"]?.Value?.[0]; // PixelMeasuresSequence
            const planePos      = fg["0048021A"]?.Value?.[0]; // PlanePositionSlideSequence

            if (!pixelMeasures || !planePos) continue;

            const spacing = pixelMeasures["00280030"].Value; // [rowSpacing, colSpacing]
            const rowSpacing = parseFloat(spacing[0]);
            const colSpacing = parseFloat(spacing[1]);

            // Use column spacing as downsample (isotropic typical for WSI)
            const ds = colSpacing;

            let levelIdx;
            if (levelIndexByDownsample.has(ds)) {
                levelIdx = levelIndexByDownsample.get(ds);
            } else {
                levelIdx = this.levels.length;
                levelIndexByDownsample.set(ds, levelIdx);
                this.levels.push({
                    downsample: ds,
                    width: Math.round(totalWidth / ds),
                    height: Math.round(totalHeight / ds),
                    spacing
                });
                this.framesByLevel[levelIdx] = {};
            }

            const row = parseInt(planePos["0048021E"].Value[0], 10); // RowPositionInTotalImagePixelMatrix
            const col = parseInt(planePos["0048021F"].Value[0], 10); // ColumnPositionInTotalImagePixelMatrix

            const tileX = Math.floor(col / tileWidth);
            const tileY = Math.floor(row / tileHeight);

            // DICOM frames are 1-based
            this.framesByLevel[levelIdx][`${tileX}_${tileY}`] = frameIndex + 1;
        }

        // Sort levels (lowest downsample → highest resolution first)
        this.levels.sort((a, b) => a.downsample - b.downsample);

        // Final OSD fields
        this.width = totalWidth;
        this.height = totalHeight;
        this.tileWidth = tileWidth;
        this.tileHeight = tileHeight;
        this.minLevel = 0;
        this.maxLevel = this.levels.length - 1;
    }

    getLevelScale(level) {
        // OSD expects scale relative to max resolution
        // Our levels[] is sorted by increasing downsample; level 0 == highest resolution
        const ds = this.levels[level]?.downsample || 1;
        return 1 / ds;
    }

    getTileUrl(level, x, y) {
        // Flip because OSD levels grow upward, but we stored from highest-res at 0
        const dsLevel = level; // we sorted with highest-res at 0; no flip needed
        const frameMap = this.framesByLevel[dsLevel];
        const frameNumber = frameMap && frameMap[`${x}_${y}`];
        if (!frameNumber) return null;

        return `${this.baseUrl}/studies/${this.studyUID}/series/${this.seriesUID}/instances/${this.instanceUID}/frames/${frameNumber}`;
    }

    // Ensure Authorization header is forwarded on XHR tile loads
    downloadTileStart(context) {
        if (this.ajaxHeaders?.Authorization) {
            context.ajaxHeaders = context.ajaxHeaders || {};
            context.ajaxHeaders.Authorization = this.ajaxHeaders.Authorization;
        }
        // Ask for rendered pixels (JPEG) if server supports it
        context.ajaxHeaders = context.ajaxHeaders || {};
        if (!context.ajaxHeaders.Accept) {
            context.ajaxHeaders.Accept = "image/jpeg, image/png;q=0.9,*/*;q=0.8";
        }
        super.downloadTileStart(context);
    }
}
