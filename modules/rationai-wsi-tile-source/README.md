# Standalone WSI Service

Implementation of OpenSeadragon Tile Source access to the standalone WSI service.

Modified by RationAI, the WSI service can read proprietary WSI file formats
in the standalone mode, accessing WSIs by their IDs (dependent on the mapper usage).

Also supports multifile access on the API extension `/files`.

### Usage
Configure the default viewer ENV using the named slide-protocol registry.
The template is a backtick expression with `data` (scalar DataID) in scope;
the server URL is embedded directly in the template.
````json
   "slide_protocols": {
       "empaia_standalone": "`{\"url\": \"http://localhost:8080/v3/files/info?paths=${data}\", \"type\": \"empaia-standalone\"}`"
   },
   "default_background_protocol":    "empaia_standalone",
   "default_visualization_protocol": "empaia_standalone"
````
or reference the registered name from a session via `BackgroundItem.protocol` / `DataOverride.protocol`.

You can also just set an URL to the WSI server, for example:
````json
   "slide_protocols": {
       "wsi_batch": "`http://localhost:8080/v3/batch/info?slides=${data}`"
   },
   "default_background_protocol":    "wsi_batch",
   "default_visualization_protocol": "wsi_batch"
````
But this approach has its limitations.

> The legacy `image_group_server` + `image_group_protocol` + `data_group_*`
> fields are still accepted and auto-synthesized into deprecated registry
> entries (with a one-shot console warning), but new deployments should use
> the shape above.

### Options

Options include:
``format`` - one of `jpeg, png, tiff, bmp, gif`. If omitted, non-RGB/RGBA slides default to `tiff`.
``quality`` - for e.g. jpeg the image quality to request.
``channels`` - if format is `tiff`, the channels to request (array of indexes) or `all` literal. If omitted, all channels are requested by default.
``plugin`` - name of the WSI-Service slide-reader plugin to use (e.g. `openslide`, `tifffile`, `wsidicom`). When omitted, the server auto-detects. Forwarded as the `plugin` query parameter on tile, thumbnail, label, and ICC-profile requests. To also influence the initial slide-info fetch, embed `plugin=…` directly in the `slide_protocols` URL template — `setSourceOptions` runs after info has been fetched.

You can set these options per data entry via `DataOverride.options`:

```json
"data": [
  {
    "dataID": "slide.tiff",
    "options": { "plugin": "tifffile", "format": "tiff", "channels": "all" }
  }
]
```

