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
// Path builders may be plain strings with `{ownerId}`/`{resourceName}`/
// `{itemId}` placeholders for config-only setups.

export interface HttpRestSinkOptions {
    /** Sink id; defaults to "http-rest". Use distinct ids if you
     *  register multiple HTTP sinks with different baseURLs. */
    id?: string;
    label?: string;
    /** Lazy getter for the sink's options (so config changes take effect). */
    getOptions: () => Record<string, unknown>;
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
        const o = opts.getOptions() ?? {};
        return new HttpClient({
            proxy: o.proxy,
            baseURL: o.baseURL,
            auth: o.auth,
        });
    };

    const buildPath = (ctx: IOContext, kind: "bundle" | "item"): string => {
        const o = opts.getOptions() ?? {};
        const tmpl = kind === "bundle" ? o.bundlePath : o.itemPath;
        if (typeof tmpl === "function") return (tmpl as any)(ctx);
        if (typeof tmpl === "string") {
            return tmpl
                .replace("{ownerId}", ctx.ownerId)
                .replace("{resourceName}", ctx.resourceName ?? "")
                .replace("{itemId}", ctx.itemId ?? "");
        }
        // Sensible default.
        if (kind === "bundle") return `/bundles/${ctx.ownerId}`;
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

    const fail = (e: any, code: string): IOResult => ({
        ok: false, refused: true, code,
        reason: e?.message ?? String(e),
    });

    return {
        id,
        label: opts.label ?? "HTTP",
        supports: ["bundle", "crud"],
        accepts: opts.accepts,

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
