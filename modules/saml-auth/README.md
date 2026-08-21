# saml-auth — SAML 2.0 Single Sign-On

Server-side SAML 2.0 **Service Provider** for xOpat. It runs the
**AuthnRequest → assertion → (optional) Single Logout** flow **on the server**, validates the signed
assertion against the IdP certificate, and mints a short-lived **HS256 token** that is written into
`XOpatUser` so `HttpClient` works transparently.

Use this for deployments backed by an enterprise IdP (Shibboleth, ADFS, SimpleSAMLphp, Azure AD SAML,
Keycloak in SAML mode). For OpenID Connect use [`oidc-client-ts`](../oidc-client-ts/README.md) (public
PKCE, browser) or [`oidc-server-ts`](../oidc-server-ts/README.md) (confidential, server). The canonical
auth model is [`src/AUTH.md`](../../src/AUTH.md).

> **Node-only.** The PHP server has no `register.server` loader and no RPC verifier registry
> (`server/php/inc/auth.php` registers only the proxy HS256 `jwt` verifier), so this module does
> nothing under the PHP backend.

## Why server-side

A SAML assertion is signed XML. Validating that signature requires the IdP certificate and an XML
canonicalisation stack — neither belongs in a browser. So the entire flow lives in
`register.server.ts`; the browser only ever receives the minted token.

## Behavior

- **Broker `"saml"`** is registered into `APPLICATION_CONTEXT.auth`, so any feature can require login
  for a context exactly like with OIDC.
- **Server routes** (`serverApi.registerServerRoute("/auth/saml", …)`):

  | Route | Purpose |
  | --- | --- |
  | `GET /auth/saml/metadata/<ctx>` | SP metadata XML — hand this to the IdP administrator. |
  | `GET /auth/saml/login/<ctx>` | Builds the AuthnRequest and redirects to the IdP. |
  | `POST /auth/saml/acs/<ctx>` | Assertion Consumer Service. Validates, mints, hands off. |
  | `GET /auth/saml/finish/<ctx>` | Binds the result to the xOpat session (see below). |
  | `GET+POST /auth/saml/slo/<ctx>` | Single Logout — SP-initiated, IdP-initiated, and LogoutResponse. |

- **Login UX — popup by default** (`flow`): the client opens login in a popup so the viewer tab (and
  unsaved work) is preserved; if the browser blocks it, it falls back to a full-page redirect. Set
  `"flow": "redirect"` on a context to force the redirect flow.
- **`autoLogin: true` signs in at boot, driven by core** (`XOpatAuth.runAutoLogin`), not by our
  `init()`. Core calls `loginSilent` first — for us that is the server-side token sync, no IdP
  round-trip — and escalates to `login(ctx, cfg, {gesture:false})` only if we are the one context
  allowed to navigate this page load. That login always uses a **redirect**, whatever `flow` says,
  because `window.open` without a user gesture is blocked by the browser. `flow` governs
  user-initiated logins only. Same for a re-login triggered by a 401 refresh.
- **The redirect-loop guard is core's.** This module used to redirect straight from `init()` with no
  record of having tried, so a deployment where the IdP authenticates but the SP-side session write
  fails could bounce forever. Core claims a boot marker before it navigates and hands over to the
  recovery gate on the second attempt instead.
- **Token renewal without an IdP round-trip.** SAML has no `refresh_token`. The server keeps the
  validated claims on the xOpat session and **re-mints** the token when it nears expiry, until
  `sessionTtlSec` elapses — then an interactive login is required again. That re-mint is also this
  module's **silent route** (`loginSilent`), so core's automatic ladder resolves a returning session
  with no IdP round trip at all.
- **A transport failure is reported as `"unknown"`, never `false`.** `getToken` returning
  `{token: null}` means "no session"; the RPC *throwing* means we never reached the server, and the
  two must not look alike — this module declares `navigatesOnLogin`, so a `false` licenses core to
  redirect, and redirecting because xserver was still starting throws the viewer (and the unsaved
  workspace) at the IdP over a two-second blip. The adopt helper also retries once and coalesces
  concurrent callers.

### The ACS → finish hand-off (do not "simplify" this away)

The xOpat session cookie is `SameSite=Lax` (`server/node/index.js`), and **Lax cookies are not sent on
a cross-site POST**. The IdP's ACS POST therefore arrives without a session. So the ACS parks the
minted result under a random, single-use, 60-second `code` and 302s the browser to
`/auth/saml/finish/<ctx>?code=…` — a **top-level GET**, which *does* carry a Lax cookie — and only
there is the token bound to the session.

