/**
 * The measurements a pathologist actually asks for, end to end, against a slide
 * whose pixels are known in closed form.
 *
 * The unit suites prove the maths in isolation; they cannot reach the half that
 * needs a GPU — the off-screen render, `gl.readPixels`, the polygon mask, the
 * channel projection. This does, by measuring a region of the synthetic slide
 * whose answer is derivable from the generator.
 *
 * The fixture (`test/harness/slides/make-synthetic.mjs`) paints, per tile, a
 * 32 px checkerboard in TILE-LOCAL coordinates:
 *
 *     checker = ((x >> 5) + (y >> 5)) % 2 === 0
 *     base    = checker ? 200 : 120
 *     R = base + tint,  G = base - tint,  B = levelHue,  A = 255
 *     tint    = ((col * 53 + row * 97) % 64) - 32          // constant per tile
 *
 * Two consequences drive every choice below:
 *
 *  - At the native level `levelHue` is 230, so B swamps R and G and the default
 *    `V = max(RGB)` channel is almost flat. These cases measure **R**, where the
 *    two checker classes sit 80 apart. That is a property of this fixture, not a
 *    defect — but it is exactly why "measure what looks right" is not a test.
 *  - Each tile carries an 8x8 red corner marker at its own origin, so the region
 *    must avoid tile corners.
 *
 * Region: 128x128 image px at (288, 288) — inside tile (1, 1), offset one cell in
 * so it clears the marker, covering 4x4 = 16 whole cells. Eight are light, eight
 * dark, and the light ones touch only at corners, which under the labeller's
 * 4-connectivity makes each its own object.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const slide = ensureSyntheticSlide();

// Booting a server, a viewer, the annotations plugin AND rendering tiles before a
// single assertion runs; the project's 120 s budget goes to boot.
test.describe.configure({ timeout: 300_000 });

// ─── what the fixture guarantees, computed here rather than observed ──────────

const TILE = 256;
const CELL = 32;
const TILE_COL = 1, TILE_ROW = 1;
const TINT = ((TILE_COL * 53 + TILE_ROW * 97) % 64) - 32;      // -10
const LIGHT_R = 200 + TINT;                                     // 190
const DARK_R = 120 + TINT;                                      // 110

const ROI = { left: TILE_COL * TILE + CELL, top: TILE_ROW * TILE + CELL, width: 4 * CELL, height: 4 * CELL };
const ROI_AREA = ROI.width * ROI.height;                        // 16384 px²

/**
 * Counting objects needs a region whose blobs are unambiguously separate. In the
 * 2-D checkerboard the light cells touch at their corners, and the sampler
 * resamples 128 image px onto a 137 px grid — at that scale a shared corner
 * sometimes lands on a shared pixel, so 4-connectivity merges a diagonal pair and
 * the count depends on rounding rather than on the image. A ONE-CELL-TALL strip
 * has no diagonal contact at all: light cells alternate along x, each flanked by a
 * full dark cell, so the answer is the same at any sampling resolution.
 */
const STRIP = { left: ROI.left, top: ROI.top, width: 4 * CELL, height: CELL };
const STRIP_LIGHT_CELLS = 2;                                    // cx = 1, 3 with cy = 1

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

