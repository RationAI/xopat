# Integrating xOpat Into Your System

This page is the front door for integrators who want to **host the viewer**,
**point it at slides**, **feed it sessions**, and **drive or read it back**
from a host system. Each section is a short narrative plus an outbound link
to the doc that owns the deep dive.

If you are authoring a plugin or a module, jump to
[`plugins/README.md`](plugins/README.md) and
[`modules/README.md`](modules/README.md) instead — those are the right
entry points for that work.

---

## 1. Pick a host

xOpat is a static front-end bundle that needs a host to serve it and (for
non-trivial sessions) accept a POST body. Three options ship:

| Host    | When to use                                                                     | Entry point                                                                       |
| ------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Node    | Default. Plugin/module RPC, hot reload, generic proxy, multi-worker cluster.    | [`server/node/README.md`](server/node/README.md), [`docker/node/`](docker/node/)  |
| PHP     | Drop-in for existing PHP infrastructure. No RPC; needs an Apache reverse proxy. | [`docker/php/README.md`](docker/php/README.md), [`server/php/init.php`](server/php/init.php) |
| Static  | Embedded demos, kiosk, anywhere no server can run. No plugin/module dynamism, no POST.   | `grunt static` / `npm run s-static`                                               |

Fastest start:

```bash
# clone, install, build once
npm install

# Node host on http://localhost:9001 (port mapped from container 9000)
npm run docker-node
# or, without docker:
npm run s-node
# or, for hot-reload during development:
npm run dev
```

Server architecture, RPC, runtime safety and cluster mode live in
[`server/README.md`](server/README.md) and
[`server/node/README.md`](server/node/README.md).

---

## 2. Configure the environment

The viewer reads its configuration from `env/env.json` (or from the path /
inline JSON in `XOPAT_ENV`). Defaults live in
[`src/config.json`](src/config.json) and are **deep-merged** with
`env.json`'s `core.*` at boot, so an env file only needs to carry overrides
— not the full surface.

Generate a fully commented example env file:

```bash
npm install && npm run env   # runs `grunt env`
```

Field-by-field reference (slide-protocols, server proxies, plugin/module
selection mode, allowed `setup` keys) is in
[`env/README.md`](env/README.md). Authentication and proxy fields are
covered in [`src/AUTHORIZATION_AND_PROXY_AND_USERS.md`](src/AUTHORIZATION_AND_PROXY_AND_USERS.md)
and [`src/HTTP_CLIENT.md`](src/HTTP_CLIENT.md).

---

## 3. Point the viewer at slides

Slides are not addressed by URL in the session JSON. The session carries a
**`data` array of scalar DataIDs**, and a **slide-protocol registry**
(declared in env) decides how each DataID is resolved into a tile-source
URL or factory.

Minimal env snippet — one named protocol, one default, optional server-side
proxy alias so the browser sees a same-origin URL:

```jsonc
{
  "core": {
    "client": {
      "localhost": {
        "domain": "http://localhost:9001",
        "slide_protocols": {
          "wsi_service": {
            "url": "`/v3/slides/info?slide_id=${data}`",
            "proxy": "image-server"
          }
        },
        "default_background_protocol":    "wsi_service",
        "default_visualization_protocol": "wsi_service"
      }
    },
    "server": {
      "secure": {
        "proxies": {
          "image-server": { "baseUrl": "http://localhost:8080" }
        }
      }
    }
  }
}
```

The template is a backtick string with `data` (the scalar DataID) in scope;
the resolved value is either a `string` (treated as a URL — OpenSeadragon's
`TileSource.supports()` chain picks the right source) or a custom
JSON-parseable object that one of your registered protocols consumes.

For tile sources that cannot be expressed as a URL — DICOMweb, anything
that orchestrates `studies/series/instances` lookups internally — register
a **factory** entry from a plugin instead:

```js
window.SLIDE_PROTOCOLS.register({
    id: "my-proto",
    createTileSource: (ctx) => new MyTileSource({ baseUrl: "…", id: ctx.dataID }),
});
```

