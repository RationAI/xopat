# XOpat — OpenSeadragon-based histology data visualizer

xOpat is a JavaScript application. Two reference backends ship in the repo and either may serve it:

- **`server/node/`** — canonical Node.js backend (see `server/node/README.md`). Started with `npm run s-node` (production) or `npm run dev` (`server/utils/node/dev-mode.js`).
- **`server/php/`** — legacy PHP backend (entrypoint `server/php/index.php` → `server/php/init.php`).

Both backends inject the same runtime configuration into the browser and provide the proxy/auth/storage endpoints the client expects. A high-level integration story lives in [`../INTEGRATION.md`](../INTEGRATION.md); operational/deployment docs at <https://xopat.readthedocs.io>.

## Configuration

The viewer always boots from a single object (`XOpatRuntimeConfig`, see `src/types/app.d.ts`) carrying `params`, `data`, `background`, `visualizations`, `plugins`. The client resolves where that object comes from in this order — first hit wins (`src/parse-input.js:94–209`):

1. **POST body, field `visualization`** (legacy alias `visualisation` also accepted). Canonical delivery for non-trivial sessions; the field carries either a JSON object or a JSON-encoded string. The server advertises POST support via `XOpatServerConfig.supportsPost` (`src/types/config.d.ts:113`).
2. **URL hash `#<urlencoded-json>`** — parsed locally. If `supportsPost` is true the viewer transparently rewrites the navigation into a self-POST (hidden form at `parse-input.js:110–123`) so refreshes/shares stay POST-backed and the address bar is clean.
3. **`?visualization=<urlencoded-json>`** query parameter — same parser as the hash path.
4. **`?slides=id1,id2&masks=m1,m2`** shorthand — synthesizes one background per slide plus a `heatmap`-shader visualization per mask (`parse-input.js:131–174`). Convenient for quick links and CI tests.
5. **Storage fallback** — `localStorage["xoSessionCache"]` (or `sessionStorage["xoSessionCache"]`) restores the last successful session if it is < 30 minutes old. The restored config is marked `__fromLocalStorage: true` so plugins can detect it. Every successful boot writes the current session back to both storages, so an auth-redirect round-trip never loses state.

> A simple form that just POSTs a session JSON into the `visualization` field is available at **`/dev_setup`** on both backends (`server/node/index.js:438–473, 610–611`, `server/php/dev_setup.php`, template `server/templates/dev-setup.html`). Use it during development; in production the embedding application supplies POST data directly.

Plugins may layer additional opening behavior on top of this pipeline — check the relevant plugin README.

### Example session

```jsonc
{
  "params": {
    "sessionName": "Demo case 0042",
    "locale": "en"
  },
  "data": [
    {
      "dataID": "path/to/tissue/scan.tif",
      "microns": 0.001,
      "protocol": "dzi",
      "options": { "format": "jpeg" }
    },
    "path/to/annotation.tif",
    "path/to/probability.tif"
  ],
  "background": [
    { "dataReference": 0 }
  ],
  "visualizations": [
    {
      "name": "A visualization setup 1",
      "shaders": {
        "shader_id_1": {
          "name": "Advanced visualization layer",
          "type": "edge",
          "fixed": false,
          "visible": 1,
          "dataReferences": [2, 0],
          "params": {}
        },
        "another_shader_id": {
          "name": "Probability layer",
          "type": "edge",
          "visible": 1,
          "dataReferences": [1],
          "params": { "color": "#fa0058", "use_gamma": 1.0 }
        }
      }
    }
  ],
  "plugins": {
    "recorder": {}
  }
}
```

### `data` — `DataSpecification[]` (required)

Each entry is either a bare `DataID` (string/object the image server understands — most often a UUID4 or file path; objects are used by sources like DICOM) or a `DataOverride` (`src/types/app.d.ts:31–39`):

