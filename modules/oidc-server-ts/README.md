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
  It also announces that discovery to core (`registerContextDiscovery`) so the boot
  barrier waits for contexts that only exist after that RPC answers.
- **Boot login is core's, not ours.** `init()` only adopts an existing server-side
  session. With `autoLogin: true`, core (`XOpatAuth.runAutoLogin`) drives the ladder:
  it calls our `loginSilent` first, and only then — if we are the one context allowed
  to navigate this page load — our `login(ctx, cfg, {gesture:false})`, which does a
  **full-page redirect** regardless of `flow`, because a login that no click
  initiated cannot open a popup. `flow` still governs the click-driven login (the
  recovery gate, a Login button), where `popup` keeps the workspace. The boot marker
  that stops a redirect loop is core's too, and it round-trips through our return URL
  for free (we default it to `window.location.href`). `autoLogin: false` leaves the
  context on-demand: nothing happens until a feature calls `auth.login(ctx)`.
- **`flow` defaults to `"redirect"`.** It is the only flow that works with no user
  gesture behind it, so it is what an unconfigured deployment needs at boot; a popup
  there is blocked by every browser. Set `"flow": "popup"` to keep the tab instead.
  Either way core has the last word: it hands down `mayNavigate`, and this module
  falls back to a popup whenever a navigation is refused (the viewer is framed, or the
  user has work a redirect would discard).
- **`loginSilent` reports `"unknown"`, not `false`, on a transport failure.** Being
  unable to *ask* whether a session exists is not evidence that none does; core then
  declines to redirect rather than bouncing the user to an identity provider it just
  failed to reach.
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
          "autoLogin": true,                          // redirect to the IdP at boot when there is no session
          "flow": "popup",                            // CLICK-driven login: "popup" (default, keeps workspace) | "redirect"
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

**Why `getToken`/`logout` are session-gated, not context-verified.** These are the
credential *dispenser* for a context, so requiring a verified bearer for the very
context whose bearer only this call can hand out is circular — and it refuses
outright on a deployment that configures no `rpcVerifiers` (common: the token is
consumed by an upstream API, not by our own RPC). The gate is `requireSession:
true` (session cookie + CSRF) plus a token store scoped to the caller's **own**
session, so every context reachable from here already belongs to the caller;
naming another one picks among their own credentials rather than escalating. The
verifier config in §2 above is what gates *resources*, and it is still required
for anything that must enforce a specific context server-side.
