/**
 * An overlay is placed by the pixel scale it declares, not by luck.
 *
 * OpenSeadragon normalizes every image in a world to viewport width 1, so two
 * images overlap correctly only when their aspect ratios happen to match. That
 * is a coincidence, and when it fails it fails quietly: the overlay still covers
 * the slide, just at slightly the wrong scale, drifting from the origin.
 *
 * The motivating case, and the numbers these vectors are built from: a model
 * predicts on 512 x 512 squares over a 105185 x 221772 slide. 105185 / 512 =
 * 205.44, so the mask is 206 cells wide and covers 105472 slide pixels — its
 * edge column hangs past the slide. Squeezed to width 1, each cell became
 * 510.61 px instead of 512 and the far corner sat nearly a whole cell out.
 *
 * `pixelScale` states the missing fact. These pin the arithmetic, the
 * composition with a virtual-region crop, and — most importantly — that every
 * malformed or hostile value degrades to exactly the old behaviour rather than
 * throwing or being honoured.
 */
import { test, expect } from "@xopat/test-harness";

const { readPixelScale, computeOverlayWidth, MAX_PIXEL_SCALE } =
    await import("../../../src/classes/app/overlay-pixel-scale.ts");

// The real demo geometry.
const SLIDE_W = 105185;
const MASK_W = 206;
const CELL = 512;

// ── readPixelScale ─────────────────────────────────────────────────────────

test("a plain positive number is taken as the horizontal scale", () => {
    expect(readPixelScale({ pixelScale: 512 })).toBe(512);
    expect(readPixelScale({ pixelScale: 0.5 })).toBe(0.5);
});

test("the {x, y} form is read from x, since only width drives placement", () => {
    // OSD derives height from the image's own aspect ratio, so `y` is carried
    // by the image itself and never needed here.
    expect(readPixelScale({ pixelScale: { x: 512, y: 512 } })).toBe(512);
    expect(readPixelScale({ pixelScale: { x: 4, y: 8 } })).toBe(4);
});

test("absent means no opinion, not zero", () => {
    expect(readPixelScale({})).toBe(undefined);
    expect(readPixelScale({ pixelScale: undefined })).toBe(undefined);
    expect(readPixelScale({ pixelScale: null })).toBe(undefined);
});

test("a bare data id has no fields and is ignored without complaint", () => {
    const warnings = [];
    expect(readPixelScale("slides/slide.tif", (m) => warnings.push(m))).toBe(undefined);
    expect(readPixelScale(undefined, (m) => warnings.push(m))).toBe(undefined);
    expect(warnings).toEqual([]);
});

test("malformed values are refused AND reported", () => {
    // Silence would make a typo indistinguishable from omission, which is how a
    // misconfigured overlay goes unnoticed.
    for (const bad of [0, -1, NaN, Infinity, "512", true, {}, { y: 512 }, []]) {
        const warnings = [];
        expect(readPixelScale({ pixelScale: bad }, (m) => warnings.push(m))).toBe(undefined);
        expect(warnings.length).toBe(1);
    }
});

test("a hostile magnitude is clamped out, not honoured", () => {
    // Session data is third-party controllable. Placing an image at 1e9x the
    // viewport is not a visual glitch, it is a renderer allocating tiles for a
    // world it can never draw.
    expect(readPixelScale({ pixelScale: 1e9 })).toBe(undefined);
    expect(readPixelScale({ pixelScale: 1e-9 })).toBe(undefined);
    expect(readPixelScale({ pixelScale: MAX_PIXEL_SCALE })).toBe(MAX_PIXEL_SCALE);
    expect(readPixelScale({ pixelScale: 1 / MAX_PIXEL_SCALE })).toBe(1 / MAX_PIXEL_SCALE);
});

test("refusal never throws", () => {
    // An overlay is not worth failing an open over.
    expect(() => readPixelScale({ pixelScale: Symbol("x") })).not.toThrow();
    expect(() => readPixelScale(Object.create(null))).not.toThrow();
});

