# `webtiff` — TIFF / whole-slide support

Opens TIFF, BigTIFF, OME-TIFF, QPTIFF and the TIFF-based slide formats (`.svs`,
`.ndpi`, `.scn`) — including 10/12/14/16-bit and floating-point samples — with
libtiff compiled to WebAssembly.

**This module replaces [`geotiff`](../geotiff/README.md).** Both register the
`tiff` slide protocol, so a deployment enables one of them, never both; see
*Replacing `geotiff`* below.

## What this module does — and does not

The decoder normalizes every channel to `[0,1]` and declares its encoding, so
**the ordinary renderer shaders are already correct on TIFF data**. This module
ships no shaders of its own.

| piece | file |
|---|---|
| decoder (vendored libtiff/wasm build) | `dist/` — do not edit |
| decode transport: workers + `HttpClient` bytes | `decode-pool.mjs`, `decode.proxy.worker.mjs` |
| tile source, packing per drawer | `tile-source.mjs` |
| `rawTiff` converter edges (WSI-Service tiles) | `raw-tiff.mjs` |
| `tiff` slide protocol, wiring, ownership | `index.mjs` |
| channel-layout resolution | `tiff-metadata.mjs` |
| measured channel ranges | `tiff-statistics.mjs` |
| shader choice per background | `auto-config.mjs` |
| ambient types (`TiffSampleEncoding`, …) | `webtiff.d.ts` |

## The decode transport — why it is not the bundle's

The vendored bundle ships a worker pool, and it is deliberately unused.

That pool hands a worker a **URL** and lets the worker fetch it with the global
`fetch`: no JWT, no CSRF, no proxy alias, no secureMode policy — a §0 rule-3
violation on every deployment whose slides are not world-readable. Its only
escape hatch, `openTiff(url, { fetch })`, disables the worker entirely and runs
libtiff on the main thread, which is worse: one 512² 16-bit tile is tens of
milliseconds of blocked UI, and a viewport is dozens of tiles.

So the transport is split the way `geotiff` already split it — **HTTP on the main
thread through `HttpClient`, decode in workers** — using `openTiff`'s documented
`{ pool }` extension point:

```
 worker: "I need bytes 3145728..3211264 of source 4"
   main: HttpClient.fetchRaw(...)  →  Range request, auth headers, proxy alias
   main: → transfer the bytes back
 worker: libtiff decodes, packs, transfers the tile out
```

Two consequences worth knowing:

- **Byte answers are cached on the main thread** (`byteCacheBlocks`), so the
  second worker that opens the same slide re-reads its header from memory instead
  of the network.
- **A slide is opened on more than one worker, lazily** — only when a tile read
  finds the previous worker busy. The bundle's pool pins a file to one worker,
  which serializes an entire viewport's decode behind a single core.

The fetch itself is `HttpClient.createAdapter()`: it routes each URL to the
client owning it and falls back to plain `fetch` for a URL no protocol claims, so
this module never has to know which deployment it runs in.

### Upstream

The clean fix is a `kind: "proxy"` source in web-tiff's own worker protocol, so
the library can serve bytes from the host without a xOpat-side pool at all
(§8, *library fixes belong in the library*). Until then `decode-pool.mjs` +
`decode.proxy.worker.mjs` are the adapter — both built on public API, neither
patching the bundle.

Requests against the vendored bundle that are still open are written down in
[`UPSTREAM.md`](../../UPSTREAM.md) at the repo root, not here. Two that were —
JPEG/YCbCr decoding to subsampled planes, and the tile source indexing its own
level array absolutely — landed in web-tiff 0.1.0, which is what `dist/` now
carries; the bundle exports `VERSION`, so which copy is loaded is checkable at
runtime rather than by diffing the `.wasm`.

## What a tile arrives as

The bundle's own tile source decodes every tile to 8-bit RGBA and hands OSD an
`ImageBitmap`. That is correct for a colour slide and lossy for everything this
module exists for. `tile-source.mjs` decides per tile, from the drawer that asked:

| drawer accepts | decoder output | handed to OSD as |
|---|---|---|
| `gpuTextureSet` (`FlexDrawer`) | packed RGBA8 / RGBA16F layers | `gpuTextureSet` |
| anything else (canvas fallback) | `rgba8` | `imageBitmap` |

