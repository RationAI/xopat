/**
 * Reading per-feature answers back out of whatever the vision model emitted.
 *
 * The invariant under everything here: **`not-assessable` never becomes `no`**. Those are
 * opposite conclusions, and collapsing them is how a run reports a feature as absent when
 * nobody looked closely enough to say — the exact failure the checklist schema exists to
 * prevent. Every degraded path below must land on `not-assessable`.
 */
import { test, expect } from "@xopat/test-harness";
import { loadLib, cleanupLib } from "../load-lib.mjs";

const { parseFieldAnswers, aggregateFeatureAnswers } = await loadLib("answers");
const { sanitizeChecklist } = await loadLib("checklist");

test.afterAll(() => cleanupLib());

const CHECKLIST = sanitizeChecklist([
    { id: "invasion", label: "Stromal invasion", question: "irregular nests in stroma?", requiredMpp: 0.5 },
    { id: "atypia", label: "Nuclear atypia", question: "pleomorphic nuclei?", requiredMpp: 0.25 },
], { source: "derived", query: "is there invasive cancer" });

test("reads the fenced JSON contract", { tag: ["@unit"] }, () => {
    const r = parseFieldAnswers([
        "Irregular glands infiltrate a desmoplastic stroma.",
        "```json",
        '{"invasion": {"a": "irregular nests in desmoplastic stroma", "p": "yes", "c": "high"},',
        ' "atypia": {"a": "marked pleomorphism", "p": "yes", "c": "medium"}}',
        "```",
    ].join("\n"), CHECKLIST);

    expect(r.parsed).toBe("json");
    expect(r.answers.invasion.present).toBe("yes");
    expect(r.answers.invasion.confidence).toBe("high");
    expect(r.answers.atypia.answer).toBe("marked pleomorphism");
    expect(r.prose, "the machine block is not part of what a human reads")
        .toBe("Irregular glands infiltrate a desmoplastic stroma.");
});

test("reads a bare trailing object with no fence", { tag: ["@unit"] }, () => {
    const r = parseFieldAnswers(
        'Bland squamous epithelium. {"invasion": {"p": "no"}, "atypia": {"p": "no"}}',
        CHECKLIST
    );

    expect(r.parsed).toBe("json");
    expect(r.answers.invasion.present).toBe("no");
});

test("accepts the bare shorthand", { tag: ["@unit"] }, () => {
    const r = parseFieldAnswers('{"invasion": "yes", "atypia": "not-assessable"}', CHECKLIST);

    expect(r.answers.invasion.present).toBe("yes");
    expect(r.answers.atypia.present).toBe("not-assessable");
});

test("falls back to the line form", { tag: ["@unit"] }, () => {
    const r = parseFieldAnswers([
        "Findings:",
        "- invasion: yes — irregular nests breach the basement membrane, high",
        "- atypia: uncertain",
    ].join("\n"), CHECKLIST);

    expect(r.parsed).toBe("lines");
    expect(r.answers.invasion.present).toBe("yes");
    expect(r.answers.invasion.answer).toMatch(/irregular nests/);
    expect(r.answers.invasion.confidence).toBe("high");
    expect(r.answers.atypia.present).toBe("uncertain");
});

test("the line form matches on the label as well as the id", { tag: ["@unit"] }, () => {
    const r = parseFieldAnswers("Stromal invasion: yes\nNuclear atypia: no", CHECKLIST);

    expect(r.answers.invasion.present).toBe("yes");
    expect(r.answers.atypia.present).toBe("no");
});

test("garbage yields not-assessable, never a negative", { tag: ["@unit"] }, () => {
    const r = parseFieldAnswers("The tissue looks unremarkable to me.", CHECKLIST);

    expect(r.parsed).toBe("none");
    for (const id of ["invasion", "atypia"]) {
        expect(r.answers[id].present, id).toBe("not-assessable");
        expect(r.answers[id].reason, id).toBe("unparsed");
    }
});

test("a feature the model skipped is not-assessable, not absent", { tag: ["@unit"] }, () => {
    const r = parseFieldAnswers('{"invasion": {"p": "yes"}}', CHECKLIST);

    expect(r.answers.invasion.present).toBe("yes");
    expect(r.answers.atypia.present, "silence is not a negative").toBe("not-assessable");
    expect(r.answers.atypia.reason, "the model answered — it just did not answer this").toBe("model");
});

