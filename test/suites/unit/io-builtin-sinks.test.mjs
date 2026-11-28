/**
 * The built-in sinks and the restore pass had no tests of their own, and each
 * vector below is a defect that shipped because of it:
 *
 *   - `http-rest` reported every failure as `W_IO_HTTP_<OP>`, a code neither
 *     `withRetry` nor the outbox stall detector recognises — so the retry
 *     wrapper core registers around it never retried anything.
 *   - `withRetry` rebuilt the sink field by field and dropped `route`, turning a
 *     wrapped local-file sink into an ordinary destination.
 *   - `file-download` handed an `IOBinaryPayload` envelope to `new Blob([obj])`,
 *     producing a file containing the text "[object Object]".
 *   - Restore imported once PER SINK. A slide-aware owner wipes before it
 *     imports, so an empty answer from a later sink erased what an earlier one
 *     had just restored.
 *   - Two restores of the same slot in one tick both passed the `hydratedKeys`
 *     check and both imported.
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
const { makeHttpRestSink } = await import("../../../src/classes/io/sinks/http-rest.ts");
const { withRetry } = await import("../../../src/classes/io/sinks/with-retry.ts");
const { fileDownloadSink } = await import("../../../src/classes/io/sinks/file-download.ts");
const { fileUploadSink } = await import("../../../src/classes/io/sinks/file-upload.ts");

const ctxOf = (over = {}) => ({
    direction: "export", capabilityId: "bundle-export", xoType: "module",
    ownerUid: "module.annotations", ownerId: "annotations", key: "", meta: {}, ...over,
});

/** Install an HttpClient whose every request fails the given way; returns the call log. */
function failingHttpClient(makeError) {
    const requests = [];
    globalThis.HttpClient = class {
        async request(path, init) { requests.push({ path, init }); throw makeError(); }
    };
    return requests;
}

const httpError = (status) => Object.assign(new Error(`HTTP failed: ${status}`),
    { statusCode: status, response: { status } });
// What HttpClient throws when nothing answered: an HTTPError with no response
// (whose `statusCode` DEFAULTS to 500 — which is why the sink reads `response`).
const networkError = () => Object.assign(new Error("fetch failed"), { statusCode: 500 });

// ── http-rest failure codes ────────────────────────────────────────────────

test("http-rest reports a 5xx as its bare status @unit", async () => {
    failingHttpClient(() => httpError(503));
    const sink = makeHttpRestSink({ getOptions: () => ({ baseURL: "/api" }) });
    const r = await sink.writeBundle(ctxOf(), "x");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("503");
});

test("http-rest reports an unanswered request as a network failure @unit", async () => {
    failingHttpClient(networkError);
    const sink = makeHttpRestSink({ getOptions: () => ({ baseURL: "/api" }) });
    expect((await sink.writeBundle(ctxOf(), "x")).code).toBe("W_IO_HTTP_NETWORK");
});

test("http-rest keeps the per-operation code for a 4xx @unit", async () => {
    failingHttpClient(() => httpError(404));
    const sink = makeHttpRestSink({ getOptions: () => ({ baseURL: "/api" }) });
    expect((await sink.writeBundle(ctxOf(), "x")).code).toBe("W_IO_HTTP_WRITE");
});

test("the default retry policy retries http-rest on network and 5xx, never on 4xx @unit", async () => {
    const fast = { attempts: 3, backoff: () => 0 };
    for (const [makeError, expected] of [[networkError, 3], [() => httpError(502), 3], [() => httpError(403), 1]]) {
        const requests = failingHttpClient(makeError);
        const sink = withRetry(makeHttpRestSink({ getOptions: () => ({ baseURL: "/api" }) }), fast);
        await sink.writeBundle(ctxOf(), "x");
        expect(requests.length).toBe(expected);
    }
});

