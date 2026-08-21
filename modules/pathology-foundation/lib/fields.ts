/**
 * Field planning: turning "look at this region at this resolution" into a set of
 * renders that actually deliver that resolution.
 *
 * ## Why this file exists
 *
 * The engine used to ask for a magnification over a bounding box and let the renderer
 * clamp the result into a pixel budget. On a whole-slide image that clamp is enormous:
 * a 15 mm tissue island asked for 1.0 µm/px comes back at roughly 4.3 µm/px, and a
 * drilled cell at roughly 0.5 µm/px. The prompt then quoted the resolution that had
 * been *requested*, so a vision model looking at architecture-only detail was told it
 * had nuclear detail — and answered cytology questions whose evidence was never in the
 * image. Nuclear features simply never got rendered on a normal slide.
 *
 * The fix is to stop treating a region as one image. A **field** is a sampling window
 * of a fixed physical size delivered at an exact resolution; when a region is too large
 * to be one field, it is TILED into several rather than squashed into one. Resolution
 * becomes an input the planner honours, not an aspiration the renderer silently drops.
 *
 * `planFields` is the only place that decides tiling, and it is pure: no viewer, no
 * async, no render. That is what makes "a 60000 px region at 1.0 µm/px never comes back
 * at 4.3 µm/px" a unit test rather than a slide-dependent observation.
 */

import type { Bounds, MaskResult } from "./types";

/**
 * Raster budget for ONE vision call, in pixels.
 *
 * Sets the physical size of a field at any given resolution: `tileSide` is the largest
 * square of slide pixels that fits this budget once downsampled. Lowering it makes
 * fields smaller and more numerous (better montage batching, more renders); raising it
 * makes each call carry more tissue at the same resolution.
 */
export const FIELD_MAX_PIXELS = 2_000_000;

/**
 * How far the delivered resolution may drift from the request before it is a bug.
 *
 * Rounding a raster to whole pixels moves the ratio slightly; anything beyond this
 * means a clamp fired somewhere it should not have, and the prompt is about to quote a
 * number the image does not support.
 */
export const FIELD_MPP_TOLERANCE = 0.05;

/** A sampling window of a FIXED physical size delivered at an EXACT resolution. */
export interface Field {
    /** Stable within a run — the memo and dedup key. */
    id: string;
    parentId: string | null;
    /** Human-facing name; the caller supplies the ancestry-dotted form. */
    label: string;
    /** Parent-global level-0 image bbox. Aspect is preserved EXACTLY — never squashed. */
    bounds: Bounds;
    /** Requested µm per delivered raster pixel; null on an uncalibrated slide. */
    mpp: number | null;
    /** Level-0 image px per raster px. Always >= 1 — level 0 is the finest that exists. */
    downsample: number;
    /** The raster this field WILL produce, in pixels. */
    rasterPx: { width: number; height: number };
    /** Physical extent of the field, or null when uncalibrated. */
    sizeUm: { width: number; height: number } | null;
    /** Which ladder rung this field belongs to. */
    rung: number;
    /** Tissue fraction from the cached survey mask — costs no render. */
    fill: number;
    /** Normalized nuclear density from the density map — costs no model call. */
    cellularity: number;
    /** Position within its plan, when the plan tiled a larger region. */
    tile?: { n: number; of: number; sampled: boolean };
}

export interface FieldPlan {
    fields: Field[];
    /** The µm/px EVERY field in this plan is delivered at — equal by construction. */
    deliveredMpp: number | null;
    downsample: number;
    /** False when the fields tile `bounds` exhaustively; true when subsampled to `maxFields`. */
    sampled: boolean;
    /** Fraction of the TISSUE inside `bounds` that the returned fields cover (0..1). */
    tissueCoverage: number;
    /** Set when the requested µm/px was finer than level 0 and could not be honoured. */
    clampedToNative: boolean;
}

