/**
 * The checklist: turning the reviewer's question into the schema the whole run obeys.
 *
 * ## Why this file exists
 *
 * The walk used to ask every region the same thing — *"in 1-2 sentences describe the
 * tissue and whether it looks worth examining at higher magnification"* — and the user's
 * `query` was pasted into one clause of it. Nothing else consumed the query: not which
 * regions were visited, not the resolution rendered, not the fields returned, not the
 * ranking. So a run asked to find invasion never asked about invasion; it asked for a
 * description, got prose, kept the first sentence of it, and the answer to the actual
 * question was never anywhere in the pipeline to be lost.
 *
 * A checklist is a small set of NAMED features, each with the question to ask and the
 * resolution needed to answer it. It then drives five things: the answer schema, the
 * ladder, the drill rule (keep going while something is unassessable), the ranking, and
 * the report rows. One question, one path.
 *
 * ## Two rules that shape everything here
 *
 * **No clinical vocabulary in this module.** Feature ids and questions come from the
 * caller or from a model; nothing here enumerates pathology terms, because a list of
 * them would be wrong for the next stain, the next organ, and the next question, and
 * would rot in the source. The *mechanism* is generic; the *content* is per-query.
 *
 * **A derived checklist is untrusted input.** It is model-written text on its way into
 * another model's prompt, so {@link sanitizeChecklist} is a security control (AGENTS.md
 * §0.2/§7), not tidiness — bounded count, bounded lengths, no control characters, no
 * template punctuation, unknown keys dropped. It is applied twice: once where the
 * checklist is derived and again in the engine on anything a caller passes.
 */

/** One named thing the run is trying to establish about the tissue. */
export interface ChecklistFeature {
    /** Machine id, and the answer field name. `[a-z0-9_-]{1,32}`, unique in a checklist. */
    id: string;
    /** Row label for the report. */
    label: string;
    /** The question asked of each field. */
    question: string;
    /**
     * µm per pixel needed to answer it. Snapped to a ladder rung by the engine; a field
     * coarser than this records the feature as `not-assessable` WITHOUT a model call,
     * which is what makes the drill rule fire and the report honest.
     */
    requiredMpp: number;
    /** Ranking weight 0..1 (default 1) — how much this feature matters to the query. */
    weight?: number;
}

export interface Checklist {
    features: ChecklistFeature[];
    /**
     * `explicit` — the caller supplied it. `derived` — a model wrote it from the query.
     * `fallback` — no query, or derivation was unavailable; the generic checklist below.
     */
    source: "explicit" | "derived" | "fallback";
    query?: string;
    /** Stable hash of the normalized features; part of the analyze memo key. */
    hash: string;
}

/** One field's answer to one checklist feature. */
export interface FeatureAnswer {
    id: string;
    /** The model's own short statement, or null when it did not answer. */
    answer: string | null;
    /**
     * `not-assessable` is NOT a negative finding. It means this image at this resolution
     * cannot show the feature — a reason to look closer, and never a reason to report the
     * feature as absent. Conflating the two is the failure this whole schema exists to
     * prevent.
     */
    present: "yes" | "no" | "uncertain" | "not-assessable";
    confidence: "low" | "medium" | "high" | null;
    /** Why it was not assessable: the walk distinguishes "too coarse" from "model said so". */
    reason?: "resolution" | "model" | "unparsed";
}

export const MAX_CHECKLIST_FEATURES = 6;
const MAX_LABEL = 48;
const MAX_QUESTION = 160;
const MAX_ID = 32;
/** Bounds on a plausible slide resolution, in µm/px. */
const MPP_RANGE: [number, number] = [0.1, 8];

/**
 * Normalize and BOUND a checklist from any source.
 *
 * Everything about this is defensive. The count is capped so a chatty derivation cannot
 * make every vision call enormous; the strings are capped and stripped so nothing can
 * inject prompt structure (newlines, backticks, `${`) into the framing the engine wraps
 * them in; ids are slugged so a feature name can never be read as anything but a key;
 * unknown keys are dropped rather than carried; and `requiredMpp` is clamped into a range
 * a real slide could satisfy so a feature cannot demand a resolution that makes every
 * field unassessable forever.
 *
 * Note what is NOT validated: whether the questions are clinically sensible. That is not
 * knowable here and pretending otherwise would put a term list in this file.
 */
