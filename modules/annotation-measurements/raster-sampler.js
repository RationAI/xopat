(function (global) {
    'use strict';

    const NS = global.AnnotationMeasurements = global.AnnotationMeasurements || {};

    // Channel extraction. Rendered RGBA is Uint8Clamped; we project to a single
    // Float32Array in [0, 255]. Luminance uses Rec. 709 weights.
    function projectChannel(rgba, channel) {
        const n = rgba.length / 4 | 0;
        const out = new Float32Array(n);
        switch (channel) {
            case 'R': for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = rgba[j]; break;
            case 'G': for (let i = 0, j = 1; i < n; i++, j += 4) out[i] = rgba[j]; break;
            case 'B': for (let i = 0, j = 2; i < n; i++, j += 4) out[i] = rgba[j]; break;
            case 'A': for (let i = 0, j = 3; i < n; i++, j += 4) out[i] = rgba[j]; break;
            case 'L':
            default:
                for (let i = 0, j = 0; i < n; i++, j += 4) {
                    out[i] = 0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2];
                }
                break;
        }
        return out;
    }

    /**
     * Sample the rendered viewport for a slide-px bbox via the standalone
     * flex-renderer (VisualizationAPI). The pixels we read are exactly what
     * the user sees: same shaders, blending, and visualization order. No
     * manual tile stitching, no raw-pyramid guesswork.
     *
     * When the annotation bbox is only partially inside the viewport we sample
     * the intersection: callers receive `bbox` (the clipped slide-px rect we
     * actually sampled) and `coveragePct` (clipped area / requested area), so
     * masks and aggregates can stay aligned with the partial pixels. Zero
     * overlap still returns `{ rgba: null, reason: 'out-of-viewport' }`.
     *
     * @param {object} api          VisualizationAPI instance for the active viewer.
     * @param {object} viewer       OpenSeadragon viewer that owns the bbox.
     * @param {{x,y,width,height}} bboxImagePx  Slide-pixel bbox of the annotation.
     * @param {{width,height}} outputSize       Target rasterization size for the
     *                                          full bbox; output is scaled if
     *                                          the visible region is smaller.
     * @param {object} [vizSource]  Optional visualization override; defaults to
     *                              `api.getActiveVisualization()` so we measure
     *                              the exact visualization on display.
     */
    async function sampleRenderedRegion(api, viewer, bboxImagePx, outputSize, vizSource) {
        if (!api || !viewer || !bboxImagePx) return null;
        const vp = viewer.viewport;
        const image = viewer?.scalebar?.getReferencedTiledImage?.()
            || viewer?.world?.getItemAt?.(0);
        if (!vp || !image) return null;
        if (!(bboxImagePx.width > 0) || !(bboxImagePx.height > 0)) return null;

        // Slide bbox → viewport coords → viewer-element (canvas) px. The
        // standalone drawer renders the same viewport rect as the active
        // viewer, so we crop in canvas-px space.
        const tlVp = image.imageToViewportCoordinates(bboxImagePx.x, bboxImagePx.y);
        const brVp = image.imageToViewportCoordinates(
            bboxImagePx.x + bboxImagePx.width,
            bboxImagePx.y + bboxImagePx.height
        );
        const visibleVp = vp.getBounds();

        // Intersect the annotation rect with the viewport rect (in viewport
        // coords) so partial annotations still get sampled. Zero overlap means
        // the annotation is entirely off-screen → caller should pan/zoom.
        const ix = Math.max(tlVp.x, visibleVp.x);
        const iy = Math.max(tlVp.y, visibleVp.y);
        const ax = Math.min(brVp.x, visibleVp.x + visibleVp.width);
        const ay = Math.min(brVp.y, visibleVp.y + visibleVp.height);
        if (!(ax > ix) || !(ay > iy)) {
            return { rgba: null, width: 0, height: 0, reason: 'out-of-viewport' };
        }

        const isClipped = (ix > tlVp.x) || (iy > tlVp.y) || (ax < brVp.x) || (ay < brVp.y);

        // Project the (possibly clipped) viewport rect back to image-px so the
        // engine can rebuild the polygon mask against the same region we
        // actually sampled.
        let clippedBbox = bboxImagePx;
        if (isClipped) {
            const tlImg = image.viewportToImageCoordinates(ix, iy);
            const brImg = image.viewportToImageCoordinates(ax, ay);
            clippedBbox = {
                x: Math.min(tlImg.x, brImg.x),
                y: Math.min(tlImg.y, brImg.y),
                width: Math.abs(brImg.x - tlImg.x),
                height: Math.abs(brImg.y - tlImg.y),
            };
        }

        // OSD's pixelFromPoint expects real OpenSeadragon.Point instances
        // (it calls .rotate / .minus on them), not plain {x,y} objects.
        const Point = global.OpenSeadragon?.Point;
        const tlCanvas = vp.viewportToViewerElementCoordinates(Point ? new Point(ix, iy) : { x: ix, y: iy });
        const brCanvas = vp.viewportToViewerElementCoordinates(Point ? new Point(ax, ay) : { x: ax, y: ay });
        const x = Math.max(0, Math.min(tlCanvas.x, brCanvas.x));
        const y = Math.max(0, Math.min(tlCanvas.y, brCanvas.y));
        const regionWidth = Math.max(1, Math.abs(brCanvas.x - tlCanvas.x));
        const regionHeight = Math.max(1, Math.abs(brCanvas.y - tlCanvas.y));

        // Scale the requested output size to match the clipped portion, keeping
        // per-pixel slide resolution roughly equal to what the caller asked for
        // on the full bbox.
        const fullW = Math.max(1, outputSize.width | 0);
        const fullH = Math.max(1, outputSize.height | 0);
        const wScale = isClipped ? (clippedBbox.width / bboxImagePx.width) : 1;
        const hScale = isClipped ? (clippedBbox.height / bboxImagePx.height) : 1;
        const w = Math.max(1, Math.round(fullW * wScale));
        const h = Math.max(1, Math.round(fullH * hScale));

        const fullArea = bboxImagePx.width * bboxImagePx.height;
        const clippedArea = clippedBbox.width * clippedBbox.height;
        const coveragePct = (fullArea > 0) ? (clippedArea / fullArea) : 1;

        // Default to whatever the user is looking at right now. Callers can
        // still inject an explicit visualization (e.g. a scripted alternate
        // shader) via `channel.vizSource`.
        let visualization = vizSource;
        if (!visualization) {
            visualization = (typeof api.getActiveVisualization === 'function')
                ? api.getActiveVisualization()
                : null;
        }
        if (!visualization) {
            return { rgba: null, width: 0, height: 0, reason: 'no-active-visualization' };
        }

        let result;
        try {
            result = await api.renderCurrentViewportPixels(visualization, {
                x, y, regionWidth, regionHeight, width: w, height: h, maxPixels: w * h + 16,
            });
        } catch (err) {
            return { rgba: null, width: 0, height: 0, reason: (err && err.message) || 'render-failed' };
        }
        if (!result || !result.data) {
            return { rgba: null, width: 0, height: 0, reason: 'render-empty' };
        }
        const rgba = new Uint8ClampedArray(result.data);
        return {
            rgba,
            width: result.width,
            height: result.height,
            bbox: clippedBbox,
            coveragePct,
        };
    }

    NS.sampler = {
        projectChannel,
        sampleRenderedRegion,
    };
})(typeof window !== 'undefined' ? window : globalThis);
