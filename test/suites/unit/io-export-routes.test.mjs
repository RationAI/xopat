/**
 * Export and import travel one of two routes, and they are separate questions.
 *
 * The pipeline used to ask one: "may this owner export?" — checked before any
 * destination was chosen. That conflated two things an operator needs to say
 * apart. Denying `annotations.bundle-export` to mean "do not upload to the
 * registry" also confiscated the pathologist's own local copy of their work,
 * and there was no way to say the opposite either ("keep working, but nothing
 * leaves this machine").
 *
 * So a dispatch now carries `ctx.route`:
 *   - `"sink"`  — a bound destination, judged by the owner's own capability
 *   - `"local"` — the file escape hatch, judged by `core.io.local-file`
 *
 * The other half is the fallback condition. It used to be
 * `sinks.length > 0 && succeeded === 0`, counting *bound* sinks rather than
 * sinks that actually ran — so when every bound sink declined on POLICY grounds
 * ("you may not write here"), the payload was handed straight to a local
 * download and the refusal meant nothing. A *shape* decline is the opposite
 * case and must still rescue the user's data.
 *
 * Vectors below pin both halves, plus the invariant that matters most: with NO
 * guards registered, everything behaves exactly as it did before any of this.
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

const denied = (capability) => ({
    ok: false, refused: true, code: "W_PERM_DENIED",
    reason: `rights: capability "${capability}" denied`,
});

/**
 * @param remoteAccepts `undefined` to accept everything, or the decision object
 *   the remote sink should return from `accepts()` — which is how the two kinds
 *   of decline (policy vs shape) are expressed.
 */
function makePipeline({ config = {}, remoteAccepts, bindFileDownload = false } = {}) {
    const calls = { exportBundle: 0, importBundle: 0, writeBundle: 0, readBundle: 0, download: 0 };
    // Everything the user would have been shown. `notify` IS the dialog layer
    // (`src/classes/io/bootstrap.ts` wires it to `Dialogs.show`), so counting
    // it is counting interruptions.
    const notified = [];
    const refused = [];
    const pipeline = new IOPipeline({
        POST_DATA: {}, getConfig: () => config,
        notify: (msg, level) => notified.push({ msg, level }),
    });
    pipeline.addHandler("io:refused", (e) => refused.push(e));

    pipeline.registerOwner(OWNER, {
        ownerId: "annotations",
        xoType: "module",
        bundleScope: "global",
        exportBundle: async () => { calls.exportBundle++; return JSON.stringify({ some: "state" }); },
        importBundle: async () => { calls.importBundle++; },
    });

    pipeline.registerSink({
        id: "remote",
        supports: ["bundle"],
        // `!== undefined`, not a truthiness test: `false` is a legitimate
        // (and load-bearing) verdict here.
        accepts: remoteAccepts !== undefined ? () => remoteAccepts : undefined,
        async writeBundle() { calls.writeBundle++; return { ok: true }; },
        async readBundle() { calls.readBundle++; return { ok: true, payload: JSON.stringify({ some: "state" }) }; },
    });
    // Mirrors the real built-in, including its `route` declaration — which is
    // what makes an EXPLICITLY bound file-download answer to the local verdict
    // rather than the owner's.
    pipeline.registerSink({
        id: "file-download",
        supports: ["bundle"],
        route: "local",
        async writeBundle() { calls.download++; return { ok: true }; },
    });

    const targets = bindFileDownload ? ["remote", "file-download"] : ["remote"];
    return { pipeline, calls, targets, notified, refused };
}

const bind = (sinkIds) => ({
    bindings: {
        annotations: {
            "bundle-export": sinkIds,
            "bundle-import": sinkIds,
        },
    },
});

/** A guard that only judges one route, as the real owner/core gates do. */
const routeGuard = (direction, route, capability) => ({
    ownerId: `rights:${route}`,
    resource: "*",
    direction,
    priority: 10_000,
    handler: (ctx) => (ctx?.route === route ? denied(capability) : { ok: true }),
});

// ── the invariant: nothing configured, nothing changes ───────────────────────

test("with no guards an export reaches its sink and takes no local copy @unit", async () => {
    // The regression this file exists to prevent: a vanilla deployment must
    // behave byte-identically to one that never heard of roles.
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });

    await pipeline.flushBundleExport({ ownerUid: OWNER });

    expect(calls.exportBundle).toBeGreaterThan(0);
    expect(calls.writeBundle).toBeGreaterThan(0);
    expect(calls.download).toBe(0);
});

// ── the two routes are independent ───────────────────────────────────────────

test("denying the sink route still lets the user keep a local copy @unit @security", async () => {
    // "Do not upload to the registry" is not "you may not have your own work".
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard(routeGuard("pre-export", "sink", "annotations.bundle-export"));

    const results = await pipeline.flushBundleExport({ ownerUid: OWNER });

    expect(calls.writeBundle).toBe(0);
    expect(calls.download).toBe(1);
    // …and the refusal is still reported, so the export can name what it skipped.
    expect(results.some(r => !r.ok && r.code === "W_PERM_DENIED")).toBe(true);
});

