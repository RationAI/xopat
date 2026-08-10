# basic-auth

Credential source for HTTP Basic authentication.

`HttpClient` has always shipped a `"basic"` auth handler — it turns a
`{username, password}` secret into an `Authorization: Basic …` header
(`src/classes/http-client.ts`). Nothing produced such a secret, so the handler
always returned `{}`. This module fills that gap: it registers a broker with
`APPLICATION_CONTEXT.auth`, prompts the user with the shared `UI.LoginModal`, and
stores the credential in `XOpatUser` under the `basic` secret type.

## Choose the right mechanism first

| Situation | Use |
|---|---|
| One credential for the whole deployment (an API key, a service account) | `server.secure.proxies.<alias>.headers = { "Authorization": "Basic <% ENV_VAR %>" }` — the credential never reaches the browser |
| Each user has their own username/password | this module |
| The upstream speaks OIDC or SAML | `oidc-client-ts` / `oidc-server-ts` / `saml-auth` — short-lived, revocable tokens |

Basic is the weakest of the three: the credential is replayable, cannot be
revoked, cannot expire, and is sent on every single request. Prefer a token-based
broker whenever the upstream offers one.

## Configuration

Contexts come from **static** config (`include.json` merged with the deployment
`ENV.modules["basic-auth"]`), never from session config — a session bundle must
not be able to point an auth context somewhere of its choosing (AGENTS.md §7).

```jsonc
"modules": {
  "basic-auth": {
    "permaLoad": true,
    "contexts": {
      "archive": {
        "serviceName": "Slide archive",   // shown in the prompt
        "autoLogin": false,               // prompt at boot; default false (lazy)
        "allowInsecure": false            // permit plain HTTP; DEV ONLY
      }
    }
  }
}
```

A feature then requires that context the same way it would for OIDC or SAML —
`authMode` / `authContext` static meta plus `this.requireAuthContext()`, or an
`HttpClient` built with `auth: { contextId: "archive", required: true }`. No
feature ever names this module: it declares a *context*, and whichever broker
claims that context provides the credential.

Each context declares `secretTypes: ["basic"]`, so `HttpClient` and
`XOpatAuth.isAuthenticated` / `getToken` follow it automatically instead of
assuming `jwt`.

## Security properties

- **Memory only.** The credential lives in `XOpatUser._secret` and is gone on
  reload. It is never written to `AppCache`, `localStorage` or `sessionStorage`:
  unlike a short-lived bearer token it cannot be revoked or expired, so persisting
  it turns one compromised browser profile into a permanent account takeover.
- **HTTPS required.** `Authorization: Basic` is base64, not encryption. Login is
  refused on a plain-HTTP origin unless the context sets `allowInsecure: true`
  (localhost is always allowed, for development).
- **Same-origin only.** `XOpatRemoteEndpoint._authHeaders` drops auth headers for
  cross-origin absolute URLs. A direct-to-tile-server deployment therefore needs
  the server proxy; the credential is not attached to a third-party origin.
- **No sign-up.** The prompt hides the sign-up tab (`showSignup: false`) — Basic
  verifies existing credentials, it cannot create them.
- **No server-side verifier.** This module provides an *outbound* credential. The
  xOpat server cannot validate an inbound `Authorization: Basic` — the built-in
  proxy/RPC verifiers are `jwt` / `bearer` and both require the `Bearer ` prefix.

## Logout

`broker.logout(contextId)` calls `XOpatUser.logout(contextId)`, which clears both
the identity and every secret bound to that context.
