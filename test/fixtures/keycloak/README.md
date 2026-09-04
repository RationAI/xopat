# Keycloak fixture — SAML and OIDC login, and the role-based rules they share

A throwaway Keycloak with everything the SAML broker, the OIDC broker and the
roles layer need, already imported. It backs four things:

- the **manual demos** `test/env/saml.json` and `test/env/oidc.json` (two users
  with different rights), and
- the **`saml` and `oidc` test projects** (`npm test -- --project=saml`,
  `--project=oidc`), which drive those logins for real and assert what each role
  may do.

**One realm, two clients, on purpose.** The two deployments differ only in
protocol, so the same `pathologist` in the same `/pathologists` group has to come
out as the same xOpat role either way — `core.roles.claims` names a *claim* and a
*context*, never a protocol. Split the realms and the two suites could quietly
drift on what a pathologist is, which is the thing being proved.

Nothing here is a secret and nothing here is production-shaped — it is a
development identity provider on loopback.

## Run it

```bash
docker compose -f test/fixtures/keycloak/docker-compose.yaml up -d
```

| | |
| --- | --- |
| Admin console | <http://localhost:8081/admin> — `admin` / `admin` |
| Realm | `xopat` |
| SAML metadata | <http://localhost:8081/realms/xopat/protocol/saml/descriptor> |
| OIDC discovery | <http://localhost:8081/realms/xopat/.well-known/openid-configuration> |

The two clients:

| Client | Protocol | Used by | Notes |
| --- | --- | --- | --- |
| `xopat-viewer` | SAML 2.0 | `modules/saml-auth` | clientId **is** the SP entityID |
| `xopat-viewer-oidc` | OpenID Connect | `modules/oidc-client-ts` | public client, PKCE `S256`, no secret |

Test users, and what either deployment grants each of them:

| User / password | Keycloak group | xOpat role | May |
| --- | --- | --- | --- |
| `pathologist` / `pathologist` | `/pathologists` | `pathologist` | fill and submit a questionnaire; create/edit annotations. **Not** edit the form. |
| `researcher` / `researcher` | `/researchers` | `researcher` | author the questionnaire (designer, save/load form). Annotations are **read-only**. |

Anyone not logged in holds the deployment default role `guest`, which is denied
both.

Both deployments also run an **auth-protected OpenAI provider** on the same
`core` context, so one login covers the viewer identity, the roles, and the chat.
Before logging in its RPCs are refused server-side (401 `RPC_AUTH_FAILED`) and no
provider is registered; after, the provider appears with `requiresLogin: true`.
The `plugins.chat-openai` block is byte-identical in the two ENV files, which is
the auth indirection stated as a diff: the plugin names a context and knows
nothing about SAML or OIDC.

Set `OPENAI_API_KEY` to talk to the real API. Leave it unset and everything
except the model calls still works — the provider registers keyless and the chat
opens its API-key panel, which is the bring-your-own-key path. **Note:** that
panel is a full-viewport modal, so while it is open the rest of the viewer is
behind it; give it a key or close it before driving the UI.

## Point the viewer at it

Keycloak is on loopback, and the SSRF guard blocks private upstreams and fails
closed — so **both** deployments need an allowlist entry. SAML uses it for the
IdP metadata fetch, OIDC for the JWKS fetch its RPC verifier makes.

SAML additionally needs the secret it mints its session token with. OIDC needs no
secret at all: the IdP signs the token and the verifier checks that signature
against the published JWKS, so there is nothing shared to configure.

```bash
XOPAT_ENV=test/env/saml.json \
XOPAT_SAML_JWT_SECRET="$(openssl rand -base64 48)" \
XOPAT_SSRF_ALLOWED_HOSTS=localhost \
npm run dev

XOPAT_ENV=test/env/oidc.json \
XOPAT_SSRF_ALLOWED_HOSTS=localhost \
npm run dev
```

Windows `cmd`:

```
set "XOPAT_ENV=test/env/saml.json" && set "XOPAT_SAML_JWT_SECRET=dev-only-secret" && set "XOPAT_SSRF_ALLOWED_HOSTS=localhost" && npm run dev

set "XOPAT_ENV=test/env/oidc.json" && set "XOPAT_SSRF_ALLOWED_HOSTS=localhost" && npm run dev
```

Then open <http://localhost:9000>, log in as either user, and check
`XOpatUser.instance().currentRoles()` in the console — it reflects the Keycloak
group, mapped through `core.roles.claims`. Neither deployment logs in at boot
(`autoLogin` is off in both), so you can watch the `guest` → login → role
transition; start it from the app-bar user menu or with
`APPLICATION_CONTEXT.auth.login("core")`.

`test/env/saml.json` and `test/env/oidc.json` are the deployments, and they are
tracked on purpose: `env/` is gitignored, so a config living there could not back
a test anyone else can run. Copy either into `env/` if you want to diverge
locally.

### Anonymous viewer, login-gated chat

Both files above gate the **`core`** context, so one login covers the viewer, its
roles and the chat — and a logged-out visitor cannot open a slide. For the
opposite shape, where the slides are open to everyone and only the chat asks for
a sign-in, use `test/env/oidc-chat.json`:

```bash
XOPAT_ENV=test/env/oidc-chat.json XOPAT_SSRF_ALLOWED_HOSTS=localhost npm run dev
```

It gates a `chat` **sub**-context instead of `core`. A main context with no
`rpcVerifiers` entry stays open (the zero-config deployment), so the viewer boots
anonymously and never redirects; the chat's Login button starts a popup login on
its own context and the viewer identity is untouched.

The Keycloak side needs nothing extra. Unlike SAML — whose ACS/SLO URLs carry the
context id in their path, which is why a second set has to be registered for a
sub-context — an OIDC `redirect_uri` is just the page URL, so `xopat-viewer-oidc`
covers it as-is.

No test project of its own: the `oidc` project already drives this broker and this
JWKS verifier end to end, and this deployment differs only in which context key
the gate hangs on.

## Run the tests against it

```bash
npm test -- --project=saml
npm test -- --project=oidc
```

With the container down both suites **skip with a reason** rather than timing
out. Each pins its server port and runs single-worker, because the realm's
redirect URIs name concrete ports.

## Ports

| Client | Registered origins |
| --- | --- |
| `xopat-viewer` (SAML) | `:9000` manual runs, `:9400` the `saml` project |
| `xopat-viewer-oidc` | `:9000` manual runs, `:9401` the `oidc` project |

9400/9401 sit clear of the harness's own window: every other project takes
`PORT_BASE + workerIndex` = `9300 + N` (`test/harness/fixtures/server.mjs`), so a
pinned 9300 would be exactly the port their first worker binds.

Serving the viewer anywhere else means adding that origin here first. Keycloak
refuses an AssertionConsumerServiceURL it has not been told about, and it refuses
an OIDC `redirect_uri` the same way — and for the OIDC client you must add the
origin to **`webOrigins`** too, or the browser's token exchange fails on CORS
after a login that looked perfect.

## Reset

The realm is imported only when it does not already exist, so **every edit to
`realm-xopat.json` needs this** — a container started before the change keeps the
old realm forever, and the missing client or mapper surfaces as a login failure
rather than as stale state:

```bash
docker compose -f test/fixtures/keycloak/docker-compose.yaml down -v
docker compose -f test/fixtures/keycloak/docker-compose.yaml up -d
```

The `oidc` suite probes for the `xopat-viewer-oidc` client specifically rather
than just for the realm (`requireKeycloakOidc()`), so a container older than that
client skips with this command in the message instead of failing obscurely.

## Editing `realm-xopat.json`

Keycloak parses it with Jackson in fail-on-unknown-field mode, so it **cannot
carry comments** — even a `//` key aborts the import. The notes that would
otherwise live inline are in the `docker-compose.yaml` header.
