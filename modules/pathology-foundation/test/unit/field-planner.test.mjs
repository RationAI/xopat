/**
 * The regression suite for the resolution the engine promised but never delivered.
 *
 * The old path computed a raster size from a requested magnification and then clamped
 * the area into an 8 MP budget. On a real whole-slide image that clamp dominates: a
 * 15 mm tissue island asked for 1.0 µm/px came back at roughly 4.3 µm/px, while the
 * prompt still quoted 1.0. The vision model was told it could see nuclei and answered
 * accordingly, from an image in which nuclei were not present at all.
 *
 * `planFields` closes that by refusing to squash: too big for one call means TILED,
 * not downsampled. Every assertion below is about that invariant holding on numbers
 * taken from an actual slide.
 */
import { test, expect } from "@xopat/test-harness";
import { loadLib, cleanupLib } from "../load-lib.mjs";

const {
    planFields, rasterSizeFor, isMppExact, maskSampler, fitDownsample, fieldRenderAttempt,
    FIELD_MAX_PIXELS,
} = await loadLib("fields");

test.afterAll(() => cleanupLib());

/** A 40x scan: 0.25 µm/px at level 0. */
const SLIDE_MPP = 0.25;
/** A 15 mm x 10 mm tissue island in level-0 pixels. */
const ISLAND = { x: 0, y: 0, width: 60_000, height: 40_000 };

const deliveredMppOf = (field, slideMpp = SLIDE_MPP) =>
    slideMpp * (field.bounds.width / field.rasterPx.width);

test("a whole tissue island at 1.0 µm/px is tiled, never squashed", { tag: ["@unit"] }, () => {
    const plan = planFields({ bounds: ISLAND, mpp: 1.0, slideMpp: SLIDE_MPP });

    expect(plan.fields.length, "one 8 MP image cannot hold 15 mm at 1 µm/px").toBeGreaterThan(1);
    expect(plan.deliveredMpp, "the plan delivers what was asked for").toBeCloseTo(1.0, 6);

    for (const f of plan.fields) {
        const area = f.rasterPx.width * f.rasterPx.height;
        expect(area, `${f.id} fits one vision call`).toBeLessThanOrEqual(FIELD_MAX_PIXELS);
        // This is the assertion the old path failed, by a factor of ~4.3.
        expect(deliveredMppOf(f), `${f.id} is delivered at the resolution quoted to the model`)
            .toBeCloseTo(1.0, 1);
    }
});

test("the finest rung genuinely reaches nuclear resolution", { tag: ["@unit"] }, () => {
    // 0.25 µm/px over a 3 mm cell: the old path clamped this to ~1 µm/px, so nuclear
    // detail was never rendered anywhere on the slide at any depth.
    const cell = { x: 0, y: 0, width: 12_000, height: 12_000 };
    const plan = planFields({ bounds: cell, mpp: 0.25, slideMpp: SLIDE_MPP });

    expect(plan.downsample, "0.25 µm/px on a 0.25 µm/px scan is level 0").toBe(1);
    for (const f of plan.fields) {
        expect(deliveredMppOf(f)).toBeCloseTo(0.25, 3);
        expect(f.rasterPx.width * f.rasterPx.height).toBeLessThanOrEqual(FIELD_MAX_PIXELS);
    }
});

