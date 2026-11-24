/**
 * A bulk producer (a scripted batch, a file import, "delete all") issues ops far
 * faster than a destination stores them one call at a time. The outbox then hit
 * its cap, refused the rest of the batch and reverted it — with one identical
 * dialog per refused op.
 *
 * These vectors pin the three things that stop that:
 *   - a sink offering `createMany` / `deleteMany` receives a run of ops per call,
 *     and each op still succeeds or is refused on its own;
 *   - a sink that does not is called exactly as before;
 *   - a producer can wait for room (`whenHeadroom`) instead of overflowing, and
 *     an overflow says so once, not once per op.
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

const OWNER = "module.annotations";
const CAP = "crud:annotation";

function makePipeline(sinks, notify = () => {}) {
    const pipeline = new IOPipeline({
        POST_DATA: {},
        getConfig: () => ({ bindings: { annotations: { [CAP]: sinks.map(s => s.id) } } }),
        notify,
    });
    pipeline.registerOwner(OWNER, { ownerId: "annotations", xoType: "module" });
    pipeline.registerCapability(OWNER, { id: CAP, kind: "crud" });
    for (const sink of sinks) pipeline.registerSink(sink);
    return pipeline;
}

function makeResource(pipeline, def = {}) {
    return new IOResourceImpl({
        ownerUid: OWNER, ownerId: "annotations", xoType: "module", pipeline,
        def: { name: "annotation", identityOf: (i) => String(i?.id ?? ""), persistOutbox: false, ...def },
    });
}

const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const tick = () => new Promise(r => setTimeout(r, 0));

test("a bulk-capable sink gets runs of creates, in order, with per-item results",
    { tag: ["@unit"] }, async () => {
        const calls = [];
        const pipeline = makePipeline([{
            id: "bulk", supports: ["crud"], maxBatch: 40,
            async create() { throw new Error("the per-item route must not be used"); },
            async createMany(ctxs, items) {
                calls.push(items.map(i => i.id));
                return items.map(i => ({ ok: true, payload: { id: `srv-${i.id}` } }));
            },
        }]);
        const resource = makeResource(pipeline);

        const ops = [];
        for (let i = 0; i < 100; i++) ops.push(resource.create({ id: i }, { apply: () => {} }));
        const settled = await Promise.all(ops.map(o => o.settled));

        expect(calls.map(c => c.length)).toEqual([40, 40, 20]);
        expect(calls.flat()).toEqual(Array.from({ length: 100 }, (_, i) => i));
        expect(settled.map(r => r.payload.id)).toEqual(Array.from({ length: 100 }, (_, i) => `srv-${i}`));
    });

test("one item refused inside a batch reverts that item only, with one dialog",
    { tag: ["@unit"] }, async () => {
        const toasts = [];
        const refusedEvents = [];
        const pipeline = makePipeline([{
            id: "bulk", supports: ["crud"],
            async createMany(ctxs, items) {
                return items.map(i => i.id % 2
                    ? { ok: false, refused: true, reason: "odd", code: "W_TEST", userMessage: "odd ones are refused" }
                    : { ok: true });
            },
        }], (m) => toasts.push(m));
        pipeline.addHandler("io:refused", (e) => refusedEvents.push(e));
        const resource = makeResource(pipeline);

        const world = new Set();
        const ops = [];
        for (let i = 0; i < 10; i++) {
            ops.push(resource.create({ id: i }, {
                apply: () => world.add(i), inverseApply: () => world.delete(i), skipHistory: true,
            }));
        }
        const settled = await Promise.all(ops.map(o => o.settled));
        await settle();

        expect(settled.map(r => r.ok)).toEqual([true, false, true, false, true, false, true, false, true, false]);
        expect([...world]).toEqual([0, 2, 4, 6, 8]);
        // Every refusal is an event; the user is told once.
        expect(refusedEvents.length).toBe(5);
        expect(toasts).toEqual(["odd ones are refused"]);
    });

test("a sink without bulk methods is called per item, as before", { tag: ["@unit"] }, async () => {
    const stored = [];
    const pipeline = makePipeline([{
        id: "plain", supports: ["crud"],
        async create(ctx, item) { stored.push(item.id); return { ok: true }; },
        async delete(ctx) { stored.push(`-${ctx.itemId}`); return { ok: true }; },
    }]);
    expect(pipeline.batchLimit(OWNER, CAP, "create")).toBe(1);
    const resource = makeResource(pipeline);

    const ops = [0, 1, 2].map(id => resource.create({ id }, { apply: () => {} }));
    ops.push(resource.delete("9", { apply: () => {} }));
    await Promise.all(ops.map(o => o.settled));
    expect(stored).toEqual([0, 1, 2, "-9"]);
});

test("a batch stops at a direction change and a mixed binding still serves every sink",
    { tag: ["@unit"] }, async () => {
        const bulk = [];
        const plain = [];
        const pipeline = makePipeline([
            {
                id: "bulk", supports: ["crud"],
                async createMany(ctxs, items) { bulk.push(`c${items.length}`); return items.map(() => ({ ok: true })); },
                async deleteMany(ctxs) { bulk.push(`d${ctxs.length}`); return ctxs.map(() => ({ ok: true })); },
            },
            {
                id: "plain", supports: ["crud"],
                async create(ctx, item) { plain.push(`c:${item.id}`); return { ok: true }; },
                async delete(ctx) { plain.push(`d:${ctx.itemId}`); return { ok: true }; },
            },
        ]);
        const resource = makeResource(pipeline);

        const ops = [
            resource.create({ id: "a" }, { apply: () => {} }),
            resource.create({ id: "b" }, { apply: () => {} }),
            resource.delete("x", { apply: () => {} }),
            resource.delete("y", { apply: () => {} }),
            resource.create({ id: "c" }, { apply: () => {} }),
        ];
        await Promise.all(ops.map(o => o.settled));

        // The lone trailing create is a batch of one for the bulk-only sink —
        // not an unsupported operation it silently never receives.
        expect(bulk).toEqual(["c2", "d2", "c1"]);
        expect(plain).toEqual(["c:a", "c:b", "d:x", "d:y", "c:c"]);
    });

test("a bulk-only sink serves a single op as a batch of one", { tag: ["@unit"] }, async () => {
    const calls = [];
    const pipeline = makePipeline([{
        id: "bulk", supports: ["crud"],
        async createMany(ctxs, items) { calls.push(items.map(i => i.id)); return items.map(i => ({ ok: true, payload: { id: `srv-${i.id}` } })); },
    }]);
    const resource = makeResource(pipeline);

    const r = await resource.create({ id: "only" }, { apply: () => {} }).settled;
    expect(calls).toEqual([["only"]]);
    expect(r.ok).toBe(true);
    expect(r.payload.id).toBe("srv-only");
});

for (const [label, answer] of [
    ["nothing", () => undefined],
    ["a short array", (items) => items.slice(0, 2).map(() => ({ ok: true }))],
    ["something that is not an array", () => ({ ok: true })],
    ["holes and bare booleans", (items) => items.map((_, k) => (k < 2 ? { ok: true } : true))],
]) {
    test(`a bulk sink answering ${label} does not get its unanswered items recorded as stored`,
        { tag: ["@unit"] }, async () => {
            const pipeline = makePipeline([{
                id: "bulk", supports: ["crud"],
                async createMany(ctxs, items) { return answer(items); },
            }]);
            const resource = makeResource(pipeline);

            const world = new Set();
            const ops = [];
            for (let i = 0; i < 5; i++) {
                ops.push(resource.create({ id: i }, {
                    apply: () => world.add(i), inverseApply: () => world.delete(i), skipHistory: true,
                }));
            }
            const settled = await Promise.all(ops.map(o => o.settled));
            await settle();

            const answered = label === "a short array" || label === "holes and bare booleans" ? 2 : 0;
            expect(settled.map(r => r.ok)).toEqual([0, 1, 2, 3, 4].map(i => i < answered));
            expect(settled.slice(answered).every(r => r.code === "W_IO_BULK_RESULT")).toBe(true);
            // Reverted locally: what the destination never confirmed is not kept.
            expect([...world]).toEqual([0, 1, 2, 3, 4].filter(i => i < answered));
        });
}

test("a refusal nobody was shown does not use up the dialog a user's op is owed",
    { tag: ["@unit"] }, async () => {
        const toasts = [];
        const pipeline = makePipeline([{
            id: "bulk", supports: ["crud"],
            async createMany(ctxs) {
                return ctxs.map(() => ({ ok: false, refused: true, reason: "no", code: "W_TEST", userMessage: "refused" }));
            },
        }], (m) => toasts.push(m));

        const ctx = (trigger, id) => ({
            direction: "create", capabilityId: CAP, xoType: "module", ownerUid: OWNER, ownerId: "annotations",
            resourceName: "annotation", key: "", itemId: id, trigger, meta: {},
        });
        await pipeline.dispatchMany([ctx("system", "a"), ctx("user", "b"), ctx("user", "c")], [{}, {}, {}]);
        expect(toasts).toEqual(["refused"]);
    });

test("a full outbox refuses per op but speaks once, and whenHeadroom waits for the drain",
    { tag: ["@unit"] }, async () => {
        const toasts = [];
        const full = [];
        let release;
        const gate = new Promise(r => { release = r; });
        const pipeline = makePipeline([{
            id: "slow", supports: ["crud"],
            async create() { await gate; return { ok: true }; },
        }], (m) => toasts.push(m));
        pipeline.addHandler("io:outbox-full", (e) => full.push(e));
        const resource = makeResource(pipeline, { persistOutbox: true, persistMaxEntries: 5 });
        await tick();

        expect(resource.headroom()).toBe(5);
        const ops = [];
        for (let i = 0; i < 9; i++) ops.push(resource.create({ id: i }, { apply: () => {} }));
        await tick();

        const refused = (await Promise.all(ops.slice(5).map(o => o.settled))).map(r => r.code);
        expect(refused).toEqual(Array(4).fill("W_IO_OUTBOX_FULL"));
        expect(full.length).toBe(4);
        expect(toasts.length).toBe(1);
        expect(resource.headroom()).toBe(0);

        let roomy = false;
        const waiting = resource.whenHeadroom(3).then(ok => { roomy = ok; });
        await tick();
        expect(roomy).toBe(false);

        release();
        await waiting;
        expect(roomy).toBe(true);
        expect(resource.headroom()).toBeGreaterThanOrEqual(3);
    });

test("whenHeadroom answers false instead of hanging when the queue is held",
    { tag: ["@unit"] }, async () => {
        // Bound to a sink that never registers: the queue holds.
        const pipeline = new IOPipeline({
            POST_DATA: {},
            getConfig: () => ({ bindings: { annotations: { [CAP]: ["absent"] } } }),
            notify: () => {},
        });
        pipeline.registerOwner(OWNER, { ownerId: "annotations", xoType: "module" });
        pipeline.registerCapability(OWNER, { id: CAP, kind: "crud" });
        const resource = makeResource(pipeline, { persistOutbox: true, persistMaxEntries: 3 });
        await tick();

        for (let i = 0; i < 3; i++) resource.create({ id: i }, { apply: () => {} });
        await tick();
        expect(await resource.whenHeadroom(1)).toBe(false);
    });

test("nothing bound means nothing is owed: the cap does not limit local edits",
    { tag: ["@unit"] }, async () => {
        const pipeline = new IOPipeline({ POST_DATA: {}, getConfig: () => ({}), notify: () => {} });
        pipeline.registerOwner(OWNER, { ownerId: "annotations", xoType: "module" });
        pipeline.registerCapability(OWNER, { id: CAP, kind: "crud" });
        const resource = makeResource(pipeline, { persistOutbox: true, persistMaxEntries: 3 });
        await tick();

        expect(resource.headroom()).toBe(Infinity);
        const ops = [];
        for (let i = 0; i < 20; i++) ops.push(resource.delete(String(i), { apply: () => {} }));
        const settled = await Promise.all(ops.map(o => o.settled));
        expect(settled.every(r => r.ok)).toBe(true);
    });
