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
- **Slow loading** → enable `"useRendered": true`

---

## Summary

The DICOM plugin gives xOpat full DICOMweb WSI support with:
- automatic pyramid detection
- tile rendering
- slide browser integration
- annotation support
- fine-grained frame ordering fixes for vendor quirks

Perfect for Google Cloud DICOM, Orthanc, and other DICOMweb servers.
