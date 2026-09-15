/**
 * Who decides how many tiles a level has.
 *
 * OpenSeadragon derives it: `getNumTiles` scales the BASE image dimensions by
 * `getLevelScale(level)` and divides by the tile size. That works for a pyramid
 * built by halving, and fails for DICOM, where every level carries its own
 * independently rounded width and height. The implied height and the real one
 * then differ by a fraction of a pixel — and on a level that is a single tile
 * row, a fraction is a whole extra row of cells no frame maps to.
 *
 * These tests pin that the tile source answers from the level record instead,
 * using the exact numbers measured on an IDC slide, so a future "simplification"
 * back to OSD's formula fails here rather than in a viewer.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.OpenSeadragon = globalThis.OpenSeadragon || { TileSource: class {} };
// Additive, and never replaces an existing stub: these files may share a module
// registry, and the source captured whichever TileSource was defined first.
globalThis.OpenSeadragon.Point = globalThis.OpenSeadragon.Point ||
    class Point { constructor(x, y) { this.x = x; this.y = y; } };
globalThis.HTTPError = globalThis.HTTPError || class HTTPError extends Error {};

const { DICOMWebTileSource } = await import("../../tile-source.mjs");

/**
 * The two ends of the HTAN-OHSU pyramid this bug was found on
 * (study 2.25.5621…728). Level 6 of 10 is the first that is a single tile row:
 * 555 pixels tall with a 555-pixel tile.
 */
const IDC_BASE = { width: 69720, height: 35580, tileWidth: 1024, tileHeight: 1024, tilesX: 69, tilesY: 35 };
const IDC_SHORT = { width: 1089, height: 555, tileWidth: 1024, tileHeight: 555, tilesX: 2, tilesY: 1 };

function makeSource(levels) {
    const src = Object.create(DICOMWebTileSource.prototype);
    src.wsi = { levels };
    src.maxLevel = levels.length - 1;
    src.minLevel = 0;
    src.tileWidth = levels[0]?.tileWidth ?? 256;
    src.tileHeight = levels[0]?.tileHeight ?? 256;
    // What OSD would read for its own derivation.
    src.dimensions = { x: levels[0]?.width, y: levels[0]?.height };
    return src;
}

/** OpenSeadragon's own formula, verbatim (openseadragon.js `getNumTiles`). */
const osdNumTiles = (src, level) => ({
    x: Math.ceil(src.getLevelScale(level) * src.dimensions.x / src.getTileWidth(level)),
    y: Math.ceil(src.getLevelScale(level) * src.dimensions.y / src.getTileHeight(level)),
});

/* ------------------------------------------------------------------ */
/* The measured case                                                   */
/* ------------------------------------------------------------------ */

test("a short level reports its own grid, not the one OSD would infer", { tag: ["@unit"] }, async () => {
    const src = makeSource([IDC_BASE, IDC_SHORT]);
    const osdLevel = 0;                       // maxLevel(1) - index(1)

    // What the instance actually holds: 2 frames, side by side, one row.
    const grid = src.getNumTiles(osdLevel);
    expect({ x: grid.x, y: grid.y }).toEqual({ x: 2, y: 1 });

    // What OSD would have said, and why. `getLevelScale` is width-derived, so
    // the implied height is 35580 * (1089/69720) = 555.85 against a real 555 —
    // enough for `ceil` to invent a second row of tiles.
    const inferred = osdNumTiles(src, osdLevel);
    expect(inferred.y).toBe(2);
    expect(inferred.x).toBe(grid.x);          // only the short axis diverges
});

test("the phantom row is out of grid, and stays out of the sparse path", { tag: ["@unit"] }, async () => {
    const src = makeSource([IDC_BASE, IDC_SHORT]);
    const grid = src.getNumTiles(0);

    // OSD's inherited bounds check is `y < numTiles.y`. That is the whole fix:
    // the cell is rejected one layer above `tileExists`'s frame-map lookup.
    expect(1 < grid.y).toBe(false);

    // And the level is emphatically NOT sparse — it is dense with a complete
    // map. A phantom cell reporting itself as a hole is what sent a dense level
    // down the sparse path and produced "(sparse level)" in the console.
    expect(src.wsi.levels[1].sparse).toBeFalsy();
});

