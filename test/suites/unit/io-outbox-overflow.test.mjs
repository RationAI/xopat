/**
 * A change of any size must go through per-record IO whole.
 *
 * The persisted outbox is capped (`persistMaxEntries`), and the cap used to be
 * the producer's problem: past it an op was refused and reverted, so every bulk
 * producer had to pace itself or abort. These vectors pin the replacement:
 *   - the cap bounds what is *stored* at a time, not what is accepted — ops past
 *     it keep their place and are written as the head drains;
 *   - crash-recovery records are written in runs (one transaction per run), not
 *     one transaction per op in the producer's frame;
 *   - until the overflow is written, the resource says it holds unsaved work.
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
const { OutboxStore } = await import("../../../src/classes/io/outbox-store.ts");

const OWNER = "module.annotations";
const CAP = "crud:annotation";

/** In-memory stand-in for the IndexedDB store, counting transactions. */
function fakeStore() {
    const records = new Map();
    const store = {
        records, transactions: 0, maxSize: 0, writes: [],
        async addMany(entries) {
            store.transactions++;
            // One record that cannot be stored aborts the whole transaction.
            if (entries.some(e => e.serializedPayload?.unclonable)) throw new Error("could not be cloned");
            for (const e of entries) records.set(e.clientOpId, e);
            store.writes.push(entries.length);
            store.maxSize = Math.max(store.maxSize, records.size);
        },
        async removeMany(ids) { for (const id of ids) records.delete(id); },
        async update(id, patch) { const r = records.get(id); if (r) Object.assign(r, patch); },
        async bumpAttempt() {},
        async listForResource() { return []; },
        async pruneOlderThan() { return 0; },
        async count() { return records.size; },
    };
    return store;
}

function setup(sink, def = {}) {
    const store = fakeStore();
    OutboxStore.open = async () => store;
    const pipeline = new IOPipeline({
        POST_DATA: {},
        getConfig: () => ({ bindings: { annotations: { [CAP]: [sink.id] } } }),
        notify: () => {},
    });
    pipeline.registerOwner(OWNER, { ownerId: "annotations", xoType: "module" });
    pipeline.registerCapability(OWNER, { id: CAP, kind: "crud" });
    pipeline.registerSink(sink);
    const resource = new IOResourceImpl({
        ownerUid: OWNER, ownerId: "annotations", xoType: "module", pipeline,
        def: { name: "annotation", identityOf: (i) => String(i?.id ?? ""), persistOutbox: true, ...def },
    });
    return { store, pipeline, resource };
}

const tick = () => new Promise(r => setTimeout(r, 0));

test("2000 creates in one frame with a cap of 50: none refused, all stored in order, written in runs",
    { tag: ["@unit"] }, async () => {
        const stored = [];
        const { store, resource } = setup({
            id: "bulk", supports: ["crud"], maxBatch: 100,
            async createMany(_ctxs, items) { for (const it of items) stored.push(it.id); return items.map(() => ({ ok: true })); },
        }, { persistMaxEntries: 50, coalesce: true });
        await tick();

        let serialized = 0;
        resource.def.serialize = (item) => { serialized++; return { ...item }; };
        const ops = [];
        for (let i = 0; i < 2000; i++) ops.push(resource.create({ id: i }, { apply: () => {} }));
        // Nothing was serialized or written in the producer's frame.
        expect(serialized).toBe(0);
        expect(store.transactions).toBe(0);
        await Promise.resolve();
        await tick();
        // More is queued than may be stored: a reload now would lose the tail.
        expect(resource.hasUnsavedWork()).toBe(true);

        const results = await Promise.all(ops.map(o => o.settled));
        expect(results.every(r => r.ok)).toBe(true);
        expect(stored).toEqual(Array.from({ length: 2000 }, (_, i) => i));
        // The cap held for what was on disk at any time…
        expect(store.maxSize).toBeLessThanOrEqual(50);
        // …and records were written in runs, far fewer transactions than ops.
        expect(store.transactions).toBeLessThan(400);
        expect(Math.max(...store.writes)).toBeGreaterThan(1);
        await tick();
        await tick();
        expect(store.records.size).toBe(0);
        expect(resource.hasUnsavedWork()).toBe(false);
        expect(resource.headroom()).toBe(50);
    });

