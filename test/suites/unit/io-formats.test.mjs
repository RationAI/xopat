/**
 * Formats: a registry anyone can add to, a conversion service usable on its
 * own, and the pipeline matching formats to sinks.
 *
 * Before this, the pipeline had no notion of format. `exportBundle` ran once
 * and every bound sink got the same payload, in whatever format one
 * module-global setting named — so a sink needing a specific format either
 * ignored the payload and re-encoded from live state, or flipped that global
 * for everybody (changing what the user's own "download" produced, and
 * silently storing nothing when the user flipped it back).
 *
 * Pinned here:
 *   - registration is by `(domain, id)` and needs no owner to exist;
 *   - detection prefers the file name, lets content overrule it, and never
 *     guesses when nothing recognises the data;
 *   - one flush exports once PER DISTINCT FORMAT and hands each sink its own;
 *   - a binding may pick among a sink's formats, never outside them;
 *   - a read comes back tagged, and the tag survives the trip to the owner.
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
const { IOFormatRegistry } = await import("../../../src/classes/io/io-formats.ts");
const { makeSessionMemorySink } = await import("../../../src/classes/io/sinks/session-memory.ts");

const DOMAIN = "annotations";
const OWNER = "module.annotations";

/** Two JSON formats that share an extension, and one that owns a longer one. */
const NATIVE = {
    domain: DOMAIN, id: "native", title: "Native", extensions: [".json"], contentType: "application/json",
    encode: (model) => JSON.stringify({ native: true, ...model }),
    decode: (data) => JSON.parse(data),
    sniff: (_data, hint) => hint.json?.native === true ? 0.9 : 0,
};
const GEO = {
    domain: DOMAIN, id: "geo", title: () => "Geo", extensions: ["geo.json", ".geojson"], contentType: "application/geo+json",
    options: { precision: { type: "numberInput", default: 3 }, _note: { type: "text" } },
    encode: (model, fctx) => JSON.stringify({ type: "FeatureCollection", n: model.items.length, p: fctx.options.precision }),
    decode: (data) => ({ items: new Array(JSON.parse(data).n).fill(0) }),
    sniff: (_data, hint) => hint.json?.type === "FeatureCollection" ? 0.7 : 0,
    encodeItem: (item, fctx) => ({ wire: item.id, slide: fctx.io?.backgroundId }),
    decodeItem: (raw) => ({ id: raw.wire }),
};
const BINARY = {
    domain: DOMAIN, id: "bin", title: "Binary", extensions: [".dcm"], contentType: "application/dicom", binary: true,
    encode: () => new Uint8Array([1, 2]),
};

function registry(...formats) {
    const events = [];
    const r = new IOFormatRegistry((name, payload) => events.push({ name, ...payload }));
    for (const f of formats) r.register(f);
    return { r, events };
}

// ── registry ───────────────────────────────────────────────────────────────

test("a format registers without its owner existing, and announces itself @unit", () => {
    const { r, events } = registry(NATIVE);
    expect(r.has(DOMAIN, "native")).toBe(true);
    expect(r.list("someone-else")).toEqual([]);
    expect(events).toEqual([{ name: "io:format-registered", domain: DOMAIN, id: "native" }]);
});

test("a disposer removes only its own registration @unit", () => {
    const { r } = registry();
    const disposeFirst = r.register(NATIVE);
    r.register({ ...NATIVE, title: "Replacement" });
    disposeFirst();
    expect(r.title(DOMAIN, "native")).toBe("Replacement");
});

test("a format with no conversion at all is refused @unit", () => {
    const { r } = registry();
    expect(() => r.register({ domain: DOMAIN, id: "empty", title: "x", extensions: [] })).toThrow(/no conversion/);
});

test("extensions are normalized and titles resolved lazily @unit", () => {
    const { r } = registry(GEO);
    expect(r.get(DOMAIN, "geo").extensions).toEqual([".geo.json", ".geojson"]);
    expect(r.title(DOMAIN, "geo")).toBe("Geo");
    expect(r.title(DOMAIN, "unknown")).toBe("unknown");
});

