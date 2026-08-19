/**
 * Pure geometry over image-space bounds, polygons and masks.
 *
 * Nothing here touches a viewer, a driver or the DOM: every function is a
 * deterministic transform of its arguments, so the engine's coordinate work can be
 * tested without a browser or a slide. Coordinates are whatever space the caller
 * passes in — the engine works in parent-global level-0 image pixels for bounds and
 * in raster pixels for masks, and it is the caller's job not to mix them.
 */

import type { Bounds, MaskResult, Point } from "./types";

/** Shoelace polygon area (absolute). */
export function polygonArea(pts: Point[]): number {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
    }
    return Math.abs(a / 2);
}

/** Image-space bounding box over one or more polygons (nulls skipped). */
export function boundsOfPolygons(polys: Array<Point[] | null | undefined>): Bounds | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
    for (const poly of polys) {
        if (!poly) continue;
        for (const p of poly) {
            any = true;
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
    }
    if (!any) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Centre point of a bbox, or null. */
export function centerOf(b: Bounds | null): Point | null {
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
}

/** Ray-casting point-in-polygon test. */
export function pointInRing(x: number, y: number, ring: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
        if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
}

/** Intersect a bbox with the slide bounds; null when the overlap is negligible. */
export function clampBoundsToSlide(b: Bounds, slideW: number, slideH: number): Bounds | null {
    if (!(slideW > 0) || !(slideH > 0)) return b;
    const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y);
    const x1 = Math.min(slideW, b.x + b.width), y1 = Math.min(slideH, b.y + b.height);
    const w = x1 - x0, h = y1 - y0;
    if (!(w > 0) || !(h > 0)) return null;
    return { x: x0, y: y0, width: w, height: h };
}

/**
 * Pad a bbox by `padding` (fraction of each dimension, both sides) and clamp it to the
 * slide when its extent is known. The result is what actually gets rendered, so callers
 * must quote and map against the RETURNED bounds, not the input.
 *
 * Degrades to the input bounds rather than throwing: a padding that collapses the box is
 * a caller bug, but losing the region over it would lose the analysis too.
 */
export function padBounds(bounds: Bounds, padding: number, slideW = 0, slideH = 0): Bounds {
    let x0 = bounds.x - bounds.width * padding;
    let y0 = bounds.y - bounds.height * padding;
    let x1 = bounds.x + bounds.width * (1 + padding);
    let y1 = bounds.y + bounds.height * (1 + padding);
    if (slideW > 0 && slideH > 0) {
        x0 = Math.max(0, x0); y0 = Math.max(0, y0);
        x1 = Math.min(slideW, x1); y1 = Math.min(slideH, y1);
    }
    if (!(x1 - x0 > 0) || !(y1 - y0 > 0)) return bounds;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Split a mask into an N×N grid, keeping only cells that actually contain tissue, and
 * map each cell rect through `mapPoint` into the caller's coordinate space.
 *
 * Used where the tissue is one contiguous mass and contour islands would hand back a
 * reframe of the same box instead of genuinely smaller children.
 */
export function gridSplitTissue(
    mask: MaskResult,
    mapPoint: (px: number, py: number) => Point,
    n = 3,
    minFill = 0.05
): Array<{ bounds: Bounds; areaFraction: number }> {
    const total = mask.width * mask.height || 1;
    const cw = mask.width / n, ch = mask.height / n;
    const cells: Array<{ bounds: Bounds; areaFraction: number }> = [];
    for (let gy = 0; gy < n; gy++) {
        for (let gx = 0; gx < n; gx++) {
            const x0 = Math.floor(gx * cw), y0 = Math.floor(gy * ch);
            const x1 = Math.floor((gx + 1) * cw), y1 = Math.floor((gy + 1) * ch);
            let area = 0, filled = 0;
            for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) {
                    area++;
                    if (mask.binaryMask[y * mask.width + x]) filled++;
                }
            }
            // Skip near-empty cells so vision budget is not spent on glass.
            if (!area || filled / area < minFill) continue;
            const tl = mapPoint(x0, y0);
            const br = mapPoint(x1, y1);
            cells.push({
                bounds: {
                    x: Math.min(tl.x, br.x),
                    y: Math.min(tl.y, br.y),
                    width: Math.abs(br.x - tl.x),
                    height: Math.abs(br.y - tl.y),
                },
                areaFraction: filled / total,
            });
        }
    }
    return cells.sort((a, b) => b.areaFraction - a.areaFraction);
}

