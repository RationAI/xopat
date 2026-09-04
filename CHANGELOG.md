# Changelog

### Unreleased

* **Fixed upstream and re-vendored**: a multi-channel OME-TIFF rendered one channel, silently. Files
  of that shape store each channel as its own full-size IFD with `SamplesPerPixel = 1` and hang the
  pyramid off each plane as SubIFDs; web-tiff's request carried a single directory, so planes 1..N
  were never fetched and the one that was — 8-bit grey — resolved as `interpretation: "image"`, i.e.
  grey replicated across RGB plus a constant alpha. From the viewport that read as a shader bug: three
  markers drawing identical content in three tints and a fourth layer as a flat wash of its colour.
  The decoder now reads every same-size directory as a channel of one tile in **one** request (the
  bytes live at N offsets either way, so this costs no extra network), reports the stack in its
  descriptor, and carries the OME-XML `Name=`/`Color=` per channel. `layout.prefer` is gone — a
  pyramid and a plane stack stopped being alternatives — leaving `layout.planeIndex` as the opt-out,
  which now *pins* one plane, so `planeIndex: 0` is a selection rather than a default. Measured on
  `test/fixtures/data/slides/LuCa-7color_Scan1.ome.tiff`: six levels of five planes, `channelCount 5` in two
  RGBA8 packs. The library's `VERSION` did not move, so probe
  `Array.isArray(file.levels?.[0]?.planes)` rather than a version (`UPSTREAM.md`).
* **The `webtiff` module was written against the one-plane decoder in four places.** Channel names and
  colours are now lifted from `encoding.channels[i]`, so a fluorescence slide auto-configures as
  DAPI/FITC/CY3/… in its acquisition colours instead of `ch0…ch4` in fallback tints; the statistics
  and thumbnail reads pass `planes`, so every channel gets a measured window (previously only channel
  0 did, which defeated `autoWindow: "rescue"` on exactly the dim channels it exists for) and a
  slide-list card is a composite rather than a grey plane; the canvas flattener forces alpha opaque in
  `data` mode, where a stacked pack `[0,1,2,3]` used to draw its fourth measurement as opacity; and
  the removed `layout` option no longer reaches the decoder. The multichannel demo session's heatmap
  layer moved from channel 0 to channel 4 — a swizzle letter cannot address past lane 3, so it had
  been re-rendering DAPI under the name "Autofluorescence".
* **Fixed upstream and re-vendored**: MVT vector tiles landed in the wrong place on any pyramid whose
  world is not an exact multiple of the tile size. The worker normalized geometry to the *nominal*
  tile while the drawer maps UV 0..1 onto `Tile.positionedBounds`, which OSD *clips* at a level's
  right/bottom edge — so the mesh was squeezed into the visible part of its own tile. The raster path
  had always compensated by scaling texcoords; a vector tile has none, and `GeoJSONTileSource` avoided
  it only because its worker already normalizes to the clipped rect. On the demo slide (105185 ×
  221772) that put the whole layer 2.49× off in x at low zoom. The tile source now derives
  nominal ÷ clipped from OSD's own `getTileBounds` and the worker folds it into every mesh kind;
  square web-mercator pyramids are unaffected. Same build also merges the worker's style `config`
  instead of replacing it, which used to drop `STYLE.fallback` for any TileJSON-derived style and
  turn an unstyled layer name into a worker throw.
* **A sparse MVT pyramid is now declared rather than discovered by 404.** The
  visualization-flexibility demo writes only tiles carrying geometry (1981 of ~119 000), so every
  other tile 404'd, and enough consecutive failures marked the whole source faulty — correctly, since
  a 404 is indistinguishable from a broken server. `make-visualization-demo.mjs` emits a `tileIndex`
  (per-level base64 bitmask) into `tiles.json` and `modules/demo-vector-layers` turns it into a
  `tileExists` predicate, which OSD consults before scheduling a tile. A 404 stays an error.
  Regenerate with `node test/harness/data/derive.mjs --only mvt --force`.

* **Fixed** menu pages rendering their own markup as visible text. `menu-pages` handed the built page
  to the viewer menu as an HTML *string*, and a string child is re-judged by `BaseComponent.toNode`'s
  untrusted-text renderer: with no `SanitizeHtml` loaded it degrades closed to a text node — and
  nothing re-rendered it, so it stayed that way — while with the sanitizer loaded its allowlist
  stripped every `id`, so pages that fill a placeholder after render (the whole Slide Information
  panel: slide label, technical metadata, download action) silently gave up. The module now hands
  over parsed nodes. Surfaced in the EMPAIA workbench deployment, whose plugin whitelist contains no
  other sanitizer consumer; every other deployment happened to load one first.
* A degraded `HtmlRenderer` render is now upgraded when `sanitize-html` finishes loading, matching
  what `modules/markdown` and `Toast` already do — degrading closed is only defensible while
  temporary.

