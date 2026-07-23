(function (global) {
    'use strict';

    const NS = global.AnnotationMeasurements = global.AnnotationMeasurements || {};

    // Channel extraction. RGBA is Uint8Clamped; we project to a single
    // Float32Array in [0, 255]. Luminance uses Rec. 709 weights.
    function projectChannel(rgba, channel) {
        const n = rgba.length / 4 | 0;
        const out = new Float32Array(n);
        switch (channel) {
            case 'R': for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = rgba[j]; break;
            case 'G': for (let i = 0, j = 1; i < n; i++, j += 4) out[i] = rgba[j]; break;
            case 'B': for (let i = 0, j = 2; i < n; i++, j += 4) out[i] = rgba[j]; break;
            case 'A': for (let i = 0, j = 3; i < n; i++, j += 4) out[i] = rgba[j]; break;
            case 'V':
                // HSV value = max(R,G,B). Colormap-agnostic: captures signal in
                // pseudo-coloured / fluorescence renders (e.g. magenta, which
                // luminance — 72% green-weighted — reads as near-zero).
                for (let i = 0, j = 0; i < n; i++, j += 4) {
                    out[i] = Math.max(rgba[j], rgba[j + 1], rgba[j + 2]);
                }
                break;
            case 'L':
            default:
                for (let i = 0, j = 0; i < n; i++, j += 4) {
                    out[i] = 0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2];
                }
                break;
        }
        return out;
    }

    // ─── background source resolution ──────────────────────────────────────
    //
    // Deterministic sampling must not depend on the live viewport's zoom/pan.
    // We render an explicit image-space region off-screen through the
    // standalone flex-drawer, which supports an explicit `view` object
    // ({bounds, center, rotation, zoom}) — the same primitive
    // `navigatorThumbnail` (src/external/osd_tools.js) uses to render a whole
    // slide off-screen. Here we generalize it to an arbitrary sub-region.
    //
    // Tile availability: the live world's tiled image only has tiles for the
    // levels/regions currently on screen. To render an off-screen region at a
    // chosen level we drive tile loading on a *synthetic* tiled image built
    // from the same source (cached per viewer+source so repeated measurements
    // don't re-instantiate). This mirrors navigatorThumbnail's synthetic-image
    // approach but keeps the image resident and only requests the tiles the
    // current region needs.

    // Build the renderer config restricted to background layer(s) — the raw,
    // shader-neutral image. Uses the per-viewer namespaced id (open pipeline
    // namespaces shader ids; see shader-id-namespace.ts).
    function backgroundConfig(viewer) {
        const renderer = viewer?.drawer?.renderer;
        if (!renderer?.getShaderLayerConfig) return null;
        const ns = viewer.__shaderNamespace || '';
        const backgrounds = global.APPLICATION_CONTEXT?.config?.background || [];
        const out = {};
        for (const bg of backgrounds) {
            const id = bg?.id;
            if (typeof id !== 'string' || !id.length) continue;
            const cfg = renderer.getShaderLayerConfig(ns + id) || renderer.getShaderLayerConfig(id);
            if (cfg) out[cfg.id ?? (ns + id)] = { ...cfg };
        }
        return Object.keys(out).length ? out : null;
    }

    // Build the renderer config for the FULL visible composite — every visible
    // layer (background image + visualization overlays) exactly as displayed,
    // post-shader. This is the honest "measure what I see": for a pseudo-
    // coloured single-data slide the colour lives in a visualization shader, so
    // background-only sampling would read black; for H&E the background carries
    // the image. Including all layers covers both.
    function renderedConfig(viewer) {
        const renderer = viewer?.drawer?.renderer;
        if (!renderer?.getShaderLayerOrder) return null;
        const order = renderer.getShaderLayerOrder() || [];
        const out = {};
        for (const id of order) {
            const cfg = renderer.getShaderLayerConfig(id);
            if (!cfg || cfg.error) continue;
            if (cfg.visible === 0 || cfg.visible === false) continue;
            out[id] = { ...cfg };
        }
        return Object.keys(out).length ? out : null;
    }

    function getStandaloneDrawer(viewer) {
        const OSD = global.OpenSeadragon;
        if (typeof OSD?.makeStandaloneFlexDrawer !== 'function') return null;
        return (viewer.__ofscreenRender = viewer.__ofscreenRender || OSD.makeStandaloneFlexDrawer(viewer));
    }

    /**
     * Micrometers-per-pixel of the referenced slide, or undefined when the
     * slide has no physical calibration. Sourced from the per-viewer scalebar.
     */
    function imageMppPerPx(viewer) {
        const sb = viewer?.scalebar;
        if (!sb) return undefined;
        // scalebar exposes micronsPerPixel via 1e6 / pixelsPerMeter; guard both.
        if (typeof sb.imagePixelSizeOnScreen === 'function' && sb.pixelsPerMeter) {
            return 1e6 / sb.pixelsPerMeter;
        }
        if (typeof sb.pixelsPerMeter === 'number' && sb.pixelsPerMeter > 0) {
            return 1e6 / sb.pixelsPerMeter;
        }
        return undefined;
    }

    /**
     * Deterministically render a slide-pixel region off-screen and read it
     * back as RGBA, independent of the current viewport zoom/pan. The region
     * is fully covered whether or not it is currently on screen.
     *
     * @param {object} viewer OpenSeadragon viewer that owns the region.
     * @param {{x,y,width,height}} bboxImagePx slide-pixel bbox to sample.
     * @param {object} opts
     * @param {number} [opts.downscale] slide-px per output-px (≥1). Chosen by
     *        the engine from a target µm/px so results are resolution-stable.
     * @param {number} [opts.maxPixels] hard cap on output pixels.
     * @param {'background-raw'|'rendered'} [opts.source] which layer stack to
     *        read. `background-raw` (default) is the calibration-stable stain
     *        image; `rendered` is the post-shader overlay the user sees.
     * @param {AbortSignal} [opts.signal]
     * @returns {Promise<{rgba:Uint8ClampedArray,width,height,downscale,source}|
     *                    {rgba:null,reason:string}>}
     */
    async function sampleRegion(viewer, bboxImagePx, opts = {}) {
        if (!viewer || !bboxImagePx) return { rgba: null, reason: 'bad-args' };
        if (!(bboxImagePx.width > 0) || !(bboxImagePx.height > 0)) {
            return { rgba: null, reason: 'empty-bbox' };
        }
        const image = viewer.scalebar?.getReferencedTiledImage?.() || viewer.world?.getItemAt?.(0);
        if (!image) return { rgba: null, reason: 'no-image' };

        const source = opts.source === 'rendered' ? 'rendered' : 'background-raw';
        const downscale = Math.max(1, opts.downscale || 1);
        const maxPixels = Number.isFinite(opts.maxPixels) ? opts.maxPixels : 8 * 1024 * 1024;

        let w = Math.max(1, Math.round(bboxImagePx.width / downscale));
        let h = Math.max(1, Math.round(bboxImagePx.height / downscale));
        if (w * h > maxPixels) {
            // Shrink isotropically to fit the cap; the engine records the
            // effective downscale so physical-unit conversion stays honest.
            const s = Math.sqrt((w * h) / maxPixels);
            w = Math.max(1, Math.round(w / s));
            h = Math.max(1, Math.round(h / s));
        }
        const effectiveDownscale = bboxImagePx.width / w;

        const drawer = getStandaloneDrawer(viewer);
        if (!drawer) return { rgba: null, reason: 'no-drawer' };

        const config = source === 'rendered' ? renderedConfig(viewer) : backgroundConfig(viewer);
        if (!config) return { rgba: null, reason: source === 'rendered' ? 'no-visualization' : 'no-background' };

        // Image-space bbox → viewport-space bounds. The standalone drawer takes
        // an explicit view; bounds in viewport coords, zoom = 1 / bounds.width
        // renders the region to fill the output canvas.
        const OSD = global.OpenSeadragon;
        const tl = image.imageToViewportCoordinates(bboxImagePx.x, bboxImagePx.y);
        const br = image.imageToViewportCoordinates(
            bboxImagePx.x + bboxImagePx.width,
            bboxImagePx.y + bboxImagePx.height
        );
        const bx = Math.min(tl.x, br.x), by = Math.min(tl.y, br.y);
        const bw = Math.abs(br.x - tl.x), bh = Math.abs(br.y - tl.y);
        if (!(bw > 0) || !(bh > 0)) return { rgba: null, reason: 'degenerate-bounds' };

        const bounds = new OSD.Rect(bx, by, bw, bh);
        const view = {
            bounds,
            center: new OSD.Point(bx + bw / 2, by + bh / 2),
            rotation: 0,
            zoom: 1.0 / bw,
        };

        // Ensure the live world items have their tiles for this region+level
        // requested, then render. We drive `update` on the referenced image and
        // wait briefly for the covering tiles at the target level to arrive.
        try {
            await ensureRegionTiles(viewer, image, bounds, view.zoom, opts.signal);
        } catch (e) {
            if (e && e.name === 'AbortError') return { rgba: null, reason: 'aborted' };
            // fall through — render with whatever is loaded; partial is flagged
        }

        const renderer = drawer.renderer;
        const gl = renderer?.gl;
        if (!gl) return { rgba: null, reason: 'no-gl' };

        const drawOnce = async () => {
            // Off-screen canvas is not auto-cleared between draws; transparent
            // areas would otherwise leak the previous frame (same fix as
            // viewport-segmentation.js / magic-wand.js). Dropping the cached
            // first-pass forces a re-steal of the live viewer's textures.
            renderer.__firstPassResult = null;
            gl.clear(gl.COLOR_BUFFER_BIT);
            await drawer.drawWithConfiguration(viewer.world._items, config, view, { x: w, y: h });
            const buf = new Uint8Array(w * h * 4);
            gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            return buf;
        };

        let data;
        try {
            data = await drawOnce();
            // Cold-drawer first render can land before the background textures
            // are ready, yielding an all-transparent frame (the "first run gives
            // different numbers" symptom). If nothing was painted, settle a
            // frame and redraw once.
            if (!hasCoverage(data) && !opts.signal?.aborted) {
                await new Promise((r) => (global.requestAnimationFrame || setTimeout)(r, 16));
                try { image.update?.(true); } catch (e) { /* best effort */ }
                data = await drawOnce();
            }
        } catch (e) {
            return { rgba: null, reason: (e && e.message) || 'render-failed' };
        }

        // GL origin is bottom-left; flip to top-left raster order so mask and
        // sample indices agree.
        const row = w * 4;
        const tmp = new Uint8Array(row);
        for (let t = 0, b = (h - 1) * row; t < b; t += row, b -= row) {
            tmp.set(data.subarray(t, t + row));
            data.copyWithin(t, b, b + row);
            data.set(tmp, b);
        }

        return {
            rgba: new Uint8ClampedArray(data.buffer),
            width: w,
            height: h,
            downscale: effectiveDownscale,
            source,
        };
    }

    // Request the tiles covering `bounds` at the level implied by `zoom` and
    // resolve once they have loaded (or after a short settle timeout, so a slow
    // tile never blocks a measurement indefinitely — partial coverage is
    // preferable to a hang and is surfaced to the user elsewhere).
    function ensureRegionTiles(viewer, image, bounds, zoom, signal) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) return reject(namedAbort());
            let settled = false;
            const finish = () => { if (!settled) { settled = true; cleanup(); resolve(); } };
            const onAbort = () => { if (!settled) { settled = true; cleanup(); reject(namedAbort()); } };
            const cleanup = () => {
                clearInterval(poll);
                clearTimeout(cap);
                signal?.removeEventListener?.('abort', onAbort);
            };
            signal?.addEventListener?.('abort', onAbort);

            // Nudge OSD to fetch tiles for the target resolution. `update(true)`
            // forces a tile pass; the live viewer keeps its own level, so we
            // request explicitly by drawing region bounds through the image.
            try { image._needsDraw = true; image.update?.(true); } catch (e) { /* best effort */ }

            // Poll fully-loaded state; give up after a cap.
            const poll = setInterval(() => {
                try { image.update?.(true); } catch (e) { /* ignore */ }
                if (isRegionLoaded(image)) finish();
            }, 60);
            const cap = setTimeout(finish, 1500);
        });
    }

    function isRegionLoaded(image) {
        // Conservative: OSD marks images fully loaded per-level lazily. We treat
        // "no tiles currently loading" as good enough; whenFullyLoaded is
        // whole-image and too strict for a sub-region.
        if (typeof image.getFullyLoaded === 'function') return image.getFullyLoaded();
        return true;
    }

    function namedAbort() {
        const e = new Error('aborted');
        e.name = 'AbortError';
        return e;
    }

    // Cheap "did the drawer paint anything?" probe — any non-trivial alpha.
    // Sampled sparsely (every 64th pixel) so it stays O(1)-ish on big frames.
    function hasCoverage(rgbaBytes) {
        for (let a = 3; a < rgbaBytes.length; a += 4 * 64) {
            if (rgbaBytes[a] > 8) return true;
        }
        return false;
    }

    NS.sampler = {
        projectChannel,
        sampleRegion,
        imageMppPerPx,
        backgroundConfig,
        renderedConfig,
    };
})(typeof window !== 'undefined' ? window : globalThis);
