// `http-rest` sink — generic HttpClient-backed sink for both
// bundle and CRUD capabilities. A single instance can serve any owner
// whose binding routes to it; per-deployment overrides come from
// `ENV.client.io.sinkOverrides[<id>]` (composed by the sink factory's
// `getOptions` callback).
//
// Config shape:
//   {
//     "proxy":      "cerit",            // optional HttpClient proxy alias
//     "baseURL":    "/api/v1/objects",  // required
//     "auth":       { ... },            // passed to HttpClient
//     // URL builders (each receives ctx and returns a path appended to baseURL):
//     "bundlePath": (ctx) => "/bundles/" + ctx.ownerId,
//     "itemPath":   (ctx) => "/items/" + ctx.resourceName + (ctx.itemId ? "/" + ctx.itemId : ""),
//   }
// Path builders may be plain strings using the `IO_PIPELINE.formatPath`
// placeholder set (`{ownerId}`, `{key}`, `{viewerId}`, `{backgroundId}`,
// `{resourceName}`, `{itemId}`, `{slideHash}`, …) for config-only setups.
// Every substituted value is percent-encoded into one URL segment (mode
// `"uri"`): ids are kept distinct and whole, never rewritten.
//
// Default bundle path: `/bundles/{ownerId}` for global owners, and
// `/bundles/{ownerId}/{key}` for per-viewer / per-slide owners (their bundle
// key is part of the address — before v3 they all shared one document). Set
// `bundlePath: "/bundles/{ownerId}"` to keep the old single-document URL.
//
// Retries: the client is built with `maxRetries: 0`, so `withRetry` (which
// core wraps around this sink) is the ONE retry layer — HttpClient's own
// 429/5xx retry would otherwise multiply with it. `withRetry` does not retry
// `create` by default: POST is not idempotent.
//
// Failure codes: a request that never got an answer is `W_IO_HTTP_NETWORK`,
// a 5xx or 429 answer is the bare status (`"503"`), anything else is the
// per-operation `W_IO_HTTP_<OP>`. The first two are what `withRetry` and the
// outbox stall detector key on — a 4xx is the upstream saying no.

import { formatContextTemplate, pinnedFormatFrom } from "../io-pipeline";

export interface HttpRestSinkOptions {
    /** Sink id; defaults to "http-rest". Use distinct ids if you
     *  register multiple HTTP sinks with different baseURLs. */
    id?: string;
    label?: string;
    /** Lazy getter for the sink's options (so config changes take effect).
     *  Receives the dispatch context so per-binding config can be layered in. */
    getOptions: (ctx?: IOContext) => Record<string, unknown>;
    /** Template expander — pass `IO_PIPELINE.formatPath` so slide tokens
     *  (`{slideHash}`, `{slideName}`) resolve. Without it they fall back to
     *  `_any` / empty, i.e. one address for every slide. */
    formatPath?: (template: string, ctx: IOContext, options?: IOFormatOptions) => string;
    /** Optional fine-grained gate. */
    accepts?(ctx: IOContext): boolean;
}

export function makeHttpRestSink(opts: HttpRestSinkOptions): IOSink {
    const id = opts.id ?? "http-rest";

    const client = (ctx: IOContext) => {
        const HttpClient = (globalThis as any).HttpClient;
        if (!HttpClient) {
            throw new Error("HttpClient is not available");
        }
        const o = opts.getOptions(ctx) ?? {};
        return new HttpClient({
            proxy: o.proxy,
            baseURL: o.baseURL,
            auth: o.auth,
            // `withRetry` is the one retry layer — see the header comment.
            maxRetries: 0,
        });
    };

    const buildPath = (ctx: IOContext, kind: "bundle" | "item"): string => {
        const o = opts.getOptions(ctx) ?? {};
        const tmpl = kind === "bundle" ? o.bundlePath : o.itemPath;
        if (typeof tmpl === "function") return (tmpl as any)(ctx);
        if (typeof tmpl === "string") {
            const format = opts.formatPath ?? formatContextTemplate;
            return format(tmpl, ctx, { mode: "uri", empty: "" });
        }
        // Sensible default. The bundle key is part of the address: per-viewer
        // and per-slide owners would otherwise all write one document.
        if (kind === "bundle") {
            return ctx.key
                ? `/bundles/${encodeURIComponent(ctx.ownerId)}/${encodeURIComponent(ctx.key)}`
                : `/bundles/${encodeURIComponent(ctx.ownerId)}`;
        }
        return ctx.itemId
            ? `/${ctx.resourceName}/${encodeURIComponent(ctx.itemId)}`
            : `/${ctx.resourceName}`;
    };

    const okFromResponse = async (response: any): Promise<IOResult> => {
        try {
            if (!response) return { ok: true };
            if (typeof response === "object" && "data" in response) {
                return { ok: true, payload: (response as any).data };
            }
            return { ok: true, payload: response };
        } catch (e: any) {
            return { ok: false, refused: true, reason: e?.message ?? String(e), code: "W_IO_HTTP_PARSE" };
        }
    };

    const fail = (e: any, opCode: string): IOResult => {
        // `HTTPError.statusCode` defaults to 500 when there was no response at
        // all, so "no response" has to be read off the response, not the code.
        const status = Number(e?.response?.status ?? 0);
        const code = !e?.response ? "W_IO_HTTP_NETWORK"
            : status >= 500 || status === 429 ? String(status)
            : opCode;
        return {
            ok: false, refused: true, code,
            reason: e?.message ?? String(e),
        };
    };

    return {
        id,
        label: opts.label ?? "HTTP",
        supports: ["bundle", "crud"],
        accepts: opts.accepts,
        // Stores whatever it is handed; `formats: { <domain>: "<id>" }` in the
        // sink's options picks which (see `IOSink.preferredFormat`).
        preferredFormat: (domain, ctx) => pinnedFormatFrom(opts.getOptions(ctx), domain),

        async writeBundle(ctx, payload) {
            try {
                const res = await client(ctx).request(buildPath(ctx, "bundle"), {
                    method: "PUT", body: payload,
                });
                return okFromResponse(res);
            } catch (e) { return fail(e, "W_IO_HTTP_WRITE"); }
        },
        async readBundle(ctx) {
            try {
                const res = await client(ctx).request(buildPath(ctx, "bundle"), { method: "GET" });
                return okFromResponse(res);
            } catch (e) { return fail(e, "W_IO_HTTP_READ"); }
        },
        async create(ctx, item) {
            try {
                const res = await client(ctx).request(buildPath(ctx, "item"), {
                    method: "POST", body: item,
                });
                return okFromResponse(res);
            } catch (e) { return fail(e, "W_IO_HTTP_CREATE"); }
        },
        async read(ctx) {
            try {
                const res = await client(ctx).request(buildPath(ctx, "item"), { method: "GET" });
                return okFromResponse(res);
            } catch (e) { return fail(e, "W_IO_HTTP_READ"); }
        },
        async update(ctx, patch) {
            try {
                const res = await client(ctx).request(buildPath(ctx, "item"), {
                    method: "PATCH", body: patch,
                });
                return okFromResponse(res);
            } catch (e) { return fail(e, "W_IO_HTTP_UPDATE"); }
        },
        async delete(ctx) {
            try {
                const res = await client(ctx).request(buildPath(ctx, "item"), { method: "DELETE" });
                return okFromResponse(res);
            } catch (e) { return fail(e, "W_IO_HTTP_DELETE"); }
        },
    };
}
