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
* `sanitizeConfig`: `false` (no sanitization), `true` (default sanitize-html), or an object (custom sanitize-html config).

Both consume the **same** page specification, so a caller can send the same config to
either (or both) targets. For dynamic, viewer-dependent content in the viewer menu, use
`buildViewerMenu(getter, sanitizeConfig)` instead — the getter receives the viewer and
returns a page spec.

### Menu Page Specification

```jsonc
{
  "id": "optional-id",
  "title": "Main Section Title",   // required
  "subtitle": "Tooltip subtitle",  // optional
  "icon": "fa-cogs",              // optional icon — Font Awesome class name; renders as Phosphor if mapped in src/libs/phoshor-icons/fa-overrides.css
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

Inject raw HTML. Blocked in secure mode unless sanitization is enabled.

```json
{ "type": "html", "html": "<b>Raw HTML</b>" }
```

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

The mapping is forgiving:

* `button` → `UI.Button`
* `ph-icon`, `phicon`, `PhIcon` → `UI.PhIcon` (Phosphor — preferred for new code)
* `fa-icon`, `faicon`, `FAIcon` → `UI.FAIcon` (Font Awesome — legacy)
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

const html = builder.guessUIFromJson(json);

builder._build([
  {
    title: "Auto UI",
    page: [ { type: "html", html } ]
  }
], false);
```

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
const html = builder.guessUIFromJson(data);

builder._build([
  {
    title: "User Info",
    page: [ { type: "html", html } ]
  }
], false);
```
