# Auth broker — require login for a context (`APPLICATION_CONTEXT.auth`)

xOpat features can **require the user to log in** before a piece of functionality
is usable, against **any** auth method (OIDC and SAML today; others can be added
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
  id, all at once. On the **server** the context in the RPC body is a *claim*: it
  selects which verifier set runs for that request. Code that must enforce a
  specific context takes it from the resource and calls
  `XOPAT_SERVER.requireRpcAuthContext(ctx, contextId)`.
- **the default / main context** — the main viewer identity. In JSON config and
  session bundles write it as an **empty string `""`, `null`, or simply omit it**
  — the explicit literal **`"core"`** is also accepted and means the same thing.
  All of these canonicalize to `"core"` (`XOpatUser._sanitizeContextId` /
  `XOpatAuth._ctx` / `oidc-flow.normalizeContextId`, all `contextId || "core"`),
  so whichever spelling you use it updates the appbar user + the default
  `XOpatUser`/`HttpClient` context and fires the **bare** `login` / `secret-updated`
  events (not `login:core`). Any non-empty id other than `"core"` is a
  sub-identity and fires namespaced `login:<id>` events. **Server RPC verifiers**
  use the **same** context, not a separate namespace: under
  `core.server.secure.rpcVerifiers` the main context may be keyed **`""`,
  `"core"` or `"default"` — all three are accepted and mean the same thing**.
  Use exactly one: they resolve to a single entry that governs every spelling, so
  the `contextId` a caller sends selects nothing, and two main spellings with
  *different* settings are refused (the caller would otherwise pick which one
  gates their own request). A **sub**-context that is sent but matches no entry is
  **rejected**, never silently downgraded onto the main entry — see
  `server/node/README.md`.
- **broker** — an auth-method implementation registered under a `method` name
  (`"oidc"`, `"oidc-server"`, `"saml"`). Interface:
  `{ init?(ctx,cfg), login(ctx,cfg), logout?(ctx,cfg), isAuthenticated?(ctx,cfg), getToken?(ctx,cfg) }`.
  Brokers store the resulting token in `XOpatUser` under `("jwt", ctx)` so the
  core defaults work even for methods that don't implement every hook.

## Requiring login from a feature

**A feature declares WHERE it authenticates, never HOW.** It names a context and
stops there; whichever auth module the deployment loads owns the mechanism. That
is what makes the same plugin work on an OIDC deployment, a SAML deployment, or
one with no auth at all.

```js
// 1. Declare the requirement (once, e.g. in pluginReady). No method named.
this.requireAuthContext();   // XOpatElement sugar: reads this element's own
                             // `authMode` / `authContext` static meta

// …or directly, when you are not an XOpatElement:
APPLICATION_CONTEXT.auth.requireContext({
    contextId: "anthropic",
    serviceName: "Anthropic Chat",
    requiresLogin: true,
});

// 2. Gate usage.
if (!APPLICATION_CONTEXT.auth.isAuthenticated("anthropic")) {
    await APPLICATION_CONTEXT.auth.login("anthropic");   // interactive
}

// 3. React to changes (login completes after a redirect-return on reload).
const off = APPLICATION_CONTEXT.auth.onChange((ctx) => updateUI());
```

`login()` resolves via `XOpatUser` events (not the broker's promise) because the
redirect flow unloads the page — completion is detected here and on reload. It
also waits (briefly) for the context to be claimed, since a server-declared
context (SAML's `listContexts` RPC) arrives asynchronously.

### Static-meta keys an `XOpatElement` reads

| key | default | meaning |
| --- | --- | --- |
| `authMode` | `"none"` | Anything but `"none"` requires login. **Opt-in** — a deployment that configures nothing still works. |
| `authContext` | `"core"` | Which context. `null`/`"core"` = the viewer's main identity, which resolves server-side against `rpcVerifiers.core` **or** `rpcVerifiers.default` — they are aliases. |
| `authBroker` + `authConfig` | — | Back-compat inline config, applied **only** when no auth module claims the context. Legacy aliases: `oidc` + `oidcFlow`. |

All read via `getStaticMeta` (deployment-trusted), never `getOption` — an
imported session bundle must never be able to flip `authMode` to `"none"`.

### Who owns a context, and what happens when nobody does

`configureContext` is for **auth modules** (they own methods); `requireContext` is
for **features** (they own requirements). A module's `configureContext` always wins
over a feature's inline fallback, even when it arrives late. If nothing claims a
required context, core logs a one-shot warning naming it — the deployment fix is
to load an auth module (`modules.<oidc-client-ts|saml-auth>.permaLoad: true`).
Features must **not** `requires` an auth module in `include.json`: that hardcodes
one mechanism into a feature that should accept any.

### Declaring what a broker stores — `secretTypes`

A broker declares `secretTypes` on each context it configures (default `["jwt"]`).
Consumers simply **omit** `auth.types` on their `HttpClient` — it is resolved per
request from `APPLICATION_CONTEXT.auth.getSecretTypes(contextId)`, so a client built
before the context was configured still follows the broker, and a future broker
storing something else declares it once with every consumer following unchanged.

### Boot login vs. clicked login — popup only works for the latter

**A login that starts without a user gesture must use the redirect flow.**
`window.open` is blocked by every browser when it is not called from a real click,
so an `autoLogin` context configured with a popup flow silently never signs in —
no error, no dialog, just an unauthenticated viewer. This applies to the boot
`init()` login *and* to a re-login kicked off by a 401 refresh handler.

Brokers own this: pick redirect for automatic logins, and honour the configured
`popup`/`redirect` flow only for `broker.login()` calls that came from the UI.
Both shipped brokers do (`oidc-client-ts` defaults an `autoLogin` context to
`redirect`; `saml-auth` forces redirect unless the login came from a gesture).
Core does **not** trigger a boot login for you — `configureContext` only calls
`broker.init()`, so acting on `autoLogin` is the broker's job. Core does, however,
**wait** for that attempt to finish before opening the first slide — see below.

## Waiting for a context to settle

A login is asynchronous (redirect return, silent renew, a server round-trip), while
the viewer starts opening slides on `DOMContentLoaded`. Without a barrier the first
slide-info/tile burst races the login, goes out with no `Authorization` header, and
the upstream answers 401. Three APIs on `APPLICATION_CONTEXT.auth` fix that:

```js
// Resolve once the context finished TRYING to authenticate; true if it succeeded.
await APPLICATION_CONTEXT.auth.whenContextSettled("core");              // bounded, default 8 s
await APPLICATION_CONTEXT.auth.whenContextSettled("core", { timeoutMs: 3000 });

// The same for several contexts under one deadline (defaults to all autoLogin ones).
const verdicts = await APPLICATION_CONTEXT.auth.whenAllSettled();       // { core: true }

// React to verdicts (also raised on XOpatUser as `auth-settled` / `auth-settled:<ctx>`).
const off = APPLICATION_CONTEXT.auth.onSettled(({ contextId, authenticated, reason }) => { … });
```

**Settled means *finished trying*, not *succeeded*.** A context whose IdP is
unreachable settles as `false` so callers degrade instead of hanging. These calls
never start an interactive login — that is `login()`; they only wait for the attempt
the broker makes on its own. Concurrent callers share one wait and the verdict is
memoized until the next `login`/`logout`/`secret-updated`/`secret-removed` for that
context, so the authenticated hot path costs nothing.

Two places use it:

- **Boot barrier.** `application-lifecycle-controller` awaits `whenAllSettled()` for
  the `autoLogin` contexts between `before-app-init` and the first slide open. Only
  `autoLogin` contexts qualify — a context declared merely as *required* has nothing
  driving a login at boot, so waiting for it would only burn the timeout. A
  deployment with no auth module resolves immediately and pays nothing.
- **`HttpClient`.** An endpoint with `auth.required` holds a request whose credential
  is not available yet until its context settles (`auth.awaitContext`, default
  `= required`; bound with `auth.awaitContextTimeoutMs`, default 8000). This covers
  everything the boot barrier cannot — slides opened later, history restores, and
  mid-session renewals. **Set `awaitContext: false` on any client an auth broker
  itself uses to obtain a credential for the same context**, or it waits on its own
  work.

When the wait fails, the request is still sent — unauthenticated, with one warning
per context. The upstream's own 401 is a better error than a synthetic client-side
one, and a transient auth outage must not be recorded as a permanent client failure.

### `AuthBroker.whenSettled` — for brokers that write the secret late

Core's default definition of settled is `init()` plus a short grace on
`login`/`secret-updated`, because brokers commonly deposit the token from an
asynchronous event a tick after `init()` resolves. A broker that can report this
precisely implements the optional hook:

```js
async whenSettled(ctx, cfg) { await clientFor(ctx, cfg).whenSettled(); }
```

It **must not** start an interactive login and **must** resolve — core races it
against its own deadline regardless.

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
does — order-independent. **SAML** ships exactly this way — `modules/saml-auth`
registers a `"saml"` broker and required no core change; any further method is
added the same way.

> **Hint — multiple candidates for one context.** A context binds to exactly one
> broker, but that broker may internally hold an **ordered list of candidates** and
> try them by priority: run each candidate's `init`, and after each check whether
> auth is now established (`XOpatUser.getIsLogged(ctx) && getSecret("jwt", ctx)`) —
> if not, fall through to the next. A candidate **opts out** simply by depositing no
> token (e.g. an iframe-only candidate that detects `window.self === window.top` and
> yields, so a new-tab candidate takes over). Candidates can reuse already-registered
> brokers (`"oidc"`, `"oidc-server"`). This is a feature-side convention today — the
> candidate list lives in the context `config`; core may grow first-class support for
> it later.

## Server-side enforcement — the verifier is provided by the module

Client gating is UI-only; the real gate is the server. **Core is auth-agnostic**:
it exposes a generic verifier registry (`registerRpcAuthVerifier` /
`registerProxyAuthVerifier` in `server/node/auth.js`) and a **boot hook**, but knows
no auth types. A module ships a `register.server.{ts,mjs,js}` exporting
`register(serverApi)`; at startup core loads each once
(`XopatServerRuntime.loadServerExtensions`) and calls it, so the module registers
its verifier before any request. This mirrors the client
`APPLICATION_CONTEXT.auth.registerBroker(...)` pattern.

- **`"jwt"`** — HS256 shared-secret (a generic core primitive). Config:
  `{ secret | secretEnv, issuer?, audience?, clockSkewSec? }`.
- **`"bearer"`** — shared-secret gate, **no identity**. Requires
  `{ secret | secretEnv }` (or `core.server.auth.bearer`) and fails closed without
  one; the token is compared in constant time. A context verified only by `bearer`
  can never satisfy a resource that needs a user principal — pair it with an
  identity verifier.
- **`"oidc"`** — RS256/JWKS, **registered by `modules/oidc-client-ts/register.server.ts`**
  (verifies an asymmetric JWT against the IdP JWKS). Config comes from the per-context
  verifier entry: `{ jwksUri, issuer, audience, algorithms?, forward?, userClaimHeader? }`.
- **`"oidc-server"`** — server-side OIDC code flow, registered by
  `modules/oidc-server-ts/register.server.ts`.
- **`"saml"`** — registered by `modules/saml-auth/register.server.ts`. It verifies
  the HS256 token the *same module* minted from the validated SAML assertion, reading
  the signing secret from its own `contexts.<ctx>.token.*` config, so minter and
  verifier cannot drift. Config is usually just `{}`; `{ contextId }` pins the SAML
  context when the verifier key differs from it. (The generic `jwt` verifier pointed
  at the same secret still works and stays supported, but now needs the secret in
  two places.)

**The verifier's return value is the caller's identity.** Return
`{ ok: true, user }`; core normalizes it into `ctx.user.id` and `ctx.principal`
(`user:<id>` / `sess:<id>`, never a shared `null` bucket). Return an explicit
`user.id` when your method has its own identity model; otherwise core maps
`sub`/`oid`/`upn`/`preferred_username`/`email`. See the *"The principal"* section
of `server/node/README.md`.

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
calls go through an `HttpClient` configured `auth:{ contextId }` — the secret types
come from the context automatically — and send `contextId` in the RPC body
(verifier selection). See
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
> `modules/saml-auth` is likewise Node-only — PHP has no `register.server` loader
> and no RPC verifier registry, so its routes are never mounted there (the HS256
> token it mints would, however, verify under the PHP proxy `jwt` verifier).

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
provider the same way — a module that registers a broker (+ optionally a
verifier and routes) and feeds `XOpatUser`.

## SAML 2.0 — `modules/saml-auth`

Same contract, different protocol. A SAML assertion is signed XML, so the flow is
**necessarily server-side**: the module mounts `/auth/saml/{metadata,login,acs,finish,slo}/<ctx>`,
validates the assertion against the IdP certificate, and **mints a short-lived
HS256 token** which the broker `"saml"` writes into `XOpatUser` under `("jwt", ctx)`
— from there everything downstream (HttpClient, `isAuthenticated`, the appbar
identity) is identical to OIDC.

The same module registers the **`"saml"` server verifier**, which verifies that
token against its own `contexts.<ctx>.token` config — so enforcement is
`"verifiers": { "saml": {} }` with no secret duplicated anywhere.

| Provider | Context config lives in | Register with IdP | Details |
| --- | --- | --- | --- |
| `saml-auth` (server SP) | `core.server.secure.modules["saml-auth"].contexts.<ctx>` (certs + keys stay server-side) | ACS `<origin>/auth/saml/acs/<ctx>`, SLO `<origin>/auth/saml/slo/<ctx>`; metadata at `<origin>/auth/saml/metadata/<ctx>` | [`modules/saml-auth/README.md`](../../modules/saml-auth/README.md) |

Two SAML-specific things worth knowing before you debug it:

- **There is no refresh token.** The server keeps the validated claims on the
  xOpat session and re-mints the token on `getToken` until `sessionTtlSec`
  elapses; after that an interactive login is required.
- **The ACS is a cross-site POST**, so the `SameSite=Lax` session cookie is absent
  on it. The module parks the result under a single-use code and bounces through a
  top-level GET (`/auth/saml/finish/<ctx>`) to bind it to the session. Don't
  "simplify" that into a direct session write — it cannot work.

## Security

Auth/OIDC config is **deployment-trusted** — read it with `getStaticMeta`
(ENV/`include.json`), never `getOption` (session/third-party controllable). See
`AGENTS.md` §3 / §7.
