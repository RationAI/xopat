# Session fixtures

Viewer sessions that exercise configuration without relying on plugins. One
library, tracked, used by three consumers: `npm run fixtures:urls`, the docs
showcase pages, and the `sessionFile` references in `env/parts/demo/*`.

They used to live in three places — untracked `docs/data/sessions/`, tracked
`docs/example_sessions/`, and a personal `demo/` folder at the repo root that
nothing referenced. That is why the docs site could not build on a clean
checkout.

## Running one

```bash
npm run fixtures:fetch            # once: the slides these sessions name
npm run fixtures:derive           # once: the viz-flex overlays
npm run fixtures:serve            # terminal 1 — fixture data on :9100, with ranges
npm run up:dev -- webtiff         # terminal 2 — the viewer on :9000
npm run fixtures:urls             # terminal 3 — one hash URL per session
```

`fixtures:urls` prints, per session, the deployment it wants and what must exist
first. Narrow it with `--group viz-flex`, `--deployment webtiff`, `--filter mask`.

Or paste a session into `http://localhost:9000/dev_setup`.

## `index.json` is the index

`index.json` states each session's title, group, deployment and prerequisites.
It is the only place those are written down: `fixtures:urls` decides what to
print from it, `docs/site/scripts/generate-fixtures.mjs` renders the docs
catalogue from it, and `test/MANUAL_TESTING.md` links to it. **A session file
with no `index.json` record is invisible to all three** — adding the JSON is
half the job.

Groups today: `visualization`, `multichannel`, `viz-flex`, `errors`, `dicom`.

## Conventions

- **Data ids are fileserver-relative**: `slides/<file>` for a fetched fixture,
  `generated/<…>` for a derived overlay. Both resolve against `TIFF_FILESERVER`
  (`http://127.0.0.1:9100/files` by default), so one origin serves both and the
  same session works against a mirror.
- **No session names a protocol it does not need.** `webtiff` owns `tiff` and
  reads everything here — the H&E slides and the mask pyramids alike. The
  deployment used to compose two decoders because the H&E slides are JPEG/YCbCr
  with 2×2 chroma subsampling and the vendored web-tiff build decoded them as
  raw subsampled planes; web-tiff 0.1.0 fixes that, so the split is gone. Only
  `demo-static` and `demo-mvt` are named, and only where the tile source is not
  autodetectable.
- **A missing data id is spelled `slides/absent-*.tif`.** The error sessions
  need files that genuinely 404; naming them for what they are keeps a future
  reader from "fixing" a fixture whose whole point is to fail.
- **Real failures, not invented ones.** `grouped-errors` and `multi-view-goals`
  use `channel-error.tif` / `other-error.tif`, two actual inference failure
  modes, because the error UI is worth testing against what it will really see.

## Visualization-flexibility showcase

The six `viz-flex-*` sessions are one capability each, described in
[`docs/site/docs/visualization-flexibility.mdx`](../../../docs/site/docs/visualization-flexibility.mdx),
and registered as startup examples by
[`env/parts/demo/visualization-flexibility.json`](../../../env/parts/demo/visualization-flexibility.json).
They need the `viz-flex-demo` deployment plus `fixtures:derive`.
