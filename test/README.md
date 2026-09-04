# Testing xOpat

One runner covers core client, core server, plugins and modules — including
elements developed in their own repositories — and can run the same suites
against several deployment configurations.

```bash
npm test                                  # everything except @slow / @soak
npm test -- --project=secure              # one deployment
npm test -- --grep @security              # one topic
npm test -- --grep "legacy: server/"      # the not-yet-ported server suites
npm test -- --last-failed                 # rerun only what failed
npm test -- --only-changed                # only suites affected by the working tree
npm run test:ui                           # watch mode with time travel
npm run test:slow                         # the long ones (chat stress, RAM soak)
npm run test:report                       # open the last HTML report
```

There is deliberately no npm script per project or per suite — selection is what
`--project` and `--grep` are for, and a script per test turns `package.json`
into the index of what tests exist.

Nothing needs to be installed or downloaded first: `npm test` on a clean
checkout boots its own servers and generates its own slide.

## Layout

| Path | What |
| --- | --- |
| `test/suites/{unit,integration,e2e}/` | core suites |
| `{plugins,modules}/<id>/test/{unit,integration,e2e}/` | element suites |
| `test/harness/` | the harness itself (`@xopat/test-harness`) |
| `test/env/` | deployment ENV files backing the matrix |
| `test/e2e/`, `test/support/`, `test/fixtures/` | the frozen Cypress suite (below) |
| `test/legacy/<area>/` | core suites that predate the runner, still running (below) |
| `{plugins,modules}/<id>/test/legacy/` | element suites that predate the runner |

Test files are `*.test.mjs`. Cypress owns `*.cy.js`; the two never overlap.

## Projects — the deployment matrix

| Project | Deployment | Purpose |
| --- | --- | --- |
| `unit` | none | pure logic; no server, no browser |
| `legacy` | none | the not-yet-ported scripts, run unmodified |
| `default` | `env/env.default.json` | the ordinary dev deployment |
| `secure` | `test/env/secure.json` | `client.secureMode` on |
| `production` | `test/env/production.json` | `client.production` on — config cache + asset baking |
| `synthetic` | `test/env/synthetic.json` | serves a generated slide; the only project that renders image data |
| `errors` | `test/env/errors.json` | the same slide plus a destination that is not there; failure rendering |
| `saml` | `test/env/saml.json` | a real identity provider and role-based rules; skips without the Keycloak fixture |
| `oidc` | `test/env/oidc.json` | the same deployment and the same rules over OIDC instead of SAML; same fixture |

Why projects and not flags: `secureMode` and `production` are **not reachable
from a session**. `secureMode` lives at `core.client.<active>.secureMode` and is
deliberately absent from the `setup` block, so the boot sanitizer in
`src/app.ts` drops any attempt to set it from a session bundle or URL param —
which is the point of it. The only honest way to test it is a server that was
started with it.

`integration` and `e2e` suites run in **every** matrix project. A test that only
makes sense in one says so with a tag.

A matrix ENV file states only its *difference*, over a `$base` — either one path,
or an ordered list of composer selectors (fragment ids under `env/parts/`, preset
names, paths). Resolution, merging and conflict detection are
`server/utils/node/env-compose.mjs`, shared with the `npm run up` runner, so a
project's deployment and a developer's hand-run deployment cannot mean different
things. `createEnvScratch({ envFile })` accepts an array directly, and a layer
disagreement throws rather than resolving last-wins. See
[`env/README.md`](../env/README.md).

### The `saml` project

It needs an identity provider, so it brings its own:

```bash
docker compose -f test/fixtures/keycloak/docker-compose.yaml up -d
npm test -- --project=saml
```

Without the container the suite **skips with instructions** (`requireKeycloak()`
probes it), so a clean checkout pays one failed connection. Two things make it
different from the other matrix projects, both consequences of talking to
something outside the repo:

- **The port is pinned** (`xopatPort: 9400`, `workers: 1`). The realm registers
  concrete redirect URIs, so the server cannot float with the worker index.
- **It declares its own process environment** (`xopatServerEnv`) for the values
  read before any config — the token signing secret and the SSRF allowlist entry
  a loopback IdP needs. Stating them in the project beats relying on whatever the
  developer happened to export.

