(function (global) {
    'use strict';

    const NS = global.AnnotationMeasurements = global.AnnotationMeasurements || {};

    // Output-pixel cap for a single raster sample. The engine picks a downscale
    // from a target µm/px; this only bounds pathological cases (whole-slide
    // annotations) so one sample never allocates an unbounded buffer.
    const DEFAULT_MAX_PIXELS = 8 * 1024 * 1024;
    const MIN_USEFUL_SIDE = 16;
    const BATCH_YIELD_EVERY = 8;
    // A rendered pixel counts as "covered" (real data) when its alpha exceeds
    // this. Filters out unpainted/transparent regions of the off-screen render.
    const COVERAGE_ALPHA = 8;
    // Default sampling resolution when the caller doesn't pin one: ~1 µm/px is a
    // good stain-analysis default (nuclei ~5-10 µm resolve well) and keeps most
    // annotations well under the pixel cap. Falls back to native when the slide
    // has no physical calibration.
    const DEFAULT_TARGET_MPP = 1.0;

    function asFinite(v) {
        return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
    }

    // Geometry fingerprint used for cache invalidation. Unlike the previous
    // heuristic (a few props + last point only), this folds EVERY vertex plus
    // all transform-bearing props, so any edit that changes the shape changes
    // the key. Cheap: one pass, integer accumulator.
    function geometryVersion(object) {
        let acc = 2166136261 >>> 0; // FNV-ish seed
        const mix = (n) => { acc = (Math.imul(acc ^ (n | 0), 16777619)) >>> 0; };
        const props = ['left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle', 'rx', 'ry', 'radius'];
        for (const k of props) {
            const v = object?.[k];
            if (typeof v === 'number') mix(Math.round(v * 1000));
        }
        const pts = object?.points;
        if (Array.isArray(pts)) {
            mix(pts.length);
            for (let i = 0; i < pts.length; i++) {
                mix(Math.round((pts[i].x || 0) * 100));
                mix(Math.round((pts[i].y || 0) * 100));
            }
        }
        // Multipolygon / group children carry nested geometry on `objects`.
        if (Array.isArray(object?.objects)) {
            mix(object.objects.length);
            for (const child of object.objects) mix(geometryVersion(child));
        }
        return acc;
    }

    // A measurement is identified by (source, channel) so the same annotation
    // can cache background-raw-L alongside rendered-G without collision.
    function slotKey(cfg) {
        const source = cfg?.source === 'rendered' ? 'rendered' : 'background-raw';
        const channel = cfg?.channel || 'L';
        return `${source}:${channel}`;
    }

    /**
     * MeasurementEngine — the single compute entry point for measurements.
     *
     * All pixel-mode metrics go through {@link sampleAndMask}, which reads a
     * deterministic, viewport-independent region via the standalone sampler.
     * Geometric metrics (area, length, ratios, composition, distances) are pure
     * polygon math via NS.geometry. Every method takes an explicit `viewer` so
     * the engine is multi-viewport-correct (never reads window.VIEWER for
     * domain logic).
     */
    class MeasurementEngine {
        constructor({ annotations } = {}) {
            this.annotations = annotations || global.OSDAnnotations?.instance?.();
            this._activeController = null;
            this.lastConfig = {
                source: 'background-raw',
                channel: 'V',
                // 'auto' → Otsu per-annotation. A fixed number never fits
                // arbitrary stains/colormaps; auto separates signal from
                // background from each region's own histogram.
                threshold: 'auto',
                targetMpp: DEFAULT_TARGET_MPP,
            };
        }

        _annots() {
            return this.annotations || (this.annotations = global.OSDAnnotations?.instance?.());
        }

        _notifyUpdated() {
            try {
                const wrappers = global.OSDAnnotations?.FabricWrapper?.instances?.() || [];
                for (const w of wrappers) w?.raiseEvent?.('annotation-measurements-updated');
            } catch { /* non-fatal */ }
        }

        // Force the live viewer to render current tiles once, so the off-screen
        // standalone drawer has warm textures/tiles to sample. Without this the
        // first measurement after opening the tool reads an empty frame — the
        // "must zoom first before anything runs" symptom (a zoom triggers the
        // same render). Cheap and idempotent; resolves after two frames.
        async _warmViewer(viewer) {
            if (!viewer) return;
            try {
                viewer.forceRedraw?.();
                await new Promise((r) => {
                    const raf = global.requestAnimationFrame || ((f) => setTimeout(f, 16));
                    raf(() => raf(r));
                });
            } catch { /* non-fatal */ }
        }

        // ─── geometric metrics (zoom-independent) ─────────────────────────────

        /**
         * Area + length in slide px AND physical units (µm²/mm², µm) when the
         * viewer's slide is calibrated. This is the authoritative geometric
         * readout the board / popover / workspace all share.
         */
        getGeometric(viewer, object) {
            const annots = this._annots();
            const areaPx = NS.geometry.areaOf(annots, object);
            const factory = annots?.getAnnotationObjectFactory?.(object?.factoryID);
            const lengthPx = factory && typeof factory.getLength === 'function'
                ? asFinite(factory.getLength(object)) : NaN;
            const conv = NS.geometry.unitConverter(viewer);
            return {
                areaImagePx: areaPx,
                lengthImagePx: lengthPx,
                hasPhysical: conv.hasPhysical,
                areaUm2: conv.areaImagePxToUm2(areaPx),
                areaMm2: conv.areaImagePxToMm2(areaPx),
                lengthUm: conv.lengthImagePxToUm(lengthPx),
                areaLabel: conv.formatArea(areaPx),
                lengthLabel: Number.isFinite(lengthPx) ? conv.formatLength(lengthPx) : null,
            };
        }

        /** area(numerator) / area(denominator), unit-free and exact. */
        areaRatio(viewer, numerator, denominator) {
            return NS.geometry.areaRatio(this._annots(), numerator, denominator);
        }

        /** annotation area / summed area of a denominator set (e.g. tissue layer). */
        areaRatioAgainstSet(viewer, numerator, denominators) {
            return NS.geometry.areaRatioAgainstSet(this._annots(), numerator, denominators);
        }

        /** per-preset area breakdown of annotations contained in `parent`. */
        composition(viewer, parent, candidates, presetLabelOf) {
            const res = NS.geometry.presetComposition(this._annots(), parent, candidates, presetLabelOf);
            if (!res) return null;
            const conv = NS.geometry.unitConverter(viewer);
            res.parentAreaUm2 = conv.areaImagePxToUm2(res.parentAreaPx);
            for (const row of res.rows) {
                row.areaUm2 = conv.areaImagePxToUm2(row.areaPx);
                row.areaLabel = conv.formatArea(row.areaPx);
            }
            return res;
        }

        /** nearest boundary distance from `from` to a target set, in px + µm. */
        nearestDistance(viewer, from, targets) {
            const res = NS.geometry.nearestDistance(this._annots(), from, targets);
            if (!res) return null;
            const conv = NS.geometry.unitConverter(viewer);
            res.distanceUm = conv.lengthImagePxToUm(res.distancePx);
            res.distanceLabel = conv.formatLength(res.distancePx);
            return res;
        }

        // ─── raster sampling + intensity ──────────────────────────────────────

        _chooseDownscale(viewer, bbox, targetMpp) {
            const imageMpp = NS.sampler.imageMppPerPx(viewer);
            if (imageMpp && targetMpp && targetMpp > 0) {
                // downscale = output-px covers this many slide px = targetMpp/imageMpp
                return Math.max(1, targetMpp / imageMpp);
            }
            // No calibration → sample near native, letting the pixel cap shrink
            // oversized regions inside the sampler.
            return 1;
        }

        /**
         * Deterministically sample the region under `object` and build the
         * polygon mask at the SAME output resolution, so intensity/component
         * indices align. Returns null on unsupported shape; `{reason}` on a
         * sampling miss.
         */
        async sampleAndMask(viewer, object, cfg, signal) {
            const bbox = NS.rasterizer.annotationBboxImagePx(object);
            if (!bbox) return { reason: 'unsupported-shape' };

            const targetMpp = Number.isFinite(cfg?.targetMpp) ? cfg.targetMpp : this.lastConfig.targetMpp;
            const downscale = this._chooseDownscale(viewer, bbox, targetMpp);

            const sample = await NS.sampler.sampleRegion(viewer, bbox, {
                downscale,
                source: cfg?.source || 'background-raw',
                maxPixels: DEFAULT_MAX_PIXELS,
                signal,
            });
            if (!sample || !sample.rgba) return { reason: sample?.reason || 'no-sample' };

            const w = sample.width, h = sample.height;
            if (Math.max(w, h) < MIN_USEFUL_SIDE) return { reason: 'too-small' };

            // Rasterize the mask at the exact sampled resolution using the
            // sampler's effective downscale (the sampler may have shrunk to fit
            // the cap), so mask and pixels are the same grid — no truncation hack.
            const maskResult = NS.rasterizer.rasterizePolygonMaskAt(object, bbox, w, h);
            if (!maskResult) return { reason: 'unsupported-shape' };

            // Gate the mask by the render's alpha: pixels the drawer did NOT
            // paint (no tile loaded, outside image bounds, transparent overlay)
            // must not count as intensity-0 — that silently drags mean/median
            // down and empties the positivity/component thresholds. Only pixels
            // that are both inside the polygon AND actually rendered are kept.
            const rgba = sample.rgba;
            const mask = maskResult.mask;
            let covered = 0;
            for (let i = 0, a = 3; i < mask.length; i++, a += 4) {
                if (mask[i] && rgba[a] > COVERAGE_ALPHA) covered++;
                else mask[i] = 0;
            }
            if (covered === 0) return { reason: 'no-coverage' };

            const intensities = NS.sampler.projectChannel(rgba, cfg?.channel || 'L');
            return {
                bbox,
                width: w,
                height: h,
                effectiveDownscale: sample.downscale,
                mask,
                coveredPixels: covered,
                intensities,
                source: sample.source,
            };
        }

        // Resolve a config threshold to a concrete number: 'auto' (or a
        // non-finite value) → Otsu on the masked values, falling back to 128
        // only when Otsu can't split (empty / single-valued).
        _resolveThreshold(cfg, maskedValues) {
            const t = cfg?.threshold;
            if (Number.isFinite(t)) return t;
            const otsu = NS.stats.otsuThreshold(maskedValues);
            return Number.isFinite(otsu) ? otsu : 128;
        }

        /** intensity stats (mean/median/%+/histogram) over the masked region. */
        async computeIntensity(viewer, object, cfg, signal) {
            const s = await this.sampleAndMask(viewer, object, cfg, signal);
            if (s.reason) return s;
            const vals = [];
            const n = s.mask.length;
            for (let i = 0; i < n; i++) if (s.mask[i]) vals.push(s.intensities[i]);
            const arr = Float32Array.from(vals);
            const threshold = this._resolveThreshold(cfg, arr);
            return {
                source: s.source,
                channel: cfg?.channel || 'V',
                pixelCount: arr.length,
                mean: NS.stats.mean(arr),
                median: NS.stats.median(arr),
                histogram: NS.stats.histogram(arr, 64, [0, 255]),
                threshold,
                thresholdAuto: !Number.isFinite(cfg?.threshold),
                percentPositive: NS.stats.percentPositive(arr, threshold),
                effectiveDownscale: s.effectiveDownscale,
            };
        }

        /**
         * Connected-component metrics with PHYSICAL units. Component areas and
         * perimeters are converted from raster px (at the effective downscale)
         * to µm²/µm via the slide MPP; density is components per mm² of the
         * annotation region.
         */
        async computeComponents(viewer, object, cfg, signal) {
            const s = await this.sampleAndMask(viewer, object, cfg, signal);
            if (s.reason) return s;

            // Resolve threshold from the masked values (Otsu when auto).
            const masked = [];
            for (let i = 0; i < s.mask.length; i++) if (s.mask[i]) masked.push(s.intensities[i]);
            const threshold = this._resolveThreshold(cfg, Float32Array.from(masked));

            const total = s.mask.length;
            const bin = new Uint8Array(total);
            for (let i = 0; i < total; i++) {
                if (s.mask[i] && s.intensities[i] >= threshold) bin[i] = 1;
            }
            const labels = NS.components.labelConnected(bin, s.width, s.height);
            let stats = NS.components.componentStats(labels);
            stats = this._applySizeFilter(stats, cfg);

            // Physical-unit conversion. One raster px covers effectiveDownscale²
            // slide px²; slide px → µm via MPP.
            const imageMpp = NS.sampler.imageMppPerPx(viewer);
            const ds = s.effectiveDownscale || 1;
            const um2PerRasterPx = (imageMpp && imageMpp > 0) ? (imageMpp * ds) * (imageMpp * ds) : NaN;
            const umPerRasterPx = (imageMpp && imageMpp > 0) ? (imageMpp * ds) : NaN;

            const maskedRasterPx = this._countMask(s.mask);
            const regionMm2 = Number.isFinite(um2PerRasterPx) ? (maskedRasterPx * um2PerRasterPx) / 1e6 : NaN;
            const densityPerMm2 = (Number.isFinite(regionMm2) && regionMm2 > 0) ? stats.count / regionMm2 : NaN;

            return {
                source: s.source,
                channel: cfg?.channel || 'L',
                threshold,
                count: stats.count,
                meanAreaPx: stats.meanArea,
                medianAreaPx: stats.medianArea,
                meanAreaUm2: Number.isFinite(um2PerRasterPx) ? stats.meanArea * um2PerRasterPx : NaN,
                medianAreaUm2: Number.isFinite(um2PerRasterPx) ? stats.medianArea * um2PerRasterPx : NaN,
                meanPerimeterUm: Number.isFinite(umPerRasterPx) ? this._mean(stats.perimeters) * umPerRasterPx : NaN,
                circularities: stats.circularities,
                densityPerMm2,
                regionMm2,
                effectiveDownscale: ds,
            };
        }

        _applySizeFilter(stats, cfg) {
            const minSize = (cfg?.minSize | 0);
            const maxSize = cfg?.maxSize ? (cfg.maxSize | 0) : 0;
            if (minSize <= 1 && !maxSize) return stats;
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
            const out = { ...stats, sizes, perimeters, circularities, count: keep.length };
            if (sizes.length) {
                out.meanArea = this._mean(sizes);
                const sorted = Array.from(sizes).sort((a, b) => a - b);
                out.medianArea = sorted[Math.floor(0.5 * (sorted.length - 1))];
            } else {
                out.meanArea = out.medianArea = NaN;
            }
            return out;
        }

        _mean(arr) {
            if (!arr || !arr.length) return NaN;
            let s = 0;
            for (let i = 0; i < arr.length; i++) s += arr[i];
            return s / arr.length;
        }

        _countMask(mask) {
            let c = 0;
            for (let i = 0; i < mask.length; i++) if (mask[i]) c++;
            return c;
        }

        // ─── single-object convenience + cache ────────────────────────────────

        /**
         * Compute the requested metrics for one object with the last-used (or
         * supplied) config, merge into the on-object cache, and notify boards.
         * The one code path used by the popover, workspace, and scripting.
         */
        async computeForObject(viewer, object, opts = {}) {
            const cfg = this._mergeConfig(opts);
            // Warm once for standalone calls (popover); runForScope warms up-front
            // and passes _warmed so we don't redraw per object.
            if (!opts._warmed) await this._warmViewer(viewer);
            const merge = {};
            let reason = null;
            try {
                if (opts.includeComponents) {
                    const comp = await this.computeComponents(viewer, object, cfg, opts.signal);
                    if (comp.reason) reason = comp.reason; else merge.components = comp;
                }
                const intensity = await this.computeIntensity(viewer, object, cfg, opts.signal);
                if (intensity.reason) reason = reason || intensity.reason;
                else {
                    merge.mean = intensity.mean;
                    merge.median = intensity.median;
                    merge.percentPositive = intensity.percentPositive;
                    merge.pixelCount = intensity.pixelCount;
                    merge.threshold = intensity.threshold;
                    merge.histogram = intensity.histogram;
                }
            } catch (err) {
                if (err?.name === 'AbortError') reason = 'aborted';
                else reason = (err && err.message) || String(err);
            }
            if (Object.keys(merge).length) this._mergeCache(object, cfg, merge);
            this._notifyUpdated();
            return { merged: Object.keys(merge), reason };
        }

        _mergeConfig(opts) {
            const threshold = (opts.threshold === 'auto' || Number.isFinite(opts.threshold))
                ? opts.threshold : this.lastConfig.threshold;
            const cfg = {
                source: opts.source || this.lastConfig.source,
                channel: opts.channel || this.lastConfig.channel,
                threshold,
                targetMpp: Number.isFinite(opts.targetMpp) ? opts.targetMpp : this.lastConfig.targetMpp,
                minSize: opts.minSize,
                maxSize: opts.maxSize,
            };
            this.lastConfig = { ...this.lastConfig, ...cfg };
            return cfg;
        }

        getCached(object, cfg) {
            const slot = object?._measurements?.[slotKey(cfg)];
            if (!slot) return null;
            if (slot.geomVersion !== geometryVersion(object)) return null;
            return slot;
        }

        _mergeCache(object, cfg, partial) {
            if (!object) return;
            const key = slotKey(cfg);
            if (!object._measurements) object._measurements = {};
            const existing = (object._measurements[key]?.geomVersion === geometryVersion(object))
                ? object._measurements[key] : {};
            object._measurements[key] = {
                ...existing,
                ...partial,
                geomVersion: geometryVersion(object),
                slotKey: key,
                source: cfg.source,
                channel: cfg.channel,
                computedAt: Date.now(),
            };
        }

        clearCacheFor(object) {
            if (object && object._measurements) object._measurements = {};
        }

        clearAllCaches() {
            const fabrics = global.OSDAnnotations?.FabricWrapper?.instances?.() || [];
            for (const f of fabrics) {
                const objs = f?.canvas?.getObjects?.() || [];
                for (const o of objs) if (o && o._measurements) o._measurements = {};
            }
        }

        // ─── batch run over a scope, with real cancellation ───────────────────

        /**
         * Run one metric set over a scope of annotations in a viewer. Returns
         * { done, total, aborted, errors }. Cancel via {@link cancelActiveRun}.
         */
        async runForScope(viewer, { scope, includeComponents, source, channel, threshold, targetMpp, minSize, maxSize, onProgress } = {}) {
            if (this._activeController) {
                throw new Error('Another measurement run is already in progress.');
            }
            const controller = new AbortController();
            this._activeController = controller;
            const signal = controller.signal;
            const cfg = this._mergeConfig({ source, channel, threshold, targetMpp, minSize, maxSize });

            const objects = this._collectScope(viewer, scope);
            const total = objects.length;
            const errors = [];
            let done = 0;
            await this._warmViewer(viewer);
            try {
                for (let i = 0; i < total; i++) {
                    if (signal.aborted) break;
                    const obj = objects[i];
                    try {
                        const res = await this.computeForObject(viewer, obj, {
                            ...cfg, includeComponents, signal, _warmed: true,
                        });
                        if (res.reason && !res.merged.length) errors.push({ object: obj, reason: res.reason });
                    } catch (err) {
                        errors.push({ object: obj, reason: err?.name === 'AbortError' ? 'aborted' : (err?.message || String(err)) });
                    }
                    done++;
                    onProgress?.({ done, total });
                    if ((i % BATCH_YIELD_EVERY) === BATCH_YIELD_EVERY - 1) {
                        await new Promise((r) => requestAnimationFrame(r));
                    }
                }
            } finally {
                this._activeController = null;
            }
            return { done, total, aborted: signal.aborted, errors };
        }

        cancelActiveRun() {
            this._activeController?.abort();
            this._activeController = null;
        }

        _collectScope(viewer, scope) {
            if (!scope) return [];
            if (scope.kind === 'list' && Array.isArray(scope.list)) return scope.list.filter(Boolean);

            const annots = this._annots();
            const fabric = viewer ? annots?.getFabric?.(viewer) : null;
            const fabrics = fabric ? [fabric] : (global.OSDAnnotations?.FabricWrapper?.instances?.() || []);
            const out = [];
            for (const f of fabrics) {
                const objs = f?.canvas?.getObjects?.() || [];
                for (const o of objs) {
                    if (!f.isAnnotation?.(o)) continue;
                    if (scope.kind === 'preset' && o.presetID !== scope.presetID) continue;
                    if (scope.kind === 'selection') {
                        const sel = new Set((f.getSelectedAnnotations?.() || []).map((s) => s?.incrementId));
                        if (!sel.has(o.incrementId)) continue;
                    }
                    if (scope.kind === 'visible' && !this._isVisibleInViewer(viewer, o)) continue;
                    out.push(o);
                }
            }
            return out;
        }

        _isVisibleInViewer(viewer, o) {
            const vp = viewer?.viewport;
            const image = viewer?.scalebar?.getReferencedTiledImage?.() || viewer?.world?.getItemAt?.(0);
            if (!vp || !image) return true;
            const r = o.getBoundingRect?.(true, true);
            if (!r) return true;
            const tl = image.imageToViewportCoordinates(r.left, r.top);
            const br = image.imageToViewportCoordinates(r.left + r.width, r.top + r.height);
            const b = vp.getBounds();
            return !(br.x < b.x || br.y < b.y || tl.x > b.x + b.width || tl.y > b.y + b.height);
        }
    }

    NS.MeasurementEngine = MeasurementEngine;
    NS.geometryVersion = geometryVersion;
    NS.slotKey = slotKey;
})(typeof window !== 'undefined' ? window : globalThis);
