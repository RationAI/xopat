/**
 * The engine's coordinate arithmetic.
 *
 * Every one of these functions decides which pixels a vision model is shown, so a
 * silent error here is not a wrong number — it is a region described from the wrong
 * tissue. They used to be private methods on a 3400-line viewer-coupled class and
 * were therefore untestable; extracting them is what this suite exists to protect.
 */
import { test, expect } from "@xopat/test-harness";
import { loadLib, cleanupLib, maskFromRows } from "../load-lib.mjs";

const {
    polygonArea, boundsOfPolygons, centerOf, pointInRing,
    clampBoundsToSlide, padBounds, gridSplitTissue, coverageOverRings, countFilled, cropMask,
} = await loadLib("geometry");

test.afterAll(() => cleanupLib());

const square = (x, y, s) => [
    { x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s },
];

test("polygonArea is orientation-independent", { tag: ["@unit"] }, () => {
    const cw = square(0, 0, 10);
    const ccw = [...cw].reverse();

    expect(polygonArea(cw)).toBe(100);
    expect(polygonArea(ccw), "winding order must not flip the sign").toBe(100);
});

test("boundsOfPolygons spans every polygon and skips nulls", { tag: ["@unit"] }, () => {
    const b = boundsOfPolygons([square(0, 0, 10), null, square(30, 20, 5), undefined]);

    expect(b).toEqual({ x: 0, y: 0, width: 35, height: 25 });
    expect(boundsOfPolygons([null, undefined]), "nothing to bound is null, not an empty box").toBeNull();
});

test("centerOf tolerates a null box", { tag: ["@unit"] }, () => {
    expect(centerOf({ x: 10, y: 20, width: 4, height: 8 })).toEqual({ x: 12, y: 24 });
    expect(centerOf(null)).toBeNull();
});

test("pointInRing distinguishes inside from outside", { tag: ["@unit"] }, () => {
    const ring = square(0, 0, 10);

    expect(pointInRing(5, 5, ring)).toBe(true);
    expect(pointInRing(15, 5, ring)).toBe(false);
});

test("clampBoundsToSlide trims overhang and reports a miss as null", { tag: ["@unit"] }, () => {
    expect(clampBoundsToSlide({ x: -10, y: -10, width: 30, height: 30 }, 100, 100))
        .toEqual({ x: 0, y: 0, width: 20, height: 20 });

    expect(clampBoundsToSlide({ x: 200, y: 200, width: 10, height: 10 }, 100, 100),
        "a box entirely off the slide has no overlap to return").toBeNull();

    const unknownExtent = { x: -5, y: -5, width: 10, height: 10 };
    expect(clampBoundsToSlide(unknownExtent, 0, 0),
        "an unknown slide extent cannot clamp — pass the box through").toEqual(unknownExtent);
});

test("padBounds grows both sides and stops at the slide edge", { tag: ["@unit"] }, () => {
    expect(padBounds({ x: 100, y: 100, width: 100, height: 100 }, 0.1, 1000, 1000))
        .toEqual({ x: 90, y: 90, width: 120, height: 120 });

    // At the origin the padding has nowhere to go on two sides; it must not produce
    // negative coordinates, because the render would then map to the wrong pixels.
    expect(padBounds({ x: 0, y: 0, width: 100, height: 100 }, 0.5, 1000, 1000))
        .toEqual({ x: 0, y: 0, width: 150, height: 150 });
});

test("padBounds returns the input rather than a collapsed box", { tag: ["@unit"] }, () => {
    const bounds = { x: 10, y: 10, width: 20, height: 20 };

    expect(padBounds(bounds, -1, 1000, 1000),
        "a degenerate result is worse than no padding").toEqual(bounds);
});

test("gridSplitTissue keeps only cells that hold tissue, ranked", { tag: ["@unit"] }, () => {
    // 6x6 split 3x3 gives 2x2 cells. The top-left cell is solid tissue and the
    // bottom-right cell holds one pixel; the other seven are glass.
    const mask = maskFromRows([
        "##....",
        "##....",
        "......",
        "......",
        "......",
        ".....#",
    ]);
    const identity = (px, py) => ({ x: px, y: py });

    const cells = gridSplitTissue(mask, identity, 3);

    expect(cells.length, "the seven empty cells are dropped before any budget is spent").toBe(2);
    expect(cells[0].bounds, "the densest cell ranks first").toEqual({ x: 0, y: 0, width: 2, height: 2 });
    expect(cells[0].areaFraction).toBeGreaterThan(cells[1].areaFraction);
});

