# oidc-server-ts — server-side OIDC (confidential)

Server-side OpenID Connect token provider for xOpat. It runs the OAuth
**authorize → callback → refresh** flow **on the server**, so the `client_secret`
**and** the long-lived `refresh_token` never leave the server. The browser only
ever receives the short-lived access/id token, which is written into `XOpatUser`
so `HttpClient` works transparently.

Use this for IdPs that **require a confidential client** (a `client_secret`). For
public PKCE clients (no secret, flow in the browser), use
[`oidc-client-ts`](../oidc-client-ts/README.md) instead. The canonical auth model
is in [`src/AUTH.md`](../../src/AUTH.md).

## Purpose

- Keep the `client_secret` + `refresh_token` **server-side only**.
- Register an **`"oidc-server"` broker** into `APPLICATION_CONTEXT.auth` so
  features require login for a context exactly like any other method.
- Provision each context's token into `XOpatUser` (refreshing server-side as
  needed), and register the matching server-side RS256/JWKS **verifier**.

## Behavior

- **Server routes** (`register.server.ts`, mounted via
  `serverApi.registerServerRoute("/auth/oidc-server", …)`):
  - `GET /auth/oidc-server/login/<ctx>` — builds an authorize request (PKCE S256,
    `access_type=offline`, `prompt=consent`) and redirects the browser to the IdP.
  - `GET /auth/oidc-server/callback/<ctx>` — validates `state`, exchanges the code
    **with the secret** for tokens, stashes the `refresh_token` on the xOpat
    session, then either **closes the popup** (popup flow — `postMessage`s the
    opener same-origin so the viewer keeps its workspace) or **redirects back** to
    the `return` URL (redirect flow, same-origin only).
- **Login UX — popup by default** (`flow`): the client glue opens login in a
  **popup** so the viewer tab (and unsaved work) is preserved; if the browser
  blocks the popup it **falls back to a full-page redirect**. Set `"flow":
  "redirect"` on a context to force the redirect flow. The popup vs redirect mode
  is carried through the OAuth `state` (via `?display=`), so the callback knows how
  to finish.
- **redirect_uri (register this with the IdP):** built server-side as
  **`<viewer-origin>/auth/oidc-server/callback/<contextId>`**
  (`viewer-origin` = `core.client.domain` when a full URL, else the request host).
  Example for context `core` on localhost:
  ```
  http://localhost:9000/auth/oidc-server/callback/core
  ```
  Add that under the IdP's *Authorized redirect URIs*, and the origin
  (`http://localhost:9000`) under *Authorized JavaScript origins*. Each context id
  is its own callback path.
- **Client glue** (`auth-broker.js`): registers `"oidc-server"` into
  `APPLICATION_CONTEXT.auth`, discovers the server-declared contexts via the
  `listContexts` RPC (public flags only — no secrets), and on
  `secret-needs-update:<ctx>` (or at boot / after a login redirect returns) calls
  the `getToken` RPC → server refreshes if needed → token written to `XOpatUser`.
  `autoLogin: true` kicks the interactive login (popup by default) when the server
  has no session token.
- **Session-scoped RPC** (`policy` in `register.server.ts`, all `requireSession`):
  `listContexts`, `getToken({contextId})`, `logout({contextId})`.
- **Verifier**: registers the `"oidc-server"` RS256/JWKS verifier for RPC + proxy,
  so server-side gating works for tokens minted through this module.

## Configuration

### 1. Server-side contexts (secrets live here, `server.secure` only)

`core.server.secure.modules["oidc-server-ts"].contexts.<contextId>`. Key the
default/main context as **`""` / `"core"` / `"default"`** (all resolve to the main
identity `"core"`; `normalizeContextId` in `oidc-flow.ts` handles the aliases and
`listContexts` emits the canonical `"core"` to the client). Any other id is a
sub-context. See [`src/AUTH.md`](../../src/AUTH.md#concepts).

```jsonc
"core": { "server": { "secure": {
  "modules": {
    "oidc-server-ts": {
      "contexts": {
        "core": {                                    // "" / "core" / "default" → main identity
          "issuer": "https://accounts.google.com",   // or "discoveryUrl": "…/.well-known/openid-configuration"
          "clientId": "<oauth-client-id>",
          "clientSecret": "<server-only-secret>",     // NEVER shipped to the browser
          "scope": "openid email profile",            // add the upstream API's scope, e.g. .../auth/cloud-healthcare
          "authMethod": "post",                       // token-endpoint creds: "post" (Google) | "basic"
          "tokenForServer": "access_token",           // choose by WHO consumes it — see note below
          "autoLogin": true,                          // kick login on first missing token (e.g. DICOM 401)
          "flow": "popup",                            // "popup" (default, keeps workspace) | "redirect"
          "serviceName": "Google"
        }
      }
    }
  },
```

`tokenForServer` (default `access_token`): pick it by **who consumes the token** —
an upstream API called directly (→ `access_token` + that API's `scope`) vs. our own
RS256/JWKS verifier (→ a JWT; Google's is the `id_token`). Full rule + pitfalls in
[`src/AUTH.md`](../../src/AUTH.md#which-token-to-expose--tokenforserver--scope).

### 2. The server verifier (per context)

`core.server.secure.rpcVerifiers.<contextId>` (same block as above continues):

```jsonc
  "rpcVerifiers": {
    "core": {
      "verifiers": { "oidc-server": {
        "jwksUri": "https://www.googleapis.com/oauth2/v3/certs",
        "issuer":  "https://accounts.google.com",
        "audience": "<oauth-client-id>"
      } },
      "mode": "all"
    }
  }
} } }
```

Only the **public** per-context flags (`autoLogin`, `tokenForServer`,
`serviceName`) reach the browser (via `listContexts`); issuer/secret/scope stay on
the server.

### Enabling

Enable the module (`modules["oidc-server-ts"].enabled/permaLoad`) and, for each
feature, gate on the context — e.g. DICOM/`HttpClient` uses the default `core`
context, which this module provisions (server-side refresh replaces the blocked
hidden-iframe silent renewal).

## Security

Server-only config is **deployment-trusted** and lives under `server.secure`; the
`client_secret` and `refresh_token` never leave the server. `return` targets are
restricted to the same origin (no open redirect). See `AGENTS.md` §3/§7 and
[`src/AUTH.md`](../../src/AUTH.md).
