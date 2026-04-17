# UI Component System

You can build and re-use components using ``Van.js``.

### Development
Develop & test components independently of the viewer:

- use npm tasks or grunt directly to develop UI (see [development guidelines](../DEVELOPMENT.md))
  - you can develop directly in the running viewer, or
  - using grunt watch task, a separate UI playground page should be accessible on [this page](http://localhost:9000/ui/test_ui.html)
- each file is documented in its module
  - see README files in each directory
- dark mode theme is set by data-theme to the body
  - DO NOT use the tailwind dark selector, rely on the DaisyUI theme

Example:
~~~ js
// we define new collapse
var c1 = new UI.Collapse({
    summary: "hello there",
}, div("general kenobi")); // we can put different components into another ones

// we append it to the div we want:
c1.attachTo(document.getElementById("workspace"));
~~~

### Directory structure

- **`classes/`** — reusable UI component building blocks (see [`classes/README.md`](classes/README.md))
  - **`classes/elements/`** — atomic elements (Button, Input, Checkbox, Dropdown, …)
  - **`classes/components/`** — composed components (Menu, Toolbar, Modal, FloatingWindow, …)
  - **`classes/mixins/`** — shared behaviours (VisibilityManager, utility helpers)
- **`services/`** — singleton UI services that hold a unique position in the viewer (see [`services/README.md`](services/README.md))
  - `AppBar` — top navigation bar with Edit/View/Plugins menus
  - `MobileBottomBar` — mobile-specific navigation bar
  - `FloatingManager` — manages z-ordering of floating panels
  - `FullscreenMenus` — full-screen overlay menu system
  - `GlobalTooltip` — singleton tooltip
- **`index.mjs`** — ES module entry point; compiled to `index.js` by esbuild
- **`index.js`** — bundled output (do not edit directly; rebuild with `npm run build` or `grunt build`)
- **`test_ui.html`** — standalone development sandbox for iterating on components without the viewer

### Building

The bundle is generated from `index.mjs` using esbuild:

```sh
npm run build        # full build (includes UI bundle)
npm run dev          # starts dev server + tailwind watcher
npm run dev-ui       # opens the UI component playground only
npm run watch-ui     # watches UI sources and rebuilds bundle on change
```

After editing any `.mjs` file in `ui/`, rebuild the bundle so `ui/index.js` reflects your changes.