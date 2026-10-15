/**
 * A sink can be unplugged — by the operator, or by a session the operator let in.
 *
 * `ENV.client.io.bindings` is server-rendered and immutable at runtime, so until
 * now "do not push this run to MLflow" was inexpressible: the only switch was to
 * remove the binding and redeploy. The toggle closes that, and the trust split is
 * the whole point — `enabled` is the operator's baseline and
 * `sessionControllable` is the operator saying a session may change it. Omitting
 * the block is therefore a hard pin, which is what these vectors protect.
 *
 * The second half pins the subtler half: a disabled sink is **unplugged, not
 * missing**. A sink that has not registered *yet* parks its (owner, capability) in
 * `pendingBindings` and makes dispatch refuse with `W_IO_SINK_NOT_READY` so no
 * write is lost while it arrives. Reusing that path for a sink switched off on
 * purpose would hold data for a destination nobody expects to answer — so the
 * sink is dropped from the binding instead.
 *
 * The other extreme is just as wrong: an emptied list must not RESUME the rule
 * cascade, which re-activates a binding the disabled rule had overridden and
 * turns an off switch into a redirect. Only a `bundle` continues, and only as far
 * as the built-in local sinks.
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
globalThis.$ = globalThis.$ ?? { t: (key) => String(key).split(".").pop() };

const { IOPipeline } = await import("../../../src/classes/io/io-pipeline.ts");

/**
 * One owner with a crud and a bundle capability, both bound to `mlflow` only,
 * plus the built-in local sinks so the fallback is reachable.
 */
function makePipeline(config = {}, sessionSinks = undefined) {
    const warnings = [];
    const pipeline = new IOPipeline({
        POST_DATA: {},
        getConfig: () => config,
        getSessionSinks: () => sessionSinks,
        notify: (m, l) => warnings.push([l, m]),
    });
    pipeline.registerOwner("plugin.slide-scoring", {
        ownerId: "slide-scoring", xoType: "plugin", bundleScope: "per-viewer-background",
    });
    pipeline.registerCapability("plugin.slide-scoring", { id: "crud:score", kind: "crud" });
    pipeline.registerCapability("plugin.slide-scoring", { id: "bundle-export", kind: "bundle" });
    for (const id of ["mlflow", "other-sink", "post-data", "session-memory"]) {
        pipeline.registerSink({ id, supports: ["crud", "bundle"], async create() { return { ok: true }; } });
    }
    pipeline.notified = warnings;
    return pipeline;
}

const bound = (overrides = {}) => ({
    bindings: {
        "slide-scoring": {
            "crud:score": ["mlflow"],
            "bundle-export": ["mlflow"],
        },
    },
    ...overrides,
});

// ── the operator's baseline ─────────────────────────────────────────────────

test("with no sinks block every sink is plugged in, and routing is unchanged @unit", () => {
    const pipeline = makePipeline(bound());
    expect(pipeline.isSinkEnabled("mlflow")).toBe(true);
    expect(pipeline.isSinkEnabled("anything-at-all")).toBe(true);
    expect(pipeline.bindingsFor("plugin.slide-scoring", "crud:score")).toEqual(["mlflow"]);
});

test("the operator can switch a sink off, and nothing else moves @unit", () => {
    const pipeline = makePipeline(bound({ sinks: { mlflow: { enabled: false } } }));
    expect(pipeline.isSinkEnabled("mlflow")).toBe(false);
    expect(pipeline.isSinkEnabled("other-sink")).toBe(true);
});

// ── who may change it ───────────────────────────────────────────────────────

test("a session cannot unplug a sink the deployment did not open up @unit", () => {
    // The hard pin: `sessionControllable` absent.
    const pipeline = makePipeline(bound({ sinks: { mlflow: { enabled: true } } }), { mlflow: false });
    expect(pipeline.isSinkEnabled("mlflow"), "the session value is not even read").toBe(true);
    expect(pipeline.setSinkEnabled("mlflow", false), "and the runtime call is refused").toBe(false);
    expect(pipeline.isSinkEnabled("mlflow")).toBe(true);
    expect(pipeline.bindingsFor("plugin.slide-scoring", "crud:score")).toEqual(["mlflow"]);
});

test("a session can unplug a sink the deployment opened up @unit", () => {
    const config = bound({ sinks: { mlflow: { enabled: true, sessionControllable: true } } });
    const pipeline = makePipeline(config, { mlflow: false });
    expect(pipeline.isSinkEnabled("mlflow")).toBe(false);
});

