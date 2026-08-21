# xOpat DICOM Plugin (WSI via DICOMweb)

This plugin enables xOpat to load **Whole Slide Images (WSI)** from any **DICOMweb** server  
(e.g. Google Cloud Healthcare, Orthanc, dcm4chee). You need to run a build task
for the plugin to work - it uses package.json. See the workspace item readme for details.

---

## Features

- Detects WSI pyramid levels automatically
- Renders tiles from multi-frame DICOM
- Supports raw or rendered tiles (`/frames/{n}` vs `/frames/{n}/rendered`)
- Integrates with slide browser: patients → studies → series → slides
- Handles auth tokens automatically
- Per-slide frame order overrides for correct tile alignment
- Optional annotation import/export (DICOM SR)
- Renders **DICOM Segmentation** and **Parametric Map** objects as overlay layers
- Full display chain: Palette Color LUT, Modality LUT / Real World Value Mapping, VOI LUT

---

## Derived objects: Segmentation and Parametric Map

When a slide is opened — at boot or through the slide browser — the plugin looks
for SEG (`1.2.840.10008.5.1.4.1.1.66.4`) and Parametric Map
(`1.2.840.10008.5.1.4.1.1.30`) series in the same study that reference it, and
wires each one in as a visualization shader layer above the slide. Nothing has to
be configured for this — colours, labels and windows all come from the DICOM
objects themselves.

Discovery runs on the `before-open` event, so it follows whichever slide is
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

---

## Opening Slides Automatically

### Open one specific slide
```json
{
  "dicom": {
    "serviceUrl": "...",
    "studyUID": "1.2.3...",
    "seriesUID": "4.5.6..."
  }
}
```

### Browse a whole study
```json
{
  "dicom": {
    "serviceUrl": "...",
    "studyUID": "1.2.3..."
  }
}
```

### Browse by patient
```json
{
  "dicom": {
    "serviceUrl": "...",
    "patientUID": "PAT123"
  }
}
```

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

### Decoder payloads

`dist/` carries the cornerstone loader, its decode worker, and the WASM codecs
(`openjpegwasm_decode.wasm` for JPEG 2000, `charlswasm_decode.wasm` for JPEG-LS,
`libjpegturbowasm_decode.wasm`). The worker resolves the WASM relative to its own
URL, so those files must stay next to it.

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

The plugin adds a DICOM hierarchy:

- If `/patients` is supported → Patient → Study → Series → Slides
- Otherwise → Study → Series → Slides

Each WSI-capable series becomes a slide in Slide Switcher.

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

The DICOM plugin gives xOpat full DICOMweb WSI support with:
- automatic pyramid detection
- tile rendering
- slide browser integration
- annotation support
- fine-grained frame ordering fixes for vendor quirks

Perfect for Google Cloud DICOM, Orthanc, and other DICOMweb servers.
