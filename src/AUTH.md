# Auth broker — require login for a context (`APPLICATION_CONTEXT.auth`)

xOpat features can **require the user to log in** before a piece of functionality
is usable, against **any** auth method (OIDC today; SAML or others can be added
without touching core). This is coordinated by a core singleton, **`XOpatAuth`**,
reached as `APPLICATION_CONTEXT.auth` — a sibling to `XOpatUser`.

- **`XOpatUser`** (`src/classes/user.ts`) holds per-context *identity + secrets*:
  `getIsLogged(ctx)`, `getSecret/setSecret("jwt", ctx)`, events `login:<ctx>` /
  `secret-updated:<ctx>`.
- **`XOpatAuth`** (`src/classes/auth/xopat-auth.ts`) is the *registry +
  orchestration* on top: it knows **how** to obtain a login for a named context
  via a pluggable **broker**, and exposes a uniform `login` / `isAuthenticated`.

Core is deliberately **method-agnostic** — brokers *register into* it (inversion
of control). No OIDC/SAML code lives in core.

## Concepts

- **context id** — a string naming a login session (e.g. `"anthropic"`). It is
  the `XOpatUser` sub-context, the token key, and the server RPC verifier-context
  id, all at once.
- **the default / main context** — the main viewer identity. In JSON config and
  session bundles write it as an **empty string `""`, `null`, or simply omit it**
  — the explicit literal **`"core"`** is also accepted and means the same thing.
  All of these canonicalize to `"core"` (`XOpatUser._sanitizeContextId` /
  `XOpatAuth._ctx` / `oidc-flow.normalizeContextId`, all `contextId || "core"`),
  so whichever spelling you use it updates the appbar user + the default
  `XOpatUser`/`HttpClient` context and fires the **bare** `login` / `secret-updated`
  events (not `login:core`). Any non-empty id other than `"core"` is a
  sub-identity and fires namespaced `login:<id>` events. **Server RPC verifiers**
  are a separate namespace: the fallback verifier context key is **`"default"`**
  (an unmatched/empty/`"core"` `contextId` in an RPC falls back to
  `rpcVerifiers.default`) — see `server/node/README.md`.
- **broker** — an auth-method implementation registered under a `method` name
  (`"oidc"`, later `"saml"`). Interface:
  `{ init?(ctx,cfg), login(ctx,cfg), logout?(ctx,cfg), isAuthenticated?(ctx,cfg), getToken?(ctx,cfg) }`.
  Brokers store the resulting token in `XOpatUser` under `("jwt", ctx)` so the
  core defaults work even for methods that don't implement every hook.

## Requiring login from a feature

```js
// 1. Declare how the context authenticates (once, e.g. in pluginReady).
await APPLICATION_CONTEXT.auth.configureContext({
    contextId: "anthropic",
    method: "oidc",                 // a registered broker
    config: { authority, client_id, scope },   // method-specific (OIDC block)
    serviceName: "Anthropic Chat",
    authMethod: "popup",            // OIDC flow: "popup" | "redirect"
    tokenForServer: "id_token"      // which token our server verifies (see below)
});

// 2. Gate usage.
if (!APPLICATION_CONTEXT.auth.isAuthenticated("anthropic")) {
    await APPLICATION_CONTEXT.auth.login("anthropic");   // interactive
}

// 3. React to changes (login completes after a redirect-return on reload).
const off = APPLICATION_CONTEXT.auth.onChange((ctx) => updateUI());
```

