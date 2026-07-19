# Administration & Integration

This page is for **administrators and integrators** who configure an xOpat
deployment: pointing the viewer at image servers, keeping secrets server-side,
wiring proxies and authentication, choosing where saved data goes (IO), and
deciding which plugins and modules are available. It is reference material for
the **static configuration** of a deployment.

Adjacent topics live elsewhere:

- **Where to host** the viewer (Node / PHP / server-less) and the recommended
  bring-up order — [Deployment overview](docs/web/deployment.md) and
  [Generic Deployment](docs/web/generic_deployment.md).
- **Opening the viewer with data** (sessions, URLs) —
  [Viewer Configuration](docs/web/xopat_configuration.md).
- **Authoring** plugins/modules — [plugins/README.md](plugins/README.md),
  [modules/README.md](modules/README.md).

---

## 1. The configuration model

Everything an admin sets lives in one JSON file. The viewer ships sane defaults
in [`src/config.json`](src/config.json); your deployment only supplies the
**overrides**, which are **deep-merged over those defaults** at boot. You never
copy the whole surface — just the keys you change.

The override file is resolved in this order:

1. The `XOPAT_ENV` environment variable — either a **path** to a JSON file, or
   **inline JSON**.
2. Otherwise `env/env.json`.

Generate a fully commented starter (scans every plugin/module for its config
keys):

```bash
npm install
npm run env            # writes env/env.example.json with all keys + comments
npm run env -- --minimal   # only the non-empty overrides
```

The field-by-field reference is [`env/README.md`](env/README.md); ready-made
examples live in [`env/`](env/) (e.g. `env.default.json`, `env.standalone.json`,
`env.dicom.json`, `env.chats.json`, `env.github.sink.json`,
`env.php.empaia.auth.json`).

### Environment-variable substitution

Any string value may embed environment variables, so secrets and per-host URLs
stay out of the committed file. Values are JSON-escaped automatically:

| Form | Meaning |
| --- | --- |
| `<% VAR %>` | value of `VAR`, or empty string if unset |
| `<% VAR:-default %>` | `default` if `VAR` is unset **or** empty |
| `<% VAR-default %>` | `default` only if `VAR` is unset |

### The client / server trust boundary

This is the single most important rule for a secure deployment:

:::warning
**Everything under `core` is shipped to and readable by the browser — except
`core.server.secure`, which is stripped before the page is rendered.** Put any
value you must never expose (API keys, JWT secrets, upstream tokens) inside
`core.server.secure`, and reach the protected upstream through a **proxy**
(§3). Never place a secret anywhere else in the config.
:::

The viewer also exposes whether it is running in hardened mode via
`APPLICATION_CONTEXT.secureMode` — see `secureMode` in §2.

---

## 2. Client configuration

`core.gateway` is the fallback redirect on fatal errors; `core.active_client`
picks which block under `core.client` is live. The active client block carries
the per-deployment viewer settings:

| Key | Purpose |
| --- | --- |
| `domain` | Full viewer URL incl. protocol and trailing slash. Special value `"__ORIGIN__"` resolves to `window.location.origin` at boot — for unpredictable iframe origins (e.g. notebooks). |
| `path` | Path to the viewer under the domain; `null` auto-detects. |
| `headers` | Extra HTTP headers appended to viewer requests. |
| `js_cookie_*` | Cookie policy: `js_cookie_expire`, `js_cookie_path`, `js_cookie_same_site`, `js_cookie_secure`, `js_cookie_domain`. |
| `secureMode` | Hardened mode. When `true`, session JSON may only reference **registered** slide-protocol names; inline backtick templates (a code-execution vector) are rejected. Leave `true` for any deployment exposed to untrusted session input. |
| `slide_protocols` | The image-server registry — see below. |
| `default_background_protocol` / `default_visualization_protocol` | Which registered protocol resolves background slides vs. visualization/mask layers by default. |
| `pluginSelectionMode` | Which plugins/modules are shippable — see §4. |
| `io` | Persistence routing — see §5. |

### Slide-protocol registry

A session never carries raw tile URLs. It carries scalar **DataIDs**, and the
registry decides how each DataID becomes a tile-source URL. Each entry is a
backtick template with `data` (the DataID) in scope:

```jsonc
"slide_protocols": {
  "wsi_service": {
    "url": "`/v3/slides/info?slide_id=${data}`",
    "proxy": "image-server"        // optional: route via a secure proxy (§3)
  }
}
```

A bare string is shorthand for `{ "url": … }`. The resolved value is either a
URL (OpenSeadragon picks the matching `TileSource`) or a JSON object consumed by
a protocol your plugin registered (§6). `default_background_protocol` /
`default_visualization_protocol` name the entries used when a session doesn't
specify one.

### The `setup` allowlist

