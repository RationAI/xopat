# xOpat LLM Coding Guidelines

This document is the cross-tool source of truth for LLM assistants (Claude, Codex, Cursor, Aider, Jules, Gemini, Copilot, etc.) and human developers working in xOpat. It is loaded from the **repository root** and applies to the entire repository — `src/`, `plugins/`, `modules/`, `ui/`, `server/`, `test/`, everything.

If you only have time to read one section, read [§0](#0-must-not-skip-rules).

---

## 0. Must-not-skip rules

These rules override defaults from your training. **Read them before you write any code.**

1. **Reuse before you build.** Before designing UI, search `ui/classes/components/` and `ui/services/` for an existing component or singleton that fits. Only if none fits, extend `BaseComponent` (`ui/classes/baseComponent.mjs`) with Van.js. **Never write raw DOM for app-state UI.** *Why:* xOpat's UI is a Van.js + DaisyUI ecosystem; ad-hoc components diverge visually, leak z-index, and bypass `AppBar.Chrome` hide-UI enrolment.
2. **Treat all input as hostile.** No `innerHTML`/`outerHTML` with concatenated strings. No native `fetch`/`XMLHttpRequest`. No `eval`/`Function(...)` on user-supplied strings. No template-string SQL or shell construction. Gate anything risky behind `APPLICATION_CONTEXT.secureMode`. *Why:* xOpat handles potentially sensitive medical/pathology data; an XSS or SSRF here is a breach, not a bug.
3. **All upstream HTTP goes through `window.HttpClient`.** It injects JWT/CSRF and resolves proxied paths. *Why:* native `fetch` bypasses auth, proxy aliases, and secureMode policy.
4. **Never use `window.VIEWER` for plugin domain logic.** Derive the viewer from the event source (`e.eventSource`) or a `VIEWER_MANAGER` lookup. *Why:* xOpat runs multi-viewport grids; `window.VIEWER` is whichever is focused right now, often the wrong one.
5. **No direct ES6 imports across `plugins/` ↔ `modules/` ↔ `src/`.** Use globals (`USER_INTERFACE`, `VIEWER_MANAGER`, `UTILITIES`) and `plugin('id')` / `singletonModule('id')` / `viewerSingletonModule(...)`. *Why:* the loader composes plugins/modules dynamically; cross-boundary imports break dynamic loading and create hidden coupling.
6. **Don't edit `src/libs/*` or minified/untracked files.** If a vendored library needs changes, ask the user to re-vendor. *Why:* these get overwritten on next library bump.
7. **Prefer fixing libraries upstream over xOpat-side patches.** xOpat is the broker, not the patch surface. Record the request in [`UPSTREAM.md`](UPSTREAM.md) instead of editing `src/libs/*`. *Why:* monkey-patches turn into permanent technical debt and obscure root causes.
8. **Never hardcode user-facing language.** Every label, title, tooltip, placeholder, aria-label, and dialog/toast/error message goes through `$.t('key')` (JS) or `data-i18n="key"` (HTML), with the key defined in `src/locales/en.json`. Run `npm run i18n-audit` before finishing. *Why:* xOpat is multi-language; a hardcoded string is invisible to translators and ships as English to everyone. See [§3 Translation](#translation).

---

## 1. General Code Style and Practices

- **Strict Separation of Concerns**: xOpat extensively uses logical domains divided into core application components (`src/`), plugins (`plugins/`), and modules (`modules/`).
- **No Direct Imports Across Boundaries**: You cannot use ES6 `import` to bring in functionality from other plugins, modules, or the core application directly. Instead, communication happens via **global variables and the CORE API** exposed through `loader.js` and system initialization:
    - `window.VIEWER_MANAGER` (manager for OSD viewers)
    - `window.USER_INTERFACE` (core generic UI operations)
    - `window.UTILITIES` (system utilities)
    - Modules and Plugins instances: accessible via `window.xmodule.<name>` and `window.xplugin.<name>`, or safer by using `plugin('id')` and `singletonModule('id')` and `viewerSingletonModule('className', 'viewerLikeRef')` if possible.
- **CSS / Styling**: Rely heavily on **DaisyUI + TailwindCSS**. Do not write custom CSS unless absolutely necessary. Do not use Tailwind's dark mode selectors directly; the application relies on DaisyUI's data-theme mechanism. Deprecate the usage of old `Primer CSS` or direct Bootstrap where possible.
- **Icons**: Phosphor Icons (Light) is the **only** icon font xOpat ships. Use `UI.PhIcon` or raw `<i class="ph-light ph-<name>"></i>` markup; names live in `src/libs/phoshor-icons/style.css`. `UI.FAIcon` survives only as a deprecated alias that translates a handful of legacy names — never call it in new code, and never write a `fa-*` class.

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
- `stability` (`"stable"` default | `"experimental"` | `"deprecated"`) marks maturity declaratively. Never infer maturity from a directory name or id — set the field. It is presentation-only (Plugins Menu badge, docs catalogue badge), overridable per deployment via `ENV.plugins.<id>` / `ENV.modules.<id>`, and readable through `getStaticMeta("stability")` / `pluginMeta(id, "stability")`.
- **User-facing metadata is translatable — use it.** `name`, `description` and `longDescription` accept a `"%key%"` reference resolved against the element's own locale bundle (namespace = element id). Hardcoding English there is the same §0 rule-8 violation as hardcoding it in JS. `pluginMeta`/`moduleMeta`/`getStaticMeta` resolve the reference; `loadElementLocale(kind, id)` loads the bundle of an element that is not loaded yet, and `ensureElementMeta(kind, id)` returns that promise only when there is something to fetch. In a user-facing message never interpolate the raw record (`PLUGINS[id].name`) or even `pluginMeta(id, "name")` — use `elementName(kind, id)`, which falls back to the id instead of printing `%meta.name%` or `undefined`.
- Discovery/provenance keys: `categories` (first one groups the plugin list and the docs catalogue), `keywords` (search only), `homepage`/`repository`/`bugs`/`docsUrl` (absolute http(s) only — other schemes are dropped, never rendered), `license` (docs only).
- `engines: {"xopat": "<range>"}` gates loading against the app version — an out-of-range plugin/module is refused before it can wire itself in. Prerelease tags of the app version are ignored (`>=3.0.0` matches `3.0.0-beta.1`); a deployment reporting no usable version skips the check. Range logic lives in `src/classes/app/semver.ts` — do not add a semver dependency.
- `icon` is a Phosphor icon class (`ph-*`) **or** an image URL; both work in every icon slot via `componentIconNode` (`ui/classes/elements/ph-icon.mjs`). Markup strings are not supported.
- **Production baking conventions.** With `client.production`, the server inlines per-element assets into the served page — zero runtime fetches — but only for assets at convention paths: locales at `locales/<lang>.json` (namespace = element id), scripting declarations at `<element>/scripting/*.d.ts` or `<element>/*.scripts.d.ts` referenced via a `dtypesSource` URL under `APPLICATION_CONTEXT.url`. Follow these layouts for new elements; custom paths silently fall back to runtime fetches. See `modules/README.md`/`plugins/README.md` "Production Baking" and the server-side registry in `server/node/index.js` (`getBakedDtsRegistry`, mirrored in `server/php/init.php`).

### Viewer Core
Has supportive features. Use them for good integration.
- `src/classes/scripting` Scripting API with safety checks. Used for example for LLM tight integration. **Always route user-supplied script execution through this — never `eval`/`Function`.**
- `src/classes/history.ts` The viewer history stack. Reasonable actions should support undo/redo.
- `src/classes/app/shortcut-manager.ts` (`APPLICATION_CONTEXT.shortcuts`) Central keyboard-shortcut registry — register key strokes here (declared defaults, conflict enforcement, user remapping via the Keymap fullscreen-menu panel) instead of attaching raw `key-down`/`key-up` handlers. Contextual keys (Escape/Enter/Delete in widgets and inputs) stay widget-local and are NOT registered. See `src/SHORTCUTS.md`.
- `src/classes/app/tutorial/` (`APPLICATION_CONTEXT.tutorials`) Interactive tour overlay behind `USER_INTERFACE.Tutorials`. Register tours with `USER_INTERFACE.Tutorials.add(...)`; never build a bespoke highlight overlay. See `src/TUTORIALS.md`.
- `src/classes/user.ts` & `src/classes/http-client.ts` User authentication and request management. Rely on contextualized auth scopes where necessary.
- `src/classes/auth/xopat-auth.ts` (`APPLICATION_CONTEXT.auth`) Core auth broker — lets any feature *require login* for a named context via a pluggable, registerable broker (OIDC now, SAML later). Built on `XOpatUser`. See `src/AUTH.md`. Never gate auth on `getOption` (§7); read `oidc`/`authMode` config via `getStaticMeta`.
- `src/loader.ts` The core application loader. It loads all modules and plugins, and defines the viewer manager.
- `src/store.ts` Pluggable storage middleware.
- `src/classes/session` Live-collaboration singleton (`window.SESSION`). Sync cursor/viewport/visualization by default; modules opt in by calling `window.SESSION.registerProvider({...})` and declaring `"sessionCompatible": "provider" | true | false` in their `include.json`. See `src/SESSION.md`.

Do not change files in `src/libs/` — these are vendored libraries. If a change is needed, notify the user to update upstream and re-vendor.

## 3. The `XOpatElement` API (Plugins and Modules)

Always extend `XOpatPlugin`, `XOpatModule`, or `XOpatModuleSingleton` when creating new system features.

### Core Lifecycle & Setup
- **`constructor`**: Accepts the instance ID. Call `super(id)`. Do not interact with the DOM or heavy global APIs here, as the system is still spinning up. However, constructors *must* attach handlers to events that fire early such as `before-app-init`.
- **`pluginReady()` / Events**: Override this or listen to `plugin-loaded` events to bootstrap the UI and attach your logics to the `USER_INTERFACE` or `VIEWER_MANAGER`.
- **Metadata and Configs** — *the trust boundary matters, read carefully*:
    - `getStaticMeta(key, default)`: reads from `PLUGINS[id]` — the plugin's `include.json` **merged with the deployment `ENV.plugins.<id>` block** (server-side). This is **deployment/operator-controlled = trusted**.
    - `setOption(key, value)` / `getOption(key)`: read/write **dynamic, per-session** config (`APPLICATION_CONTEXT.config.plugins[id]` + runtime `setOption`). This is seeded from POST_DATA / the exported visualizer session and **can be supplied by the embedding third-party app, URL params, or an imported peer session = UNTRUSTED**.
    - **§0/§7 security rule: never gate an authentication/authorization/security decision on `getOption`.** Auth mode, auth context, `requiresLogin`, credential/endpoint selection, secureMode-like toggles, and script-execution limits must come from `getStaticMeta` (or server-secure config), so a hostile session bundle cannot downgrade them (e.g. flip `authMode` `jwt`→`none` to bypass login). Use `getOption` only for genuine user preferences (UI toggles, last-used values).
    - **Gotchas.** `getOption(key)` only falls back to the static `PLUGINS[id]` value when **no explicit default** is passed (`loader.ts` ~1838) — `getOption("authMode", "jwt")` returns the literal `"jwt"`, silently ignoring ENV. And `config.plugins[id]` is reset to `{}` on load for plugins loaded without params (`application-lifecycle-controller.ts`). Both are extra reasons deployment knobs belong in `getStaticMeta`.
    - **Do not confuse the plugin-level `this.getOption` above with the core `APPLICATION_CONTEXT.getOption`.** They are different objects with different precedence. The core one resolves `config.params` (session) → `AppCache` (user preference) → `config.defaultParams` (the deployment `ENV.setup` block) → caller `defaultValue`; the caller literal is a last resort for keys the `setup` schema does not declare, so it can **never** shadow ENV. Consequently, do not pass a default that merely repeats the `src/config.json` value — declare the default in `config.json` once and call `getOption("key")`.

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

xOpat is multi-language (i18next). **No user-facing English may be hardcoded** — not labels, titles, tooltips, placeholders, aria-labels, menu/button text, nor dialog/toast/error messages. This is a §0 rule, not a nicety.

**How to add a translated string:**
1. Add the key to `src/locales/en.json` (en is the source of truth; other locales fall back to it via `fallbackLng: 'en'`). Follow the existing dot-notation namespaces — `error.*`, `main.*`, `common.*` (shared atoms like `Close`/`cancel`/`window`), `messages.*`, `inspector.*`, `toolbar.*`, etc. Reuse an existing key before inventing one.
2. Reference it with `$.t('namespace.key')` in JS/TS, or `data-i18n="namespace.key"` in HTML. Interpolate with `{{var}}` in the value and `$.t('key', { var })` at the call site (e.g. `inspector.smallerRadiusPx` → `$.t('inspector.smallerRadiusPx', { px })`).
3. `ui/` components reuse `src/locales/*.json` directly via the global `$.t` — there is **no** separate `ui/` locale dir. Plugins/modules instead ship their own `locales/<lang>.json` and load it with `this.loadLocale(locale, data)`, then read it under their own namespace (e.g. `$.t('annotations.key')`).

**The dummy-`$.t` gotcha — do NOT write literal fallbacks.** `src/classes/app/i18n-dom.ts` installs `$.t = (x) => last-dot-segment(x)` before i18next initializes (from `src/store.ts`, `src/loader.ts` and the UI bundle, idempotently). After init, `$.t` *always returns a string* — for a missing key it returns the key's last segment (`common.confirm` → `"confirm"`). Therefore:
- `$.t('x') ?? 'English'`, `$.t('x') || 'English'`, and `typeof $.t === 'function' ? $.t('x') : 'English'` are **dead code** — the English literal never shows. Don't write them. The real fix for a missing string is always *define the key in `en.json`*.
- For statics evaluated at module-load time (e.g. a class `static DEFAULT_*` array), don't call `$.t` in the static — it may run before init and capture the wrong value. Store a `titleKey` and resolve it with `$.t(titleKey)` at consumption time (see `Menu.DEFAULT_NAMESPACES` + its constructor loop).

**Before you finish:** run `npm run i18n-audit` (or `grunt i18n-audit`). It fails the build on any `$.t('key')` whose key is missing from `en.json`, and prints advisory warnings for likely hardcoded UI strings (`--strict` makes those fatal). Fix every reported missing key.

## 4. HTTP and RPC (`HttpClient`)

**NEVER use native `fetch` or `XMLHttpRequest` when communicating with upstream APIs, especially LLMs or secured endpoints.**

Use `window.HttpClient`. It tightly integrates with the user authentication system (`xOpatUser`), meaning it will automatically inject JWT tokens, CSRF tokens, and resolve proxied paths securely.

```javascript
// Example of HttpClient usage
const contextId = "core";    // specific auth context if required
const client = new HttpClient({
  proxy: "cerit",            // alias defined in server config
  baseURL: "/api/v1",
  auth: {
    contextId,
    // Do NOT pass `types`. They are resolved per request from the auth module
    // owning the context (APPLICATION_CONTEXT.auth.getSecretTypes), so the same
    // client works under OIDC, SAML, or anything added later.
    // `required: true` also makes the client WAIT for that context to finish
    // authenticating before sending a request it has no credential for
    // (`awaitContext`), instead of racing the login and 401-ing.
    required: true
  }
});

const response = await client.request("data", { method: "POST", body: { object: 'goes here' } });
```

A feature that must not send a request before login is in place does **not** poll
`isAuthenticated`: it awaits `APPLICATION_CONTEXT.auth.whenContextSettled(contextId)`
(bounded, memoized, never interactive). Core awaits `whenAllSettled()` for `autoLogin`
contexts before the first slide opens. See `src/AUTH.md` → "Waiting for a context to settle".

### Server-side (`*.server.ts`) outbound HTTP — NOT `window.HttpClient`

`window.HttpClient` is a **browser-only** broker: it binds to `window`, `btoa`,
`XOpatUser`, and the CSRF/session globals, so importing or `globalThis.HttpClient`-ing
it from a Node server module throws / is `undefined`. Server code that calls an
upstream must instead route through the **core SSRF guard** on
`globalThis.XOPAT_SERVER` (also handed to `register(serverApi)`):

- `XOPAT_SERVER.safeRequest(url, { method, headers, body, timeoutMs, signal, allowHosts })` — **TOCTOU-safe** (validates the destination at connect time, closing DNS-rebinding); use for untrusted/attacker-influenced hostnames.
- `XOPAT_SERVER.safeFetch(url, init)` — global-`fetch` convenience for trusted/operator-configured upstreams (small resolve-then-connect window).
- `XOPAT_SERVER.validateUpstreamUrl(url)` — pre-flight vetting before handing a `baseUrl` to a third-party SDK that brings its own `fetch`.

Both block private/loopback/link-local/CGNAT/metadata (incl. IPv4-mapped IPv6 and Azure wireserver) and refuse redirects. Keep feature-specific policy (HTTPS-only, origin allowlists) in your module; do **not** re-implement the IP/redirect/rebinding checks. A trusted internal upstream (a Docker/VPC-private backend) is permitted only via the operator env allowlist `XOPAT_SSRF_ALLOWED_HOSTS` / `XOPAT_SSRF_ALLOWED_CIDRS` — never a per-module private-IP bypass; the allowlist relaxes just the private-IP verdict, keeping redirect/rebinding protection. See `server/node/ssrf-guard.js` and the SSRF section of `server/README.md`.

### Server-side state — never a bare module-level `Map`

A `Map` at module scope in a `*.server.*` file has no bound, no sweeper, no
introspection, and no way for an operator to move it. That is how the server grew
unbounded: every subsystem that needed to remember something invented its own
(usually incomplete) eviction policy. Route it through `globalThis.XOPAT_SERVER`
instead, picking the surface by one question — *can the value be serialized?*

- **`XOPAT_SERVER.cache.create({ name, maxEntries, ttlMs, maxBytes, onEvict })`** — in-process,
  bounded, any JS value (promises, `KeyObject`s, SDK clients, decoded buffers).
  Lost on restart by design. TTL is **idle** (refreshed on `get`/`set`/`touch`,
  not on `peek`/iteration); `onEvict` reports store-initiated removals only
  (`ttl`/`lru`/`bytes`), never your own `delete()`.
- **`XOPAT_SERVER.storage.kv|log|blob(ownerUid, namespace, options)`** — pluggable and
  durable-capable, operator-routable via `core.server.secure.storage`. Pick the
  shape: `kv` for records, `log` for append-only transcripts (tail-read + FIFO
  trim), `blob` for bytes that must never be resident. The default `tiered`
  driver is bounded memory over durable files, so eviction is not data loss and
  state stays coherent across `XOPAT_WORKERS` cluster workers.

Two rules that bite: use `handle.scoped(XOPAT_SERVER.resolvePrincipal(ctx))` for
per-caller isolation rather than hand-written ACL checks, and declare
`sensitivity: "secret"` on anything holding credentials — the broker then refuses
to bind it to a persistent driver without an explicit operator opt-in. Do **not**
rely on mutating a value you read back: that persists only on the `memory`
driver, so write it back explicitly or the namespace stops being re-bindable.

Never key a cache directly by request input (a query param, a `Host` header, a
client-chosen id) without validating it first — a bound stops memory exhaustion,
it does not stop one caller reading another's entry.

Full spec: `server/STORAGE.md`. Dev introspection: `POST /__rpc/server/core/getStorageStats`.

### Server-side logging — never a bare `console.log`, never a `*_DEBUG` env var

Diagnostics go through the core logging broker. Take a channel logger from
`XOPAT_SERVER.log("module.<id>[:sub]")`, or — inside an RPC method — use
`ctx.log`, which is already scoped to `<kind>.<itemId>:<method>` with the request
id and the *hashed* principal bound. Levels (`trace/debug/info/warn/error`) are
resolved per channel by longest-prefix match from `core.server.logging`, so an
operator turns one subsystem up without drowning in the rest. `log.time(label)`
returns a stop function that emits `durationMs` — use it instead of hand-rolled
timing.

Two rules that matter: payload-bearing records (prompts, request bodies, tool
arguments) go through `log.sensitive(...)`, which the broker emits only when the
operator set `logging.allowSensitive` **and** the channel is at `trace` — a
logging decision must never be readable from request input or a session bundle
(§7); and redaction is the formatter's job, so never pre-scrub or pre-stringify.
Records land in the console, a bounded ring readable via
`POST /__rpc/server/core/getLogs`, a durable `core/log:logs` storage namespace,
and — with `sinks.stream` — batched NDJSON to an HTTP collector and/or a plain
file path, which is how records leave the box at all. Full spec:
`server/LOGGING.md`.

**Client-side the same broker exists at `APPLICATION_CONTEXT.log`** — same
channels, levels and `sensitive()` gate, configured from `env.client.logging`
(operator-controlled; never `getOption`, §7). Take a channel
(`APPLICATION_CONTEXT.log("module.<id>")`) instead of `console.log`: console
output has no level, no bound and no way out of the tab. With
`logging.forward.enabled` client records are batched into
`server/core/ingestClientLogs` and join the server's sinks — the server
re-stamps identity and applies the `sensitive` gate, because a browser says what
happened, never who it was. See `src/LOGGING.md`.

For dev-only *behavior* (not logging), gate on `XOPAT_SERVER.isDevMode(ctx)` (the operator dev flag `core.CORE.server.devMode`, set by `XOPAT_DEV_MODE` / `--dev`). Client-side the equivalent is `APPLICATION_CONTEXT.getOption("debugMode")`. Secrets stay `<% VAR %>`-injected; tuning belongs in server config — read it with `getSecureModuleConfig(ctx, id)`, or `XOPAT_SERVER.getStaticModuleConfig(id)` / `getStaticPluginConfig(id)` when state is built lazily and no ctx exists. Reserve `process.env` for bootstrap values read before any config (`XOPAT_ENV`, `XOPAT_CACHE_DIR`, `XOPAT_WORKERS`). See `server/ENVIRONMENT.md`.

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
   - Inputs / pickers: `Autocomplete` (searchable single-value combobox, static or async options, `fromSelect()` for a plain `<select>`), `TagSelect` (multi-select), `ContextMenu`, `SuggestionEditor`; atoms in `ui/classes/elements/` (`Checkbox`, `Select`, `Input`, `Slider`, …) (inline accept/decline diff editor over `original` vs `suggested` text; `getValue()` resolves decisions + free edits)
   - Roles: `UserRolesPanel`
2. **Reuse a UI service singleton** in `ui/services/`. **Never spawn duplicates.**
   - `AppBar` — mount plugin menus via `AppBar.Edit`, `AppBar.Plugins`, etc.
   - `AppBar.Chrome` — opt-in registry behind the top-bar "hide UI" button. Components register a `VisibilityManager` (or `{is, on, off}` / `{is, set}` duck) via `AppBar.Chrome.register(id, vm)`; everything routed through `AppBar.View.append()` / `View.registerViewComponent()` is enrolled automatically. Floaters outside the View system must call `register` on creation and `unregister` on teardown. Unrelated to `FullscreenMenus`.
   - `AppBar.Actions` — read-only live catalogue aggregating `Tools` / `View` / opt-in (`quickAction: true`) shortcuts into normalized, pinnable action descriptors; `AppBar.Actions.register(id, {label, icon, invoke})` is the escape hatch for functionality in no registry. `AppBar.QuickActions` renders the pinned subset as icon-only buttons in the bar (ENV `core.setup.quickActions` + per-user override; see `ui/services/README.md`).
   - `FloatingManager` — z-index management for floating panels.
   - `FullscreenMenus` — for capturing the whole viewing portal.
   - `GlobalTooltip` — global tooltip emitter.
   - `MobileBottomBar` — mobile layout slot.
3. **Extend `BaseComponent` with Van.js.** Constructor defines defaults; override `create()` to return exactly one HTML Node; use `this.classMap` and `this.setClass(key, value)` for reactive styling without re-rendering the whole tree. Mount via `myComp.attachTo(document.getElementById('workspace'))`.
4. **Raw Van.js** only when `BaseComponent` is genuinely the wrong abstraction (rare — usually means you're writing infrastructure, not a feature).
5. **Raw DOM for app-state UI is forbidden.** jQuery is **gone** — it is not loaded and `$` is not callable. The global `$` is xOpat's i18n namespace (`$.t` / `$.i18n`, installed by `src/classes/app/i18n-dom.ts`); writing `$(selector)` is a TypeError, not legacy style. For DOM work outside a component use the platform API (`document.querySelector`, `classList`, `textContent`); for deep clone/merge use `OpenSeadragon.extend`.

### Rendering markdown or model-authored prose

Never hand-roll "parse markdown → sanitize → degrade closed". Depend on the
[`markdown`](modules/markdown/README.md) module (`requires`/`modules`:
`["markdown"]`) and call `singletonModule("markdown").renderInto(host, text)`
(`{inline: true}` for labels). It bundles `marked`, sanitizes through the vetted
allowlist, degrades to `textContent` when the sanitizer is missing, and caches by
content so a re-render costs one `innerHTML` assignment.

The same module owns the **`#xopat-<kind>?<query>` link mechanism**: register a
kind (`markdown.links.register(...)`) and every subsystem that renders text gets
that action for free. The built-in `region` kind navigates a viewer to a slide
region — which is how an assistant-authored
`[label](#xopat-region?viewer=…&x=…&y=…&w=…&h=…)` works identically in a chat
bubble, a questionnaire description and a recorder overlay. If your feature hands
the model aliases instead of real viewer ids, register a resolver
(`markdown.registerViewerResolver(fn)`) rather than a parallel link scheme.

### Forbidden patterns

- Direct HTML string templates for reactive parts.
- A second markdown renderer, or a private `#`-link convention parsed by one component.
- `innerHTML +=` / manual node juggling for app-state mechanics.
- Custom CSS files unless absolutely necessary — use DaisyUI + Tailwind utilities.
- Tailwind dark-mode selectors directly (the app uses DaisyUI `data-theme`).

### Deep-dive references
`ui/README.md` (design system) · `ui/classes/README.md` (`BaseComponent` + Van.js) · `ui/services/README.md` (singletons) · `modules/markdown/README.md` (markdown rendering + `#xopat-…` links).

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
- **No feature hardcoding an auth method.** A plugin/module that needs login declares a *context* (`authMode` + `authContext` static meta → `this.requireAuthContext()`), never a broker method, and never `requires`/`modules` an auth module (`oidc-client-ts`, `saml-auth`) in `include.json`. Read `auth.types` from `APPLICATION_CONTEXT.auth.getSecretTypes(contextId)`. Server-side, take the required context from the *resource*, never from `ctx.contextId` (client-supplied). See `src/AUTH.md`.
- **No security decisions read via `getOption` / `APPLICATION_CONTEXT.config.plugins`.** That config is session/POST_DATA-derived and **third-party controllable** (embedding app, URL params, imported peer session). Auth mode/context, `requiresLogin`, credential & endpoint selection, and scripting limits must come from `getStaticMeta` (ENV/`include.json`) or server-secure config, so an untrusted bundle can't downgrade them. See §3 *Metadata and Configs*. The converse also holds: `setup.bypassCache` / `bypassCookies` are genuine **user preferences** about persistence and legitimately live in `getOption`, while *operator* storage policy (which KV driver a deployment binds) belongs in the server-only `ENV.client.io.bindings` block.

### Server-side rendering: never interpolate into a `<script>` unescaped

`JSON.stringify` escapes quotes and backslashes but **not `<`**, so any value
containing `</script>` closes the tag and everything after it is parsed as HTML.
Server-rendered pages embed the POST body (`postData` → `initXOpat`), which makes
that a reflected XSS on the viewer's own origin, next to `XOPAT_CSRF_TOKEN`.

Use `jsonForScript()` (`server/node/index.js`) for **every** interpolation into a
`<script>` body — including operator-controlled values. The invariant is
"nothing reaches a script body unescaped", because a per-value judgement call is
what decays. Same rule in the PHP renderer.

### Server-side: the deployment config is not a static asset

Static serving resolves against an explicit **allowlist of roots**
(`DEFAULT_STATIC_ROOTS`, extensible via `core.server.staticRoots`), not "any path
that exists". Anything else publishes `env/env.json`, the storage root, and
`*.server.ts` sources to anonymous callers. When you add an asset directory, add
the root — do not widen the rule. See `server/README.md` → "Serving static files".

### Framing the viewer is three walls, not one

An iframe deployment that only deals with `X-Frame-Options` gets a viewer that
renders and then 401s everything. Set `core.server.security.frameAncestors` to
the embedder origins — one knob that also switches the session cookie to
`SameSite=None; Secure; Partitioned` and enables the cookieless
`X-XOPAT-Session` fallback for frames with no cookie jar (blocked third-party
cookies, or a `sandbox` without `allow-same-origin`). Never put `frame-ancestors`
inside `security.csp`: that block is **report-only** by default and would
restrict nothing. Client-side, an opaque-origin frame also loses persistent
storage (`src/IO_PIPELINE.md`), and a framed login must be `authMethod: "popup"`
(`src/AUTH.md`). See `server/README.md` → "Embedding the viewer in a third-party
page".

### Multi-process is the deployment shape — write for it

Production runs `cluster-index.js` with N workers. Before adding server state, ask
where it lives when there are N of you:

- Per-request identity must be in a **shared** storage binding, not process memory.
- A budget that protects an upstream (`maxConcurrency`, `queueLimit`) is
  deployment-wide; the runtime divides it by the worker count. Do not re-multiply it.
- Never gate "am I the leader?" on `cluster.worker.id` — ids are monotonic and
  never reused, so the first restart loses the leader permanently. Use a lease.
- `XOPAT_SHARED_DEPLOYMENT=1` tells the server it is one of several processes in
  topologies where `cluster.isWorker` is false (k8s replicas, PM2 fork).

See `server/node/README.md` → "Multi-process deployment".

### When you change something security-relevant

Update `xss_report*.txt` if your change affects the reports' subject matter, and call it out in the PR/commit so review attention focuses correctly.

---

## 8. Known Pitfalls & Project Conventions

Lessons learned the hard way across past sessions. Each rule includes the *why* so you can judge edge cases.

### Lifecycle / module wiring

- **Hang core singletons off `APPLICATION_CONTEXT`, don't add new top-level globals.** The window namespace is already crowded; keep it a narrow, curated set (`APPLICATION_CONTEXT`, `VIEWER_MANAGER`, `USER_INTERFACE`, `UTILITIES`, …). A new app-wide singleton belongs *inside* one of those namespaces — construct it in the `createApplicationContext` factory (`src/classes/app/application-context.ts`) next to `history` / `httpClient` / `Scripting` / `io` / `networkStatus` / `auth`, type it on the `ApplicationContext` interface (`src/types/app.d.ts`), and let consumers reach it via `APPLICATION_CONTEXT.<name>`. *Why:* every `window.FOO` is global surface that leaks into plugins/modules, collides, and is hard to discover; namespacing keeps ownership and lifecycle explicit. Reserve a brand-new global only for a genuinely orthogonal subsystem with its own lifecycle (`VIEWER_MANAGER`, `SESSION`).
- **Eager-init singletons via `addModule(id, Class, true)`.** Calling `Class.instance()` before `addModule(id, Class)` throws `"no id given"` because `$id` is assigned inside `addModule`. If another module's constructor calls your `instance()`, register eagerly with the third argument.
- **Never touch `localStorage` / `sessionStorage` / `document.cookie` / `indexedDB` directly.** In a sandboxed iframe without `allow-same-origin` (the EMPAIA Workbench embedding) the document has an opaque origin and the **property read itself throws `SecurityError`** — `if (window.localStorage)` is a throw site, not a feature detection, and one unguarded access on the boot path used to take the whole viewer down. Use `this.cache` / `this.cookies` / `this.data`, `IO_PIPELINE.kv(uid, "kv:<ns>")`, or the `XOpatStorage` façades; they substitute in-memory drivers and never throw. `npm run storage-audit` fails the build on a direct access — the bootstrap exceptions are allowlisted there with justifications. See `src/IO_PIPELINE.md` → *Sandboxed / opaque-origin operation*.
- **`data` / `cache` / `cookies` are reserved getter-only accessors on `XOpatElement`.** They expose the IO KV stores (`kv:data` / `kv:cache` / `kv:cookies`, see §3). Assigning `this.data = ...` in a plugin/module constructor throws `Cannot set property data of #<XOpatElement> which has only a getter`. Name your own fields something else.
- **A directly-`new`ed `XOpatModule`'s `uid` is the *class* identity, not the owner's.** `super()` resolves the id from the class `$id` (e.g. `"module.menu-pages"`), shared by every owner that instantiates the module (e.g. `new AdvancedMenuPages(this.id)`). To scope menus/DOM ids/IO to the owning plugin, store and use the id passed to the constructor — don't key off `this.uid`.
- **Key per-source state by `tiledImage.source.tileSourceId`, not `source.url`.** DICOMweb shares `baseUrl` across slides; URL keys collide silently and you'll see one slide's state leak onto another.
- **`BackgroundConfig` snapshots `_rawValue` at construction.** Mid-flight mutations of `config.data[i]` do **not** propagate. Put custom tile sources on `background.dataReference`, never on `evt.data` after the fact.
- **One origin serves many deployments — persisted boot state must carry the deployment key.** `src/classes/app/deployment-key.ts` computes it once in `initXOpat` from the *served* ENV + plugin/module registries (operators pin it with `core.client.<active>.cacheKey`). It scopes the boot session caches (`xoSessionCache`, `__xopat_session__`) and the plugin-autoload cookie (`_plugins.<key>`) — nothing else. `kv:*` keys stay `<ownerUid>::<key>`, so two envs on one `localhost` *do* share `AppCache`/`AppCookies`; bind them to `memory` if that matters. Anything new that survives a reload and would be invalid under a different env belongs behind this key. *Why:* without it a session captured under one env replays under another with unresolvable data references, and plugins auto-load in deployments that never shipped them.
- **The boot path's raw storage access is a structural exception — do not "fix" it, and do not copy it.** `__xopat_session__` carries the ENV that configures the pipeline, and `parse-input.js` may *replace* the `POST_DATA` object the pipeline captures by reference, so `bootstrapIOPipeline` cannot run any earlier than it does. New state that must be readable before `initXOpatLoader` therefore belongs in the same club: stamp it with the deployment key, honour `setup.bypassCache`, probe-gate it, and add a `storage-audit` allowlist entry saying *why*. Everything else uses `IO_PIPELINE.kv(...)`. Two consequences worth knowing: `client.io.bindings` does **not** reach these flows (binding `core.kv:cache` to `memory` still writes localStorage at boot), and `bypassCache` suppresses restore/save but **never** eviction of a foreign deployment's entry. *Why:* conflating those two is what let a stale session survive an `XOPAT_ENV` switch.
- **`kv` values are encoded, and only `set`/`get` know that.** `handle.set` keeps strings verbatim, `String()`s numbers/booleans, JSON-envelopes everything else and deletes on `undefined`; `getItem`/`setItem` are the raw pair for libraries needing a real `Storage`. A value read back as the literal `"[object Object]"` is pre-envelope damage (`String(object)`), treated as absent and removed. *Why:* every object written before this was silently destroyed, and each affected feature failed quietly at its own read site.

### Build / dev loop

- **Shipped Tailwind is purged.** `src/libs/tailwind.min.css` is the production-purged build — many `md:` / `lg:` responsive variants and arbitrary classes are missing. Plugin UI must stick to compiled utilities, inline styles, or trigger a Tailwind recompile if a new class is needed.
- **Do NOT run builds yourself — the dev server watches and rebuilds.** Assume the developer is running the dev server (`npm run dev`); it watches all client assets and auto-rebuilds them, **including workspace bundles** (module/plugin TypeScript → `index.workspace.js` via esbuild) and module/plugin server files (rebuilt on load by the server-module-loader). Never manually invoke `esbuild`, `grunt workspaceBuild`, `grunt twinc`, `grunt buildUI`, or `npm run build`; doing so churns tracked bundles and races the watcher. Just edit the source and let the watcher pick it up.
- **The one exception: core server-side code is NOT hot-reloaded.** Changes to the core Node backend (`server/`, `index.js`) or the PHP server require a manual server restart. This does not apply to module/plugin server files, which the server-module-loader rebuilds on load.
- **Debug interactively when the cause isn't obvious — don't guess.** The developer is running the app (often in Docker; `docker logs <container>` is available) and can run a browser-console snippet and paste the output. Give them a self-contained snippet or a log command and ask. Apply the small **temporary** debug edits *yourself* (a `console.error(...)` in a hot-rebuilt module/plugin server or client file) rather than handing source to paste — the watcher/loader rebuilds it, so the user only reproduces and reads the log. Prefer one high-signal log at the exact divergence point over scattered logs, tag it greppable (e.g. `[foo-debug]`), and remove it once the cause is found. *Why:* an observed datapoint beats reasoning in the dark, and it splits the work correctly — the mechanical edit is yours, the reproduce+paste is theirs.

### UI patterns

- **Canvas right-click goes through `CanvasContextMenu` providers.** Register a provider; never call `DropDown.open` directly from `nonprimary-release-not-handled`.
- **Hot-path Fabric integration: patch the prototype.** For high-frequency events (every render, every object touch), monkey-patch `fabric.Canvas` / `fabric.Object` prototype methods rather than wiring `canvas.on(...)` listeners — events are an order of magnitude slower on the hot path.

### Library vs. application split

- **Library fixes belong in the library.** Prefer fixing flex-renderer / fabric / OSD upstream over xOpat-side patches. xOpat is the broker, not the patch surface — adapter / facade improvements are fine; monkey-patching library internals from xOpat is not. Write the pending request down in [`UPSTREAM.md`](UPSTREAM.md) so it does not get lost between library bumps.
- **Time-series shader source resolver: xOpat broker owns swap/append policy.** The library no longer unilaterally appends; if you find yourself reaching into the renderer to decide swap-vs-append, push that decision back to the broker.

---

## 9. Testing

One runner covers everything: core client, core server, plugins and modules —
including elements developed in their own repositories. Full documentation in
[`test/README.md`](test/README.md).

```bash
npm test                              # everything except @slow / @soak
npm test -- --project=secure          # one deployment configuration
npm test -- --grep @security          # one topic
npm test -- --grep "legacy: server/"  # the not-yet-ported server suites
npm test -- --last-failed             # rerun only what failed
npm run test:ui                       # watch mode with time travel
npm run test:slow                     # the long ones
npm run test:cypress                  # the frozen legacy Cypress suite
```

Selection is `--project` / `--grep`, never a new npm script: a script per
project or per suite makes `package.json` the index of what tests exist, which
is the runner's job.

**Where a test goes.** `test/suites/{unit,integration,e2e}/*.test.mjs` for core;
`{plugins,modules}/<id>/test/{unit,integration,e2e}/*.test.mjs` for an element —
no registration step, the runner finds it. Import `{ test, expect }` from
`@xopat/test-harness`. Elements linked in from their own repository
(`ln -s /path plugins/my-plugin`) are picked up with no configuration.

**Fixtures.** `xopatServer` boots a real server for the project's deployment ENV;
`xopat` gives a browser page bound to it (`launch()`, `waitForViewer()`,
`canvas()`, `drag()`). Requesting `xopat` is what starts a browser — a
server-only test must not. Failures automatically carry the effective ENV, the
server's output and logs, and the page's `console.appTrace`.

**Deployment differences are projects, not flags.** `secureMode` and
`production` cannot be set from a session (§3, §7) — that is the point of them —
so they are separate projects with their own ENV files (`test/env/*.json`), and
`integration`/`e2e` suites run against every one. Tag a test `@secure-only` /
`@production-only` when it only makes sense in one.

**Rules that keep the suite honest:**

- **Never require external data for a test that does not need it.** The
  synthetic DeepZoom slide (`ensureSyntheticSlide()`, project `synthetic`) covers
  rendering; only tests that genuinely need real slides call `requireSlides()`,
  which *skips with a reason* instead of timing out.
- **Assert on `APPLICATION_CONTEXT.env.setup.<key>`, not `getOption("<key>")`,**
  when checking what a deployment configured — a caller-supplied default outranks
  the ENV `setup` block in the core resolver (§3).
- **Suites that predate the runner** live with what they test —
  `test/legacy/<area>/*.mjs` for core, `{plugins,modules}/<id>/test/legacy/*.mjs`
  for an element — and run unmodified through `test/harness/legacy/`, which
  *scans* those locations rather than listing them. Porting one means moving it
  to the matching `test/{unit,integration,e2e}/` — never deleting the assertions.
- **Do not add a second runner.** If something seems to need one, it belongs in
  the harness.

**TODO (not yet done):** no CI workflow runs any of this — nothing gates a PR
today. The intended shape is a fast lane on every PR (`unit` + `integration`, no
browser, no external data), a browser lane on the synthetic slide, and a nightly
lane for `@slow`. Also outstanding: porting the four Cypress specs, and a PHP
backend matrix project.

## 10. Useful Deep-Dive References

For a specific and more detailed understanding of each subsystem, read the following repository READMEs:

- **Root & Architecture**:
    - [`test/README.md`](test/README.md) (The test runner: projects, tags, fixtures, element tests)
    - [`src/README.md`](src/README.md) (General App Config and Init logic)
    - [`src/NPM_MODULES_PLUGINS.md`](src/NPM_MODULES_PLUGINS.md) (Node Package integrations)
- **Plugin & Module Design**:
    - [`plugins/README.md`](plugins/README.md)
    - [`modules/README.md`](modules/README.md)
- **Core APIs & Communication**:
    - [`src/EVENTS.md`](src/EVENTS.md) (Lifecycle events and system broadcasts)
    - [`src/HTTP_CLIENT.md`](src/HTTP_CLIENT.md) (HttpClient, Token Verifiers, and Upstream Proxy integrations)
    - [`src/IO_PIPELINE.md`](src/IO_PIPELINE.md) (Generic IO/persistence pipeline: capabilities, sinks, bindings)
    - [`server/STORAGE.md`](server/STORAGE.md) (Server-side bounded caches + pluggable kv/log/blob storage: drivers, bindings, retention, the secret gate)
    - [`server/LOGGING.md`](server/LOGGING.md) (Server logging broker: channels, per-channel levels, redaction, the sensitive gate, log sinks incl. the HTTP/file stream destination, client ingest & RPC reads)
    - [`src/LOGGING.md`](src/LOGGING.md) (Client logging broker `APPLICATION_CONTEXT.log`: channels, `env.client.logging`, forwarding to the server)
    - [`src/SESSION.md`](src/SESSION.md) (Live-collaboration `window.SESSION` providers)
    - [`src/USER_ROLES.md`](src/USER_ROLES.md) (Roles, capabilities, and rights-resolver plugins)
    - [`src/SHORTCUTS.md`](src/SHORTCUTS.md) (Central keyboard-shortcut registry, combo format, Keymap panel)
    - [`src/TUTORIALS.md`](src/TUTORIALS.md) (Interactive tours: step grammar, selector cookbook, `APPLICATION_CONTEXT.tutorials`)
    - [`src/AUTH.md`](src/AUTH.md) (Core auth broker: require login for a context, register OIDC/SAML brokers, server RS256/JWKS verifier)
    - [`src/ZSTACK.md`](src/ZSTACK.md) (Focal-plane z-stack: tile-source opt-in contract, in-place plane swap, prefetch/cache config)
- **UI Architecture**:
    - [`ui/README.md`](ui/README.md) (Design system setup)
    - [`ui/classes/README.md`](ui/classes/README.md) (Developing via Van.js and `BaseComponent`)
    - [`ui/services/README.md`](ui/services/README.md) (Singletons controlling layout regions like `AppBar`)
- **Advanced State Management**:
    - [`src/MULTI_VIEWPORTS.md`](src/MULTI_VIEWPORTS.md) (How to design plugins not to break when multi-view instances are running)
    - [`src/VIRTUAL_VIEWPORTS_SPLIT.md`](src/VIRTUAL_VIEWPORTS_SPLIT.md) (Splitting one slide into aligned virtual regions: none/sidebyside/overlaid modes, identity/IO semantics, the one-bg rule, session authoring)
