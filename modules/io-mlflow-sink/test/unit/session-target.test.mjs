/**
 * Session-chosen MLflow destination (`params.mlflowTarget` + trusted
 * `sessionTarget`). The target is untrusted session input, so what is pinned here
 * is mostly where it must NOT reach: no allowlist = no redirect, names outside a
 * plain charset are dropped, the resolved name is what the allowlist judges, and
 * a run the session fixes never makes records overwrite each other.
 */
import { test, expect } from "@xopat/test-harness";
import * as MlflowUtils from "../../../mlflow/utils.mjs";
import { makeMlflowSink, normalizeTarget } from "../../mlflow-sink-factory.ts";
import { BUILT_IN_TEMPLATES } from "../../templates.ts";

globalThis.$ = globalThis.$ ?? {};
globalThis.$.t = (key) => key;

/** Fake MLflow client: records what the sink asked for. */
function installFakeMlflow() {
    const calls = { runs: [], batches: [], uploads: [] };
    globalThis.MlFlow = {
        Utils: MlflowUtils,
        MlFlowClient: class {
            experiments = { ensure: async (name) => `exp:${name}` };
            runs = {
                getOrCreateRunByTag: async (args) => {
                    calls.runs.push(args);
                    return `run:${args.experiment_id}:${args.identifierTag.value}`;
                },
                logBatch: async (runId, payload) => { calls.batches.push({ runId, ...payload }); },
            };
            artifacts = {
                uploadBytes: async (runId, path) => { calls.uploads.push({ runId, path }); },
            };
        },
    };
    return calls;
}

const ctxFor = (extra = {}) => ({
    ownerId: "annotations",
    ownerUid: "module.annotations",
    xoType: "module",
    direction: "export",
    capabilityId: "crud:score",
    viewerId: "v1",
    backgroundId: "slideA",
    ...extra,
});

function sinkWith(config, target, rejected = false) {
    return makeMlflowSink({
        getOptions: () => ({ proxy: "mlflow", template: "slide-scoring", experimentTemplate: "xopat-{ownerId}",
            runTemplate: "xopat-{viewerId}", identifierTag: "data_id", ...config }),
        getMapper: (name) => BUILT_IN_TEMPLATES[name],
        getTarget: () => target,
        isTargetRejected: () => rejected,
    });
}

const score = (slideId, value = 1) => ({ slideId, scoreKey: "grade", value });

test("without experimentAllow a session target is ignored, and \"required\" refuses @unit", async () => {
    const calls = installFakeMlflow();
    const target = { experiment: "attacker-exp" };

    const allowed = sinkWith({ sessionTarget: "allowed" }, target);
    expect((await allowed.create(ctxFor(), score("s1"))).ok).toBe(true);
    expect(calls.runs[0].experiment_id).toBe("exp:xopat-annotations"); // template, not the session

    const required = sinkWith({ sessionTarget: "required" }, target);
    const decision = required.accepts(ctxFor());
    expect(decision.accept).toBe(false);
    const result = await required.create(ctxFor(), score("s1"));
    expect(result.code).toBe("W_MLFLOW_TARGET_UNBOUNDED");
});

test("\"required\" with no target refuses; unset sessionTarget ignores a target @unit", async () => {
    const calls = installFakeMlflow();
    const required = sinkWith({ sessionTarget: "required", experimentAllow: ["xopat-*"] }, undefined);
    expect(required.accepts(ctxFor()).accept).toBe(false);
    expect((await required.create(ctxFor(), score("s1"))).code).toBe("W_MLFLOW_NO_TARGET");

    const off = sinkWith({ experimentAllow: ["xopat-*"] }, { experiment: "xopat-chosen" });
    await off.create(ctxFor(), score("s1"));
    expect(calls.runs[0].experiment_id).toBe("exp:xopat-annotations");
});

test("\"allowed\": an invalid session target refuses, an absent one falls back to the template @unit", async () => {
    const calls = installFakeMlflow();
    const rejected = sinkWith({ sessionTarget: "allowed", experimentAllow: ["xopat-*"] }, undefined, true);
    expect((await rejected.create(ctxFor(), score("s1"))).code).toBe("W_MLFLOW_NO_TARGET");
    expect(calls.runs.length).toBe(0);

    const absent = sinkWith({ sessionTarget: "allowed", experimentAllow: ["xopat-*"] }, undefined);
    expect((await absent.create(ctxFor(), score("s1"))).ok).toBe(true);
    expect(calls.runs[0].experiment_id).toBe("exp:xopat-annotations");
});

test("placeholders resolve per dispatch: one run per slide @unit", async () => {
    const calls = installFakeMlflow();
    const sink = sinkWith({ sessionTarget: "allowed", experimentAllow: ["xopat-*"] },
        { experiment: "xopat-cohort", run: "review-{backgroundId}" });
    await sink.create(ctxFor({ backgroundId: "slideA" }), score("slideA"));
    await sink.create(ctxFor({ backgroundId: "slideB" }), score("slideB"));
    expect(calls.runs.map(r => r.identifierTag)).toEqual([
        { key: "mlflow.runName", value: "review-slideA" },
        { key: "mlflow.runName", value: "review-slideB" },
    ]);
    expect(calls.runs.every(r => r.experiment_id === "exp:xopat-cohort")).toBe(true);
});

