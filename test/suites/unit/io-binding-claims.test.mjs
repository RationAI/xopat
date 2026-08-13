/**
 * A sink-providing module can bind its own sink, and the operator still wins.
 *
 * `registerSink` only *offers* a destination — until now nothing could route to
 * it except `ENV.client.io.bindings` or the capability owner's own include.json.
 * That is the right default for a sink competing with others and the wrong one
 * for a module that IS the backend of the session it created: forget one config
 * line and the feature is not degraded, it is silently inert, which is what
 * pushes integrations into persisting beside the pipeline instead of through it.
 *
 * These vectors pin the precedence that makes claiming safe: a claim fills a
 * hole (rule 2.5), it never overrides an operator decision in either direction,
 * and `crud:*` — which has no built-in fallback — is the case that actually
 * needed it.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

class EventSource {
    constructor() { this._h = new Map(); }
    addHandler(name, fn) { (this._h.get(name) ?? this._h.set(name, []).get(name)).push(fn); }
    removeHandler(name, fn) {
        const l = this._h.get(name);
        if (l) this._h.set(name, l.filter(x => x !== fn));
    }
    raiseEvent(name, payload) { for (const fn of this._h.get(name) ?? []) fn(payload); }
}
globalThis.OpenSeadragon = globalThis.OpenSeadragon ?? {};
globalThis.OpenSeadragon.EventSource = globalThis.OpenSeadragon.EventSource ?? EventSource;
// The pipeline reports an unresolvable binding through `$.t`; outside the app the
// i18next shim the loader installs does not exist. Same contract: key in, string out.
globalThis.$ = globalThis.$ ?? { t: (key) => String(key).split(".").pop() };

const { IOPipeline } = await import("../../../src/classes/io/io-pipeline.ts");

/** Pipeline with one owner declaring a crud capability, and one registered sink. */
function makePipeline(config = {}) {
    const pipeline = new IOPipeline({
        POST_DATA: {},
        getConfig: () => config,
        notify: () => {},
    });
    pipeline.registerOwner("module.annotations", { ownerId: "annotations", xoType: "module" });
    pipeline.registerCapability("module.annotations", { id: "crud:annotation", kind: "crud" });
    pipeline.registerCapability("module.annotations", { id: "bundle-export", kind: "bundle" });
    for (const id of ["empaia-annotations", "other-sink", "post-data"]) {
        pipeline.registerSink({ id, supports: ["crud", "bundle"], async create() { return { ok: true }; } });
    }
    return pipeline;
}

test("crud is inert with no binding — the hole a claim exists to fill @unit", () => {
    const pipeline = makePipeline();
    expect(pipeline.bindingsFor("module.annotations", "crud:annotation")).toEqual([]);
});

test("a claim binds the capability without any operator config @unit", () => {
    const pipeline = makePipeline();
    pipeline.claimBinding("annotations", "crud:annotation", ["empaia-annotations"], "module.empaia-workbench");

    expect(pipeline.bindingsFor("module.annotations", "crud:annotation")).toEqual(["empaia-annotations"]);
    expect(pipeline.listBindingClaims()).toEqual([{
        owner: "annotations",
        capabilityId: "crud:annotation",
        claimantUid: "module.empaia-workbench",
        targets: ["empaia-annotations"],
    }]);
});

test("the claim may name the owner by uid instead of id @unit", () => {
    const pipeline = makePipeline();
    pipeline.claimBinding("module.annotations", "crud:annotation", ["empaia-annotations"], "module.empaia-workbench");
    expect(pipeline.bindingsFor("module.annotations", "crud:annotation")).toEqual(["empaia-annotations"]);
});

test("an explicit operator binding outranks the claim @unit", () => {
    const pipeline = makePipeline({
        bindings: { annotations: { "crud:annotation": ["other-sink"] } },
    });
    pipeline.claimBinding("annotations", "crud:annotation", ["empaia-annotations"], "module.empaia-workbench");

    expect(pipeline.bindingsFor("module.annotations", "crud:annotation")).toEqual(["other-sink"]);
    // Still visible as claimed-but-overridden, so an operator can see what was
    // displaced rather than wondering why a module says it is connected.
    expect(pipeline.listBindingClaims()).toHaveLength(1);
});

test("a disabled capability silences the claim @unit", () => {
    const pipeline = makePipeline({
        disabledCapabilities: [["annotations", "crud:annotation"]],
    });
    pipeline.claimBinding("annotations", "crud:annotation", ["empaia-annotations"], "module.empaia-workbench");
    expect(pipeline.bindingsFor("module.annotations", "crud:annotation")).toEqual([]);
});

test("a claim outranks the owner's own include.json default @unit", () => {
    const pipeline = makePipeline();
    pipeline.applyIncludeBlock("module.annotations", {
        defaultBindings: { "crud:annotation": ["other-sink"] },
    });
    pipeline.claimBinding("annotations", "crud:annotation", ["empaia-annotations"], "module.empaia-workbench");
    expect(pipeline.bindingsFor("module.annotations", "crud:annotation")).toEqual(["empaia-annotations"]);
});

test("disposing a claim restores the previous resolution @unit", () => {
    const pipeline = makePipeline();
    const dispose = pipeline.claimBinding(
        "annotations", "crud:annotation", ["empaia-annotations"], "module.empaia-workbench");
    expect(pipeline.bindingsFor("module.annotations", "crud:annotation")).toEqual(["empaia-annotations"]);

    dispose();
    expect(pipeline.bindingsFor("module.annotations", "crud:annotation")).toEqual([]);
    expect(pipeline.listBindingClaims()).toEqual([]);
});

test("two claimants merge rather than one silently winning @unit", () => {
    const pipeline = makePipeline();
    pipeline.claimBinding("annotations", "crud:annotation", ["empaia-annotations"], "module.a");
    pipeline.claimBinding("annotations", "crud:annotation", ["other-sink"], "module.b");

    expect(pipeline.bindingsFor("module.annotations", "crud:annotation"))
        .toEqual(["empaia-annotations", "other-sink"]);
});

test("a claim naming an unregistered sink resolves to nothing, not to a fallback @unit", () => {
    const pipeline = makePipeline();
    pipeline.claimBinding("annotations", "bundle-export", ["no-such-sink"], "module.empaia-workbench");
    // Degrade closed: the claim was made, so the built-in bundle fallback does
    // NOT quietly send the payload somewhere the claimant did not ask for.
    expect(pipeline.bindingsFor("module.annotations", "bundle-export")).toEqual([]);
});

test("a malformed claim is ignored instead of poisoning resolution @unit", () => {
    const pipeline = makePipeline();
    const dispose = pipeline.claimBinding("annotations", "crud:annotation", [], "module.empaia-workbench");
    expect(pipeline.bindingsFor("module.annotations", "crud:annotation")).toEqual([]);
    expect(pipeline.listBindingClaims()).toEqual([]);
    expect(typeof dispose).toBe("function");
});