test("http-rest reads a missing bundle as empty, and only that @unit", async () => {
    // Every other sink answers "nothing stored yet" with ok + no payload; a
    // refusal here left the previous slide's state on screen.
    failingHttpClient(() => httpError(404));
    const sink = makeHttpRestSink({ getOptions: () => ({ baseURL: "/api" }) });
    const importCtx = ctxOf({ direction: "import", capabilityId: "bundle-import" });
    expect(await sink.readBundle(importCtx)).toEqual({ ok: true });

    for (const [makeError, code] of [[() => httpError(500), "500"], [() => httpError(401), "W_IO_HTTP_READ"],
        [networkError, "W_IO_HTTP_NETWORK"]]) {
        failingHttpClient(makeError);
        const r = await sink.readBundle(importCtx);
        expect(r.ok).toBe(false);
        expect(r.code).toBe(code);
    }
});

test("http-rest reads a named binary format as bytes, a guessed one as before @unit", async () => {
    const requests = [];
    globalThis.HttpClient = class {
        async request(path, init) { requests.push(init); return "x"; }
    };
    const sink = makeHttpRestSink({ getOptions: () => ({ baseURL: "/api" }) });
    const importCtx = ctxOf({ direction: "import", capabilityId: "bundle-import" });
    await sink.readBundle({ ...importCtx, format: { id: "dicom-sr", binary: true } });
    await sink.readBundle({ ...importCtx, format: { id: "dicom-sr", binary: true }, meta: { formatGuessed: true } });
    await sink.readBundle({ ...importCtx, format: { id: "native" } });
    expect(requests.map(r => r.expect)).toEqual(["bytes", undefined, undefined]);
});

// ── http-rest addressing ───────────────────────────────────────────────────

test("http-rest's default bundle path is distinct per bundle key @unit", async () => {
    const requests = failingHttpClient(() => httpError(404));
    const sink = makeHttpRestSink({ getOptions: () => ({ baseURL: "/api" }) });
    await sink.writeBundle(ctxOf(), "x");
    await sink.writeBundle(ctxOf({ key: "v1::slide/a", viewerId: "v1", backgroundId: "slide/a" }), "x");
    expect(requests[0].path).toBe("/bundles/annotations");
    expect(requests[1].path).toBe("/bundles/annotations/v1%3A%3Aslide%2Fa");
});

test("http-rest string templates substitute every occurrence, percent-encoded @unit @security", async () => {
    const requests = failingHttpClient(() => httpError(404));
    const sink = makeHttpRestSink({
        getOptions: () => ({ baseURL: "/api", itemPath: "/{resourceName}/{itemId}/copy/{itemId}" }),
    });
    await sink.update(ctxOf({ direction: "update", resourceName: "annotation", itemId: "../../etc" }), {});
    await sink.update(ctxOf({ direction: "update", resourceName: "annotation", itemId: ".." }), {});
    expect(requests[0].path).toBe("/annotation/..%2F..%2Fetc/copy/..%2F..%2Fetc");
    expect(requests[1].path).toBe("/annotation/%2E%2E/copy/%2E%2E");
});

test("http-rest template values stay distinct and whole @unit", async () => {
    const requests = failingHttpClient(() => httpError(404));
    const sink = makeHttpRestSink({ getOptions: () => ({ baseURL: "/api", itemPath: "/items/{itemId}" }) });
    const long = "x".repeat(300);
    for (const itemId of ["a:1", "a_1", long]) {
        await sink.update(ctxOf({ direction: "update", resourceName: "annotation", itemId }), {});
    }
    expect(requests.map(r => r.path)).toEqual(["/items/a%3A1", "/items/a_1", `/items/${long}`]);
});

test("http-rest expands templates through the injected formatPath @unit", async () => {
    const requests = failingHttpClient(() => httpError(404));
    const seen = [];
    const sink = makeHttpRestSink({
        getOptions: () => ({ baseURL: "/api", bundlePath: "/bundles/{ownerId}/{slideHash}" }),
        formatPath: (template, ctx, options) => { seen.push(options); return `/resolved/${ctx.backgroundId}`; },
    });
    await sink.writeBundle(ctxOf({ backgroundId: "bg1" }), "x");
    expect(requests[0].path).toBe("/resolved/bg1");
    expect(seen[0].mode).toBe("uri");
});