test("a descriptor carries what a sink needs to name and type a file @unit", () => {
    const { r } = registry(GEO, BINARY);
    expect(r.descriptor(DOMAIN, "geo", { precision: 1 })).toEqual({
        domain: DOMAIN, id: "geo", registered: true, binary: false,
        contentType: "application/geo+json", fileExt: "geo.json", options: { precision: 1 },
    });
    expect(r.descriptor(DOMAIN, "bin").binary).toBe(true);
    expect(r.descriptor(DOMAIN, "nope").registered).toBe(false);
});

// ── direct conversion ──────────────────────────────────────────────────────

test("encode and decode work with no pipeline flush involved @unit", async () => {
    const { r } = registry(NATIVE, GEO);
    expect(await r.encode(DOMAIN, "geo", { items: [1, 2] })).toBe('{"type":"FeatureCollection","n":2,"p":3}');
    expect(await r.encode(DOMAIN, "geo", { items: [] }, { options: { precision: 9 } }))
        .toBe('{"type":"FeatureCollection","n":0,"p":9}');
    expect(await r.decode(DOMAIN, "geo", '{"type":"FeatureCollection","n":2}'))
        .toEqual({ model: { items: [0, 0] }, format: "geo" });
});

test("a single item converts synchronously, with the dispatch in reach @unit", () => {
    const { r } = registry(GEO);
    expect(r.encodeItem(DOMAIN, "geo", { id: "a" }, { io: { backgroundId: "bg1" } })).toEqual({ wire: "a", slide: "bg1" });
    expect(r.decodeItem(DOMAIN, "geo", { wire: "a" })).toEqual({ id: "a" });
});

test("an unknown format, or an unsupported direction, is an error that says so @unit", async () => {
    const { r } = registry(BINARY);
    await expect(r.encode(DOMAIN, "nope", {})).rejects.toThrow(/Unknown format "nope"/);
    await expect(r.decode(DOMAIN, "bin", "x")).rejects.toThrow(/does not support decode/);
});

// ── detection ──────────────────────────────────────────────────────────────

test("the longest matching extension wins @unit", () => {
    const { r } = registry(NATIVE, GEO);
    expect(r.detect(DOMAIN, '{"type":"FeatureCollection","n":0}', { fileName: "Slide.GEO.JSON" })).toBe("geo");
});

test("content overrules a file name that lied @unit", () => {
    const { r } = registry(NATIVE, GEO);
    // A GeoJSON saved as plain `.json`: the name says native, the content says no.
    expect(r.detect(DOMAIN, '{"type":"FeatureCollection","n":0}', { fileName: "export.json" })).toBe("geo");
});

test("with no file name the best sniff wins, and nothing is guessed @unit", () => {
    const { r } = registry(NATIVE, GEO);
    expect(r.detect(DOMAIN, '{"native":true}')).toBe("native");
    expect(r.detect(DOMAIN, '{"something":"else"}')).toBeUndefined();
    expect(r.detect(DOMAIN, "<xml/>")).toBeUndefined();
});

test('decode "auto" reports which format it used @unit', async () => {
    const { r } = registry(NATIVE, GEO);
    const out = await r.decode(DOMAIN, "auto", '{"type":"FeatureCollection","n":1}');
    expect(out.format).toBe("geo");
    await expect(r.decode(DOMAIN, "auto", "<xml/>")).rejects.toThrow(/recognises/);
});

test('decode "auto" falls back when the likeliest format fails to read the data @unit', async () => {
    // The name says geo, the content does not say no — but geo cannot read it.
    const BROKEN_GEO = { ...GEO, sniff: undefined, decode: () => { throw new Error("not geo"); } };
    const UNSNIFFED = { domain: DOMAIN, id: "plain", title: "Plain", extensions: [".txt"], decode: (d) => ({ text: d }) };
    const { r } = registry(NATIVE, BROKEN_GEO, UNSNIFFED);
    const out = await r.decode(DOMAIN, "auto", '{"native":true}', { fileName: "x.geojson" });
    expect(out.format).toBe("native");
    // Nothing claims it: the formats with no sniff each get one attempt.
    const opaque = await r.decode(DOMAIN, "auto", "opaque", { fileName: "x.geojson" });
    expect(opaque.format).toBe("plain");
    // A format whose own sniff said no is never tried.
    const { r: strict } = registry(NATIVE, BROKEN_GEO);
    const err = await strict.decode(DOMAIN, "auto", "opaque", { fileName: "x.geojson" }).catch(e => e);
    expect(err.message).toMatch(/recognises/);
    expect(err.cause?.message).toBe("not geo");
});

