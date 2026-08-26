# DICOM Browser

The application half of xOpat's DICOM integration.

The [`dicom`](../dicom/README.md) plugin is a **protocol**: it renders exactly
what a session declares and never decides anything on its own. This plugin is
what turns that into an application:

- a **Patients → Studies → Images explorer** in the slide switcher,
- **boot-time defaults** (`studyUID` / `seriesUID` / `patientUID`) that seed the
  first open,
- **automatic discovery** of derived Segmentation / Parametric Map overlays for
  whichever slide is opened.

**Loading this plugin is the switch.** A deployment that wants the viewer to be
a standalone rendering surface for externally-supplied configuration simply does
not load it, and the `dicom` plugin alone will then open only what a session
asks for. There is no autonomy flag to get wrong.

---

## Configuration

```jsonc
{
  "plugins": {
    "dicom": { "serviceUrl": "https://your-server/dicomWeb" },
    "dicom-browser": {
      // Open one specific slide at boot
      "studyUID": "1.2.3…",
      "seriesUID": "4.5.6…",
      // …or offer every renderable series of a study
      // "studyUID": "1.2.3…",
      // …or prefetch a patient and let the user choose
      // "patientUID": "PAT123",

      // Discover SEG / Parametric Map series derived from the opened slide.
      "renderDerivedObjects": true,
      // Override the runtime QIDO probe for /patients (Google Healthcare: false)
      // "supportsPatients": false
    }
  }
}
```

`serviceUrl`, `httpClient`, `useRendered`, `preferBaselineJpeg` and the
frame-order overrides stay on `plugins.dicom` — they are protocol concerns.

### Migrating from the single-plugin layout

`studyUID`, `seriesUID`, `patientUID`, `renderDerivedObjects` and
`supportsPatients` used to live under `plugins.dicom`. They are read from there
for one more release, with a console warning naming the new key. Move them to
`plugins.dicom-browser`.

A restored session still outranks these defaults: exporting a DICOM-backed
session and reloading shows what you exported, not the configured study. The
plugin says so in the console when it stands down.

---

## What the browser adds

| Level | Source | Notes |
|---|---|---|
| Patients | QIDO `/patients`, or distinct patients derived from `/studies` | Removed entirely when the store has no patient listing |
| Studies | QIDO `/studies` | Searchable: patient name, study UID, `acc:<number>`, `YYYYMMDD-YYYYMMDD` |
| Images | one QIDO series sweep + one instances call per series | No per-instance metadata — that is the tile source's job |

Each WSI-capable series becomes a slide in the Slide Switcher. Selecting one
hands `(studyUID, seriesUID)` to the open pipeline as a serializable
`{ dataID, protocol: "dicom" }` reference, so the resulting session exports and
re-imports cleanly.

## Automatic overlays

When `renderDerivedObjects` is on, opening a slide triggers a study-scoped probe
for SEG / Parametric Map series that reference it, and any matches are wired in
as shader layers. Discovery costs one QIDO series listing plus one metadata
fetch per SEG/OT candidate, memoized per study — turn it off for stores holding
many unrelated derived objects.

A background whose `dataID` already carries `derived` is left alone: the session
said what it wants and this plugin does not second-guess it.

## Coupling

Cross-plugin ES imports are forbidden (AGENTS.md §0.5). This plugin reaches the
protocol through `plugin('dicom')` and its read-only query API — nothing under
`plugins/dicom/` is imported. When that plugin is absent, this one logs one
warning and stays inert rather than breaking the load.
