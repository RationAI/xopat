# Fixture data

Real slides and the overlays derived from them. Everything here is reproducible
from tracked code plus published files — nothing depends on the state of one
developer's disk, which is what the previous `docs/data/` arrangement did.

```
test/fixtures/data/
├── manifest.json   TRACKED — the catalogue: url, sha256, bytes, provenance, usedBy
├── README.md       TRACKED — this file
├── slides/         gitignored — fetched by `npm run fixtures:fetch`
└── generated/      gitignored — derived by `npm run fixtures:derive`
```

## Getting the data

```bash
npm run fixtures:fetch            # download + verify everything in the manifest
npm run fixtures:fetch -- --list  # what is present, what is missing, how big
npm run fixtures:derive           # build the vector/mvt/grid/pyramid overlays
npm run fixtures:serve            # serve this directory on :9100 with byte ranges
```

`fixtures:serve` is only needed for data living outside the repository
(`XOPAT_SLIDE_ROOT=/data/scans`, then `TIFF_FILESERVER=http://127.0.0.1:9100/files`
in `env/.env`). The `webtiff` / `geotiff` deployments serve this directory
themselves, with `Range`, through `core.server.media`.

## Referencing a fixture in a session

A data id is the path **relative to this directory** — `slides/<file>` for a
fetched slide, `generated/<…>` for a derived overlay:

```json
{
  "data": ["slides/slide.tif", "slides/cancer-inference.tif"],
  "background": [{ "dataReference": 0, "visualizationIndex": 0 }],
  "visualizations": [{
    "shaders": {
      "prediction": { "type": "heatmap", "dataReferences": [1], "params": {} }
    }
  }]
}
```

Run `npm run up:dev -- webtiff`, then open
`http://localhost:9000/?slides=slides/slide.tif` or paste the session into
`http://localhost:9000/dev_setup`. The id resolves against the `webtiff`
module's `protocolBaseUrl` (`TIFF_FILESERVER`, default `/test/fixtures/data`),
so no protocol or absolute URL belongs in the session. Ready-made sessions and
their conventions: [`../sessions/README.md`](../sessions/README.md).

**These ids only resolve in a TIFF deployment.** What a data id means is
decided by the deployment's data layer, not by the session. Most presets
(`default`, `synthetic`, `roles-dev`, …) use `data/synthetic-dzi`, whose only
id is `synthetic.dzi` and which does not serve this directory at all — there
`slides/slide.tif` is a 404. Swap the data layer on any preset by naming it
after the preset: `npm run up:dev -- roles-dev data/tiff-webtiff`.

Set `XOPAT_FIXTURE_BASE` to fetch the release assets from a mirror (or a local
HTTP copy) without editing the tracked manifest.

**No slide is ever accepted unverified.** Each item carries a `sha256`; a
mismatch deletes the download and fails, because a truncated TIFF opens far
enough to render a plausible-looking wrong demo. An item whose `sha256` is
`null` has not been published yet — the fetcher refuses it by name rather than
downloading bytes it cannot check.

## What each file is

`manifest.json` is the answer, and it is the only copy of it: the docs
catalogue page and the session index are generated from the same records. Read
it, or run `npm run fixtures:fetch -- --list`.

The short version: `slide.tif` is the H&E slide every prediction overlay was
inferred over; `cancer-inference.tif`, `detection.tiff`, `annotations.tif` and
`explainability.tif` are that inference; `slide-errors.tif` with
`channel-error.tif` / `other-error.tif` are a second slide and two real failure
modes, kept because the error-presentation UI needs genuine errors to exercise;
`LuCa-7color_Scan1.ome.tiff` is the public OME fluorescence sample and is the
only multichannel source.

## Publishing a new fixture, or refreshing an existing one

1. Put the file in `slides/`.
2. `npm run fixtures:fetch -- --print-manifest` — prints a `sha256`/`bytes`
   block for every file currently in `slides/`. Cross-platform, so nobody has
   to remember whether this machine has `sha256sum`, `shasum` or `certutil`.
3. Upload it as an asset on the release named by `manifest.json`'s `baseUrl`
   (currently the `data-v1` tag on `RationAI/xopat`). Per-asset cap is 2 GiB —
   `LuCa-7color_Scan1.ome.tiff` at 1.94 GiB is the only one near it.
4. Add the record: `asset`, `sha256`, `bytes`, `title`, `purpose`, `channels`,
   `license`, `provenance`, `usedBy`. `usedBy` names session fixtures in
   `test/fixtures/sessions/` and `derive:<artifact>` for a derived overlay; the
   docs catalogue links both directions from it.
5. `npm run fixtures:fetch -- --force --only <name>` to prove the published copy
   is byte-identical to yours.

**The release tag is immutable once the manifest references it.** Replacing an
asset in place under an existing tag breaks every checkout that already
verified the old checksum. Cut `data-v2` instead.

> **`license` is `null` on the RationAI-produced files.** That is a real gap,
> not a formatting choice: those files cannot be published until somebody states
> the terms. The OME sample is covered by its own upstream terms.

## Derived overlays

`npm run fixtures:derive` (`test/harness/data/derive.mjs`) turns the prediction
masks into the four layer geometries the visualization-flexibility showcase
compares — GeoJSON polygons, the same polygons as Mapbox Vector Tiles, a
one-pixel-per-prediction-square grid, and two mask pyramids that straddle the
preview-injection threshold. Nothing is invented: the 512 px prediction cell is
measured off the source masks, not chosen. Output is content-stamped, so
re-running is free.

`generated/` is gitignored for the same reason `test/fixtures/slides/generated/`
is: reproducible from tracked code, so committing it would only create a second
thing to keep in sync.
