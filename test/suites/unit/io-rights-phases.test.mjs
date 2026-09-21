/**
 * Bundle and read traffic can be vetoed before a sink ever sees it.
 *
 * The pipeline used to model a pre-action phase for CRUD writes only. Everything
 * else — every `bundle-export`, every `bundle-import`, every read — dispatched
 * straight to whatever the operator had bound. `registerOwnerRights` therefore
 * *declared* `annotations.bundle-export` and then mounted nothing, so denying it
 * in `core.roles` changed precisely nothing: the payload still reached github,
 * mlflow, or whatever else was bound. The only defence was each owner
 * remembering to call `can()` itself, which annotations never did.
 *
 * Pushing the veto into the pipeline is what makes admin role rules real
 * WITHOUT every sink author writing their own permission check. These vectors
 * pin the parts that are easy to get subtly wrong:
 *
 *  - a refused export must not fall back to a local download (that would hand
 *    the denied user the same data through the other door),
 *  - the hook must not run at all, not merely have its result discarded,
 *  - and `direction: "*"` must NOT silently widen onto the new phases, or every
 *    pre-existing write guard becomes a veto over reads it never inspected.
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

const OWNER = "module.annotations";

/** Refusal shaped exactly like the one `registerOwnerRights` mounts. */
const denied = (capability) => ({
    ok: false, refused: true, code: "W_PERM_DENIED",
    reason: `rights: capability "${capability}" denied`,
});

/**
 * A pipeline with one owner, its bundle hooks, and a recording sink.
 *
 * `calls` records what actually ran, which is the whole point: a guard that
 * returns a refusal the caller ignores looks identical in the result array to
 * one that stopped the work.
 */
function makePipeline({ config = {}, sinks = ["remote"] } = {}) {
    const calls = { exportBundle: 0, importBundle: 0, writeBundle: 0, readBundle: 0, read: 0, query: 0, download: 0 };
    const pipeline = new IOPipeline({ POST_DATA: {}, getConfig: () => config, notify: () => {} });

    pipeline.registerOwner(OWNER, {
        ownerId: "annotations",
        xoType: "module",
        bundleScope: "global",
        exportBundle: async () => { calls.exportBundle++; return JSON.stringify({ some: "state" }); },
        importBundle: async () => { calls.importBundle++; },
    });
    pipeline.registerCapability(OWNER, { id: "crud:annotation", kind: "crud" });
    pipeline.registerCapability(OWNER, { id: "bundle-submit", kind: "bundle" });

    for (const id of sinks) {
        pipeline.registerSink({
            id,
            supports: ["crud", "bundle"],
            async writeBundle() { calls.writeBundle++; return { ok: true }; },
            async readBundle() { calls.readBundle++; return { ok: true, payload: JSON.stringify({ some: "state" }) }; },
            async read() { calls.read++; return { ok: true, payload: { id: "a1" } }; },
            async create() { return { ok: true }; },
            async *query() { calls.query++; yield { id: "a1" }; },
        });
    }
    // Stands in for the built-in last-resort local download.
    pipeline.registerSink({
        id: "file-download",
        supports: ["bundle"],
        async writeBundle() { calls.download++; return { ok: true }; },
    });
    return { pipeline, calls };
}

/** Route every bundle capability of the owner at `sinkIds`. */
const bind = (sinkIds) => ({
    bindings: {
        annotations: {
            "bundle-export": sinkIds,
            "bundle-import": sinkIds,
            "bundle-submit": sinkIds,
            "crud:annotation": sinkIds,
        },
    },
});

const readCtx = (pipeline) => ({
    direction: "read",
    capabilityId: "crud:annotation",
    xoType: "module",
    ownerUid: OWNER,
    ownerId: "annotations",
    resourceName: "annotation",
    itemId: "a1",
    key: "",
    meta: {},
});

// ── pre-export ───────────────────────────────────────────────────────────────

