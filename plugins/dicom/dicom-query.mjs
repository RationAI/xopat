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

    static async stow(serviceUrl, authToken, studyUID, dicomData) {
        const url = `${serviceUrl}/studies/${studyUID}`;
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

        // 2. Send Request with CORRECT HEADERS
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/related; type="application/dicom"; boundary=${boundary}`,
                'Accept': 'application/dicom+json', // <--- THIS FIXES THE CRASH
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
            },
            body: body
        });

        // 3. Handle Response
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`STOW-RS failed (${res.status}): ${txt}`);
        }

        // Safety check: verify response is actually JSON before parsing
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

    static async findWSIItems(serviceUrl, authToken, studyUID, seriesUID, frameOrder=undefined) {
        const base = `${serviceUrl}/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}/instances`;
        const { rows, total } = await this.qidoSafeWithMeta(base, authToken, '00080018,00080008,00280010,00280011,00400512,00480106,00480006,00480007');
        // rows are already instance objects; pass through or normalize if needed
        const wsiInstances = await this.groupSeriesInstances(serviceUrl, authToken, rows, { studyUID, seriesUID });

        for (let wsi of wsiInstances) {
            wsi.levels = [];
            for (let instance of wsi.pyramidInstances) {
                const uid = this.v(instance, "00080018");
                const meta = await this.wadoMetadata(`${serviceUrl}/studies/${studyUID}/series/${seriesUID}/instances/${uid}/metadata`, authToken);
                this._ingestInstanceMetadata(uid, instance, meta, wsi, frameOrder);
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

    static async findLatestAnnotation(serviceUrl, authToken, studyUID) {
        // Request Modality (00080060) and Dates explicitly
        const seriesUrl = `${serviceUrl}/studies/${studyUID}/series?includefield=00080060&includefield=00080021&includefield=00080031`;

        try {
            const seriesList = await this.qidoSafe(seriesUrl, authToken);
            if (!seriesList || !seriesList.length) return null;

            // Filter for SR (Structured Report) series client-side
            const srSeriesList = seriesList.filter(s => {
                const mod = this.v(s, '00080060');
                return mod === 'SR';
            });

            if (srSeriesList.length === 0) {
                console.log("No SR series found in this study.");
                return null;
            }

            let allCandidates = [];

            // Check every SR series for instances
            for (const series of srSeriesList) {
                const seriesUID = this.v(series, '0020000E');

                // Fetch instances with date tags
                const instancesUrl = `${serviceUrl}/studies/${studyUID}/series/${seriesUID}/instances?includefield=00080023&includefield=00080033&includefield=00080012&includefield=00080013`;

                const instances = await this.qidoSafe(instancesUrl, authToken);
                if (instances && instances.length) {
                    // Attach SeriesUID so we can use it later
                    instances.forEach(i => { i._parentSeriesUID = seriesUID; });
                    allCandidates.push(...instances);
                }
            }

            if (allCandidates.length === 0) return null;

            // Sort: Newest First
            // Priortize Content Date/Time (SR specific), fallback to Instance Creation
            allCandidates.sort((a, b) => {
                const getDt = (item) => {
                    const clean = (val) => (val || '').replace(/[^0-9]/g, '');
                    const date = clean(this.v(item, '00080023')) ||
                        clean(this.v(item, '00080012')) ||
                        clean(this.v(item, '00080021')) || '00000000';
                    const time = clean(this.v(item, '00080033')) ||
                        clean(this.v(item, '00080013')) ||
                        clean(this.v(item, '00080031')) || '000000';
                    return Number(date + time);
                };
                return getDt(b) - getDt(a);
            });

            const latest = allCandidates[0];
            console.log(`Found ${allCandidates.length} annotations. Newest:`, latest, allCandidates);

            return {
                seriesUID: latest._parentSeriesUID,
                sopUID: this.v(latest, '00080018')
            };

        } catch (e) {
            console.warn("Error finding annotations:", e);
            return null;
        }
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
            if (!(frames > 1 && rows > 0 && cols > 0 && rows <= 512 && cols <= 512)) {
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
        const totalWidth  = this.iv(attrs, "00480006");
        const totalHeight = this.iv(attrs, "00480007");
        const tileWidth   = this.iv(attrs, "00280011");
        const tileHeight  = this.iv(attrs, "00280010");

        // Per-frame functional groups (often absent or unusable in DICOMweb servers)
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

        // Helper: apply spacing to a level if it doesn't have it yet
        const applySpacingToLevel = (level, measures) => {
            const m = measures || spacingArr || null;
            if (m && (!level.micronsX || !level.micronsY)) {
                level.micronsX = Number(m[0]);
                level.micronsY = Number(m[1] ?? m[0]);
            }
            if (!level.micronsX || !level.micronsY) {
                // Hard fallback (0.25 microns) — you already used this default
                level.micronsX = level.micronsX || 0.00025;
                level.micronsY = level.micronsY || 0.00025;
            }
        };

        // === 1) Try per-frame mapping ONLY if it is truly usable ===
        // Many DICOMweb servers provide 5200,9230 in metadata but not the slide position keys you rely on.
        // We only "commit" to this path if it maps most of the expected grid.
        let didMapPerFrame = false;

        if (Array.isArray(perFrameFG) && numberOfFrames > 1 && totalWidth && totalHeight && tileWidth && tileHeight) {
            const tilesX = Math.ceil(totalWidth / tileWidth);
            const tilesY = Math.ceil(totalHeight / tileHeight);
            const expected = tilesX * tilesY;

            // Make/find level for these dims early (so we fill into one object)
            const level = this._injectLevelByDims(wsiInstance, totalWidth, totalHeight, tileWidth, tileHeight);
            level.instanceUID = instanceUID;
            level.frames = level.frames || {};
            applySpacingToLevel(level, spacingArr);

            let mapped = 0;

            for (let frameIndex = 0; frameIndex < numberOfFrames; frameIndex++) {
                const fg = perFrameFG[frameIndex];
                if (!fg) continue;

                // Your current code expects a "plane position" group under tag 0048,021A.
                // In practice, servers vary; keep your lookup but don't assume success.
                const planePos = this.v(fg, "0048021A");

                // Compute row/col offsets. Use floats (DS values are common).
                const colOff = this.fv(fg, "0048021E") ?? this.fv(planePos, "0048021E");
                const rowOff = this.fv(fg, "0048021F") ?? this.fv(planePos, "0048021F");

                if (!Number.isFinite(colOff) || !Number.isFinite(rowOff)) continue;

                const tileX = Math.floor((colOff ?? 0) / (tileWidth || 1));
                const tileY = Math.floor((rowOff ?? 0) / (tileHeight || 1));
                if (tileX < 0 || tileY < 0) continue;

                const key = `${tileX}_${tileY}`;
                if (level.frames[key] == null) mapped++;
                level.frames[key] = frameIndex + 1;
            }

            // Only trust this map if it filled most of the grid (otherwise fall back)
            if (expected > 0 && mapped >= expected * 0.80) {
                didMapPerFrame = true;
            } else {
                // Per-frame info was incomplete; clear partial mapping so it doesn't interfere
                level.frames = {};
            }

            const inferred = this._inferFrameOrderFromMap(level, tilesX, tilesY);
            if (inferred && !wsiInstance._inferredFrameOrder) {
                wsiInstance._inferredFrameOrder = inferred;
            }
        }

        if (didMapPerFrame) {
            return;
        }

        // === 2) Fallback: sequential row-major mapping (works for the metadata you posted) ===
        // This triggers when per-frame info is absent OR incomplete.
        if (totalWidth && totalHeight && tileWidth && tileHeight && numberOfFrames > 1) {
            const level = this._injectLevelByDims(wsiInstance, totalWidth, totalHeight, tileWidth, tileHeight);

            level.instanceUID = instanceUID;
            level.frames = level.frames || {};
            applySpacingToLevel(level, spacingArr);

            const tilesX = Math.ceil(totalWidth / tileWidth);
            const tilesY = Math.ceil(totalHeight / tileHeight);
            const expected = tilesX * tilesY;

            // Only build if it's a perfect grid (your sample is perfect: 487*262 == 127594)
            if (expected === numberOfFrames) {
                // Different DICOMweb backends / WSI writers may order frames differently.
                // Support 4 common variants and pick via wsiInstance.frameOrder:
                //   "row-major" (default)          : f = y*tilesX + x + 1
                //   "row-major-flipY"              : f = (tilesY-1-y)*tilesX + x + 1
                //   "col-major"                    : f = x*tilesY + y + 1
                //   "col-major-flipY"              : f = x*tilesY + (tilesY-1-y) + 1
                const order = wsiInstance.frameOrder || wsiInstance._inferredFrameOrder || frameOrder || "row-major";

                const frameAt = (x, y) => {
                    const yy = order.includes("flipY") ? (tilesY - 1 - y) : y;
                    if (order.startsWith("row-major")) {
                        return yy * tilesX + x + 1;
                    }
                    // col-major
                    return x * tilesY + yy + 1;
                };

                for (let y = 0; y < tilesY; y++) {
                    for (let x = 0; x < tilesX; x++) {
                        level.frames[`${x}_${y}`] = frameAt(x, y);
                    }
                }

                const inferred = this._inferFrameOrderFromMap(level, tilesX, tilesY);
                if (inferred && !wsiInstance._inferredFrameOrder) {
                    wsiInstance._inferredFrameOrder = inferred;
                }
            } else {
                console.warn("WSI sequential frame-map mismatch; cannot map frames reliably", {
                    instanceUID,
                    totalWidth, totalHeight, tileWidth, tileHeight,
                    tilesX, tilesY, expected,
                    numberOfFrames
                });
            }
        }
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

    static _inferFrameOrderFromMap(level, tilesX, tilesY) {
        // Returns one of:
        // "row-major", "row-major-flipY", "col-major", "col-major-flipY"
        // based on predominant neighbor deltas in level.frames.

        const frames = level?.frames;
        if (!frames || tilesX < 2 || tilesY < 2) return null;

        let dxPos1 = 0, dxNeg1 = 0, dxPosTY = 0, dxNegTY = 0;
        let dyPos1 = 0, dyNeg1 = 0, dyPosTX = 0, dyNegTX = 0;

        const get = (x, y) => frames[`${x}_${y}`];

        // Sample a grid of interior points (avoid last row/col)
        const stepX = Math.max(1, Math.floor(tilesX / 16));
        const stepY = Math.max(1, Math.floor(tilesY / 16));

        for (let y = 0; y < tilesY - 1; y += stepY) {
            for (let x = 0; x < tilesX - 1; x += stepX) {
                const f = get(x, y);
                const fx = get(x + 1, y);
                const fy = get(x, y + 1);
                if (!Number.isFinite(f)) continue;

                if (Number.isFinite(fx)) {
                    const d = fx - f;
                    if (d === 1) dxPos1++;
                    else if (d === -1) dxNeg1++;
                    else if (d === tilesY) dxPosTY++;       // col-major: x-step moves by tilesY
                    else if (d === -tilesY) dxNegTY++;
                }

                if (Number.isFinite(fy)) {
                    const d = fy - f;
                    if (d === 1) dyPos1++;
                    else if (d === -1) dyNeg1++;
                    else if (d === tilesX) dyPosTX++;       // row-major: y-step moves by tilesX
                    else if (d === -tilesX) dyNegTX++;
                }
            }
        }

        // Decide major order by which pattern dominates
        const rowMajorScore = dyPosTX + dyNegTX + dxPos1 + dxNeg1;
        const colMajorScore = dxPosTY + dxNegTY + dyPos1 + dyNeg1;

        if (rowMajorScore === 0 && colMajorScore === 0) return null;

        const isRowMajor = rowMajorScore >= colMajorScore;

        if (isRowMajor) {
            // flipY if moving "down" decreases frame numbers by tilesX
            const flipY = dyNegTX > dyPosTX;
            return flipY ? "row-major-flipY" : "row-major";
        } else {
            // flipY if moving "down" decreases frame numbers by 1 (col-major)
            const flipY = dyNeg1 > dyPos1;
            return flipY ? "col-major-flipY" : "col-major";
        }
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