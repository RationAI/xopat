# Advanced Menu Pages

See the API of ``menu-pages`` module, this plugin only forwards its configuration to the module.
Supports ``data`` property - the configuration sent to the module. It can be either an array of
configurations or a single configuration (also an array).

Sanitization is enabled via ``sanitizeConfig`` param (either in configuration or in `include.json`).
This param accepts ``true`` , `false`, `{....}` or object configuration (see the menu-pages module docs).

## Placement target

Pages can be mounted in two places. Set the plugin-level default via the ``target`` param
(in the session config or `include.json`):

| `target`   | Where the pages appear                                                        |
|------------|-------------------------------------------------------------------------------|
| `plugins`  | Fullscreen **Plugins** menu (default), under this plugin's entry.             |
| `viewer`   | Global per-viewer **right-side** menu (toggled by `params.ui.globalMenu`).    |
| `both`     | Both of the above.                                                            |

Any individual page may override the default by setting its own ``target`` property:

````json
{
  "target": "plugins",
  "data": [
    { "title": "Always in Plugins menu", "page": [ /* ... */ ] },
    { "title": "Also in the viewer dock", "target": "both", "page": [ /* ... */ ] },
    { "title": "Only in the viewer dock",  "target": "viewer", "page": [ /* ... */ ] }
  ]
}
````

> Note: the legacy ``main`` page property is no longer used — pages render as sibling
> submenus under one entry. See the menu-pages module docs.


Example configurations (contents of ``data`` property):

````json
[
  {
    "title": "My Main Page",
    "subtitle": "Contents 1",
    "page": [
      {
        "type": "header",
        "classes": "f1-light",
        "title": "Header 1"
      }, {
        "type": "text",
        "content": "This page is generated from the custom pages module."
      }, {
        "type": "columns",
        "children": [
          {
            "type": "text",
            "content": "Text in the first column. Cool, huh?"
          },
          {
            "type": "text",
            "content": "Text in the second column. Also pretty cool."
          }
        ]
      }
    ]
  },
  {
    "title": "Contents 2",
    "page": [
      {
        "type": "header",
        "classes": "f1-light",
        "title": "Header 2"
      }, {
        "type": "text",
        "content": "This page is hidden within 'My Main Page'."
      }
    ]
  },
  {
    "title": "Another Main Page",
    "main": true,
    "page": [
      {
        "type": "header",
        "classes": "f1-light",
        "title": "Vega"
      }, {
        "type": "text",
        "content": "This is page on the same level as the first page. Moreover, it contains a graph!"
      }, {
        "type": "vega",
        "vega": {
          ...
        }
      }
    ]
  }
]
````
