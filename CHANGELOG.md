# Changelog


### 3.0.1

Hardening and infrastructure release. The headline items are a server-side storage and logging
architecture (bounded, operator-routable, cluster-aware), a single test runner covering core,
plugins and modules, a new WebAssembly TIFF reader, SAML and HTTP-Basic authentication, and a
broad pass over the Node server's security posture.

**Features**:

* **Server infrastructure** — pluggable `kv` / `log` / `blob` storage with `memory` / `file` /
  `tiered` drivers, retention policy and a secret gate (`server/STORAGE.md`); one bounded
  LRU/TTL cache engine replacing seven hand-rolled `Map`s; a logging broker with per-channel
  levels, redaction and a gated `sensitive` path (`server/LOGGING.md`); documented environment
  and secret handling (`server/ENVIRONMENT.md`); `XOPAT_SERVER.isDevMode(ctx)` as the canonical
  dev gate; multi-process deployment via `cluster-index.js` and `XOPAT_WORKERS`, with a
  `/ready` endpoint, graceful SIGTERM/SIGINT drain and deployment-wide budgets.
* **Testing** — one Playwright-based runner for core client, core server, plugins and modules,
  including elements linked in from their own repositories. Deployment differences (`secureMode`,
  `production`) are projects rather than flags; a synthetic DeepZoom slide removes the dependency
  on real WSI data; legacy suites run unmodified through an adapter (`test/README.md`).
* **Tile sources & rendering** — new `webtiff` module (libtiff, zlib-ng, libjpeg-turbo, libwebp
  and zstd compiled to WebAssembly, with a decode worker pool); GeoTIFF data rendering; DICOM
  segmentation and parametric-map overlays; float16 GPU rendering; a live render-debug panel;
  off-screen region rendering for scripting.
* **Authentication** — SAML support (`modules/saml-auth`); an HTTP Basic broker
  (`modules/basic-auth`); OIDC unified behind the core auth broker with contexts auto-declared
  from config; late context discovery so boot no longer races the login; degraded-session support.
* **Chat & voice** — an OpenAI provider; providers referenceable by id from config instead of
  generated ids; server-side conversation storage; stronger guardrails when a model narrates
  without executing; provider discovery suppressed when no API key is set; dictation captions and
  batched audio capture; a configurable default transcription model.
* **UI** — a reusable `Autocomplete` component (replacing the vendored BVSelect) and a
  `SuggestionEditor`; `AppBar.Actions` plus pinnable quick actions; a `MainLayout` with an overlay
  global menu; a `"…"` configuration overflow for menus; a keymap panel; explorer search and
  navigation improvements; mobile toolbar dropdown integration.
* **EMPAIA workbench** — analyses moved out of the fullscreen plugin menu into a dockable
  **Tools → Analyses** window with search, status/time filtering and a running-job app-bar badge.
  One eye per analysis now governs everything that run produced — annotations, pixel maps and
  scalar values alike — with *solo* and *hide all*, the newest completed run shown by default.
  Job state and output visibility became per-slide in `empaia-workbench`, and output is painted
  into the viewport actually showing the slide rather than the focused one.
* **Annotations & plugins** — read-only annotation support and a disposal API; preset API keyed by
  name; a comment indicator on annotations that carry one; questionnaire answers persisted through
  the IO pipeline; slide-info visited-slide tracking and improved switching; viewport registration
  (image alignment) running in a worker.
* **Core** — a request scheduler with a background lane so tile traffic never starves; z-depth
  fetch and sync generalization; explicit tile-source selection from a session; rotation via a
  modifier key; auto navigator sync; per-ENV session isolation; `npm run storage-audit`, and
  `i18n-audit` extended to plugins and modules.
* **Chat on AI SDK 7** — core `ai`, `@ai-sdk/provider` and every provider plugin moved onto one
  release line (system prompt as `instructions`, `file` content parts, the renamed stream/usage
  surfaces). Provider packages must now match core's specification major: the rule is documented
  in `modules/vercel-ai-chat-sdk/README.md`, enforced per model at runtime
  (`assertLanguageModelCompatible`) and per manifest in a unit test, because a mixed line installs
  cleanly and only fails once a user sends a turn.

**Bugfixes**:

* **Server security** — static file serving now resolves against an allowlist of roots instead of
  "any path that exists" (`env/env.json`, the storage root and `*.server.*` sources were reachable
  anonymously); every interpolation into an inline `<script>` goes through `jsonForScript()`, so a
  reflected `</script>` in the POST body can no longer execute on the viewer's origin; baseline
  security headers (`nosniff`, referrer policy, framing) with a `frameAncestors` allowlist for
  embedded deployments; `/dev_setup` and `/scheme*` gated behind dev mode or an explicit opt-in;
  the proxy forwards an allowlist of request headers (it previously handed the browser's `Cookie`,
  `Authorization` and CSRF token to third parties), strips `Set-Cookie` from upstream responses,
  follows redirects itself so operator credentials are dropped off-origin, and streams instead of
  buffering; constant-time CSRF and JWT-signature comparison; a configured JWT `issuer`/`audience`
  is now a requirement rather than a hint, and a token without `exp` is refused by default; request
  bodies are capped on every route; unhandled errors return a correlation id instead of the
  exception text. The same hardening was applied to the PHP renderer, which had none of it.
