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
| `XOPAT_DEV_LOG_MAX_ENTRIES` | Max entries in the in-memory dev log buffer (min `100`) | `10000` | — | `server/node/constants.js:42` |
| `XOPAT_CACHE_DIR` | Directory for the server runtime cache (plugin/module `.server-dist` build artifacts) | `<root>/server/.cache` | — | `server/node/server-runtime.js:102` |
| `XOPAT_CROSS_SITE_COOKIES` | When `=== 'true'`, session cookie uses `SameSite=None` and forces `Secure` (Colab / cross-origin embedding) | unset → `SameSite=Lax` | — | `server/node/index.js:105` |
| `NODE_ENV` | When `=== 'production'`, adds the `Secure` flag to the session cookie | unset | — | `server/node/index.js:116` |
| `PROJECT_ROOT` | Relative path prefix prepended to every viewer resource path (`src/`, `modules/`, `plugins/`, `server/`) | `""` | — | `server/node/constants.js:33` |
| `XOPAT_ENV` | Static-config source (file path → load file; else inline JSON string; else `env/env.json`). See [config source](#two-kinds-of-server-env-vars) | `env/env.json` if present | — | `server/node/index.js:823`, `server/templates/javascript/core.js:361` |
| `XOPAT_SSRF_ALLOWED_HOSTS` | Comma/space list of hostnames that may bypass the SSRF guard's private-IP block (trusted internal upstreams). See [SSRF allowlist](#ssrf-trusted-internal-upstreams) | unset → none | — | `server/node/ssrf-guard.js` |
| `XOPAT_SSRF_ALLOWED_CIDRS` | Comma list of IPv4 CIDRs whose addresses may bypass the SSRF guard's private-IP block. See [SSRF allowlist](#ssrf-trusted-internal-upstreams) | unset → none | — | `server/node/ssrf-guard.js` |

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
> reads for genuinely process-scoped, non-secret toggles (e.g. feature
> kill-switches like `XOPAT_CHAT_STREAMING`), not for endpoints, credentials, or
> per-deployment values.
>
> **For dev/debug gating, ride on the core dev flag — do not invent a bespoke
> `XOPAT_*_DEBUG` env var.** Server modules call `XOPAT_SERVER.isDevMode(ctx)`
> (returns `core.CORE.server.devMode`, set by `XOPAT_DEV_MODE` / `--dev`);
> client-side use `APPLICATION_CONTEXT.getOption("debugMode")`.

See
[`plugins/README.md`](../plugins/README.md) and
[`modules/README.md`](../modules/README.md). Example: the chat SDK's
`XOPAT_CHAT_STREAMING` and `XOPAT_PATHOLOGY_VISION_TIMEOUT_MS` flags are
documented in [`modules/vercel-ai-chat-sdk/README.md`](../modules/vercel-ai-chat-sdk/README.md).
