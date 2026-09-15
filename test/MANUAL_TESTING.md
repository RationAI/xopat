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
```

No file server: these deployments declare `core.server.media`, so the viewer
serves `test/fixtures/data` itself with `Range` support. `npm run fixtures:serve`
(:9100) is still there for scans stored **outside** the repository, which a media
root may not reach — point `XOPAT_SLIDE_ROOT` at them and `TIFF_FILESERVER` at
the server.

> If `fixtures:fetch` refuses an item by name, that file has not been published
> yet — see `test/fixtures/data/README.md`.

### `webtiff` — the session fixture library's deployment

```bash
npm run up:dev -- webtiff
npm run fixtures:urls -- --deployment webtiff     # …or just read the startup banner
```

The server prints every session this deployment can open, with its prerequisites
— published from `test/fixtures/sessions/index.json`, the same catalogue
`fixtures:urls` reads.

Verify, walking that list:
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

### `geotiff` — the other decoder, the plain-TIFF subset

```bash
npm run up:dev -- geotiff
```

Deprecated, and deliberately narrower: its banner lists **eight** sessions, not
the twelve `webtiff` publishes. The four multichannel ones are excluded because
this decoder reads a single plane of a multi-plane TIFF and refuses the OME
file's companion pages outright — see `modules/geotiff/README.md` § *Limits*.
A `Tile … Unsupported data format/bitsPerSample` here has two causes, and only
one is a defect. **Check the banner first:** if the failing session is not on it,
you opened a URL this deployment never advertised — a stale tab, or a link from
`npm run fixtures:urls`, which correctly names `webtiff` as the deployment for
those sessions. That is expected; the exclusion stops a session being
*advertised*, not *opened*, and nothing should refuse a session merely because
the running decoder is weaker than the one it was written for. If the session
*is* on the banner, the capability exclusion failed and that is worth
investigating.

Verify: those eight render. The row exists for bisection — when a **plain** TIFF
looks wrong under `webtiff`, whether `geotiff` agrees separates a decoder fault
from a file fault. For anything multichannel there is nothing to compare against.

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

### `annotations-lab` — annotations, measurements and pathology

```bash
npm run up:dev -- annotations-lab
npm run fixtures:urls -- --deployment annotations-lab
```

The three subsystems are one feature in use — draw a region, measure what is
under it, bound the sample by a tissue mask — so they get one deployment rather
than three ENV edits. Nothing external: the tissue detector in
`pathology-foundation` is dependency-free and nothing leaves the viewer. Quick
draw arrives with combos already bound (`Digit1`-`Digit4`), which ships unbound
everywhere else.

Verify, on `annotations-lab` (bare H&E):
- `Digit1` / `Digit2` / `Digit3` each enter manual drawing with that shape and
  preset in one press — no trip through the toolbar. `Digit4` swaps only the
  preset and leaves the shape alone.
- A drawn region reports an area in **µm²**, not pixels: the session declares
  `microns`, and a measurement quoted in px means the pixel size was lost
  between the background config and the scalebar, not that the engine is wrong.
- The tissue-mask action exists. If it is missing, `pathology-foundation` did
  not load — the measurements module degrades silently when it is absent, which
  reads as a broken build rather than a deployment that did not ask for it.
- A mask derived while framed on one island keeps that island; zoomed out to the
  whole section it keeps the section. The reach is a fraction of the *current*
  viewport width, so the same action at two zooms must not give the same answer.
- Every field coming back `reason: "unread"` is a **latency** symptom, not an
  unreadable slide. This deployment already raises the three
  `pathology-foundation` timeouts over their defaults; raise them further before
  concluding the slide is at fault.

On `annotations-lab-overlay` (the same slide with a prediction heatmap):
- With `source: "rendered"` the sampler reads the **composited** canvas, so
  toggling the overlay changes what a threshold selects. If it does not, the
  sampler is reading raw data while claiming to read the render.

---

## Tier 2 — a wsi-service container

```bash
docker compose -f docker/wsi-service/docker-compose.yml up -d
```

It publishes **9002:8080**, so `WSI_PORT=9002` in `env/.env`. Slides are by default
read from the repo-root `test/fixtures/data/slides/` directory. Opionally use `DOCKER_COMPOSE_WSI_SERVER_DATA`
ENV variable to change the default position.

### `default` — the shipped standalone deployment

```bash
npm run up:dev -- default
```

Verify: the slide browser lists what is in `test/fixtures/data/slides/`, a slide opens, tiles
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
- **Nothing reaches :9002.** Filter the network panel on the image-server port and
  keep it empty: the slide info, the tiles, the thumbnail/label/ICC requests, *and*
  the WSI file browser's case listing all travel `…/proxy/image-server/v3/…` on the
  viewer origin. The browser listing is the half that used to go direct — it owns a
  separate config key (`plugins["rationai-wsi-file-browser"].proxy`).
- No `…/proxy/image-server/http:/…` anywhere. The client `baseURL` is the path
  *after* the alias; `data/wsi-service` states an absolute one for the direct
  deployment, and the preset's `override` clears it (see `env/README.md` →
  *Conflicts are an error*). `npm run up:check` refuses the pair outright now.
- **A session cookie plus a CSRF token is not authorization.** `/proxy/<alias>/`
  with an alias this deployment does not configure answers
  `403 Proxy target alias is not allowed or not configured.` — deliberately the
  same response a session-refused alias gets, so the manual check proves the
  lookup only. Under `auth/none` the minted session is `allowedProxies: 'ALL'`,
  so nothing here is session-refused; that gate is pinned by
  `test/suites/unit/proxy-access.test.mjs` and exercised by the Keycloak tiers.

### `storage-persistent` — durable server state

Boots with no key. Every namespace `storage/persistent-30d` binds belongs to the
chat module, so the assistant is what produces the state to restart over:
`chat/all-providers` registers Anthropic, OpenAI and the OpenAI-compatible
(CERIT) provider at once, each taking its operator key from `env/.env`
(`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `CERIT_API_KEY`) when you hold one. A
provider with no key is still listed and asks the user for one in chat settings →
*Providers & API keys*.

