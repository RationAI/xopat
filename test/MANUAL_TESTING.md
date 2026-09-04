# Manual testing: every deployment, in order of setup cost

One row per `npm run up:dev -- <preset>`. Ordered so that everything needing
nothing comes first — if tier 0 is broken, nothing below it is worth debugging.

`npm run up -- --list` is the authoritative preset list; a unit test asserts
every preset in `env/presets.json` appears on this page, so a new deployment
cannot be added without saying how to exercise it.

**Read the tier-0 section first even if you only care about tier 4.** A failure
that reproduces under `synthetic` is a viewer bug; the same failure that does not
is a data or deployment bug, and knowing which halves the search.

---

## Before anything

```bash
npm ci
cp env/.env.example env/.env      # then fill in what your tier needs
npm run up:check -- --all         # every preset composes, nothing leaks
```

`up:check` prints, per preset, which `<% VAR %>` it needs and which are unset.
It exits non-zero on a conflict (2), a missing required variable (3), a literal
credential in a tracked fragment (4), or a non-public hostname in one (5).

Every command below is `npm run up:dev -- <preset>`, i.e. **dev mode**: the
asset watcher rebuilds client code and workspace bundles on save, `debugMode` is
on, and the role switcher in the user menu is visible. `npm run up -- <preset>`
is the same deployment without any of that.

> Core server code (`server/`, `index.js`) is **not** hot-reloaded — restart
> after editing it. Module/plugin server files are rebuilt on load.

---

## Tier 0 — nothing but the repository

### `synthetic` — the zero-dependency viewer

```bash
npm run fixtures:synthetic
npm run up:dev -- synthetic
# http://localhost:9000/?slides=synthetic.dzi
```

No image server, no container, no download, no key. The pyramid is generated
from tracked code and content-stamped, so re-running is free.

Verify:
- The slide opens and fills the viewport; zooming in and out stays sharp.
- Every tile carries an **8×8 red square in its top-left corner**. A grid of
  markers in the wrong places means tiles are transposed or off by one; markers
  from the wrong colour band mean the wrong pyramid level is being drawn.
- Tile colour shifts with zoom level (blue channel encodes the level) — a level
  that never changes colour means level selection is stuck.
- The navigator thumbnail matches the main view.

### `dicom-idc` — public DICOMweb, no credentials

```bash
npm run up:dev -- dicom-idc
```

Reads the NCI Imaging Data Commons proxy. Nothing to configure — if this fails
and `synthetic` passes, the problem is DICOM or the network, not the viewer.

Verify:
- The DICOM browser lists studies and a slide opens.
- Pan/zoom streams tiles without stalling.
- Metadata (magnification, MPP) shows in the slide-info panel.

### `dicom-regress` — the DICOM regression slides

```bash
npm run up:dev -- dicom-regress
```

Opens **nothing** on boot, on purpose: the four regression slides are links, not
presets. They and what each one stresses are in `plugins/dicom/README.md`
§ "Regression slides".

Verify: each of the four links opens and renders. `?slides=` does not work here
— the `dicom` protocol needs `{studyUID, seriesUID}`, which the hash carries.

---

## Tier 1 — fixture data on disk

```bash
npm run fixtures:fetch     # once, checksum-verified (~3.4 GB)
npm run fixtures:derive    # once, builds the viz-flex overlays
npm run fixtures:serve     # leave running — :9100, with byte ranges
```

`fixtures:serve` is a separate process because xOpat's own static handler
answers with the whole file and no `206`, which is useless for a 2 GB pyramid a
client-side decoder reads by range. `TIFF_FILESERVER` points at it.

> If `fixtures:fetch` refuses an item by name, that file has not been published
> yet — see `test/fixtures/data/README.md`.

### `webtiff` — the session fixture library's deployment

```bash
npm run up:dev -- webtiff
npm run fixtures:urls -- --deployment webtiff     # a link per session
```

Verify, walking `npm run fixtures:urls` output:
- `basic-overlay` — H&E background with three overlays; each layer's visibility
  toggle and opacity slider affects only its own layer.
- `two-backgrounds` — two viewers open at once, each showing a *different*
  visualization. This is the multi-viewport case: acting on the unfocused
  viewer must affect that one, not the focused one.
- `all-shaders` — every registered shader type renders something. A blank layer
  here is a shader that failed to register.
- `fluorescence-background` / `fluorescence-cross-source` — per-channel colours
  apply; the cross-source session's third layer renders the *brightfield* slide
  inside the fluorescence stack.
