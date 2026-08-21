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
        "authMethod": "redirect",              // "redirect" | "popup" — the INTERACTIVE flow
        "tokenForServer": "access_token",      // or "id_token"
        "serviceName": "...", "usesStore": "default"
        // "isMain": true                       // implied for "core"
        // "autoLogin": false                   // declare WITHOUT the boot login
        // "maxRetryCount": 2                   // failed attempts before giving up
        // "retryTimeout": 20                   // seconds shown on the retry toast
        // "extraSigninRequestArgs": { ... }    // IdP extras (acr_values, login_hint, …)
      }
    }
  }}}
  ```
  `autoLogin` says *whether* a context logs in at boot, `authMethod` says which
  interactive flow it uses when it needs one — see *Boot login: silent first* below
  for what each combination does. Bounds on the silent attempt come from the library
  key `silentRequestTimeoutInSeconds` inside the `oidc` block; there is no separate
  xOpat knob.
  A **legacy** bare top-level `oidc` block (+ `method`) is accepted as the `core`
  context for back-compat (only when `contexts` is absent — the two cannot be
  mixed). `OIDCAuthClient.init()` processes a *returning* callback and arms the renew
  loop; the boot login itself is driven by core (`XOpatAuth.runAutoLogin`), so a
  declared `core` context still logs the user in at boot.
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

### Boot login: silent first

The ladder itself is core's (`src/AUTH.md` → *Core drives the automatic login*); this
broker supplies the mechanism: `loginSilent` = `signinSilent()`,
`canLoginWithoutGesture` = `navigatesOnLogin` = `authMethod === "redirect"`.
`signinSilent()` returns **`"unknown"`** rather than `false` when it could not reach
the identity provider at all, so core declines to escalate a network blip into a
redirect that would land the user on a browser error page. `login()` **returns a
verdict** (`false` for a closed popup or a refused exchange), so core stops holding
the recovery scrim instead of waiting out its five-minute interactive timeout.
What an `autoLogin` context actually does at boot:

| `authMethod` | boot attempt | if it does not authenticate |
| --- | --- | --- |
| `"redirect"` (default for `autoLogin`) | silent first, then a full-page redirect | the IdP page takes over |
| `"popup"` | silent only | reports to the interaction gate — the user signs in from the scrim or the app-bar user menu |

Silent means one of two very different things, and the difference matters:

- **with a refresh token** → a token-endpoint call. Cheap, no frame, repeatable.
- **without one** → a hidden `prompt=none` iframe. This is a *probe* of the identity
  provider's own session (established by an embedding page, another tab, an earlier
  visit) — there is nothing of ours to renew. It rides the IdP's cookies in a
  third-party context, so it fails wherever those are blocked.

**The probe runs at most once per session.** Its answer cannot change until
something else signs the user in, and each attempt costs a watchdog timeout plus
three IdP redirects. A landed credential re-arms it (`SILENT_PROBE_ONCE_PER_SESSION`,
`_silentSignIn`). Concurrent callers — a burst of 401s, boot plus a slide — share one
in-flight attempt. Core adds a second, broker-independent bound on the 401 path
(`XOpatUser.REFRESH_COOLDOWN_MS` / `MAX_REFRESH_FAILURES`).

Regression signature to watch for: repeated `…/oidc/authorize?…&prompt=none` requests
minutes apart in one session, each ending in a redirect bounce or an aborted request.

### Callbacks must not boot the viewer

`silent_redirect_uri` **and** `popup_redirect_uri` fall back to `redirect_uri`, which
defaults to the bare page URL — so both the library's `prompt=none` frame and the
sign-in popup load **the whole application**: plugins, tile sources, slide metadata.
In the frame that routinely outruns the 10 s watchdog
(`silentRequestTimeoutInSeconds`), and the resulting `ErrorTimeout` used to be
reported as "your session expired" while the token in hand was perfectly valid; in
the popup the user watched a second viewer boot and disappear.

`OIDCAuthClient._doInit` therefore answers such a callback and stops before booting
(`_handleForeignAuthCallback`). The detector is the stored `request_type` (`"si:s"` =
silent, `"si:r"` = redirect, `"si:p"` = popup) plus the window relationship it
implies — a `si:s` response only short-circuits inside a frame, a `si:p` one only
when there is a `window.opener` to post the result to. No heuristics, so a
legitimately **embedded** viewer completing its own `si:r` login is never mistaken
for either, and anything unrecognised falls through to the normal path.

Symptoms that this regressed: console lines whose page URL carries `?state=…`
(a second application booting), `[Intervention] … beforeunload` from `IFrameWindow`,
`ErrorTimeout` right after a successful login.

Related knobs, both passed straight through from the per-context `oidc` block:
`silentRequestTimeoutInSeconds` (library default 10) and
`accessTokenExpiringNotificationTimeInSeconds` (default 60 — if it is ≥ the token
lifetime the library clamps the renew timer to 1 s and renews continuously;
`_tuneRenewWindow` warns with the exact value to set). A deployment that prefers a
dedicated callback document can set `silent_redirect_uri` explicitly — but it must be
registered at the IdP verbatim, or the renew fails with `redirect_uri_mismatch`.

### Failure classification: report ≠ expire

- **IdP verdicts** (`interaction_required`, `login_required`, `consent_required`,
  `account_selection_required`) mean a human is needed.
- **Timeouts** (`ErrorTimeout`, "IFrame timed out", "Network timed out", "Failed to
  fetch") mean the answer never arrived. They are retried, never treated as a verdict.
- Either way the module reports to `APPLICATION_CONTEXT.auth.markNeedsInteraction`
  **without `force`**, so core defers while the credential still works and acts only
  once it actually stops working (see [`src/AUTH.md`](../../src/AUTH.md)). A renew
  failure never tears down a working session.
- A redirect that comes back with `?error=interaction_required` — the expected answer
  to an automatic `prompt=none` attempt — triggers **one** real interactive login for
  an `autoLogin` context. The guard is a store flag (`xopat.interactive-retry.<ctx>`),
  not a URL marker, because `redirect_uri` must match the IdP registration verbatim;
  it is released whenever a credential lands.

  > **Superseded.** That automatic retry is gone, and with it the
  > `xopat.interactive-retry.<ctx>` flag. It started a full-page redirect from inside
  > `init()`, which bypasses core's boot marker and its arbitration of the single
  > page-unloading login across *all* brokers — in a deployment that also loads
  > `saml-auth` or `oidc-server-ts` that is a second `location.assign` cancelling the
  > first. A callback that comes back `interaction_required` now reports to the
  > recovery gate; core's own ladder makes the redirect on the next load, under the
  > marker. Costs one click in the narrow case where the silent frame was blocked
  > *and* the answer landed top-level.

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

Core enforces that now (`XOpatAuth.runAutoLogin`), which is the only place that can:
this module could only ever see *its own* contexts, so a deployment running it
alongside `saml-auth` or `oidc-server-ts` had two brokers each guarding half the set
and nothing guarding the whole. A demoted context stays configured and logs in on
demand, with a `console.error` naming it.

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
