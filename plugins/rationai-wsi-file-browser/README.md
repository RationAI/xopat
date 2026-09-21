# Local File Browser

This plugin allows to browse local files using the [RationAI WSI Service](https://github.com/RationAI/WSI-Service/) slide provider.
It is not compatible with other provider APIs and expects the WSI service to be running.

## Configuration

Both keys are deployment-controlled (`include.json`, overridable per deployment
under `ENV.plugins["rationai-wsi-file-browser"]`):

| Key | Meaning |
| --- | --- |
| `wsiService` | Absolute URL of the WSI Service. Required unless `proxy` is set; must parse as a URL, and a corrupt value is reported with the key and the value rather than throwing per listing. |
| `proxy` | Server proxy alias (`core.server.secure.proxies.<alias>`) to route the listing through. Requests then travel `/proxy/<alias>/v3/...` on the viewer origin, so the upstream needs no CORS and its origin never reaches the browser. `wsiService` is unused in this mode. |

Requests go through `window.HttpClient`, which injects the CSRF token a proxied
request needs. `env/parts/transport/proxy-image-server.json` is the shipped
example of the proxied form (`npm run up:dev -- image-proxy`).
