/**
 * Reading a vision model's per-feature answers back out of whatever it actually emitted.
 *
 * Two properties matter more than anything else here.
 *
 * **`not-assessable` must never collapse to `no`.** "I cannot see that at this
 * resolution" and "that is not present" are opposite conclusions, and conflating them is
 * precisely how a run reports a feature as absent when nobody ever looked at it closely
 * enough to say. Every fallback path in this file resolves to `not-assessable`, never to
 * a negative.
 *
 * **The vocabulary is the checklist's, not this file's.** The line-form matcher is built
 * FROM the feature ids and labels at call time, so the parser works for any question
 * anyone ever asks without a clinical term appearing in the source.
 *
 * Nothing here throws. A model that ignores the contract entirely still produces a
 * well-formed, honest result: every feature unassessable, `reason: "unparsed"`, and
 * `interest: null` — unknown, not zero.
 */

import type { Checklist, ChecklistFeature, FeatureAnswer } from "./checklist";
import { unassessable } from "./checklist";
import { axis, isTemplateEcho, keywordInterest, normalizeScore } from "./verdict";
import type { OverviewVerdict } from "./verdict";

export interface ParsedAnswers {
    /** Keyed by feature id; ALWAYS holds an entry for every feature in the checklist. */
    answers: Record<string, FeatureAnswer>;
    verdict: OverviewVerdict;
    /** The model's text with any machine block removed — what a human would read. */
    prose: string;
    /** How the answers were recovered, for diagnostics and for the repair decision. */
    parsed: "json" | "lines" | "none";
}

const PRESENCE: Record<string, FeatureAnswer["present"]> = {
    yes: "yes", y: "yes", true: "yes", present: "yes",
    no: "no", n: "no", false: "no", absent: "no",
    uncertain: "uncertain", unsure: "uncertain", equivocal: "uncertain", maybe: "uncertain",
    "not-assessable": "not-assessable", "not assessable": "not-assessable",
    na: "not-assessable", "n/a": "not-assessable", unassessable: "not-assessable",
};

const CONFIDENCE = new Set(["low", "medium", "high"]);

/**
 * Parse `text` against `checklist`, trying the strict form first and degrading in order.
 *
 * The dual JSON/line path is not belt-and-braces: a small vision model asked for JSON
 * produces a fenced object most of the time and `id: yes` lines the rest of the time, and
 * insisting on one of them means discarding a real answer for a formatting miss. Both are
 * cheap; a re-ask is not.
 */
export function parseFieldAnswers(
    text: string | null | undefined,
    checklist: Checklist,
    query?: string
): ParsedAnswers {
    const features = checklist.features;
    if (!text || typeof text !== "string") {
        return {
            answers: allUnassessable(features, "unparsed"),
            verdict: emptyVerdict(),
            prose: "",
            parsed: "none",
        };
    }

    const json = parseJsonForm(text, features);
    const answers = json.answers ?? parseLineForm(text, features).answers;
    const parsed: ParsedAnswers["parsed"] = json.answers ? "json" : (answers ? "lines" : "none");

    const resolved = answers ?? allUnassessable(features, "unparsed");
    // Missing ids in an otherwise successful parse: the model answered, just not about
    // this feature. That is the model's silence, not a parse failure — and still not a "no".
    for (const f of features) {
        if (!resolved[f.id]) resolved[f.id] = unassessable(f.id, parsed === "none" ? "unparsed" : "model");
    }

    return {
        answers: resolved,
        verdict: deriveVerdict(text, resolved, checklist, query),
        // Strip unconditionally. `parseJsonForm` removes the JSON block it consumed but
        // knows nothing about a SCORE line the model volunteered alongside it — and
        // whatever the parser ate must not also be handed back as prose, or the machine
        // line is read to the user as if it were a finding.
        prose: stripMachineBlock(json.prose ?? text),
        parsed,
    };
}

/**
 * Interest derived from the answers themselves, weighted by how much each feature matters.
 *
 * This is what removes most of the need for a separate SCORE line — and with it most of
 * the repair calls the old contract spent budget on. An explicit score still wins when the
 * model volunteers one, because a model that scored itself has said something the answers
 * alone do not capture.
 *
 * Only ASSESSABLE features count. A field where nothing could be judged scores `null`
 * (unknown), never 0 — a 0 would mean "looked and found nothing", which would rank an
 * unreadable region below a genuinely dull one and guarantee it is never revisited.
 */
