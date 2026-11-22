/**
 * Output sizing of an off-screen region render (`viewer.captureRegion`,
 * `visualization.renderRegion*`).
 *
 * What these vectors pin:
 *  - an explicit `size` is a contract: fitted to the region's aspect ratio, refused when
 *    it exceeds `maxPixels`;
 *  - `magnification` / `targetPixels` are requests: never upsampled past native resolution,
 *    shrunk to `maxPixels` instead of refused, with the effective scale reported;
 *  - an uncalibrated slide cannot honour a magnification and says what to pass instead,
 *    rather than rendering at an invented resolution.
 */
import { test, expect } from "@xopat/test-harness";

const { resolveRegionRenderSize } = await import("../../../src/classes/scripting/region-render-size.ts");

const region = { regionWidth: 4000, regionHeight: 2000, maxPixels: 4096 * 4096 };

test("size: one dimension derives the other from the region aspect", () => {
    expect(resolveRegionRenderSize({ ...region, size: { width: 500 } }))
        .toMatchObject({ width: 500, height: 250, scale: 0.125 });
    expect(resolveRegionRenderSize({ ...region, size: { height: 500 } }))
        .toMatchObject({ width: 1000, height: 500 });
});

test("size: a box is fitted, not stretched", () => {
    expect(resolveRegionRenderSize({ ...region, size: { width: 800, height: 800 } }))
        .toMatchObject({ width: 800, height: 400 });
});

test("size: an explicit size over maxPixels is refused", () => {
    expect(() => resolveRegionRenderSize({ ...region, maxPixels: 1000, size: { width: 500 } }))
        .toThrow(/too large/);
});

test("magnification: scales against the native objective power", () => {
    const out = resolveRegionRenderSize({ ...region, magnification: 10, nativeMagnification: 40 });
    expect(out).toMatchObject({ width: 1000, height: 500, scale: 0.25, magnification: 10 });
});

test("magnification: never upsampled past native resolution", () => {
    const out = resolveRegionRenderSize({ ...region, magnification: 80, nativeMagnification: 40 });
    expect(out).toMatchObject({ width: 4000, height: 2000, scale: 1, magnification: 40 });
});

test("magnification: shrunk to maxPixels and the effective value reported", () => {
    const out = resolveRegionRenderSize({ ...region, maxPixels: 20000, magnification: 40, nativeMagnification: 40 });
    expect(out.width * out.height).toBeLessThanOrEqual(20000);
    expect(out.width).toBe(200);
    expect(out.magnification).toBeCloseTo(2);
});

test("magnification: an uncalibrated slide names the alternative", () => {
    expect(() => resolveRegionRenderSize({ ...region, magnification: 10, nativeMagnification: null }))
        .toThrow(/targetPixels/);
});

test("targetPixels: works without calibration and keeps the aspect", () => {
    const out = resolveRegionRenderSize({ ...region, targetPixels: 20000 });
    expect(out).toMatchObject({ width: 200, height: 100, magnification: null });
});

test("exactly one way of asking for detail", () => {
    expect(() => resolveRegionRenderSize({ ...region })).toThrow(/one of/);
    expect(() => resolveRegionRenderSize({ ...region, size: { width: 100 }, targetPixels: 100 }))
        .toThrow(/only one/);
});