- `errors-partial-viz` — the slide still opens, the good layer still renders,
  and the broken one is reported rather than taking the visualization down.
- `errors-all-invalid` — the viewer says every background failed. It must not
  hang, and it must not show an empty viewport with no explanation.
- `empty-session` — data declared, nothing opened. `activeBackgroundIndex: []`
  means *nothing* open, not everything.

### `geotiff` — the other decoder, same data

```bash
npm run up:dev -- geotiff
```

Verify: the same sessions render. When a TIFF looks wrong under one decoder,
whether `geotiff` agrees is the first bisection.

### `viz-flex-demo` — the visualization-flexibility showcase

```bash
npm run up:dev -- viz-flex-demo
npm run fixtures:urls -- --group viz-flex
```

Six sessions, one capability each; the prose for every one is in
`docs/site/docs/visualization-flexibility.mdx`.

Verify:
- `viz-flex-multichannel` — five channels as five layers, plus one layer
  retargeted at the brightfield slide.
- `viz-flex-geojson` — polygon boundaries follow prediction cells exactly (no
  invented diagonals); coarse zoom collapses dense tiles to a count badge.
- `viz-flex-mvt` — the vector layer stays aligned with the slide at **every**
  zoom level. Misalignment growing toward the bottom is the non-square-world bug.
- `viz-flex-grid` — cells are hard-edged, not blurred, and the white grid ruler
  coincides with the raster at the far corner as well as the near one. Confirm
  numerically in the console:
  ```js
  var w = VIEWER.world; var s0 = w.getItemAt(0).source; var it = w.getItemAt(1);
  (it.getBounds().width * s0.width) / it.source.width    // 512.000 when correct
  ```
- `viz-flex-mask-coarse` — preview injection **declines** (coarsest level
  1025 px).
- `viz-flex-mask-preview` — preview injection **fires** on the overlay: first
  paint is one request, then it refines.

---

## Tier 2 — a wsi-service container

```bash
docker compose -f docker/wsi-service/docker-compose.yml up -d
```

It publishes **9002:8080**, so `WSI_PORT=9002` in `env/.env`. Slides go in the
repo-root `wsi_data/` directory (gitignored) — the fixture slides work:

```bash
mkdir -p wsi_data && cp test/fixtures/data/slides/slide.tif wsi_data/
```

### `default` — the shipped standalone deployment

```bash
npm run up:dev -- default
```

Verify: the slide browser lists what is in `wsi_data/`, a slide opens, tiles
stream, and the scale bar reports a plausible magnification.

### `roles-dev` — the role matrix, no login

```bash
npm run up:dev -- roles-dev
```

Five roles, switchable in the user menu (`--dev` is what reveals the switcher).

Verify:
- Switching role changes what the UI offers **without a reload**.
- The user menu's Roles panel lists a "Not available to you" section — a refused
  action must appear there, not as a dialog.
- Export is gated: `core.io.local-file` and a sink-bound capability are separate
  questions, so "let me keep a local copy but do not upload" is expressible.

### `image-proxy` — tiles through the server proxy alias

```bash
npm run up:dev -- image-proxy
```

Verify:
- Tiles load, and the network panel shows them going to the viewer origin, not
  straight to :9002.
- **A session cookie plus a CSRF token is not authorization.** Request a proxy
  alias the session never opened and confirm it is refused — `session.allowedProxies`
  is what decides.

### `storage-persistent` — durable server state

```bash
npm run up:dev -- storage-persistent
```

Verify: create some state, restart the server (Ctrl-C, re-run), and confirm it
is still there — then that it expires per the 30-day retention window.

### `annotations-github` — annotation bundles to a repository

Needs `GITHUB_TOKEN` (repo scope) and `GITHUB_SINK_REPO=owner/repo` in `env/.env`.

```bash
npm run up:dev -- annotations-github
```

Verify: draw annotations, export, confirm the commit lands in the repository,
then re-import into a fresh session and confirm the geometry round-trips.

### `mlflow` — slide scoring to a tracking server

Needs an MLflow server; `MLFLOW_URL` defaults to `http://localhost:5000`.

```bash
docker run -p 5000:5000 ghcr.io/mlflow/mlflow mlflow server --host 0.0.0.0
npm run up:dev -- mlflow
```

Verify: a score submitted from the viewer appears as an MLflow run.

---

## Tier 3 — container plus an identity provider

