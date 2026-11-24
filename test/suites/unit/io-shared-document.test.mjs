/**
 * Two viewports showing the same slide share one bundle key.
 *
 * `ctx.viewerId` is the viewer's `uniqueId`, which is derived from the slide —
 * so it names the DOCUMENT, not a viewport. The pipeline used to treat it as
 * both, and an owner holding per-viewport state (the annotations canvas) could
 * only resolve "the first viewer with that id":
 *
 *   - the second viewport's restore was skipped as "already hydrated", or, when
 *     it ran first, wiped and filled the FIRST viewport's canvas;
 *   - the document was exported once per viewport under the same key, every
 *     pass reading the first viewport.
 *
 * A dispatch now names its viewport in `ctx.viewportId` (`viewer.id`). An
 * export is written once, from the document's primary (first) viewport. A
 * restore is delivered once to every viewport showing the document — but only
 * for an owner that declares `perViewport`. An owner keyed by the document
 * holds one copy: a second delivery would replace what the user changed since
 * the first, so it gets exactly one. The key is unchanged — slot ids do not
 * survive a reload.
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

/**
 * A slide-aware owner bound to one readable sink, and a viewer manager holding
 * `viewers` (`{ id, uniqueId, bg }`). `viewers` is live: tests mutate it.
 * `perViewport` is what the annotations module declares (a canvas per
 * viewport); `false` is every owner that keys its state by the document.
 */
function sharedPipeline(viewers, { perViewport = true } = {}) {
    const imported = [];
    const exported = [];
    const written = [];
    const previousUtilities = globalThis.UTILITIES;
    globalThis.UTILITIES = { currentBackgroundIdFor: (viewer) => viewer?.bg };
    const pipeline = new IOPipeline({
        POST_DATA: {},
        getConfig: () => ({ bindings: { annotations: { "bundle-export": ["store"], "bundle-import": ["store"] } } }),
        getViewers: () => viewers.map(v => ({ uniqueId: v.uniqueId, viewer: v })),
        notify: () => {},
    });
    pipeline.registerOwner(OWNER, {
        ownerId: "annotations", xoType: "module", bundleScope: "per-viewer-background", perViewport,
        exportBundle: async (ctx) => { exported.push(ctx.viewportId); return `state of ${ctx.viewportId}`; },
        importBundle: async (ctx, data) => { imported.push({ slot: ctx.viewportId, key: ctx.key, data }); },
    });
    pipeline.registerSink({
        id: "store", supports: ["bundle"],
        async writeBundle(ctx, payload) { written.push({ key: ctx.key, payload }); return { ok: true }; },
        async readBundle() { return { ok: true, payload: "stored" }; },
    });
    const restore = () => { globalThis.UTILITIES = previousUtilities; };
    return { pipeline, imported, exported, written, restore };
}

const twoOnOneSlide = () => [
    { id: "osd-0", uniqueId: "slide-a", bg: "slide-a" },
    { id: "osd-1", uniqueId: "slide-a", bg: "slide-a" },
];

test("each viewport showing a slide gets its restore, under the shared key @unit", async () => {
    const viewers = twoOnOneSlide();
    const { pipeline, imported, restore } = sharedPipeline(viewers);
    try {
        // What the loader's boot pass does: one call per viewer, naming it.
        for (const v of viewers) {
            await pipeline.tryRestoreImport({ viewerId: v.uniqueId, viewportId: v.id, trigger: "system" });
        }
        expect(imported).toEqual([
            { slot: "osd-0", key: "slide-a::slide-a", data: "stored" },
            { slot: "osd-1", key: "slide-a::slide-a", data: "stored" },
        ]);
    } finally { restore(); }
});

test("a viewport is hydrated once, whoever asks and however @unit", async () => {
    const viewers = twoOnOneSlide();
    const { pipeline, imported, restore } = sharedPipeline(viewers);
    try {
        const slot = { viewerId: "slide-a", viewportId: "osd-0", backgroundId: "slide-a", trigger: "system" };
        await pipeline.tryRestoreImport(slot);
        await pipeline.tryRestoreImport(slot);
        // A caller that names no viewport reaches every one showing the slide —
        // and still skips the one already hydrated.
        await pipeline.tryRestoreImport({ viewerId: "slide-a", backgroundId: "slide-a", trigger: "system" });
        expect(imported.map(i => i.slot)).toEqual(["osd-0", "osd-1"]);
    } finally { restore(); }
});

test("viewerFor resolves the named viewport, else the first one showing the slide @unit", async () => {
    const viewers = twoOnOneSlide();
    const { pipeline, restore } = sharedPipeline(viewers);
    try {
        expect(pipeline.viewerFor({ viewerId: "slide-a", viewportId: "osd-1" })).toBe(viewers[1]);
        expect(pipeline.viewerFor({ viewerId: "slide-a" })).toBe(viewers[0]);
        // A named viewport that is gone is not replaced by its sibling.
        expect(pipeline.viewerFor({ viewerId: "slide-a", viewportId: "osd-9" })).toBeUndefined();
        expect(pipeline.viewerFor(undefined)).toBeUndefined();
    } finally { restore(); }
});

test("a shared document is exported once, from its primary viewport @unit", async () => {
    const viewers = twoOnOneSlide();
    const { pipeline, exported, written, restore } = sharedPipeline(viewers);
    try {
        await pipeline.flushBundleExport({ ownerUid: OWNER });
        expect(exported).toEqual(["osd-0"]);
        expect(written).toEqual([{ key: "slide-a::slide-a", payload: "state of osd-0" }]);
    } finally { restore(); }
});

