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

/** Intersection of two bboxes; null when they do not overlap. */
export function intersectBounds(a: Bounds, b: Bounds): Bounds | null {
    const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height);
    const width = x1 - x0, height = y1 - y0;
    if (!(width > 0) || !(height > 0)) return null;
    return { x: x0, y: y0, width, height };
}

/**
 * Intersection over union of two boxes, 0..1.
 *
 * The symmetric measure of "these two are the same box". Deliberately paired with
 * {@link containedFraction} in {@link mergeOverlappingBounds}, because IoU alone cannot see
 * a small box swallowed by a large one: a sliver entirely inside a whole tissue island
 * scores near zero on IoU and 1 on containment, and re-reading it is exactly the waste the
 * merge exists to stop.
 */
export function boundsIoU(a: Bounds, b: Bounds): number {
    const hit = intersectBounds(a, b);
    if (!hit) return 0;
    const inter = hit.width * hit.height;
    const union = a.width * a.height + b.width * b.height - inter;
    return union > 0 ? inter / union : 0;
}

/** Fraction of `inner`'s area that lies inside `outer`, 0..1. */
export function containedFraction(inner: Bounds, outer: Bounds): number {
    const area = inner.width * inner.height;
    if (!(area > 0)) return 0;
    const hit = intersectBounds(inner, outer);
    return hit ? (hit.width * hit.height) / area : 0;
}

/**
 * Fraction of `box` covered by the UNION of `others`, 0..1.
 *
 * Summing pairwise intersections would be wrong here and wrong in the direction that
 * matters: the boxes this is asked about routinely overlap EACH OTHER (that is the whole
 * reason the question is being asked), so a sum double-counts and reports a box as fully
 * covered when it is not. Rasterizing `box` into a coarse lattice and marking hit cells
 * gives the union for free.
 *
 * `grid` is a resolution/cost trade, not a precision claim. At 32 the answer is within
 * ~3% per axis, which is far inside the slack of any threshold worth gating on, and it
 * costs 1024 cheap rectangle tests regardless of how many `others` there are.
 */
export function coveredFraction(box: Bounds, others: Bounds[], grid = 32): number {
    if (!(box.width > 0) || !(box.height > 0) || !others.length) return 0;
    const n = Math.max(1, Math.floor(grid));
    const cw = box.width / n, ch = box.height / n;
    let hits = 0;
    for (let gy = 0; gy < n; gy++) {
        const cy = box.y + (gy + 0.5) * ch;
        for (let gx = 0; gx < n; gx++) {
            const cx = box.x + (gx + 0.5) * cw;
            for (const o of others) {
                if (cx >= o.x && cx <= o.x + o.width && cy >= o.y && cy <= o.y + o.height) {
                    hits++;
                    break;
                }
            }
        }
    }
    return hits / (n * n);
}

/** Smallest box containing both inputs. */
export function unionBounds(a: Bounds, b: Bounds): Bounds {
    const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x + a.width, b.x + b.width), y1 = Math.max(a.y + a.height, b.y + b.height);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The minimum an item must expose to take part in a merge. */
export interface MergeableRegion {
    bounds: Bounds;
    areaFraction?: number;
}

/**
 * Collapse boxes that describe the same tissue into one.
 *
 * ## Why this exists
 *
 * Regions are the axis-aligned bounding boxes of traced tissue contours. On anything that
 * is not a compact blob — a curved biopsy strip, a folded core, a ribbon of mucosa — the
 * AABBs of neighbouring contours overlap heavily while the contours themselves do not.
 * Nothing downstream noticed: each box became a region of its own, was rendered, was sent
 * to a vision model, and was reported as a separate finding. The user saw a stack of
 * examination markers over one piece of tissue, and the budget paid for the same cells
 * several times.
 *
 * Merging is done on the BOXES because the boxes are what gets rendered. Two contours that
 * genuinely occupy the same rectangle cannot be read separately, so keeping them separate
 * is a distinction the pipeline is incapable of honouring.
 *
 * ## The two tests
 *
 * - `iou` — the boxes are largely the same box.
 * - `containment` — one box is almost entirely inside the other, at any size ratio.
 *
 * Either one merges. Iterated to a fixed point, because a merge grows a box and can bring
 * a third into range; a single pass would leave the chain half-collapsed and the result
 * order-dependent.
 *
 * `areaFraction` is SUMMED rather than recomputed: it measures tissue, and the tissue of
 * two merged islands really is the sum. Recomputing it from the union box would silently
 * count the glass between them as tissue.
 */
