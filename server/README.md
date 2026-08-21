# xOpat Servers

xOpat is a standalone web-browser application. Server-side execution is necessary only
due to certain capabilities browsers cannot provide:
 - parse HTTP POST data
 - scan filesystem
 - dynamically compile from configurations

There are different server implementations to provide different means of deployment.
Notable is the '_static server_' which is simply a server-less variation that does not 
support certain features and also behaves statically: needs to be compiled, and
then provides an HTML static page.

## Available Servers / Entrypoints
 - [x] Node.js Server
 - [x] PHP Server
   - no RPC support
 - [x] HTML static index page
   - no dynamic loading of modules and plugins, no server support

## Implementation

There are no implementation constraints, and so the server implementations might behave
slightly differently depending on what is possible in the given environment, and
how the server was implemented. But the server should be able to:

### Provide basic entrypoints
 - ``/`` location that opens up the viewer
 - ``/dev_setup`` that opens the developer session manual editor

All such entrypoints should be implemented using the prepared HTML templates.
See ``templates/README.md``. 

### Production Mode Baking

With `client.production` enabled, servers pre-compute ("bake") work that would
otherwise repeat on every request or cost the client extra round-trips:
 - **Core scan cache** (Node): the parsed `config.json` + ENV and the full
   plugins/modules directory scan are memoized per process
   (`_productionCoreCache` in `server/node/index.js`); page and RPC requests
   reuse the snapshot instead of re-walking the filesystem.
 - **Locale bake** (Node + PHP): every enabled module/plugin `locales/<lang>.json`
   is inlined into the page's i18next resources (namespace = element id), so the
   client performs zero locale fetches. Memoized per language on Node.
 - **Scripting `.d.ts` bake** (Node + PHP): declaration files at the documented
   convention paths (`src/classes/scripting/*.scripts.d.ts`,
   `<element>/scripting/*.d.ts`, `<element>/*.scripts.d.ts`) are inlined as
   `window.XOPAT_BAKED_DTS`; the client's `fetchDtsCached` resolves them without
   requests. Files over 256 KB are skipped with a warning.

Invalidation is restart-only — production means "baked". Dev mode never caches
or bakes, keeping locale/declaration files hot-editable. PHP recomputes bakes
per request by design (opcache does not cover `glob`/`file_get_contents`);
behavior is identical to Node, only latency differs. Deployments serving PHP
statics through Apache/nginx should additionally configure long-lived cache
headers for `?v=`-versioned asset URLs (the Node server does this natively:
`?v=` → `public, max-age=31536000, immutable`, otherwise `no-store`).

### Provide Static Configuration

Static configuration comes from the deployment, and must:
 - read default values from ``/path/to/xopat/src/config.json``
 - override these values with custom static configuration that might exist (see below)

The user-defined configuration files that are available support the following:
 - JSON with comments: being able to strip comments and parse the JSON configuration file
 - environmental variables: being able to replace ``<% ENV_VAR_NAME %>`` with relevant variable contents.
   Bash-style default values are also supported:
   - ``<% VAR:-default %>`` — use ``default`` if ``VAR`` is unset OR empty (matches bash ``${VAR:-...}``)
   - ``<% VAR-default %>`` — use ``default`` only if ``VAR`` is unset (matches bash ``${VAR-...}``)
   - example: ``http://localhost:<% XOPAT_NODE_PORT:-8080 %>``
   Substitutions that land inside a JSON string literal are JSON-escaped automatically,
   so env values containing ``"``, ``\``, or control characters cannot break JSON
   structure or inject sibling keys. Substitutions outside string context (e.g. a numeric
   port placeholder like ``"port": <% XOPAT_PORT:-8080 %>``) are inserted raw.

The user-defined overrides must respect ``env.json`` configuration and ``XOPAT_ENV`` variable:
 - if ``XOPAT_ENV`` points to a file, load that file to parse static configuration
 - if ``XOPAT_ENV`` contains a string, use this data to set up the static configuration
 - otherwise try to load ``/path/to/xopat/env/env.json`` configuration file

