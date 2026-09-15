/**
 * The regression suite for exploring somewhere other than the whole slide.
 *
 * Exploration used to have one answer to three questions — where to look (the whole slide),
 * how coarsely (a flat 2 MP), and which cached survey answers for a box (the slide's one
 * survey). Making the first configurable makes the other two decisions, and each of them has
 * a way to be quietly wrong:
 *
 * - a scoped walk that still opens at whole-slide coarseness is a slow way to learn nothing
 *   the unscoped walk did not already know;
 * - a survey cache keyed by slide alone hands a whole-slide mask to a walk that asked for a
 *   viewport-fine one, at four times the pixel size it believes it has;
 * - an unbounded cache keeps a ~2 MB mask per scope, and scopes are unbounded.
 *
 * Numbers below are from a 40x scan.
 */
import { test, expect } from "@xopat/test-harness";
import { loadLib, cleanupLib } from "../load-lib.mjs";

const {
    normalizeScopeRect, resolveSurveyMpp, surveyPixelBudget, surveyCacheKey, isKeyOfSlide,
    pickSurvey, rememberBounded, shouldResegmentScope,
} = await loadLib("scope");
const { clampNumber } = await loadLib("types");

test.afterAll(() => cleanupLib());

/** A 40x scan: 0.25 µm/px at level 0, 100k x 80k pixels. */
const SLIDE_MPP = 0.25;
const SLIDE = { width: 100_000, height: 80_000 };
const WHOLE_SLIDE = { x: 0, y: 0, width: SLIDE.width, height: SLIDE.height };
/** Roughly what a viewport covers on such a slide at a working zoom. */
const VIEWPORT = { x: 40_000, y: 30_000, width: 4_000, height: 3_000 };

const MASK_TARGET_PIXELS = 2_000_000;
const MASK_MAX_PIXELS = 4_000_000;
const SURVEY_MPP = 2.0;

const survey = (bounds, maskWidth, maskHeight) => ({ bounds, surveyBounds: bounds, mask: { width: maskWidth, height: maskHeight } });

// ---- scope rectangles ---------------------------------------------------------------

test("a scope rectangle is validated and clamped onto the slide", { tag: ["@unit"] }, () => {
    expect(normalizeScopeRect(VIEWPORT, SLIDE.width, SLIDE.height)).toEqual(VIEWPORT);

    // Half off the right edge: kept, but only the part that exists.
    const overhanging = { x: 99_000, y: 0, width: 4_000, height: 1_000 };
    expect(normalizeScopeRect(overhanging, SLIDE.width, SLIDE.height))
        .toEqual({ x: 99_000, y: 0, width: 1_000, height: 1_000 });
});

test("a malformed or off-slide scope is refused, not silently emptied", { tag: ["@unit"] }, () => {
    // Each of these would otherwise survey nothing and be reported as "the slide looks blank".
    for (const bad of [
        undefined, null, {},
        { x: NaN, y: 0, width: 10, height: 10 },
        { x: 0, y: 0, width: 0, height: 10 },
        { x: 0, y: 0, width: -10, height: 10 },
        { x: "0", y: 0, width: 10, height: 10 },
        { x: 200_000, y: 0, width: 100, height: 100 },   // entirely past the right edge
    ]) {
        expect(normalizeScopeRect(bad, SLIDE.width, SLIDE.height), JSON.stringify(bad)).toBeNull();
    }
});

test("a scope on a slide of unknown extent is taken as given", { tag: ["@unit"] }, () => {
    // Some DICOM/custom sources expose no dimensions; there is nothing to clamp against, and
    // refusing the box would remove the only way to explore such a slide at all.
    expect(normalizeScopeRect(VIEWPORT, 0, 0)).toEqual(VIEWPORT);
});

// ---- the coarse rung ----------------------------------------------------------------

test("a whole-slide run still opens at the survey rung", { tag: ["@unit"] }, () => {
    expect(resolveSurveyMpp(WHOLE_SLIDE, SLIDE_MPP, "whole-slide", {}, SURVEY_MPP, MASK_TARGET_PIXELS))
        .toBe(SURVEY_MPP);
});

test("a scoped run opens as finely as its scope already affords", { tag: ["@unit"] }, () => {
    const mpp = resolveSurveyMpp(VIEWPORT, SLIDE_MPP, "current-view", {}, SURVEY_MPP, MASK_TARGET_PIXELS);

    // 4000x3000 level-0 px is 12 MP of slide into a 2 MP budget — about 2.45x down, i.e.
    // ~0.61 µm/px. THIS is the point of scoping: the same budget reads the box far closer
    // than the 2.0 µm/px a whole-slide pass would have opened at.
    expect(mpp).toBeLessThan(SURVEY_MPP);
    expect(mpp).toBeCloseTo(SLIDE_MPP * Math.sqrt(12_000_000 / MASK_TARGET_PIXELS), 6);
});

