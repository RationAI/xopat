/**
 * A background entry carries its own `visualizationIndex`, and the open pipeline
 * seeds `event.visualizationIndex` from it. After a slide change that seed is the
 * PREVIOUS slide's — so a handler that has no overlays to offer must say so, or
 * the old visualization rides along onto the new slide.
 *
 * It cannot say so by staying silent: the pipeline treats `undefined` as "no
 * opinion" and keeps the seed, and only an explicit `null` as "no visualization
 * for this slide". Left unsaid, the generated overlay visualization stays
 * mounted while its shaders still reference the *other* series' `config.data`
 * entries — the previous slide's masks keep drawing over a background that has
 * lost its own layer.
 *
 * What is pinned here is that boundary: our own generated overlays are dropped
 * when they belong to a different slide, and nothing else is ever touched — an
 * author-written visualization is not ours to clear.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.OpenSeadragon = globalThis.OpenSeadragon || { TileSource: class {} };
globalThis.HTTPError = globalThis.HTTPError || class HTTPError extends Error {};
globalThis.XOpatPlugin = globalThis.XOpatPlugin || class {};
globalThis.VIEWER_MANAGER = globalThis.VIEWER_MANAGER || { addHandler() {} };
globalThis.APPLICATION_CONTEXT = globalThis.APPLICATION_CONTEXT || { config: {} };
globalThis.window = globalThis.window || globalThis;
globalThis.window.SLIDE_PROTOCOLS = globalThis.window.SLIDE_PROTOCOLS || { register() {} };

let Captured = null;
globalThis.addPlugin = (id, cls) => { if (id === "dicom") Captured = cls; };

// A distinct specifier — see the note in `dataid-completion.test.mjs`: the
// plugin's `addPlugin` registration is an import side effect and fires once per
// module instance, so sharing the plain path across suites is a race.
await import("../../index.workspace.mjs?overlay-inheritance");

const STUDY = "1.2.840.999";
const SLIDE_A = "1.2.840.999.1";
const SLIDE_B = "1.2.840.999.2";

const marker = () => Captured.OVERLAY_MARKER;

/** A visualization this plugin generated for `seriesUID`. */
const generated = (seriesUID) => ({ name: `overlays for ${seriesUID}`, shaders: {}, [marker()]: seriesUID });

/** A visualization somebody wrote by hand — no marker, never ours to clear. */
const authored = () => ({ name: "author's own", shaders: {} });

/**
 * The real method against a `this` carrying only what it touches.
 * `_buildOverlayVisualization` returns null — "this slide has no derived
 * objects", the case the inheritance bug was found in.
 */
function attach(event, id, { visualizations = [], built = null } = {}) {
    globalThis.APPLICATION_CONTEXT.config = { visualizations };
    const self = {
        constructor: Captured,
        _buildOverlayVisualization: async () => built,
    };
    return Captured.prototype.attachDerivedOverlays.call(self, event, id, "auto");
}

test("a previous slide's generated overlays are dropped, not inherited @unit", async () => {
    const event = { visualizationIndex: 0, background: { name: "Slide B" } };

    await attach(event, { studyUID: STUDY, seriesUID: SLIDE_B, role: "wsi" },
        { visualizations: [generated(SLIDE_A)] });

    // null, not undefined: undefined is "no opinion" and keeps the seed.
    expect(event.visualizationIndex).toBe(null);
});

test("this slide's own generated overlays are reused, never re-appended @unit", async () => {
    const event = { visualizationIndex: 0, background: { name: "Slide A" } };

    await attach(event, { studyUID: STUDY, seriesUID: SLIDE_A, role: "wsi" },
        { visualizations: [generated(SLIDE_A)] });

    expect(event.visualizationIndex).toBe(0);
});

test("an author-written visualization is left alone @unit", async () => {
    const event = { visualizationIndex: 0, background: { name: "Slide B" } };

    await attach(event, { studyUID: STUDY, seriesUID: SLIDE_B, role: "wsi" },
        { visualizations: [authored()] });

    // Not ours to clear — the session asked for it deliberately.
    expect(event.visualizationIndex).toBe(0);
});

test("a background with no seeded visualization gains no spurious null @unit", async () => {
    const event = { background: { name: "Slide B" } };

    await attach(event, { studyUID: STUDY, seriesUID: SLIDE_B, role: "wsi" },
        { visualizations: [generated(SLIDE_A)] });

    expect(event.visualizationIndex).toBe(undefined);
});

test("opening a derived series as its own background drops the inherited overlays @unit", async () => {
    // Roles other than wsi/radiology return early — that path seeds the same
    // stale index and must clear it too.
    const event = { visualizationIndex: 0, background: { name: "The SEG itself" } };

    await attach(event, { studyUID: STUDY, seriesUID: "1.2.840.999.9", role: "seg" },
        { visualizations: [generated(SLIDE_A)] });

    expect(event.visualizationIndex).toBe(null);
});

test("a session that asked for no overlays at all is not touched @unit", async () => {
    const event = { visualizationIndex: 0, background: { name: "Slide B" } };
    globalThis.APPLICATION_CONTEXT.config = { visualizations: [generated(SLIDE_A)] };

    // `requested` falsy: the caller never opted in, so this handler has no
    // opinion about the slide's visualization.
    await Captured.prototype.attachDerivedOverlays.call(
        { constructor: Captured }, event, { studyUID: STUDY, seriesUID: SLIDE_B, role: "wsi" }, undefined);

    expect(event.visualizationIndex).toBe(0);
});
