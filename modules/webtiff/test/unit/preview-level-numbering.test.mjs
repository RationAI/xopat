/**
 * The real vendored `WebTiffTileSource`, under a real preview-level graft.
 *
 * This composition is what broke, and it broke silently. The graft prepends an
 * OSD level 0 and pushes `maxLevel` up by one, then delegates every level query
 * to the source's captured original with `level - 1`, through a shim that
 * reports the PRE-graft `maxLevel`. The decoder's own level array is untouched
 * by any of that. So the library's indexing convention and the injector's
 * translation have to agree, and when they did not the result was not an error
 * or a missing tile — it was every tile read one pyramid level too coarse, which
 * looks exactly like a resampling choice.
 *
 * `test/suites/unit/preview-level-eligibility.test.mjs` pins the injector against
 * a synthetic source. This pins it against the actual bundle, because the bug
 * lived in the seam between the two and neither side alone shows it.
 */
import { test, expect } from "@xopat/test-harness";

// Both modules are browser scripts; `preview-level.ts` patches the OSD prototype
// on import, and `makeTileSource` needs a namespace to subclass from.
globalThis.window = globalThis.window ?? globalThis;

class StubTileSource {
    getThumbnail() { return Promise.resolve(undefined); }
    getTilePrecision() { return undefined; }
    getNumTiles() { return { x: 1, y: 1 }; }
    tileExists() { return true; }
    raiseEvent() {}
    addHandler() {}
}

globalThis.window.OpenSeadragon = {
    TileSource: StubTileSource,
    version: { major: 6, versionStr: "6.0.0" },
    Point: class { constructor(x, y) { this.x = x; this.y = y; } },
};
globalThis.window.APPLICATION_CONTEXT = { getOption: () => true };
globalThis.window.UTILITIES = { imageLikeToImage: async () => null };

const { installWebTiffTileSource } = await import("../../tile-source.mjs");
await import("../../../../src/classes/preview-level.ts");

const WebTiffTileSource = installWebTiffTileSource(globalThis.window.OpenSeadragon, {});
const tryInject = StubTileSource.prototype.tryInjectPreviewLevel;

/**
 * A source positioned exactly where `#open` leaves one, without opening a file.
 *
 * The decoder's array is ascending — index 0 is the SMALLEST level — which is
 * the opposite of most viewers' convention and half the reason the off-by-one
 * was easy to write.
 *
 * Each gets its own `tileSourceId`: the injector remembers refusals per id, so
 * sources sharing one do not graft independently.
 */
let fixtureCounter = 0;
function makeSource() {
    const levels = [
        { width: 4096, height: 2048, tileWidth: 256, tileHeight: 256 },
        { width: 8192, height: 4096, tileWidth: 256, tileHeight: 256 },
        { width: 16384, height: 8192, tileWidth: 512, tileHeight: 512 },
        { width: 32768, height: 16384, tileWidth: 512, tileHeight: 512 },
        { width: 65536, height: 32768, tileWidth: 1024, tileHeight: 1024 },
    ];
    const src = Object.create(WebTiffTileSource.prototype);
    Object.assign(src, {
        levels,
        width: 65536,
        height: 32768,
        minLevel: 0,
        maxLevel: levels.length - 1,
        ready: true,
        tileSourceId: `webtiff-numbering-fixture-${++fixtureCounter}`,
        // Distinct per level, so a wrong index is visible rather than plausible.
        getTileUrl(level, x, y) { return `https://slides/${level}/${x}_${y}`; },
        downloadTileAbort() {},
        getThumbnail() { return Promise.resolve(new Blob([])); },
        // Records which decoder level `downloadTileStart` would have read.
        _file: { readTile(level) { src.__lastRead = level; return new Promise(() => {}); } },
        _options: {},
        _outputFor() { return "rgba8"; },
    });
    return src;
}

test("the vendored source reads levels relative to maxLevel", () => {
    const src = makeSource();
    for (let level = 0; level <= src.maxLevel; level++) {
        expect(src._decoderLevel(level)).toBe(level);
        expect(src.getTileWidth(level)).toBe(src.levels[level].tileWidth);
        expect(src.getLevelScale(level)).toBe(src.levels[level].width / 65536);
    }
});

test("after a graft, level L reports what level L-1 reported before it", () => {
    const before = makeSource();
    const widths = [], heights = [], scales = [];
    for (let level = 0; level <= before.maxLevel; level++) {
        widths.push(before.getTileWidth(level));
        heights.push(before.getTileHeight(level));
        scales.push(before.getLevelScale(level));
    }

    const src = makeSource();
    expect(tryInject.call(src)).toBe(true);
    expect(src.maxLevel).toBe(before.maxLevel + 1);

    for (let level = 0; level < widths.length; level++) {
        expect(src.getTileWidth(level + 1)).toBe(widths[level]);
        expect(src.getTileHeight(level + 1)).toBe(heights[level]);
        expect(src.getLevelScale(level + 1)).toBe(scales[level]);
    }

    // And the synthetic level is a real, single-tile level rather than a hole.
    expect(src.getTileWidth(0)).toBeGreaterThan(0);
    expect(src.getLevelScale(0)).toBeGreaterThan(0);
    expect(src.getLevelScale(0)).toBeLessThan(scales[0]);
});

test("no level scale becomes NaN once maxLevel has moved", () => {
    // The sharpest form of the original bug: `getLevelScale` normalized by
    // `levels[this.maxLevel]`, so the graft made the DIVISOR undefined and every
    // scale came back NaN — which OpenSeadragon propagates into the layout.
    const src = makeSource();
    expect(tryInject.call(src)).toBe(true);
    for (let level = 0; level <= src.maxLevel; level++) {
        expect(Number.isNaN(src.getLevelScale(level))).toBe(false);
    }
    expect(src.getLevelScale(src.maxLevel)).toBe(1);
});

test("downloadTileStart reads the decoder level the OSD level now means", () => {
    // The injector delegates `downloadTileStart` in the NEW numbering on purpose
    // — the context carries a NEW `tile.level` — so this override is the one
    // place that must translate, and it is the site that silently read one level
    // too coarse before.
    const src = makeSource();
    expect(tryInject.call(src)).toBe(true);

    const context = {
        tile: { level: 3, x: 0, y: 0 },
        src: "https://slides/2/0_0",
        userData: {},
        finish() {}, fail() {},
    };
    src.downloadTileStart(context);
    // OSD level 3 after the graft is decoder level 2.
    expect(src.__lastRead).toBe(2);
});