/* ------------------------------------------------------------------ */
/* Everything else must be unchanged                                   */
/* ------------------------------------------------------------------ */

test("a level whose axes agree reports what OSD would have", { tag: ["@unit"] }, async () => {
    const src = makeSource([IDC_BASE, IDC_SHORT]);
    const osdLevel = 1;                       // the base level

    const grid = src.getNumTiles(osdLevel);
    expect({ x: grid.x, y: grid.y }).toEqual({ x: 69, y: 35 });
    expect(osdNumTiles(src, osdLevel)).toEqual({ x: 69, y: 35 });
});

test("the stored grid wins over one derived from the tile size", { tag: ["@unit"] }, async () => {
    // The derived (SEG / Parametric Map) ingest collapses a whole-slide raster
    // to ONE logical tile stretched over the full extent. Re-deriving the grid
    // from width/tileWidth would undo that and ask for tiles that do not exist.
    const collapsed = {
        width: 4096, height: 4096, tileWidth: 4096, tileHeight: 4096,
        frameWidth: 1024, frameHeight: 1024, tilesX: 1, tilesY: 1,
    };
    const src = makeSource([collapsed]);
    const grid = src.getNumTiles(0);
    expect({ x: grid.x, y: grid.y }).toEqual({ x: 1, y: 1 });
});

test("a hand-built level with no stored grid falls back to its geometry", { tag: ["@unit"] }, async () => {
    // `RadiologySeriesTileSource` builds its single level directly and never
    // goes through WSI ingest, so it carries no tilesX/tilesY.
    const src = makeSource([{ width: 2048, height: 1024, tileWidth: 512, tileHeight: 512 }]);
    const grid = src.getNumTiles(0);
    expect({ x: grid.x, y: grid.y }).toEqual({ x: 4, y: 2 });
});

test("a level index outside the pyramid yields a grid instead of throwing", { tag: ["@unit"] }, async () => {
    // OSD asks about levels it has not bounded yet — the same reason
    // `getTileUrl` optional-chains the level.
    const src = makeSource([IDC_BASE, IDC_SHORT]);
    const grid = src.getNumTiles(9);
    expect(Number.isFinite(grid.x) && Number.isFinite(grid.y)).toBe(true);
});

/* ------------------------------------------------------------------ */
/* Slide orientation                                                   */
/* ------------------------------------------------------------------ */

/** What every IDC slide declares: a reflection, `(x, y) -> (-y, -x)`. */
const IDC_SLIDE = { orientation: [0, -1, 0, -1, 0, 0], originX: 0, originY: 0 };

const withSlide = (level, slide) => ({ ...level, slide, frames: { "1_0": 2, "0_0": 1 } });

test("the measured orientation turns the image and moves nothing else", { tag: ["@unit"] }, async () => {
    // 180 degrees, handed to OSD, which honours it in rendering AND in
    // coordinate conversion — so annotations, masks and measurements follow with
    // nothing to translate. The raster itself must not be touched: transposing
    // it here is what rendered a landscape slide as portrait.
    const src = makeSource([
        withSlide(IDC_BASE, IDC_SLIDE),
        withSlide(IDC_SHORT, IDC_SLIDE),
    ]);
    const placement = src._applySlideOrientation();

    expect(placement).toEqual({ degrees: 180 });
    expect(placement.flipped).toBe(undefined);

    const short = src.wsi.levels[1];
    expect({ w: short.width, h: short.height }).toEqual({ w: 1089, h: 555 });
    expect({ tw: short.tileWidth, th: short.tileHeight }).toEqual({ tw: 1024, th: 555 });
    expect({ x: short.tilesX, y: short.tilesY }).toEqual({ x: 2, y: 1 });
    expect(short.frames).toEqual({ "1_0": 2, "0_0": 1 });

    // Published for the SR converter, which needs it whatever the renderer does.
    expect(src.wsi.slide.orientation).toEqual(IDC_SLIDE.orientation);
});

test("an orientation that would need a mirror renders as stored", { tag: ["@unit"] }, async () => {
    const mirrored = { orientation: [1, 0, 0, 0, 1, 0], originX: 0, originY: 0 };
    const src = makeSource([withSlide(IDC_BASE, mirrored)]);
    expect(src._applySlideOrientation()).toBe(undefined);
    expect(src.wsi.levels[0].width).toBe(69720);
});

