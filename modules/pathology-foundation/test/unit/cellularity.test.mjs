/**
 * The free, deterministic prior that says where to spend a vision budget.
 *
 * Its whole value is DISCRIMINATION: it has to rate nuclei-dense tissue above tissue
 * that is merely dark. Projecting the optical density onto the haematoxylin vector —
 * the obvious one-liner — fails exactly there, because eosin has a large component
 * along that vector, so any densely stained region scores high and the ordering
 * carries no information. These tests pin the property, not the implementation.
 */
import { test, expect } from "@xopat/test-harness";
import { loadLib, cleanupLib } from "../load-lib.mjs";

const {
    stainConcentration, densityGrid, saturationChannel, DEFAULT_STAIN_VECTORS,
} = await loadLib("imaging");

test.afterAll(() => cleanupLib());

/** An RGBA buffer of `count` pixels, all the same colour. */
function flat(rgb, count) {
    const px = new Uint8ClampedArray(count * 4);
    for (let i = 0; i < count; i++) {
        px[i * 4] = rgb[0]; px[i * 4 + 1] = rgb[1]; px[i * 4 + 2] = rgb[2]; px[i * 4 + 3] = 255;
    }
    return px;
}

/** Beer–Lambert: the RGB a given concentration of one stain transmits over white. */
function stained(vector, concentration) {
    return vector.map(v => Math.max(0, Math.min(255, Math.round(255 * Math.pow(10, -v * concentration)))));
}

const H = DEFAULT_STAIN_VECTORS.nuclear;
const E = DEFAULT_STAIN_VECTORS.counter;

test("white glass carries no stain", { tag: ["@unit"] }, () => {
    const c = stainConcentration(flat([255, 255, 255], 4), 4);

    for (const v of c) expect(v).toBeCloseTo(0, 2);
});

test("nuclear concentration rises with the nuclear stain", { tag: ["@unit"] }, () => {
    const light = stainConcentration(flat(stained(H, 0.3), 1), 1)[0];
    const heavy = stainConcentration(flat(stained(H, 1.2), 1), 1)[0];

    expect(light).toBeGreaterThan(0);
    expect(heavy).toBeGreaterThan(light);
});

test("the counter-stain is unmixed away, not counted as nuclei", { tag: ["@unit"] }, () => {
    // This is the assertion a projection cannot pass. Dense eosin is dark and absorbs
    // strongly along the haematoxylin vector; only inverting the basis separates them.
    const nuclei = stainConcentration(flat(stained(H, 0.8), 1), 1)[0];
    const counter = stainConcentration(flat(stained(E, 0.8), 1), 1)[0];

    expect(counter, "equally dense counter-stain must not read as equally nuclear")
        .toBeLessThan(nuclei * 0.5);
});

test("concentration never goes negative", { tag: ["@unit"] }, () => {
    // Unmixing an out-of-basis colour can produce a negative coefficient. A negative
    // "density" would invert the ordering it exists to provide.
    for (const rgb of [[0, 255, 0], [255, 0, 255], [0, 0, 0], [12, 200, 30]]) {
        expect(stainConcentration(flat(rgb, 1), 1)[0], `rgb(${rgb})`).toBeGreaterThanOrEqual(0);
    }
});

test("a degenerate stain basis degrades instead of returning NaN", { tag: ["@unit"] }, () => {
    // Two parallel vectors cannot be inverted — a deployment misconfiguration. The prior
    // should get worse, not poison every downstream comparison with NaN.
    const c = stainConcentration(flat(stained(H, 0.8), 1), 1, {
        nuclear: H, counter: H, third: H,
    });

    expect(Number.isFinite(c[0])).toBe(true);
    expect(c[0]).toBeGreaterThan(0);
});

test("densityGrid reduces pixels to normalized blocks", { tag: ["@unit"] }, () => {
    // 4x4 signal, 2x2 cells: the top-left block is hot, the rest cold.
    const signal = new Float32Array(16);
    signal[0] = signal[1] = signal[4] = signal[5] = 1.0;

    const grid = densityGrid(signal, 4, 4, 2);

    expect(grid.width).toBe(2);
    expect(grid.height).toBe(2);
    expect(grid.values[0]).toBeCloseTo(1, 5);
    expect(grid.values[1]).toBe(0);
});

test("normalization uses the 95th percentile, so one artefact cannot flatten a slide", { tag: ["@unit"] }, () => {
    // 100 blocks of moderate signal and one enormous outlier — a fold, an ink mark.
    // Against the MAXIMUM every real block would collapse to ~0.001 and the prior would
    // carry no ordering at all.
    const signal = new Float32Array(101);
    signal.fill(1);
    signal[100] = 1000;

    const grid = densityGrid(signal, 101, 1, 1);

    const real = Array.from(grid.values).slice(0, 100);
    expect(Math.min(...real), "ordinary tissue keeps a usable value").toBeGreaterThan(0.5);
    expect(grid.values[100], "the outlier is clamped, not allowed to set the scale").toBe(1);
});

test("the mask keeps glass from dragging a block down", { tag: ["@unit"] }, () => {
    // Two 2x2 blocks of equally cellular tissue. The left one is half glass; the right
    // one sits fully inside the tissue. Averaging over the glass would rate the left as
    // half as cellular as the right, purely for where the grid happened to fall.
    //   row 0:  1 0 | 1 1
    //   row 1:  1 0 | 1 1
    const signal = Float32Array.from([1, 0, 1, 1, 1, 0, 1, 1]);
    const mask = Uint8Array.from([1, 0, 1, 1, 1, 0, 1, 1]);

    const unmasked = densityGrid(signal, 4, 2, 2).values;
    expect(unmasked[0] / unmasked[1], "unmasked, the glass halves it").toBeCloseTo(0.5, 5);

    const masked = densityGrid(signal, 4, 2, 2, mask).values;
    expect(masked[0] / masked[1], "masked, the two read as equally cellular").toBeCloseTo(1, 5);
});

test("an all-zero signal yields zeros rather than NaN", { tag: ["@unit"] }, () => {
    const grid = densityGrid(new Float32Array(16), 4, 4, 2);

    for (const v of grid.values) expect(v).toBe(0);
});

test("saturation is the fallback signal where unmixing is meaningless", { tag: ["@unit"] }, () => {
    // Fluorescence is emissive and an unstained slide has nothing to unmix; the basis does
    // not apply, but a bright/saturated ordering still beats no ordering.
    const sat = saturationChannel(flat([0, 200, 0], 1), 1);

    expect(sat[0]).toBe(255);
    expect(saturationChannel(flat([128, 128, 128], 1), 1)[0], "grey is unsaturated").toBe(0);
});
