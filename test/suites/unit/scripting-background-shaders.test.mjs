/**
 * A slide's own rendering lives in `background[i].shaders`, not in a visualization.
 *
 * A fluorescence slide is the reference case: one `single_channel` background layer per
 * channel and `visualizationIndex: null`. The `visualization` scripting namespace could
 * only add/update VISUALIZATIONS and hid background layers entirely, so "make the channels
 * red, blue and yellow" had exactly one expressible answer — add three new layers. They
 * were drawn on top of the three existing ones: six layers, none of the originals changed.
 *
 * Pinned here: the background layers are readable, one of them can be patched in place,
 * and nothing else in the session moves when that happens.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
// Globals are shared by every suite a worker runs, so nothing here replaces one that is
// already installed — same stubs, same shapes, as the suites that got there first.
globalThis.window.$ = globalThis.window.$ ?? { t: (key) => String(key).split(".").pop() };
globalThis.$ = globalThis.window.$;

/** `OpenSeadragon.extend(true, target, ...sources)` — the deep merge the API relies on. */
function deepExtend(deep, target, ...sources) {
    for (const source of sources) {
        for (const [key, value] of Object.entries(source || {})) {
            if (value === undefined) continue;
            const plain = value && typeof value === "object" && !Array.isArray(value);
            target[key] = plain
                ? deepExtend(deep, target[key] && typeof target[key] === "object" ? target[key] : {}, value)
                : (Array.isArray(value) ? value.slice() : value);
        }
    }
    return target;
}
globalThis.window.OpenSeadragon = globalThis.window.OpenSeadragon ?? globalThis.OpenSeadragon ?? {
    converter: { copyings: {}, destructors: {} },
    TileSource: class { constructor(options) { Object.assign(this, options || {}); } },
};
globalThis.window.OpenSeadragon.extend ??= deepExtend;
globalThis.OpenSeadragon = globalThis.window.OpenSeadragon;

const channel = (base) => ({ type: "single_channel", params: { use_channel_base0: base, use_gamma: 2 } });

/** The session from the report, plus a second viewer so "nothing else moves" means something. */
function install() {
    const background = [
        { id: "fluo", fill: "#000000FF", visualizationIndex: null, dataReference: 0,
          shaders: [channel(0), channel(1), channel(2)] },
        { id: "he", dataReference: 1, visualizationIndex: 0 },
    ];
    // A value the user set on the slider: it lives in the cache and outranks `params`.
    background[0].shaders[1].cache = { single_channel: { use_gamma: 5, color: "#00ff00" } };

    const opened = [];
    const viewers = [{ uniqueId: "fluo" }, { uniqueId: "he" }];
    globalThis.APPLICATION_CONTEXT = globalThis.window.APPLICATION_CONTEXT = {
        url: "http://localhost/",
        config: {
            data: ["fluo.ome.tif", "he.tif"],
            background,
            visualizations: [{ name: "overlay", shaders: { heat: { type: "heatmap" } } }],
        },
        getOption: (key, def) => (key === "activeBackgroundIndex" ? [0, 1] : def),
        openViewerWith: async (...args) => { opened.push(args); return true; },
    };
    globalThis.VIEWER_MANAGER = globalThis.window.VIEWER_MANAGER = {
        viewers,
        getViewerSlotIndex: (viewer) => viewers.indexOf(viewer),
    };
    return { opened, viewers };
}
install();

const { XOpatVisualizationScriptApi } = await import("../../../src/classes/scripting/visualization-api.ts");

/** A script context bound to one viewer, with consent pre-granted. */
const api = (viewerId, { sensitiveAllowed = true } = {}) =>
    new XOpatVisualizationScriptApi("visualization").bindInvocationContext({
        scriptingContext: {
            id: "test-context",
            getActiveViewerContextId: () => viewerId,
            setActiveViewerContextId() {},
            isConsentDialogBypassed: () => true,
            setBypassConsentDialog() {},
            mayExposeSensitiveData: () => sensitiveAllowed,
        },
    });

test("the slide's own layers are readable, addressed by position @unit", () => {
    install();
    const layers = api("fluo").getBackgroundShaders();

    expect(layers.map((layer) => layer.type)).toEqual(["single_channel", "single_channel", "single_channel"]);
    expect(layers.map((layer) => layer.params.use_channel_base0)).toEqual([0, 1, 2]);
    // The renderer id is derived from the background id (i.e. from the slide's path).
    expect(layers.every((layer) => !("id" in layer))).toBe(true);
});

test("a background with no declared shaders still has its implicit layer 0 @unit", () => {
    install();
    expect(api("he").getBackgroundShaders()).toEqual([{ type: "identity" }]);
});

test("patching one channel changes that layer and nothing else @unit", async () => {
    const { opened } = install();
    const before = JSON.stringify(globalThis.APPLICATION_CONTEXT.config);

    await api("fluo").updateBackgroundShaderAt(1, { params: { color: "#0000ff", use_gamma: 1 } });

    expect(opened.length).toBe(1);
    const [data, background, visualizations, activeBackground] = opened[0];
    const layers = background[0].shaders;

    // Still three layers — restyled, not stacked.
    expect(layers.length).toBe(3);
    expect(layers[1].params).toEqual({ use_channel_base0: 1, use_gamma: 1, color: "#0000ff" });
    // The cached slider values would have outranked the patch; they are gone for the keys
    // the patch named.
    expect(layers[1].cache).toEqual({ single_channel: {} });
    expect(layers[0]).toEqual(channel(0));
    expect(layers[2]).toEqual(channel(2));

    // The other viewer's background, the visualizations, the data and the slot mapping are
    // handed back as they were.
    expect(background[1]).toBe(globalThis.APPLICATION_CONTEXT.config.background[1]);
    expect(visualizations).toBe(globalThis.APPLICATION_CONTEXT.config.visualizations);
    expect(data).toBe(globalThis.APPLICATION_CONTEXT.config.data);
    expect(activeBackground).toEqual([0, 1]);
    // The live config is only ever changed by the open pipeline, never patched in place.
    expect(JSON.stringify(globalThis.APPLICATION_CONTEXT.config)).toBe(before);
});

test("changing the shader type replaces the layer instead of merging old controls @unit", async () => {
    const { opened } = install();

    await api("fluo").updateBackgroundShaderAt(1, { type: "heatmap", params: { color: "#ff0000" } });

    expect(opened[0][1][0].shaders[1]).toEqual({ type: "heatmap", params: { color: "#ff0000" } });
});

test("an index outside the background's layers is refused before anything is asked @unit", async () => {
    const { opened } = install();

    await expect(api("fluo").updateBackgroundShaderAt(3, { params: {} })).rejects.toThrow(/0\.\.2/);
    expect(opened.length).toBe(0);
});