test("the operator override suppresses the rotation but keeps the descriptor", { tag: ["@unit"] }, async () => {
    // `ignoreSlideOrientation` is about PIXELS. Annotations still have to map to
    // the frame of reference the file declares, so the descriptor survives.
    const src = makeSource([withSlide(IDC_BASE, { ...IDC_SLIDE, originX: 2 })]);
    src.ignoreSlideOrientation = true;

    expect(src._applySlideOrientation()).toBe(undefined);
    expect(src.wsi.slide.originX).toBe(2);
});

test("one answer covers the whole series", { tag: ["@unit"] }, async () => {
    // A level whose instance carried no orientation must not be placed
    // differently from its siblings.
    const src = makeSource([withSlide(IDC_BASE, IDC_SLIDE), withSlide(IDC_SHORT, undefined)]);
    expect(src._applySlideOrientation()).toEqual({ degrees: 180 });
});

/* ------------------------------------------------------------------ */
/* Orientation of DERIVED objects (SEG / Parametric Map)               */
/* ------------------------------------------------------------------ */

/**
 * The overlay is a TiledImage of its own, so it needs a rotation of its own —
 * nothing is inherited from the slide's. Slide-orientation support landed after
 * the overlay path existed and `_initializeFromServer` is a full override here,
 * so the resolver simply never ran: on every IDC slide the slide turned 180° and
 * the segmentation did not, which over a whole-slide extent reads as a point
 * reflection about the centre rather than as an obvious rotation.
 *
 * These drive the REAL `_initializeFromServer` rather than calling the resolver
 * directly, because the missing call was the entire bug.
 */
const DicomQuery = (await import("../../dicom-query.mjs")).default;
const { DICOMDerivedTileSource } = await import("../../derived-tile-source.mjs");

/** One 4096² SEG level with a single segment, the usual downsampled shape. */
const SEG_LEVEL = { width: 4096, height: 2048, tileWidth: 512, tileHeight: 512, tilesX: 8, tilesY: 4 };

async function makeDerived(levels, options = {}) {
    const { parentDescriptor, ...rest } = options;
    const src = Object.create(DICOMDerivedTileSource.prototype);
    Object.assign(src, {
        kind: "seg",
        studyUID: "2.25.1",
        seriesUID: "2.25.2",
        sourceSeriesUID: "2.25.3",
        client: {},
        ...rest,
    });

    const originalFind = DicomQuery.findDerivedItem;
    const originalDescriptor = DicomQuery.slideDescriptorForSeries;
    DicomQuery.findDerivedItem = async () => ({
        levels,
        segments: [{ number: 1, label: "Tumor", color: [255, 0, 0] }],
        pixel: { photometricInterpretation: "MONOCHROME2", samplesPerPixel: 1 },
    });
    DicomQuery.slideDescriptorForSeries = async () => parentDescriptor ?? null;
    try {
        await src._initializeFromServer();
    } finally {
        DicomQuery.findDerivedItem = originalFind;
        DicomQuery.slideDescriptorForSeries = originalDescriptor;
    }
    return src;
}

test("a derived object is placed by its own orientation, like the slide", { tag: ["@unit"] }, async () => {
    const src = await makeDerived([withSlide(SEG_LEVEL, IDC_SLIDE)]);

    // The same 180° the slide resolves to — which is the point: the pair must
    // agree, and they agree by both reading the tag rather than by one copying
    // the other.
    expect(src.getIntrinsicPlacement()).toEqual({ degrees: 180 });
    // Never a flip: OSD draws one but does not convert coordinates through it.
    expect("flipped" in src.getIntrinsicPlacement()).toBe(false);

    // The raster is untouched — placement only.
    expect({ w: src.width, h: src.height }).toEqual({ w: 4096, h: 2048 });
});

test("the operator override suppresses a derived rotation too", { tag: ["@unit"] }, async () => {
    // Suppressing on the slide and not on the overlay would misalign them just as
    // surely as reading it on neither.
    const src = await makeDerived([withSlide(SEG_LEVEL, IDC_SLIDE)], { ignoreSlideOrientation: true });

    expect(src.getIntrinsicPlacement()).toBe(undefined);
    expect(src.wsi.slide.orientation).toEqual(IDC_SLIDE.orientation);
});