* **SSRF guard** — classified upstream errors with host-free public messages, a response-size
  ceiling, working timeouts (the old code silently dropped the timeout whenever the caller also
  passed a signal), and an operator allowlist (`XOPAT_SSRF_ALLOWED_HOSTS` / `_CIDRS`) for trusted
  internal backends that never relaxes the redirect or DNS-rebinding protections. The three modules
  that broker credentials (`saml-auth`, `oidc-server-ts`, `oidc-client-ts`) now fail closed when the
  guard is unavailable instead of falling back to a bare `fetch`; the check is at request time, so a
  deployment that configures no identity provider is unaffected.
* **Sessions** — split into a shareable identity half and a memory-only secret half, so a
  clustered deployment stops losing sessions at random; per-request writes merge instead of
  clobbering a concurrent login's state; expiry now notifies owners on every path, so per-session
  data (chat transcripts, BYOK keys) is purged rather than orphaned.
* **IO pipeline** — simplified, with hardening for the case where the server refuses a write;
  hydration guard against a double `importBundle` at boot; revert-on-refusal by default.
* **Rendering & data** — DICOM decode-path and concurrency performance, pixel handling, and ICC
  correction for every tile type; flex-renderer initialization crashes; deferred preview rendering;
  faulty tile-source initialization no longer takes the viewer down; scalebar re-render cost.
* **UI** — explorer paging no longer corrupts its own page cache (paging back re-rendered the
  wrong page, and slide prev/next inherited it); the autocomplete no longer discards the first
  character typed into a closed control; toggling a quick-action pin in Settings no longer rebuilds
  the list under the checkbox being clicked, which stole focus and reset the scroll position on
  every toggle; the global-menu edge rail updates its tooltip again; right-side menu header layout.
* **Robustness** — a crashed registration worker is now discarded instead of being handed back to
  the next caller, where its requests never settled and disposal refused to run; a malformed
  "Extra headers JSON" provider field is reported and skipped rather than surfacing as a 500; a
  DICOM palette descriptor with a bad entry count degrades to the grayscale path instead of
  painting black; auth diagnostics moved onto the `core.auth` logging channel; worker close and
  annotation-settle failures are logged rather than swallowed.
* **Server module bundler** — a plugin/module `*.server.ts` whose bundle failed to import used to
  report as `RPC_UNKNOWN_METHOD` on every one of its methods; two causes are fixed. CommonJS
  dependencies now get a real `require` in the ESM bundle (esbuild's shim otherwise throws
  `Dynamic require of "path" is not supported` at module scope), and the build cache is keyed on
  the toolchain and installed-dependency identity as well as source mtime — an `npm install`
  changes no `*.server.ts` mtime, so unedited elements silently kept running bundles with the
  previous major of a shared library inlined. Abandoned `.tmp-*` build directories are also swept
  now (`fs.rmSync({recursive})` silently no-ops on some Windows setups).
* **Misc** — `syncSessionToUrl` made fail-safe; `HttpClient` retries only when it can help and
  keeps per-slide contexts; safe file operations on the server; `env/` excluded from Docker build
  context so deployment secrets are not baked into image layers.

### 3.0.0

First stable v3 release (promoting `3.0.0-beta.1`). Focus areas since the beta: the AI chat
stack (streaming, voice, BYOK, security), a new pathology exploration API, annotation UX, and
rendering/loading robustness.

**Features**:

* **Chat & AI** — streaming RPC and a faster, more stable chat interface; voice input integration
  with hands-free controls and quicker speech recognition; bring-your-own-key (BYOK) provider
  secrets; a configurable default provider with consent remembering; region hotlinks in chat;
  friendly progress feedback during LLM computation; MedGemma integration; an experimental
  chat-based tester; by-default injection of basic viewer-context summary.
* **Pathology** — hierarchical pathology exploration API; generalized MLflow API + IO sink; a
  general slide-labelling plugin; sensitive-patient API support.
* **Scripting** — progress reporting and partial results; multi-viewport scripting; recorder
  scripting and importing; pathology scripting; magnification control.
* **Annotations** — replaced the ruler with a line tool; quick annotation-draw shortcuts;
  polyline works as a polygon in creation style; general UX polish.
* **Rendering & navigation** — synthetic preview image level for incomplete pyramids; z-stack
  (focal-plane) support promoted from the time-series shader to the core; base slide
  virtualization; scroll snapping to zoom levels; reverse scroll; joystick navigation mode.
* **Core** — central shortcut manager (hotkeys plugin removed); viewer virtual aliases; network
  status detection; branding configuration; global menu hover/overlay; do-not-ask-again API;
  streamlined auth configuration and integration API (legacy `oidc-auth` plugin removed);
  bundled third-party license notices; i18n audit script and localization detection.

**Bugfixes**:

* **Chat & voice** — security hardening (chat requires an active session); whisperer/speech
  transcription flexibility, stabilization, and WASM bugfixes; recorder listing; better global
  handling of uncaught errors; more robust chat request/error recovery.