- **`dataID`** (required) — the underlying `DataID`.
- **`options`** — generic map forwarded to the TileSource (`SlideSourceOptions`, `src/types/app.d.ts:46–49`). Standard keys: `format`.
- **`microns`** / **`micronsX`** / **`micronsY`** — pixel size in micrometers.
- **`protocol`** — **name of a registered slide protocol** (see *Slide protocols* below). In non-secure mode a backtick-template string is accepted for back-compat, but is rejected with a warning in secure mode.
- **`imageSmoothingEnabled`** — when `false`, tiles for this data source are sampled with `gl.NEAREST` (blocky pixels at high zoom — useful for label maps or integer-coded segmentation layers). When `true` or unset (default), tiles use `gl.LINEAR`. Honored by drawers that implement `setTiledImageSmoothingEnabled` (currently FlexDrawer); silently ignored otherwise.
- **`tileSource`** — deprecated escape hatch for code-only consumers; not serializable.

### `params` — viewer setup (optional)

Aligned with `XOpatSetup` in `src/types/config.d.ts:53–87`. **`initXOpat` silently drops unknown keys** with a console warning (`src/app.ts:108–122`), so typos vanish quietly — verify names against the type.

| Key | Type | Default | Notes |
|---|---|---|---|
| `sessionName` | string | — | Unique session id; overridable by `background[i].sessionName`. |
| `locale` | string | `"en"` | i18next locale. |
| `theme` | `"auto" \| "light" \| "dark"` | `"auto"` | DaisyUI `data-theme`; `"auto"` follows the OS preference. (`"dark_dimmed"` / `"dimmed"` were never wired up in the v3 UI.) |
| `customBlending` | bool | `false` | Allow user-programmed blending. |
| `debugMode` | bool | `false` | Verbose runtime instrumentation. |
| `webglDebugMode` | bool | `false` | Debug post-processing. |
| `webGlPreferredVersion` | string | — | Select WebGL backend version. |
| `valueInspectorEnabled` | bool | `false` | Hover value inspector. |
| `visualizationInspectorEnabled` | bool | `false` | Pixel/lens inspector overlay. |
| `visualizationInspectorMode` | string | — | Inspector mode (paired with `UTILITIES.setVisualizationInspectorMode`). |
| `visualizationInspectorRadiusPx` | number | — | Inspector radius. |
| `visualizationInspectorLensZoom` | number | — | Lens zoom factor. |
| `activeBackgroundIndex` | number \| number[] | `0` | Initial bg index; array for multi-view. |
| `viewport` | `ViewportSetup \| ViewportSetup[]` | — | `{ point, zoomLevel, rotation? }`; single value applies to all viewers or one per viewer in multi-view. |
| `preventNavigationShortcuts` | bool | `false` | Disable xOpat navigation bindings (OSD defaults still apply). |
| `scrollRequiresCtrl` | bool | `false` | Require `Ctrl/Cmd + wheel` to zoom; plain wheel scrolls the host page. Use for notebook / scrollable-host embeddings. A throttled toast nudges first-time users toward the modifier. |
| `scaleBar` | bool | `true` | **Deprecated**, use `ui.scaleBar`. Requires microns to render. |
| `toolBar` | bool | — | **Deprecated**, use `ui.toolBar`. |
| `statusBar` | bool | — | **Deprecated**, use `ui.statusBar`. |
| `ui` | `XOpatUiSetup` | — | Initial visibility of UI components — see table below. |
| `disablePluginsUi` | bool | `false` | Hide plugin UI without unloading the plugins. |
| `disablePluginsAutoload` | bool | `false` | Skip the `_plugins` cookie restore for this session. `permaLoad` plugins and plugins listed in `config.plugins` still load. Use to ignore the user's prior manual picks while respecting deployment defaults and session-declared plugins. |
| `grayscale` | bool | `false` | Force grayscale transfer. |
| `tileCache` | bool | `true` | Enable tile caching. |
| `maxImageCacheCount` | number | `1200` | Tile cache size. |
| `preferredFormat` | string | — | Hint to the protocol; must be honored by the TileSource. |
| `background` | string | — | Hex `#RGB`/`#RGBA` clear color (e.g. fluorescence). Transparent if unset. |
| `permaLoadPlugins` | bool | `true` | Remember loaded plugins across sessions. |
| `bypassCookies` | bool | `false` | Skip cookie-backed user state. |
| `bypassCache` | bool | `false` | Never reuse cached values. |
| `bypassCacheLoadTime` | bool | `false` | Ignore cache at initial load only — avoids pulling cached content from a foreign session. |
| `historySize` | number | — | Cap on the history stack (`src/classes/history.ts`). |
| `isStaticPreview` | bool | `false` | Disable interactive controls for thumbnail/preview embeds. |
| `maxMobileWidthPx` | number | — | Responsive breakpoint. |