// ── pipeline: formats per sink ─────────────────────────────────────────────

function exportPipeline({ bindings, sinks }) {
    const exports = [];
    const written = {};
    const invalid = [];
    const pipeline = new IOPipeline({
        POST_DATA: {},
        getConfig: () => ({ bindings: { annotations: { "bundle-export": bindings, "bundle-import": bindings } } }),
        notify: () => {},
    });
    pipeline.addHandler("io:invalid-binding", (e) => invalid.push(e));
    for (const f of [NATIVE, GEO, BINARY]) pipeline.formats.register(f);
    pipeline.registerOwner(OWNER, {
        ownerId: DOMAIN, xoType: "module", bundleScope: "global",
        exportBundle: async (ctx) => {
            exports.push(ctx.format?.id ?? "(default)");
            return `payload:${ctx.format?.id ?? "default"}:${ctx.format?.options?.precision ?? ""}`;
        },
        importBundle: async () => {},
    });
    for (const [id, formats] of Object.entries(sinks)) {
        pipeline.registerSink({
            id, supports: ["bundle"], ...(formats ? { formats } : {}),
            async writeBundle(ctx, payload) { written[id] = { payload, format: ctx.format?.id, ext: ctx.format?.fileExt }; return { ok: true }; },
        });
    }
    return { pipeline, exports, written, invalid };
}

test("each sink receives the format it takes, from one flush @unit", async () => {
    const { pipeline, exports, written } = exportPipeline({
        bindings: ["plain", "dicom-store", "geo-store"],
        sinks: { plain: undefined, "dicom-store": { annotations: ["bin"] }, "geo-store": { "*": ["geo"] } },
    });
    await pipeline.flushBundleExport({ skipFileFallback: true });
    expect(exports.sort()).toEqual(["(default)", "bin", "geo"]);
    expect(written.plain).toEqual({ payload: "payload:default:", format: undefined, ext: undefined });
    expect(written["dicom-store"].format).toBe("bin");
    // No binding options: the dispatch carries none. Declared defaults are the
    // registry's to apply at encode time, beneath the owner's own values.
    expect(written["geo-store"]).toEqual({ payload: "payload:geo:", format: "geo", ext: "geo.json" });
});

test("sinks sharing a format share one export @unit", async () => {
    const { pipeline, exports } = exportPipeline({
        bindings: ["a", "b", "c"],
        sinks: { a: undefined, b: undefined, c: { annotations: ["geo"] } },
    });
    await pipeline.flushBundleExport({ skipFileFallback: true });
    expect(exports.sort()).toEqual(["(default)", "geo"]);
});

test("a binding picks the format, and its options reach the owner @unit", async () => {
    const { pipeline, written } = exportPipeline({
        bindings: [{ sink: "plain", format: "geo", formatOptions: { precision: 7 } }],
        sinks: { plain: undefined },
    });
    await pipeline.flushBundleExport({ skipFileFallback: true });
    expect(written.plain.payload).toBe("payload:geo:7");
});

test("a sink is tried in the order it lists its formats, skipping unregistered ones @unit", async () => {
    const { pipeline, written } = exportPipeline({
        bindings: ["picky"],
        sinks: { picky: { annotations: ["not-registered", "geo", "native"] } },
    });
    await pipeline.flushBundleExport({ skipFileFallback: true });
    expect(written.picky.format).toBe("geo");
});

test("a sink whose required formats are all missing is declined, not fed the default @unit", async () => {
    const { pipeline, written, exports } = exportPipeline({
        bindings: ["picky"],
        sinks: { picky: { annotations: ["not-registered"] } },
    });
    const results = await pipeline.flushBundleExport({ skipFileFallback: true });
    expect(written.picky).toBeUndefined();
    expect(results.some(r => !r.ok)).toBe(true);
    // The owner was only asked for its default, to see whether anything was lost.
    expect(exports).toEqual(["(default)"]);
});

test("a binding with no formatOptions carries none, so it cannot shadow the owner's values @unit", () => {
    const { r } = registry(GEO);
    expect(r.descriptor(DOMAIN, "geo").options).toEqual({});
    expect(r.descriptor(DOMAIN, "geo", { precision: undefined, x: 1 }).options).toEqual({ x: 1 });
});

