/**
 * A short click in a creation mode selects the annotation under the cursor.
 *
 * The mode-level half of this is pinned by `test/unit/click-up-contract.test.mjs`. What
 * only a real canvas can prove is the other half: fabric resolves `mouse:up`'s `target`
 * *before* the module's handler runs, so it is resolved before the mode deletes its
 * in-progress helper. A fix that merely returns `false` from `handleClickUp` would make
 * the canvas "select" the 1x1 helper rect it had just thrown away — the assertions below
 * on `isHelperAnnotation` are what catch that.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const slide = ensureSyntheticSlide();

// Each test boots a server, a viewer AND the annotations plugin before it can click
// anything. Under a full-matrix run every worker is doing that at once, and the project's
// 120 s budget goes to boot rather than to the assertions.
test.describe.configure({ timeout: 300_000 });

const session = () => ({
    data: [slide.dataId],
    background: [{ dataReference: 0, name: "Synthetic" }],
    // the plugin id is `gui_annotations`; `annotations` is the module it pulls in
    plugins: { gui_annotations: {} },
    params: {
        bypassCookies: true,
        bypassCache: true,
        disablePluginsAutoload: true,
        debugMode: false,
    },
});

/**
 * Boot the viewer with the annotations plugin, put one rect annotation in the middle of
 * the viewport, and switch to the manual creation mode. Screen coordinates are `pointOf`'s
 * job, not this one's.
 */
async function withOneAnnotation(xopat) {
    await xopat.launch(session());
    await xopat.waitForViewer();

    // One wait, one budget: the annotations module has to exist for this viewer, and
    // `#fullscreen-loader` — a full-page overlay that outlives `waitForViewer` — has to be
    // gone. While it is up every synthetic mouse event lands on it instead of the annotation
    // canvas, which reads exactly like "the click did nothing", i.e. the bug under test.
    await xopat.page.waitForFunction(() => {
        if (!window.OSDAnnotations?.instance?.()?.getFabric?.(window.VIEWER)) return false;
        const loader = document.getElementById("fullscreen-loader");
        return !loader || !loader.isConnected || getComputedStyle(loader).display === "none";
    }, null, { timeout: 120_000 });

    return xopat.page.evaluate(() => {
        const module = window.OSDAnnotations.instance();
        const fabricWrapper = module.getFabric(window.VIEWER);

        // A rect preset on the left button: `custom` mode then draws rectangles, whose
        // factory carries the 100 ms threshold that produces the discard branch.
        const rect = module.getAnnotationObjectFactory("rect");
        const preset = module.presets.addPreset(undefined, "test", "#ff0000", rect);
        module.presets.selectPreset(preset.presetID, true);

        const viewport = window.VIEWER.viewport;
        const centre = viewport.viewportToImageCoordinates(viewport.getCenter(true));
        const size = 400;
        const annotation = rect.create(
            { left: centre.x - size / 2, top: centre.y - size / 2, width: size, height: size },
            module.presets.getAnnotationOptions(true),
        );
        fabricWrapper.addAnnotation(annotation);
        fabricWrapper.clearAnnotationSelection(true);
        module.setModeById("custom");

        // remembered for `pointOf` below, which re-derives screen coordinates once the
        // viewport has stopped moving
        window.__annotationTestCentre = { x: centre.x, y: centre.y, size };

        // `getSelectedAnnotations()` reads fabric's own active object, and fabric sets that
        // on mousedown regardless of what the mode does — so it is NOT evidence the module
        // ran its selection path. The event is: it only fires from `selectAnnotation` /
        // `clearAnnotationSelection`, which are what update the highlight, the board and IO.
        window.__selectionEvents = [];
        fabricWrapper.addHandler("annotation-selection-changed", (e) => {
            window.__selectionEvents.push({
                selected: (e.selected || []).map((o) => o.incrementId),
                deselected: (e.deselected || []).map((o) => o.incrementId),
                fromCanvas: e.fromCanvas,
            });
        });

        return {
            id: annotation.incrementId,
            mode: module.mode.getId(),
            baseline: fabricWrapper.canvas._objects.filter((o) => !o.isHelperAnnotation && !o.isHighlight).length,
        };
    });
}

/**
 * A screen point, resolved after the viewport has come to rest.
 *
 * OSD springs into place, so coordinates taken right after `addAnnotation` can be stale
 * by the time the mouse gets there — which shows up as an intermittently empty selection.
 *
 * @param {"inside"|"outside"|"dragFrom"} kind
 */
