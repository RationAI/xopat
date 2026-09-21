/**
 * A sink is allowed to arrive late.
 *
 * An integration that must finish a handshake before it can serve anything
 * registers its sink seconds after boot, while the operator's
 * `ENV.client.io.bindings` entry naming it exists from the first frame. The
 * pipeline used to read that window as a misconfiguration: it told the *user*
 * "data is being discarded", and — because it reported the missing sink under a
 * key indistinguishable from the real sink's — it then swallowed the genuine
 * mismatch report once that sink appeared.
 *
 * Worse than the noise: `dispatch` answered `{ok: true}` for a configured binding
 * that resolved to nothing, so a write in that window was reported as stored and
 * lost. These vectors pin the distinction the whole mechanism rests on — nothing
 * bound (inert, normal) versus bound-but-not-here-yet (hold, never discard).
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
const { IOResourceImpl } = await import("../../../src/classes/io/io-resource.ts");

const BINDINGS = {
    bindings: { annotations: { "crud:annotation": ["late-sink"] } },
};

function makePipeline(notify = () => {}) {
    const pipeline = new IOPipeline({ POST_DATA: {}, getConfig: () => BINDINGS, notify });
    pipeline.registerOwner("module.annotations", { ownerId: "annotations", xoType: "module" });
    pipeline.registerCapability("module.annotations", { id: "crud:annotation", kind: "crud" });
    return pipeline;
}

function makeResource(pipeline) {
    return new IOResourceImpl({
        ownerUid: "module.annotations",
        ownerId: "annotations",
        xoType: "module",
        pipeline,
        def: { name: "annotation", identityOf: (i) => String(i?.id ?? ""), persistOutbox: false },
    });
}

const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

test("a binding naming an absent sink is pending, not invalid", { tag: ["@unit"] }, async () => {
    const toasts = [];
    const pipeline = makePipeline((m, level) => toasts.push({ m, level }));

    expect(pipeline.bindingsFor("module.annotations", "crud:annotation")).toEqual([]);
    expect(pipeline.bindingsPending("module.annotations", "crud:annotation")).toBe(true);
    // The end user can do nothing about a deployment binding, and at boot the
    // claim was not even true — nothing was being discarded.
    expect(toasts).toEqual([]);
});

test("an unbound capability stays inert — pending is not the same as unconfigured",
    { tag: ["@unit"] }, async () => {
        const pipeline = new IOPipeline({ POST_DATA: {}, getConfig: () => ({}), notify: () => {} });
        pipeline.registerOwner("module.other", { ownerId: "other", xoType: "module" });
        pipeline.registerCapability("module.other", { id: "crud:thing", kind: "crud" });

        expect(pipeline.bindingsPending("module.other", "crud:thing")).toBe(false);
        const r = await pipeline.dispatch({
            direction: "create", capabilityId: "crud:thing", xoType: "module",
            ownerUid: "module.other", ownerId: "other", resourceName: "thing", key: "", meta: {},
        }, { id: "x" });
        expect(r.ok).toBe(true);
    });

test("the queue holds while the sink is missing, and moves when it registers",
    { tag: ["@unit"] }, async () => {
        const pipeline = makePipeline();
        const resource = makeResource(pipeline);

        const stalls = [];
        pipeline.addHandler("io:queue-stalled", (e) => stalls.push(e));

        const stored = [];
        const op = resource.create({ id: "a1" }, { apply: () => {} });
        await settle();

        // Held: not dispatched, not settled, and above all not rolled back.
        expect(op.ok).toBe(true);
        expect(stored).toEqual([]);
        expect(stalls.length).toBe(1);
        expect(stalls[0].pending).toBe(1);

        // The handshake completes.
        pipeline.registerSink({
            id: "late-sink",
            supports: ["crud"],
            async create(ctx, item) { stored.push(item); return { ok: true, payload: { id: "srv-1" } }; },
        });
        const settled = await op.settled;

        expect(settled.ok).toBe(true);
        expect(stored).toEqual([{ id: "a1" }]);
        expect(pipeline.bindingsPending("module.annotations", "crud:annotation")).toBe(false);
    });

test("flush answers instead of blocking on a held queue", { tag: ["@unit"] }, async () => {
    const pipeline = makePipeline();
    const resource = makeResource(pipeline);

    resource.create({ id: "a1" }, { apply: () => {} });
    await settle();

    // `flushAllResources` sits behind the user's Save button with a spinner; an
    // entry that may never settle must not be awaited there.
    const results = await resource.flush();
    expect(results.length).toBe(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].code).toBe("W_IO_SINK_NOT_READY");
    // ...and the work is still queued, not dropped.
    expect(pipeline.bindingsPending("module.annotations", "crud:annotation")).toBe(true);
});

test("the missing-sink report does not mask a real mismatch for the same sink",
    { tag: ["@unit"] }, async () => {
        const pipeline = makePipeline();
        const reported = [];
        pipeline.addHandler("io:invalid-binding", (e) => reported.push(e));

        // Force the "nothing registered" verdict the way a dispatch would.
        await pipeline.dispatch({
            direction: "create", capabilityId: "crud:annotation", xoType: "module",
            ownerUid: "module.annotations", ownerId: "annotations",
            resourceName: "annotation", key: "", meta: {},
        }, { id: "x" });
        expect(reported.length).toBe(1);
        expect(reported[0].sinkId).toBe("*");

        // Now the sink arrives — but it only serves a different owner, which IS a
        // genuine misconfiguration. Keyed by the real sink id, it must still be
        // reported; before this it collided with the report above and was dropped.
        pipeline.registerSink({
            id: "late-sink",
            supports: { kinds: ["crud"], owners: ["somebody-else"] },
            async create() { return { ok: true }; },
        });
        pipeline.validateBindings();

        const real = reported.filter(e => e.sinkId === "late-sink");
        expect(real.length).toBe(1);
        expect(real[0].capabilityId).toBe("crud:annotation");
    });