export interface FieldPlanRequest {
    bounds: Bounds;
    /** Target resolution in µm/px, from the ladder rung. Null on an uncalibrated slide. */
    mpp?: number | null;
    /** Slide calibration in µm/px. Null means uncalibrated — `downsample` is used instead. */
    slideMpp?: number | null;
    /** Explicit level-0 px per raster px. Used when `slideMpp` is null; also a hard override. */
    downsample?: number;
    /** Per-vision-call raster budget. Defaults to {@link FIELD_MAX_PIXELS}. */
    maxRasterPixels?: number;
    /** Cap on the number of fields returned. Exceeding it subsamples and sets `sampled`. */
    maxFields?: number;
    /**
     * Cached survey mask, with a mapper from parent-global coordinates into its pixels.
     * Lets empty cells be dropped with no render at all — the reason an exhaustive
     * coverage pass is affordable.
     */
    mask?: MaskSampler;
    /** Cached density map, used to rank cells when subsampling. */
    density?: DensitySampler;
    /** Minimum tissue fill a cell must hold to be worth a vision call. */
    minFill?: number;
    /** Slide extent, for clamping fields onto the slide. */
    slide?: { width: number; height: number };
    /**
     * Emit exactly ONE field covering `bounds`, skipping the lattice.
     *
     * For the survey rung, where the honest answer is "this whole region, at whatever
     * resolution it affords". Pair with {@link fitDownsample}: the field then carries the
     * resolution it really delivers, which the caller must quote instead of the rung's
     * target. A lattice cannot express this, because a region wider than it is tall does
     * not fit a square tile even when it fits the raster budget.
     */
    single?: boolean;
    /** Ladder rung recorded on each field. */
    rung?: number;
    parentId?: string | null;
    /** Names a field from its grid position. Defaults to `<parentId>#<gx>-<gy>`. */
    labelFor?: (gx: number, gy: number, index: number) => string;
}

/** Reads a tissue fraction for a parent-global box. Backed by the cached survey mask. */
export interface MaskSampler {
    /** Fraction of `bounds` that is tissue, 0..1. */
    fill(bounds: Bounds): number;
}

/** Reads a normalized nuclear density for a parent-global box. */
export interface DensitySampler {
    /** Mean density over `bounds`, 0..1. */
    sample(bounds: Bounds): number;
}

/** A `MaskSampler` over a mask that covers `maskBounds` in parent-global coordinates. */
export function maskSampler(mask: MaskResult, maskBounds: Bounds): MaskSampler {
    const sx = mask.width / Math.max(1e-9, maskBounds.width);
    const sy = mask.height / Math.max(1e-9, maskBounds.height);
    return {
        fill(bounds: Bounds): number {
            const x0 = Math.max(0, Math.floor((bounds.x - maskBounds.x) * sx));
            const y0 = Math.max(0, Math.floor((bounds.y - maskBounds.y) * sy));
            const x1 = Math.min(mask.width, Math.ceil((bounds.x + bounds.width - maskBounds.x) * sx));
            const y1 = Math.min(mask.height, Math.ceil((bounds.y + bounds.height - maskBounds.y) * sy));
            if (!(x1 > x0) || !(y1 > y0)) return 0;
            let filled = 0;
            for (let y = y0; y < y1; y++) {
                const row = y * mask.width;
                for (let x = x0; x < x1; x++) if (mask.binaryMask[row + x]) filled++;
            }
            return filled / ((x1 - x0) * (y1 - y0));
        },
    };
}

/**
 * Plan the renders that answer "show me `bounds` at `mpp`".
 *
 * 1. `downsample = mpp / slideMpp`, floored at 1 — level 0 is the finest sampling that
 *    exists, so a finer request is reported via `clampedToNative` rather than faked.
 * 2. `tileSide` is the largest square of slide pixels that fits one call's raster budget
 *    at that downsample. Square cells keep fields comparable across the slide and make
 *    them montage-friendly.
 * 3. A region within one tile becomes exactly one field equal to `bounds` — no padding,
 *    no re-aspecting, no subdivision.
 * 4. Otherwise an even lattice whose union is `bounds` exactly. Cells are equal-sized
 *    and no larger than `tileSide`, so every field in the plan shares one resolution.
 * 5. Cells below `minFill` are dropped using the cached mask — no render is spent on glass.
 * 6. When `maxFields` is smaller than the survivors, the densest cells win. That choice
 *    is a BUDGET decision, not a geometry one: a coverage pass asks for all of them, a
 *    focus expansion asks for a few.
 */
