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
For environments where a PHP stack is already in place. It serves the viewer,
discovers plugins/modules, accepts POST sessions, and supports the secured proxy
— but it has **one gap versus Node.js: no RPC support**. Choose it when PHP fits
your existing hosting and you don't need RPC.

:::warning PHP has no RPC
**RPC** is server-side execution of plugin/module methods (`POST /__rpc/plugin/…`
and `/__rpc/module/…`) — the mechanism plugins use to run secured server-side
logic, e.g. tightly-integrated LLM/chat assistants and any feature whose
`HttpClient` call targets an RPC endpoint. On the PHP server those calls have **no
handler and fail**. The viewer itself, slides, POST sessions, and proxied upstream
requests all work; only plugins/features that depend on RPC won't. **Proxying *is*
supported on PHP** (it has its own `proxy.php`), so proxy-only features keep
working. If you need RPC, use the **Node.js server**.
:::

### Server-less (static build)
xOpat can be **compiled once and served as static files** from any web server or
CDN — no live backend at all. The trade-off: anything that needs a backend (POST
sessions, runtime plugin/module discovery, proxy, RPC) must be baked in at build
time or is simply unavailable. Best for locked-down or CDN-only hosting.

| Option | Backend process | POST sessions | Runtime plugin/module discovery | Proxy | RPC |
| --- | --- | --- | --- | --- | --- |
| Node.js server | yes | yes | yes | yes | yes |
| PHP server | yes | yes | yes | yes | **no** |
| Server-less | none | no (build-time only) | no (build-time only) | no | no |

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