```bash
docker compose -f test/fixtures/keycloak/docker-compose.yaml up -d   # :8081
```

Users: `pathologist` / `pathologist`, `researcher` / `researcher`. An existing
realm is **never re-imported** — after editing `realm-xopat.json` you need
`down -v`, not `restart`.

Both presets need `OPENAI_API_KEY` and set `XOPAT_SSRF_ALLOWED_HOSTS=localhost`
themselves (the SSRF guard blocks private upstreams, and Keycloak is loopback).

### `keycloak-oidc` / `keycloak-saml`

```bash
npm run up:dev -- keycloak-oidc
npm run up:dev -- keycloak-saml
```

These are the same deployment reached two ways. **Run both** — that a feature
declares a *context* rather than a broker is the whole point, and a divergence
between them is the regression.

Verify, identically under each:
- Login redirects to Keycloak and comes back authenticated.
- The role derived from the user's `groups` claim gates the UI: `pathologist`
  and `researcher` see different things.
- The chat rides the `core` context — one login covers viewer, roles and chat —
  and the assistant reports `requiresLogin` before you are logged in rather than
  401-ing mid-request.
- Log out and confirm the gated UI closes again.

---

## Tier 4 — an API key in `env/.env`

### `roles-dev-chat` — assistant plus the role matrix

Needs `ANTHROPIC_API_KEY`.

```bash
npm run up:dev -- roles-dev-chat
```

Verify:
- The assistant answers, and streams rather than arriving all at once.
- Ask it to create annotations: it writes through the scripting API, which
  `core.scripting.run` gates.
- **Then switch role in the user menu** and confirm the IO gates now apply to
  the data it just produced. That sequence is the reason this preset exists.

### `roles-dev-chat-cerit` — the same, different provider

Needs `CERIT_API_KEY` (`CERIT_BASE_URL` defaults to the public endpoint).

```bash
npm run up:dev -- roles-dev-chat-cerit
```

Verify: identical behaviour to the Anthropic run. Provider choice is
configuration, not code.

### `roles-dev-vision` / `dicom-idc-chat` — with vision inference

Need `MEDGEMMA_BASE_URL`, `MEDGEMMA_API_KEY`, `MEDGEMMA_MODEL` (plus the chat
provider's key). Both set `XOPAT_SSRF_ALLOWED_HOSTS=localhost` because MedGemma
defaults to a loopback endpoint.

```bash
npm run up:dev -- roles-dev-vision
npm run up:dev -- dicom-idc-chat
```

Verify:
- Ask about what is visible; the model receives **image bytes**, and the region
  it describes is the region on screen.
- An assistant-authored `[label](#xopat-region?viewer=…&x=…)` link navigates the
  viewer when clicked.

### `byok-chat` — no server key at all

```bash
npm run up:dev -- byok-chat
```

Verify:
- Chat is offered but refuses to run until you supply a key in the UI.
- The key is scoped (`user:` / `sess:`) and does not leak into the session
  bundle — export the session and read it.

### `chat-logging` — full transcript logging

Needs `CERIT_API_KEY` and the MedGemma variables.

```bash
npm run up:dev -- chat-logging
```

Verify:
- `env/logs/*.ndjson` fills with transcript records.
- Payload-bearing records only appear because this deployment set
  `logging.allowSensitive` **and** the channel is at `trace`. Turn either off
  and confirm they stop — a logging decision must never be readable from request
  input.

---

## Tier 5 — an external account

### `googledicom` — Google Healthcare DICOMweb

Needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_DICOM_SERVICE_URL`.

```bash
npm run up:dev -- googledicom
npm run fixtures:urls -- --group dicom
```

Verify:
- Google login completes and the store's studies list.
- `dicom-google-standalone` — `derived: "auto"` finds SEG/parametric series for
  the source series by itself.
- `dicom-google-standalone-explicit` — fill in the placeholder `seriesUID` from
  your own store; the explicit `{role, sourceSeriesUID}` shape resolves the same
  overlay.

---

## What this page does not cover

The automated suite does. `npm test` runs unit, integration and e2e against
seven deployment configurations, including `secureMode` and `production`, which
**cannot** be reached from here: they live at `core.client.<active>.secureMode`
and are deliberately absent from the `setup` block, so a session cannot set them.
They are Playwright projects (`test/env/secure.json`, `test/env/production.json`)
rather than presets, and that is the point of them.

`test/TEST_COVERAGE_GAPS.md` records what neither this page nor the suite
asserts, and why.
