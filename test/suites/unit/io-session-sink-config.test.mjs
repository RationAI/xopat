/**
 * `params.ioSinks.<id>` may carry settings for one sink, not only on/off. Core
 * hands them over opaque through `IO_PIPELINE.sessionSinkConfig(id)` — and only
 * where the operator marked the sink `sessionControllable`, the same rule that
 * lets a session switch it. They are session input, so what is pinned here is
 * the gate, the copy, and that garbage never reads as anything.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.OpenSeadragon = globalThis.OpenSeadragon ?? {};
globalThis.OpenSeadragon.EventSource = globalThis.OpenSeadragon.EventSource ?? class {
    addHandler() {} removeHandler() {} raiseEvent() {}
};
globalThis.$ = globalThis.$ ?? { t: (key) => String(key).split(".").pop() };

const { IOPipeline } = await import("../../../src/classes/io/io-pipeline.ts");

const controllable = { sinks: { mlflow: { enabled: false, sessionControllable: true } } };

function pipelineWith(config, sessionSinks) {
    return new IOPipeline({
        POST_DATA: {},
        getConfig: () => config,
        getSessionSinks: () => sessionSinks,
        notify: () => {},
    });
}

test("object form: enabled switches the sink, the rest goes to the sink @unit", () => {
    const pipeline = pipelineWith(controllable, {
        mlflow: { enabled: true, target: { experiment: "cohort-A", run: "review" } },
    });
    expect(pipeline.isSinkEnabled("mlflow")).toBe(true);
    expect(pipeline.sessionSinkConfig("mlflow")).toEqual({ target: { experiment: "cohort-A", run: "review" } });
});

test("without sessionControllable the settings are never handed out @unit", () => {
    const pipeline = pipelineWith({ sinks: { mlflow: { enabled: true } } }, {
        mlflow: { enabled: false, target: { experiment: "attacker" } },
    });
    expect(pipeline.sessionSinkConfig("mlflow")).toBeUndefined();
    expect(pipeline.isSinkEnabled("mlflow")).toBe(true); // operator pin stands
});

test("each call returns a detached copy @unit", () => {
    const session = { mlflow: { target: { experiment: "cohort-A" } } };
    const pipeline = pipelineWith(controllable, session);
    const first = pipeline.sessionSinkConfig("mlflow");
    first.target.experiment = "mutated";
    session.mlflow.target.experiment = "mutated-at-source";
    expect(pipeline.sessionSinkConfig("mlflow")).toEqual({ target: { experiment: "cohort-A" } });
});

test("non-boolean enabled and non-object entries say nothing @unit", () => {
    const pipeline = pipelineWith(controllable, {
        mlflow: { enabled: "true", target: { experiment: "cohort-A" } },
        other: ["not", "an", "object"],
    });
    expect(pipeline.isSinkEnabled("mlflow")).toBe(false); // baseline, "true" is not a boolean
    expect(pipeline.sessionSinkConfig("mlflow")).toEqual({ target: { experiment: "cohort-A" } });
    expect(pipeline.sessionSinkConfig("other")).toBeUndefined();
});

test("boolean form is unchanged and carries no settings @unit", () => {
    const pipeline = pipelineWith(controllable, { mlflow: true });
    expect(pipeline.isSinkEnabled("mlflow")).toBe(true);
    expect(pipeline.sessionSinkConfig("mlflow")).toBeUndefined();
});
