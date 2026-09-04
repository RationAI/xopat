/**
 * Who may receive a synthetic preview level, and what the graft does to the
 * pyramid's numbering.
 *
 * Eligibility used to be decided in two places for two different reasons: the
 * open pipeline refused any layer that was not a background ("shader data, an
 * RGB preview would be semantically wrong"), and `modules/webtiff` opted out
 * wholesale because the graft shifts OSD levels while its decoder indexes its
 * own level array absolutely. The first was too broad — a raster prediction mask
 * is a tiled image like any other — and the second was a real bug wearing an
 * opt-out as a workaround.
 *
 * Eligibility is now entirely the source's, and these vectors pin it:
 *  - a plain 8-bit source that declares no precision is eligible (the default
 *    must stay permissive, or DICOMweb — the feature's original consumer —
 *    silently loses it),
 *  - a source declaring `float16` is refused, because the synthetic tile is
 *    served as an 8-bit `rasterBlob` and cannot stand in for half-float packs,
 *  - `__noPreviewLevel` still wins outright,
 *  - a source with no real `getThumbnail()` is refused, which is what makes the
 *    vector tile sources fall out for free with no vector special-case,
 *  - a coarsest level at or below the threshold is refused as pointless,
 *  - the call is idempotent,
 *  - and after a graft, level L reports what level L-1 reported before it, which
 *    is the invariant every level-indexing consumer depends on.
 */
import { test, expect } from "@xopat/test-harness";

// The module is a browser script that patches the OSD prototype on import.
globalThis.window = globalThis.window ?? globalThis;

/** Base prototype the module patches, and against which it compares overrides. */
const tileSourcePrototype = {
    getThumbnail() { return Promise.resolve(undefined); },
    getTilePrecision() { return undefined; },
    getNumTiles() { return { x: 1, y: 1 }; },
    tileExists() { return true; },
};

globalThis.window.OpenSeadragon = { TileSource: { prototype: tileSourcePrototype } };
globalThis.window.APPLICATION_CONTEXT = { getOption: (key) => key !== "__never" };
globalThis.window.UTILITIES = { imageLikeToImage: async () => null };

await import("../../../src/classes/preview-level.ts");

const tryInject = tileSourcePrototype.tryInjectPreviewLevel;

/**
 * A minimal conformant source. `width/height` and the level scales describe a
 * pyramid whose coarsest level is `width * scale0` wide.
 *
 * @param {object} [over] fields to override — this is how each vector differs
 */
function makeSource(over = {}) {
    const levels = over.levels ?? 5;   // coarsest 4096x2048 by default
    const src = {
        width: 65536,
        height: 32768,
        minLevel: 0,
        maxLevel: levels - 1,
        ready: true,
        tileSourceId: over.tileSourceId ?? `slide-${Math.random().toString(36).slice(2)}`,
        getLevelScale(level) { return 1 / Math.pow(2, this.maxLevel - level); },
        getTileWidth() { return 256; },
        getTileHeight() { return 256; },
        getTileUrl(level, x, y) { return `https://slides/${level}/${x}_${y}`; },
        downloadTileStart(context) { context.finish(null, null, "rasterBlob"); },
        downloadTileAbort() {},
        // A real override, i.e. not the base no-op — that is the eligibility test.
        getThumbnail() { return Promise.resolve(new Blob([])); },
    };
    Object.setPrototypeOf(src, tileSourcePrototype);
    delete over.levels;
    return Object.assign(src, over);
}

test("a plain 8-bit source that declares nothing is eligible", () => {
    const src = makeSource();
    expect(tryInject.call(src)).toBe(true);
    expect(src.__previewLevelInjected).toBe(true);
});

test("an undeclared precision is treated as 8-bit-compatible", () => {
    // The permissive default is deliberate: every source that worked with the
    // preview level before `getTilePrecision` existed declares nothing, and
    // defaulting the other way would disable the feature for all of them.
    const src = makeSource({ getTilePrecision: () => undefined });
    expect(tryInject.call(src)).toBe(true);
});

