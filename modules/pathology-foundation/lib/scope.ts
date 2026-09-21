/**
 * Where an exploration looks, how coarsely, and which cached survey answers for a box.
 *
 * Exploration used to have exactly one answer to all three questions: the whole slide, at a
 * flat 2 MP, from the slide's one survey. A scope makes each of them a decision, and each
 * decision is arithmetic over rectangles — no viewer, no renderer, no driver. It lives here
 * so it can be tested against numbers taken from a real slide instead of only observed on one.
 *
 * Coordinates are parent-global level-0 image pixels throughout, the same space the engine's
 * `bounds` speak. Nothing here touches a viewer or the DOM.
 */

import type { Bounds } from "./types";
import { clampNumber } from "./types";
import { clampBoundsToSlide, containsBounds } from "./geometry";

/** What a survey's coverage figures refer to. */
export type CoverageScope = "whole-slide" | "current-view" | "region";

/** The shape `pickSurvey` needs; the engine's `SlideSurvey` satisfies it structurally. */
export interface SurveyLike {
    surveyBounds: Bounds;
    mask: { width: number; height: number };
}

/**
 * Validate and clamp a caller-supplied scope rectangle.
 *
 * The rectangle arrives from a script the chat model wrote, so it is treated as hostile
 * (AGENTS.md §0.2/§7): every field must be a finite number and the box must have area.
 * Returns null for a box that is malformed or misses the slide entirely — which the caller
 * must turn into an error, because silently surveying nothing gets reported as "blank slide".
 */
export function normalizeScopeRect(box: any, slideWidth = 0, slideHeight = 0): Bounds | null {
    const finite = (v: any) => typeof v === "number" && Number.isFinite(v);
    if (!box || !finite(box.x) || !finite(box.y) || !finite(box.width) || !finite(box.height)) return null;
    if (!(box.width > 0) || !(box.height > 0)) return null;
    const rect: Bounds = { x: box.x, y: box.y, width: box.width, height: box.height };
    if (!(slideWidth > 0) || !(slideHeight > 0)) return rect;
    const clamped = clampBoundsToSlide(rect, slideWidth, slideHeight);
    return clamped && clamped.width > 0 && clamped.height > 0 ? clamped : null;
}

/**
 * The µm/px the orientation pass aims at.
 *
 * An explicit `surveyMpp` wins verbatim — the same contract an explicit magnification ladder
 * has, and second-guessing it would make the knob useless. Otherwise `defaultMpp` for a
 * whole-slide run, but never coarser than the resolution the scope already affords inside its
 * own pixel budget: on a viewport-sized box, forcing 2 µm/px throws away detail the render was
 * going to deliver for free, which is the whole reason to scope a walk in the first place.
 *
 * Returns undefined on an uncalibrated slide — there is no physical scale to hit, and the
 * pixel budget is then the only honest statement of how closely anything was read.
 */
export function resolveSurveyMpp(
    bounds: Bounds,
    slideMpp: number | null,
    coverageScope: CoverageScope,
    opts: { surveyMpp?: number; surveyPixels?: number },
    defaultMpp: number,
    defaultPixels: number
): number | undefined {
    if (typeof opts.surveyMpp === "number" && opts.surveyMpp > 0) return opts.surveyMpp;
    if (!slideMpp || !(slideMpp > 0)) return undefined;
    if (coverageScope === "whole-slide") return defaultMpp;
    const budget = Math.max(1024, opts.surveyPixels ?? defaultPixels);
    const area = Math.max(1, bounds.width * bounds.height);
    // The finest µm/px this budget covers the box at, never finer than the slide itself.
    const affordable = slideMpp * Math.max(1, Math.sqrt(area / budget));
    return Math.min(defaultMpp, affordable);
}

/**
 * Raster budget for a survey of `bounds`, in pixels.
 *
 * `surveyMpp` states a RESOLUTION, which is what a caller actually means by "look closer at
 * this area"; it is converted here into the pixel count the render path already takes, so
 * there stays one render entry point rather than two that can disagree.
 */
export function surveyPixelBudget(
    bounds: Bounds,
    slideMpp: number | null,
    opts: { surveyMpp?: number; surveyPixels?: number },
    defaultPixels: number,
    maxPixels: number
): number {
    const ceiling = clampNumber(opts.surveyPixels, defaultPixels, 1024, maxPixels);
    if (!slideMpp || !(slideMpp > 0) || !(typeof opts.surveyMpp === "number" && opts.surveyMpp > 0)) {
        return ceiling;
    }
    const scale = slideMpp / opts.surveyMpp;   // delivered raster px per level-0 px
    return Math.min(ceiling, Math.max(1024, Math.round(bounds.width * scale * bounds.height * scale)));
}