It also carries a **SAML-protected OpenAI chat provider** on the same `core`
context, which is what proves the auth indirection: the plugin names a context
and knows nothing about SAML, so swapping brokers is a `modules` change. No API
key is needed — the assertions are that the RPCs are refused without a token and
that the provider registers with `requiresLogin` after login. Set
`OPENAI_API_KEY` to exercise real model calls.

See [`fixtures/keycloak/README.md`](fixtures/keycloak/README.md) for the users
and what each is allowed to do.

### The `oidc` project

The same deployment reached over OpenID Connect — same container, same realm,
same two users, second client (`xopat-viewer-oidc`, public + PKCE).

```bash
docker compose -f test/fixtures/keycloak/docker-compose.yaml up -d
npm test -- --project=oidc
```

It exists because `core.roles.claims` is supposed to be **broker-agnostic**: it
names a claim and a context, and nothing in it is SAML. The only way to show that
is to run it twice.

The two fixtures used to carry the role block and the `chat-openai` block copied
verbatim, with a comment asking readers to keep them byte-identical — a
divergence *was* the regression. They now compose the same fragments
(`env/parts/roles/guest-pathologist-researcher.json`, `chat/openai-server-key`,
`storage/tiered-sessions`) through an array `$base`, so identity is structural
rather than aspirational, and each file is down to the one layer that differs:
`auth/keycloak-oidc` versus `auth/keycloak-saml`.

Two differences from the `saml` project:

- **No signing secret.** `saml-auth` mints a session token, so both halves need
  `XOPAT_SAML_JWT_SECRET`. Here the IdP signs and the `oidc` verifier checks the
  signature against the published JWKS, so nothing shared has to be configured.
- **`XOPAT_SSRF_ALLOWED_HOSTS` is still required**, for a different fetch: the
  verifier pulls the JWKS through the core SSRF guard, which blocks loopback and
  fails closed. Without it every authenticated RPC is refused, which looks like a
  broken login.

The port is pinned to **9401** (`workers: 1`), for the same reason 9400 is:
`redirectUris` on the OIDC client name concrete origins. Its probe is
`requireKeycloakOidc()` rather than `requireKeycloak()`, because a container
started before that client existed still answers for the realm — an existing
realm is never re-imported, so the skip message names the `down -v`.

### The `errors` project

Failure rendering — a tile that will not load, a descriptor that will not parse,
a destination that is not there, a visualization index pointing at nothing, a
shader type nothing registers.

```bash
npm run test:slides           # once; the same pyramid the synthetic project uses
npm test -- --project=errors
```

To drive it by hand in a browser, **compose the ENV first**:

```bash
npm run up:dev -- test/env/errors.json
```

Not `XOPAT_ENV=test/env/errors.json npm run dev`. The server reads `XOPAT_ENV`
as a plain file and does **not** resolve `$base` — that key lives only in
`server/utils/node/env-compose.mjs`. It would see this file's one added protocol
and nothing the base layers contribute, then fall back to the `src/config.json`
dev client, which fails as `/iipsrv/iipsrv.fcgi?…` 404s: a broken ENV that looks
exactly like a broken slide. The harness never hits this because
`createEnvScratch` flattens the chain before spawning; `up:dev` does the same
for a hand-run server. This applies to every `$base`-using ENV under `test/env/`,
not just this one.

It is opt-in for the inverse of the `synthetic` project's reason: these specs
*expect* the viewer to fail, so running them against a healthy deployment would
report a working viewer as a broken test.

Faults are injected two ways, and which one is right depends on the failure:

- **`page.route`** when a destination answers *wrongly* — a tile that 500s, a
  descriptor that comes back malformed. There is deliberately **no server-side
  fault-injection hook**: a test-only "fail this path" branch in
  `server/node/index.js` would put test surface in the production server, and
  interception produces the same client behaviour. Install the route **before**
  `launch()`.
- **the deployment** when a destination is *not there*. `test/env/errors.json`
  adds a `missing` protocol pointing inside the opted-in static root at a
  directory the generator never creates, so the request gets a real 404 from the
  real static handler. A background opts in per entry with
  `{"protocol": "missing"}`; the inherited `static` protocol stays the default,
  so one session can hold both a healthy and a dead slide.