test("every checklist feature always has an entry", { tag: ["@unit"] }, () => {
    for (const text of [null, undefined, "", "nonsense", '{"unknown": "yes"}']) {
        const r = parseFieldAnswers(text, CHECKLIST);
        expect(Object.keys(r.answers).sort(), JSON.stringify(text)).toEqual(["atypia", "invasion"]);
    }
});

test("unknown ids are dropped rather than carried through", { tag: ["@unit"] }, () => {
    const r = parseFieldAnswers('{"invasion": {"p": "yes"}, "made_up": {"p": "yes"}}', CHECKLIST);

    expect(r.answers.made_up).toBeUndefined();
});

test("malformed JSON degrades to the line form instead of throwing", { tag: ["@unit"] }, () => {
    const r = parseFieldAnswers('invasion: yes\n```json\n{"invasion": {oops}\n```', CHECKLIST);

    expect(r.parsed).toBe("lines");
    expect(r.answers.invasion.present).toBe("yes");
});

test("interest is derived from the answers, weighted by feature", { tag: ["@unit"] }, () => {
    const both = parseFieldAnswers('{"invasion": "yes", "atypia": "yes"}', CHECKLIST);
    expect(both.verdict.interest).toBe(1);

    const neither = parseFieldAnswers('{"invasion": "no", "atypia": "no"}', CHECKLIST);
    expect(neither.verdict.interest, "answered and negative IS a real zero").toBe(0);

    const half = parseFieldAnswers('{"invasion": "yes", "atypia": "no"}', CHECKLIST);
    expect(half.verdict.interest).toBeCloseTo(0.5, 5);

    const hedged = parseFieldAnswers('{"invasion": "uncertain", "atypia": "uncertain"}', CHECKLIST);
    expect(hedged.verdict.interest).toBeCloseTo(0.5, 5);
});

test("all-unassessable is UNKNOWN interest, never zero", { tag: ["@unit"] }, () => {
    // A zero would rank an unreadable region below a genuinely dull one, and it would
    // then never be revisited — the death spiral this null exists to prevent.
    const r = parseFieldAnswers('{"invasion": "n/a", "atypia": "n/a"}', CHECKLIST);

    expect(r.verdict.interest).toBeNull();
    expect(r.verdict.interest).not.toBe(0);
});

test("unassessable features are excluded from the weighting, not counted as no", { tag: ["@unit"] }, () => {
    const r = parseFieldAnswers('{"invasion": "yes", "atypia": "not-assessable"}', CHECKLIST);

    expect(r.verdict.interest, "one of one assessable features says yes").toBe(1);
});

test("an explicit SCORE outranks the derived one", { tag: ["@unit"] }, () => {
    const r = parseFieldAnswers('SCORE: 0.3\n{"invasion": "yes", "atypia": "yes"}', CHECKLIST);

    expect(r.verdict.interest).toBe(0.3);
    expect(r.verdict.source).toBe("contract");
});

test("the SCORE reader tolerates the same decoration as the verdict parser", { tag: ["@unit"] }, () => {
    // These two readers look at the SAME line. When each carried its own hand-written
    // decoration class they drifted: `~~SCORE~~` was readable by one and not the other,
    // so identical model output scored differently depending on which path saw it.
    for (const line of ["SCORE: 0.6", "**SCORE:** `0.6`", "*SCORE* : **0.6**", "~~SCORE~~= [0.6]"]) {
        const r = parseFieldAnswers(`${line}\n{"invasion": "uncertain"}`, CHECKLIST);
        expect(r.verdict.interest, line).toBe(0.6);
        expect(r.verdict.source, line).toBe("contract");
    }
});

test("a consumed SCORE line does not survive into the prose", { tag: ["@unit"] }, () => {
    // Whatever the reader ate must also be stripped, or the machine line is read back to
    // the user as if it were a finding.
    const r = parseFieldAnswers('Bland epithelium.\n~~SCORE~~= [0.2]\n{"invasion": "no"}', CHECKLIST);

    expect(r.prose).not.toMatch(/SCORE/i);
    expect(r.prose).toContain("Bland epithelium.");
});

test("an off-scale SCORE is still rescaled", { tag: ["@unit"] }, () => {
    const r = parseFieldAnswers('SCORE: 7/10\n{"invasion": "yes"}', CHECKLIST);

    expect(r.verdict.interest).toBeCloseTo(0.7, 5);
    expect(r.verdict.scoreScale).toBe(10);
});