test("a pre-export refusal stops the payload from being built at all @unit @security", async () => {
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard({
        ownerId: "rights:annotations", resource: "*", direction: "pre-export", priority: 10_000,
        handler: () => denied("annotations.bundle-export"),
    });

    const results = await pipeline.flushBundleExport({ ownerUid: OWNER });

    expect(calls.exportBundle).toBe(0);
    expect(calls.writeBundle).toBe(0);
    expect(results.some(r => r.code === "W_PERM_DENIED")).toBe(true);
});

test("a refused export does NOT degrade to a local download @unit @security", async () => {
    // The whole denial is pointless if the user still walks away with the file.
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard({
        ownerId: "rights:annotations", resource: "*", direction: "pre-export", priority: 10_000,
        handler: () => denied("annotations.bundle-export"),
    });

    await pipeline.flushBundleExport({ ownerUid: OWNER });

    expect(calls.download).toBe(0);
});

test("without a guard the export runs as before @unit", async () => {
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });
    await pipeline.flushBundleExport({ ownerUid: OWNER });
    expect(calls.exportBundle).toBeGreaterThan(0);
    expect(calls.writeBundle).toBeGreaterThan(0);
});

// ── pre-import ───────────────────────────────────────────────────────────────

test("a pre-import refusal stops a sink restore @unit @security", async () => {
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard({
        ownerId: "rights:annotations", resource: "*", direction: "pre-import", priority: 10_000,
        handler: () => denied("annotations.bundle-import"),
    });

    const results = await pipeline.tryRestoreImport({ ownerUid: OWNER });

    expect(calls.readBundle).toBe(0);
    expect(calls.importBundle).toBe(0);
    expect(results.some(r => r.code === "W_PERM_DENIED")).toBe(true);
});

test("a pre-import refusal also stops a user-supplied payload @unit @security", async () => {
    // Denying the sink route but leaving "load a file" open would be no denial.
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard({
        ownerId: "rights:annotations", resource: "*", direction: "pre-import", priority: 10_000,
        handler: () => denied("annotations.bundle-import"),
    });

    const results = await pipeline.importBundle(JSON.stringify({ some: "state" }), { ownerUid: OWNER });

    expect(calls.importBundle).toBe(0);
    expect(results.some(r => r.code === "W_PERM_DENIED")).toBe(true);
});

// ── pre-read ─────────────────────────────────────────────────────────────────

test("a pre-read refusal stops a CRUD read @unit @security", async () => {
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard({
        ownerId: "rights:annotations", resource: "annotation", direction: "pre-read", priority: 10_000,
        handler: () => denied("annotations.crud:annotation.read"),
    });

    const result = await pipeline.dispatch(readCtx(pipeline));

    expect(calls.read).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("W_PERM_DENIED");
});

test("a pre-read refusal yields an empty stream, not a throw @unit @security", async () => {
    // Every caller is a hydration `for await` that treats "nothing" as a valid
    // answer; throwing there would take the feature down instead of gating it.
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard({
        ownerId: "rights:annotations", resource: "annotation", direction: "pre-read", priority: 10_000,
        handler: () => denied("annotations.crud:annotation.read"),
    });

    const seen = [];
    for await (const item of pipeline.queryStream({ ...readCtx(pipeline), direction: "query" }, {})) seen.push(item);

    expect(seen).toEqual([]);
    expect(calls.query).toBe(0);
});

test("reads still work when nothing denies them @unit", async () => {
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });
    const result = await pipeline.dispatch(readCtx(pipeline));
    expect(result.ok).toBe(true);
    expect(calls.read).toBe(1);
});

// ── the "*" scope ────────────────────────────────────────────────────────────

