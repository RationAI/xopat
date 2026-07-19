Run xOpat alongside a Jupyter environment so that analyses in notebooks can open
the viewer on specific slides and results. The notebook acts as the **opener**
(the optional third part described in the [Deployment Overview](deployment.md)):
a cell constructs a session and hands it to the viewer.

:::info
This page documents the integration pattern. The notebook-side helper code and
environment-specific wiring are maintained with the notebook tooling; this guide
focuses on how the pieces fit together and what each side is responsible for.
:::

## How the pieces map

A Jupyter deployment uses the same parts as any other, with the notebook added on
top:

| Part | Role |
| --- | --- |
| Image server | Serves WSI tiles to the viewer — see [Image Server Deployment](image_server_deployment.md). |
| xOpat viewer | Hosted somewhere the notebook user's browser can reach (see [Ways to host the viewer](generic_deployment.md#ways-to-host-the-viewer)). |
| Jupyter notebook | The **opener** — builds a session (slides, visualisation, plugins, data) and launches the viewer with it. |

The notebook does not replace the viewer or the image server; it orchestrates
them.

## Typical setup

1. **Stand up the viewer and an image server** reachable from where notebooks
   run (local, JupyterHub, or a cluster). For a single-machine setup the
   [Quick Start](quick_start.md) stack is usually enough; for shared
   environments follow the [generic deployment](deployment.md#generic-deployment)
   path.
2. **Make slide data available** to the image server the notebook will reference.
3. **Open the viewer from a cell** by constructing a session and either embedding
   the viewer in an output frame or opening it in a new browser tab. Sessions are
   built from the same configuration levels described in
   [Viewer Configuration](xopat_configuration.md); for programmatic, backend-style
   integration see [Integration](../../INTEGRATION.md).

## Choosing how the notebook opens the viewer

- **Embedded** — render the viewer inside the notebook output (an `IFrame`) for an
  inline, exploratory workflow.
- **New tab / link** — emit a link or POST a session to a viewer backend and open
  it full-screen; better for large slides and multi-viewport work.

Either way, the session is constructed the same way — the difference is only how
the resulting viewer is surfaced to the user.

## See also

- [Collaboratory Notebook Integration](collab_notebook_deployment.md) — the same
  pattern for hosted collaborative notebooks.
- [Viewer Configuration](xopat_configuration.md) — how sessions, data, and plugins
  are assembled.
- [Integration](../../INTEGRATION.md) — embedding xOpat in a larger product.
