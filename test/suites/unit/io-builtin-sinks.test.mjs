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
