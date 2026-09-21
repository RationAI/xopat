Run xOpat directly from a notebook. The [`xopat`](https://pypi.org/project/xopat/)
pip package automates the whole stack: it downloads the xOpat viewer and a
[WSI-Service](image_server_deployment.md) image server, starts both, wires up the
proxy so tiles load, and embeds the viewer in a notebook cell. The notebook is
the **opener** (the optional third part from the
[Deployment Overview](deployment.md)) — a cell builds a session and hands it to
the viewer.

## Quick start

```python
!pip install xopat

import xopat
from xopat import run_server

# Downloads the xOpat + WSI-Service binaries on first run (cached afterwards),
# then starts both. `data_dir` is the folder your slide files live in.
server = run_server(data_dir="path/to/slides")

# Open a slide in an embedded viewer.
xopat.display(server, "slide.tiff")

# When you're done (or before re-running run_server):
server.stop()
```

That's the whole loop: **install → `run_server` → `display` → `stop`**. The first
`run_server` downloads the binaries (tens of MB) and caches them; later runs start
instantly.

## The ropes

### `run_server(data_dir=None) -> Server`

Downloads (if needed) and starts WSI-Service and xOpat, returning a `Server`
handle. `data_dir` is the slides folder (defaults to the current working
directory). Only one server runs at a time — calling `run_server` again stops the
previous one first.

### `display(server, slide, width="100%", height=None)`

Embeds the viewer in the notebook output. The **`slide`** argument is the key
part and accepts two forms:

- **A string** — a slide id / path **relative to `data_dir`**, opened via
  `?slides=<id>`:
  ```python
  xopat.display(server, "subfolder/slide.tiff")
  ```
- **A full session config (dict)** — `data`, `background`, `visualizations`,
  `params`, `plugins` … POSTed into the viewer. This is the same configuration
  described in [Viewer Configuration](xopat_configuration.md), built inline:
  ```python
  xopat.display(server, {
      "data": ["slide.tiff", "heatmap.tiff"],
      "background": [{"dataReference": 0}],
      "visualizations": [{
          "name": "Prediction",
          "shaders": {
              "heatmap": {"type": "heatmap", "dataReferences": [1],
                          "params": {"opacity": 0.5}},
          },
      }],
  }, "100%", 600)
  ```

`width` is any CSS value; `height` is pixels (default ~800, capped at 70 % of the
window so the viewer doesn't crowd out the notebook — pass an explicit number to
opt out of the cap).

### `display_link(server, path, label=None)`

Renders a button that opens the viewer at `path` in a **new browser tab** — better
for large slides, multi-viewport work, or pages not meant to embed (e.g.
`display_link(server, "dev_setup")`). It is also the escape hatch when an embedded
iframe wedges.

### `Server` handle

`server.stop()` shuts both processes down. When a viewer comes up blank, the
`Server` carries built-in diagnostics that read the backends' own error bodies:

- `server.diagnose(slide="slide.tiff")` — probes the viewer and the real WSI
  request and prints each status code + response body.
- `server.logs("xopat")` / `server.logs("wsi")` — recent process output.
- `server.health()` — liveness, memory, and open file descriptors.

## JupyterHub

On a hub you **must** point the package at the hub's public host **before**
`run_server`, so the viewer's asset and proxy URLs resolve through the hub proxy
instead of `localhost`:

```python
import xopat
from xopat import setup_jupyterhub, run_server

setup_jupyterhub("https://your-jupyterhub-host")
server = run_server(data_dir="path/to/slides")
xopat.display(server, "slide.tiff")
```

Skipping `setup_jupyterhub` raises a loud error — without it the xopat binary
boots its built-in `localhost` client config and every asset URL points at
`http://localhost:9001`, unreachable through the hub proxy.

## See also

- [Google Colab](collab_notebook_deployment.md) — the same package in a hosted
  notebook, with two Colab-specific caveats.
- [Viewer Configuration](xopat_configuration.md) — how the session dicts above are
  assembled.
- [Image Server Deployment](image_server_deployment.md) — the WSI-Service backend
  `run_server` launches for you.
- [Integration](../../INTEGRATION.md) — embedding xOpat in a larger product.
