# HTTP Client & Proxy – Developer Guide

This document explains:

1. How to use the **HttpClient** in the viewer.
2. How to configure and use the **generic proxy** on the server.
3. How **authentication** between client ↔ proxy ↔ upstream is wired.

It’s written so you can drop it into your repo as `README-http-client-proxy.md`.

---

## 1. HttpClient overview

`HttpClient` is the standard way to make HTTP requests from the viewer code.

It supports:

- Normal requests to **absolute** or **relative** URLs.
- Requests via a **server-side proxy** (to hide API keys).
- **Pluggable auth handlers** (JWT, basic, …) that add headers based on secrets stored in `XOpatUser`.
- Automatic **CSRF** header injection for proxied requests.

Typical usage:

- Construct a client:

  const client = new HttpClient({
  baseURL: "/api",
  auth: {
  contextId: "core",
  types: ["jwt"],
  required: true,
  },
  });

- Send a request:

  const result = await client.request("user/info", {
  method: "GET",
  });

---

## 2. HttpClient constructor options

You create a client like:

    const client = new HttpClient(options);

Available options:

- `baseURL` (string, optional)  
  Prefix added in front of `path` you pass to `.request()`.  
  If `path` is relative, the final URL is `baseURL + "/" + path`.

- `proxy` (string, optional)  
  Name of the server proxy alias (e.g. `"openai"`, `"cerit"`). When set:
    - All requests go through `/proxy/<alias>/<path>`.
    - CSRF header is added automatically.

- `auth` (object, optional)  
  Controls how auth headers are added from secrets:

  {
  contextId: "openai",     // which XOpatUser context to read secrets from
  types: undefined,        // omit: resolved from the context at request time
  handlers: {},            // custom handlers (rarely needed)
  refreshOn401: true,      // whether to trigger secret refresh on 401
  required: false,         // warn when no secret is found; also defaults awaitContext
  awaitContext: undefined, // wait for the context to authenticate; defaults to `required`
  awaitContextTimeoutMs: 8000,
  }

    - `contextId`  
      The context under which secrets are stored in `XOpatUser`.  
      This must match what your OIDC client uses, e.g. `"openai"`, `"cerit-io"`.

    - `types`  
      List of auth types to apply, in order. For each type:
        - The client looks up a secret via `XOpatUser.getSecret(type, contextId)`.
        - If found, it runs the corresponding handler to get headers.

      **Just omit it when you pass a `contextId`.** Types are resolved at *request*
      time from `APPLICATION_CONTEXT.auth.getSecretTypes(contextId)`, so the auth
      module owning the context decides (`secretTypes`) and a client constructed
      before that context was configured still follows it. `["jwt"]` remains the
      fallback for a context nobody has configured. Pass an explicit list only to
      override the owning module. Note these are *client* secret types — the
      **server** verifier names (`jwt`, `oidc`, `saml`, …) are a separate namespace,
      linked only by `contextId`.

    - `handlers`  
      Optional map of custom auth handlers. By default, `HttpClient` has global auth handlers registered (e.g. `"jwt"`). You can override or extend them.

    - `refreshOn401`  
      If `true`, and a request returns 401, the client will fire a `requestSecretUpdate` event so other code (e.g. OIDC auth client) can refresh the token. The refresh now rejects immediately when no auth module listens for `secret-needs-update` on that context, instead of sitting on a 20 s timer.

    - `required`  
      If `true` and no secret was found, `_authHeaders` warns **once per context** (proxied or not):
      > XOpatRemoteEndpoint: auth.required=true but no secret is available for context 'core'…

      It also turns on `awaitContext` by default.

    - `awaitContext` / `awaitContextTimeoutMs`  
      Before issuing a request for which no secret exists yet, wait (bounded) for the
      auth context to finish authenticating — `APPLICATION_CONTEXT.auth.whenContextSettled`.
      This is what stops the boot request burst from racing an asynchronous login
      (OIDC redirect return, silent renew) and 401-ing. The wait is resolved *before*
      the request timeout is armed, honours the caller's `AbortSignal`, and never
      throws: if it fails the request is sent unauthenticated so the upstream's own
      401 (with its diagnostics) is what surfaces. Complementary to `refreshOn401`,
      which covers *expiry* rather than *not-logged-in-yet*.

      **Set it to `false` on any client an auth broker itself uses to obtain a
      credential for the same context** — it would otherwise wait on its own work.
      See `src/AUTH.md` → "Waiting for a context to settle".

