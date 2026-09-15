/**
 * Parsing of a vision model's machine-readable verdict line.
 *
 * Tolerant on the way in, honest on the way out. Models routinely answer on a 1-5 or
 * 1-10 scale, wrap values in the template's own angle brackets, or echo the placeholder;
 * a strict 0..1 regex silently turns every one of those into `interest: 0`, which is
 * indistinguishable from a real "not interesting" and hides genuine findings. So:
 * normalize known scales, reject template echoes, and when nothing usable comes back
 * report interest as UNKNOWN (null) rather than inventing a number.
 *
 * Pure — no viewer, no driver, no i18n. Every axis parses independently: a missing SCORE
 * must not discard a stated DRILL.
 */

/** How a node's interest score was established — so a parse failure is never read as a real 0. */
export type VerdictSource =
    /** The model emitted a conforming 0..1 SCORE. */
    | "contract"
    /** The model emitted a score on another scale (1-5/1-10/...); normalized to 0..1. */
    | "normalized"
    /** No machine line; interest derived coarsely from query keywords in the prose. */
    | "keyword"
    /** No usable score at all — interest is UNKNOWN (null), not zero. */
    | "unparsed";

export interface OverviewVerdict {
    /** Interest 0..1, or null when nothing usable was returned. NEVER fabricated as 0. */
    interest: number | null;
    drill: boolean;
    confidence: "low" | "medium" | "high" | null;
    /**
     * Whether the features the question needs could be JUDGED at this resolution —
     * deliberately independent of `interest`. "I cannot tell at this power" is a reason to
     * look closer, not a reason to stop, so it must not arrive disguised as a low score.
     * Null when the model did not state it.
     */
    resolvable: boolean | null;
    source: VerdictSource;
    /** The denominator assumed when `source` is "normalized" (5, 10, 100, ...). */
    scoreScale?: number;
}

/**
 * Markdown and quoting noise a model wraps a label or a value in.
 *
 * Whitespace is inside the class rather than around it because decoration and spaces
 * interleave in any order — `**SCORE:** \`0.45\`` puts `**`, a space and a backtick
 * between the colon and the digits. A pattern of the shape `\s*[<*"']*\s*` only
 * tolerates ONE decoration run and reads that answer as unparseable, which is the
 * same as scoring a real finding as unknown and ranking it last.
 */
const DECOR = "[\\s*_`\"'~]*";
/** An opening bracket the model may have wrapped the value in (`<yes>`, `[0.4]`). */
const OPEN = "[<(\\[]?";

/**
 * `LABEL: value`, tolerant of however the model dressed it up.
 *
 * Exported because the checklist parser reads the same `SCORE:` line. Two hand-written
 * decoration classes drift — and did: one accepted `~~SCORE~~` while the other did not,
 * so the same model output scored differently depending on which path read it.
 */
export function axis(label: string, value: string): RegExp {
    return new RegExp(`${label}${DECOR}[:=]${DECOR}${OPEN}${DECOR}(${value})`, "i");
}

/** True when the model parroted the contract's placeholder instead of filling it in. */
export function isTemplateEcho(text: string): boolean {
    // Must be at least as tolerant as the score pattern below: an echo the score
    // regex can read but this one cannot becomes a fabricated score.
    return axis("SCORE", "decimal|number|a\\s+decimal|0\\s*(?:to|-|\\.\\.)\\s*1\\b").test(text);
}

/**
 * Map a raw score onto 0..1. An explicit `/N` is authoritative; otherwise infer the
 * scale from the magnitude, since a value above 1 cannot have been on the 0..1 scale
 * the contract asked for. Returns the assumed denominator so callers can flag it.
 */
export function normalizeScore(raw: number, explicitScale: number | null): { interest: number; scale: number } {
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    if (explicitScale && explicitScale > 0) return { interest: clamp(raw / explicitScale), scale: explicitScale };
    if (raw <= 1) return { interest: clamp(raw), scale: 1 };
    if (raw <= 5) return { interest: clamp(raw / 5), scale: 5 };
    if (raw <= 10) return { interest: clamp(raw / 10), scale: 10 };
    return { interest: clamp(raw / 100), scale: 100 };
}

/**
 * Fraction of the query's salient words present in `text` (0..1); 0 without a query.
 *
 * This is the LAST-RESORT interest signal — used only when the model produced no score and
 * answered nothing assessable — which makes it the signal attached to the least informative
 * fields on the slide. It must therefore not reward the one thing such a field's reply almost
 * always contains: the question itself, quoted back. A real run scored a region 1.0 because it
 * said "judging the presence of 'interesting pathological findings' is not possible" — every
 * query word present, nothing seen — and that region then ranked first in the report.
 *
 * So every verbatim occurrence of the query is removed before counting. What remains is the
 * model's own vocabulary, which is what the overlap was ever meant to measure.
 */
export function keywordInterest(text: string, query?: string): number {
    if (!query) return 0;
    const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    if (!words.length) return 0;
    const needle = query.toLowerCase().trim();
    const hay = needle ? text.toLowerCase().split(needle).join(" ") : text.toLowerCase();
    let hits = 0;
    for (const w of words) if (hay.includes(w)) hits++;
    return Math.min(1, hits / words.length);
}

/** Parse `SCORE: <0..1> DRILL: <yes|no> CONFIDENCE: <...> RESOLVABLE: <yes|no>`. */
export function parseOverviewVerdict(text: string | null | undefined, query?: string): OverviewVerdict {
    if (!text || typeof text !== "string") {
        return { interest: null, drill: false, confidence: null, resolvable: null, source: "unparsed" };
    }

    const drillMatch = text.match(axis("DRILL", "yes|no|true|false"));
    const drill = drillMatch ? /^(yes|true)$/i.test(drillMatch[1]) : false;
    const confMatch = text.match(axis("CONFIDENCE", "low|medium|high"));
    const confidence = (confMatch ? confMatch[1].toLowerCase() : null) as OverviewVerdict["confidence"];
    // Parsed independently, and NULL when unstated — an axis the model omitted must not
    // read as "resolvable: false" (endless drilling) nor as "true" (silent blind spot).
    const resolvableMatch = text.match(axis("RESOLVABLE", "yes|no|true|false"));
    const resolvable = resolvableMatch ? /^(yes|true)$/i.test(resolvableMatch[1]) : null;

    // The trailing group is an explicit denominator (`7/10`), which outranks any guess
    // at the scale. `\s*` around the slash only — a backtick after the value closes it.
    const scoreMatch = text.match(
        new RegExp(`${axis("SCORE", "[0-9]*\\.?[0-9]+").source}\\s*(?:\\/\\s*([0-9]+))?`, "i")
    );
    if (scoreMatch && !isTemplateEcho(text)) {
        const raw = parseFloat(scoreMatch[1]);
        if (Number.isFinite(raw)) {
            const explicitScale = scoreMatch[2] ? parseFloat(scoreMatch[2]) : null;
            const { interest, scale } = normalizeScore(raw, explicitScale);
            return {
                interest,
                drill,
                confidence,
                resolvable,
                source: scale === 1 ? "contract" : "normalized",
                ...(scale === 1 ? {} : { scoreScale: scale }),
            };
        }
    }

    // No usable score. A query gives us a coarse prose signal; without one we know
    // nothing — and "nothing" must stay null, never collapse to 0.
    if (query) {
        return { interest: keywordInterest(text, query), drill, confidence, resolvable, source: "keyword" };
    }
    return { interest: null, drill, confidence, resolvable, source: "unparsed" };
}
