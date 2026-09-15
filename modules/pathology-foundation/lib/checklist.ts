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

/**
 * Why a run is using the generic checklist instead of one derived from the question.
 *
 * `no-query` is the benign case and the only one that is the caller's to fix. The other three
 * are failures on this side, and telling them apart is the difference between "ask a more
 * specific question" (useless advice when the question was fine) and "the assistant model is
 * not reachable from here". Only ever set alongside `source: "fallback"`.
 */
export type ChecklistFallbackReason = "no-query" | "no-model" | "unparseable" | "error";

export interface Checklist {
    features: ChecklistFeature[];
    /**
     * `explicit` — the caller supplied it. `derived` — a model wrote it from the query.
     * `fallback` — no query, or derivation was unavailable; the generic checklist below.
     */
    source: "explicit" | "derived" | "fallback";
    /** Set with `source: "fallback"`: what stopped a real checklist from being derived. */
    fallbackReason?: ChecklistFallbackReason;
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
    /**
     * Why it was not assessable. These send a reader to four different next steps, so they
     * must not be collapsed:
     *
     * - `resolution` — the image was too coarse to show the feature. *Look closer.*
     * - `model` — the model saw the image and could not tell. *A real, if unhelpful, reading.*
     * - `unparsed` — the model replied, but not about this feature. *A prompt/parse problem.*
     * - `unread` — no image was ever produced (render failed or timed out). Nothing looked at
     *   anything. *Re-run.* Reporting this as `model` is how a rendering failure came back as a
     *   clinical non-answer and sent a user zooming in to fix a network problem.
     */
    reason?: "resolution" | "model" | "unparsed" | "unread";
    /**
     * The feature was asked at a resolution COARSER than its `requiredMpp`, because the
     * slide holds nothing finer.
     *
     * Set on an answer the model actually gave. The alternative — deferring the feature
     * because the stated requirement cannot be met — asks nobody and then reports the
     * silence as `not-assessable`, which manufactures a finding out of a resolution
     * figure. A real answer at the slide's limit is information; it just has to be read
     * knowing what it was formed at, which is what this flag says.
     */
    belowRequested?: boolean;
}

export const MAX_CHECKLIST_FEATURES = 6;
const MAX_LABEL = 48;
const MAX_QUESTION = 160;
const MAX_ID = 32;
/** Used when `requiredMpp` is absent or not a usable number at all. */
const DEFAULT_REQUIRED_MPP = 1.0;

/**
 * Normalize and BOUND a checklist from any source.
 *
 * Everything about this is defensive. The count is capped so a chatty derivation cannot
 * make every vision call enormous; the strings are capped and stripped so nothing can
 * inject prompt structure (newlines, backticks, `${`) into the framing the engine wraps
 * them in; ids are slugged so a feature name can never be read as anything but a key;
 * and unknown keys are dropped rather than carried.
 *
 * **`requiredMpp` is NOT clamped**, and used to be. A fixed `[0.1, 8]` range was applied
 * here with the stated purpose of stopping "a feature that demands a resolution that makes
 * every field unassessable forever" — which it could never do, because the range is not the
 * slide's. On a 20x scan (0.504 µm/px) a derived `0.25` for nuclear detail sailed through,
 * and every downstream stage then treated an impossible target as a live one: the ladder grew
 * a rung nothing could render, the drill gate never closed, and the feature was reported
 * `not-assessable` on every field of every run without any model ever being asked.
 *
 * A stated requirement is a true fact about the QUESTION. What the slide can deliver is a
 * separate fact about the SCAN. Rewriting the first to match the second destroys the
 * information needed to say "asked for 0.25, answered at 0.504" — so the requirement is kept
 * verbatim, and reconciling the two belongs to whoever knows the slide: see
 * {@link splitByResolution}, and `ladderRungs` for the render targets.
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
            // Kept as stated. Only a value that is not a positive finite number at all is
            // replaced — that is a parse failure, not a requirement.
            requiredMpp: positiveNumber(e.requiredMpp, DEFAULT_REQUIRED_MPP),
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
    query?: string,
    fallbackReason: ChecklistFallbackReason = query?.trim() ? "error" : "no-query"
): Checklist {
    const features: ChecklistFeature[] = [
        { id: "match", label: strings.matchLabel, question: strings.match, requiredMpp: 1.0, weight: 1 },
        { id: "extent", label: strings.extentLabel, question: strings.extent, requiredMpp: 1.0, weight: 0.6 },
        { id: "quality", label: strings.qualityLabel, question: strings.quality, requiredMpp: 2.0, weight: 0.3 },
    ];
    return { features, source: "fallback", fallbackReason, query, hash: hashFeatures(features) };
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
 *
 * **Deferring is only honest while a finer read is still coming.** Pass `nativeMpp` (the
 * slide's own calibration — level 0, the finest sampling that exists) and a feature whose
 * requirement is finer than the whole scan is asked ANYWAY, at the limit, rather than
 * deferred to a rung that will never arrive. Without it, a checklist asking for 0.25 µm/px
 * on a 0.504 µm/px slide produced `not-assessable` for that feature on every field of every
 * run — a verdict reached without a single model call, indistinguishable in the report from
 * a model that looked and could not tell. Those answers are marked `belowRequested` by the
 * caller so the difference stays legible.
 *
 * Omit `nativeMpp` and the behaviour is exactly as before.
 */