Then your session items use `"protocol": "my-proto"`. See
[`plugins/dicom/`](plugins/dicom/) for a worked example.

The legacy `image_group_server` / `image_group_protocol` /
`data_group_server` / `data_group_protocol` shape is still recognized and
auto-synthesized into `__legacy_bg` / `__legacy_viz` entries at boot
(`src/classes/slide-protocols.ts:313-352`) with a one-shot deprecation
warning. Migrate to `slide_protocols` when convenient — the legacy shim
is scheduled for removal.

---

## 4. Build a session

A session is a JSON object with up to five meaningful top-level keys:

| Key              | Meaning                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `params`         | Viewer settings (theme, viewport, `backgroundColor`, `activeBackgroundIndex`, …). Allowlist = the `setup` block in `src/config.json`. |
| `data`           | Flat list of DataIDs referenced by index from `background` and `visualizations`.                                                  |
| `background`     | Base-layer slides. Each entry references `data[i]` via `dataReference` and optionally carries `microns`, `visualizationIndex`, `name`, `protocol`. |
| `visualizations` | Optional shader stacks rendered on top of the background.                                                                        |
| `plugins`        | Per-plugin runtime config (optional; consumed by individual plugins).                                                            |

Minimum viable session — one slide, default protocol, no visualization:

```json
{
  "data": ["my-slide-id"],
  "background": [{ "dataReference": 0, "name": "My slide" }]
}
```

A complete example with multiple backgrounds and two visualization goals
lives at
[`docs/example_sessions/background-and-visualization.json`](docs/example_sessions/background-and-visualization.json).
The full per-field reference for `params`, `data`, `background`, and
`visualizations` is in [`src/README.md`](src/README.md); more working
sessions to copy from are under [`docs/example_sessions/`](docs/example_sessions/).

---

## 5. Hand the session to the viewer

The viewer resolves the session at boot from the first source that matches
([`src/parse-input.js:94-209`](src/parse-input.js)):

1. **POST body** field `visualization` (or alias `visualisation`). Node
   host only — PHP can POST too, but static cannot.
2. **URL hash** `#<urlencoded-json>`. Auto-rewrites to a self-POST when
   the host supports POST, otherwise parsed locally.
3. **Query string** `?visualization=<urlencoded-json>`. Subject to browser
   URL length limits; prefer POST for non-trivial payloads.
4. **Shorthand query** `?slides=a,b&masks=m1,m2`. Synthesizes one
   background per slide and a heatmap visualization per mask. Good for
   "just show these images" links from external systems.
5. **Storage fallback**: `localStorage["xoSessionCache"]` (or
   `sessionStorage`) with a 30-minute TTL — used to recover state after
   an auth redirect. Restored sessions are tagged `__fromLocalStorage`.

Examples:

```bash
# POST a session JSON to the Node host
curl -X POST http://localhost:9001/ \
     -F "visualization=$(cat my-session.json)"
```

```text
https://viewer.example.com/?slides=case-42-he,case-42-ihc&masks=tumor
```

---

## 6. Drive the viewer from a host page

The browser-side entry point is
`initXOpat(PLUGINS, MODULES, ENV, POST_DATA, PLUGINS_FOLDER, MODULES_FOLDER, VERSION, I18NCONFIG?)`
([`src/app.ts:44`](src/app.ts)). The host server renders this call into a
template with the right arguments; see
[`server/node/index.js:401`](server/node/index.js) (Node) and
[`server/php/init.php:100`](server/php/init.php) (PHP) for the canonical
wiring.

For most integrations, "drive from a host page" means:

- **Server-rendered embed.** Mount the bundle via the SSR template the
  Node/PHP host already provides, then POST the session JSON to it.
- **iframe embed.** Use a standard `<iframe src="…">` pointing at the host
  with the session encoded in the URL hash, or POST a form into the iframe.
  Core ships **no** postMessage handshake; plugins are free to add their
  own.

For the dev-mode runner and cluster topology, see
[`server/node/README.md`](server/node/README.md).

---

## 7. Read the session back out

The current viewer state serializes back to a JSON string via:

