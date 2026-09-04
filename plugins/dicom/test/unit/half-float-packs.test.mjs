/**
 * Half-float texture packs are the one place a DICOM overlay's numbers become
 * GPU memory, and getting the shape wrong is invisible in review: a pack that is
 * four times too large still renders correctly, and a pack written at the wrong
 * stride still uploads. The renderer validates length against the format, so a
 * mismatch now fails at upload — but only on a machine with a GPU, which is not
 * where this suite runs. So the shapes are pinned here.
 *
 * The narrow formats (`R16F`, `RG16F`) exist because a Parametric Map and a
 * radiology plane both carry exactly ONE channel; packing that into RGBA16F
 * spent three quarters of the upload, and of the plane cache, on zeroes.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.window.OpenSeadragon = globalThis.window.OpenSeadragon ?? {
    converter: { copyings: {}, destructors: {} },
    TileSource: class { constructor(options) { Object.assign(this, options || {}); } },
    ImageJob: function ImageJob() { throw new Error("not used in unit tests"); },
};
globalThis.OpenSeadragon = globalThis.window.OpenSeadragon;
globalThis.HTTPError = globalThis.HTTPError ?? class HTTPError extends Error {};
globalThis.window.$ = globalThis.window.$ ?? { t: (key) => String(key).split(".").pop() };

const { writeHalfChannel, floatToHalf, warnHalfFloatPrecisionOnce } =
    await import("../../pixel-pipeline.mjs");
const { DICOMDerivedTileSource } = await import("../../derived-tile-source.mjs");

/** IEEE 754 half -> float, for reading a pack back. */
function halfToFloat(bits) {
    const sign = (bits & 0x8000) ? -1 : 1;
    const exponent = (bits >> 10) & 0x1f;
    const mantissa = bits & 0x3ff;
    if (exponent === 0) return sign * mantissa * Math.pow(2, -24);
    if (exponent === 0x1f) return mantissa ? NaN : sign * Infinity;
    return sign * (mantissa + 1024) * Math.pow(2, exponent - 25);
}

/* ------------------------------------------------------------------ */
/* writeHalfChannel                                                    */
/* ------------------------------------------------------------------ */

test("writeHalfChannel strides by the pack width, not always by four", { tag: ["@unit"] }, () => {
    const values = [0, 0.25, 0.5, 1];

    for (const componentsPerPack of [1, 2, 4]) {
        for (let channel = 0; channel < componentsPerPack; channel++) {
            const target = new Uint16Array(values.length * componentsPerPack);
            writeHalfChannel(target, values, channel, componentsPerPack);

            for (let i = 0; i < values.length; i++) {
                for (let c = 0; c < componentsPerPack; c++) {
                    const got = target[i * componentsPerPack + c];
                    // Only the requested component is written; the rest are
                    // whatever the buffer already held (here, zero).
                    if (c === channel) expect(halfToFloat(got)).toBeCloseTo(values[i], 3);
                    else expect(got).toBe(0);
                }
            }
        }
    }
});

test("writeHalfChannel bounds on the pack width, so a narrow buffer fills completely",
    { tag: ["@unit"] }, () => {
        // The old bound was `target.length / 4` unconditionally, which would have
        // written only a quarter of an R16F buffer and left the rest black.
        const values = [1, 1, 1, 1, 1, 1, 1, 1];
        const target = new Uint16Array(8);
        writeHalfChannel(target, values, 0, 1);
        expect([...target].every(v => halfToFloat(v) === 1)).toBe(true);
    });

test("writeHalfChannel defaults to four components", { tag: ["@unit"] }, () => {
    const target = new Uint16Array(8);
    writeHalfChannel(target, [1, 1], 3);
    expect(target[3]).toBe(floatToHalf(1));
    expect(target[7]).toBe(floatToHalf(1));
    expect(target[0]).toBe(0);
});

/* ------------------------------------------------------------------ */
/* _composeHalfFloatSet                                                */
/* ------------------------------------------------------------------ */

/**
 * The composer reads only `this.kind`, so it can be exercised off the prototype
 * rather than by standing up a whole tile source against a fake DICOMweb store.
 */
