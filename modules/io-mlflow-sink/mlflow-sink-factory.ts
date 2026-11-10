/// <reference path="../../src/types/globals.d.ts" />

// `mlflow` sink — MLflow-backed bundle + CRUD sink.
//
// Dispatches are shaped by a *mapper* (see templates.ts): the mapper decides
// experiment/run/tags/metrics, the sink decides nothing about structure and
// everything about transport. That split is what keeps the security boundary
// clean — `proxy`, `baseURL` and `auth` are read here from trusted deployment
// config only, and a mapper can never influence them.
//
// All HTTP goes through the mlflow module's client, which goes through
// xOpat's HttpClient and (in any real deployment) a server-side proxy alias
// that injects the MLflow credential. No token ever reaches the browser.
//
// Options are composed by the owning module (mlflow-sink.ts) from hardcoded
// defaults + include.json + ENV.client.io.sinkOverrides.mlflow, and read
// lazily on every dispatch so admin re-config needs no re-registration.

import {
    DEFAULT_TEMPLATE,
    interpolate,
    sanitizeArtifactPath,
    type KV,
    type MlflowMapper,
    type MlflowMapping,
    type MapperOptions,
} from "./templates";

export type MlflowSinkConfig = {
    /** Server proxy alias holding the MLflow credential. Trusted config only. */
    proxy?: string;
    /** REST base, joined with the proxy's upstream baseUrl. Trusted config only. */
    baseURL?: string;
    /** Forwarded to HttpClient — the *viewer's* token for the proxy's verifier chain. */
    auth?: Record<string, unknown>;
    /** Name of the mapper template to use. Overridden by a registered mapper. */
    template?: string;
    /**
     * Placeholders, resolved by `IO_PIPELINE.formatPath` (the same set every
     * sink uses): {ownerId} {ownerUid} {xoType} {direction} {capabilityId}
     * {capabilityGroup} {viewerId} {backgroundId} {key} {resourceName}
     * {itemId}. Substituted values are reduced to `[A-Za-z0-9._-]`.
     *
     * Prefer {capabilityGroup} over {capabilityId} for anything that must
     * address the same run on both write and read — the latter differs
     * between `bundle-export` and `bundle-import`.
     */
    experimentTemplate?: string;
    runTemplate?: string;
    /** Tag key used to find/reuse a run. */
    identifierTag?: string;
    /**
     * Allowlist of experiment name patterns a mapper may target (`*` wildcard).
     * `null`/absent = unrestricted. Trusted config only — this is the bound on
     * what dynamic mappers can reach.
     */
    experimentAllow?: string[] | null;
    /**
     * Allowlist of run-name patterns (`*` wildcard). `null`/absent =
     * unrestricted. The experiment allowlist alone is not a complete bound:
     * run names and the run identifier tag come from the mapper too, and the
     * built-in mappers derive them from `ctx.viewerId` / `ctx.ownerId`, which
     * a session config can influence.
     */
    runAllow?: string[] | null;
    /**
     * Required prefix for every mapper-emitted artifact path. `null`/absent =
     * unrestricted. Artifact paths land in an upload URL; a third-party
     * mapper registered via `registerMapper` is not obliged to sanitize.
     */
    artifactPathPrefix?: string | null;
    /** Artifacts adapter config, forwarded to MlFlowClient. */
    artifacts?: Record<string, unknown> | null;
    /**
     * Whether a session may pick the experiment/run (see {@link MlflowSessionTarget}).
     * Trusted config only — the operator decides if the session's choice is read.
     *   - absent/`null`: a session target is ignored; templates decide.
     *   - `"allowed"`:   a session target, when present, replaces the mapped experiment/run.
     *   - `"required"`:  as `"allowed"`, and without a target the sink declines every dispatch.
     * The chosen names are still bounded by `experimentAllow` / `runAllow`, and a
     * session target is only ever honoured when `experimentAllow` is configured:
     * without it a hostile session could route data to any experiment.
     */
    sessionTarget?: "allowed" | "required" | null;
};

