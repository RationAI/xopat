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
cookie and a matching `X-XOPAT-CSRF` header.

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
request body. The runtime then looks it up against
`server.secure.rpcVerifiers`:

1. If `contextId` is a string and `rpcVerifiers` has an **own property** by
   that name, that entry is used.
2. Otherwise the `default` entry (own property only) is used.
3. Otherwise the verifier context is empty — see the decision matrix.

The own-property requirement matters: a naive lookup would let a client send
`contextId: "__proto__"` and reach `Object.prototype`, which has no
verifiers and was previously treated as "no auth required". The runtime now
uses `Object.prototype.hasOwnProperty.call(...)` to block that bypass.

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

`SsrfBlockedError` (also exposed on `XS`) has `code === "SSRF_BLOCKED"` so
callers can distinguish guard rejections from upstream errors.

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

Maximum number of active calls for this method at once.

queueLimit

Maximum number of queued requests waiting for a concurrency slot.

If exceeded:

request is rejected

usually with overload status

isolation

Execution mode for the method.

Allowed values:

"none" or omitted

"worker"

"worker" means the method may be executed in a separate isolated process/worker path.

circuitBreaker

Optional upstream failure protection.

Example:

circuitBreaker: {
  key: "cerit-chat",
  failureThreshold: 5,
  resetAfterMs: 30000
}
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

### Worker isolation

Methods marked with:
```
runtime: {
  isolation: "worker"
}
```
run in isolated execution.

> **Important limitation**
> Worker-isolated methods receive a reduced serializable context, not live server objects.
> They should not depend on: raw `req`, `res`, non-serializable mutable objects, direct closures into the live server runtime
> They should depend on: method inpu, basic user/session metadata, simple config data, serializable context fields

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
node index.js
```
Clustered mode
```
node cluster-index.js
```
Optional worker count: `XOPAT_WORKERS=4 node cluster-index.js`


## Development - Core RPC
Start server with: `--dev / XOPAT_DEV_MODE=1 flag`


Start example:
node server/node/index.js --dev
or:
XOPAT_DEV_MODE=1 node server/node/index.js

Browser example:
window.xserver.server.core.getStatus()
window.xserver.server.core.getLogs({ afterId: 0, limit: 200 })

These built-in server RPC routes are available only in dev mode:

- `window.xserver.server.core.getStatus(payload?)`
- `window.xserver.server.core.getLogs(payload?)`

`window.xserver.server.dev.getLogs(...)` remains available as a compatibility alias.
