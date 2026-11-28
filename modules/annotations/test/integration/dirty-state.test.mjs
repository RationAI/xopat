/**
 * Annotation work the user has not saved must be known to the app: it arms the
 * leave-page prompt and highlights Save. Equally, nothing the user did not do
 * may count: a viewer that boots "dirty" prompts on every close, and users
 * learn to click the prompt away.
 *
 * Default binding here is the in-page `session-memory` + `post-data` pair, so
 * the file Export is what saves.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const slide = ensureSyntheticSlide();

test.describe.configure({ timeout: 300_000 });

const session = () => ({
    data: [slide.dataId],
    background: [{ dataReference: 0, name: "Synthetic" }],
    plugins: { gui_annotations: {} },
    params: {
        bypassCookies: true,
        bypassCache: true,
        disablePluginsAutoload: true,
        bypassCloseConfirmation: false,
        debugMode: false,
    },
});

async function withAnnotationsReady(xopat) {
    await xopat.launch(session());
    await xopat.waitForViewer();
    await xopat.page.waitForFunction(() => {
        if (!window.OSDAnnotations?.instance?.()?.getFabric?.(window.VIEWER)) return false;
        const loader = document.getElementById("fullscreen-loader");
        return !loader || !loader.isConnected || getComputedStyle(loader).display === "none";
    }, null, { timeout: 120_000 });
}

const addPolygon = () => {
    const module = window.OSDAnnotations.instance();
    const polygon = module.getAnnotationObjectFactory("polygon");
    const preset = module.presets.addPreset(undefined, "dirty-test", "#00a0ff", polygon);
    module.presets.selectPreset(preset.presetID, true);
    const viewport = window.VIEWER.viewport;
    const c = viewport.viewportToImageCoordinates(viewport.getCenter(true));
    module.getFabric(window.VIEWER).addAnnotation(polygon.create(
        [{ x: c.x - 200, y: c.y }, { x: c.x, y: c.y - 200 }, { x: c.x + 200, y: c.y }],
        module.presets.getAnnotationOptions(true),
    ));
};

const unloadBlocked = () => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
};

test("a drawn annotation is unsaved until exported", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    await withAnnotationsReady(xopat);
    const page = xopat.page;

    // Booting, opening the slide and hydrating annotations is not user work.
    expect(await page.evaluate(() => window.APPLICATION_CONTEXT.isDirty())).toBe(false);
    expect(await page.evaluate(unloadBlocked)).toBe(false);

    await page.evaluate(addPolygon);
    const state = await page.evaluate(() => ({
        dirty: window.APPLICATION_CONTEXT.isDirty(),
        entries: window.IO_PIPELINE.dirtyEntries(),
    }));
    expect(state.dirty).toBe(true);
    expect(state.entries.some(e => e.ownerUid.endsWith("annotations") && e.viewerId === undefined)).toBe(false);
    expect(await page.evaluate(unloadBlocked)).toBe(true);

    // Switching to in-page storage is not a save.
    await page.evaluate(() => window.IO_PIPELINE.flushBundleExport({ trigger: "system", skipFileFallback: true }));
    expect(await page.evaluate(() => window.APPLICATION_CONTEXT.isDirty())).toBe(true);

    // The file Export is.
    const download = page.waitForEvent("download", { timeout: 60_000 }).catch(() => null);
    await page.evaluate(() => window.UTILITIES.export());
    await download;
    expect(await page.evaluate(() => window.APPLICATION_CONTEXT.isDirty())).toBe(false);
    expect(await page.evaluate(unloadBlocked)).toBe(false);
});

test("bulk adds, their undo and layer edits are unsaved work; visibility is not", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    await withAnnotationsReady(xopat);
    const page = xopat.page;
    const dirty = () => page.evaluate(() => window.APPLICATION_CONTEXT.isDirty());
    const clean = () => page.evaluate(() => window.IO_PIPELINE.markClean());

    // A scripted / job-result bulk add.
    await page.evaluate(async () => {
        const module = window.OSDAnnotations.instance();
        const polygon = module.getAnnotationObjectFactory("polygon");
        const preset = module.presets.addPreset(undefined, "bulk-test", "#00a0ff", polygon);
        module.presets.selectPreset(preset.presetID, true);
        const c = window.VIEWER.viewport.viewportToImageCoordinates(window.VIEWER.viewport.getCenter(true));
        const make = (dx) => polygon.create(
            [{ x: c.x + dx, y: c.y }, { x: c.x + dx + 50, y: c.y - 50 }, { x: c.x + dx + 100, y: c.y }],
            module.presets.getAnnotationOptions(true));
        await module.getFabric(window.VIEWER).addAnnotationsBulk([make(0), make(200)]);
    });
    expect(await dirty()).toBe(true);

    await clean();
    await page.evaluate(() => window.APPLICATION_CONTEXT.history.undo());
    expect(await dirty(), "undoing the batch changes the document").toBe(true);

    await clean();
    const layerId = await page.evaluate(async () => {
        const fabric = window.OSDAnnotations.instance().getFabric(window.VIEWER);
        await fabric.createLayer("dirty-layer");
        return "dirty-layer";
    });
    expect(await dirty(), "a new layer").toBe(true);
    await clean();
    await page.evaluate((id) => window.OSDAnnotations.instance().getFabric(window.VIEWER).renameLayer(id, "Renamed"), layerId);
    expect(await dirty(), "a rename").toBe(true);

    await clean();
    await page.evaluate((id) => {
        const fabric = window.OSDAnnotations.instance().getFabric(window.VIEWER);
        fabric.setLayerVisibility(id, false);
    }, layerId);
    expect(await dirty(), "hiding a layer is view state").toBe(false);
});
