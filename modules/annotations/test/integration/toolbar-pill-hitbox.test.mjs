/**
 * The toolbar pill's hit box must match the pill as drawn — from the first
 * setCoords(), before the pill has ever been rendered.
 *
 * fabric hit-tests controls against `oCoords[key].corner`, a box it caches in
 * setCoords() from `control.sizeX/sizeY`. The pill used to start at a 120px
 * placeholder and learn its real width only in render(), so a freshly selected
 * annotation kept a box roughly twice as wide as the pill. `findTarget` checks
 * the active object's controls first, so presses next to the pill showed the
 * pointer cursor and were swallowed instead of starting the next annotation.
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

test("a freshly selected annotation's toolbar hit box is the pill, not a placeholder", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();
    await xopat.page.waitForFunction(() => {
        if (!window.OSDAnnotations?.instance?.()?.getFabric?.(window.VIEWER)) return false;
        const loader = document.getElementById("fullscreen-loader");
        return !loader || !loader.isConnected || getComputedStyle(loader).display === "none";
    }, null, { timeout: 120_000 });

    const result = await xopat.page.evaluate(() => {
        const module = window.OSDAnnotations.instance();
        const fabricWrapper = module.getFabric(window.VIEWER);
        const rect = module.getAnnotationObjectFactory("rect");
        const preset = module.presets.addPreset(undefined, "pill-test", "#00a0ff", rect);
        module.presets.selectPreset(preset.presetID, true);

        const viewport = window.VIEWER.viewport;
        const c = viewport.viewportToImageCoordinates(viewport.getCenter(true));
        const object = rect.create({ left: c.x - 50, top: c.y - 50, width: 100, height: 100 },
            module.presets.getAnnotationOptions(true));
        fabricWrapper.addAnnotation(object);
        fabricWrapper.selectAnnotation(object, false, true);

        // Cache the hit boxes the way fabric does, with no render in between.
        object.setCoords();
        const control = object.controls.toolbar;
        const oc = object.oCoords.toolbar;
        const box = oc.corner;
        const boxWidth = Math.hypot(box.tr.x - box.tl.x, box.tr.y - box.tl.y);
        const hit = (dx) => object._findTargetCorner({ x: oc.x + dx, y: oc.y }, false);

        return {
            active: fabricWrapper.canvas._activeObject === object,
            sizeX: control.sizeX,
            boxWidth,
            atCenter: hit(0),
            justOutside: hit(control.sizeX / 2 + 10),
        };
    });

    expect(result.active, "the annotation is the active object").toBe(true);
    expect(result.sizeX, "sized to the pill, not the old 120px placeholder").toBeLessThan(120);
    expect(result.sizeX).toBeGreaterThan(19);
    expect(result.boxWidth, "fabric's cached hit box uses that size").toBeCloseTo(result.sizeX, 0);
    expect(result.atCenter, "the pill itself is still clickable").toBe("toolbar");
    expect(result.justOutside, "a press next to the pill is not swallowed by it").toBe(false);
});
