/**
 * Montage geometry — the part that decides whether one vision call can carry N fields.
 *
 * A montage trades N renders for ONE model call, which is what makes triaging a dozen
 * candidate regions affordable inside a budget of twenty-eight calls. The composite has
 * to stay inside one request body, so cells shrink rather than the image growing; and
 * every cell has to be identifiable, because an answer that cannot be tied back to a
 * region is not an answer.
 *
 * Composition itself needs a canvas and is exercised in the browser; the sizing and
 * labelling are pure and live here.
 */
import { test, expect } from "@xopat/test-harness";
import { loadLib, cleanupLib } from "../load-lib.mjs";

const { planMontageLayout, montageCellLabel } = await loadLib("imaging");

test.afterAll(() => cleanupLib());

const area = (l) => l.cols * (l.cellPixels + l.gutter) * l.rows * (l.cellPixels + l.labelBand + l.gutter);

test("the grid holds every cell", { tag: ["@unit"] }, () => {
    for (const n of [1, 2, 5, 9, 12]) {
        const l = planMontageLayout(n);
        expect(l.cols * l.rows, `${n} cells`).toBeGreaterThanOrEqual(n);
    }
});

test("the default grid is roughly square", { tag: ["@unit"] }, () => {
    expect(planMontageLayout(9).cols).toBe(3);
    expect(planMontageLayout(4).cols).toBe(2);
    expect(planMontageLayout(12).cols).toBe(4);
});

test("an explicit column count is honoured", { tag: ["@unit"] }, () => {
    const l = planMontageLayout(6, { cols: 2 });

    expect(l.cols).toBe(2);
    expect(l.rows).toBe(3);
});

test("cells shrink so the composite fits the budget", { tag: ["@unit"] }, () => {
    // Twelve 512px cells would be ~4.7 MP with the label bands; the layout must give up
    // cell size rather than hand back an image too big to send.
    const l = planMontageLayout(12, { cellPixels: 512, maxPixels: 2_000_000 });

    expect(area(l)).toBeLessThanOrEqual(2_000_000);
    expect(l.cellPixels).toBeLessThan(512);
});

test("cells never shrink below legibility", { tag: ["@unit"] }, () => {
    // Past a point the model is judging thumbnails; the layout stops rather than
    // pretending an unreadable montage is a usable one.
    const l = planMontageLayout(12, { maxPixels: 1000 });

    expect(l.cellPixels).toBeGreaterThanOrEqual(128);
});

test("a small montage keeps its requested cell size", { tag: ["@unit"] }, () => {
    const l = planMontageLayout(2, { cellPixels: 512, maxPixels: 4_000_000 });

    expect(l.cellPixels).toBe(512);
});

test("the requested cell size is clamped to a sane range", { tag: ["@unit"] }, () => {
    expect(planMontageLayout(1, { cellPixels: 5000 }).cellPixels).toBeLessThanOrEqual(768);
    expect(planMontageLayout(1, { cellPixels: 1 }).cellPixels).toBeGreaterThanOrEqual(128);
});

test("a gutter and a label band are always reserved", { tag: ["@unit"] }, () => {
    // Both are load-bearing: the band carries the label the model answers by, and the
    // gutter is what makes "do not read across cell borders" visually true rather than
    // merely asserted in the prompt.
    const l = planMontageLayout(4);

    expect(l.labelBand).toBeGreaterThan(0);
    expect(l.gutter).toBeGreaterThan(0);
});

test("cell labels are unique and read as a grid", { tag: ["@unit"] }, () => {
    const labels = Array.from({ length: 9 }, (_, i) => montageCellLabel(i, 3));

    expect(labels).toEqual(["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"]);
    expect(new Set(labels).size, "a duplicate label would misattribute an answer").toBe(9);
});

test("labels stay unique for a single-column montage", { tag: ["@unit"] }, () => {
    const labels = Array.from({ length: 4 }, (_, i) => montageCellLabel(i, 1));

    expect(labels).toEqual(["A1", "B1", "C1", "D1"]);
});

test("a single cell is still labelled", { tag: ["@unit"] }, () => {
    expect(montageCellLabel(0, 1)).toBe("A1");
});
