/**
 * The mlflow-artifacts REST service addresses a file by its path under the
 * tracking server's artifact root. It has no `run_id` parameter anywhere.
 *
 * The adapter used to PUT `/artifacts/log-artifact?run_id=…&path=…`, which is
 * not an endpoint — MLflow read `log-artifact` as the artifact path and wrote a
 * file by that name at the root, then answered 200 with an empty body. The
 * client asked for JSON, so a write that had already happened surfaced as
 * "returned an unparseable body where JSON was expected". Both halves of that
 * are pinned here: where the bytes go, and that an empty 200 is success.
 */
import { test, expect } from "@xopat/test-harness";
import { artifactRootFromUri, MlflowArtifactsAdapter } from "../../adapters-artifacts.mjs";

/** Records what the adapter asked of HttpClient, and answers like MLflow does. */
const recordingHttp = (reply = "") => {
    const calls = [];
    return {
        calls,
        request(path, options = {}) {
            calls.push({ path, ...options });
            return Promise.resolve(reply);
        },
    };
};

test("a proxied artifact_uri resolves to the path the REST service addresses @unit", () => {
    expect(artifactRootFromUri("mlflow-artifacts:/0/8467cab/artifacts")).toBe("0/8467cab/artifacts");
    // Some servers spell the same location out as a URL.
    expect(artifactRootFromUri("http://localhost:5000/api/2.0/mlflow-artifacts/artifacts/0/abc/artifacts"))
        .toBe("0/abc/artifacts");
});

test("a storage-backend artifact_uri resolves to nothing @unit", () => {
    // Not a parse failure — the deployment is saying the client should talk to
    // the backend directly, and the artifacts service genuinely cannot serve it.
    for (const uri of ["file:///mlruns/0/abc/artifacts", "s3://bucket/x", "gs://bucket/x", "", undefined]) {
        expect(artifactRootFromUri(uri), String(uri)).toBeUndefined();
    }
});

test("uploadBytes PUTs under the run's artifact root, not a query parameter @unit", async () => {
    const http = recordingHttp();
    const adapter = new MlflowArtifactsAdapter(http, async () => "0/8467cab/artifacts");

    await adapter.uploadBytes("8467cab", "xopat/slides-slide-tif.json", '{"a":1}',
        { contentType: "application/json" });

    expect(http.calls).toHaveLength(1);
    const call = http.calls[0];
    expect(call.path).toBe("/artifacts/0/8467cab/artifacts/xopat/slides-slide-tif.json");
    expect(call.method).toBe("PUT");
    // A successful upload answers 200 with an empty body; "json" would throw.
    expect(call.expect).toBe("text");
    // `run_id` is not part of this API — passing it as a query parameter is what
    // made the request address the artifact root instead of the run.
    expect(call.query).toBeUndefined();
    expect(call.headers["Content-Type"]).toBe("application/json");
});

test("an unproxied run fails with a reason rather than writing somewhere else @unit", async () => {
    const http = recordingHttp();
    const adapter = new MlflowArtifactsAdapter(http, async () => undefined);

    await expect(adapter.uploadBytes("abc", "xopat/x.json", "{}")).rejects.toThrow(/mlflow-artifacts/);
    // The point: nothing was sent. A write to a wrong-but-valid path is worse
    // than an error, because it looks like it worked.
    expect(http.calls).toHaveLength(0);
});

test("list addresses the root, and download the file under it @unit", async () => {
    const adapter = new MlflowArtifactsAdapter(recordingHttp(), async () => "0/abc/artifacts");

    await adapter.list("abc", "xopat");
    await adapter.downloadText("abc", "xopat/x.json");

    const [listed, downloaded] = adapter.http.calls;
    expect(listed.path).toBe("/artifacts");
    expect(listed.query.path).toBe("0/abc/artifacts/xopat");
    expect(downloaded.path).toBe("/artifacts/0/abc/artifacts/xopat/x.json");
    expect(downloaded.expect).toBe("text");
});
