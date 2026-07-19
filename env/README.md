# xOpat Default Deployment Configuration

This README describes options for xOpat configurations and available core configuration details.
For details on modules and plugin configurations, see respective READMEs in given folders.

The configuration can be provided either in a file (default location `env/env.json`, override-able path in `XOPAT_ENV` 
variable) or a serialized JSON (also in `XOPAT_ENV`).

Default static configuration for plugins, modules and the viewer itself can be overridden
in ``env.json`` file. The full configuration is compiled for you (with comments) in `env.example.json`.
Only fields that are to be overridden can be present.

To compile the `env.example.json`, run

> grunt env

Then, you can simply override values you need to change, simply follow the `env.example.json` file. It looks like this:
````json
{
  "core": {
      //In particular, you will want to provide a path to redirect in case of errors
      "gateway": "../",
      "active_client": "localhost",
      "client": {
          "localhost": {
              ...
          }
      },
      ...
  },
  "plugins": [
      //here goes plugins configuration as a list of objects
  ],
  "modules": [
      //here goes modules configuration as a list of objects
  ]
}
````
To generate minimal configuration file, run

> grunt env --minimal

which strips built-in options for plugins, modules, and removes empty configuration module objects.

### Static configuration provided in a dynamic way
To provide a configuration file path, you can set 
``XOPAT_ENV`` environmental variable to specify
 - a file path, if the file exists and _is readable_, it will try to parse its contents,
 - a string data, its contents will be treated as a serialized JSON,
 - otherwise, ``env/env.json`` is used (if exists)

### `__ORIGIN__` for unpredictable iframe origins
The `core.client.<active_client>.domain` field accepts the literal token
`"__ORIGIN__"`. At browser boot, xopat replaces it with
`window.location.origin`. Use this when the deploy script cannot know in
advance which origin will actually serve the iframe — the canonical case is
Google Colab's `serve_kernel_port_as_iframe`, which serves the iframe under
a different alias than `google.colab.kernel.proxyPort(...)` returns. The
xopat `/proxy/...` route emits no CORS headers, so the effective `domain`
must match the iframe origin or every proxy fetch fails the preflight.

If you also need cookies in such a deployment, set `js_cookie_domain`
explicitly — the cookie attribute receives the raw token unchanged.

### Slide-protocol registry
The `core.client.<active_client>` block declares which image servers the viewer
talks to via the named **slide-protocol registry**:

```json
"slide_protocols": {
    "wsi_service": "`http://localhost:8080/v3/slides/info?slide_id=${data}`"
},
"default_background_protocol":    "wsi_service",
"default_visualization_protocol": "wsi_service"
```

Each entry is a backtick template with `data` (scalar DataID) in scope; the
server URL is embedded directly in the template. Names declared here can be
referenced safely from a session config via `BackgroundItem.protocol` /
`DataOverride.protocol` — including in secure mode, because the lookup is a
name, not an `eval` of user input. Plugins may add additional entries (URL
templates **or** factory protocols that build a `TileSource` directly) at
runtime via `window.SLIDE_PROTOCOLS.register(...)` — see the dicom plugin for
a factory-protocol reference.

The legacy `image_group_server` + `image_group_protocol` + `data_group_server`
+ `data_group_protocol` fields are still accepted and auto-synthesized at
boot into deprecated `__legacy_bg` / `__legacy_viz` registry entries (with a
one-shot deprecation warning). Plan to migrate new deployments to the new
shape; the legacy fields will be removed in a follow-up major.

### Plugin selection mode
The active client block carries a `pluginSelectionMode` knob (default `"all"`)
that decides which plugins the server ships to the client:

```json
"core": {
    "active_client": "localhost",
    "client": {
        "localhost": {
            "pluginSelectionMode": "available"
        }
    }
}
```

- `"all"` — every discovered plugin without `enabled: false` is shipped.
- `"whitelist"` — only plugins explicitly opted in by this env via
  `plugins.<id>.enabled = true` are shipped. A plugin's own `enabled: true`
  in `include.json` does NOT whitelist it; only the deployment ENV does. Note
  that ``permaLoad`` implies `enabled = true`.
- `"available"` — like `"all"`, plus each plugin OR module may declare
  a single `requiredConfig: ["dot.path", ...]` array in its
  `include.json`. Each path is resolved against TWO deployment-owned
  sources; a path is satisfied when EITHER carries a non-empty value:
    1. `plugins[<id>]` / `modules[<id>]` block in env.json (the public
       per-element block).
    2. `core.server.secure.plugins[<id>]` / `core.server.secure.modules[<id>]`
       (the server-only block, never shipped to the browser — natural
       home for secret-adjacent values).
  **Include.json defaults are not consulted**; only what this env
  explicitly sets in one of the two buckets satisfies the gate.
  Plugins whose required module is dropped get the existing missing-dep
  error, which is the intended UX when an upstream isn't configured.
  The plugin author lists *what* keys must exist; this env decides
  *where* each value lives based on sensitivity.

  Concrete shape for a deployment that wants DICOM and a chat plugin to
  be available, mixing both buckets according to sensitivity:

  ```json
  {
      "core": {
          "client": { "<env>": { "pluginSelectionMode": "available" } },
          "server": {
              "secure": {
                  "proxies": {
                      "openai": {
                          "baseUrl": "https://api.openai.com",
                          "headers": { "Authorization": "Bearer <% OPENAI_KEY %>" }
                      }
                  },
                  "plugins": {
                      "chat-chatgpt": { "proxyAlias": "openai" }
                  }
              }
          }
      },
      "plugins": [
          { "id": "dicom", "serviceUrl": "https://my-pacs/dicom-web" }
      ]
  }
  ```

  Both `dicom.requiredConfig` (`["serviceUrl"]`) and
  `chat-chatgpt.requiredConfig` (`["proxyAlias"]`) are satisfied — the
  former by the public `plugins.dicom.serviceUrl` entry, the latter by
  `core.server.secure.plugins.chat-chatgpt.proxyAlias`. The gate doesn't
  care which bucket carried each value, only that something did.

See `server/README.md` for the full reference and `plugins/README.md` for
the `requiredConfig` field semantics.

### Environmental variables
You can use custom environment variables as a string values like this: ``<% ENV_VAR_NAME %>``.
If ``X=3`` then `"watch <%X%>"` will result in `"watch 3"`. The pattern used is
> ``<%\s*[a-zA-Z_][a-zA-Z0-9_]*\s*%>``

which basically says
 - start with `<%`
 - continue with any whitespace including newlines `\s*`
 - allowed a single word, name of variable, that does not start with a number: `[a-zA-Z_][a-zA-Z0-9_]*`
 - and backwards