test("IOPipeline.formatPath resolves slide tokens per slide @unit", async () => {
    globalThis.UTILITIES = { slideIdentityFor: (bg) => ({ hash: `h-${bg}`, name: `n ${bg}` }) };
    const pipeline = new IOPipeline({ POST_DATA: {}, getConfig: () => ({}), notify: () => {} });
    const a = pipeline.formatPath("/b/{slideHash}/{slideName}", ctxOf({ backgroundId: "s1" }), { mode: "uri" });
    const b = pipeline.formatPath("/b/{slideHash}/{slideName}", ctxOf({ backgroundId: "s2" }), { mode: "uri" });
    expect(a).toBe("/b/h-s1/n%20s1");
    expect(b).toBe("/b/h-s2/n%20s2");
});

test("http-rest hands the dispatch ctx to getOptions @unit", async () => {
    failingHttpClient(() => httpError(404));
    const seen = [];
    const sink = makeHttpRestSink({ getOptions: (ctx) => { seen.push(ctx?.ownerId); return { baseURL: "/api" }; } });
    await sink.writeBundle(ctxOf(), "x");
    expect(seen.every(id => id === "annotations")).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
});

test("http-rest's HttpClient does not retry on its own @unit", async () => {
    const built = [];
    globalThis.HttpClient = class {
        constructor(o) { built.push(o); }
        async request() { return { data: null }; }
    };
    await makeHttpRestSink({ getOptions: () => ({ baseURL: "/api" }) }).readBundle(ctxOf());
    expect(built[0].maxRetries).toBe(0);
});

// ── withRetry ──────────────────────────────────────────────────────────────

test("withRetry never retries a create by default, but does retry idempotent writes @unit", async () => {
    const fast = { attempts: 3, backoff: () => 0 };
    let requests = failingHttpClient(() => httpError(502));
    let sink = withRetry(makeHttpRestSink({ getOptions: () => ({ baseURL: "/api" }) }), fast);
    await sink.create(ctxOf({ direction: "create", resourceName: "annotation" }), {});
    expect(requests.length).toBe(1);
    await sink.update(ctxOf({ direction: "update", resourceName: "annotation", itemId: "1" }), {});
    expect(requests.length).toBe(4);

    requests = failingHttpClient(() => httpError(502));
    sink = withRetry(makeHttpRestSink({ getOptions: () => ({ baseURL: "/api" }) }),
        { ...fast, methods: ["create"] });
    await sink.create(ctxOf({ direction: "create", resourceName: "annotation" }), {});
    expect(requests.length).toBe(3);
});

test("withRetry retries a 429 @unit", async () => {
    const requests = failingHttpClient(() => httpError(429));
    const sink = withRetry(makeHttpRestSink({ getOptions: () => ({ baseURL: "/api" }) }), { attempts: 2, backoff: () => 0 });
    expect((await sink.writeBundle(ctxOf(), "x")).code).toBe("429");
    expect(requests.length).toBe(2);
});

test("withRetry keeps the inner sink's route @unit @security", () => {
    const wrapped = withRetry({ id: "local", supports: ["bundle"], route: "local", async writeBundle() { return { ok: true }; } });
    expect(wrapped.route).toBe("local");
});

test("withRetry re-sends only the failed slots of a deleteMany @unit", async () => {
    const calls = [];
    let failB = 2;
    const wrapped = withRetry({
        id: "bulk", supports: ["crud"], maxBatch: 7,
        async deleteMany(ctxs) {
            calls.push(ctxs.map(c => c.itemId));
            return ctxs.map(c => (c.itemId === "b" && failB-- > 0
                ? { ok: false, refused: true, reason: "down", code: "503" }
                : { ok: true, payload: { id: c.itemId } }));
        },
    }, { attempts: 3, backoff: () => 0 });

    expect(wrapped.maxBatch).toBe(7);
    const out = await wrapped.deleteMany(["a", "b", "c"].map(itemId => ctxOf({ direction: "delete", itemId })));
    expect(calls).toEqual([["a", "b", "c"], ["b"], ["b"]]);
    expect(out.map(r => r.ok)).toEqual([true, true, true]);
    expect(out.map(r => r.payload.id)).toEqual(["a", "b", "c"]);
});

