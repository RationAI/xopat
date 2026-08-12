# Server Environment Variables

Reference for the OS environment variables the **core xOpat server** (Node and
PHP runtimes) reads at launch and at request time. Plugin- and module-specific
variables are documented in each element's own README — see
[Plugin / module variables](#plugin--module-variables) below.

## Two kinds of server env vars

1. **Deployment-config source & substitution** — `XOPAT_ENV` selects the static
   configuration, and `<% VAR %>` placeholders interpolate OS env values into
   that configuration. This is how secrets reach the server: they enter via
   `<% VAR %>` into `env.json` and live under `core.server.secure`, which is
   stripped from the client payload and never read directly by feature code.
   These two are already documented — do not re-learn them here:
   - [`server/README.md` → "Provide Static Configuration"](README.md#provide-static-configuration)
   - [`env/README.md`](../env/README.md) (field-by-field `env.json` reference, `<% VAR %>` grammar)
   - [`INTEGRATION.md` §1](../INTEGRATION.md) (config model & trust boundary)

2. **Process-launch runtime variables** — configure the server *process* itself
   (host, port, workers, dev mode, cache, cookies). These have no home elsewhere
   and are the subject of the tables below.

## Node core runtime

| Variable | Purpose | Default | CLI alternative | Source |
| --- | --- | --- | --- | --- |
| `XOPAT_NODE_HOST` | Bind host for the HTTP server | `0.0.0.0` | `-h` / `--host` | `server/node/constants.js:68` |
| `XOPAT_NODE_PORT` | Listen port | `9000` | `-p` / `--port` | `server/node/constants.js:69` |
| `XOPAT_WORKERS` | Cluster worker processes to fork (`cluster-index.js` only) | cpu count | — | `server/node/cluster-index.js:7` |
| `XOPAT_DEV_MODE` | Enable dev mode (dev RPC routes, hot rebuilds). Accepts `1/true/yes/on` | `false` | `--dev` | `server/node/constants.js:41` |
| `XOPAT_CACHE_DIR` | Directory for the server runtime cache (plugin/module `.server-dist` build artifacts) | `<root>/server/.cache` | — | `server/node/server-runtime.js:102` |
| `XOPAT_CROSS_SITE_COOKIES` | When `=== 'true'`, session cookie uses `SameSite=None; Secure; Partitioned` and framing is unrestricted (Colab / cross-origin embedding). Prefer `core.server.security.frameAncestors`, which turns the same mode on *and* names who may frame — see [Embedding](README.md#embedding-the-viewer-in-a-third-party-page) | unset → `SameSite=Lax` | — | `server/node/index.js` |
| `NODE_ENV` | When `=== 'production'`, adds the `Secure` flag to the session cookie | unset | — | `server/node/index.js:116` |
| `XOPAT_SESSION_TTL_SEC` | Idle lifetime of a browser session. An unauthenticated caller's principal is `sess:<id>`, so this also bounds how long anonymously-owned state (chat transcripts, BYOK keys) stays reachable. Floored at `60` | `86400` (24 h) | — | `server/node/index.js` |
| `XOPAT_SESSION_MAX` | Cap on live browser sessions; least-recently-seen are evicted past it. Floored at `100` | `50000` | — | `server/node/index.js` |
| `XOPAT_RPC_MAX_BODY_BYTES` | Absolute ceiling on an RPC request body, clamping any per-method `runtime.maxBodyBytes`. A method that declares none gets 256 KiB. The body is read before the auth gate, so this is what bounds an unauthenticated caller. Also caps the non-RPC raw-body reads (`/proxy/*`, `responseViewer` POST), which previously had no limit at all. Floored at `65536` | `16777216` (16 MiB) | — | `server/node/server-runtime.js`, `server/node/utils.js` |
| `PROJECT_ROOT` | Relative path prefix prepended to every viewer resource path (`src/`, `modules/`, `plugins/`, `server/`) | `""` | — | `server/node/constants.js:33` |
| `XOPAT_ENV` | Static-config source (file path → load file; else inline JSON string; else `env/env.json`). See [config source](#two-kinds-of-server-env-vars) | `env/env.json` if present | — | `server/node/index.js:823`, `server/templates/javascript/core.js:361` |
| `XOPAT_SSRF_ALLOWED_HOSTS` | Comma/space list of hostnames that may bypass the SSRF guard's private-IP block (trusted internal upstreams). See [SSRF allowlist](#ssrf-trusted-internal-upstreams) | unset → none | — | `server/node/ssrf-guard.js` |
| `XOPAT_SSRF_ALLOWED_CIDRS` | Comma list of IPv4 CIDRs whose addresses may bypass the SSRF guard's private-IP block. See [SSRF allowlist](#ssrf-trusted-internal-upstreams) | unset → none | — | `server/node/ssrf-guard.js` |
| `XOPAT_SSRF_TIMEOUT_MS` | Default socket-idle timeout (ms) for guarded outbound requests (`safeRequest`/`safeFetch`) when the caller passes no explicit `timeoutMs`. Raised from the old hardcoded 30s because LLM streaming/vision/model-discovery routinely exceed it. Floored at `1000` | `120000` | — | `server/node/ssrf-guard.js` |
| `XOPAT_STORAGE_ROOT` | Root directory for the server storage subsystem (`XOPAT_SERVER.storage`). Prefer `core.server.secure.storage.root`. See [`STORAGE.md`](STORAGE.md) | `<XOPAT_CACHE_DIR>/storage` | — | `server/node/storage/index.js` |
| `XOPAT_STORAGE_SWEEP_INTERVAL_MS` | Period of the single process-wide retention sweep (TTL expiry + entry caps across every storage namespace) | `60000` | — | `server/node/storage/index.js` |
| `XOPAT_STORAGE_MEMORY_MAX_BYTES` | Default byte budget for the `memory` driver / the `tiered` driver's front tier | unset (entry counts only) | — | `server/node/storage/index.js` |
| `XOPAT_SHARED_DEPLOYMENT` | Assert that several processes serve this deployment when `node:cluster` is not in use (k8s replicas, PM2 fork). Enables the shared-state defaults `cluster.isWorker` would have. `1/true/yes/on` | unset | — | `server/node/index.js` |
| `XOPAT_SHARED_DEPLOYMENT_SIZE` | Process count used to divide cluster-wide RPC budgets (`maxConcurrency`, `queueLimit`). Overrides the `XOPAT_WORKERS`/cpu-count inference | inferred | — | `server/node/server-runtime.js` |
| `XOPAT_SHUTDOWN_GRACE_MS` | Drain window on SIGTERM/SIGINT before the process exits anyway. Read by both the worker and the cluster supervisor. Keep below the orchestrator's kill timeout | `120000` | — | `server/node/index.js`, `cluster-index.js` |
| `XOPAT_WORKER_HEALTHY_MS` | A worker exiting sooner than this counts against the crash budget | `30000` | — | `server/node/cluster-index.js` |
| `XOPAT_WORKER_CRASH_BUDGET` | Consecutive young worker deaths before the supervisor gives up and exits non-zero (stops crash-loops) | `10` | — | `server/node/cluster-index.js` |
| `XOPAT_KEEPALIVE_TIMEOUT_MS` | HTTP keep-alive idle timeout. Raised from Node's 5s default, the classic source of sporadic 502s behind a reverse proxy | `75000` | — | `server/node/index.js` |
| `XOPAT_HEADERS_TIMEOUT_MS` | Time allowed to receive request headers. Forced above `keepAliveTimeout` | `90000` | — | `server/node/index.js` |
| `XOPAT_REQUEST_TIMEOUT_MS` | Whole-request timeout. `0` (default) disables it — streaming RPC responses legitimately run for many minutes | `0` (off) | — | `server/node/index.js` |
| `XOPAT_RPC_ABORT_GRACE_MS` | After an RPC's abort fires, how long the runtime still waits for a handler that ignores `ctx.signal` before releasing its slot and answering | `60000` | — | `server/node/server-runtime.js` |
| `XOPAT_RESCAN_INTERVAL_MS` | Minimum spacing between request-triggered plugin/module rescans. Dev only — production never rescans on the request path | `2000` | — | `server/node/server-runtime.js` |
| `XOPAT_PROXY_TIMEOUT_MS` | Default upstream timeout for `/proxy/*`. Override per alias with `proxies.<alias>.timeoutMs` | `300000` | — | `server/node/index.js` |
| `XOPAT_SSRF_MAX_RESPONSE_BYTES` | Ceiling on a `safeRequest` response body (it is fully materialized; `safeFetch` streams instead) | `536870912` (512 MiB) | — | `server/node/ssrf-guard.js` |

`<% VAR %>` placeholders inside the config are resolved from `process.env` via
the `readEnv` callback wired at `server/node/index.js:173` (resolver
`server/templates/javascript/core.js:242-251`).

### SSRF: trusted internal upstreams

Server-side outbound HTTP (provider endpoints, transcription/vision backends,
JWKS, webhooks) is routed through the core **SSRF guard**
(`server/node/ssrf-guard.js`), which refuses any destination that resolves to a
private / loopback / link-local / cloud-metadata address. That block is what
stops an attacker-influenced URL from turning the server into a proxy into your
private network (metadata credentials, `localhost` admin endpoints, unauthed
internal services) — see [`server/README.md` → SSRF](README.md#ssrf-safe-outbound-http-server-modules--plugins).

A containerized deployment, however, legitimately needs to reach its **own**
internal backends (e.g. a Docker sibling `internal-backend` on a `172.28.0.0/16`
network), which is indistinguishable by IP from the attack. The operator — the
trust boundary — vouches for specific destinations with these two vars:

| Variable | Value | Example |
| --- | --- | --- |
| `XOPAT_SSRF_ALLOWED_HOSTS` | Exact hostnames (lowercased); a leading-dot entry matches any subdomain | `internal-backend,whisper` or `.svc.cluster.local` |
| `XOPAT_SSRF_ALLOWED_CIDRS` | IPv4 CIDRs; a resolved/literal address inside one is allowed | `172.28.0.0/16` |

- **Empty (default) ⇒ strict** — no carve-out, identical to prior behavior.
- The allowlist relaxes **only** the private-IP verdict for the listed
  destinations. The HTTP(S)-scheme restriction and the redirect / DNS-rebinding
  protections are **never** relaxed — an allowlisted host that 3xx-redirects is
  still refused.
- It is deliberately **specific**: it is not a global "allow private" switch.
  List each trusted host or subnet; everything else stays blocked.

`docker-compose` example:

```yaml
environment:
  XOPAT_SSRF_ALLOWED_CIDRS: "172.28.0.0/16"   # this compose network
  # or, by name:
  # XOPAT_SSRF_ALLOWED_HOSTS: "internal-backend"
```

## PHP core runtime

| Variable | Purpose | Default | Source |
| --- | --- | --- | --- |
| `APP_BASE_PATH` | Public base-path override for containers (used when no `X-Forwarded-Prefix` header is present) | derives from `X-Forwarded-Prefix`, then script dir | `server/php/inc/core.php:39` |
| `XOPAT_ENV` | Static-config source — same semantics as Node | `env/env.json` if present | `server/php/inc/core.php:225` |
| `<% VAR %>` placeholders | Env substitution inside the config | per-placeholder default or `""` | `server/php/inc/core.php:89-98` |

> PHP `PROJECT_ROOT` is a compile-time `define()` (`server/php/inc/init.php:13`),
> **not** an environment variable (unlike the Node side).

## JWT signing secret (`secretEnv`)

Both runtimes support signing/verifying proxy-auth JWTs with an HMAC secret
supplied through the environment. The env-var **name is not fixed** — it comes
from the config key `server.auth.jwt.secretEnv`, and the server then reads
`process.env[<that name>]`:

- Node: `server/node/auth.js:151` (throws if the named var is unresolved)
- PHP: `server/php/inc/auth.php:102` (`getenv`, rejects if unresolved)

The documented example name is `XOPAT_JWT_SECRET`
(`server/node/README.md:240`). It is required **only** when JWT proxy auth is
configured with `secretEnv`.

## Pointers (out of core-runtime scope)

- **Build / dev tooling** (build-time only, not the served-request path):
  `XO_REPO_ROOT`, `WATCH_PATTERN`, `CHOKIDAR_USEPOLLING`, `CHOKIDAR_INTERVAL` —
  under `server/utils/` (Grunt tasks, dev watcher).
- **Docker / compose / apache**: `XO_ROOT_PATH`, `XO_IMAGE_NAME`, and
  `APP_BASE_PATH` — see [`docker/php/README.md`](../docker/php/README.md).

## Plugin / module variables

Plugins and modules are independent — their environment variables are documented
in **their own README**, not here. Note that plugin/module server code
(`*.server.ts`) does **not** read `process.env` for secrets: configuration and
secrets are injected via `ctx.secure` and `globalThis.XOPAT_SERVER.getSecure*`
(deployer tier `core.server.secure` ⊕ author tier `server.json`).

> **Prefer the server config (`server.json` / `core.server.secure`) over
> `process.env`.** Routing configuration through the secure config tree keeps a
> deployment self-describing and portable — every knob a plugin/module needs
> lives in one readable place (`env.json` / `server.json`), can be templated with
> `<% VAR %>`, and is validated by `requiredConfig`. Reserve raw `process.env`
> reads for genuinely process-scoped bootstrap values read before any config
> exists (`XOPAT_ENV`, `XOPAT_CACHE_DIR`, `XOPAT_WORKERS`) — not for endpoints,
> credentials, per-deployment values, or feature toggles.
>
> **For diagnostics, use the logging broker — do not invent a bespoke
> `XOPAT_*_DEBUG` env var.** `XOPAT_SERVER.log("module.<id>")` (or the pre-scoped
> `ctx.log` inside an RPC) emits on a channel whose level the operator controls
> per deployment via `core.server.logging`; payload dumps go through
> `log.sensitive(...)`, which stays off unless an operator opts in. See
> [`server/LOGGING.md`](LOGGING.md). For dev-only *behavior* (not logging), gate on
> `XOPAT_SERVER.isDevMode(ctx)` (returns `core.CORE.server.devMode`, set by
> `XOPAT_DEV_MODE` / `--dev`); client-side use
> `APPLICATION_CONTEXT.getOption("debugMode")`.
>
> **Config without a request ctx.** Lazily-built module state (a store created on
> first use, a retention policy) used to reach for `process.env` because every
> config accessor needed a `ctx`. It does not any more:
> `XOPAT_SERVER.getStaticModuleConfig(id)` / `getStaticPluginConfig(id)` read the
> composed config snapshot core republishes on every core build.

See
[`plugins/README.md`](../plugins/README.md) and
[`modules/README.md`](../modules/README.md).

> **Deprecated: `XOPAT_CHAT_*`.** The chat SDK's dozen tuning variables
> (`XOPAT_CHAT_DEBUG`, `_STREAMING`, `_TURN_TIMEOUT_MS`, `_ATTEMPT_TIMEOUT_MS`,
> `_MAX_RETRIES`, `_PROBE_TIMEOUT_MS`, `_MAX_INLINE_ATTACHMENT_BYTES`,
> `_MAX_OUTPUT_TOKENS`, `_DECODED_MEDIA_CACHE_BYTES`, `_SESSION_TTL_MS`,
> `_MAX_SESSIONS`, `_MAX_MESSAGES_PER_SESSION`, `_MAX_ATTACHMENTS_PER_SESSION`,
> `_KEEP_LEGACY_SESSIONS`) moved into
> `core.server.secure.modules["vercel-ai-chat-sdk"].tuning`. They still work and
> warn once per process; they will be removed. `XOPAT_CHAT_DEBUG` has **no**
> replacement variable — raise the `module.vercel-ai-chat-sdk:llm` channel in
> `core.server.logging` instead. See
> [`modules/vercel-ai-chat-sdk/README.md`](../modules/vercel-ai-chat-sdk/README.md)
> and [`server/LOGGING.md`](LOGGING.md).
