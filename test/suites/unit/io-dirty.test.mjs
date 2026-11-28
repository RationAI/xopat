/**
 * Dirty state: which owners hold work not stored anywhere the user can get it
 * back from. It drives the leave-page prompt and the Save cue, so the two ways
 * it can be wrong both cost something: a missing mark loses work silently, a
 * mark that never clears trains users to click through the prompt.
 *
 * Vectors pin who may clear (a persisting sink, not an in-page one), that a
 * save only clears what it captured, that the pipeline's own restore is not
 * user work, and when queued CRUD ops count.
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
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

/** A global-scope owner bound to `sinkIds`; sinks are registered by the caller. */
function makePipeline(sinkIds, owner = {}) {
    const pipeline = new IOPipeline({
        POST_DATA: {},
        getConfig: () => ({ bindings: { annotations: { "bundle-export": sinkIds, "bundle-import": sinkIds } } }),
        notify: () => {},
    });
    pipeline.registerOwner(OWNER, {
        ownerId: "annotations",
        xoType: "module",
        bundleScope: "global",
        exportBundle: async () => "state",
        ...owner,
    });
    const events = [];
    pipeline.addHandler("io:dirty-changed", (e) => events.push(e));
    return { pipeline, events };
}

const sink = (id, extra = {}) => ({
    id, supports: ["bundle"],
    async writeBundle() { return { ok: true }; },
    ...extra,
});

test("marks are per document and events fire on transitions only", { tag: ["@unit"] }, async () => {
    const { pipeline, events } = makePipeline([], { bundleScope: "per-viewer-background" });
    expect(pipeline.isDirty()).toBe(false);

    pipeline.markDirty(OWNER, { viewerId: "v1", backgroundId: "b1" });
    pipeline.markDirty(OWNER, { viewerId: "v1", backgroundId: "b1" });
    pipeline.markDirty(OWNER);
    expect(events.map(e => [e.viewerId, e.backgroundId, e.dirty])).toEqual([
        ["v1", "b1", true],
        [undefined, undefined, true],
    ]);
    expect(pipeline.isDirty({ viewerId: "v1", backgroundId: "b1" })).toBe(true);
    expect(pipeline.isDirty({ viewerId: "v1", backgroundId: "b2" })).toBe(false);

    pipeline.markClean(OWNER, { viewerId: "v1", backgroundId: "b1" });
    expect(pipeline.isDirty()).toBe(true);
    pipeline.markClean();
    expect(pipeline.isDirty()).toBe(false);
    expect(events.at(-1)).toMatchObject({ dirty: false, anyDirty: false });
});

test("a persisting sink clears; an in-page one does not", { tag: ["@unit"] }, async () => {
    {
        const { pipeline } = makePipeline(["session-memory"]);
        pipeline.registerSink(sink("session-memory", { persists: false }));
        pipeline.markDirty(OWNER);
        await pipeline.flushBundleExport();
        expect(pipeline.isDirty(), "in-page store dies with the tab").toBe(true);
    }
    {
        const { pipeline } = makePipeline(["session-memory", "remote"]);
        pipeline.registerSink(sink("session-memory", { persists: false }));
        pipeline.registerSink(sink("remote"));
        pipeline.markDirty(OWNER);
        await pipeline.flushBundleExport({ skipFileFallback: true });
        expect(pipeline.isDirty()).toBe(false);
    }
});

test("a refused write keeps the document dirty", { tag: ["@unit"] }, async () => {
    const { pipeline } = makePipeline(["remote"]);
    pipeline.registerSink(sink("remote", {
        async writeBundle() { return { ok: false, refused: true, code: "W_TEST", reason: "no" }; },
    }));
    pipeline.markDirty(OWNER);
    await pipeline.flushBundleExport({ skipFileFallback: true });
    expect(pipeline.isDirty()).toBe(true);
});

test("an edit made while the sink writes is newer than the payload", { tag: ["@unit"] }, async () => {
    let release;
    const { pipeline } = makePipeline(["remote"]);
    pipeline.registerSink(sink("remote", {
        writeBundle: () => new Promise((r) => { release = () => r({ ok: true }); }),
    }));
    pipeline.markDirty(OWNER);
    const flush = pipeline.flushBundleExport({ skipFileFallback: true });
    await settle();
    pipeline.markDirty(OWNER);          // user keeps drawing
    release();
    await flush;
    expect(pipeline.isDirty()).toBe(true);
});

test("the pipeline's own restore is not user work", { tag: ["@unit"] }, async () => {
    let pipelineRef;
    const { pipeline } = makePipeline(["remote"], {
        // An owner that marks on its ordinary change events, loads included.
        importBundle: async () => { pipelineRef.markDirty(OWNER); },
    });
    pipelineRef = pipeline;
    pipeline.registerSink(sink("remote", {
        async readBundle() { return { ok: true, payload: "state" }; },
    }));
    await pipeline.tryRestoreImport({ ownerUid: OWNER });
    expect(pipeline.isDirty()).toBe(false);

    // ...and the suppression ends with the restore.
    pipeline.markDirty(OWNER);
    expect(pipeline.isDirty()).toBe(true);
});