test("withRetry does not re-send a createMany unless create is retryable @unit", async () => {
    const make = (calls) => ({
        id: "bulk", supports: ["crud"],
        async createMany(ctxs, items) {
            calls.push(items.length);
            return items.map(() => ({ ok: false, refused: true, reason: "down", code: "503" }));
        },
    });
    const once = [];
    await withRetry(make(once), { attempts: 3, backoff: () => 0 }).createMany([ctxOf(), ctxOf()], [{}, {}]);
    expect(once).toEqual([2]);

    const thrice = [];
    await withRetry(make(thrice), { attempts: 3, backoff: () => 0, methods: ["create"] })
        .createMany([ctxOf(), ctxOf()], [{}, {}]);
    expect(thrice).toEqual([2, 2, 2]);
});

test("withRetry keeps bulk methods and the format pin of a class-based sink @unit", () => {
    class Sink {
        id = "klass"; supports = ["crud"];
        preferredFormat() { return "native"; }
        async createMany(ctxs) { return ctxs.map(() => ({ ok: true })); }
        async deleteMany(ctxs) { return ctxs.map(() => ({ ok: true })); }
    }
    const wrapped = withRetry(new Sink());
    expect(typeof wrapped.createMany).toBe("function");
    expect(typeof wrapped.deleteMany).toBe("function");
    expect(wrapped.preferredFormat("annotations", ctxOf())).toBe("native");
});

test("a binding written as a single target instead of a list still resolves @unit", () => {
    const pipeline = new IOPipeline({
        POST_DATA: {},
        getConfig: () => ({ bindings: { annotations: { "bundle-export": "solo" } } }),
        notify: () => {},
    });
    pipeline.registerOwner("module.annotations", { ownerId: "annotations", xoType: "module" });
    pipeline.registerCapability("module.annotations", { id: "bundle-export", kind: "bundle" });
    pipeline.registerSink({ id: "solo", supports: ["bundle"], async writeBundle() { return { ok: true }; } });
    expect(pipeline.bindingsFor("module.annotations", "bundle-export")).toEqual(["solo"]);
});

// ── file-download ──────────────────────────────────────────────────────────

test("file-download writes the bytes of a binary payload, not the envelope @unit", async () => {
    const downloads = [];
    globalThis.UTILITIES = { downloadAsFile: (name, content) => downloads.push({ name, content }) };
    const r = await fileDownloadSink.writeBundle(ctxOf(), {
        bytes: new Uint8Array([1, 2, 3]), contentType: "video/webm", fileExt: "webm",
    });
    expect(r.ok).toBe(true);
    expect(downloads[0].name.endsWith(".webm")).toBe(true);
    expect(downloads[0].content).toBeInstanceOf(Blob);
    expect(downloads[0].content.size).toBe(3);
    expect(downloads[0].content.type).toBe("video/webm");
});

/** A fake file picker: the hidden input "picks" `fileName` as soon as it is clicked. */
function fakePicker(fileName) {
    const modes = [];
    const prevDocument = globalThis.document;
    globalThis.document = {
        body: { appendChild() {} },
        createElement() {
            const handlers = {};
            const input = {
                style: {}, remove() {},
                addEventListener: (name, fn) => { handlers[name] = fn; },
                click: () => handlers.change({ target: { files: [{ name: fileName }] } }),
            };
            return input;
        },
    };
    globalThis.addEventListener ??= () => {};
    globalThis.UTILITIES = {
        readFileUploadEvent: async (_e, mode = "text") => { modes.push(mode); return mode === "bytes" ? new ArrayBuffer(2) : "text"; },
    };
    return { modes, restore: () => { globalThis.document = prevDocument; } };
}

