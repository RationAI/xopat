/**
 * The measurements panel once printed "8368 m" for an annotation the canvas
 * labelled "3903 mm" — the same object, off by `pixelsPerMeter` (~2.1e6).
 *
 * The cause was a formatter-pair mix-up on the scalebar. `imageLengthToGivenUnits`
 * / `imageAreaToGivenUnits` take **image pixels** and divide by `pixelsPerMeter`
 * (squared, for area) before choosing a unit prefix. The bare `formatLength` /
 * `formatArea` take a value **already in metres** and only attach the prefix.
 * `unitConverter` called the second pair with pixels, so a pixel count was
 * rendered as metres — and because the magnitude was ~1e6× off, the prefix branch
 * changed too, which is why the unit differed and not just the digits.
 *
 * The pre-existing `measurements-format` suite could not see any of this: it
 * stubs `unitConverter` outright. These cases drive the real one.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
await import("../../raster-sampler.js");
await import("../../geometry-metrics.js");

const NS = globalThis.AnnotationMeasurements;

/** 0.4665 µm/px — a routine 20x slide. */
const PIXELS_PER_METER = 1e6 / 0.4665;

/**
 * Stand-in for the real scalebar. The `image*ToGivenUnits` bodies mirror
 * `src/classes/osd/scalebar/scalebar.ts:432-440`; the bare formatters are traps,
 * because calling them with pixels is precisely the bug.
 */
function makeScalebar({ pixelsPerMeter = PIXELS_PER_METER } = {}) {
    const calls = { formatLength: 0, formatArea: 0 };
    return {
        calls,
        pixelsPerMeter,
        lengthMetric: () => "m",
        areaMetric: () => "m²",
        micronsPerPixel() { return pixelsPerMeter ? 1e6 / pixelsPerMeter : undefined; },
        imageLengthToGivenUnits(px) { return `${px / pixelsPerMeter} m`; },
        imageAreaToGivenUnits(px2) { return `${px2 / (pixelsPerMeter * pixelsPerMeter)} m2`; },
        formatLength(v) { calls.formatLength++; return `${v} m`; },
        formatArea(v) { calls.formatArea++; return `${v} m2`; },
    };
}

test("length labels are converted from image pixels, not passed through raw @unit", () => {
    const scalebar = makeScalebar();
    const conv = NS.geometry.unitConverter({ scalebar });

    // 8368 slide px on this slide is ~3.9 mm, not 8368 of anything physical.
    expect(conv.formatLength(8368)).toBe(scalebar.imageLengthToGivenUnits(8368));
    // The raw formatter would have emitted "8368 m".
    expect(conv.formatLength(8368)).not.toBe("8368 m");
    expect(scalebar.calls.formatLength).toBe(0);
});

test("area labels are converted from image pixels squared @unit", () => {
    const scalebar = makeScalebar();
    const conv = NS.geometry.unitConverter({ scalebar });

    expect(conv.formatArea(1e6)).toBe(scalebar.imageAreaToGivenUnits(1e6));
    expect(conv.formatArea(1e6)).not.toBe("1000000 m2");
    expect(scalebar.calls.formatArea).toBe(0);
});

test("the label agrees with the numeric field it sits next to @unit", () => {
    // The regression was visible as a correct µm number beside a wrong label.
    const scalebar = makeScalebar();
    const conv = NS.geometry.unitConverter({ scalebar });
    const px = 8368;

    const metresFromLabel = Number(conv.formatLength(px).split(" ")[0]);
    const metresFromNumber = conv.lengthImagePxToUm(px) / 1e6;
    expect(Math.abs(metresFromLabel - metresFromNumber)).toBeLessThan(1e-9);
});

test("an uncalibrated slide degrades to pixels rather than inventing metres @unit", () => {
    const conv = NS.geometry.unitConverter({});          // no scalebar at all
    expect(conv.hasPhysical).toBe(false);
    expect(conv.formatLength(1234.6)).toBe("1235 px");
    expect(conv.formatArea(1234.6)).toBe("1235 px²");
    expect(Number.isNaN(conv.areaImagePxToUm2(10))).toBe(true);
});

test("a px-mode scalebar is uncalibrated, whatever pixelsPerMeter says @unit", () => {
    // An uncalibrated slide gets `pixelsPerMeter = 1` and a px renderer, so every
    // truthiness guard reports one metre per pixel — the "1000000.000 µm/px" footer.
    const scalebar = {
        pixelsPerMeter: 1,
        lengthMetric: () => "px",
        areaMetric: () => "px²",
        micronsPerPixel() { return 1e6; },
        imageLengthToGivenUnits(px) { return `${px} px`; },
        imageAreaToGivenUnits(px2) { return `${px2} px²`; },
    };

    expect(NS.sampler.imageMppPerPx({ scalebar })).toBe(undefined);

    const conv = NS.geometry.unitConverter({ scalebar });
    expect(conv.hasPhysical).toBe(false);
    expect(Number.isNaN(conv.areaImagePxToUm2(100))).toBe(true);
    // Labels still work — they never needed µm, only the scalebar's own unit.
    expect(conv.formatArea(100)).toBe("100 px²");
});

test("imageMppPerPx prefers the scalebar's own accessor @unit", () => {
    const scalebar = makeScalebar();
    expect(NS.sampler.imageMppPerPx({ scalebar })).toBeCloseTo(0.4665, 6);

    // A scalebar predating `micronsPerPixel` still resolves through pixelsPerMeter.
    expect(NS.sampler.imageMppPerPx({ scalebar: { pixelsPerMeter: PIXELS_PER_METER } }))
        .toBeCloseTo(0.4665, 6);

    // Uncalibrated and absent both yield undefined, never 0 or Infinity.
    expect(NS.sampler.imageMppPerPx({ scalebar: { pixelsPerMeter: 0 } })).toBe(undefined);
    expect(NS.sampler.imageMppPerPx({})).toBe(undefined);
});
