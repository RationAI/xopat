/**
 * Structural layer params a user edits at runtime — the legacy input filters
 * (`UTILITIES.setFilterOfLayer`) and the per-layer module pipeline
 * (`params.pipeline`, APPLICATION_CONTEXT.adjustments) — must survive the live
 * snapshot that undo, session sync and config write-back are built on.
 *
 * Before: `exportLiveVisualization` carried only `{type, cache, state(visible/
 * mode/blend)}`, so a filter edit produced no undo entry, never reached a peer,
 * and was dropped from the exported session.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const slide = ensureSyntheticSlide();

const session = () => ({
    data: [slide.dataId],
    background: [{ dataReference: 0, name: "Synthetic" }],
    params: { bypassCookies: true, bypassCache: true, disablePluginsAutoload: true, debugMode: false },
});

test("a filter edit is in the live snapshot, written back, and undoable", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();

    const result = await xopat.page.evaluate(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const viewer = window.VIEWER_MANAGER.viewers[0];
        const layerId = viewer.drawer.renderer.getShaderLayerOrder()[0];
        const liveState = () => {
            const live = window.UTILITIES.exportLiveVisualization(viewer);
            return Object.values(live.layers).find((layer) => layer.state)?.state || {};
        };

        // Let visualization-history take its baseline first.
        await sleep(800);
        window.UTILITIES.setFilterOfLayer(layerId, "use_gamma", 2, viewer);
        const afterEdit = liveState();
        await sleep(800); // live-config-sync (100 ms) + history (300 ms) debounces
        const written = window.APPLICATION_CONTEXT.config.background[0].shaders?.[0]?.params?.use_gamma;

        await window.APPLICATION_CONTEXT.history.undo();
        await sleep(300);
        const afterUndo = liveState();
        const configAfterUndo = viewer.drawer.renderer.getShaderLayerConfig(layerId).params.use_gamma;
        return { afterEdit, written, afterUndo, configAfterUndo };
    });

    expect(result.afterEdit.use_gamma).toBe(2);
    expect(result.afterEdit.structural).toBe(true);
    expect(result.written).toBe(2);
    expect(result.afterUndo.use_gamma).toBeUndefined();
    expect(result.configAfterUndo).toBeUndefined();
});
