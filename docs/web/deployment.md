xOpat is **server-agnostic** and has no hardwired backend: deploying it means
wiring together a few independent pieces and choosing how to host the viewer
itself. This page introduces the moving parts and the deployment options so you
can pick the right path before diving into the step-by-step guides.

:::tip
Just want to see it running on your machine? The [Quick Start](quick_start.md)
boots everything inside Docker in one command. Come back here when you want to
deploy for real.
:::

## The moving parts

Two pieces are the **basic requirement** to get xOpat running at all:

1. **An image server** — reads your whole-slide images and serves their tiles
   over HTTP. xOpat does not read WSI formats itself; it connects to a server
   that does. You can use the reference RationAI
   [WSI-Service](https://github.com/RationAI/WSI-Service) or any server xOpat can
   speak to: All OpenSeadragon-supported (and FlexDrawer) protocols, other APIs through
   modules/plugins, or add support for your custom server with a single file.

2. **The xOpat viewer** — the browser application, statically configured
   (`env.json`) to know which image server(s) to talk to and which protocol to
   use. Optionally backed by a server (Node.js or PHP) for parsing plugins and
   modules and for accepting POST sessions.

These are decoupled on purpose: you can point one viewer at several image
servers, or several viewers at one server, and swap either side independently.

Getting these two talking is enough to *open a slide*, but it is rarely the
whole story:

- **Full integration usually needs more configuration.** Real deployments enable
  and configure **plugins and modules** (annotations, user roles, storage
  backends, …), wire up authentication/proxy, and tune the static and
  dynamic configuration levels. See [Viewer Configuration](xopat_configuration.md)
  and [Integration](../../INTEGRATION.md) for what can be layered on top.
- **A third part is good to have: something that *opens* the viewer.** xOpat shows
  whatever it is told to show, so most products add a component that **constructs a
  session** — which slides, which visualisation, which plugins, what data — and
  launches the viewer accordingly. That "opener" can be a backend POST-session
  endpoint, or a launcher app. Without it, users have to
  assemble sessions by hand.

Unfamiliar with a term used here? See the [Glossary](glossary.md).

## Deployment considerations

There are several ways to deploy xOpat; pick the one that matches how much you
need to host and customise. They differ in *who builds the session and hosts the
viewer*, not in the viewer's features. Each links to its own guide.

### Desktop viewers
The fastest way to a working viewer on a single machine: the Dockerised stack
from the **[Quick Start](quick_start.md)** brings up an image server and the
viewer together in one command. Ideal for local evaluation, demos, and
single-workstation use.

### Jupyter & collaborative notebooks
Drive xOpat from a notebook: an analysis cell constructs a session and opens the
viewer on the relevant slides and results — the notebook plays the role of the
"opener" third part described above.

- **[Jupyter Integration](jupyter_deployment.md)** — embed or launch xOpat from a
  local/JupyterHub environment.
- **[Collaboratory Notebook Integration](collab_notebook_deployment.md)** — run
  xOpat from a hosted collaborative notebook (e.g. Google Colaboratory).

### Custom Docker Compose
When the Quick Start stack is close but not quite right, copy and adapt its
`docker-compose` files into an **ad-hoc setup**: swap the image server, add your
own backend, mount real slide storage, or pin versions. The two halves are
deployed and configured separately:

- **[Image Server Deployment](image_server_deployment.md)** — stand up
  WSI-Service (or connect your own server) and confirm it serves your slides.
- **[xOpat Deployment](xopat_deployment.md)** — clone xOpat, write `env.json`,
  point it at your image server, and run the viewer.

### Generic deployment
For everything else — bespoke infrastructure, existing systems — deploy the
pieces yourself. The **[Generic Deployment](generic_deployment.md)** guide covers
how to host the viewer (Node.js, PHP, or server-less) and the recommended order
to stand the parts up.

For integrating xOpat into a larger product or backend, see
[Integration](../../INTEGRATION.md).
