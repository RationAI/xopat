/**
 * The regression suite for the run that could not have seen what it was asked about.
 *
 * A scoped prostate walk read every field at 5.46 → 1.046 → 0.849 µm/px and reported, at each
 * one, that the resolution was too low to judge cells. It was right. The ladder it was
 * descending had two rungs, `[2.0, 1.0]`, because checklist derivation had failed and the
 * GENERIC placeholder checklist's `requiredMpp` values (1, 1, 2) had been read as a statement
 * about what the question needs. The default ladder — the one used when there is no checklist
 * at all — is `[1.0, 0.5, 0.25]`, so the failure made the run strictly WORSE than asking
 * nothing, and nothing in the result said so.
 *
 * Numbers below are from that run: a 40x scan at 0.243 µm/px, scope 52063 x 19382.
 */
import { test, expect } from "@xopat/test-harness";
import { loadLib, cleanupLib } from "../load-lib.mjs";

const { ladderRungs } = await loadLib("ladder");
const { fallbackChecklist } = await loadLib("checklist");

test.afterAll(() => cleanupLib());

/** `OVERVIEW_MPP_LADDER` — architecture, glandular detail, nuclear detail. */
const DEFAULT_LADDER = [1.0, 0.5, 0.25];
/** `SURVEY_MPP` — the orientation rung a whole-slide run opens at. */
const SURVEY_MPP = 2.0;

const FALLBACK_STRINGS = {
    matchLabel: "Match", match: "?",
    extentLabel: "Extent", extent: "?",
    qualityLabel: "Quality", quality: "?",
};

// ---- the placeholder must not decide how closely the slide is read -------------------

test("a fallback checklist does not shorten the ladder", { tag: ["@unit"] }, () => {
    const generic = fallbackChecklist(FALLBACK_STRINGS, "interesting pathological findings");
    expect(generic.source, "the checklist under test").toBe("fallback");

    const rungs = ladderRungs({
        requiredMpp: generic.features.map(f => f.requiredMpp),
        source: generic.source,
        surveyMpp: SURVEY_MPP,
        defaultLadder: DEFAULT_LADDER,
    });

    // The failure verbatim: taking the placeholder's own numbers gave [2.0, 1.0].
    expect(rungs, "the default ladder, not the placeholder's figures").toEqual([1.0, 0.5, 0.25]);
    expect(Math.min(...rungs), "nuclear detail is reachable").toBe(0.25);
});

test("no checklist at all behaves identically", { tag: ["@unit"] }, () => {
    // A fallback checklist exists precisely because there was nothing to derive one from, so
    // it must not produce a different run from having none.
    expect(ladderRungs({ surveyMpp: SURVEY_MPP, defaultLadder: DEFAULT_LADDER }))
        .toEqual([1.0, 0.5, 0.25]);
    expect(ladderRungs({ requiredMpp: [], source: null, surveyMpp: SURVEY_MPP, defaultLadder: DEFAULT_LADDER }))
        .toEqual([1.0, 0.5, 0.25]);
});

// ---- a checklist somebody wrote still governs ----------------------------------------

test("a derived checklist states the rungs, and nothing finer is climbed to", { tag: ["@unit"] }, () => {
    // The point of deriving one: a question about architecture must not pay for nuclear rungs.
    const rungs = ladderRungs({
        requiredMpp: [1.0, 2.0], source: "derived",
        surveyMpp: SURVEY_MPP, defaultLadder: DEFAULT_LADDER,
    });
    expect(rungs).toEqual([2.0, 1.0]);
});

test("a derived checklist finer than the default ladder is honoured", { tag: ["@unit"] }, () => {
    const rungs = ladderRungs({
        requiredMpp: [0.5, 0.125], source: "explicit",
        surveyMpp: SURVEY_MPP, defaultLadder: DEFAULT_LADDER,
    });
    expect(rungs, "prefixed by an orientation rung at the survey").toEqual([2.0, 0.5, 0.125]);
});

test("duplicate requirements are one rung", { tag: ["@unit"] }, () => {
    const rungs = ladderRungs({
        requiredMpp: [0.5, 0.5, 0.5], source: "derived",
        surveyMpp: 0.5, defaultLadder: DEFAULT_LADDER,
    });
    expect(rungs, "the survey rung IS the requirement here").toEqual([0.5]);
});

// ---- scoped runs open finer, and must ladder from there -------------------------------

test("a scoped survey drops rungs it has already passed", { tag: ["@unit"] }, () => {
    // A viewport-sized scope reads at ~0.6 µm/px, so a 1.0 rung would be a step BACKWARDS.
    const rungs = ladderRungs({ surveyMpp: 0.61, defaultLadder: DEFAULT_LADDER });
    expect(rungs).toEqual([0.5, 0.25]);
});