Nothing converts *out of* `gpuTextureSet`, deliberately: OSD's `_convert` rewrites
the shared cache record in place, so one consumer asking a packed tile for a
bitmap would take the packs away from the drawer still rendering them (and
nothing registers a `learnDestroy` to release the textures). The predecessor
module kept `gpuTextureSet` a graph sink for the same reason, and nothing needs
the edges: `FlexDrawer` — including the navigator's — accepts packed tiles
natively, and a canvas-only deployment never receives one, because the output is
chosen per tile from the drawer that asked.

## Tiles that are themselves TIFFs (`rawTiff`)

Not every TIFF in xOpat is a file this module opens. A WSI-Service source asked
for `image_format=tiff` (`rationai-wsi-tile-source`, `empaia-wsi-tile-source`)
finishes each *tile* as a TIFF blob typed `rawTiff`, and until now the only thing
that could turn those into pixels was the `geotiff` module's bundled converter
chain — so replacing `geotiff` would have left those deployments with
high-bit-depth slides they can no longer draw.

`raw-tiff.mjs` provides `rawTiff → gpuTextureSet` and, for a drawer that cannot
take packed textures, `rawTiff → context2d`; both decode through the same worker
pool. The bytes are transferred into a worker, opened, read and closed there in
one round trip — going through the range-reading path would make the worker pull
back data the main thread already holds.

These are converter edges, **not** an ownership claim: the slide, its shaders and
its metadata still belong to the protocol that served it. Turn them off with
`decodeRawTiffTiles: false` when something else provides them.

### Before you change a conversion cost

`converter.learn(from, to, fn, costPower, costMultiplier)` does not weight edges
the way its documentation reads. OSD computes

```js
costMultiplier = Math.min(Math.max(costMultiplier, 1), 10 ^ 5);   // ^ is XOR: the clamp is 15
graph.addEdge(from, to, costPower * 10 ^ 5 + costMultiplier, cb); // ((costPower+1)*10) ^ (5+m)
```

so the weight is not monotonic in either argument, multipliers above 15 are
clamped, and a plausible "make this expensive" value evaluates to **0** — the
cheapest edge in the graph. `(1, 24)` weighs zero, which is what once routed every
WSI-Service TIFF tile into an 8-bit canvas instead of a packed texture, silently.

Measured weights of the two registered edges: `rawTiff → gpuTextureSet` `(1, 8)` =
**25**, `rawTiff → context2d` `(3, 1)` = **46**. Dijkstra picks the cheapest
*supported* target and `FlexDrawer` supports both, so the packed one must stay the
smaller number. Compute `((costPower + 1) * 10) ^ (5 + Math.min(costMultiplier, 15))`
before changing either, and check with `debugMode` on — the module logs
`rawTiff converts as: …` at load. There is no `rawTiff → imageBitmap` edge: no
drawer here lists that format (`CanvasDrawer` accepts only `context2d`), so it
would be unreachable and one more chance to register a zero-weight shortcut.

## Shader auto-config

`autoConfigure` (deployment knob, default on) sets `background.shaders` when the
background has none of its own. The only thing it decides is which **built-in**
shader fits the channel layout — the implicit `identity` layer samples `.rgba`
and needs four channels:

| slide | shaders |
|---|---|
| whatever the decoder packs as an image (8-bit colour, 8-bit grayscale, palette) | *(none — implicit `identity`)* |
| three or four channels on the data path (>8-bit or float colour) | *(none — implicit `identity`)*; the packer pads the unused lane with `gpu.padAlpha` |
| one scalar channel (>8-bit or float grayscale) | `single_channel` |
| more than four channels (QPTIFF, OME) | `group` of one `single_channel` per channel, tinted |

Derived entries are tagged `autoDerived: "webtiff@1"`. A user's own configuration
is never overwritten, and tagged entries are stripped on load so the layout is
re-derived rather than persisted into a session. Entries tagged `geotiff@1` are
recognised as auto-derived too, so a session saved under the old module is
re-derived here instead of being mistaken for a user's choice.

### Declared range vs. occupied range

