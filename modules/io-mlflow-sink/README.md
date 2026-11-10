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

### 2b-bis. Letting a session switch the sink off

Whether MLflow receives anything at all is a routing decision, so it is the
pipeline's switch, not this module's — the sink needs no configuration of its own
to participate:

```jsonc
"io": {
    "sinks": { "mlflow": { "enabled": true, "sessionControllable": true } }
}
```

With `sessionControllable` set, a session may run without pushing:

```jsonc
"params": { "ioSinks": { "mlflow": false } }
```

and code can do the same at runtime with
`IO_PIPELINE.setSinkEnabled("mlflow", false)`. **Omit `sessionControllable` and
the deployment's `enabled` is a hard pin** — the session value is not read and the
runtime call is refused, so an embedding app or an imported peer session cannot
redirect where scores go.

Switched off, the sink stays registered but resolves as if no binding named it:
bundle capabilities fall through to the built-in local sinks (`session-memory` /
`post-data`), so export still works, and `crud:score` simply has nowhere to go
rather than piling up behind a destination that will not answer. See
[`src/IO_PIPELINE.md`](../../src/IO_PIPELINE.md) → *Per-sink on/off*.

Two things this does **not** change: the trusted-only keys (`proxy`, `baseURL`,
`auth`, `experimentAllow`, `artifactPathPrefix`, `sessionTarget`) remain
ENV/include.json-only either way — a session can refuse the destination, and
picks an experiment/run only where the operator opted in (§2b-ter), never an
endpoint; and the module itself still loads or not by
`ENV.modules.io-mlflow-sink.enabled`, since sessions have no `modules` block at
all. The switch is about the sink, not about loading the code.

### 2b-ter. Letting a session choose the experiment and run

By default the experiment and run come from `experimentTemplate` /
`runTemplate`. Set `sessionTarget` (trusted config) to let the session name them:

| `sessionTarget` | session `params.mlflowTarget` present | absent |
|-----------------|---------------------------------------|--------|
| unset / `null`  | ignored — templates decide            | templates decide |
| `"allowed"`     | its experiment/run are used           | templates decide |
| `"required"`    | its experiment/run are used           | sink declines every dispatch (`W_MLFLOW_NO_TARGET`) |

**`experimentAllow` is mandatory for this.** The target comes from the session —
the embedding app, URL parameters or an imported peer session — so it is
untrusted, and without an allowlist it could route a user's data into *any*
experiment on the tracking server. With `sessionTarget` set and no
`experimentAllow`, the session target is ignored (a console warning says so once),
and under `"required"` every dispatch is refused with `W_MLFLOW_TARGET_UNBOUNDED`.
Set `runAllow` too: a named run is matched by `mlflow.runName`, so without it a
session may append to (and, on delete, untag) any existing run of an allowed
experiment, including runs created outside xOpat.

The session names its destination in `params`:

```jsonc
"params": {
    "mlflowTarget": { "experiment": "xopat-cohort-A", "run": "review-2026-11" }
}
```

- `experiment` is required; it is created on first write if missing.
- `run` is optional. It is matched against MLflow's own `mlflow.runName` tag, so
  an existing run of that name is reused — including one created outside xOpat —
  and created if missing. Without `run`, the template's run layout applies inside
  the chosen experiment.
- Names may use letters, digits, space and `. _ - / :`, at most 250 characters.
  Anything else (quotes, backslashes, backticks, …) invalidates the target rather
  than being coerced — and an invalid target refuses every dispatch with
  `W_MLFLOW_NO_TARGET` under `"allowed"` too, never falling back to the templates.
  `setTarget()` / `clearTarget()` replace it.
- Names may carry the shared placeholders (`{backgroundId}`, `{viewerId}`,
  `{ownerId}`, `{capabilityGroup}`, `{key}`, … — the set `IO_PIPELINE.formatPath`
  resolves), substituted per dispatch with the same sanitization every sink uses.
  The **resolved** name is what `experimentAllow` / `runAllow` judge. A name that
  resolves to nothing refuses with `W_MLFLOW_NO_TARGET`.