// ── computeOverlayWidth ────────────────────────────────────────────────────

test("the demo mask comes out wider than the slide, as its cells demand", () => {
    const width = computeOverlayWidth({
        ownWidth: MASK_W, referenceWidth: SLIDE_W, scaleX: CELL,
    });
    // 206 * 512 / 105185 = 1.002728...  The overlay overhangs by 287 slide px,
    // which is exactly the part of the edge prediction square the slide cuts off.
    expect(width).toBeCloseTo(1.0027285, 6);
    expect(width).toBeGreaterThan(1);
});

test("the cells land on true 512 px multiples once placed", () => {
    // This is the property the `grid` shader (anchored to the slide at 512) is
    // compared against, and the one that was violated before.
    const width = computeOverlayWidth({
        ownWidth: MASK_W, referenceWidth: SLIDE_W, scaleX: CELL,
    });
    const cellInSlidePx = (width * SLIDE_W) / MASK_W;
    expect(cellInSlidePx).toBeCloseTo(CELL, 9);
});

test("without a scale the old squeeze is what you get", () => {
    // Documents the defect: 206 cells over the slide's width is 510.61 px/cell,
    // drifting 287 px by the right edge.
    const squeezedCell = SLIDE_W / MASK_W;
    expect(squeezedCell).toBeCloseTo(510.6068, 3);
    expect(MASK_W * (CELL - squeezedCell)).toBeCloseTo(287, 0);
});

test("a half-resolution overlay is placed at width 1", () => {
    // The ordinary co-registered case: same field of view, coarser raster.
    expect(computeOverlayWidth({ ownWidth: 500, referenceWidth: 1000, scaleX: 2 })).toBe(1);
});

test("a stack placement multiplies rather than replaces", () => {
    // A virtual-region crop places every tile of its stack at the region's
    // fraction; an overlay in that stack must be cropped AND scaled.
    const plain = computeOverlayWidth({ ownWidth: 500, referenceWidth: 1000, scaleX: 2 });
    const cropped = computeOverlayWidth({
        ownWidth: 500, referenceWidth: 1000, scaleX: 2, placementWidth: 0.25,
    });
    expect(plain).toBe(1);
    expect(cropped).toBe(0.25);
});

test("a missing or nonsensical stack placement is treated as no crop", () => {
    for (const placementWidth of [undefined, null, 0, -1, NaN, "0.5"]) {
        expect(computeOverlayWidth({
            ownWidth: 500, referenceWidth: 1000, scaleX: 2, placementWidth,
        })).toBe(1);
    }
});

test("unusable inputs yield no width, so the caller leaves OSD alone", () => {
    const base = { ownWidth: 206, referenceWidth: SLIDE_W, scaleX: CELL };
    expect(computeOverlayWidth({ ...base, ownWidth: 0 })).toBe(undefined);
    expect(computeOverlayWidth({ ...base, ownWidth: undefined })).toBe(undefined);
    expect(computeOverlayWidth({ ...base, referenceWidth: 0 })).toBe(undefined);
    expect(computeOverlayWidth({ ...base, referenceWidth: undefined })).toBe(undefined);
    expect(computeOverlayWidth({ ...base, scaleX: undefined })).toBe(undefined);
    expect(computeOverlayWidth({ ...base, scaleX: NaN })).toBe(undefined);
    expect(computeOverlayWidth({ ...base, scaleX: -1 })).toBe(undefined);
});

test("scale 1 on an equal-sized overlay is exactly the OSD default", () => {
    // The no-op case must be a true no-op: same width OSD would have chosen, so
    // declaring the obvious changes nothing.
    expect(computeOverlayWidth({
        ownWidth: SLIDE_W, referenceWidth: SLIDE_W, scaleX: 1,
    })).toBe(1);
});