Two different questions, answered in two different places, and conflating them is
what makes a slide render black.

The decoder normalizes each channel against the range the file **declares** — its
bit depth, or `SMinSampleValue`/`SMaxSampleValue` when present. It is not allowed
to do anything else: a scale derived from pixels would depend on which tiles
decoded first and would be baked into the tile cache, so the same normalized value
would stop meaning the same thing across the pyramid.

The consequence is that a file which *under-uses* its declared range decodes
correctly and displays as a black frame. 12-bit data written into a
`BitsPerSample=16` container with no range tags peaks at `4095/65535 = 0.0625`,
and no header separates that from a genuinely dim 16-bit scene — only the samples
do.

So the second question is answered on the display side, where being
data-dependent is safe. `tiff-statistics.mjs` reads the smallest pyramid level
once per slide, takes the 0.1/99.9 percentiles per channel — percentiles, so a
single hot pixel cannot set the window — and `auto-config.mjs` emits them as
`window_low`/`window_high` on the derived `single_channel` layer. The window is a
live shader control: it changes what you see, never what was decoded, and the
user can overrule it.

`autoWindow` decides how eagerly:

| value | behaviour |
|---|---|
| `"rescue"` *(default)* | window only a channel that cannot reach half intensity — the black-frame case. A well-exposed slide renders exactly as its file declares. |
| `"always"` | window every scalar channel to its measured range (ordinary auto-contrast). |
| `"off"` | never measure. |

A file with **no pyramid** has no overview to measure: its smallest level is the
slide itself. Rather than decode gigapixels to seed a draggable control, the
measurement is skipped above 32 MP and says so in the console.

The controls are a renderer feature, so `auto-config.mjs` probes
`ShaderLayerRegistry` for them and emits the params only when the vendored
`flex-renderer` provides them. The same probe governs `opaque` — a lone scalar
layer has nothing beneath it, so it must not write its value into alpha and blend
toward the canvas backdrop.

### Render precision — a deployment setting, not a module knob

A window is a display transform, and it can only redistribute the values a shader
actually receives. By default the renderer composites tiles into an 8-bit
first-pass target, so a 16-bit or floating-point plane is quantized to 256 levels
and clamped to `[0,1]` *before* any shader runs — the module's packs are uploaded
as `RGBA16F`, and the precision is thrown away one step later.

`ENV`/session setting `webGlPrecision: "auto"` turns that off: the tile data then
declares its own precision and the renderer allocates a half-float target, so
windowing operates on the real values. It is off by default because the offscreen
colour array doubles in size, per renderer, and every viewer also has a navigator
renderer — that cost is a deployment decision, not something a slide should
trigger silently. Nothing in this module needs configuring either way; see the
`precision` option in the `flex-renderer` README.

## Slide-list previews

A thumbnail is rendered for a slide that is open in no viewer, so nothing knows
its shader configuration and the preview would fall back to the implicit
`identity` — showing a picture of a slide that does not exist. The module answers
`get-preview-shader` (see `src/EVENTS.md`) with the configuration it would apply
on open, under the same two ownership gates as `before-open`.

Layout and statistics come from `ensureSlideLayout`, shared with the open path.
That sharing is load-bearing rather than tidy: resolving the descriptor and the
measured ranges separately lets whichever consumer runs second find the descriptor
already cached, skip the measurement, and silently drop the window — so the slide
would render windowed in one place and black in the other. Concurrent cards asking
about one slide collapse into a single header read, and whatever a preview reads
warms the later open.

## Which slides this module touches

**Ownership is the protocol serving the slide, never what its data id looks
like.** A `.tif` served over DICOM, WSI-Service or anything else belongs to that
protocol — its module knows things about the slide this one does not, and
silently rewriting its shaders is a bug even when the file really is a TIFF.

Two tests, one per phase, both in `index.mjs`:

| phase | test |
|---|---|
| before a source exists (`before-open`, `get-preview-shader`) | `SLIDE_PROTOCOLS.protocolIdFor(...) === protocolId` |
| once it exists (`open`) | `source instanceof OpenSeadragon.WebTiffTileSource` |

