# xOpat LLM Coding Guidelines

This document serves as a comprehensive guide for Large Language Models (and human developers) on how to write code for the xOpat repository. It outlines key architectural patterns, strict coding rules, and core concepts to ensure consistency and correctness within the viewer's ecosystem.

## 1. General Code Style and Practices

- **Strict Separation of Concerns**: xOpat extensively uses logical domains divided into core application components (`src/`), plugins (`plugins/`), and modules (`modules/`).
- **No Direct Imports Across Boundaries**: You cannot use ES6 `import` to bring in functionality from other plugins, modules, or the core application directly. Instead, communication happens via **global variables and the CORE API** exposed through `loader.js` and system initialization:
  - `window.VIEWER_MANAGER` (manager for OSD viewers)
  - `window.USER_INTERFACE` (core generic UI operations)
  - `window.UTILITIES` (system utilities)
  - Modules and Plugins instances: accessible via `window.xmodule.<name>` and `window.xplugin.<name>`, or safer by using `plugin('id')` and `singletonModule('id')` and `viewerSingletonModule('className', 'viewerLikeRef')`.
- **CSS / Styling**: Rely heavily on **DaisyUI + TailwindCSS**. Do not write custom CSS unless absolutely necessary. Do not use Tailwind's dark mode selectors directly; the application relies on DaisyUI's data-theme mechanism. Deprecate the usage of old `Primer CSS` or direct Bootstrap where possible.

> Keep best programming practices in mind - separate responsibilities, design clean interfaces, and avoid unnecessary coupling.
> Avoid underperforming code and excessive dependencies. Do NOT guess at APIs or features - ask for clarification,
> or for more code examples from the codebase if you cannot retrieve it yourself. Always ensure
> documentation is up-to-date and clear. Especially note if this 'xOpat LLM Coding Guidelines'
> document needs to be updated due to some changes in the codebase. Prefer typescript over javascript,
> however, note the loosely coupled nature of the codebase.

## 2. Modules, Plugins, and Packages

### Architecture
- **Plugins (`plugins/`)**: Deliver user-facing features, tools, or integrations with clear UI components.
- **Modules (`modules/`)**: Shared libraries and hidden logical extensions (e.g., annotations mapping, webgl logic). 
- **Packages**: Modules and Plugins can leverage NPM and custom build logics, for example for typescript. They must have a `package.json` and a `build` sequence. 
The build must produce an `index.workspace.js` file (via `esbuild` or custom bundlers), which is the unified bundle that xOpat will load dynamically.
Alernatively, this file can be present as the module main file and the build can be skipped.


#### Typescript and dependencies
Modules, plugins and core are loosely coupled. No direct import between them can happen. Types need
to be available as ambient declarations for global IDE validation. Apis must be exported globally
to be accessible from the core, or rely on automatic exposal through the ``addModule`` or `addPlugin`
calls. Reuse functionality from other modules or plugins by requesting hard dependencies via include.json,
or by using the loader API to listen for conditional availability of a module or plugin (integrate if available, otherwise skip).

### Structure & `include.json`
Every plugin and module requires an `include.json` containing metadata (like `id`, `name`, `description`).
- Modules declare dependencies on other modules using the `requires` array.
- Plugins declare external dependencies via the `includes` array or `modules` array.

## 3. The `XOpatElement` API (Plugins and Modules)

Always extend `XOpatPlugin`, `XOpatModule`, or `XOpatModuleSingleton` when creating new system features.

### Core Lifecycle & Setup
- **`constructor`**: Accepts the instance ID. Call `super(id)`. Do not interact with the DOM or heavy global APIs here, as the system is still spinning up.
- **`pluginReady()` / Events**: Override this or listen to `plugin-loaded` events to bootstrap the UI and attach your logics to the `USER_INTERFACE` or `VIEWER_MANAGER`.
- **Metadata and Configs**: 
  - `getStaticMeta(key)`: read fields from `include.json`.
  - `setOption(key, value)` / `getOption(key)`: manage dynamic configuration and user options. It saves these to the exported visualizer session.

### Save & Load Data (IO)
Do not create random backend fetch calls to persist state files. Inherit and override the built-in IO methods:
- Override `exportData(key)` and `importData(key, data)` for global data.
- Override `exportViewerData(viewer, key)` and `importViewerData(viewer, key, data)` for viewer-bound state.
- Initialize it by calling `this.initPostIO({ exportKey: 'my_data' })` in the constructor.

