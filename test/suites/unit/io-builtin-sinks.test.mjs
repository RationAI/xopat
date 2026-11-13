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

test("http-rest string templates substitute every occurrence, sanitized @unit", async () => {
    const requests = failingHttpClient(() => httpError(404));
    const sink = makeHttpRestSink({
        getOptions: () => ({ baseURL: "/api", itemPath: "/{resourceName}/{itemId}/copy/{itemId}" }),
    });
    await sink.update(ctxOf({ direction: "update", resourceName: "annotation", itemId: "../../etc" }), {});
    expect(requests[0].path).toBe("/annotation/.._.._etc/copy/.._.._etc");
});

test("http-rest hands the dispatch ctx to getOptions @unit", async () => {
    failingHttpClient(() => httpError(404));
    const seen = [];
    const sink = makeHttpRestSink({ getOptions: (ctx) => { seen.push(ctx?.ownerId); return { baseURL: "/api" }; } });
    await sink.writeBundle(ctxOf(), "x");
    expect(seen.every(id => id === "annotations")).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
});

// ── withRetry ──────────────────────────────────────────────────────────────

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

// ── restore ────────────────────────────────────────────────────────────────

const OWNER = "module.annotations";

/** A slide-aware owner bound to the given sinks, each answering `readBundle` with its payload. */
function restorePipeline(sinkPayloads, { readDelayMs = 0 } = {}) {
    const imported = [];
    const ids = Object.keys(sinkPayloads);
    const pipeline = new IOPipeline({
        POST_DATA: {},
        getConfig: () => ({ bindings: { annotations: { "bundle-export": ids, "bundle-import": ids } } }),
        notify: () => {},
    });
    pipeline.registerOwner(OWNER, {
        ownerId: "annotations", xoType: "module", bundleScope: "per-viewer-background",
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
