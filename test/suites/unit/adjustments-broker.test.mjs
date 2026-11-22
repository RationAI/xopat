/**
 * APPLICATION_CONTEXT.adjustments — the broker between the display-adjustment UI
 * and the renderer's per-layer module pipeline (UPSTREAM.md, "a pre/post module
 * pipeline on every shader layer").
 *
 * The renderer here is a fake of the vendored contract (`resetPipeline`,
 * `getPipelineControl`, `invalidate`, `getAllShaders`, `ShaderModuleRegistry`)
 * plus the requested transient `setPipelineBypass`, so these vectors pin
 * xOpat's side of it:
 *  - a write inserts only the nodes it needs, in canonical chain order, and that
 *    insert is the ONE rebuild — later writes are uniform updates (`control.set`);
 *  - inserted nodes carry identity params (invert's module default is a full
 *    inversion), ranges come from the module registry, value writes redraw;
 *  - reset removes only xOpat's own nodes and their cached values;
 *  - before/after is a no-op without the transient bypass, and covers every
 *    shader (group children included) when it exists;
 *  - without renderer support every adjustment write is refused (sampling is not);
 *  - sampling lands on the data item and on the live drawer;
 *  - linked viewers mirror writes by background position;
 *  - percentiles for Auto levels.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

const { Adjustments } = await import("../../../src/classes/app/adjustments.ts");

function makeRenderer(layers) {
    const configs = Object.fromEntries(layers.map(([id, cfg]) => [id, cfg]));
    const shaders = {};
    const stats = { resets: 0, sets: 0, invalidates: 0 };
    for (const id of Object.keys(configs)) {
        const shader = {
            controls: {},
            bypassed: false,
            invalidate() { stats.invalidates++; },
            setPipelineBypass(on) { this.bypassed = on; },
            resetPipeline(params) {
                stats.resets++;
                const next = {};
                for (const node of params?.pipeline?.post || []) {
                    for (const ctl of ["black", "white", "gamma", "brightness", "contrast", "saturation", "hue", "temperature", "tint", "amount"]) {
                        const key = `${node.id}.${ctl}`;
                        next[key] = this.controls[key] || {
                            encodedValue: undefined,
                            set(v) { this.encodedValue = v; stats.sets++; },
                        };
                    }
                }
                this.controls = next;
            },
            getPipelineControl(stage, node, ctl) {
                return stage === "post" ? this.controls[`${node}.${ctl}`] : undefined;
            },
        };
        shaders[id] = shader;
    }
    return {
        stats,
        shaders,
        getShaderLayerOrder: () => Object.keys(configs),
        getShaderLayerConfig: (id) => configs[id],
        getShaderLayer: (id) => shaders[id],
        getAllShaders: () => shaders,
    };
}

function makeViewer(name, layers, bgCount = 1) {
    const renderer = makeRenderer(layers);
    let rebuilds = 0;
    const smoothing = new Map();
    const minify = new Map();
    const items = [{ getConfig: (t) => (t === "background" ? { dataReference: 0 } : undefined) }];
    return {
        uniqueId: name,
        __shaderNamespace: `${name}_`,
        __bgCount: bgCount,
        drawer: {
            renderer,
            rebuild() { rebuilds++; },
            setTiledImageSmoothingEnabled: (item, v) => smoothing.set(item, v),
            setTiledImageMinificationFilter: (item, v) => minify.set(item, v),
        },
        world: { getItemCount: () => items.length, getItemAt: (i) => items[i] },
        forceRedraw() {},
        get rebuilds() { return rebuilds; },
        smoothing, minify, items,
    };
}

function installGlobals(viewers, { supported = true, bypass = true, modules = {} } = {}) {
    const ShaderLayer = function () {};
    if (supported) ShaderLayer.prototype.resetPipeline = function () {};
    if (bypass) ShaderLayer.prototype.setPipelineBypass = function () {};
    const cache = new Map();
    const ShaderModuleRegistry = { get: (type) => modules[type] };
    window.OpenSeadragon = { FlexRenderer: { ShaderLayer, ShaderModuleRegistry } };
    window.VIEWER_MANAGER = { viewers };
    window.UTILITIES = {
        emitted: [],
        getBackgroundShaderSplitIndex: (viewer) => viewer.__bgCount,
        _emitShaderConfigUpdate(viewer, layerId, change) { this.emitted.push({ viewer, layerId, change }); },
        scheduleSessionUrlSync() {},
    };
    window.APPLICATION_CONTEXT = {
        config: { data: ["slide.tiff"] },
        AppCache: { get: (k, d) => (cache.has(k) ? cache.get(k) : d), set: (k, v) => cache.set(k, v) },
    };
}

const bgLayer = () => ["v1_bg", { type: "identity", name: "Slide", tiledImages: [0], params: {}, cache: {} }];

test("a write inserts nodes in chain order and rebuilds once", { tag: ["@unit"] }, () => {
    const viewer = makeViewer("v1", [bgLayer()]);
    installGlobals([viewer]);
    const adjustments = new Adjustments();

    expect(adjustments.set(viewer, "v1_bg", { saturation: 1.5, black: 0.1 })).toBe(true);
    const config = viewer.drawer.renderer.getShaderLayerConfig("v1_bg");
    expect(config.params.pipeline.post.map(n => n.id)).toEqual(["xadj_levels", "xadj_saturation"]);
    expect(viewer.rebuilds).toBe(1);
    expect(adjustments.get(viewer, "v1_bg").saturation).toBe(1.5);
    expect(window.UTILITIES.emitted).toHaveLength(1);

    // Same node again: a uniform update, no rebuild, no structural emit.
    adjustments.set(viewer, "v1_bg", { white: 0.8, saturation: 0.5 });
    expect(viewer.rebuilds).toBe(1);
    expect(window.UTILITIES.emitted).toHaveLength(1);
    expect(adjustments.get(viewer, "v1_bg")).toMatchObject({ black: 0.1, white: 0.8, saturation: 0.5, brightness: 0 });
    expect(viewer.drawer.renderer.stats.invalidates).toBe(2);

    // A node inserted later lands at its chain position, not at the end.
    adjustments.set(viewer, "v1_bg", { brightness: 0.2 });
    expect(config.params.pipeline.post.map(n => n.id)).toEqual(["xadj_levels", "xadj_bc", "xadj_saturation"]);
});

test("identity writes add nothing and values are clamped", { tag: ["@unit"] }, () => {
    const viewer = makeViewer("v1", [bgLayer()]);
    installGlobals([viewer]);
    const adjustments = new Adjustments();

    adjustments.set(viewer, "v1_bg", { brightness: 0, gamma: 1 });
    expect(viewer.drawer.renderer.getShaderLayerConfig("v1_bg").params.pipeline).toBeUndefined();
    expect(viewer.rebuilds).toBe(0);

    adjustments.set(viewer, "v1_bg", { contrast: 9, bogus: 3 });
    expect(adjustments.get(viewer, "v1_bg").contrast).toBe(1);
});

test("reset removes only xOpat's nodes and their cached values", { tag: ["@unit"] }, () => {
    const viewer = makeViewer("v1", [bgLayer()]);
    installGlobals([viewer]);
    const adjustments = new Adjustments();
    const config = viewer.drawer.renderer.getShaderLayerConfig("v1_bg");
    config.params.pipeline = { post: [{ id: "custom", type: "gamma", params: {} }] };
    config.cache = { __pipeline: { post_xadj_bc_brightness: 0.4, post_custom_gamma: 2 } };

    adjustments.set(viewer, "v1_bg", { brightness: 0.4 });
    adjustments.reset(viewer, "v1_bg");
    expect(config.params.pipeline.post.map(n => n.id)).toEqual(["custom"]);
    expect(config.cache.__pipeline).toEqual({ post_custom_gamma: 2 });
    expect(adjustments.get(viewer, "v1_bg").brightness).toBe(0);
});

test("without renderer support adjustment writes are refused", { tag: ["@unit"] }, () => {
    const viewer = makeViewer("v1", [bgLayer()]);
    installGlobals([viewer], { supported: false });
    const adjustments = new Adjustments();
    expect(adjustments.isSupported()).toBe(false);
    expect(adjustments.set(viewer, "v1_bg", { brightness: 0.3 })).toBe(false);
    expect(viewer.drawer.renderer.getShaderLayerConfig("v1_bg").params.pipeline).toBeUndefined();
    // Sampling does not depend on the pipeline.
    expect(adjustments.setSampling(0, "fluorescence")).toBe(true);
});

test("sampling persists on the data item and reaches the drawer", { tag: ["@unit"] }, () => {
    const viewer = makeViewer("v1", [bgLayer()]);
    installGlobals([viewer]);
    const adjustments = new Adjustments();

    expect(adjustments.setSampling(0, "fluorescence")).toBe(true);
    expect(window.APPLICATION_CONTEXT.config.data[0]).toEqual({ dataID: "slide.tiff", imageSmoothingEnabled: true, minificationFilter: "max" });
    expect(viewer.minify.get(viewer.items[0])).toBe("max");
    expect(adjustments.getSampling(0)).toBe("fluorescence");

    adjustments.setSampling(0, "pixelated");
    expect(viewer.smoothing.get(viewer.items[0])).toBe(false);

    // Back to default restores the minimal string form and clears the overrides.
    adjustments.setSampling(0, "auto");
    expect(window.APPLICATION_CONTEXT.config.data[0]).toBe("slide.tiff");
    expect(viewer.minify.get(viewer.items[0])).toBe(null);
    expect(adjustments.setSampling(5, "auto")).toBe(false);
});

test("linked viewers mirror background writes by position", { tag: ["@unit"] }, () => {
    const a = makeViewer("a", [["a_bg", { type: "identity", tiledImages: [0], params: {} }]]);
    const b = makeViewer("b", [["b_bg", { type: "identity", tiledImages: [0], params: {} }]]);
    installGlobals([a, b]);
    const adjustments = new Adjustments();

    adjustments.set(a, "a_bg", { contrast: 0.3 });
    expect(adjustments.get(b, "b_bg").contrast).toBe(0);

    adjustments.setLinked(true);
    adjustments.set(a, "a_bg", { contrast: 0.5 });
    expect(adjustments.get(b, "b_bg").contrast).toBe(0.5);

    adjustments.reset(a);
    expect(adjustments.get(b, "b_bg").contrast).toBe(0);
});

test("inserted nodes are seeded with identity params", { tag: ["@unit"] }, () => {
    const viewer = makeViewer("v1", [bgLayer()]);
    installGlobals([viewer]);
    const adjustments = new Adjustments();
    adjustments.set(viewer, "v1_bg", { invert: 1, gamma: 2 });
    const nodes = viewer.drawer.renderer.getShaderLayerConfig("v1_bg").params.pipeline.post;
    // The renderer's invert defaults to a FULL inversion: the config must say "none".
    expect(nodes.find(n => n.id === "xadj_invert").params).toEqual({ amount: 0 });
    expect(nodes.find(n => n.id === "xadj_levels").params).toEqual({ black: 0, white: 1, gamma: 1 });
    expect(adjustments.get(viewer, "v1_bg")).toMatchObject({ invert: 1, gamma: 2 });
});

test("ranges come from the renderer's module definitions", { tag: ["@unit"] }, () => {
    const viewer = makeViewer("v1", [bgLayer()]);
    installGlobals([viewer], {
        modules: { levels: { defaultControls: { gamma: { default: { type: "range", min: 0.1, max: 10, step: 0.05 } } } } },
    });
    const adjustments = new Adjustments();
    expect(adjustments.getDescriptor("gamma")).toMatchObject({ min: 0.1, max: 10, step: 0.05, identity: 1 });
    // Unknown to the registry: the literal fallback.
    expect(adjustments.getDescriptor("hue")).toMatchObject({ min: -180, max: 180 });
    adjustments.set(viewer, "v1_bg", { gamma: 8 });
    expect(adjustments.get(viewer, "v1_bg").gamma).toBe(8);
});

test("bypass is a transient uniform on every shader, without a rebuild", { tag: ["@unit"] }, () => {
    const viewer = makeViewer("v1", [bgLayer(), ["v1_group", { type: "group", params: {} }]]);
    installGlobals([viewer]);
    const adjustments = new Adjustments();
    // A group child: nested under the group's `shaderLayers`, as the renderer holds it;
    // getAllShaders() returns only the top-level map.
    const shaders = viewer.drawer.renderer.shaders;
    const child = { bypassed: false, setPipelineBypass(on) { this.bypassed = on; } };
    shaders.v1_group.shaderLayers = { v1_child: child };
    adjustments.set(viewer, "v1_bg", { invert: 1 });
    const rebuilds = viewer.rebuilds;
    adjustments.setBypass(viewer, true);
    expect([shaders.v1_bg.bypassed, shaders.v1_group.bypassed, child.bypassed]).toEqual([true, true, true]);
    expect(adjustments.toggleBypass(viewer)).toBe(false);
    expect(shaders.v1_bg.bypassed).toBe(false);
    expect(viewer.rebuilds).toBe(rebuilds);
    // Never persisted: the config carries no enabled flag.
    expect(viewer.drawer.renderer.getShaderLayerConfig("v1_bg").params.pipeline.enabled).toBeUndefined();
});

test("without the transient bypass, before/after does nothing", { tag: ["@unit"] }, () => {
    const viewer = makeViewer("v1", [bgLayer()]);
    installGlobals([viewer], { bypass: false });
    const adjustments = new Adjustments();
    expect(adjustments.isBypassSupported()).toBe(false);
    adjustments.setBypass(viewer, true);
    expect(adjustments.isBypassed(viewer)).toBe(false);
});

test("the broker reports the controls it owns", { tag: ["@unit"] }, () => {
    const viewer = makeViewer("v1", [bgLayer()]);
    installGlobals([viewer]);
    const adjustments = new Adjustments();
    const shader = viewer.drawer.renderer.shaders.v1_bg;
    expect(adjustments.getOwnedControls(shader).size).toBe(0);
    adjustments.set(viewer, "v1_bg", { brightness: 0.2 });
    const owned = adjustments.getOwnedControls(shader);
    expect(owned.has(shader.getPipelineControl("post", "xadj_bc", "brightness"))).toBe(true);
    expect(owned.has(shader.getPipelineControl("post", "xadj_bc", "contrast"))).toBe(true);
});

test("presets are sanitized full states", { tag: ["@unit"] }, () => {
    const viewer = makeViewer("v1", [bgLayer()]);
    installGlobals([viewer]);
    const adjustments = new Adjustments();
    adjustments.savePreset("Pale H&E", { saturation: 1.4, nonsense: 1, brightness: "x" });
    expect(adjustments.listPresets()).toEqual({ "Pale H&E": { saturation: 1.4 } });

    adjustments.set(viewer, "v1_bg", { brightness: 0.3 });
    adjustments.applyPreset(viewer, "v1_bg", "Pale H&E");
    expect(adjustments.get(viewer, "v1_bg")).toMatchObject({ saturation: 1.4, brightness: 0 });
});

test("auto-level percentiles", { tag: ["@unit"] }, () => {
    const bins = new Array(64).fill(0);
    bins[0] = 1; bins[10] = 500; bins[40] = 500; bins[63] = 1;
    expect(Adjustments.percentileRange(bins, 0.005, 0.995)).toEqual({ black: 0.156, white: 0.641 });
    expect(Adjustments.percentileRange(new Array(64).fill(0), 0.005, 0.995)).toBeNull();
});