The suite asserts **state and messages, not pixels** — and that is the finding,
not a shortcut. A failed tile draws nothing (OSD sets `exists = false` and
returns; `tileRetryMax` is 0), and a faulty background is an `EmptyTileSource`
at `opacity: 0`. Both are pixel-identical to a slow load, so a pixel assertion
here would be asserting that the gap exists. Messages are captured by trapping
the `window.Dialogs` assignment in an init script rather than scraping the toast
DOM, which collapses repeats into a count badge and races the auto-hide timer.

**These specs need a current `src/dist` bundle** — see *Diagnosing a failure*.

## Tags

| Tag | Meaning |
| --- | --- |
| `@unit` `@integration` `@e2e` | suite kind (usually implied by location) |
| `@security` | security-relevant assertions |
| `@slow` `@soak` | excluded from the default run; `npm run test:slow` |
| `@secure-only` `@production-only` | only meaningful under that deployment |
| `@synthetic` | needs the generated slide; runs only in the `synthetic` project |
| `@errors` | expects the viewer to fail; runs only in the `errors` project |
| `@saml` | needs the Keycloak fixture; runs only in the `saml` project, skips with a reason when it is not up |
| `@oidc` | the same fixture over its OIDC client; runs only in the `oidc` project, same skip |
| `@needs-slides` | needs *real* slide data; skips with a reason when absent |

`XOPAT_TEST_ALL=1` lifts the slow exclusion — as an env var rather than a baked-in
`--grep-invert`, so your own `--grep @slow` is not silently cancelled by it.

## Writing a test

```js
import { test, expect } from "@xopat/test-harness";

test("the client learns its secure mode from the deployment", { tag: ["@e2e"] },
    async ({ xopat, xopatServer }) => {
        await xopat.launch({ params: { bypassCookies: true, bypassCache: true } });
        const secure = await xopat.page.evaluate(() => window.APPLICATION_CONTEXT.secureMode);
        expect(secure).toBe(xopatServer.scratch.flags.secureMode);
    });
```

Fixtures:

- **`xopatServer`** (worker-scoped) — a running server for this project's ENV.
  `baseURL`, `rpc(kind, id, method, args)`, `session()`, `getLogs()`, `logs`,
  `setEnv(partial)`, `restart()`.
- **`xopat`** — a browser page bound to that server. `launch(session, {transport})`,
  `waitForApp()`, `waitForViewer()`, `canvas()`, `drag(points)`, `getOption()`,
  `env()`. **Requesting it is what starts a browser** — server-only tests must not.
- **`xopatDiagnostics`** (automatic) — on failure, attaches the effective ENV, the
  server's output, its log buffer, and the page's `console.appTrace`.

Helpers: `ensureSyntheticSlide()`, `requireSlides()`, `requireEnvVar()`,
`requireKeycloak()`, `requireKeycloakOidc()`, `installBrowserGlobals()`,
`loadBrowserScript()`, `fromRoot()`.

Worker options a project sets in `use`: `xopatEnv`, `xopatDevMode`,
`xopatServerLogLevel`, `xopatServerEnv` (extra process environment for the
spawned server — bootstrap values that by definition cannot come from the ENV
file), `xopatPort` (pin the port instead of deriving it from the worker index;
requires `workers: 1`).

Prefer asserting on application state (`APPLICATION_CONTEXT`, `VIEWER`) and
stable DOM anchors over screenshots.

### Launching a session

`launch()` takes a transport, because `src/parse-input.js` accepts four and each
is a real deployment path:

| Transport | URL / mechanism | Used by |
| --- | --- | --- |
| `hash` (default) | `#<session json>`, parsed locally | shareable links |
| `query` | `?visualization=<json>`, client re-submits as POST | hand-written URLs |
| `post` | the navigation request itself is rewritten to POST | embedding applications |
| `slides` | `?slides=a,b,c` | the cheapest smoke URL |

### Rewriting the deployment mid-run

`await xopatServer.setEnv({ core: { setup: { theme: "dark" } } })` — the server
re-reads its configuration on every request, so this takes effect immediately.

