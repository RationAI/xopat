# Plugins

It is easy to create and plug-in a plugin. Each plugin must be in its own folder placed here (`./plugins/`). 
Recommeded way of creating a new plugin is a command ``grunt generate:plugin``.

## Plugin Directory Structure
 
#### `include.json`
Inside a plugin, at least this file must exist (otherwise the directory is not treated as a plugin directory):

````json
{
    "id": "plugin_id",
    "name": "Plugin Name",
    "description": "My awesome plugin for this and that.",
    "includes" : [
        "dependency1.js",
        "dependency2.js",
        "implementation.js"
    ],
    "modules": []
}
````

exception to this rule is a workspace plugin, which is set to use NPM ([see development basics](../DEVELOPMENT.md)).

##### Built-in keys

  - `id` is a required value that defines plugin's ID as well as it's variable name (everything is set-up automatically)
  - `name` is the plugin name
  - `description` is a text displayed to the user to let them know what the plugin does: it should be short and concise
  - `longDescription` is an optional longer text for places with room for it (docs catalogue page)
  - `author` is the plugin author
  - `icon` is the plugin icon: either an **icon class** (`ph-*` preferred, `fa-*` legacy — see `src/libs/phoshor-icons/style.css`) or an **image URL**. Both forms work everywhere an icon is mounted (plugin list, menus). Markup strings are not supported. Omit or `null` for the generic placeholder.
  - `version` is the plugin version
  - `categories` is a list of grouping labels; the first one decides the group in the Plugins Menu and in the docs catalogue. The recommended set is `Annotations`, `AI`, `IO`, `Viewer`, `Navigation`, `Integration`, `Development` — these have translated labels (`plugins.category.*`); any other string is shown verbatim, so prefer the existing ones.
  - `keywords` is a list of search terms; never displayed, only matched by the Plugins Menu search box
  - `homepage`, `repository`, `bugs`, `docsUrl` are links rendered next to the plugin name and on its docs page. Only absolute `http(s)` URLs are accepted; anything else is silently dropped.
  - `license` is an SPDX identifier, shown in the docs catalogue only
  - `engines` declares compatibility, e.g. `"engines": {"xopat": ">=3.0.0"}`. Only the `xopat` key is understood. Supported ranges: `*`, `>=`/`>`/`<=`/`<`/`=`, `^`, `~`, and space-separated conjunctions (`">=3.0.0 <4.0.0"`). The plugin is **refused at load time** when the app version is out of range, and the Plugins Menu marks it incompatible. Prerelease tags of the app version are ignored, so `>=3.0.0` matches a `3.0.0-beta.1` build; deployments that report no usable version skip the check entirely.

##### Translating `name` / `description` / `longDescription`

These three values may be a `"%key%"` reference instead of literal text. The key
is resolved against the plugin's own locale bundle (`locales/<lang>.json`, whose
i18next namespace is the plugin id — see *Translation* in the root `AGENTS.md`):

````json
{ "id": "slide-info", "name": "%meta.name%", "description": "%meta.description%" }
````

with `locales/en.json` holding `{"meta": {"name": "Slides", "description": "…"}}`.
Anything without the `%…%` wrapper stays literal, and a reference that cannot be
resolved degrades to the raw manifest value. `pluginMeta(id, key)` /
`getStaticMeta(key)` resolve it for you; the Plugins Menu loads the bundle of a
plugin that is not loaded yet so unloaded plugins list correctly too.

Resolution needs the bundle to be registered, which is asynchronous: until your
`loadLocale()` resolves, the metadata reads back as the raw `%key%` string. Read
it after that promise (a constructor read is too early), and note that code
reading *another*, possibly unloaded element — a menu listing components, a
picker — must load that element's bundle first:

````js
await loadElementLocale("plugins", "slide-info");   // or "modules"
pluginMeta("slide-info", "name");                   // -> "Slides"
````

`loadElementLocale(kind, id, locale?)` is idempotent (repeated calls do not
re-fetch) and resolves to nothing when the element has no bundle for that
language — metadata then stays raw rather than failing.

##### Global metadata helpers

