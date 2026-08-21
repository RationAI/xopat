# Standalone WSI Service

Implementation of OpenSeadragon Tile Source access to the standalone WSI service.

Modified by RationAI, the WSI service can read proprietary WSI file formats
in the standalone mode, accessing WSIs by their IDs (dependent on the mapper usage).

Also supports multifile access on the API extension `/files`.

### Usage
Configure the default viewer ENV using the named slide-protocol registry.
The template is a backtick expression with `data` (scalar DataID) in scope;
the server URL is embedded directly in the template. **Name this class
explicitly with `tileSourceClass`:**
````json
   "slide_protocols": {
       "rationai_wsi": {
           "url": "`http://localhost:8080/v3/slides/info?slide_id=${data}`",
           "tileSourceClass": "RationaiStandaloneV3TileSource"
       }
   },
   "default_background_protocol":    "rationai_wsi",
   "default_visualization_protocol": "rationai_wsi"
````
or reference the registered name from a session via `BackgroundItem.protocol` / `DataOverride.protocol`.

`tileSourceClass` makes the slide-protocol registry construct this class up
front and skip OpenSeadragon's autodetection. That matters for two reasons:

1. **Determinism.** Autodetection picks the first class in the `OpenSeadragon`
   namespace whose `supports()` matches — and the deprecated
   `empaia-wsi-tile-source` module matches the *same* `/v3/{files,slides}/info`
   URLs. With both modules loaded, script order silently decides which one wins.
2. **Options timing.** Autodetection fetches the slide info with a *generic*
   `TileSource` before any class is chosen, so `setSourceOptions` cannot run
   until afterwards. Constructed directly, the source receives its options
   synchronously *before* the info request — which is what lets `plugin` reach
   the `/info` endpoint (see below).

You can also just set a plain URL string, in which case autodetection applies
with the caveats above:
````json
   "slide_protocols": {
       "wsi_batch": "`http://localhost:8080/v3/batch/info?slides=${data}`"
   },
   "default_background_protocol":    "wsi_batch",
   "default_visualization_protocol": "wsi_batch"
````
The legacy `"`{\"url\": …, \"type\": \"empaia-standalone\"}`"` JSON-blob template
still works (it forces this class through the `type` discriminator), but
`tileSourceClass` supersedes it.

> The legacy `image_group_server` + `image_group_protocol` + `data_group_*`
> fields are still accepted and auto-synthesized into deprecated registry
> entries (with a one-shot console warning), but new deployments should use
> the shape above.

### Options

Options include:
``format`` - one of `jpeg, png, tiff, bmp, gif`. If omitted, non-RGB/RGBA slides default to `tiff`.
``quality`` - for e.g. jpeg the image quality to request.
``channels`` - if format is `tiff`, the channels to request (array of indexes) or `all` literal. If omitted, all channels are requested by default.
``plugin`` - name of the WSI-Service slide-reader plugin to use (e.g. `openslide`, `tifffile`, `wsidicom`). When omitted, the server auto-detects.

Which request each option shapes:

| Option | `/info` request | tile / thumbnail / label requests |
|---|---|---|
| `plugin` | yes (when the protocol names `tileSourceClass`) | yes |
| `format` | no | yes (`image_format`) |
| `quality` | no | yes (`image_quality`) |
| `channels` | no | yes (`image_channels`) |

Only `plugin` is forwarded to `/info` — a deliberate allow-list, since the
options bag is session-supplied and the info URL is the operator's. When the
protocol entry does *not* name `tileSourceClass`, options arrive only after the
info response, so a `plugin` needed for slide discovery must be embedded in the
`slide_protocols` URL template instead.

You can set these options per data entry via `DataOverride.options`:

```json
"data": [
  {
    "dataID": "slide.tiff",
    "options": { "plugin": "tifffile", "format": "tiff", "channels": "all" }
  }
]
```

### Z-stack support

This source is the **reference implementation** of xOpat's focal-plane
(z-stack) tile-source contract — see [`src/ZSTACK.md`](../../src/ZSTACK.md)
for the full design. The four contract pieces, all in `tile-source.js`:

- `static _buildZStack(extent, pixelSizeNm)` — builds the
  `zStack = { count, index, spacingUm }` descriptor from the server-reported
  extent. Static on purpose: OSD invokes `configure()` with `this` bound to a
  generic autodetect `TileSource`, so instance helpers are unavailable there.
- `setZDepth(index)` — clamps and stores `_activeZ` / `zStack.index` only; the
  core `ViewerDepthController` triggers the actual tile refetch.
- `_zQuery()` — appends `&z=<n>` to tile/URL requests, and emits nothing when
  `count <= 1` so single-plane slide URLs stay stable.
- `getTileHashKey` — deliberately z-independent (`x_y/level/fileId`), so a tile
  keeps one cache identity across planes.

Slides with a single focal plane are unaffected; the viewer's depth slider,
Alt+scroll, and `[` / `]` shortcuts appear automatically when `count > 1`.

