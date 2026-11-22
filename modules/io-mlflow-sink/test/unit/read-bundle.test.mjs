/**
 * `readBundle` must hand an importer back what `writeBundle` stored. Artifact
 * templates store the bundle as a file, so the file — not the run's tags — is
 * the payload; a run without it is "nothing saved yet", not an error.
 */
import { test, expect } from "@xopat/test-harness";
import * as MlflowUtils from "../../../mlflow/utils.mjs";
import { makeMlflowSink } from "../../mlflow-sink-factory.ts";
import { BUILT_IN_TEMPLATES } from "../../templates.ts";

globalThis.$ = globalThis.$ ?? {};
globalThis.$.t = (key) => key;

function installFakeMlflow({ files = {}, runData = { tags: [{ key: "t", value: "v" }] }, experimentError } = {}) {
    const calls = { downloads: [] };
    globalThis.MlFlow = {
        Utils: MlflowUtils,
        MlFlowClient: class {
            experiments = { getByName: async (name) => {
                if (experimentError) throw Object.assign(new Error("lookup failed"), { statusCode: experimentError });
                return { experiment: { experiment_id: `exp:${name}` } };
            } };
            runs = { search: async () => ({ runs: [{ info: { run_id: "run1" }, data: runData }] }) };
            artifacts = {
                downloadText: async (runId, path) => {
                    calls.downloads.push({ runId, path });
                    if (!(path in files)) throw Object.assign(new Error("not found"), { statusCode: 404 });
                    return files[path];
                },
                downloadBytes: async (runId, path) => {
                    calls.downloads.push({ runId, path, bytes: true });
                    if (!(path in files)) throw Object.assign(new Error("not found"), { statusCode: 404 });
                    return files[path];
                },
            };
        },
    };
    return calls;
}

const ctx = { ownerId: "annotations", ownerUid: "module.annotations", xoType: "module", direction: "import",
    capabilityId: "bundle-import", viewerId: "v1", backgroundId: "slideA", key: "slideA" };

const sinkWith = (template) => makeMlflowSink({
    getOptions: () => ({ proxy: "mlflow", template, artifacts: { type: "mlflow-artifacts" },
        experimentTemplate: "xopat-{ownerId}", runTemplate: "xopat-{viewerId}", identifierTag: "data_id" }),
    getMapper: (name) => name === "tags-only"
        ? () => ({ experiment: "xopat-x", run: { name: "r", identifierTag: { key: "data_id", value: "v1" } } })
        : BUILT_IN_TEMPLATES[name],
});

test("bundle-artifact returns the stored JSON file, parsed @unit", async () => {
    const bundle = { objects: [{ type: "rect", left: 1 }] };
    const calls = installFakeMlflow({ files: { "xopat/slideA.json": JSON.stringify(bundle) } });
    const res = await sinkWith("bundle-artifact").readBundle(ctx);
    expect(res).toEqual({ ok: true, payload: bundle });
    expect(calls.downloads).toEqual([{ runId: "run1", path: "xopat/slideA.json" }]);
});

test("bundle-artifact with no file yet is empty, not an error @unit", async () => {
    installFakeMlflow();
    expect(await sinkWith("bundle-artifact").readBundle(ctx)).toEqual({ ok: true });
});

test("a missing experiment is empty; an unreachable one is a failure @unit", async () => {
    installFakeMlflow({ experimentError: 404 });
    expect(await sinkWith("bundle-artifact").readBundle(ctx)).toEqual({ ok: true });
    // Reading an outage as "nothing stored" would let the next save overwrite
    // data that was never loaded.
    for (const status of [401, 500, 503]) {
        installFakeMlflow({ experimentError: status });
        const res = await sinkWith("bundle-artifact").readBundle(ctx);
        expect(res.ok).toBe(false);
        expect(res.refused).toBe(true);
    }
});

test("templates without artifacts still return the run data @unit", async () => {
    const runData = { metrics: [{ key: "grade", value: 2 }] };
    const calls = installFakeMlflow({ runData });
    const res = await sinkWith("tags-only").readBundle(ctx);
    expect(res).toEqual({ ok: true, payload: runData });
    expect(calls.downloads.length).toBe(0);
});

test("a session artifact target is read from the same path it was written to @unit", async () => {
    const calls = installFakeMlflow({ files: { "annotations/slideA.json": "[]" } });
    const sink = makeMlflowSink({
        getOptions: () => ({ proxy: "mlflow", template: "bundle-artifact", artifacts: { type: "mlflow-artifacts" },
            experimentTemplate: "xopat-{ownerId}", runTemplate: "xopat-{viewerId}", identifierTag: "data_id",
            sessionTarget: "allowed", experimentAllow: ["xopat-*"] }),
        getMapper: (name) => BUILT_IN_TEMPLATES[name],
        getTarget: () => ({ experiment: "xopat-cohort", run: "review", artifact: "annotations/{key}.json" }),
    });
    expect(await sink.readBundle(ctx)).toEqual({ ok: true, payload: [] });
    expect(calls.downloads).toEqual([{ runId: "run1", path: "annotations/slideA.json" }]);
});

test("a binding pinned to a binary format reads the artifact back as bytes @unit", async () => {
    const stored = new Uint8Array([0x44, 0x49, 0x43, 0x4d, 0xff, 0x00]).buffer;
    const calls = installFakeMlflow({ files: { "xopat/slideA.dcm": stored } });
    const format = { domain: "annotations", id: "dicom-sr", registered: true, binary: true,
        contentType: "application/dicom", fileExt: "dcm", options: {} };
    const res = await sinkWith("bundle-artifact").readBundle({ ...ctx, format });
    expect(res.ok).toBe(true);
    expect(res.payload).toBeInstanceOf(Uint8Array);
    expect(Array.from(res.payload)).toEqual([0x44, 0x49, 0x43, 0x4d, 0xff, 0x00]);
    expect(calls.downloads).toEqual([{ runId: "run1", path: "xopat/slideA.dcm", bytes: true }]);
});