export function deriveVerdict(
    text: string,
    answers: Record<string, FeatureAnswer>,
    checklist: Checklist,
    query?: string
): OverviewVerdict {
    const confidences = checklist.features
        .map(f => answers[f.id]?.confidence)
        .filter((c): c is "low" | "medium" | "high" => !!c);

    const scored = checklist.features.filter(f => answers[f.id]?.present !== "not-assessable");
    const weightOf = (f: ChecklistFeature) => (f.weight == null ? 1 : f.weight);
    const valueOf = (p: FeatureAnswer["present"]) => (p === "yes" ? 1 : p === "uncertain" ? 0.5 : 0);

    let interest: number | null = null;
    let source: OverviewVerdict["source"] = "unparsed";
    let scoreScale: number | undefined;

    const explicit = readScore(text);
    if (explicit) {
        interest = explicit.interest;
        source = explicit.scale === 1 ? "contract" : "normalized";
        if (explicit.scale !== 1) scoreScale = explicit.scale;
    } else if (scored.length) {
        const total = scored.reduce((s, f) => s + weightOf(f), 0);
        interest = total > 0
            ? scored.reduce((s, f) => s + weightOf(f) * valueOf(answers[f.id].present), 0) / total
            : null;
        source = "contract";
    } else if (query) {
        // Nothing was assessable and no score was given, but the model did write prose.
        // Word overlap with the query is a weak signal — it is marked as such via
        // `source` — and it is still better than discarding the node's text entirely.
        const overlap = keywordInterest(text, query);
        if (overlap > 0) { interest = overlap; source = "keyword"; }
    }

    return {
        interest,
        // The old contract's own axes, still honoured when volunteered. `drill` is no
        // longer asked for: the walk decides that from the resolution gaps, which is a
        // fact about the image rather than an opinion the model has to be trusted on.
        drill: /DRILL\s*[:=]\s*[^a-z]*\s*(yes|true)/i.test(text),
        confidence: aggregateConfidence(confidences),
        resolvable: scored.length ? true : (checklist.features.length ? false : null),
        source,
        ...(scoreScale ? { scoreScale } : {}),
    };
}