test("denying the local route leaves the configured destination working @unit", async () => {
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard(routeGuard("pre-export", "local", "core.io.local-file"));

    await pipeline.flushBundleExport({ ownerUid: OWNER });

    expect(calls.writeBundle).toBe(1);
    expect(calls.download).toBe(0);
});

test("denying the local route removes the fallback when the sink fails @unit @security", async () => {
    // The kiosk case: nothing may leave as a file, whatever else goes wrong.
    const { pipeline, calls } = makePipeline({
        config: bind(["remote"]),
        remoteAccepts: { accept: false, reason: "sink offline" },
    });
    pipeline.registerGuard(routeGuard("pre-export", "local", "core.io.local-file"));

    await pipeline.flushBundleExport({ ownerUid: OWNER });

    expect(calls.writeBundle).toBe(0);
    expect(calls.download).toBe(0);
});

test("denying both routes builds no payload at all @unit @security", async () => {
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard(routeGuard("pre-export", "sink", "annotations.bundle-export"));
    pipeline.registerGuard(routeGuard("pre-export", "local", "core.io.local-file"));

    const results = await pipeline.flushBundleExport({ ownerUid: OWNER });

    expect(calls.exportBundle).toBe(0);
    expect(calls.writeBundle).toBe(0);
    expect(calls.download).toBe(0);
    expect(results.some(r => !r.ok && r.code === "W_PERM_DENIED")).toBe(true);
});

test("a route-blind guard denies everything, exactly as before @unit @security", async () => {
    // Guards written before `route` existed must not become half-effective.
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard({
        ownerId: "rights:legacy", resource: "*", direction: "pre-export", priority: 10_000,
        handler: () => denied("annotations.bundle-export"),
    });

    await pipeline.flushBundleExport({ ownerUid: OWNER });

    expect(calls.exportBundle).toBe(0);
    expect(calls.download).toBe(0);
});

// ── policy declines vs shape declines ────────────────────────────────────────

test("a sink declining on POLICY grounds suppresses the local fallback @unit @security", async () => {
    // The bypass this closes: the fallback used to key off how many sinks were
    // BOUND, so "you may not write here" produced a full local download of the
    // same bytes and the refusal was decorative.
    const { pipeline, calls } = makePipeline({
        config: bind(["remote"]),
        remoteAccepts: { accept: false, reason: "upstream refused: not your project", policy: true },
    });

    await pipeline.flushBundleExport({ ownerUid: OWNER });

    expect(calls.writeBundle).toBe(0);
    expect(calls.download).toBe(0);
});

test("a sink declining on SHAPE grounds still gets the user their data @unit", async () => {
    // Nobody suitable was bound. That is a misconfiguration, not a verdict —
    // and a local copy is exactly the right rescue.
    const { pipeline, calls } = makePipeline({
        config: bind(["remote"]),
        remoteAccepts: { accept: false, reason: "this sink only stores DICOM SR" },
    });

    await pipeline.flushBundleExport({ ownerUid: OWNER });

    expect(calls.writeBundle).toBe(0);
    expect(calls.download).toBe(1);
});

test("a bare `accepts: false` counts as a shape decline @unit", async () => {
    // A sink cannot suppress the rescue by accident: only the explicit decision
    // form can claim `policy: true`.
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]), remoteAccepts: false });

    await pipeline.flushBundleExport({ ownerUid: OWNER });

    expect(calls.download).toBe(1);
});

// ── an explicitly bound local sink ───────────────────────────────────────────

test("a bound file-download answers to the local verdict, not the owner's @unit @security", async () => {
    // What the sink IS does not change with who dispatched to it. Binding the
    // file sink explicitly must not launder the local-file denial.
    const { pipeline, calls, targets } = makePipeline({
        config: bind(["remote", "file-download"]),
        bindFileDownload: true,
    });
    void targets;
    pipeline.registerGuard(routeGuard("pre-export", "local", "core.io.local-file"));

    await pipeline.flushBundleExport({ ownerUid: OWNER });

    expect(calls.writeBundle).toBe(1);
    expect(calls.download).toBe(0);
});

test("a bound file-download survives an owner-level sink denial @unit", async () => {
    const { pipeline, calls } = makePipeline({
        config: bind(["remote", "file-download"]),
        bindFileDownload: true,
    });
    pipeline.registerGuard(routeGuard("pre-export", "sink", "annotations.bundle-export"));

    await pipeline.flushBundleExport({ ownerUid: OWNER });

    expect(calls.writeBundle).toBe(0);
    expect(calls.download).toBe(1);
});

// ── Save never takes the local route ─────────────────────────────────────────

test("skipFileFallback keeps Save away from the local route entirely @unit", async () => {
    // Save means "persist where the deployment says"; a silent download instead
    // would be a different verb.
    const { pipeline, calls } = makePipeline({
        config: bind(["remote"]),
        remoteAccepts: { accept: false, reason: "sink offline" },
    });

    await pipeline.flushBundleExport({ ownerUid: OWNER, skipFileFallback: true });

    expect(calls.download).toBe(0);
});

