/**
 * The outbox queue collapses `create A; delete A` before either op reaches the
 * wire — so the `create` emitted by the *undo* of that delete is the only one
 * the server ever sees. It must therefore carry the item's real body, and keep
 * A's identity so the following redo can cancel it again.
 *
 * These vectors pin that round trip plus the three invariants it rests on: a
 * coalesced-out op always settles, a surviving op keeps its queue slot (no
 * cross-identity reordering), and an inverse op is always addressable.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

const { IOResourceImpl } = await import("../../../src/classes/io/io-resource.ts");

/** Records everything that reaches the sink layer. */
function makePipeline() {
    const dispatched = [];
    let gate = null;
    return {
        dispatched,
        /** Hold the next dispatches open so entries can be observed in-flight. */
        block() {
            let release;
            gate = new Promise(resolve => { release = resolve; });
            return () => { gate = null; release(); };
        },
        isEnabled: () => true,
        async dispatch(ctx, payload) {
            dispatched.push({ direction: ctx.direction, itemId: ctx.itemId, payload, meta: ctx.meta });
            if (gate) await gate;
            return { ok: true };
        },
        emitQueueEvent_() {},
        surfaceRefusal_() {},
        runGuards: () => ({ ok: true }),
    };
}

/** Stand-in for `APPLICATION_CONTEXT.history` — buffer + cursor, nothing else. */
function installHistory() {
    const buffer = [];
    let idx = -1;
    const history = {
        buffer,
        pushExecuted(forward, backward) { buffer.splice(++idx, buffer.length, { forward, backward }); },
        undo() { if (idx >= 0) buffer[idx--].backward(); },
        redo() { if (idx + 1 < buffer.length) buffer[++idx].forward(); },
    };
    globalThis.window.APPLICATION_CONTEXT = { history };
    return history;
}

function makeResource(pipeline, defOverrides = {}) {
    return new IOResourceImpl({
        ownerUid: "module.test",
        ownerId: "test",
        xoType: "module",
        pipeline,
        def: {
            name: "thing",
            identityOf: (item) => String(item?.id ?? ""),
            coalesce: true,
            merge: (prev, next) => ({ ...(prev || {}), ...(next || {}) }),
            persistOutbox: false,
            ...defOverrides,
        },
    });
}

/** The worker starts on a microtask and each dispatch is async — let it drain. */
const drain = async (resource) => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await resource.flush();
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

const ITEM = { id: "A", shape: "polygon", points: [1, 2, 3] };

test("a coalesced-out op settles instead of hanging", { tag: ["@unit"] }, async () => {
    const pipeline = makePipeline();
    installHistory();
    const resource = makeResource(pipeline);

    const created = resource.create(ITEM);
    const deleted = resource.delete("A");

    // Both sides of the cancelled pair resolve — awaiting either must not hang.
    const results = await Promise.race([
        Promise.all([created.settled, deleted.settled]),
        new Promise(resolve => setTimeout(() => resolve("TIMEOUT"), 1000)),
    ]);
    expect(results).not.toBe("TIMEOUT");
    for (const r of results) {
        expect(r.ok).toBe(true);
        expect(r.payload).toEqual({ coalesced: true });
    }

    await drain(resource);
    expect(pipeline.dispatched).toHaveLength(0);   // nothing reached the wire
});

test("undo of a cancelled-out delete re-creates the item with its real body", { tag: ["@unit"] }, async () => {
    const pipeline = makePipeline();
    const history = installHistory();
    const resource = makeResource(pipeline);
    const snapshot = { ...ITEM };

    resource.create(ITEM, { apply: () => {}, inverseApply: () => {} });
    resource.delete("A", {
        apply: () => {},
        inverseApply: () => {},
        inversePayload: snapshot,
    });
    await drain(resource);
    expect(pipeline.dispatched).toHaveLength(0);

    history.undo();
    await drain(resource);

    // Exactly one op, and it carries the item — not an empty resurrection.
    expect(pipeline.dispatched).toHaveLength(1);
    expect(pipeline.dispatched[0].direction).toBe("create");
    expect(pipeline.dispatched[0].payload).toEqual(snapshot);
    expect(pipeline.dispatched[0].itemId).toBe("A");
    expect(pipeline.dispatched[0].meta.fromUndo).toBe(true);
});

test("redo cancels the undo's create — identity survives the replay", { tag: ["@unit"] }, async () => {
    const pipeline = makePipeline();
    const history = installHistory();
    const resource = makeResource(pipeline);

    resource.create(ITEM, { apply: () => {}, inverseApply: () => {} });
    resource.delete("A", { apply: () => {}, inverseApply: () => {}, inversePayload: { ...ITEM } });
    await drain(resource);

    // Both replays land in one frame, so the create is still unstarted when the
    // delete arrives. They cancel only if the create kept identity "A" — a
    // synthetic key would let both through.
    history.undo();
    history.redo();
    await drain(resource);

    expect(pipeline.dispatched).toHaveLength(0);
});

test("an inverse op is addressable even when its partner is already in flight", { tag: ["@unit"] }, async () => {
    const pipeline = makePipeline();
    const history = installHistory();
    const resource = makeResource(pipeline);

    const release = pipeline.block();
    resource.create(ITEM, { apply: () => {}, inverseApply: () => {} });
    for (let i = 0; i < 10; i++) await Promise.resolve();   // create is now started
    expect(pipeline.dispatched).toHaveLength(1);

    history.undo();                 // cannot coalesce past an in-flight op
    release();
    await drain(resource);

    expect(pipeline.dispatched).toHaveLength(2);
    const [, inverse] = pipeline.dispatched;
    expect(inverse.direction).toBe("delete");
    // `create` dispatches with no itemId; the inverse must recover it from the
    // payload or the sink has nothing to delete.
    expect(inverse.itemId).toBe("A");
});

test("undo of an update sends the reverting patch, not the forward one", { tag: ["@unit"] }, async () => {
    const pipeline = makePipeline();
    const history = installHistory();
    const resource = makeResource(pipeline);

    resource.update("A", { color: "red" }, {
        apply: () => {},
        inverseApply: () => {},
        inversePayload: { color: "blue" },
    });
    await drain(resource);
    history.undo();
    await drain(resource);

    expect(pipeline.dispatched.map(d => d.payload)).toEqual([{ color: "red" }, { color: "blue" }]);
});

test("coalescing removes work without reordering other identities", { tag: ["@unit"] }, async () => {
    const pipeline = makePipeline();
    installHistory();
    const resource = makeResource(pipeline);

    const release = pipeline.block();
    resource.update("gate", { n: 0 });                 // occupies the worker
    for (let i = 0; i < 10; i++) await Promise.resolve();

    resource.update("A", { n: 1 });
    resource.update("B", { n: 2 });
    resource.update("A", { n: 3 });                    // supersedes A's entry in place

    release();
    await drain(resource);

    expect(pipeline.dispatched.map(d => d.itemId)).toEqual(["gate", "A", "B"]);
    expect(pipeline.dispatched[1].payload).toEqual({ n: 3 });   // last write won
});