/** JSON object keyed by feature id, from the last fence or the last balanced block. */
function parseJsonForm(
    text: string,
    features: ChecklistFeature[]
): { answers: Record<string, FeatureAnswer> | null; prose?: string } {
    const block = lastJsonBlock(text);
    if (!block) return { answers: null };

    let data: any;
    try {
        data = JSON.parse(block.body);
    } catch {
        return { answers: null };
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return { answers: null };

    // Ids are matched case-insensitively: a model that title-cases a key has still
    // answered the question, and rejecting it would be a formatting technicality.
    const byLowerId = new Map(features.map(f => [f.id.toLowerCase(), f]));
    const out: Record<string, FeatureAnswer> = {};
    let matched = 0;
    for (const [key, value] of Object.entries(data)) {
        const feature = byLowerId.get(String(key).toLowerCase().trim());
        if (!feature) continue; // unknown ids are dropped, never carried through
        const answer = readEntry(feature.id, value);
        if (answer) { out[feature.id] = answer; matched++; }
    }
    if (!matched) return { answers: null };
    return { answers: out, prose: (text.slice(0, block.start) + text.slice(block.end)).trim() };
}

/** `<id>: yes — short note` lines, with the id set built from the checklist itself. */
function parseLineForm(
    text: string,
    features: ChecklistFeature[]
): { answers: Record<string, FeatureAnswer> | null } {
    const keys = features.flatMap(f => [f.id, f.label].filter(Boolean).map(escapeRegExp));
    if (!keys.length) return { answers: null };
    const byKey = new Map<string, ChecklistFeature>();
    for (const f of features) {
        byKey.set(f.id.toLowerCase(), f);
        if (f.label) byKey.set(f.label.toLowerCase(), f);
    }

    const re = new RegExp(
        `^\\s*[-*\`"'\\s]*(${keys.join("|")})[\`"'*]*\\s*[:=]\\s*[\`"'*<\\[(]*\\s*` +
        `(yes|no|uncertain|unsure|equivocal|maybe|not[- ]assessable|unassessable|n\\/?a|present|absent)\\b(.*)$`,
        "gim"
    );

    const out: Record<string, FeatureAnswer> = {};
    let matched = 0;
    for (const m of text.matchAll(re)) {
        const feature = byKey.get(m[1].toLowerCase().trim());
        if (!feature || out[feature.id]) continue;
        const rest = (m[3] || "").trim().replace(/^[-–—:,.\s]+/, "");
        out[feature.id] = {
            id: feature.id,
            answer: rest ? rest.replace(/[`"'*]+/g, "").trim().slice(0, 300) || null : null,
            present: PRESENCE[m[2].toLowerCase().replace(/\s+/g, "-")] ?? "uncertain",
            confidence: readInlineConfidence(rest),
        };
        matched++;
    }
    return { answers: matched ? out : null };
}

/** One JSON value for one feature: the `{a, p, c}` object or the bare shorthand. */
function readEntry(id: string, value: unknown): FeatureAnswer | null {
    if (typeof value === "string") {
        const present = PRESENCE[value.toLowerCase().trim().replace(/\s+/g, "-")];
        return present ? { id, answer: null, present, confidence: null } : null;
    }
    if (!value || typeof value !== "object") return null;

    const v = value as Record<string, unknown>;
    const rawPresent = String(v.p ?? v.present ?? "").toLowerCase().trim().replace(/\s+/g, "-");
    const present = PRESENCE[rawPresent];
    if (!present) return null;

    const rawConfidence = String(v.c ?? v.confidence ?? "").toLowerCase().trim();
    const answer = String(v.a ?? v.answer ?? "").trim();
    return {
        id,
        answer: answer ? answer.slice(0, 300) : null,
        present,
        confidence: CONFIDENCE.has(rawConfidence) ? (rawConfidence as FeatureAnswer["confidence"]) : null,
    };
}

/**
 * The most conservative confidence stated across the answered features.
 *
 * A node is only as trustworthy as its weakest answer, and taking the mean would let four
 * confident trivia outvote one low-confidence answer about the thing being asked.
 */
function aggregateConfidence(values: Array<"low" | "medium" | "high">): FeatureAnswer["confidence"] {
    if (!values.length) return null;
    if (values.includes("low")) return "low";
    if (values.includes("medium")) return "medium";
    return "high";
}

function readScore(text: string): { interest: number; scale: number } | null {
    if (isTemplateEcho(text)) return null;
    // The SAME pattern the verdict parser uses. A second hand-written decoration class
    // here is how `~~SCORE~~` came to be readable by one path and not the other.
    const m = text.match(new RegExp(`${axis("SCORE", "[0-9]*\\.?[0-9]+").source}\\s*(?:\\/\\s*([0-9]+))?`, "i"));
    if (!m) return null;
    const raw = parseFloat(m[1]);
    if (!Number.isFinite(raw)) return null;
    return normalizeScore(raw, m[2] ? parseFloat(m[2]) : null);
}

function readInlineConfidence(text: string): FeatureAnswer["confidence"] {
    const m = text.match(/\b(low|medium|high)\b/i);
    return m ? (m[1].toLowerCase() as FeatureAnswer["confidence"]) : null;
}

/** The last ```json fence, else the last balanced `{...}` — models put it at the end. */
function lastJsonBlock(text: string): { body: string; start: number; end: number } | null {
    const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
    if (fences.length) {
        const f = fences[fences.length - 1];
        return { body: f[1], start: f.index!, end: f.index! + f[0].length };
    }
    const close = text.lastIndexOf("}");
    if (close < 0) return null;
    let depth = 0;
    for (let i = close; i >= 0; i--) {
        if (text[i] === "}") depth++;
        else if (text[i] === "{" && --depth === 0) {
            return { body: text.slice(i, close + 1), start: i, end: close + 1 };
        }
    }
    return null;
}

/**
 * One answer per feature across several fields.
 *
 * Asymmetric on purpose: any positive wins. The fields are a SAMPLE of a region, so one field
 * showing a feature is evidence it is there, while several not showing it is not proof it is not.
 *
 * When nothing was assessable the REASON is what survives, because each one sends the reader to
 * a different next step and there is no way to recover it from `present` alone. Ordered by how
 * actionable it is, not by how many fields voted for it: one field that WAS read and came back
 * too coarse tells a reader more than three that never rendered.
 *
 * `unread` outranking `model` is the fix for a specific failure: a field whose render failed
 * still contributed answers, so the "did any field answer?" test saw a non-empty set and
 * reported `model` — "the model looked and could not tell" — about images that were never
 * produced. The advice that follows from that is to look closer, which cannot help, and the
 * user is sent round a loop with no exit.
 */
export function aggregateFeatureAnswers(
    fields: Array<{ answers: FeatureAnswer[] }>,
    features: ChecklistFeature[]
): FeatureAnswer[] {
    return features.map(feature => {
        const seen = fields
            .map(f => f.answers.find(a => a.id === feature.id))
            .filter((a): a is FeatureAnswer => !!a);
        const pick = (p: FeatureAnswer["present"]) => seen.find(a => a.present === p);
        const winner = pick("yes") || pick("uncertain") || pick("no");
        if (winner) return { ...winner, id: feature.id };
        for (const reason of ["resolution", "unread", "model"] as const) {
            if (seen.some(a => a.reason === reason)) return unassessable(feature.id, reason);
        }
        return unassessable(feature.id, "unparsed");
    });
}

function stripMachineBlock(text: string): string {
    return text
        .replace(/```(?:json)?[\s\S]*?```/gi, "")
        // Same decoration tolerance as the reader: a SCORE line the parser consumed but
        // this missed would be left in the prose and read back to the user as a finding.
        .replace(new RegExp(`^[\\s*_\`"'~]*SCORE[\\s*_\`"'~]*[:=].*$`, "gim"), "")
        .trim();
}

function allUnassessable(
    features: ChecklistFeature[],
    reason: FeatureAnswer["reason"]
): Record<string, FeatureAnswer> {
    const out: Record<string, FeatureAnswer> = {};
    for (const f of features) out[f.id] = unassessable(f.id, reason);
    return out;
}

function emptyVerdict(): OverviewVerdict {
    return { interest: null, drill: false, confidence: null, resolvable: null, source: "unparsed" };
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
