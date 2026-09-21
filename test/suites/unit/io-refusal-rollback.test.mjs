/**
 * A destination that refuses a change is authoritative: the change must not
 * stay on screen. The hard part is reverting the *right* one — dispatch is
 * queued, so by the time op N is refused the top of the undo stack is rarely
 * op N, and `history.undo()` is offered to every provider before it touches the
 * buffer at all.
 *
 * These vectors pin that the resource reverts through its own history handle,
 * exactly once, for exactly the refused op — and that a guard refusal still
 * happens before anything is committed at all.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

// `history.ts` is a browser script extending OSD's event bus; give it one.
class EventSource {
    constructor() { this._h = new Map(); }
    addHandler(name, fn) { (this._h.get(name) ?? this._h.set(name, []).get(name)).push(fn); }
    removeHandler(name, fn) {
        const l = this._h.get(name);
        if (l) this._h.set(name, l.filter(x => x !== fn));
    }
    raiseEvent(name, payload) { for (const fn of this._h.get(name) ?? []) fn(payload); }
}
// Another suite in this worker may have installed its own OSD stub; only the
// piece history.ts needs has to be present.
globalThis.OpenSeadragon = globalThis.OpenSeadragon ?? {};
globalThis.OpenSeadragon.EventSource = globalThis.OpenSeadragon.EventSource ?? EventSource;

const { IOResourceImpl } = await import("../../../src/classes/io/io-resource.ts");
const { XOpatHistory } = await import("../../../src/classes/history.ts");

/** Sink layer that answers whatever the test tells it to. */
function makePipeline({ refuse = () => false } = {}) {
    const dispatched = [];
    const guards = [];
    return {
        dispatched,
        guards,
        refusals: [],
        isEnabled: () => true,
        async dispatch(ctx, payload) {
            dispatched.push({ direction: ctx.direction, itemId: ctx.itemId, payload });
            if (refuse(ctx)) {
                return { ok: false, refused: true, reason: "nope", code: "W_TEST_REFUSED" };
            }
            return { ok: true };
        },
        runGuards(ctx, payload) {
            for (const g of guards) {
                const r = g(ctx, payload);
                if (r && !r.ok) return r;
            }
            return { ok: true };
        },
        emitQueueEvent_(name, payload) { this.refusals.push({ name, payload }); },
        surfaceRefusal_() {},
    };
}

function makeResource(pipeline) {
    return new IOResourceImpl({
        ownerUid: "module.test",
        ownerId: "test",
        xoType: "module",
        pipeline,
        def: {
            name: "thing",
            identityOf: (item) => String(item?.id ?? ""),
            coalesce: true,
            persistOutbox: false,
        },
    });
}

/** Real history, so provider interception and buffer state are the real thing. */
function installHistory() {
    const history = new XOpatHistory(99);
    globalThis.window.APPLICATION_CONTEXT = { history };
    return history;
}

const drain = async (resource, history) => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
    await resource.flush();
    await history.whenIdle();
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** A tiny world the apply/inverseApply closures mutate. */
function makeWorld(initial = []) {
    const items = new Map(initial.map(i => [i.id, i]));
    return {
        items,
        has: (id) => items.has(id),
        add: (item) => items.set(item.id, item),
        remove: (id) => items.delete(id),
    };
}

test("a refused delete puts the item back", { tag: ["@unit"] }, async () => {
    const pipeline = makePipeline({ refuse: (ctx) => ctx.direction === "delete" });
    const history = installHistory();
    const resource = makeResource(pipeline);
    const item = { id: "A", shape: "polygon" };
    const world = makeWorld([item]);

    resource.delete("A", {
        apply: () => world.remove("A"),
        inverseApply: () => world.add(item),
        inversePayload: item,
    });
    expect(world.has("A")).toBe(false);       // optimistic local commit

    await drain(resource, history);

    expect(world.has("A")).toBe(true);        // …undone by the refusal
    // No inverse op on the wire: the delete never reached the destination.
    expect(pipeline.dispatched).toHaveLength(1);
    expect(pipeline.dispatched[0].direction).toBe("delete");
});