test("a float16 source is refused: the synthetic tile is an 8-bit raster", () => {
    const src = makeSource({ getTilePrecision: () => "float16" });
    expect(tryInject.call(src)).toBe(false);
    expect(src.__previewLevelInjected).toBeFalsy();
});

test("an explicit unorm8 declaration is eligible", () => {
    const src = makeSource({ getTilePrecision: () => "unorm8" });
    expect(tryInject.call(src)).toBe(true);
});

test("a throwing getTilePrecision does not block injection", () => {
    // A source mid-initialisation may not be able to answer yet; that is not a
    // reason to refuse, and certainly not a reason to throw out of the open.
    const src = makeSource({ getTilePrecision() { throw new Error("not ready"); } });
    expect(tryInject.call(src)).toBe(true);
});

test("__noPreviewLevel wins outright", () => {
    const src = makeSource({ __noPreviewLevel: true });
    expect(tryInject.call(src)).toBe(false);
});

test("a source with no real getThumbnail is refused — vector sources for free", () => {
    // `$.MVTTileSource` / `$.GeoJSONTileSource` implement no thumbnail, so this
    // one condition is the whole of "raster only". There is no vector branch.
    const src = makeSource();
    src.getThumbnail = tileSourcePrototype.getThumbnail;
    expect(tryInject.call(src)).toBe(false);
});

test("a coarsest level at or below the threshold is refused", () => {
    // 3 levels => coarsest 16384/4 = 4096 wide (eligible),
    // 1 level  => coarsest is full size, but a small slide is not.
    const small = makeSource({ width: 2048, height: 1024, levels: 1 });
    expect(tryInject.call(small)).toBe(false);

    const big = makeSource({ width: 8192, height: 4096, levels: 2 });
    expect(tryInject.call(big)).toBe(true);
});

test("injection is idempotent", () => {
    const src = makeSource();
    expect(tryInject.call(src)).toBe(true);
    expect(tryInject.call(src)).toBe(true);
    expect(src.maxLevel).toBe(5);   // shifted exactly once, not twice
});

test("minLevel must be 0", () => {
    const src = makeSource({ minLevel: 1 });
    expect(tryInject.call(src)).toBe(false);
});

test("a not-ready source is refused", () => {
    const src = makeSource({ ready: false });
    expect(tryInject.call(src)).toBe(false);
});

test("after a graft, level L reports what level L-1 reported before", () => {
    // This is the invariant a level-indexing consumer depends on, and the one
    // `modules/webtiff._decoderLevel` exists to preserve on the decoder side.
    const src = makeSource();
    const before = [];
    for (let level = 0; level <= src.maxLevel; level++) {
        before.push({
            scale: src.getLevelScale(level),
            width: src.getTileWidth(level),
            url: src.getTileUrl(level, 1, 2),
        });
    }
    const oldMax = src.maxLevel;

    expect(tryInject.call(src)).toBe(true);
    expect(src.maxLevel).toBe(oldMax + 1);

    for (let level = 1; level <= src.maxLevel; level++) {
        expect(src.getLevelScale(level)).toBe(before[level - 1].scale);
        expect(src.getTileWidth(level)).toBe(before[level - 1].width);
        expect(src.getTileUrl(level, 1, 2)).toBe(before[level - 1].url);
    }
});

test("the synthetic level 0 is a single tile covering the whole image", () => {
    const src = makeSource();
    expect(tryInject.call(src)).toBe(true);

    const w = src.getTileWidth(0);
    const h = src.getTileHeight(0);
    // Halvings of the coarsest scale, capped at the 1024 px target.
    expect(Math.max(w, h)).toBeLessThanOrEqual(1024);
    // One tile: the level's pixel size IS the tile size.
    expect(src.__previewLevelDims).toEqual({ w, h });
    // Aspect preserved, so the preview is not stretched onto the level.
    expect(Math.abs(w / h - src.width / src.height)).toBeLessThan(0.01);
    // A distinct URL per slide, or two previews would alias in the tile cache.
    expect(src.getTileUrl(0, 0, 0)).toContain(src.tileSourceId);
});
