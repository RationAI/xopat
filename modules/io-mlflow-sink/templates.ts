/// <reference path="../../src/types/globals.d.ts" />

// Mapper layer — the ONLY place that decides what an xOpat record looks like
// once it lands in MLflow. A mapper shapes structure: which experiment, which
// run, which tags/metrics/params/artifacts. It can never choose an endpoint,
// a proxy alias or an auth block — those are trusted deployment config read by
// the sink itself (see mlflow-sink.ts). A mapper's chosen experiment is still
// validated against the static `experimentAllow` before any dispatch.
//
// Records reaching a mapper are owner-defined and therefore untrusted: treat
// every field as adversarial and coerce rather than assume.

export type KV = { key: string; value: string };

export type MlflowMapping = {
    /** Experiment to write into. Validated against `experimentAllow`. */
    experiment: string;
    run: {
        /** Run name for a newly created run. */
        name?: string;
        /** Tag identifying the run to reuse; the sink's getOrCreateRunByTag key. */
        identifierTag: KV;
        /** Extra tags applied only when the run is created. */
        extraTags?: KV[];
    };
    metrics?: Array<{ key: string; value: number; step?: number; timestamp?: number }>;
    params?: KV[];
    tags?: KV[];
    artifacts?: Array<{ path: string; bytes: Uint8Array | string; contentType?: string }>;
};

/**
 * Shapes one record (CRUD) or one whole payload (bundle) into MLflow terms.
 * Return `null` to decline — the sink then reports a clean skip rather than a
 * refusal, so a mapper can ignore records it does not understand.
 */
export type MlflowMapper = (ctx: IOContext, item: unknown, options: MapperOptions) => MlflowMapping | null;

/** The resolved sink config a mapper may read. Deliberately excludes proxy/baseURL/auth. */
export type MapperOptions = {
    experimentTemplate: string;
    runTemplate: string;
    identifierTag: string;
};

/** Interpolates the IOContext placeholder set shared with the github sink. */
export function interpolate(tmpl: string, ctx: IOContext): string {
    return String(tmpl).replace(/\{(\w+)\}/g, (_, key: string) => {
        switch (key) {
            case "ownerId":      return ctx.ownerId;
            case "ownerUid":     return ctx.ownerUid;
            case "viewerId":     return ctx.viewerId ?? "_global";
            case "backgroundId": return ctx.backgroundId ?? "_any";
            case "capabilityId": return ctx.capabilityId;
            case "xoType":       return ctx.xoType;
            case "resourceName": return ctx.resourceName ?? "";
            case "itemId":       return ctx.itemId ?? "";
            default:             return "";
        }
    });
}

/**
 * Metric/param/tag keys must match the character set RunsAPI.logMetric enforces —
 * we build log-batch payloads by hand, which bypasses that call's own sanitization.
 * Reuses the mlflow module's helper (exposed on the `MlFlow` global) rather than
 * repeating the regex, so the two can never drift apart.
 */
const sanitizeKey = (s: unknown): string => {
    const util = (globalThis as any).MlFlow?.Utils?.sanitizeMetricKey;
    if (!util) throw new Error("The mlflow module is not loaded; io-mlflow-sink requires it.");
    return util(s);
};

/** Best-effort numeric coercion. Returns undefined when the record carries no number. */
function toNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return undefined;
}

/** The subset of a scoring record the built-in templates understand. */
type ScoreLike = {
    slideId?: unknown;
    scoreKey?: unknown;
    value?: unknown;
    label?: unknown;
    step?: unknown;
    ts?: unknown;
    author?: unknown;
};

const asScore = (item: unknown): ScoreLike => (item && typeof item === "object" ? item as ScoreLike : {});

/** Identity of the thing being scored. Slide first, then the slot, then the item. */
function subjectOf(ctx: IOContext, s: ScoreLike): string {
    const slide = s.slideId;
    if (typeof slide === "string" && slide) return slide;
    if (typeof slide === "number") return String(slide);
    return ctx.backgroundId ?? ctx.itemId ?? "_unknown";
}

function scoreKeyOf(s: ScoreLike): string {
    return typeof s.scoreKey === "string" && s.scoreKey ? s.scoreKey : "score";
}

/** Tags every mapping carries so runs are traceable back to xOpat. */
function provenanceTags(ctx: IOContext, s: ScoreLike): KV[] {
    const tags: KV[] = [
        { key: "source", value: "xopat" },
        { key: "xopat.owner", value: ctx.ownerId },
        { key: "xopat.capability", value: ctx.capabilityId },
    ];
    if (typeof s.author === "string" && s.author) tags.push({ key: "xopat.author", value: s.author });
    return tags;
}