test("a derived object with no orientation anywhere is not rotated", { tag: ["@unit"] }, async () => {
    const src = await makeDerived([withSlide(SEG_LEVEL, undefined)]);
    expect(src.getIntrinsicPlacement()).toBe(undefined);
});

test("a derived object with no orientation inherits the slide's", { tag: ["@unit"] }, async () => {
    // The measured case: every IDC SEG and Parametric Map carries no
    // ImageOrientationSlide of its own, so reading only its own tag left it at 0°
    // under a slide at 180° — a point reflection over a whole-slide extent.
    const src = await makeDerived([withSlide(SEG_LEVEL, undefined)], { parentDescriptor: IDC_SLIDE });

    expect(src.getIntrinsicPlacement()).toEqual({ degrees: 180 });
    expect(src.wsi.slide.orientation).toEqual(IDC_SLIDE.orientation);
});

test("a derived object's own orientation outranks the slide's", { tag: ["@unit"] }, async () => {
    // A store that legitimately writes a different orientation on the derived
    // object must stay honest — inheritance is the last resort, not the rule.
    const quarterTurn = { orientation: [1, 0, 0, 0, -1, 0], originX: 0, originY: 0 };
    const src = await makeDerived([withSlide(SEG_LEVEL, quarterTurn)], { parentDescriptor: IDC_SLIDE });

    expect(src.wsi.slide.orientation).toEqual(quarterTurn.orientation);
    expect(src.getIntrinsicPlacement()).not.toEqual({ degrees: 180 });
});

test("the operator override suppresses an INHERITED rotation too", { tag: ["@unit"] }, async () => {
    // Suppressing on the slide but not on an overlay that inherited from it would
    // misalign the pair in the opposite direction.
    const src = await makeDerived([withSlide(SEG_LEVEL, undefined)],
        { parentDescriptor: IDC_SLIDE, ignoreSlideOrientation: true });

    expect(src.getIntrinsicPlacement()).toBe(undefined);
    expect(src.wsi.slide.orientation).toEqual(IDC_SLIDE.orientation);
});

/* ------------------------------------------------------------------ */
/* A collapsed frame covers what its spacing says, not the whole matrix */
/* ------------------------------------------------------------------ */

/**
 * The measured IDC Parametric Map: a 618x349 raster at 0.0556665 mm per pixel
 * over a 74003x38857 matrix whose slide is 0.5015 um per pixel. That is 111 slide
 * pixels per map pixel, so the raster covers 68598x38739 — full height, 92.7% of
 * the width. Drawn across the whole matrix it was 7.9% too wide, zero error at the
 * origin and ~5400 px at the right edge.
 */
const SLIDE_SPACING = { micronsX: 0.5015, micronsY: 0.5015 };

const collapsed = (frameWidth, frameHeight, microns) => ({
    width: 74003, height: 38857,
    // The collapse: one logical tile spanning the entire matrix.
    tileWidth: 74003, tileHeight: 38857,
    tilesX: 1, tilesY: 1,
    frameWidth, frameHeight,
    micronsX: microns, micronsY: microns,
    frames: { "0_0": { 1: 1 } },
});

/**
 * The invariant whose violation blanked the overlay and pinned the render loop.
 *
 * OSD derives `getTileAtPoint` from `getTileWidth` while this source pins
 * `getNumTiles` to the stored grid, so a level whose stored grid disagrees with
 * `ceil(size/tileSize)` hands `_visitTiles` indices that do not exist. Coverage
 * then never completes, corner tiles can invert, nothing is drawn, and
 * `setDrawn()` re-arms `_needsDraw` every frame. Nothing else asserts this.
 */
const expectConsistentGrid = (src) => {
    for (const L of src.wsi.levels) {
        expect({
            level: `${L.width}x${L.height}/${L.tileWidth}x${L.tileHeight}`,
            x: Math.ceil(L.width / L.tileWidth),
            y: Math.ceil(L.height / L.tileHeight),
        }).toEqual({
            level: `${L.width}x${L.height}/${L.tileWidth}x${L.tileHeight}`,
            x: L.tilesX,
            y: L.tilesY,
        });
    }
};

