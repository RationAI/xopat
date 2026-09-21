# AdvancedMenuPages Module — Usage Guide

The **AdvancedMenuPages** module allows building interactive menu pages from declarative JSON specifications. It integrates with the compiled `UI` system (`window.UI`) and supports both explicit UI element definitions and automatic UI generation from raw JSON data.

---

## Table of Contents

* [Initialization](#initialization)
* [Building Menus](#building-menus)
* [Supported Element Types](#supported-element-types)

    * [Special Root Types](#special-root-types)
    * [UI Elements](#ui-elements)
* [Automatic UI Guessing](#automatic-ui-guessing)
* [Examples](#examples)

---

## Initialization

```js
const builder = new AdvancedMenuPages(this.id); // pass the OWNER element id (e.g. plugin id)
```

The constructor argument is the **owner id** — the id of the plugin/module that owns
the menu (typically `this.id` inside an `XOpatPlugin`). Pages built via
`buildMetaDataMenu` are mounted under that owner's entry in the AppBar **Plugins**
menu through `USER_INTERFACE.AppBar.Plugins.setMenu(ownerId, ...)`, and all generated
DOM/menu IDs are scoped to it so multiple owners using this module never collide.

> Note: `this.uid` of the instance is the shared module identity (`"module.menu-pages"`)
> and is the same for every owner — it is **not** the owner id. Always construct with the
> owner's own id.

---

## Building Menus

There are two placement targets, with matching entrypoints:

```js
// (1) Fullscreen Plugins menu — under the owner's plugin entry.
builder.buildMetaDataMenu(config, sanitizeConfig);

// (2) Global per-viewer (right-side) menu — one tab per page, same content for every viewer.
builder.buildMetaDataViewerMenu(config, sanitizeConfig);
```

* `config`: an array of menu page specifications (see below), or a single one.
* `sanitizeConfig`: the sanitization **policy** for raw `{type:"html"}` content — not a
  switch. A page config may arrive with a session bundle, so "render it raw" cannot be one
  of its choices.

  | value | meaning |
  |---|---|
  | `false` / omitted | the module default allowlist (`AdvancedMenuPages.SANITIZE_DEFAULTS`) |
  | `true` | identical to `false` |
  | object | merged **over** the defaults, shallowly — this is how an operator widens the policy from `include.json` / ENV |

  The merge is shallow because sanitize-html's own is: supplying `allowedAttributes`
  replaces the whole map rather than extending it, so copy the key you are changing from
  `SANITIZE_DEFAULTS` and edit that. Passing `allowedTags: false` disables the tag check
  entirely — legitimate for an operator, and unreachable from a session, which is the
  point of reading the policy from static meta (see `plugins/custom-pages`).

Both consume the **same** page specification, so a caller can send the same config to
either (or both) targets. For dynamic, viewer-dependent content in the viewer menu, use
`buildViewerMenu(getter, sanitizeConfig)` instead — the getter receives the viewer and
returns a page spec.

> **The body reaches the menu as DOM nodes, not as an HTML string.** This module
> renders a page to markup and parses it here (inertly, via
> `BaseComponent.parseDomNodes`) before handing it over. Passing the string on
> would re-enter `BaseComponent.toNode`, whose *untrusted-text* renderer either
> shows the markup as literal text (no `SanitizeHtml` loaded — it degrades closed)
> or strips every attribute outside its own narrow allowlist, `id` included,
> which breaks any page that fills a placeholder by id after render. Keep the
> conversion here if you touch `_pageToViewerItem`.
>
> **What makes that safe is where the sanitization happens.** `parseDomNodes` does
> not sanitize, so `renderUIFromJson` sanitizes where untrusted content *enters* —
> never at the end, which would mangle the component markup the ids live on:
>
> | entry point | treatment |
> |---|---|
> | `{type:"html"}` | sanitized against `SANITIZE_DEFAULTS`, degrading **closed** to escaped text when `SanitizeHtml` is unavailable |
> | a value interpolated into an attribute (`classes`) | HTML-**escaped**. Not a duplicate of sanitizing: sanitize-html escapes text with `escapeHtml(text, false)` and leaves `"` intact, so a sanitized string still breaks out of `class="…"` |
> | `{type:"<Element>"}` | resolved against `JSON_ELEMENTS`; anything else renders nothing |
> | component options and string children | untouched — van.js and `toNode` escape them, and sanitizing here only double-escaped every label |
>
> A page spec is *data*, so it may name a presentational element, never an
> application shell. Without `JSON_ELEMENTS` the resolver reached the whole `UI`
> namespace, including `UI.RawHtml` and `UI.StatusBar`, both of which `innerHTML`
> their own input — script execution with no `{type:"html"}` node involved at all.

### Menu Page Specification

```jsonc
{
  "id": "optional-id",
  "title": "Main Section Title",   // required
  "subtitle": "Tooltip subtitle",  // optional
  "icon": "ph-gear-six",          // optional icon — Phosphor class name, see src/libs/phoshor-icons/style.css
  "page": [ ...elements... ]       // array of element specifications
}
```

Each page becomes one submenu under the owner's Plugins-menu entry. Passing multiple
page objects produces multiple sibling submenus grouped under that single entry.

---

## Supported Element Types

### Special Root Types

#### `vega`

Embed a Vega visualization.

```json
{ "type": "vega", "vega": { /* Vega spec */ }, "classes": "m-2" }
```

#### `columns`

Arrange children into equal-width columns.

```json
{
  "type": "columns",
  "classes": "gap-2",
  "children": [
    { "type": "button", "text": "Left" },
    { "type": "button", "text": "Right" }
  ]
}
```

#### `html`

Author-supplied markup, always filtered through the sanitization policy — there is no
raw mode, and `secureMode` no longer changes anything here.

```json
{ "type": "html", "html": "<b>Formatted text</b>" }
```

The default allowlist is `HTML_ALLOWLIST` (`ui/classes/baseComponent.mjs`) widened by
exactly two groups: `details`/`summary` (this module's collapse idiom) and inert
text-structure tags (`figure`, `blockquote`, `dl`, `abbr`, `time`, …). Plus the `id`
attribute, which is the placeholder contract this module is built around.

Not allowed, and not oversights: `script`, `style`, `iframe`, `object`, `embed`, `form`
and every form control; any `on*` attribute; the `style` attribute; the `data-*` glob
(`data-action` drives delegated app handlers). Nor `svg` — `<foreignObject>`/`<animate>`
are script surface, and htmlparser2 lowercases attribute names, so `viewBox` breaks
without `parser: {lowerCaseAttributeNames: false}` anyway. An operator who needs inline
SVG opts in explicitly:

```json
{ "sanitizeConfig": { "allowedTags": ["svg", "path", "…"], "parser": { "lowerCaseAttributeNames": false } } }
```

> **`id` caveat.** Allowing `id` on markup you do not control enables DOM clobbering of
> another element's `getElementById` target — an integrity nuisance, not code execution.
> A deployment that cares drops it by overriding `allowedAttributes`.

If `sanitize-html` is not loaded the content degrades **closed**: it renders as escaped
text, and a one-shot module load is requested so the degrade is temporary. The build
entry points avoid the degraded first render by waiting for the module when — and only
when — the config actually contains a `html` node (`AdvancedMenuPages.needsSanitizer`),
so a placeholder-only page stays synchronous.

#### `newline`

Insert a horizontal divider line.

```json
{ "type": "newline" }
```

---

### UI Elements

All other types resolve to compiled `UI` classes. The `type` field is the element
discriminator and is stripped before the remaining keys are forwarded as the component's
options; `children` is likewise consumed as child nodes, not an option.

> **Static-JSON limitation.** Options whose values must be **functions** cannot be expressed
> in JSON. This includes behavioural handlers (`onClick`) and the components' functional
> enum properties (e.g. `Button.TYPE.PRIMARY`, `Button.SIZE.LARGE`) — passing them as strings
> throws in `BaseComponent._applyOptions`. Use the `base`/`extraClasses` string options for
> styling instead, and reserve interactive components for code-built UIs (`buildViewerMenu`
> getters, or `BaseComponent` directly).

The mapping below is an **allowlist**, not a convenience table: a `type` outside it
renders nothing at all. Name *matching* stays forgiving (exact, PascalCase, alias), but
what a JSON page may instantiate does not — see `AdvancedMenuPages.JSON_ELEMENTS`.
Anything else belongs in a code-built UI (`buildViewerMenu` getters, or `BaseComponent`
directly), where the author is the deployment rather than the session.

* `button` → `UI.Button`
* `ph-icon`, `phicon`, `PhIcon` → `UI.PhIcon` (Phosphor — preferred for new code)
* `fa-icon`, `faicon`, `FAIcon` → `UI.PhIcon` (legacy spellings, kept so old declarations keep parsing)
* `title`, `header`, `heading` → `UI.Title`
* `checkbox` → `UI.Checkbox`
* `dropdown` → `UI.Dropdown`
* `menu` → `UI.Menu`
* `tabsmenu` → `UI.TabsMenu`
* `multipanelmenu` → `UI.MultiPanelMenu`
* `fullscreenmenu` → `UI.FullscreenMenu`
* `join` → `UI.Join`
* `div` → `UI.Div`

#### Title

```json
{ "type": "title", "text": "Section", "level": 3, "separator": true }
```

#### Button

Use `base` for the button classes (not `class`). `onClick` cannot be set from JSON, so a
JSON button is static — for behaviour, build it in code.

```json
{
  "type": "button",
  "base": "btn btn-primary",
  "children": [
    { "type": "ph-icon", "name": "ph-play" },
    " Run"
  ]
}
```

#### Checkbox

```json
{ "type": "checkbox", "label": "Enable feature", "checked": true }
```

#### Dropdown

The header label is `title` (not `label`), and `items` must be **objects** with an `id`
(strings are not accepted — `Dropdown` keys items by `item.id`):

```json
{
  "type": "dropdown",
  "title": "Mode",
  "items": [
    { "id": "2d", "label": "2D" },
    { "id": "3d", "label": "3D" }
  ]
}
```

#### Menu

```json
{
  "type": "menu",
  "items": [
    { "text": "File", "children": [
        { "text": "Open" },
        { "text": "Save" }
    ]},
    { "text": "Edit" }
  ]
}
```

#### TabsMenu

```json
{
  "type": "tabsmenu",
  "tabs": [
    { "label": "Settings", "page": [
        { "type": "checkbox", "label": "Show grid" }
    ]},
    { "label": "About", "page": [
        { "type": "html", "html": "<p>Version 1.0</p>" }
    ]}
  ]
}
```

---

## Automatic UI Guessing

The module includes a helper:

```js
const html = builder.guessUIFromJson(data, sanitizer?, { title, maxDepth, maxArrayItems });
```

* **data**: arbitrary JSON object.
* **title**: optional root title string (default "Details").
* **maxDepth**: recursion depth limit (default 3).
* **maxArrayItems**: maximum items to render from arrays (default 25).

### Heuristics

* **Booleans** → Checkbox with label.
* **Numbers** → Labeled value.
* **Strings** → Labeled text; long strings as multiline.
* **Arrays**

    * Primitives → rendered as badge chips.
    * Objects → nested sections with titles.
* **Objects** → section titles + recursive rendering.

### Example

```js
const json = {
  some_item: 123,
  someNested: {
    arrayOF_VALUES: [1, 2, true],
    "some value": true
  }
};

// Pick the strategy at construction; every build entry point then uses it.
const builder = new AdvancedMenuPages(myPluginId, "guessUIFromJson");
builder.buildMetaDataMenu([{ title: "Auto UI", page: [json] }]);
```

> Do **not** round-trip the output back in as `{type:"html", html}`. That treats the
> module's own component markup as author-supplied HTML and runs it through the
> allowlist, which strips the ids and attributes the components need. Set the strategy
> and hand over the data.

---

## Examples

### Simple Page

```json
[
  {
    "title": "Visualization",
    "page": [
      { "type": "title", "text": "Options", "separator": true },
      {
        "type": "columns",
        "children": [
          { "type": "checkbox", "label": "Show grid" },
          { "type": "dropdown", "label": "Mode", "items": ["2D", "3D"] }
        ]
      },
      { "type": "vega", "vega": { /* spec */ } }
    ]
  }
]
```

### Auto-Generated UI Page

```js
const data = { user: "Alice", active: true, roles: ["admin", "editor"] };

const builder = new AdvancedMenuPages(myPluginId, "guessUIFromJson");
builder.buildMetaDataMenu([{ title: "User Info", page: [data] }]);
```