| Global | Purpose |
|---|---|
| `pluginMeta(id, key)` | presentation metadata of any plugin: `name`, `description`, `longDescription`, `author`, `version`, `icon`, `stability`, `categories`, `keywords`, `homepage`, `repository`, `bugs`, `docsUrl`, `license`, `engines`. Anything else (internal wiring, deployment config) returns `undefined` — use `getStaticMeta` from inside the owning element instead. |
| `moduleMeta(id, key)` | the same for modules; not restricted to the list above |
| `loadElementLocale(kind, id, locale?)` | register the locale bundle of an element that is not loaded, so its `%key%` metadata resolves |
| `elementIncompatibility(kind, id)` | why an element cannot run here (`engines`, incl. a plugin's module chain), or `null`. For UI that lists elements it does not load itself. |
  - `includes` is a list of JavaScript files relative to the plugin folder to include 
  - `modules` array of id's of required modules (libraries)
      - note that in case a new library you need is probably not useful to the whole system, include it internally via the plugin's `"includes"` list 
      instead of creating a module for it
  - `permaLoad` is an option to include the plugin permanently without asking; such plugin is not shown in Plugins Menu and is always present
  - `enabled` is an option to allow or disallow the plugin in the system, default `true`
  - `hidden` is an option to hide plugin from the user-available selection
  - `stability` is a maturity marker, one of `"stable"` (the default when the key is absent), `"experimental"` or `"deprecated"`. It is presentation-only and never gates loading: the Plugins Menu renders a badge next to the plugin name and the docs catalogue renders a matching badge on the plugin page. A deployment can override it through the `ENV.plugins[<id>]` block, and code can read it with `getStaticMeta("stability")` or `pluginMeta(id, "stability")`.
  - `requiredConfig` is an array of dot-paths (e.g. `["serviceUrl", "proxyAlias"]`) within the plugin's `<id>` namespace that must be configured by the deployment for the plugin to be shipped under the `"available"` server-side plugin-selection mode. Each path is resolved against TWO deployment-controlled sources; a path is satisfied if EITHER source carries a non-`undefined`/non-`null`/non-empty-string value:
      1. **Deployment ENV block** — `ENV.plugins[<id>]`, supplied via env.json's top-level `plugins` array.
      2. **Server-secure block** — `CORE.server.secure.plugins[<id>]`, supplied via env.json's `core.server.secure.plugins`. Never shipped to the browser. The natural home for secret-adjacent values (API key bindings, proxy aliases referencing a secret).
    Booleans `false` and the number `0` count as configured. **Include.json defaults are NOT consulted** — even if a plugin's own include.json sets `serviceUrl: "http://localhost:8042"` as a default, that does not satisfy the gate. Only what the deployment explicitly sets in either bucket counts. This makes include.json defaults safe for dev convenience under `"all"` mode without accidentally satisfying production-availability checks. The plugin author declares *what* keys must exist; the deployment admin decides *where* each value lives based on sensitivity. Ignored under selection modes `"all"` and `"whitelist"`. See `server/README.md` for the mode reference.

##### Built-in options
  - `ignorePostIO` - see below the default IO lifecycle
  - `capabilities` — top-level array of rights-capabilities the plugin exposes for the role-based UI gating layer. Each entry is `{ "id": "myplugin.<gate>", "default": "allow" | "deny", "label": "..." }`. IO-mediated actions are auto-derived from `io.capabilities[]` and do **not** need to be listed here; this array is for UI gates that aren't tied to a typed IO resource. See `src/USER_ROLES.md` for the full model.

##### Custom keys
A developer can provide custom parameters to `include.json` and retrieve them later in the code.
A deployment maintainer then uses ENV setup (see `/env/README.md`) to override necessary values.
These are called **Static Configurations**.


## Must do's
- A plugin must register itself using the name of its parent class. For more information see below.
    - if the plugin is based on `MyAwesomePlugin` object/class, then call `addPlugin('myPluginId', MyAwesomePlugin);` on a global level
    - `'myPluginId'` must be the same as `id` from `includes.json`
- Any attached HTML to the DOM must be attached by the provided API (see `USER_INTERFACE` global variable)
- A plugin must inherit from ``XOpatPlugin`` class
    - your plugin constructor is given ``id`` and ``params`` arguments, call `super(id)` and use params (from the **Dynamic session**) at your will
- Get familiar with both global and ``XOpatPlugin`` API - use it where possible
    - especially, do not add HTML to DOM directly (unless you operate a new window instance), use ``window.USER_INTERFACE`` API instead
    - cache meaningful values
    - interact with static & dynamic configuration values
    - provide built-in IO logics
    - ...
- If your entity works with a viewer instance, the xOpat viewer can have multiple viewers open at the same time.
Make sure you know viewer lifecycle from events of the VIEWER_MANAGER and that you use ``viewer.uiqueId`` to 
reference the viewer. There is also ``viewer.id`` which is suitable to use only if you care about the viewer
position/element, **not the data it opens**.

> **IMPORTANT.** Please respect the viewer API and behavior. Specifically,
> respect the ``APPLICATION_CONTEXT.secureMode`` parameter
> and provide necessary steps to ensure secure execution if applicable.

### NPM Support and UI
Please, [see development basics](../DEVELOPMENT.md) on how to develop with NPM and have live UI support.
Also, [read ui specification](../ui/README.md) and get to know available UI elements.

### Interface XOpatPlugin
Basic functions that are available to plugins atop what ``XOpatElement`` provides.
````js
/**
 * Function called once a viewer is fully loaded
 */
async pluginReady();

/**
 * Load localization data
 * @param locale the current locale if undefined
 * @param data possibly custom locale data if not fetched from a file
 */
async loadLocale(locale=undefined, data=undefined);

/**
 * Read static metadata - include.json contents and additional meta attached at runtime
 * @param metaKey key to read
 * @param defaultValue
 * @return {undefined|*}
 */
getStaticMeta(metaKey, defaultValue);
/**
 * Store the plugin configuration parameters
 * @param {string} key
 * @param {*} value
 * @param {boolean} cookies
 */
setOption(key, value, cookies=true);

/**
 * Read the plugin configuration parameters
 * @param {string} key
 * @param {*} defaultValue
 * @return {*}
 */
getOption(key, defaultValue=undefined);

/**
 * Code for global-scope access to this instance
 * @return {string}
 */
get THIS();

/**
 * Plugins CANNOT BE DIRECTLY DEPENDENT on each other. Only loosely.
 * To simplify plugin interaction, you can register a callback executed
 * when a certain plugin gets loaded into the system.
 * @param {string} pluginId
 * @param {function} callback that receives the plugin instance
 * @return {boolean} true if finished immediatelly, false if registered handler for the
 *   future possibility of plugin being loaded
 */
integrateWithPlugin(pluginId, callback);

/**
 * Absolute url (path part only) to plugins folder
 */
static ROOT;
````

#### `XOpatPlugin::constructor(id, params)`
The plugin main class is given it's `id` and `params` object (dynamic metadata). `params` object
is integrated within the system and gets exported in the viewer configuration - such information is available when 
sharing the plugin
exports.

#### `XOpatPlugin::pluginReady()`
You can override this function - it will get invoked once the plugin is fully ready.
Because of dynamic loading and behaviour, it is necessary that you do most initialization
in this function instead of the constructor, especially if
 - you access **the global API**
 - you access any **API of other plugins/modules**
 - you access global scope **of your own plugin's _other files_**!
 TODO: rewrite
#### `XOpatPlugin::getOption(key, defaultValue=undefined)`
Returns stored value if available, supports cookie caching and the value gets automatically exported with the viewer. The value itself is
read from the `params` object given to the constructor, unless cookie cache overrides it. For cookie support, prefer this method.

> **⚠️ Security / trust boundary.** `getOption` reads **per-session, third-party-controllable** config (`params` = `config.plugins[id]`, seeded from POST_DATA / the viewer URL / imported peer sessions). **Never** base an authentication/authorization decision (auth mode, auth context, `requiresLogin`, credential or endpoint selection, scripting limits) on `getOption` — a hostile bundle could downgrade it. Read such deployment settings with `getStaticMeta` (ENV/`include.json`, operator-controlled) instead. Also note `getOption(key, explicitDefault)` will **not** fall back to the static `include.json`/ENV value — the fallback only applies when no default is passed; and `config.plugins[id]` is reset to `{}` on load for plugins loaded without params. See root `AGENTS.md` §3 / §7.

#### `XOpatPlugin::setOption(key, value, cookies=true)`
Stores value under arbitrary `key`, caches it, if allowed within cookies The value must be already serialized as a string
(constants are OK since they can be converted naturally). The value gets exported with the viewer. 
The value itself is stored in the `params` object given to the constructor. For cookie support, prefer this method.

### Selected global API functions
Since `HTML` files and `js` scripts work a lot with global scope, we define several functions and variables for plugins to 
be able to work flawlessly.

#### `plugin(id)`
Retrieve an instantiated plugin by its id.

#### `addPlugin(id, PluginMainClass)`
This (global) function will register the plugin and initialize it. It will make sure that
- an instance of `PluginMainClass` is created
- `id` member variable is set
- the API is correctly configured
    - ``this.THIS`` is a memoized global accessor string equal to `plugin('${this.id}')`. It historically existed so legacy markup could reach the plugin from inline `on...=""` HTML attributes, e.g. ``let html = `<tag onclick="${this.THIS}.callMyPluginFunction(...)">`;``

      > **⚠️ Deprecated — do not write inline `onclick` / HTML-string UI in new code.** Concatenated HTML strings bypass escaping (an XSS risk) and diverge from the viewer's UI system. Build UI with the **Van.js + `BaseComponent`** component system and attach handlers in JavaScript instead (see [Building UI](#building-ui) below). `this.THIS` is retained only for interop with existing legacy markup.

>
> You can register the plugin anonymously if you do not need the class namespace:
> ``` 
> addPlugin("user-session", class extends XOpatPlugin {
>      ...
> });
> ```
>


## IO Handling

xOpat ships a generic IO pipeline (`src/classes/io/`) that decouples *what* a
plugin persists from *where* the bytes go. Plugins declare capabilities;
admins bind them to sinks (file download, GitHub, HTTP REST, custom). See
[`src/IO_PIPELINE.md`](../src/IO_PIPELINE.md) for the full reference.

Two flavors of persistence are supported per element:

- **Bundle export/import** — the whole plugin's state as one blob
  (annotations bundle, recorder timeline, questionaire schema, …).
  Round-trips through whatever sink the admin binds.
- **Per-item CRUD** — each entity (annotation, step, answer, …)
  dispatched as `create`/`update`/`delete` to a sink, with a durable
  outbox so offline edits replay on reconnect.

Both are opt-in. Declare them in `include.json` and wire them in your
constructor with `initIO` + `defineResource`. The legacy
`exportData`/`importData`/`exportViewerData`/`importViewerData` overrides
and the `initPostIO()` helper have been removed; existing plugins that
used them have migration notes in their own `MIGRATION.md` files (see
[`plugins/recorder/MIGRATION.md`](recorder/MIGRATION.md),
[`plugins/questionaire-new/MIGRATION.md`](questionaire-new/MIGRATION.md)).

### Declare in `include.json`

```jsonc
{
  "id": "my-plugin",
  "io": {
    "capabilities": [
      { "id": "bundle-export", "kind": "bundle", "label": "My plugin export" },
      { "id": "bundle-import", "kind": "bundle", "label": "My plugin import" },
      { "id": "crud:thing",    "kind": "crud",   "label": "Thing" }
    ]
  }
}
```

Set `"io": false` to hard-disable IO regardless of admin bindings.

### Wire in the constructor

```js
constructor(id) {
    super(id);
    this._initIOPipeline().catch(e => console.error("[my-plugin] IO init failed:", e));
}

async _initIOPipeline() {
    await this.initIO({
        bundleScope: "global",         // "global" | "per-viewer" | "both"
        exportBundle: async (ctx) => JSON.stringify(this._state),
        importBundle: async (ctx, data) => {
            try {
                await APPLICATION_CONTEXT.history.withoutRecording(() => {
                    this._state = typeof data === "string" ? JSON.parse(data) : data;
                    this._render();
                });
            } catch (e) {
                // Surface a user-facing toast via the pipeline. `userMessage`
                // escalates the dialog to error-level.
                const wrapped = new Error(`Failed to load: ${e?.message ?? e}`);
                wrapped.userMessage = "Could not load my-plugin data.";
                throw wrapped;
            }
        },
    });

    this.thingResource = this.defineResource({
        name: "thing",
        identityOf: t => String(t?.id ?? ""),
        coalesce: true,
        merge: (prev, next) => ({ ...prev, ...next }),
        persistOutbox: true,
        persistMaxEntries: 1000,
        persistMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
        validate: t => t?.id ? { ok: true } : { ok: false, refused: true, reason: "missing id" },
    });
}
```

`bundleScope: "per-viewer"` makes the pipeline call `exportBundle` /
`importBundle` once per active viewer (with `ctx.viewerId` set), which is
the right choice when state is keyed to a tiled image — see the
annotations module for a worked example. `"global"` is for plugin-wide
state that spans all viewers.

### Dispatch local mutations through the resource

Mirror your in-process events to the resource so admins binding a CRUD
sink get free upstream sync:

```js
this.addHandler("thing-create", e => this.thingResource.create(e.thing));
this.addHandler("thing-update", e => this.thingResource.update(e.thing.id, e.patch));
this.addHandler("thing-delete", e => this.thingResource.delete(e.thing.id));
```

When unbound the resource is inert and these calls are no-ops.

### Hydration on boot

`initIO` triggers `IO_PIPELINE.tryRestoreImport({ ownerUid })` automatically
for global state, and the loader fires the per-viewer pass on each viewer
open. Wrap `importBundle`'s body in
`APPLICATION_CONTEXT.history.withoutRecording(...)` so hydration doesn't
pollute the undo stack.

### Triggering exports

Programmatically: `await APPLICATION_CONTEXT.io.flushBundleExport({ ownerUid: "my-plugin" })`.
The user-facing Export action (`UTILITIES.export()`) fans out to every
owner with bundle capabilities. If every bound sink for your plugin
refuses, the pipeline's automatic `file-download` fallback kicks in so
the user always walks away with their data.

### Errors

Sink refusals (`{ ok: false, refused: true, userMessage }`) and exceptions
thrown from `importBundle` / `exportBundle` automatically surface as
12-second toasts (error-level when a `userMessage` is supplied,
warning-level otherwise) via `IOPipeline.surfaceRefusal`.

### Static-preview mode

When the viewer is exported as a self-contained file (HTML), the option
`isStaticPreview` is set to `true`. Plugins that fetch their own data
from a backend should skip that fetch in static-preview mode to avoid
duplication with the bundle:

```js
if (APPLICATION_CONTEXT.getOption("isStaticPreview")) {
    // skip backend fetch — the IO pipeline restores state from the bundle
}
```

### Data Management Options
There are generally **five** different ways to manage data. For metadata (e.g., configurations, settings),
three different options are available:

 1. `getOption`, `setOption` suitable for small configuration metadata, present in the configuration of _viewer URL and file exports_. **Untrusted: third-party/session-controlled — never use for auth or security decisions (see the `getOption` security note above).**
 2. `getStaticMeta` suitable for static (hardcoded) configuration metadata, reading from your `include.json` **merged with the deployment `ENV.plugins.<id>` block**. Operator-controlled = trusted; use this for auth mode/context and any security-relevant knob.
 3. `async getCache`, `async setCache` suitable for session-independent data (cookies or user data), always available.
    - use for user configurations caching to avoid re-setting in each session.

And one global meta store meant for reading only global viewer metadata:
 4. `APPLICATION_CONTEXT.metadata` as an instance of `MetaStore` class.

For data IO:
 1. **`initIO` + `defineResource`** (the IO pipeline above) — the canonical path. Bundle for whole-state round-trips, CRUD for per-item upstream sync. Admin-routable, sink-agnostic, with offline outbox replay and automatic file-download fallback.
 2. Custom service stored at a server
    - prefer wiring it as an `http-rest` sink (or your own custom sink registered with `IO_PIPELINE.registerSink(...)`) rather than calling `fetch`/`HttpClient` directly. That way admins keep one binding surface.

### Events
Modules (and plugins) can have their own event system - in that case, the `EVENTS.md` description
should be provided. These events require OpenSeadragon.EventSource implementation (which it is based on).

### Localization
Can be done using ``this.loadLocale(locale, data)`` which behaves like plugin's `loadLocale` function
(both ``locale`` and `data` can be undefined). 
````javascript
//load default locale
this.loadLocale() 
//load raw data for 'cs'
this.loadLocale('cs', {"x":"y"}) 
````
Override ``getLocaleFile`` function to describe module-relative path to the locale file for given `locale` string.


## Global API
> !!! Avoid touching directly any properties, attaching custom content to the DOM or inventing your own
approaches when API is available !!!
 
First, get familiar with (sorted in importance order):
 - `window.VIEWER_MANAGER`
    - Manager for all OSD viewer instances. **Resolve viewers through this**, not through `window.VIEWER`:
      - `VIEWER_MANAGER.get(...)` for a specific viewer
      - `viewerSingletonModule(className, viewerLike)` for per-viewer module singletons
      - `e.eventSource` inside `VIEWER_MANAGER.broadcastHandler(...)` callbacks
    - See [`../src/MULTI_VIEWPORTS.md`](../src/MULTI_VIEWPORTS.md) — the codebase supports arbitrary multi-viewport grids, so `window.VIEWER` (the *focused* viewer) is the wrong handle whenever a plugin's domain logic could fire from another viewport.
 - Per-viewer OpenSeadragon surface — obtained via `VIEWER_MANAGER.get(...)` / `e.eventSource`:
    - `TileSource` API, `EventSource` API for managing rendering and user-input events
    - `OpenSeadragon.Tools` (`viewer.tools`) for focusing areas, screenshots, viewer cloning, navigation
    - `OpenSeadragon.Scalebar` (`viewer.scalebar`) for measurements; `imagePixelSizeOnScreen` is the **cached** image↔window coordinate conversion
    - WebGL layers group via `viewer.bridge` for image data post-processing
    - Per-viewer events — always check the local `EVENTS.md`
 - `window.VIEWER`
    - *Focused-viewer* shortcut. Safe only for transient, UI-driven actions where "the viewer the user is looking at" really is what you want; **never** for domain logic that may originate from a non-focused viewport.
 - `window.USER_INTERFACE`
    - API for dealing with application UI - menus, tutorials, inserting custom HTML to DOM...
 - `window.UTILITIES`
    - functional API - exporting, downloading files, refreshing page and many other useful utilities
 - ``window.HTTPClient`` for seamless auth integration
    - Third party code (see below)
 - `window.APPLICATION_CONTEXT`
    - supported runtime entrypoint for session/viewer transactions
    - to access the configuration, should be used in read-only manner: `APPLICATION_CONTEXT.config`
    - to access viewer parameters, use `[set|get]Option(...)`
    - to mutate viewer/session opening state, use:
      - `APPLICATION_CONTEXT.openViewerWith(...)`
      - `APPLICATION_CONTEXT.updateViewerSelection(viewerIndex, selection, opts?)`
      - `APPLICATION_CONTEXT.replaceVisualizations(...)`
    - `APPLICATION_CONTEXT.updateVisualization(...)` still exists for compatibility, but prefer `replaceVisualizations(...)` in new code
 - `window.plugin(id)`
   - preferred way to access another plugin instance when it is already active
 - `window.singletonModule(id)` and `window.viewerSingletonModule(className, viewerRef)`
   - preferred lazy accessors for singleton modules and viewer singletons
 - `window.registerViewerSingleton(...)` and `window.requireViewerSingletonPresence(...)`
   - register and auto-materialize viewer-scoped helpers from plugins/modules
 - ``window.LAYOUT`` 
   - the main app layout
  
And also other available modules. Each module provides it's own way of enriching the environment, 
such as pre-defined color maps, (already mentioned) webgl processing, fabricJS canvas, JSON to HTML parser, 
annotation logic, HTML sanitization, vega graphs, threading worker or keyframe snapshots.   

> #### Note on `XOpatViewerSingleton`
> The `XOpatViewerSingleton` is not a module nor plugin (do not confuse it like so), it is utility class instantiated per viewer.
> Unlike plugins, you need to call ``registerViewerSingleton(XOpatModuleViewerSingleton)``.
> Multiple such classes can exist within a plugin, as they do not define a plugin.
> Instead of ``registerViewerSingleton``, you can call `requireViewerSingletonPresence`
> to ensure that the singleton is instantiated along with each viewer without explicitly telling it so.

### Available Third-party Code and UI
- You should use new UI components, see [this](../../../../../Repos/xopat-shadowaya/ui/README.md)

You can use
 - [jQuery](https://jquery.com/), 
 - [Phosphor Icons (Light)](https://phosphoricons.com/) — preferred for new code.
   Use `new UI.PhIcon({ name: "ph-gear" })` or raw markup `<i class="ph-light ph-gear"></i>`.
   Icon names are listed in `src/libs/phoshor-icons/style.css`.
 - [Font Awesome 6 Free icons](https://fontawesome.com/) — legacy; still loaded for
   coverage. Existing `<i class="fa-auto fa-..."></i>` markup keeps working and is
   transparently swapped to Phosphor as entries are added to
   `src/libs/phoshor-icons/fa-overrides.css` (any unmapped `fa-*` class falls back to
   Font Awesome). When you add a new icon, prefer Phosphor directly.
 - DaisyUI + TailwindCSS styling
 - The CORE UI Component system (see `ui/`)
 - Pre-defined, documented CSS in the core ``src/assets/style.css``
   - slowly moving away from, rely on UI components and tailwind / daisy UI
 - other libraries included in `/external`, the Monaco editor is available only in a child window
   context via the `Dialogs` interface

> Primer.css and material icons are deprecated and slowly removed!
 
#### `includes` property
In fact, the plugin can either specify a string value to indicate local file, 
or an object to specify a file on the web. The object properties (almost) map to
 supported attributes of `<script>` element. In case you will attach a file, 
 make sure you also set `integrity` property.
````json
{
    "id": "plugin_id",
    "includes" : [
        {
            "src": "https://host.xy/file.js",
            "integrity": "hashalgo-hashofthefilesothatitsintegrityisverified",
            "crossOrigin": "anonymous"
        }
    ]
}
```` 

##### Production minification (`bundle`)
When the deployment runs with `client.production: true` (build with `npm run
minify`), each plugin/module is served as **minified bundle(s)** instead of the
raw include list:
- local classic `.js` includes are concatenated + minified into `index.min.js`;
- local `.mjs` ES modules are esbuild-bundled + minified into `index.min.mjs`
  (served as `type="module"`, syntax preserved — e.g. `import.meta`);
- workspace (npm-package) items ship `index.workspace.min.js`.

An item with both classic and module includes gets both files. Entries that
*cannot* be bundled are detected automatically and keep loading as their own
files: remote `http(s)` URLs, already-`.min.js` bundles, and any object-form
include (SRI/attributes).

If a **local `.js`** file must NOT be folded into the bundle — e.g. a Web Worker
source that only looks foldable by its `.js` suffix — mark it with
`"bundle": false` (object form). It then always loads as its own file and is
never concatenated:
````json
{
    "includes": [
        "app.js",
        { "src": "my.worker.js", "bundle": false }
    ]
}
````
## Viewer Multiplexing
There can be multiple viewers open at once. You might need to create:
- custom viewer-oriented menus: use ``VIEWER_MANAGER.getMenu(...)`` method to access desired menu component and add custom content
- custom viewer-oriented data models: use `XOpatViewerSingleton` if you need only instance per viewer.

If your plugin needs to switch only one viewer, do not rebuild the whole session manually. Use `APPLICATION_CONTEXT.updateViewerSelection(...)`, which goes through the same synchronized open pipeline as full session opens.

### ``XOpatViewerSingleton``
The `XOpatViewerSingleton` exists one per active viewer, and have ``destroy()`` you can use to react on viewer context being lost. By default, instances ARE NOT
created, only when one requests the instance with ```MyViewerSingleton.instance(viewerRefOrViewerUID)```. If you want to force
instance creation per viewer automatically, call ``requireViewerSingletonPresence(MyViewerSingleton)``.

For dynamically or lazily loaded singletons, use the loader helper APIs. Ensure that `className` accurately matches the expected context context:

````js
this.integrateWithViewerSingletonModule('MyViewerSingleton', viewerRef, async (module) => {
    //...
});

const mod = viewerSingletonModule('MyViewerSingleton', viewerRef);
````

## Dynamic Loading
As workers and js modules (recommended usage), the viewer does not offer advanced tools for
loading these scripts dynamically. You need to use **relative** file names and instantiate
your worker or import a module. Relative paths must begin in the repository root. With plugins and
modules, the easiest way is to extend appropriate interface and retrieve ``this.PLUGIN_ROOT`` or
``this.MODULE_ROOT`` respectively, against which you can import local files.

## Caveats
The plugins should integrate into exporting/importing events, otherwise the user will have to re-create
the state on each reload - which might be fatal wrt. user experience. Also, you can set dirty state
using ``APPLICATION_CONTEXT.setDirty()`` so that the user gets notified if they want to leave.

Furthermore, the layout canvas setup can vary - if you work with canvas in any way relying on dimensions
or certain tile sources, make sure you subscribe to events related to modification of the canvas and update
the functionality appropriately. Also, **do not store reference** to any tiled images or sources you do not control.
Instead, use ``VIEWER.scalebar.getReferencedTiledImage();`` to get to the _reference_ Tiled Image: an image wrt. which
all measures should be done.

For authentication, ``HttpClient`` is avaiable and strongly recommended. It integrates with
the viewer auth flows directly, and you can use custom contexts for authentication too.
Moreover, you can use proxies to hide API keys: the proxy can be used only trusted services: you should use ``HttpClient`` to talk to the proxy, and not ``fetch``
````javascript
// here is some login that logs within contextId
const authClient = new OIDCAuthClient(oidcConfig, {
    userContextId: "my-service",
    serviceName,
    authMethod: "popup",
});

const client = new HttpClient({
    proxy: "proxy-key",           // the config key in server.secure.proxies
    baseURL: "/v1",               // optional base path inside the proxy
    auth: {                       // optional authentication, if configured, directly integrates with xOpatUser API
        contextId: "my-service",
        types: ["jwt"],
    },
});
````
 
## Hints
If you have a panel registered under your ID, you can use `loading` class to show a loading spinner
````JavaScript
appendToMainMenuExtended(title, titleHtml, html, hiddenHtml, id, pluginId);
$(`#${id}`).addClass("loading");
````
And remove it after you are done. In fact, do not be shy and open `assets/custom.css`
file to see pre-defined classes for uniform UI (button hovering, error message containers and more).  

---
### Building UI

> **⚠️ Deprecated pattern — avoid raw HTML strings with inline handlers.** Code like
> ````JavaScript
> // ❌ DEPRECATED: concatenated HTML + inline onclick — XSS-prone, bypasses the UI system.
> let html = `<button class="btn" onclick="${this.THIS}.myPluginRootClassMethod();">Click me</button>`;
> ````
> is discouraged in **all** new code. Inline `on...=""` attributes and
> string-built markup skip escaping and diverge from the viewer's reactive UI.

Build plugin UI with the **Van.js + `BaseComponent`** component system. Follow
the build-priority chain: first reuse an existing component (`ui/classes/components/`)
or service (`ui/services/`); only extend `BaseComponent` when none fits. Define
markup with `van.tags` and bind handlers as properties — never as inline HTML
attributes:

````JavaScript
const { button } = van.tags; // van.tags provides the HTML element builders

class MyPanel extends BaseComponent {
  create() {
    // handler is a function reference, not an inline string — escaping is automatic
    return button({ class: "btn", onclick: () => this.myPluginRootClassMethod() }, "Click me");
  }
}
````

If you must integrate with pre-existing legacy markup, fetch the element by its
ID and attach the listener programmatically
(`el.addEventListener("click", () => this.myPluginRootClassMethod())`) rather
than embedding an `onclick` string. `this.id` is set automatically to your
plugin ID by `addPlugin(...)`.

See the [UI System](../ui/README.md), [`BaseComponent`](../ui/classes/README.md),
and [UI services](../ui/services/README.md) guides for the full catalogue.

### Styling with CSS
Rely on **DaisyUI + TailwindCSS** utility classes (on top of DaisyUI's
`data-theme` mechanism) together with the pre-defined classes in
`assets/custom.css`.

> _Primer CSS / Bootstrap styling is legacy_ and should not be introduced in new
> plugins — prefer DaisyUI + Tailwind utilities.

If you genuinely need your own CSS, create a `style.css` file in your plugin root
directory — it is included automatically.