// ── import ───────────────────────────────────────────────────────────────────

test("a local-route import denial stops a hand-loaded file @unit @security", async () => {
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard(routeGuard("pre-import", "local", "core.io.local-file"));

    const results = await pipeline.importBundle(JSON.stringify({ some: "state" }), { ownerUid: OWNER });

    expect(calls.importBundle).toBe(0);
    expect(results.some(r => !r.ok && r.code === "W_PERM_DENIED")).toBe(true);
});

test("a local-route import denial does NOT stop a sink restore @unit", async () => {
    // Boot hydration from `post-data` is not the user loading a file.
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard(routeGuard("pre-import", "local", "core.io.local-file"));

    await pipeline.tryRestoreImport({ ownerUid: OWNER });

    expect(calls.readBundle).toBe(1);
    expect(calls.importBundle).toBe(1);
});

test("a sink-route import denial does NOT stop a hand-loaded file @unit", async () => {
    // The mirror image: an owner denied its configured import channel can still
    // be handed a file by the user, if the deployment allows local files.
    const { pipeline, calls } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard(routeGuard("pre-import", "sink", "annotations.bundle-import"));

    await pipeline.importBundle(JSON.stringify({ some: "state" }), { ownerUid: OWNER });

    expect(calls.importBundle).toBe(1);
});

// ── who asked for this? ──────────────────────────────────────────────────────

test("an automatic restore refusal is logged, not shown @unit", async () => {
    // The reported bug: loading the page as a restricted role produced four
    // dialogs before the user touched anything. Boot hydration is the
    // pipeline's own bookkeeping — a refusal there reports a failure the user
    // did not cause and cannot act on.
    const { pipeline, notified, refused } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard({
        ownerId: "rights:annotations", resource: "*", direction: "pre-import", priority: 10_000,
        handler: () => denied("annotations.bundle-import"),
    });

    const results = await pipeline.tryRestoreImport({ ownerUid: OWNER, trigger: "system" });

    expect(notified, "nothing reaches the dialog layer").toEqual([]);
    // …but nothing is lost: the event still fires and the result is still
    // returned, so a caller and the roles UI can both see it.
    expect(refused).toHaveLength(1);
    expect(results.some(r => !r.ok && r.code === "W_PERM_DENIED")).toBe(true);
});

test("the SAME refusal is shown when the default trigger applies @unit", async () => {
    // The guard against fixing the noise by making the whole layer silent. A
    // caller that does not declare itself automatic keeps interrupting — loud
    // is the default, and this is what pins it.
    const { pipeline, notified } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard({
        ownerId: "rights:annotations", resource: "*", direction: "pre-import", priority: 10_000,
        handler: () => denied("annotations.bundle-import"),
    });

    await pipeline.tryRestoreImport({ ownerUid: OWNER });

    expect(notified).toHaveLength(1);
});

test("an automatic slide-leave flush refusal is equally quiet @unit", async () => {
    // Navigating away from a slide snapshots it. The user asked to change
    // slides, not to export — so a refusal is a log line.
    const { pipeline, notified, refused } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard({
        ownerId: "rights:annotations", resource: "*", direction: "pre-export", priority: 10_000,
        handler: () => denied("annotations.bundle-export"),
    });

    const results = await pipeline.flushBundleExport({ ownerUid: OWNER, trigger: "system" });

    expect(notified).toEqual([]);
    // The export policy check is deliberately event-free (it is asked once per
    // owner and aggregated by the caller), so the refusal travels in the
    // RESULT, identified. A system flush additionally logs it, since it has no
    // aggregating caller to report it.
    expect(refused).toEqual([]);
    expect(results.find(r => !r.ok)?.ownerId).toBe("annotations");
});

test("a sink runtime failure during an automatic flush stays quiet too @unit", async () => {
    // Not just permission refusals: an automatic operation that fails for ANY
    // reason is still something nobody requested. The log is the right
    // destination; the toast would be about a phantom action.
    const { pipeline, notified } = makePipeline({
        config: bind(["remote"]),
        remoteAccepts: { accept: false, reason: "sink offline" },
    });

    await pipeline.flushBundleExport({ ownerUid: OWNER, trigger: "system", skipFileFallback: true });

    expect(notified).toEqual([]);
});

test("a restore refusal names the owner it is about @unit", async () => {
    // The export path stamped identity; the restore path did not, so a caller
    // aggregating boot hydration could not say whose state failed to come back.
    const { pipeline } = makePipeline({ config: bind(["remote"]) });
    pipeline.registerGuard({
        ownerId: "rights:annotations", resource: "*", direction: "pre-import", priority: 10_000,
        handler: () => denied("annotations.bundle-import"),
    });

    const results = await pipeline.tryRestoreImport({ ownerUid: OWNER });
    const refusal = results.find(r => !r.ok);

    expect(refusal.ownerId).toBe("annotations");
    expect(refusal.ownerUid).toBe(OWNER);
});