test("a partly-covering raster becomes an image of its own extent", { tag: ["@unit"] }, async () => {
    const src = await makeDerived([collapsed(618, 349, 55.6665)],
        { kind: "pmap", parentDescriptor: { ...IDC_SLIDE, ...SLIDE_SPACING } });
    const L = src.wsi.levels[0];

    // The IMAGE is what it covers — not the matrix it declares — and its grid stays
    // self-consistent, which is what the previous attempt broke.
    expect({ w: L.width, h: L.height }).toEqual({ w: 68598, h: 38739 });
    expect({ w: L.tileWidth, h: L.tileHeight }).toEqual({ w: 68598, h: 38739 });
    expect({ x: L.tilesX, y: L.tilesY }).toEqual({ x: 1, y: 1 });
    expectConsistentGrid(src);
});

test("the covered rect is placed, with the rotation pivot cancelled", { tag: ["@unit"] }, async () => {
    const src = await makeDerived([collapsed(618, 349, 55.6665)],
        { kind: "pmap", parentDescriptor: { ...IDC_SLIDE, ...SLIDE_SPACING } });
    const p = src.getIntrinsicPlacement();

    // Content occupies the LEFT 92.7% of the matrix. The slide is half-turned, so
    // on screen it belongs in the RIGHT 92.7% — x + width lands exactly on 1.
    expect(p.degrees).toBe(180);
    expect(p.width).toBeCloseTo(68598 / 74003, 9);
    expect(p.x).toBeCloseTo(1 - 68598 / 74003, 9);
    expect(p.x + p.width).toBeCloseTo(1, 9);
    // y is scaled by the matrix WIDTH, OSD's convention, not by its height.
    expect(p.y).toBeCloseTo((38857 - 38739) / 74003, 9);
});

test("without a rotation the covered rect is placed where the content is", { tag: ["@unit"] }, async () => {
    // The pivot term must vanish at 0 degrees — a sign error there is invisible at
    // one angle and obvious across two.
    const src = await makeDerived([collapsed(618, 349, 55.6665)],
        { kind: "pmap", ignoreSlideOrientation: true, parentDescriptor: { ...IDC_SLIDE, ...SLIDE_SPACING } });
    const p = src.getIntrinsicPlacement();

    expect(p.degrees).toBe(0);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0, 9);
    expect(p.width).toBeCloseTo(68598 / 74003, 9);
});

test("a raster that does cover the whole matrix is left alone", { tag: ["@unit"] }, async () => {
    // The SEG's coarse level: 1024x537 at 72.27x, i.e. the whole slide rounded.
    // Re-placing it would move it for nothing.
    const src = await makeDerived([collapsed(1024, 537, 0.5015 * 72.2686)],
        { parentDescriptor: { ...IDC_SLIDE, ...SLIDE_SPACING } });

    expect({ w: src.wsi.levels[0].width, h: src.wsi.levels[0].height }).toEqual({ w: 74003, h: 38857 });
    // Rotation only — no rect, so the pipeline leaves x/y/width to OSD's default.
    expect(src.getIntrinsicPlacement()).toEqual({ degrees: 180 });
});

test("without a spacing on either side the image is left as it was", { tag: ["@unit"] }, async () => {
    // Degrade to the previous behaviour rather than invent a downsample: a crop
    // computed from a guess looks plausible and is wrong.
    const noneOnObject = await makeDerived([collapsed(618, 349, undefined)],
        { kind: "pmap", parentDescriptor: { ...IDC_SLIDE, ...SLIDE_SPACING } });
    expect(noneOnObject.wsi.levels[0].width).toBe(74003);
    expect(noneOnObject.getIntrinsicPlacement()).toEqual({ degrees: 180 });

    const noneOnSlide = await makeDerived([collapsed(618, 349, 55.6665)],
        { kind: "pmap", parentDescriptor: IDC_SLIDE });
    expect(noneOnSlide.wsi.levels[0].width).toBe(74003);
});

test("coverage larger than the declared matrix is refused, not cropped", { tag: ["@unit"] }, async () => {
    // The file contradicting itself. Cropping on that basis would be a confident
    // wrong answer, so the previous behaviour stands and the reason is logged.
    const src = await makeDerived([collapsed(618, 349, 55.6665 * 2)],
        { kind: "pmap", parentDescriptor: { ...IDC_SLIDE, ...SLIDE_SPACING } });
    expect(src.wsi.levels[0].width).toBe(74003);
    expect(src.getIntrinsicPlacement()).toEqual({ degrees: 180 });
});