test("file-upload reads a file of a binary format as bytes, anything else as text @unit", async () => {
    const formats = [
        { id: "native", extensions: [".json"] },
        { id: "dicom-sr", extensions: [".dcm"], binary: true },
    ];
    globalThis.IO_PIPELINE = { formats: { list: (domain) => domain === "annotations" ? formats : [] } };
    const importCtx = ctxOf({ direction: "import", capabilityId: "bundle-import" });

    let picker = fakePicker("slide.DCM");
    let r = await fileUploadSink.readBundle(importCtx);
    picker.restore();
    expect(picker.modes).toEqual(["bytes"]);
    expect(r.payload).toBeInstanceOf(ArrayBuffer);
    expect(r.meta.fileName).toBe("slide.DCM");

    picker = fakePicker("slide.json");
    r = await fileUploadSink.readBundle(importCtx);
    picker.restore();
    expect(picker.modes).toEqual(["text"]);
    expect(r.payload).toBe("text");

    // A format pinned on the dispatch decides, whatever the file is called.
    picker = fakePicker("export.json");
    await fileUploadSink.readBundle({ ...importCtx, format: { id: "dicom-sr", binary: true } });
    picker.restore();
    expect(picker.modes).toEqual(["bytes"]);
    delete globalThis.IO_PIPELINE;
});

// ── restore ────────────────────────────────────────────────────────────────

const OWNER = "module.annotations";

/** An owner (slide-aware by default) bound to the given sinks, each answering `readBundle` with its payload. */
function restorePipeline(sinkPayloads, { readDelayMs = 0, bundleScope = "per-viewer-background" } = {}) {
    const imported = [];
    const ids = Object.keys(sinkPayloads);
    const pipeline = new IOPipeline({
        POST_DATA: {},
        getConfig: () => ({ bindings: { annotations: { "bundle-export": ids, "bundle-import": ids } } }),
        notify: () => {},
    });
    pipeline.registerOwner(OWNER, {
        ownerId: "annotations", xoType: "module", bundleScope,
        exportBundle: async () => undefined,
        importBundle: async (_ctx, data) => { imported.push(data); },
    });
    for (const id of ids) {
        pipeline.registerSink({
            id, supports: ["bundle"],
            async writeBundle() { return { ok: true }; },
            async readBundle() {
                if (readDelayMs) await new Promise(r => setTimeout(r, readDelayMs));
                return { ok: true, payload: sinkPayloads[id] };
            },
        });
    }
    return { pipeline, imported };
}

const SLOT = { ownerUid: OWNER, viewerId: "v1", backgroundId: "bg1", trigger: "system" };

test("an empty later sink does not wipe what an earlier sink restored @unit", async () => {
    const { pipeline, imported } = restorePipeline({ first: "stored", second: undefined });
    await pipeline.tryRestoreImport(SLOT);
    expect(imported).toEqual(["stored"]);
});

test("two populated sinks import once, last one winning @unit", async () => {
    const { pipeline, imported } = restorePipeline({ first: "older", second: "newer" });
    await pipeline.tryRestoreImport(SLOT);
    expect(imported).toEqual(["newer"]);
});

test("a global owner imports every populated sink, so it can merge them @unit", async () => {
    const { pipeline, imported } = restorePipeline({ first: "a", empty: undefined, second: "b" }, { bundleScope: "global" });
    await pipeline.tryRestoreImport({ ownerUid: OWNER, trigger: "system" });
    expect(imported).toEqual(["a", "b"]);
});

test("a slide-aware owner is still told when every sink is empty @unit", async () => {
    const { pipeline, imported } = restorePipeline({ first: undefined, second: undefined });
    await pipeline.tryRestoreImport(SLOT);
    expect(imported).toEqual([undefined]);
});

test("two restores of one slot in the same tick hydrate once @unit", async () => {
    const { pipeline, imported } = restorePipeline({ only: "stored" }, { readDelayMs: 5 });
    await Promise.all([pipeline.tryRestoreImport(SLOT), pipeline.tryRestoreImport(SLOT)]);
    expect(imported).toEqual(["stored"]);
});

// ── a restore that could not read ─────────────────────────────────────────
//
// The slide-aware owner's overlay survives a slide change, and the wipe lives
// in its `importBundle`. A read that fails called nothing: slide A's state
// stayed on screen under slide B, and the next flush stored it under B's key.

