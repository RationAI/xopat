/**
 * Display adjustments on the real flex-renderer pipeline (APPLICATION_CONTEXT.adjustments).
 *
 * What this pins against the vendored renderer, not a fake:
 *  - the first adjustment inserts a pipeline node (one program build); further value
 *    writes are uniform updates — no second-pass program is (re)used for them;
 *  - the live snapshot carries `params.pipeline` and `cache.__pipeline`, so undo removes
 *    the node again;
 *  - the shader card never mounts the broker's controls (the Data panel owns them),
 *    while a legacy `use_gamma` filter shows up exactly once there, as its migrated
 *    `legacy_gamma` pipeline control.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const slide = ensureSyntheticSlide();

const session = (shaders) => ({
    data: [slide.dataId],
    background: [{ dataReference: 0, name: "Synthetic", ...(shaders ? { shaders } : {}) }],
    params: { bypassCookies: true, bypassCache: true, disablePluginsAutoload: true, debugMode: false },
});

test("an adjustment is one rebuild, then uniforms; undoable", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();

    const result = await xopat.page.evaluate(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const adjustments = window.APPLICATION_CONTEXT.adjustments;
        const viewer = window.VIEWER_MANAGER.viewers[0];
        const renderer = viewer.drawer.renderer;
        let programs = 0;
        renderer.addHandler("program-used", (e) => { if (e?.name === "second-pass") programs++; });
        const state = () => {
            const live = window.UTILITIES.exportLiveVisualization(viewer);
            const layer = Object.values(live.layers)[0];
            return { pipeline: layer.state.pipeline, cache: layer.cache?.__pipeline };
        };

        await sleep(800); // history baseline
        const supported = adjustments.isSupported();
        adjustments.setBackground(viewer, { brightness: 0.2 });
        await sleep(500);
        const afterInsert = programs;
        adjustments.setBackground(viewer, { brightness: 0.3 });
        adjustments.setBackground(viewer, { brightness: 0.35 });
        await sleep(500);
        const afterValues = programs;
        const live = state();
        const ownedInDom = document.querySelectorAll('[id*="xadj"]').length;

        for (let i = 0; i < 4 && state().pipeline?.post?.length; i++) {
            await window.APPLICATION_CONTEXT.history.undo();
            await sleep(400);
        }
        return { supported, afterInsert, afterValues, live, ownedInDom, undone: state().pipeline ?? null };
    });

    expect(result.supported).toBe(true);
    expect(result.afterInsert).toBeGreaterThan(0);
    expect(result.afterValues).toBe(result.afterInsert);
    expect(result.live.pipeline.post.map((n) => n.id)).toEqual(["xadj_bc"]);
    expect(result.live.pipeline.post[0].params).toEqual({ brightness: 0, contrast: 0 });
    expect(Number(result.live.cache.post_xadj_bc_brightness)).toBeCloseTo(0.35);
    expect(result.ownedInDom).toBe(0);
    expect(result.undone?.post?.length ?? 0).toBe(0);
});

test("a legacy filter renders once on the shader card", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session([{ type: "identity", params: { use_gamma: 2 } }]));
    await xopat.waitForViewer();

    const rows = await xopat.page.evaluate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        return [...document.querySelectorAll(".shader-controls-row--renderer")]
            .filter((row) => row.innerHTML.includes("legacy_gamma")).length;
    });
    expect(rows).toBe(1);
});
