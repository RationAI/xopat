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

    static async qido(url, authToken) {
        const res = await fetch(url.toString(), {
            headers: {
                Accept: 'application/dicom+json',
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
            }
        });
        if (res.status === 204) return undefined;
        const text = await res.text();
        if (res.status === 404 && /Unknown resource/i.test(text)) throw new Error(`QIDO endpoint missing at ${path}`);
        if (res.status === 404) return undefined;
        if (!res.ok) throw new Error(`QIDO ${url.pathname} failed: ${res.status} ${text}`);
        try { return JSON.parse(text); } catch (e) { throw new Error(`Bad DICOM JSON: ${e.message} - body: ${text}`); }
    }

    // Safe QIDO wrapper: try with includefield, retry without if server rejects that param
    static async qidoSafe(baseUrl, authToken, includefield) {
        const withParams = new URL(baseUrl);
        if (includefield) withParams.searchParams.set('includefield', includefield);
        try {
            return await this.qido(withParams, authToken);
        } catch (e) {
            const msg = String(e?.message || '');
            if (includefield && (msg.includes('includefield') || msg.includes('Invalid JSON payload'))) {
                const noParams = new URL(baseUrl);
                return await this.qido(noParams, authToken);
            }
            throw e;
        }
    }

    static async qidoSafeWithMeta(baseUrl, authToken, includefield) {
        const make = (withFields) => {
            const u = new URL(baseUrl);
            if (withFields && includefield) u.searchParams.set('includefield', includefield);
            return u;
        };

        // First try with includefield
        let url = make(true);
        let res = await fetch(url.toString(), {
            headers: { Accept: 'application/dicom+json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) }
        });
        if (!res.ok) {
            // Retry without includefield if the server rejects it (e.g., GCP)
            const msg = await res.text();
            if (includefield && (msg.includes('includefield') || msg.includes('Invalid JSON payload'))) {
                url = make(false);
                res = await fetch(url.toString(), {
                    headers: { Accept: 'application/dicom+json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) }
                });
            } else {
                throw new Error(`QIDO ${url.pathname} failed: ${res.status} ${msg}`);
            }
        }
        const total = this._readTotalHeader(res.headers);
        const text = await res.text();
        let rows;
        try { rows = JSON.parse(text); } catch (e) { throw new Error(`Bad DICOM JSON: ${e.message} - body: ${text}`); }
        return { rows, total };
    }

    // WADO-RS metadata fetch for richer details when QIDO filters are blocked
    static async wadoMetadata(urlPath, authToken) {
        const url = new URL(urlPath);
        const res = await fetch(url.toString(), {
            headers: {
                Accept: 'application/dicom+json',
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
            }
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`WADO ${url.pathname} failed: ${res.status} ${text}`);
        try { return JSON.parse(text); } catch (e) { throw new Error(`Bad DICOM JSON: ${e.message} - body: ${text}`); }
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

    static async findWSIItems(serviceUrl, authToken, studyUID, seriesUID) {
        const base = `${serviceUrl}/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}/instances`;
        const { rows, total } = await this.qidoSafeWithMeta(base, authToken, '00080018,00080008,00280010,00280011,00400512,00480106,00480006,00480007');
        // rows are already instance objects; pass through or normalize if needed
        const wsiInstances = await this.groupSeriesInstances(serviceUrl, authToken, rows, { studyUID, seriesUID });

        for (let wsi of wsiInstances) {
            wsi.levels = [];
            for (let instance of wsi.pyramidInstances) {
                const uid = this.v(instance, "00080018");
                const meta = await this.wadoMetadata(`${serviceUrl}/studies/${studyUID}/series/${seriesUID}/instances/${uid}/metadata`, authToken);
                this._ingestInstanceMetadata(uid, instance, meta, wsi);
            }
        }
        return wsiInstances;
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

    /* PRIVATE */

    static async groupSeriesInstances(serviceUrl, authToken, instancesObject, seriesObject) {
        const _best = (v) => (typeof v === "string" && v.trim()) ? v.trim() : null;
        const _tail = (uid, n = 6) => (uid ? uid.slice(-n) : null);
        const _makeSeriesLabel = (group, seriesObject) => {
            const container = _best(group.containerIdentifier);
            const pathId    = _best(group.opticalPathId);
            const dims      = _best(group.totalPixelMatrix);
            const sDesc     = _best(seriesObject?.description);
            const sTail     = _tail(seriesObject?.seriesUID);

            // Build pieces in priority order
            const base = container || sDesc || `Series …${sTail ?? ""}`;
            const parts = [base];

            if (pathId && pathId !== "DEFAULT_PATH") parts.push(`[${pathId}]`);
            if (dims) parts.push(`• ${dims}`);

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
                    thumbUrl: null, renderedUrl: null,
                };
                g.label = _makeSeriesLabel(g, seriesObject);
                groups.set(key, g);
            } else {
                g = groups.get(key);
            }

            // todo duplicate logics on the ingest metadata level
            const imageType = (ds?.["00080008"]?.Value || []).join("\\");  // ImageType
            if (/LABEL/i.test(imageType)) g.labelInstance = ds;
            else if (/OVERVIEW/i.test(imageType)) g.overviewInstance = ds;
            else g.pyramidInstances.push(ds); // pyramid levels

            const area = rows * cols || Number.POSITIVE_INFINITY;
            if (sopInstanceUID && area < g._bestArea) {
                g._bestArea = area;
                g._bestSop = sopInstanceUID;
            }
        }

        for (const g of groups.values()) {
            const studyUID  = g.studyUID;
            const seriesUID = g.seriesUID;
            // Prefer LABEL, then OVERVIEW, then smallest volume instance
            const pick = this.v(g.labelInstance, "00080018")
                || this.v(g.overviewInstance, "00080018")
                || g._bestSop
                || null;
            if (pick) {
                const base = `${serviceUrl}/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}/instances/${encodeURIComponent(pick)}`;
                g.thumbUrl    = `${base}/thumbnail`;
                g.renderedUrl = `${base}/rendered?rows=256`;
            }
        }
        return Array.from(groups.values());
    }

    static _ingestInstanceMetadata(instanceUID, instance, metadata, wsiInstance) {
        const attrs = metadata[0] || {};
        const numberOfFrames = this.iv(attrs, "00280008");

        // Heuristics for role detection (single frame, specialized ImageType)
        const imageType = this.tag(attrs, "00080008")?.map(x => x.toUpperCase());
        const isSingleFrame = (numberOfFrames || 1) === 1;
        if (isSingleFrame && imageType?.length) {
            const tag = imageType.join("\\");
            if (!wsiInstance.previewInstanceUID && /OVERVIEW|THUMBNAIL/.test(tag)) wsiInstance.previewInstanceUID = instanceUID;
            if (!wsiInstance.macroInstanceUID && /LABEL|MACRO/.test(tag)) wsiInstance.macroInstanceUID = instanceUID;
        }

        // Try to read pyramid definition
        const totalWidth  = this.iv(attrs, "00480006");
        const totalHeight = this.iv(attrs, "00480007");
        const tileWidth   = this.iv(attrs, "00280011");
        const tileHeight  = this.iv(attrs, "00280010");

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
                const planePos      = this.v(fg, "0048021A"); // PlanePositionSlideSequence
                if (!planePos) continue;
                const pixelMeasures = this.v(fg, "00289110"); // PixelMeasuresSequence
                let measures = pixelMeasures?.["00280030"]?.Value || spacingArr;
                if (!measures) {
                    console.warn("No pixel measures found for frame", frameIndex);
                    const pixelSpacing = this.fv(attrs, "00181164");  // or ImagerPixelSpacing at worst
                    measures = [pixelSpacing, pixelSpacing];
                }

                const level = this._injectLevelByDims(wsiInstance, totalWidth, totalHeight, tileWidth, tileHeight);
                level.micronsX = measures[0];
                level.micronsY = measures[1];
                level.instanceUID = instanceUID;
                level.frames = {};
                const frames = level.frames;
                // Map tile (x,y) -> { frameNumber, instanceUID }
                const row = this.iv(fg, "0048021E") || this.iv(planePos, "0048021E");
                const col = this.iv(fg, "0048021F") || this.iv(planePos, "0048021F");
                const tileX = Math.floor((col ?? 0) / (tileWidth || 1));
                const tileY = Math.floor((row ?? 0) / (tileHeight || 1));
                frames[`${tileX}_${tileY}`] = frameIndex + 1
            }
            return;
        }

        // Fallback: a single‑resolution tiled instance without per‑frame FG (row‑major)
        if (totalWidth && totalHeight && tileWidth && tileHeight && numberOfFrames > 1) {
            const level = this._injectLevelByDims(wsiInstance, totalWidth, totalHeight, tileWidth, tileHeight);
            // todo read microns
            level.instanceUID = instanceUID;
            level.frames = {};
            const frames = level.frames;

            const tilesX = Math.ceil(totalWidth / tileWidth);
            const tilesY = Math.ceil(totalHeight / tileHeight);
            if (tilesX * tilesY === numberOfFrames) {
                for (let y = 0; y < tilesY; y++) for (let x = 0; x < tilesX; x++) {
                    frames[`${x}_${y}`] = y * tilesX + x + 1;
                }
            }
        }
    }

    static _injectLevelByDims(wsiInstance, totalWidth, totalHeight, tileWidth, tileHeight) {
        const levels = wsiInstance.levels;

        // 0) Reuse existing level if same dimensions
        for (let i = 0; i < wsiInstance.levels.length; i++) {
            const L = levels[i];
            if (L.width != null && L.height != null &&
                // test dimensions with 1 pixel tolerance
                Math.abs(L.width - totalWidth) <= 1 && Math.abs(L.height - totalHeight) <= 1) {
                if (L.tileWidth == null && tileWidth != null)  L.tileWidth  = tileWidth;
                if (L.tileHeight == null && tileHeight != null) L.tileHeight = tileHeight;
                return i;
            }
        }

        let insertIdx = levels.length;
        for (let i = 0; i < levels.length; i++) {
            const L = levels[i];
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