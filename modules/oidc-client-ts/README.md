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
  context for back-compat. `OIDCAuthClient.init()` auto-logs-in when there is no
  session (redirect/popup), so a declared `core` context logs the user in at boot.
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
