# io-github-sink

A GitHub-backed bundle sink for the xOpat IO pipeline. Hydrates from
and writes back to a configured repository path. Bundle-only — no per-entity
CRUD.

## When to use

- You want annotation / preset / other bundle state to persist on a real,
  long-lived backend without standing up a custom server.
- You want each session export to land as a commit (audit trail + history).
- You're OK with a single-file-per-bundle layout (≤ 1 MB per file).

## Architecture

```
  Browser                       xOpat node server                 GitHub
  ───────                       ─────────────────                 ──────
  HttpClient ─────►  /proxy/github/repos/<owner>/<repo>/contents/...
   (proxy:                       │
    "github")                    │  responseProxy:
                                 │   • verifies viewer JWT (verifiers chain)
                                 │   • injects Authorization: Bearer <PAT>
                                 │   • forwards to upstream baseUrl
                                 ▼
                              api.github.com (or GHE host)
```

The **GitHub PAT never reaches the browser**. It lives in
`server.secure.proxies.<alias>.headers.Authorization`, expanded server-side
from an environment variable via the `<% VAR %>` template syntax. The
client only knows the proxy alias and the target repo. See
[`src/HTTP_CLIENT.md`](../../src/HTTP_CLIENT.md) §5–9 for the proxy
framework's full contract.

## 1. Server setup

### 1a. Declare the proxy alias

In your deployment's `config.json` (or wherever `server.secure.proxies`
lives for that install), add:

```jsonc
"server": {
  "secure": {
    "proxies": {
      "github": {
        "baseUrl": "https://api.github.com/",
        "headers": {
          "Authorization": "Bearer <% GITHUB_TOKEN %>"
        },
        "auth": {
          "enabled": true,
          "verifiers": ["jwt"],
          "mode": "all",
          "jwt": {
            "forward": false,
            "userClaimHeader": "x-user-sub"
          }
        }
      }
    }
  }
}
```

- `baseUrl`: GitHub.com is `https://api.github.com/`. For **GHE**, use
  `https://<ghe-host>/api/v3/`.
- `<% GITHUB_TOKEN %>` is expanded once at core init from
  `process.env.GITHUB_TOKEN`. The literal token never lands in any
  client-shipped artifact.
- `forward: false` strips the viewer's JWT before the upstream call so
  GitHub only sees the PAT, not the viewer's identity token.
- If you don't want to require viewer auth (single-user / kiosk
  deployments), drop the `auth` block entirely.

### 1b. Provide the PAT to the server

Set `GITHUB_TOKEN` in the node process environment:

```bash
export GITHUB_TOKEN=github_pat_...
```

