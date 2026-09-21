/**
 * Overlap: when two boxes stop being two boxes, and when a box has already been read.
 *
 * The failure this protects against is not a wrong number — it is a walk that renders the
 * same tissue several times, sends it to a vision model several times, and reports it as
 * several findings. On a curved biopsy strip the bounding boxes of neighbouring tissue
 * contours overlap heavily while the contours do not, and nothing downstream noticed:
 * the user saw a stack of examination markers over one piece of tissue.
 */
import { test, expect } from "@xopat/test-harness";
import { loadLib, cleanupLib } from "../load-lib.mjs";

const {
    boundsIoU, containedFraction, coveredFraction, unionBounds, mergeOverlappingBounds,
} = await loadLib("geometry");
const { isRedundantRead, REDUNDANT_COVERAGE } = await loadLib("scheduler");

test.afterAll(() => cleanupLib());

const box = (x, y, w, h) => ({ x, y, width: w, height: h });

test("boundsIoU is 1 for identical boxes and 0 for disjoint ones", { tag: ["@unit"] }, () => {
    expect(boundsIoU(box(0, 0, 10, 10), box(0, 0, 10, 10))).toBe(1);
    expect(boundsIoU(box(0, 0, 10, 10), box(50, 50, 10, 10))).toBe(0);
    // Half-overlapping equal squares: intersection 50, union 150.
    expect(boundsIoU(box(0, 0, 10, 10), box(5, 0, 10, 10))).toBeCloseTo(50 / 150, 6);
});

test("containedFraction sees the small box inside the big one, which IoU cannot", { tag: ["@unit"] }, () => {
    const island = box(0, 0, 100, 100);
    const sliver = box(10, 10, 5, 5);

    expect(containedFraction(sliver, island), "the sliver is entirely inside").toBe(1);
    expect(boundsIoU(sliver, island), "IoU alone would call these unrelated").toBeLessThan(0.01);
});

test("coveredFraction measures the UNION, not the sum of intersections", { tag: ["@unit"] }, () => {
    const target = box(0, 0, 100, 100);
    // Two coverers that overlap EACH OTHER over the left half. Summing intersections would
    // report ~1.0; the truth is ~0.6.
    const covered = coveredFraction(target, [box(0, 0, 60, 100), box(0, 0, 55, 100)]);

    expect(covered).toBeGreaterThan(0.55);
    expect(covered, "double-counting the shared strip would push this to 1").toBeLessThan(0.65);
});

test("coveredFraction is 0 with nothing to cover with", { tag: ["@unit"] }, () => {
    expect(coveredFraction(box(0, 0, 10, 10), [])).toBe(0);
    expect(coveredFraction(box(0, 0, 10, 10), [box(50, 50, 10, 10)])).toBe(0);
});

test("mergeOverlappingBounds collapses boxes that are the same box", { tag: ["@unit"] }, () => {
    const merged = mergeOverlappingBounds([
        { label: "a", bounds: box(0, 0, 100, 100), areaFraction: 0.3 },
        { label: "b", bounds: box(5, 5, 100, 100), areaFraction: 0.2 },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].label, "the first item keeps its identity — callers hand these in ranked order").toBe("a");
    expect(merged[0].bounds).toEqual(unionBounds(box(0, 0, 100, 100), box(5, 5, 100, 100)));
    expect(merged[0].areaFraction, "tissue adds up; it is not recomputed from the union box").toBeCloseTo(0.5, 6);
});

test("mergeOverlappingBounds swallows a contained sliver at any size ratio", { tag: ["@unit"] }, () => {
    const merged = mergeOverlappingBounds([
        { bounds: box(0, 0, 100, 100) },
        { bounds: box(10, 10, 5, 5) },
    ]);

    expect(merged, "IoU is ~0.0025 here — containment is what catches it").toHaveLength(1);
    expect(merged[0].bounds).toEqual(box(0, 0, 100, 100));
});

test("mergeOverlappingBounds runs to a fixed point across a chain", { tag: ["@unit"] }, () => {
    // C does not touch A at all, but merging A+B grows A until C falls inside it. A single
    // pass would leave two boxes behind and make the result depend on iteration order.
    const merged = mergeOverlappingBounds([
        { bounds: box(0, 0, 100, 100) },
        { bounds: box(20, 0, 100, 100) },
        { bounds: box(105, 10, 10, 10) },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].bounds).toEqual(box(0, 0, 120, 100));
});

test("mergeOverlappingBounds leaves genuinely separate tissue alone", { tag: ["@unit"] }, () => {
    const items = [{ bounds: box(0, 0, 100, 100) }, { bounds: box(500, 500, 100, 100) }];

    expect(mergeOverlappingBounds(items)).toHaveLength(2);
});

test("a box already read at the same rung is redundant", { tag: ["@unit"] }, () => {
    const candidate = { bounds: box(0, 0, 100, 100), rung: 2 };
    const read = [{ bounds: box(0, 0, 95, 100), rung: 2 }];

    expect(isRedundantRead(candidate, read, coveredFraction)).toBe(true);
});

test("a COARSER read never suppresses a drill", { tag: ["@unit"] }, () => {
    // The parent contains its child completely. Counting it would suppress every drill the
    // walk exists to make — resolution is the entire point of looking again.
    const child = { bounds: box(10, 10, 20, 20), rung: 3 };
    const parent = [{ bounds: box(0, 0, 100, 100), rung: 1 }];

    expect(isRedundantRead(child, parent, coveredFraction)).toBe(false);
});

test("a partly-new box is not redundant", { tag: ["@unit"] }, () => {
    const candidate = { bounds: box(0, 0, 100, 100), rung: 1 };
    const read = [{ bounds: box(0, 0, 40, 100), rung: 1 }];

    expect(isRedundantRead(candidate, read, coveredFraction)).toBe(false);
});

test("a threshold of 1 disables the gate outright", { tag: ["@unit"] }, () => {
    const candidate = { bounds: box(0, 0, 100, 100), rung: 1 };
    const read = [{ bounds: box(0, 0, 100, 100), rung: 1 }];

    expect(isRedundantRead(candidate, read, coveredFraction, 1)).toBe(false);
    expect(REDUNDANT_COVERAGE, "the shipped default must leave room for a genuinely new slice")
        .toBeLessThan(1);
});