test("a refusal reverts its own op, not whatever is on top of the stack", { tag: ["@unit"] }, async () => {
    // Only the first op is refused; a second, unrelated op lands after it.
    let seen = 0;
    const pipeline = makePipeline({ refuse: () => seen++ === 0 });
    const history = installHistory();
    const resource = makeResource(pipeline);
    const a = { id: "A" }, b = { id: "B" };
    const world = makeWorld([a, b]);

    resource.delete("A", {
        apply: () => world.remove("A"),
        inverseApply: () => world.add(a),
        inversePayload: a,
    });
    resource.delete("B", {
        apply: () => world.remove("B"),
        inverseApply: () => world.add(b),
        inversePayload: b,
    });

    await drain(resource, history);

    expect(world.has("A")).toBe(true);        // refused → restored
    expect(world.has("B")).toBe(false);       // accepted → stays deleted
});

test("a history provider that swallows undo cannot block the revert", { tag: ["@unit"] }, async () => {
    const pipeline = makePipeline({ refuse: () => true });
    const history = installHistory();
    history.registerProvider({
        importance: 100,
        async undo() { return true; },        // claims every undo
        async redo() { return true; },
        canUndo() { return true; },
        canRedo() { return true; },
    });
    const resource = makeResource(pipeline);
    const item = { id: "A" };
    const world = makeWorld([item]);

    resource.delete("A", {
        apply: () => world.remove("A"),
        inverseApply: () => world.add(item),
        inversePayload: item,
    });
    await drain(resource, history);

    expect(world.has("A")).toBe(true);
});

test("an op the user already undid is not reverted twice", { tag: ["@unit"] }, async () => {
    const pipeline = makePipeline({ refuse: () => true });
    const history = installHistory();
    const resource = makeResource(pipeline);
    const item = { id: "A" };
    const world = makeWorld([item]);
    let inverseRuns = 0;

    resource.delete("A", {
        apply: () => world.remove("A"),
        inverseApply: () => { inverseRuns++; world.add(item); },
        inversePayload: item,
    });
    await history.whenIdle();
    await history.undo();                     // user undoes before the refusal lands
    await drain(resource, history);

    expect(inverseRuns).toBe(1);
    expect(world.has("A")).toBe(true);
});

test("revert is the default; opting out keeps the local change", { tag: ["@unit"] }, async () => {
    const pipeline = makePipeline({ refuse: () => true });
    const history = installHistory();
    const resource = makeResource(pipeline);
    const item = { id: "A" };
    const world = makeWorld([item]);

    resource.delete("A", {
        apply: () => world.remove("A"),
        inverseApply: () => world.add(item),
        inversePayload: item,
        rollbackOnAsyncRefuse: false,
    });
    await drain(resource, history);

    expect(world.has("A")).toBe(false);       // divergence, explicitly chosen
});

test("a guard refusal commits nothing and dispatches nothing", { tag: ["@unit"] }, async () => {
    const pipeline = makePipeline();
    const history = installHistory();
    pipeline.guards.push((ctx) => ctx.direction === "pre-delete"
        ? { ok: false, refused: true, reason: "denied", code: "W_PERM_DENIED" }
        : { ok: true });
    const resource = makeResource(pipeline);
    const item = { id: "A" };
    const world = makeWorld([item]);
    let applied = false;

    const result = resource.delete("A", {
        apply: () => { applied = true; world.remove("A"); },
        inverseApply: () => world.add(item),
        inversePayload: item,
    });

    expect(result.ok).toBe(false);
    expect(applied).toBe(false);
    expect(world.has("A")).toBe(true);
    await drain(resource, history);
    expect(pipeline.dispatched).toHaveLength(0);
    expect(history.hasStackUndo()).toBe(false);   // nothing recorded either
});

test("canDelete reports the veto without committing or dispatching", { tag: ["@unit"] }, async () => {
    const pipeline = makePipeline();
    installHistory();
    pipeline.guards.push(() => ({ ok: false, refused: true, reason: "denied", code: "W_PERM_DENIED" }));
    const resource = makeResource(pipeline);

    const veto = resource.canDelete("A");
    expect(veto.ok).toBe(false);
    expect(veto.code).toBe("W_PERM_DENIED");
    expect(pipeline.dispatched).toHaveLength(0);
});
