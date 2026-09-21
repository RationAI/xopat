
/**
 * Artifacts in MLflow are deployed in different ways depending on your server.
 * This module exposes a pluggable adapter interface. Supply one to MlFlowClient
 * if you want artifact uploads/downloads.
 *
 * Provided adapters:
 *  - MlflowArtifactsAdapter (MLflow >= 2.x with mlflow-artifacts REST enabled)
 *  - DatabricksArtifactsAdapter (Databricks-specific endpoints)
 * If neither fits your stack, implement the same interface and pass it in.
 */

export class NoopArtifactsAdapter {
    constructor() {}
    async uploadBytes() { throw new Error("Artifacts not configured. Provide an artifacts adapter."); }
    async list() { throw new Error("Artifacts not configured. Provide an artifacts adapter."); }
    async download() { throw new Error("Artifacts not configured. Provide an artifacts adapter."); }
}

/**
 * Strip the artifact-root prefix out of a run's `artifact_uri`.
 *
 * The mlflow-artifacts service addresses a file by its path under the tracking
 * server's artifact root — there is no `run_id` parameter anywhere in that API.
 * A run's root is whatever `runs/get` reports:
 *
 *   mlflow-artifacts:/<experiment_id>/<run_id>/artifacts   (proxied — supported)
 *   http://host/api/2.0/mlflow-artifacts/artifacts/<...>   (same, spelled out)
 *   file:///…  s3://…  gs://…                              (NOT proxied)
 *
 * The last group is the deployment saying the client should talk to the storage
 * backend directly; the artifacts REST service cannot serve it, so callers get a
 * clear error instead of a write that lands somewhere unintended.
 *
 * @returns {string|undefined} root path with no leading/trailing slash
 */
export function artifactRootFromUri(uri) {
    if (typeof uri !== "string" || !uri) return undefined;
    const trim = (s) => s.replace(/^\/+|\/+$/g, "");
    const proxied = /^mlflow-artifacts:(?:\/\/[^/]*)?\/(.*)$/.exec(uri);
    if (proxied) return trim(proxied[1]);
    const spelled = /^https?:\/\/[^/]+\/api\/2\.0\/mlflow-artifacts\/artifacts\/(.*)$/.exec(uri);
    if (spelled) return trim(spelled[1]);
    return undefined;
}

/** Percent-encode each segment; never collapse or drop one. */
const encodePath = (p) => String(p).split("/").filter(Boolean).map(encodeURIComponent).join("/");

/** MLflow Artifacts REST (mlflow-artifacts) */
export class MlflowArtifactsAdapter {
    /**
     * @param {HttpClient} http - an HttpClient pointing to the *mlflow-artifacts* base URL
     *                            e.g. https://host/api/2.0/mlflow-artifacts
     * @param {(run_id: string) => Promise<string>} resolveRunRoot - resolves a run
     *        to its artifact root path. Required: the REST API has no notion of a
     *        run, so without it there is nothing to address.
     */
    constructor(http, resolveRunRoot) {
        this.http = http;
        this.resolveRunRoot = resolveRunRoot;
    }

    async _rootOf(run_id) {
        if (typeof this.resolveRunRoot !== "function") {
            throw new Error("MlflowArtifactsAdapter: no run-root resolver was supplied.");
        }
        const root = await this.resolveRunRoot(run_id);
        if (!root) {
            throw new Error(
                `MlflowArtifactsAdapter: run ${run_id} does not store artifacts behind the ` +
                `mlflow-artifacts service (its artifact_uri points straight at the storage ` +
                `backend). Start the server with a proxied artifact root, or supply a custom adapter.`);
        }
        return root;
    }

    /**
     * Upload raw bytes to `<run artifact root>/<path>`.
     *
     * `expect: "text"` because a successful upload answers 200 with an EMPTY
     * body — asking for JSON made every successful write look like a transport
     * failure ("returned an unparseable body where JSON was expected"), which is
     * a worse outcome than a real error: the bytes were already written.
     *
     * Some servers require multipart/form-data instead; if you hit 415,
     * switch to multipart per your deployment.
     */
    async uploadBytes(run_id, path, bytes, { contentType = "application/octet-stream" } = {}) {
        const root = await this._rootOf(run_id);
        return this.http.request(`/artifacts/${root}/${encodePath(path)}`, {
            method: "PUT",
            body: bytes, // string or Uint8Array/Buffer
            headers: { "Content-Type": contentType },
            expect: "text",
        });
    }

    async list(run_id, path = "") {
        const root = await this._rootOf(run_id);
        const under = encodePath(path);
        return this.http.request("/artifacts", {
            method: "GET",
            query: { path: under ? `${root}/${under}` : root },
        });
    }

    /** Download file as text */
    async downloadText(run_id, path) {
        const root = await this._rootOf(run_id);
        return this.http.request(`/artifacts/${root}/${encodePath(path)}`, {
            method: "GET",
            expect: "text",
        });
    }
}

/** Databricks-specific artifacts adapter (shape may differ across deployments). */
export class DatabricksArtifactsAdapter {
    constructor(http) { this.http = http; }
    async uploadBytes(run_id, path, bytes, { contentType = "application/octet-stream" } = {}) {
        // Databricks often exposes /artifacts/put
        return this.http.request("/artifacts/put", {
            method: "PUT",
            query: { run_id, path },
            body: bytes,
            headers: { "Content-Type": contentType },
            expect: "json",
        });
    }
    list(run_id, path = "") {
        return this.http.request("/artifacts/list", { method: "GET", query: { run_id, path } });
    }
    async downloadText(run_id, path) {
        return this.http.request("/artifacts/get", { method: "GET", query: { run_id, path }, expect: "text" });
    }
}