#### `params.ui` — UI initial visibility

Each flag is the *initial* visible state at boot. `false` boots the component
collapsed, but the user can still bring it back via the settings menu, the
hide-UI button, or the relevant opener. Defaults to `true` for every key.
Reads go through `APPLICATION_CONTEXT.getUiOption(key)` which also honors the
legacy flat aliases (`scaleBar` / `toolBar` / `statusBar`) and the AppCache
of user-toggled settings — see `XOpatUiSetup` in `src/types/config.d.ts`.

Shorthand: set `params.ui: false` (or `setup.ui: false` for a deployment-wide
default) to hide every global UI component in one shot — handy for notebook
embeddings. `params.ui: true` is equivalent to leaving the field unset.

| Key | Affects |
|---|---|
| `scaleBar` | Per-viewer OSD scalebar overlay. Replaces legacy flat `scaleBar`. |
| `toolBar` | Top viewer toolbar. Replaces legacy flat `toolBar`. |
| `statusBar` | Bottom status bar (`#viewer-status-bar`). Replaces legacy flat `statusBar`. |
| `mainMenu` | Global menu (`FullscreenMenus`). `false` boots collapsed; menu-open buttons still work. |
| `navigator` | Per-viewer OSD navigator panel. |
| `appBar` | Top AppBar chrome — `false` is equivalent to the hide-UI button being pre-toggled. |
| `globalMenu` | Global right-side dock (`window.LAYOUT`) that hosts plugin tabs (chats, slide-switcher, questionnaire, …). `false` boots the dock closed; user opens/plugins focus still work. |

### `background` — `BackgroundItem[]`

Each item is an image group rendered as one OSD layer (`src/types/app.d.ts:76–90`):

- **`dataReference`** (required) — index into `data`, or an inline `DataID` / `DataOverride`. *One* reference per background entry.
- **`shaders`** (optional) — shader configuration array, same shape as visualization shaders (`dataReferences` becomes optional). When unset, the renderer synthesizes an implicit `identity` shader keyed under the background's `id`. As soon as any entry is set, the implicit identity is replaced. `canonical-scene.ts` materializes the implicit entry as `[{ type: "identity", … }]` when a tool edits it, so the change persists across reopens.
- **`id`** — unique id; derived from the data path if unset.
- **`name`** — tissue name shown in the UI.
- **`sessionName`** — overrides `params.sessionName` for this background.
- **`visualizationIndex`** — index into `visualizations` selected when this background is mounted. Authoritative per-viewer viz binding — the slot's viz follows the bg entry through slot reordering / insertion / deletion. Pass `null` for "no overlay". Legacy `goalIndex` is still accepted on read (folded with a one-time warning).
- **`options`** — forwarded to the TileSource.

> Legacy fields `lossless`, `protocol`, `microns`, `micronsX`, `micronsY` are still accepted at the background level for back-compat, but new code should put them on the `DataOverride` instead.

### `visualizations` — `VisualizationItem[]`

WebGL composition goals over the data group (`src/types/app.d.ts:109–116`):

- **`shaders`** (required) — map of shader id → layer spec:
    - **`type`** (required) — `color`, `edge`, `dual-color`, `identity`, `heatmap`, `none`, or any custom-registered shader.
    - **`dataReferences`** (required) — index array into `data`.
    - **`visible`** — `1`/`0` or boolean.
    - **`name`** — UI label.
    - **`fixed`** — if `false`, user can change the shader type; default `true`.
    - **`params`** — shader-specific defaults; invalid entries fall back silently.
- **`name`** — goal label.
- **`goalIndex`** — preferred index when this item is selected.

