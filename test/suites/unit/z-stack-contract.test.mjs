/**
 * The z-stack core used to recognize planes by scanning tile URLs for `z=<int>`
 * and to cache them only as `rasterBlob`. Both assumptions are gone: a plane URL
 * now comes from the source itself (`setZDepth` → `getTileUrl` → restore), the
 * "is this the tile's original plane?" question is a URL comparison, and cache
 * handling is decided from OSD's converter tables.
 *
 * These vectors pin the two source shapes that motivated the change — a
 * `z=`-parameterized WSI source (the shipped `rationai-wsi-tile-source`, whose
 * behaviour must not move) and a per-instance-URL source (DICOM CT) — plus the
 * defaults that make an unaware source behave exactly as before.
 */
import { test, expect } from "@xopat/test-harness";

// The module is a browser script; give it the globals it reads lazily.
globalThis.window = globalThis.window ?? globalThis;
const OSD = {
    converter: { copyings: {}, destructors: {} },
    TileSource: { prototype: { getTileHashKey() { return "default"; } } },
    ImageJob: function ImageJob() { throw new Error("not used in unit tests"); },
};
globalThis.window.OpenSeadragon = OSD;
globalThis.window.APPLICATION_CONTEXT = { getOption: (key, def) => def };

const { ViewerDepthController, withPlane, mapPlaneIndex, canCopyDataType, canShareDataType } =
    await import("../../../src/classes/app/viewer-depth-controller.ts");

/** A minimal conformant z-stack source over an arbitrary URL scheme. */
function makeSource(urlFor, { count = 5, fileId = "file-1", spacingUm, ...rest } = {}) {
    const src = {
        fileId,
        zStack: { count, index: 0, ...(spacingUm === undefined ? {} : { spacingUm }) },
        setZDepth(i) {
            src.zStack.index = Math.max(0, Math.min(count - 1, Math.round(i)));
        },
        getTileUrl(level, x, y) {
            return urlFor(level, x, y, src.zStack.index);
        },
        getTileHashKey(level, x, y) {
            return `${x}_${y}/${level}/${fileId}`;   // z-independent, carries identity
        },
        ...rest,
    };
    return src;
}

/** `&z=<n>` scheme — what `modules/rationai-wsi-tile-source` emits. */
const zParamUrl = (level, x, y, z) => `https://wsi/tile?x=${x}&y=${y}&level=${level}&z=${z}`;
/** Per-plane instance URL — what a DICOMweb CT series would emit. */
const perInstanceUrl = (level, x, y, z) => `https://dicom/instances/uid-${z}/frames/1`;

function makeTile(src, { level = 2, x = 1, y = 3 } = {}) {
    const url = src.getTileUrl(level, x, y);
    return { level, x, y, getUrl: () => url, originalCacheKey: `${x}_${y}/${level}/${src.fileId}` };
}

function makeViewer(items = []) {
    const world = {
        getItemCount: () => items.length,
        getItemAt: (i) => items[i],
    };
    return { world, addHandler() {}, removeHandler() {}, tileCache: { _zombiesLoaded: {}, _zombiesLoadedCount: 0 } };
}

const controllerFor = (sources) =>
    new ViewerDepthController(makeViewer(sources.map(source => ({ source }))));

test("withPlane hands the source back at its original plane", { tag: ["@unit"] }, () => {
    const src = makeSource(zParamUrl);
    src.setZDepth(3);

    const url = withPlane(src, 1, () => src.getTileUrl(0, 0, 0));
    expect(url).toContain("z=1");
    expect(src.zStack.index).toBe(3);

    expect(() => withPlane(src, 1, () => { throw new Error("boom"); })).toThrow("boom");
    expect(src.zStack.index).toBe(3);   // restored on the throwing path too

    // No flip at all when the plane is already active, or the source cannot flip.
    expect(withPlane(src, 3, () => "same")).toBe("same");
    expect(withPlane({ zStack: { count: 2, index: 0 } }, 1, () => "nosetter")).toBe("nosetter");
});