* **Annotations** — border-width rendering and border updates; arrow cut/paste, arrow tool and
  factory stability; angle-arc rendering; polyline/polygon creation and viewport crop; IndexedDB
  serializers and hardened persistence; sink-API deletion propagation; toolbar UI/UX; HTML
  sanitization.
* **Rendering & data** — flex-renderer GeoJSON color parsing; DICOM integration and ICC usage;
  rationai-tile-source tile-size fix; bad-data viewer opening and slide-info behavior; playground
  duplicating shader entries.
* **Loading & build** — production bundling, asset inclusion, minification file serving, and
  handling of failed transpilation/minification; more stable core loading of modules and plugins
  with more metadata support; session env check on cached data.
* **Misc** — questionnaire fixed (now working); measurements plugin; explorer listing; renamed
  the security flag to `secureMode`; dialogs render safe HTML; translation and auth-context fixes;
  strengthened sanitization.

### 3.0.0-beta.1

xOpat v3 is a near-complete rewrite and is **partially backward-compatible with v2** —
but your old modules and plugins should be ported to the new APIs, especially the life-cycle timings
and multi-viewport support. The high-level changes are:

* **New rendering engine** — the WebGL `flex-renderer`, requiring OpenSeadragon v6.
* **Multi-viewport core** — a `VIEWER_MANAGER` can run several viewers on one page; most core events changed accordingly.
* **New UI system** — Van.js + DaisyUI components; Primer CSS, Material icons, and Bootstrap are deprecated.
* **Generic IO pipeline** — unified, pluggable persistence for sessions, annotations, and per-element state.
* **Server RPC & proxy auth** — server-side plugin/module methods and secured upstream proxying (Node; the PHP server supports the proxy).

And more, mostly new approach to most of the functionality to enable reusable functionality and providers,
consumed by generic users - pluggable and extendable. Check out the documentation!

---------------

### 2.3.1
**Features**: author annotation distinction.

**Bugfixes**: php image includes UI folder.

### 2.3.0

**Features**: added a way to set preferred annotation preset IDs for the GUI. Support for
annotation modes private and locked. Support for annotation comments. Implementation of ICC profiles.
Guidelines for WASM usage.
Annotation features: private / locked modes, comments support. Support for copy/move/delete
on right click.

**Bugfixes**: Fixed mjs module loading on servers.

**V3 Pull**: We are slowly adding code from v3 development that does not 
influence the v2 functionality, but allow using v3 features - UI and dev scripts.

### 2.2.2

**Bugfixes**: Fixed annotation visuals for point, line. Fix annotations rest IO, fix logics with refreshing token,
more robust behavior. Better behavior of tutorials. Better points rendering.

**Features**: annotation reconstruction from point array new API. Useful for convertors.
Using 'Unknown', non-exported annotation preset instead of creating new. Configurable data snapshots.

### 2.2.1
**Bugfixes**: faster zooming constant, disabled dynamic speed adjustment.

**Features**: experimental module & plugin sam-segmentation.

### 2.2.0
**NEW UI SYSTEM**. The UI now supports component system using Van.js library. A lightweight
way of re-using defined components, supported newly by tailwind css. The ui will be further
separated from the viewer core in the future. UI Components are not yet integrated, but the CSS Styles are.
There might be slight disturbances on collision of button / theme styling.

**Features:** new UI component system & developer UI tools. Server support for .mjs files - 
support for native JS modules. New annotation tool for multipolygons, new viewport segmentation
annotation tool. New event reacting on visualization rendering setting change.

**Bugfixes:** improved behavior for touchpad zooming.

### 2.1.1
**Features:** standalone wsi tile source module. Edge navigation optional.

**Bugfixes:** OIDC module popup method - await login.
Use session storage to store xOpat sessions as well.
Fixed scalebar magnification estimates. Annotations IO bugfixes.
Extend await event support.

### 2.1.0
**Features:** new system for module/plugin building, improvements of annotation listing features,
support for generic annotation visual style changes.

**Maintenance:** removed outdated plugins.

**Bugfixes:** plugins use also Cache API, annotation visuals updated also with history.
Fix oidc login with events.

### 2.0.4
**Features:** vertical magnification slider, allow 2x artificial zoom, annotation areas.

**Bugfixes:** OIDC module, magic wand annotation tool, stacktrace capture.

### 2.0.3
Bugifxes on annotations. Update font + change default weight. More
events propagated to modes (and recursively factories) to control.

### 2.0.2
New annotation features (edge mouse navigation, undo on manual creation steps, left click works
in navigation mode regardless of left mouse preset, ...). Fix PHP parsing: avoid converting
objects to arrays.

### 2.0.1
Improved annotations & bugfixes with storage API.

### 2.0.0
The version 2 brings:
* new UI features
  * servers: php & node & static
  * docker builds for php server
  * unified data & metadata storage logics
  * unified session config parsing
  * user interface: loading, events, bugfixes
  * maintenance & refactoring
* new modules & plugins
  * oAuth2 login capabilities
  * support for integration with Empaia WBS
  * YouTrack feedback form
  * pollyjs for traffic interception
