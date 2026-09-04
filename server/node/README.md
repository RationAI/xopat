# xOpat Server API README

This document describes the current server-side API and runtime model for the xOpat server counterpart.

---

## Overview

The server consists of two main entrypoints:

- `index.js`
- `cluster-index.js`

### `index.js`
Run this for a **single-process server**.

Use it when:
- developing locally
- debugging
- running a simple deployment
- using only one Node process

### `cluster-index.js`
Run this for a **multi-process deployment**.

Use it when:
- deploying to production on a multi-core machine
- you want better throughput and resilience
- you want multiple worker processes behind one master process


---

## High-level architecture

The server provides:

- normal HTTP serving
- generic proxy/auth support (see server env.json config)
- RPC execution for plugin/module server methods
- optional auth verification per RPC context
- runtime protections:
    - request size limits
    - concurrency limits
    - timeouts
    - circuit breakers
    - optional worker isolation

---

## Server-side method discovery

The runtime discovers server methods from files like:

- `*.server.js`
- `*.server.mjs`
- `*.server.ts`

These files can exist in plugins or modules.

Named exports from these files are exposed as RPC-callable methods.

### How `*.server.ts` is built (`server-module-loader.js`)

TypeScript server files are bundled per element with esbuild (`bundle`, `platform:
node`, `format: esm`) into `<element>/.server-dist/`, then imported. Two properties of
that pipeline are worth knowing before you debug one:

- **A failed import looks like a missing method.** The module registers nothing, so the
  call comes back as `{ code: "RPC_UNKNOWN_METHOD" }` — check the server log for the
  import error rather than hunting for a typo in the export.
- **The bundle is ESM but dependencies may be CJS.** esbuild rewrites a CJS
  `require("x")` into a shim that needs a real `require` in scope; the build injects one
  via a `createRequire` banner, so CommonJS dependencies keep working. Never "fix" such
  a dependency by marking it external — that just moves the failure to load time.
- **The build cache is keyed on source mtime AND a build key** (`BUILD_FORMAT_VERSION`,
  the esbuild version, and the installed-dependency identity from
  `node_modules/.package-lock.json`). This is what makes an `npm install` rebuild every
  element: no `*.server.ts` mtime changes when a dependency major moves, and stale
  bundles would otherwise leave the deployment running two majors of the same library at
  once. Bump `BUILD_FORMAT_VERSION` whenever you change the esbuild options.

### Example

```ts
export async function getChatMessages(ctx, input) {
  return { ok: true, input };
}

export const policy = {
  getChatMessages: {
    auth: {
      public: false,
      requireSession: true
    },
    runtime: {
      timeoutMs: 5000
    }
  }
};
```

## RPC transport API

### Endpoint shape

#### Module RPC `POST /__rpc/module/:moduleId/:method`

#### Plugin RPC `POST /__rpc/plugin/:pluginId/:method`

Request body
```
{
  "args": [
    { "foo": "bar" }
  ],
  "viewerId": "optional-viewer-id",
  "contextId": "optional-auth-context-id"
}
```
Response body

Successful response:
```
{
  "result": {
    "ok": true
  }
}
```
Error response:
```
{
  "error": "Human readable message",
  "code": "ERROR_CODE",
  "details": {}
}
```
---
## Browser-side API

The browser gets `window.xserver` from the server bootstrap.

### Available scopes

`window.xserver.module[moduleId]`

`window.xserver.plugin[pluginId]`

#### Example

```
await window.xserver.module["chat"].getChatMessages({ foo: "bar" });
```

This should normally be wrapped by the xOpat element helper:
```
await this.server().getChatMessages({ foo: "bar" });
```
Instead of doing all this manually, we can elevate `XOpatElement.server()`.
The intended high-level API is:
```
await this.server().getChatMessages({ foo: "bar" });
```
or:
```
await this.server({ contextId: "my-service" }).getChatMessages({ foo: "bar" });
```
or:
```
await this.server().getChatMessages(
  { foo: "bar" },
  { contextId: "my-service" }
);
```
The underlying transport uses HttpClient, so make hard use of contextualized http clients.

### Default client

By default the server call uses `APPLICATION_CONTEXT.httpClient`.
A caller may override the client if needed. 
Auth payload attachment is fully controlled by the chosen HttpClient.

#### Auth model
Security is provided by:
 - session validation
 - CSRF validation

These are not configured as named verifiers, and these are injected automatically by default.

Method auth policy - atop of verifying the request comes from the viewer itself, 
we can check whether a given user can use the API, we can require login against
certain services.

Each method may define:
```
auth: {
  public?: boolean | ((ctx) => boolean); //default false
  requireSession?: boolean;              //default true
}
```

### Meaning
`public: false`

The method is protected. The server consults the session, the RPC verifier
context, or both — see the decision matrix below.

`public: true`

The method is public and skips both session and verifier checks. Anyone who
can reach the endpoint can call the method.

