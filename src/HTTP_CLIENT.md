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
  types: ["jwt"],          // which auth handler(s) to use
  handlers: {},            // custom handlers (rarely needed)
  refreshOn401: true,      // whether to trigger secret refresh on 401
  required: false,         // if true, warn when no secret is found
  }

    - `contextId`  
      The context under which secrets are stored in `XOpatUser`.  
      This must match what your OIDC client uses, e.g. `"openai"`, `"cerit-io"`.

    - `types`  
      List of auth types to apply, in order. For each type:
        - The client looks up a secret via `XOpatUser.getSecret(type, contextId)`.
        - If found, it runs the corresponding handler to get headers.

    - `handlers`  
      Optional map of custom auth handlers. By default, `HttpClient` has global auth handlers registered (e.g. `"jwt"`). You can override or extend them.

    - `refreshOn401`  
      If `true`, and a request returns 401, the client will fire a `requestSecretUpdate` event so other code (e.g. OIDC auth client) can refresh the token.

    - `required`  
      If `true` and the client is using a proxy and no secrets were found, `_authHeaders` will emit a warning:
      > HttpClient: auth.required=true for proxy request but no secrets found…

- `secretStore` (optional)  
  Object with `getSecret(type, contextId)` and `setSecret(...)`. Defaults to `XOpatUser.instance()`.

- `timeout` (number, optional)  
  Request timeout in milliseconds (if implemented in your environment).

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
  query: { ... },        // optional query string object
  responseType: "json" | "text" | "arraybuffer", // default "json"
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

`HttpClient` has a static registry of handlers:

- `HttpClient.addAuthHandler("name", handlerFn)`
- `HttpClient.removeAuthHandler("name")`

A handler has the form:

    async function myHandler({ secret, type, contextId, url, method }) {
      return {
        "Authorization": "Bearer " + secret,
      };
    }

The provided `"jwt"` handler does exactly this:

- Takes the JWT secret from `XOpatUser`.
- Adds `Authorization: Bearer <jwt>` header.

### 4.3. Auth flow inside `_authHeaders`

When a request is sent:

1. `_authHeaders` iterates over `auth.types` (e.g. `["jwt"]`).
2. For each type:
    - Looks up a secret `getSecret(type, contextId)`.
    - If found, calls the handler with `{ secret, type, contextId, url, method }`.
    - Merges the returned headers into the request.
3. If `required` is `true`, the client is using a proxy, and **no secret** was found for any type, a warning is logged.

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

- `auth.verifiers` (array of strings)  
  List of auth verifiers to run (e.g. `["jwt"]`).

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