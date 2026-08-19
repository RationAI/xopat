/**
 * The evidence table — one row per question asked, with what was found and where.
 *
 * Two properties carry the whole design:
 *
 * - **Aggregation is asymmetric.** One field showing a feature is evidence it exists
 *   somewhere; a hundred fields not showing it is not evidence it is absent everywhere,
 *   because the walk only ever samples part of the tissue. Averaging would let breadth
 *   bury a focal finding, which on a slide is usually the finding that matters.
 * - **`underResolved` is about the image, not the answer.** It means the run never got
 *   close enough to judge — an invitation to look again, never a negative finding.
 */
import { test, expect } from "@xopat/test-harness";
import { loadLib, cleanupLib } from "../load-lib.mjs";

const { buildEvidence, renderEvidence } = await loadLib("evidence");
const { sanitizeChecklist } = await loadLib("checklist");

test.afterAll(() => cleanupLib());

const CHECKLIST = sanitizeChecklist([
    { id: "invasion", label: "Stromal invasion", question: "irregular nests?", requiredMpp: 0.5 },
    { id: "atypia", label: "Nuclear atypia", question: "pleomorphic nuclei?", requiredMpp: 0.25 },
], { source: "derived" });

let seq = 0;
const node = (answers, over = {}) => ({
    label: `region ${++seq}`,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    rankScore: 0.5,
    deliveredMpp: 0.5,
    answers: Object.fromEntries(Object.entries(answers).map(([id, a]) => [
        id, typeof a === "string" ? { id, answer: null, present: a, confidence: null } : { id, ...a },
    ])),
    ...over,
});

test("one row per checklist feature, whatever the nodes said", { tag: ["@unit"] }, () => {
    const rows = buildEvidence([node({ invasion: "yes" })], CHECKLIST);

    expect(rows.map(r => r.id)).toEqual(["invasion", "atypia"]);
    expect(rows[0].question).toBe("irregular nests?");
    expect(rows[0].requiredMpp).toBe(0.5);
});

test("a single positive outweighs many negatives", { tag: ["@unit"] }, () => {
    const rows = buildEvidence([
        node({ invasion: "no" }), node({ invasion: "no" }), node({ invasion: "no" }),
        node({ invasion: "yes" }),
    ], CHECKLIST);

    expect(rows[0].verdict, "the walk sampled part of the slide; one positive is a finding").toBe("yes");
    expect(rows[0].counts).toEqual({ yes: 1, no: 3, uncertain: 0, notAssessable: 0 });
});

test("uncertain beats no, and no beats silence", { tag: ["@unit"] }, () => {
    expect(buildEvidence([node({ invasion: "no" }), node({ invasion: "uncertain" })], CHECKLIST)[0].verdict)
        .toBe("uncertain");
    expect(buildEvidence([node({ invasion: "no" })], CHECKLIST)[0].verdict).toBe("no");
    expect(buildEvidence([node({ invasion: "not-assessable" })], CHECKLIST)[0].verdict)
        .toBe("not-assessable");
});

test("underResolved fires only when nothing ever reached the resolution", { tag: ["@unit"] }, () => {
    const never = buildEvidence([
        node({ atypia: { present: "not-assessable", reason: "resolution" } }),
        node({ atypia: { present: "not-assessable", reason: "resolution" } }),
    ], CHECKLIST);
    expect(never[1].underResolved).toBe(true);
    expect(never[1].verdict, "and it reads as unassessed, never as absent").toBe("not-assessable");

    const once = buildEvidence([
        node({ atypia: { present: "not-assessable", reason: "resolution" } }),
        node({ atypia: "no" }),
    ], CHECKLIST);
    expect(once[1].underResolved, "one adequate look settles it").toBe(false);
    expect(once[1].verdict).toBe("no");
});

test("a model that could not tell at adequate power is not under-resolved", { tag: ["@unit"] }, () => {
    // The walk DID get close enough; the model still could not say. Reporting that as
    // "we never looked closely" would send the reader chasing a resolution they have.
    const rows = buildEvidence([
        node({ atypia: { present: "not-assessable", reason: "model" } }),
    ], CHECKLIST);

    expect(rows[1].underResolved).toBe(false);
});

test("citations support the verdict rather than merely ranking high", { tag: ["@unit"] }, () => {
    // A row concluding "yes" that links five regions saying "no" is worse than useless
    // to a reader checking it.
    const rows = buildEvidence([
        node({ invasion: "no" }, { label: "loud-negative", rankScore: 0.99 }),
        node({ invasion: "yes" }, { label: "the-finding", rankScore: 0.2 }),
    ], CHECKLIST);

    expect(rows[0].verdict).toBe("yes");
    expect(rows[0].citedBy.map(c => c.label)).toEqual(["the-finding"]);
});

test("citations are ranked and capped", { tag: ["@unit"] }, () => {
    const nodes = Array.from({ length: 9 }, (_, i) =>
        node({ invasion: "yes" }, { label: `r${i}`, rankScore: i / 10 }));

    const [row] = buildEvidence(nodes, CHECKLIST);

    expect(row.citedBy).toHaveLength(5);
    expect(row.citedBy[0].label, "best-ranked first").toBe("r8");
});

test("citations carry the resolution their answer was formed at", { tag: ["@unit"] }, () => {
    const rows = buildEvidence([
        node({ invasion: { present: "yes", answer: "irregular nests", confidence: "high" } },
            { deliveredMpp: 0.25 }),
    ], CHECKLIST);

    expect(rows[0].citedBy[0]).toMatchObject({
        answer: "irregular nests", confidence: "high", deliveredMpp: 0.25,
    });
});

test("errored and answer-less nodes are excluded", { tag: ["@unit"] }, () => {
    const rows = buildEvidence([
        node({ invasion: "yes" }, { error: "driver timed out" }),
        { label: "no answers", bounds: { x: 0, y: 0, width: 1, height: 1 } },
        null,
    ], CHECKLIST);

    expect(rows[0].counts).toEqual({ yes: 0, no: 0, uncertain: 0, notAssessable: 0 });
    expect(rows[0].verdict).toBe("not-assessable");
});

test("no nodes at all still yields a complete, honest table", { tag: ["@unit"] }, () => {
    const rows = buildEvidence([], CHECKLIST);

    expect(rows).toHaveLength(2);
    for (const r of rows) {
        expect(r.verdict).toBe("not-assessable");
        expect(r.underResolved).toBe(true);
        expect(r.citedBy).toEqual([]);
    }
});

test("renderEvidence leaves the wording to the caller", { tag: ["@unit"] }, () => {
    const rows = buildEvidence([node({ invasion: "yes" })], CHECKLIST);

    expect(renderEvidence(rows, r => `${r.label}=${r.verdict}`))
        .toBe("Stromal invasion=yes\nNuclear atypia=not-assessable");
});