`requireSession: true`

A normal xOpat session is required. The request must carry a valid session
cookie and a matching `X-XOPAT-CSRF` header. Under
`core.server.security.cookielessSessions` (embedded deployments where the frame
has no cookie jar) an `X-XOPAT-Session` header names the session instead — the
CSRF requirement is unchanged. See
[Embedding the viewer in a third-party page](../README.md#embedding-the-viewer-in-a-third-party-page).

`requireSession: false`

No session is required. The server logs a one-shot warning when an endpoint
opts out. Because no session implies no CSRF, you must pair this with an RPC
verifier — see the matrix.

### Decision matrix (server-side)

For each call the runtime evaluates `auth.public`, `requireSession`, and the
resolved verifier context. The outcome:

| `public` | `requireSession` | Verifier context | Verifier entries | Result |
|---|---|---|---|---|
| `true` | — | — | — | Accepted (no checks) |
| `false` | `true`  | any                  | any   | Session + CSRF (+ verifier if present); all must pass |
| `false` | `false` | has `verifiers`      | ≥ 1   | Verifier only (e.g. raw JWT calls) |
| `false` | `false` | `{ enabled: false }` | —     | Accepted — explicit operator opt-out |
| `false` | `false` | empty `{}` / missing | —     | **Rejected** — `RPC_AUTH_NO_VERIFIERS` / `RPC_AUTH_NOT_CONFIGURED` |

The last row is the fail-closed default. The bypass class was: an endpoint
opting out of session (`requireSession: false`) plus an empty or absent
`rpcVerifiers` entry would silently pass. **Fail-closed is now the default.**
The operator opts back in *explicitly* by setting `enabled: false` on the
verifier-context entry — leaving the entry empty is no longer accepted as
"no auth needed", because that exact misconfiguration is what made the
original bypass invisible.

### The principal (`ctx.principal` / `ctx.user.id`)

Every RPC handler receives the caller's identity as one opaque string:

| `ctx.principal` | `ctx.principalKind` | Meaning |
|---|---|---|
| `user:<id>`  | `"user"`    | A verifier established an identity |
| `sess:<id>`  | `"session"` | Anonymous, but tracked per browser (`xopat_session`) |
| `null`       | `null`      | Neither — the request is unauthorized |

Use it — via `XOPAT_SERVER.resolvePrincipal(ctx)` (throws when `null`) or
`tryResolvePrincipal(ctx)` (returns `null`) — for **ownership stamps and
per-user storage scopes**.

> **Never write `ctx.user?.id ?? null`.** That expression collapses every
> unauthenticated caller into one shared `null` identity, so `owner === requester`
> compares `null === null` and passes for everybody. Anonymity is not a shared
> account: two anonymous browsers must be two principals.

#### What a verifier must return

An RPC verifier returns `{ ok: true, user }`. Core normalizes `user` before it
reaches `ctx`:

- If `user.id` is already a non-empty string, it is **left untouched** — a
  verifier that knows its own identity model (a custom attribute map, a real
  user record) stays in control.
- Otherwise core derives `id` from the first present of `sub`, `oid`, `upn`,
  `preferred_username`, `email`. The original payload is preserved (spread), plus
  `claims`, `via` (verifier name) and `contextId`.
- If no id can be derived, the user is `null` and the caller degrades to a
  `sess:` principal. Core does **not** invent an authenticated-but-anonymous user.

`req.user` remains the **raw** claim payload — proxy verifiers forward
`payload.sub` upstream and must keep seeing the unmapped shape.

The built-in `bearer` verifier is a shared-secret gate and yields **no identity**
by design; pair it with `jwt` / `oidc` / `saml` when you need one. It requires a
configured `secret`/`secretEnv` and fails closed without one.

**Identity does not cross contexts.** Verifiers write `req.user` as a side effect
and `req` is shared by every context evaluated in one request, so the verifier set
for a context runs against a cleared `req.user` and only a user it produced counts.
Otherwise an identity-less verifier in one context would inherit the identity
another context had established.

### Configuring RPC verifiers

Verifiers live under `server.secure.rpcVerifiers` (the legacy key
`server.secure.rpcAuth` is still recognised as an alias):

```json
{
  "server": {
    "secure": {
      "rpcVerifiers": {
        "default": {},
        "my-service": {
          "verifiers": {
            "jwt": {
              "secretEnv": "<% XOPAT_JWT_SECRET %>",
              "issuer": "https://issuer.example",
              "audience": "xopat"
            }
          },
          "mode": "all"
        },
        "internal-only": {
          "enabled": false
        }
      }
    }
  }
}
```

### Context resolution

The client picks the verifier context via the `contextId` field on the RPC
request body. One resolver (`resolveVerifierContext` in `server/node/auth.js`)
answers for the request-time gate, `requireRpcAuthContext` and
`getRpcAuthConfig` alike, so they cannot drift apart.

#### Naming the main context

**`""`, `"core"` and `"default"` are three spellings of the same context** — the
viewer's main identity. The client canonicalizes it to `"core"` everywhere
(`XOpatAuth._ctx` / `XOpatUser._sanitizeContextId` / `XOpatElement.authContextId`,
all `contextId || "core"`); this registry has historically keyed it `"default"`.
Configure whichever you prefer; `default` remains the conventional spelling.

**Use exactly one of them.** `canonicalizeRpcVerifierContexts` resolves the main
context to a single entry, and that entry governs every spelling — so the
`contextId` a caller sends selects *nothing*. Defining two main spellings with
**different** settings is refused: while two different main entries are reachable,
the caller picks which one governs their own request, and if one of them is
`{enabled: false}` (the shipped pattern until this was fixed) naming it skips the
gate. Identical duplicates collapse silently.

| `contextId` sent | treated as | resolves to |
|---|---|---|
| absent, `""`, `"core"`, `"default"` | main | the single main entry, whatever its key |
| any other non-empty string | **sub-context** | that key only, own-property |
| non-string | invalid | rejected |

- **A main context with no entry is "unconfigured", not "unknown"** — it falls
  through to the decision matrix and keeps a zero-config deployment working.
- **A sub-context with no entry is rejected**, 401 `RPC_AUTH_UNKNOWN_CONTEXT`, so
  a stale or invented id cannot pick a weaker verifier set. Set
  `server.secure.rpcVerifierStrictContext: false` to restore the legacy
  fall-through (logged once, not recommended).
- An ambiguous main split answers 500 `RPC_AUTH_MISCONFIGURED` on every non-public
  RPC, with the offending keys logged once. It fails closed: no request is served
  under a config whose meaning depends on what the client typed.

Lookups use `Object.prototype.hasOwnProperty.call(...)`: a naive lookup would let
a client send `contextId: "__proto__"` and reach `Object.prototype`, which has no
verifiers and was previously read as "no auth required".

**If you need "authenticated here, open there":** mark the open *methods*
`auth: { public: true }` in their own policy — a property of the code, reviewable
in a diff, that scales with the codebase — and/or give the gated features a
**named sub-context**, which the resource declares and `requireRpcAuthContext`
enforces. Do not express it as a second main-context entry; that is a JSON key
silently applying to every RPC in the process, including ones written later.

> **This is defence in depth, not the primary control.** A caller can still simply
> *omit* `contextId`. Code that must enforce a specific context — anything that
> dispenses a credential — has to take it from the resource and verify on demand;
> see the next section.

### On-demand context verification (`requireRpcAuthContext`)

`XOPAT_SERVER.requireRpcAuthContext(ctx, contextId)` verifies a context
mid-request, from a context id *you* supply — a provider record, a proxy binding —
never `ctx.contextId`, which is a client claim. Returns
`{contextId, matchedKey, user, principal}`, where `contextId` is the **canonical**
id (every main spelling reports `"core"`) and `matchedKey` is the config key that
actually matched (diagnostic only — never branch on it). Main-context aliases
apply, so `requireRpcAuthContext(ctx, "core")` finds `rpcVerifiers.default`.

Memoized per `(ctx, canonical context)`, so `"core"` and `"default"` in one turn
run the verifier once — it may be doing a JWKS fetch. Failures are memoized too
and rethrown.

It fails closed at every step, and unlike the request-time gate it treats
`{ enabled: false }` as an **error**: at a credential chokepoint, "the operator
turned verification off" is not a licence to hand out an API key.

| condition | code |
|---|---|
| no entry for the context | `RPC_AUTH_CONTEXT_UNCONFIGURED` |
| `{ enabled: false }` | `RPC_AUTH_CONTEXT_DISABLED` |
| entry with no verifiers | `RPC_AUTH_CONTEXT_NO_VERIFIERS` |
| verifiers ran and failed | `RPC_AUTH_CONTEXT_FAILED` |
| verified, but identity-less (e.g. `bearer` only) | `RPC_AUTH_CONTEXT_NO_PRINCIPAL` |
| caller passed no context id at all | `RPC_AUTH_CONTEXT_INVALID` |

For an unconfigured **main** context the message names both `rpcVerifiers.core`
and `rpcVerifiers.default`, since either would fix it; for a sub-context it names
only that key.

#### Error contract for module consumers

- **`getRpcAuthConfig(ctx, contextId)` no longer falls back to `default` for an
  unknown *named* key** (it returns `null`), and no longer walks the prototype.
  Breaking only for out-of-tree server modules that relied on the old fallback.
- Modules that need to recognise a chat provider refusal must check `error.code`
  (`CHAT_PROVIDER_ACCESS_DENIED` / `CHAT_PROVIDER_CONTEXT_DENIED`, via the exported
  `isProviderAccessError`) — **never `instanceof`**. Each `*.server.ts` entry is
  bundled independently, so class identity differs across bundles.

> **`default: {}` is not public access.**
> An empty entry exists but configures no verifiers. With `requireSession:
> true` this means "session-only"; with `requireSession: false` it means
> "no verifier configured", and the runtime rejects the call.

#### Explicit opt-out

An entry shaped `{ "enabled": false }` is treated as "this context disables
verifier checks intentionally". It is the only way to mark a non-public
endpoint as accepting requests without verifier (e.g. internal-only routes
gated by network ACL). Use sparingly — it's the moral equivalent of
`public: true` once the call passes session checks.

#### Consumer note: context-restricted chat providers

The vercel-ai-chat-sdk provider layer can restrict a provider to an allow-list of
contexts (`metadata.contexts`, from secure `providerDefaults.contexts` — see that
module's README), or simply mark it `requiresLogin`. Either way the credential
chokepoint calls `requireRpcAuthContext` with the context **the provider record
declares**, so the request body cannot influence which gate runs.

Consequences for configuration:

- Every context named on a provider needs a real verifier entry here. An empty,
  session-only or `{ "enabled": false }` entry makes the provider refuse to
  resolve (degrade closed) — including for the operator's own key.
- A provider with `requiresLogin: false` and no `contexts` verifies nothing, and
  works on a deployment with no `rpcVerifiers` at all. That is the intended
  zero-config path; auth is an addon.
- A provider with `requiresLogin: true` that names **no** context verifies the
  **main** context (`core`/`default`) and logs a one-shot notice. That matches what
  `authContext: null` means everywhere else in xOpat. Consequence worth knowing:
  the main viewer login becomes the gate for that provider's operator-held key. To
  gate it more narrowly, name `providerDefaults.contexts` or
  `providerDefaults.contextId`.

#### Decision matrix addendum

| `public` | `requireSession` | Verifier context | Result |
|---|---|---|---|
| `false` | any | **named but unknown** | **Rejected** — `RPC_AUTH_UNKNOWN_CONTEXT` |

#### Verifier mode
`mode: "all"`

All configured verifiers must pass. This is the default.

`mode: "any"`

At least one configured verifier must pass.

If only one verifier is configured, the mode makes no practical difference.

If the entry has `verifiers: {}` (or no `verifiers` at all) the runtime
defers to the session check. With `requireSession: true` the call still
goes through on a valid session. With `requireSession: false` the runtime
rejects the call — empty/absent verifier entries are no longer treated as
implicit "no auth needed". Set `enabled: false` if you really want a
no-verifier, no-session route (e.g. an internal-only RPC fronted by a
network ACL).

### How to make a method "auth-less"

There are three legitimate ways to expose a method without bothering with
JWT/RPC verifiers, depending on what "auth-less" should mean for your use
case:

1. **Truly public** — anybody on the network can call it.
   ```ts
   export const policy = {
     pingHealth: { auth: { public: true } },
   } as const;
   ```
   Skip session, CSRF and verifier checks. Suitable only for endpoints that
   leak nothing and have no side effects.

2. **Session-only** — the call must come from a logged-in viewer tab. This
   is the *default*; you can leave `auth` off entirely.
   ```ts
   export const policy = {
     listMyThings: { auth: {} },                 // or omit auth entirely
   } as const;
   ```
   The runtime enforces the xOpat session cookie + `X-XOPAT-CSRF`. No
   `rpcVerifiers` configuration is needed.

3. **Verifier-only** — for service-to-service traffic that has a JWT but no
   browser session.
   ```ts
   export const policy = {
     ingestExternalEvent: {
       auth: { public: false, requireSession: false },
     },
   } as const;
   ```
   You **must** pair this with a `rpcVerifiers.<contextId>` entry that has
   real verifiers in it. For an internal-only no-verifier route, opt out
   explicitly:
   ```json
   { "server": { "secure": { "rpcVerifiers": {
     "default": { "enabled": false }
   } } } }
   ```
   An empty `default: {}` (or no `default` at all) is rejected — that was
   the original silent-bypass shape and is the failure mode the fail-closed
   guard is named after.

#### Note on Proxy auth configuration

Proxy auth is configured separately from RPC auth, under
`server.secure.proxy.<alias>`. Proxy verifier configuration uses the same
verifier maps but is unrelated to the RPC decision matrix above.

## Outbound HTTP — SSRF guard

Any `*.server.{ts,js,mjs}` file can reach a small server-level outbound-HTTP
guard via `globalThis.XOPAT_SERVER`. Use it instead of raw `fetch` whenever
the URL is operator- or user-influenced — provider registration, webhooks,
custom proxies, model discovery, etc.

```ts
const XS = globalThis.XOPAT_SERVER;

// Validate only — returns the parsed URL or throws SsrfBlockedError.
const url = await XS.validateUpstreamUrl(config.baseUrl);

// Fetch with: scheme allowlist (http/https), private/loopback/link-local/
// CGNAT/multicast block (IPv4 + IPv6), redirect: "manual" enforced, and
// a clear error on any 3xx so attacker-controlled hosts can't chain into
// private space.
const res = await XS.safeFetch(url.toString(), {
  method: "GET",
  headers: { ... },
  signal: ctx?.signal,
});
```

What the guard does **not** do:

- Vet redirects performed *inside* third-party SDKs that bring their own
  fetch (e.g. handing a baseURL to the Vercel AI SDK). Vet the baseURL with
  `validateUpstreamUrl` before constructing the SDK client; once the SDK
  takes over, its internal fetches are trusted.
- Pin DNS between validation and the actual fetch. The TOCTOU window is
  small and the upstream is typically operator-configured. A custom
  dispatcher (e.g. `undici` with `lookup`) or fetching by literal IP is
  required to close that gap.

#### Classified failures — `code`, `publicMessage`, `cause`

Every error the guard throws carries three fields, and the RPC layer honours them
on **any** thrown error (not just the guard's own):

| field | who reads it | rule |
| --- | --- | --- |
| `code` | the client (`err.code` after the RPC round trip) | forwarded verbatim when it is enum-shaped (`/^[A-Z][A-Z0-9_]*$/`), else `RPC_INTERNAL_ERROR` |
| `publicMessage` | the client, **in production** | host-free summary — this is what a non-admin sees |
| `message` | the server log, and the client **in dev mode only** | full detail, may name the upstream URL |
| `cause` | the server log | the original error; the logger walks it (depth-bounded) |
| `retriable` | the client's retry loop | forwarded when it is a boolean, and then it **wins over the status heuristic**. Omit when unknown |

Codes: `SSRF_BLOCKED` (a guard verdict — scheme, private range, redirect,
oversized body), `UPSTREAM_UNREACHABLE`, `UPSTREAM_TIMEOUT`, `UPSTREAM_DNS`,
`UPSTREAM_TLS` (transport failures, classified from `err.cause.code` — global
`fetch` reports all of them as the same opaque `TypeError: fetch failed`).

A module that wants the same treatment for its *own* failure throws
`XS.UpstreamRequestError` (or copies the two fields onto its error):

```ts
if (!res.ok) throw new XS.UpstreamRequestError(
    `Model discovery failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`,
    {
        code: "UPSTREAM_STATUS",
        publicMessage: `model discovery failed (HTTP ${res.status})`,
        retriable: res.status === 429 || res.status >= 500,
    }
);
```

**Set `retriable` whenever the upstream's status is what failed.** Every RPC
failure leaves this server as an HTTP 500, so the client's "5xx may be transient"
heuristic cannot see that the *upstream* answered 401 — and it will replay the
call three times (1s/2s/4s backoff) for a verdict that cannot change. You are the
only party holding `res.status`; say so. Guard verdicts (`SsrfBlockedError`) are
already `retriable: false` — a refused destination stays refused.

Do **not** branch on `isDevMode` to decide what to put in a message — build both
forms and let the RPC boundary pick. That decision belongs in one place, and a
per-module copy of it is how a URL eventually leaks into a production panel.

**Trusted internal upstreams.** The guard blocks private/reserved IPs because
they are the SSRF target surface (metadata, loopback, unauthed internal
services). A containerized deployment that must reach its own internal backends
(e.g. a Docker sibling on `172.28.0.0/16`) declares them via the operator env
vars `XOPAT_SSRF_ALLOWED_HOSTS` / `XOPAT_SSRF_ALLOWED_CIDRS` — the only supported
way to permit a private destination. The allowlist relaxes just the private-IP
verdict for the listed hosts/subnets; scheme, redirect, and DNS-rebinding
protection stay in force, and the default (empty) is fully strict. See
[`server/ENVIRONMENT.md` → SSRF](../ENVIRONMENT.md#ssrf-trusted-internal-upstreams).

`XOPAT_SERVER.isDevMode(ctx)` returns the operator dev flag
(`ctx.core.CORE.server.devMode`, set by `XOPAT_DEV_MODE` / `--dev`). Use it to
gate dev-only *behavior* — see [`server/ENVIRONMENT.md`](../ENVIRONMENT.md).

### Logging

`XOPAT_SERVER.log("module.<id>[:sub]")` — or the pre-scoped `ctx.log` inside an
RPC method, which already carries the request id and the hashed principal —
returns a channel logger (`trace/debug/info/warn/error`, plus `child`, `time`
and `sensitive`). Levels are per-channel and operator-controlled via
`core.server.logging`; payload dumps go through `log.sensitive(...)` and stay off
unless an operator opted in. Never `console.log` and never add a per-module
`XOPAT_*_DEBUG` env var. Full spec: [`server/LOGGING.md`](../LOGGING.md).

```ts
export async function myMethod(ctx, input) {
    const done = ctx.log.time("upstream");
    const data = await XOPAT_SERVER.safeRequest(url);
    done({ bytes: data.length });          // debug record with durationMs
    ctx.log.warn({ id: input.id }, "degraded result");
}
```

### Config without a request ctx

`getSecureModuleConfig(ctx, id)` needs a request. State that is built lazily —
a store created on first use, a retention policy — has none, which is how module
code drifted to `process.env`. Use `XOPAT_SERVER.getStaticModuleConfig(id)` /
`getStaticPluginConfig(id)`: the same composed (author ⊕ deployer) config, read
from the snapshot core republishes on every core build. Returns `{}` before the
first build — treat that as "defaults", never as "configured empty".

### Capability policy (roles)

A method may declare the capabilities its caller must hold. This is the half of
the roles system that is authorization rather than UI gating: the client decodes
the token unverified, the server resolves the same `core.roles` rules from the
token it has already verified.

```js
export const policy = {
    deleteEverything: {
        auth: { public: false, requireSession: true },
        capabilities: ["myPlugin.crud:thing.delete"],
        capabilitiesMode: "all",      // or "any"; default "all"
    },
};
```

Checked **after** authentication — a capability is a statement about a known
caller, and answering "forbidden" to an anonymous request would enumerate
methods — and **before** the concurrency gate, so a refused call costs no slot
and reaches no upstream. Refusal is `403` with code `RPC_CAP_DENIED`.

Two things worth knowing:

- **Declaring nothing changes nothing.** Existing methods are untouched, which
  is what makes this safe to add to a running deployment.
- **It fails closed on identity.** A capability-declaring method with no verified
  identity is refused, unlike the browser, which answers `true` for ids it does
  not know so that one deployment's config cannot lock another's UI.

For decisions that depend on the record being touched rather than the method,
call `XOPAT_SERVER.resolveRoles(ctx)` / `XOPAT_SERVER.can(ctx, id)` in the
handler. Resolution lives in `server/node/roles.js`, which borrows the browser's
own resolver (`src/classes/user-roles-core.ts`) rather than copying it; the two
are pinned together by `test/suites/unit/server-roles-parity.test.mjs`. Full
spec: [`src/USER_ROLES.md`](../../src/USER_ROLES.md).

### Runtime policy API

Each RPC method may optionally define a runtime section.

```
runtime: {
  timeoutMs: 5000,
  maxBodyBytes: 262144,
  maxConcurrency: 20,
  queueLimit: 100,
  isolation: "worker",
  circuitBreaker: {
    key: "cerit-chat",
    failureThreshold: 5,
    resetAfterMs: 30000
  }
}
```
### Runtime fields
`timeoutMs` - Maximum execution time for the method. If exceeded:

- the method fails

- timeout is logged

- worker/process may be terminated if isolated

`maxBodyBytes` - Maximum allowed request body size for this method.

If exceeded:

request is rejected

server returns 413 Payload Too Large

maxConcurrency

Maximum number of active calls for this method at once. At capacity, further
requests wait in a per-method queue; a queued caller that disconnects is
dropped from the queue without ever consuming a slot.

queueLimit

Maximum number of queued requests waiting for a concurrency slot.

If exceeded:

request is rejected with 429 and code `RPC_QUEUE_FULL`

isolation

Execution mode for the method.

Allowed values:

"none" or omitted

"worker"

"worker" means the method may be executed in a separate isolated process/worker path.

circuitBreaker

Optional upstream failure protection. `failureThreshold` consecutive failures
(timeouts included; client-disconnect aborts excluded) open the circuit for
`resetAfterMs`: requests fail fast with 503 and code `RPC_CIRCUIT_OPEN`. After
`resetAfterMs` the breaker goes half-open — traffic flows again with a single
remaining strike, so one more failure re-opens it immediately while one success
resets it fully. `key` shares one breaker across methods; it defaults to the
method key.

Example:

circuitBreaker: {
  key: "cerit-chat",
  failureThreshold: 5,
  resetAfterMs: 30000
}

Client-disconnect handling: when the requesting client goes away mid-call
(stop button, closed tab), the RPC's `ctx.signal` aborts, so handlers that
thread it into upstream requests cancel immediately instead of running to
their timeout.

concurrencyKey

Optional shared gate key (mirrors `circuitBreaker.key`, scoped to the same
plugin/module). Methods declaring the same `concurrencyKey` share ONE
maxConcurrency/queue pool — use it when a buffered and a streaming variant of
the same upstream operation must not double the effective concurrency.
Defaults to the method's own key.

### Streaming RPC mode (NDJSON)

A method declares `runtime: { streaming: true }` to answer as a newline-
delimited JSON stream on the same POST endpoint instead of one JSON body.
Generic and module-agnostic — any module can use it (chat token streaming is
the first consumer; a live transcription feed would work identically).

Handler contract: invocation is unchanged (`fn(ctx, ...args)`), plus
`ctx.emit(event) => Promise<void>` writes one `{"event": <payload>}` line
(awaits socket drain for backpressure; payload shape is the module's business).
The handler's return value becomes the terminal result; a throw becomes the
terminal error. Timeout, client-disconnect abort, concurrency slot, and
circuit breaker all wrap the FULL stream lifetime.

Wire protocol (`Content-Type: application/x-ndjson`, headers committed
eagerly so long-thinking handlers survive reverse-proxy read timeouts;
`X-Accel-Buffering: no` is set — configure `proxy_buffering off;` on nginx
for live delivery, otherwise the stream degrades gracefully to
buffered-looking arrival):

```
{"event": <module payload>}                          0..n
{"ping": true}                                       heartbeat (15 s default)
{"done": true, "ok": true, "result": <result>}       terminal success
{"done": true, "ok": false, "error", "code", "status"}  terminal failure
```

Rejections that happen BEFORE the stream opens (auth, CSRF, malformed JSON,
unknown method, body too large) remain plain-JSON HTTP errors. The headers are
committed right after the mode check — deliberately *before* the circuit
breaker and the concurrency gate, because the gate can **wait**: a turn queued
behind a saturated `maxConcurrency` used to send nothing at all, and the caller
timed out a request the server was handling exactly as designed. Those two
therefore answer in-band as terminal records (`RPC_CIRCUIT_OPEN`,
`RPC_QUEUE_FULL`) carrying the same code and status the HTTP answer had. The
client must send `X-Xopat-Rpc-Stream: 1`; mismatches answer 400
`RPC_STREAM_REQUIRED` / `RPC_NOT_STREAMABLE`.

**Timings are one setting, not two.** `core.server.rpc.streamHeartbeatMs`
(default 15 s) drives the ping period, and the client's dead-pipe window is
derived from it (`3×`, overridable with `core.server.rpc.streamStallMs`, floored
at `2×` the heartbeat) and interpolated into the client script — a watchdog can
never end up tighter than the signal it watches for. The caller applies that
window only to an *established* stream; before the response headers it allows
`2×` as long, since a request still waiting for admission has nothing it could
have sent. Two server-side warnings make the failure modes visible instead of
browser-only: a concurrency slot held longer than one heartbeat, and a heartbeat
that fires late (which means the event loop was blocked — that starves every
stream on the process). With `debugMode` on, the browser logs each received
line kind under `[rpc-stream]`.

Client side: `xserver.<kind>[id].$stream.<method>(payload, callOptions)` (or
`XOpatElement.callServerStream(...)` / `this.server().$stream.<method>(...)`)
returns `{ events: AsyncGenerator, result: Promise, abort(reason) }`. The pump
runs eagerly — `result` settles even when `events` is not consumed; a stream
that ends without a terminal record rejects with `RPC_STREAM_TRUNCATED`
(partial data is never a success), and a silent pipe (no bytes, pings
included, for the configured stall window — 45 s by default) aborts with
`RPC_STREAM_STALLED`. Transport is
`HttpClient.stream()` — auth headers, CSRF, proxy aliases, and session-expiry
recovery are identical to buffered RPC.
Structured logging

The runtime emits structured logs for RPC execution.

Typical events include:

rpc.complete

rpc.error

rpc.timeout

rpc.rejected

rpc.circuit_open

Typical fields include:

timestamp

request id

module/plugin id

method

auth context

duration

status

error code

process id

Structured logging is meant for:

debugging

production monitoring

tracing overload/failure patterns

Concurrency control

Concurrency is enforced per RPC method key.

Typical behavior:

- if active calls are below maxConcurrency, run immediately

- otherwise queue

  - if queue is full, reject

This prevents one method or integration from monopolizing the process.

### Circuit breakers

Circuit breakers help when upstream dependencies are failing.

Behavior:

- failures accumulate for a breaker key

- once threshold is reached, the breaker opens

- open breaker rejects requests immediately

- after resetAfterMs, the breaker allows a trial call again

This prevents the server from flooding a broken upstream.

### Worker isolation — NOT IMPLEMENTED

`runtime: { isolation: "worker" }` is **not wired up**. The policy normalizer
does not read `isolation`, nothing constructs a `worker_threads` Worker, and
`server/node/rpc-method-worker.js` is an unreferenced sketch. A method declaring
it runs exactly like any other method, in-process — do not rely on the isolation
for anything security-relevant.

Finishing it needs `ctx.principal` / `ctx.principalKind` in the serialized set
(identity would otherwise vanish inside the worker) and an answer for
`requireRpcAuthContext`, which needs `req`. See the header comment in
`rpc-method-worker.js`.

### Request size limits

RPC requests are JSON-based and have size limits.

This protects the server from:

- accidental huge payloads

- memory pressure

- abuse

The request body is rejected early when the configured byte limit is exceeded.

### Multi-process deployment

Single-process mode
```
node index.js                 # npm run s-node
```
Clustered mode
```
XOPAT_WORKERS=4 node server/node/cluster-index.js    # npm run s-node-cluster
```
The Docker image picks the clustered entrypoint automatically when
`XOPAT_WORKERS` is set.

#### What clustering changes

| Concern | Behaviour |
|---|---|
| **Sessions** | Split in two. The identity half (`kv:sessions` — id, CSRF token, timestamps) auto-binds to the shared `tiered` driver when clustered, so any worker recognises any session; **no sticky-session affinity is required**. The secure half (`kv:sessions-secure` — module-attached OIDC/SAML state) stays `sensitivity: "secret"` and memory-only. |
| **Interactive login** | Because the secure half is worker-local, an OAuth/SAML redirect flow needs `/login` and its callback to land on the same worker. To share it instead, set `allowPersistentSecrets: true` and bind `bindings.core["kv:sessions-secure"]` to `["tiered"]` — that writes refresh tokens to disk, so restrict the storage root first. |
| **`maxConcurrency` / `queueLimit`** | Interpreted as **deployment-wide** budgets and divided by the worker count (floor 1). A method declaring `maxConcurrency: 8` under `XOPAT_WORKERS=4` gets 2 per worker. |
| **Circuit breakers** | Still per-worker. A downed upstream is probed by each worker independently. |
| **Retention sweeps** | One leader at a time, elected by a lease on `<storageRoot>/.sweep.lock`. Not tied to worker id, so a worker restart does not lose the leader permanently. |
| **Builds** | `*.server.ts` compilation is serialized across processes with a per-output lock and lands via atomic rename, so a cold multi-worker boot compiles once. |
| **Logs / introspection** | Per-worker. `getLogs` / `getStorageStats` answer for whichever worker served the call; each record carries its `pid`. |

Other multi-process topologies (k8s replicas, PM2 fork mode) look single-process
from inside while sharing a filesystem. Tell the server with
`XOPAT_SHARED_DEPLOYMENT=1` (shared-state defaults) and
`XOPAT_SHARED_DEPLOYMENT_SIZE=<n>` (budget division).

#### Shutdown

`SIGTERM`/`SIGINT` drains rather than drops: stop accepting, end in-flight
NDJSON streams with a terminal `RPC_SERVER_SHUTDOWN` record instead of severing
the socket, let queued session write-backs run, release storage. The window is
`XOPAT_SHUTDOWN_GRACE_MS` (default 120s) — keep it under the orchestrator's own
kill timeout.

Use `/ready` (not `/health`) as the load-balancer probe: it reports 503 while
extensions are loading, if they failed, and for the whole drain window.
`/health` is liveness only and answers 200 regardless.


## Development - Core RPC
Start server with: `--dev / XOPAT_DEV_MODE=1 flag`


Start example:
node server/node/index.js --dev
or:
XOPAT_DEV_MODE=1 node server/node/index.js

Browser example:
window.xserver.server.core.getStatus()
window.xserver.server.core.getLogs({ afterId: 0, limit: 200 })

Built-in server RPC routes:

- `window.xserver.server.core.getStatus(payload?)` — dev only. Includes `memory`
  (the full `process.memoryUsage()`: `rss`, `heapTotal`, `heapUsed`, `external`,
  `arrayBuffers`) and `resourceUsage.maxRSS`, for leak hunting over a long run.
  Read it together with `getStorageStats`: a rising `rss` while the bounded caches
  sit at their caps is expected, whereas a rising `heapUsed` with flat cache
  counters is a real leak. Per-worker, like every other builtin. Deliberately not
  exposed on `getLogs`/`getLogChannels`, which are the production-reachable pair.
- `window.xserver.server.core.getStorageStats()` — dev only
- `window.xserver.server.core.collectGarbage()` — dev only, and additionally inert
  unless the process was started with `--expose-gc` (returns `available: false`).
  Forces a collection and returns `{before, after, freedBytes, durationMs}`, so a
  leak hunt can compare post-collection baselines instead of `heapUsed` sampled
  wherever the collector happened to be. A forced major GC pauses the process —
  it is a diagnostic, never a tuning knob, which is why it is doubly gated.
- `window.xserver.server.core.setLogLevel({channel, level})` — dev only, ephemeral, this worker only
- `window.xserver.server.core.getLogs(payload?)` — dev mode, **or** production for a
  principal listed in `core.server.logging.access` (empty allowlist ⇒ nobody)
- `window.xserver.server.core.getLogChannels()` — same access rule; lists channels,
  effective levels, sink state and counters

`window.xserver.server.dev.getLogs(...)` remains available as a compatibility alias.
See [`server/LOGGING.md`](../LOGGING.md).