- `secretStore` (optional)  
  Object with `getSecret(type, contextId)` and `setSecret(...)`. Defaults to `XOpatUser.instance()`.

- `timeoutMs` (number, optional, default `30000`)
  Per-request timeout in milliseconds. Implemented via `AbortController` in `HttpClient.request`.

- `maxRetries` (number, optional, default `3`)
  Number of automatic retries on `429` and `5xx` responses. Set to `0` to disable retries.

  The status is only a **heuristic**, and an error body may overrule it. A JSON
  error payload carrying `"retriable": false` is never replayed, at any status;
  `"retriable": true` is always replayed. This exists because our own RPC layer
  answers `500` for every handler throw, so the status cannot distinguish an
  overloaded gateway from an upstream `401` relayed through it — the server-side
  thrower sets the flag (see `server/node/README.md`, the error-contract table).
  Absent the flag: `429` retries, `5xx` retries except `504` + `code:
  "RPC_TIMEOUT"`, everything else does not.

---

## 3. Making requests

Call:

    const result = await client.request(path, options);

Where:

- `path` (string)  
  Path relative to `baseURL` (if set). For proxy mode, this is the path after `/proxy/<alias>/`.

- `options` (object)

  {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", // default "GET"
  headers: { ... },      // extra headers
  body: any,             // will be JSON.stringify’d if object
  query: { ... },        // optional query string object — appended via URLSearchParams; arrays become repeated keys
  expect: "json" | "text" | "auto", // default "auto" — drives response parsing
  }

Example:

    const client = new HttpClient({
      baseURL: "/api",
    });

    const data = await client.request("items", {
      method: "GET",
      query: { page: 1, pageSize: 20 },
    });

    const created = await client.request("items", {
      method: "POST",
      body: { name: "New item" },   // will be sent as JSON
    });

---

## 4. Auth handlers in detail

### 4.1. Secrets in XOpatUser

`HttpClient` relies on `secretStore` (by default `XOpatUser`) to obtain credentials:

- `XOpatUser.setSecret(secretValue, type, contextId)`
- `XOpatUser.getSecret(type, contextId)`

Typically, your OIDC auth client will:

- Log the user in.
- Store tokens in `XOpatUser` with `type = "jwt"` and `contextId = "openai"` (or similar).

### 4.2. Global auth handlers

`HttpClient` has a static registry of handlers, inherited from `XOpatRemoteEndpoint`:

- `HttpClient.registerAuthHandler("name", handlerFn)`
- `HttpClient.knowsSecretType("name")` — whether anything can turn that secret into headers

A handler has the form:

    async function myHandler({ secret, type, contextId, url, method }) {
      return {
        "Authorization": "Bearer " + secret,
      };
    }

Two handlers ship by default:

- **`"jwt"`** — takes the JWT secret from `XOpatUser`, adds `Authorization: Bearer <jwt>`.
- **`"basic"`** — takes a `{username, password}` secret and adds
  `Authorization: Basic base64(user:pass)`. It returns `{}` when no secret (or no
  `username`) is stored, so it is inert until something provides a credential.

Which types a request actually uses comes from the context, not from a hardcoded
list: `auth.types` if you passed it, else `APPLICATION_CONTEXT.auth.getSecretTypes(contextId)`,
else `["jwt"]`. A broker declares `secretTypes` when it configures its context —
`modules/basic-auth` declares `["basic"]` — and every consumer follows with no
code change.

> **Basic auth:** the handler is only half the story. A credential source must
> store the secret. Load `modules/basic-auth` for a per-user login prompt, or —
> preferably, when the credential is per-deployment rather than per-user — inject
> it server-side via `server.secure.proxies.<alias>.headers` so it never reaches
> the browser at all. See `modules/basic-auth/README.md`.

### 4.3. Auth flow inside `_authHeaders`

When a request is sent:

1. Cross-origin URLs (an absolute URL outside `baseURL`'s origin) drop **all** auth headers, with one warning per foreign origin.
2. If `awaitContext` is on and no secret exists yet, the client waits (bounded, abortable) for `APPLICATION_CONTEXT.auth.whenContextSettled(contextId)`.
3. `_authHeaders` iterates the resolved secret types (explicit `auth.types`, else `getSecretTypes(contextId)`, else `["jwt"]`).
4. For each type:
    - Looks up a secret `getSecret(type, contextId)`.
    - If found, calls the handler with `{ secret, type, contextId, url, method }`.
    - Merges the returned headers into the request.
5. If `required` is `true` and **no secret** was found for any type, one warning per context is logged and the request goes out unauthenticated.

The proxy/login enforcement is ultimately done server-side; the client just controls whether it *tries* to send tokens and warns if it can’t.

---

## 5. Proxy mode in HttpClient

You enable proxy mode by passing a `proxy` string:

    const client = new HttpClient({
      proxy: "cerit",
      baseURL: "/v1/chat/completions",
      auth: {
        contextId: "cerit-io",
        types: ["jwt"],
        required: true,
      },
    });

Behavior in proxy mode:

- All requests are made to:

  /proxy/&lt;alias>/&lt;baseURL>/&lt;path>?...

  For example:

  /proxy/cerit/v1/chat/completions

- HttpClient automatically adds **CSRF** header if `window.XOPAT_CSRF_TOKEN` is available:

  X-XOPAT-CSRF: <token>

  If the token is missing, a warning is logged.

- It also adds **X-XOPAT-Session** if `window.XOPAT_SESSION_ID` is available.
  That global exists only under `core.server.security.cookielessSessions`,
  i.e. when the viewer is embedded in a third-party page and may have **no
  cookie jar at all** — third-party cookies blocked, or a `sandbox` iframe
  without `allow-same-origin`. The server then accepts the header in place of
  the session cookie (the CSRF check is unchanged, and the cookie still wins
  when both arrive). Outside that mode the global is absent and nothing extra
  is sent. See [Embedding the viewer in a third-party page](../server/README.md#embedding-the-viewer-in-a-third-party-page).

- Credentials mode is set appropriately (e.g. `credentials: "same-origin"`) so cookies and CSRF protection work as expected.

---

## 6. Server-side proxy basics

On the server, there is a generic `/proxy/<alias>/...` handler that:

1. Reads the viewer configuration (`core.CORE.server.secure.proxies`).
2. Finds the proxy config for `alias`.
3. Optionally runs **auth verifiers**.
4. Forwards the request to the configured `baseUrl` + `targetPath`.
5. Merges static `headers` (e.g. API keys) from the config.

### 6.1. Proxy configuration

In your server config (e.g. `config.json`):

    "server": {
      "secure": {
        "proxies": {
          "cerit": {
            "baseUrl": "https://llm.ai.e-infra.cz/v1/",
            "headers": {
              "Authorization": "Bearer <CERIT_API_KEY>"
            },
            "auth": {
              "enabled": true,
              "verifiers": ["jwt"],
              "mode": "all",
              "jwt": {
                "secret": "<% VIEWER_JWT_SECRET %>",
                "issuer": "https://login.example.com/",
                "audience": "xopat-viewer",
                "forward": false,
                "userClaimHeader": "x-user-sub"
              }
            }
          }
        }
      }
    }

Fields:

- `baseUrl`  
  The upstream base URL to forward to (e.g. CERIT, OpenAI, internal gateway).

- `headers`  
  Static headers always added to upstream requests (API keys, custom headers).

- `auth.enabled` (boolean)  
  Whether viewer-level auth should be enforced for this proxy.

- `auth.verifiers` (object map, or array of strings)  
  Which verifiers must run. Two accepted shapes:

      "verifiers": { "jwt": { "secret": "<% VIEWER_JWT_SECRET %>" } }   // preferred
      "verifiers": ["jwt"]                                              // shorthand

  The **map** form is preferred and is what the rest of the docs use: it is the
  only one that can carry per-verifier configuration. The **array** form is
  shorthand for "these verifiers, with empty config", and then the settings must
  come from the sibling block (`auth.jwt` below). Both are normalized identically
  on every backend — `getVerifierEntries` in `server/node/auth.js`.

  Note this is the **proxy** `auth` block. RPC uses a separate
  `server.secure.rpcVerifiers` section with the same two shapes — see
  [`AUTH.md`](AUTH.md).

- `auth.mode` (`"all"` or `"any"`)
    - `"all"`: all listed verifiers must pass.
    - `"any"`: at least one must pass.

- `auth.jwt` (object, optional)  
  Per-proxy JWT settings (see below).

---

## 7. Proxy auth verifiers

The server has a small framework for verifiers:

- Registry:

  registerProxyAuthVerifier("name", async ({ req, res, core, alias, proxyConfig, upstream }) => {
  // throw or return false to fail
  // mutate upstream.headers as needed
  return true;
  });

- Main function:

  await verifyProxyAuth(req, res, core, alias, proxyConfig, upstreamState);

`upstreamState` is:

    {
      headers: { ... },   // mutable headers object to send upstream
      targetPath: string, // e.g. "/v1/chat/completions"
    }

Verifiers can:

- Inspect the request (`req.headers`, `req.user`, etc.).
- Validate tokens or other credentials.
- Add or remove headers in `upstream.headers` before the request is sent to the upstream service.

If auth fails, `verifyProxyAuth` sends `401 Unauthorized` and the proxy stops.

---

## 8. JWT verifier (HS256)

> **Server support.** The JWT verifier described here runs as a **proxy** verifier
> on **both** the Node and PHP servers (the two implementations are kept at
> parity). **RPC** verifiers (§7's `rpcVerifiers`, used to gate `/__rpc/...`) are
> **Node-only** — the PHP server has no RPC endpoint, so on PHP, JWT applies to the
> proxy only. See [Generic Deployment → PHP server](../docs/web/generic_deployment.md).

There is a built-in `"jwt"` verifier that:

1. Extracts `Authorization: Bearer <token>` from the request.
2. Parses the JWT (header, payload, signature).
3. Verifies that:
    - `header.alg === "HS256"`, `header.typ === "JWT"`.
    - Signature matches using the configured secret.
    - `exp` has not passed, `nbf` (if present) is valid.
    - `iss` and `aud` match configured values (if set).

Configuration sources:

- Global: `core.CORE.server.auth.jwt`
- Per-proxy: `proxyConfig.auth.jwt` (overrides global)

Example JWT config:

    "server": {
      "auth": {
        "jwt": {
          "secret": "<% VIEWER_JWT_SECRET %>",
          "issuer": "https://login.example.com/",
          "audience": "xopat-viewer",
          "clockSkewSec": 60,
          "forward": false,
          "userClaimHeader": "x-user-sub"
        }
      }
    }

Per-proxy can override specific keys:

    "server": {
      "secure": {
        "proxies": {
          "cerit": {
            "auth": {
              "enabled": true,
              "verifiers": ["jwt"],
              "mode": "all",
              "jwt": {
                "forward": false,
                "userClaimHeader": "x-user-sub"
              }
            }
          }
        }
      }
    }

Behavior after verification:

- If valid, sets `req.user = payload` (decoded JWT claims).
- If `jwtCfg.forward !== true`, removes `Authorization` from `upstream.headers` so the upstream service does not see the viewer’s JWT.
- If `jwtCfg.userClaimHeader` is set and `payload.sub` exists, adds:

  upstream.headers[jwtCfg.userClaimHeader.toLowerCase()] = payload.sub;

Thus, the upstream can see the user identity via a custom header, but not the full JWT.

---

## 9. Client ⇄ Proxy auth alignment

To make everything coherent:

- For a proxy that **requires viewer auth**:
    - Set `auth.enabled: true` + `verifiers: ["jwt"]` on the server.
    - On the client, construct `HttpClient` with:
        - `proxy: "<alias>"`,
        - `auth.contextId` set to your OIDC context,
        - `auth.types: ["jwt"]`,
        - `auth.required: true`.

- For a proxy that uses **only API keys, no viewer auth**:
    - Set `auth.enabled: false` (or omit `auth`) on the server.
    - On the client, use:
        - `proxy: "<alias>"`,
        - `auth` either omitted or `required: false` and `types: []`.

This way:

- Server is the ultimate gatekeeper (rejects unauthenticated requests).
- Client only controls whether it *tries* to send auth headers and logs helpful warnings when misconfigured.

---

## 10. Summary

- Use `HttpClient` for all viewer-side HTTP.
- Use `proxy` when talking to external APIs (LLMs, cloud services) so secrets stay on the server.
- Configure `auth` in both:
    - viewer (what headers to send),
    - server (what verifiers to run and how to forward to upstream).
- The JWT verifier ensures that:
    - viewer tokens are valid,
    - upstream only sees what it needs (API keys + optional user ID header),
    - headers can be cleaned/reshaped per proxy.

With this setup, you have a **flexible, secure, and configurable** pipeline for LLMs and other external services that can evolve to support additional auth methods simply by registering new verifiers.