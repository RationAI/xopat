/**
 * Ground truth for the object count.
 *
 * "Objects 780" is the least checkable number the panel prints, and its meaning
 * depends entirely on a detail nobody sees: the labeller is **4-connected** — the
 * first pass looks only up and left (`connected-components.js:60-73`). Under
 * 8-connectivity a diagonal touch would merge two blobs into one, so the same
 * slide would report a different count with neither answer looking wrong.
 *
 * These cases pin the connectivity and the derived statistics against masks
 * small enough to count by hand.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
await import("../../connected-components.js");

const components = globalThis.AnnotationMeasurements.components;

/**
 * Build a mask from an ASCII picture; `#` is set, anything else is background.
 * Rows must be equal length.
 */
function mask(rows) {
    const height = rows.length;
    const width = rows[0].length;
    const out = new Uint8Array(width * height);
    rows.forEach((row, y) => {
        expect(row.length).toBe(width);
        for (let x = 0; x < width; x++) out[y * width + x] = row[x] === "#" ? 1 : 0;
    });
    return { mask: out, width, height };
}

const label = (rows) => {
    const m = mask(rows);
    return components.labelConnected(m.mask, m.width, m.height);
};

test("an empty mask has no components @unit", () => {
    const res = label([
        "...",
        "...",
    ]);
    expect(res.count).toBe(0);
});

test("a plus shape is one component @unit", () => {
    // Every arm touches the centre edge-on, so 4-connectivity keeps it whole.
    const res = label([
        ".#.",
        "###",
        ".#.",
    ]);
    expect(res.count).toBe(1);
    expect(res.sizes[1]).toBe(5);
});

test("a diagonal touch is two components, not one @unit", () => {
    // This is the assertion that pins 4- vs 8-connectivity. Under 8-connectivity
    // it would be 1, and every object count on every slide would shift.
    const res = label([
        "#.",
        ".#",
    ]);
    expect(res.count).toBe(2);
});

test("separate blobs stay separate and keep their own sizes @unit", () => {
    const res = label([
        "##..#",
        "##..#",
        ".....",
        "#....",
    ]);
    expect(res.count).toBe(3);
    const sizes = Array.from(res.sizes.slice(1, res.count + 1)).sort((a, b) => a - b);
    expect(sizes).toEqual([1, 2, 4]);
});

test("a U shape that closes on the row below is one component @unit", () => {
    // Two columns joined only by the bottom row - a merge the union-find has to
    // resolve, which is where a broken label-compaction pass shows up.
    const res = label([
        "#.#",
        "#.#",
        "###",
    ]);
    expect(res.count).toBe(1);
    expect(res.sizes[1]).toBe(7);
});

test("component sizes account for every set pixel @unit", () => {
    const rows = [
        "##.#",
        "#..#",
        "..##",
    ];
    const res = label(rows);
    const setPixels = rows.join("").split("").filter((c) => c === "#").length;
    let total = 0;
    for (let k = 1; k <= res.count; k++) total += res.sizes[k];
    expect(total).toBe(setPixels);
});

test("componentStats reports count, mean and percentiles over known blobs @unit", () => {
    // Three blobs of 4, 2 and 1 pixels.
    const res = label([
        "##..#",
        "##..#",
        ".....",
        "#....",
    ]);
    const stats = components.componentStats(res);

    expect(stats.count).toBe(3);
    expect(stats.meanArea).toBeCloseTo((4 + 2 + 1) / 3, 9);
    // Percentiles index the sorted sizes [1, 2, 4] as `floor(q·(n−1))`, so with
    // few components p90 is NOT the largest blob — here index floor(0.9·2)=1.
    // Pinned deliberately: it is a reasonable choice, but a surprising one to
    // read off the UI, and it must not drift silently.
    expect(stats.p10).toBe(1);
    expect(stats.p50).toBe(2);
    expect(stats.medianArea).toBe(2);
    expect(stats.p90).toBe(2);
});

test("circularity separates a compact blob from an elongated one of equal area @unit", () => {
    // Same area, different shape — the only honest way to read this metric.
    // 4x4 square: A=16, P=12 (the 4 interior pixels touch no background).
    // 1x16 line:  A=16, P=16 (every pixel is on the boundary).
    // 4πA/P² → 1.396 vs 0.785.
    const square = components.componentStats(label([
        "####",
        "####",
        "####",
        "####",
    ]));
    const line = components.componentStats(label([
        "################",
    ]));

    expect(square.count).toBe(1);
    expect(line.count).toBe(1);
    expect(square.sizes[0]).toBe(line.sizes[0]);           // equal area
    expect(square.circularities[0]).toBeGreaterThan(line.circularities[0]);

    // Perimeter counts pixels-with-a-background-neighbour, not boundary edge
    // length, so this ratio is not the isoperimetric one and legitimately
    // exceeds 1 for small compact blobs. Asserted so nobody "fixes" it to <= 1.
    expect(square.circularities[0]).toBeCloseTo((4 * Math.PI * 16) / (12 * 12), 5);
});

test("componentStats on an empty result is NaN, not zero @unit", () => {
    const stats = components.componentStats(label(["..", ".."]));
    expect(stats.count).toBe(0);
    expect(Number.isNaN(stats.meanArea)).toBe(true);
    expect(Number.isNaN(stats.medianArea)).toBe(true);
});
