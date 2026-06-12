Run xOpat from a hosted, collaborative notebook (for example Google
Collaboratory). As with [Jupyter](jupyter_deployment.md), the notebook is the
**opener** (the optional third part from the
[Deployment Overview](deployment.md)): a cell constructs a session and launches
the viewer on the relevant slides and results, while collaborators share the same
notebook.

:::info
This page documents the integration pattern. The notebook-side helper code and
environment-specific wiring are maintained with the notebook tooling; this guide
focuses on how the pieces fit together and what to watch out for in a hosted,
shared environment.
:::

## How the pieces map

| Part | Role |
| --- | --- |
| Image server | Serves WSI tiles — must be reachable from the *user's browser*, not just the notebook runtime. See [Image Server Deployment](image_server_deployment.md). |
| xOpat viewer | Hosted somewhere publicly reachable (see [Ways to host the viewer](generic_deployment.md#ways-to-host-the-viewer)). |
| Collaborative notebook | The **opener** — constructs a session and launches the viewer; shared between collaborators. |

## What's different from a local Jupyter setup

Hosted notebooks run in someone else's environment, which changes a few
assumptions:

- **Reachability.** The viewer and image server must be reachable from each
  collaborator's browser over the public internet (or a shared network) — a
  `localhost` service on the notebook runtime is not enough.
- **Cross-origin.** Embedding the viewer in notebook output and talking to the
  image server happens across origins; ensure CORS and any auth/proxy are
  configured. See [Integration](../../INTEGRATION.md) and
  [Viewer Configuration](xopat_configuration.md).
- **Secrets.** Do not embed tokens or credentials in shared notebook cells; route
  authenticated access through the viewer's auth/proxy layer instead.

## Typical setup

1. **Host the viewer and image server** at publicly reachable origins (the
   [generic deployment](deployment.md#generic-deployment) path).
2. **Construct a session in a cell** — slides, visualisation, plugins, data — the
   same way as for [Viewer Configuration](xopat_configuration.md).
3. **Open the viewer**, either embedded in the notebook output or via a link /
   POST session to the viewer backend.

## See also

- [Jupyter Integration](jupyter_deployment.md) — the same pattern for local /
  JupyterHub environments.
- [Integration](../../INTEGRATION.md) — embedding xOpat in a larger product.