test("the lattice covers the region exactly and never overlaps", { tag: ["@unit"] }, () => {
    const plan = planFields({ bounds: ISLAND, mpp: 1.0, slideMpp: SLIDE_MPP });

    const area = plan.fields.reduce((sum, f) => sum + f.bounds.width * f.bounds.height, 0);
    expect(area, "the union of the fields is the region, no more and no less")
        .toBeCloseTo(ISLAND.width * ISLAND.height, 0);

    const union = plan.fields.reduce((u, f) => ({
        x0: Math.min(u.x0, f.bounds.x),
        y0: Math.min(u.y0, f.bounds.y),
        x1: Math.max(u.x1, f.bounds.x + f.bounds.width),
        y1: Math.max(u.y1, f.bounds.y + f.bounds.height),
    }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    expect(union).toEqual({ x0: 0, y0: 0, x1: ISLAND.width, y1: ISLAND.height });
});

test("a region that fits is one field equal to the region", { tag: ["@unit"] }, () => {
    const small = { x: 1_000, y: 2_000, width: 4_000, height: 3_000 };
    const plan = planFields({ bounds: small, mpp: 1.0, slideMpp: SLIDE_MPP });

    expect(plan.fields.length).toBe(1);
    expect(plan.fields[0].bounds, "no re-aspecting, no padding, no subdivision").toEqual(small);
    expect(plan.sampled).toBe(false);
    expect(plan.fields[0].tile, "a lone field is not 'tile 1 of 1'").toBeUndefined();
});

test("aspect ratio is preserved exactly on both axes", { tag: ["@unit"] }, () => {
    // A very wide region: deriving one raster dimension from the other is where
    // letterboxing and a per-axis resolution mismatch creep in.
    const wide = { x: 0, y: 0, width: 40_000, height: 2_500 };
    const plan = planFields({ bounds: wide, mpp: 0.5, slideMpp: SLIDE_MPP });

    for (const f of plan.fields) {
        const mppX = SLIDE_MPP * (f.bounds.width / f.rasterPx.width);
        const mppY = SLIDE_MPP * (f.bounds.height / f.rasterPx.height);
        expect(mppX, `${f.id} samples both axes at the same rate`).toBeCloseTo(mppY, 3);
    }
});

test("a request finer than level 0 is reported, not faked", { tag: ["@unit"] }, () => {
    const plan = planFields({ bounds: { x: 0, y: 0, width: 1_000, height: 1_000 }, mpp: 0.1, slideMpp: SLIDE_MPP });

    expect(plan.clampedToNative, "the scan has no such detail — say so").toBe(true);
    expect(plan.downsample, "never upsample past level 0").toBe(1);
    expect(plan.deliveredMpp, "the honest number is the native one").toBeCloseTo(SLIDE_MPP, 6);
});

test("an uncalibrated slide plans in downsample instead of µm/px", { tag: ["@unit"] }, () => {
    const plan = planFields({ bounds: ISLAND, slideMpp: null, downsample: 8 });

    expect(plan.deliveredMpp, "there is no µm/px to report").toBeNull();
    expect(plan.downsample).toBe(8);
    for (const f of plan.fields) {
        expect(f.sizeUm).toBeNull();
        expect(f.rasterPx).toEqual(rasterSizeFor(f.bounds, 8));
    }
});

test("empty cells are dropped before any render is spent on them", { tag: ["@unit"] }, () => {
    // Tissue only in the left quarter of the island.
    const mask = {
        fill: (b) => (b.x + b.width <= ISLAND.width / 4 ? 0.9 : 0),
    };

    const withMask = planFields({ bounds: ISLAND, mpp: 1.0, slideMpp: SLIDE_MPP, mask });
    const withoutMask = planFields({ bounds: ISLAND, mpp: 1.0, slideMpp: SLIDE_MPP });

    expect(withMask.fields.length).toBeLessThan(withoutMask.fields.length);
    expect(withMask.fields.every(f => f.fill > 0), "every planned field holds tissue").toBe(true);
    expect(withMask.tissueCoverage, "dropping glass loses no tissue").toBeCloseTo(1, 6);
    expect(withMask.sampled, "an exhaustive plan is not a sampled one").toBe(false);
});

test("subsampling keeps the densest cells and admits it", { tag: ["@unit"] }, () => {
    const density = { sample: (b) => b.x / ISLAND.width };

    const plan = planFields({ bounds: ISLAND, mpp: 1.0, slideMpp: SLIDE_MPP, density, maxFields: 3 });

    expect(plan.fields.length).toBe(3);
    expect(plan.sampled, "the caller must know this is not full coverage").toBe(true);
    expect(plan.tissueCoverage).toBeLessThan(1);
    expect(plan.fields[0].cellularity, "the densest cell is planned first")
        .toBeGreaterThanOrEqual(plan.fields[2].cellularity);
});

test("fields carry their tile position so a prompt can say so", { tag: ["@unit"] }, () => {
    const plan = planFields({ bounds: ISLAND, mpp: 1.0, slideMpp: SLIDE_MPP });

    expect(plan.fields[0].tile).toEqual({ n: 1, of: plan.fields.length, sampled: false });
    expect(plan.fields.at(-1).tile.n).toBe(plan.fields.length);
});

test("fields are clamped onto the slide", { tag: ["@unit"] }, () => {
    const overhang = { x: -5_000, y: -5_000, width: 30_000, height: 30_000 };
    const plan = planFields({
        bounds: overhang, mpp: 1.0, slideMpp: SLIDE_MPP, slide: { width: 20_000, height: 20_000 },
    });

    for (const f of plan.fields) {
        expect(f.bounds.x).toBeGreaterThanOrEqual(0);
        expect(f.bounds.y).toBeGreaterThanOrEqual(0);
        expect(f.bounds.x + f.bounds.width).toBeLessThanOrEqual(20_000);
        expect(f.bounds.y + f.bounds.height).toBeLessThanOrEqual(20_000);
    }
});

test("isMppExact catches a clamp the planner did not sanction", { tag: ["@unit"] }, () => {
    const bounds = { x: 0, y: 0, width: 60_000, height: 40_000 };

    // What the planner promises for one field of this size.
    expect(isMppExact(bounds, rasterSizeFor(bounds, 4).width, SLIDE_MPP, 1.0)).toBe(true);
    // What the OLD path actually delivered: 60000 px squashed into an 8 MP raster.
    expect(isMppExact(bounds, 3464, SLIDE_MPP, 1.0), "a 4.3x shortfall must not pass silently").toBe(false);
});

test("maskSampler reads a fill fraction out of a survey mask", { tag: ["@unit"] }, () => {
    // 4x4 mask covering a 400x400 image region; the left half is tissue.
    const binaryMask = new Uint8Array(16);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) binaryMask[y * 4 + x] = 1;
    const sampler = maskSampler({ binaryMask, width: 4, height: 4 }, { x: 0, y: 0, width: 400, height: 400 });

    expect(sampler.fill({ x: 0, y: 0, width: 200, height: 400 })).toBe(1);
    expect(sampler.fill({ x: 200, y: 0, width: 200, height: 400 })).toBe(0);
    expect(sampler.fill({ x: 0, y: 0, width: 400, height: 400 })).toBe(0.5);
    expect(sampler.fill({ x: 900, y: 900, width: 10, height: 10 }), "outside the mask is not tissue").toBe(0);
});

test("the survey rung trades resolution for coverage, and reports what it got", { tag: ["@unit"] }, () => {
    // Keeping the whole island in one call is legitimate — it is the survey view. What
    // must not happen is claiming the rung's resolution while delivering this one.
    const ds = fitDownsample(ISLAND, FIELD_MAX_PIXELS);
    const plan = planFields({ bounds: ISLAND, slideMpp: SLIDE_MPP, downsample: ds, single: true });

    expect(plan.fields.length).toBe(1);
    expect(plan.fields[0].bounds).toEqual(ISLAND);
    expect(plan.fields[0].rasterPx.width * plan.fields[0].rasterPx.height)
        .toBeLessThanOrEqual(FIELD_MAX_PIXELS);
    expect(plan.deliveredMpp, "the honest figure is coarse, and it is the one reported")
        .toBeCloseTo(SLIDE_MPP * ds, 6);
    expect(plan.deliveredMpp, "coarser than the 1.0 µm/px rung — which is the point").toBeGreaterThan(1.0);
});

test("single mode holds a region no square tile could", { tag: ["@unit"] }, () => {
    // 16:1 aspect: it fits a 2 MP raster, but not a square tile of side sqrt(2 MP).
    const wide = { x: 0, y: 0, width: 32_000, height: 2_000 };
    const plan = planFields({
        bounds: wide, slideMpp: SLIDE_MPP, downsample: fitDownsample(wide, FIELD_MAX_PIXELS), single: true,
    });

    expect(plan.fields.length).toBe(1);
    expect(plan.fields[0].bounds).toEqual(wide);
});

test("fitDownsample never upsamples a region that already fits", { tag: ["@unit"] }, () => {
    expect(fitDownsample({ x: 0, y: 0, width: 500, height: 500 }, FIELD_MAX_PIXELS)).toBe(1);
});

test("rejects bounds it cannot plan", { tag: ["@unit"] }, () => {
    expect(() => planFields({ bounds: { x: 0, y: 0, width: 0, height: 10 }, mpp: 1, slideMpp: SLIDE_MPP }))
        .toThrow(/positive width and height/);
});

// ---- "did it land short of the rung?" is a question about RESOLUTION ------------------

/**
 * `_planNodeFields` used to answer it with `wanted.fields.length > 1` — "the lattice had more
 * than one cell". Those are different questions, and a real leaf sat exactly where they
 * disagree: 4165 x 5863 level-0 px at a 1.0 µm/px rung on a 0.243 µm/px scan. The lattice has
 * two cells (the box is 43 px taller than one tile), so the node reported
 * `resolutionShortfall: true` — while the single-raster fit it actually rendered delivered
 * 0.849 µm/px, BETTER than the rung asked for.
 *
 * The cost was not cosmetic: that flag warns about unresolved leaves, and it routes
 * `_childrenOf` to a lattice re-read of the same tissue instead of separating what is inside
 * it. The numbers below are the ones the engine compares.
 */
const LEAF = { x: 62887, y: 124643, width: 4165, height: 5863 };
const LEAF_SLIDE_MPP = 0.243;
const RUNG_MPP = 1.0;
/** How the engine now decides, mirroring `_planNodeFields`. */
const shortOfRung = (delivered, target, tol = 0.05) => delivered == null || delivered > target * (1 + tol);

test("a box whose single raster beats its rung is not short of it", { tag: ["@unit"] }, () => {
    const wanted = planFields({ bounds: LEAF, mpp: RUNG_MPP, slideMpp: LEAF_SLIDE_MPP, minFill: 0 });
    expect(wanted.fields.length, "the old predicate: more than one cell").toBeGreaterThan(1);

    const single = planFields({
        bounds: LEAF, slideMpp: LEAF_SLIDE_MPP, minFill: 0,
        single: true, downsample: fitDownsample(LEAF, FIELD_MAX_PIXELS),
    });
    expect(single.deliveredMpp, "what the node actually renders").toBeCloseTo(0.849, 2);
    expect(single.deliveredMpp, "finer than the rung it was asked for").toBeLessThan(RUNG_MPP);
    expect(shortOfRung(single.deliveredMpp, RUNG_MPP), "so it is not a shortfall").toBe(false);
});

test("a box that genuinely cannot carry its rung still reports one", { tag: ["@unit"] }, () => {
    // The whole scope from the same run: 52063 x 19382 fits one raster only at 5.46 µm/px.
    const scope = { x: 23319, y: 124643, width: 52063, height: 19382 };
    const single = planFields({
        bounds: scope, slideMpp: LEAF_SLIDE_MPP, minFill: 0,
        single: true, downsample: fitDownsample(scope, FIELD_MAX_PIXELS),
    });

    expect(single.deliveredMpp).toBeCloseTo(5.46, 1);
    expect(shortOfRung(single.deliveredMpp, RUNG_MPP)).toBe(true);
});

test("the tolerance absorbs rounding, not a real gap", { tag: ["@unit"] }, () => {
    expect(shortOfRung(1.02, 1.0), "2% over — a rounded raster, not a coarser read").toBe(false);
    expect(shortOfRung(1.2, 1.0)).toBe(true);
    expect(shortOfRung(null, 1.0), "an unknown delivery is never claimed as adequate").toBe(true);
});

// ---- a requested µm/px is a ceiling on coarseness, not a downsample to hit -------------
//
// `region 4.3` from the lung run: a 124 x 144 px box on a 0.504 µm/px scan, asked at a
// 1.0 µm/px ladder rung. The planner computed `downsample = 1.0/0.504 ~= 1.98` and produced a
// 62 x 72 pixel raster — 0.004% of a 2 MP budget — throwing away half the resolution the slide
// was offering for nothing, because the read costs one call at either resolution. A vision
// model was then asked whether that image showed invasive growth, and said yes.

/** The lung slide: 20x, 0.504 µm/px. */
const LUNG_MPP = 0.504;
/** `region 4.3`: the box the walk drilled down to. */
const TINY = { x: 30_832, y: 40_525, width: 124, height: 144 };

test("a box that fits one call is delivered at the finest it affords", { tag: ["@unit"] }, () => {
    const plan = planFields({ bounds: TINY, mpp: 1.0, slideMpp: LUNG_MPP });

    expect(plan.fields, "one box, one call — before and after").toHaveLength(1);
    expect(plan.downsample, "level 0 is what a 124 px box affords").toBe(1);
    expect(plan.deliveredMpp, "0.504, not the rung's 0.996").toBeCloseTo(LUNG_MPP, 6);
    expect(plan.refinedToFit, "the delivered figure is not the requested one — say so").toBe(true);
    expect(plan.fields[0].rasterPx, "124 x 144, not 62 x 72").toEqual({ width: 124, height: 144 });
});

test("refining never drops a field or blocks a small read", { tag: ["@unit"] }, () => {
    // The regression this must not cause is the OPPOSITE failure — a walk that declines to
    // read small regions and then reports it could not judge them. Refinement only ever adds
    // pixels to a read that was already going to happen.
    for (const side of [16, 40, 124, 512, 2_000]) {
        const plan = planFields({
            bounds: { x: 0, y: 0, width: side, height: side }, mpp: 2.0, slideMpp: LUNG_MPP,
        });
        expect(plan.fields.length, `a ${side} px box is still read`).toBeGreaterThan(0);
        expect(plan.deliveredMpp, `a ${side} px box is never delivered coarser than asked`)
            .toBeLessThanOrEqual(2.0);
    }
});

test("a region that needs a lattice still obeys its rung", { tag: ["@unit"] }, () => {
    // In a lattice the resolution decides how many cells the region costs, so refining there
    // would multiply the call count. The rung has to govern.
    const plan = planFields({ bounds: ISLAND, mpp: 1.0, slideMpp: SLIDE_MPP });

    expect(plan.fields.length, "this is the tiled case").toBeGreaterThan(1);
    expect(plan.refinedToFit, "untouched by the refinement").toBe(false);
    expect(plan.deliveredMpp, "exactly the rung, as before").toBeCloseTo(1.0, 6);
});

test("single:true is never refined, so a montage keeps one scale", { tag: ["@unit"] }, () => {
    // Montage cells are planned one `single: true` call each and composited into ONE image
    // whose prompt quotes a single µm/px. Refining per-cell would give a small entry native
    // resolution and a large one the rung's — different scales in the same picture, described
    // by one number. That is the failure this whole file exists to prevent, rebuilt.
    const small = planFields({ bounds: TINY, mpp: 2.0, slideMpp: LUNG_MPP, single: true });
    const large = planFields({ bounds: ISLAND, mpp: 2.0, slideMpp: LUNG_MPP, single: true });

    expect(small.refinedToFit).toBe(false);
    expect(small.deliveredMpp, "the figure the caller asked for and will quote").toBeCloseTo(2.0, 6);
    expect(large.deliveredMpp, "and the same one for every other cell")
        .toBeGreaterThanOrEqual(2.0);
});

test("an explicit downsample is an instruction, not a target to improve on", { tag: ["@unit"] }, () => {
    const plan = planFields({ bounds: TINY, slideMpp: LUNG_MPP, downsample: 4 });

    expect(plan.downsample).toBe(4);
    expect(plan.refinedToFit).toBe(false);
});

test("a single field already at its rung is not reported as refined", { tag: ["@unit"] }, () => {
    // `refinedToFit` has to mean "the delivered figure is not the requested one", or a caller
    // reading it learns nothing.
    const plan = planFields({ bounds: TINY, mpp: LUNG_MPP, slideMpp: LUNG_MPP });

    expect(plan.deliveredMpp).toBeCloseTo(LUNG_MPP, 6);
    expect(plan.refinedToFit).toBe(false);
});

/**
 * Retrying a field whose render failed.
 *
 * A field render fails far more often because the tile server was slow than because the
 * region is unreadable, and the walk used to turn the first into `not-assessable` — a
 * clinical-sounding non-answer for an infrastructure problem. The escalation has to keep the
 * resolution it promises honest while it does that: `mpp` and `downsample` move together, or
 * the coarse attempt quotes a resolution its pixels cannot carry, which is the exact failure
 * `planFields` exists to prevent.
 */
const FIELD = {
    id: "f0", parentId: null, label: "field#0-0",
    bounds: { x: 1000, y: 2000, width: 1024, height: 1024 },
    mpp: 0.25, downsample: 1,
    rasterPx: { width: 1024, height: 1024 },
    sizeUm: { width: 256, height: 256 }, rung: 0, fill: 1, cellularity: 0.5,
};

test("the first retry asks for exactly what the first attempt did", { tag: ["@unit"] }, () => {
    // Not optimism: the failed attempt already requested its tiles and they keep arriving
    // into the shared cache, so the same request over a warm cache is the cheapest thing
    // available AND keeps full resolution.
    expect(fieldRenderAttempt(FIELD, 0)).toEqual(FIELD);
    expect(fieldRenderAttempt(FIELD, 1)).toEqual(FIELD);
});

test("the coarse attempt drops one pyramid level", { tag: ["@unit"] }, () => {
    const coarse = fieldRenderAttempt(FIELD, 2);

    expect(coarse.downsample, "half the resolution is a quarter of the tiles").toBe(2);
    expect(coarse.rasterPx).toEqual({ width: 512, height: 512 });
    expect(coarse.bounds, "the same tissue, read less finely").toEqual(FIELD.bounds);
});

test("mpp follows downsample, so the attempt reports what it can actually carry", { tag: ["@unit"] }, () => {
    // If mpp stayed at 0.25 the raster would be measured against a request it does not meet
    // (a planner defect that did not happen), and features needing 0.25 µm/px would be asked
    // of pixels half that fine instead of being deferred as `reason: "resolution"`.
    expect(fieldRenderAttempt(FIELD, 2).mpp).toBe(0.5);
    expect(isMppExact(FIELD.bounds, 512, 0.25, fieldRenderAttempt(FIELD, 2).mpp)).toBe(true);
    expect(isMppExact(FIELD.bounds, 512, 0.25, FIELD.mpp), "the drift the old code would log").toBe(false);
});

test("an uncalibrated field stays uncalibrated when it goes coarser", { tag: ["@unit"] }, () => {
    const coarse = fieldRenderAttempt({ ...FIELD, mpp: null }, 2);

    expect(coarse.mpp, "no physical scale exists to halve").toBe(null);
    expect(coarse.downsample).toBe(2);
});

test("each further attempt halves again rather than resetting", { tag: ["@unit"] }, () => {
    expect(fieldRenderAttempt(FIELD, 3).downsample).toBe(4);
    expect(fieldRenderAttempt(FIELD, 3).mpp).toBe(1);
});

test("the field itself is never mutated", { tag: ["@unit"] }, () => {
    // Attempts are re-derived from the original each time; a mutation here would make the
    // second retry coarser than the policy says and silently compound.
    fieldRenderAttempt(FIELD, 2);

    expect(FIELD.downsample).toBe(1);
    expect(FIELD.mpp).toBe(0.25);
});
