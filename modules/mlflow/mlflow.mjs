import { ExperimentsAPI } from "./experiments.mjs";
import { RunsAPI } from "./runs.mjs";
import { HttpClient } from "./http-client.mjs";
import * as ArtifactAdapters from "./adapters-artifacts.mjs";

/**
 * High-level MlFlow client.
 *
 * ```js
 * const ml = new MlFlowClient({
 *   url: "https://host/api/2.0/mlflow",
 *   token: process.env.MLFLOW_TOKEN,
 *   artifacts: { type: "mlflow-artifacts", url: "https://host/api/2.0/mlflow-artifacts" }
 * });
 * const expId = await ml.experiments.ensure("my-experiment");
 * const runId = await ml.runs.getOrCreateRunByTag({ experiment_id: expId, identifierTag: { key: "data_id", value: "abc" }, run_name: "ABC run" });
 * await ml.runs.logMetric(runId, "accuracy", 0.98);
 * await ml.endRun(runId, "FINISHED");
 * ```
 */
class MlFlowClient {
    /**
     * @param {Object} options
     * @param {string} options.url  - MlFlow base REST URL (e.g., https://host/api/2.0/mlflow)
     * @param {string} [options.token]
     * @param {string} [options.username]
     * @param {string} [options.password]
     * @param {Object} [options.http] - { timeoutMs?, maxRetries? }
     * @param {Object} [options.artifacts] - { type: 'mlflow-artifacts'|'databricks'|'custom', url?: string, adapter?: object, token?, username?, password? }
     */
    constructor({ url, token, username, password, http = {}, artifacts } = {}) {
        if (!url) throw new Error("MlFlowClient: options.url is required");

        this.http = new HttpClient({ baseURL: url, token, username, password, ...http });

        this.experiments = new ExperimentsAPI(this.http);
        this.runs = new RunsAPI(this.http);

        // Artifacts: plug-in adapter
        this.artifacts = this._buildArtifactsAdapter(artifacts);
    }

    async _buildArtifactsAdapter(artifacts) {
        if (!artifacts) return new ArtifactAdapters.NoopArtifactsAdapter();

        if (artifacts.type === "custom" && artifacts.adapter) return artifacts.adapter;


        if (artifacts.type === "mlflow-artifacts") {
            const { MlflowArtifactsAdapter } = await import("./adapters-artifacts.mjs");
            const http = new HttpClient({ baseURL: artifacts.url, token: artifacts.token ?? this.http.token, username: artifacts.username ?? this.http.username, password: artifacts.password ?? this.http.password, timeoutMs: this.http.timeoutMs, maxRetries: this.http.maxRetries });
            return new MlflowArtifactsAdapter(http);
        }

        if (artifacts.type === "databricks") {
            const { DatabricksArtifactsAdapter } = await import("./adapters-artifacts.mjs");
            const baseURL = artifacts.url || this.http.baseURL.replace(/\/mlflow($|\/)/, "mlflow"); // best-effort
            const http = new HttpClient({ baseURL, token: artifacts.token ?? this.http.token, username: artifacts.username ?? this.http.username, password: artifacts.password ?? this.http.password, timeoutMs: this.http.timeoutMs, maxRetries: this.http.maxRetries });
            return new DatabricksArtifactsAdapter(http);
        }

        return new ArtifactAdapters.NoopArtifactsAdapter();
    }

    /** Convenience to end a run */
    endRun(run_id, status) { return this.runs.endRun(run_id, status); }
}

export { MlFlowClient, ExperimentsAPI, RunsAPI, HttpClient, ArtifactAdapters };
const __MLFLOW_EXPORT__ = { MlFlowClient, ExperimentsAPI, RunsAPI, HttpClient, ArtifactAdapters };

if (typeof globalThis !== "undefined") {
    const ns = (globalThis.MlFlow = globalThis.MlFlow || {});
    for (const [k, v] of Object.entries(__MLFLOW_EXPORT__)) {
        if (!(k in ns)) {
            Object.defineProperty(ns, k, {
                value: v,
                enumerable: true,
                configurable: false,
                writable: false,
            });
        }
    }
}