test("markCleanUpTo spares refused owners and later edits", { tag: ["@unit"] }, async () => {
    const { pipeline } = makePipeline([]);
    pipeline.markDirty(OWNER);
    pipeline.markDirty("plugin.other");
    const mark = pipeline.dirtyMark();
    pipeline.markDirty("plugin.late");

    pipeline.markCleanUpTo(mark, [{ ok: false, refused: true, reason: "denied", ownerUid: "plugin.other" }]);
    expect(pipeline.isDirty({ ownerUid: OWNER })).toBe(false);
    expect(pipeline.isDirty({ ownerUid: "plugin.other" })).toBe(true);
    expect(pipeline.isDirty({ ownerUid: "plugin.late" })).toBe(true);

    // A refusal naming nobody may concern anyone: nothing is cleared.
    pipeline.markCleanUpTo(pipeline.dirtyMark(), [{ ok: false, refused: true, reason: "?" }]);
    expect(pipeline.isDirty({ ownerUid: "plugin.late" })).toBe(true);
});

test("queued CRUD ops count only while they would be lost", { tag: ["@unit"] }, async () => {
    const pipeline = new IOPipeline({
        POST_DATA: {},
        getConfig: () => ({ bindings: { annotations: { "crud:annotation": ["late-sink"] } } }),
        notify: () => {},
    });
    pipeline.registerOwner(OWNER, { ownerId: "annotations", xoType: "module" });
    pipeline.registerCapability(OWNER, { id: "crud:annotation", kind: "crud" });
    const resource = new IOResourceImpl({
        ownerUid: OWNER, ownerId: "annotations", xoType: "module", pipeline,
        def: { name: "annotation", identityOf: (i) => String(i?.id ?? ""), persistOutbox: false },
    });
    pipeline.registerResource(resource);
    const events = [];
    pipeline.addHandler("io:dirty-changed", (e) => events.push(e));

    expect(resource.hasUnsavedWork()).toBe(false);
    const op = resource.create({ id: "a1" }, { apply: () => {} });
    await settle();
    // Held for a sink that has not registered: in memory only.
    expect(resource.hasUnsavedWork()).toBe(true);
    expect(pipeline.isDirty()).toBe(true);
    expect(events.at(-1)).toMatchObject({ resourceName: "annotation", dirty: true });

    pipeline.registerSink({ id: "late-sink", supports: ["crud"], async create() { return { ok: true }; } });
    await op.settled;
    await settle();
    expect(resource.hasUnsavedWork()).toBe(false);
    expect(pipeline.isDirty()).toBe(false);
    expect(events.at(-1)).toMatchObject({ resourceName: "annotation", dirty: false, anyDirty: false });
});

test("a viewer mark uses the key the owner's scope writes, so a save clears it", { tag: ["@unit"] }, async () => {
    const prev = globalThis.UTILITIES;
    globalThis.UTILITIES = { currentBackgroundIdFor: () => "b1" };
    try {
        const viewer = { uniqueId: "v1" };
        {
            const { pipeline } = makePipeline(["remote"], { bundleScope: "per-viewer" });
            pipeline.registerSink(sink("remote"));
            pipeline.markDirty(OWNER, viewer);
            await pipeline.flushBundleExport({ viewerId: "v1", skipFileFallback: true });
            expect(pipeline.isDirty(), "per-viewer document is `v1`, not `v1::b1`").toBe(false);
        }
        {
            const { pipeline } = makePipeline(["remote"]);
            pipeline.registerSink(sink("remote"));
            pipeline.markDirty(OWNER, viewer);
            await pipeline.flushBundleExport({ skipFileFallback: true });
            expect(pipeline.isDirty(), "a global owner has one document").toBe(false);
        }
    } finally {
        globalThis.UTILITIES = prev;
    }
});

test("a restore on one viewer does not swallow an edit on another", { tag: ["@unit"] }, async () => {
    const { pipeline } = makePipeline([], { bundleScope: "per-viewer" });
    await pipeline.asRestore(OWNER, "vA", async () => {
        pipeline.markDirty(OWNER, { viewerId: "vA" });     // the restore itself
        pipeline.markDirty(OWNER, { viewerId: "vB" });     // the user, elsewhere
    });
    expect(pipeline.isDirty({ ownerUid: OWNER, viewerId: "vA" })).toBe(false);
    expect(pipeline.isDirty({ ownerUid: OWNER, viewerId: "vB" })).toBe(true);

    // A global restore covers the whole owner.
    pipeline.markClean();
    await pipeline.asRestore(OWNER, undefined, async () => { pipeline.markDirty(OWNER, { viewerId: "vB" }); });
    expect(pipeline.isDirty()).toBe(false);
});

test("Export clears an owner a remote sink refused when the in-page copy took it", { tag: ["@unit"] }, async () => {
    const { pipeline } = makePipeline(["post-data", "remote"]);
    pipeline.registerSink(sink("post-data", { persists: false }));
    pipeline.registerSink(sink("remote", {
        async writeBundle() { return { ok: false, refused: true, code: "W_DOWN", reason: "store down" }; },
    }));
    pipeline.markDirty(OWNER);
    const mark = pipeline.dirtyMark();
    const results = await pipeline.flushBundleExport();
    expect(results.filter(r => !r.ok).every(r => r.ownerUid === OWNER), "sink answers carry the owner").toBe(true);
    expect(pipeline.isDirty(), "post-data does not persist on its own").toBe(true);
    pipeline.markCleanUpTo(mark, results);
    expect(pipeline.isDirty()).toBe(false);

    // Refused everywhere: left out, stays dirty.
    pipeline.markDirty(OWNER);
    pipeline.markCleanUpTo(pipeline.dirtyMark(), [{ ok: false, refused: true, reason: "no", ownerUid: OWNER }]);
    expect(pipeline.isDirty()).toBe(true);
});