test("a binding format the sink does not take is declined at dispatch @unit", async () => {
    const { pipeline, written, exports } = exportPipeline({
        bindings: [{ sink: "dicom-store", format: "geo" }],
        sinks: { "dicom-store": { annotations: ["bin"] } },
    });
    const results = await pipeline.flushBundleExport({ skipFileFallback: true });
    expect(written["dicom-store"]).toBeUndefined();
    expect(exports).not.toContain("geo");
    expect(results.some(r => !r.ok)).toBe(true);
});

test("a binding format that is not registered is declined, not thrown on every flush @unit", async () => {
    const { pipeline, written } = exportPipeline({
        bindings: [{ sink: "plain", format: "not-registered" }],
        sinks: { plain: undefined },
    });
    const results = await pipeline.flushBundleExport({ skipFileFallback: true });
    expect(written.plain).toBeUndefined();
    expect(results.some(r => !r.ok)).toBe(true);
    // Registered later, it starts working.
    pipeline.formats.register({ ...NATIVE, id: "not-registered" });
    await pipeline.flushBundleExport({ skipFileFallback: true });
    expect(written.plain?.format).toBe("not-registered");
});

test("a binding format the sink does not take is reported at validation @unit", () => {
    const { pipeline, invalid } = exportPipeline({
        bindings: [{ sink: "dicom-store", format: "geo" }],
        sinks: { "dicom-store": { annotations: ["bin"] } },
    });
    pipeline.validateBindings();
    expect(invalid.some(e => e.sinkId === "dicom-store" && /takes only \[bin\]/.test(e.reason))).toBe(true);
});

test("{ext} in a path template follows the dispatch format @unit", () => {
    const { pipeline } = exportPipeline({ bindings: [], sinks: {} });
    const ctx = {
        direction: "export", capabilityId: "bundle-export", xoType: "module",
        ownerUid: OWNER, ownerId: DOMAIN, key: "", meta: {},
    };
    expect(pipeline.formatPath("a/{ownerId}.{ext}", ctx)).toBe("a/annotations.json");
    expect(pipeline.formatPath("a/{ownerId}.{ext}", { ...ctx, format: pipeline.formats.descriptor(DOMAIN, "bin") }))
        .toBe("a/annotations.dcm");
});

// ── pipeline: formats on the way back ──────────────────────────────────────

function restorePipeline(readResult, { sinkFormats, bindingFormat } = {}) {
    const imported = [];
    const pipeline = new IOPipeline({
        POST_DATA: {},
        getConfig: () => ({
            bindings: { annotations: { "bundle-import": [bindingFormat ? { sink: "store", format: bindingFormat } : "store"] } },
        }),
        notify: () => {},
    });
    for (const f of [NATIVE, GEO, BINARY]) pipeline.formats.register(f);
    pipeline.registerOwner(OWNER, {
        ownerId: DOMAIN, xoType: "module", bundleScope: "global",
        exportBundle: async () => undefined,
        importBundle: async (ctx, data) => { imported.push({ data, format: ctx.format?.id, meta: ctx.meta }); },
    });
    pipeline.registerCapability(OWNER, { id: "bundle-import", kind: "bundle" });
    pipeline.registerSink({
        id: "store", supports: ["bundle"], ...(sinkFormats ? { formats: sinkFormats } : {}),
        async readBundle() { return readResult; },
    });
    return { pipeline, imported };
}

test("a sink's own tag wins, and its meta reaches the owner @unit", async () => {
    const { pipeline, imported } = restorePipeline(
        { ok: true, payload: "bytes", format: "bin", meta: { pixelSpacing: 0.25 } },
        { sinkFormats: { annotations: ["geo"] } },
    );
    await pipeline.tryRestoreImport({ ownerUid: OWNER, trigger: "system" });
    expect(imported[0].format).toBe("bin");
    expect(imported[0].data).toBe("bytes");
    expect(imported[0].meta.pixelSpacing).toBe(0.25);
});

test("the legacy {format, meta, buffer} wrapper is still understood @unit", async () => {
    const { pipeline, imported } = restorePipeline(
        { ok: true, payload: { format: "bin", meta: { a: 1 }, buffer: "bytes" } });
    await pipeline.tryRestoreImport({ ownerUid: OWNER, trigger: "system" });
    expect(imported[0]).toMatchObject({ data: "bytes", format: "bin" });
    expect(imported[0].meta.a).toBe(1);
});