export function planFields(req: FieldPlanRequest): FieldPlan {
    const { bounds } = req;
    if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) {
        throw new Error("planFields requires bounds with positive width and height.");
    }

    const maxRasterPixels = Math.max(1024, req.maxRasterPixels ?? FIELD_MAX_PIXELS);
    const minFill = req.minFill ?? 0.05;
    const rung = req.rung ?? 0;
    const parentId = req.parentId ?? null;

    // --- resolution -------------------------------------------------------------
    const slideMpp = req.slideMpp && req.slideMpp > 0 ? req.slideMpp : null;
    const wantMpp = req.mpp && req.mpp > 0 ? req.mpp : null;
    let downsample: number;
    let clampedToNative = false;
    if (typeof req.downsample === "number" && req.downsample > 0) {
        downsample = Math.max(1, req.downsample);
    } else if (slideMpp && wantMpp) {
        const raw = wantMpp / slideMpp;
        downsample = Math.max(1, raw);
        // Asking for finer than level 0 is not an error — it is a question the scan
        // cannot answer. Say so instead of pretending the request was met.
        clampedToNative = raw < 1;
    } else {
        downsample = 1;
    }
    const deliveredMpp = slideMpp ? slideMpp * downsample : null;

    // --- tiling -----------------------------------------------------------------
    const tileSide = Math.max(16, Math.floor(Math.sqrt(maxRasterPixels) * downsample));
    const nx = req.single ? 1 : Math.max(1, Math.ceil(bounds.width / tileSide));
    const ny = req.single ? 1 : Math.max(1, Math.ceil(bounds.height / tileSide));
    // Edges from the grid index rather than an accumulated cell width: at gx === nx the
    // expression is exactly `bounds.x + bounds.width`, so the lattice's union is the
    // region to the last bit. Accumulation drifts, and a field that ends a hair past the
    // region is a field the renderer clamps — silently, and only for the last column.
    const edgeX = (gx: number) => bounds.x + (gx * bounds.width) / nx;
    const edgeY = (gy: number) => bounds.y + (gy * bounds.height) / ny;

    const labelFor = req.labelFor ?? ((gx: number, gy: number) => `${parentId ?? "field"}#${gx}-${gy}`);

    type Candidate = { field: Field; score: number; tissue: number };
    const candidates: Candidate[] = [];
    let totalTissue = 0;

    for (let gy = 0; gy < ny; gy++) {
        for (let gx = 0; gx < nx; gx++) {
            const x0 = edgeX(gx), y0 = edgeY(gy);
            let cell: Bounds = {
                x: x0,
                y: y0,
                width: edgeX(gx + 1) - x0,
                height: edgeY(gy + 1) - y0,
            };
            if (req.slide) {
                const clamped = intersect(cell, req.slide.width, req.slide.height);
                if (!clamped) continue;
                cell = clamped;
            }

            const fill = req.mask ? req.mask.fill(cell) : 1;
            const cellArea = cell.width * cell.height;
            totalTissue += fill * cellArea;
            // Skip near-empty cells so vision budget is not spent on glass.
            if (fill < minFill) continue;

            const cellularity = req.density ? clamp01(req.density.sample(cell)) : 0;
            candidates.push({
                field: {
                    id: `${parentId ?? "root"}#${gx}-${gy}@${rung}`,
                    parentId,
                    label: labelFor(gx, gy, candidates.length),
                    bounds: cell,
                    mpp: deliveredMpp,
                    downsample,
                    rasterPx: rasterSizeFor(cell, downsample),
                    sizeUm: slideMpp
                        ? { width: cell.width * slideMpp, height: cell.height * slideMpp }
                        : null,
                    rung,
                    fill,
                    cellularity,
                },
                // Fill decides whether a cell is worth looking at; cellularity decides
                // which of the worthwhile ones to look at FIRST. Weighted so a dense
                // sliver never outranks a solidly-filled field outright.
                score: fill * (0.5 + 0.5 * cellularity),
                tissue: fill * cellArea,
            });
        }
    }

    candidates.sort((a, b) => b.score - a.score);

    const maxFields = req.maxFields ?? Infinity;
    const kept = candidates.length > maxFields ? candidates.slice(0, maxFields) : candidates;
    const sampled = kept.length < candidates.length;
    const keptTissue = kept.reduce((sum, c) => sum + c.tissue, 0);

    const fields = kept.map((c, i) => ({
        ...c.field,
        ...(kept.length > 1 ? { tile: { n: i + 1, of: kept.length, sampled } } : {}),
    }));

    return {
        fields,
        deliveredMpp,
        downsample,
        sampled,
        tissueCoverage: totalTissue > 0 ? clamp01(keptTissue / totalTissue) : (fields.length ? 1 : 0),
        clampedToNative,
    };
}

