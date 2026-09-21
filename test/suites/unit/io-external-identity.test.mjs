/**
 * A sink has to be able to say *which of its own records* a dispatch is about.
 *
 * The obvious answer — keep a map from the owner's local id to the remote id —
 * fails for exactly the data that matters most: anything restored on a reload,
 * because the local id is a per-session counter and nothing wrote those records
 * this session. The obvious repair — look the object up on the canvas when asked
 * — cannot work either, and that is the subtle part these vectors pin: the
 * pipeline runs `apply()` synchronously and dispatches a microtask later, so by
 * the time the sink is asked about a deleted item, the owner has already detached
 * it. `ctx.meta` is the only thing that still holds it.
 *
 * The second vector characterizes the restore guard around a late sink: hydrating
 * once per (owner, viewer, background) is right, and a binding whose sink has not
 * registered yet must not burn that one chance. (It does not today, because such
 * a binding resolves to no sinks at all and nothing is attempted — this pins that
 * property so a future change to the empty-read accounting cannot quietly lose
 * it. The related gap where a *registered* sink answers empty and a better one is
 * bound afterwards is documented in `runOneRestore`, not fixed: re-arming would
 * wipe whatever the user drew in the meantime.)
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

const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

test("the sink can still identify an item its owner already detached", { tag: ["@unit"] }, async () => {
    const seen = [];
    const pipeline = new IOPipeline({
        POST_DATA: {},
        getConfig: () => ({ bindings: { things: { "crud:thing": ["remote"] } } }),
        notify: () => {},
    });
    pipeline.registerOwner("module.things", { ownerId: "things", xoType: "module" });
    pipeline.registerCapability("module.things", { id: "crud:thing", kind: "crud" });
    pipeline.registerSink({
        id: "remote",
        supports: ["crud"],
        async delete(ctx) {
            // What a real sink does: read its own foreign key off the object the
            // dispatch carries.
            seen.push(ctx?.meta?.object?.remoteId);
            return { ok: true };
        },
    });

    const resource = new IOResourceImpl({
        ownerUid: "module.things", ownerId: "things", xoType: "module", pipeline,
        def: { name: "thing", identityOf: (i) => String(i?.localId ?? ""), persistOutbox: false },
    });

    // The owner's world, and an item restored into it (no create ever ran, so
    // nothing could have registered its remote id anywhere).
    const canvas = new Map();
    const restored = { localId: 7, remoteId: "srv-abc" };
    canvas.set(7, restored);

    const op = resource.delete(7, {
        // Synchronous, exactly like the annotations module: by the time the sink
        // runs, `canvas` no longer holds the item.
        apply: () => { canvas.delete(7); },
        inverseApply: () => { canvas.set(7, restored); },
        meta: { kind: "delete", object: restored },
    });
    expect(canvas.has(7)).toBe(false);

    const result = await op.settled;
    await settle();

    expect(result.ok).toBe(true);
    expect(seen).toEqual(["srv-abc"]);
});

test("a binding whose sink has not registered yet does not burn the one hydration",
    { tag: ["@unit"] }, async () => {
        const imported = [];
        const pipeline = new IOPipeline({
            POST_DATA: {},
            getConfig: () => ({ bindings: { things: { "bundle-import": ["late"] } } }),
            notify: () => {},
        });
        pipeline.registerOwner("module.things", {
            ownerId: "things",
            xoType: "module",
            bundleScope: "per-viewer-background",
            importBundle: async (ctx, data) => { imported.push(data); },
        });

        // The configured sink is not registered yet, so this restore is answered
        // by nobody.
        await pipeline.tryRestoreImport({ viewerId: "osd-0", backgroundId: "bg-1" });
        expect(imported).toEqual([]);

        // It arrives, and the same (viewer, background) must still be hydratable —
        // before this, the first empty answer claimed the slot for the session.
        pipeline.registerSink({
            id: "late",
            supports: ["bundle"],
            async readBundle() { return { ok: true, payload: { items: ["a", "b"] } }; },
        });

        await pipeline.tryRestoreImport({ viewerId: "osd-0", backgroundId: "bg-1" });
        expect(imported).toEqual([{ items: ["a", "b"] }]);

        // And it stays a once-per-slide guard for everything after that.
        await pipeline.tryRestoreImport({ viewerId: "osd-0", backgroundId: "bg-1" });
        expect(imported.length).toBe(1);
    });
