/**
 * The outbox worker is a single-consumer FIFO: if one entry can never settle,
 * every later write for that resource is stuck behind it, silently and for the
 * rest of the session. Owner-supplied hooks (`serialize`, `validate`) are the
 * realistic source of such an entry, so these vectors pin that a hook which
 * misbehaves costs exactly its own operation and nothing after it.
 *
 * They also pin that a refusal the user cannot see does not exist: a `validate`
 * rejection has to reach `surfaceRefusal_`, the same way a guard rejection does.
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

const { IOResourceImpl } = await import("../../../src/classes/io/io-resource.ts");

function makePipeline() {
    const dispatched = [];
    const surfaced = [];
    return {
        dispatched,
        surfaced,
        isEnabled: () => true,
        async dispatch(ctx, payload) {
            dispatched.push({ direction: ctx.direction, itemId: ctx.itemId, payload });
            return { ok: true };
        },
        runGuards() { return { ok: true }; },
        emitQueueEvent_() {},
        surfaceRefusal_(ctx, result) { surfaced.push({ ctx, result }); },
    };
}

function makeResource(pipeline, def = {}) {
    return new IOResourceImpl({
        ownerUid: "module.test",
        ownerId: "test",
        xoType: "module",
        pipeline,
        def: {
            name: "thing",
            identityOf: (item) => String(item?.id ?? ""),
            persistOutbox: false,
            ...def,
        },
    });
}

const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

test("a serialize() that throws costs its own op, not the whole queue", { tag: ["@unit"] }, async () => {
    const pipeline = makePipeline();
    const resource = makeResource(pipeline, {
        serialize: (item) => {
            if (item.id === "poison") throw new Error("cannot serialize");
            return item;
        },
    });

    const reverted = [];
    const first = resource.create({ id: "poison" }, {
        apply: () => {},
        inverseApply: () => reverted.push("poison"),
    });
    const second = resource.create({ id: "fine" }, { apply: () => {} });

    const firstResult = await first.settled;
    const secondResult = await second.settled;
    await settle();

    // The bad op is refused with its own code — not W_IO_DISPATCH_THREW, which
    // `isStallSignal` reads as the network being down.
    expect(firstResult.ok).toBe(false);
    expect(firstResult.code).toBe("W_IO_SERIALIZE_THREW");
    expect(pipeline.surfaced.some(s => s.result.code === "W_IO_SERIALIZE_THREW")).toBe(true);
    // The local commit is rolled back, like any other post-commit refusal.
    expect(reverted).toEqual(["poison"]);

    // The regression this exists for: the entry used to be left on the queue
    // unsettled, so nothing after it ever ran.
    expect(secondResult.ok).toBe(true);
    expect(pipeline.dispatched.map(d => d.payload.id)).toEqual(["fine"]);
});

test("a validate() refusal is shown to the user, not just returned", { tag: ["@unit"] }, async () => {
    const pipeline = makePipeline();
    const resource = makeResource(pipeline, {
        validate: (item) => item?.id
            ? { ok: true }
            : { ok: false, refused: true, reason: "id required", userMessage: "Give it a name." },
    });

    let applied = false;
    const result = resource.create({}, { apply: () => { applied = true; } });
    await settle();

    expect(result.ok).toBe(false);
    // Nothing was committed and nothing was sent.
    expect(applied).toBe(false);
    expect(pipeline.dispatched.length).toBe(0);
    // And the user hears about it — a silent `ok:false` is how an annotation
    // ends up simply never saving with no explanation anywhere.
    expect(pipeline.surfaced.length).toBe(1);
    expect(pipeline.surfaced[0].result.userMessage).toBe("Give it a name.");
});

test("canCreate stays silent — it is a question, not an operation", { tag: ["@unit"] }, async () => {
    const pipeline = makePipeline();
    const resource = makeResource(pipeline, {
        validate: () => ({ ok: false, refused: true, reason: "never", userMessage: "no" }),
    });

    const verdict = resource.canCreate({ id: "x" });
    await settle();

    expect(verdict.ok).toBe(false);
    // A probe drives UI enablement and can run on every render; toasting there
    // would fire an error dialog per frame.
    expect(pipeline.surfaced.length).toBe(0);
});
