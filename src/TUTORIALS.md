# Authoring Tutorials

xOpat's tutorial system has three layers:

1. **`USER_INTERFACE.Tutorials.add(...)`** — registers a tutorial entry. Defined in `src/user-interface.js`; runs at any time after `USER_INTERFACE` is available (typically in `pluginReady`, or from `app.ts` for core entries).
2. **`UI.TutorialsModal`** — the launcher modal that lists every registered tutorial as a card (`ui/classes/components/tutorialsModal.mjs`). Opened by `USER_INTERFACE.Tutorials.show()` and by the graduation-cap icon in the top-right AppBar.
3. **EnjoyHint** (`src/external/enjoyhint.js`) — the actual step driver, with the visual styling tuned to DaisyUI (glass exit pill, readable label, gradient Next/Prev buttons).

Plugins/modules that want to expose a tutorial only ever touch layer 1. The launcher and the driver are wired up for you.

## When to add a tutorial
Per `docs/web/development.md`: provide a tutorial when your feature is one of the main UI surfaces, or when a change in core behaviour would surprise an existing user. Keep each tutorial short (4–10 steps); split into multiple entries rather than a single 20-step monster — the launcher shows cards, so several short tutorials read better than one giant one.

## API reference

```js
USER_INTERFACE.Tutorials.add(
    pluginId,        // "" for core, otherwise this.id from your XOpatPlugin
    name,            // short card title (locale string recommended)
    description,     // one-line subtitle
    icon,            // Phosphor class like "ph-compass" (preferred), or legacy "fa-..."
    steps,           // ordered array of step objects (see below)
    prerequisites    // optional () => void run when the tour starts
);
```

### Step shape

Each step is an object with **exactly one** rule key plus optional metadata:

```js
{ "<action> <css-selector>": "<HTML text shown next to the element>", runIf?: () => boolean }
```

- **`action`** — `next` (advance via the EnjoyHint NEXT button) or `click` (advance only when the user actually clicks the selector — useful for opening a collapsed panel as part of the walk).
- **`css-selector`** — any jQuery selector string. See the cookbook below.
- **`runIf`** — optional function evaluated when the tour starts; if it returns falsy, the step is silently skipped. Use it for visualization-only steps, multi-viewer-only steps, etc.

Step text is HTML-capable: small formatting tags (`<b>`, `<i>`, `<u>`, `<br>`, `<code>`, `<sub>`, `<sup>`) render as expected. In xOpat builds that sanitise plugin-supplied input (see `plugins/extra-tutorials/README.md` → "Allowed HTML in text fields"), unsafe tags and attributes are stripped at registration time.

### `prerequisites`

Runs once when the user clicks the card, before EnjoyHint takes over. Use it to put the UI into the known starting state your steps assume — e.g. close floating windows, scroll a list to the top. Don't put per-step set-up here; that belongs in `runIf` (or in an earlier `click` step).

## Selector cookbook

| What you want to target | Stable selector | Source |
|---|---|---|
| The main viewer area | `#viewer-container` | `src/app.ts` (MainLayout) |
| Active OSD canvas (first viewer) | `#osd-0` | per-viewer cell id, `src/loader.ts` |
| Hide-all-UI button | `#fullscreen-button` | `ui/services/appBar.mjs:152` |
| View / Edit / Plugins AppBar tab | `#visual-menu-b-view`, `#visual-menu-b-edit`, `#visual-menu-b-plugins` | tab id pattern `${parent.id}-b-${tab.id}` |
| AppBar right-side icons (settings, tutorials, share, user) | `#top-user-buttons-menu-b-{settings,tutorial,share,user}` | same pattern, parent `top-user-buttons-menu` |
| Right-side viewer menu — Navigator tab toggle | `[id$="-right-menu-menu-b-opened-navigator"]` | per-viewer, `ui/classes/components/multiPanelMenuTab.mjs:113` |
| Right-side viewer menu — Layers (shaders) tab toggle | `[id$="-right-menu-menu-b-opened-shaders"]` | same |
| Right-side viewer menu — open Layers panel body | `[id$="-right-menu-menu-opendiv-shaders"]` | same |
| Visualisation picker `<select>` (when Layers is open) | `[id$="-right-menu-menu-opendiv-shaders"] select[name="shaders"]` | `ui/classes/components/shaderSideMenu.mjs:148` |
| The whole shader-cards container | `[id$="-panel-shaders"]` | `ui/classes/components/shaderSideMenu.mjs:244` |
| A specific shader card (by shader id) | `#${shaderId}-shader` | global, keyed by name |
| Snapshot / cache button | `[id$="-cache-snapshot"]` | `ui/classes/components/shaderSideMenu.mjs:176` |
| Right-side viewer menu — Annotations tab toggle | `[id$="-right-menu-menu-b-opened-gui_annotations"]` | per-viewer; tab id is the annotations plugin id (`gui_annotations`) |
| Annotations enable/disable toggle | `[id$="-annotations-enable-toggle"]` | `plugins/annotations/methods/viewerMenu.mjs` |
| Annotations save button | `[id$="-annotations-save"]` | same |

