/**
 * Reading order: what a region NUMBER means.
 *
 * A region's number is the only name it has for the user and for a region link, and it used
 * to be the tissue-SIZE rank — the survey sorted contours largest-first and numbered them by
 * array position. No reviewer counts fragments that way, so "region 1" was routinely the
 * third core along and following a reply's links jumped back and forth across the slide.
 *
 * These are about naming only. The arrays stay in priority order; what this decides is what
 * the survivors are called.
 */
import { test, expect } from "@xopat/test-harness";
import { loadLib, cleanupLib } from "../load-lib.mjs";

const { readingOrder } = await loadLib("geometry");

test.afterAll(() => cleanupLib());

const region = (x, y, w, h) => ({ bounds: { x, y, width: w, height: h } });

/** The input positions, in the order the numbering visits them. */
const visitOrder = (items, opts) => {
    const ranks = readingOrder(items, opts);
    return ranks.map((rank, at) => ({ rank, at })).sort((p, q) => p.rank - q.rank).map(e => e.at);
};

test("two rows of fragments are numbered row by row, left to right", { tag: ["@unit"] }, () => {
    // Handed in deliberately scrambled: the survey hands them over largest-first.
    const items = [
        region(600, 400, 100, 100),   // 0 — bottom right
        region(100, 100, 100, 100),   // 1 — top left
        region(600, 100, 100, 100),   // 2 — top right
        region(350, 400, 100, 100),   // 3 — bottom middle
        region(350, 100, 100, 100),   // 4 — top middle
        region(100, 400, 100, 100),   // 5 — bottom left
    ];

    expect(visitOrder(items)).toEqual([1, 4, 2, 5, 3, 0]);
});

test("the largest fragment is not region 1 unless it sits first on the slide", { tag: ["@unit"] }, () => {
    // One row; the big one is rightmost. Under the old size-rank numbering it was "region 1",
    // which is the whole bug: the reviewer counts it last.
    const items = [
        region(900, 100, 400, 400),   // 0 — much the largest, and last on the row
        region(100, 100, 80, 80),     // 1
        region(400, 100, 80, 80),     // 2
    ];

    const ranks = readingOrder(items);
    expect(ranks[1], "leftmost fragment is number 1").toBe(0);
    expect(ranks[2]).toBe(1);
    expect(ranks[0], "the largest is simply the last one along").toBe(2);
});

test("a staggered row stays one row", { tag: ["@unit"] }, () => {
    // Cores are never laid down aligned to the pixel. A plain `y` sort interleaves rows and
    // reproduces exactly the jumping this exists to remove.
    const items = [
        region(100, 100, 100, 300),
        region(400, 140, 100, 300),   // 40px lower — still the same row
        region(700, 80, 100, 300),    // 20px higher — still the same row
    ];

    expect(visitOrder(items)).toEqual([0, 1, 2]);
});

test("a genuinely lower fragment opens a new row", { tag: ["@unit"] }, () => {
    const items = [
        region(700, 100, 100, 100),   // 0 — top row, right
        region(100, 100, 100, 100),   // 1 — top row, left
        region(400, 900, 100, 100),   // 2 — well below both
    ];

    expect(visitOrder(items)).toEqual([1, 0, 2]);
});

test("a small fragment banded with tall cores is judged on its OWN height", { tag: ["@unit"] }, () => {
    // The overlap test is a fraction of the box's own height, so a 40px speck beside a 600px
    // core belongs to that core's row — measuring against the core would exile it to its own.
    const items = [
        region(100, 100, 100, 600),
        region(400, 300, 40, 40),
        region(700, 100, 100, 600),
    ];

    expect(visitOrder(items)).toEqual([0, 1, 2]);
});

test("degenerate and trivial inputs are permutations too", { tag: ["@unit"] }, () => {
    expect(readingOrder([])).toEqual([]);
    expect(readingOrder([region(500, 500, 10, 10)])).toEqual([0]);
    // A zero-height box cannot satisfy a fractional overlap test; it must still be placed.
    expect(readingOrder([region(0, 0, 10, 0), region(5, 0, 10, 10)])).toEqual([0, 1]);
});

test("identical boxes keep their input order rather than swapping between runs", { tag: ["@unit"] }, () => {
    const items = [region(10, 10, 50, 50), region(10, 10, 50, 50), region(10, 10, 50, 50)];
    expect(readingOrder(items)).toEqual([0, 1, 2]);
});

test("every result is a permutation of 0..n-1", { tag: ["@unit"] }, () => {
    const items = [
        region(0, 0, 10, 10), region(500, 20, 90, 90), region(250, 800, 40, 300),
        region(20, 790, 10, 10), region(900, 15, 200, 60), region(600, 500, 30, 30),
    ];
    const ranks = readingOrder(items);
    expect(ranks.slice().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
});
