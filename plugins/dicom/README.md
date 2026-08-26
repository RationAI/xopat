# xOpat DICOM Plugin (DICOMweb protocol)

This plugin lets xOpat render data from any **DICOMweb** server (Google Cloud
Healthcare, Orthanc, dcm4chee, …) — whole-slide images, CT/MR/PET series, and
derived Segmentation / Parametric Map objects. You need to run a build task for
the plugin to work — it uses package.json. See the workspace item readme.

## This plugin decides nothing

It is a **protocol**, not an application. It registers the `dicom` slide
protocol, the DICOM shader layers and the DICOM SR annotation sink, exposes a
read-only DICOMweb query API — and then waits to be told what to do. Everything
it can expand (opening a whole study, attaching derived overlays) happens *only*
because a session's `dataID` asked for it.

Browsing a store — the patient → study → series explorer, boot-time defaults,
automatic overlay discovery — lives in the separate
[`dicom-browser`](../dicom-browser/README.md) plugin. **Loading that plugin is
the switch:** without it the viewer is a standalone rendering surface for
externally-supplied configuration, with slide-info showing only what is actually
loaded. There is no autonomy flag.

> **Upgrading from the single-plugin layout?** `studyUID`, `seriesUID`,
> `patientUID`, `renderDerivedObjects` and `supportsPatients` moved to
> `plugins.dicom-browser`. The old location is read for one more release, with a
> warning naming the new key.

---

## Features

