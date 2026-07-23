# mlflow — MLflow REST client

A lightweight, modular MLflow REST client. It is a **plain library**: it performs
no IO of its own and registers nothing with the IO pipeline.

- **Robust basics**: create/reuse experiments, create/search/manage runs
- **Logging**: metrics, params, tags, batches
- **Run lifecycle**: end runs with status
- **Artifacts (pluggable)**: optional adapters for `mlflow-artifacts` or Databricks
- **Resilience**: retries & timeouts come from the core `HttpClient`

## When to use this module directly

Use it when you want **manual** MLflow interaction — a custom experiment layout,
model-registry poking, an ad-hoc migration script.

If you instead want xOpat data (annotations, scores, bundles) to *land* in
MLflow, do **not** build on this module directly. Use
[`io-mlflow-sink`](../io-mlflow-sink/README.md), which is admin-routable via
`ENV.client.io.bindings` and is itself built on this client's API.

## Credentials

**No token, username, or password is accepted here.** MLflow credentials live
server-side only, in a proxy alias:

```jsonc
"server": {
  "secure": {
    "proxies": {
      "mlflow": {
        "baseUrl": "https://mlflow.yourhost.com/",
        "headers": { "Authorization": "Bearer <% MLFLOW_TOKEN %>" },
        "auth": {
          "enabled": true,
          "verifiers": ["jwt"],
          "mode": "all",
          "jwt": { "forward": false }
        }
      }
    }
  }
}
```

`<% MLFLOW_TOKEN %>` is expanded once at core init from the server process
environment; the literal token never reaches any client-shipped artifact.
`forward: false` strips the viewer's JWT before the upstream call, so MLflow
sees only the deployment credential.

The client's `auth` option is unrelated to that credential — it is the
*viewer's* token, presented to the proxy's verifier chain. See
[`src/HTTP_CLIENT.md`](../../src/HTTP_CLIENT.md) §4–9.

## Quick start

> Vanilla JS reaches the classes through the `window.MlFlow` namespace.

```js
const { MlFlowClient } = MlFlow;

const ml = new MlFlowClient({
  proxy: "mlflow",                 // server proxy alias — injects the credential
  baseURL: "/api/2.0/mlflow",      // joined with the proxy's upstream baseUrl
  auth: { contextId: "core", types: ["jwt"], required: true },
  // artifacts are optional
  // artifacts: { type: "mlflow-artifacts", baseURL: "/api/2.0/mlflow-artifacts" }
});

const expId = await ml.experiments.ensure("demo-exp");

// Reuse or create a run by tag
const runId = await ml.runs.getOrCreateRunByTag({
  experiment_id: expId,
  identifierTag: { key: "data_id", value: "base" },
  run_name: "base-run",
  extra_tags: [{ key: "source", value: "xopat" }]
});

await ml.runs.logParams(runId, { model: "resnet50", lr: 0.001 });
await ml.runs.logMetric(runId, "accuracy", 0.987);
await ml.runs.logMetrics(runId, { loss: 0.12, f1: 0.91 });

await ml.endRun(runId, "FINISHED");
```

For an MLflow server with no auth at all, drop `proxy` and `auth` and pass an
absolute `baseURL`. That path is only appropriate for local development —
`APPLICATION_CONTEXT.secureMode` deployments should always proxy.

## Artifacts

Artifact APIs vary across deployments, so this client uses **adapters**:

```js
const ml = new MlFlowClient({
  proxy: "mlflow",
  baseURL: "/api/2.0/mlflow",
  artifacts: { type: "mlflow-artifacts", baseURL: "/api/2.0/mlflow-artifacts" }
});

const data = new TextEncoder().encode("hello world");
await ml.artifacts.uploadBytes(runId, "notes/hello.txt", data, { contentType: "text/plain" });
const list = await ml.artifacts.list(runId, "notes");
const text = await ml.artifacts.downloadText(runId, "notes/hello.txt");
```