const compose = (channelCount, planes, requests, w = 2, h = 2) =>
    DICOMDerivedTileSource.prototype._composeHalfFloatSet.call(
        { kind: "pmap" }, planes, requests, w, h, channelCount);

test("one channel packs as R16F, with no padding at all", { tag: ["@unit"] }, () => {
    // Every Parametric Map lands here: `_channelOrder` is `[null]`.
    const set = compose(1, [[0, 0.5, 1, 0.25]], [{ channel: 0 }]);

    expect(set.packs).toHaveLength(1);
    expect(set.packs[0].format).toBe("R16F");
    expect(set.packs[0].data).toHaveLength(4);       // was 16 under RGBA16F
    expect(set.channelCount).toBe(1);
    expect(halfToFloat(set.packs[0].data[1])).toBeCloseTo(0.5, 3);
    expect(halfToFloat(set.packs[0].data[3])).toBeCloseTo(0.25, 3);
});

test("two channels pack as RG16F in one pack", { tag: ["@unit"] }, () => {
    const set = compose(2, [[1, 1, 1, 1], [0.5, 0.5, 0.5, 0.5]],
        [{ channel: 0 }, { channel: 1 }]);

    expect(set.packs).toHaveLength(1);
    expect(set.packs[0].format).toBe("RG16F");
    expect(set.packs[0].data).toHaveLength(8);
    expect(halfToFloat(set.packs[0].data[0])).toBeCloseTo(1, 3);
    expect(halfToFloat(set.packs[0].data[1])).toBeCloseTo(0.5, 3);
});

test("three or more channels stay on RGBA16F, one pack per four", { tag: ["@unit"] }, () => {
    const plane = (v) => [v, v, v, v];
    const planes = [0.1, 0.2, 0.3, 0.4, 0.5].map(plane);
    const requests = planes.map((_, i) => ({ channel: i }));
    const set = compose(5, planes, requests);

    expect(set.packs).toHaveLength(2);              // ceil(5 / 4)
    expect(set.packs.every(p => p.format === "RGBA16F")).toBe(true);
    expect(set.packs[0].data).toHaveLength(16);
    expect(set.channelCount).toBe(5);

    // Channel 4 is component 0 of the SECOND pack — the division must agree with
    // the `>> 2` / `& 3` it replaced.
    expect(halfToFloat(set.packs[0].data[3])).toBeCloseTo(0.4, 3);
    expect(halfToFloat(set.packs[1].data[0])).toBeCloseTo(0.5, 3);
});

test("a channelCount of zero still yields one usable pack", { tag: ["@unit"] }, () => {
    // `Math.max(channelCount, 1)` — a texture set with no packs is not a thing
    // the renderer accepts.
    const set = compose(0, [], []);
    expect(set.packs).toHaveLength(1);
    expect(set.channelCount).toBe(1);
});

/* ------------------------------------------------------------------ */
/* The precision warning                                               */
/* ------------------------------------------------------------------ */

test("warns only for unorm8, and only once per session", { tag: ["@unit"] }, () => {
    const warnings = [];
    const realWarn = console.warn;
    const realContext = globalThis.APPLICATION_CONTEXT;
    console.warn = (...args) => warnings.push(args.join(" "));

    try {
        // "auto" negotiates the upgrade from the data; "float16" forces it. The
        // previous version warned for both, telling a correctly configured
        // deployment to change a working setting.
        for (const precision of ["auto", "float16"]) {
            globalThis.APPLICATION_CONTEXT = { getOption: () => precision };
            warnHalfFloatPrecisionOnce("test");
        }
        expect(warnings).toEqual([]);

        const session = { getOption: () => "unorm8" };
        globalThis.APPLICATION_CONTEXT = session;
        warnHalfFloatPrecisionOnce("test");
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("unorm8");

        // A study with eight series must not print eight identical warnings.
        warnHalfFloatPrecisionOnce("test");
        expect(warnings).toHaveLength(1);

        // ...but a NEW session is a new context, and hears about it again.
        globalThis.APPLICATION_CONTEXT = { getOption: () => "unorm8" };
        warnHalfFloatPrecisionOnce("test");
        expect(warnings).toHaveLength(2);
    } finally {
        console.warn = realWarn;
        globalThis.APPLICATION_CONTEXT = realContext;
    }
});