- Detects WSI pyramid levels automatically
- Renders tiles from multi-frame DICOM
- Supports raw or rendered tiles (`/frames/{n}` vs `/frames/{n}/rendered`)
- **Renders radiology series (CT / MR / PET / CR / DX / NM)** as a focal-plane
  stack with live window/level — see [Radiology](#radiology-ct--mr--pet)
- Handles auth tokens automatically
- Per-slide frame order overrides for correct tile alignment
- Optional annotation import/export (DICOM SR)
- Renders **DICOM Segmentation** and **Parametric Map** objects as overlay layers
- Full display chain: Palette Color LUT, Modality LUT / Real World Value Mapping, VOI LUT

---

## Radiology (CT / MR / PET)

A radiology series is the mirror image of a slide: its instances (or the frames
of one enhanced instance) are the *same raster at different depths*, and there is
no pyramid. That is exactly the shape the core's focal-plane contract
([`src/ZSTACK.md`](../../src/ZSTACK.md)) describes, so a CT series opens as one
background whose depth axis is driven by the navigator slider, `Alt`+wheel and
the `[` / `]` shortcuts — the same controls an optical z-stack uses.

```jsonc
{
  "params": {
    // REQUIRED for readable window/level — see "Precision" below.
    "webGlPrecision": "auto",
    "zPrefetchRadius": 2,
    // 512² RGBA16F is 2 MB per plane; the default 400 would hold ~800 MB.
    "zPlaneCacheMaxItems": 120
  },
  "data": [
    { "protocol": "dicom",
      "dataID": { "studyUID": "1.2.…", "seriesUID": "1.2.…", "role": "radiology" } }
  ],
  "background": [
    { "dataReference": 0, "name": "CT chest",
      "shaders": [{ "type": "dicom-window" }] }
  ]
}
```

`role: "radiology"` is one value for every modality — which one it is, is a
property of the data, not something a session author should be able to get
wrong.

### Window / level is a slider, not a re-decode

The Modality LUT (rescale / RealWorldValueMapping) is applied in the tile source,
per plane, because it is a fixed property of the data. The **VOI LUT is applied
in the shader**, per fragment, so window centre and width are live controls
rather than a cache flush and a re-decode of every visible slice.

The `dicom-window` layer offers the object's own `WindowCenter`/`WindowWidth`
pairs as named presets (using its `WindowCenterWidthExplanation` verbatim), plus
the standard Hounsfield windows — soft tissue, lung, bone, brain, liver,
mediastinum, angio — **for CT only**, since HU presets are meaningless for MR
signal intensity. It is grayscale by default and colour-mapped by default for
PT/NM, where a colour scale is the reading convention.

You can leave `params` off the shader entirely: the plugin fills in the value
range, presets, units, modality and MONOCHROME1 inversion from the series itself
at open time. Author-supplied params always win, and auto-filled ones are
stamped so a session export can drop them.

### Precision

Windowing only means anything while the renderer's first pass keeps float
precision. Tiles ship as RGBA16F packs and the layer declares
`precision: "float16"`, but both are honoured **only while `webGlPrecision` is
`"auto"`** — and it defaults to `"unorm8"`. Under the default, a CT with a 400 HU
soft-tissue window shows roughly 25 grey levels: fine for navigating, not for
reading. The tile source logs one warning at init when it sees this.

### Slice ordering, and what is refused

Planes are ordered by projecting `ImagePositionPatient` onto the slice normal,
falling back to `SliceLocation` and then `InstanceNumber`. `spacingUm` is derived
from the positions themselves — **never** from `SliceThickness` when a real
spacing is available, because on an overlapped acquisition those differ by up to
2× and `spacingUm` is what physically aligns overlays.

Ambiguity is reported, not guessed at. The plugin refuses to interleave two
volumes stored in one series (dual-echo MR, multi-phase, multi-stack): it splits
on the discriminating attribute, renders the largest sub-volume, and lists the
rest — pick another with `dataID.subVolume`. It splits at a positional gap
rather than stretching one spacing across a hole, keeps the dominant orientation
and reports the localizer it dropped, and refuses outright a series with no depth
ordering at all, mismatched rasters, non-monochrome pixels, or MR Spectroscopy /
Secondary Capture / Ultrasound SOP classes. All of that surfaces in the Slide
Information panel.

**PET is rendered in its declared real-world units. SUV is not computed** —
that needs the radiopharmaceutical sequence, patient weight, acquisition times,
half-life and the decay-correction state, and a silently wrong SUV is clinically
dangerous. When the object declares an `SUVbw` Real World Value Mapping, that
*is* SUV and the controls say so.

### Known limitation: annotations have no z coordinate

An annotation drawn while one plane is active renders on **every** plane
(`src/ZSTACK.md`). That is harmless for an optical focal stack, where the planes
are microns apart and depict the same field, but wrong-looking on a slice stack
where every plane is different content. Fixing it would touch the annotation
model, its renderer, existing-data migration and the DICOM SR round-trip; it is
deliberately out of scope.

### Cost

A 300-slice series is described in **two HTTP requests** (one instance-level
QIDO carrying the full field list, one WADO `/metadata` for the middle plane) —
never one per slice. A store that rejects `includefield` costs one extra listing
attempt, then degrades to `InstanceNumber` ordering with a loud warning.

---

## Derived objects: Segmentation and Parametric Map

SEG (`1.2.840.10008.5.1.4.1.1.66.4`) and Parametric Map
(`1.2.840.10008.5.1.4.1.1.30`) series that reference a slide are wired in as
visualization shader layers above it. Colours, labels and windows all come from
the DICOM objects themselves — nothing about the *appearance* has to be
configured.

**Attaching them is opt-in.** A background asks with `dataID.derived`:
`"auto"` to discover, or an explicit array of series UIDs (which costs no
discovery probe). Install the [`dicom-browser`](../dicom-browser/README.md)
plugin to have that decision made for every slide automatically — that is what
its `renderDerivedObjects` switch does.

Attachment runs on the `before-open` event, so it follows whichever slide is
actually being opened. The study is indexed once (one series listing plus two
requests per derived candidate — ~25 requests for a study with a dozen
segmentations) and every other slide in that study is then attributed offline.

**Attribution.** An object that declares its source
(`ReferencedSeriesSequence`, or `ReferencedImageEvidenceSequence`) attaches to
exactly the slides it names. An object that declares nothing attaches only when
the study holds a single SM series; otherwise it is skipped with a logged
reason. A study with six slides and twelve segmentations is normal in public
archives, and attaching an unlinked mask to every slide would render one slide's
nuclei over another — wrong in a way that looks entirely plausible on screen.

**Default visibility.** All discovered overlays become shader layers so they are
listed and toggleable, but only the first is visible. Slides commonly carry
several renderings of the same thing (a BINARY and a FRACTIONAL map of one
segmentation), and painting them together just double-covers the tissue.

Turn it off per deployment when a store holds many unrelated derived objects:

```json
{ "dicom": { "renderDerivedObjects": false } }
```

**Segmentations** (`dicom-seg` shader) get one channel per segment, a colour from
`RecommendedDisplayCIELabValue` (or a deterministic hue keyed on SegmentNumber
when the object declares none), a per-segment visibility toggle and a shared
threshold. BINARY (1 bit per pixel) and FRACTIONAL segmentations both work;
FRACTIONAL values are rescaled by `MaximumFractionalValue`. Up to three segments
ride in an RGBA8 tile's R/G/B channels; beyond that the tile is emitted as a
`gpuTextureSet` with packs of four channels.

**Parametric Maps** (`dicom-parametric` shader) are passed through the Modality
LUT (rescale or Real World Value Mapping) in the tile source, then windowed and
colour-mapped **on the GPU** — window centre and width are live sliders in the
object's own real-world units, seeded from its declared VOI. Float Pixel Data
(`7FE0,0008`) and Double Float Pixel Data (`7FE0,0009`) are both supported.

### Palette Color LUT

An object that declares `PhotometricInterpretation = PALETTE COLOR` supplies its
own colour map, and that is the appearance its author intended — so it is used
instead of the selectable one. The palette is applied at **full fidelity** (up to
65536 entries, plain `(0028,1201-1203)` or segmented `(0028,1221-1223)`), never
subsampled, for both slides and derived objects.

For derived objects the whole DICOM chain — Modality LUT, VOI, then the palette —
is baked in the tile source and the tile arrives display-ready, so the overlay is
rendered by the passthrough `identity` shader rather than `dicom-parametric`. The
windowed value becomes the tile's alpha, so low values stay transparent and the
slide shows through.

The trade-off is deliberate: because the palette is applied *after* the VOI stage,
such an object has no live window/level. Changing its window goes through
`DICOMWebTileSource#setVoiWindow` and requires the tile cache to be dropped — the
same contract the 8-bit segmentation path has. It also skips the `RGBA16F`
first-pass upgrade, which would otherwise double the renderer's offscreen memory
for no benefit.

### Alignment

Overlays are aligned by aspect ratio, not by pyramid level. A SEG series often
ships at a single reduced resolution, and a Parametric Map is frequently one
small frame covering the whole slide — OSD places both tiled images with default
bounds, so a derived object that covers the same physical area lands on top of
the slide exactly regardless of its own resolution.

### Sample precision

Parametric-map tiles are emitted as a `gpuTextureSet` with `RGBA16F` packs, which
is what upgrades the renderer's first-pass colour target to `RGBA16F` for the
whole viewer: precision is declared by the *data*, and the drawer reports it. The
emitted shader config also carries `precision: "float16"` so the intent holds
before the first tile arrives. Without that upgrade the first pass quantizes
samples to 8 bits and clamps them to `[0,1]` before the shader runs, and
windowing is meaningless.

**Both are honoured only while the renderer runs `precision: "auto"` — the
`webGlPrecision` application option, which defaults to `"unorm8"`.** A deployment
that shows parametric maps should set `webGlPrecision: "auto"`; otherwise the
overlay renders through the degraded 8-bit path described below.

Samples are **normalized to the object's declared real-world range** before
upload rather than shipped raw. That spends half-float's ~11 mantissa bits on the
range that actually occurs (measured 2.4e-4 absolute error on a real IDC map,
against 3.9e-3 under RGBA8), and it degrades sensibly: if the WebGL context lacks
`EXT_color_buffer_half_float` the renderer warns and falls back to RGBA8, where a
normalized tile bands rather than clamping to white — which raw Hounsfield units
would do. The shader denormalizes with GLSL literals, so every control is in the
object's own units.

Segmentations stay on the 8-bit path: a coverage mask is inherently `0..1` and
gains nothing from a float target, which would only double offscreen memory.

Design rationale and the upstream contract are recorded in
`FLEX_RENDERER_UPSTREAM.md`.

### Where pixel work happens, and what it costs

Compressed frame decoding already runs off the main thread — cornerstone's own
worker pool handles it (`tile-source.mjs#_initializeCornerstoneLoader`). What
remains on the main thread is the post-decode mapping: LUT application, palette
indexing, bit unpacking and channel packing.

Measured on V8 (warm), per tile:

| Path | Cost |
|---|---|
| SEG binary: bit unpack + RGBA compose, 256×256 | 0.30 ms |
| 16-bit monochrome: LUT → RGBA, 256×256 | 0.26 ms |
| Palette: index → RGB, 256×256 | 0.25 ms |
| Parametric map 466×306: normalize + half-float pack | 0.97 ms — **once per slide**, a whole-slide map is one logical tile |
| `buildGrayscaleLut`, once per level and per window change | 0.086 ms (12-bit) / 0.50 ms (16-bit) |

So a ~40-tile screenful costs roughly 12 ms of main-thread work, spread across
tile arrivals rather than landing in one burst.

**Why this is not in a worker yet.** A worker round trip plus transfer costs on
the order of 0.1–0.3 ms, which is a large fraction of the 0.25–0.30 ms being
moved, so the win is marginal at these sizes. `_decodedToImageData` carries a
standing `todo` for it. The right trigger is an in-browser profile showing the
mapping actually costing frames under real tile pressure — the numbers above are
Node/V8 on one machine and do not model GC or tile concurrency in Chrome. If it
does prove worthwhile, the three hot loops (`_decodedToImageData`, the SEG channel
compose, and the half-float pack) should move together behind one worker, with
buffers transferred rather than copied.

### Known limits

- The generated visualization is appended to the live config, so it is carried
  into an exported session. Re-importing reuses it (entries are marked with the
  source series) rather than appending a second copy.
- Segmented palettes using indirect segments (opcode 2) are refused rather than
  guessed at — they reference a byte offset into a segment table that is not
  retained, and a wrong palette on medical data is worse than no palette.

### Testing

`npm test -- --grep "legacy: dicom/"` runs conformance checks over the pure logic (Image Pixel
module, Modality/VOI arithmetic, Segment Sequence, bit unpacking, TILED_FULL
frame maps) with no server and no credentials.

For an end-to-end smoke test, the NCI Imaging Data Commons proxy serves real
whole-slide images with SEG and Parametric Map overlays and needs no
authentication:

```json
{
  "dicom": {
    "serviceUrl": "https://proxy.imaging.datacommons.cancer.gov/current/viewer-only-no-downloads-see-tinyurl-dot-com-slash-3j3d9jyp/dicomWeb",
    "supportsPatients": false,
    "studyUID": "2.25.80243218818500960592170645250812550533"
  }
}
```

That study carries an SM slide, a BINARY nuclei segmentation (4-level pyramid)
and a float-valued "Aggressiveness Score Map" parametric map — i.e. it exercises
both overlay shaders at once. It is also available on Google Cloud Healthcare at
`projects/nci-idc-data/locations/us-central1/datasets/idc/dicomStores/idc-store-v23`,
which needs any signed-in Google account and the `cloud-healthcare` scope.

To find other cases:

```
node plugins/dicom/tools/find-idc-overlays.mjs --pages 5 --per-page 40 [--offset 0]
```

It lists slide-microscopy studies that also carry a SEG or Parametric Map series
and prints a ready-to-paste `plugins.dicom` env block. Note that the obvious
query — `/studies?ModalitiesInStudy=SEG` — is close to useless here: nearly all
IDC segmentations are CT/MR, so the first pages contain nothing this viewer can
open. The script filters to `SM` server-side and then lists each study's series,
because the proxy honours `ModalitiesInStudy` as a filter but returns the
attribute itself empty.

Roughly a third of SM studies in the scanned range carry overlays. The Stony
Brook TIL maps are a good target: each study ships a BINARY *and* a
FRACTIONAL/PROBABILITY segmentation of the same slide, so both SEG encodings are
covered side by side.

---

## Basic Configuration

```json
{
  "dicom": {
    "serviceUrl": "https://your-server/dicomWeb"
  }
}
```

### Going through the xOpat server (recommended for cloud stores)

The default is a direct browser → store connection. That is the right shape for
a store on your own origin, and the wrong one for a cloud store reached with a
bearer token, because of CORS:

An `Authorization` header is not CORS-safelisted, so **every** request is
preceded by an `OPTIONS` preflight. The browser's preflight cache is keyed by
**URL**, and every tile has a different URL — so the cache never helps and each
tile pays a full extra round trip. Measured against Google Healthcare from
Europe: 145 requests became 290, with the preflights averaging **649 ms each**.

Routing through a server proxy alias makes the requests same-origin, which
removes the preflight entirely and lets the server pool connections to the
store:

```jsonc
// env.json → core.server.secure.proxies
"proxies": {
  "google-healthcare": {
    "baseUrl": "https://healthcare.googleapis.com/v1/",
    "headers": { "Authorization": "Bearer <% GOOGLE_HEALTHCARE_TOKEN %>" }
  }
}
```

```jsonc
// env.json → plugins.dicom
"dicom": {
  "httpClient": {
    "proxy": "google-healthcare",
    "baseURL": "projects/<id>/locations/<loc>/datasets/<ds>/dicomStores/<store>/dicomWeb",
    "auth": { "contextId": "dicom", "required": true }
  }
}
```

The trade: the app server now carries tile bandwidth for every viewer. On a
deployment where that server is small, or far from the store, keep the direct
path — [tile batching](#tile-batching) already divides the preflight count by
the batch size, which is what makes direct-to-origin workable.

Secrets stay `<% VAR %>`-injected; never inline a token into a committed
`env.json`.

---

## Declaring what to open

Everything is per background, in the session — this plugin has no
"default study" of its own. Each form below is a `dataReference` value.

### One slide
```jsonc
{ "dataID": { "studyUID": "1.2.3…", "seriesUID": "4.5.6…" }, "protocol": "dicom" }
```

### One radiology series
```jsonc
{ "dataID": { "studyUID": "1.2.3…", "seriesUID": "4.5.6…", "role": "radiology" }, "protocol": "dicom" }
```
Pair it with `"shaders": [{ "type": "dicom-window" }]` on the background — see
[Radiology](#radiology-ct--mr--pet).

### A whole case
```jsonc
{ "dataID": { "studyUID": "1.2.3…", "expand": "case" }, "protocol": "dicom" }
```
Every renderable series of the study is merged in as a sibling background:
`config.background` — the catalog of available slides — grows, while
`params.activeBackgroundIndex` decides what is actually on screen. Radiology
series in the case get a `dicom-window` layer automatically.

### Derived overlays on a slide
```jsonc
{ "dataID": { "studyUID": "…", "seriesUID": "…", "derived": "auto" },    "protocol": "dicom" }
{ "dataID": { "studyUID": "…", "seriesUID": "…", "derived": ["<uid>"] }, "protocol": "dicom" }
```
`"auto"` discovers everything attributable to the slide (one study-wide probe,
memoized). Naming the series explicitly costs no probe at all.

**Without one of these keys, nothing is expanded and nothing is discovered.**
To get boot-time defaults and a browsable store instead, load the
[`dicom-browser`](../dicom-browser/README.md) plugin.

---

## Tile Rendering Options

### Rendered vs Raw tiles
```json
{
  "useRendered": true
}
```

Rendered tiles (`/rendered`) are recommended for cloud servers  
(Google / Orthanc JPEG rendering is fast and lighter).

### Codec preference

```json
{
  "preferBaselineJpeg": true
}
```

By default the source asks the server for the stored bitstream, J2K first
(`1.2.840.10008.1.2.4.90` is lossless, so no fidelity is given away). J2K is
decoded by a WASM worker.

Baseline JPEG is the one codec the browser decodes itself — off the main thread,
straight into a texture, with no pixel readback — so a store that can transcode
will serve tiles noticeably cheaper under this flag. The cost is that the
transcode is lossy and happens on the server. Leave it off unless the deployment
has measured that it wants that trade.

Frames the local codecs cannot handle fall back to the server's `/rendered`
endpoint automatically (once per source, then remembered), so an exotic transfer
syntax degrades to a slower slide rather than a grid of failed tiles.

### Tile batching

WADO-RS can return many frames in one multipart response
(`…/instances/<uid>/frames/1,2,3`), and OpenSeadragon can hand a TileSource a
group of tile jobs to satisfy together (`batchEnabled` / `batchCompatible` /
`batchMaxJobs` / `batchTimeout` / `downloadTileBatchStart`). `DICOMWebTileSource`
implements that pair: jobs in a batch are grouped by DICOM instance and each
group becomes one request.

This matters twice over against a remote store. It divides the request count —
and with it the CORS preflight count — by the batch size. And it is the
concurrency lever: `ImageLoader` counts a whole batch as **one** job against
`imageLoaderLimit` (6), so tiles actually in flight become
`6 × batchMaxJobs`, reached without opening a single extra connection.

Batch width adapts to the observed frame size, targeting ~1 MB per response
(clamped to 2…16): a coarse level of 6 KB frames batches wide, a base level of
150 KB frames stays narrow so one failure or abort discards less. If a batch
fails, or the store returns fewer parts than requested, the affected tiles are
re-requested individually — xOpat runs OSD with `tileRetryMax: 0`, so the
library's own "retry a failed batch unbatched" never fires and the fallback is
the plugin's.

Batching is off where a multi-frame URL is not answerable: `useRendered`
(`…/frames/{n}/rendered` has no multi-frame form), the derived SEG / Parametric
Map source (whose tiles are *already* multi-frame requests), and the radiology
source (which decodes into the z-stack's own representation).

Tile requests are also abortable now, so panning away from a screenful releases
its connections instead of letting six ~6 s requests run to completion. A batch's
request is torn down only once every tile in it has been abandoned.

### Request priority

Everything the user is not waiting on — browser listings, thumbnails, annotation
(SR) discovery, patient/study detail cards — is issued with
`priority: "background"` and routed through
`APPLICATION_CONTEXT.requestScheduler`, which admits **no** background traffic
while any viewer has tiles in flight (with a 1.5 s starvation escape so nothing
freezes). Previously the explorer's queries ran at full priority on the same
connection as the tiles, and were still going out 80 s into a slide open.

The pyramid scan and per-level metadata are deliberately **not** backgrounded:
they *are* the slide open, and yielding them to tile loading would deadlock the
thing they feed.

### Decoder payloads

`dist/` carries the cornerstone loader, its decode worker, and the WASM codecs
(`openjpegwasm_decode.wasm` for JPEG 2000, `charlswasm_decode.wasm` for JPEG-LS,
`libjpegturbowasm_decode.wasm`). The worker resolves the WASM relative to its own
URL, so those files must stay next to it.

None of them is in `include.json`'s `includes`, and that is deliberate — see the
comment there. All three are loaded on first use: cornerstone
(1.36 MB) when a frame arrives that the browser cannot decode natively, dcmjs
(1.64 MB) when annotations are imported or exported, and the worker bundle
(1.24 MB) by the worker itself. A baseline-JPEG colour pyramid never loads any of
them. Listing them as `includes` cost every session 4.24 MB at boot, DICOM or not.

They are not hand-copied: the versions are pinned in this plugin's own
`package.json` `dependencies`, and its `copy` block declares where each payload
lands. `grunt workspaceBuild` (which `npm run build` and the dev-server watcher
both run) refreshes them, and `grunt clean` removes them again.

---

## Fixing Misaligned / Scrambled Tiles

The plugin picks a tile-ordering strategy per pyramid level using the
following priority (first one that fully and uniquely covers the grid
wins):

1. **`pixel-pos`** — `ColumnPositionInTotalImagePixelMatrix` /
   `RowPositionInTotalImagePixelMatrix` from `PerFrameFunctionalGroupsSequence`
   (ground truth, unambiguous).
2. **`div-dis`** — `DimensionIndexValues` interpreted via
   `DimensionIndexSequence` / `DimensionIndexPointer` from the Shared
   Functional Groups.
3. **`div-heuristic-xy` / `div-heuristic-yx`** — legacy DIV-axis guess.
   Accepted **only** when one axis assignment fully maps the grid and the
   other does not. Ambiguous cases (both fully map) are rejected and
   reported.
4. **`sequential-…`** — last resort. Used when `DimensionOrganizationType`
   is `TILED_FULL` (or unknown) and `NumberOfFrames === tilesX*tilesY`. A
   `TILED_SPARSE` file with no usable per-frame positions is flagged as
   malformed and tiles fail-fast.

When some levels in the same series resolve via per-frame data (1–3) and
other levels fall through to sequential, the plugin **auto-infers the
canonical sequential layout** from the truth maps and applies it to the
sequential levels. It scores the eight supported sequential patterns
(row/col-major × plain/serpentine × flipY off/on) against every truth
level and accepts only when one pattern explains ≥99% of cells on **every**
truth level. The inferred name is printed:

```
[DICOM] inferred sequential layout=row-major-serpentine (min truth-level match=100.0%, truth dims=[7780×4178, 1945×1044]); applied to 2 level(s)
```

Explicit `frameOrderByInstance` / `frameOrderBySeries` / `frameOrder`
options always win over the inference pass — if you've pinned a layout in
config, it is respected even if inference would have chosen differently.

Each level logs one `console.info` line at load time so you can confirm
which strategy was chosen:

```
[DICOM] level=0 dims=98304×65536 grid=192×128 frames=24576 strategy=pixel-pos coverage=100.0% collisions=0 oob=0 instance=…
```

If the chosen strategy is wrong (visible stripes / zig-zag artifacts),
override the sequential layout per instance or per series.

### Per-instance fix (recommended)
```json
{
  "dicom": {
    "serviceUrl": "...",
    "frameOrderByInstance": {
      "INSTANCE_UID_HERE": "row-major-flipY"
    }
  }
}
```

### Per-series fix
```json
{
  "dicom": {
    "serviceUrl": "...",
    "frameOrderBySeries": {
      "SERIES_UID_HERE": "row-major-serpentine"
    }
  }
}
```

### Available values (sequential fallback only)

These override the sequential strategy only — they do **not** override
explicit per-frame positions or DIV mapping (those are authoritative).

- `row-major`
- `row-major-flipY`
- `row-major-serpentine`
- `row-major-serpentine-flipY`
- `col-major`
- `col-major-serpentine`
- `col-major-flipY`

---

## Slide Browser Integration

Not here — it lives in the [`dicom-browser`](../dicom-browser/README.md) plugin,
which builds the Patient → Study → Series hierarchy on top of this plugin's
read-only query API (`listStudies`, `shallowWsiItemsForStudy`,
`makeDataReference`, `buildCaseSession`, `describeDerived`, …). That API is the
only seam between them: cross-plugin ES imports are forbidden, so anything else
driving DICOM from the outside uses the same surface.

---

## Annotations (optional)

If the xOpat `annotations` module is present and configured:

````json
  "io": {
    "bindings": {
      "annotations": {
        "bundle-export": ["dicom-sr-annotations"],
        "bundle-import": ["dicom-sr-annotations"]
      }
    }
  }
````

- **Load**: Latest SR referencing the slide is loaded automatically
- **Save**: Annotations are converted to DICOM SR and uploaded via STOW-RS

---

## Troubleshooting

- **Tiles misaligned** → check the `[DICOM] level=… strategy=…` log line; if
  strategy is `div-heuristic-*`, the file lacks unambiguous metadata —
  set `frameOrderByInstance` or `frameOrderBySeries`
- **High-res only broken** → before this hardening, `div-heuristic-xy`
  silently won when both axis assignments fully mapped the grid; now this
  case is rejected and logged. If you still see misalignment, capture the
  log line and the affected instance's DIV/DIS metadata and file an issue
- **White tiles** → missing frames; check server logs/network tab
- **401 errors** → user token expired; log in again
- **Slow loading** → try `"preferBaselineJpeg": true` first (native browser
  decode, no server-side rendering pipeline), then `"useRendered": true`
- **J2K tiles fail to decode** → check the network tab for a 404 on
  `plugins/dicom/dist/openjpegwasm_decode.wasm` or on the decode worker; run
  `npm run build` to restore them from the pinned npm packages

---

## Summary

The DICOM plugin gives xOpat DICOMweb rendering with:
- automatic WSI pyramid detection and tile rendering
- radiology series (CT / MR / PET / CR / DX / NM) as a focal-plane stack with
  live window/level
- SEG / Parametric Map overlays
- annotation support (DICOM SR)
- fine-grained frame ordering fixes for vendor quirks

…and no opinion about what the viewer should show. Pair it with
[`dicom-browser`](../dicom-browser/README.md) when you want one.

Works with Google Cloud DICOM, Orthanc, and other DICOMweb servers.
