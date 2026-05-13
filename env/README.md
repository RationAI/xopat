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

### Environmental variables
You can use custom environment variables as a string values like this: ``<% ENV_VAR_NAME %>``.
If ``X=3`` then `"watch <%X%>"` will result in `"watch 3"`. The pattern used is
> ``<%\s*[a-zA-Z_][a-zA-Z0-9_]*\s*%>``

which basically says
 - start with `<%`
 - continue with any whitespace including newlines `\s*`
 - allowed a single word, name of variable, that does not start with a number: `[a-zA-Z_][a-zA-Z0-9_]*`
 - and backwards