/**
 * Rasterize a polygon-with-holes into mask space and count its pixels against the mask.
 *
 * `rings[0]` is the outer ring, the rest are holes. Scanline over the outer ring's bbox
 * only — the cost is O(bbox pixels × ring vertices), which is why callers should hand it
 * the smallest mask that still answers their question.
 */
export function coverageOverRings(rings: Point[][], mask: MaskResult): { area: number; tissue: number } {
    const outer = rings[0];
    if (!outer || outer.length < 3) return { area: 0, tissue: 0 };
    const w = mask.width, h = mask.height;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of outer) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    minX = Math.max(0, Math.floor(minX));
    minY = Math.max(0, Math.floor(minY));
    maxX = Math.min(w - 1, Math.ceil(maxX));
    maxY = Math.min(h - 1, Math.ceil(maxY));

    let area = 0, tissue = 0;
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const cx = x + 0.5, cy = y + 0.5;
            if (!pointInRing(cx, cy, outer)) continue;
            let inHole = false;
            for (let k = 1; k < rings.length; k++) {
                if (pointInRing(cx, cy, rings[k])) { inHole = true; break; }
            }
            if (inHole) continue;
            area++;
            if (mask.binaryMask[y * w + x]) tissue++;
        }
    }
    return { area, tissue };
}

/**
 * Cut the part of a mask that covers `bounds` out of a mask covering `maskBounds`.
 *
 * Lets a sub-region be measured or subdivided from a mask that was already computed for
 * the whole slide, instead of rendering and thresholding the same pixels again. The
 * returned `bounds` are SNAPPED to mask pixel edges rather than being the request, so
 * mapping crop coordinates back to parent-global space stays exact — an unsnapped
 * rectangle would shift every derived box by up to one mask pixel, which at survey
 * resolution is a good fraction of a millimetre on the slide.
 *
 * Null when the overlap is empty. Callers must also decide whether the crop is BIG
 * enough to be worth using: a few pixels can say "there is tissue here" but cannot
 * describe its shape.
 */
export function cropMask(
    mask: MaskResult,
    maskBounds: Bounds,
    bounds: Bounds
): { mask: MaskResult; bounds: Bounds } | null {
    const sx = mask.width / Math.max(1e-9, maskBounds.width);
    const sy = mask.height / Math.max(1e-9, maskBounds.height);
    const x0 = Math.max(0, Math.floor((bounds.x - maskBounds.x) * sx));
    const y0 = Math.max(0, Math.floor((bounds.y - maskBounds.y) * sy));
    const x1 = Math.min(mask.width, Math.ceil((bounds.x + bounds.width - maskBounds.x) * sx));
    const y1 = Math.min(mask.height, Math.ceil((bounds.y + bounds.height - maskBounds.y) * sy));
    const w = x1 - x0, h = y1 - y0;
    if (!(w > 0) || !(h > 0)) return null;

    const binaryMask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        const src = (y0 + y) * mask.width + x0;
        const dst = y * w;
        for (let x = 0; x < w; x++) binaryMask[dst + x] = mask.binaryMask[src + x];
    }
    return {
        mask: { binaryMask, width: w, height: h, label: mask.label },
        bounds: {
            x: maskBounds.x + x0 / sx,
            y: maskBounds.y + y0 / sy,
            width: w / sx,
            height: h / sy,
        },
    };
}

/** Number of set pixels in a binary mask. */
export function countFilled(mask: Uint8Array): number {
    let n = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
    return n;
}

/** Round to a fixed number of decimals (for numbers that end up in a prompt). */
export function round(v: number, decimals: number): number {
    const f = Math.pow(10, decimals);
    return Math.round(v * f) / f;
}