Use a **fine-grained personal access token** scoped to the single target
repository, with `Contents: Read and write` permission. See
[GitHub's docs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens).

### 1c. (Optional) Use a different proxy alias

If `github` collides with another alias, pick a different name (e.g.
`gh-state`) under `server.secure.proxies`, then mirror it on the client
via `ENV.client.io.sinkOverrides.github.proxy = "gh-state"`.

## 2. Client setup

### 2a. Module defaults — `modules/io-github-sink/include.json`

Verbose; every tunable field is listed. `null` placeholders mean "the
admin must override or the hardcoded default applies".

```jsonc
{
    "github": {
        "_help":                  "Per-deployment overrides live in ENV.client.io.sinkOverrides.github. The token does NOT belong here — declare a server proxy alias under server.secure.proxies.<proxy> with Authorization: Bearer <% GITHUB_TOKEN %>.",
        "proxy":                  "github",
        "repo":                   null,
        "branch":                 "main",
        "pathTemplate":           "xopat/{ownerId}/{viewerId}.json",
        "commitMessageTemplate":  "xopat: sync {ownerId} {viewerId}",
        "committer":              null,
        "author":                 null,
        "auth":                   null
    }
}
```

`null` values and `_`-prefixed keys are stripped before merge — they
don't shadow upstream layers.

### 2b. Admin overrides + bindings — `ENV.client.io`

```jsonc
{
    "sinkOverrides": {
        "github": {
            "repo":      "your-org/xopat-state",
            "committer": { "name": "xOpat Bot", "email": "bot@example.org" },
            "auth": {
                "contextId": "core",
                "types": ["jwt"],
                "required": true
            }
        }
    },
    "bindings": {
        "annotations": {
            "bundle-export": ["github"],
            "bundle-import": ["github"]
        }
    }
}
```

The `auth` block is forwarded verbatim to `HttpClient` — see
[`src/HTTP_CLIENT.md`](../../src/HTTP_CLIENT.md) §4 for available types
and contexts. Drop it if your proxy has `auth.enabled: false`.

### 2c. Option layering

The module composes its sink options on every dispatch. Latest layer wins;
`null` values and `_`-prefixed keys are filtered out:

1. **Hardcoded JS defaults** in `github-sink.ts` (safety net — always present).
2. **Module include.json** `github` block (deployment-tunable defaults).
3. **`ENV.client.io.sinkOverrides.github`** (admin per-deployment values).

| Key                       | Required | Layer                | Default                              |
|---------------------------|----------|----------------------|--------------------------------------|
| `proxy`                   | no       | hardcoded            | `"github"`                           |
| `repo`                    | yes      | admin override       | —                                    |
| `branch`                  | no       | hardcoded            | `"main"`                             |
| `pathTemplate`            | no       | hardcoded            | `"xopat/{ownerId}/{viewerId}.json"`  |
| `commitMessageTemplate`   | no       | hardcoded            | `"xopat: sync {ownerId} {viewerId}"` |
| `committer`               | no       | admin override       | unset                                |
| `author`                  | no       | admin override       | unset                                |
| `auth`                    | no       | admin override       | unset (no headers added by client)   |

Path / commit placeholders: `{ownerId}` `{ownerUid}` `{viewerId}`
`{capabilityId}` `{xoType}`. `{viewerId}` resolves to `_global` for
global-scope bundles.

> **No `token` field.** Older versions of this module accepted a `token`
> in `sinkOverrides`. That field is gone — see the migration note below.

## 3. Behavior

- `readBundle`: GET `/repos/{repo}/contents/{path}?ref={branch}`. 404 →
  clean "no data yet". Caches the file SHA so subsequent writes are
  conditional.
- `writeBundle`: PUT `/repos/{repo}/contents/{path}` with base64-encoded
  payload. Sends `sha` if known. On `409` / `422` (sha conflict) re-fetches
  and retries once before refusing with `W_GITHUB_CONFLICT`.
- `accepts(ctx)`: returns `false` when `repo` is missing — the sink opts
  out cleanly without surfacing a toast.

## 4. Troubleshooting

| Code                       | Meaning                                                          |
|----------------------------|------------------------------------------------------------------|
| `W_GITHUB_AUTH`            | 401 / 403 — server-side PAT rejected, **or** the proxy's auth verifier chain rejected the viewer's JWT. Check the PAT's scopes/expiry and the proxy's `auth.verifiers` config. |
| `W_GITHUB_NOT_FOUND`       | 404 — repo / branch / path does not exist (writes only).         |
| `W_GITHUB_CONFLICT`        | 409 / 422 — SHA mismatch after retry.                            |
| `W_GITHUB_TOO_LARGE`       | Bundle exceeds the 1 MB Contents-API cap.                        |
| `W_GITHUB_ENCODING`        | GitHub returned a non-base64 encoding (unexpected).              |
| `W_GITHUB_HTTP_<status>`   | Other non-2xx response (including 502/504 from a misconfigured proxy alias).  |

All refusals fan out to the standard `io:refused` event + Dialogs toast.

### Common misconfigurations

- **Browser hits `api.github.com` directly** — `proxy` is empty/unset on
  the client. Re-check the merge order; the hardcoded default of
  `"github"` should keep this from happening unless an override sets
  `proxy: ""` explicitly.
- **`Bearer <% GITHUB_TOKEN %>` shows up in upstream requests verbatim**
  — the env var was unset at core init, so template expansion left the
  literal placeholder. Set `GITHUB_TOKEN` and restart the server.
- **All requests 401 even though the PAT is valid** — viewer is not
  logged in / has no JWT in the configured `contextId`. Either log in,
  flip `auth.required` to `false`, or remove server-side `auth.enabled`.

## 5. Migration note (from pre-proxy versions)

Pre-`0.2` deployments configured the PAT under
`ENV.client.io.sinkOverrides.github.token`. **That field is gone.** To
migrate:

1. Remove `token` from `ENV.client.io.sinkOverrides.github`.
2. Remove `apiBase` from your overrides — GHE host is now configured
   server-side via the proxy's `baseUrl`.
3. Add the `server.secure.proxies.github` block (§1a) to the deployment
   config and set `GITHUB_TOKEN` in the server environment (§1b).
4. (Optional) Add an `auth` block to `sinkOverrides.github` if the
   deployment proxy enforces viewer JWT auth.

## 6. Non-goals

- **Per-entity CRUD** (`crud:annotation`, `crud:preset`). Use a database
  sink for that — GitHub's per-file API isn't designed for high-volume
  per-row dispatch.
- **Multiple repo targets in one app**. One sink id `github` per app.
- **Auto-flush on edit**. The module is a sink, not a save trigger.
  Existing flush triggers (user save, session export) drive it.
- **Conflict merging**. Last write wins after one retry; no three-way merge.
- **Files larger than 1 MB**. Use the Git Data API (blobs/trees) — out of
  scope for v1.