Each worker gets its **own scratch copy** of the project's ENV file, so this
works in every project and cannot touch a tracked fixture or another worker's
server. Under `production` the configuration is memoized until restart, and the
fixture restarts for you.

Assert on `APPLICATION_CONTEXT.env.setup.<key>`, not `getOption("<key>")`: the
boot call passes an explicit default for some keys, and an explicit caller
default outranks the ENV `setup` block in the core resolver.

## Slides

`test/env/synthetic.json` + `ensureSyntheticSlide()` generate a DeepZoom pyramid
(pure Node, no dependencies, cached on disk) and serve it from the viewer's own
static handler. Regenerate by hand with `npm run test:slides`.

Tests that genuinely need real data call `requireSlides()`, which **skips with a
reason** unless `XOPAT_TEST_WSI` and `XOPAT_TEST_SLIDES` are set — rather than
failing with a timeout whose cause has to be explained in prose.

## Plugin and module tests

Put them in `<element>/test/{unit,integration,e2e}/*.test.mjs` and import
`@xopat/test-harness`. Nothing needs to be registered.

Optional `include.json` block:

```json
"tests": {
  "dir": "test",
  "envs": ["default", "secure"],
  "requires": { "browser": true, "server": true, "slides": false },
  "tags": ["@slow"]
}
```

`envs` is the useful one: a plugin that is only enabled in some deployments
would otherwise fail in the projects that never load it.

**Elements developed in their own repository** are linked in the same way the
server already supports — `ln -s /path/to/my-plugin plugins/my-plugin`, or a
junction on Windows. The runner follows the link with no further configuration;
it prints which elements it found linked in when it does. Two caveats: their
suites are collected through `test/harness/external/`, and `tests.envs` is not
enforced for them (use tags instead).

## Suites that predate the runner

Standalone `node` scripts with their own assertion style, **run unmodified** by
`test/harness/legacy/`, which parses their output back into runner-visible
assertions — so all of their coverage counts today, with no rewrite. Each is
also still runnable directly (`node test/legacy/core/semver.mjs`).

They live with whatever they test:

```
test/legacy/{server,core,io,ui}/*.mjs        core
{plugins,modules}/<id>/test/legacy/*.mjs     the element they exercise
```

That second location is the point: an element's suites belong to the element —
including one developed in its own repository — and porting is then a move
*within* it (`test/legacy/` → `test/unit/`), not a relocation across the tree.
The report name is `<area-or-element>/<basename>`, e.g. `legacy: server/ssrf-guard`,
`legacy: dicom/derived-conformance`.

Run one of them:

```bash
npm test -- --grep "legacy: server/semver"   # one suite
npm test -- --grep "legacy: server/"         # the server suites
npm test -- --project=legacy                 # all of them
```

They are not listed anywhere: `test/harness/legacy/manifest.mjs` scans
`test/legacy/*` and `{plugins,modules}/*/test/legacy`, declaring only what it
cannot derive (the few suites needing a longer budget or the `@slow` tag).
Adding one needs no registration; porting one removes it automatically. An empty
scan means the port is finished.

## Diagnosing a failure

The HTML report carries, for every failed test: the deployment ENV in force, the
server's stdout/stderr, its log ring buffer, the page's `console.appTrace`, plus
Playwright's trace, screenshot and video.

A test that used the `xopat` fixture also attaches what it takes to reproduce
the failure **outside the runner**, which the ENV file alone does not give you:

- **`session config`** — the session that was launched. Nothing recorded it
  before; a spec builds it inline and it vanished with the worker.
- **`effective client ENV`** — the ENV *as the page received it*. The scratch
  file is pre-substitution, so the protocol URL the test actually hit — usually
  the thing that is wrong — appears nowhere in it.
- **`reproduce`** — `XOPAT_ENV=…`, the port, and for the hash transport the
  literal URL. Paste it into a browser running that ENV and you have the failure
  with no test runner involved.

`XOPAT_TEST_SERVER_LOG=debug npm test -- --project=default` raises the spawned
server's log level through the normal logging broker (see `server/LOGGING.md`).

**A client-side fix with no effect usually means a stale bundle.** The harness
boots `node index.js` against whatever is compiled into `src/dist`; it does not
build. `src/**/*.ts` is compiled by the watcher (`npm run dev`), so with the dev
server down, an edit to `src/classes/**` is invisible to every browser project.
Check the timestamp of `src/dist/app.js` against your edit before believing a
red test.