test("a parroted SCORE template does not become a score", { tag: ["@unit"] }, () => {
    const r = parseFieldAnswers('SCORE: <decimal between 0 and 1>\n{"invasion": "yes", "atypia": "yes"}',
        CHECKLIST);

    expect(r.verdict.interest, "the echo is ignored and the answers speak instead").toBe(1);
});

test("confidence aggregates to the weakest answer", { tag: ["@unit"] }, () => {
    const r = parseFieldAnswers(
        '{"invasion": {"p": "yes", "c": "high"}, "atypia": {"p": "yes", "c": "low"}}', CHECKLIST);

    expect(r.verdict.confidence, "a node is only as good as its weakest answer").toBe("low");
});

test("resolvable reflects whether anything could be judged", { tag: ["@unit"] }, () => {
    expect(parseFieldAnswers('{"invasion": "yes"}', CHECKLIST).verdict.resolvable).toBe(true);
    expect(parseFieldAnswers('{"invasion": "n/a", "atypia": "n/a"}', CHECKLIST).verdict.resolvable).toBe(false);
});

test("prose survives when there is no machine block at all", { tag: ["@unit"] }, () => {
    const r = parseFieldAnswers("Dense lymphoid infiltrate throughout.", CHECKLIST);

    expect(r.prose).toBe("Dense lymphoid infiltrate throughout.");
});

/**
 * Aggregating several fields into one answer per feature.
 *
 * The polarity rule (any positive wins) is a sampling argument. The REASON rule is a
 * communication one: a run whose fields all failed to render must not describe itself the
 * same way as a run whose fields the model examined and could not call, because the two
 * need opposite next steps and the caller cannot tell them apart from `present` alone.
 */
const field = (...answers) => ({ answers });
const ans = (id, present, reason) => ({ id, answer: null, present, confidence: null, ...(reason ? { reason } : {}) });

test("any positive wins over any number of negatives", { tag: ["@unit"] }, () => {
    const out = aggregateFeatureAnswers([
        field(ans("invasion", "no")),
        field(ans("invasion", "yes")),
        field(ans("invasion", "no")),
    ], CHECKLIST.features);

    expect(out.find(a => a.id === "invasion").present,
        "one field showing a feature is evidence; several not showing it is not proof").toBe("yes");
});

test("uncertain outranks a negative but not a positive", { tag: ["@unit"] }, () => {
    expect(aggregateFeatureAnswers(
        [field(ans("invasion", "no")), field(ans("invasion", "uncertain"))], CHECKLIST.features
    )[0].present).toBe("uncertain");
    expect(aggregateFeatureAnswers(
        [field(ans("invasion", "uncertain")), field(ans("invasion", "yes"))], CHECKLIST.features
    )[0].present).toBe("yes");
});

test("fields that never rendered report 'unread', not 'model'", { tag: ["@unit"] }, () => {
    // The regression: a failed render still contributed answers, so "did any field answer?"
    // was true and the aggregate said the model had looked and could not tell — about images
    // that were never produced. The advice that follows is "zoom in", which cannot help.
    const out = aggregateFeatureAnswers([
        field(ans("invasion", "not-assessable", "unread")),
        field(ans("invasion", "not-assessable", "unread")),
    ], CHECKLIST.features);

    expect(out[0].present).toBe("not-assessable");
    expect(out[0].reason).toBe("unread");
});

test("a field that WAS read at too coarse a resolution outranks one that never rendered", { tag: ["@unit"] }, () => {
    // Ordered by how actionable the answer is, not by how many fields voted for it.
    const out = aggregateFeatureAnswers([
        field(ans("invasion", "not-assessable", "unread")),
        field(ans("invasion", "not-assessable", "unread")),
        field(ans("invasion", "not-assessable", "resolution")),
    ], CHECKLIST.features);

    expect(out[0].reason, "there is a closer look to offer, and that is the useful advice").toBe("resolution");
});

test("'unread' outranks 'model'", { tag: ["@unit"] }, () => {
    const out = aggregateFeatureAnswers([
        field(ans("invasion", "not-assessable", "model")),
        field(ans("invasion", "not-assessable", "unread")),
    ], CHECKLIST.features);

    expect(out[0].reason).toBe("unread");
});

test("a feature no field mentioned is 'unparsed', never a negative", { tag: ["@unit"] }, () => {
    const out = aggregateFeatureAnswers([field(ans("invasion", "yes"))], CHECKLIST.features);
    const atypia = out.find(a => a.id === "atypia");

    expect(atypia.present, "silence is not absence").toBe("not-assessable");
    expect(atypia.reason).toBe("unparsed");
});
