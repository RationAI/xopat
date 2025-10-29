# Tiny MLflow JS Client

A lightweight, modular MLflow REST client for browsers or Node.js. It focuses on:

- **Robust basics**: create/reuse experiments, create/search/manage runs
- **Logging**: metrics, params, tags, batches
- **Run lifecycle**: end runs with status
- **Artifacts (pluggable)**: optional adapters for "mlflow-artifacts" or Databricks
- **Resilience**: retries & timeouts built-in

> Works great as a foundation for higher-level features like your slide-labeling utility.

---

## Install

Just copy `src/` into your project, or bundle it as an ES module.

## Quick start

> Note: Vanilla JS can use ``window.MlFlow`` namespace to access the classes.

```js
import { MLflowClient } from "./src/index.js";

const ml = new MLflowClient({
  url: "https://mlflow.yourhost.com/api/2.0/mlflow",
  token: process.env.MLFLOW_TOKEN,
  // artifacts are optional
  // artifacts: { type: "mlflow-artifacts", url: "https://mlflow.yourhost.com/api/2.0/mlflow-artifacts" }
});

const expId = await ml.experiments.ensure("demo-exp");

// Reuse or create a run by tag
const runId = await ml.runs.getOrCreateRunByTag({
  experiment_id: expId,
  identifierTag: { key: "data_id", value: "base" },
  run_name: "base-run",
  extra_tags: [{ key: "source", value: "tiny-client" }]
});

await ml.runs.logParams(runId, { model: "resnet50", lr: 0.001 });
await ml.runs.logMetric(runId, "accuracy", 0.987);
await ml.runs.logMetrics(runId, { loss: 0.12, f1: 0.91 });

// End run
await ml.endRun(runId, "FINISHED");
```




## Artifacts

Artifacts APIs vary across deployments. This client supports **adapters**:

```js
import { MLflowClient, ArtifactAdapters } from "./src/index.js";

const ml = new MLflowClient({
  url: "https://host/api/2.0/mlflow",
  artifacts: {
    type: "mlflow-artifacts",
    url: "https://host/api/2.0/mlflow-artifacts"
  }
});

// upload bytes
const data = new TextEncoder().encode("hello world");
await ml.artifacts.uploadBytes(runId, "notes/hello.txt", data, { contentType: "text/plain" });

// list
const list = await ml.artifacts.list(runId, "notes");

// download
const text = await ml.artifacts.downloadText(runId, "notes/hello.txt");
```

If your server errors with **415 Unsupported Media Type**, switch to a multipart/form-data upload in your adapter (behavior differs by vendor/version). You can also implement a custom adapter:

```js
class MyAdapter {
    constructor(http) { this.http = http; }
    uploadBytes(run_id, path, bytes) { /* ... */ }
    list(run_id, path) { /* ... */ }
    downloadText(run_id, path) { /* ... */ }
}
```

## API surface

```ts
class MLflowClient {
    constructor(opts: {
        url: string; token?: string; username?: string; password?: string;
        http?: { timeoutMs?: number; maxRetries?: number };
        artifacts?: { type: 'mlflow-artifacts'|'databricks'|'custom'; url?: string; adapter?: any; }
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
    list(opts?: { view_type?: 'ACTIVE_ONLY'|'DELETED_ONLY'|'ALL'; max_results?: number; page_token?: string }): Promise<any>;
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
- All methods return raw MLflow responses so you can drill into `info`, `data`, etc.
- Metric keys are sanitized to the MLflow-safe character set.
- HTTP client retries 429/5xx with exponential backoff.
- For browsers without `btoa`, Basic auth falls back to `Buffer` (Node).