`protocolIdFor` is the non-constructing half of `SLIDE_PROTOCOLS.resolve` —
probing with `resolve` would build the foreign source, and issue its requests,
just to answer the question.

That gate runs alongside `shadersAreAutoOwned`, and the two are independent:
ownership keeps the module off foreign **data**, `shadersAreAutoOwned` keeps it
off foreign **configuration** (an authored `background.shaders`, from a session,
from `ENV`, or from another module).

**Consequence:** answering `getSampleEncoding()` does not make a source ours.
WSI-Service slides negotiated to `image_format=tiff` therefore keep the implicit
`identity` instead of getting an automatic multi-channel configuration. The
correct owner of that decision is the module serving those slides.

## Where the layout comes from

`tiff-metadata.mjs` walks a short chain (`describeTileSource`). All of it
describes a source this module already owns — none of it confers ownership:

1. `source.getTiffDescriptor()` — the decoder describing itself (throws until the
   header is parsed, which is treated as "not known yet").
2. the directory record behind the full-resolution level — the same information
   one step lower.
3. `source.getSampleEncoding()` — the shape `TiffSampleEncoding` in
   `webtiff.d.ts`, a plain data contract also implemented by the WSI-Service tile
   sources when they negotiated `image_format=tiff`.

For a `tiff`-protocol slide the chain is walked in an awaited `before-open`
handler, which reads the header first (the source is memoized, so the open that
follows reuses it). The layout is therefore known *before* the shader
configuration is assembled, on the first open as much as on any later one.

Only a slide whose header cannot be read up front can still start on the wrong
shader. The module does not swap the live layer in that case: a runtime swap can
only change a layer's *type*, leaving its params at the shader's defaults, which
is how a grayscale slide ends up magenta. It records the resolved layout and logs
that it applies on the next open of that slide.

Note that `promises.ready` is a *deferred* (`{promise, resolve, reject}`), not a
promise. `await`-ing the deferred itself is a no-op — await
`promises.ready.promise`.

### Steering it per slide

A slide's `options` block — `data[i].options`, merged with the background entry's
own, entry-wins — is honoured. `decoderOptionsFrom` (`tile-source.mjs`) validates
it against an allowlist and drops everything else, because that block is session
data and therefore untrusted (§7):

| key | value | effect | applied |
|---|---|---|---|
| `planeIndex` | integer ≥ 0 | read this plane only, instead of stacking | construction |
| `pyramid` | `"auto"` \| `"ifd"` \| `"subifd"` | which pyramid the levels come from | construction |
| `channels` | `number[]` \| `"all"` | decode only these channels | per tile |
| `interpretation` | `"auto"` \| `"image"` \| `"data"` | override the photometric decision | per tile |

`planeIndex` is the opt-out from channel stacking, so it is not a default with a
harmless zero: unset, every same-size directory is read as a channel of one tile;
`planeIndex: 0` reads plane 0 and drops the other four of a five-channel slide.
(A `layout` key is dropped — the decoder's old `layout.prefer` is gone, because a
pyramid and a plane stack stopped being alternatives.)

The split matters. The first two choose the level pyramid, which is resolved
once when the header is read — and that read starts in the tile source's own
constructor, before the registry's `setSourceOptions` call can arrive. So the
protocol factory and the layout probe both resolve the options themselves and pass
them to the constructor, and `setSourceOptions` reports a layout key that arrives
too late rather than ignoring it. The last two are read parameters and take effect
from the next tile.

Because a layout option changes *what the file is*, it is part of the slide's
identity: `slideKeyFor` appends it to both the source-cache key and
`tileSourceId`, so two backgrounds naming one URL with two different
`planeIndex` values are two sources and two descriptors. A slide with no options
keys exactly as the bare URL, so nothing that already caches by `tileSourceId`
loses its entries.

`channels: "all"` is accepted and means "no selection", which is already the
default. It has no effect here, but it is WSI-Service's spelling of it
(`image_channels=all`) and a session that says so should mean the same thing
whichever protocol serves the slide rather than being silently inert on one of
them.

## Slide handles are reused, and bounded

A source owns the parsed header, the level pyramid and — in each worker that
touched it — the decoder's block cache. Rebuilding one per open means re-reading
the header and re-fetching every block, so sources are cached by URL and reused;
`destroy()` (called by `TiledImage.destroy()` on every slide close) is
deliberately a no-op.