/** One remote sink whose read answers `state.read`, plus an explicitly bound local one. */
function unreadablePipeline() {
    const state = { read: { ok: false, refused: true, code: "503", reason: "down" } };
    const imported = [];
    const written = { remote: [], local: [] };
    const pipeline = new IOPipeline({
        POST_DATA: {},
        getConfig: () => ({ bindings: { annotations: {
            "bundle-export": ["remote", "local"], "bundle-import": ["remote"] } } }),
        notify: () => {},
    });
    pipeline.registerOwner(OWNER, {
        ownerId: "annotations", xoType: "module", bundleScope: "per-viewer-background",
        exportBundle: async () => "on-canvas",
        importBundle: async (_ctx, data) => { imported.push(data); },
    });
    pipeline.registerSink({
        id: "remote", supports: ["bundle"],
        async writeBundle(_ctx, payload) { written.remote.push(payload); return { ok: true }; },
        async readBundle() { return state.read; },
    });
    pipeline.registerSink({
        id: "local", supports: ["bundle"], route: "local",
        async writeBundle(_ctx, payload) { written.local.push(payload); return { ok: true }; },
    });
    return { pipeline, state, imported, written };
}

test("an unreadable slot is wiped once and closed to bound sinks @unit", async () => {
    const { pipeline, imported, written } = unreadablePipeline();
    await pipeline.tryRestoreImport(SLOT);
    // The previous slide's state is cleared...
    expect(imported).toEqual([undefined]);
    // ...and a retry does not clear what the user has drawn here since.
    await pipeline.tryRestoreImport(SLOT);
    expect(imported).toEqual([undefined]);

    // Slide-leave: nothing is written anywhere, and no file is produced.
    const left = await pipeline.flushBundleExport({ ...SLOT });
    expect(written).toEqual({ remote: [], local: [] });
    expect(left.some(r => !r.ok && r.code === "W_IO_NOT_HYDRATED")).toBe(true);
});

test("a user export of an unreadable slot keeps the local copy, not the store @unit", async () => {
    const { pipeline, written } = unreadablePipeline();
    await pipeline.tryRestoreImport(SLOT);
    const results = await pipeline.flushBundleExport({ ownerUid: OWNER, viewerId: "v1", backgroundId: "bg1" });
    expect(written.remote).toEqual([]);
    expect(written.local).toEqual(["on-canvas"]);
    expect(results.some(r => !r.ok && r.code === "W_IO_NOT_HYDRATED")).toBe(true);
});

test("a later successful restore reopens the slot @unit", async () => {
    const { pipeline, state, imported, written } = unreadablePipeline();
    await pipeline.tryRestoreImport(SLOT);
    state.read = { ok: true, payload: "stored" };
    await pipeline.tryRestoreImport(SLOT);
    expect(imported).toEqual([undefined, "stored"]);
    await pipeline.flushBundleExport({ ...SLOT });
    expect(written.remote).toEqual(["on-canvas"]);
});

test("the user is told once, with a retry that reopens the slot @unit", async () => {
    const { pipeline, state, imported, written } = unreadablePipeline();
    const notices = [];
    pipeline.notifier = (message, level, buttons) => { notices.push({ message, level, buttons }); };

    // An automatic restore is silent about its refusals, but not about this.
    await pipeline.tryRestoreImport(SLOT);
    await pipeline.tryRestoreImport(SLOT);
    const offers = notices.filter(n => n.buttons?.length);
    expect(offers).toHaveLength(1);
    expect(pipeline.unreadableSlots()).toEqual([{ ownerUid: OWNER, viewerId: "v1", backgroundId: "bg1" }]);

    // Still down: nothing changes, and what is on screen is not wiped again.
    await pipeline.retryRestore({ viewerId: "v1", backgroundId: "bg1" });
    expect(imported).toEqual([undefined]);
    expect(pipeline.unreadableSlots()).toHaveLength(1);

    // Back up: the button loads the stored state and saving reopens.
    state.read = { ok: true, payload: "stored" };
    offers[0].buttons[0].onClick();
    await new Promise(r => setTimeout(r, 5));
    expect(imported).toEqual([undefined, "stored"]);
    expect(pipeline.unreadableSlots()).toEqual([]);
    await pipeline.flushBundleExport({ ...SLOT });
    expect(written.remote).toEqual(["on-canvas"]);

    // A healthy slot is never re-imported by a retry.
    await pipeline.retryRestore({ viewerId: "v1", backgroundId: "bg1" });
    expect(imported).toEqual([undefined, "stored"]);
});

