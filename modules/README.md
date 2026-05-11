# Modules

Are basically plugins for plugins - available feature extensions, libraries.
Basically, there are two types of modules: 'extensions' and 'xOpat modules'.
Modules are defined in ``include.json`` in this folder.
#### `include.json`
It's structure is similar to plugin's, but instead of `modules` key we 
define a dependency on other modules with `requires` key - also accepts a list of modules. Circular
dependencies are detected and result in error.
````json
{
    "id": "module_id",
    "name": "Module Name",
    "includes" : [
        "dependency1.js",
        "dependency2.js",
        "implementation.js"
    ],
    "requires": []
}
````
Exception to this rule is a workspace module, which is set to use NPM ([see development basics](../DEVELOPMENT.md)).

Using third party hosted scripts: an include array item should (instead of a string) look like this:
````json
{
    "src": "https://host.xy/file.js",
    "integrity": "hashalgo-hashofthefilesothatitsintegrityisverified",
    "crossOrigin": "anonymous"
}
````
Note that this is meant mainly for a module/deployment maintainer to set-up the plugin default, static configuration.
Moreover, it is advised to use ENV setup (see `/env/README.md`) to override necessary configurations. 
- `id` is a required value that defines module ID as well as it's variable name (everything is set-up automatically)
- `name` is the module name
- `description` is a text displayed to the user to let them know what the module does: it should be short and concise
- `author` is the module author
- `includes` is a list of JavaScript files relative to the module folder to include
- `requires` array of id's of required modules (libraries)
- `enabled` is an option to allow or disallow the module to be loaded into the system, default `true`
- `permaLoad` always loads the module within the system if set to `true`, default `false`

## Plain Modules
Any code can be a module. You can clone a npm package and export as xopat module (there is a task for it).
You can add requirement for another module and just extend/integrate new feature. You can
export global window variable. And so on. Note though, that due to loosely coupled architecture,
you should think about how other access your code - usually, you want to attach to a global variable or namespace.

## xOpat Modules
xOpat modules bring powerful features - configurable options, IO support, and more - the list is below.
Modules can be defined JUST ONCE per a module, and the module class is auto-exported as ``xmodules`` variable.
The list of features is below. Similar to plugins, you need to call ``addModule(id, Class)`` to register the module.


##### Built-in options
Unlike plugins, module options are usually built-in centered, or used to cache values - vales
are actually not stored anywhere, unless the cache itself is being persisted by overriding xOpat storage API.
- `ignorePostIO` - see below the default IO lifecycle

#### Basic DO's
The integration to the global scope, application etc. is left to the module itself.
You should not pollute the global scope (`window`...) and follow the following:
 - attach itself to a hierarchy of existing dependencies if you depend on them logically
    - OSD snapshots and OSD plugins usually attach themselves to ``window.OpenSeadragon`` 'namespace'
 - otherwise, add only few new elements to the ``window`` object (especially make sure these are visible, later 
 modules and plugins will be included in `<script>` mode `module`)
    - prefer the use of XOpat API where possible
    - extend with helper classes your main class namespace
    - expose only what's needed, possibly instantiate as singleton if the module should exist just once, such as annotations canvas
 - any attached HTML to the DOM must be attached by the provided API (see `USER_INTERFACE` global variable)
    - avoid working with HTML in modules where possible - modules should implement logics, not UI
    - if you need to add HTML to DOM, think rather about splitting your implementation to the module (logics) and
    a plugin (UI)
 - do not add HTML to DOM directly (unless you operate a new window instance), use ``window.USER_INTERFACE`` API instead
If your entity works with a viewer instance, the xOpat viewer can have multiple viewers open at the same time.
 Make sure you know viewer lifecycle from events of the VIEWER_MANAGER and that you use ``viewer.uiqueId`` to
 reference the viewer. There is also ``viewer.id`` which is suitable to use only if you care about the viewer
 position/element, **not the data it opens**.

> **IMPORTANT.** Please respect the viewer API and behavior. Specifically, 
> respect the ``APPLICATION_CONTEXT.secure`` flag parameter
> and provide necessary steps to ensure secure execution if applicable.

## NPM Support and UI
Please, [see development basics](../DEVELOPMENT.md) on how to develop with NPM and have live UI support.
Also, [read ui specification](../ui/README.md) and get to know available UI elements.
    
## Modules: Extensions
Extensions are unconstrained code libraries with no (or little) constrains; but without features. Only basic rules 
above apply; the module is self-organizing. Note that many features (translation, data IO, access to metadata) is
not supported. Example are `colormaps`, adding only a dictionary of static data definition, or `webgl` module that
is implemented in a way not relying on xOpat core which makes it use-able with any OpenSeadragon library. 

The text 
below describes ``xOpat Modules`` features only.

## Modules: xOpat Modules
More advanced modules extend one of ``XOpatModule`` or `XOpatModuleSingleton` classes that provide numerous features 
(localization, metadata and options data access, IO support and more). Should the plugin create and export data,
the ``XOpatElement`` API should be used so that IO is handled flawlessly.