Because that memory is real, the cache is bounded by `maxOpenSlides`: the least
recently used slide **that no viewer is showing** is closed for good. A slide
still on screen is never evicted.

## Replacing `geotiff`

Both modules register the `tiff` protocol, and the registry refuses a duplicate
id — whichever loads first wins and the other decodes nothing. Enable exactly one:

```jsonc
// env.json
"modules": {
  "webtiff": { "permaLoad": true },
  "geotiff": { "permaLoad": false }
}
```

What changes for a deployment that switches:

- **Formats.** libtiff reads what geotiff.js did, plus SubIFD pyramids (`.svs`,
  `.ndpi` and other SubIFD-based slides no longer fall back to their
  full-resolution level), BigTIFF, and WebP/ZSTD-compressed tiles.
- **Sessions.** Shader entries tagged `geotiff@1` are recognised and re-derived;
  nothing has to be re-authored.
- **WSI-Service `image_format=tiff`.** The `rawTiff` converter chain those
  deployments depend on is provided here too (see above), so their tiles keep
  decoding at native bit depth.
- **Knob names.** `autoConfigure`, `registerSlideProtocol`, `protocolId`,
  `protocolBaseUrl` and `autoWindow` keep their names and meanings. `workerUrl`
  is gone — the worker is this module's own file and needs no pinning; the
  transport knobs below replace it.
- **`OpenSeadragon.GeoTIFFTileSource`** becomes
  `OpenSeadragon.WebTiffTileSource`. A deployment naming the class in a protocol
  entry (`tileSourceClass`) must update it.

## Where the slides live

**The default is the viewer origin, and that is usually wrong.** With no
`protocolBaseUrl`, a data id like `"slide.tif"` resolves against the page's own
origin — every range request 404s and the only symptom is a header the decoder
cannot read. The module says so once per session:

```
[webtiff] data id "slide.tif" for the "tiff" protocol resolves against the viewer
origin (http://localhost:9000/slide.tif) — `ENV.modules.webtiff.protocolBaseUrl` is not set.
```

Three ways to answer it.

### 1. `protocolBaseUrl` — a browser-reachable server

The simple case, and the one the dev setup uses. No `HttpClient` is constructed
at all; the decoder reads the file directly with range requests.

```jsonc
// env/env.json — under core.client.<active_client>
"default_background_protocol": "tiff",
"default_visualization_protocol": "tiff",

// …and under "modules"
"webtiff": {
  "permaLoad": true,
  // must match --host/--port of tmp/slide-fileserver.mjs (defaults 127.0.0.1:9100)
  "protocolBaseUrl": "http://127.0.0.1:9100/files"
},
"geotiff": { "permaLoad": false }
```

```bash
node tmp/slide-fileserver.mjs "/path/to/scans"     # serves it on :9100
XOPAT_ENV=env/env.json npm run dev
```

`env/` is gitignored except `README.md` and `env.default.json`, so a deployment
writes this itself. Note that `env/env.fileserver.json` configures the
**deprecated `geotiff`** module — switching to `webtiff` means moving
`protocolBaseUrl` across, and forgetting to is exactly how a slide ends up
requested from the viewer.

### 2. Absolute data ids

A session may name the full URL (`"http://host/files/slide.tif"`). Used verbatim,
both knobs skipped, same server requirements as (1).

### 3. Through the viewer's own server — env only, no module change

For a store the browser cannot reach, one with no CORS, or one whose credential
must never reach the browser. The module's own protocol registration is turned
off and the deployment declares an equivalent entry that carries a transport:

```jsonc
// core.server.secure.proxies
"slides": { "baseUrl": "http://127.0.0.1:9100/files" },

// core.client.<active_client>
"slide_protocols": {
  "tiff_proxy": { "url": "`${data}`", "proxy": "slides", "tileSourceClass": "WebTiffTileSource" }
},
"default_background_protocol": "tiff_proxy",

// modules
"webtiff": { "permaLoad": true, "registerSlideProtocol": false, "protocolId": "tiff_proxy" }
```