test("a scope already at native resolution still has somewhere to go", { tag: ["@unit"] }, () => {
    // Every default rung is coarser than the survey. Returning [] would leave the walk with no
    // rung to descend to and no way to expand anything.
    const rungs = ladderRungs({ surveyMpp: 0.2, defaultLadder: DEFAULT_LADDER });
    expect(rungs.length).toBeGreaterThan(0);
    expect(rungs).toEqual([0.25]);
});

// ---- hostile input --------------------------------------------------------------------

test("unusable requirements fall back rather than producing a broken ladder", { tag: ["@unit"] }, () => {
    // Every knob arrives through a script the chat model wrote (AGENTS.md §0.2/§7).
    for (const bad of [[NaN, Infinity], [0, -1], [null, "0.5"]]) {
        expect(ladderRungs({
            requiredMpp: bad, source: "derived",
            surveyMpp: SURVEY_MPP, defaultLadder: DEFAULT_LADDER,
        }), JSON.stringify(bad)).toEqual([1.0, 0.5, 0.25]);
    }
});

// ---- what the depth cap is derived from -----------------------------------------------

test("the ladder's length is the depth a run needs", { tag: ["@unit"] }, () => {
    // `maxDepth` defaults to `max(2, ladder.targetMpp.length)`. One rung costs one level, so a
    // three-rung ladder walked to depth 2 stops one rung above the resolution it declared —
    // which is the shape of the original failure, restated as arithmetic.
    const rungs = ladderRungs({ surveyMpp: SURVEY_MPP, defaultLadder: DEFAULT_LADDER });
    expect(Math.max(2, rungs.length)).toBe(3);
});

// ---- a rung is a render target, so it cannot be finer than the scan --------------------
//
// From the lung run: a 20x scan at 0.504 µm/px, a derived checklist asking 0.25 µm/px for
// nuclear atypia and mitotic activity. Nothing clamped that (deliberately — the requirement
// is a true statement about the question), so the ladder grew a rung no render could deliver.
// The cost was not a wasted rung: `maxDepth` is derived from the ladder's LENGTH, so the walk
// gained a depth level it could never satisfy, and `finestMpp` became a figure no field could
// match, which held the drill gate open. It subdivided until its fields were 63 x 73 µm and a
// vision model was asked to read cytology from a 62 x 72 pixel raster.

/** The lung slide: 20x, 0.504 µm/px. */
const LUNG_NATIVE = 0.504;

test("no rung is finer than the scan itself holds", { tag: ["@unit"] }, () => {
    const rungs = ladderRungs({
        requiredMpp: [1, 2, 0.25, 0.25],
        source: "derived",
        surveyMpp: SURVEY_MPP,
        defaultLadder: DEFAULT_LADDER,
        nativeMpp: LUNG_NATIVE,
    });

    for (const r of rungs) expect(r, `rung ${r}`).toBeGreaterThanOrEqual(LUNG_NATIVE);
    expect(rungs, "0.25 and 0.25 both floor to native and collapse into ONE rung")
        .toEqual([2, 1, LUNG_NATIVE]);
});

test("flooring two unreachable requirements does not add a depth level", { tag: ["@unit"] }, () => {
    // 0.25 and 0.4 describe one reachable rung, not two. Left as duplicates they would add a
    // level that re-reads the same pixels — `maxDepth` counts rungs, not distinct resolutions.
    const rungs = ladderRungs({
        requiredMpp: [2, 0.4, 0.25],
        source: "derived",
        surveyMpp: SURVEY_MPP,
        defaultLadder: DEFAULT_LADDER,
        nativeMpp: LUNG_NATIVE,
    });

    expect(rungs).toEqual([2, LUNG_NATIVE]);
});

test("the default ladder is floored too", { tag: ["@unit"] }, () => {
    // `OVERVIEW_MPP_LADDER` ends at 0.25 — finer than most scans. A fallback checklist must
    // not aim the walk at a resolution the slide does not have either.
    const rungs = ladderRungs({
        surveyMpp: SURVEY_MPP, defaultLadder: DEFAULT_LADDER, nativeMpp: LUNG_NATIVE,
    });

    expect(rungs).toEqual([1.0, LUNG_NATIVE]);
});

test("without nativeMpp the rungs are unchanged", { tag: ["@unit"] }, () => {
    // An uncalibrated slide has no floor to apply, and every existing caller that omits it
    // must keep the ladder it had.
    expect(ladderRungs({
        requiredMpp: [1, 2, 0.25], source: "derived",
        surveyMpp: SURVEY_MPP, defaultLadder: DEFAULT_LADDER,
    })).toEqual([2, 1, 0.25]);
});

test("a native finer than every requirement changes nothing", { tag: ["@unit"] }, () => {
    // A 40x scan (0.243 µm/px) can deliver everything asked of it — the floor must not
    // coarsen a ladder that was already reachable.
    expect(ladderRungs({
        requiredMpp: [1, 2, 0.25], source: "derived",
        surveyMpp: SURVEY_MPP, defaultLadder: DEFAULT_LADDER, nativeMpp: 0.243,
    })).toEqual([2, 1, 0.25]);
});