test("a plane URL is asked of the source, whatever its scheme", { tag: ["@unit"] }, () => {
    const zSrc = makeSource(zParamUrl);
    const dicomSrc = makeSource(perInstanceUrl, { fileId: "series-9" });
    const controller = controllerFor([zSrc, dicomSrc]);

    const zTile = makeTile(zSrc);
    const dicomTile = makeTile(dicomSrc);

    // Byte-identical to what the old `z=` regex rewrite produced.
    expect(controller.tilePlaneUrl(zSrc, zTile, 2))
        .toBe(zSrc.getTileUrl(zTile.level, zTile.x, zTile.y).replace(/([?&]z=)\d+/, "$12"));
    // ...and the shape the regex could never express.
    expect(controller.tilePlaneUrl(dicomSrc, dicomTile, 2)).toBe("https://dicom/instances/uid-2/frames/1");

    expect(zSrc.zStack.index).toBe(0);
    expect(dicomSrc.zStack.index).toBe(0);

    // A source that cannot address a tile by URL is skipped, not guessed at.
    const vector = makeSource(() => ({ notAString: true }));
    expect(controller.tilePlaneUrl(vector, makeTile(zSrc), 1)).toBe(null);
});

test("the tile's original plane is recognized by URL identity", { tag: ["@unit"] }, () => {
    for (const [scheme, id] of [[zParamUrl, "wsi"], [perInstanceUrl, "ct"]]) {
        const src = makeSource(scheme, { fileId: id });
        const controller = controllerFor([src]);
        const tile = makeTile(src);          // downloaded at plane 0

        src.setZDepth(4);
        expect(controller.holdsOriginPlane(src, tile, 4)).toBe(false);
        expect(controller.holdsOriginPlane(src, tile, 0)).toBe(true);
        expect(src.zStack.index).toBe(4);    // probing never disturbs the active plane
    }
});

test("cache handling is read off OSD's converter, not declared by the source", { tag: ["@unit"] }, () => {
    // Mirrors what OSD actually teaches (openseadragon.js:18639-18642) plus the
    // HTML drawer's destructor for `image` (:23727).
    OSD.converter.copyings = { image: () => {}, rasterBlob: () => {}, imageBitmap: () => {} };
    OSD.converter.destructors = { image: () => {} };
    try {
        // Unchanged for the shipped WSI path: blobs are copied out as before.
        expect(canCopyDataType("rasterBlob")).toBe(true);
        expect(canShareDataType("rasterBlob")).toBe(true);

        expect(canCopyDataType("image")).toBe(true);
        expect(canShareDataType("image")).toBe(false);      // owned — never in two records

        // The types the `rasterBlob` literal used to lock out of the plane cache:
        // no copy edge exists, so a copy would have resolved `undefined`, but
        // nothing owns them either — they are parked and shared by reference.
        for (const type of ["rawTiff", "gpuTextureSet"]) {
            expect(canCopyDataType(type)).toBe(false);
            expect(canShareDataType(type)).toBe(true);
        }
    } finally {
        OSD.converter.copyings = {};
        OSD.converter.destructors = {};
    }
});

test("zombie purge matches on fileId or tileSourceId", { tag: ["@unit"] }, () => {
    const withFileId = makeSource(zParamUrl, { fileId: "abc-file" });
    const withSourceId = makeSource(perInstanceUrl, { fileId: null, tileSourceId: "dicom:series-7" });
    const viewer = makeViewer([{ source: withFileId }, { source: withSourceId }]);
    const controller = new ViewerDepthController(viewer);

    const destroyed = [];
    const zombie = (name) => ({ destroy: () => destroyed.push(name) });
    viewer.tileCache._zombiesLoaded = {
        "0_0/2/abc-file": zombie("wsi"),
        "z://3/0_0/2/abc-file": zombie("wsi-plane"),
        "0_0/0/dicom:series-7": zombie("ct"),
        "0_0/2/someone-else": zombie("other"),
    };
    viewer.tileCache._zombiesLoadedCount = 4;

    controller.purgeZombiePlanes();

    expect(destroyed.sort()).toEqual(["ct", "wsi", "wsi-plane"]);
    expect(Object.keys(viewer.tileCache._zombiesLoaded)).toEqual(["0_0/2/someone-else"]);
});

test("plane cache keys stay z-independent per tile", { tag: ["@unit"] }, () => {
    const src = makeSource(perInstanceUrl, { fileId: "series-9" });
    const controller = controllerFor([src]);
    const tile = makeTile(src);

    expect(controller.zCacheKey(0, tile)).toBe(`z://0/${tile.originalCacheKey}`);
    expect(controller.zCacheKey(7, tile)).toBe(`z://7/${tile.originalCacheKey}`);
    // The tile identity itself never mentions the plane.
    expect(tile.originalCacheKey).not.toContain("uid-");
});

