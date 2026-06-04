# xOpat LLM Coding Guidelines

This document is the cross-tool source of truth for LLM assistants (Claude, Codex, Cursor, Aider, Jules, Gemini, Copilot, etc.) and human developers working in xOpat. It is loaded from the **repository root** and applies to the entire repository — `src/`, `plugins/`, `modules/`, `ui/`, `server/`, `test/`, everything.

If you only have time to read one section, read [§0](#0-must-not-skip-rules).

---

## 0. Must-not-skip rules

These rules override defaults from your training. **Read them before you write any code.**

1. **Reuse before you build.** Before designing UI, search `ui/classes/components/` and `ui/services/` for an existing component or singleton that fits. Only if none fits, extend `BaseComponent` (`ui/classes/baseComponent.mjs`) with Van.js. **Never write raw DOM/jQuery for app-state UI.** *Why:* xOpat's UI is a Van.js + DaisyUI ecosystem; ad-hoc components diverge visually, leak z-index, and bypass `AppBar.Chrome` hide-UI enrolment.
2. **Treat all input as hostile.** No `innerHTML`/`outerHTML` with concatenated strings. No native `fetch`/`XMLHttpRequest`. No `eval`/`Function(...)` on user-supplied strings. No template-string SQL or shell construction. Gate anything risky behind `APPLICATION_CONTEXT.secureMode`. *Why:* xOpat handles potentially sensitive medical/pathology data; an XSS or SSRF here is a breach, not a bug.
3. **All upstream HTTP goes through `window.HttpClient`.** It injects JWT/CSRF and resolves proxied paths. *Why:* native `fetch` bypasses auth, proxy aliases, and secureMode policy.
4. **Never use `window.VIEWER` for plugin domain logic.** Derive the viewer from the event source (`e.eventSource`) or a `VIEWER_MANAGER` lookup. *Why:* xOpat runs multi-viewport grids; `window.VIEWER` is whichever is focused right now, often the wrong one.
5. **No direct ES6 imports across `plugins/` ↔ `modules/` ↔ `src/`.** Use globals (`USER_INTERFACE`, `VIEWER_MANAGER`, `UTILITIES`) and `plugin('id')` / `singletonModule('id')` / `viewerSingletonModule(...)`. *Why:* the loader composes plugins/modules dynamically; cross-boundary imports break dynamic loading and create hidden coupling.
6. **Don't edit `src/libs/*` or minified/untracked files.** If a vendored library needs changes, ask the user to re-vendor. *Why:* these get overwritten on next library bump.
7. **Prefer fixing libraries upstream over xOpat-side patches.** xOpat is the broker, not the patch surface. *Why:* monkey-patches turn into permanent technical debt and obscure root causes.

---

## 1. General Code Style and Practices

- **Strict Separation of Concerns**: xOpat extensively uses logical domains divided into core application components (`src/`), plugins (`plugins/`), and modules (`modules/`).
- **No Direct Imports Across Boundaries**: You cannot use ES6 `import` to bring in functionality from other plugins, modules, or the core application directly. Instead, communication happens via **global variables and the CORE API** exposed through `loader.js` and system initialization:
    - `window.VIEWER_MANAGER` (manager for OSD viewers)
    - `window.USER_INTERFACE` (core generic UI operations)
    - `window.UTILITIES` (system utilities)
    - Modules and Plugins instances: accessible via `window.xmodule.<name>` and `window.xplugin.<name>`, or safer by using `plugin('id')` and `singletonModule('id')` and `viewerSingletonModule('className', 'viewerLikeRef')` if possible.
- **CSS / Styling**: Rely heavily on **DaisyUI + TailwindCSS**. Do not write custom CSS unless absolutely necessary. Do not use Tailwind's dark mode selectors directly; the application relies on DaisyUI's data-theme mechanism. Deprecate the usage of old `Primer CSS` or direct Bootstrap where possible.
- **Icons**: Phosphor Icons (Light) is the target icon font; Font Awesome is legacy but still loaded for coverage. For new code, use `UI.PhIcon` or raw `<i class="ph-light ph-<name>"></i>` markup (names in `src/libs/phoshor-icons/style.css`). Existing `fa-*` markup keeps working; entries in `src/libs/phoshor-icons/fa-overrides.css` transparently swap selected `fa-*` classes to Phosphor glyphs, with unmapped classes falling back to Font Awesome. When you add a new icon to that file, look the codepoint up in `src/libs/phoshor-icons/style.css` and group it with related rules.

> Keep best programming practices in mind — separate responsibilities, design clean interfaces, and avoid unnecessary coupling.
> Avoid underperforming code and excessive dependencies. Do NOT guess at APIs or features — ask for clarification,
> or for more code examples from the codebase if you cannot retrieve it yourself. Always ensure
> documentation is up-to-date and clear. Especially note if this 'xOpat LLM Coding Guidelines'
> document needs to be updated due to some changes in the codebase. Prefer TypeScript over JavaScript;
> however, note the loosely coupled nature of the codebase. Try to improve API if necessary, not monkey-patch
> or touch private methods. Keep clean separation of responsibilities.

Do not edit minified files or files that are ignored by git or otherwise not tracked. If you need to make changes, notify the user to take over the changes.

Try to avoid patches in general and prefer clean rewrites and API improvements. Instead of hardcoding conditional scenarios, strive for generic and reusable solutions. Prefer coupling similar low-level details together — for example, avoid shader-level specifics outside the flex-renderer, as shader types can change and the specific helpers should be encapsulated in the shader-renderer. Apply this approach across the codebase.

## 2. Modules, Plugins, and Packages

### Architecture
- **Plugins (`plugins/`)**: Deliver user-facing features, tools, or integrations with clear UI components.
- **Modules (`modules/`)**: Shared libraries and hidden logical extensions (e.g., annotations mapping, webgl logic).
- **Packages**: Modules and Plugins can leverage NPM and custom build logics, for example for typescript. They must have a `package.json` and a `build` sequence.
  The build must produce an `index.workspace.js` file (via `esbuild` or custom bundlers), which is the unified bundle that xOpat will load dynamically.
  Alernatively, this file can be present as the module main file and the build can be skipped.

#### Typescript and dependencies
Modules, plugins and core are loosely coupled. No direct import between them can happen. Types need to be available as ambient declarations for global IDE validation. APIs must be exported globally to be accessible from the core, or rely on automatic exposal through the `addModule` or `addPlugin` calls. Reuse functionality from other modules or plugins by requesting hard dependencies via `include.json`, or by using the loader API to listen for conditional availability of a module or plugin (integrate if available, otherwise skip).

### Structure & `include.json`
Every plugin and module requires an `include.json` containing metadata (like `id`, `name`, `description`).
- Modules declare dependencies on other modules using the `requires` array.
- Plugins declare external dependencies via the `includes` array or `modules` array.

### Viewer Core
Has supportive features. Use them for good integration.
- `src/classes/scripting` Scripting API with safety checks. Used for example for LLM tight integration. **Always route user-supplied script execution through this — never `eval`/`Function`.**
- `src/classes/history.ts` The viewer history stack. Reasonable actions should support undo/redo.
- `src/classes/user.ts` & `src/classes/http-client.ts` User authentication and request management. Rely on contextualized auth scopes where necessary.
- `src/loader.ts` The core application loader. It loads all modules and plugins, and defines the viewer manager.
- `src/store.ts` Pluggable storage middleware.
- `src/classes/session` Live-collaboration singleton (`window.SESSION`). Sync cursor/viewport/visualization by default; modules opt in by calling `window.SESSION.registerProvider({...})` and declaring `"sessionCompatible": "provider" | true | false` in their `include.json`. See `src/SESSION.md`.

Do not change files in `src/libs/` — these are vendored libraries. If a change is needed, notify the user to update upstream and re-vendor.

## 3. The `XOpatElement` API (Plugins and Modules)

Always extend `XOpatPlugin`, `XOpatModule`, or `XOpatModuleSingleton` when creating new system features.

### Core Lifecycle & Setup
- **`constructor`**: Accepts the instance ID. Call `super(id)`. Do not interact with the DOM or heavy global APIs here, as the system is still spinning up. However, constructors *must* attach handlers to events that fire early such as `before-app-init`.
- **`pluginReady()` / Events**: Override this or listen to `plugin-loaded` events to bootstrap the UI and attach your logics to the `USER_INTERFACE` or `VIEWER_MANAGER`.
- **Metadata and Configs**:
    - `getStaticMeta(key)`: read fields from `include.json`.
    - `setOption(key, value)` / `getOption(key)`: manage dynamic configuration and user options. It saves these to the exported visualizer session.

### Save & Load Data (IO)
Inherit the system IO sink design — see `src/IO_PIPELINE.md` for the full spec. Do **not** open ad-hoc backend fetches to persist state.

Quick reference:
- Declare capabilities in `include.json` `io.capabilities` (e.g. `bundle-export`, `crud:annotation`, custom `kv:<namespace>`).
- In your constructor or `pluginReady`, `await this.initIO({ exportBundle, importBundle, bundleScope })`. Use `bundleScope: "per-viewer"` for viewer-scoped state, `"per-viewer-background"` for slide-aware state (pipeline keys by `(viewerId, backgroundId)` and `viewer-open-pipeline` auto-flushes on slide-out / restores on slide-in).
- Per-element CRUD: `this.r = this.defineResource({ name, validate, serialize, deserialize })`. Calls dispatch through guards. Pass `{ apply: () => commitLocally() }` to `create/update/delete` so guards run *before* your local commit.
- Streamed query: `for await (const item of r.query(params, { signal }))`.
- Per-element KV storage: `this.cache` (sync, `kv:cache`), `this.cookies` (sync, `kv:cookies`), `this.data` (async, `kv:data`). Custom namespaces via `IO_PIPELINE.kv(this.uid, "kv:<ns>")`.
- Admins bind capabilities to sinks/drivers in `ENV.client.io.bindings`. Sink-providing modules register at runtime via `IO_PIPELINE.registerSink(...)`.

### User roles & capabilities
Client-side UI gating only — real authorization belongs in the embedding backend. Plugins declare `capabilities[]` in their `include.json`; IO-mediated actions auto-derive matching gates from `io.capabilities[]` (with a `pre-create/update/delete` guard mounted on the IO pipeline). Roles + grants/denies live in `core.roles` in env config. Code uses `this.can('cap.id')` or `this.onCapabilityChange('cap.id', fn)`; the user singleton exposes `XOpatUser.instance().assignRoles(...)` for rights-resolver plugins. See `src/USER_ROLES.md` for the full model.

### Translation
- Built-in localization support uses `this.loadLocale(locale, data)`.
- To use translations dynamically, use `$.t('translation_key')`.

## 4. HTTP and RPC (`HttpClient`)

**NEVER use native `fetch` or `XMLHttpRequest` when communicating with upstream APIs, especially LLMs or secured endpoints.**

Use `window.HttpClient`. It tightly integrates with the user authentication system (`xOpatUser`), meaning it will automatically inject JWT tokens, CSRF tokens, and resolve proxied paths securely.

```javascript
// Example of HttpClient usage
const client = new HttpClient({
  proxy: "cerit",            // alias defined in server config
  baseURL: "/api/v1",
  auth: {
    contextId: "core",       // specific auth context if required
    types: ["jwt"],          // required auth verifiers
    required: true
  }
});

const response = await client.request("data", { method: "POST", body: { object: 'goes here' } });
```

## 5. UI and Custom Component System

xOpat uses **Van.js** as the underlying reactive primitive, abstracted by **`BaseComponent`** (`ui/classes/baseComponent.mjs`). Styling is **DaisyUI + TailwindCSS** on top of DaisyUI's `data-theme` mechanism.

### Build priority chain — follow in order

LLMs (and humans) often skip steps 1–2 and jump to step 3 or worse. Don't.

1. **Reuse an existing component** in `ui/classes/components/`. Catalogue (non-exhaustive):
   - Dialogs / modals: `Modal`, `IllustratedModal`, `LoginModal`, `TutorialsModal`, `ProgressDialog`
   - Notifications: `Toast`, `StatusBar`, `GlobalTooltip`
   - Windows / panels: `FloatingWindow`, `DockableWindow`, `MainLayout`, `MainPanel`, `RightSideViewerMenu`, `NavigatorSideMenu`, `ShaderSideMenu`, `ShaderLayer`
   - Menus / tabs: `Menu`, `MenuTab`, `MenuTabBanner`, `MultiPanelMenu`, `MultiPanelMenuTab`, `TabsMenu`, `Explorer`
   - Fullscreen: `FullscreenMenu`, `FullscreenMenuModal`, `FullscreenMenuPanel`, `FullscreenMenuNavTab`
   - Toolbar family: `Toolbar`, `ToolbarGroup`, `ToolbarItem`, `ToolbarChoiceGroup`, `ToolbarPanelButton`, `ToolbarSeparator`
   - Inputs / pickers: `TagSelect`, `ContextMenu`
   - Roles: `UserRolesPanel`
2. **Reuse a UI service singleton** in `ui/services/`. **Never spawn duplicates.**
   - `AppBar` — mount plugin menus via `AppBar.Edit`, `AppBar.Plugins`, etc.
   - `AppBar.Chrome` — opt-in registry behind the top-bar "hide UI" button. Components register a `VisibilityManager` (or `{is, on, off}` / `{is, set}` duck) via `AppBar.Chrome.register(id, vm)`; everything routed through `AppBar.View.append()` / `View.registerViewComponent()` is enrolled automatically. Floaters outside the View system must call `register` on creation and `unregister` on teardown. Unrelated to `FullscreenMenus`.
   - `FloatingManager` — z-index management for floating panels.
   - `FullscreenMenus` — for capturing the whole viewing portal.
   - `GlobalTooltip` — global tooltip emitter.
   - `MobileBottomBar` — mobile layout slot.
3. **Extend `BaseComponent` with Van.js.** Constructor defines defaults; override `create()` to return exactly one HTML Node; use `this.classMap` and `this.setClass(key, value)` for reactive styling without re-rendering the whole tree. Mount via `myComp.attachTo(document.getElementById('workspace'))`.
4. **Raw Van.js** only when `BaseComponent` is genuinely the wrong abstraction (rare — usually means you're writing infrastructure, not a feature).
5. **Raw DOM / jQuery for app-state UI is forbidden.** jQuery is retained for legacy interop only — do not introduce it in new code.

### Forbidden patterns

- Direct HTML string templates for reactive parts.
- `$.appendTo`/`innerHTML +=` for app-state mechanics.
- Custom CSS files unless absolutely necessary — use DaisyUI + Tailwind utilities.
- Tailwind dark-mode selectors directly (the app uses DaisyUI `data-theme`).

### Deep-dive references
`ui/README.md` (design system) · `ui/classes/README.md` (`BaseComponent` + Van.js) · `ui/services/README.md` (singletons).

## 6. Multi-Viewport & Viewer Manager

**CRITICAL RULE: DO NOT USE `window.VIEWER` FOR PLUGIN DOMAIN LOGIC.**

`window.VIEWER` points to the currently active/focused OpenSeadragon instance. xOpat supports arbitrary multiple grid-viewports parsing different slides simultaneously. If a user interacts with Viewport B while Viewport A is focused, `window.VIEWER` is wrong.

### The right approach
- Subscribe to specific global viewer events and derive the caller viewer from the event source:
  ```javascript
  VIEWER_MANAGER.broadcastHandler("open", async (e) => {
      const viewer = e.eventSource; // This is the instance you should query
      const meta = viewer?.scalebar?.getReferencedTiledImage()?.source?.getMetadata();
      // ...
  });
  ```
- Use `XOpatViewerSingleton` or manage an internal map of viewers to your local controller representations.
- Use APIs like `module.getFabric(viewer)` instead of generic `module.fabric` to prevent bleeding context.

See `src/MULTI_VIEWPORTS.md` for the full design.

---

## 7. Security

Security is paramount. xOpat is meant to work with sensitive medical/pathology data; an XSS, CSRF, or SSRF here is a breach, not a bug. Assume every input is hostile until proven otherwise.

### Threat model

- **Untrusted inputs** include URL params, session bundles imported from peers, user-provided scripts, third-party tile-server responses, postMessage payloads, and anything coming back from a proxied upstream.
- **Trusted boundary** is the embedding backend's authorization layer. The client only does UI gating; never assume the client can refuse an action a malicious user has authorized at the API.

### Always do

- **HttpClient for all upstream calls.** It applies JWT/CSRF injection, proxy resolution, and secureMode policy.
- **Validate on the deserialization side.** When implementing `defineResource({ deserialize })` or `importBundle`, treat the payload as adversarial — schema-check, range-check, and reject unknown fields rather than silently passing them through.
- **Gate dangerous-by-default features behind `APPLICATION_CONTEXT.secureMode`.** If a feature legitimately needs to be less safe (e.g. allow remote tile sources, allow scripting), require an explicit secureMode opt-out.
- **Use the capability system for UI gating.** `this.can('cap.id')` for synchronous checks; `this.onCapabilityChange('cap.id', fn)` for reactive UI. Backend still enforces.
- **Degrade closed.** When unsure whether a path is safe, refuse to render / fetch / persist rather than trust the input.

### Never do

- **No `innerHTML` / `outerHTML` / `insertAdjacentHTML` with concatenated strings.** Use `textContent`, or Van.js / `BaseComponent` rendering (which escapes by default). If you genuinely need HTML insertion, sanitize with a vetted sanitizer and document why.
- **No native `fetch` or `XMLHttpRequest` to external endpoints.** Bypasses auth, proxy aliases, and secureMode.
- **No `eval` / `new Function(...)` on user-supplied strings.** Route through `src/classes/scripting` which applies safety checks.
- **No template-string SQL or shell-command construction** in server code (`server/`, `index.js`). Parameterize, always.
- **No trust in URL origins.** Validate origins before navigating, fetching, posting messages, or rendering linked content.
- **No PII / tokens / session keys** in `console.log`, `localStorage`, or URL parameters.
- **No third-party scripts** loaded without integrity (SRI) or a hard same-origin allowlist.

### When you change something security-relevant

Update `xss_report*.txt` if your change affects the reports' subject matter, and call it out in the PR/commit so review attention focuses correctly.

---

## 8. Known Pitfalls & Project Conventions

Lessons learned the hard way across past sessions. Each rule includes the *why* so you can judge edge cases.

### Lifecycle / module wiring

- **Eager-init singletons via `addModule(id, Class, true)`.** Calling `Class.instance()` before `addModule(id, Class)` throws `"no id given"` because `$id` is assigned inside `addModule`. If another module's constructor calls your `instance()`, register eagerly with the third argument.
- **Key per-source state by `tiledImage.source.tileSourceId`, not `source.url`.** DICOMweb shares `baseUrl` across slides; URL keys collide silently and you'll see one slide's state leak onto another.
- **`BackgroundConfig` snapshots `_rawValue` at construction.** Mid-flight mutations of `config.data[i]` do **not** propagate. Put custom tile sources on `background.dataReference`, never on `evt.data` after the fact.

### Build / dev loop

- **Shipped Tailwind is purged.** `src/libs/tailwind.min.css` is the production-purged build — many `md:` / `lg:` responsive variants and arbitrary classes are missing. Plugin UI must stick to compiled utilities, inline styles, or trigger a Tailwind recompile if a new class is needed.
- **`npm run dev` watches client assets only.** Backend changes (`server/`, `index.js`, etc.) require a manual `node index.js` restart.

### UI patterns

- **Canvas right-click goes through `CanvasContextMenu` providers.** Register a provider; never call `DropDown.open` directly from `nonprimary-release-not-handled`.
- **Hot-path Fabric integration: patch the prototype.** For high-frequency events (every render, every object touch), monkey-patch `fabric.Canvas` / `fabric.Object` prototype methods rather than wiring `canvas.on(...)` listeners — events are an order of magnitude slower on the hot path.

### Library vs. application split

- **Library fixes belong in the library.** Prefer fixing flex-renderer / fabric / OSD upstream over xOpat-side patches. xOpat is the broker, not the patch surface — adapter / facade improvements are fine; monkey-patching library internals from xOpat is not.
- **Time-series shader source resolver: xOpat broker owns swap/append policy.** The library no longer unilaterally appends; if you find yourself reaching into the renderer to decide swap-vs-append, push that decision back to the broker.

---

## 9. Useful Deep-Dive References

For a specific and more detailed understanding of each subsystem, read the following repository READMEs:

- **Root & Architecture**:
    - [`src/README.md`](src/README.md) (General App Config and Init logic)
    - [`src/NPM_MODULES_PLUGINS.md`](src/NPM_MODULES_PLUGINS.md) (Node Package integrations)
- **Plugin & Module Design**:
    - [`plugins/README.md`](plugins/README.md)
    - [`modules/README.md`](modules/README.md)
- **Core APIs & Communication**:
    - [`src/EVENTS.md`](src/EVENTS.md) (Lifecycle events and system broadcasts)
    - [`src/HTTP_CLIENT.md`](src/HTTP_CLIENT.md) (HttpClient, Token Verifiers, and Upstream Proxy integrations)
    - [`src/IO_PIPELINE.md`](src/IO_PIPELINE.md) (Generic IO/persistence pipeline: capabilities, sinks, bindings)
    - [`src/SESSION.md`](src/SESSION.md) (Live-collaboration `window.SESSION` providers)
    - [`src/USER_ROLES.md`](src/USER_ROLES.md) (Roles, capabilities, and rights-resolver plugins)
- **UI Architecture**:
    - [`ui/README.md`](ui/README.md) (Design system setup)
    - [`ui/classes/README.md`](ui/classes/README.md) (Developing via Van.js and `BaseComponent`)
    - [`ui/services/README.md`](ui/services/README.md) (Singletons controlling layout regions like `AppBar`)
- **Advanced State Management**:
    - [`src/MULTI_VIEWPORTS.md`](src/MULTI_VIEWPORTS.md) (How to design plugins not to break when multi-view instances are running)