`core.setup` presets viewer defaults (e.g. `locale`, `theme`, UI toggles like
`scaleBar` / `statusBar`, `viewport`, `activeBackgroundIndex`, `tileCache`,
`maxImageCacheCount`). These same keys form the **allowlist** for the session
`params` object: a session may override an allowlisted key, but unknown keys are
dropped. Full list in [`env/README.md`](env/README.md) and
[`src/config.json`](src/config.json).

---

## 3. Secure server values & proxies

Secrets and authenticated upstreams are configured under
`core.server.secure` — the block that **never reaches the browser**. A **proxy**
is a server-side alias: the browser calls a same-origin `/proxy/<alias>/…` path,
and the server attaches the secret headers and forwards the request upstream.

```jsonc
"core": {
  "server": {
    "secure": {
      "proxies": {
        "openai": {
          "baseUrl": "https://api.openai.com",
          "headers": {
            "Authorization": "Bearer <% OPENAI_KEY %>"   // secret via env var
          },
          "auth": {
            "enabled": true,
            "mode": "all",                 // "all" verifiers must pass (vs "any")
            "verifiers": {
              "jwt": {
                "secret": "<% VIEWER_JWT_SECRET %>",
                "issuer": "https://login.example.com/",
                "audience": "xopat-viewer",
                "forward": false,          // strip the viewer JWT before upstream
                "userClaimHeader": "x-user-sub"
              }
            }
          }
        }
      }
    }
  }
}
```

A proxy alias is consumed in two ways:

- from a slide protocol — `"proxy": "openai"` (§2);
- from plugin/module code — `new HttpClient({ proxy: "openai", … })`.

:::note
**All upstream calls must go through `HttpClient`.** It resolves the proxy path
and injects CSRF (`window.XOPAT_CSRF_TOKEN` → the `X-XOPAT-CSRF` header) and
auth automatically. Native `fetch`/`XMLHttpRequest` bypass this and are not
allowed.
:::

**Server-to-server RPC** is gated by `core.server.secure.rpcVerifiers`, which is
**fail-closed**: an empty `{}` rejects, and you opt a context out explicitly with
`{ "enabled": false }`. Details in
[`server/node/README.md`](server/node/README.md).

**Secret-adjacent plugin config** (an API key a plugin needs, a proxy alias it
binds to) goes in `core.server.secure.plugins.<id>` /
`core.server.secure.modules.<id>` — never in the public `plugins`/`modules`
blocks. The deep dives are
[Authorization, Proxy & Users](src/AUTHORIZATION_AND_PROXY_AND_USERS.md) and the
[HTTP Client](src/HTTP_CLIENT.md) reference.

---

## 4. Enabling plugins & modules

Non-secret, browser-visible plugin/module configuration lives in the top-level
`plugins` and `modules` objects (keyed by component `id`). These override each
component's own `include.json` defaults:

```jsonc
"plugins": {
  "slide-info":   { "permaLoad": true },   // force-load at boot
  "some-plugin":  { "enabled": true }       // opt in (whitelist mode)
},
"modules": {
  "annotations":  { "enabled": true }
}
```

- `permaLoad: true` force-loads the component at boot (and implies it is
  shippable).
- `enabled` is the explicit opt-in used by whitelist mode.

`core.client.<active_client>.pluginSelectionMode` decides what is shippable:

| Mode | A component is included when… |
| --- | --- |
| `all` (default) | it is not `enabled: false`. |
| `whitelist` | `plugins.<id>.enabled === true` in *this* env file (the component's own default does not count). |
| `available` | it is not disabled **and** every path in its `requiredConfig` resolves to a non-empty value — in **either** the public `plugins`/`modules` block **or** the secure `server.secure.plugins`/`modules` block. |

The `available` mode is how chat-style plugins self-gate: e.g. a chat plugin
declares `requiredConfig: ["proxyAlias"]`, you place the API key under
`server.secure.proxies.<alias>` and bind it with
`server.secure.plugins.<id>.proxyAlias` — the plugin appears only once that
secret is configured, and the key never reaches the browser. See
[`env/env.chats.json`](env/env.chats.json) and the selection-mode section of
[`env/README.md`](env/README.md).

---

## 5. Persistence & IO

What a plugin/module *saves* (annotation bundles, CRUD records, key/value state)
and *where it goes* are decoupled. The component declares **capabilities**; the
admin **routes** each capability to one or more **sinks**. The routing block is
`core.client.<active_client>.io` (server-side only, never URL-modifiable):

```jsonc
"io": {
  "bindings": {
    "annotations": {                       // ownerId (plugin/module id)
      "bundle-export": ["github"],          // capability → [sink, …]
      "bundle-import": ["github"]
    }
  },
  "sinkOverrides": {
    "http-rest:annotations": {              // per-deployment sink options
      "proxy": "my-api",
      "baseURL": "/v1/annotations",
      "auth": { "contextId": "core", "types": ["jwt"], "required": true }
    }
  },
  "disabled": ["some-plugin"]               // hard-disable all IO for an owner
}
```

- **Capabilities**: `bundle-export` / `bundle-import` (whole-state blobs),
  `crud:<resource>` (per-element records), `kv:<namespace>` (key/value).
  Binding a capability to `[]` disables it.
- **Built-in sinks**: `file-download`, `file-upload`, `post-data`, `http-rest`,
  `github` (KV drivers: `local-storage`, `session-storage`, `cookies`,
  `memory`, plus async `http-rest`).
- **Zero-config defaults**: with no binding, `crud:*` is inert (nothing
  persists) and bundle export falls back to the in-page `post-data` form. To
  actually persist to a backend you **must** add a binding.

IO capabilities also auto-derive matching **user-role** gates (a guest can be
denied annotation CRUD, etc.), configured under `core.roles` — see
[Users, Roles & Capabilities](src/USER_ROLES.md). The full sink/driver/capability
model, including admin-vs-module responsibilities, is in the
[IO Pipeline](src/IO_PIPELINE.md) reference;
[`env/env.github.sink.json`](env/env.github.sink.json) is a complete worked
example routing annotations to a GitHub repository through a secure proxy.

---

## 6. Developing a custom integration — where to start

When configuration alone is not enough, these are the extension points and the
in-repo examples to copy from:

- **A custom image-server protocol.** For sources that can't be expressed as a
  plain URL template (DICOMweb, multi-request lookups), register a factory from
  a plugin with `window.SLIDE_PROTOCOLS.register({ id, createTileSource })` and
  reference it by name from sessions. Worked example:
  [`plugins/dicom/`](plugins/dicom/).
- **A custom persistence sink.** Implement and register one with
  `IO_PIPELINE.registerSink(...)`, then bind a capability to it in `io.bindings`.
  See [IO Pipeline](src/IO_PIPELINE.md).
- **Custom authentication / proxy verifiers.** Add a verifier under a proxy's
  `auth.verifiers`, or integrate the user/secret model — see
  [Authorization, Proxy & Users](src/AUTHORIZATION_AND_PROXY_AND_USERS.md).
- **Richer slide metadata.** A custom OpenSeadragon `TileSource` may implement
  the optional `getMetadata()`, `setSourceOptions()`, `getThumbnail()` and
  `getLabel()` hooks (each has a no-op default). See the OpenSeadragon
  [custom tile-source guide](https://openseadragon.github.io/examples/tilesource-custom-advanced/)
  and [`src/external/dziexttilesource.js`](src/external/dziexttilesource.js).
- **Opening the viewer & reading state back.** A host system builds a session
  (POST body, URL `#hash`, or the `?slides=…&masks=…` shorthand) and can read the
  live state back out via `UTILITIES.serializeAppConfig(...)`, which round-trips
  through the same session contract. See
  [Viewer Configuration](docs/web/xopat_configuration.md),
  [Core Architecture](src/README.md), and
  [`docs/example_sessions/`](docs/example_sessions/).
- **Driving from a host page / iframe.** Mount via the server's SSR template, or
  embed an `<iframe>` with the session in the URL hash. Core ships **no**
  postMessage handshake — plugins add their own. See
  [`server/node/README.md`](server/node/README.md).

---

## 7. Where to go next

| Topic | Reference |
| --- | --- |
| Env-file fields & slide-protocol registry | [`env/README.md`](env/README.md) |
| Allowed `params`, session JSON shape, URL precedence | [Core Architecture](src/README.md), [Viewer Configuration](docs/web/xopat_configuration.md) |
| Authentication, users, secrets, 401 refresh | [Authorization, Proxy & Users](src/AUTHORIZATION_AND_PROXY_AND_USERS.md) |
| `HttpClient`, proxies, CSRF, JWT injection | [HTTP Client](src/HTTP_CLIENT.md) |
| IO / persistence pipeline | [IO Pipeline](src/IO_PIPELINE.md) |
| Users, roles & capabilities | [Users, Roles & Capabilities](src/USER_ROLES.md) |
| Lifecycle events | [Events](src/EVENTS.md) |
| Multi-viewport pitfalls (`window.VIEWER` warning) | [Multi-Viewports](src/MULTI_VIEWPORTS.md) |
| Plugins / modules — authoring, lifecycle, `include.json` | [plugins/README.md](plugins/README.md), [modules/README.md](modules/README.md) |
| NPM-built modules & bundling | [NPM Modules & Plugins](src/NPM_MODULES_PLUGINS.md) |
| UI components, services, theming | [ui/README.md](ui/README.md) |
| Hosting the viewer & server architecture | [Generic Deployment](docs/web/generic_deployment.md), [`server/README.md`](server/README.md) |