* **Preview-level injection is source-gated, not role-gated.** The synthetic coarsest level
  (`src/classes/preview-level.ts`) used to be offered only to backgrounds, on the grounds that an
  RGB preview would be semantically wrong for shader data. The real constraint is narrower: the
  synthetic tile is served as an 8-bit `rasterBlob`, so it must not stand in for half-float tiles.
  Sources now declare `getTilePrecision()` (`src/tile-source.ts`; undeclared means
  8-bit-compatible), and any layer — overlay included — is eligible. Vector sources still fall out
  for free by implementing no `getThumbnail()`. The preview is also encoded as PNG rather than
  JPEG now that it can be shader input.
* **`webtiff` participates in preview injection.** It previously opted out wholesale
  (`__noPreviewLevel`) because the graft shifts OSD levels while its decoder indexed its own level
  array absolutely — a silent off-by-one that read every tile one level too coarse. web-tiff 0.1.0
  indexes relative to `maxLevel` (`_decoderLevel`), so the shift is harmless.
* **Overlays can declare their pixel scale.** A new `pixelScale` on a session data entry says how many
  pixels of the stack's background one pixel of that image covers. OpenSeadragon normalizes every image in
  a world to viewport width 1, so an overlay previously landed on its background only when their aspect
  ratios happened to match — an overlay covering a whole number of blocks of a slide that is *not* a whole
  number of blocks wide never matched, and was silently squeezed, drifting by most of a block across the
  image. Arithmetic and validation in `src/classes/app/overlay-pixel-scale.ts`; absent or malformed values
  place the image exactly as before.
* **Known issue** (`UPSTREAM.md`): the follow-up to the above — flex-renderer's `devicePixelScale` is one
  scalar taken from the X axis, but framebuffer dimensions are rounded per axis, so `sx != sy` whenever
  `devicePixelRatio != 1`. The grid's vertical period comes out 512.106 px for a configured 512 (0.02%,
  ~46 px by the bottom of a 221772 px slide); horizontal is exact because `sx` cancels there.
* **Fixed upstream and re-vendored**: flex-renderer's `grid` and `gridheatmap` positioned themselves in
  framebuffer pixels but scaled themselves in CSS pixels, so on any `devicePixelRatio != 1` display they
  drew cells at `1/DPR` of the configured size (426.7 px for a configured 512 at DPR 1.2). The origin was
  correct, so it read as drift rather than a scale error — and it made a correctly placed overlay look
  wrong. Now carries a `u_devicePixelScale` uniform.
* **Fixed** a small overlay failing its tiles in complete silence. `ViewerFaultySourceRegistry` required five
  consecutive failures before marking a source faulty — calibrated for gigapixel pyramids, and unreachable
  for a single-tile overlay, which can only ever produce one. The tolerance now scales to the source's own
  tile count, so one tile out of one is condemning.
* **Visualization-flexibility demo** (`docs/site/docs/visualization-flexibility.mdx`,
  `npm run up -- viz-flex-demo`): six sessions covering multichannel TIFF channel routing, GeoJSON
  and MVT vector layers, a one-pixel-per-prediction-square raster with interpolation off, and both
  sides of preview injection. Data is derived from the real prediction masks by
  `npm run fixtures:derive`. Adds `modules/demo-vector-layers` (non-square MVT worlds — see `UPSTREAM.md`)
  and promotes the range-capable dev file server to `server/utils/node/slide-fileserver.mjs`
  (`npm run fixtures:serve`).
* **`webtiff` reads JPEG/YCbCr whole-slide TIFFs.** Most brightfield `.svs` decoded to vertical
  striping and wrong hues: the vendored libtiff build read them with `JPEGCOLORMODE_RAW`, so the
  2x2-subsampled chroma planes came back as stored and were then indexed as full-resolution
  interleave. Fixed in web-tiff 0.1.0, which sets `JPEGCOLORMODE_RGB` and dispatches conversion on
  what the decode loop actually produced rather than on the file's tag. On the demo H&E slide a row
  of pixels went from `(255,121,255) (255,255,255) (255,121,255)` — alternating — to smooth
  `(213,114,194) (217,116,196) (220,119,199)`.
  `viz-flex-demo` composed two TIFF decoders to work around this; it is back to one.
* **Fixed** in `webtiff`: a three-sample colour TIFF reported `channelCount: 3` while its
  packer filled the fourth lane with opaque `padAlpha`. The renderer bounds channel reads by that
  count, so the implicit `identity` layer sampled `vec4(r, g, b, 0.0)` and every such slide
  rendered fully transparent. web-tiff 0.1.0 declares what it presents (four lanes for an
  image-mode read), so the xOpat-side `presentedChannelCount` correction is gone.
* **The vendored web-tiff bundle carries a version.** `dist/web-tiff.mjs` exports `VERSION`
  (0.1.0), so which copy is loaded is checkable at runtime instead of by diffing the `.wasm`.
  Both `web-tiff` entries in `UPSTREAM.md` are closed.
* **Fixed** dead MVT wiring in `modules/rationai-wsi-tile-source`, which resolved
  `OpenSeadragon.FlexRenderer.MVT.AbstractTileSource` — a namespace that does not exist — and so
  always took its error branch.


### 3.1.0

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
