# `geotiff` — TIFF / GeoTIFF support

Opens TIFF, OME-TIFF and QPTIFF slides, including 10/12/14/16-bit and
floating-point samples.

## What this module does — and does not

The vendored decoder normalizes every channel to `[0,1]` and declares its
encoding, so **the ordinary renderer shaders are already correct on TIFF data**.
This module ships no shaders of its own; it used to, and they were deleted when
the decoder started meeting that contract (see `GEOTIFF_TILESOURCE_UPSTREAM.md`,
"LANDED").

| piece | file |
|---|---|
| decoder + tile source (vendored build) | `dist/` — do not edit |
| worker + `HttpClient` adapter wiring | `index.mjs` |
| `tiff` slide protocol | `index.mjs` |
| channel-layout resolution | `tiff-metadata.mjs` |
| measured channel ranges | `tiff-statistics.mjs` |
| shader choice per background | `auto-config.mjs` |

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

Derived entries are tagged `autoDerived: "geotiff@1"`. A user's own configuration
is never overwritten, and tagged entries are stripped on load so the layout is
re-derived rather than persisted into a session.

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
and no header separates it from a genuinely dim 16-bit scene — only the samples
do.

So the second question is answered on the display side, where being
data-dependent is safe. `tiff-statistics.mjs` reads the smallest pyramid level
once per slide (an overview, usually one tile), takes the 0.1/99.9 percentiles per
channel — percentiles, so a single hot pixel cannot set the window — and
`auto-config.mjs` emits them as `window_low`/`window_high` on the derived
`single_channel` layer. The window is a live shader control: it changes what you
see, never what was decoded, and the user can overrule it.

`autoWindow` decides how eagerly:

| value | behaviour |
|---|---|
| `"rescue"` *(default)* | window only a channel that cannot reach half intensity — the black-frame case. A well-exposed slide renders exactly as its file declares. |
| `"always"` | window every scalar channel to its measured range (ordinary auto-contrast). |
| `"off"` | never measure. |

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
| once it exists (`open`) | `source instanceof OpenSeadragon.GeoTIFFTileSource` |

`protocolIdFor` is the non-constructing half of `SLIDE_PROTOCOLS.resolve` —
probing with `resolve` would build the foreign source, and issue its requests,
just to answer the question.

That gate runs alongside `shadersAreAutoOwned`, and the two are independent:
ownership keeps the module off foreign **data**, `shadersAreAutoOwned` keeps it
off foreign **configuration** (an authored `background.shaders`, from a session,
from `ENV`, or from another module).

**Consequence:** answering `getSampleEncoding()` no longer makes a source ours.
WSI-Service slides negotiated to `image_format=tiff` therefore keep the implicit
`identity` instead of getting an automatic multi-channel configuration. The
correct owner of that decision is the module serving those slides; it can derive
its own configuration and answer `get-preview-shader` for its own sources.

## Where the layout comes from

TIFF pixels reach xOpat by more than one route, so `tiff-metadata.mjs` walks a
chain (`describeTileSource`). All of it describes a source this module already
owns — none of it confers ownership:

1. `source.getTiffDescriptor()` — the decoder describing itself (throws until the
   header is parsed, which is treated as "not known yet").
2. the GeoTIFF source's raw `fileDirectory` — fallback for older builds.
3. `source.getSampleEncoding()` — the shape `TiffSampleEncoding` in `geotiff.d.ts`,
   a plain data contract also implemented by the WSI-Service tile sources
   (`rationai-wsi-tile-source`, `empaia-wsi-tile-source`) when they negotiated
   `image_format=tiff`. Reachable here only for a source this module owns that
   also reports one; a WSI-Service slide is not such a source (see above).
4. the first decoded tile, cached per data id.

For a `tiff`-protocol slide the chain is walked in an awaited `before-open`
handler, which reads the header first (`readySourceFor` — the source is memoized,
so the open that follows reuses it). The layout is therefore known *before* the
shader configuration is assembled, on the first open as much as on any later one.

Only a slide whose header cannot be read up front can still start on the wrong
shader. The module does not swap the live layer in that case: a runtime swap can
only change a layer's *type*, leaving its params at the shader's defaults, which
is how a grayscale slide once ended up magenta. It records the resolved layout
and logs that it applies on the next open of that slide.

Note that `promises.ready` on a GeoTIFF source is a *deferred*
(`{promise, resolve, reject}`), not a promise. `await`-ing the deferred itself is
a no-op, and the symptom is exactly the failure above on every first open —
grayscale rendered red, six channels rendered as raw noise — resolving itself on
the second. Await `promises.ready.promise`.

## The decoder worker

`include.json` deliberately sets **no** `workerUrl`: the bundle names its own
worker and that name carries a build hash, so pinning it means the next
re-vendor 404s. A missing worker is not merely slower — the main-thread fallback
packs tiles differently (alpha padding, channel selection, pack count), so
`index.mjs` probes `RawTiffPlugin.getWorkerPool()` at load and warns when it is
null. Treat that warning as a broken deployment, not as noise.

## Deployment knobs

`ENV.modules.geotiff`, merged into `include.json` and read via `moduleMeta`:

| key | default | meaning |
|---|---|---|
| `autoConfigure` | `true` | pick a built-in shader for TIFF backgrounds |
| `registerSlideProtocol` | `true` | register the `tiff` protocol (turn off if the deployment declares its own) |
| `protocolId` | `"tiff"` | the protocol whose slides this module owns and may auto-configure — set it when the deployment registers its own GeoTIFF-backed entry |
| `protocolBaseUrl` | `""` | prefix for data ids of that protocol, so sessions can use `"subdir/slide.tif"`; absolute ids are used as-is |
| `autoWindow` | `"rescue"` | how a measured channel range may seed the shader window — see above |
| `workerUrl` | *(bundle default)* | only to relocate the worker asset |

The `tiff` protocol reads the file directly with range requests through
`HttpClient`, so the file server must support `Range` (and CORS, when it is a
different origin). `tmp/slide-fileserver.mjs` + `env/env.fileserver.json` are a
ready local setup, and `modules/geotiff/tools/make-fixtures.py` generates the tiled,
pyramidal fixtures the behaviour above is verified against.

## Limits

- Complex and undefined `SampleFormat` values are refused by the decoder; the
  slide still opens, rendered as an ordinary image.
- SubIFD pyramids are not read by the bundled `geotiff.js`; such files fall back
  to their full-resolution level only.
- The renderer's first pass is 8-bit unless the deployment sets
  `webGlPrecision: "auto"` (see *Render precision* above): values are correct, but
  quantized to 256 levels before any shader sees them.
- **Both halves of the range handling are implemented upstream but not yet
  vendored here**: declared-range support for integer samples in
  `GeoTIFFTileSource`, and the `window_low`/`window_high` controls in
  `flex-renrerer-cupr`. Until `dist/` and `src/libs/flex-renderer.js` are rebuilt,
  a low-range scalar slide still renders black — the module detects the missing
  controls and emits no window params rather than config nothing can resolve. See
  `GEOTIFF_TILESOURCE_UPSTREAM.md`.
- **Only scalar layers can be windowed.** A three- or four-channel colour slide
  goes to the implicit `identity`, which has no window, so a low-range *colour*
  TIFF has no rescue path today.
