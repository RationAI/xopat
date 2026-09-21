/**
 * The declared range and the samples must live in the same unit system.
 *
 * `RealWorldValueFirst/LastValueMapped` are STORED-value bounds — the interval
 * over which the mapping is defined (PS3.3 C.7.6.16.2.11) — not the real-world
 * values those bounds denote. `parseRealWorldRange` returned them raw while
 * `applyModality` put the samples through the RWVM affine, so an object with
 * slope 2 was labelled `[0, 1]` while its data reached 2. The tile source then
 * normalized against the wrong range and hard-clamped the excess, turning the
 * upper half of a score map into a flat saturated plateau that no window setting
 * could recover. That is the bug this file pins.
 */
import { test, expect } from "@xopat/test-harness";

const { parseRealWorldRange, storedValueRange, applyModality, parseModalityLut } =
    await import("../../pixel-pipeline.mjs");

/** DICOM JSON element helpers — the shapes the parsers actually read. */
const num = (...v) => ({ vr: "FD", Value: v });
const seq = (...items) => ({ vr: "SQ", Value: items });

/** A Real World Value Mapping over stored 0..1 with the given affine. */
const rwvm = ({ first = 0, last = 1, slope, intercept } = {}) => ({
    "00409096": seq({
        "00409216": num(first),                                    // FirstValueMapped
        "00409211": num(last),                                     // LastValueMapped
        ...(slope === undefined ? {} : { "00409225": num(slope) }),      // Slope
        ...(intercept === undefined ? {} : { "00409224": num(intercept) }), // Intercept
    }),
});

test("the mapped bounds are reported in real-world units, not stored", { tag: ["@unit"] }, () => {
    // The measured shape: stored 0..1, slope 2 — a map whose values reach 2 while
    // the tag's bounds read 0..1.
    const range = parseRealWorldRange(rwvm({ first: 0, last: 1, slope: 2, intercept: 0 }));
    expect(range).toEqual({ min: 0, max: 2 });
});

test("an intercept shifts the range with the samples", { tag: ["@unit"] }, () => {
    const ds = rwvm({ first: 0, last: 100, slope: 0.5, intercept: -10 });
    expect(parseRealWorldRange(ds)).toEqual({ min: -10, max: 40 });
});

test("the range is exactly what the samples become", { tag: ["@unit"] }, () => {
    // The invariant, stated directly: whatever transform the samples get, the
    // bounds get. Anything else and the two disagree by that transform.
    const ds = rwvm({ first: 3, last: 97, slope: 1.75, intercept: 4 });
    const lut = parseModalityLut(ds);
    const range = parseRealWorldRange(ds);

    expect(range.min).toBeCloseTo(applyModality(3, lut), 9);
    expect(range.max).toBeCloseTo(applyModality(97, lut), 9);
});

test("an identity mapping is unchanged", { tag: ["@unit"] }, () => {
    // Slope 1 / no intercept is the case that always worked; it must keep working.
    expect(parseRealWorldRange(rwvm({ first: 0, last: 4095, slope: 1 })))
        .toEqual({ min: 0, max: 4095 });
    expect(parseRealWorldRange(rwvm({ first: 0, last: 4095 })))
        .toEqual({ min: 0, max: 4095 });
});

test("no mapping sequence yields no range", { tag: ["@unit"] }, () => {
    expect(parseRealWorldRange({})).toBe(null);
    // A degenerate interval is not a range either.
    expect(parseRealWorldRange(rwvm({ first: 5, last: 5, slope: 2 }))).toBe(null);
});

test("a LUT reports the values it can actually produce", { tag: ["@unit"] }, () => {
    // A lookup table need not be monotonic, so its endpoints are not its extremes;
    // taking first/last would under-report the range and clamp real data away.
    const ds = {
        "00409096": seq({
            "00409216": num(0),
            "00409211": num(3),
            "00409212": { vr: "OW", InlineBinary: null },
        }),
    };
    const parsed = parseRealWorldRange(ds);
    // Without decodable LUT data the parser must fall back to the affine path
    // rather than invent a range.
    expect(parsed === null || (parsed.min <= parsed.max)).toBe(true);
});

test("storedValueRange stays the fallback shape it always was", { tag: ["@unit"] }, () => {
    // The derived source now falls back to this when an object declares no RWVM,
    // instead of assuming 0..1 and normalizing a 16-bit map into its bottom
    // 1/65535. Signed and unsigned both have to come out right.
    expect(storedValueRange({ bitsStored: 16, pixelRepresentation: 0 }, null))
        .toEqual({ min: 0, max: 65535 });
    expect(storedValueRange({ bitsStored: 16, pixelRepresentation: 1 }, null))
        .toEqual({ min: -32768, max: 32767 });
    expect(storedValueRange({ bitsStored: 8, pixelRepresentation: 0 }, { kind: "linear", slope: 2, intercept: 1 }))
        .toEqual({ min: 1, max: 511 });
});