/**
 * The coarsest-necessary downsample that fits ALL of `bounds` into one raster.
 *
 * The survey rung's answer to "this region is bigger than one call can carry at the
 * resolution you asked for". Trading resolution for coverage is legitimate — trading it
 * *silently* is not, which is why the caller must quote the resulting `deliveredMpp`.
 */
export function fitDownsample(bounds: Bounds, maxRasterPixels = FIELD_MAX_PIXELS): number {
    const M = Math.max(1024, maxRasterPixels);
    const w = Math.max(1, bounds.width), h = Math.max(1, bounds.height);
    // `sqrt(area / M)` is the answer only if the raster could be fractional. Rounding each
    // axis to whole pixels adds up to 1 px per side, and (w/d + 1)(h/d + 1) can then exceed
    // the budget — by a hair, but "fits" has to mean fits, since the render path turns this
    // budget into a hard tripwire. So solve for the exact constraint instead:
    //     (w/d + 1)(h/d + 1) <= M,  substituting u = 1/d,
    //     wh·u² + (w + h)·u + (1 - M) <= 0
    const u = (-(w + h) + Math.sqrt((w + h) * (w + h) + 4 * w * h * (M - 1))) / (2 * w * h);
    return u > 0 ? Math.max(1, 1 / u) : 1;
}

/**
 * The raster a field's bounds produce at `downsample`, preserving aspect exactly.
 *
 * Both dimensions are computed from the same divisor rather than one being derived from
 * the other, so the core renderer's aspect refit is a no-op and the delivered µm/px is
 * the same on both axes.
 */
export function rasterSizeFor(bounds: Bounds, downsample: number): { width: number; height: number } {
    return {
        width: Math.max(1, Math.round(bounds.width / downsample)),
        height: Math.max(1, Math.round(bounds.height / downsample)),
    };
}

/**
 * True when a raster of `rasterWidth` px over `bounds` really is at `requestedMpp`.
 *
 * The engine asserts this after every field render. A miss is a BUG — a clamp fired
 * where the planner said none would — not a soft condition to describe in a prompt.
 */
export function isMppExact(
    bounds: Bounds,
    rasterWidth: number,
    slideMpp: number | null,
    requestedMpp: number | null,
    tolerance = FIELD_MPP_TOLERANCE
): boolean {
    if (!slideMpp || !requestedMpp || !(rasterWidth > 0)) return true;
    const delivered = slideMpp * (bounds.width / rasterWidth);
    return Math.abs(delivered / requestedMpp - 1) <= tolerance;
}

function intersect(b: Bounds, slideW: number, slideH: number): Bounds | null {
    if (!(slideW > 0) || !(slideH > 0)) return b;
    const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y);
    const x1 = Math.min(slideW, b.x + b.width), y1 = Math.min(slideH, b.y + b.height);
    if (!(x1 - x0 > 0) || !(y1 - y0 > 0)) return null;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function clamp01(v: number): number {
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}