### Interface XOpatModule
Modules that inherit from `XOpatModule` support following features:
````js
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
 * Root to the modules folder
 */
static ROOT;
````

### Interface XOpatModuleSingleton extends XOpatModule
Modules that inherit from `XOpatModuleSingleton` should instantiate the module as `ModuleClass.instance()`.
````js
/**
 * Get instance of the singleton
 * (only one instance can run since it captures mouse events)
 * @static
 * @return {XOpatModuleSingleton} manager instance
 */
static instance();
/**
 * Check if instantiated
 * @return {boolean}
 */
static instantiated();
````

> #### Note on `XOpatViewerSingleton`
> The `XOpatViewerSingleton` is not a module (do not confuse it like so), it is instantiated per viewer.
> Unlike modules, you need to call ``registerViewerSingleton(XOpatModuleViewerSingleton)``.
> Multiple such classes can exist within a module, as they do not define a module.
> Instead of ``registerViewerSingleton``, you can call `requireViewerSingletonPresence`
> to ensure that the singleton is instantiated along with each viewer without explicitly telling it so.

### Selected global API functions
#### `APPLICATION_CONTEXT::getOption(key, defaultValue=undefined)`
Returns stored value if available, supports cookie caching and the value gets exported with the viewer. The value itself is
read from the `params` object given to the constructor, unless cookie cache overrides it. Default value can be ommited
for build-in defaults, defined in the viewer core.

#### `APPLICATION_CONTEXT::setOption(key, value, cache=true)`
Stores value under arbitrary `key`, caches it if allowed. The value gets exported with the viewer. 
The value itself is stored in the `params` object given to the constructor.

#### `APPLICATION_CONTEXT::getData(key)`
Return data exported with the viewer if available. Exporting the data is done through events.

#### Viewer/session mutation entrypoints
Modules that need to drive viewer state should use the public runtime entrypoints instead of mutating config/world state directly.

- `APPLICATION_CONTEXT.openViewerWith(...)`
  - main transaction entrypoint for opening or synchronizing viewer state
- `APPLICATION_CONTEXT.updateViewerSelection(viewerIndex, selection, opts?)`
  - viewer-targeted switch of background and/or visualization for one viewer
- `APPLICATION_CONTEXT.replaceVisualizations(visualizations, newData?, activeVizIndex?)`
  - session-level visualization-list replacement
- `APPLICATION_CONTEXT.updateVisualization(...)`
  - compatibility alias; new code should prefer `replaceVisualizations(...)`

These methods are ambiently declared in `src/types/app.d.ts`, so workspace modules can use them without cross-importing from the core runtime.


### Events
Modules (and plugins) can have their own event system - in that case, the `EVENTS.md` description
should be provided. These events require OpenSeadragon.EventSource implementation (which it is based on).

Events can furthermore be broadcasted if the instance you want to raise on is ``XOpatViewer*Instance*`` like object,
which is alive once per active viewer window. The events to call are ``broadcastHandler`` and `cancelBroadcast`, 
the syntax is similar to the other handlers. Asynchronous versions are not yet available.

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

> Modules must not wait with initialization after locales had been loaded: modules define dependency trees that
>are not explicitly synchronized. For delayed translations, ``$.localize([selector])`` of `jqueryI18next` might be useful.
>However, most modules should act only when needed: instantiate your module after it had been used, then you are
>guaranteed your locales had been loaded if you did so at the module inclusion time.


## Dynamic Loading
As workers and js modules (recommended usage), the viewer does not offer advanced tools for
loading these scripts dynamically. You need to use **relative** file names and instantiate
your worker or import a module. Relative paths must begin in the repository root. With plugins and
modules, the easiest way is to extend appropriate interface and retrieve ``this.PLUGIN_ROOT`` or
``this.MODULE_ROOT`` respectively, against which you can import local files.

## Caveats
Modules should support IO, otherwise the user will have to re-create
the state on each reload - which might be fatal wrt. user experience. Also, you can set dirty state
using ``APPLICATION_CONTEXT.setDirty()`` so that the user gets notified if they want to leave.

Furthermore, the layout canvas setup can vary - if you work with canvas in any way relying on dimensions
or certain tile sources, make sure you subscribe to events related to modification of the canvas and update
the functionality appropriately. This includes:
 - tissue image swapping
 - visualization swapping
 
Also, **do not store reference** to any tiled images or sources you do not control.
Instead, use ``VIEWER.scalebar.getReferencedTiledImage();`` to get to the _reference_ of a Tiled Image: an image wrt. which
all measures should be done.

This is especially important now that viewer opening supports surgical world updates: a `TiledImage` that happened to represent some data earlier may be reused, replaced, or removed as the pipeline synchronizes one viewer independently from others.

# Gotchas
Check plugin's README in case you did not. The available API is described there to greater detail.

## IO Handling

xOpat ships a generic IO pipeline (`src/classes/io/`) that decouples *what* a
module persists from *where* the bytes go. Modules declare capabilities;
admins bind them to sinks (file download, GitHub, HTTP REST, custom). See
[`src/IO_PIPELINE.md`](../src/IO_PIPELINE.md) for the full reference.

