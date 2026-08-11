# oidc-client-ts — client-side OIDC (PKCE public)

Browser-side OpenID Connect / OAuth2 login for xOpat, built on the vendored
[`oidc-client-ts`](https://github.com/authts/oidc-client-ts) library. It runs the
**whole flow in the browser** as a **PKCE public client** (no `client_secret`),
obtains a token, and hands it to `XOpatUser` so `HttpClient` "just works". It is
the **default** OIDC provider.

> For IdPs that *require* a confidential client (a `client_secret`), use the
> server-side [`oidc-server-ts`](../oidc-server-ts/README.md) module instead — a
> secret shipped to the browser is insecure (this module warns and still proceeds
> PKCE-style). The canonical auth model is documented in [`src/AUTH.md`](../../src/AUTH.md).

## Purpose

- Perform automated login + silent token refresh against an OIDC IdP.
- Register an **`"oidc"` broker** into the core auth registry
  (`APPLICATION_CONTEXT.auth`, `XOpatAuth`), so features can *require login* for a
  named context without touching OIDC code.
- Attach the obtained JWT to upstream requests (via `XOpatUser` + `HttpClient`).

## Behavior

- **Auto-declared contexts** (`auth-broker.js`): at boot the broker reads this
  module's **public static config** and declares each context into
  `APPLICATION_CONTEXT.auth` — so the main viewer login needs no plugin or feature
  code (this replaced the removed `oidc-auth` plugin). Convention: the **default /
  main context** = the main viewer identity (updates the appbar user + the default
  `XOpatUser`/`HttpClient` context); any other id is a sub-identity. Key the default
  context as **`""` / `null` / `"core"`** (all equivalent — they canonicalize to
  `"core"` and fire the bare `login`/`secret-updated` events; see
  [`src/AUTH.md`](../../src/AUTH.md#concepts)). Shape:
  ```jsonc
  "modules": { "oidc-client-ts": { "permaLoad": true,
    "contexts": {
      "core": {                                // "" / null / "core" → main identity
        "oidc": { "authority": "...", "client_id": "...", "scope": "..." },
        "authMethod": "redirect",              // "redirect" | "popup"
        "tokenForServer": "access_token",      // or "id_token"
        "serviceName": "...", "usesStore": "default"
        // "isMain": true                       // implied for "core"
        // "autoLogin": false                   // declare WITHOUT the boot login
      }
    }
  }}}
  ```
  A **legacy** bare top-level `oidc` block (+ `method`) is accepted as the `core`
  context for back-compat (only when `contexts` is absent — the two cannot be
  mixed). `OIDCAuthClient.init()` auto-logs-in when there is no session
  (redirect/popup), so a declared `core` context logs the user in at boot.
- **Broker registration** (`auth-broker.js`): registers `"oidc"` into
  `APPLICATION_CONTEXT.auth`. A feature may ALSO declare a (sub-)context in code —
  e.g. in `pluginReady` — and then gate on it:
  ```js
  await APPLICATION_CONTEXT.auth.configureContext({
      contextId: "anthropic",              // XOpatUser sub-context + token key + verifier id
      method: "oidc",
      config: { authority, client_id, scope },   // the OIDC block (see below)
      serviceName: "Anthropic Chat",
      authMethod: "popup",                 // "popup" (default) | "redirect"
      tokenForServer: "id_token"           // which token the server verifies
  });
  if (!APPLICATION_CONTEXT.auth.isAuthenticated("anthropic")) {
      await APPLICATION_CONTEXT.auth.login("anthropic");   // interactive
  }
  ```
- **One `OIDCAuthClient` per context** (`oidc-auth.js`), each with its own
  authority/client_id/scope. These are sub-contexts (`updateXOpatUser: false`) —
  not the main viewer identity.

### `usesStore` — where OIDC state lives

Every value routes through the IO pipeline; none of them touches
`localStorage` / `sessionStorage` directly. That is deliberate: in a sandboxed
iframe (opaque origin) the property read itself throws `SecurityError`, and the
pipeline substitutes in-memory drivers there — see
[`src/IO_PIPELINE.md`](../../src/IO_PIPELINE.md).

| value | capability | outlives the tab? |
|---|---|---|
| `"default"` / `"session"` | `kv:session` (owner `module.oidc-client-ts`) | no — survives a login redirect, dies with the tab |
| `"local"` / `"cache"` | `kv:cache` (owner `core`) | yes, when localStorage is available |
| `"cookie"` | `kv:cookies` (owner `core`) | yes, when cookies are available |

`"local"` used to mean the bare `localStorage` root; it is now namespaced under
the owner uid, so deployments that set it re-login once. Storage that is
unavailable degrades to memory rather than throwing — auth still works, it just
does not survive a reload.

**In a sandboxed frame OIDC login cannot complete** (redirect and popup flows
both need a real origin), but nothing here throws at load: the client
configures its stores and the feature simply reports "not authenticated".

### Multiple contexts (two IdPs, or one IdP twice)

Declare as many `contexts.<ctx>` entries as you need — one client is built per
context, with its own authority, client_id, scope and its own namespaced storage
(`oidc.<ctx>.` in `sessionStorage`). One rule governs the shape:

> **At most one context may log in at boot.** The boot flow is a full-page
> redirect: it unloads the page, so a second one issued in the same tick simply
> cancels the first. Give exactly one context (normally `core`) the boot login and
> make every other one on-demand.

Defaults already encode this: the **main** context auto-logs-in unless you set
`"autoLogin": false`, while a **sub-context** is on-demand unless you set
`"autoLogin": true`. A sub-context therefore defaults to the popup flow, which is
what an on-demand login needs — popups are blocked unless opened from a real click.

```jsonc
"contexts": {
  "core":    { "oidc": { "authority": "https://idp-a/…", "client_id": "viewer",  "scope": "openid email" } },
  "archive": { "oidc": { "authority": "https://idp-b/…", "client_id": "archive", "scope": "openid" },
               "serviceName": "Slide archive" }          // on-demand by default
}
```

`archive` is registered at boot but stays logged out. Log it in from a **click**:

```js
if (!APPLICATION_CONTEXT.auth.isAuthenticated("archive")) {
    await APPLICATION_CONTEXT.auth.login("archive");     // popup
}
```

Nothing prompts automatically on first use: an `HttpClient` bound to a context only
*waits* for it to settle and then sends the request unauthenticated, and the 401
refresh path attempts a **silent** renew only. A sub-context needs a UI affordance —
see the chat panel's Login button for the worked pattern.

If two contexts both ask for a boot redirect, the broker keeps the main one, demotes
the rest to on-demand and logs a `console.error` naming them. They remain fully
usable via `auth.login(...)`.

**Give each context its own `client_id`.** The library keys its user store by
`user:<authority>:<client_id>`, so two contexts sharing both would share one stored
session regardless of the per-context prefix.
- **Flows**: `authMethod: "popup"` (default; opens a new tab, keeps the workspace)
  or `"redirect"` (full-page). `login()` resolves via `XOpatUser` events, not the
  broker promise, because a redirect unloads the page — completion is detected here
  and on reload.
- **`redirect_uri`**: if not set, defaults to the **current page URL** stripped of
  `?query`/`#hash` (`origin + pathname`); `popup_redirect_uri` defaults to it. So
  **the URL you register with the IdP is the page the viewer loads at** (e.g.
  `http://localhost:9000/`). Set `redirect_uri` explicitly to pin it.
- **Server-side verification** (`register.server.ts`): registers the `"oidc"`
  RS256/JWKS verifier for RPC **and** proxy — incoming Bearer tokens are checked
  against the IdP JWKS. Core stays auth-agnostic; the verifier ships with this
  module and is mounted once at boot (`loadServerExtensions`).

## Configuration

### 1. The client OIDC block (per context)

The `oidc` block inside a `contexts.<ctx>` entry (see *Behavior*), or passed as
`config` to `configureContext` when a feature declares a context in code:

```jsonc
"oidc": {
  "authority": "https://accounts.google.com",   // IdP base (issuer)
  "client_id": "<oauth-client-id>",
  "scope": "openid email profile",
  // "redirect_uri": "http://localhost:9000/",  // optional — pin instead of page URL
  "confidential": false                          // must be false; a secret warns
}
```

Register with the IdP (Google Console → *Authorized redirect URIs*): the
**redirect URI = the page URL** the viewer loads at (or your explicit
`redirect_uri`), and add the origin under *Authorized JavaScript origins*.

### 2. The server verifier (per context)

Under `core.server.secure.rpcVerifiers.<contextId>` (and/or `proxies.<alias>.auth`):

```jsonc
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

### Which token — `tokenForServer`

`tokenForServer` selects the token stored as the `XOpatUser "jwt"` secret (default
`"access_token"`). **Pick it by who consumes the token** — an upstream API called
directly (→ `access_token`, and add the API's `scope`) vs. our own RS256/JWKS
verifier (→ a JWT; Google's is the `id_token`). The full decision rule + pitfalls
are in [`src/AUTH.md`](../../src/AUTH.md#which-token-to-expose--tokenforserver--scope)
— e.g. DICOM against Google Healthcare needs `access_token` +
`.../auth/cloud-healthcare` in `scope`, or it 401s after login.

## Security

Auth/OIDC config is **deployment-trusted** — read it with `getStaticMeta`
(ENV/`include.json`), never `getOption` (session/third-party controllable). Never
put a `client_secret` here (it would ship to the browser). See `AGENTS.md` §3/§7
and [`src/AUTH.md`](../../src/AUTH.md).
