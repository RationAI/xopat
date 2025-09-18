export class DICOMWebTileSource extends OpenSeadragon.TileSource {
    constructor(options) {
        super(options);

        this.baseUrl = this.options.baseUrl;
        this.studyUID = this.options.studyUID;
        this.seriesUID = this.options.seriesUID;
        this.instanceUID = this.options.instanceUID;

        this.ajaxHeaders = options.ajaxHeaders || {};

        // Hook into xOpat user handling
        const user = XOpatUser.instance();
        const secret = user.getSecret();
        if (secret) {
            this.ajaxHeaders["Authorization"] = secret;
        }
        user.addHandler("secret-updated", e => e.type === "jwt" && (this.ajaxHeaders["Authorization"] = e.secret));
        user.addHandler("secret-removed", e => e.type === "jwt" && (this.ajaxHeaders["Authorization"] = null));
        user.addHandler("logout", e => this.ajaxHeaders["Authorization"] = null);

        // Pyramid info
        this.levels = [];
        this.framesByLevel = {}; // { level: { "x_y": frameNumber } }
    }

    supports(data, url) {
        // only direct injection supported
        return false;
    }

    configure(data, url, postData) {
        if (!data.id) {
            data._handlesOwnImageLoadLogics = data;
            return data;
        }

        console.log("DICOM", data);
        const attrs = data[0];

        const totalWidth  = parseInt(attrs["00480006"].Value[0]); // TotalPixelMatrixColumns
        const totalHeight = parseInt(attrs["00480007"].Value[0]); // TotalPixelMatrixRows
        const numberOfFrames = parseInt(attrs["00280008"].Value[0]);

        // Default values if Shared FG present
        const sharedFG = attrs["52009229"]?.Value || []; // SharedFunctionalGroups
        const perFrameFG = attrs["52009230"].Value;      // PerFrameFunctionalGroups

        if (!perFrameFG) {
            throw new Error("No Per-Frame Functional Groups found, cannot build pyramid.");
        }

        // Organize frames into levels
        for (let frameIndex = 0; frameIndex < numberOfFrames; frameIndex++) {
            const fg = perFrameFG[frameIndex];

            const pixelMeasures = fg["00289110"]?.Value[0]; // PixelMeasuresSequence
            const planePos      = fg["0048021A"]?.Value[0]; // PlanePositionSlideSequence
            const planeCommon   = fg["00209111"]?.Value[0]; // PlaneCommonSequence (for res)

            const row = planePos["0048021E"].Value[0]; // RowPositionInTotalImagePixelMatrix
            const col = planePos["0048021F"].Value[0]; // ColumnPositionInTotalImagePixelMatrix

            const rowSpacing = parseFloat(pixelMeasures["00280030"].Value[0]);
            const colSpacing = parseFloat(pixelMeasures["00280030"].Value[1]);

            // Downsample factor: relative to base level
            const dsFactor = colSpacing; // assumes isotropic
            let levelIndex = this._getOrCreateLevel(dsFactor, totalWidth, totalHeight, pixelMeasures);

            const tileWidth  = parseInt(attrs["00280011"].Value[0]); // Columns
            const tileHeight = parseInt(attrs["00280010"].Value[0]); // Rows

            const tileX = Math.floor(col / tileWidth);
            const tileY = Math.floor(row / tileHeight);

            if (!this.framesByLevel[levelIndex]) {
                this.framesByLevel[levelIndex] = {};
            }
            this.framesByLevel[levelIndex][`${tileX}_${tileY}`] = frameIndex + 1; // DICOM frames are 1-based
        }

        // Sort levels by downsample factor
        this.levels.sort((a, b) => a.downsample - b.downsample);
        this.minLevel = 0;
        this.maxLevel = this.levels.length - 1;

        this.width = totalWidth;
        this.height = totalHeight;
        this.tileWidth = parseInt(attrs["00280011"].Value[0]);
        this.tileHeight = parseInt(attrs["00280010"].Value[0]);
        this.tileOverlap = 0;
    }

    getImageInfo(url) {
        if (!this._handlesOwnImageLoadLogics) return super.getImageInfo(url);

        fetch(`${this.baseUrl}/studies/${this.studyUID}/series/${this.seriesUID}/instances/${this.instanceUID}/metadata`, {
            headers: this.ajaxHeaders || {}
        }).then(async res => {
            const text = await res.text();
            let json;
            try { json = JSON.parse(text) } catch (e) {}
            if (res.status !== 200 || !json) {
                throw new HTTPError("Empaia standalone failed to fetch image info!", json || text, res.error);
            }
            return json;
        }).then(imageInfo => {
            this.configure(imageInfo, url, null);
            // necessary TileSource props that wont get set manually
            this.dimensions = new OpenSeadragon.Point(this.width, this.height);
            this.aspectRatio = this.width / this.height;
            this.ready = true;
            this.raiseEvent('ready', {tileSource: this});
        }).catch(e => {
            this.raiseEvent('open-failed', {
                message: e,
                source: url,
                postData: null
            });
        });
    }

    _getOrCreateLevel(dsFactor, fullW, fullH, pixelMeasures) {
        let idx = this.levels.findIndex(l => l.downsample === dsFactor);
        if (idx === -1) {
            const level = {
                downsample: dsFactor,
                width: fullW / dsFactor,
                height: fullH / dsFactor,
                spacing: pixelMeasures["00280030"].Value
            };
            this.levels.push(level);
            idx = this.levels.length - 1;
        }
        return idx;
    }

    getLevelScale(level) {
        const lvl = this.levels[level];
        return lvl.downsample;
    }

    getTileUrl(level, x, y) {
        const dsLevel = this.maxLevel - level; // flip for OSD
        const frameMap = this.framesByLevel[dsLevel];
        const frameNumber = frameMap[`${x}_${y}`];
        if (!frameNumber) {
            return null; // tile missing
        }
        return `${this.baseUrl}/studies/${this.studyUID}/series/${this.seriesUID}/instances/${this.instanceUID}/frames/${frameNumber}`;
    }
}