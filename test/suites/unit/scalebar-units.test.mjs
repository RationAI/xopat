/**
 * The unit ladder, and why a series needs to share one rung.
 *
 * `getWithSquareUnitRounded` picks an SI prefix from the magnitude of the value it
 * is given. For a single readout that is exactly right. For a column it is not:
 * two annotations on one slide rendered as
 *
 *     7 138.95 kpx²        (7 138 947 px²)
 *     919 076.44 px²       (  919 076 px²)
 *
 * — a factor of a thousand apart, with nothing on screen saying so. `scaleForSeries`
 * lets a caller pick one rung for the whole set.
 *
 * The first half of this file pins the existing single-value output, because the
 * ladder was refactored into `{divisor, prefix}` pickers and the rendering of every
 * scalebar label and annotation pill had to come through unchanged.
 */
import { test, expect } from "@xopat/test-harness";

// `units.ts` publishes `ScalebarSizeAndTextRenderer` onto OpenSeadragon at import
// time; the ladder itself needs nothing else from it.
globalThis.window = globalThis.window ?? globalThis;
globalThis.window.OpenSeadragon = globalThis.window.OpenSeadragon ?? {};
globalThis.OpenSeadragon = globalThis.window.OpenSeadragon;

const {
    getWithUnitRounded, getWithSquareUnitRounded,
    unitScale, squareUnitScale, scaleForSeries,
    formatWithScale, formatWithSquareScale,
} = await import("../../../src/classes/osd/scalebar/units.ts");

/** Whitespace in these strings is cosmetic; the number and unit are not. */
const norm = (s) => s.replace(/\s+/g, " ").trim();

test("the area ladder renders each magnitude on its own prefix @unit", () => {
    expect(norm(getWithSquareUnitRounded(7138947.31, "px²"))).toBe("7 138.95 kpx²");
    expect(norm(getWithSquareUnitRounded(919076.44, "px²"))).toBe("919 076.44 px²");
    expect(norm(getWithSquareUnitRounded(0.5, "m²"))).toBe("500 000 mm²");
    expect(norm(getWithSquareUnitRounded(0.0000001, "m²"))).toBe("100 000 μm²");
});

test("the length ladder renders each magnitude on its own prefix @unit", () => {
    expect(norm(getWithUnitRounded(0.0039, "m"))).toBe("3.9 mm");
    // 5e-7 m is below the micro rung, so it reads in nanometres.
    expect(norm(getWithUnitRounded(0.0000005, "m"))).toBe("500 nm");
    expect(norm(getWithUnitRounded(12.5, "m"))).toBe("12.5m");
    expect(norm(getWithUnitRounded(2500, "m"))).toBe("2.5 km");
});

test("negatives keep their sign and their prefix @unit", () => {
    expect(norm(getWithSquareUnitRounded(-7138947.31, "px²"))).toBe("-7 138.95 kpx²");
    expect(norm(getWithUnitRounded(-0.0039, "m"))).toBe("-3.9 mm");
});

test("a series shares the rung the largest value asks for @unit", () => {
    // The reported pair. On one unit the thousandfold difference is legible.
    const areas = [7138947.31, 919076.44];
    const scale = scaleForSeries(areas, squareUnitScale);
    const rendered = areas.map((a) => norm(formatWithSquareScale(a, "px²", scale)));

    expect(rendered).toEqual(["7 138.95 kpx²", "919.08 kpx²"]);
    // Every entry carries the same unit — that is the property that was missing.
    const units = rendered.map((s) => s.replace(/^[-\d\s.]+/, ""));
    expect(new Set(units).size).toBe(1);
});

test("a length series shares one rung too @unit", () => {
    const lengths = [2500, 0.0039];
    const scale = scaleForSeries(lengths, unitScale);
    const rendered = lengths.map((v) => norm(formatWithScale(v, "m", scale)));

    expect(rendered[0]).toBe("2.5 km");
    // 3.9 mm expressed in km rounds to zero rather than silently changing unit;
    // the caller sees the magnitude gap instead of being misled by "3.9".
    expect(rendered[1].endsWith("km")).toBe(true);
});

test("a series of one behaves exactly like the single-value formatter @unit", () => {
    for (const v of [7138947.31, 919076.44, 0.5, 0]) {
        const single = getWithSquareUnitRounded(v, "px²");
        const series = formatWithSquareScale(v, "px²", scaleForSeries([v], squareUnitScale));
        expect(series).toBe(single);
    }
});

test("an all-zero or empty series still picks a usable rung @unit", () => {
    expect(() => scaleForSeries([], squareUnitScale)).not.toThrow();
    // Zero sits in the smallest rung, exactly as the single-value formatter puts it —
    // pinned so the series path cannot drift away from it.
    expect(norm(formatWithSquareScale(0, "px²", scaleForSeries([0], squareUnitScale))))
        .toBe(norm(getWithSquareUnitRounded(0, "px²")));
    // Non-finite entries must not decide the scale for everyone else.
    const scale = scaleForSeries([NaN, Infinity, 5], squareUnitScale);
    expect(norm(formatWithSquareScale(5, "px²", scale))).toBe("5 px²");
});
