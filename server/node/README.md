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

The method is protected and may trigger configured RPC verifiers.

`public: true`

The method is public and skips configured RPC verifier checks.

`requireSession: true`

A normal xOpat session is required.

`requireSession: false`

No session is required. This is allowed, but the server should warn in logs.

### Extending default auth: RPC verifier configuration

RPC verifiers are configured under `server.secure.rpcAuth`:
```
{
  "server": {
    "secure": {
      "rpcAuth": {
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
        }
      }
    }
  }
}
```
### Context resolution

RPC verifier config is resolved by contextId.


> Important note
> default: {} does not mean public access.
> It means: no extra verifier checked, normal session/CSRF behavior still applies unless the method says otherwise

#### Verifier mode
`mode: "all"`

All configured verifiers must pass.

`mode: "any"`

At least one configured verifier must pass.

If only one verifier is configured, the mode usually makes no practical difference.

#### Note on Proxy auth configuration

Proxy auth is configured separately from RPC auth.

Proxy verifier configuration is also server-side and uses configured verifier maps, not hardcoded method verifier arrays.

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
