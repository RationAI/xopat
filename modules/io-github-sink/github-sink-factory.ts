// `github` sink — GitHub Contents-API-backed bundle sink.
//
// Implements `bundle-export` / `bundle-import` against a single repository
// path computed per dispatch via `pathTemplate`. Per-viewer fan-out is
// handled by the IO pipeline (one writeBundle/readBundle call per active
// viewer); the path template is what disambiguates them.
//
// All HTTP traffic is routed through xOpat's server-side proxy (see
// src/HTTP_CLIENT.md §5–9). The GitHub PAT is held server-side under
// `server.secure.proxies.<alias>.headers.Authorization` and never reaches
// the browser. The client only needs to know the proxy alias and the
// target repo; auth (if any) is the viewer's own JWT, validated by the
// proxy's verifier chain before the request is forwarded.
//
// Options are composed by the owning module (modules/io-github-sink/
// github-sink.ts) — the module merges hardcoded JS defaults, its
// include.json `github` block, and `ENV.client.io.sinkOverrides.github`
// before handing the result to this factory's `getOptions` callback.
// `getOptions` is called lazily on every dispatch so admin re-config
// takes effect without re-registration.

export type GithubSinkConfig = {
    /** "owner/repo". Required. */
    repo?: string;
    /** Default: "main". */
    branch?: string;
    /** Path placeholders: {ownerId} {ownerUid} {viewerId} {capabilityId} {xoType}.
     *  `{viewerId}` resolves to "_global" when the dispatch is global-scope. */
    pathTemplate?: string;
    /** Same placeholders. */
    commitMessageTemplate?: string;
    /** Server proxy alias (declared under `server.secure.proxies` in the
     *  deployment config). Default: "github". The proxy injects the GitHub
     *  PAT server-side and forwards to api.github.com (or the GHE host). */
    proxy?: string;
    /** Forwarded to HttpClient. Use it to require a viewer JWT for the
     *  proxy. Shape: `{ contextId, types: ["jwt"], required: true }`. */
    auth?: Record<string, unknown>;
    /** Forwarded into PUT body verbatim. */
    committer?: { name: string; email: string };
    /** Forwarded into PUT body verbatim. */
    author?: { name: string; email: string };
};

export interface GithubSinkOptions {
    /** Sink id; defaults to "github". */
    id?: string;
    label?: string;
    /** Lazy getter for the fully-composed sink config — re-evaluated on
     *  every dispatch. The owning module is responsible for merging its
     *  defaults with `IO_PIPELINE.sinkOverrides('github')`. */
    getOptions: () => GithubSinkConfig;
    /** Optional fine-grained gate. Composed with the built-in config check. */
    accepts?: (ctx: IOContext) => boolean;
}

/** GitHub Contents API caps a single file at 1 MB. */
const MAX_BUNDLE_BYTES = 1024 * 1024;

function interpolate(tmpl: string, ctx: IOContext): string {
    return tmpl.replace(/\{(\w+)\}/g, (_, key: string) => {
        switch (key) {
            case "ownerId":      return ctx.ownerId;
            case "ownerUid":     return ctx.ownerUid;
            case "viewerId":     return ctx.viewerId ?? "_global";
            case "capabilityId": return ctx.capabilityId;
            case "xoType":       return ctx.xoType;
            default:             return "";
        }
    });
}

/** UTF-8-safe base64 encode. `btoa` alone fails on non-Latin-1 input. */
function utf8ToBase64(s: string): string {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
    return btoa(bin);
}

function base64ToUtf8(s: string): string {
    const clean = s.replace(/\s+/g, "");
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
}

function fail(reason: string, code: string, userMessage?: string): IOResult {
    return userMessage
        ? { ok: false, refused: true, reason, code, userMessage }
        : { ok: false, refused: true, reason, code };
}

function classifyHttpError(e: any, op: "read" | "write"): IOResult {
    const status: number = e?.statusCode ?? 0;
    const reason: string = e?.message ?? String(e);
    if (status === 401 || status === 403) {
        return fail(reason, "W_GITHUB_AUTH",
            "GitHub rejected the access token. Check the server-side PAT's scopes and expiry, and the proxy's auth verifier chain.");
    }
    if (status === 404) {
        return fail(reason, "W_GITHUB_NOT_FOUND",
            "GitHub repository or path not found. Check `repo`/`branch`/`pathTemplate`.");
    }
    if (status === 409 || status === 422) {
        return fail(reason, "W_GITHUB_CONFLICT",
            "GitHub rejected the change due to a conflict. Reload to pick up the latest version.");
    }
    return fail(reason, `W_GITHUB_HTTP_${status || "UNKNOWN"}`);
}