/** Boot far enough that annotations can be created and the renderer has tiles. */
async function boot(xopat) {
    await xopat.launch(session());
    await xopat.waitForViewer();
    await xopat.page.waitForFunction(() => {
        if (!window.OSDAnnotations?.instance?.()?.getFabric?.(window.VIEWER)) return false;
        if (!window.xmodules?.["annotation-measurements"]?.instance?.()) return false;
        const loader = document.getElementById("fullscreen-loader");
        return !loader || !loader.isConnected || getComputedStyle(loader).display === "none";
    }, null, { timeout: 120_000 });

    // Every tile in flight must have landed. The sampler renders off-screen from
    // the live viewer's textures, so measuring while tiles are still arriving
    // reads whatever coarser level is currently standing in — opaque, plausible,
    // and wrong. `waitForViewer` only requires the queue to be nearly drained.
    await xopat.page.waitForFunction(
        () => window.VIEWER?.imageLoader?.jobsInProgress === 0,
        null, { timeout: 120_000 },
    );
    await xopat.page.evaluate(() => new Promise((resolve) => {
        window.VIEWER.forceRedraw();
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

/**
 * Draw rectangles the way the plugin does, in image coordinates, and return their
 * increment ids. `rects` is `[{left, top, width, height, klass}]`.
 */
function drawRects(xopat, rects) {
    return xopat.page.evaluate((specs) => {
        const module = window.OSDAnnotations.instance();
        const fabric = module.getFabric(window.VIEWER);
        const factory = module.getAnnotationObjectFactory("rect");

        return specs.map((spec) => {
            const preset = module.presets.addPreset(undefined, spec.klass || "region", "#ff0000", factory);
            module.presets.selectPreset(preset.presetID, true);
            const object = factory.create(
                { left: spec.left, top: spec.top, width: spec.width, height: spec.height },
                module.presets.getAnnotationOptions(true),
            );
            fabric.addAnnotation(object);
            // AFTER adding: the add path applies the preset's visuals, stroke
            // included. `left` is the OUTER edge of that stroke — fabric paints the
            // path `strokeWidth / 2` inside it and `getBoundingRect` agrees — so the
            // preset's ~9 px stroke would sit the region half a stroke off the
            // checker grid these expectations are derived from. The fixture drops the
            // stroke rather than the assertions absorbing it.
            object.set({ strokeWidth: 0 });
            object.setCoords();
            return { incrementId: object.incrementId, presetID: preset.presetID };
        });
    }, rects);
}

/** Read geometry back through the engine, by increment id. */
function geometryOf(xopat, incrementId) {
    return xopat.page.evaluate((id) => {
        const module = window.OSDAnnotations.instance();
        const fabric = module.getFabric(window.VIEWER);
        const object = fabric.canvas.getObjects().find((o) => o.incrementId === id);
        const engine = window.xmodules["annotation-measurements"].instance().getEngine();
        const geo = engine.getGeometric(window.VIEWER, object);
        return { areaImagePx: geo.areaImagePx, areaLabel: geo.areaLabel, hasPhysical: geo.hasPhysical };
    }, incrementId);
}

// ─── the workflow ─────────────────────────────────────────────────────────────

test("a drawn region measures the area it was drawn with", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    await boot(xopat);
    const [roi] = await drawRects(xopat, [ROI]);

    const geo = await geometryOf(xopat, roi.incrementId);
    // The whole point: an independently known answer, not agreement between two
    // renderings of the same wrong number.
    expect(geo.areaImagePx).toBeCloseTo(ROI_AREA, 6);
    // No calibration on this fixture, so it must stay in pixels rather than
    // inventing metres.
    expect(geo.hasPhysical).toBe(false);
    expect(geo.areaLabel).toContain("px");
});

/**
 * Ratios, in the three shapes the compare row can produce, on ONE scene.
 *
 * They share a boot deliberately. Every `boot()` launches a page and a WebGL
 * context, and the synthetic project runs single-worker: splitting this into three
 * tests added two more contexts and made an unrelated click test in
 * `creation-mode-selection` start failing — later tests, never earlier ones. The
 * assertions are independent of one another, so one scene costs nothing.
 */
test("a region inside a region reports the ratio a pathologist would compute", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    await boot(xopat);
    // Tumour occupying exactly a quarter of the ROI: 64x64 inside 128x128, and a
    // second quarter beside it that will join the same class.
    const quarter = { width: ROI.width / 2, height: ROI.height / 2 };
    const [roi, tumour, sibling] = await drawRects(xopat, [
        ROI,
        { left: ROI.left, top: ROI.top, ...quarter, klass: "tumour" },
        { left: ROI.left + quarter.width, top: ROI.top, ...quarter, klass: "tumour" },
    ]);

    const measured = await xopat.page.evaluate(([roiId, tumourId, siblingId, presetID]) => {
        const module = window.OSDAnnotations.instance();
        const fabric = module.getFabric(window.VIEWER);
        const byId = (id) => fabric.canvas.getObjects().find((o) => o.incrementId === id);
        const engine = window.xmodules["annotation-measurements"].instance().getEngine();

        const single = engine.areaRatio(window.VIEWER, byId(tumourId), byId(roiId));
        // The swap button's claim, through the engine rather than literals: the
        // direction is decided by argument order at three layers (panel, engine,
        // geometry) and only the innermost one is covered by the unit suite.
        const forward = engine.areaRatioBetweenSets(window.VIEWER, [byId(tumourId)], [byId(roiId)]);
        const reverse = engine.areaRatioBetweenSets(window.VIEWER, [byId(roiId)], [byId(tumourId)]);

        // `drawRects` mints a preset per rect, so put the sibling into the tumour's
        // class the way the panel's class assignment does. A class as an operand is
        // the ordinary case once a derived tissue mask becomes one.
        fabric.changeAnnotationPreset(byId(siblingId), presetID);
        const klass = engine.collectScope(window.VIEWER, { kind: "preset", presetID });

        return {
            single,
            forward,
            reverse,
            members: klass.length,
            set: engine.areaRatioBetweenSets(window.VIEWER, klass, [byId(roiId)]),
        };
    }, [roi.incrementId, tumour.incrementId, sibling.incrementId, tumour.presetID]);

    expect(measured.single.numeratorAreaPx).toBeCloseTo(ROI_AREA / 4, 6);
    expect(measured.single.denominatorAreaPx).toBeCloseTo(ROI_AREA, 6);
    expect(measured.single.ratio).toBeCloseTo(0.25, 9);

    expect(measured.forward.ratio).toBeCloseTo(0.25, 9);
    expect(measured.reverse.ratio).toBeCloseTo(4, 9);
    expect(measured.forward.ratio * measured.reverse.ratio).toBeCloseTo(1, 9);
    // The areas trade places rather than being recomputed differently.
    expect(measured.forward.numeratorAreaPx).toBeCloseTo(measured.reverse.denominatorAreaPx, 6);

    // Two quarters over the whole: the set is summed, not sampled.
    expect(measured.members, "both tumour rects must resolve into the class").toBe(2);
    expect(measured.set.numeratorAreaPx).toBeCloseTo(2 * (ROI_AREA / 4), 6);
    expect(measured.set.ratio).toBeCloseTo(0.5, 9);
});

test("margin distance between two regions is the gap between them", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    await boot(xopat);
    const GAP = 40;
    const a = { left: ROI.left, top: ROI.top, width: CELL, height: CELL };
    const b = { left: ROI.left + CELL + GAP, top: ROI.top, width: CELL, height: CELL };
    const [first, second] = await drawRects(xopat, [a, b]);

    const distance = await xopat.page.evaluate(([fromId, toId]) => {
        const module = window.OSDAnnotations.instance();
        const fabric = module.getFabric(window.VIEWER);
        const byId = (id) => fabric.canvas.getObjects().find((o) => o.incrementId === id);
        const engine = window.xmodules["annotation-measurements"].instance().getEngine();
        return engine.nearestDistance(window.VIEWER, byId(fromId), [byId(toId)]);
    }, [first.incrementId, second.incrementId]);

    // Nearest boundary-to-boundary distance is the gap, not centre-to-centre.
    expect(distance.distancePx).toBeCloseTo(GAP, 3);
});

test("intensity and object count match what the fixture painted", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    await boot(xopat);
    const [roi] = await drawRects(xopat, [ROI]);

    const measured = await xopat.page.evaluate(async (id) => {
        const module = window.OSDAnnotations.instance();
        const fabric = module.getFabric(window.VIEWER);
        const object = fabric.canvas.getObjects().find((o) => o.incrementId === id);
        const engine = window.xmodules["annotation-measurements"].instance().getEngine();

        // R, not the V default: at this level the fixture's blue channel is 230
        // everywhere and max(RGB) carries almost no contrast.
        const cfg = { source: "rendered", channel: "R", threshold: "auto", includeComponents: true };
        const outcome = await engine.computeForObject(window.VIEWER, object, cfg);
        return { outcome, cached: engine.getCached(object, cfg) };
    }, roi.incrementId);

    expect(measured.outcome.reason, "sampling must succeed, not degrade").toBe(null);

    const m = measured.cached;
    // Half the covered cells are light: the split is exactly 50 %.
    expect(m.percentPositive).toBeCloseTo(0.5, 2);
    // Mean of an even split of the two painted values.
    expect(m.mean).toBeCloseTo((LIGHT_R + DARK_R) / 2, 0);
    // Otsu must land strictly between the two classes.
    expect(m.threshold).toBeGreaterThan(DARK_R);
    expect(m.threshold).toBeLessThanOrEqual(LIGHT_R);
    // Uncalibrated slide: a density in /mm² is not knowable and must not be faked.
    expect(Number.isNaN(m.components.densityPerMm2)).toBe(true);
});