test("gridSplitTissue drops cells under the fill floor", { tag: ["@unit"] }, () => {
    const mask = maskFromRows([
        "#.....",
        "......",
        "......",
        "......",
        "......",
        "......",
    ]);
    const identity = (px, py) => ({ x: px, y: py });

    // One pixel in a 2x2 cell is 25% fill — kept at the default floor, dropped at 50%.
    expect(gridSplitTissue(mask, identity, 3).length).toBe(1);
    expect(gridSplitTissue(mask, identity, 3, 0.5).length).toBe(0);
});

test("coverageOverRings counts tissue inside a ring and excludes holes", { tag: ["@unit"] }, () => {
    // 8x8 all tissue; a 6x6 outer ring with a 2x2 hole punched out of the middle.
    const mask = maskFromRows(Array(8).fill("########"));
    const outer = square(1, 1, 6);
    const hole = square(3, 3, 2);

    const solid = coverageOverRings([outer], mask);
    expect(solid.area, "36 pixel centres fall inside the 6x6 ring").toBe(36);
    expect(solid.tissue, "the mask is fully set, so every counted pixel is tissue").toBe(36);

    const withHole = coverageOverRings([outer, hole], mask);
    expect(withHole.area, "the 2x2 hole is excluded from the area").toBe(32);
    expect(withHole.tissue).toBe(32);
});

test("coverageOverRings refuses a degenerate ring", { tag: ["@unit"] }, () => {
    const mask = maskFromRows(["##", "##"]);

    expect(coverageOverRings([[{ x: 0, y: 0 }, { x: 1, y: 1 }]], mask)).toEqual({ area: 0, tissue: 0 });
    expect(coverageOverRings([], mask)).toEqual({ area: 0, tissue: 0 });
});

test("countFilled counts set pixels", { tag: ["@unit"] }, () => {
    expect(countFilled(maskFromRows(["#.#", ".#."]).binaryMask)).toBe(3);
});

test("cropMask cuts a sub-region out of a survey mask", { tag: ["@unit"] }, () => {
    // 4x4 mask over a 400x400 image region: the top-left quadrant is tissue.
    const mask = maskFromRows([
        "##..",
        "##..",
        "....",
        "....",
    ]);
    const maskBounds = { x: 0, y: 0, width: 400, height: 400 };

    const crop = cropMask(mask, maskBounds, { x: 0, y: 0, width: 200, height: 200 });

    expect(crop.mask.width).toBe(2);
    expect(crop.mask.height).toBe(2);
    expect(countFilled(crop.mask.binaryMask), "the quadrant is solid tissue").toBe(4);
    expect(crop.bounds).toEqual({ x: 0, y: 0, width: 200, height: 200 });
});

test("cropMask reports the bounds it snapped to, not the ones requested", { tag: ["@unit"] }, () => {
    const mask = maskFromRows(["####", "####", "####", "####"]);
    const maskBounds = { x: 0, y: 0, width: 400, height: 400 };

    // A request that starts and ends mid-pixel must widen to whole mask pixels, and SAY so
    // — mapping crop pixels back through the request would shift every derived box.
    const crop = cropMask(mask, maskBounds, { x: 130, y: 130, width: 40, height: 40 });

    expect(crop.bounds, "snapped outward to the enclosing mask pixels")
        .toEqual({ x: 100, y: 100, width: 100, height: 100 });
    expect(crop.mask.width).toBe(1);
});

test("cropMask preserves which pixels are tissue", { tag: ["@unit"] }, () => {
    const mask = maskFromRows([
        "#.#.",
        ".#.#",
        "#.#.",
        ".#.#",
    ]);
    const crop = cropMask(mask, { x: 0, y: 0, width: 4, height: 4 }, { x: 2, y: 0, width: 2, height: 2 });

    expect(Array.from(crop.mask.binaryMask), "the right half of the first two rows")
        .toEqual([1, 0, 0, 1]);
});

test("cropMask returns null when nothing overlaps", { tag: ["@unit"] }, () => {
    const mask = maskFromRows(["##", "##"]);
    const maskBounds = { x: 0, y: 0, width: 200, height: 200 };

    expect(cropMask(mask, maskBounds, { x: 500, y: 500, width: 100, height: 100 })).toBeNull();
});
