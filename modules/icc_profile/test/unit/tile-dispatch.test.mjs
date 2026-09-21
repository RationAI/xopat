/**
 * ICC correction has to reach every tile type that carries colour, and has to
 * write each one back as itself.
 *
 * Both halves have failed silently before: `gpuTextureSet` is a sink in OSD's
 * converter graph, so the old hardcoded `getDataAs("imageBitmap")` resolved
 * `undefined` and the module simply returned; and writing a corrected tile back
 * as `imageBitmap` collapses a high-precision source to 8-bit raster. Neither
 * shows up as an error — the slide just renders wrong.
 *
 * The transform itself is covered by the wasm; what is asserted here is the
 * routing.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window || globalThis;
globalThis.Worker = class { constructor() {} postMessage() {} terminate() {} };
globalThis.XOpatModuleSingleton = globalThis.window.XOpatModuleSingleton = class {
    static instance() {}
    getStaticMeta(_key, dflt) { return dflt; }
};
globalThis.VIEWER_MANAGER = { broadcastHandler() {}, addHandler() {}, viewers: [] };
globalThis.addModule = () => {};

const { ICCProfile } = await import("../../icc_client.mjs");

/** A module instance with the worker replaced by a call recorder. */
function makeModule() {
    const icc = Object.create(ICCProfile.prototype);
    icc.profileState = new Map([["src-1", { status: "ready" }]]);
    icc._warnedUncorrectable = new Set();
    icc._jobs = new Map();
    icc._seq = 0;
    icc.debugMode = false;
    icc.calls = [];

    icc.processBitmapForContext = async (ctxId, bmp) => {
        icc.calls.push({ kind: "bitmap", ctxId });
        return { corrected: bmp };
    };
    icc.processBlobForContext = async (ctxId, blob) => {
        icc.calls.push({ kind: "blob", ctxId, size: blob.size });
        return { corrected: blob };
    };
    icc.processPixelsForContext = async (ctxId, view, format) => {
        icc.calls.push({ kind: "pixels", ctxId, format, length: view.length });
        // Stand in for the transform: shift every sample so "corrected" is visible.
        const out = view.slice();
        for (let i = 0; i < out.length; i++) out[i] = (out[i] + 1) % (format === "rgba16" ? 65536 : 256);
        return out.buffer;
    };
    return icc;
}

/** A `tile-invalidated` event whose working cache is a recording stub. */
function makeEvent(nativeType, data) {
    const written = [];
    return {
        written,
        tile: { getCache: () => ({ type: nativeType }) },
        tiledImage: { source: { tileSourceId: "src-1" } },
        getData: async (type) => {
            if (!type) return data;
            if (type === "imageBitmap") return { asBitmap: true };
            if (type === "gpuTextureSet") return data.decoded ?? data;
            return undefined;
        },
        setData: async (value, type) => { written.push({ value, type }); },
    };
}

const textureSet = (packs, channelCount = 4) => ({ width: 2, height: 2, channelCount, packs });
const rgba8Pack = () => ({ format: "RGBA8", data: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]) });

test("a raster tile is corrected as a bitmap and written back as one", { tag: ["@unit"] }, async () => {
    for (const type of ["imageBitmap", "image", "context2d", "rasterBlob"]) {
        const icc = makeModule();
        const e = makeEvent(type, { some: "raster" });
        await ICCProfile.prototype.correctTile.call(icc, e);

        expect(icc.calls).toEqual([{ kind: "bitmap", ctxId: "src-1" }]);
        expect(e.written).toHaveLength(1);
        expect(e.written[0].type).toBe("imageBitmap");
    }
});

test("a still-compressed tile is handed to the worker undecoded", { tag: ["@unit"] }, async () => {
    // The main thread must not build a bitmap for it: the worker decodes the
    // blob itself, which is what keeps the canvas out of the hot path.
    const icc = makeModule();
    const blob = new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])], { type: "image/jpeg" });
    const e = makeEvent("rasterBlob", blob);
    await ICCProfile.prototype.correctTile.call(icc, e);

    expect(icc.calls).toEqual([{ kind: "blob", ctxId: "src-1", size: 4 }]);
    expect(e.written[0].type).toBe("imageBitmap");
});

