# UI Component System

You can build and re-use components using ``Van.js``.

### Development
Develop & test components independently of the viewer:

- use npm tasks or grunt directly to develop UI (see [development guidelines](../DEVELOPMENT.md))
  - you can develop directly in the running viewer, or
  - using grunt watch task, a separate UI playground page should be accessible on [this page](http://localhost:9000/ui/test_ui.html)
- each file is documented in its module
  - see README files in each directory
- the theme is set on the body: `data-theme="<DaisyUI theme name>"` plus `data-theme-mode="light|dark"`
  - prefer DaisyUI tokens (`bg-base-100`, `text-primary`, ...) - they follow any theme
  - for genuinely dark-only CSS key on `[data-theme-mode="dark"]` (that is also what `dark:` compiles to),
    never on a theme name - deployments ship their own (see [Theming](#theming))

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

### Theming

A deployment restyles xOpat without forking `tailwind.config.js`: an element ships the themes, the operator
selects them in ENV. Three pieces, all optional.

**1. Build-time preset** - `<element>/tailwind.preset.js` (any module or plugin folder; extra paths via the
`XOPAT_TW_PRESET` env var, `path.delimiter`-separated). Only two keys are honoured:

```js
// modules/my-theme/tailwind.preset.js
module.exports = {
    theme: { extend: { fontFamily: { brand: ["Inter", "sans-serif"] } } },
    daisyui: { themes: [{
        "my-light": { primary: "#0b6e4f", "base-100": "#ffffff", "--rounded-btn": "0.25rem" },
        "my-dark":  { primary: "#3ddc97", "base-100": "#111418", "color-scheme": "dark" },
    }] },
};
```

Preset themes are *added* to the core ones; a preset cannot redefine `xOpat-*` (skipped with a warning).
Content globs, safelist and plugins stay owned by the core config. The committed `src/libs/tailwind.min.css`
contains only core themes: in dev the `twinc` watcher (`npm run dev`) picks presets up at start and rebaselines
when one changes (a newly *added* preset needs a watcher restart); image builds run `grunt themeCss`, which
rebuilds the CSS only when a preset exists.

**2. Theme names** - ENV `core.setup.branding.themes = { "light": "my-light", "dark": "my-dark" }`. The user's
auto/light/dark choice resolves to these names (unset keys fall back to `xOpat-light` / `xOpat-dark`). Names
must match `[A-Za-z0-9_-]+`.

**3. Override stylesheets** - ENV `core.setup.branding.css = ["modules/my-theme/theme.css"]`, emitted in the
page head *after* `tailwind.min.css`, `style.css` and `custom.css`, so order is guaranteed. Page-root-relative
paths or http(s) URLs only. Do not rely on an element `style.css` for overrides - it loads in the body.

Both ENV keys are operator-trusted (read from ENV, never from a session), like the rest of `branding`.

**Stable token contract** - what a theme may set and what core/plugins may read:

- DaisyUI colours: `primary secondary accent neutral base-100 base-200 base-300 info success warning error`
  and their `*-content` pairs (CSS vars `--p --pc --s --sc --a --ac --n --nc --b1 --b2 --b3 --bc --in --inc
  --su --suc --wa --wac --er --erc`).
- Shape/motion: `--rounded-box`, `--rounded-btn`, `--rounded-badge`, `--tab-radius`, `--tab-border`,
  `--border-btn`, `--animation-btn`, `--animation-input`, `--btn-focus-scale`.
- `color-scheme` per theme, and `data-theme-mode` on the body for dark-only CSS.
- Fonts and other scales through `theme.extend` in the preset (new utilities, e.g. `font-brand`).

Do **not** redefine stock utilities (`.rounded-xl`, `.shadow-*`, `.uppercase`, ...) in override CSS: plugins
expect stock Tailwind semantics and break silently. Change a token, or add a token-driven component class.