test("an untagged read takes the binding's format, then the sink's @unit", async () => {
    let run = restorePipeline({ ok: true, payload: "x" }, { bindingFormat: "geo", sinkFormats: { annotations: ["geo", "bin"] } });
    await run.pipeline.tryRestoreImport({ ownerUid: OWNER, trigger: "system" });
    expect(run.imported[0].format).toBe("geo");

    run = restorePipeline({ ok: true, payload: "x" }, { sinkFormats: { annotations: ["bin"] } });
    await run.pipeline.tryRestoreImport({ ownerUid: OWNER, trigger: "system" });
    expect(run.imported[0].format).toBe("bin");
});

test("an untagged read from a format-agnostic sink is detected, or left to the owner @unit", async () => {
    let run = restorePipeline({ ok: true, payload: '{"type":"FeatureCollection","n":0}' });
    await run.pipeline.tryRestoreImport({ ownerUid: OWNER, trigger: "system" });
    expect(run.imported[0].format).toBe("geo");

    run = restorePipeline({ ok: true, payload: "opaque" });
    await run.pipeline.tryRestoreImport({ ownerUid: OWNER, trigger: "system" });
    expect(run.imported[0].format).toBeUndefined();
});

test("session-memory remembers the format a payload was written in @unit", async () => {
    const sink = makeSessionMemorySink();
    const ctx = { ownerUid: OWNER, key: "v1::bg1" };
    await sink.writeBundle({ ...ctx, format: { id: "geo" } }, "data");
    expect(await sink.readBundle(ctx)).toEqual({ ok: true, payload: "data", format: "geo" });
    await sink.writeBundle(ctx, "plain");
    expect(await sink.readBundle(ctx)).toEqual({ ok: true, payload: "plain" });
});

test("a user-picked file is detected from its name and content @unit", async () => {
    const { pipeline, imported } = restorePipeline({ ok: true });
    await pipeline.importBundle('{"type":"FeatureCollection","n":0}', { ownerUid: OWNER, fileName: "a.geojson" });
    expect(imported[0].format).toBe("geo");
    expect(imported[0].meta.fileName).toBe("a.geojson");
    await pipeline.importBundle("anything", { ownerUid: OWNER, format: "native" });
    expect(imported[1].format).toBe("native");
});

// ── format-agnostic sinks: the sink's own config pin and the owner default ──
//
// A plain binding (`["github"]`) plus the sink's module config used to have no
// way to pick a format: no `ctx.format` reached the owner, and annotations fell
// back to the user's download-dialog choice — so what was stored followed a UI
// preference. Now the sink reports its config pin (`preferredFormat`), and with
// none the pipeline hands over the owner's DEPLOYMENT default.

const { pinnedFormatFrom } = await import("../../../src/classes/io/io-pipeline.ts");

function agnosticPipeline({ bindings = ["store"], pin, ownerDefault, sinkRoute, readResult } = {}) {
    const exports = [];
    const written = {};
    const imported = [];
    const pipeline = new IOPipeline({
        POST_DATA: {},
        getConfig: () => ({ bindings: { annotations: { "bundle-export": bindings, "bundle-import": bindings } } }),
        notify: () => {},
    });
    for (const f of [NATIVE, GEO, BINARY]) pipeline.formats.register(f);
    pipeline.registerOwner(OWNER, {
        ownerId: DOMAIN, xoType: "module", bundleScope: "global",
        exportBundle: async (ctx) => {
            exports.push({ format: ctx.format?.id ?? "(default)", route: ctx.route ?? "sink" });
            return `payload:${ctx.format?.id ?? "default"}:${ctx.format?.options?.precision ?? ""}`;
        },
        importBundle: async (ctx, data) => { imported.push({ data, format: ctx.format?.id }); },
        ...(ownerDefault !== undefined ? { defaultFormat: () => ownerDefault } : {}),
    });
    pipeline.registerCapability(OWNER, { id: "bundle-import", kind: "bundle" });
    pipeline.registerSink({
        id: "store", supports: ["bundle"], ...(sinkRoute ? { route: sinkRoute } : {}),
        preferredFormat: (domain, ctx) => pinnedFormatFrom({ formats: pin }, domain),
        async writeBundle(ctx, payload) { written.store = { payload, format: ctx.format?.id }; return { ok: true }; },
        async readBundle() { return readResult ?? { ok: true }; },
    });
    return { pipeline, exports, written, imported };
}