test("an ordinary tiled level is never re-placed", { tag: ["@unit"] }, async () => {
    // Only the collapse is in question; a level that tiles its matrix already
    // describes itself correctly.
    const tiled = { ...collapsed(256, 256, 55.6665), tileWidth: 256, tileHeight: 256, tilesX: 290, tilesY: 152 };
    const src = await makeDerived([tiled], { parentDescriptor: { ...IDC_SLIDE, ...SLIDE_SPACING } });

    expect({ w: src.wsi.levels[0].width, h: src.wsi.levels[0].height }).toEqual({ w: 74003, h: 38857 });
    expectConsistentGrid(src);
});

/* ------------------------------------------------------------------ */
/* Which instance of the slide carries the spacing                     */
/* ------------------------------------------------------------------ */

/**
 * The regression that shrank a 92.7%-wide overlay to a 5.8% sliver in the corner.
 *
 * Orientation is a property of the SERIES, so reading whichever instance QIDO
 * listed first was fine for the rotation. Spacing is a property of the LEVEL, and
 * a WSI series is a whole pyramid: the measured store listed the 4625-wide level
 * of a 74003-wide slide first — exactly 16x too coarse — so the downsample came
 * out 6.937 instead of 111.
 */
const wsiInstance = (uid, width, height) => ({
    "00080018": { Value: [uid] },
    "00480006": { Value: [width] },
    "00480007": { Value: [height] },
});

/** Shared Functional Groups > Pixel Measures > PixelSpacing, in mm. */
const instanceMeta = (mm) => [{
    "52009229": { Value: [{ "00289110": { Value: [{ "00280030": { Value: [mm, mm] } }] } }] },
    "00480102": { Value: [0, -1, 0, -1, 0, 0] },
}];

async function withStubbedStore(instances, metaByUid, fn) {
    const originalQido = DicomQuery.qidoSafe;
    const originalMeta = DicomQuery.wadoMetadata;
    DicomQuery.qidoSafe = async () => instances;
    DicomQuery.wadoMetadata = async (client, path) => {
        const uid = decodeURIComponent(path.split("/instances/")[1].split("/")[0]);
        return metaByUid[uid];
    };
    try { return await fn(); } finally {
        DicomQuery.qidoSafe = originalQido;
        DicomQuery.wadoMetadata = originalMeta;
    }
}

test("the slide's spacing comes from its base level, not the first listed instance", { tag: ["@unit"] }, async () => {
    const instances = [
        wsiInstance("coarse", 4625, 2428),      // listed FIRST, 16x too coarse
        wsiInstance("base", 74003, 38857),
    ];
    const meta = {
        coarse: instanceMeta(0.5015 * 16 / 1000),
        base: instanceMeta(0.5015 / 1000),
    };

    const got = await withStubbedStore(instances, meta, () =>
        DicomQuery.slideDescriptorForSeries({}, "2.25.1", "2.25.3", { width: 74003, height: 38857 }));

    expect(got.micronsX).toBeCloseTo(0.5015, 6);
    expect({ w: got.matrixWidth, h: got.matrixHeight }).toEqual({ w: 74003, h: 38857 });
    // The number that matters downstream: 55.6665 / 0.5015 = 111, not 6.937.
    expect(55.6665 / got.micronsX).toBeCloseTo(111, 3);
});

test("with no expected matrix the largest instance still wins", { tag: ["@unit"] }, async () => {
    const instances = [wsiInstance("coarse", 4625, 2428), wsiInstance("base", 74003, 38857)];
    const meta = { coarse: instanceMeta(0.008024), base: instanceMeta(0.0005015) };

    const got = await withStubbedStore(instances, meta, () =>
        DicomQuery.slideDescriptorForSeries({}, "2.25.1", "2.25.3"));
    expect(got.matrixWidth).toBe(74003);
});

test("a store that lists no dimensions falls back to the first instance", { tag: ["@unit"] }, () => {
    const bare = [{ "00080018": { Value: ["only"] } }, { "00080018": { Value: ["other"] } }];
    expect(DicomQuery._pickBaseInstance(bare, { width: 74003, height: 38857 })).toBe(bare[0]);
});