test('direction "*" covers CRUD writes but never the new phases @unit @security', async () => {
    // A pre-existing guard was written to judge a write. Widening `"*"` onto
    // exports and reads would make it veto traffic it has never inspected.
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });
    const seen = [];
    pipeline.registerGuard({
        ownerId: "domain", resource: "*", direction: "*",
        handler: (ctx) => { seen.push(ctx.direction); return { ok: true }; },
    });

    await pipeline.flushBundleExport({ ownerUid: OWNER });
    await pipeline.dispatch(readCtx(pipeline));
    pipeline.runGuards({ ...readCtx(pipeline), direction: "pre-create" });

    expect(seen).toEqual(["pre-create"]);
    expect(calls.exportBundle).toBeGreaterThan(0);
    expect(calls.read).toBe(1);
});

// ── capability-scoped flush ──────────────────────────────────────────────────

test("flush can target ONE outbound bundle capability @unit", async () => {
    // An owner with both a session-state channel and a submission channel must
    // be able to drive one from a button without pushing the other.
    const { pipeline } = makePipeline({ config: bind(["remote"]) });
    const seen = [];
    pipeline.registerGuard({
        ownerId: "spy", resource: "*", direction: "pre-export",
        handler: (ctx) => { seen.push(ctx.capabilityId); return { ok: true }; },
    });

    await pipeline.flushBundleExport({ ownerUid: OWNER, capabilityId: "bundle-submit" });

    // Deduped: the phase runs twice per capability by design — once as the
    // per-capability POLICY check that skips the whole scope fan-out on a
    // refusal, once on the dispatch itself for guards registered later. What
    // this test pins is WHICH capabilities were reached, not how often.
    expect([...new Set(seen)]).toEqual(["bundle-submit"]);
});

test("an unscoped flush still covers every outbound bundle capability @unit", async () => {
    const { pipeline } = makePipeline({ config: bind(["remote"]) });
    const seen = [];
    pipeline.registerGuard({
        ownerId: "spy", resource: "*", direction: "pre-export",
        handler: (ctx) => { seen.push(ctx.capabilityId); return { ok: true }; },
    });

    await pipeline.flushBundleExport({ ownerUid: OWNER });

    expect([...new Set(seen)].sort()).toEqual(["bundle-export", "bundle-submit"]);
});

test("a bundle capability not spelled 'export' still counts as remote @unit", async () => {
    // The old predicate matched the literal word, so a `bundle-submit` bound to
    // a real destination read as "nothing remote is configured" and Save
    // silently degraded to a local file.
    const { pipeline } = makePipeline({
        config: { bindings: { annotations: { "bundle-submit": ["remote"] } } },
    });
    expect(pipeline.hasRemoteBundleSinks(OWNER)).toBe(true);
});

test("an unbound bundle capability is NOT remote, despite the fallback @unit", async () => {
    // The trap this exists to close: with nothing bound, every bundle capability
    // still resolves to the in-page `post-data` dict, so a flush ALWAYS returns
    // results. Reading "results.length" as "somewhere stored it" is how a Submit
    // button reported success while writing to a dict that dies with the tab.
    const { pipeline } = makePipeline({ config: {} });
    // The real app always has this registered; it is what Rule 5 falls back to.
    pipeline.registerSink({ id: "post-data", supports: ["bundle"], async writeBundle() { return { ok: true }; } });

    expect(pipeline.bindingsFor(OWNER, "bundle-submit")).toEqual(["post-data"]);
    expect(pipeline.hasRemoteBundleSinks(OWNER, "bundle-submit")).toBe(false);
});

// ── the gate belongs to ONE owner ────────────────────────────────────────────

