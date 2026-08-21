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
    planFields, rasterSizeFor, isMppExact, maskSampler, fitDownsample, FIELD_MAX_PIXELS,
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