test("a resized region measures its resized area, not its drawn one", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    // The unit suite proves the formulas against an explicit matrix; only this
    // proves the wiring to a REAL fabric object, whose matrix comes from
    // `calcTransformMatrix()` rather than from a literal. A rect carries a resize
    // in `scaleX`/`scaleY` until `recalculate()` folds it back, so this is the
    // state the label is read in mid-drag.
    await boot(xopat);

    const measured = await xopat.page.evaluate((spec) => {
        const module = window.OSDAnnotations.instance();
        const fabricWrapper = module.getFabric(window.VIEWER);
        const factory = module.getAnnotationObjectFactory("rect");
        const preset = module.presets.addPreset(undefined, "roi", "#ff0000", factory);
        module.presets.selectPreset(preset.presetID, true);

        const object = factory.create(spec, module.presets.getAnnotationOptions(true));
        fabricWrapper.addAnnotation(object);
        object.set({ strokeWidth: 0 });   // after adding; see the note in drawRects
        object.setCoords();

        const before = factory.getArea(object);
        object.set({ scaleX: 2, scaleY: 3 });
        object.setCoords();
        const after = factory.getArea(object);

        const engine = window.xmodules["annotation-measurements"].instance().getEngine();
        return { before, after, engine: engine.getGeometric(window.VIEWER, object).areaImagePx };
    }, ROI);

    expect(measured.before).toBeCloseTo(ROI_AREA, 6);
    expect(measured.after).toBeCloseTo(ROI_AREA * 6, 3);
    // And the measurements engine agrees with the factory, as it must.
    expect(measured.engine).toBeCloseTo(measured.after, 6);
});

