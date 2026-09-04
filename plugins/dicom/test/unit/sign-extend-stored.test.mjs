/**
 * `signExtendStored` recovers the signed stored value from a raw sample. The
 * quantitative path (radiology planes packed as half-floats) has no lookup table
 * to hide this in, so it is the only thing standing between a 12-bit-in-16
 * signed CT and a Hounsfield number that is wrong by 4096 — which renders as a
 * plausible image, not as an error.
 */
import { test, expect } from "@xopat/test-harness";

const { signExtendStored, applyModality } = await import("../../pixel-pipeline.mjs");

const px = (over) => ({ bitsAllocated: 16, bitsStored: 16, pixelRepresentation: 1, ...over });

test("leaves unsigned samples alone", { tag: ["@unit"] }, () => {
    const p = px({ pixelRepresentation: 0 });
    expect(signExtendStored(0, p)).toBe(0);
    expect(signExtendStored(4095, p)).toBe(4095);
    expect(signExtendStored(65535, p)).toBe(65535);
});

test("sign-extends a full-width 16-bit signed sample", { tag: ["@unit"] }, () => {
    const p = px();
    expect(signExtendStored(0, p)).toBe(0);
    expect(signExtendStored(32767, p)).toBe(32767);
    expect(signExtendStored(32768, p)).toBe(-32768);
    expect(signExtendStored(65535, p)).toBe(-1);
    // Already-negative input (an Int16Array read) round-trips unchanged.
    expect(signExtendStored(-1, p)).toBe(-1);
    expect(signExtendStored(-1024, p)).toBe(-1024);
});

test("sign-extends a 12-bit-stored sample from the low 12 bits only", { tag: ["@unit"] }, () => {
    const p = px({ bitsStored: 12 });
    expect(signExtendStored(0, p)).toBe(0);
    expect(signExtendStored(2047, p)).toBe(2047);
    expect(signExtendStored(2048, p)).toBe(-2048);
    expect(signExtendStored(4095, p)).toBe(-1);

    // The bits above highBit carry no meaning. Whether the scanner zero-padded,
    // sign-extended, or left junk there, the stored value is the same.
    expect(signExtendStored(0xF800 | 2048, p)).toBe(-2048);
    expect(signExtendStored(0x1000 | 100, p)).toBe(100);
});

test("a 12-bit-in-16 signed CT reaches the right Hounsfield value either way", { tag: ["@unit"] }, () => {
    const p = px({ bitsStored: 12 });
    const ct = { kind: "linear", slope: 1, intercept: -1024 };

    // Air: stored 0 -> -1024 HU. Water: stored 1024 -> 0 HU.
    expect(applyModality(signExtendStored(0, p), ct)).toBe(-1024);
    expect(applyModality(signExtendStored(1024, p), ct)).toBe(0);

    // The same sample arriving with the high nibble sign-extended by the scanner
    // must not become 61440 HU.
    expect(applyModality(signExtendStored(0xF000, p), ct)).toBe(-1024);
});

test("survives a missing or degenerate pixel descriptor", { tag: ["@unit"] }, () => {
    expect(signExtendStored(123, null)).toBe(123);
    expect(signExtendStored(123, {})).toBe(123);
    // bitsStored wider than the shift is meaningful for is passed through.
    expect(signExtendStored(123, { bitsAllocated: 32, bitsStored: 32, pixelRepresentation: 1 })).toBe(123);
});