test("one viewport leaving re-arms only its own hydration @unit", async () => {
    const viewers = twoOnOneSlide();
    const { pipeline, imported, exported, restore } = sharedPipeline(viewers);
    try {
        for (const v of viewers) {
            await pipeline.tryRestoreImport({ viewerId: v.uniqueId, viewportId: v.id, trigger: "system" });
        }
        // osd-1 navigates away: the slide-leave flush names the leaving viewport.
        await pipeline.flushBundleExport({
            ownerUid: OWNER, viewerId: "slide-a", viewportId: "osd-1", backgroundId: "slide-a", trigger: "system",
        });
        // The document is still written from the primary viewport, which stays.
        expect(exported).toEqual(["osd-0"]);

        imported.length = 0;
        const again = { viewerId: "slide-a", backgroundId: "slide-a", trigger: "system" };
        await pipeline.tryRestoreImport({ ...again, viewportId: "osd-0" });
        expect(imported, "the viewport that stayed is not re-imported (it would be wiped)").toEqual([]);
        await pipeline.tryRestoreImport({ ...again, viewportId: "osd-1" });
        expect(imported.map(i => i.slot), "the one that left hydrates again on return").toEqual(["osd-1"]);
    } finally { restore(); }
});

test("distinct slides are untouched by any of this @unit", async () => {
    const viewers = [
        { id: "osd-0", uniqueId: "slide-a", bg: "slide-a" },
        { id: "osd-1", uniqueId: "slide-b", bg: "slide-b" },
    ];
    const { pipeline, imported, exported, written, restore } = sharedPipeline(viewers);
    try {
        for (const v of viewers) {
            await pipeline.tryRestoreImport({ viewerId: v.uniqueId, viewportId: v.id, trigger: "system" });
        }
        await pipeline.flushBundleExport({ ownerUid: OWNER });
        expect(imported.map(i => i.key)).toEqual(["slide-a::slide-a", "slide-b::slide-b"]);
        expect(exported).toEqual(["osd-0", "osd-1"]);
        expect(written.map(w => w.key)).toEqual(["slide-a::slide-a", "slide-b::slide-b"]);
    } finally { restore(); }
});

// ── owners keyed by the document (the default) ───────────────────────────────
//
// `plugins/slide-scoring` keeps one record per (viewerId, backgroundId). Its
// `importBundle` overwrites that record, so a restore fired because a SECOND
// viewport opened the slide would discard a score the user had just changed.

const SHARED = { viewerId: "slide-a", backgroundId: "slide-a", trigger: "system" };

test("a per-document owner is imported once, however many viewports show the slide @unit", async () => {
    const viewers = twoOnOneSlide();
    const { pipeline, imported, restore } = sharedPipeline(viewers, { perViewport: false });
    try {
        // Boot pass, then each viewport's own slide-open restore.
        for (const v of viewers) {
            await pipeline.tryRestoreImport({ viewerId: v.uniqueId, viewportId: v.id, trigger: "system" });
        }
        for (const v of viewers) await pipeline.tryRestoreImport({ ...SHARED, viewportId: v.id });
        await pipeline.tryRestoreImport(SHARED);
        expect(imported.length).toBe(1);
        expect(imported[0].key).toBe("slide-a::slide-a");
    } finally { restore(); }
});

test("a per-document owner is not re-imported while another viewport still shows the slide @unit", async () => {
    const viewers = twoOnOneSlide();
    const { pipeline, imported, restore } = sharedPipeline(viewers, { perViewport: false });
    try {
        await pipeline.tryRestoreImport({ ...SHARED, viewportId: "osd-0" });
        imported.length = 0;

        // osd-1 leaves the slide, then comes back; osd-0 never left.
        await pipeline.flushBundleExport({ ownerUid: OWNER, ...SHARED, viewportId: "osd-1" });
        viewers[1].bg = "slide-b"; viewers[1].uniqueId = "slide-b";
        viewers[1].bg = "slide-a"; viewers[1].uniqueId = "slide-a";
        await pipeline.tryRestoreImport({ ...SHARED, viewportId: "osd-1" });
        expect(imported, "the shared copy is still in use and must not be replaced").toEqual([]);
    } finally { restore(); }
});

test("a per-document owner restores again once the last viewport has left @unit", async () => {
    const viewers = [{ id: "osd-0", uniqueId: "slide-a", bg: "slide-a" }];
    const { pipeline, imported, restore } = sharedPipeline(viewers, { perViewport: false });
    try {
        await pipeline.tryRestoreImport({ ...SHARED, viewportId: "osd-0" });
        await pipeline.flushBundleExport({ ownerUid: OWNER, ...SHARED, viewportId: "osd-0" });
        await pipeline.tryRestoreImport({ ...SHARED, viewportId: "osd-0" });
        expect(imported.length).toBe(2);
    } finally { restore(); }
});

test("closing a viewport keeps a per-document owner hydrated for the one that remains @unit", async () => {
    const viewers = twoOnOneSlide();
    const { pipeline, imported, restore } = sharedPipeline(viewers, { perViewport: false });
    try {
        await pipeline.tryRestoreImport({ ...SHARED, viewportId: "osd-0" });
        imported.length = 0;

        viewers.pop(); // osd-1 destroyed — what the viewer manager then reports:
        pipeline.clearHydratedFor("slide-a", "osd-1");
        await pipeline.tryRestoreImport({ ...SHARED, viewportId: "osd-0" });
        expect(imported, "osd-0 is still working on that copy").toEqual([]);

        viewers.pop(); // osd-0 destroyed too: nobody holds it any more
        pipeline.clearHydratedFor("slide-a", "osd-0");
        viewers.push({ id: "osd-2", uniqueId: "slide-a", bg: "slide-a" });
        await pipeline.tryRestoreImport({ ...SHARED, viewportId: "osd-2" });
        expect(imported.length, "a later viewport on the same slide restores from the sinks").toBe(1);
    } finally { restore(); }
});