```js
const json = UTILITIES.serializeAppConfig(/* withCookies */ false,
                                          /* staticPreview */ false);
```

(See `serializeAppConfig` in [`src/loader.ts`](src/loader.ts) for the
implementation.) The output uses the **same top-level keys as the input
contract** — `params` (with live viewport merged), `data`, `background`,
`visualizations`, `plugins` — so a round-trip `serialize → POST → reopen`
reproduces the viewer state.

For persistence beyond a copy/paste — file download, REST sink, browser
storage — go through the IO pipeline; see
[`src/IO_PIPELINE.md`](src/IO_PIPELINE.md) for the capability/admin/sink
model and the bundled file-download / file-upload / http-rest / cookies /
localStorage drivers.

---

## 8. Live collaboration

Multiple users on the same session ride
`window.SESSION` (WebRTC peer-to-peer; cursor / viewport / visualization
sync ships by default). Modules opt in by registering a
`SessionSyncProvider` and declaring `"sessionCompatible"` in their
`include.json`. Full lifecycle, snapshot/delta contract and echo-suppression
rules are in [`src/SESSION.md`](src/SESSION.md).

---

## 9. Extending OpenSeadragon for digital pathology

The viewer extends OpenSeadragon's `TileSource` with four optional hooks
used by the UI when present
([`src/tile-source.ts:32-67`](src/tile-source.ts) is the source of truth):

- `getMetadata()` — arbitrary key/value bag surfaced in the slide-info
  panels; an `error` key flags failed layers.
- `setSourceOptions(options)` — accept caller-supplied options at runtime.
- `getThumbnail()` / `getLabel()` — return promise-of-`ImageLike` to avoid
  reconstructing previews from the lowest resolution level.

Each hook has a no-op default on the prototype, so your custom
`TileSource` only overrides what it actually supports.

---

## 10. Where to go next

| Topic                              | Doc                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| Allowed `params`, session JSON shape, URL precedence | [`src/README.md`](src/README.md)                                          |
| Env file fields & slide-protocols registry | [`env/README.md`](env/README.md)                                                          |
| Authentication, users, secrets, 401 refresh    | [`src/AUTHORIZATION_AND_PROXY_AND_USERS.md`](src/AUTHORIZATION_AND_PROXY_AND_USERS.md) |
| `HttpClient`, proxies, CSRF, JWT injection     | [`src/HTTP_CLIENT.md`](src/HTTP_CLIENT.md)                                             |
| Lifecycle events                               | [`src/EVENTS.md`](src/EVENTS.md)                                                       |
| Multi-viewport pitfalls (`window.VIEWER` warning) | [`src/MULTI_VIEWPORTS.md`](src/MULTI_VIEWPORTS.md)                                  |
| Plugins / modules — authoring, lifecycle, `include.json` | [`plugins/README.md`](plugins/README.md), [`modules/README.md`](modules/README.md) |
| NPM-built modules & bundling pipeline | [`src/NPM_MODULES_PLUGINS.md`](src/NPM_MODULES_PLUGINS.md)                                  |
| IO / persistence pipeline             | [`src/IO_PIPELINE.md`](src/IO_PIPELINE.md)                                                  |
| UI components, services, theming      | [`ui/README.md`](ui/README.md), [`ui/classes/README.md`](ui/classes/README.md)              |
| WSI service & docker compose          | [`docker/wsi-service/`](docker/wsi-service/), [`docker/node/`](docker/node/), [`docker/php/`](docker/php/) |

---

> **Removed on purpose.** Older revisions of this file included a
> hand-written `OpenSeadragon.TileSource` walkthrough and an
> ExtendedDZI / IIPServer protocol description. Those are protocol-author
> material, not integration material; the OpenSeadragon documentation
> ([`tilesource-custom-advanced`](https://openseadragon.github.io/examples/tilesource-custom-advanced/))
> covers the generic API, and [`plugins/dicom/`](plugins/dicom/) plus
> [`src/external/dziexttilesource.js`](src/external/dziexttilesource.js) are
> the worked in-repo examples.