test("a session can plug one in that the deployment shipped off @unit", () => {
    const config = bound({ sinks: { mlflow: { enabled: false, sessionControllable: true } } });
    const pipeline = makePipeline(config, { mlflow: true });
    expect(pipeline.isSinkEnabled("mlflow")).toBe(true);
    expect(pipeline.bindingsFor("plugin.slide-scoring", "crud:score")).toEqual(["mlflow"]);
});

test("only real booleans are read out of the session value @unit", () => {
    const config = bound({ sinks: { mlflow: { enabled: true, sessionControllable: true } } });
    // A hand-written URL or a hostile bundle can put anything here. A string
    // "false" must not read as `false` (nor as `true`) — it says nothing.
    for (const value of ["false", "true", 0, 1, null, {}, []]) {
        expect(makePipeline(config, { mlflow: value }).isSinkEnabled("mlflow"), String(value)).toBe(true);
    }
    expect(makePipeline(config, "not an object").isSinkEnabled("mlflow")).toBe(true);
    expect(makePipeline(config, '{"mlflow": false}'), "a JSON string is still accepted").toBeTruthy();
    expect(makePipeline(config, '{"mlflow": false}').isSinkEnabled("mlflow")).toBe(false);
});

test("the runtime toggle wins over the session seed, both ways @unit", () => {
    const config = bound({ sinks: { mlflow: { enabled: true, sessionControllable: true } } });
    const pipeline = makePipeline(config, { mlflow: false });
    expect(pipeline.isSinkEnabled("mlflow")).toBe(false);
    expect(pipeline.setSinkEnabled("mlflow", true)).toBe(true);
    expect(pipeline.isSinkEnabled("mlflow"), "the seed is read once; this map is the state").toBe(true);
    expect(pipeline.setSinkEnabled("mlflow", false)).toBe(true);
    expect(pipeline.isSinkEnabled("mlflow")).toBe(false);
});

// ── unplugged, not missing ──────────────────────────────────────────────────

test("a bundle bound only to a disabled sink falls back to the local sinks @unit", () => {
    const pipeline = makePipeline(bound({ sinks: { mlflow: { enabled: false } } }));

    expect(
        pipeline.bindingsFor("plugin.slide-scoring", "bundle-export"),
        "resolution continued past the binding, as if it had never named mlflow",
    ).toEqual(["session-memory", "post-data"]);
    expect(
        pipeline.bindingsPending("plugin.slide-scoring", "bundle-export"),
        "and nothing is held: a switched-off sink is not a sink on its way",
    ).toBe(false);
});

test("a disabled sink does not make dispatch refuse @unit", async () => {
    const pipeline = makePipeline(bound({ sinks: { mlflow: { enabled: false } } }));

    // crud has no built-in fallback, so this capability ends up with nowhere to
    // write — which is inert by design, NOT the W_IO_SINK_NOT_READY refusal an
    // unregistered sink produces.
    expect(pipeline.bindingsFor("plugin.slide-scoring", "crud:score")).toEqual([]);
    expect(pipeline.bindingsPending("plugin.slide-scoring", "crud:score")).toBe(false);
    expect(pipeline.isEnabled("plugin.slide-scoring", "crud:score")).toBe(false);
});

test("an UNREGISTERED sink still holds writes — the case this must not break @unit", () => {
    const pipeline = makePipeline({
        bindings: { "slide-scoring": { "crud:score": ["not-here-yet"] } },
    });
    expect(pipeline.bindingsFor("plugin.slide-scoring", "crud:score")).toEqual([]);
    expect(
        pipeline.bindingsPending("plugin.slide-scoring", "crud:score"),
        "a late sink must not lose its writes to a fallback",
    ).toBe(true);
});

test("a disabled sink is dropped while its live neighbours still resolve @unit", () => {
    const pipeline = makePipeline({
        sinks: { mlflow: { enabled: false } },
        bindings: { "slide-scoring": { "crud:score": ["mlflow", "other-sink"] } },
    });
    expect(pipeline.bindingsFor("plugin.slide-scoring", "crud:score")).toEqual(["other-sink"]);
});