`login()` resolves via `XOpatUser` events (not the broker's promise) because the
redirect flow unloads the page — completion is detected here and on reload.

## Registering a broker (auth method)

A module owns the method implementation and registers it. The OIDC broker lives
in `modules/oidc-client-ts/auth-broker.js` and wraps the global `OIDCAuthClient`:

```js
APPLICATION_CONTEXT.auth.registerBroker("oidc", {
    async init(ctx, cfg)  { await clientFor(ctx, cfg).init(); },   // process redirect-return
    async login(ctx, cfg) { clientFor(ctx, cfg).signIn(); },       // interactive
    async logout(ctx)     { XOpatUser.instance().logout(ctx); },
    isAuthenticated(ctx)  { const u = XOpatUser.instance(); return u.getIsLogged(ctx) && !!u.getSecret("jwt", ctx); },
    getToken(ctx)         { return XOpatUser.instance().getSecret("jwt", ctx); }
});
```

Contexts declared before a broker registers are initialized automatically when it
does — order-independent. **Adding SAML** = registering a `"saml"` broker the same
way; no core change.

## Server-side enforcement — the verifier is provided by the module

Client gating is UI-only; the real gate is the server. **Core is auth-agnostic**:
it exposes a generic verifier registry (`registerRpcAuthVerifier` /
`registerProxyAuthVerifier` in `server/node/auth.js`) and a **boot hook**, but knows
no auth types. A module ships a `register.server.{ts,mjs,js}` exporting
`register(serverApi)`; at startup core loads each once
(`XopatServerRuntime.loadServerExtensions`) and calls it, so the module registers
its verifier before any request. This mirrors the client
`APPLICATION_CONTEXT.auth.registerBroker(...)` pattern.

- **`"jwt"`** — HS256 shared-secret (a generic core primitive).
- **`"oidc"`** — RS256/JWKS, **registered by `modules/oidc-client-ts/register.server.ts`**
  (verifies an asymmetric JWT against the IdP JWKS). Config comes from the per-context
  verifier entry: `{ jwksUri, issuer, audience, algorithms?, forward?, userClaimHeader? }`.

Enable per context under `core.server.secure.rpcVerifiers.<contextId>`:

```json
"rpcVerifiers": {
  "anthropic": {
    "verifiers": { "oidc": {
      "jwksUri": "https://www.googleapis.com/oauth2/v3/certs",
      "issuer":  "https://accounts.google.com",
      "audience": "<client_id>"
    } },
    "mode": "all"
  }
}
```

The client attaches the context's token automatically: provider-scoped chat RPC
calls go through an `HttpClient` configured `auth:{ contextId, types:["jwt"] }`,
and send `contextId` in the RPC body (verifier selection). See
`src/HTTP_CLIENT.md` (§6–9) and `server/node/README.md` (RPC auth matrix).

### Which token to expose — `tokenForServer` (+ scope)

`tokenForServer` picks which OIDC token becomes the `XOpatUser "jwt"` secret — the
token `HttpClient` attaches for that context. **Choose by who CONSUMES the token,
not by the IdP alone** (getting this wrong is the usual cause of a 401 *after* a
successful login):

- **An upstream API consumes it directly** (e.g. DICOM's `HttpClient` calling
  Google Healthcare) → send exactly what that API expects — normally the
  **`access_token`** — and make sure the context's **`scope`** includes what the
  API authorizes (e.g. `.../auth/cloud-healthcare`). A missing scope or the wrong
  token type shows up as a **401 from that upstream API**.
- **Our own server verifies it** (an RPC/proxy `oidc` verifier, RS256/JWKS) → the
  token must be a verifiable **JWT**. Keycloak/Auth0 access tokens are JWTs
  (`access_token`); **Google's access token is opaque** — only its **`id_token`**
  is an RS256 JWT (`aud = client_id`), so use `id_token` there.

Default is `access_token`. If one context needs both and they conflict (opaque
access token wanted upstream, but our server needs a JWT), split into two contexts.

> **PHP note:** the `oidc` verifier is Node-only for now; the PHP server verifies
> HS256 (`"jwt"`) at the proxy only. RS256/JWKS PHP parity is a follow-up.

### Common auth pitfalls (symptom → cause)

- **401 from an upstream API after login works** → wrong `tokenForServer` for that
  API, or the context `scope` is missing the API's scope (see above).
- **`redirect_uri_mismatch` at the IdP** → the exact redirect URI the provider
  sends isn't registered. It is **provider-specific**: the page URL for
  `oidc-client-ts`, the `/auth/oidc-server/callback/<ctx>` route for
  `oidc-server-ts` — see the module README before registering.
- **`IFrame timed out` / silent-renew failures** → client-side token renewal uses a
  hidden iframe the browser may block (third-party cookies). Prefer `oidc-server-ts`
  (server-side refresh) when the deployment needs long-lived upstream access.
- **`client_secret` warning dialog** → a secret was put in a *client* (`oidc-client-ts`)
  config; move confidential clients to `oidc-server-ts`.

## Two OIDC providers: client PKCE vs server secret

Both providers register a broker into `APPLICATION_CONTEXT.auth` and both simply
**put the token into `XOpatUser`** for a context — so plugins never touch login;
they just use `HttpClient` with the context and, on 401, the broker (re)provisions.

- **`oidc-client-ts`** (client-side, **PKCE public**) — the default. Runs the whole
  flow in the browser (`OIDCAuthClient`). It *allows* a `client_secret` but shows a
  **warning dialog** (a secret shipped to the browser is insecure) — use the server
  module instead. Broker `"oidc"`.
- **`oidc-server-ts`** (server-side, **confidential**) — for IdPs that require a
  secret. The `client_secret` **and** the `refresh_token` live only on the server /
  xOpat session; the browser gets only the short-lived access/id token. Broker
  `"oidc-server"`.

Both follow the same convention and are interchangeable at the config level:

- **The default context = the main viewer identity** (updates the appbar user + the
  default `XOpatUser`/`HttpClient` context); any other id is a sub-identity. Key it
  in JSON as `""` / `null` / omitted / `"core"` — all equivalent (see *Concepts*).
- **Both auto-declare their contexts from config** and drive the broker — no
  feature code owns the main login. `oidc-server-ts` reads `server.secure` (via its
  `listContexts` RPC); `oidc-client-ts` reads its **public** static config
  `modules["oidc-client-ts"].contexts.<ctx>` (a bare top-level `oidc` block is
  accepted as the `core` context for back-compat). Swapping providers = moving the
  context block between the two locations. This auto-declaration is what **replaced
  the former `oidc-auth` plugin** (now removed).

**Where each is configured** (config keys, the exact redirect URI to register, and
the login/refresh mechanics are provider-specific — see the module README):

| Provider | Context config lives in | Register with IdP | Details |
| --- | --- | --- | --- |
| `oidc-client-ts` (client PKCE) | `modules["oidc-client-ts"].contexts.<ctx>` (public; no secret) | the **page URL** | [`modules/oidc-client-ts/README.md`](../../modules/oidc-client-ts/README.md) |
| `oidc-server-ts` (server confidential) | `core.server.secure.modules["oidc-server-ts"].contexts.<ctx>` (secret + refresh stay server-side) | `<origin>/auth/oidc-server/callback/<ctx>` | [`modules/oidc-server-ts/README.md`](../../modules/oidc-server-ts/README.md) |

DICOM (and any consumer) needs no changes: its `HttpClient` uses the default
(`core`) context, which whichever provider is configured provisions. Add a new
provider (SAML, …) the same way — a module that registers a broker (+ optionally a
verifier and routes) and feeds `XOpatUser`.

## Security

Auth/OIDC config is **deployment-trusted** — read it with `getStaticMeta`
(ENV/`include.json`), never `getOption` (session/third-party controllable). See
`AGENTS.md` §3 / §7.