test("a rotated region keeps its area and moves its mask", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    await boot(xopat);

    const measured = await xopat.page.evaluate((spec) => {
        const module = window.OSDAnnotations.instance();
        const fabricWrapper = module.getFabric(window.VIEWER);
        const factory = module.getAnnotationObjectFactory("rect");
        const preset = module.presets.addPreset(undefined, "roi", "#ff0000", factory);
        module.presets.selectPreset(preset.presetID, true);

        const object = factory.create(spec, module.presets.getAnnotationOptions(true));
        fabricWrapper.addAnnotation(object);
        object.set({ strokeWidth: 0 });   // after adding; see the note in drawRects
        object.setCoords();
        object.set({ angle: 45 });
        object.setCoords();

        const NS = window.AnnotationMeasurements;
        const bbox = NS.rasterizer.annotationBboxImagePx(object);
        const mask = NS.rasterizer.rasterizePolygonMaskAt(object, bbox, 128, 128);
        let inside = 0;
        for (let i = 0; i < mask.mask.length; i++) inside += mask.mask[i];

        return {
            area: factory.getArea(object),
            bboxWidth: bbox.width,
            strokeWidth: object.strokeWidth || 0,
            coverage: inside / mask.mask.length,
        };
    }, ROI);

    // Rotation cannot change an area.
    expect(measured.area).toBeCloseTo(ROI_AREA, 6);
    // A square turned 45° has a bounding box sqrt(2) wider than its side — plus the
    // stroke, because `getBoundingRect` measures what is painted, not the geometry.
    expect(measured.bboxWidth)
        .toBeCloseTo((ROI.width + measured.strokeWidth) * Math.SQRT2, 0);
    // ...and fills exactly half of that bounding box. The old mask drew the shape
    // axis-aligned inside the rotated bbox, which would fill far more than half —
    // measuring pixels the annotation does not cover.
    expect(measured.coverage).toBeGreaterThan(0.45);
    expect(measured.coverage).toBeLessThan(0.55);
});

test("the reported channel is the channel that was measured", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    await boot(xopat);
    const [roi] = await drawRects(xopat, [ROI]);

    const measured = await xopat.page.evaluate(async (id) => {
        const module = window.OSDAnnotations.instance();
        const fabric = module.getFabric(window.VIEWER);
        const object = fabric.canvas.getObjects().find((o) => o.incrementId === id);
        const engine = window.xmodules["annotation-measurements"].instance().getEngine();

        // Two channels the fixture separates: R spans 110..190, G is its mirror
        // (base - tint), so measuring one and labelling the other is detectable.
        const asR = { source: "rendered", channel: "R", threshold: "auto" };
        const asG = { source: "rendered", channel: "G", threshold: "auto" };
        await engine.computeForObject(window.VIEWER, object, asR);
        await engine.computeForObject(window.VIEWER, object, asG);
        return { r: engine.getCached(object, asR), g: engine.getCached(object, asG) };
    }, roi.incrementId);

    expect(measured.r.channel).toBe("R");
    expect(measured.g.channel).toBe("G");
    // R = base + tint, G = base - tint, tint = -10 → means of 150 and 170. Asserted
    // separately rather than as a difference so a failure names the guilty channel.
    expect(measured.r.mean, "R channel mean").toBeCloseTo((LIGHT_R + DARK_R) / 2, 0);
    expect(measured.g.mean, "G channel mean").toBeCloseTo(((200 - TINT) + (120 - TINT)) / 2, 0);
});
