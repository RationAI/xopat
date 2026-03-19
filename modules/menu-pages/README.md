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
const builder = new AdvancedMenuPages("my-module");
```

Each instance is tied to a module ID (`uid`) to ensure unique DOM IDs for menu items.

---

## Building Menus

The main entrypoint is:

```js
builder.buildMetaDataMenu(config, sanitizeConfig);
```

* `config`: an array of menu page specifications (see below).
* `sanitizeConfig`: `false` (no sanitization), `true` (default sanitize-html), or an object (custom sanitize-html config).

### Menu Page Specification

```jsonc
{
  "id": "optional-id",
  "title": "Main Section Title",   // required
  "subtitle": "Tooltip subtitle",  // optional
  "icon": "fa-cogs",              // optional FontAwesome icon name
  "main": true,                    // marks this page as the main parent
  "page": [ ...elements... ]       // array of element specifications
}
```

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

All other types resolve to compiled `UI` classes. The mapping is forgiving:

* `button` → `UI.Button`
* `fa-icon`, `faicon`, `FAIcon` → `UI.FAIcon`
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

```json
{
  "type": "button",
  "class": "btn btn-primary",
  "children": [
    { "type": "fa-icon", "name": "fa-play" },
    " Run"
  ]
}
```

#### Checkbox

```json
{ "type": "checkbox", "label": "Enable feature", "checked": true }
```

#### Dropdown

```json
{
  "type": "dropdown",
  "label": "Mode",
  "items": ["2D", "3D"]
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