| Layout you want | `params.mlflowTarget` |
|-----------------|-----------------------|
| One experiment, template decides runs | `{ "experiment": "xopat-cohort-A" }` |
| One run per slide | `{ "experiment": "xopat-cohort-A", "run": "review-{backgroundId}" }` |
| One run per plugin/module | `{ "experiment": "xopat-cohort-A", "run": "{ownerId}" }` |
| One experiment per slide | `{ "experiment": "xopat-{backgroundId}", "run": "review" }` |
| Everything in one run | `{ "experiment": "xopat-cohort-A", "run": "review-2026-11" }` |

**Shared runs.** Whenever the target names a `run`, records the template would
have spread over several runs may share one, so the built-in templates switch to
keys that keep them apart (mappers receive `options.sharedRun === true`):

| Template | Default layout | With a session `run` |
|----------|----------------|----------------------|
| `slide-scoring`   | metric `<scoreKey>`, tag `<scoreKey>.label` | metric `<slide>.<scoreKey>`, tag `<slide>.<scoreKey>.label` |
| `run-per-viewer`  | metric `<scoreKey>.<slide>` | metric `<viewerId>.<scoreKey>.<slide>` |
| `run-per-session` | param `<slide>.<scoreKey>[.<ts>]` | param `<ownerId>.<slide>.<scoreKey>[.<ts>]` |
| `bundle-artifact` | `xopat/<slot>.<ext>`, tag `xopat.bundle.<slot>` | `xopat/<viewerId>/<slot>.<ext>`, tag `xopat.bundle.<viewerId>.<slot>` |

A custom mapper registered via `registerMapper` should honour the flag the same way.
- The template still shapes the *content* (metrics, tags, artifacts); the target
  only replaces *where* it lands, before the `experimentAllow` / `runAllow`
  checks — a session cannot leave the allowlists.
- At runtime: `singletonModule("io-mlflow-sink").setTarget({experiment, run})` /
  `clearTarget()`, or the `mlflowSink.setTarget(...)` scripting call. The script
  call validates first, then asks the user with the exact names; the approval is
  per destination and never remembered, so approving one experiment does not
  approve a later switch. Not persisted.

**Opt-in per session.** Combine with §2b-bis to keep MLflow off unless a session
asks for it — the sink is then never used by accident, and never with a
template-derived experiment nobody chose:

```jsonc
// ENV.modules["io-mlflow-sink"].mlflow
{ "sessionTarget": "required", "template": "bundle-artifact",
  "experimentAllow": ["xopat-*"], "runAllow": ["review-*"], ... }
// ENV.client.io
"sinks": { "mlflow": { "enabled": false, "sessionControllable": true } },
"bindings": { "annotations": {
    "bundle-export": [ { "sink": "mlflow" }, "session-memory", "post-data" ]
} }
// session
"params": { "ioSinks": { "mlflow": true },
            "mlflowTarget": { "experiment": "xopat-cohort-A", "run": "review-{backgroundId}" } }
```

Listing `session-memory` and `post-data` after `mlflow` keeps the annotations'
normal in-session state and HTML session export working whether or not MLflow is
switched on (they are what an unbound per-viewer bundle falls back to).
`bundle-import` is unbound here, so annotations keep loading from the session.
Bind it to `mlflow` to load them back from MLflow instead: with `bundle-artifact`,
`readBundle` returns the stored JSON file (see §4).

### 2c. Option layering

Composed on every dispatch; latest wins. `null` values and `_`-prefixed keys are
filtered out.

1. **Hardcoded JS defaults** in `mlflow-sink.ts` (safety net — always present).
2. **Module include.json** `mlflow` block (deployment-tunable defaults).
3. **`ENV.client.io.sinkOverrides.mlflow`** (admin per-deployment values).
4. **The per-binding `config`** for the dispatching (owner, capability), from
   `ENV.client.io.bindings` — this is how ONE mlflow sink gives each owner its
   own experiment/run layout without a second sink id:

```jsonc
"bindings": {
    "slide-scoring": {
        "crud:score": [
            { "sink": "mlflow", "config": { "template": "slide-scoring",
                                            "experimentTemplate": "scores-{ownerId}" } }
        ]
    },
    "annotations": {
        "bundle-export": [
            { "sink": "mlflow", "config": { "template": "bundle-artifact",
                                            "experimentTemplate": "annotations-{backgroundId}" } }
        ]
    }
}
```