test("a rights gate for one owner does not refuse another owner's export @unit @security", async () => {
    // The bug this exists to stop: bundle contexts carry no `resourceName`, so a
    // bundle gate can only register under `resource: "*"` — and `runGuards` then
    // offers it EVERY owner's dispatch. A handler that only asked "does the user
    // hold my capability?" refused the recorder, the questionnaire and everything
    // else whenever annotations was denied, each reporting the ANNOTATIONS
    // capability id. One Export click produced six dialogs.
    const { pipeline } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerOwner("module.recorder", {
        ownerId: "recorder", xoType: "module", bundleScope: "global",
        exportBundle: async () => "{}",
    });

    // Exactly the shape `registerOwnerRights.mountGate` installs.
    pipeline.registerGuard({
        ownerId: "rights:annotations", resource: "*", direction: "pre-export", priority: 10_000,
        handler: (ctx) => {
            if (ctx?.ownerId !== "annotations") return { ok: true };
            if (ctx?.capabilityId !== "bundle-export") return { ok: true };
            return denied("annotations.bundle-export");
        },
    });

    const mine = pipeline.runGuards({
        direction: "pre-export", capabilityId: "bundle-export",
        xoType: "module", ownerUid: OWNER, ownerId: "annotations", key: "", meta: {},
    });
    const theirs = pipeline.runGuards({
        direction: "pre-export", capabilityId: "bundle-export",
        xoType: "module", ownerUid: "module.recorder", ownerId: "recorder", key: "", meta: {},
    });
    // Same owner, DIFFERENT capability — also not this gate's business.
    const otherCap = pipeline.runGuards({
        direction: "pre-export", capabilityId: "bundle-submit",
        xoType: "module", ownerUid: OWNER, ownerId: "annotations", key: "", meta: {},
    });

    expect(mine.ok).toBe(false);
    expect(mine.code).toBe("W_PERM_DENIED");
    expect(theirs.ok).toBe(true);
    expect(otherCap.ok).toBe(true);
});

test("a denied capability refuses ONCE per flush, not once per scope @unit", async () => {
    // `bundleScope: "all"` fans out to global + per-viewer + per-viewer-background.
    // The policy answer is identical for all of them, so it is asked once.
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerOwner(OWNER, {
        ownerId: "annotations", xoType: "module", bundleScope: "all",
        exportBundle: async () => { calls.exportBundle++; return "{}"; },
    });
    pipeline.registerGuard({
        ownerId: "rights:annotations", resource: "*", direction: "pre-export", priority: 10_000,
        handler: (ctx) => (ctx?.ownerId === "annotations" ? denied("annotations.bundle-export") : { ok: true }),
    });

    const results = await pipeline.flushBundleExport({ ownerUid: OWNER, capabilityId: "bundle-export" });

    const refusals = results.filter(r => !r.ok && r.code === "W_PERM_DENIED");
    expect(refusals).toHaveLength(1);
    expect(calls.exportBundle).toBe(0);
});

test("a refusal names the owner it is about @unit", async () => {
    // `IOResult` used to carry no identity, so a caller aggregating a flush could
    // not say WHAT it failed to export — and index-correlation is impossible
    // because the result count per owner varies.
    const { pipeline } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard({
        ownerId: "rights:annotations", resource: "*", direction: "pre-export", priority: 10_000,
        handler: (ctx) => (ctx?.ownerId === "annotations" ? denied("annotations.bundle-export") : { ok: true }),
    });

    const results = await pipeline.flushBundleExport({ ownerUid: OWNER, capabilityId: "bundle-export" });
    const refusal = results.find(r => !r.ok);

    expect(refusal.ownerId).toBe("annotations");
    expect(refusal.ownerUid).toBe(OWNER);
    expect(refusal.capabilityId).toBe("bundle-export");
});

test("remoteness is answerable per capability, not just per owner @unit", async () => {
    // An owner can be remotely bound for session state and NOT for submissions.
    // Asking about the owner as a whole answers "yes, somewhere" and lets the
    // unbound channel claim success.
    const { pipeline } = makePipeline({
        config: { bindings: { annotations: { "bundle-export": ["remote"] } } },
    });
    expect(pipeline.hasRemoteBundleSinks(OWNER)).toBe(true);
    expect(pipeline.hasRemoteBundleSinks(OWNER, "bundle-export")).toBe(true);
    expect(pipeline.hasRemoteBundleSinks(OWNER, "bundle-submit")).toBe(false);
});