test("re-plugging restores the route and says writes may move again @unit", () => {
    const config = bound({ sinks: { mlflow: { enabled: false, sessionControllable: true } } });
    const pipeline = makePipeline(config);
    expect(pipeline.bindingsFor("plugin.slide-scoring", "crud:score")).toEqual([]);

    const seen = [];
    for (const ev of ["io:sink-enabled", "io:sink-disabled", "io:sink-registered"]) {
        pipeline.addHandler(ev, (e) => seen.push([ev, e?.sinkId]));
    }

    expect(pipeline.setSinkEnabled("mlflow", true)).toBe(true);
    expect(pipeline.bindingsFor("plugin.slide-scoring", "crud:score"),
        "the binding cache was invalidated by the toggle").toEqual(["mlflow"]);
    expect(seen).toEqual([["io:sink-enabled", "mlflow"], ["io:sink-registered", "mlflow"]]);

    seen.length = 0;
    pipeline.setSinkEnabled("mlflow", false);
    expect(pipeline.bindingsFor("plugin.slide-scoring", "crud:score")).toEqual([]);
    expect(seen, "unplugging announces itself but never the resume event")
        .toEqual([["io:sink-disabled", "mlflow"]]);
});

test("a no-op toggle is allowed and silent @unit", () => {
    const config = bound({ sinks: { mlflow: { enabled: true, sessionControllable: true } } });
    const pipeline = makePipeline(config);
    const seen = [];
    pipeline.addHandler("io:sink-enabled", () => seen.push("enabled"));

    expect(pipeline.setSinkEnabled("mlflow", true)).toBe(true);
    expect(seen).toEqual([]);
});

test("the built-in local sinks obey the switch as well @unit", () => {
    const pipeline = makePipeline({ sinks: { "session-memory": { enabled: false } } });
    expect(
        pipeline.bindingsFor("plugin.slide-scoring", "bundle-export"),
        "nothing bound this capability, so Rule 5 answers — minus the disabled sink",
    ).toEqual(["post-data"]);
    expect(
        makePipeline({ sinks: { "post-data": { enabled: false } } })
            .bindingsFor("plugin.slide-scoring", "bundle-export"),
    ).toEqual(["session-memory"]);
});

// ── unplugging never REDIRECTS ──────────────────────────────────────────────
//
// The subtle half of "unplugged, not missing": the cascade must not resume. A
// lower-precedence rule holds a binding the disabled one overrode, so resuming
// re-activates it — switching the operator's `crud:score` sink off used to bring
// the owner's own include.json default back to life. With `sessionControllable`
// that means a session toggle MOVES the data instead of stopping it, which is
// exactly what src/config.json promises it cannot do.

test("a disabled crud sink resolves to nothing, not to the include.json default @unit @security", () => {
    const pipeline = makePipeline(bound({
        sinks: { mlflow: { enabled: true, sessionControllable: true } },
    }), { mlflow: false });
    pipeline.applyIncludeBlock("plugin.slide-scoring", {
        defaultBindings: { "crud:score": ["other-sink"] },
    });

    expect(pipeline.isSinkEnabled("mlflow")).toBe(false);
    expect(
        pipeline.bindingsFor("plugin.slide-scoring", "crud:score"),
        "the owner's default must not come back to life under the operator's override",
    ).toEqual([]);
    expect(pipeline.bindingsPending("plugin.slide-scoring", "crud:score")).toBe(false);

    // ...and plugging it back in restores the operator's route, not the default.
    expect(pipeline.setSinkEnabled("mlflow", true)).toBe(true);
    expect(pipeline.bindingsFor("plugin.slide-scoring", "crud:score")).toEqual(["mlflow"]);
});

test("an owner's OWN disabled default resolves to nothing either @unit", () => {
    const pipeline = makePipeline({ sinks: { mlflow: { enabled: false } } });
    pipeline.applyIncludeBlock("plugin.slide-scoring", {
        defaultBindings: { "crud:score": ["mlflow"] },
    });
    expect(pipeline.bindingsFor("plugin.slide-scoring", "crud:score")).toEqual([]);
});

test("a bundle still reaches the local sinks past an include.json default @unit", () => {
    // The one capability allowed to continue, and only as far as Rule 5: "do not
    // upload, but let me keep a file" has to stay expressible.
    const pipeline = makePipeline(bound({ sinks: { mlflow: { enabled: false } } }));
    pipeline.applyIncludeBlock("plugin.slide-scoring", {
        defaultBindings: { "bundle-export": ["other-sink"] },
    });
    expect(
        pipeline.bindingsFor("plugin.slide-scoring", "bundle-export"),
        "not `other-sink` — a disabled destination picks no replacement",
    ).toEqual(["session-memory", "post-data"]);
});