Why that works with no module code: the tile source declares
`static xopatSelfConfiguring`, so the registry constructs it directly with a URL
already resolved through the protocol's `HttpClient` (→ `/proxy/slides/<id>`) and
stamps the client on it; the decode pool's adapter then claims those URLs by
base-URL prefix, so every range read carries the session and CSRF header.
`protocolId` keeps this module's ownership gate — auto-config, previews — pointed
at the deployment's entry instead of the `tiff` one it no longer registers.

What to expect on that route:

- `/proxy/*` needs a live viewer session **and** `X-XOPAT-CSRF` on every request,
  GET included. A session that expired shows up as 401/403 **on tiles**, not on
  the page.
- The proxy forwards `Range`/`If-Range` and returns `206`, `Content-Range` and
  `Accept-Ranges` verbatim, and streams with no size cap — but always strips
  `Content-Length`. Harmless here: the decoder learns the file size from
  `Content-Range`.
- A loopback upstream needs no SSRF allowlist for this route (the alias is
  operator-configured, so the guard does not apply).
- On the first open of a slide the layout probe and the registry each build a
  source, so that slide's header is read twice; later opens reuse the cache.

### What the server must do (routes 1 and 2)

The decoder learns the file's size from the `Content-Range` of its first range
request, so a cross-origin store must both answer correctly and let the browser
*see* the answer:

- `Access-Control-Allow-Origin`
- `Access-Control-Allow-Headers: Range, If-Range`
- `Access-Control-Expose-Headers: Content-Range, Accept-Ranges` — **without this
  the open fails with "answered a range request without a usable Content-Range"
  even though the server did everything right**
- a server that answers `200` to a `Range` request makes the decoder download the
  whole file

`tmp/slide-fileserver.mjs` already sends all of it.

### Two consequences worth knowing

- **Changing the transport changes slide identity.** The resolved URL is the cache
  key *and* `tileSourceId`, so moving a deployment from `protocolBaseUrl` to a
  proxy alias resets everything keyed by slide identity (preview cache, visited
  markers).
- **A slow store is a protocol-entry setting.** `timeoutMs` and `maxRetries` on the
  `slide_protocols` entry govern every block read on route 3; route 1 has no
  client and therefore no retry policy.

## Deployment knobs

`ENV.modules.webtiff`, merged into `include.json` and read via `moduleMeta`:

| key | default | meaning |
|---|---|---|
| `autoConfigure` | `true` | pick a built-in shader for TIFF backgrounds |
| `registerSlideProtocol` | `true` | register the `tiff` protocol (turn off if the deployment declares its own) |
| `protocolId` | `"tiff"` | the protocol whose slides this module owns and may auto-configure |
| `protocolBaseUrl` | `""` | prefix for data ids of that protocol, so sessions can use `"subdir/slide.tif"`; absolute ids are used as-is |
| `autoWindow` | `"rescue"` | how a measured channel range may seed the shader window — see above |
| `decodeWorkers` | `0` (auto) | decode workers; auto is half the cores, at most 4 |
| `workerCacheBytes` | `0` (32 MB) | decoder block cache per worker per slide |
| `blockSize` | `0` (64 KB) | range-request granularity |
| `byteCacheBlocks` | `96` | blocks the main thread keeps, shared by all workers |
| `maxOpenSlides` | `4` | slides whose decoder handles stay open |
| `preferRGBA8` | `true` | pack as 8-bit when the file needs no more |
| `forceRGBA16F` | `false` | diagnostic: always pack half-float |
| `decodeRawTiffTiles` | `true` | provide the `rawTiff` converter edges for WSI-Service tiles |
| `threads` | `false` | use the pthreads wasm build (needs COOP+COEP; decoding in it is serialized anyway) |

Where the files come from is *Where the slides live*, above. The `.wasm` files
must be served as `application/wasm`: with `X-Content-Type-Options: nosniff` a
wrong MIME type makes `WebAssembly.instantiateStreaming` reject. Workers must be
same-origin.

## Thumbnails

`getThumbnail()` renders the coarsest pyramid level to a PNG blob, so a slide
list can show a card without opening a viewer. The core only takes it where a
flat RGB picture is the right answer — `osd_tools` prefers the real pyramid
whenever the background resolves to a channel-aware shader configuration — so a
six-channel slide still previews as what the viewport will show.