test("mapPlaneIndex keeps unequal stacks at the same depth", { tag: ["@unit"] }, () => {
    const stack = (count, spacingUm) => ({ count, index: 0, ...(spacingUm ? { spacingUm } : {}) });

    // EXACT — equal counts, no spacing declared: identity (today's behaviour).
    for (const i of [0, 3, 39]) expect(mapPlaneIndex(stack(40), stack(40), i)).toBe(i);

    // PHYSICAL — spacing wins over equal counts. An overlay sampled every 2 µm
    // against a 1 µm background sits at half the index...
    expect(mapPlaneIndex(stack(40, 1), stack(40, 2), 10)).toBe(5);
    // ...and the reverse doubles it, clamped at the overlay's own end.
    expect(mapPlaneIndex(stack(40, 2), stack(40, 1), 10)).toBe(20);
    expect(mapPlaneIndex(stack(40, 1), stack(6, 1), 30)).toBe(5);   // shorter stack stops at its end
    expect(mapPlaneIndex(stack(40, 3), stack(40, 3), 7)).toBe(7);   // equal spacing == identity

    // PROPORTIONAL — different counts, no spacing to go by.
    expect(mapPlaneIndex(stack(40), stack(3), 0)).toBe(0);
    expect(mapPlaneIndex(stack(40), stack(3), 39)).toBe(2);
    expect(mapPlaneIndex(stack(40), stack(3), 20)).toBe(1);
    expect(mapPlaneIndex(stack(3), stack(40), 2)).toBe(39);

    // Clamping and degenerate axes.
    expect(mapPlaneIndex(stack(40), stack(3), 999)).toBe(2);
    expect(mapPlaneIndex(stack(40), stack(3), -5)).toBe(0);
    expect(mapPlaneIndex(stack(40), stack(1), 10)).toBe(0);         // single-plane target
    expect(mapPlaneIndex(stack(1), stack(40), 10)).toBe(10);        // no axis to map from
});

test("one setDepth gives every layer its own aligned index", { tag: ["@unit"] }, () => {
    // Background 40 planes @1µm, an overlay sampled every 4µm, and a coarse
    // 3-plane mask with no spacing at all — one scrub, three different indices.
    const bg = makeSource(zParamUrl, { count: 40, spacingUm: 1, fileId: "bg" });
    const overlay = makeSource(perInstanceUrl, { count: 10, spacingUm: 4, fileId: "ov" });
    const mask = makeSource(zParamUrl, { count: 3, fileId: "mask" });
    const controller = controllerFor([bg, overlay, mask]);

    controller.setDepth(20);

    expect(controller.getRange().index).toBe(20);   // reference axis is what the UI sees
    expect(bg.zStack.index).toBe(20);
    expect(overlay.zStack.index).toBe(5);           // 20 µm / 4 µm
    expect(mask.zStack.index).toBe(1);              // proportional: 20/39 of 2

    // ...and each source's plane URL follows its own index.
    const tile = makeTile(overlay);
    expect(controller.tilePlaneUrl(overlay, tile, overlay.zStack.index))
        .toBe("https://dicom/instances/uid-5/frames/1");

    controller.setDepth(39);
    expect(overlay.zStack.index).toBe(9);           // clamped at the overlay's own end
    expect(mask.zStack.index).toBe(2);
});

test("setDepth translates a plane measured on a foreign axis", { tag: ["@unit"] }, () => {
    // What a linked viewport hands over: the peer's index plus the axis it was
    // measured on. Two different slides ⇒ two different axes.
    const local = makeSource(zParamUrl, { count: 40, spacingUm: 1, fileId: "local" });
    const controller = controllerFor([local]);

    controller.setDepth(6, { from: { count: 10, index: 6, spacingUm: 4 } });
    expect(local.zStack.index).toBe(24);            // 24 µm deep on both

    controller.setDepth(9, { from: { count: 10, index: 9, spacingUm: 4 } });
    expect(local.zStack.index).toBe(36);

    // Without `from` the index is already on the local axis.
    controller.setDepth(6);
    expect(local.zStack.index).toBe(6);
});

test("getRange reports the reference source, setDepth clamps and syncs layers", { tag: ["@unit"] }, () => {
    const a = makeSource(zParamUrl, { count: 6, fileId: "a" });
    const b = makeSource(perInstanceUrl, { count: 6, fileId: "b" });
    const controller = controllerFor([a, b]);

    expect(controller.hasZStack()).toBe(true);
    expect(controller.getRange()).toMatchObject({ count: 6, index: 0 });

    controller.setDepth(99);
    expect(a.zStack.index).toBe(5);
    expect(b.zStack.index).toBe(5);      // layered stacks stay in lockstep

    controller.step(-2);
    expect(controller.getRange().index).toBe(3);

    // A single-plane source never opts in.
    expect(controllerFor([makeSource(zParamUrl, { count: 1 })]).getRange()).toBe(null);
});