test("an empty slot is looked up once more under the slide's former address @unit", async () => {
    // `{slideHash}` no longer covers display-only fields, so data stored for an
    // entry like {dataID, minificationFilter} sits under the old hash.
    const store = { "x/old": "stored-before" };
    const paths = [];
    const pipeline = new IOPipeline({
        POST_DATA: {},
        getConfig: () => ({ slideHashKey: "k",
            bindings: { annotations: { "bundle-export": ["store"], "bundle-import": ["store"] } } }),
        notify: () => {},
    });
    const imported = [];
    pipeline.registerOwner(OWNER, {
        ownerId: "annotations", xoType: "module", bundleScope: "per-viewer-background",
        exportBundle: async () => "on-canvas",
        importBundle: async (ctx, data) => { imported.push([data, ctx.meta.legacySlideHash]); },
    });
    pipeline.registerSink({
        id: "store", supports: ["bundle"],
        async readBundle(ctx) {
            const path = pipeline.formatPath("x/{slideHash}", ctx);
            paths.push(path);
            return { ok: true, payload: store[path] };
        },
        async writeBundle(ctx, payload) { store[pipeline.formatPath("x/{slideHash}", ctx)] = payload; return { ok: true }; },
    });
    const identity = { hash: "new", name: "a.tif", legacyHash: "old" };
    globalThis.UTILITIES = { slideIdentityFor: () => identity };
    try {
        await pipeline.tryRestoreImport(SLOT);
        expect(paths).toEqual(["x/new", "x/old"]);
        // Imported into today's slot; the flag does not travel to the owner.
        expect(imported).toEqual([["stored-before", undefined]]);
        // ...and the next save lands on the current address.
        await pipeline.flushBundleExport({ ...SLOT });
        expect(store["x/new"]).toBe("on-canvas");

        // A slide whose address never changed costs no second read.
        delete identity.legacyHash;
        paths.length = 0;
        await pipeline.tryRestoreImport({ ...SLOT, backgroundId: "bg2" });
        expect(paths).toEqual(["x/new"]);
    } finally {
        delete globalThis.UTILITIES;
    }
});

test("a slot nobody could read from still saves @unit", async () => {
    // A write-only binding attempts no read, so there is nothing unknown to protect.
    const written = [];
    const pipeline = new IOPipeline({
        POST_DATA: {},
        getConfig: () => ({ bindings: { annotations: { "bundle-export": ["out"], "bundle-import": ["out"] } } }),
        notify: () => {},
    });
    pipeline.registerOwner(OWNER, {
        ownerId: "annotations", xoType: "module", bundleScope: "per-viewer-background",
        exportBundle: async () => "on-canvas", importBundle: async () => {},
    });
    pipeline.registerSink({
        id: "out", supports: ["bundle"],
        async writeBundle(_ctx, payload) { written.push(payload); return { ok: true }; },
    });
    await pipeline.tryRestoreImport(SLOT);
    await pipeline.flushBundleExport({ ...SLOT });
    expect(written).toEqual(["on-canvas"]);
});

test("a user-picked file import can name the viewer it is for @unit", async () => {
    const seen = [];
    const pipeline = new IOPipeline({ POST_DATA: {}, getConfig: () => ({}), notify: () => {} });
    pipeline.registerOwner(OWNER, {
        ownerId: "annotations", xoType: "module", bundleScope: "per-viewer-background",
        exportBundle: async () => undefined,
        importBundle: async (ctx) => { seen.push([ctx.viewerId, ctx.backgroundId, ctx.key]); },
    });
    await pipeline.importBundle("data", { ownerUid: OWNER, viewerId: "v1", backgroundId: "bg1" });
    expect(seen).toEqual([["v1", "bg1", "v1::bg1"]]);
});