test("a scope small enough to read 1:1 never asks for more than native resolution", { tag: ["@unit"] }, () => {
    const tiny = { x: 0, y: 0, width: 800, height: 600 };   // 0.48 MP, well inside the budget
    expect(resolveSurveyMpp(tiny, SLIDE_MPP, "region", {}, SURVEY_MPP, MASK_TARGET_PIXELS)).toBe(SLIDE_MPP);
});

test("an explicit surveyMpp is honoured verbatim, at any scope", { tag: ["@unit"] }, () => {
    // A deliberate override; second-guessing it would make the knob useless.
    for (const scope of ["whole-slide", "current-view", "region"]) {
        expect(resolveSurveyMpp(VIEWPORT, SLIDE_MPP, scope, { surveyMpp: 4 }, SURVEY_MPP, MASK_TARGET_PIXELS))
            .toBe(4);
    }
});

test("an uncalibrated slide has no rung to aim at", { tag: ["@unit"] }, () => {
    // No physical scale means nothing to be wrong about; the pixel budget is the honest answer.
    expect(resolveSurveyMpp(VIEWPORT, null, "current-view", {}, SURVEY_MPP, MASK_TARGET_PIXELS)).toBeUndefined();
});

// ---- the pixel budget ---------------------------------------------------------------

test("the survey budget is the flat default when no resolution is requested", { tag: ["@unit"] }, () => {
    expect(surveyPixelBudget(WHOLE_SLIDE, SLIDE_MPP, {}, MASK_TARGET_PIXELS, MASK_MAX_PIXELS))
        .toBe(MASK_TARGET_PIXELS);
});

test("a requested resolution buys only the pixels it needs", { tag: ["@unit"] }, () => {
    // 4000x3000 at 0.5 µm/px is 2000x1500 = 3 MP... over the 2 MP default, so it clamps.
    expect(surveyPixelBudget(VIEWPORT, SLIDE_MPP, { surveyMpp: 0.5 }, MASK_TARGET_PIXELS, MASK_MAX_PIXELS))
        .toBe(MASK_TARGET_PIXELS);
    // At 1.0 µm/px it is 1000x750 = 0.75 MP, and asking for the full 2 MP would be asking
    // the renderer for detail the rung says is not wanted.
    expect(surveyPixelBudget(VIEWPORT, SLIDE_MPP, { surveyMpp: 1.0 }, MASK_TARGET_PIXELS, MASK_MAX_PIXELS))
        .toBe(750_000);
});

test("a caller cannot raise the budget past the reader's ceiling", { tag: ["@unit"] }, () => {
    expect(surveyPixelBudget(WHOLE_SLIDE, SLIDE_MPP, { surveyPixels: 64_000_000 }, MASK_TARGET_PIXELS, MASK_MAX_PIXELS))
        .toBe(MASK_MAX_PIXELS);
    expect(surveyPixelBudget(WHOLE_SLIDE, SLIDE_MPP, { surveyPixels: NaN }, MASK_TARGET_PIXELS, MASK_MAX_PIXELS))
        .toBe(MASK_TARGET_PIXELS);
});

test("clampNumber refuses everything that is not a finite number", { tag: ["@unit"] }, () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined, null, "4", {}, []]) {
        expect(clampNumber(bad, 7, 1, 10), JSON.stringify(bad)).toBe(7);
    }
    expect(clampNumber(-3, 7, 1, 10)).toBe(1);
    expect(clampNumber(99, 7, 1, 10)).toBe(10);
});

// ---- the survey cache ---------------------------------------------------------------

test("surveys of different scopes or budgets are different cache entries", { tag: ["@unit"] }, () => {
    const slide = "tsid-1";
    const whole = surveyCacheKey(slide, WHOLE_SLIDE, MASK_TARGET_PIXELS);
    const view = surveyCacheKey(slide, VIEWPORT, MASK_TARGET_PIXELS);
    const viewFiner = surveyCacheKey(slide, VIEWPORT, MASK_MAX_PIXELS);

    expect(new Set([whole, view, viewFiner]).size, "three distinct surveys, three keys").toBe(3);
    for (const key of [whole, view, viewFiner]) expect(isKeyOfSlide(key, slide)).toBe(true);
    expect(isKeyOfSlide(whole, "tsid-2"), "keys never leak across slides").toBe(false);
});

test("a key survives the sub-pixel drift of a coordinate round-trip", { tag: ["@unit"] }, () => {
    // The same rectangle, back from viewport conversions. Drift far below one mask pixel must
    // not turn a cache hit into another whole-slide render.
    const drifted = { x: 40_000.0000001, y: 29_999.9999998, width: 4_000.0000003, height: 3_000 };
    expect(surveyCacheKey("tsid-1", drifted, MASK_TARGET_PIXELS))
        .toBe(surveyCacheKey("tsid-1", VIEWPORT, MASK_TARGET_PIXELS));
});