test("a spacing read from the wrong level is refused, not used", { tag: ["@unit"] }, async () => {
    // Defence in depth for the above: if the instance that carried the spacing
    // describes a different matrix than this object does, the ratio is meaningless
    // and the overlay stays stretched rather than being confidently misplaced.
    const src = await makeDerived([collapsed(618, 349, 55.6665)], {
        kind: "pmap",
        parentDescriptor: { ...IDC_SLIDE, ...SLIDE_SPACING, matrixWidth: 4625, matrixHeight: 2428 },
    });
    expect(src.wsi.levels[0].width).toBe(74003);
    expect(src.getIntrinsicPlacement()).toEqual({ degrees: 180 });
});

test("a multi-level derived object is never re-placed", { tag: ["@unit"] }, async () => {
    // The SEG case. Its coarse level looks exactly like the collapse — one tile
    // spanning the level — so gating on that shape alone ran this on a 1024x537
    // level and compared a base-resolution coverage against it.
    const src = await makeDerived([
        withSlide(SEG_LEVEL, IDC_SLIDE),
        { ...collapsed(1024, 537, 0.5015 * 72.2686), width: 1024, height: 537,
            tileWidth: 1024, tileHeight: 537 },
    ], { parentDescriptor: { ...IDC_SLIDE, ...SLIDE_SPACING } });

    expect(src.wsi.levels[1].width).toBe(1024);
    expect(src.getIntrinsicPlacement()).toEqual({ degrees: 180 });
});

/* ------------------------------------------------------------------ */
/* Where a functional-groups object keeps the tag                      */
/* ------------------------------------------------------------------ */

const { default: DicomQueryClass } = await import("../../dicom-query.mjs");

test("orientation nested in the Shared Functional Groups is found", { tag: ["@unit"] }, async () => {
    // A SEG / Parametric Map is a multi-frame functional-groups object; it does
    // not carry slide geometry at the top level the way a WSI image does.
    const descriptor = DicomQueryClass._parseSlideDescriptor({
        "52009229": { Value: [{
            "00209116": { Value: [{ "00480102": { Value: [0, -1, 0, -1, 0, 0] } }] },
        }] },
    });

    expect(descriptor.orientation).toEqual([0, -1, 0, -1, 0, 0]);
    expect({ x: descriptor.originX, y: descriptor.originY }).toEqual({ x: 0, y: 0 });
});

test("a top-level orientation still wins over a nested one", { tag: ["@unit"] }, async () => {
    const descriptor = DicomQueryClass._parseSlideDescriptor({
        "00480102": { Value: [1, 0, 0, 0, -1, 0] },
        "52009229": { Value: [{ "00480102": { Value: [0, -1, 0, -1, 0, 0] } }] },
    });
    expect(descriptor.orientation).toEqual([1, 0, 0, 0, -1, 0]);
});

test("a nested origin is read alongside a nested orientation", { tag: ["@unit"] }, async () => {
    const descriptor = DicomQueryClass._parseSlideDescriptor({
        "52009229": { Value: [{
            "00480102": { Value: [0, -1, 0, -1, 0, 0] },
            "00480008": { Value: [{ "0040072A": { Value: [1.5] }, "0040073A": { Value: [2.5] } }] },
        }] },
    });
    expect({ x: descriptor.originX, y: descriptor.originY }).toEqual({ x: 1.5, y: 2.5 });
});

test("a Per-Frame group is never mistaken for a Shared one", { tag: ["@unit"] }, async () => {
    // A per-frame value describes ONE frame; adopting frame 0's as the whole
    // object's is the guess this parser exists to avoid.
    expect(DicomQueryClass._parseSlideDescriptor({
        "52009230": { Value: [{ "00480102": { Value: [0, -1, 0, -1, 0, 0] } }] },
    })).toBe(null);
});

test("a resolved orientation is reported to the owner", { tag: ["@unit"] }, async () => {
    // The slide and its overlay are built independently and in no fixed order, so
    // the owner is the only thing that can see both and name a disagreement.
    const seen = [];
    await makeDerived([withSlide(SEG_LEVEL, IDC_SLIDE)], { reportOrientation: r => seen.push(r) });

    expect(seen).toEqual([{
        studyUID: "2.25.1", seriesUID: "2.25.2", sourceSeriesUID: "2.25.3", degrees: 180,
    }]);
});
