/**
 * Which slides may be split into virtual regions.
 *
 * A virtual region's INTERIOR tiles are the parent's own tiles, passed through
 * untouched — those work for any payload. Its BORDER tiles are not: `_composeTile`
 * re-fetches them from `parent.getTileUrl(...)`, decodes them with the browser
 * (`createImageBitmap` / `<img>`) and blits them onto a 2D canvas. So the split
 * only works for a parent whose tiles are plainly-fetchable browser-decodable
 * images, and every other parent used to open into a viewer ringed with failed
 * tiles instead of being refused.
 *
 * `canCompositeRegions` derives the verdict instead of listing ids: a source that
 * still uses the base `downloadTileStart` is on exactly the plain URL→image path
 * the compositor imitates, and every source that decodes elsewhere (webtiff,
 * DICOM, MVT, pixelmaps) overrides it. These vectors pin that, plus the two
 * escape hatches — the explicit `supportsRegionCompositing` opt-in/opt-out, and
 * a non-raster `_dataFormat` on an otherwise inherited download path.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

/** The base download path `canCompositeRegions` compares against. */
const baseDownloadTileStart = function (context) { context.finish(null, null, "rasterBlob"); };
globalThis.window.OpenSeadragon = globalThis.window.OpenSeadragon ?? {};
globalThis.window.OpenSeadragon.TileSource = globalThis.window.OpenSeadragon.TileSource ?? { prototype: {} };
globalThis.window.OpenSeadragon.TileSource.prototype.downloadTileStart = baseDownloadTileStart;

const { canCompositeRegions } = await import("../../../src/classes/virtual-region-protocol.ts");

/** A plain raster pyramid: inherits the base download path, declares no format. */
function makeSource(over = {}) {
    return Object.assign({
        width: 4096,
        height: 2048,
        downloadTileStart: baseDownloadTileStart,
        getTileUrl(level, x, y) { return `https://slides/${level}/${x}_${y}`; },
    }, over);
}

test("a plain raster pyramid on the base download path may be split", () => {
    expect(canCompositeRegions(makeSource())).toBe(true);
});

test("a source that decodes its own tiles may not", () => {
    // webtiff / DICOM / MVT / pixelmap all differ from the base exactly here.
    const src = makeSource({ downloadTileStart(context) { context.finish({}, null, "gpuTextureSet"); } });
    expect(canCompositeRegions(src)).toBe(false);
});

test("a non-raster transfer encoding is refused even on the base download path", () => {
    // WSI-Service `image_format=tiff`: the base path finishes the blob as
    // `_dataFormat`, which the browser cannot decode.
    expect(canCompositeRegions(makeSource({ _dataFormat: "rawTiff" }))).toBe(false);
    expect(canCompositeRegions(makeSource({ _dataFormat: "rasterBlob" }))).toBe(true);
});

test("supportsRegionCompositing overrides the derivation both ways", () => {
    const optIn = makeSource({
        downloadTileStart(context) { context.finish(null, null, "rasterBlob"); },
        supportsRegionCompositing: true,
    });
    expect(canCompositeRegions(optIn)).toBe(true);

    const optOut = makeSource({ supportsRegionCompositing: false });
    expect(canCompositeRegions(optOut)).toBe(false);
});

test("nothing at all is refused, not assumed", () => {
    // Degrade closed: the gate runs before a parent may have resolved.
    expect(canCompositeRegions(null)).toBe(false);
    expect(canCompositeRegions(undefined)).toBe(false);
});

test("an already-split region delegates the question to its parent", () => {
    // `CroppedTileSource` overrides `downloadTileStart`, so without the getter a
    // split slide could never be re-split (overlaid ⇄ sidebyside would refuse).
    const cropped = (parent) => ({
        downloadTileStart() {},
        get supportsRegionCompositing() { return parent ? canCompositeRegions(parent) : true; },
    });
    expect(canCompositeRegions(cropped(makeSource()))).toBe(true);
    expect(canCompositeRegions(cropped(makeSource({ _dataFormat: "rawTiff" })))).toBe(false);
    expect(canCompositeRegions(cropped(null))).toBe(true);
});
