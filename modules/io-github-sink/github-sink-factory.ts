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
    /**
     * Storage path. Placeholders (resolved by `IO_PIPELINE.formatPath`):
     *   {ownerId} {ownerUid} {xoType} {direction}
     *   {capabilityId} {capabilityGroup}
     *   {viewerId} {backgroundId} {key} {resourceName} {itemId}
     *
     * `{viewerId}` resolves to "_global" for a global-scope dispatch,
     * `{backgroundId}` to "_any" when the owner is not slide-scoped.
     *
     * Use `{capabilityGroup}` — NOT `{capabilityId}` — when the path must
     * round-trip: export dispatches carry `bundle-export` and restores carry
     * `bundle-import`, so `{capabilityId}` reads back from a different file
     * than it wrote. Both collapse to `bundle` in `{capabilityGroup}`.
     *
     * Every substituted value is reduced to ONE safe path segment; the
     * template itself is trusted config and may contain `/`.
     */
    pathTemplate?: string;
    /** Same placeholders, but unrestricted charset (it is not addressing). */
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
    /**
     * Lazy getter for the fully-composed sink config — re-evaluated on every
     * dispatch. The owning module merges its defaults with
     * `IO_PIPELINE.sinkOverrides('github')` and, when `ctx` is supplied, the
     * per-binding config for that (owner, capability). The parameter is
     * optional so callers written against the old zero-arg signature keep
     * working unchanged.
     */
    getOptions: (ctx?: IOContext) => GithubSinkConfig;
    /** Optional fine-grained gate. Composed with the built-in config check. */
    accepts?: (ctx: IOContext) => boolean;
}

/** GitHub Contents API caps a single file at 1 MB. */
const MAX_BUNDLE_BYTES = 1024 * 1024;

/**
 * Interpolate a config template against the dispatch context.
 *
 * Delegates to the core helper (`IO_PIPELINE.formatPath`), which owns the
 * placeholder set AND the sanitization of every substituted value. This is
 * not optional politeness: `viewerId` / `backgroundId` / `itemId` are
 * attacker-influenceable (a session bundle picks the background id, and
 * `BackgroundConfig.virtualOf` used to reach here unsanitized), while the
 * GitHub Contents API normalizes `..` server-side and `encodePath` below
 * deliberately preserves `/`. Sanitizing at the source is what keeps a
 * hostile slide id from addressing `.github/workflows/`.
 *
 * The local fallback exists because this module is bundled into
 * `index.workspace.js` and loads against whatever core version a deployment
 * is running; an older core has no `formatPath`.
 */
function fmt(tmpl: string, ctx: IOContext, mode: "path" | "raw" = "path"): string {
    const pipeline = (globalThis as any).IO_PIPELINE;
    if (typeof pipeline?.formatPath === "function") {
        return pipeline.formatPath(tmpl, ctx, { mode });
    }
    return legacyInterpolate(tmpl, ctx, mode);
}

// eslint-disable-next-line no-control-regex
const CTRL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/** Mirror of the core sanitizer for cores predating `formatPath`. */
function legacyInterpolate(tmpl: string, ctx: IOContext, mode: "path" | "raw"): string {
    const capabilityGroup = ctx.capabilityId.startsWith("crud:") ? "crud"
        : ctx.capabilityId.startsWith("kv:") ? "kv"
        : ctx.capabilityId.replace(/-(export|import)$/, "");
    const values: Record<string, string | undefined> = {
        ownerId: ctx.ownerId,
        ownerUid: ctx.ownerUid,
        xoType: ctx.xoType,
        direction: ctx.direction,
        capabilityId: ctx.capabilityId,
        capabilityGroup,
        viewerId: ctx.viewerId ?? "_global",
        backgroundId: ctx.backgroundId ?? "_any",
        key: ctx.key || "_default",
        resourceName: ctx.resourceName,
        itemId: ctx.itemId,
    };
    return String(tmpl).replace(/\{(\w+)\}/g, (_m, key: string) => {
        const raw = String(values[key] ?? "");
        if (mode === "raw") return raw.replace(CTRL_CHARS, "").slice(0, 256);
        const v = raw.replace(CTRL_CHARS, "")
            .replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128);
        return (v === "" || v === "." || v === "..") ? "_" : v;
    });
}

/**
 * Reject a template that assembles into something that is not a plain
 * relative repo path. Values are already single-segment-safe by the time we
 * get here, so this catches admin mistakes in the TEMPLATE itself (a leading
 * slash, a literal `..`) rather than hostile input.
 */
function assertRepoPath(path: string): string | undefined {
    if (!path) return "resolved to an empty path";
    if (path.startsWith("/")) return `resolved to an absolute path ("${path}")`;
    if (path.includes("//")) return `contains an empty path segment ("${path}")`;
    if (path.length > 512) return `is longer than 512 characters`;
    const segments = path.split("/");
    if (!segments.length) return "resolved to an empty path";
    if (segments.some(s => s === "." || s === "..")) return `contains a relative path segment ("${path}")`;
    return undefined;
}

/** UTF-8-safe base64 encode. `btoa` alone fails on non-Latin-1 input. */
function utf8ToBase64(s: string): string {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
    return btoa(bin);
}

function base64ToUtf8(s: string): string {
    return new TextDecoder("utf-8").decode(base64ToBytes(s));
}