test("what is on disk while the queue is held is the oldest prefix, up to the cap",
    { tag: ["@unit"] }, async () => {
        let release;
        const gate = new Promise(r => { release = r; });
        const { store, resource } = setup({
            id: "slow", supports: ["crud"],
            async create() { await gate; return { ok: true }; },
        }, { persistMaxEntries: 5 });
        await tick();
        const ops = [];
        for (let i = 0; i < 20; i++) ops.push(resource.create({ id: i }, { apply: () => {} }));
        await tick();
        await tick();
        const onDisk = Array.from(store.records.values()).map(r => r.serializedPayload.id).sort((a, b) => a - b);
        expect(onDisk).toEqual([0, 1, 2, 3, 4]);
        expect(resource.hasUnsavedWork()).toBe(true);
        release();
        expect((await Promise.all(ops.map(o => o.settled))).every(r => r.ok)).toBe(true);
    });

test("one record that cannot be stored does not cost its neighbours theirs, nor anyone their dispatch",
    { tag: ["@unit"] }, async () => {
        let release;
        const gate = new Promise(r => { release = r; });
        const stored = [];
        const failed = [];
        const { store, pipeline, resource } = setup({
            id: "slow", supports: ["crud"],
            async create(_ctx, item) { await gate; stored.push(item.id); return { ok: true }; },
        }, { persistMaxEntries: 100 });
        pipeline.addHandler("io:outbox-write-failed", e => failed.push(e));
        await tick();
        const ops = [];
        for (let i = 0; i < 6; i++) ops.push(resource.create({ id: i, unclonable: i === 3 }, { apply: () => {} }));
        await tick();
        await tick();
        const onDisk = Array.from(store.records.values()).map(r => r.serializedPayload.id).sort((a, b) => a - b);
        expect(onDisk).toEqual([0, 1, 2, 4, 5]);
        release();
        expect((await Promise.all(ops.map(o => o.settled))).every(r => r.ok)).toBe(true);
        expect(stored).toEqual([0, 1, 2, 3, 4, 5]);
        expect(failed).toHaveLength(1);
    });

test("ops still waiting past the cap coalesce like any unstarted op, and leave no record behind",
    { tag: ["@unit"] }, async () => {
        let release;
        const gate = new Promise(r => { release = r; });
        const stored = [];
        const { store, resource } = setup({
            id: "slow", supports: ["crud"],
            async create(_ctx, item) { await gate; stored.push(item.id); return { ok: true }; },
            async delete(ctx) { stored.push("-" + ctx.itemId); return { ok: true }; },
        }, { persistMaxEntries: 2, coalesce: true });
        await tick();
        const ops = [];
        for (let i = 0; i < 6; i++) ops.push(resource.create({ id: i }, { apply: () => {} }));
        await tick();
        // 4 and 5 are past the cap and unstarted: creating then deleting 5 cancels out.
        ops.push(resource.delete("5", { apply: () => {} }));
        await tick();
        release();
        await Promise.all(ops.map(o => o.settled));
        expect(stored).toEqual([0, 1, 2, 3, 4]);
        await tick();
        await tick();
        expect(store.records.size).toBe(0);
        expect(resource.hasUnsavedWork()).toBe(false);
    });

test("without a store the queue is memory-only and nothing waits for a record",
    { tag: ["@unit"] }, async () => {
        const stored = [];
        OutboxStore.open = async () => null;
        const pipeline = new IOPipeline({
            POST_DATA: {},
            getConfig: () => ({ bindings: { annotations: { [CAP]: ["plain"] } } }),
            notify: () => {},
        });
        pipeline.registerOwner(OWNER, { ownerId: "annotations", xoType: "module" });
        pipeline.registerCapability(OWNER, { id: CAP, kind: "crud" });
        pipeline.registerSink({ id: "plain", supports: ["crud"], async create(_c, item) { stored.push(item.id); return { ok: true }; } });
        const resource = new IOResourceImpl({
            ownerUid: OWNER, ownerId: "annotations", xoType: "module", pipeline,
            def: { name: "annotation", identityOf: (i) => String(i?.id ?? ""), persistOutbox: true, persistMaxEntries: 3 },
        });
        await tick();
        const ops = [];
        for (let i = 0; i < 30; i++) ops.push(resource.create({ id: i }, { apply: () => {} }));
        expect((await Promise.all(ops.map(o => o.settled))).every(r => r.ok)).toBe(true);
        expect(stored).toHaveLength(30);
    });
