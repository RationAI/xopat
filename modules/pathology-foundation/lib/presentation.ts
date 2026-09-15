/**
 * Shaping an overview for the thing that reads it: a language model.
 *
 * The engine works in full floating-point precision — field planning, mask mapping and
 * coverage arithmetic all need it. A model does not, and paying for it is expensive in a
 * way that turns out to be load-bearing:
 *
 * - **Cost.** An unrounded coordinate serializes as `12345.678901234567` — about 18
 *   characters where 5 would do, across roughly fifteen numeric fields per region. A
 *   script result is truncated at a fixed character budget, so precision nobody uses
 *   directly displaces the regions the model still needed to see.
 * - **Correctness.** The region-link contract requires `x`, `y`, `w`, `h` to be
 *   **integers in level-0 image pixels**. Handing the model a float and expecting it to
 *   round is one more step at which a link can come out malformed and render as inert
 *   text. Rounding here means the value it copies is already the value the link needs.
 *
 * Applied at the scripting boundary only. Nothing here touches the cached tree or the
 * module API, so code consumers keep the precision they depend on.
 *
 * Pure and non-mutating: it returns new objects and leaves the input untouched. That
 * matters because the input is the CACHED overview — mutating it would quietly degrade
 * every later read of the same slide.
 */

/** How much prose from one region survives into a script result. */
export const MAX_FINDINGS_CHARS = 400;
/** Decimals kept for scores, fractions and µm/px. */
const RATIO_DECIMALS = 3;

/** Fields that are image-pixel geometry and must round to whole pixels. */
const PIXEL_KEYS = new Set(["bounds", "center", "scopeBounds"]);
/** Fields that are ratios, scores or physical scales — a few decimals is plenty. */
const RATIO_KEYS = new Set([
    "interest", "rankScore", "areaFraction", "slideAreaFraction", "bboxFillFraction",
    "cellularity", "slideCoverage", "renderedMpp", "requestedMpp", "deliveredMpp",
    "micronsPerPixel", "magnification", "coveredFraction", "tissueCoverage",
    "requiredMpp", "weight", "downsample",
]);
/** Prose fields worth capping. */
const PROSE_KEYS = new Set(["findings", "summary", "answer"]);
/**
 * Scheduler bookkeeping that must not reach the model.
 *
 * `pendingTiles` is a list of rectangles the walk has planned and not yet read. It is the
 * largest thing on a node after its children, it is meaningless to a reader, and a model that
 * saw it would be given boxes it must never present as regions that were examined — the
 * COUNT is what a caller needs, and that is reported once as `budget.plannedNotRead`.
 *
 * `expandedUnder` is the checklist hash a node's children were generated for — traversal
 * bookkeeping that says nothing about the tissue.
 */
const DROP_KEYS = new Set(["pendingTiles", "expandedUnder"]);

/**
 * A copy of `value` sized for a model: whole-pixel geometry, short numbers, capped prose.
 *
 * Deliberately key-driven rather than type-driven. A blanket "round every number" would
 * destroy `x`/`y` on a small slide as readily as it helps on a large one, and would round
 * `micronsPerPixel` to zero on a 40x scan — a number the prompt quotes to the vision model.
 */
export function forPresentation<T>(value: T, maxFindings = MAX_FINDINGS_CHARS): T {
    return project(value, null, null, maxFindings) as T;
}

/** How the numbers under the current key should be treated. */
type Mode = "pixel" | "ratio" | null;

/**
 * `mode` is what a container passes DOWN to its numbers.
 *
 * It has to be a mode rather than the key itself: `bounds` is an object, and its members
 * are named `x`/`y`/`width`/`height`, which appear in no list. Matching on the leaf key
 * alone would leave every coordinate unrounded — the exact values the region link needs.
 */
function project(value: any, key: string | null, mode: Mode, maxFindings: number): any {
    if (value == null) return value;

    // A function cannot be structure-cloned, so one left anywhere in a result does not degrade
    // the call — it makes the whole call throw `DataCloneError` before the caller sees a single
    // field. Dropping it here means a helper method on an engine object can never take a script
    // result down with it; anything a caller is meant to USE has to be plain data (see
    // `buildDensityMap`'s `topSpots`).
    if (typeof value === "function") return undefined;

    if (Array.isArray(value)) return value.map(item => project(item, key, mode, maxFindings));

    if (typeof value === "number") {
        if (!Number.isFinite(value)) return value;
        if (mode === "pixel") return Math.round(value);
        if (mode === "ratio") return round(value, RATIO_DECIMALS);
        return value;
    }

    if (typeof value === "string") {
        return key && PROSE_KEYS.has(key) ? cap(value, maxFindings) : value;
    }

    if (typeof value === "object") {
        // Anything the structured-clone boundary would not survive anyway (a Blob, a typed
        // array, a bound method) is passed through untouched rather than rebuilt wrongly.
        if (!isPlainObject(value)) return value;
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
            if (DROP_KEYS.has(k)) continue;
            // A key that names a mode establishes it for everything beneath; otherwise the
            // container passes down whatever it was given. That inheritance is the whole
            // point: `bounds` is an object whose members are `x`/`y`/`width`/`height`, and
            // those names appear in no list — matching on the leaf key alone would leave
            // every coordinate unrounded, which is exactly the value a region link needs.
            out[k] = project(v, k, modeFor(k) ?? mode, maxFindings);
        }
        return out;
    }

    return value;
}

/** The mode a key establishes, or null to inherit the enclosing one. */
function modeFor(key: string): Mode {
    if (PIXEL_KEYS.has(key)) return "pixel";
    if (RATIO_KEYS.has(key)) return "ratio";
    return null;
}

function isPlainObject(value: any): value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function round(value: number, decimals: number): number {
    const f = Math.pow(10, decimals);
    return Math.round(value * f) / f;
}

function cap(text: string, max: number): string {
    if (text.length <= max) return text;
    // Cut at a sentence end when one is near the limit, so the model is not handed half a
    // clause and left to guess how it ended.
    const head = text.slice(0, max);
    const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
    return (sentence > max * 0.6 ? head.slice(0, sentence + 1) : head.trimEnd()) + "…";
}