### Translation
- Built-in localization support uses `this.loadLocale(locale, data)`. 
- To use translations dynamically, use `$.t('translation_key')`.

## 4. HTTP and RPC (`HttpClient`)

**NEVER use native `fetch` or `XMLHttpRequest` when communicating with upstream APIs, especially LLMs or secured endpoints.**

Use `window.HttpClient`. It tightly integrates with the user authentication system (`xOpatUser`), meaning it will automatically inject JWT tokens, CSRF tokens, and resolve proxied paths securely.

```javascript
// Example of HttpClient usage
const client = new HttpClient({
  proxy: "cerit", // The alias defined in server config 
  baseURL: "/api/v1",
  auth: {
    contextId: "core", // specific auth context if required
    types: ["jwt"],    // required auth verifiers
    required: true
  }
});

const response = await client.request("data", { method: "POST", body: { object: 'goes here' } });
```

## 5. UI and Custom Component System

xOpat uses `Van.js` as the underlying reactive logic for its UI Components, heavily abstracted by `ui/classes/BaseComponent`.

### Building UI Components
- **Do not write direct HTML string templates for complex reactive parts or use jQuery DOM appends for app-state mechanics**.
- Extend `BaseComponent`, define defaults in the constructor, and override `create()` to return exactly one HTML Node.
- Use `this.classMap` and `this.setClass(key, value)` to reactively map styles without re-rendering the whole tree.
- Mount components natively onto standard wrappers using `myComp.attachTo(document.getElementById('workspace'))`.

### UI Services
Crucial singletons control layouts. Do not spawn multiple instances of them:
- `AppBar`: Use its APIs to mount plugin menus (e.g., `AppBar.Edit`, `AppBar.Plugins`).
- `FloatingManager`: Essential for Floating panels to manage z-indices cleanly.
- `FullscreenMenus`: For capturing the whole viewing portal.
- `GlobalTooltip`: Emits tooltip text globally.

## 6. Multi-Viewport & Viewer Manager

**CRITICAL RULE: DO NOT USE `window.VIEWER` FOR PLUGIN DOMAIN LOGIC.**

`window.VIEWER` points to the currently active/focused OpenSeadragon instance. xOpat supports arbitrary multiple grid-viewports parsing different slides simultaneously. If a user interacts with Viewport B while Viewport A is focused, `window.VIEWER` is wrong.

### The Right Approach:
- Subscribe to specific global viewer events and derive the caller viewer:
  ```javascript
  VIEWER_MANAGER.broadcastHandler("open", async (e) => {
      const viewer = e.eventSource; // This is the instance you should query
      const meta = viewer?.scalebar?.getReferencedTiledImage()?.source?.getMetadata();
      // ...
  });
  ```
- Use `XOpatViewerSingleton` or manage an internal map of viewers to your local controller representations. 
- Use APIs like `module.getFabric(viewer)` instead of generic `module.fabric` to prevent bleeding context.

---

## 7. Useful Deep-Dive References

For a specific and more detailed understanding of each subsystem, read the following repository READMEs:

- **Root & Architecture**: 
  - [`src/README.md`](README.md) (General App Config and Init logic)
  - [`src/NPM_MODULES_PLUGINS.md`](NPM_MODULES_PLUGINS.md) (Node Package integrations)
- **Plugin & Module Design**: 
  - [`plugins/README.md`](../plugins/README.md)
  - [`modules/README.md`](../modules/README.md)
- **Core APIs & Communication**:
  - [`src/EVENTS.md`](EVENTS.md) (Lifecycle events and system broadcasts)
  - [`src/HTTP_CLIENT.md`](HTTP_CLIENT.md) (HttpClient, Token Verifiers, and Upstream Proxy integrations)
- **UI Architecture**:
  - [`ui/README.md`](../ui/README.md) (Design system setup)
  - [`ui/classes/README.md`](../ui/classes/README.md) (Developing via Van.js and `BaseComponent`)
  - [`ui/services/README.md`](../ui/services/README.md) (Singletons controlling layout regions like `AppBar`)
- **Advanced State Management**:
  - [`src/MULTI_VIEWPORTS.md`](MULTI_VIEWPORTS.md) (How to design plugins not to break when multi-view instances are running)