export function sanitizeChecklist(
    input: unknown,
    meta: { source: Checklist["source"]; query?: string }
): Checklist | null {
    const raw = Array.isArray(input)
        ? input
        : Array.isArray((input as any)?.features) ? (input as any).features : null;
    if (!raw) return null;

    const seen = new Set<string>();
    const features: ChecklistFeature[] = [];
    for (const entry of raw) {
        if (features.length >= MAX_CHECKLIST_FEATURES) break;
        if (!entry || typeof entry !== "object") continue;

        const e = entry as Record<string, unknown>;
        let id = String(e.id ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, MAX_ID);
        if (!id) id = `f${features.length + 1}`;
        // A duplicate id would silently overwrite an answer, losing a whole feature.
        if (seen.has(id)) {
            let n = 2;
            while (seen.has(`${id}-${n}`)) n++;
            id = `${id}-${n}`.slice(0, MAX_ID);
        }
        seen.add(id);

        const question = clean(e.question, MAX_QUESTION);
        if (!question) continue;

        features.push({
            id,
            label: clean(e.label, MAX_LABEL) || id,
            question,
            requiredMpp: clampNumber(e.requiredMpp, MPP_RANGE, 1.0),
            weight: clampNumber(e.weight, [0, 1], 1),
        });
    }

    if (!features.length) return null;
    return { features, source: meta.source, query: meta.query, hash: hashFeatures(features) };
}

/**
 * The checklist used when there is no query to derive one from, or no model to derive it.
 *
 * Deliberately vocabulary-free — it asks about the QUERY and about the image, never about
 * a named clinical feature. A generic checklist is worse than a derived one, which is why
 * the engine flags it in `warnings`; but it keeps the schema, the drill rule and the
 * evidence table working identically, so nothing downstream needs a second code path.
 */
export function fallbackChecklist(
    /**
     * Labels and questions, already translated by the caller. This module never calls
     * `$.t` itself — it is the pure layer, and a string resolved here would be resolved
     * at import time, before i18next exists.
     */
    strings: {
        matchLabel: string; match: string;
        extentLabel: string; extent: string;
        qualityLabel: string; quality: string;
    },
    query?: string
): Checklist {
    const features: ChecklistFeature[] = [
        { id: "match", label: strings.matchLabel, question: strings.match, requiredMpp: 1.0, weight: 1 },
        { id: "extent", label: strings.extentLabel, question: strings.extent, requiredMpp: 1.0, weight: 0.6 },
        { id: "quality", label: strings.qualityLabel, question: strings.quality, requiredMpp: 2.0, weight: 0.3 },
    ];
    return { features, source: "fallback", query, hash: hashFeatures(features) };
}

/**
 * Split a checklist by whether a field at `deliveredMpp` can actually answer each feature.
 *
 * The 10% slack absorbs rounding: a field delivered at 0.51 µm/px genuinely answers a
 * 0.5 µm/px feature, and failing it would drill forever chasing a rounding error.
 *
 * Deferred features are recorded as `not-assessable` with `reason: "resolution"` and cost
 * no model call at all — which is both the honest answer and the signal that makes the
 * walk go deeper.
 */
export function splitByResolution(
    checklist: Checklist,
    deliveredMpp: number | null,
    slack = 1.1
): { assessable: ChecklistFeature[]; deferred: ChecklistFeature[] } {
    // No calibration means no basis to defer on — ask everything and let the model judge.
    if (!deliveredMpp) return { assessable: checklist.features, deferred: [] };
    const assessable: ChecklistFeature[] = [];
    const deferred: ChecklistFeature[] = [];
    for (const f of checklist.features) {
        (f.requiredMpp * slack >= deliveredMpp ? assessable : deferred).push(f);
    }
    return { assessable, deferred };
}

/** An answer for a feature nobody could ask about at this resolution. */
export function unassessable(id: string, reason: FeatureAnswer["reason"]): FeatureAnswer {
    return { id, answer: null, present: "not-assessable", confidence: null, reason };
}

/** FNV-1a over the normalized features — a memo key, not a security digest. */
function hashFeatures(features: ChecklistFeature[]): string {
    const text = features
        .map(f => `${f.id}|${f.question}|${f.requiredMpp}|${f.weight ?? 1}`)
        .join("\n");
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
}

/**
 * A single-line, prompt-safe string.
 *
 * Newlines, backticks and `${` are removed because the engine interpolates these into a
 * fixed translated framing; a value carrying its own structure could break out of the
 * list item it is meant to be and read as an instruction instead of data.
 */
function clean(value: unknown, max: number): string {
    return String(value ?? "")
        // Control characters, including the newlines that would let a value escape
        // its list item and read as a line of instruction in its own right.
        .replace(/[ -]+/g, " ")
        // Template punctuation; neither backticks nor `${` belong in a question.
        .replace(/`|\$\{/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
}

function clampNumber(value: unknown, [lo, hi]: [number, number], fallback: number): number {
    const n = typeof value === "number" ? value : parseFloat(String(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
}
