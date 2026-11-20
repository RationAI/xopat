/**
 * A cache saved under one shader type must not poison another.
 *
 * Production report (3.1.0): every `colormap` layer of one user's session rendered
 * grayscale. The session carried a flat 3.x cache written while the layers were
 * heatmaps — `color: "#2962ff"` — and the colormap's `custom_colormap` control
 * loaded that hex string as its palette, rejected it and fell back to the library
 * default instead of the authored palette. flex-renderer now buckets the cache per
 * shader type, migrates a flat cache into the current type's bucket, drops a saved
 * value that does not fit its control, and reports through `UIControls.setReporter`.
 *
 * The payload below is that session's layer, verbatim apart from the data source.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const slide = ensureSyntheticSlide();
const AUTHORED = ["#000000", "#00e5ff"];

const session = () => ({
    data: [slide.dataId],
    background: [{ dataReference: 0, name: "Synthetic", visualizationIndex: 0 }],
    visualizations: [{
        name: "Stale cache",
        shaders: {
            layer_shader_0: {
                type: "colormap",
                name: "PNI candidates",
                visible: 1,
                dataReferences: [0],
                params: {
                    color: { type: "custom_colormap", default: AUTHORED, steps: 2 },
                    threshold: { type: "advanced_slider", breaks: [0.5], mask: [0, 1] },
                    connect: true,
                    opacity: 0.6,
                },
                cache: {
                    use_channel0: "r", color: "#2962ff", threshold: 1, inverse: false, opacity: 0.3,
                },
            },
        },
    }],
    params: { bypassCookies: true, bypassCache: true, disablePluginsAutoload: true, debugMode: false },
});

const layerState = (xopat) => xopat.page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const renderer = window.VIEWER.drawer.renderer;
    const shader = Object.values(renderer.getAllShaders()).find(s => s.getConfig().name === "PNI candidates");
    const config = shader.getConfig();
    const control = shader._controls.color;
    return {
        type: config.type,
        palette: control.colorPallete,
        cache: JSON.parse(JSON.stringify(config.cache)),
    };
});

test("a heatmap-era flat cache does not replace the authored palette", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();
    const state = await layerState(xopat);

    expect(state.type).toBe("colormap");
    expect(state.palette, "authored palette, not the grayscale default").toEqual(AUTHORED);
    expect(Object.keys(state.cache), "the flat cache is migrated into the type bucket").toEqual(["colormap"]);
    expect(state.cache.colormap.color, "the foreign value does not survive into the session").not.toBe("#2962ff");
    expect(state.cache.colormap.opacity, "values that fit their control are kept").toBe(0.3);
});

test("switching the layer type keeps each type's values apart", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();
    const id = await xopat.page.evaluate(() => {
        const renderer = window.VIEWER.drawer.renderer;
        return Object.values(renderer.getAllShaders()).find(s => s.getConfig().name === "PNI candidates").id;
    });

    await xopat.page.evaluate((layerId) => window.UTILITIES.changeVisualizationLayer(layerId, "heatmap", window.VIEWER), id);
    await xopat.page.evaluate((layerId) => window.UTILITIES.changeVisualizationLayer(layerId, "colormap", window.VIEWER), id);
    const state = await layerState(xopat);

    expect(state.type).toBe("colormap");
    expect(state.palette).toEqual(AUTHORED);
    expect(Object.keys(state.cache).sort()).toEqual(["colormap", "heatmap"]);
});