test("the survey chosen for a box is the finest one that covers it", { tag: ["@unit"] }, () => {
    const wholeSlide = survey(WHOLE_SLIDE, 1580, 1264);          // ~2 MP over the whole slide
    const viewport = survey(VIEWPORT, 1630, 1222);               // ~2 MP over the viewport
    const elsewhere = survey({ x: 0, y: 0, width: 4_000, height: 3_000 }, 1630, 1222);

    // Both cover it; the viewport survey resolves it ~600x better per unit area.
    expect(pickSurvey([wholeSlide, viewport, elsewhere], VIEWPORT)).toBe(viewport);
    // A box the fine survey does not contain falls back to the one that does.
    expect(pickSurvey([wholeSlide, viewport, elsewhere], { x: 0, y: 0, width: 90_000, height: 70_000 }))
        .toBe(wholeSlide);
    // Nothing covers it at all.
    expect(pickSurvey([viewport, elsewhere], { x: 0, y: 0, width: 90_000, height: 70_000 })).toBeNull();
    // No box asked for: simply the finest.
    expect(pickSurvey([wholeSlide, viewport, elsewhere])).toBe(viewport);
});

// ---- a scope that came back as one core ----------------------------------------------

/**
 * The run this guard exists for: a 52063 x 19382 scope over a prostate biopsy came back as ONE
 * region whose bounds were the scope rectangle, with `bboxFillFraction: 0.105`. The cores in it
 * were separated by glass; one diagonal touch in an 8-connected trace merged them. Everything
 * downstream then reasoned about "a single core".
 */
const SCOPE = { x: 23319, y: 124643, width: 52063, height: 19382 };
const SCOPE_AREA = SCOPE.width * SCOPE.height;
const GUARD = { spanFraction: 0.9, solidCoverage: 0.9 };

const collapsed = (over = {}) => shouldResegmentScope({
    coverageScope: "region", regionCount: 1, regionArea: SCOPE_AREA,
    surveyArea: SCOPE_AREA, coverage: 0.105, ...GUARD, ...over,
});

test("a scoped survey that outlined its own rectangle is re-segmented", { tag: ["@unit"] }, () => {
    expect(collapsed()).toBe(true);
    // The same shape with the box already discarded as degenerate: no regions at all.
    expect(collapsed({ regionCount: 0, regionArea: null })).toBe(true);
});

test("a scope that really is one solid object is left alone", { tag: ["@unit"] }, () => {
    // Both numbers matter, and neither is the test on its own: a scope may legitimately hold
    // one object, and a scope may legitimately be mostly glass.
    expect(collapsed({ coverage: 0.95 }), "a rectangle of solid tissue is one region").toBe(false);
    expect(collapsed({ regionArea: 0.2 * SCOPE_AREA }), "a genuine island inside a big scope").toBe(false);
    expect(collapsed({ regionCount: 4 }), "the survey already separated them").toBe(false);
});

test("a whole-slide run is never re-segmented here", { tag: ["@unit"] }, () => {
    // A slide-spanning contour is already dropped upstream, and a caller who framed glass and
    // asked for the number must get that number back unqualified.
    expect(collapsed({ coverageScope: "whole-slide" })).toBe(false);
});

test("a survey of nothing is not turned into a split", { tag: ["@unit"] }, () => {
    expect(collapsed({ surveyArea: 0 })).toBe(false);
});

test("the survey cache is bounded per slide, least-recently-used first out", { tag: ["@unit"] }, () => {
    const store = new Map();
    const slide = "tsid-1";
    const keys = [0, 1, 2, 3, 4].map(i =>
        surveyCacheKey(slide, { x: i * 1000, y: 0, width: 500, height: 500 }, MASK_TARGET_PIXELS));

    keys.slice(0, 4).forEach((k, i) => rememberBounded(store, k, slide, i, 4));
    expect(store.size, "four fit").toBe(4);

    // Touching the oldest makes it the newest, so the NEXT insert must not evict it.
    rememberBounded(store, keys[0], slide, 0, 4);
    rememberBounded(store, keys[4], slide, 4, 4);
    expect(store.size).toBe(4);
    expect(store.has(keys[0]), "recently used survives").toBe(true);
    expect(store.has(keys[1]), "least recently used is evicted").toBe(false);

    // Another slide's surveys are counted (and evicted) separately.
    rememberBounded(store, surveyCacheKey("tsid-2", WHOLE_SLIDE, MASK_TARGET_PIXELS), "tsid-2", "other", 4);
    expect(store.size).toBe(5);
});
