/**
 * A `before-open` handler may re-point a viewer at a visualization it just
 * appended, without replacing `e.visualization`.
 *
 * The event is seeded with the slot's current visualization object. Writing that
 * seed back to the re-pointed index used to overwrite the appended overlay with
 * a copy of the old one — a slide swap then showed the previous slide's masks
 * (and their pixel density inflated the scalebar's top magnification).
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const slide = ensureSyntheticSlide();

const layer = (name) => ({
    name,
    shaders: {
        overlay: { type: "identity", visible: 1, dataReferences: [0], params: {} },
    },
});

test("re-pointing visualizationIndex keeps the appended visualization", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch({
        data: [slide.dataId],
        background: [
            { dataReference: 0, id: "repoint-a", name: "A" },
            { dataReference: 0, id: "repoint-b", name: "B" },
        ],
        visualizations: [layer("seed")],
        params: { bypassCookies: true, bypassCache: true, disablePluginsAutoload: true, activeBackgroundIndex: [0] },
    });
    await xopat.waitForViewer();

    const result = await xopat.page.evaluate(async () => {
        const ctx = window.APPLICATION_CONTEXT;
        let appended = -1;
        const handler = (e) => {
            if (e.changeKind !== "content" || e.background?.id !== "repoint-b") return;
            ctx.config.visualizations.push({
                name: "appended",
                shaders: { overlay: { type: "identity", visible: 1, dataReferences: [0], params: {} } },
            });
            appended = ctx.config.visualizations.length - 1;
            e.visualizationIndex = appended;
        };
        window.VIEWER_MANAGER.addHandler("before-open", handler);
        try {
            await ctx.updateViewerSelection(0, { backgroundIndex: 1 });
        } finally {
            window.VIEWER_MANAGER.removeHandler("before-open", handler);
        }
        const bg = ctx.config.background.find(b => b.id === "repoint-b");
        return {
            appended,
            names: ctx.config.visualizations.map(v => v.name),
            bgVisualizationIndex: bg?.visualizationIndex,
        };
    });

    expect(result.appended, "the handler ran for the swapped-in slide").toBeGreaterThan(0);
    expect(result.names[result.appended]).toBe("appended");
    expect(result.names[0]).toBe("seed");
    expect(result.bgVisualizationIndex).toBe(result.appended);
});
