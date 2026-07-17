import { ExperimentsAPI } from "./experiments.mjs";
import { RunsAPI } from "./runs.mjs";
import * as ArtifactAdapters from "./adapters-artifacts.mjs";
import * as Utils from "./utils.mjs";

/**
 * High-level MlFlow client.
 *
 * Credentials are never configured here. Declare a server proxy alias under
 * `server.secure.proxies.<alias>` whose `headers.Authorization` is expanded
 * server-side from an environment variable, and pass the alias as `proxy`.
 * `auth` is forwarded verbatim to HttpClient and refers to the *viewer's* own
 * token for that proxy's verifier chain — not to any MLflow secret.
 *
 * ```js
 * const ml = new MlFlowClient({
 *   proxy: "mlflow",
 *   baseURL: "/api/2.0/mlflow",
 *   auth: { contextId: "core", types: ["jwt"], required: true },
 *   artifacts: { type: "mlflow-artifacts", baseURL: "/api/2.0/mlflow-artifacts" }
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
     * @param {string} [options.proxy]   - server proxy alias holding the MLflow credential
     * @param {string} [options.baseURL] - REST base; relative when proxied (e.g. /api/2.0/mlflow),
     *                                     absolute only for open/unauthenticated servers
     * @param {Object} [options.auth]    - forwarded to HttpClient: { contextId, types, required }
     * @param {Object} [options.http]    - { timeoutMs?, maxRetries? }
     * @param {Object} [options.artifacts] - { type: 'mlflow-artifacts'|'databricks'|'custom',
     *                                        baseURL?: string, proxy?: string, auth?: object, adapter?: object }
     */
    constructor({ proxy, baseURL, auth, http = {}, artifacts } = {}) {
        if (!proxy && !baseURL) throw new Error("MlFlowClient: options.proxy or options.baseURL is required");

        this.http = new globalThis.HttpClient({ proxy, baseURL, auth, ...http });

        this.experiments = new ExperimentsAPI(this.http);
        this.runs = new RunsAPI(this.http);

        // Artifacts: plug-in adapter
        this.artifacts = this._buildArtifactsAdapter({ proxy, auth, http, artifacts });
    }

    _buildArtifactsAdapter({ proxy, auth, http, artifacts }) {
        if (!artifacts) return new ArtifactAdapters.NoopArtifactsAdapter();

        if (artifacts.type === "custom" && artifacts.adapter) return artifacts.adapter;

        const Adapter = artifacts.type === "mlflow-artifacts" ? ArtifactAdapters.MlflowArtifactsAdapter
            : artifacts.type === "databricks" ? ArtifactAdapters.DatabricksArtifactsAdapter
                : null;
        if (!Adapter) return new ArtifactAdapters.NoopArtifactsAdapter();

        // Artifacts live under a sibling REST base. They inherit the parent's
        // proxy/auth unless the deployment routes them elsewhere.
        return new Adapter(new globalThis.HttpClient({
            proxy: artifacts.proxy ?? proxy,
            baseURL: artifacts.baseURL,
            auth: artifacts.auth ?? auth,
            ...http,
        }));
    }

    /** Convenience to end a run */
    endRun(run_id, status) { return this.runs.endRun(run_id, status); }
}

export { MlFlowClient, ExperimentsAPI, RunsAPI, ArtifactAdapters, Utils };
// `Utils` is part of the public surface on purpose: consumers that build
// log-batch payloads by hand (e.g. the io-mlflow-sink module) must sanitize
// metric keys the same way RunsAPI.logMetric does. Re-implementing it drifts.
const __MLFLOW_EXPORT__ = { MlFlowClient, ExperimentsAPI, RunsAPI, ArtifactAdapters, Utils };

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