Two flavors of persistence are supported per element:

- **Bundle export/import** — the whole module's state as one blob
  (annotations bundle, recorder timeline, questionaire schema, …).
  Round-trips through whatever sink the admin binds.
- **Per-item CRUD** — each entity (annotation, recorder step, answer …)
  dispatched as `create`/`update`/`delete` to a sink. Comes with a
  durable outbox so offline edits replay on reconnect.

Both are opt-in. Declare them in `include.json` and wire them in your
constructor with `initIO` + `defineResource`. The legacy
`exportData`/`importData`/`exportViewerData`/`importViewerData` overrides
and `initPostIO()` helper have been removed; existing modules that used
them have migration notes in their own `MIGRATION.md` files (see
[`modules/annotations`](annotations/), [`modules/recorder`](recorder/MIGRATION.md)).

### Declare in `include.json`

```jsonc
{
  "id": "my-module",
  "io": {
    "capabilities": [
      { "id": "bundle-export", "kind": "bundle", "label": "My module export" },
      { "id": "bundle-import", "kind": "bundle", "label": "My module import" },
      { "id": "crud:thing",    "kind": "crud",   "label": "Thing" }
    ]
  }
}
```

Set `"io": false` to hard-disable IO regardless of admin bindings.

### Wire in the constructor

```js
constructor() {
    super();
    // …other init…
    this._initIOPipeline().catch(e => console.error("[my-module] IO init failed:", e));
}

async _initIOPipeline() {
    await this.initIO({
        bundleScope: "global",            // "global" | "per-viewer" | "both"
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
                wrapped.userMessage = "Could not load my-module data.";
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
annotations module for a worked example. `"global"` is for module-wide
state spanning all viewers.

### Dispatch local mutations through the resource

Mirror in-process events to the resource so admins binding a CRUD sink get
free upstream sync:

```js
this.addHandler("thing-create", e => this.thingResource.create(e.thing));
this.addHandler("thing-update", e => this.thingResource.update(e.thing.id, e.patch));
this.addHandler("thing-delete", e => this.thingResource.delete(e.thing.id));
```

When unbound the resource is inert and these calls are no-ops. When bound
they dispatch through the configured sink with the outbox handling
offline replay automatically.

### Hydration on boot

`initIO` triggers `IO_PIPELINE.tryRestoreImport({ ownerUid })` automatically
for global state, and the loader fires the per-viewer pass on each viewer
open. Wrap the body of your `importBundle` callback in
`APPLICATION_CONTEXT.history.withoutRecording(...)` so hydration doesn't
pollute the undo stack.

### Triggering exports

Programmatically: `await APPLICATION_CONTEXT.io.flushBundleExport({ ownerUid: "my-module" })`.
The user-facing Export action (`UTILITIES.export()`) fans out to every
owner with bundle capabilities. If every bound sink for your module
refuses, the pipeline's automatic `file-download` fallback kicks in so
the user always walks away with their data.

### Errors

Sink refusals (`{ ok: false, refused: true, userMessage }`) and exceptions
thrown from `importBundle` / `exportBundle` automatically surface as
12-second toasts (error-level when a `userMessage` is supplied,
warning-level otherwise) via `IOPipeline.surfaceRefusal`.

## Viewer Multiplexing
There can be multiple viewers open at once. You might need to create:
 - custom viewer-oriented menus: use ``VIEWER_MANAGER.getMenu(...)`` method to access desired menu component and add custom content
 - custom viewer-oriented data models: use ``XOpatViewerSingletonModule`` if you need the module API, or `XOpatViewerSingleton` if you need only instance per viewer.

### ``XOpatViewerSingleton``
The `XOpatViewerSingleton` or `XOpatViewerSingletonModule` comes with helper APIs that ease the multiplexing management. You can either keep ``XOpatViewerSingletonModule`` X instances per viewer,
or rather offer single module `XOpatModuleSingleton` interface that internally owns multiple `XOpatViewerSingleton`s, which is usually nicer to users. These classes
exists one per active viewer, and have ``destroy()`` you can use to react on viewer context being lost. By default, instances ARE NOT
created, only when one requests the instance with ```MyViewerSingleton.instance(viewerRefOrViewerUID)```. If you want to force
instance creation per viewer automatically, call ``requireViewerSingletonPresence(MyViewerSingleton)``.

For dynamically or lazily loaded singletons, use the loader helper APIs (similar to global singletons). Ensure that `className` accurately matches the expected context:

````js
// Wait for instance creation for a specific viewer
this.integrateWithViewerSingletonModule('MyViewerSingleton', viewerRef, async (module) => {
    //...
});

// Or attempt directly fetching it
const mod = viewerSingletonModule('MyViewerSingleton', viewerRef);
````

The following global accessors are part of the supported ambient surface for modules:

- `plugin(id)`
- `singletonModule(id)`
- `viewerSingletonModule(className, viewerRef)`
- `registerViewerSingleton(SingletonClass, className?)`
- `requireViewerSingletonPresence(SingletonClass)`
