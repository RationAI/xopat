/**
 * A mode switch that gets refused still has to say what mode is in effect.
 *
 * Every mode-aware UI paints optimistically — `ToolbarGroup` sets its van state on click,
 * before the app callback runs, and never rolls it back (`toolbarGroup.mjs`). So the only
 * thing that can un-paint the annotations toolbar is `mode-changed`, and
 * `_setModeFromAuto` used to raise it on success but stay *silent* when a mode refused to
 * activate from AUTO — `this.mode !== AUTO` was false, so the whole refusal went
 * unannounced. The `edit-selection` button then stayed lit forever with the module still
 * in `auto`, and re-clicking retried the same refusal.
 *
 * `edit-selection` is refused here the way a user hits it: a READ-ONLY annotation is
 * selected. `getSelectedEditableObject` only screens on `isEditable()`, so the object
 * reaches `beginSelectionEdit`, where the module's read-only IO guard vetoes
 * `canUpdate(..., {kind: 'edit-start'})` and the entry fails. (A *non-editable* factory
 * is not this case: it is screened out earlier and edit mode legitimately stays armed.)
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

test("a refused mode switch from auto still announces the effective mode", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    await withAnnotationsReady(xopat);

    const result = await xopat.page.evaluate(() => {
        const module = window.OSDAnnotations.instance();
        const fabricWrapper = module.getFabric(window.VIEWER);

        // An editable shape the user may look at but not change.
        const polygon = module.getAnnotationObjectFactory("polygon");
        const preset = module.presets.addPreset(undefined, "readonly-test", "#00a0ff", polygon);
        module.presets.selectPreset(preset.presetID, true);

        const viewport = window.VIEWER.viewport;
        const c = viewport.viewportToImageCoordinates(viewport.getCenter(true));
        const object = polygon.create(
            [{ x: c.x - 200, y: c.y }, { x: c.x, y: c.y - 200 }, { x: c.x + 200, y: c.y }],
            module.presets.getAnnotationOptions(true),
        );
        fabricWrapper.addAnnotation(object);
        object.readOnly = true;
        fabricWrapper.selectAnnotation(object, true, true);

        const events = [];
        const handler = (e) => events.push(e.mode?.getId?.() ?? null);
        module.addHandler("mode-changed", handler);

        const editId = module._ensureEditSelectionMode().getId();
        module.setModeById(editId);

        module.removeHandler("mode-changed", handler);
        return {
            editId,
            editable: polygon.isEditable(),
            reachesGuard: Boolean(module.getSelectedEditableObject()),
            selected: fabricWrapper.getSelectedAnnotations().length,
            modeAfter: module.mode.getId(),
            events,
        };
    });

    expect(result.editable, "the factory itself is editable - the veto is about the record").toBe(true);
    expect(result.selected, "exactly one annotation is selected").toBe(1);
    expect(result.reachesGuard, "so the object reaches beginSelectionEdit and its guard").toBe(true);
    expect(result.modeAfter, "the refusal leaves the module in auto").toBe("auto");
    expect(result.events, "and says so, instead of refusing silently").toEqual(["auto"]);
    expect(result.events, "never reports the mode it refused to enter").not.toContain(result.editId);
});

test("disabling interaction resets the mode instead of freezing it", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    await withAnnotationsReady(xopat);

    // `enableInteraction(false)` used to set `disabledInteraction` first, and `setMode`
    // refuses on exactly that flag — so its own "return to the default state, always"
    // reset was a no-op and the previous mode stayed live with interaction gone.
    const result = await xopat.page.evaluate(() => {
        const module = window.OSDAnnotations.instance();
        const rect = module.getAnnotationObjectFactory("rect");
        const preset = module.presets.addPreset(undefined, "rect-test", "#ff0000", rect);
        module.presets.selectPreset(preset.presetID, true);

        module.setModeById("custom");
        const before = module.mode.getId();

        module.enableInteraction(false);
        const whileDisabled = module.mode.getId();

        module.enableInteraction(true);
        return { before, whileDisabled, after: module.mode.getId() };
    });

    expect(result.before, "the custom creation mode was entered").toBe("custom");
    expect(result.whileDisabled, "disabling interaction returns to auto").toBe("auto");
    expect(result.after, "and re-enabling leaves it there").toBe("auto");
});
