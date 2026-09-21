(function (global) {
    'use strict';

    const NS = global.AnnotationMeasurements = global.AnnotationMeasurements || {};

    /**
     * Compute the slide-pixel bounding box of a fabric annotation.
     * Returns {x, y, width, height} in image (slide) pixel coordinates,
     * or null if the geometry can't be expressed as a slide-aligned bbox.
     */
    function annotationBboxImagePx(object) {
        if (!object) return null;
        // Fabric's getBoundingRect returns canvas pixel coords; for image coords
        // we use the object's own left/top + width*scale (annotations are
        // authored directly in image px and never canvas-transformed at edit time
        // in this module).
        const rect = (typeof object.getBoundingRect === 'function')
            ? object.getBoundingRect(true, true)
            : null;
        if (!rect) return null;
        return {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
        };
    }

    /**
     * Choose a downscale factor so the longer side ≤ maxSide.
     * Returns 1 (no downscale) when bbox is small enough.
     */
    function chooseDownscale(width, height, maxSide) {
        const longer = Math.max(width, height);
        if (longer <= maxSide) return 1;
        return longer / maxSide;
    }

    /**
     * Rasterize a fabric polygon-like annotation into a binary mask.
     * - bbox: {x, y, width, height} in slide px (typically from annotationBboxImagePx)
     * - downscale: ≥1 (output px = slide px / downscale)
     * Returns { mask: Uint8Array (1 inside / 0 outside), width, height, downscale }
     * or null when the shape is not rasterizable.
     */
    function rasterizePolygonMask(object, bbox, downscale) {
        const w = Math.max(1, Math.round(bbox.width / downscale));
        const h = Math.max(1, Math.round(bbox.height / downscale));
        return rasterizePolygonMaskAt(object, bbox, w, h);
    }

    /**
     * Rasterize into an explicit w×h grid covering `bbox` in slide px. Used by
     * the engine so the mask grid exactly matches the sampler's output
     * dimensions (which may have been shrunk to satisfy the pixel cap),
     * eliminating the old 1-px mask/sample realignment hack.
     */
    /**
     * The shape's outline(s) in image coordinates, via its factory.
     *
     * This is the same call `geometry-metrics.ringsForObject` makes, and using it
     * here is the point: the mask and the geometry now come from one source and
     * cannot disagree. It replaces per-shape sniffing that drew everything
     * axis-aligned — the rect branch ignored `angle`, the ellipse branch passed a
     * hard-coded rotation of 0, and multipolygon fell into the polygon branch and
     * read `.x` off an array of rings, producing NaN coordinates.
     *
     * @return {Array<Array<{x,y}>>|null} one ring per sub-path (outer first)
     */
    function outlineRings(object) {
        const annotations = global.OSDAnnotations?.instance?.();
        const factory = annotations?.getAnnotationObjectFactory?.(object?.factoryID);
        if (!factory || typeof factory.toPointArray !== 'function') return null;

        let pts;
        try {
            pts = factory.toPointArray(
                object, global.OSDAnnotations.AnnotationObjectFactory.withObjectPoint, undefined, 1);
        } catch (e) {
            return null;
        }
        if (!Array.isArray(pts) || !pts.length) return null;
        // Multipolygon answers with rings-of-rings; everything else with one ring.
        const rings = Array.isArray(pts[0]) ? pts : [pts];
        const usable = rings.filter(r => Array.isArray(r) && r.length >= 3);
        return usable.length ? usable : null;
    }

    function rasterizePolygonMaskAt(object, bbox, w, h) {
        if (!object || !bbox || !(bbox.width > 0) || !(bbox.height > 0)) return null;
        w = Math.max(1, w | 0);
        h = Math.max(1, h | 0);

        const canvas = (typeof OffscreenCanvas === 'function')
            ? new OffscreenCanvas(w, h)
            : Object.assign(document.createElement('canvas'), { width: w, height: h });
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.fillStyle = '#fff';
        ctx.beginPath();

        // Independent x/y scale from slide px → mask px so a shrunk-to-cap
        // sample (non-uniform rounding) still maps exactly onto the grid.
        const sxMap = w / bbox.width;
        const syMap = h / bbox.height;
        const mapX = (x) => (x - bbox.x) * sxMap;
        const mapY = (y) => (y - bbox.y) * syMap;
        const downscale = bbox.width / w;

        const rings = outlineRings(object);
        if (!rings) return null;
        for (const ring of rings) {
            ctx.moveTo(mapX(ring[0].x), mapY(ring[0].y));
            for (let i = 1; i < ring.length; i++) {
                ctx.lineTo(mapX(ring[i].x), mapY(ring[i].y));
            }
            ctx.closePath();
        }

        // even-odd so a multipolygon's inner rings punch holes rather than filling
        // them; with a single ring it is identical to nonzero.
        ctx.fill('evenodd');

        // Read back. We use the alpha channel as the mask: 255 inside, 0 outside.
        const data = ctx.getImageData(0, 0, w, h).data;
        const mask = new Uint8Array(w * h);
        for (let i = 0, j = 3; i < mask.length; i++, j += 4) {
            mask[i] = data[j] >= 128 ? 1 : 0;
        }
        return { mask, width: w, height: h, downscale };
    }

    NS.rasterizer = {
        annotationBboxImagePx,
        chooseDownscale,
        rasterizePolygonMask,
        rasterizePolygonMaskAt,
    };
})(typeof window !== 'undefined' ? window : globalThis);