async function pointOf(xopat, kind) {
    await xopat.page.waitForFunction(() => !window.VIEWER.isAnimating?.(), null, { timeout: 30_000 });
    return xopat.page.evaluate((which) => {
        const module = window.OSDAnnotations.instance();
        const fabricWrapper = module.getFabric(window.VIEWER);
        const viewport = window.VIEWER.viewport;
        const { x, y, size } = window.__annotationTestCentre;
        const toScreen = (ix, iy) => {
            const p = viewport.imageToWindowCoordinates(new window.OpenSeadragon.Point(ix, iy));
            return { x: Math.round(p.x), y: Math.round(p.y) };
        };
        if (which === "inside") return toScreen(x, y);
        if (which === "dragFrom") return toScreen(x + size, y + size);
        const box = fabricWrapper.canvas.upperCanvasEl.getBoundingClientRect();
        return { x: Math.round(box.x + 15), y: Math.round(box.y + 15) };
    }, kind);
}

/**
 * What the canvas looks like after an interaction.
 *
 * The selection highlight is itself a helper annotation (`setHighlight` routes through
 * `addHelperAnnotation`), so "a creation helper leaked" means a helper that is not a
 * highlight — counting all helpers would just count the highlight the selection added.
 */
function readState(xopat) {
    return xopat.page.evaluate(() => {
        const module = window.OSDAnnotations.instance();
        const fabricWrapper = module.getFabric(window.VIEWER);
        const objects = fabricWrapper.canvas._objects;
        const selected = fabricWrapper.getSelectedAnnotations() || [];
        return {
            selectedIds: selected.map((o) => o.incrementId),
            selectedAreHelpers: selected.some((o) => o.isHelperAnnotation === true),
            strayHelpers: objects.filter((o) => o.isHelperAnnotation === true && !o.isHighlight).length,
            annotations: objects.filter((o) => !o.isHelperAnnotation && !o.isHighlight).length,
            hasHighlight: Boolean(fabricWrapper.getHighlight?.()),
            events: window.__selectionEvents.slice(),
        };
    });
}

/** A press/release pair shorter than the 100 ms creation threshold. */
async function shortClick(xopat, at) {
    await xopat.page.mouse.move(at.x, at.y);
    await xopat.page.mouse.down();
    await xopat.page.mouse.up();
    // let the module's mouse:up handler and the selection event settle
    await xopat.page.waitForTimeout(200);
}

test("a short click on an annotation selects it while drawing manually", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    const setup = await withOneAnnotation(xopat);
    expect(setup.mode, "the test runs in the manual creation mode").toBe("custom");

    await shortClick(xopat, await pointOf(xopat, "inside"));

    const state = await readState(xopat);
    expect(state.selectedIds, "the annotation under the cursor is selected").toEqual([setup.id]);
    expect(state.events, "the module ran its selection path, not just fabric's").toEqual([
        expect.objectContaining({ selected: [setup.id], fromCanvas: true }),
    ]);
    expect(state.hasHighlight, "the selection highlight was drawn").toBe(true);
    expect(state.selectedAreHelpers, "the discarded helper must never be what gets selected").toBe(false);
    expect(state.strayHelpers, "the discarded helper is off the canvas").toBe(0);
    expect(state.annotations, "a too-short click creates nothing").toBe(setup.baseline);
});

test("a short click on empty canvas clears the selection and leaves no helper", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    const setup = await withOneAnnotation(xopat);

    await shortClick(xopat, await pointOf(xopat, "inside"));
    expect((await readState(xopat)).selectedIds).toEqual([setup.id]);

    await shortClick(xopat, await pointOf(xopat, "outside"));

    const state = await readState(xopat);
    expect(state.selectedIds).toEqual([]);
    expect(state.strayHelpers).toBe(0);
    expect(state.annotations, "still nothing created").toBe(setup.baseline);
});

test("a real drag still creates an annotation instead of selecting", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    const setup = await withOneAnnotation(xopat);

    const from = await pointOf(xopat, "dragFrom");
    await xopat.page.mouse.move(from.x, from.y);
    await xopat.page.mouse.down();
    // past the 100 ms threshold, with real motion in between
    for (let i = 1; i <= 6; i++) {
        await xopat.page.mouse.move(from.x + i * 8, from.y + i * 8);
        await xopat.page.waitForTimeout(30);
    }
    await xopat.page.mouse.up();
    await xopat.page.waitForTimeout(300);

    const state = await readState(xopat);
    expect(state.annotations, "the drag produced a second annotation").toBe(setup.baseline + 1);
    expect(state.strayHelpers, "the created shape was promoted, not left as a helper").toBe(0);
});