Artifacts inherit the parent's `proxy`/`auth` unless the deployment routes them
elsewhere (`artifacts.proxy` / `artifacts.auth`).

If your server errors with **415 Unsupported Media Type**, switch to a
multipart/form-data upload — behavior differs by vendor and version. Supply a
custom adapter:

```js
class MyAdapter {
    constructor(http) { this.http = http; }
    uploadBytes(run_id, path, bytes) { /* ... */ }
    list(run_id, path) { /* ... */ }
    downloadText(run_id, path) { /* ... */ }
}

new MlFlowClient({ proxy: "mlflow", baseURL: "/api/2.0/mlflow",
                   artifacts: { type: "custom", adapter: new MyAdapter(http) } });
```

## API surface

```ts
class MlFlowClient {
    constructor(opts: {
        proxy?: string; baseURL?: string; auth?: object;
        http?: { timeoutMs?: number; maxRetries?: number };
        artifacts?: { type: 'mlflow-artifacts'|'databricks'|'custom';
                      baseURL?: string; proxy?: string; auth?: object; adapter?: any; }
    });
    experiments: ExperimentsAPI;
    runs: RunsAPI;
    artifacts: ArtifactsAdapter;
    endRun(run_id: string, status?: 'FINISHED'|'FAILED'|'KILLED'): Promise<any>;
}

class ExperimentsAPI {
    getByName(name: string): Promise<{ experiment?: { experiment_id: string } }>;
    ensure(name: string): Promise<string>;
    create(opts: { name: string; artifact_location?: string; tags?: Array<{key:string,value:string}> }): Promise<{ experiment_id: string }>;
    get(experiment_id: string): Promise<any>;
    setTag(experiment_id: string, key: string, value: string): Promise<any>;
    search(opts?: { view_type?: 'ACTIVE_ONLY'|'DELETED_ONLY'|'ALL'; max_results?: number; page_token?: string; filter?: string }): Promise<any>;
    delete(experiment_id: string): Promise<any>;
    restore(experiment_id: string): Promise<any>;
}

class RunsAPI {
    create(opts: { experiment_id: string; run_name?: string; tags?: Array<{key:string,value:string}>; start_time?: number }): Promise<{ run: { info: { run_id: string }}} >;
    get(run_id: string): Promise<any>;
    search(opts?: { experiment_ids?: string[]; filter?: string; order_by?: string[]; max_results?: number; page_token?: string }): Promise<{ runs?: any[] }>;
    setTag(run_id: string, key: string, value: string): Promise<any>;
    deleteTag(run_id: string, key: string): Promise<any>;
    logParam(run_id: string, key: string, value: string): Promise<any>;
    logParams(run_id: string, params: Record<string, any>): Promise<any>;
    logMetric(run_id: string, key: string, value: number, opts?: { timestamp?: number; step?: number }): Promise<any>;
    logMetrics(run_id: string, metrics: Record<string, number>, opts?: { timestamp?: number; step?: number }): Promise<any>;
    logBatch(run_id: string, payload: { metrics?: any[]; params?: any[]; tags?: any[] }): Promise<any>;
    endRun(run_id: string, status?: 'FINISHED'|'FAILED'|'KILLED', end_time?: number): Promise<any>;
    getOrCreateRunByTag(opts: { experiment_id: string; identifierTag: {key:string,value:string}; run_name?: string; extra_tags?: Array<{key:string,value:string}> }): Promise<string>;
}
```

## Notes

- All methods return raw MLflow responses, so you can drill into `info`, `data`, etc.
- Metric keys are sanitized to the MLflow-safe character set (`sanitizeMetricKey`,
  `utils.mjs`). Reuse it rather than re-implementing it.
- `HttpClient` retries 429/5xx with exponential backoff and throws `HTTPError`
  carrying `statusCode`.
- Targets the MLflow **2.x** REST API (`/experiments/search`, not the 1.x
  `/experiments/list`).
