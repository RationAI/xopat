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
     * Returns { mask: Uint8Array (0 / 255 in alpha), width, height, downscale }
     * or null when the shape is not rasterizable.
     */
    function rasterizePolygonMask(object, bbox, downscale) {
        if (!object || !bbox || !(bbox.width > 0) || !(bbox.height > 0)) return null;
        const w = Math.max(1, Math.round(bbox.width / downscale));
        const h = Math.max(1, Math.round(bbox.height / downscale));

        const canvas = (typeof OffscreenCanvas === 'function')
            ? new OffscreenCanvas(w, h)
            : Object.assign(document.createElement('canvas'), { width: w, height: h });
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.fillStyle = '#fff';
        ctx.beginPath();

        // Map slide px → mask px (translate by bbox origin, divide by downscale).
        const mapX = (x) => (x - bbox.x) / downscale;
        const mapY = (y) => (y - bbox.y) / downscale;

        let drew = false;
        if (Array.isArray(object.points) && object.points.length) {
            // Polygon / polyline. fabric's points are relative to pathOffset; we
            // honor the object-level transform by adding object.left / top first.
            const ox = (object.left || 0) - (object.pathOffset?.x || 0) * (object.scaleX || 1);
            const oy = (object.top || 0) - (object.pathOffset?.y || 0) * (object.scaleY || 1);
            const sx = object.scaleX || 1;
            const sy = object.scaleY || 1;
            const pts = object.points;
            ctx.moveTo(mapX(ox + pts[0].x * sx), mapY(oy + pts[0].y * sy));
            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(mapX(ox + pts[i].x * sx), mapY(oy + pts[i].y * sy));
            }
            ctx.closePath();
            drew = true;
        } else if (object.type === 'rect') {
            const x0 = mapX(object.left || 0);
            const y0 = mapY(object.top || 0);
            const ww = (object.width || 0) * (object.scaleX || 1) / downscale;
            const hh = (object.height || 0) * (object.scaleY || 1) / downscale;
            ctx.rect(x0, y0, ww, hh);
            drew = true;
        } else if (object.type === 'ellipse' || object.type === 'circle') {
            const rx = (object.rx ?? object.radius ?? 0) * (object.scaleX || 1) / downscale;
            const ry = (object.ry ?? object.radius ?? 0) * (object.scaleY || 1) / downscale;
            const cx = mapX((object.left || 0) + rx * downscale);
            const cy = mapY((object.top || 0) + ry * downscale);
            if (typeof ctx.ellipse === 'function') {
                ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
                drew = true;
            }
        }

        if (!drew) return null;
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
    };
})(typeof window !== 'undefined' ? window : globalThis);