test("a gpuTextureSet is corrected in place and stays a gpuTextureSet", { tag: ["@unit"] }, async () => {
    const icc = makeModule();
    const original = textureSet([rgba8Pack()]);
    const e = makeEvent("gpuTextureSet", original);
    await ICCProfile.prototype.correctTile.call(icc, e);

    expect(icc.calls).toEqual([{ kind: "pixels", ctxId: "src-1", format: "rgba8", length: 16 }]);
    expect(e.written).toHaveLength(1);
    expect(e.written[0].type).toBe("gpuTextureSet");

    const out = e.written[0].value;
    // A NEW object, or CacheRecord._overwriteData short-circuits and the GPU
    // texture is never refreshed.
    expect(out).not.toBe(original);
    expect(out.packs[0].data).not.toBe(original.packs[0].data);
    expect(Array.from(out.packs[0].data.slice(0, 3))).toEqual([2, 3, 4]);
    // Everything that is not pixels must survive untouched.
    expect(out.width).toBe(2);
    expect(out.channelCount).toBe(4);
    expect(out.packs[0].format).toBe("RGBA8");
});

test("a 16-bit pack keeps its precision", { tag: ["@unit"] }, async () => {
    const icc = makeModule();
    const packs = [{ format: "RGBA16", data: new Uint16Array([1000, 2000, 3000, 65535]) }];
    const e = makeEvent("gpuTextureSet", textureSet(packs));
    await ICCProfile.prototype.correctTile.call(icc, e);

    expect(icc.calls[0].format).toBe("rgba16");
    const out = e.written[0].value.packs[0];
    expect(out.data).toBeInstanceOf(Uint16Array);
    expect(Array.from(out.data)).toEqual([1001, 2001, 3001, 0]);
});

test("rawTiff is decoded to packed textures rather than flattened to raster", { tag: ["@unit"] }, async () => {
    const icc = makeModule();
    // The native payload is an opaque Blob-ish thing; the decoded form is the set.
    const e = makeEvent("rawTiff", { decoded: textureSet([rgba8Pack()]) });
    await ICCProfile.prototype.correctTile.call(icc, e);

    expect(icc.calls[0].kind).toBe("pixels");
    expect(e.written[0].type).toBe("gpuTextureSet");
});

test("float packs are left alone and reported once", { tag: ["@unit"] }, async () => {
    const icc = makeModule();
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...a) => warnings.push(a.join(" "));
    try {
        const packs = [{ format: "RGBA16F", data: new Uint16Array([1, 2, 3, 4]) }];
        await ICCProfile.prototype.correctTile.call(icc, makeEvent("gpuTextureSet", textureSet(packs)));
        // A second tile from the same source must not warn again.
        await ICCProfile.prototype.correctTile.call(icc, makeEvent("gpuTextureSet", textureSet(packs)));
    } finally {
        console.warn = realWarn;
    }

    expect(icc.calls).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("RGBA16F");
});

test("a multi-channel measurement stack is not treated as colour", { tag: ["@unit"] }, async () => {
    const icc = makeModule();
    const e = makeEvent("gpuTextureSet", textureSet([rgba8Pack(), rgba8Pack()], 8));
    await ICCProfile.prototype.correctTile.call(icc, e);

    expect(icc.calls).toHaveLength(0);
    expect(e.written).toHaveLength(0);
});

test("a source with no profile is untouched", { tag: ["@unit"] }, async () => {
    const icc = makeModule();
    icc.profileState = new Map();
    const e = makeEvent("gpuTextureSet", textureSet([rgba8Pack()]));
    await ICCProfile.prototype.correctTile.call(icc, e);

    expect(icc.calls).toHaveLength(0);
    expect(e.written).toHaveLength(0);
});

test("a failed correction leaves the tile alone instead of breaking the chain", { tag: ["@unit"] }, async () => {
    const icc = makeModule();
    icc.processPixelsForContext = async () => { throw new Error("worker died"); };
    const e = makeEvent("gpuTextureSet", textureSet([rgba8Pack()]));

    const realWarn = console.warn;
    console.warn = () => {};
    try {
        await ICCProfile.prototype.correctTile.call(icc, e);
    } finally {
        console.warn = realWarn;
    }
    expect(e.written).toHaveLength(0);
});
