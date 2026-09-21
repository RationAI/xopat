/**
 * Ground truth for the intensity statistics.
 *
 * "Mean 242.3 · % positive 80.0 %" is not a number anyone can check by looking at
 * a slide, so it has to be checked against arithmetic. Every case here uses a
 * buffer whose answer is known before the implementation runs.
 *
 * These are the pure halves of the raster path: the sampling that produces the
 * buffer needs WebGL and is not covered here (see the file header of
 * `raster-source.test.mjs` for what *is* pinned about it).
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
await import("../../statistics.js");

const stats = globalThis.AnnotationMeasurements.stats;

const range = (a, b) => Float32Array.from({ length: b - a + 1 }, (_, i) => a + i);

test("mean and median over a known sequence @unit", () => {
    // 1..10 → mean (1+10)/2 = 5.5; even count → median is the midpoint 5.5.
    expect(stats.mean(range(1, 10))).toBeCloseTo(5.5, 9);
    expect(stats.median(range(1, 10))).toBeCloseTo(5.5, 9);
    // Odd count → the middle element itself.
    expect(stats.median(range(1, 9))).toBe(5);
});

test("median does not disturb the caller's buffer @unit", () => {
    // It quickselects, which is destructive; the implementation copies first.
    // If that copy were dropped, the *next* metric computed over the same array
    // would silently read a partially sorted buffer.
    const values = Float32Array.from([9, 1, 8, 2, 7]);
    const before = Array.from(values);
    expect(stats.median(values)).toBe(7);
    expect(Array.from(values)).toEqual(before);
});

test("empty input is NaN, never 0 @unit", () => {
    // 0 would read as a measurement; NaN reads as "no measurement".
    expect(Number.isNaN(stats.mean(new Float32Array(0)))).toBe(true);
    expect(Number.isNaN(stats.median(new Float32Array(0)))).toBe(true);
    expect(Number.isNaN(stats.percentPositive(new Float32Array(0), 128))).toBe(true);
});

test("percentPositive counts values at or above the threshold @unit", () => {
    const values = Float32Array.from([0, 100, 127, 128, 200, 255]);
    // >= 128 → 128, 200, 255 = 3 of 6.
    expect(stats.percentPositive(values, 128)).toBeCloseTo(0.5, 12);
    // The boundary is inclusive: everything passes at 0.
    expect(stats.percentPositive(values, 0)).toBe(1);
    // Nothing exceeds 256.
    expect(stats.percentPositive(values, 256)).toBe(0);
});

test("histogram bins every value exactly once and clamps outliers @unit", () => {
    const values = Float32Array.from([0, 64, 128, 192, 255, -10, 300]);
    const h = stats.histogram(values, 4, [0, 255]);
    let total = 0;
    for (const c of h.bins) total += c;
    expect(total).toBe(values.length);
    expect(h.lo).toBe(0);
    expect(h.hi).toBe(255);
    // Out-of-range values land in the end bins rather than being dropped.
    expect(h.bins[0]).toBeGreaterThan(0);
    expect(h.bins[3]).toBeGreaterThan(0);
});

test("otsu splits a bimodal distribution between the modes @unit", () => {
    // 500 dark pixels at 30, 500 bright at 220 — the split belongs between them.
    const values = new Float32Array(1000);
    values.fill(30, 0, 500);
    values.fill(220, 500);

    const t = stats.otsuThreshold(values);
    expect(t).toBeGreaterThan(30);
    expect(t).toBeLessThan(220);
});

test("an auto threshold does not count the background as positive @unit", () => {
    // The regression this suite was written to find. The search accumulates a
    // level into the background class before scoring it, so the maximizing level
    // IS background; returning it made `value >= threshold` true for every dark
    // pixel as well. A 50/50 image reported 100% positive, and the connected-
    // component mask labelled the background too.
    const values = new Float32Array(1000);
    values.fill(30, 0, 500);
    values.fill(220, 500);

    expect(stats.percentPositive(values, stats.otsuThreshold(values))).toBeCloseTo(0.5, 6);
});

test("otsu refuses a distribution with nothing to split @unit", () => {
    // Single-valued: any threshold is arbitrary, so the engine must fall back
    // rather than invent one (measurement-engine `_resolveThreshold` → 128).
    expect(Number.isNaN(stats.otsuThreshold(new Float32Array(0)))).toBe(true);
    expect(Number.isNaN(stats.otsuThreshold(Float32Array.from([7, 7, 7, 7])))).toBe(true);
});
