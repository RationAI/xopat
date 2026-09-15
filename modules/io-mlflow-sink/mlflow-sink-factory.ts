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
};

export interface MlflowSinkOptions {
    id?: string;
    label?: string;
    /** Lazy getter for the fully-composed sink config. */
    getOptions: (ctx?: IOContext) => MlflowSinkConfig;
    /** Resolves the mapper for a dispatch: registered mapper first, then template name. */
    getMapper: (name: string) => MlflowMapper | undefined;
    /** Optional fine-grained gate, composed with the built-in config check. */
    accepts?: (ctx: IOContext) => boolean;
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
    const key = MlFlow?.Utils?.sanitizeMetricKey
        ? MlFlow.Utils.sanitizeMetricKey(tag.key)
        : String(tag.key).replace(/[^A-Za-z0-9._\- /]/g, "_");
    const value = String(tag.value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `tags.${key} = "${value}"`;
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

export function makeMlflowSink(opts: MlflowSinkOptions): IOSink {
    const id = opts.id ?? "mlflow";

    /** Per-(experiment) and per-(experiment,runTag) id caches. Cleared on refusal. */
    const experimentIds = new Map<string, string>();
    const runIds = new Map<string, string>();

    const resolved = (ctx?: IOContext): MlflowSinkConfig => opts.getOptions(ctx) ?? {};

    const mapperOptionsOf = (o: MlflowSinkConfig): MapperOptions => ({
        experimentTemplate: o.experimentTemplate ?? "xopat-{ownerId}",
        runTemplate: o.runTemplate ?? "xopat-{viewerId}",
        identifierTag: o.identifierTag ?? "data_id",
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

    const resolveMapping = (ctx: IOContext, item: unknown, o: MlflowSinkConfig)
        : { mapping: MlflowMapping } | { refusal: IOResult } | { skip: true } => {
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
            mapping = mapper(ctx, item, mapperOptionsOf(o));
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
