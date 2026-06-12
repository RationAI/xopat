When none of the ready-made paths in the [Deployment Overview](deployment.md)
fit — bespoke infrastructure, existing hosting, a CDN — deploy the pieces
yourself. This guide covers the one decision unique to a generic deployment
(**how to host the viewer**) and the order in which to stand the parts up.

## Ways to host the viewer

xOpat can be hosted in three ways. They differ in what the backend does for you,
not in the viewer's features.

### Node.js server
The recommended general-purpose option. Runs via `npm run s-node` and serves the
viewer, dynamically discovers plugins/modules, and accepts POST sessions.
Best when you want the full feature set and are comfortable running a Node
process.

### PHP server
Equivalent backend capabilities for environments where a PHP stack is already
in place. Choose it when PHP fits your existing hosting better than Node.js.

### Server-less (static build)
xOpat can be **compiled once and served as static files** from any web server or
CDN — no live backend at all. The trade-off: features that need a backend (POST
sessions, runtime plugin/module discovery) must be baked in at build time.
Best for locked-down or CDN-only hosting.

| Option | Backend process | POST sessions | Runtime plugin/module discovery |
| --- | --- | --- | --- |
| Node.js server | yes | yes | yes |
| PHP server | yes | yes | yes |
| Server-less | none | no (build-time only) | no (build-time only) |

## Recommended path

For a first real generic deployment, follow these chapters in order:

1. **[Image Server Deployment](image_server_deployment.md)** — stand up
   WSI-Service (or connect your own server) and confirm it serves your slides.
2. **[xOpat Deployment](xopat_deployment.md)** — clone xOpat, write `env.json`,
   point it at your image server, and run the viewer.
3. **[Viewer Configuration](xopat_configuration.md)** — understand the static,
   dynamic, and cached configuration levels and open the viewer with custom
   sessions, data, and plugins.

For integrating xOpat into a larger product or backend, see
[Integration](../../INTEGRATION.md).