Widening the cookie to `SameSite=None` would "fix" this too, but that is a deployment-wide CSRF
posture change for one module. Don't.

An **embedded** deployment already runs `SameSite=None` for its own reasons
(`core.server.security`, see [Embedding the viewer in a third-party page](../../server/README.md#embedding-the-viewer-in-a-third-party-page)),
so the paragraph above reads as `Lax`-or-`None` depending on config. The hand-off stays mandatory
regardless: it must work on the strict default, and under `cookielessSessions` the frame has no
cookie on the ACS POST *at all* — only the `code` binds the result to a session.

## Configuration

All configuration is **server-only**, under `core.server.secure.modules["saml-auth"].contexts.<ctx>`.
Key the default/main context as `""` / `"core"` / `"default"` (all resolve to the main identity
`"core"`); any other id is a sub-context. See [`src/AUTH.md`](../../src/AUTH.md#concepts).

### The minimum a context needs

Four things, and a context missing any of them is **not offered to the viewer at all** —
it is skipped by `listContexts` with an error naming the missing key. That is
deliberate: core drives the automatic login for whatever is advertised, so announcing
a context that cannot serve `/auth/saml/login/<ctx>` would navigate the viewer into a
400 page on its first load.

| required | notes |
|---|---|
| `issuer` | the SP entityID; must equal the IdP-side client id |
| `entryPoint` | **or** `idpMetadataUrl`, which supplies it |
| `idpCert` | **or** `idpMetadataUrl`, which supplies it |
| `token.secret` **or** `token.secretEnv` | see the two traps below |

Everything else has a default.

**Two things that will cost you an afternoon:**

- **`token.secretEnv` wins unconditionally over `token.secret`.** Once `secretEnv` is
  present, `.secret` is never consulted — so an *unset* environment variable is a
  failure, not a fallback. It breaks `/login` outright (the relay state is signed with
  it), long before any token is minted.
- **`idpMetadataUrl` goes through the core SSRF guard.** A Keycloak on `localhost` or
  a Docker-internal host is a private address and is blocked by default: the operator
  must allowlist it with `XOPAT_SSRF_ALLOWED_HOSTS` (see
  [`server/ENVIRONMENT.md`](../../server/ENVIRONMENT.md)). If you would rather not open
  the allowlist, drop `idpMetadataUrl` and set `entryPoint` + `idpCert` + `logoutUrl`
  inline instead.

Both failures are logged on the `module.saml-auth` channel, and the failure page
repeats the reason when the server runs in dev mode.

```jsonc
"core": { "server": { "secure": {
  "modules": {
    "saml-auth": {
      "contexts": {
        "core": {
          // ── IdP: either inline, or discovered from metadata ──
          "entryPoint": "https://idp.example.org/sso",     // IdP SSO endpoint
          "idpCert": "MIIC…",                              // string or array of base64 certs
          // "idpMetadataUrl": "https://idp.example.org/metadata",  // fills the three above
          "logoutUrl": "https://idp.example.org/slo",      // enables Single Logout

          // ── This SP ──
          "issuer": "https://viewer.example.org/saml/sp",  // SP entityID
          "audience": "https://viewer.example.org/saml/sp",// defaults to `issuer`
          "privateKey": "<% SAML_SP_KEY %>",               // signs AuthnRequest / LogoutRequest
          "publicCert": "MIIC…",                           // our cert, published in metadata
          "signatureAlgorithm": "sha256",
          "digestAlgorithm": "sha256",
          "identifierFormat": "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent",

          // ── Validation policy (defaults shown; all fail closed) ──
          "wantAssertionsSigned": true,
          "wantAuthnResponseSigned": true,
          "allowIdpInitiated": false,                      // see Security
          "clockSkewSec": 60,
          "requestTtlSec": 600,

          // ── Claims + minted token ──
          "attributeMap": { "sub": "uid", "name": "displayName", "email": "mail", "groups": "memberOf" },
          "extraClaims": [],
          "sessionTtlSec": 28800,
          "token": {
            "secretEnv": "XOPAT_SAML_JWT_SECRET",          // preferred over "secret"
            "issuer": "xopat-saml",
            "audience": "xopat",
            "ttlSec": 3600
          },

          // ── Client behavior (the only fields that reach the browser) ──
          "autoLogin": true,
          "flow": "popup",
          "serviceName": "Institutional SSO"
        }
      }
    }
  },

  // ── Server-side enforcement: this module's own verifier ──
  "rpcVerifiers": {
    "core": {
      "verifiers": { "saml": {} },
      "mode": "all"
    }
  }
} } }
```

The `{}` is complete for a **single-context** deployment: the `saml` verifier reads the signing
secret, issuer and audience from `contexts.<ctx>.token` above, so the minting and verifying halves
share one config block and cannot drift. An unpinned entry means the MAIN context (`core`).

**Running more than one SAML context? Pin every verifier entry** with
`{"contextId": "<ctx>"}`. The verifier resolves its context from operator config only — it does
**not** fall back to the request body. That fallback used to exist and was a privilege-escalation
path: a caller holding a token minted for a low-trust context could present it against a resource
requiring another one simply by naming that context in the request, and verification would run
against the wrong `token.secret` / `issuer` / `audience`. An unpinned entry in a multi-context
deployment now verifies against `core` rather than against whatever the caller asked for.

Only `contextId`, `autoLogin`, `serviceName`, `flow` and `sloEnabled` reach the browser (via the
`listContexts` RPC). The IdP endpoints, certificates, keys and the signing secret stay on the server.

`attributeMap` is optional — when a field is unmapped the module tries the usual names/OIDs
(`displayName`/`cn`/`urn:oid:2.5.4.3`, `mail`/`urn:oid:0.9.2342.19200300.100.1.3`,
`memberOf`/`eduPersonAffiliation`, …). `sub` falls back to the assertion `NameID`.

### Register with the IdP

| Item | Value |
| --- | --- |
| SP entityID | your `issuer` |
| ACS (HTTP-POST) | `<viewer-origin>/auth/saml/acs/<contextId>` |
| SLO | `<viewer-origin>/auth/saml/slo/<contextId>` |
| Metadata | `<viewer-origin>/auth/saml/metadata/<contextId>` |

`viewer-origin` is `core.client.domain` when it is a full URL, else the request host. Each context id
has its own endpoint paths.

### Enabling

```jsonc
"modules": { "saml-auth": { "permaLoad": true } }
```

Features need no change: they use `HttpClient` with the context (the default `core` context for the
main identity), which this module provisions.

## Security

- Everything sensitive lives under `server.secure`, injected with `<% VAR %>`. The module refuses to
  mint a token when no signing secret is configured — it never falls back to a default.
- **Signature checking and the audience restriction are on by default.** `audience` defaults to the SP
  `issuer`; setting `"audience": false` disables the check and logs a warning — don't.
- **`allowIdpInitiated` defaults to `false`.** With it off, every response must carry an
  `InResponseTo` matching a request this server issued (one-time use). With it on, unsolicited
  responses are accepted and the only remaining defenses are the audience restriction and the
  assertion-ID replay cache. Enable it only when the IdP genuinely requires it.
- Assertion IDs are cached and re-use is rejected (replay protection), in addition to node-saml's
  request-id binding.
- `RelayState` is HMAC-signed by us, so the return target cannot be forged through the IdP round-trip;
  it is re-validated as same-origin anyway (no open redirect).
- Errors are logged with a reason only — never the assertion, the profile or the token.

### Known limitation — IdP-initiated logout over HTTP-POST

An IdP-initiated `LogoutRequest` delivered with the **HTTP-POST** binding is cross-site, so (per the
SameSite rule above) it carries no session cookie and the local session cannot be cleared; the module
validates the request and answers correctly, but the browser session is torn down only on its next
token refresh. The **HTTP-Redirect** binding is a top-level GET and works fully. Prefer configuring
HTTP-Redirect for SLO.

## Implementation notes

- `saml-flow.ts` — config resolution, cached `SAML` instances, IdP metadata parsing, signed
  RelayState, replay cache, hand-off store, session state, and the HS256 mint/verify pair
  (`mintToken` / `verifySamlToken` — change one, change the other).
- `register.server.ts` — routes, the `listContexts` / `getToken` / `logout` RPC surface (all
  session-scoped), and the `"saml"` RPC + proxy verifiers. The verifier maps `sub` to the core
  principal `id`, so `ctx.principal` is `user:<sub>` — the same subject the client logs in as.
  Core's generic HS256 `"jwt"` verifier pointed at the same secret still works (legacy), but then the
  operator maintains the secret/issuer/audience in two places.
- `saml-auth.ts` — the client broker glue, built to `index.workspace.js`.
- Dependencies (`@node-saml/node-saml`, `@xmldom/xmldom`, `xpath`) are declared in this module's
  `package.json`; the repo root uses npm workspaces, so `npm install` at the root installs them and
  esbuild bundles them into `.server-dist/register.server.mjs`.