```bash
npm run up:dev -- storage-persistent
```

Verify:
- Hold a conversation (any provider), then restart the server (Ctrl-C, re-run):
  the session is still in the picker, its messages are still there, and **another
  turn sends** — `kv:sessions` and `log:messages` are bound to `tiered`,
  attachments to `file`, and the session re-binds itself to the provider's new
  instance id (those are minted per boot; the session names the provider by
  `managedKey`/`typeId` instead).
- **A per-user API key does *not* come back.** `kv:secrets` is declared
  sensitivity `"secret"`, so the broker refuses to bind it to a persistent driver
  without an explicit operator opt-in; re-entering the key after a restart is the
  designed behaviour, not a lost write.
- Anonymous ownership is bounded by the browser session too
  (`XOPAT_SESSION_TTL_SEC`, 24 h idle) — a `user:<id>` principal is the robust
  answer for long-lived history.
- Retention: `kv:sessions` 30 days / 20000 entries, `log:messages` 500 per
  transcript, `blob:attachments` 30 days. Inspect what the server actually holds
  with `POST /__rpc/server/core/getStorageStats`.

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

The scoring control is **not** a menu entry. `slide-scoring` renders a floating
button bar — one per viewer cell, bottom-centre, one button per
`scoreSchema.labels` key (`negative` / `uncertain` / `positive`). If no bar is
visible the plugin did not mount; that is the failure, not a missing menu.

### `mlflow-annotations` — scores *and* annotation bundles to the same server

Same server, same setup as `mlflow`.

```bash
npm run up:dev -- mlflow-annotations
```

Verify: scoring still behaves as above, **and** an annotation export lands as a
run artifact under `xopat/`. The point of the preset is that both travel one
sink instance and one proxy alias — only the per-binding `template` differs
(`slide-scoring` for the metric, `bundle-artifact` for the bundle). A second
sink id would defeat the test.

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

### `annotations-lab-vision` — the annotations lab with vision inference

Same variables as `roles-dev-vision`, plus the CERIT chat key.

```bash
npm run up:dev -- annotations-lab-vision
```

Verify:
- `pathology.analyzeRegion(...)` returns findings for the region on screen — the
  `analyze` feature has a driver, which the base lab deliberately does not ship.
- Under `auth/none` the call is **refused**: `runVisionInference` requires a
  logged-in session. That refusal is the correct behaviour, not a broken
  deployment — compose an `auth/*` fragment over the preset to exercise the
  allowed path.

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