/**
 * Where a session asks its data to land. Comes from `params.mlflowTarget` or
 * `setTarget()`, i.e. untrusted input: it only names a destination inside the
 * deployment's allowlists, never an endpoint.
 */
export type MlflowSessionTarget = {
    /**
     * Experiment name. Created on first write if missing. May carry the shared
     * placeholders (`{backgroundId}`, `{viewerId}`, `{ownerId}`, ...), resolved per
     * dispatch and sanitized before the allowlist sees the result.
     */
    experiment: string;
    /**
     * Run name, placeholders as above (`"review-{backgroundId}"` = one run per slide).
     * Matched against MLflow's own `mlflow.runName` tag, so an existing run of that
     * name is reused (also one created outside xOpat); created if missing.
     * Absent: the template's run layout applies inside the chosen experiment.
     */
    run?: string;
};

/** MLflow caps experiment and run names well above this; longer input is a mistake, not a name. */
const MAX_TARGET_NAME = 250;
// eslint-disable-next-line no-control-regex
const TARGET_CTRL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
/**
 * Characters a session-chosen name may contain. Braces carry placeholders and are
 * resolved (and re-checked) per dispatch. Quotes, backslashes and backticks are
 * out: the run name ends up inside an MLflow search filter, and a name that needs
 * them is far more likely an injection attempt than a real experiment.
 */
const TARGET_NAME_CHARS = /^[A-Za-z0-9 ._\-/:{}]+$/;

/**
 * Untrusted input → a target, or `undefined`. Names are trimmed, stripped of
 * control characters, length-capped and charset-bound (see TARGET_NAME_CHARS);
 * anything else is rejected rather than coerced. The allowlists, not this
 * function, decide where writes may go — and they judge the name only after its
 * placeholders are resolved, per dispatch, in the sink.
 */
