
/**
 * Artifacts in MLflow are deployed in different ways depending on your server.
 * This module exposes a pluggable adapter interface. Supply one to MLflowClient
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

/** MLflow Artifacts REST (mlflow-artifacts) */
export class MlflowArtifactsAdapter {
    /**
     * @param {HttpClient} http - an HttpClient pointing to the *mlflow-artifacts* base URL
     *                            e.g. https://host/api/2.0/mlflow-artifacts
     */
    constructor(http) { this.http = http; }

    /**
     * Upload raw bytes to a path (creates intermediate dirs as needed);
     * Some servers require multipart/form-data instead; if you hit 415,
     * switch to multipart per your deployment.
     */
    async uploadBytes(run_id, path, bytes, { contentType = "application/octet-stream" } = {}) {
        const url = `/artifacts/log-artifact`;
        const query = { run_id, path };
        // Use binary body; override content-type
        return this.http.request(url, {
            method: "PUT",
            query,
            body: bytes, // string or Uint8Array/Buffer
            headers: { "Content-Type": contentType },
            expect: "json",
        });
    }

    list(run_id, path = "") {
        return this.http.request("/artifacts/list", { method: "GET", query: { run_id, path } });
    }

    /** Download file as text */
    async downloadText(run_id, path) {
        const res = await this.http.request("/artifacts/download", { method: "GET", query: { run_id, path }, expect: "text" });
        return res;
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