/**
 * `slide-scoring` — one run per scored subject (slide), score as a metric plus
 * a human-readable tag. The layout the original mlflow-annotations-slide plugin
 * produced, minus its duplicated run bookkeeping.
 */
const slideScoring: MlflowMapper = (ctx, item, o) => {
    const s = asScore(item);
    const subject = subjectOf(ctx, s);
    const key = scoreKeyOf(s);
    const value = toNumber(s.value);
    if (value === undefined) return null; // not a numeric score — decline cleanly

    return {
        experiment: interpolate(o.experimentTemplate, ctx),
        run: {
            name: `xopat-${subject}`,
            identifierTag: { key: o.identifierTag, value: subject },
            extraTags: provenanceTags(ctx, s),
        },
        metrics: [{ key: sanitizeKey(`${key}`), value, timestamp: toNumber(s.ts) }],
        tags: [{ key: sanitizeKey(`${key}.label`), value: String(s.label ?? value) }],
    };
};

/**
 * `run-per-viewer` — one run per viewer, scores appended as stepped metrics.
 * For time-series scoring where the history matters more than the latest value.
 */
const runPerViewer: MlflowMapper = (ctx, item, o) => {
    const s = asScore(item);
    const value = toNumber(s.value);
    if (value === undefined) return null;
    const viewerId = ctx.viewerId ?? "_global";

    return {
        experiment: interpolate(o.experimentTemplate, ctx),
        run: {
            name: interpolate(o.runTemplate, ctx),
            identifierTag: { key: o.identifierTag, value: viewerId },
            extraTags: provenanceTags(ctx, s),
        },
        metrics: [{
            key: sanitizeKey(`${scoreKeyOf(s)}.${subjectOf(ctx, s)}`),
            value,
            step: toNumber(s.step) ?? 0,
            timestamp: toNumber(s.ts),
        }],
    };
};

/**
 * `run-per-session` — a single run per owner, records written as params.
 * Audit-log shaped: params are write-once in MLflow, so a re-scored subject
 * lands as a new param key rather than overwriting the old value.
 */
const runPerSession: MlflowMapper = (ctx, item, o) => {
    const s = asScore(item);
    const value = toNumber(s.value);
    if (value === undefined) return null;
    const stamp = toNumber(s.ts);

    return {
        experiment: interpolate(o.experimentTemplate, ctx),
        run: {
            name: `xopat-${ctx.ownerId}`,
            identifierTag: { key: o.identifierTag, value: ctx.ownerId },
            extraTags: provenanceTags(ctx, s),
        },
        params: [{
            key: sanitizeKey(`${subjectOf(ctx, s)}.${scoreKeyOf(s)}${stamp ? `.${stamp}` : ""}`),
            value: String(s.label ?? value),
        }],
    };
};

/**
 * `bundle-artifact` — the whole payload as one JSON artifact. Requires an
 * `artifacts` block in the sink config; without it the sink refuses with
 * W_MLFLOW_NO_ARTIFACTS rather than silently dropping the bundle.
 */
const bundleArtifact: MlflowMapper = (ctx, item, o) => {
    const text = typeof item === "string" ? item : JSON.stringify(item ?? null);
    const slot = ctx.key || interpolate("{viewerId}", ctx);

    return {
        experiment: interpolate(o.experimentTemplate, ctx),
        run: {
            name: interpolate(o.runTemplate, ctx),
            identifierTag: { key: o.identifierTag, value: ctx.viewerId ?? "_global" },
            extraTags: provenanceTags(ctx, asScore(item)),
        },
        tags: [{ key: sanitizeKey(`xopat.bundle.${slot}`), value: `${text.length} bytes` }],
        artifacts: [{
            path: `xopat/${sanitizeKey(slot)}.json`,
            bytes: text,
            contentType: "application/json",
        }],
    };
};

export const BUILT_IN_TEMPLATES: Record<string, MlflowMapper> = {
    "slide-scoring": slideScoring,
    "run-per-viewer": runPerViewer,
    "run-per-session": runPerSession,
    "bundle-artifact": bundleArtifact,
};

export const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
    "slide-scoring":
        "One run per scored slide (identified by the configured identifier tag). The score lands as a metric plus a readable label tag.",
    "run-per-viewer":
        "One run per viewer. Scores append as stepped metrics — use when the scoring history matters, not just the latest value.",
    "run-per-session":
        "A single run per owner. Scores land as write-once params — audit-log shaped.",
    "bundle-artifact":
        "The whole bundle as one JSON artifact on a per-viewer run. Requires an artifacts block in the sink config.",
};

export const DEFAULT_TEMPLATE = "slide-scoring";