> Legacy `lossless` and `protocol` are accepted at the visualization level for back-compat — prefer `DataOverride`.

### `plugins`

Plugin-id → plugin-config map; consult each plugin's README.

<details>
<summary>Advanced features</summary>

**Internal parameters.** The runtime augments visualization items at runtime with fields that show up in serialized sessions:

- `order` — shader-id array on a visualization goal; sets render order. All referenced data with `visible=1` must be present and valid.
- `cache` — per-shader, shader-type-dependent value bag (equivalent to default-value overrides). Type-sensitive: writing a wrong-type value will break rendering.

**Slide protocols.** A protocol is a named entry in `ENV.client.slide_protocols` (see `src/types/config.d.ts:5–28`, registry implementation at `src/classes/slide-protocols.ts`). Each entry is either:

- a URL template string with `data` in scope (non-secure mode only — rejected in secure mode), or
- an object `{ url, proxy?, baseURL?, auth?, … }` whose extra fields are forwarded verbatim to `new HttpClient(...)`, so every metadata + tile request the resulting TileSource issues inherits proxy routing, CSRF tokens, and JWT/auth headers uniformly.

`DataOverride.protocol` (and legacy `BackgroundItem.protocol` / `VisualizationItem.protocol`) reference an entry **by name** (`"dzi"`, `"dicomweb"`, …). Defaults come from `default_background_protocol` / `default_visualization_protocol`; the legacy `image_group_*` / `data_group_*` env keys are auto-migrated into synthesized `__legacy_bg` / `__legacy_viz` entries. Plugins register protocols at runtime via `window.SLIDE_PROTOCOLS.register({ id, createTileSource })`.

Use this registry instead of hand-rolling URLs in `background.protocol`/`visualizations.protocol` — those evaluations are blocked in secure mode and lose proxy/auth integration.

</details>

## Structure

Each folder ships a `README` with more detail. The most up-to-date ones are this file, [`../plugins/README.md`](../plugins/README.md), and [`../modules/README.md`](../modules/README.md).

### `../` (repo root)

- `index.html` and the `server/` tree (Node + PHP entrypoints).
- `package.json` — `s-node`, `s-node-test`, `dev`, `docker-node`, `docker-php`.

### `./` (`src/`)

- `app.ts` — `initXOpat(...)` entrypoint; builds `APPLICATION_CONTEXT`, `VIEWER_MANAGER`, `SESSION`, `IO_PIPELINE`.
- `loader.ts` — module/plugin loader and the global helpers `plugin(id)`, `singletonModule(id)`, `viewerSingletonModule(className, viewerLike)`.
- `parse-input.js` — the precedence chain described in *Configuration* above.
- `store.ts` — pluggable storage middleware (KV drivers used by the IO pipeline).
- `tile-source.ts` — common TileSource scaffolding.
- `classes/`
    - `app/` — viewer-open pipeline and canonical-scene round-trip (`viewer-open-pipeline.ts`, `canonical-scene.ts`, `application-lifecycle-controller.ts`, `viewer-inspector-controller.ts`).
    - `io/` — IO pipeline implementation (see [`IO_PIPELINE.md`](IO_PIPELINE.md)).
    - `session/` — live-collaboration controller (see [`SESSION.md`](SESSION.md)).
    - `scripting/` + `scripting-manager.ts` — sandboxed scripting API.
    - `slide-protocols.ts` — `SLIDE_PROTOCOLS` registry.
    - `http-client.ts` — `HttpClient` (see [`HTTP_CLIENT.md`](HTTP_CLIENT.md)).
    - `history.ts`, `user.ts`.
- `external/` — always-loaded third-party libraries and OSD extensions (DZI ext tile source, scalebar, autocomplete, …).
- `libs/` — vendored libraries: jQuery, i18next, OpenSeadragon (`openseadragon.js`), Tailwind CSS, Monaco, FontAwesome, Phosphor Icons (`phoshor-icons/`), plus `flex-renderer/` (WebGL renderer). **Do not edit `libs/`** — upstream-only. Exception: `phoshor-icons/fa-overrides.css` is xOpat-owned and *should* be edited to extend the Font Awesome → Phosphor mapping as we migrate.
- `assets/` — `style.css`, icons, and other static assets.
- `types/` — ambient TypeScript declarations (`app.d.ts`, `config.d.ts`, `globals.d.ts`, `slide-protocols.d.ts`, `io.d.ts`).