function base64ToBytes(s: string): Uint8Array {
    const bin = atob(s.replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function bytesToBase64(input: Uint8Array | ArrayBuffer): string {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let bin = "";
    // Chunked: `String.fromCharCode(...bytes)` blows the argument limit on
    // anything media-sized, which is exactly what this path exists for.
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
}

/** An owner opting into byte storage — see `IOBinaryPayload`. */
function isBinaryPayload(p: unknown): p is IOBinaryPayload {
    if (!p || typeof p !== "object") return false;
    const bytes = (p as IOBinaryPayload).bytes;
    return bytes instanceof Uint8Array || bytes instanceof ArrayBuffer;
}

function pathRefusal(template: string, problem: string): IOResult {
    return fail(
        `pathTemplate "${template}" ${problem}`,
        "W_GITHUB_PATH_INVALID",
        "GitHub storage path is misconfigured. Check `pathTemplate` in the deployment's io.sinkOverrides.github block.",
    );
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
    const resolvedConfig = (ctx?: IOContext): ResolvedGithubConfig => {
        return (opts.getOptions(ctx) ?? {}) as ResolvedGithubConfig;
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
        // Bundle only, deliberately: one commit per CRUD item is the wrong
        // shape for the Contents API (rate limits, 1 MB cap, no batching).
        // Declaring it means an admin who binds `crud:*` here is told at boot
        // via `io:invalid-binding` instead of losing writes silently.
        supports: { kinds: ["bundle"] },

        accepts(ctx: IOContext): boolean | IOAcceptDecision {
            const o = opts.getOptions(ctx) ?? {};
            if (!o.repo) {
                return {
                    accept: false,
                    reason: `github sink has no "repo" configured`,
                    userMessage: "GitHub storage is not configured (missing `repo`).",
                };
            }
            if (opts.accepts && !opts.accepts(ctx)) {
                return { accept: false, reason: `github sink declined ${ctx.ownerId}` };
            }
            return true;
        },

        async readBundle(ctx) {
            const o = resolvedConfig(ctx);
            const path = fmt(o.pathTemplate, ctx);
            const bad = assertRepoPath(path);
            if (bad) return pathRefusal(o.pathTemplate, bad);
            try {
                const file = await readContents(o, path);
                if (!file) return { ok: true }; // 404 — no data yet, clean.
                if (file.sha) shaCache.set(path, file.sha);
                if (file.encoding && file.encoding !== "base64") {
                    return fail(`unexpected encoding "${file.encoding}"`, "W_GITHUB_ENCODING");
                }
                // Round-trip the bytes verbatim. The sink decodes the wire
                // encoding (base64) but must NOT reinterpret payload
                // semantics — owners (e.g. annotations' native Convertor)
                // own the JSON.parse step and rely on receiving the same
                // string they exported. See src/IO_PIPELINE.md.
                const raw = String(file.content ?? "");
                // Owners that stored an `IOBinaryPayload` ask for it back the
                // same way (`ctx.meta.binary`), because base64 alone cannot
                // tell us whether the bytes were ever text.
                if (ctx.meta?.binary) {
                    return {
                        ok: true,
                        payload: {
                            bytes: base64ToBytes(raw),
                            contentType: (ctx.meta.contentType as string) ?? "application/octet-stream",
                        } as IOBinaryPayload,
                    };
                }
                const payload = base64ToUtf8(raw);
                return { ok: true, payload };
            } catch (e: any) {
                shaCache.delete(path);
                return classifyHttpError(e, "read");
            }
        },

        async writeBundle(ctx, payload) {
            const o = resolvedConfig(ctx);
            const path = fmt(o.pathTemplate, ctx);
            const bad = assertRepoPath(path);
            if (bad) return pathRefusal(o.pathTemplate, bad);
            const message = fmt(o.commitMessageTemplate, ctx, "raw");

            // Bytes go through as bytes. Stringifying an `IOBinaryPayload`
            // would produce `{"bytes":{"0":137,...}}` — a JSON dump of a typed
            // array, inflating a recording by an order of magnitude and being
            // unreadable on the way back.
            const contentBase64 = isBinaryPayload(payload)
                ? bytesToBase64(payload.bytes)
                : utf8ToBase64(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));
            // Cheap upper-bound check before incurring a round-trip.
            if (contentBase64.length > MAX_BUNDLE_BYTES * 1.4) {
                return fail(
                    `bundle exceeds GitHub Contents API 1 MB cap (encoded ~${contentBase64.length} bytes)`,
                    "W_GITHUB_TOO_LARGE",
                    "Bundle is too large for GitHub Contents API (>1 MB). Reduce or use a different sink — " +
                    "media-sized payloads belong in MLflow artifacts or an http-rest backend.",
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

/**
 * Encode a path for the URL: keep slashes as path separators, encode the rest.
 *
 * This is URL encoding, NOT a security boundary — do not read it as one.
 * `encodeURIComponent("..") === ".."`, and the GitHub Contents API normalizes
 * `..` server-side, so a value containing a traversal survives this function
 * intact. Segment safety is established earlier, by `fmt()` (which reduces
 * every substituted value to `[A-Za-z0-9._-]`) and `assertRepoPath()`.
 */
function encodePath(path: string): string {
    return path.split("/").map(encodeURIComponent).join("/");
}
