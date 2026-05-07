// Module entry: registers the `github` IO sink with the pipeline.
//
// This module owns the sink's defaults. Defaults are sourced from
// `include.json::github` (via `getStaticMeta('github')`), with safe JS
// literal fallbacks. Per-deployment overrides (repo, optional auth, …)
// come from `ENV.client.io.sinkOverrides.github` and are merged in via
// `IO_PIPELINE.sinkOverrides('github')`. The pipeline never composes the
// sink's options on the module's behalf — that responsibility lives here.
//
// The GitHub PAT lives **server-side only** under
// `server.secure.proxies.<alias>.headers.Authorization` — it is never
// configured on the client. See README.md for the full setup recipe.

import { makeGithubSink, type GithubSinkConfig } from "./github-sink-factory";

const HARDCODED_DEFAULTS: GithubSinkConfig = {
    proxy: "github",
    branch: "main",
    pathTemplate: "xopat/{ownerId}/{viewerId}.json",
    commitMessageTemplate: "xopat: sync {ownerId} {viewerId}",
};

class IOGithubSink extends XOpatModuleSingleton {
    /** Returned by `IO_PIPELINE.registerSink`. Held for test harnesses
     *  / hot-reload; production never calls it. */
    private _disposeSink?: () => void;

    constructor() {
        super();

        const pipeline = (globalThis as any).IO_PIPELINE;
        if (!pipeline?.registerSink) {
            console.warn("[io-github-sink] IO_PIPELINE not available — module is inert.");
            return;
        }

        const sink = makeGithubSink({
            id: "github",
            label: "GitHub",
            getOptions: () => this._composeOptions(pipeline),
        });
        this._disposeSink = pipeline.registerSink(sink);
    }

    /**
     * Compose the github sink's runtime options. Layered (latest wins):
     *   1. Hardcoded JS defaults (always present, safety net).
     *   2. Module's include.json `github` block (deployment-tunable
     *      defaults — branch, path template, proxy alias, …).
     *   3. Admin's `ENV.client.io.sinkOverrides.github` (per-deployment
     *      values: repo, optional committer/author/auth).
     *
     * Underscore-prefixed keys (e.g. `_help`) are stripped so include.json
     * can carry inline documentation without leaking into runtime config.
     * `null` values are dropped so verbose include.json placeholders
     * don't shadow upstream layers.
     */
    private _composeOptions(pipeline: any): GithubSinkConfig {
        const fromInclude = stripDocs((this.getStaticMeta("github") ?? {}) as Record<string, unknown>);
        const fromAdmin = stripDocs((pipeline.sinkOverrides?.("github") ?? {}) as Record<string, unknown>);
        return { ...HARDCODED_DEFAULTS, ...fromInclude, ...fromAdmin } as GithubSinkConfig;
    }
}

function stripDocs(o: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
        if (k.startsWith("_")) continue;
        const v = o[k];
        if (v === null || v === undefined) continue;
        out[k] = v;
    }
    return out;
}

addModule("io-github-sink", IOGithubSink);
