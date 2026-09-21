# ICC Profiles

Applies a slide's ICC profile client-side, so a scanner's colour space is
rendered as the scanner meant it — without asking the server to bake the
correction into every tile.

The transform is Little-CMS 2 compiled to WASM and run in a dedicated worker.
Download `emsdk` and build the necessary files using the directives in
`build/icc`.

## Opting a tile source in

A `TileSource` advertises a profile by implementing one method:

```js
/**
 * @returns {Promise<ArrayBuffer|null>} the raw ICC profile, or null for none
 */
async downloadICCProfile() {
    // todo download data
    return data;
}
```

It is fetched once per source, keyed by `tileSourceId` (falling back to `url`).
Give your source a `tileSourceId` — several backends serve every slide from one
base URL, and keying on that hands slide A's profile to slide B.

Only RGB *input* profiles are usable. Anything else (a CMYK profile, a malformed
blob) is refused by lcms; the module logs it once and renders uncorrected rather
than guessing.

## What gets corrected

Correction runs on the `tile-invalidated` event, through that event's working
cache — which is cloned from the tile's original download record, so a tile is
corrected from its uncorrected pixels no matter how many times the viewer
invalidates it.

Each tile is corrected **in the representation it already has**, and written back
as that same type:

| tile data | how |
|---|---|
| `imageBitmap` / `image` / `context2d` / `rasterBlob` | drawn in the worker's `OffscreenCanvas`, corrected as RGBA8 |
| `gpuTextureSet` | each `RGBA8` / `RGBA16` pack corrected as a raw sample buffer |
| `rawTiff` | decoded to `gpuTextureSet` first, then as above |

That last column is the point. `gpuTextureSet` is deliberately a sink in
OpenSeadragon's converter graph (see `modules/webtiff/tile-source.mjs`), so a
correction that insisted on `imageBitmap` silently did nothing for every packed
source; and rewriting a high-precision tile as an 8-bit raster to correct it
throws away the very thing those sources exist to carry.

**Not corrected**, by design: float packs (parametric maps are quantitative
samples, not colour), texture sets with more than four channels (a multiplexed
measurement stack), and sources that return `null` — including DICOM's
`/rendered` path, which is display-ready by contract, and DICOM SEG /
parametric-map overlays, which are masks. Anything else that cannot be corrected
is logged once per source.

## Debugging

Set `debugMode` in the module's static meta to render a before/after/delta panel
in the corner of the viewport for raster tiles.

## Cost

One lcms transform pair (8- and 16-bit) is built per profile and kept for as
long as the source is mounted, so slides in a grid layout do not thrash a shared
slot. Per tile the cost is one worker round trip with the pixel buffer
transferred, not copied.

That per-tile cost is meant to go away: [`GPU_TRANSFORM.todo.md`](GPU_TRANSFORM.todo.md)
specifies moving the transform into the renderer's sampling path as a 3D CLUT
built once per profile — which also covers every data type by construction,
rather than one branch at a time. Not implemented; it needs a flex-renderer
change upstream.
