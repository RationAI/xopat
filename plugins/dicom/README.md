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

It will, however, finish a sentence the session started: an under-specified
`dataID` is completed from the study's own metadata before anything resolves it
(see [What you do not have to declare](#what-you-do-not-have-to-declare)).
Filling in which series a study's `expand: "case"` meant is not an opinion about
what to show — deciding to show a study nobody named would be.

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
- **Monochrome slides** (fluorescence / multiplex IHC optical paths) open with
  live window/level too — see
  [Monochrome slides](#monochrome-slides-fluorescence-multiplex-ihc)
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
    "zPrefetchRadius": 2
    // `zPlaneCacheMaxItems` needs no override: a plane is one R16F pack, so a
    // 512² slice costs 512 KB and the default 400 holds ~200 MB. It used to be
    // 2 MB per plane (three quarters padding), which is why this snippet once
    // lowered the cache to 120.
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
wrong. It is also optional: leave it out and it is read from the series'
modality, as is the `dicom-window` layer above. The example spells both out
because it is worth seeing what the session actually resolves to.

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
precision. A plane ships as a single-channel `R16F` pack — 512 KB for a 512²
slice — and the layer declares `precision: "float16"`. Both are honoured while
`webGlPrecision` is `"auto"` (negotiated from the data) or `"float16"` (forced);
under the `"unorm8"` default a CT with a 400 HU soft-tissue window shows roughly
25 grey levels: fine for navigating, not for reading. The plugin logs one warning
per session when it sees `"unorm8"`.

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

## Monochrome slides (fluorescence, multiplex IHC)

Not every `SM` series is colour. A fluorescence or multiplex-IHC scan stores one
**optical path per channel** (`OpticalPathIdentifier`, 0048,0106), each a
`MONOCHROME2` pyramid of intensity — and its values commonly occupy a narrow part
of the 8-bit range. Rendered through the implicit identity layer that is exactly
what the DICOM display chain says and, quite often, a flat washed-out picture the
user has no control over.

Such a slide therefore opens with the same **`dicom-window`** layer a radiology
series gets, and the same live window centre / width controls. Nothing has to be
declared: whether a slide carries intensity or colour is a property of the data.

**The default picture does not change.** The layer opens on the full stored
range, which is the identity mapping, and the tile source stops baking exactly
the identity table it was baking before. What the change adds is a control, not
an appearance:

- xOpat never invents a contrast stretch. Auto-windowing a slide whose dataset
  declares no VOI would be a viewer opinion presented as data — some other
  viewers do it, which is why the same slide can look markedly darker elsewhere.
  Move the sliders and you get it; nothing does it for you.
- Each optical path is its own selectable slide, labelled with its
  `OpticalPathIdentifier`. They are separate images with separate pyramids, and
  the viewer does not composite them into one.

### When the window stays baked

Moving the window into the shader is only honest while the 8-bit byte the shader
samples **is** the DICOM stored value. So the layer is added — and the bake
dropped — for `MONOCHROME2`, unsigned, `BitsAllocated == BitsStored == 8`, an
identity Modality LUT, and **no declared `WindowCenter`/`WindowWidth` or VOI
LUT**. Anything else keeps today's behaviour, where the display chain is applied
at decode time:

| Case | Why it keeps the bake |
|---|---|
| `> 8` bits stored | The byte is quantized on the way out; windowing it bands. High-precision windowing is what `role: "radiology"` and its half-float packs are for. |
| A declared window | The bake is doing real work — dropping it would change the default picture. |
| Non-identity rescale | The byte carries a rescaled value, not the stored one. |
| `MONOCHROME1` | Its inversion would have to move to the shader too, changing what an author-declared layer other than `dicom-window` renders. |
| A background that declares its own `shaders` | The session author has made a choice and it is left as written. |

The predicate is `canDeferVoiToShader` in `pixel-pipeline.mjs`, asked by both the
tile source (bake or not) and the plugin (mount the layer or not), so the two can
never disagree. `setVoiWindow()` still bakes an explicit window when a caller
asks for one, and outranks the deferral.

Note that `useRendered` (see [Rendered vs Raw tiles](#rendered-vs-raw-tiles))
sidesteps all of this: the server applies its own display chain and the tiles
arrive already mapped.

### Cost

None beyond the open. The descriptor comes from the same
`findWSIItems(only: "best")` call the tile source makes at initialization, with
the same arguments, and both the QIDO and the per-level WADO `/metadata` are
memoized per client. It is deliberately not wired into slide-switcher previews:
a card would pay a metadata walk for a series nobody opened, and since the
opening window is the identity, a preview rendered without the layer is the same
picture.

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
same contract the 8-bit segmentation path has. It also skips the half-float
first-pass upgrade, which would otherwise double the renderer's offscreen memory
for no benefit.

### Alignment

Overlays are aligned by aspect ratio, not by pyramid level. A SEG series often
ships at a single reduced resolution, and a Parametric Map is frequently one
small frame covering the whole slide — OSD places both tiled images with default
bounds, so a derived object that covers the same physical area lands on top of
the slide exactly regardless of its own resolution.

**"The same physical area" is checked, not assumed.** A one-frame object is
modelled as a single logical tile, and the obvious reading — that its raster is
the whole TotalPixelMatrix downsampled — is not always true. A measured IDC
Parametric Map declares the slide's full `74003x38857` matrix but ships a
`618x349` raster at 111 slide-pixels per map-pixel, covering `68598x38739`: full
height, 92.7% of the width. Its scoring simply stops short of the slide edge.
Stretched across the whole matrix it rendered 7.9% too wide — no error at the
origin, ~5400 px at the right edge, which reads as "roughly right, drifting".

Coverage is computed from `PixelSpacing` as a ratio against the slide's. The
derived path did not read spacing at all before this; the object keeps it in the
Shared Functional Groups' `PixelMeasuresSequence`, which is also where it keeps
its orientation.

**The image then becomes what it covers, and is placed.** `level.width/height`
and `tileWidth/tileHeight` both shrink to the covered extent, so the stored `1x1`
grid stays consistent with `ceil(width/tileWidth)`, and
`getIntrinsicPlacement()` reports the rect in the slide's normalized frame
(`src/tile-source.ts`).

> Do **not** express this by shrinking `tileWidth` below `width` instead. OSD
> derives `getTileAtPoint` from `getTileWidth` while this source pins
> `getNumTiles` to the stored grid, so points past the tile map to indices that do
> not exist: `_visitTiles` then walks a 2x2 rectangle over a 1x1 grid, coverage can
> never complete, corner tiles invert, nothing is drawn, and `setDrawn()` re-arms
> `_needsDraw` every frame. A blank overlay and a permanently hot render loop, from
> one line. The tile grid describes the image in its own pixel space and must stay
> self-consistent; *placement* is the free part.

The placement also cancels the rotation pivot. OSD rotates each tiled image about
its own bounds centre, so an overlay that no longer shares the slide's bounds would
drift by `(R - I)·dc` at the same angle. `_placementFor` rotates the covered rect's
centre about the slide's centre first: at 180 degrees, content occupying the left
92.7% correctly renders in the right 92.7%.

Without a spacing on either side, or if the declared coverage exceeds the declared
matrix (a file contradicting itself), the full-matrix stretch stands and the reason
is logged. A crop invented from a guess looks plausible and is wrong, which is
worse than a visible misalignment.

### Sample precision

Parametric-map tiles are emitted as a `gpuTextureSet` with half-float packs, which
is what upgrades the renderer's first-pass colour target to `RGBA16F` for the
whole viewer: precision is declared by the *data*, and the drawer reports it. The
emitted shader config also carries `precision: "float16"` so the intent holds
before the first tile arrives. Without that upgrade the first pass quantizes
samples to 8 bits and clamps them to `[0,1]` before the shader runs, and
windowing is meaningless.

**Both are honoured only while the renderer's colour target is float — the
`webGlPrecision` application option, which defaults to `"unorm8"`.** A deployment
that shows parametric maps should set `webGlPrecision: "auto"` (negotiated from
the data) or `"float16"` (forced); otherwise the overlay renders through the
degraded 8-bit path described below.

Samples are **normalized to the object's declared real-world range** before
upload rather than shipped raw. That spends half-float's ~11 mantissa bits on the
range that actually occurs (measured 2.4e-4 absolute error on a real IDC map,
against 3.9e-3 under RGBA8), and it degrades sensibly: if the WebGL context lacks
`EXT_color_buffer_half_float` the renderer warns and falls back to RGBA8, where a
normalized tile bands rather than clamping to white — which raw Hounsfield units
would do. The shader denormalizes with GLSL literals, so every control is in the
object's own units.

Segmentations ship `RGBA8` packs: a coverage mask is inherently `0..1` and gains
nothing from a float target. Note this is enforced by the *data*, not by a shader
veto — `dicom-seg` does not override `supportsHighPrecision()`, so a segmentation
composited with a parametric map still rides that map's float target. Correct
either way; it just does not by itself keep the viewer on 8 bits.

A single-channel map is one `R16F` pack, a two-channel one `RG16F`; three or more
channels fill `RGBA16F` packs, four channels each. Before those narrow formats
existed the map always paid for four components and wasted three.

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
- **Radiology fetches one plane per request.** `RadiologySeriesTileSource`
  declares `batchEnabled() { return false; }`, so every plane of a scrub and
  every prefetch is its own WADO-RS round trip, where a WSI screenful is
  coalesced into a handful. The WSI batcher cannot simply be inherited:
  `_getRadiologyTile` resolves the plane from `context.src` and decodes into the
  z-stack's own representation, which the batcher's per-part step knows nothing
  about. The fix is to make that per-part step a hook the subclass supplies. This
  is the largest remaining performance item.
- **A ≤3-segment SEG burns a quarter of its pack.** `_composeRgbTextureSet`
  writes alpha 255 and never reads it, deliberately: a mask stored in alpha would
  be scaled by a premultiplying upload. Closing it needs an `RGB8` or `R8` pack
  format in the renderer, which does not exist — unlike the half-float case,
  which `R16F`/`RG16F` already solved.
- **PET renders in the object's declared units; SUV is not computed.** Body
  weight, injected dose and decay correction are patient-level attributes this
  plugin does not read.
- **Annotations carry no z coordinate** ([`src/ZSTACK.md`](../../src/ZSTACK.md)),
  so one drawn on a slice shows on every slice of a radiology stack.
- **No browser test renders DICOM.** Everything under `test/unit` is pure logic;
  `test/suites/e2e/` never opens a DICOM slide, so the upload shapes and the
  shader path are only pinned by construction, never by a pixel.

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
`role` and the `dicom-window` layer are both optional — see
[What you do not have to declare](#what-you-do-not-have-to-declare) below and
[Radiology](#radiology-ct--mr--pet).

### A whole case
```jsonc
{ "dataID": { "studyUID": "1.2.3…", "expand": "case" }, "protocol": "dicom" }
```
**A study UID on its own is enough.** The study's primary series becomes this
background and every other renderable series is merged in as a sibling:
`config.background` — the catalog of available slides — grows, while
`params.activeBackgroundIndex` decides what is actually on screen.

The primary is the study's slide-microscopy series when it has one (this is a
pathology viewer; a study holding both is a slide with imaging context attached),
otherwise its lowest-numbered radiology series. Naming a `seriesUID` alongside
`expand` pins the primary yourself and the rest still merge in.

### What you do not have to declare

An external system — a LIS, a worklist, a report link — normally holds a
StudyInstanceUID and nothing else. Everything downstream of that is a property of
the data, so it is resolved at open time rather than in the caller's backend:

| Left out | What happens |
|---|---|
| `seriesUID`, with `expand: "case"` | the study's primary series is chosen, as above |
| `role` | inferred from the series' modality (`CT`/`MR`/`PT`/`CR`/`DX`/`NM` → `radiology`, otherwise a slide) |
| `shaders` on a radiology background | a `dicom-window` layer is supplied, with its params filled from the series |

Anything the session *does* declare wins, and a background that lists shaders
without a `dicom-window` among them has made a choice and is left as written.
All of it costs one QIDO series listing per study, memoized — a fully specified
`dataID` costs none at all.

Completion runs on `before-refresh`, over the whole of `config.data`, not on
`before-open` over the background being opened. Opening is not the only thing
that resolves a protocol: the slide switcher builds a thumbnail for **every**
entry in the catalog, and that path constructs a tile source with no open and no
event. An incomplete `dataID` left in the config would reach `createTileSource`
there — which is why that guard is strict and its message says the completion
pass did not run rather than trying to pick a series itself. It could not: the
reader class (slide pyramid vs radiology stack) is fixed at construction and
depends on a modality only the listing knows.

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
group becomes one request. A batch whose tiles span two parts of a
concatenated level therefore splits into one request per part — a multi-frame
URL addresses a single SOP Instance.

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

## Slide orientation (0048,0102)

`ImageOrientationSlide` gives the direction cosines of the total pixel matrix's
first **row** and first **column** in the slide frame of reference, and
`TotalPixelMatrixOriginSequence` (0048,0008) gives that matrix's origin in
millimetres. Together they say how the raster sits on the glass. A viewer that
ignores them draws the slide in whatever order the scanner happened to write it.

Every IDC slide measured declares the same value:

```
ImageOrientationSlide  [0, -1, 0, -1, 0, 0]     -> (x, y) -> (-y, -x)
```

The two consumers of the tag treat it differently, on purpose.

### Coordinates take the tag whole

`SCOORD3D` graphic data is millimetres in the slide frame of reference, so DICOM
SR is converted through the full affine — orientation, origin, and the per-axis
spacing (`slideAffine` in `slide-orientation.mjs`). This used to be a plain scale
of pixel coordinates, which is correct only for the identity orientation at a
zero origin. On real data it never is, so every annotation this plugin wrote
landed elsewhere for a conformant reader, and every one it read back landed
elsewhere for us — round-tripping inside xOpat hid it, because both directions
were wrong the same way. A store that declares no orientation keeps the previous
arithmetic exactly.

### Pixels read the same numbers through the slide's axes

The catch is that the slide frame's axes are **not** the screen's. Read the
mapping above: `X = −row`, `Y = −col`. Slide **X runs down the image** and slide
Y across it. If X were the horizontal axis, that tag would say the image's rows
run horizontally — every slide, in every viewer, would come out transposed. They
do not, so the display matrix is `M` with its axes swapped:

```
D = [[Ry, Cy],      screen x = Ry·col + Cy·row     (slide Y)
     [Rx, Cx]]      screen y = Rx·col + Cx·row     (slide X)
```

and `det(D) = −det(M)`. The value every real file carries is `det(M) = −1`, so on
screen it is a proper **180° rotation** — aspect preserved.

The rotation goes out through `TileSource.getIntrinsicPlacement()`, which the
open pipeline adds to any session placement (`src/VIRTUAL_VIEWPORTS_SPLIT.md`).
OSD applies it in rendering *and* in coordinate conversion, so annotations, masks
and measurements follow it with nothing to translate.

An orientation that would need a **mirror** on screen (`det(D) < 0`) is refused
and the slide renders as stored. OSD honours `setFlip` when drawing but not when
converting coordinates — `_imageToViewportDelta` has no mirroring term — so a
flipped slide would sit under annotations that were never mirrored. See
[`UPSTREAM.md`](../../UPSTREAM.md).

**Turning it off.** `"ignoreSlideOrientation": true` suppresses the display
rotation while leaving the coordinate mapping intact — annotations still have to
reach the frame of reference the file declares. Read with `getStaticMeta`, so a
session can never set it.

### Derived objects resolve it the same way

A SEG or Parametric Map is a **separate tiled image** in the same world, not a
texture bound into the slide's draw pass, so it needs a rotation of its own —
nothing is inherited from the slide's OSD item. Each derived series resolves one
and reports it through the same `getIntrinsicPlacement()`.
`ignoreSlideOrientation` covers both, because suppressing the rotation on one and
not the other misaligns them just as surely as reading it on neither.

**Where the tag lives depends on the object.** A Whole Slide Microscopy Image
carries `(0048,0102)` at the top level. A Segmentation or Parametric Map is a
multi-frame functional-groups object and keeps its slide geometry inside the
**Shared Functional Groups Sequence** `(5200,9229)` instead, so the parser
searches there too — and `TotalPixelMatrixOriginSequence` `(0048,0008)` with it.
Per-Frame groups `(5200,9230)` are deliberately *not* searched: a per-frame value
describes one frame, and adopting frame 0's as the whole object's is a guess.

**Precedence: own tag > slide's tag > unrotated.** A store that legitimately
writes a different orientation on the derived object stays honest, because its
own tag always wins. But an object that declares nothing — which is every IDC SEG
and Parametric Map measured — inherits the orientation of the slide named by
`sourceSeriesUID`. That is not a guess: a derived object shares its slide's frame
of reference by definition, so drawing it unrotated beneath a rotated slide is
the guess, and it is the one that was wrong. Inheritance costs one memoized
instance-metadata read, and nothing at all when the slide is already open.

Three things are said out loud, because a nonconformant file can still disagree:

- inheriting logs *"series X inherits the slide orientation of series Y"*;
- neither side declaring anything logs that both are missing and the overlay is
  drawn as stored — placed unrotated, correct only if the slide is too;
- a derived series resolving to a **different** angle than the slide it annotates
  logs an `orientation mismatch in study …` naming both series and both angles.
  Neither source can see the other, so the plugin is what compares them.

A missing rotation here is easy to misread. Over a whole-slide extent the
overlay covers the same footprint either way, so a dropped 180° looks like a
point reflection about the centre rather than like something turned — zoom to
real structure before concluding the overlay is merely offset.

---

## Fixing Misaligned / Scrambled Tiles

The plugin picks a tile-ordering strategy per pyramid level using the
following priority. A candidate map is accepted when it either **fully
covers the grid** *or* **consumes every frame the instance carries**,
in bounds and without two frames claiming one tile:

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
   is `TILED_FULL` (or unknown) and the level's total frame count equals
   `tilesX*tilesY`. Otherwise the level stays unmapped and says why.

The two acceptance rules are not interchangeable, and the difference is
deliberate. Tiers 1–2 read what the standard *defines* the position to be,
so "every frame consumed" is proof enough and they may accept a partial
(sparse) map. Tier 3 only guesses which `DimensionIndexValues` axis is X,
and its sole evidence is that the guess uniquely tiles the whole grid — over
a sparse subset that evidence is worth nothing, so tier 3 requires full
coverage. Consequence worth knowing: a **sparse level whose only positional
data is a bare `DimensionIndexValues`** (no `DimensionIndexSequence`) is
refused, and `frameOrder*` cannot override it — those steer the sequential
tier only.

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
[DICOM] level=0 dims=98304×65536 grid=192×128 frames=24576 parts=1 strategy=pixel-pos coverage=100.0% sparse=no collisions=0 oob=0 unresolved=0 instance=…
```

`parts` is how many SOP Instances the level was assembled from (see
[Concatenation](#concatenation-00209161--9162--9228)), `sparse` whether it
has legal holes, `unresolved` how many frames carried no readable position.
A level that could not be mapped at all prints the reason instead of a
strategy, plus the rejected candidate that got furthest:

```
[DICOM] level=2 dims=6144×4096 grid=24×16 frames=300 parts=1 strategy=none reason=frame-count-mismatch coverage=0.0% sparse=yes collisions=0 oob=0 unresolved=0 best=pixel-pos(mapped=290/384,collisions=0,oob=0,unresolved=10) instance=…
```

Reasons are `tiled-sparse-no-positions` (a `TILED_SPARSE` file whose frames
neither cover the grid nor carry positions), `frame-count-mismatch` (the
frame total tiles nothing and no per-frame data resolved),
`concat-offsets` (parts that cannot be ordered) and `mixed-parts` (only some
parts of a level are positioned).

If the chosen strategy is wrong (visible stripes / zig-zag artifacts),
override the sequential layout per instance or per series.

### Sparse levels

PS3.3 permits a pyramid level to be sparse: "the level may be sparse and any
number of tiles may be absent". Such a level gets a **partial frame map by
design** — it is not an error, and `sparse=yes` in the log line is not a
warning. It renders the tiles that exist, and the absent ones are simply not
requested: the tile source reports them through OpenSeadragon's `tileExists`,
so an absent tile costs **zero HTTP requests**, no cache entry and no texture.
Because such a cell is never marked as covered, the next coarser level shows
through it, which is the correct rendering for a hole in a slide.

Only levels of a *slide* pyramid carry this flag; the SEG / Parametric Map and
radiology sources have their own handling and are unaffected.

### Concatenation (0020,9161 / 9162 / 9228)

One logical level may be split across several SOP Instances — a
*concatenation*. They share `TotalPixelMatrixColumns/Rows`, each carries a
slice of the level's frames, and `ConcatenationFrameOffsetNumber` (0020,9228)
says where that slice starts in the level's frame numbering.

The plugin assembles them into one level and keeps a parts table on it, so:

- the frame map is the **union** of the parts' maps, each shifted by its
  offset; where two parts claim one tile the lower offset wins and the
  collision is logged;
- a tile URL resolves through that table, which is why a batch of tiles
  spanning two parts becomes **one request per part** — a
  `…/frames/1,2,3` URL cannot span two SOP Instances;
- the sequential fallback is applied over the level's *total* frame count,
  never one part's (for a part, `NumberOfFrames` never tiles the grid, which
  is exactly what used to leave such levels blank);
- the pyramid ranking counts distinct `TotalPixelMatrix` sizes, so a
  three-level concatenated pyramid does not outrank a genuine five-level one;
- same-size instances are still de-duplicated, unless they name the same
  `ConcatenationUID`.

Ordering needs 0020,9228 on every part, or `InConcatenationNumber`
(0020,9162) on every part so the frame counts can be accumulated. With
neither, the plugin refuses to guess: it keeps the largest part, logs
`reason=concat-offsets`, and the level renders sparsely rather than with
whole regions in the wrong place. A store that omits `ConcatenationUID` from
its QIDO response degrades to the previous behaviour rather than failing.

#### No public fixture is known

Both behaviours are covered by unit tests over synthetic metadata
(`test/unit/sparse-frame-map.test.mjs`, `test/unit/concatenation.test.mjs`) and
by neither a rendered slide nor a real file, because no real file has been
found. `tools/find-idc-sparse.mjs` swept the **whole** NCI Imaging Data Commons
slide-microscopy corpus on 2026-08-31 — 391,932 instances, 76,299 series, 73
collections, reaching the end of the collection with no failed page — and found
**zero** sparse levels and zero concatenations. Every level there is
`TILED_FULL` with `NumberOfFrames` exactly covering its grid.

So if you are looking at a level that renders nothing, do not assume this code
path is well-trodden: capture the `[DICOM] level=…` line and the instance's
metadata. Re-run the sweep (it caches pages, so a repeat costs the store
nothing) if a later IDC release might have added such data.

#### Regression slides

What IDC *can* prove is that the **dense** path did not regress. Four series are
worth checking, picked out of the sweep's own page cache for what each one
stresses and then re-verified live. They are not four deployments — one
deployment, four links:

```bash
npm run up:dev -- dicom-regress     # IDC store, no boot slide
```

Then open a link. The session travels in the **URL hash**, which
`src/parse-input.js` parses locally, so refresh and share stay stable:

| slide | what it stresses | link |
|---|---|---|
| **siblings** — start here | 10 levels × 3 same-dims instances. The two riskiest edits at once: the ingest dedupe (a `Set` keyed by dims became a `Map` keyed by dims + ConcatenationUID) and `_bestWsiGroup`, which ranks by **distinct** dimensions rather than instance count. Must yield 10 levels — the extra instances per level are channels, dropped by the DERIVED dedupe, never merged as parts. | [open](http://localhost:9000/#%7B%22background%22%3A%5B%7B%22dataReference%22%3A%7B%22dataID%22%3A%7B%22studyUID%22%3A%222.25.56219147941526607962658668060030231728%22%2C%22seriesUID%22%3A%221.3.6.1.4.1.5962.99.1.2000002781.2080371485.1655562444509.4.0%22%2C%22role%22%3A%22wsi%22%7D%2C%22protocol%22%3A%22dicom%22%7D%7D%5D%7D) |
| **pyramid** — the control | 11 levels, exactly one instance each, no siblings anywhere. A regression here is in the mapping ladder itself, not in the parts/dedupe code. | [open](http://localhost:9000/#%7B%22background%22%3A%5B%7B%22dataReference%22%3A%7B%22dataID%22%3A%7B%22studyUID%22%3A%222.25.301941217768912656923086235761929435850%22%2C%22seriesUID%22%3A%221.3.6.1.4.1.5962.99.1.3842893509.2047222810.1773369452229.4.0%22%2C%22role%22%3A%22wsi%22%7D%2C%22protocol%22%3A%22dicom%22%7D%7D%5D%7D) |
| **siblings-max** | 9 levels × 55 t-CyCIF channels, 495 instances. Under the OLD instance-count ranking this group outranks a genuinely deeper pyramid; under the new one it must not. Slow to list — run after *siblings* passes. | [open](http://localhost:9000/#%7B%22background%22%3A%5B%7B%22dataReference%22%3A%7B%22dataID%22%3A%7B%22studyUID%22%3A%222.25.56219147941526607962658668060030231728%22%2C%22seriesUID%22%3A%221.3.6.1.4.1.5962.99.1.2004658766.495663154.1655567100494.4.0%22%2C%22role%22%3A%22wsi%22%7D%2C%22protocol%22%3A%22dicom%22%7D%7D%5D%7D) |
| **scale** | The largest frame map in IDC (731,353 frames, 190464×251630) and a degenerate 2-level pyramid whose second level is 581×768 — a 328× ratio. `_normalizeLevels` lets `levels[0]` define width/tileWidth, so a level wrongly dropped or reordered silently redefines the image. | [open](http://localhost:9000/#%7B%22background%22%3A%5B%7B%22dataReference%22%3A%7B%22dataID%22%3A%7B%22studyUID%22%3A%222.25.320842540925160713857577353872519397913%22%2C%22seriesUID%22%3A%221.3.6.1.4.1.5962.99.1.3417959160.1916585275.1639800531704.2.0%22%2C%22role%22%3A%22wsi%22%7D%2C%22protocol%22%3A%22dicom%22%7D%7D%5D%7D) |

The hash is one URL-encoded session carrying the DataOverride this plugin itself
emits (`makeDataReference` → `{dataID: {studyUID, seriesUID, role}, protocol:
"dicom"}`), so any slide in the store can be linked the same way:

```jsonc
{"background":[{"dataReference":{"dataID":{"studyUID":"…","seriesUID":"…","role":"wsi"},"protocol":"dicom"}}]}
```

`?slides=…` does **not** work for DICOM: it builds *string* data IDs, and this
protocol strictly requires `{studyUID, seriesUID}`. `?visualization=…` accepts
the same JSON but self-POSTs, so it disappears from the address bar — prefer the
hash for anything you intend to share.

> **Re-paste the link; do not reload.** `UTILITIES.syncSessionToUrl`
> (`src/loader.ts:3053`) rewrites the address-bar hash with the *live* session as
> you interact, and that snapshot includes `params.viewport`
> (`src/loader.ts:3706`). So after the first load the bar no longer holds the
> link above — it holds an evolved session, and F5 restores the pan and zoom you
> left behind (`applyViewport` claims the viewer, so the startup `goHome()` is
> skipped, `viewer-state-binding-controller.ts:247-280`). For a clean boot, paste
> the original URL again or open a new tab. Clearing storage does not help: the
> state is in the URL.

**Pass criteria**, identical on all four: every level line reads `parts=1
sparse=no`, the level count matches the distinct TotalPixelMatrix dimensions, and
the Network tab filtered to `/frames/` holds no `/frames/none#` URL — one
appearing means `level.sparse` was set on a dense level.

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
- `col-major-flipY`
- `col-major-serpentine`
- `col-major-serpentine-flipY`

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

### What survives a round trip

Annotations are stored as **Comprehensive 3D SR** (`1.2.840.10008.5.1.4.1.1.88.34`). Every save
writes a new instance; the most recent one referencing the slide wins. There is no modify and no
delete — DICOMweb offers neither.

The exchange is lossy, and not marginally. SCOORD3D offers six graphic types (PS3.3 Table
C.18.9-1: `POINT`, `MULTIPOINT`, `POLYLINE`, `POLYGON`, `ELLIPSE`, `ELLIPSOID`); the convertor
writes three. Several editor shapes therefore share one encoding, and the import cannot tell them
apart:

| xOpat shape | written as | comes back as | what is lost |
|---|---|---|---|
| `polygon` | POLYGON | `polygon` | — |
| `polyline` | POLYLINE | `polyline` | — |
| `point` | POINT | `point` | — |
| `line` | POLYLINE | `line` | — (rescued by concept code `121206` Distance) |
| `text` | POINT | `text` | — (rescued by `121106` Comment) |
| `rect` | POLYGON | `polygon` | rectangle identity; no longer resizable by its handles |
| `ellipse` | POLYGON | `polygon` | the curve — only the sampled point array is stored |
| `angle` | POLYGON | `polygon` | openness; a 3-point measure closes into a shape |
| `arrow` | POLYLINE | `polyline` | the head |
| `multipolygon` | one POLYGON **per ring** | N unrelated `polygon`s | grouping, and holes fill in |

`rect` and `angle` have no native SCOORD3D form, so POLYGON is the correct carrier and only the
identity is lost. `ellipse` is different — the standard has an `ELLIPSE` type (four triplets: the
endpoints of the major axis, then of the minor axis) and we do not use it.

Four further losses, independent of shape:

- **No z.** Coordinates are written `(x, y, 0.0)`. See *Known limitation: annotations have no z
  coordinate*.
- **Labels truncate at 64 characters**, and are attached as `TextValue` on the SCOORD3D item
  itself. A content item's value attribute follows its value type, so another viewer will not show
  the label at all — it belongs on a child TEXT item.
- **Non-geometric properties are dropped**: `author`, `created`, `comments`, `readOnly`, `private`,
  `meta`, `layerID`, `id`, `zoomAtCreation`. Only points, factory, preset and text are encoded.
- **Class and colour survive only through a private extension** — two codes in scheme `99XOPAT`
  (`XOPAT.PRESETS` holding the preset definitions, `XOPAT.PRESETID` pointing each annotation at
  one). Standards-conformant and inert for other readers, but invisible to them. The preset pointer
  restores class and colour; it does **not** restore the shape type.

So an xOpat → SR → xOpat round trip preserves position and class. It does not preserve editability
or topology. Where both matter, export GeoJSON alongside.

---

## Troubleshooting

- **Tiles misaligned** → check the `[DICOM] level=… strategy=…` log line; if
  strategy is `div-heuristic-*`, the file lacks unambiguous metadata —
  set `frameOrderByInstance` or `frameOrderBySeries`
- **High-res only broken** → before this hardening, `div-heuristic-xy`
  silently won when both axis assignments fully mapped the grid; now this
  case is rejected and logged. If you still see misalignment, capture the
  log line and the affected instance's DIV/DIS metadata and file an issue
- **Some tiles never fill in, and no request is made for them** → that is a
  sparse level working as intended (`sparse=yes` in the level's log line);
  the coarser level is what you see through the holes
- **A whole level is blank** → grep the console for `strategy=none` and read
  its `reason=`. `frame-count-mismatch` / `tiled-sparse-no-positions` mean the
  file carries no usable positions (a sparse level whose only data is a bare
  `DimensionIndexValues` cannot be overridden — `frameOrder*` steers the
  sequential tier only); `concat-offsets` means several instances share the
  level and cannot be ordered
- **White tiles** → frames that were requested and failed; check server
  logs/network tab (an *absent* tile is never requested at all)
- **`No frame is mapped to this tile position` on a level the log calls
  `sparse=no`** → the tile position is outside the level's grid, not a hole.
  OpenSeadragon derives a level's tile count by scaling the *base* dimensions
  (`getNumTiles`), and this source's `getLevelScale` is width-derived, so a
  level whose height is rounded independently implies a fraction of a pixel more
  than it has. On a single-row level — `tileHeight == level.height`, normal at
  the bottom of a pyramid — that fraction became a whole phantom tile row. The
  source overrides `getNumTiles` to report `level.tilesX/tilesY` from ingest, so
  this should no longer appear; if it does, capture the level line and the
  level's `width/height/tileWidth/tileHeight`
- **The slide is mirrored or rotated against another viewer** → check for a
  `[DICOM] slide orientation […] → rotate N°` console line. No line is the normal
  case: the raster is drawn as stored. A line means the file declared a
  proper rotation and it was honoured; if that file's tag is wrong, set
  `"ignoreSlideOrientation": true` — see *Slide orientation* above
- **A segmentation or parametric map sits wrong on the slide** → expect one
  `[DICOM] slide orientation […] → rotate N°` line **per series**, all with the
  same angle; a derived object that had no tag of its own also logs *"inherits
  the slide orientation of series …"*. A missing line means neither it nor its
  slide declared anything. Two different angles are reported as an
  `orientation mismatch in study …`. On a whole-slide extent a dropped 180° reads
  as a point reflection, not as a tilt — the overlay covers the same footprint
  either way, so check structure at high zoom rather than the outline. See
  *Derived objects resolve it the same way* above
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