---

# The Cypress suite (frozen)

Still present, still runnable, unchanged: `npm run test:cypress` (or
`npm run test:cypress-w` for the interactive runner). New browser tests go to
the runner above; these specs are ported opportunistically. Everything below
this line describes that suite as it stands.

The testing framework can be run directly from console using `npx cypress open`. But first,
the testing must be configured, which can be done in many ways:
 - local WSI server and viewer
 - distant WSI server and local viewer
 - both distant WSI server and viewer

The only thing you have to ensure is that the WSI server can access the correct slides required for testing,
and that the slide paths/IDs are provided. Typically, you have to:
 - create **``cypress.env.json``** file in the project root, it defines where and how to access the viewer, see example files in this directory
 - run ``npm install`` if you haven't already, it installs build and test tools
 - run ``npm run test:cypress-w`` (alias to ``npx cypress open``) to run the interactive test framework

Configuring the test correctly might be a bit more difficult
than you would expect; therefore we provide almost out-of-box setup for localhost.

## Testing on localhost
First, get the slide data. The suite (including the pixel-diff baseline) uses the
public OpenSlide test slide **CMU-1.tiff**:

- https://openslide.cs.cmu.edu/download/openslide-testdata/Generic-TIFF/CMU-1.tiff (~200 MB)

Place it (as copies or links) wherever your WSI server resolves the ``wsi_*`` IDs
configured in ``cypress.env.json``. The suite actively renders ``wsi_tissue`` (main
background everywhere, also the pixel baseline) and ``wsi_annotation`` (second
background in the activeBackgroundIndex test); ``wsi_probability`` and
``wsi_explainability`` are reserved for future visualization-layer tests. Using a
different slide than CMU-1.tiff works for all state-based tests, but the committed
pixel baseline will not match — run those setups with ``--env skipPixelTests=1``
or record a local baseline.