A session template choice made via scripting applies last, and **only** to
`template` — a per-binding `template` must not silently win over the one the
user just picked.

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
| `runAllow`           | no²      | admin override | unset (unrestricted)   |
| `artifactPathPrefix` | no²      | admin override | unset (unrestricted)   |
| `artifacts`          | no       | admin override | unset (no artifacts)   |
| `sessionTarget`      | no       | admin override | unset (session target ignored) |

¹ At least one of `proxy` / `baseURL` must resolve, or the sink declines. If it
is the only sink bound, that decline now surfaces as a "nothing stored" refusal
rather than a silent no-op.
² Strongly recommended whenever mappers can be registered at runtime. The
experiment name is not the only mapper-chosen destination: `runAllow` bounds run
names and `artifactPathPrefix` bounds artifact paths (which land in an upload
URL). Leaving `experimentAllow` unset logs a one-time warning — allow-all may be
deliberate, but it should never be invisible.

**Write `artifactPathPrefix` without a trailing slash.** The comparison is
against `sanitizeArtifactPath(prefix)`, which rewrites the empty segment a
trailing slash produces into `_`: `"xopat/"` becomes `"xopat/_"` and then denies
`xopat/anything.json` — every path the `bundle-artifact` template emits. Use
`"xopat"`. A denial is reported as `W_MLFLOW_ARTIFACT_DENIED`, so this fails
loudly rather than silently, but it fails on a value that looks correct.

Placeholders for `experimentTemplate` / `runTemplate` (resolved by
`IO_PIPELINE.formatPath`, shared with every other sink): `{ownerId}`
`{ownerUid}` `{xoType}` `{direction}` `{capabilityId}` `{capabilityGroup}`
`{viewerId}` `{backgroundId}` `{key}` `{resourceName}` `{itemId}`. `{viewerId}`
resolves to `_global` for global-scope bundles; `{backgroundId}` to `_any` when
the dispatch is not slide-scoped. Substituted values are reduced to
`[A-Za-z0-9._-]` — they come from the session config and, for `itemId`, from the
CRUD caller.

> Prefer `{capabilityGroup}` over `{capabilityId}` for anything that must
> address the same run on both write and read: exports carry `bundle-export`
> and restores carry `bundle-import`.

## 3. Templates

A template maps one record (CRUD) or one payload (bundle) into MLflow terms.
Pick with `template`; inspect at runtime with `mlflowSink.listTemplates()`.

| Template          | Run layout                       | Record lands as                          | Use when |
|-------------------|----------------------------------|------------------------------------------|----------|
| `slide-scoring`   | one run per scored slide         | metric `<scoreKey>` + tag `<scoreKey>.label` | Default. One current score per slide. |
| `run-per-viewer`  | one run per viewer               | stepped metric `<scoreKey>.<slide>`      | The scoring *history* matters. |
| `run-per-session` | one run per owner                | write-once param                         | Audit log; every scoring event kept. |
| `bundle-artifact` | one run per viewer               | whole bundle as a JSON artifact, or the raw bytes of an `IOBinaryPayload` | Round-tripping opaque bundles, incl. recordings/images. Needs `artifacts`. |

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
  error, so hydration on a fresh deployment is silent. For an artifact template
  (`bundle-artifact`) `readBundle` downloads the stored file and returns it —
  parsed when it is JSON — and a run without that file is likewise "no data
  yet". Other templates return the run's data (tags/metrics/params). Binary
  bundles (`IOBinaryPayload`) are not read back: their path depends on the
  payload's extension, which an import does not know.
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
| `W_MLFLOW_NO_TARGET`        | `sessionTarget` is `"required"` and the session set no `params.mlflowTarget` (or `clearTarget()` was called), or — under `"allowed"` or `"required"` — the target was invalid or a name resolved to nothing. Nothing was written. |
| `W_MLFLOW_TARGET_UNBOUNDED` | `sessionTarget` is `"required"` but `experimentAllow` is unset — session targets are never honoured without an allowlist. Nothing was written. |
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