export function mergeOverlappingBounds<T extends MergeableRegion>(
    items: T[],
    options: { iou?: number; containment?: number } = {}
): T[] {
    const iouLimit = options.iou ?? 0.4;
    const containLimit = options.containment ?? 0.9;
    if (items.length < 2) return items.slice();

    let merged = items.slice();
    let changed = true;
    // Bounded by the item count: every pass that changes anything removes at least one box.
    while (changed) {
        changed = false;
        outer:
        for (let i = 0; i < merged.length; i++) {
            for (let j = i + 1; j < merged.length; j++) {
                const a = merged[i], b = merged[j];
                const overlaps = boundsIoU(a.bounds, b.bounds) >= iouLimit
                    || containedFraction(a.bounds, b.bounds) >= containLimit
                    || containedFraction(b.bounds, a.bounds) >= containLimit;
                if (!overlaps) continue;
                // Keep the FIRST item's identity: callers hand these in ranked order, and the
                // survivor should be the one that already earned its place.
                merged[i] = {
                    ...a,
                    bounds: unionBounds(a.bounds, b.bounds),
                    ...(a.areaFraction !== undefined || b.areaFraction !== undefined
                        ? { areaFraction: (a.areaFraction ?? 0) + (b.areaFraction ?? 0) }
                        : {}),
                };
                merged.splice(j, 1);
                changed = true;
                break outer;
            }
        }
    }
    return merged;
}

/**
 * Rank boxes the way a reviewer reads a slide: rows top to bottom, left to right inside a row.
 *
 * ## Why this exists
 *
 * A region's number is the only name it has for the user and for a region link, and it used
 * to be its SIZE RANK — the survey sorted contours largest-first and numbered them by array
 * position. No clinical convention counts fragments that way, so "region 1" landed on what
 * the reviewer calls the third core, and a report could not be read against the slide
 * without a lookup for every link.
 *
 * Ordering is a naming concern only. The arrays stay in priority order (the walk spends its
 * budget on the biggest, densest tissue first); this decides what the survivors are CALLED.
 *
 * ## Rows, not a `y` sort
 *
 * Fragments in one row are never aligned to the pixel, so sorting by `y` interleaves rows and
 * produces exactly the jumping this fixes. Boxes are banded instead: sorted by top edge, a
 * box joins the open band while it overlaps the band's y-range by at least `rowOverlap` of
 * its own height, and starts a new band otherwise. Measuring against the box's own height is
 * what lets a small fragment sit in a row of tall cores.
 *
 * @param items boxes in any order
 * @param opts.rowOverlap fraction of a box's height that must fall inside the open band (0..1)
 * @returns `ranks[i]` — the 0-based reading position of `items[i]`; a permutation of its input
 */
export function readingOrder<T extends { bounds: Bounds }>(
    items: T[],
    opts: { rowOverlap?: number } = {}
): number[] {
    const rowOverlap = opts.rowOverlap ?? 0.5;
    if (items.length < 2) return items.map((_, i) => i);

    // Carry the original position through: it is the answer's key, and it breaks ties
    // stably so two identical boxes never swap numbers between runs.
    const entries = items.map((item, at) => ({ at, b: item.bounds }));
    const byTop = entries.slice().sort((p, q) => p.b.y - q.b.y || p.b.x - q.b.x || p.at - q.at);

    const bands: Array<{ y0: number; y1: number; members: typeof entries }> = [];
    for (const entry of byTop) {
        const { y, height } = entry.b;
        const band = bands[bands.length - 1];
        // A degenerate (zero-height) box can never satisfy a fractional overlap test, so it
        // joins the open band on containment of its own edge instead of being exiled to one
        // band each.
        const overlap = band ? Math.min(band.y1, y + height) - Math.max(band.y0, y) : 0;
        const fits = !!band && (height > 0 ? overlap >= rowOverlap * height : overlap >= 0);
        if (fits) {
            band!.members.push(entry);
            band!.y0 = Math.min(band!.y0, y);
            band!.y1 = Math.max(band!.y1, y + height);
        } else {
            bands.push({ y0: y, y1: y + height, members: [entry] });
        }
    }

    const ranks = new Array<number>(items.length);
    let rank = 0;
    for (const band of bands) {
        band.members.sort((p, q) => p.b.x - q.b.x || p.b.y - q.b.y || p.at - q.at);
        for (const entry of band.members) ranks[entry.at] = rank++;
    }
    return ranks;
}

/**
 * Does `outer` fully contain `inner`?
 *
 * `epsilon` absorbs the sub-pixel drift a rectangle picks up going through viewport and crop
 * conversions: a box derived from the very survey that covers it must not fail its own
 * containment test because a coordinate came back a ten-thousandth of a pixel outside.
 */
export function containsBounds(outer: Bounds, inner: Bounds, epsilon = 1e-6): boolean {
    return inner.x >= outer.x - epsilon
        && inner.y >= outer.y - epsilon
        && inner.x + inner.width <= outer.x + outer.width + epsilon
        && inner.y + inner.height <= outer.y + outer.height + epsilon;
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