test("placeholder values are sanitized and the RESOLVED name meets the allowlists @unit", async () => {
    const calls = installFakeMlflow();
    const sink = sinkWith({ sessionTarget: "allowed", experimentAllow: ["xopat-*"], runAllow: ["review-*"] },
        { experiment: "xopat-cohort", run: "review-{backgroundId}" });
    // A hostile background id cannot smuggle quotes/slashes into the run name.
    await sink.create(ctxFor({ backgroundId: "a\" AND tags.x = \"/../b" }), score("s"));
    expect(calls.runs[0].identifierTag.value).toMatch(/^review-[A-Za-z0-9._-]+$/);

    const outside = sinkWith({ sessionTarget: "allowed", experimentAllow: ["xopat-*"] },
        { experiment: "{ownerId}-private" });
    expect((await outside.create(ctxFor(), score("s"))).code).toBe("W_MLFLOW_EXPERIMENT_DENIED");

    const badRun = sinkWith({ sessionTarget: "allowed", experimentAllow: ["xopat-*"], runAllow: ["review-*"] },
        { experiment: "xopat-cohort", run: "other-{backgroundId}" });
    expect((await badRun.create(ctxFor(), score("s"))).code).toBe("W_MLFLOW_RUN_DENIED");
});

test("normalizeTarget rejects rather than coerces untrusted names @unit", () => {
    expect(normalizeTarget({ experiment: "xopat-A", run: "review-{backgroundId}" }))
        .toEqual({ experiment: "xopat-A", run: "review-{backgroundId}" });
    expect(normalizeTarget('{"experiment":"xopat-A"}')).toEqual({ experiment: "xopat-A" });
    for (const bad of [
        { experiment: 'x"y' }, { experiment: "x\\" }, { experiment: "x`y" },
        { experiment: "x".repeat(251) }, { experiment: 42 }, { experiment: "" },
        { experiment: "ok", run: 'r" AND 1' }, { experiment: "ok", run: 5 },
        [], null, "not json", { run: "r" },
    ]) {
        expect(normalizeTarget(bad), JSON.stringify(bad)).toBeUndefined();
    }
    // Control characters are stripped, not kept.
    expect(normalizeTarget({ experiment: "xo\u0000pat" })).toEqual({ experiment: "xopat" });
});

test("a session-fixed run keeps built-in records apart @unit", () => {
    const ctx = ctxFor();
    const shared = { experimentTemplate: "e", runTemplate: "r", identifierTag: "data_id", sharedRun: true };
    const plain = { ...shared, sharedRun: false };

    const scoring = BUILT_IN_TEMPLATES["slide-scoring"];
    expect(scoring(ctx, score("slideA"), plain).metrics[0].key).toBe("grade");
    expect(scoring(ctx, score("slideA"), shared).metrics[0].key).toBe("slideA.grade");
    expect(scoring(ctx, score("slideA"), shared).tags[0].key).toBe("slideA.grade.label");

    const perViewer = BUILT_IN_TEMPLATES["run-per-viewer"];
    expect(perViewer(ctx, score("slideA"), plain).metrics[0].key).toBe("grade.slideA");
    expect(perViewer(ctx, score("slideA"), shared).metrics[0].key).toBe("v1.grade.slideA");

    const perSession = BUILT_IN_TEMPLATES["run-per-session"];
    expect(perSession(ctx, score("slideA"), plain).params[0].key).toBe("slideA.grade");
    expect(perSession(ctx, score("slideA"), shared).params[0].key).toBe("annotations.slideA.grade");

    const bundle = BUILT_IN_TEMPLATES["bundle-artifact"];
    const bctx = ctxFor({ key: "annotations", capabilityId: "bundle-export" });
    expect(bundle(bctx, { a: 1 }, plain).artifacts[0].path).toBe("xopat/annotations.json");
    expect(bundle(bctx, { a: 1 }, shared).artifacts[0].path).toBe("xopat/v1/annotations.json");
});

test("sink tells the mapper the run is shared only when the session fixed one @unit", async () => {
    const seen = [];
    installFakeMlflow();
    const sink = (target) => makeMlflowSink({
        getOptions: () => ({ proxy: "mlflow", template: "spy", sessionTarget: "allowed", experimentAllow: ["xopat-*"] }),
        getMapper: () => (ctx, item, o) => {
            seen.push(o.sharedRun);
            return { experiment: "xopat-x", run: { identifierTag: { key: "data_id", value: "1" } } };
        },
        getTarget: () => target,
    });
    await sink({ experiment: "xopat-a" }).create(ctxFor(), {});
    await sink({ experiment: "xopat-a", run: "r" }).create(ctxFor(), {});
    expect(seen).toEqual([false, true]);
});