For the full list of process-level server environment variables (host, port,
workers, dev mode, cache, cookies, JWT secret) across the Node and PHP runtimes,
see [`ENVIRONMENT.md`](ENVIRONMENT.md).

### Parse Modules and Plugins

Scanning existing modules and plugins folder and parsing the available items:
 - scan module dependency, ensure these are acyclic and sort them in _DFS exit time descending order_
   - if we load modules in this order, we load their dependencies first
 - remove items that define ``enabled=false``
 - translate error messages if possible
 - provide for each instance these properties (atop of what is defined in the item's `include.json`):
   - set ``directory`` to path relative to `...modules/` or `...plugins/` respectively that points 
   to the location of the instance root folder
   - set ``path`` to the full relative path wrt. the domain (e.g. so that the path is a valid relative path
   the user's browser can access the item root folder and download its contents - scripts, ...)
   - set ``styleSheet`` to the path of `style.css` file if it exists in the item root folder (e.g. `path` + `style.css`)
   - set ``loaded`` to `true` if ``permaLoad=true``, otherwise `false`
   - in case of error, set ``error="description"`` property that describes the issue
 - override this plugins default configuration with relevant values from the global 
static configuration available (the environment-based config) 

#### Plugin selection mode

Servers honor the deployment-level field ``CORE.client.pluginSelectionMode``
(default ``"all"``) when building the page-level ``PLUGINS`` map shipped to
the client. In env.json you write it as
``core.client.<active_client>.pluginSelectionMode``; the loader flattens the
active client block onto ``CORE.client``, which is the path the server code
then reads. The same three modes are implemented identically by every
server backend, so the emitted ``PLUGINS`` keys must agree byte-for-byte
between PHP and Node under the same ENV — including the truthiness of
``enabled``, which both backends parse the same way (a JSON boolean; the
strings ``"true"``/``"false"`` are accepted with a warning, anything else is
undecidable and does not opt in or out).

 - ``"all"`` *(default, current behavior)* — every discovered plugin
   without ``enabled: false`` is shipped to the client.
 - ``"whitelist"`` — inverse default. A plugin is shipped only if the
   deployment ENV sets ``plugins.<id>.enabled = true``. A plugin's own
   ``enabled: true`` in include.json does NOT whitelist it. ``enabled:
   false`` in include.json is still an absolute opt-out. Plugins filtered
   out by the whitelist are dropped *silently* — they don't exist as far
   as the client is concerned (no manifest, no UI entry, not dynamically
   loadable). The intended use is per-deployment access control where
   leaking plugin identifiers is undesirable.
 - ``"available"`` — like ``"all"``, plus a per-element config-gate
   driven by an optional ``requiredConfig: string[]`` array. The array
   may be declared on the plugin's/module's ``include.json`` OR on a
   companion ``server.json`` (see below); the loader takes the union
   when both are present. Each path is resolved against TWO
   deployment-controlled sources; a path is satisfied when EITHER
   source carries a non-``undefined``/non-``null``/non-empty value:
     1. **Deployment ENV block** — ``ENV.plugins[id]`` /
        ``ENV.modules[id]``, supplied via env.json's top-level
        ``plugins``/``modules`` objects, each keyed by element id. The
        natural home for non-secret values (URLs, aliases, flags).
     2. **Server-secure block** — ``CORE.server.secure.plugins[id]`` /
        ``CORE.server.secure.modules[id]``, supplied via env.json's
        ``core.server.secure``. Never shipped to the browser. The natural
        home for secret-adjacent values (API key bindings, proxy aliases
        referencing a secret).
   The plugin author declares *what* keys are needed; the deployment
   admin decides *where* each value lives. Booleans ``false`` and the
   number ``0`` count as configured. **Neither include.json defaults
   nor server.json defaults are consulted by the gate** — only the two
   deployer-controlled sources above. A plugin that ships
   ``serviceUrl: "http://localhost:8042"`` in its own include.json or
   ``server.json`` AND declares ``requiredConfig: ["serviceUrl"]`` is
   still dropped on deployments that don't supply ``serviceUrl`` in
   either deployer bucket. Elements that don't declare ``requiredConfig``
   are always considered configured (so this mode degrades to ``"all"``
   for them). The gate applies to modules as well — dropping a required
   module surfaces as a plugin-level missing-dep error via the existing
   dependency check, which is the desired UX when the module's upstream
   isn't available. A config-gated drop is not silent: each dropped element
   logs one line naming the unsatisfied ``requiredConfig`` paths and both
   buckets that were checked, so an admin does not have to reverse-engineer
   the omission from a downstream missing-dep error.

### ``server.json`` — author server manifest

A plugin or module may ship a ``server.json`` alongside its ``include.json``.
The file is the author's server-only manifest. Two roles:

  - ``requiredConfig: string[]`` — unioned with any ``requiredConfig`` from
    ``include.json`` and fed to the ``"available"`` gate above. The gate
    semantics are unchanged; this is purely a more discoverable home for
    server-only requirement declarations.
  - All other fields — become **author-tier secure defaults**, exposed to
    plugin server code via ``XS.getSecurePluginConfig(ctx, id)`` /
    ``XS.getSecureModuleConfig(ctx, id)``. The deployer's
    ``env.server.secure.plugins[id]`` (or ``...modules[id]``) is layered
    *on top* and wins on overlap. The author tier does **NOT** satisfy
    the gate — only deployer ENV + deployer secure do.

``server.json`` contents are kept in ``$GLOBALS['CORE_AUTHOR_SECURE']``
(PHP) / ``core.CORE_AUTHOR_SECURE`` (Node), parallel to ``CORE_SECURE``,
with the same hygiene rule: never JSON-encoded into the browser-bound
page payload.

Capture of the deployment-ENV ``enabled`` value for ``"whitelist"``
happens *before* the per-plugin ENV merge, so a plugin's own
``enabled: true`` cannot masquerade as a whitelist opt-in. ``permaLoad``
is honored after mode filtering — plugins dropped by the mode cannot
permaLoad. Plugins that fail to even parse their ``include.json`` are
still surfaced as error records in every mode (server-side
misconfiguration is an admin-visible concern).

The ``"whitelist"`` mode only filters plugins. Modules are dependencies
pulled in by plugins, so they are not user-facing items to whitelist;
they behave as in ``"all"`` mode. The ``"available"`` config-gate, in
contrast, applies to both modules and plugins.

Implementation note: the server preserves a pre-strip backup of the
secure block for its own use during plugin filtering (PHP
``$GLOBALS['CORE_SECURE']`` set in ``core.php``; Node ``core.CORE_SECURE``
set in ``core.js``). The browser-bound CORE still has
``server.secure`` deleted before emission — the backup is server-only and
must never be ``JSON.stringify``'d into the page payload.

It should also reason about what items should be loaded at the beginning (e.g. load the `annotations` plugin
if the viewer is going to be used with annotations, etc. Server should parse correctly the
configuration input and act relevantly on errors, providing translated interface where possible.
Servers should also allow to
 - pass POST data to the JS app initialization function
 - use only single URL endpoint to multiple functionalities if applicable:
   - ``directive=user_setup`` shows page that documents statically available visualizations and allows
   users to build sessions using JSON
   - ``directive=user_setup`` shows page with user-friendly setup of shaders (in progress of design)

It should include all necessary dependencies respecting their inclusion order and requirements (e.g.
support for WASM - see below, or JS modules). It should also ensure that new file versions are being labeled
correctly so that the browser does not cache them across viewer versions.

An existing server implementation demonstrates these requirements,
which should new implementations adhere to.

### Support types of access:
The server should accept POST and GET parameters, as the viewer description states
what opening ways are possible. Additionally, it should parse POST data:

### Support default IO pipeline
To support IO pipeline, the server must parse POST data and embed it in the HTML index file.
The data comes in the following structure:

````json
{
   "visualization": { ... the viewer session ... },
   "modules[moduleId.property]": "\"serialized-data\"",
   "plugins[pluginId.prop.propx]": "\"serialized-data\"",
}
````
The viewer session comes in un-serialized, or serialized once. You have to respect the session and configure the viewer accordingly.
You have to also respect the module and plugin data that optionally comes with the session, and provide it to plugins / modules
in the index file as the following structure:

````json
{
   "modules": {
      "moduleId.property": "serialized-data"
   },
   "plugins": {
      "pluginId.prop.propx": "serialized-data"
   }
}
````

The data might (and usually do) come double-encoded, this is to avoid problems with inputs: 
we could receive encoded JSON, literal string, a number, and all of them must be a valid JS in the exported index file:
````javascript
`<script>
let encoded = ${"{\"a\":1, \"b\":2}"};
let plain_string = ${"hi!"};
let number = ${3};
</script>`
````
results in 
````html
<script>
   let encoded = {a:1, b:2};
   let plain_string = hi!;
   let number = 3;
</script>
````
which is invalid. But how do we know whether a string is in fact an object encoded by JSON.stringify, 
or a dom node by XMLSerializer().serializeToString(...) .. etc?
We don't. Here comes in double-encoding, we encode each input once more. However, servers **must** attempt to encode
these values before the viewer accepts them. Although the encoding could happen also on the
viewer setup, this approach gives servers freedom to potentially modify parts of the session, etc.

To do so, each server must attempt to process POST data by:
 - figuring out whether the server receives the POST data as a unprocessed string, or whether it is pre-processed;
 PHP servers can for example natively read the submitted POST data and expand the above described syntax to already nested
 array, e.g. ``$_POST["modules"]["moduleId.property"]`` is a valid reference
 - each '`"\"serialized-data\""`' object must be safely attempted to be decoded as a JSON, e.g.

````javascript
 function readPostDataItem(item) {
     // The object can come in double-encoded, try encoding if necessary
     try {
         return JSON.parse(item);
     } catch {
         return item;
     }
 }
````

### Proxy support
Support proxying to services:
 - parse ``config.json`` (usually referred to as CORE config in servers) and read the `server` -> `secure` -> `proxies` object
 - adhering to the proxy configuration, proxy requests to the services
 - a plugin can issue ``proxy/[key]/...`` and the key is the key to `proxies` object in `config.json`
 - the session must be secured: use CSRF protection - you must set ``window.XOPAT_CSRF_TOKEN`` when user visits the viewer page
 - the resource must be secured: if configured, the server must verify a desired authentication method (so called verifier) - see ``config.json`` for more details

> !IMPORTANT!: The server, when delivering CORE configuration to the front-end *MUST DELETE* the secure object 
> of the server configuration, which MUST NOT be available on the client - it can contain secrets that are explicitly left
> hidden on the server.
>
> The same applies to **`server.auth`**, which is a separate block from
> `server.secure` and is *also* a secret-read path: `verifyJwtToken` falls back
> to `server.auth.jwt` and the bearer verifier to `server.auth.bearer`, both of
> which accept a literal `secret`. Both backends move it to a server-only
> location on client-bound builds: `core.CORE_AUTH` in Node
> (`server/templates/javascript/core.js`), `$GLOBALS['CORE_AUTH']` in PHP
> (`server/php/inc/core.php`). Verifiers therefore read
> `server.auth` **or** that backup, never `server.auth` alone.

Upstream request hygiene the proxy must implement:

- **Forward request headers by ALLOWLIST, not denylist.** The browser's `Cookie`
  (which carries the xOpat session id), its `Authorization`, and `X-XOPAT-CSRF`
  are not the upstream's business. A verifier that wants the caller's bearer
  token forwarded adds it explicitly (`forward: true`).
  Because that drop is both correct and invisible — the upstream just answers
  401/403/422 as if the viewer were at fault — Node warns **once per alias** when
  a request arrives bearing an `Authorization` that is not forwarded, naming the
  two remedies (`auth.verifiers` + `jwt.forward`, or operator
  `proxies.<alias>.headers`). The header value is never logged. PHP has no logger
  on that path and stays silent.
- **Filter response headers.** At minimum drop `Set-Cookie` — an upstream must
  not be able to set cookies on the viewer's origin — plus `Content-Encoding` /
  `Content-Length` if the body was decoded on the way through.
- **Do not let the HTTP client follow redirects blindly.** The operator-injected
  `proxies.<alias>.headers` are API keys; a hostile or compromised upstream that
  answers `302` would otherwise have them replayed to a host of its choosing.
  Follow redirects yourself and drop injected credentials on any cross-origin
  hop.
- **Time out and stream.** An upstream with no deadline pins a request, a socket
  and a buffer indefinitely; buffering whole responses makes tile and DICOM
  traffic resident twice over.

Both implementations now follow the first and third rules. Node filters through
`PROXY_FORWARDED_REQUEST_HEADERS` (`server/node/index.js`) and strips injected
credential headers on off-origin redirects. The PHP proxy (`server/php/inc/proxy.php`)
used to run the denylist shape — it forwarded the browser's `Authorization`
upstream — and followed redirects with `CURLOPT_FOLLOWLOCATION` and no stripping,
so an injected API key could be replayed to any host the upstream named. It now
uses the same allowlist and does **not** follow redirects at all: a 3xx is handed
back to the caller, which is the simplest form of "don't replay credentials to a
destination the upstream picked". Auth verification still sees the original
headers; only what is forwarded is filtered.

### Serving static files

A server must serve the viewer's assets and **nothing else**. Resolve requests
against an explicit allowlist of roots — the Node server uses `src`, `ui`,
`modules`, `plugins`, `server/static`, `docs/assets`, extensible with
`core.server.staticRoots` — and reject anything outside them even if the file
exists.

"Any path that exists on disk" is not a policy: it publishes `env/env.json`
(the deployment config, `server.secure` and all), the storage root, `*.server.ts`
sources and `.server-dist` bundles. Inside the allowed roots, still deny
dotfiles/dirs, `*.server.*` and `server.json`. Normalize `\` to `/` before
resolving (it is not a URL separator but *is* a filesystem one on Windows) and
check containment against the **realpath**, so a symlink cannot lead out.

### Other `core.server` knobs (Node)

| Key | Purpose | Default |
|---|---|---|
| `staticRoots` | Extra directories the static handler may serve | `[]` |
| `security.frameAncestors` | Pages allowed to frame the viewer, as CSP source expressions (array or space/comma string; `true`/`"*"` = anyone). Emitted as an **enforced** `Content-Security-Policy: frame-ancestors …` of its own | unset (framing denied) |
| `security.frameOptions` | `X-Frame-Options` value; falsy disables the header | `SAMEORIGIN`; auto-off when `frameAncestors` is set, or in cross-site cookie mode |
| `security.crossSiteCookies` | Session cookie becomes `SameSite=None; Secure` | on when `frameAncestors` is set or `XOPAT_CROSS_SITE_COOKIES=true` |
| `security.partitionedCookies` | Add CHIPS `Partitioned` in cross-site mode — required wherever third-party cookies are blocked, and keys the session per embedder | `true` |
| `security.cookielessSessions` | Accept `X-XOPAT-Session` (id published into the framed document) when no cookie arrives — the fallback for blocked third-party cookies and sandboxed opaque origins | follows `crossSiteCookies` |
| `security.corp` | `Cross-Origin-Resource-Policy` value | `cross-origin` when `frameAncestors` is set, else unset |
| `security.hstsMaxAge` | HSTS max-age, emitted only over TLS | `15552000` |
| `security.csp` / `security.cspReportOnly` | Content-Security-Policy. Unset by default because the viewer page relies on inline `<script>`; nonce those first | unset / report-only |
| `exposeSchemeRoutes` | Serve `/scheme*` and `/dev_setup` outside dev mode. They publish every plugin's merged config and the raw `.d.ts` sources | dev mode only |

#### Embedding the viewer in a third-party page

Framing is three walls plus a fourth, and clearing only the first produces a
viewer that renders and then fails every call:

1. **Framing** — `X-Frame-Options: SAMEORIGIN` (the default) blocks it. Do not
   just delete the header: set `security.frameAncestors` to the embedder
   origins. `ALLOW-FROM` is dead in every current browser, so the legacy header
   can only say "same origin" or "anyone"; the allowlist is CSP-only. It is sent
   as its own **enforced** policy — putting `frame-ancestors` inside
   `security.csp` while that block is report-only (the default) restricts
   nothing.
2. **Cookies** — a `SameSite=Lax` cookie is not sent from a cross-site frame, so
   the session silently never establishes and every CSRF-protected call 401s.
   `crossSiteCookies` switches it to `SameSite=None; Secure` (**real TLS
   required**, `localhost` excepted), and `partitionedCookies` adds CHIPS.
3. **No cookie jar at all** — third-party cookies blocked (Safari always; Chrome
   increasingly), or a `sandbox` iframe without `allow-same-origin`, where the
   document is on an opaque origin and `document.cookie` *throws*.
   `cookielessSessions` publishes the id as `window.XOPAT_SESSION_ID` and the
   client echoes it in `X-XOPAT-Session`. A cross-origin page can neither read
   the framed document nor set a custom header on a forged navigation, so this
   is no weaker than the CSRF token already in that HTML — and the viewer page
   is `Cache-Control: no-store` for both.

```json5
"core": { "server": { "security": {
    "frameAncestors": ["https://workbench.example.org"]
    // crossSiteCookies / cookielessSessions / corp follow automatically
}}}
```

4. **The user's login** — the three walls above get the *viewer* working; they
   say nothing about who the user is. A framed viewer cannot run a redirect
   login (the identity provider refuses to be framed, and a top-level navigation
   would take the embedder's page with it), so its contexts pin
   `authMethod: "popup"`. With `autoLogin` the boot attempt is then **silent**:
   a hidden `prompt=none` probe that succeeds whenever the identity provider
   already knows this user — typically because the embedding page signed them in
   against the same one. When it does not answer, the user gets a one-click
   sign-in (the recovery scrim, or the app-bar user menu), never a blocked
   window. Note the probe needs the *identity provider's* cookies in a
   third-party context, which is exactly what wall 3 describes being blocked; a
   deployment that needs click-free login to be guaranteed should use
   `modules/oidc-server-ts` (server-side session + refresh) or have the embedder
   supply the token. See [`src/AUTH.md`](../src/AUTH.md#login-from-inside-an-iframe).

**PHP backend:** none of the above applies — it emits no security headers at
all (so framing is unrestricted, which is its own problem) and its session
cookie comes from `session.cookie_samesite` / `session.cookie_secure` in
`php.ini`, which must be set to `None` / `1` by hand. There is no cookieless
fallback there.

Client-side storage is a separate matter the server cannot fix: an opaque-origin
frame gets in-memory KV drivers, so preferences do not survive a reload (see
`src/IO_PIPELINE.md` → *Sandboxed / opaque-origin operation*), and even a
same-origin-capable frame has partitioned `localStorage`. The embedder must also
delegate the permissions the viewer uses —
`allow="microphone; camera; fullscreen; clipboard-write"` — and, if it
sandboxes, include at minimum
`allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals`.
Dropping `allow-same-origin` is what produces case 3.

### WASM Support
WASM Files need all content to be served with the correct MIME type and headers, required by threading.
This is often not doable, therefore the following is not used (and threading not supported).
````
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
````

### Server-side state (bounded caches & pluggable storage)

Server code must not keep state in a bare module-level `Map`. A `Map` has no
bound, no sweeper, no introspection, and no way for an operator to move it — and
every subsystem that reached for one ended up hand-rolling a different, usually
incomplete, eviction policy.

Two surfaces on `globalThis.XOPAT_SERVER`, chosen by one question — *can the
value be serialized?*

```js
// Not serializable, cheap to rebuild: promises, KeyObjects, SDK clients.
const factories = XOPAT_SERVER.cache.create({
  name: "my-module:factories", maxEntries: 32, ttlMs: 3600_000,
});

// Serializable, and its loss would be noticed. Operator-routable.
const sessions = XOPAT_SERVER.storage.kv("module.my-module", "sessions", {
  ttlMs: 72 * 3600_000, maxEntries: 2000,
});
const messages = XOPAT_SERVER.storage.log("module.my-module", "messages", { maxEntries: 500 });
const blobs    = XOPAT_SERVER.storage.blob("module.my-module", "attachments");
```

`storage` mirrors the client IO pipeline: capability → binding → driver, with the
bindings and retention in `core.server.secure.storage`. The default `tiered`
driver is a bounded memory tier over durable files, so eviction from RAM is not
data loss and state stays coherent across `XOPAT_WORKERS` cluster workers.
`scoped(XOPAT_SERVER.resolvePrincipal(ctx))` gives per-caller isolation from the
broker instead of per-module ACL code, and a namespace declared
`sensitivity: "secret"` refuses to bind to a persistent driver unless the
operator opted in.

Full spec, driver contract, config reference and anti-patterns:
[`server/STORAGE.md`](STORAGE.md). Dev introspection:
`POST /__rpc/server/core/getStorageStats`.

### SSRF-safe outbound HTTP (server modules & plugins)

Any `*.server.{ts,js,mjs}` that performs **outbound** HTTP to an operator- or
user-influenced URL (provider endpoints, JWKS, webhooks, transcription/vision
backends, …) MUST route it through the core SSRF guard rather than raw
`fetch`/`node:http`. The browser `window.HttpClient` does **not** exist in the
Node runtime — that's a client-only broker — so the server equivalent is the
guard exposed on `globalThis.XOPAT_SERVER` (also passed to `register(serverApi)`).

Implementation: [`server/node/ssrf-guard.js`](node/ssrf-guard.js). It restricts
the scheme to http(s), rejects any destination that resolves to a private,
loopback, link-local, CGNAT, multicast, IPv6-special, IPv4-mapped/compatible, or
known cloud-metadata address (AWS/GCP IMDS, ECS, Alibaba, Azure wireserver), and
never follows redirects.

| API | Transport | TOCTOU-safe | Use for |
|-----|-----------|-------------|---------|
| `XOPAT_SERVER.safeRequest(url, init)` | `node:http`/`node:https` | **Yes** — validates at connect time via `createValidatingLookup`, pinning the resolved IP so a DNS rebind can't swap in an internal address | Untrusted / attacker-influenced hostnames. Supports `{ method, headers, body, timeoutMs, signal, allowHosts }`; returns `{ status, ok, headers, text(), json(), arrayBuffer() }`. |
| `XOPAT_SERVER.safeFetch(url, init)` | global `fetch` | No — small resolve-then-connect window (global fetch exposes no lookup hook without the `undici` package) | Trusted / operator-configured upstreams where the convenience of `fetch` (streaming, `Response`) matters. |
| `XOPAT_SERVER.validateUpstreamUrl(url, opts)` | — | pre-flight only | Vet a `baseUrl` up-front before handing it to a third-party SDK that brings its own `fetch`. Positive verdicts are cached per hostname for 45 s (failures and private-range verdicts never are) — hot paths that re-validate the same upstream every call skip the DNS round-trip; the bounded rebinding window this opens only affects this pre-flight, which already had a validate-to-connect gap by design. Passing a custom `opts.lookup` bypasses the cache. |

Feature-specific policy (HTTPS-only, origin allowlists, credential rules) stays
in the calling module; the generic IP/redirect/rebinding checks are **not**
re-implemented per module — they live here so a fix (e.g. a new metadata range)
lands once for everyone. Example: `modules/vercel-ai-chat-sdk/server/inference.server.ts`
enforces its own HTTPS+origin-allowlist policy, then POSTs via `safeRequest`.

#### Failures name themselves — `code` / `publicMessage` / `cause`

Guard errors are classified rather than opaque, because "what went wrong" and
"what may the client be told" are two different questions:

- `code` — `SSRF_BLOCKED` for a guard verdict; `UPSTREAM_UNREACHABLE`,
  `UPSTREAM_TIMEOUT`, `UPSTREAM_DNS`, `UPSTREAM_TLS` for transport failures,
  classified from `err.cause.code` (global `fetch` flattens every connect/DNS/TLS
  failure into the same `TypeError: fetch failed`). Forwarded to the client by
  the RPC layer, so callers branch on the class instead of matching strings.
- `publicMessage` — host-free summary (`"upstream unreachable (ECONNREFUSED)"`).
  **This is what production sends to the client.**
- `message` — full detail incl. the URL. Server log always; client only when the
  operator dev flag is on.
- `cause` — the original error, preserved and walked by the log formatter.

The dev gate lives once, in the RPC boundary (`#rpcErrorPayload`,
`server/node/server-runtime.js`), for both the buffered and streaming paths — a
module must never branch on `isDevMode` to decide what to put in an error
message. Modules that want the same treatment throw `XS.UpstreamRequestError`
(or set the two fields on their own error); see
[`server/node/README.md`](node/README.md#classified-failures--code-publicmessage-cause).

#### Why the private-IP block exists

SSRF = tricking the server into making a request from **inside** its trusted
network. Private / reserved ranges are exactly the set of "reachable from inside,
not from outside": cloud-metadata endpoints (`169.254.169.254` → IAM credentials,
instance tokens), `localhost` admin panels and databases bound loopback-only, and
internal microservices that run without auth because they trust the private
network. If an attacker can steer a server-side fetch at one of these, the server
fetches it and hands the response back — the attacker borrows the server's network
position. Blocking the ranges removes the reward, and disabling redirects +
pinning the connect-time DNS closes the two standard evasions (a public host that
302s inward, or a name that rebinds to an internal IP after validation).

#### Allowing trusted internal upstreams

A containerized / VPC deployment legitimately needs to reach its **own** internal
backends — e.g. a Docker sibling `internal-backend` on `172.28.0.0/16` — which is
indistinguishable *by IP* from the attack above. Rather than weaken the guard or
drop back to raw `fetch`, the operator (the trust boundary, §7) declares the
specific trusted destinations via two env vars read once by the guard:

| Env var | Value |
| --- | --- |
| `XOPAT_SSRF_ALLOWED_HOSTS` | comma/space hostnames (exact, lowercased; a leading-dot entry like `.internal` matches subdomains) |
| `XOPAT_SSRF_ALLOWED_CIDRS` | comma IPv4 CIDRs (e.g. `172.28.0.0/16`) |
| `XOPAT_SSRF_TIMEOUT_MS` | default socket-idle timeout for `safeRequest`/`safeFetch` when the caller passes no `timeoutMs` (default `120000`, floored at `1000`). LLM streaming, vision and slow model-discovery need more than the old 30s. Callers with their own budget (transcription, vision) override it explicitly. |

Empty (default) ⇒ strict, no carve-out. The allowlist relaxes **only** the
private-IP verdict for the listed hosts/subnets; the scheme restriction and the
redirect / DNS-rebinding protections are never relaxed. It is intentionally
specific — not a global "allow private" switch — so unlisted internal addresses
stay blocked. Full reference and a `docker-compose` example:
[`server/ENVIRONMENT.md` → SSRF](ENVIRONMENT.md#ssrf-trusted-internal-upstreams).