/**
 * Cache key for one survey: the slide, the rectangle, and the budget it was derived at.
 *
 * Rounded to whole pixels so a rectangle that survived a round-trip through viewport
 * conversions still hits its own entry — a key made of raw doubles would miss on drift far
 * below the resolution of anything the mask can represent.
 */
export function surveyCacheKey(slideKey: string, bounds: Bounds, pixelBudget: number): string {
    const r = (v: number) => Math.round(v);
    return `${slideKey}|${r(bounds.x)},${r(bounds.y)},${r(bounds.width)},${r(bounds.height)}|${r(pixelBudget)}`;
}

/**
 * True when `key` belongs to `slideKey`'s family of entries.
 *
 * Not survey-specific despite living here: the plan cache uses the same `slideKey|…` keying,
 * and so does anything else that wants {@link rememberBounded}'s per-slide eviction.
 */
export function isKeyOfSlide(key: string, slideKey: string): boolean {
    return key.startsWith(`${slideKey}|`);
}

/**
 * Did a scoped survey come back as ONE region that is really just the scope rectangle?
 *
 * A scope is drawn around tissue the reviewer cares about, which on a biopsy is usually
 * several cores. At survey coarseness those cores are separated by a few mask pixels of
 * glass, and outer contours are traced 8-connected — so one diagonal touch anywhere merges
 * them into a single contour whose bounding box is the whole scope. `exploreSlide` then
 * reports one region, the walk gets one root, and the assistant describes a four-core biopsy
 * as "a single core".
 *
 * The tell is the pair of numbers: a box spanning (almost) the whole scope while the scope is
 * mostly glass. Either alone is legitimate — a scope really can hold one object, and a scope
 * really can be mostly glass — which is why neither is the test on its own.
 *
 * Whole-slide runs are excluded: a contour spanning the slide is already dropped upstream as
 * degenerate, and a caller who framed a rectangle of mostly glass asked for that number.
 */
export function shouldResegmentScope(opts: {
    coverageScope: CoverageScope;
    /** How many regions the contour pass produced. */
    regionCount: number;
    /** Area of the single region, when there is one. */
    regionArea?: number | null;
    /** Area of the surveyed rectangle. */
    surveyArea: number;
    /** Tissue fraction of the surveyed rectangle. */
    coverage: number;
    /** Share of the scope a region must span to count as "it outlined the scope". */
    spanFraction: number;
    /** Coverage at or above which the rectangle IS one object. */
    solidCoverage: number;
}): boolean {
    if (opts.coverageScope === "whole-slide") return false;
    if (opts.regionCount > 1) return false;
    if (!(opts.surveyArea > 0)) return false;
    // Solid tissue is one object, and saying so is correct.
    if (opts.coverage >= opts.solidCoverage) return false;
    // No region at all is the same failure with the box already thrown away.
    if (!opts.regionCount) return true;
    const area = opts.regionArea;
    return typeof area === "number" && Number.isFinite(area) && area >= opts.spanFraction * opts.surveyArea;
}

/**
 * The best cached survey for `bounds`: the one that covers it at the finest mask resolution.
 *
 * Every free measurement the engine makes — tissue fill, nuclear density, the mask a
 * subdivision traces children out of — used to look up "the slide's survey", back when there
 * could only be one. With scoped runs there can be several, and the right one is not the
 * newest but the one that actually saw this box, most closely. Without `bounds` it is simply
 * the finest survey on the slide.
 */
export function pickSurvey<T extends SurveyLike>(surveys: Iterable<T>, bounds?: Bounds): T | null {
    let best: T | null = null;
    let bestDensity = -1;
    for (const survey of surveys) {
        if (bounds && !containsBounds(survey.surveyBounds, bounds)) continue;
        const area = Math.max(1e-9, survey.surveyBounds.width * survey.surveyBounds.height);
        // Mask pixels per unit slide area: higher means this survey resolves the box better.
        const density = (survey.mask.width * survey.mask.height) / area;
        if (density > bestDensity) { bestDensity = density; best = survey; }
    }
    return best;
}

/**
 * Insert `value` at `key` and evict this slide's least-recently-used entries beyond `cap`.
 *
 * A `Map` iterates in insertion order, so deleting before setting is what makes that order an
 * LRU order — and why a cache HIT must go through here too, or recency would only ever mean
 * "when it was first derived".
 */
export function rememberBounded<T>(
    store: Map<string, T>,
    key: string,
    slideKey: string,
    value: T,
    cap: number
): void {
    store.delete(key);
    store.set(key, value);
    const mine = [...store.keys()].filter(k => isKeyOfSlide(k, slideKey));
    for (const stale of mine.slice(0, Math.max(0, mine.length - Math.max(1, cap)))) store.delete(stale);
}