Next, download a WSI viewer and run it. We recommend using 
[our modification of the Empaia WSI Server](https://github.com/RationAI/WSI-Service). You need
to run the docker compose for the server - in `docker-compose.yml` inside the repository:
 - configure the ENV variables (see e.g. `cypress.env.rationai-mapper.json`)
 - mount the directory where your slides are inside the docker as ``/data``
   - move the downloaded test slides as ``[the-docker-mount-path]/cypress/*.tiff`` 

And then run ``docker compose up``. Move the `cypress.env.rationai-mapper.json` to this repository
root and rename it to `cypress.env.json`.

> Do not forget to remove commens from JSON for cypress env. Cypress does not support
> JSON with comments unlike this viewer.
 

Last but not least, we will use the `node` local viewer server (OpenSeadragon ships
with the repository in ``src/libs/``, no separate download needed).
The viewer must understand the WSI server you are going to use. You can use
``viewer.env.wsi-service.json``, simply run `npm run s-node-test` (server node for tests),
or run against your usual dev setup (`npm run s-node` with ``env/env.json``) — the suite
holds under any ENV, see *Testing across deployment ENVs* below.

The slide keys in ``cypress.env.json`` map to whatever IDs your WSI server resolves
(paths, UUIDs...). The current tests actively render only ``wsi_tissue`` (main
background everywhere) and ``wsi_annotation`` (second background in the
activeBackgroundIndex test); ``wsi_probability`` and ``wsi_explainability`` are
reserved for future visualization-layer tests.

Now you are done and you can start testing (e.g. `npm run test:cypress-w` for interactive tests).

### HEADERS object in cypress.env.json
These headers used for cypress access to the viewer domain
(configured in the `interceptDomain` field). This is necessary for the viewer
 server to parse correctly the post data (session).

## Writing tests

Inherited from the cypress default hierarchy, you can
 - find test suites in ``e2e/``
 - find configuration methods (session config generators) and static data in ``fixtures/``
 - find custom command (``cy.launch``, ``cy.canvas``, ``cy.key``, ``cy.draw``) and utility
   definitions (``waitForViewer``) in ``support/``

The best approach is to copy and modify existing tests. Prefer asserting on application
state (``APPLICATION_CONTEXT``, ``VIEWER``) and stable DOM anchors over screenshots;
use ``cy.canvas().matchImage()`` only for a few smoke scenes on the rendered canvas.

## Testing across deployment ENVs

The viewer's behavior depends heavily on the deployment ENV (the ``XOPAT_ENV`` file):
default params (``setup`` block), shipped plugins, slide protocols. The suite is
written to hold under any ENV:

- Tests exercising a param **pin it explicitly** in the session ``params`` — session
  params override ENV defaults, so an ENV cannot flip the tested baseline.
- The *env defaults* test in ``params.cy.js`` derives its expectations from
  ``APPLICATION_CONTEXT.env.setup`` at runtime instead of hard-coding shipped values.
- Pixel-diff tests compare against a baseline recorded under one particular ENV and
  machine; runs against any other ENV skip them via ``--env skipPixelTests=1``. The
  baseline is kept **per browser** (``canvas-smoke-<browser>``): the first run in a
  new browser records it, later runs compare against it — commit the generated
  ``test/e2e/__image_snapshots__/*.png`` for every browser you test with.

There is no "default" ENV — the server always runs with whatever ``XOPAT_ENV`` file it
was started with (``env/env.json`` when the variable is unset). ``npm run test:cypress``
simply runs against the server already listening on the ``viewer`` URL from
``cypress.env.json``. To run the suite against a server with a different ENV file:

    npm run test-env -- <viewer-env-file> [port]      # e.g. test/env/viewer.env.test-custom.json 9001
    npm run test-matrix                                # suite against the running server + the test-custom ENV

``test/run-env.sh`` starts ``node index.js`` with the given ``XOPAT_ENV`` on a side
port (default 9001), waits for it, runs Cypress with ``viewer``/``interceptDomain``
redirected there, and shuts the server down. ``test/env/viewer.env.test-custom.json``
deliberately flips several defaults (hidden scalebar/navigator, top notifications,
disabled nav shortcuts) to prove the suite adapts. The WSI service on :8080 is shared.
It is a bash script, so it needs Git Bash or WSL on Windows — the new runner spawns
servers in-process instead and has no such requirement.

## Rewriting the ENV file at runtime (``cy.setEnv``)

``cy.setEnv(envObject)`` overwrites the ENV file the currently-targeted server
reads (via the ``writeEnvFile`` task in ``cypress.config.js``), letting a spec
prove the server picks up a change on its very next request, no restart needed. It
requires ``--env envFile=<path>`` to be set (usually via
``test/run-env.sh <path> ...``); calling it without ``envFile`` throws.

Today only ``test/e2e/env-injection.cy.js`` uses it, and only against its own
dedicated scratch file, ``test/env/runtime.json`` - run it directly with
``npm run test-env-injection`` (it self-skips under plain ``npm run test:cypress`` or
``npm run test-matrix``, so nothing runs it unless explicitly asked). That spec gates its
activation on ``envFile`` being *exactly* that scratch path, not merely
"set to something" - ``envFile`` is a generic passthrough that other runs
reuse for their own target file (e.g. ``npm run test-matrix`` sets it to the
tracked ``test/env/viewer.env.test-custom.json``), and activating on mere
presence would let the spec overwrite whichever tracked fixture happened to
be passed in.

    const SCRATCH_ENV_FILE = 'test/env/runtime.json';
    const targetsScratchEnv = () => Cypress.env('envFile') === SCRATCH_ENV_FILE;

Any new spec that wants to use ``cy.setEnv()`` against a different target
file must gate its own activation the same way, on that specific file, not
on ``envFile`` being merely present, to avoid the same class of bug.

(The new runner does not have this constraint: every worker gets a private
scratch copy of the ENV, so `setEnv` is safe in every project.)

## Known limitations
Some deployment options cannot be exercised from the test suite at all — e.g.
`secureMode` is intentionally not overridable from a session (it would be insecure),
so it can only be tested by pointing the suite at a server deployed with it
(``npm run test-env`` with an ENV file setting it; the new runner does this with its
`secure` project). If a test fails unexpectedly,
first check that the target server is actually running with the slides available
(a 30s "Waiting for the viewer" timeout usually means the WSI server could not
resolve the configured slide IDs).