OpenSeadragon (v6+) is bundled under `src/libs/openseadragon.js` and configured via `openSeadragonPrefix` / `openSeadragon` in `src/config.json`. To run a debug build, point those values at an unminified copy.

### `../plugins/`, `../modules/`

User-facing features and shared libraries respectively; both are dynamically loadable via the loader. See their READMEs.

## Available API

Make sure you've read [`../INTEGRATION.md`](../INTEGRATION.md) first.

### Globals

Established by `src/app.ts` and `src/loader.ts`. These are the supported, ambiently-typed entrypoints:

| Global | Where it's set | Purpose |
|---|---|---|
| `window.APPLICATION_CONTEXT` | `src/app.ts:159` | Session, config accessors, open pipeline. |
| `window.VIEWER_MANAGER` | `src/app.ts:224` | Manager for all OSD viewer instances (single- and multi-view). |
| `window.USER_INTERFACE` | UI layer | Core generic UI operations (notifications, menus). |
| `window.UTILITIES` | UI / inspector controllers | System utilities (inspector toggles, serializers). |
| `window.HttpClient` | `src/classes/http-client.ts:349` | Auth-aware HTTP client (proxy, JWT, CSRF). |
| `window.SESSION` | `src/app.ts:230` | Live-collaboration `SessionSyncController`. |
| `window.IO_PIPELINE` | `bootstrapIOPipeline()` in `src/app.ts:149` | Save/load pipeline; also reachable as `APPLICATION_CONTEXT.io`. |
| `window.SLIDE_PROTOCOLS` | `src/classes/slide-protocols.ts` | Slide-protocol registry. |
| `window.xmodules` | `src/loader.ts` | Object store of module exports. Use the helpers below — don't reach in directly. |
| `plugin(id)` | `src/loader.ts:298` | Returns the plugin instance. |
| `singletonModule(id)` | `src/loader.ts:313` | Returns (and lazily instantiates) the module singleton. |
| `viewerSingletonModule(className, viewerLike)` | `src/loader.ts:330` | Returns a per-viewer `XOpatViewerSingleton`. |

> `window.VIEWER` is **not** a stable handle — it tracks whichever viewer most recently took focus, which is the wrong instance whenever multi-view is active. Resolve the right viewer with `VIEWER_MANAGER.get(...)`, with `viewerSingletonModule(...)`, or from `e.eventSource` on broadcast events. See [`MULTI_VIEWPORTS.md`](MULTI_VIEWPORTS.md).

### Viewer Open API

The runtime opening pipeline is class-based and lives under `src/classes/app/`. The public entrypoints exposed to plugins/modules remain global through `window.APPLICATION_CONTEXT`.

- `APPLICATION_CONTEXT.openViewerWith(data?, background?, visualizations?, bgSpec?, vizSpec?, opts?)`
    - Main transaction entrypoint.
    - Can replace or merge session `data` / `background`.
    - Can create additional viewers when multiple backgrounds are targeted.
    - `vizSpec` arrays may contain explicit `undefined` entries to mean "no visualization for this viewer"; omitted `vizSpec` still means "keep the current selection".
    - Rebinds navigator title, scalebar reference, measurements, visualization menu, history, and synthetic open events.
- `APPLICATION_CONTEXT.updateViewerSelection(viewerIndex, { backgroundIndex?, visualizationIndex? }, opts?)`
    - Use when one existing viewer should switch background and/or visualization without rebuilding unrelated viewers.
    - Passing `visualizationIndex: null` clears the active visualization for that viewer.
    - Delegates to the same open pipeline, keeping history/session synchronization consistent.
- `APPLICATION_CONTEXT.replaceVisualizations(visualizations, newData?, activeVizIndex?)`
    - Replaces the session visualization list while preserving the rest of the session.
    - Preferred over the older `updateVisualization(...)` name.

