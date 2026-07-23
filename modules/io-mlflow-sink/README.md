# io-mlflow-sink

An MLflow-backed sink for the xOpat IO pipeline. Any owner's `bundle-*` or
`crud:*` capability can be routed here by an admin binding; the sink turns each
dispatch into MLflow experiments, runs, metrics, params, tags and artifacts.

## When to use

- You want scores, labels or other per-element state to land in MLflow, where
  it can be searched, compared and joined with model runs.
- You want the *record layout* to be a deployment decision, not a code change.
- You already run MLflow and want xOpat to be one more producer against it.

If you instead want to talk to MLflow manually — a migration script, the model
registry, a custom experiment layout — use the [`mlflow`](../mlflow/README.md)
module's client directly. This module is built on it.

## Architecture

```
  Browser                        xOpat node server                MLflow
  ───────                        ─────────────────                ──────
  IO_PIPELINE
     │  binding: ENV.client.io.bindings[owner][cap] = ["mlflow"]
     ▼
  mlflow sink ── mapper(ctx, item) ─► {experiment, run, metrics, tags}
     │
     ▼
  MlFlowClient ──► /proxy/mlflow/api/2.0/mlflow/...
   (proxy:                        │
    "mlflow")                     │  responseProxy:
                                  │   • verifies viewer JWT (verifiers chain)
                                  │   • injects Authorization: Bearer <TOKEN>
                                  │   • forwards to upstream baseUrl
                                  ▼
                              mlflow.yourhost.com
```

Two halves, deliberately separated:

- **Transport** — `proxy`, `baseURL`, `auth`, `experimentAllow`. Deployment
  config, read from `include.json` / `ENV` only. Nothing at runtime can change
  where data goes.
- **Structure** — which experiment, run, metric keys. Chosen by a named
  template or a registered mapper, resolvable per dispatch, and reachable from
  the `mlflowSink` scripting namespace.

The **MLflow credential never reaches the browser.** It lives in
`server.secure.proxies.<alias>.headers.Authorization`, expanded server-side from
an environment variable via the `<% VAR %>` template syntax. See
[`src/HTTP_CLIENT.md`](../../src/HTTP_CLIENT.md) §5–9.

## 1. Server setup

### 1a. Declare the proxy alias

In your deployment's `config.json`:

```jsonc
"server": {
  "secure": {
    "proxies": {
      "mlflow": {
        "baseUrl": "https://mlflow.yourhost.com/",
        "headers": {
          "Authorization": "Bearer <% MLFLOW_TOKEN %>"
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

- `baseUrl` is the MLflow **host root** — the `/api/2.0/mlflow` part comes from
  the client's `baseURL` and is joined by the proxy.
- `<% MLFLOW_TOKEN %>` is expanded once at core init from
  `process.env.MLFLOW_TOKEN`. The literal token never lands in any
  client-shipped artifact.
- `forward: false` strips the viewer's JWT before the upstream call, so MLflow
  sees only the deployment credential.
- For an MLflow with no auth (local dev), drop `headers` and `auth`.

### 1b. Provide the token

```bash
export MLFLOW_TOKEN=...
```

Proxy config is **core server** config — restart the node server after changing
it. (Module code itself is rebuilt by the dev watcher; this is the one part
that is not.)

## 2. Client setup

### 2a. Module defaults — `modules/io-mlflow-sink/include.json`

Verbose; every tunable field is listed. `null` placeholders mean "the admin must
override, or the hardcoded default applies".

```jsonc
{
    "mlflow": {
        "proxy":              "mlflow",
        "baseURL":            "/api/2.0/mlflow",
        "auth":               null,
        "template":           "slide-scoring",
        "experimentTemplate": "xopat-{ownerId}",
        "runTemplate":        "xopat-{viewerId}",
        "identifierTag":      "data_id",
        "experimentAllow":    null,
        "artifacts":          null
    }
}
```

`null` values and `_`-prefixed keys are stripped before merge — they don't
shadow upstream layers.

### 2b. Admin overrides + bindings — `ENV.client.io`

```jsonc
{
    "sinkOverrides": {
        "mlflow": {
            "experimentTemplate": "pathology-scores",
            "experimentAllow":    ["pathology-*"],
            "template":           "slide-scoring",
            "auth": {
                "contextId": "core",
                "types": ["jwt"],
                "required": true
            }
        }
    },
    "bindings": {
        "slide-scoring": {
            "crud:score":    ["mlflow"],
            "bundle-export": ["mlflow"],
            "bundle-import": ["mlflow"]
        }
    }
}
```

The `auth` block is forwarded verbatim to `HttpClient` and refers to the
*viewer's* token for the proxy's verifier chain — not to any MLflow secret.
Drop it if the proxy has `auth.enabled: false`.

### 2c. Option layering

Composed on every dispatch; latest wins. `null` values and `_`-prefixed keys are
filtered out.

1. **Hardcoded JS defaults** in `mlflow-sink.ts` (safety net — always present).
2. **Module include.json** `mlflow` block (deployment-tunable defaults).
3. **`ENV.client.io.sinkOverrides.mlflow`** (admin per-deployment values).

A session template choice made via scripting applies last, and **only** to
`template`.

| Key                  | Required | Layer          | Default                |
|----------------------|----------|----------------|------------------------|
| `proxy`              | no¹      | hardcoded      | `"mlflow"`             |
| `baseURL`            | no¹      | hardcoded      | `"/api/2.0/mlflow"`    |
| `auth`               | no       | admin override | unset                  |
| `template`           | no       | hardcoded      | `"slide-scoring"`      |
| `experimentTemplate` | no       | hardcoded      | `"xopat-{ownerId}"`    |
| `runTemplate`        | no       | hardcoded      | `"xopat-{viewerId}"`   |
| `identifierTag`      | no       | hardcoded      | `"data_id"`            |
| `experimentAllow`    | no²      | admin override | unset (unrestricted)   |
| `artifacts`          | no       | admin override | unset (no artifacts)   |

¹ At least one of `proxy` / `baseURL` must resolve, or `accepts()` returns false
and the sink opts out silently.
² Strongly recommended whenever mappers can be registered at runtime.

Placeholders for `experimentTemplate` / `runTemplate`: `{ownerId}` `{ownerUid}`
`{viewerId}` `{backgroundId}` `{capabilityId}` `{xoType}` `{resourceName}`
`{itemId}`. `{viewerId}` resolves to `_global` for global-scope bundles;
`{backgroundId}` to `_any` when the dispatch is not slide-scoped.

## 3. Templates

A template maps one record (CRUD) or one payload (bundle) into MLflow terms.
Pick with `template`; inspect at runtime with `mlflowSink.listTemplates()`.

| Template          | Run layout                       | Record lands as                          | Use when |
|-------------------|----------------------------------|------------------------------------------|----------|
| `slide-scoring`   | one run per scored slide         | metric `<scoreKey>` + tag `<scoreKey>.label` | Default. One current score per slide. |
| `run-per-viewer`  | one run per viewer               | stepped metric `<scoreKey>.<slide>`      | The scoring *history* matters. |
| `run-per-session` | one run per owner                | write-once param                         | Audit log; every scoring event kept. |
| `bundle-artifact` | one run per viewer               | whole bundle as a JSON artifact          | Round-tripping opaque bundles. Needs `artifacts`. |

A record must carry a numeric `value` for the three scoring templates; anything
else is **declined cleanly** (skipped, not refused), so a sink shared by several
owners ignores records it does not understand.

### Custom structure

When no template fits, register a mapper. The `mlflowSink` scripting namespace
exposes this (and asks the user for permission first):

```js
await mlflowSink.registerMapper("by-author", (ctx, item, o) => {
    if (typeof item.value !== "number") return null;    // decline
    return {
        experiment: "pathology-scores",                 // still allowlist-checked
        run: {
            name: `reviewer-${item.author}`,
            identifierTag: { key: "reviewer", value: String(item.author) },
            extraTags: [{ key: "source", value: "xopat" }],
        },
        metrics: [{ key: item.slideId, value: item.value }],
    };
});
```

The same is available programmatically for a deployment plugin:

```js
singletonModule("io-mlflow-sink").registerMapper("by-author", fn);
```

A mapper shapes structure only. It cannot read or set `proxy`, `baseURL`, `auth`
or `experimentAllow`, and an experiment outside `experimentAllow` is refused at
dispatch with `W_MLFLOW_EXPERIMENT_DENIED`. Mappers are ordinary functions —
never built from strings — so no `eval`/`Function` is involved.

## 4. Behavior

- `create` / `update` / `writeBundle`: resolve mapper → `experiments.ensure` →
  `runs.getOrCreateRunByTag` → **one** `runs.logBatch` with all metrics, params
  and tags → artifact uploads if any. Experiment and run ids are cached and the
  cache is dropped on any refusal.
- `readBundle` / `read`: resolve the experiment **without creating it** — a
  missing experiment or run is a clean "no data yet" (`{ok: true}`), never an
  error, so hydration on a fresh deployment is silent.
- `query`: streams `runs.search` results, following MLflow page tokens and
  honoring `ctx.meta.signal`. Params: `{ filter, orderBy, maxResults }`.
- `delete`: removes the mapped tags and writes an `xopat.deleted` tombstone tag.
  See non-goals.
- `accepts(ctx)`: `false` when neither `proxy` nor `baseURL` resolves — the sink
  opts out cleanly without surfacing a toast.

## 5. Troubleshooting

| Code                        | Meaning |
|-----------------------------|---------|
| `W_MLFLOW_AUTH`             | 401 / 403 — the server-side token was rejected, **or** the proxy's verifier chain rejected the viewer's JWT. Check the token's validity and the proxy's `auth.verifiers`. |
| `W_MLFLOW_NOT_FOUND`        | 404 — experiment / run / endpoint missing. Check `baseURL` and the proxy's upstream `baseUrl`. |
| `W_MLFLOW_EXPERIMENT_DENIED`| A mapper targeted an experiment outside `experimentAllow`. Nothing was written. |
| `W_MLFLOW_MAPPER_INVALID`   | The template name does not exist, the mapper threw, or it returned a mapping without an experiment / run identifier tag. |
| `W_MLFLOW_NO_ARTIFACTS`     | The mapper emitted artifacts but no `artifacts` block is configured. |
| `W_MLFLOW_HTTP_<status>`    | Other non-2xx (including 502/504 from a misconfigured proxy alias). |

All refusals fan out to the standard `io:refused` event + toast.

### Common misconfigurations

- **Browser hits the MLflow host directly** — `proxy` is unset and `baseURL` is
  absolute. Only acceptable for a local, unauthenticated MLflow.
- **`Bearer <% MLFLOW_TOKEN %>` shows up upstream verbatim** — the env var was
  unset at core init, so expansion left the placeholder. Set it and restart.
- **404 on every call** — the proxy `baseUrl` already includes `/api/2.0/mlflow`
  and so does the client `baseURL`. Keep the API path on the client side only.
- **Scores silently do not appear** — the record carries no numeric `value`, so
  the template declined it. Check the owner's record shape.

## 6. Non-goals

- **Deleting history.** MLflow metrics and params are append-only. `delete`
  removes tags and writes a tombstone; it cannot retract a logged metric. If
  deletions must be authoritative, use a database sink.
- **The model registry.** Out of scope; use the `mlflow` module's client.
- **Conflict merging.** Last write wins; no three-way merge.
- **Being a save trigger.** This is a sink, not a flush policy — existing
  triggers (user save, session export) drive it.
