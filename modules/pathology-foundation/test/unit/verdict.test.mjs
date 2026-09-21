/**
 * The invariants of reading a vision model's verdict line.
 *
 * The one that matters most: **an unparseable answer is UNKNOWN, never zero.** A
 * strict 0..1 regex used to turn every off-scale or template-echoed score into
 * `interest: 0`, which is indistinguishable from a real "nothing here" — so genuine
 * findings were ranked last and silently dropped out of the report.
 *
 * Phase 4 replaces this contract with a per-feature answer schema; these assertions
 * are the behaviour the replacement has to keep, so the suite outlives the format.
 */
import { test, expect } from "@xopat/test-harness";
import { loadLib, cleanupLib } from "../load-lib.mjs";

const { parseOverviewVerdict, normalizeScore, isTemplateEcho, keywordInterest } = await loadLib("verdict");

test.afterAll(() => cleanupLib());

test("reads a conforming contract line", { tag: ["@unit"] }, () => {
    const v = parseOverviewVerdict(
        "Glandular tissue with irregular nests.\nSCORE: 0.8 DRILL: yes CONFIDENCE: high RESOLVABLE: yes"
    );

    expect(v).toEqual({
        interest: 0.8, drill: true, confidence: "high", resolvable: true, source: "contract",
    });
});

test("rescales a 1-5 or 1-10 answer instead of discarding it", { tag: ["@unit"] }, () => {
    const five = parseOverviewVerdict("SCORE: 4 DRILL: yes CONFIDENCE: medium");
    expect(five.interest, "4 cannot have been on a 0..1 scale").toBe(0.8);
    expect(five.source).toBe("normalized");
    expect(five.scoreScale).toBe(5);

    const ten = parseOverviewVerdict("SCORE: 7/10 DRILL: no CONFIDENCE: low");
    expect(ten.interest, "an explicit denominator is authoritative").toBe(0.7);
    expect(ten.scoreScale).toBe(10);
});

test("tolerates the decorations models actually emit", { tag: ["@unit"] }, () => {
    const v = parseOverviewVerdict('**SCORE:** `0.45` **DRILL:** "yes" **CONFIDENCE:** <medium>');

    expect(v.interest).toBe(0.45);
    expect(v.drill).toBe(true);
    expect(v.confidence).toBe("medium");
});

test("an unparseable answer is UNKNOWN, never a real zero", { tag: ["@unit"] }, () => {
    const v = parseOverviewVerdict("The tissue looks unremarkable to me.");

    expect(v.interest, "null means 'we do not know'; 0 would mean 'we looked and it is dull'").toBeNull();
    expect(v.source).toBe("unparsed");
});

test("decoration and whitespace may interleave in any order", { tag: ["@unit"] }, () => {
    // Chat models bold the label and code-quote the value, which puts `**`, a space
    // and a backtick between the colon and the digits. A pattern that tolerates only
    // one decoration run reads this as unparseable and ranks a real finding last.
    for (const line of [
        "**SCORE:** `0.6`",
        "*SCORE* : **0.6**",
        "SCORE:\t'0.6'",
        "~~SCORE~~= [0.6]",
    ]) {
        expect(parseOverviewVerdict(line).interest, line).toBe(0.6);
    }
});

test("a parroted template is rejected rather than scored", { tag: ["@unit"] }, () => {
    expect(isTemplateEcho("SCORE: <decimal between 0 and 1>")).toBe(true);
    expect(isTemplateEcho("**SCORE:** `<decimal between 0 and 1>`"),
        "echo detection must be at least as tolerant as score parsing").toBe(true);

    const v = parseOverviewVerdict("SCORE: <decimal between 0 and 1> DRILL: yes");
    expect(v.interest, "the model filled in nothing, so we know nothing").toBeNull();
    expect(v.drill, "an echoed SCORE must not discard a stated DRILL").toBe(true);
});

test("each axis parses independently", { tag: ["@unit"] }, () => {
    const noScore = parseOverviewVerdict("DRILL: yes CONFIDENCE: low");
    expect(noScore.interest).toBeNull();
    expect(noScore.drill).toBe(true);
    expect(noScore.confidence).toBe("low");

    const noDrill = parseOverviewVerdict("SCORE: 0.9");
    expect(noDrill.interest).toBe(0.9);
    expect(noDrill.drill, "unstated DRILL defaults to no").toBe(false);
});

test("unstated RESOLVABLE is null, not a guess in either direction", { tag: ["@unit"] }, () => {
    // false would drill forever; true would create a silent blind spot.
    expect(parseOverviewVerdict("SCORE: 0.5").resolvable).toBeNull();
    expect(parseOverviewVerdict("SCORE: 0.5 RESOLVABLE: no").resolvable).toBe(false);
    expect(parseOverviewVerdict("SCORE: 0.5 RESOLVABLE: yes").resolvable).toBe(true);
});

test("falls back to query keywords only when a query was given", { tag: ["@unit"] }, () => {
    const withQuery = parseOverviewVerdict("Irregular glands infiltrating the stroma.", "infiltrating stroma");
    expect(withQuery.source).toBe("keyword");
    expect(withQuery.interest).toBe(1);

    expect(parseOverviewVerdict("Irregular glands.", undefined).source,
        "without a query there is no prose signal to fall back on").toBe("unparsed");
});

test("keywordInterest ignores short words and is bounded", { tag: ["@unit"] }, () => {
    expect(keywordInterest("necrosis is present", "is a necrosis"), "'is'/'a' are too short to count").toBe(1);
    expect(keywordInterest("bland squamous epithelium", "necrosis mitoses")).toBe(0);
    expect(keywordInterest("anything", "")).toBe(0);
});

test("quoting the question back earns nothing", { tag: ["@unit"] }, () => {
    // Verbatim from a real run. This field saw nothing, said so, and scored 1.0 — because the
    // sentence in which it said so contained every word of the query. It then ranked FIRST in
    // the report, above regions that had actually described tissue. The overlap is a
    // last-resort signal attached to the least informative fields on the slide, so it must
    // measure the model's own vocabulary rather than the echo of the prompt.
    const query = "interesting pathological findings";
    const echo = "Given the low resolution, judging the presence of "
        + "'interesting pathological findings' is not possible.";

    expect(keywordInterest(echo, query)).toBe(0);
    // ...and a field that genuinely used those words on its own still scores.
    expect(keywordInterest("There are pathological glands; the findings are interesting.", query)).toBe(1);
});

test("normalizeScore clamps out-of-range values", { tag: ["@unit"] }, () => {
    expect(normalizeScore(1.5, 1)).toEqual({ interest: 1, scale: 1 });
    expect(normalizeScore(-3, null)).toEqual({ interest: 0, scale: 1 });
    expect(normalizeScore(60, null), "above 10 the only sane reading is a percentage")
        .toEqual({ interest: 0.6, scale: 100 });
});

test("no text at all is UNKNOWN", { tag: ["@unit"] }, () => {
    for (const empty of [null, undefined, ""]) {
        expect(parseOverviewVerdict(empty).interest).toBeNull();
        expect(parseOverviewVerdict(empty).source).toBe("unparsed");
    }
});