Options are ambiently typed as `ViewerOpenOptions` and per-viewer patches as `ViewerSelectionPatch`, so plugins/modules use them without importing from core.

### Canonical Scene

`src/classes/app/canonical-scene.ts` is the single round-trip pair for full session state. Use it whenever you need to capture *what is currently rendered* and replay it later — playground Apply, session sync's heavy-apply path, scripting export/import, and draft persistence all go through it.

- `serializeScene()` — captures `cfg` (data, background, visualizations, active indices) and merges per-shader runtime cache/state from every viewer's renderer back into the structural shader entries. Returns a `CanonicalScene` JSON object.
- `serializeSceneFromViewer(viewer, init, live?)` — single-viewer slice, used by the playground page (passes its namespace-stripped `live` so renderer ids match the structural ids).
- `deserializeScene(scene, opts)` — calls `APPLICATION_CONTEXT.openViewerWith(...)` with the canonical cfg shape and forwards `historyMode` / `historyLabel`. The pipeline rebuilds renderers from the inlined cache — no second per-layer apply pass needed.
- `backgroundShaderRendererIds(bg)` / `visualizationShaderRendererIds(viz)` — single source of truth for renderer-id derivation. Bg shader ids follow `bgRef.id` for index 0 and `${bgRef.id}-N` for subsequent entries (mirrors `assemble-render-output.ts:149-150`); viz shader ids are the structural map keys.

Devtools handle: `window.__SCENE = { serialize, serializeFromViewer, deserialize, … }`. Inspect the round-trip from the console — e.g. `await __SCENE.deserialize(__SCENE.serialize(), { historyMode: "skip" })` should be a visual no-op.

**Implicit identity rule.** When `cfg.background[i].shaders` is unset, the renderer synthesizes an identity shader at `bg.id`. If a tool edits that implicit shader, the canonical-scene serializer materializes it as `[{ type: "identity", cache: {…} }]` so the change persists across reopens.

### Session Restore and Lifecycle

Session bootstrap and restore live in `ApplicationLifecycleController`.

- Startup restores the last successful session from browser storage when no explicit POST/hash/query session is provided (see *Configuration* above).
- `beginApplicationLifecycle(...)` loads required plugins, initializes layers, raises `before-app-init`, and then opens the requested viewer state.
- Inspector registration is centralized in `ViewerInspectorController` (no longer mixed into `app.ts`).

### IO Pipeline

`window.IO_PIPELINE` (also `APPLICATION_CONTEXT.io`) decouples *what* modules want to save/load from *where* it goes. Modules declare capabilities in their `include.json` (`io.capabilities`); admin config (`ENV.client.io.bindings`) binds those to concrete sinks. Plugin authors typically:

- Register bundle-level hooks via `this.initIO({ bundleScope, exportBundle, importBundle })`.
- Define per-element CRUD resources via `this.defineResource({ name, validate, serialize, deserialize })`.

The pipeline queues sink dispatch per-resource, supports coalescing, and persists its outbox to IndexedDB. Bundle sinks include `file-download`, `file-upload`, `post-data`, `http-rest`. See [`IO_PIPELINE.md`](IO_PIPELINE.md) for the full design.

### Session / Collaboration

`window.SESSION` is a `SessionSyncController` singleton enabling real-time peer-to-peer collaboration. Plugins/modules participate by calling `window.SESSION?.registerProvider({ id, scope, snapshot, applySnapshot, subscribe, applyDelta })`. The `sessionCompatible` flag in `include.json` declares participation: `"provider"` = actively syncs, `true` = safe but non-syncing, `false` = incompatible (undeclared plugins trigger a warnings modal). Hosts provision guest URLs via `UTILITIES.serializeApp(...)` so guests load the host's exact plugin set. Read `meta.role` in post-event handlers to avoid duplicate side effects on guests. See [`SESSION.md`](SESSION.md).

### HttpClient

**Never use native `fetch` or `XMLHttpRequest` for upstream calls** — `HttpClient` (`src/classes/http-client.ts`) integrates with `xOpatUser` and injects JWT, CSRF, and proxy paths automatically. See [`HTTP_CLIENT.md`](HTTP_CLIENT.md).