export function makeGithubSink(opts: GithubSinkOptions): IOSink {
    const id = opts.id ?? "github";
    /** Per-path SHA cache. Populated on read, consumed on write so PUTs are
     *  conditional. Cleared on sink refusal so we re-fetch on retry. */
    const shaCache = new Map<string, string>();

    /** Non-secret headers that GitHub's REST API expects. The PAT is
     *  injected server-side by the proxy — never sent from here. */
    const githubHeaders: Record<string, string> = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };

    type ResolvedGithubConfig = Required<Pick<GithubSinkConfig,
        "branch" | "pathTemplate" | "commitMessageTemplate" | "proxy">> & GithubSinkConfig;

    /**
     * Reads composed options from the owning module. The module is
     * responsible for ensuring `branch`, `pathTemplate`,
     * `commitMessageTemplate`, and `proxy` are always present (its
     * defaults layer guarantees this).
     */
    const resolvedConfig = (): ResolvedGithubConfig => {
        return (opts.getOptions() ?? {}) as ResolvedGithubConfig;
    };

    const buildClient = (o: ResolvedGithubConfig) => {
        const HttpClient = (globalThis as any).HttpClient;
        if (!HttpClient) throw new Error("HttpClient is not available");
        return new HttpClient({
            proxy: o.proxy,
            // `baseURL` is omitted on purpose: we pass full `/repos/...`
            // paths to `.request()` and the server proxy joins them with
            // its configured upstream `baseUrl` (api.github.com or GHE).
            auth: o.auth,
        });
    };

    /** GET the file. Returns parsed body on 200, undefined on 404, throws otherwise. */
    async function readContents(o: ResolvedGithubConfig, path: string): Promise<any | undefined> {
        const client = buildClient(o);
        try {
            return await client.request(
                `/repos/${o.repo}/contents/${encodePath(path)}`,
                {
                    method: "GET",
                    query: { ref: o.branch },
                    headers: githubHeaders,
                    expect: "json",
                },
            );
        } catch (e: any) {
            if (e?.statusCode === 404) return undefined;
            throw e;
        }
    }

    /** PUT the file. `sha` required if the file already exists. */
    async function writeContents(
        o: ResolvedGithubConfig,
        path: string,
        contentBase64: string,
        message: string,
        sha: string | undefined,
    ): Promise<any> {
        const client = buildClient(o);
        const body: Record<string, unknown> = {
            message,
            content: contentBase64,
            branch:  o.branch,
        };
        if (sha) body.sha = sha;
        if (o.committer) body.committer = o.committer;
        if (o.author)    body.author    = o.author;
        return client.request(
            `/repos/${o.repo}/contents/${encodePath(path)}`,
            {
                method: "PUT",
                body,
                headers: githubHeaders,
                expect: "json",
            },
        );
    }

    return {
        id,
        label: opts.label ?? "GitHub",
        supports: ["bundle"],

        accepts(ctx: IOContext): boolean {
            const o = opts.getOptions() ?? {};
            if (!o.repo) return false;
            return opts.accepts ? opts.accepts(ctx) : true;
        },

        async readBundle(ctx) {
            const o = resolvedConfig();
            const path = interpolate(o.pathTemplate, ctx);
            try {
                const file = await readContents(o, path);
                if (!file) return { ok: true }; // 404 — no data yet, clean.
                if (file.sha) shaCache.set(path, file.sha);
                if (file.encoding && file.encoding !== "base64") {
                    return fail(`unexpected encoding "${file.encoding}"`, "W_GITHUB_ENCODING");
                }
                const text = base64ToUtf8(String(file.content ?? ""));
                let payload: unknown = text;
                try { payload = JSON.parse(text); } catch { /* leave as raw text */ }
                return { ok: true, payload };
            } catch (e: any) {
                shaCache.delete(path);
                return classifyHttpError(e, "read");
            }
        },

        async writeBundle(ctx, payload) {
            const o = resolvedConfig();
            const path = interpolate(o.pathTemplate, ctx);
            const message = interpolate(o.commitMessageTemplate, ctx);

            const text = typeof payload === "string"
                ? payload
                : JSON.stringify(payload, null, 2);
            const contentBase64 = utf8ToBase64(text);
            // Cheap upper-bound check before incurring a round-trip.
            if (contentBase64.length > MAX_BUNDLE_BYTES * 1.4) {
                return fail(
                    `bundle exceeds GitHub Contents API 1 MB cap (encoded ~${contentBase64.length} bytes)`,
                    "W_GITHUB_TOO_LARGE",
                    "Bundle is too large for GitHub Contents API (>1 MB). Reduce or use a different sink.",
                );
            }

            const tryWrite = async (sha: string | undefined) => writeContents(o, path, contentBase64, message, sha);

            try {
                const res = await tryWrite(shaCache.get(path));
                const newSha = res?.content?.sha;
                if (newSha) shaCache.set(path, newSha);
                return { ok: true };
            } catch (e: any) {
                const status: number = e?.statusCode ?? 0;
                // 409/422 = sha mismatch (or branch protection-style). Refresh once and retry.
                if (status === 409 || status === 422) {
                    try {
                        const fresh = await readContents(o, path);
                        const freshSha = fresh?.sha;
                        if (freshSha) shaCache.set(path, freshSha); else shaCache.delete(path);
                        const res2 = await tryWrite(freshSha);
                        const newSha = res2?.content?.sha;
                        if (newSha) shaCache.set(path, newSha);
                        return { ok: true };
                    } catch (e2: any) {
                        return classifyHttpError(e2, "write");
                    }
                }
                return classifyHttpError(e, "write");
            }
        },
    };
}

/** Encode a path for the URL: keep slashes as path separators, encode the rest. */
function encodePath(path: string): string {
    return path.split("/").map(encodeURIComponent).join("/");
}
