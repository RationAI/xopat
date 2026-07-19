(function (global) {
    'use strict';

    const NS = global.AnnotationMeasurements = global.AnnotationMeasurements || {};

    const DEFAULT_MAX_SIDE = 1024;
    const MIN_USEFUL_SIDE = 16;
    const BATCH_YIELD_EVERY = 8;

    function asFiniteNumber(v) {
        return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
    }

    function geometryVersion(object) {
        // We don't have an explicit geomVersion; build one from cheap, change-on-edit
        // properties. Any real edit bumps at least one of these.
        const keys = ['left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle', 'rx', 'ry'];
        let acc = 0;
        for (const k of keys) {
            const v = object?.[k];
            if (typeof v === 'number') acc = (acc * 31 + (v * 1000) | 0) | 0;
        }
        if (Array.isArray(object?.points)) {
            acc = (acc * 31 + object.points.length) | 0;
            const last = object.points[object.points.length - 1];
            if (last) acc = (acc * 31 + ((last.x * 1000) | 0) + ((last.y * 1000) | 0)) | 0;
        }
        return acc;
    }

    function channelKey(channel) {
        if (!channel) return 'display:L';
        const ch = channel.channel || 'L';
        // `vizSource` discriminates same-channel reads against different
        // visualizations (e.g. active viz vs. a scripted alternative).
        const tag = channel.vizSource ? 'viz' : 'display';
        return `${tag}:${ch}`;
    }

    /**
     * MeasurementEngine — entry point for plugin code.
     *
     * Caches per-annotation results on `object._measurements[channelKey]`
     * keyed by geometry version. Editing geometry invalidates all entries;
     * caller should also clear caches when the visualization config changes.
     */
    class MeasurementEngine {
        constructor({ annotations, getApi, getViewer } = {}) {
            this.annotations = annotations || (global.OSDAnnotations?.instance?.());
            // Lazy resolvers so the engine survives module load order.
            this._getApi = getApi || (() => global.APPLICATION_CONTEXT?.Scripting?.getApi?.('visualization'));
            this._getViewer = getViewer || (() => global.VIEWER);
            this._activeRun = null;
            // Last config used by a Run — exposed so the board panel can replay
            // a single-annotation compute with the user's most recent choices
            // (channel, threshold) instead of guessing.
            this.lastConfig = { channel: { channel: 'L' }, threshold: 128, options: {} };
        }

        /**
         * Convenience: compute metrics for one annotation using the last-used
         * config (or supplied overrides). Merges into cache and emits the
         * `annotation-measurements-updated` event so open boards repaint.
         */
        async computeForObject(object, opts = {}) {
            const channel = opts.channel || this.lastConfig.channel;
            const threshold = Number.isFinite(opts.threshold) ? opts.threshold : this.lastConfig.threshold;
            const wantComponents = !!opts.includeComponents;
            const merge = {};
            let outcomeReason = null;
            try {
                if (wantComponents) {
                    const compRes = await this.computeComponents(object, channel, threshold, opts.options || {});
                    if (compRes && compRes.components) merge.components = compRes.components;
                    else if (compRes?.sampleMissing) outcomeReason = compRes.sampleReason || 'no-sample';
                    else if (compRes?.tooSmall) outcomeReason = 'too-small';
                }
                const r = await this.computeRaster(object, channel, { ...(opts.options || {}), threshold });
                if (r && !r.tooSmall && !r.sampleMissing) {
                    merge.mean = r.mean;
                    merge.median = r.median;
                    merge.percentPositive = r.percentPositive;
                    merge.pixelCount = r.pixelCount;
                    merge.threshold = r.threshold;
                } else if (r?.sampleMissing) {
                    outcomeReason = r.sampleReason || 'no-sample';
                } else if (r?.tooSmall) {
                    outcomeReason = 'too-small';
                }
            } catch (err) {
                outcomeReason = (err && err.message) || String(err);
            }
            if (Object.keys(merge).length) this._mergeCache(object, channel, merge);
            this._notifyUpdated();
            return { merged: Object.keys(merge), reason: outcomeReason };
        }

        _notifyUpdated() {
            try {
                const wrappers = global.OSDAnnotations?.FabricWrapper?.instances?.() || [];
                for (const w of wrappers) w?.raiseEvent?.('annotation-measurements-updated');
            } catch { /* non-fatal */ }
        }

        // ─── geometric metrics ────────────────────────────────────────────

        getGeometric(object) {
            if (!object) return null;
            const factory = this.annotations?.getAnnotationObjectFactory?.(object.factoryID);
            const areaPx = factory && typeof factory.getArea === 'function'
                ? asFiniteNumber(factory.getArea(object)) : NaN;
            const lengthPx = factory && typeof factory.getLength === 'function'
                ? asFiniteNumber(factory.getLength(object)) : NaN;
            return { areaImagePx: areaPx, lengthImagePx: lengthPx };
        }

        // ─── raster + components ──────────────────────────────────────────

        async computeRaster(object, channel, options = {}) {
            const bbox = NS.rasterizer.annotationBboxImagePx(object);
            if (!bbox) {
                // Diagnostic: surface the object shape we couldn't bbox so we
                // can tell unsupported shape from missing geometry.
                console.warn('[measurements] computeRaster: no bbox for object',
                    { type: object?.type, factoryID: object?.factoryID, incrementId: object?.incrementId });
                return null;
            }
            const maxSide = options.maxSide || DEFAULT_MAX_SIDE;
            const downscale = NS.rasterizer.chooseDownscale(bbox.width, bbox.height, maxSide);
            const w = Math.max(1, Math.round(bbox.width / downscale));
            const h = Math.max(1, Math.round(bbox.height / downscale));
            if (Math.max(w, h) < MIN_USEFUL_SIDE) {
                return { tooSmall: true, width: w, height: h };
            }

            const maskResult = NS.rasterizer.rasterizePolygonMask(object, bbox, downscale);
            if (!maskResult) {
                console.warn('[measurements] computeRaster: rasterizer returned null',
                    { type: object?.type, factoryID: object?.factoryID, incrementId: object?.incrementId, bbox });
                return null;
            }

            const sample = await this._sample(channel, bbox, { width: w, height: h });
            if (!sample || !sample.rgba) return { ...maskResult, sampleMissing: true, sampleReason: sample?.reason || null };

            // When the sampler clipped to the viewport intersection, rebuild
            // the mask against the bbox it actually sampled so pixel indices in
            // `intensities` line up with the mask. Same downscale keeps the
            // per-slide-pixel resolution consistent.
            const sampleBbox = sample.bbox || bbox;
            const sampleMask = (sample.bbox && sample.bbox !== bbox)
                ? NS.rasterizer.rasterizePolygonMask(object, sampleBbox, downscale)
                : maskResult;
            if (!sampleMask) return null;

            const intensities = NS.sampler.projectChannel(sample.rgba, channel?.channel || 'L');

            // Filter intensities to mask — clip to the shorter array in case
            // rounding produced a 1-pixel mismatch between mask and sample.
            const maskedValues = [];
            const n = Math.min(sampleMask.mask.length, intensities.length);
            for (let i = 0; i < n; i++) {
                if (sampleMask.mask[i]) maskedValues.push(intensities[i]);
            }
            const arr = Float32Array.from(maskedValues);

            const mean = NS.stats.mean(arr);
            const median = NS.stats.median(arr);
            const histogram = NS.stats.histogram(arr, 64, [0, 255]);
            const threshold = options.threshold ?? 128;
            const percentPositive = NS.stats.percentPositive(arr, threshold);

            return {
                bbox: sampleBbox,
                downscale,
                width: sampleMask.width,
                height: sampleMask.height,
                mask: sampleMask.mask,
                intensities,
                pixelCount: arr.length,
                mean,
                median,
                histogram,
                threshold,
                percentPositive,
                coveragePct: sample.coveragePct ?? 1,
            };
        }

        async computeComponents(object, channel, threshold, options = {}) {
            const raster = await this.computeRaster(object, channel, { ...options, threshold });
            if (!raster || !raster.intensities) return raster;

            // Build a binary mask: foreground = polygon-mask AND intensity ≥ threshold.
            const total = raster.mask.length;
            const bin = new Uint8Array(total);
            for (let i = 0; i < total; i++) {
                if (raster.mask[i] && raster.intensities[i] >= threshold) bin[i] = 1;
            }

            const labels = NS.components.labelConnected(bin, raster.width, raster.height);
            let stats = NS.components.componentStats(labels);

            // Optional size filtering (in raster pixels).
            const minSize = options.minSize | 0;
            const maxSize = options.maxSize ? (options.maxSize | 0) : 0;
            if (minSize > 1 || maxSize > 0) {
                const keep = [];
                for (let i = 0; i < stats.sizes.length; i++) {
                    const s = stats.sizes[i];
                    if (s < minSize) continue;
                    if (maxSize && s > maxSize) continue;
                    keep.push(i);
                }
                const sizes = new Uint32Array(keep.length);
                const perimeters = new Uint32Array(keep.length);
                const circularities = new Float32Array(keep.length);
                for (let i = 0; i < keep.length; i++) {
                    sizes[i] = stats.sizes[keep[i]];
                    perimeters[i] = stats.perimeters[keep[i]];
                    circularities[i] = stats.circularities[keep[i]];
                }
                stats = { ...stats, sizes, perimeters, circularities, count: keep.length };
                // Recompute simple summaries on the filtered set.
                if (sizes.length) {
                    let sum = 0;
                    for (let i = 0; i < sizes.length; i++) sum += sizes[i];
                    stats.meanArea = sum / sizes.length;
                    const sorted = Array.from(sizes).sort((a, b) => a - b);
                    const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
                    stats.p10 = pick(0.1);
                    stats.p50 = pick(0.5);
                    stats.p90 = pick(0.9);
                    stats.medianArea = stats.p50;
                } else {
                    stats.meanArea = stats.medianArea = stats.p10 = stats.p50 = stats.p90 = NaN;
                }
            }
            return { components: stats, raster: { width: raster.width, height: raster.height, downscale: raster.downscale, threshold, channel: channelKey(channel) } };
        }

        // ─── caching ──────────────────────────────────────────────────────

        getCached(object, channel) {
            const slot = object?._measurements?.[channelKey(channel)];
            if (!slot) return null;
            if (slot.geomVersion !== geometryVersion(object)) return null;
            return slot;
        }

        setCached(object, channel, payload) {
            if (!object) return;
            const key = channelKey(channel);
            if (!object._measurements) object._measurements = {};
            object._measurements[key] = {
                ...payload,
                geomVersion: geometryVersion(object),
                channelKey: key,
                channel: channel ? { ...channel } : null,
                computedAt: Date.now(),
            };
        }

        clearCacheFor(object) {
            if (object && object._measurements) object._measurements = {};
        }

        clearAllCaches() {
            const fabrics = (global.OSDAnnotations?.FabricWrapper?.instances?.() || []);
            for (const f of fabrics) {
                const objs = f?.canvas?.getObjects?.() || [];
                for (const o of objs) if (o && o._measurements) o._measurements = {};
            }
        }

        // ─── batch ────────────────────────────────────────────────────────

        /**
         * Run a measurement set over a scope of annotations.
         * scope: { kind: 'preset'|'selection'|'visible'|'list', presetID?, list? }
         * metrics: Set of 'mean' | 'median' | 'percentPositive' | 'components'
         * channel: { channel: 'R'|'G'|'B'|'L', vizSource? }
         *   Pixels are read through the standalone flex-renderer using the
         *   active visualization (or `vizSource` when supplied), so values
         *   reflect what the user is looking at — shaders, blending, order.
         * Calls onProgress({done, total}); aborts on signal.aborted.
         */
        async runForScope({ scope, metrics, channel, threshold = 128, options = {}, onProgress, signal }) {
            if (this._activeRun && !this._activeRun.signal.aborted) {
                throw new Error('Another measurement run is already in progress.');
            }
            const ctrl = signal ? null : new AbortController();
            const effectiveSignal = signal || ctrl.signal;
            this._activeRun = { signal: effectiveSignal };
            this.lastConfig = { channel: channel ? { ...channel } : this.lastConfig.channel, threshold, options: { ...options } };

            const objects = this._collectScope(scope);
            const total = objects.length;
            const wantComponents = metrics?.has?.('components');
            const errors = [];
            let done = 0;

            try {
                for (let i = 0; i < total; i++) {
                    if (effectiveSignal.aborted) break;
                    const obj = objects[i];
                    try {
                        if (wantComponents) {
                            const compRes = await this.computeComponents(obj, channel, threshold, options);
                            if (compRes && compRes.components) {
                                this._mergeCache(obj, channel, { components: compRes.components, threshold });
                            }
                        } else {
                            const raster = await this.computeRaster(obj, channel, { ...options, threshold });
                            if (raster && !raster.tooSmall && !raster.sampleMissing) {
                                this._mergeCache(obj, channel, {
                                    pixelCount: raster.pixelCount,
                                    mean: raster.mean,
                                    median: raster.median,
                                    percentPositive: raster.percentPositive,
                                    threshold: raster.threshold,
                                    coveragePct: raster.coveragePct,
                                });
                            } else if (raster?.sampleMissing) {
                                errors.push({ object: obj, reason: raster.sampleReason || 'no-sample' });
                            } else if (raster?.tooSmall) {
                                errors.push({ object: obj, reason: 'too-small' });
                            } else {
                                // computeRaster returned null — annotation has no usable
                                // bbox or its shape isn't rasterizable (e.g. path / group).
                                // Surface this instead of skipping silently so the run
                                // summary's total adds up.
                                errors.push({ object: obj, reason: 'unsupported-shape' });
                            }
                        }
                    } catch (err) {
                        errors.push({ object: obj, reason: (err && err.message) || String(err) });
                    }
                    done++;
                    if (onProgress) onProgress({ done, total });
                    if ((i % BATCH_YIELD_EVERY) === BATCH_YIELD_EVERY - 1) {
                        await new Promise((r) => requestAnimationFrame(r));
                    }
                }
            } finally {
                this._activeRun = null;
            }
            return { done, total, aborted: effectiveSignal.aborted, errors };
        }

        cancelActiveRun() {
            // The caller owns the signal; provided for symmetry / future use.
            this._activeRun = null;
        }

        // ─── internals ────────────────────────────────────────────────────

        _mergeCache(object, channel, partial) {
            const existing = this.getCached(object, channel) || {};
            this.setCached(object, channel, { ...existing, ...partial });
        }

        async _sample(channel, bbox, outputSize) {
            const api = this._getApi();
            if (!api) return { rgba: null, reason: 'no-api' };
            const viewer = this._getViewer();
            return NS.sampler.sampleRenderedRegion(api, viewer, bbox, outputSize, channel?.vizSource);
        }

        _collectScope(scope) {
            if (!scope) return [];
            if (scope.kind === 'list' && Array.isArray(scope.list)) return scope.list.filter(Boolean);

            const fabrics = (global.OSDAnnotations?.FabricWrapper?.instances?.() || []);
            const out = [];
            for (const fabric of fabrics) {
                const objs = fabric?.canvas?.getObjects?.() || [];
                for (const o of objs) {
                    if (!fabric.isAnnotation?.(o)) continue;
                    if (scope.kind === 'preset' && o.presetID !== scope.presetID) continue;
                    if (scope.kind === 'selection') {
                        const selSet = new Set((fabric.getSelectedAnnotations?.() || []).map(s => s?.incrementId));
                        if (!selSet.has(o.incrementId)) continue;
                    }
                    if (scope.kind === 'visible') {
                        // Use OSD-supplied visibility when available; fall back to bbox-vs-viewport.
                        const viewer = this._getViewer();
                        const vp = viewer?.viewport;
                        const image = viewer?.scalebar?.getReferencedTiledImage?.() || viewer?.world?.getItemAt?.(0);
                        if (!vp || !image) continue;
                        const r = o.getBoundingRect?.(true, true);
                        if (!r) continue;
                        const tl = image.imageToViewportCoordinates(r.left, r.top);
                        const br = image.imageToViewportCoordinates(r.left + r.width, r.top + r.height);
                        const b = vp.getBounds();
                        if (br.x < b.x || br.y < b.y || tl.x > b.x + b.width || tl.y > b.y + b.height) continue;
                    }
                    out.push(o);
                }
            }
            return out;
        }
    }

    NS.MeasurementEngine = MeasurementEngine;
    NS.geometryVersion = geometryVersion;
    NS.channelKey = channelKey;
})(typeof window !== 'undefined' ? window : globalThis);