```ts
const client = new HttpClient({
  proxy: "cerit",           // alias defined in server proxies
  baseURL: "/api/v1",
  auth: { contextId: "core", types: ["jwt"], required: true },
  timeoutMs: 30000,         // optional, default 30s
  maxRetries: 3,            // optional, default 3
});

const response = await client.request("data", {
  method: "POST",
  body: { object: "goes here" },
  expect: "json",           // "json" | "text" | "auto"
  // query: { foo: "bar" },
});
```

### Inspector Utilities

Ambiently typed, part of the supported runtime surface:

- `UTILITIES.toggleVisualizationInspector(enabled?)`
- `UTILITIES.setVisualizationInspectorRadius(radiusPx)`
- `UTILITIES.adjustVisualizationInspectorRadius(deltaPx)`
- `UTILITIES.setVisualizationInspectorMode(mode)`
- `UTILITIES.toggleValueInspector(enabled?)`

### Scripting

`src/classes/scripting-manager.ts` + `src/classes/scripting/` is a Worker-based sandbox exposing scripting namespaces (`XOpatApplicationScriptApi`, `XOpatViewerScriptApi`, `XOpatVisualizationScriptApi`) to user/plugin scripts. Use it for advanced automation and LLM integration; not required for typical plugin development.

### UI

**Use the new UI components** — see [`../ui/README.md`](../ui/README.md) and [`../ui/classes/README.md`](../ui/classes/README.md). Extend `BaseComponent` and rely on Van.js reactivity instead of manual jQuery DOM work. The CORE UI singletons (`AppBar`, `FloatingManager`, `FullscreenMenus`, `GlobalTooltip`, …) are listed in [`../ui/services/README.md`](../ui/services/README.md).

Reuse the existing components before pulling new dependencies. If you need a DaisyUI element that isn't already wrapped, add it under `ui/classes/elements` so other plugins can reuse it.

### Localization

Driven by `i18next`. Use `$.t('translation_key')` at runtime; `$.i18n` holds the instance. Server-side `i18n` is available with limited capabilities. In spawned child windows, `$.t(...)` works but `jquery-i18next` is not bundled.

For plugin localization specifics, see the plugins README.

### Embedding the viewer in a custom server

The two reference backends are the documentation:

- **PHP** — `server/php/init.php` shows the canonical wiring. The helpers in `server/php/inc/core.php` (`require_libs`, `require_openseadragon`, `require_external`, `require_core`) and `server/php/inc/plugins.php` (`require_modules`, `require_plugins`) are still the building blocks for embedding xOpat into a PHP host. The browser-side entry is `initXOpat(PLUGINS, MODULES, ENV, POST_DATA, PLUGINS_FOLDER, MODULES_FOLDER, VERSION, I18NCONFIG?)` (`src/app.ts:44`).
- **Node** — `server/node/index.js` and [`server/node/README.md`](../server/node/README.md) cover the modern integration story: session-cookie CSRF, RPC for plugins/modules, dev-mode hot reload via `server/utils/node/dev-mode.js`.

## Further reading

- Lifecycle events: [`EVENTS.md`](EVENTS.md)
- HTTP / proxies / token verifiers: [`HTTP_CLIENT.md`](HTTP_CLIENT.md)
- IO pipeline (save/load): [`IO_PIPELINE.md`](IO_PIPELINE.md)
- Live collaboration: [`SESSION.md`](SESSION.md)
- Multi-viewport rules: [`MULTI_VIEWPORTS.md`](MULTI_VIEWPORTS.md)
- NPM-packaged modules/plugins: [`NPM_MODULES_PLUGINS.md`](NPM_MODULES_PLUGINS.md)
- Plugin development: [`../plugins/README.md`](../plugins/README.md)
- Module development: [`../modules/README.md`](../modules/README.md)
- UI design system: [`../ui/README.md`](../ui/README.md), [`../ui/classes/README.md`](../ui/classes/README.md), [`../ui/services/README.md`](../ui/services/README.md)