The source also participates in the **synthetic preview level**
(`src/classes/preview-level.ts`), which triggers on `getThumbnail()` and prepends
a single-tile OSD level 0 so first paint costs one request. That renumbering used
to be unsafe here — the decoder's base class indexed its own level array by the
raw OSD level, so every real level silently read one step too coarse, and the
module opted out with `__noPreviewLevel`. web-tiff ≥ 0.1.0 indexes relative to
`maxLevel` (`_decoderLevel`), so the shift is harmless and the opt-out is gone.

`getTilePrecision()` is the other gate the injector reads: the synthetic tile is
an 8-bit raster and must not stand in for half-float packs, so a slide whose
precision is `float16` is refused the preview level rather than previewed wrongly.

## Verifying a change

`modules/geotiff/tools/make-fixtures.py` (`pip install numpy tifffile imagecodecs`)
generates tiled, pyramidal fixtures covering the cases the wiring turns on: 8-bit
RGB (image path), 12-bit-in-16 grayscale (the black-frame rescue), a six-channel
16-bit stack (pack fan-out) and float32 (parametric map). Serve a directory of
them with `tmp/slide-fileserver.mjs` and open them by file name — the env block
for that is in *Where the slides live*, route 1 (`env/env.fileserver.json` still
configures the deprecated `geotiff` module).

## Limits

- Complex and undefined `SampleFormat` values are refused by the decoder; the
  slide still opens, rendered as an ordinary image.
- A `rawTiff` tile is a separate decoder open/read/close: the pool's byte cache
  spans a *file*, not a tile stream, so a WSI-Service TIFF session pays more per
  tile than a native `tiff`-protocol slide. A persistent per-slide handle keyed by
  tile-source identity would fix it; not done yet.
- The decoder emits `tiffEncoding_channel_0_of_0` ("no sample encoding … using an
  identity transform") on every data-mode tile, although the packs it returns do
  carry the right `scale`/`offset`. It is a decoder-side false alarm — reproduced
  with no xOpat code in the path — and `index.mjs` reports each warning code once
  so it cannot bury a real one. Upstream item.
- The renderer's first pass is 8-bit unless the deployment sets
  `webGlPrecision: "auto"` (see *Render precision* above): values are correct, but
  quantized to 256 levels before any shader sees them.
- **Only scalar layers can be windowed.** A three- or four-channel colour slide
  goes to the implicit `identity`, which has no window, so a low-range *colour*
  TIFF has no rescue path today.
- Pixel size (`XResolution`/`ResolutionUnit`) is not surfaced to the scalebar —
  the decoder's metadata does not report it yet. Upstream item.
- Channel **names** and **colours** come from OME-XML (`Name=` / `Color=`) when the
  file carries it; QPTIFF channel metadata is still unparsed, so those slides get
  fallback tints. Upstream item.
- **A plane stack has bounds.** A file storing each channel as its own full-size
  IFD — the common OME-TIFF layout, e.g. the five 34560 × 24960
  `SamplesPerPixel = 1` directories of `docs/data/slides/LuCa-7color_Scan1.ome.tiff` —
  is read as one N-channel tile, but: at most 32 planes stack (`MAX_PLANES`) and the
  rest are dropped with a warning; planes group by size *and* sample format, so a
  file mixing 8-bit and 16-bit planes stacks only the group its full-resolution
  directory belongs to; a SubIFD level that not every plane has is dropped from the
  pyramid, again with a warning; and `options.planeIndex` opts out entirely by
  pinning one plane. A stack is always `interpretation: "data"`, whatever plane 0's
  photometric tag says.
- **`rgba8` over a stack is a preview, not the data.** A read asked for in 8-bit
  RGBA resolves as an image: the first three channels plus an opaque alpha lane.
  That is what the slide-list card and a canvas-only deployment get; the packed
  `gpuTextureSet` path is the one that carries every channel.
- The `dist/webtiff-mt.*` pair (~2.1 MB) is only loadable on a cross-origin
  isolated page. A deployment that will never be one can delete both files.