export function splitByResolution(
    checklist: Checklist,
    deliveredMpp: number | null,
    slack = 1.1,
    nativeMpp?: number | null
): { assessable: ChecklistFeature[]; deferred: ChecklistFeature[] } {
    // No calibration means no basis to defer on — ask everything and let the model judge.
    if (!deliveredMpp) return { assessable: checklist.features, deferred: [] };
    // Already reading at the slide's limit: nothing finer is reachable, so nothing can be
    // deferred TO. Ask the whole checklist.
    if (nativeMpp && nativeMpp > 0 && deliveredMpp <= nativeMpp * slack) {
        return { assessable: checklist.features, deferred: [] };
    }
    const assessable: ChecklistFeature[] = [];
    const deferred: ChecklistFeature[] = [];
    for (const f of checklist.features) {
        (f.requiredMpp * slack >= deliveredMpp ? assessable : deferred).push(f);
    }
    return { assessable, deferred };
}

/**
 * True when this feature's stated requirement is finer than the scan itself holds.
 *
 * A property of the (feature, slide) pair, not of any one field — which is what makes it
 * reportable once per run instead of once per region, and what distinguishes "we never got
 * close enough" (go look closer) from "this scan does not contain that detail" (nothing to
 * go and do).
 */
export function exceedsSlide(
    feature: ChecklistFeature,
    nativeMpp: number | null | undefined,
    slack = 1.1
): boolean {
    if (!nativeMpp || !(nativeMpp > 0)) return false;
    return feature.requiredMpp * slack < nativeMpp;
}

/** An answer for a feature nobody could ask about at this resolution. */
export function unassessable(id: string, reason: FeatureAnswer["reason"]): FeatureAnswer {
    return { id, answer: null, present: "not-assessable", confidence: null, reason };
}

/**
 * Flag the answers that were produced coarser than their feature asked for.
 *
 * Mutates in place, because the caller has just built the map and the alternative is a copy
 * of every answer on every field of every run. Only touches features it was given, and only
 * when the comparison is meaningful — an uncalibrated field flags nothing.
 */
export function markBelowRequested(
    answers: Record<string, FeatureAnswer>,
    asked: readonly ChecklistFeature[],
    deliveredMpp: number | null,
    slack = 1.1
): void {
    if (!deliveredMpp || !(deliveredMpp > 0)) return;
    for (const f of asked) {
        const answer = answers[f.id];
        if (!answer) continue;
        if (f.requiredMpp * slack < deliveredMpp) answer.belowRequested = true;
    }
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

/** A positive finite number, or `fallback` when the value is not one. No upper bound. */
function positiveNumber(value: unknown, fallback: number): number {
    const n = typeof value === "number" ? value : parseFloat(String(value));
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clampNumber(value: unknown, [lo, hi]: [number, number], fallback: number): number {
    const n = typeof value === "number" ? value : parseFloat(String(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
}
