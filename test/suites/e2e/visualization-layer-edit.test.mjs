/**
 * Editing the active visualization's layers must not touch the background.
 *
 * A layer edit is the same data change as switching to another visualization
 * index, so it takes the same surgical path: the background's world item (and
 * with it the loaded tiles and any slide-scoped state) survives, and only the
 * overlay comes and goes. The identity of the world item is what is asserted,
 * because a reset rebuilds an indistinguishable-looking one.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const slide = ensureSyntheticSlide();
const other = ensureSyntheticSlide({ name: "synthetic-overlay" });

const session = () => ({
    data: [slide.dataId, other.dataId],
    background: [
        { dataReference: 0, name: "Synthetic", visualizationIndex: 0 },
        { dataReference: 1, name: "Other", visualizationIndex: 0 },
    ],
    visualizations: [{
        name: "Layers",
        shaders: { base: { type: "identity", dataReferences: [0] } },
    }],
    params: {
        bypassCookies: true,
        bypassCache: true,
        disablePluginsAutoload: true,
        debugMode: false,
    },
});

/** Remember the background item and count `open` events from here on. */
const markBackground = (xopat) => xopat.page.evaluate(() => {
    const viewer = window.VIEWER;
    window.__background = viewer.world.getItemAt(0);
    window.__opens = 0;
    viewer.addHandler("open", () => window.__opens++);
});

const setLayers = (xopat, layers) => xopat.page.evaluate(async (shaders) => {
    const visualizations = JSON.parse(JSON.stringify(window.APPLICATION_CONTEXT.config.visualizations));
    visualizations[0].shaders = shaders;
    return window.APPLICATION_CONTEXT.openViewerWith(undefined, undefined, visualizations);
}, layers);

const worldState = (xopat) => xopat.page.evaluate(() => ({
    items: window.VIEWER.world.getItemCount(),
    backgroundKept: window.VIEWER.world.getItemAt(0) === window.__background,
    opens: window.__opens,
}));

const base = { type: "identity", dataReferences: [0] };
const overlay = { type: "identity", dataReferences: [1] };

test("adding and removing a layer keeps the background", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();
    await markBackground(xopat);

    expect((await worldState(xopat)).items).toBe(1);

    expect(await setLayers(xopat, { base, overlay })).toBe(true);
    expect(await worldState(xopat), "the overlay joined the world around the kept background")
        .toEqual({ items: 2, backgroundKept: true, opens: 0 });

    expect(await setLayers(xopat, { base })).toBe(true);
    expect(await worldState(xopat), "the overlay left and the background stayed")
        .toEqual({ items: 1, backgroundKept: true, opens: 0 });
});

test("changing the background still reopens the viewer", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();
    await markBackground(xopat);

    const opened = await xopat.page.evaluate(
        () => window.APPLICATION_CONTEXT.openViewerWith(undefined, undefined, undefined, 1, undefined, {
            warnOnHistoryBoundary: false,
        })
    );
    expect(opened).toBe(true);

    const state = await worldState(xopat);
    expect(state.backgroundKept).toBe(false);
    expect(state.opens).toBeGreaterThan(0);
});