For plugin-registered right-side tabs in general, the toggle id is `[id$="-right-menu-menu-b-opened-${pluginId}"]` — the `${pluginId}` is whatever id was passed to the menu-tab registration (usually the plugin's `this.id`, i.e. the value from `include.json`'s `id` field).

### Why `[id$="-…"]` for per-viewer panels?

xOpat supports multiple viewers in a single page. Per-viewer DOM elements get the viewer's position id as a prefix — e.g. `osd-0-right-menu-menu-b-opened-shaders` in a single-viewer session, `osd-0-…` and `osd-1-…` in a two-viewer session. Hard-coding `#osd-0-…` would walk the wrong viewer in some setups; the suffix selector (`[id$="-right-menu-menu-b-opened-shaders"]`) lets jQuery pick the **first** matching element, which is the focused viewer in the layouts core ships today.

If your tutorial step genuinely needs to point at a specific viewer (e.g. a multi-viewer LINK/sync walkthrough that explicitly compares left vs. right), use the explicit `#osd-0-…` / `#osd-1-…` ids and mention the layout assumption in the step text. Gate with `runIf` if necessary.

### EnjoyHint can't highlight collapsed elements

Layers and Navigator tabs **start collapsed** on first load. EnjoyHint's `next` highlight needs the target visible; if you point at something inside a closed panel, the tour will look broken.

Two ways to handle this:

- **Open via a `click` step** *before* the `next` step that points inside the panel (preferred). The user opens the panel themselves; the step advances automatically.
- Open programmatically in `prerequisites` (rarely needed, and it bypasses the chance to teach the user that the panel exists).

Example (the core basic tutorial uses this pattern):

```js
{ 'click [id$="-right-menu-menu-b-opened-shaders"]': $.t('tutorials.basic.openLayers'), runIf: withLayers },
{ 'next [id$="-right-menu-menu-opendiv-shaders"] select[name="shaders"]': $.t('tutorials.basic.visualizationPicker'), runIf: withLayers },
```

## Locale conventions
- Tutorial strings live under `tutorials.<area>.*` in `src/locales/en.json` (core) or `<pluginId>.tutorial.*` in the plugin's own locale file (e.g. `plugins/annotations/locales/en.json`).
- Keep step text under ~200 characters; longer text is fine when needed but wraps awkwardly in the EnjoyHint label.
- Use `$.t(...)` rather than hard-coded English. The basic tutorial in `src/app.ts:603-621` is the canonical example.

## Multi-viewer caveat

When designing a tutorial that walks per-viewer elements:

1. Prefer the `[id$="-…"]` selector form so the walk works on 1, 2, or N viewers without code changes.
2. If the focused viewer is genuinely interchangeable (the user can have either pane focused), state that explicitly in the first step's text: *"In multi-viewer sessions every panel below exists per viewer; the tour walks the focused one."*
3. For genuinely multi-viewer-only steps (e.g. linking two viewers via the scalebar LINK button), gate with `runIf: () => APPLICATION_CONTEXT.config.background.length > 1` so single-viewer sessions skip them.

## Testing your tutorial

1. Load a session that exercises the configuration variants your tutorial cares about (with / without visualizations, 1 vs. 2 viewers, plugin loaded vs. not).
2. Open the launcher via the top-right graduation-cap icon, or in DevTools: `USER_INTERFACE.Tutorials.show()`.
3. Walk through every step. On each step, confirm the highlighted element is the right one and that no `console.error` fires.
4. Repeat for at least one *negative* config — a session that should skip steps via `runIf`. Confirm the skip is silent (no leftover empty highlight, no jumps to wrong elements).
5. Hit the glass X (top-right of the EnjoyHint overlay) mid-tour — confirm the close cleans up without leaving residual overlays.
6. The e2e suite is at `test/e2e/tutorial.cy.js`; add a routine there if your tutorial has a stable selector path worth regression-testing.

## See also

- `plugins/extra-tutorials/README.md` — embedder-supplied tutorials via session config, with an optional glass welcome modal (gradient, illustration, accent palette) before auto-start.
- `src/EVENTS.md` — viewer lifecycle events you might pin tutorial registration against (`plugin-loaded`, `before-app-init`, etc.).
- `src/external/enjoyhint.css` — visual styling of the in-step label and buttons (DaisyUI-themed).