test("pinnedFormatFrom reads an id, {id, options}, and the '*' fallback @unit", () => {
    expect(pinnedFormatFrom({ formats: { annotations: "geo" } }, DOMAIN)).toBe("geo");
    expect(pinnedFormatFrom({ formats: { annotations: { id: "geo", options: { precision: 2 } } } }, DOMAIN))
        .toEqual({ id: "geo", options: { precision: 2 } });
    expect(pinnedFormatFrom({ formats: { "*": "native", other: "geo" } }, DOMAIN)).toBe("native");
    expect(pinnedFormatFrom({ formats: { "*": "native", annotations: "geo" } }, DOMAIN)).toBe("geo");
    for (const bad of [undefined, null, {}, { formats: [] }, { formats: { annotations: 5 } },
        { formats: { annotations: { options: {} } } }, { formats: { annotations: "" } }]) {
        expect(pinnedFormatFrom(bad, DOMAIN)).toBeUndefined();
    }
});

test("a sink's own config pin selects the format of a plain binding @unit", async () => {
    const { pipeline, written, exports } = agnosticPipeline({
        pin: { annotations: { id: "geo", options: { precision: 5 } } }, ownerDefault: "native" });
    await pipeline.flushBundleExport({ skipFileFallback: true });
    expect(written.store).toEqual({ payload: "payload:geo:5", format: "geo" });
    expect(exports).toEqual([{ format: "geo", route: "sink" }]);
});

test("a binding's format beats the sink's config pin @unit", async () => {
    const { pipeline, written } = agnosticPipeline({
        bindings: [{ sink: "store", format: "bin" }], pin: { annotations: "geo" } });
    await pipeline.flushBundleExport({ skipFileFallback: true });
    expect(written.store.format).toBe("bin");
});

test("a sink config pin naming an unregistered format declines the sink @unit", async () => {
    const { pipeline, written } = agnosticPipeline({ pin: { annotations: "nope" }, ownerDefault: "native" });
    const results = await pipeline.flushBundleExport({ skipFileFallback: true });
    expect(written.store).toBeUndefined();
    expect(results.some(r => !r.ok)).toBe(true);
});

test("unpinned, a format-agnostic sink gets the owner's deployment default @unit", async () => {
    const { pipeline, written, exports } = agnosticPipeline({ ownerDefault: "native" });
    await pipeline.flushBundleExport({ skipFileFallback: true });
    expect(written.store.format).toBe("native");
    expect(exports).toEqual([{ format: "native", route: "sink" }]);
});

test("an unregistered owner default leaves the choice to the owner, as before @unit", async () => {
    const { pipeline, written } = agnosticPipeline({ ownerDefault: "not-registered" });
    await pipeline.flushBundleExport({ skipFileFallback: true });
    expect(written.store.format).toBeUndefined();
});

test("a local-route sink is asked with route 'local', so the owner may use the user's choice @unit", async () => {
    const { pipeline, exports } = agnosticPipeline({ sinkRoute: "local" });
    await pipeline.flushBundleExport({ skipFileFallback: true });
    expect(exports).toEqual([{ format: "(default)", route: "local" }]);
});

test("a restore under the owner default detects first, so older data still loads @unit", async () => {
    // Stored as geo before the default (native) was handed over.
    let run = agnosticPipeline({ ownerDefault: "native",
        readResult: { ok: true, payload: '{"type":"FeatureCollection","n":0}' } });
    await run.pipeline.tryRestoreImport({ ownerUid: OWNER, trigger: "system" });
    expect(run.imported[0].format).toBe("geo");

    // Nothing recognises it: the default is the last resort.
    run = agnosticPipeline({ ownerDefault: "native", readResult: { ok: true, payload: "opaque" } });
    await run.pipeline.tryRestoreImport({ ownerUid: OWNER, trigger: "system" });
    expect(run.imported[0].format).toBe("native");

    // A sink config pin is trusted ahead of detection, like a binding.
    run = agnosticPipeline({ pin: { annotations: "native" },
        readResult: { ok: true, payload: '{"type":"FeatureCollection","n":0}' } });
    await run.pipeline.tryRestoreImport({ ownerUid: OWNER, trigger: "system" });
    expect(run.imported[0].format).toBe("native");
});
