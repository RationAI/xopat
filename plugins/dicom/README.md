# xOpat DICOM Plugin (WSI via DICOMweb)

This plugin enables xOpat to load **Whole Slide Images (WSI)** from any **DICOMweb** server  
(e.g. Google Cloud Healthcare, Orthanc, dcm4chee). You need to run a build task
for the plugin to work - it uses package.json. See the workspace item readme for details.

It integrates with:
- Slide browser (`slide-info`)
- OpenSeadragon (through a custom DICOMWeb tile source)
- xOpat authentication (`XOpatUser`)
- Optional DICOM SR annotation load/save

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

Some DICOM WSI exporters store frames in nonstandard orders  
(row-major, flipY, serpentine, etc.).  
You can correct this per instance or per series.

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

### Available values
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

If the xOpat `annotations` module is present:

- **Load**: Latest SR referencing the slide is loaded automatically
- **Save**: Annotations are converted to DICOM SR and uploaded via STOW-RS

No extra config needed.

---

## Troubleshooting

- **Tiles misaligned** → add `frameOrderByInstance`
- **High-res only broken** → exporter uses flipped or serpentine ordering
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
