/**
 * `factory.copy(object, points)` means "same annotation, new geometry": the copy
 * is positioned by its points, not by where the source was.
 *
 * Both points-based factories used to carry the source's left/top over while
 * fabric derived `pathOffset` from the NEW points, so the copy was drawn
 * displaced by however far the bounds had moved. The brush engine hits this
 * when an edit turns a polygon into a multipolygon (the result has a hole): a
 * magic wand stroke that extended an existing annotation up or left drew the
 * fill away from the detected region, while the selection highlight - which
 * re-derives its position - stayed where the region really was.
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

test("copy derives position from new points", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();
    await xopat.page.waitForFunction(() => {
        if (!window.OSDAnnotations?.instance?.()?.getFabric?.(window.VIEWER)) return false;
        const loader = document.getElementById("fullscreen-loader");
        return !loader || !loader.isConnected || getComputedStyle(loader).display === "none";
    }, null, { timeout: 120_000 });

    const result = await xopat.page.evaluate(() => {
        const module = window.OSDAnnotations.instance();
        const polygonFactory = module.getAnnotationObjectFactory("polygon");
        const multipolygonFactory = module.getAnnotationObjectFactory("multipolygon");
        const preset = module.presets.addPreset(undefined, "copy-test", "#00a0ff", polygonFactory);
        module.presets.selectPreset(preset.presetID, true);

        const square = (x, y, size) => [
            { x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size },
        ];
        const source = polygonFactory.create(square(1000, 1000, 100), module.presets.getAnnotationOptions(true));

        // The new geometry reaches 200 up and 150 left of the source: bounds 800..1100 x 850..1100.
        const outer = [{ x: 800, y: 850 }, { x: 1100, y: 850 }, { x: 1100, y: 1100 }, { x: 800, y: 1100 }];
        const expected = { x: 950, y: 975 };
        const center = (object) => {
            const c = object.getCenterPoint();
            return { x: c.x, y: c.y };
        };

        return {
            expected,
            sourceCenter: center(source),
            polygon: center(polygonFactory.copy(source, outer)),
            multipolygon: center(multipolygonFactory.copy(source, [outer, square(900, 900, 50)])),
            // The other two forms keep the source's position.
            plain: center(polygonFactory.copy(source)),
        };
    });

    expect(result.plain.x, "a plain copy stays where the source is").toBeCloseTo(result.sourceCenter.x, 3);
    expect(result.plain.y).toBeCloseTo(result.sourceCenter.y, 3);

    expect(result.polygon.x, "polygon copy sits on its new points").toBeCloseTo(result.expected.x, 3);
    expect(result.polygon.y).toBeCloseTo(result.expected.y, 3);
    expect(result.multipolygon.x, "multipolygon copy sits on its new points").toBeCloseTo(result.expected.x, 3);
    expect(result.multipolygon.y).toBeCloseTo(result.expected.y, 3);
});