export function normalizeTarget(raw: unknown): MlflowSessionTarget | undefined {
    if (typeof raw === "string") {
        try { raw = JSON.parse(raw); } catch { return undefined; }
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const name = (v: unknown): string | undefined => {
        if (typeof v !== "string") return undefined;
        const s = v.replace(TARGET_CTRL_CHARS, "").trim();
        return s && s.length <= MAX_TARGET_NAME && TARGET_NAME_CHARS.test(s) ? s : undefined;
    };
    const r = raw as Record<string, unknown>;
    const experiment = name(r.experiment);
    if (!experiment) return undefined;
    if (r.run !== undefined && r.run !== null && !name(r.run)) return undefined;
    const run = name(r.run);
    return run ? { experiment, run } : { experiment };
}

/** Tag MLflow sets on every named run; a session-selected run is found by it. */
const RUN_NAME_TAG = "mlflow.runName";

export interface MlflowSinkOptions {
    id?: string;
    label?: string;
    /** Lazy getter for the fully-composed sink config. */
    getOptions: (ctx?: IOContext) => MlflowSinkConfig;
    /** Resolves the mapper for a dispatch: registered mapper first, then template name. */
    getMapper: (name: string) => MlflowMapper | undefined;
    /** Optional fine-grained gate, composed with the built-in config check. */
    accepts?: (ctx: IOContext) => boolean;
    /** The session's destination choice, if any. Read only when `sessionTarget` allows it. */
    getTarget?: () => MlflowSessionTarget | undefined;
}

/**
 * The module's locale bundle is registered under its id as the i18next
 * namespace (`addResourceBundle(locale, id, json)`), so every lookup must carry
 * `ns`. Spelling the id into the key instead would miss the bundle and silently
 * return the key's last segment, because `$.t` never fails.
 */
const t = (key: string, options: Record<string, unknown> = {}): string =>
    $.t(key, { ...options, ns: "io-mlflow-sink" });

function fail(reason: string, code: string, userMessage?: string): IOResult {
    return userMessage
        ? { ok: false, refused: true, reason, code, userMessage }
        : { ok: false, refused: true, reason, code };
}

function classifyHttpError(e: any): IOResult {
    const status: number = e?.statusCode ?? 0;
    const reason: string = e?.message ?? String(e);
    if (status === 401 || status === 403) {
        return fail(reason, "W_MLFLOW_AUTH",
            t("error.auth"));
    }
    if (status === 404) {
        return fail(reason, "W_MLFLOW_NOT_FOUND",
            t("error.notFound"));
    }
    // The catch-all covers both "the host is down" (status 0) and every
    // unmapped status, which are different problems with different fixes. The
    // message said neither, so the only way to tell them apart was the Network
    // tab. Carry the status; `reason` keeps the upstream's own text.
    return fail(reason, `W_MLFLOW_HTTP_${status || "UNKNOWN"}`,
        status ? t("error.httpStatus", { status }) : t("error.http"));
}

/**
 * Anchored glob (`*` = any run of characters). Prefers the core helper so
 * every allowlist in xOpat speaks one dialect; the local fallback keeps this
 * module working against a core predating `IO_PIPELINE.matchesPattern`.
 *
 * The previous implementation smuggled `*` past the escaper as a NUL
 * sentinel, which put a literal NUL byte in this source file — git then
 * treated it as binary and stopped producing diffs for it.
 */
function matchesPattern(value: string, pattern: string): boolean {
    const pipeline = (globalThis as any).IO_PIPELINE;
    if (typeof pipeline?.matchesPattern === "function") {
        return pipeline.matchesPattern(value, [pattern]);
    }
    const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(value);
}

/**
 * Build the MLflow search filter that finds a run by its identifier tag.
 * Delegates to the mlflow module's `Utils.buildTagFilter` (which `getOrCreateRunByTag`
 * uses too), so lookup and creation can never disagree on escaping.
 *
 * Both halves are mapper output, so both are untrusted. The key was
 * previously spliced in raw — a mapper deriving it from `ctx` could break out
 * of the expression and read other runs — and the value carried a naive
 * `"`-escape that a trailing backslash defeats. The key goes through the same
 * charset helper the log-batch payloads use; the value is escaped backslash
 * first, then quote, which is the only order that composes.
 */
function buildTagFilter(tag: KV): string {
    const MlFlow = (globalThis as any).MlFlow;
    if (typeof MlFlow?.Utils?.buildTagFilter === "function") {
        return MlFlow.Utils.buildTagFilter(tag.key, tag.value);
    }
    // Fallback for an mlflow module predating Utils.buildTagFilter.
    const key = MlFlow?.Utils?.sanitizeMetricKey
        ? MlFlow.Utils.sanitizeMetricKey(tag.key)
        : String(tag.key).replace(/[^A-Za-z0-9._\- /]/g, "_");
    const value = String(tag.value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `tags.\`${key}\` = "${value}"`;
}

let unboundedWarned = false;
/**
 * `experimentAllow` defaults to `null` (allow-all), so a deployment that never
 * sets it lets any mapper — including one registered at runtime — write to any
 * experiment on the tracking server. That may be intentional; it should never
 * be invisible.
 */
function warnUnbounded() {
    if (unboundedWarned) return;
    unboundedWarned = true;
    console.warn(
        "[io-mlflow-sink] no `experimentAllow` configured — mappers may target ANY experiment " +
        "on the tracking server. Set io.sinkOverrides.mlflow.experimentAllow to bound it.",
    );
}

let targetUnboundedWarned = false;
/** `sessionTarget` without `experimentAllow` is a misconfiguration; say so once. */
function warnTargetUnbounded() {
    if (targetUnboundedWarned) return;
    targetUnboundedWarned = true;
    console.warn(
        "[io-mlflow-sink] `sessionTarget` is set but `experimentAllow` is not -- session targets are " +
        "IGNORED until an allowlist bounds them. Set io.sinkOverrides.mlflow.experimentAllow.",
    );
}

/**
 * Resolve one session-target name for a dispatch: placeholders substituted (each
 * value sanitized by `interpolate`), then rejected if anything placeholder-like
 * survived (an unknown or malformed token is a typo, not a name). Empty = invalid.
 */
function resolveTargetName(name: string, ctx: IOContext): string | undefined {
    const resolved = interpolate(name, ctx).trim();
    if (!resolved || /[{}]/.test(resolved)) return undefined;
    return resolved;
}

export function makeMlflowSink(opts: MlflowSinkOptions): IOSink {
    const id = opts.id ?? "mlflow";

    /** Per-(experiment) and per-(experiment,runTag) id caches. Cleared on refusal. */
    const experimentIds = new Map<string, string>();
    const runIds = new Map<string, string>();

    const resolved = (ctx?: IOContext): MlflowSinkConfig => opts.getOptions(ctx) ?? {};

    const mapperOptionsOf = (o: MlflowSinkConfig, target?: MlflowSessionTarget): MapperOptions => ({
        experimentTemplate: o.experimentTemplate ?? "xopat-{ownerId}",
        runTemplate: o.runTemplate ?? "xopat-{viewerId}",
        identifierTag: o.identifierTag ?? "data_id",
        // A session-fixed run collects records the template would have spread
        // over many runs; the mapper must then keep them apart by key/path.
        sharedRun: !!target?.run,
    });

    const buildClient = (o: MlflowSinkConfig) => {
        const MlFlow = (globalThis as any).MlFlow;
        if (!MlFlow?.MlFlowClient) throw new Error("The mlflow module is not available");
        return new MlFlow.MlFlowClient({
            proxy: o.proxy,
            baseURL: o.baseURL,
            auth: o.auth,
            artifacts: o.artifacts ?? undefined,
        });
    };

    /** Applies the static allowlist. A mapper naming anything else is refused. */
    const checkExperiment = (o: MlflowSinkConfig, experiment: string): IOResult | undefined => {
        const allow = o.experimentAllow;
        if (!Array.isArray(allow) || allow.length === 0) {
            warnUnbounded();
            return undefined;
        }
        if (allow.some((p) => matchesPattern(experiment, String(p)))) return undefined;
        return fail(
            `mapper targeted experiment "${experiment}" outside experimentAllow [${allow.join(", ")}]`,
            "W_MLFLOW_EXPERIMENT_DENIED",
            t("error.experimentDenied", { experiment }),
        );
    };

    /** Same bound, applied to the run name a mapper chose. */
    const checkRun = (o: MlflowSinkConfig, run: MlflowMapping["run"]): IOResult | undefined => {
        const allow = o.runAllow;
        if (!Array.isArray(allow) || allow.length === 0) return undefined;
        const name = run.name;
        if (!name) return undefined; // no name = reuse-by-tag only, nothing to bound
        if (allow.some((p) => matchesPattern(name, String(p)))) return undefined;
        return fail(
            `mapper targeted run "${name}" outside runAllow [${allow.join(", ")}]`,
            "W_MLFLOW_RUN_DENIED",
            t("error.runDenied", { run: name }),
        );
    };

    /**
     * Artifact paths are the one mapper output that becomes a URL. Sanitize
     * unconditionally (cheap, and third-party mappers are not obliged to),
     * then enforce the operator's prefix if one is configured.
     */
    const checkArtifacts = (o: MlflowSinkConfig, mapping: MlflowMapping): IOResult | undefined => {
        if (!mapping.artifacts?.length) return undefined;
        const prefix = o.artifactPathPrefix;
        for (const artifact of mapping.artifacts) {
            const safe = sanitizeArtifactPath(String(artifact.path ?? ""));
            artifact.path = safe;
            if (prefix && !safe.startsWith(sanitizeArtifactPath(prefix))) {
                return fail(
                    `mapper emitted artifact path "${safe}" outside artifactPathPrefix "${prefix}"`,
                    "W_MLFLOW_ARTIFACT_DENIED",
                    t("error.artifactDenied", { path: safe }),
                );
            }
        }
        return undefined;
    };

    const NO_TARGET_REASON =
        "sessionTarget is \"required\" but the session selected no usable MLflow experiment (params.mlflowTarget)";
    const missingTarget = (): IOResult => fail(NO_TARGET_REASON, "W_MLFLOW_NO_TARGET", t("error.targetMissing"));
    const UNBOUNDED_REASON =
        "sessionTarget is set but experimentAllow is not: a session target is ignored without an allowlist";
    const unboundedTarget = (): IOResult =>
        fail(UNBOUNDED_REASON, "W_MLFLOW_TARGET_UNBOUNDED", t("error.targetUnbounded"));

    /**
     * The session target for this dispatch, resolved, or a refusal.
     *
     * The target is untrusted (session bundle / script), so it is honoured only
     * when the operator both enabled `sessionTarget` AND bounded experiments with
     * `experimentAllow` -- degrade closed: without the allowlist a hostile session
     * could route a user's data into any experiment on the tracking server.
     * Placeholders are resolved here, before the allowlists judge the result.
     */
    const resolveTarget = (ctx: IOContext, o: MlflowSinkConfig)
        : { target?: MlflowSessionTarget } | { refusal: IOResult } => {
        if (o.sessionTarget !== "allowed" && o.sessionTarget !== "required") return {};
        const required = o.sessionTarget === "required";
        if (!Array.isArray(o.experimentAllow) || o.experimentAllow.length === 0) {
            warnTargetUnbounded();
            return required ? { refusal: unboundedTarget() } : {};
        }
        const raw = opts.getTarget?.();
        if (!raw?.experiment) return required ? { refusal: missingTarget() } : {};

        const experiment = resolveTargetName(raw.experiment, ctx);
        const run = raw.run !== undefined ? resolveTargetName(raw.run, ctx) : undefined;
        // A target that resolves to nothing is a broken choice, never "no choice":
        // falling back to the template would write somewhere the user did not pick.
        if (!experiment || (raw.run !== undefined && !run)) return { refusal: missingTarget() };
        return { target: run ? { experiment, run } : { experiment } };
    };

    const resolveMapping = (ctx: IOContext, item: unknown, o: MlflowSinkConfig)
        : { mapping: MlflowMapping } | { refusal: IOResult } | { skip: true } => {
        const targetStep = resolveTarget(ctx, o);
        if ("refusal" in targetStep) return targetStep;
        const { target } = targetStep;

        const name = o.template ?? DEFAULT_TEMPLATE;
        const mapper = opts.getMapper(name);
        if (!mapper) {
            return { refusal: fail(
                `no mapper or template named "${name}"`,
                "W_MLFLOW_MAPPER_INVALID",
                t("error.mapperMissing", { name }),
            ) };
        }

        let mapping: MlflowMapping | null;
        try {
            mapping = mapper(ctx, item, mapperOptionsOf(o, target));
        } catch (e: any) {
            return { refusal: fail(
                `mapper "${name}" threw: ${e?.message ?? String(e)}`,
                "W_MLFLOW_MAPPER_INVALID",
                t("error.mapperThrew", { name }),
            ) };
        }
        if (!mapping) return { skip: true }; // mapper declined this record

        if (!mapping.experiment || !mapping.run?.identifierTag?.key) {
            return { refusal: fail(
                `mapper "${name}" returned a mapping without an experiment or run identifier tag`,
                "W_MLFLOW_MAPPER_INVALID",
                t("error.mapperShape", { name }),
            ) };
        }
        // The session's choice replaces the destination the template derived;
        // the template still shapes the content (metrics, tags, artifacts).
        // Applied before the allowlist checks, so it is bounded like any mapper.
        if (target) {
            mapping.experiment = target.experiment;
            if (target.run) {
                mapping.run = {
                    ...mapping.run,
                    name: target.run,
                    identifierTag: { key: RUN_NAME_TAG, value: target.run },
                };
            }
        }
        const denied = checkExperiment(o, mapping.experiment)
            ?? checkRun(o, mapping.run);
        if (denied) return { refusal: denied };

        if (mapping.artifacts?.length && !o.artifacts) {
            return { refusal: fail(
                `mapper "${name}" emitted artifacts but no artifacts adapter is configured`,
                "W_MLFLOW_NO_ARTIFACTS",
                t("error.noArtifacts"),
            ) };
        }
        const artifactDenied = checkArtifacts(o, mapping);
        if (artifactDenied) return { refusal: artifactDenied };
        return { mapping };
    };

    async function experimentIdFor(client: any, experiment: string): Promise<string> {
        const hit = experimentIds.get(experiment);
        if (hit) return hit;
        const expId = await client.experiments.ensure(experiment);
        experimentIds.set(experiment, expId);
        return expId;
    }

    async function runIdFor(client: any, expId: string, run: MlflowMapping["run"]): Promise<string> {
        const cacheKey = `${expId}::${run.identifierTag.key}=${run.identifierTag.value}`;
        const hit = runIds.get(cacheKey);
        if (hit) return hit;
        const runId = await client.runs.getOrCreateRunByTag({
            experiment_id: expId,
            identifierTag: run.identifierTag,
            run_name: run.name,
            extra_tags: run.extraTags ?? [],
        });
        if (!runId) throw new Error(`Failed to resolve an MLflow run for ${cacheKey}`);
        runIds.set(cacheKey, runId);
        return runId;
    }

    /** One mapping → at most one log-batch + any artifact uploads. */
    async function apply(ctx: IOContext, item: unknown): Promise<IOResult> {
        const o = resolved(ctx);
        const step = resolveMapping(ctx, item, o);
        if ("refusal" in step) return step.refusal;
        if ("skip" in step) return { ok: true };
        const { mapping } = step;

        try {
            const client = buildClient(o);
            const expId = await experimentIdFor(client, mapping.experiment);
            const runId = await runIdFor(client, expId, mapping.run);

            const now = Date.now();
            const metrics = (mapping.metrics ?? []).map((m) => ({
                key: m.key,
                value: Number(m.value),
                timestamp: m.timestamp ?? now,
                step: m.step ?? 0,
            }));
            if (metrics.length || mapping.params?.length || mapping.tags?.length) {
                await client.runs.logBatch(runId, {
                    ...(metrics.length ? { metrics } : {}),
                    ...(mapping.params?.length ? { params: mapping.params } : {}),
                    ...(mapping.tags?.length ? { tags: mapping.tags } : {}),
                });
            }

            for (const artifact of mapping.artifacts ?? []) {
                await client.artifacts.uploadBytes(runId, artifact.path, artifact.bytes, {
                    contentType: artifact.contentType,
                });
            }
            return { ok: true };
        } catch (e: any) {
            experimentIds.clear();
            runIds.clear();
            return classifyHttpError(e);
        }
    }

    return {
        id,
        label: opts.label ?? "MLflow",
        supports: { kinds: ["bundle", "crud"] },

        accepts(ctx: IOContext): boolean | IOAcceptDecision {
            const o = opts.getOptions(ctx) ?? {};
            if (!o.proxy && !o.baseURL) {
                // Declining with a reason rather than a bare `false`: if this
                // is the ONLY sink bound, the pipeline now reports "nothing
                // stored" and quotes this line, instead of the write vanishing.
                return {
                    accept: false,
                    reason: "mlflow sink has no `proxy` or `baseURL` configured",
                    userMessage: t("error.notConfigured"),
                };
            }
            if (o.sessionTarget === "required") {
                // Plugged in but not pointed anywhere (or pointed somewhere the
                // operator never bounded): decline loudly rather than fall back to
                // a template-derived experiment the user never chose.
                const step = resolveTarget(ctx, o);
                if ("refusal" in step) {
                    return {
                        accept: false,
                        reason: step.refusal.reason ?? NO_TARGET_REASON,
                        userMessage: step.refusal.userMessage,
                    };
                }
            }
            if (opts.accepts && !opts.accepts(ctx)) {
                return { accept: false, reason: `mlflow sink declined ${ctx.ownerId}` };
            }
            return true;
        },

        create(ctx, item) { return apply(ctx, item); },
        update(ctx, patch) { return apply(ctx, patch); },
        writeBundle(ctx, payload) { return apply(ctx, payload); },

        /**
         * MLflow metrics and params are append-only, so a delete cannot remove
         * history. Tags are removable; anything else gets a tombstone tag so the
         * deletion is at least recorded. Documented in README §Non-goals.
         */
        async delete(ctx) {
            const o = resolved(ctx);
            const step = resolveMapping(ctx, { slideId: ctx.itemId }, o);
            if ("refusal" in step) return step.refusal;
            if ("skip" in step) return { ok: true };
            const { mapping } = step;

            try {
                const client = buildClient(o);
                const expId = await experimentIdFor(client, mapping.experiment);
                const runId = await runIdFor(client, expId, mapping.run);

                for (const tag of mapping.tags ?? []) {
                    await client.runs.deleteTag(runId, tag.key);
                }
                await client.runs.setTag(runId, "xopat.deleted", String(ctx.itemId ?? ctx.key ?? ""));
                return { ok: true };
            } catch (e: any) {
                experimentIds.clear();
                runIds.clear();
                return classifyHttpError(e);
            }
        },

        async read(ctx) {
            const o = resolved(ctx);
            const step = resolveMapping(ctx, { slideId: ctx.itemId }, o);
            if ("refusal" in step) return step.refusal;
            if ("skip" in step) return { ok: true };
            const { mapping } = step;

            try {
                const client = buildClient(o);
                const expId = await experimentIdFor(client, mapping.experiment);
                const runId = await runIdFor(client, expId, mapping.run);
                const res = await client.runs.get(runId);
                return { ok: true, payload: res?.run?.data ?? undefined };
            } catch (e: any) {
                return classifyHttpError(e);
            }
        },

        async readBundle(ctx) {
            const o = resolved(ctx);
            const step = resolveMapping(ctx, {}, o);
            if ("refusal" in step) return step.refusal;
            if ("skip" in step) return { ok: true };
            const { mapping } = step;

            try {
                const client = buildClient(o);
                // A missing experiment/run is "no data yet", not an error — never
                // create one on the import path.
                const found = await client.experiments.getByName(mapping.experiment).catch(() => undefined);
                const expId = found?.experiment?.experiment_id;
                if (!expId) return { ok: true };

                const tag = mapping.run.identifierTag;
                const filter = buildTagFilter(tag);
                const search = await client.runs.search({ experiment_ids: [expId], filter, max_results: 1 });
                const run = search?.runs?.[0];
                if (!run?.info?.run_id) return { ok: true };

                return { ok: true, payload: run.data ?? undefined };
            } catch (e: any) {
                return classifyHttpError(e);
            }
        },

        /**
         * Streams the runs of the mapped experiment, following MLflow's page
         * tokens. `params` may carry `{ filter, maxResults, orderBy }`.
         */
        async *query(ctx, params) {
            const o = resolved(ctx);
            const step = resolveMapping(ctx, {}, o);
            if ("refusal" in step || "skip" in step) return;
            const { mapping } = step;

            const client = buildClient(o);
            const found = await client.experiments.getByName(mapping.experiment).catch(() => undefined);
            const expId = found?.experiment?.experiment_id;
            if (!expId) return;

            const p = (params ?? {}) as Record<string, unknown>;
            const signal = ctx.meta?.signal as AbortSignal | undefined;
            let pageToken: string | undefined;

            do {
                if (signal?.aborted) return;
                const page = await client.runs.search({
                    experiment_ids: [expId],
                    ...(typeof p.filter === "string" ? { filter: p.filter } : {}),
                    ...(Array.isArray(p.orderBy) ? { order_by: p.orderBy } : {}),
                    ...(typeof p.maxResults === "number" ? { max_results: p.maxResults } : {}),
                    ...(pageToken ? { page_token: pageToken } : {}),
                });
                for (const run of page?.runs ?? []) {
                    if (signal?.aborted) return;
                    yield run;
                }
                pageToken = page?.next_page_token;
            } while (pageToken);
        },
    };
}

export { interpolate, type KV };
