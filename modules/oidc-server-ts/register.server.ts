// Server side of the oidc-server-ts provider. Loaded once at boot (core calls
// `register(serverApi)`) to mount the OAuth login/callback HTTP routes + the
// RS256/JWKS verifier; also exposes `getToken`/`logout` RPC (session-scoped) so
// the client can pull the current token into XOpatUser. The client_secret and
// refresh_token never leave the server. See src/AUTH.md.
import {
    getContextConfig, discover, makeState, makePkce, saveAuthState, takeAuthState,
    exchangeCode, currentTokens, clearTokens, verifyToken, normalizeContextId,
} from "./oidc-flow";

const ROUTE_PREFIX = "/auth/oidc-server";

/** Channel logger. Falls back to console only when the broker is absent — and
 * never in addition to it (`log.error(...)` returns undefined, so a `??` chain
 * would emit twice and bypass the operator's level + redaction config). */
function oidcLog(): any {
    return (globalThis as any).XOPAT_SERVER?.log?.("module.oidc-server-ts") || {
        warn: (...a: any[]) => console.warn("[oidc-server]", ...a),
        error: (...a: any[]) => console.error("[oidc-server]", ...a),
        info: (...a: any[]) => console.info("[oidc-server]", ...a),
        debug: () => {},
    };
}

/**
 * A status page. `body` must be a STATIC literal — never a request-derived
 * string. These pages render on the viewer's own origin, next to
 * XOPAT_CSRF_TOKEN and XOpatUser's in-memory secrets, so echoing an attacker's
 * path segment or query param back here is a reflected XSS. The offending value
 * belongs in the server log (where an operator can actually act on it), not in
 * the browser. If a future page genuinely must render a dynamic value, take
 * `XOPAT_SERVER.escapeHtml` — do not interpolate raw.
 */
function endHtml(res: any, status: number, body: string): void {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:2rem">${body}</body>`);
}
function redirect(res: any, url: string): void {
    res.writeHead(302, { Location: url });
    res.end();
}
/** Popup completion page: notify the opener (same-origin) and close, so the
 * viewer tab keeps its workspace instead of being navigated away. */
function endPopupClose(res: any, contextId: string, origin: string): void {
    // jsonForScript, NOT JSON.stringify: the latter escapes quotes and
    // backslashes but not `<`, so a value containing `</script>` closes the tag
    // (AGENTS.md §7). The invariant is "nothing reaches a script body
    // unescaped" — it does not depend on today's value being safe.
    const enc = (globalThis as any).XOPAT_SERVER?.jsonForScript
        || ((v: any) => JSON.stringify(v === undefined ? null : v).replace(/</g, "\\u003c"));
    const cid = enc(String(contextId));
    const org = enc(String(origin));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:2rem">Signed in — you can close this window.<script>
try{var t=window.opener||window.parent;t&&t!==window&&t.postMessage({type:"xopat-oidc-server:done",contextId:${cid}},${org});}catch(e){}
try{window.close();}catch(e){}
</script></body>`);
}

/**
 * Origins this deployment is willing to answer as: an absolute `client.domain`
 * plus anything under `server.secure.modules["oidc-server-ts"].allowedOrigins`.
 * Mirrors saml-auth's declaredOrigins().
 */
function declaredOrigins(ctx: any): string[] {
    const out: string[] = [];
    const domain = ctx?.core?.CORE?.client?.domain;
    if (typeof domain === "string" && /^https?:\/\//.test(domain)) out.push(domain.replace(/\/$/, ""));
    const declared = ctx?.core?.CORE?.server?.secure?.modules?.["oidc-server-ts"]?.allowedOrigins
        ?? ctx?.secure?.modules?.["oidc-server-ts"]?.allowedOrigins;
    if (Array.isArray(declared)) {
        for (const entry of declared) {
            if (typeof entry === "string" && /^https?:\/\//.test(entry)) out.push(entry.replace(/\/$/, ""));
        }
    }
    return out;
}

/**
 * The origin this OAuth flow runs on.
 *
 * This is not cosmetic: it becomes the `redirect_uri` sent to the IdP, the
 * `safeReturn` same-origin test, and the `postMessage` target — so an unchecked
 * Host header lets a caller point an otherwise valid flow at a domain they
 * control. When the operator declared any origin, the request headers are only
 * honored if they match one; otherwise we degrade closed onto the first declared
 * origin. With nothing declared (a dev box) the header is still used, which is
 * why `client.domain` should be set in production.
 */
function viewerOrigin(req: any, ctx: any): string {
    const allowed = declaredOrigins(ctx);
    if (allowed.length === 1) return allowed[0];

    // No x-forwarded-proto → derive from the socket rather than assuming http:
    // a TLS-terminating proxy that omits the header would otherwise produce an
    // http:// redirect_uri that the IdP rejects against its registered HTTPS one.
    const fallbackProto = req?.socket?.encrypted ? "https" : "http";
    const proto = String(req.headers["x-forwarded-proto"] || fallbackProto).split(",")[0].trim();
    const host = req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
    const derived = `${proto}://${host}`;
    if (!allowed.length) return derived;
    if (allowed.includes(derived)) return derived;
    oidcLog().warn(`request origin '${derived}' is not declared; using '${allowed[0]}'.`);
    return allowed[0];
}
/** Only allow returning to a same-origin URL (no open redirect). */
function safeReturn(req: any, ctx: any, candidate: string | null): string {
    const origin = viewerOrigin(req, ctx);
    if (candidate && candidate.startsWith(origin + "/")) return candidate;
    if (candidate === origin) return candidate;
    return origin + "/";
}

async function handleRoute(ctx: any, urlObj: any, prefix: string): Promise<void> {
    const { req, res } = ctx;
    const sub = urlObj.pathname.slice(prefix.length);              // "/login/<ctx>" | "/callback/<ctx>"
    const parts = sub.split("/").filter(Boolean);
    const action = parts[0];
    // Decode inside the try: `%` alone raises URIError, which would otherwise
    // escape handleRoute as a generic 500.
    let rawContextId = "";
    try { rawContextId = parts[1] ? decodeURIComponent(parts[1]) : ""; }
    catch { return endHtml(res, 404, "Not found."); }
    // Canonical from here on. listContexts emits "core", so a login through
    // "/login/" or "/login/default" must not store tokens under "" / "default"
    // while the client asks for "core" — that reads as a permanent logged-out state.
    const contextId = normalizeContextId(rawContextId);
    if (!ctx.session) return endHtml(res, 401, "No session — reload the viewer first.");

    let cfg;
    try { cfg = getContextConfig(ctx, contextId); }
    catch {
        // Static body: `contextId` is request-derived and this page renders on
        // our own origin (see endHtml).
        oidcLog().warn(`unknown OIDC context requested: ${JSON.stringify(rawContextId)}`);
        return endHtml(res, 404, "Unknown OIDC context.");
    }

    const redirectUri = `${viewerOrigin(req, ctx)}${prefix}/callback/${encodeURIComponent(contextId)}`;
    try {
        const disco = await discover(cfg);
        if (action === "login") {
            const returnTo = safeReturn(req, ctx, urlObj.searchParams.get("return"));
            const display = urlObj.searchParams.get("display") === "popup" ? "popup" : "redirect";
            const state = makeState();
            const { verifier, challenge } = makePkce();
            saveAuthState(ctx, contextId, state, verifier, returnTo, display);
            const params = new URLSearchParams({
                response_type: "code",
                client_id: cfg.clientId,
                redirect_uri: redirectUri,
                scope: cfg.scope || "openid",
                state,
                code_challenge: challenge,
                code_challenge_method: "S256",
                access_type: "offline",   // Google: return a refresh_token
                prompt: "consent",
            });
            return redirect(res, `${disco.authorization_endpoint}?${params.toString()}`);
        }
        if (action === "callback") {
            const err = urlObj.searchParams.get("error");
            if (err) {
                // The IdP's `error` is request-derived — log it, never echo it.
                oidcLog().warn(`IdP returned an error for context '${contextId}': ${JSON.stringify(err)}`);
                return endHtml(res, 400, `Login failed. <a href="/">Return</a>.`);
            }
            const code = urlObj.searchParams.get("code");
            const state = urlObj.searchParams.get("state");
            const pending = state ? takeAuthState(ctx, state) : null;
            if (!code || !pending || pending.contextId !== contextId) {
                return endHtml(res, 400, `Invalid OIDC callback state. <a href="/">Return</a>.`);
            }
            await exchangeCode(ctx, contextId, code, pending.verifier, redirectUri);
            // Popup flow: close the popup + notify the opener (keeps the workspace);
            // redirect flow: navigate the (top) window back to where login started.
            if (pending.display === "popup") return endPopupClose(res, contextId, viewerOrigin(req, ctx));
            return redirect(res, pending.returnTo || (viewerOrigin(req, ctx) + "/"));
        }
        return endHtml(res, 404, "Not found.");
    } catch (e: any) {
        // Reason to the log only: it can carry the IdP's error_description.
        oidcLog().error(`${action} failed for context '${contextId}':`, e?.message || e);
        return endHtml(res, 502, `OIDC provider error. <a href="/">Return</a>.`);
    }
}

/** Boot hook: mount routes + register the verifier(s). */
export function register(serverApi: any): void {
    serverApi.registerServerRoute(ROUTE_PREFIX, (ctx: any, urlObj: any, prefix: string) => handleRoute(ctx, urlObj, prefix));

    serverApi.registerRpcAuthVerifier("oidc-server", async ({ req, verifierConfig }: any) => {
        const authHeader = req.headers["authorization"] || req.headers["Authorization"];
        if (!authHeader || !authHeader.startsWith("Bearer ")) throw new Error("Missing Bearer token");
        const payload = await verifyToken(authHeader.slice(7).trim(), verifierConfig || {});
        req.user = payload;
        return { ok: true, user: payload };
    });
    serverApi.registerProxyAuthVerifier("oidc-server", async ({ req, upstream, verifierConfig }: any) => {
        const authHeader = req.headers["authorization"] || req.headers["Authorization"];
        if (!authHeader || !authHeader.startsWith("Bearer ")) throw new Error("Missing Bearer token for oidc-server verifier");
        req.user = await verifyToken(authHeader.slice(7).trim(), verifierConfig || {});
        // Core builds `upstream.headers` from an allowlist that omits
        // `authorization`, so forwarding is an explicit add; the delete stays as
        // a scrub in case an earlier verifier put one there.
        if (((verifierConfig || {}).forward) === true) {
            upstream.headers["authorization"] = authHeader;
        } else {
            delete upstream.headers["authorization"];
            delete upstream.headers["Authorization"];
        }
        return true;
    });
}

// ── Session-scoped RPC: the client pulls the current token into XOpatUser ─────
// `public: true` + `requireSession: true` — NOT a missing gate.
//
// These three RPCs are how the browser OBTAINS its bearer token. Marking them
// non-public makes core run the RPC verifier (server-runtime.js), which demands
// `Authorization: Bearer <jwt>` — the very token only getToken can hand out. The
// boot `listContexts()` would 401, the client would never register a context,
// and login could never start. `requireSession: true` still enforces the session
// cookie + CSRF check, which is the correct control here: every method reads or
// clears state scoped to the caller's own session and yields no cross-session
// data. Same shape as modules/saml-auth/register.server.ts.
export const policy = {
    listContexts: { auth: { public: true, requireSession: true }, runtime: { timeoutMs: 3_000, maxBodyBytes: 2 * 1024 } },
    getToken:     { auth: { public: true, requireSession: true }, runtime: { timeoutMs: 8_000, maxBodyBytes: 8 * 1024 } },
    logout:       { auth: { public: true, requireSession: true }, runtime: { timeoutMs: 4_000, maxBodyBytes: 4 * 1024 } },
} as const;

/** Public per-context client-behavior flags (NO secrets). Config lives only in
 * server.secure; the login redirect is built server-side, so the client needs
 * only these flags to register the contexts into APPLICATION_CONTEXT.auth. */
export async function listContexts(ctx: any): Promise<any> {
    const secure = ctx?.secure || ctx?.core?.CORE?.server?.secure || {};
    const contexts = ((secure.modules && secure.modules["oidc-server-ts"]) || {}).contexts || {};
    return {
        contexts: Object.keys(contexts).map((rawId) => {
            const c = contexts[rawId] || {};
            // Emit the CANONICAL id ("" / "core" default → "core") so the client
            // registers, logs in, and stores tokens under one consistent key.
            const contextId = normalizeContextId(rawId);
            return {
                contextId,
                autoLogin: c.autoLogin === true,
                tokenForServer: c.tokenForServer || "access_token",
                serviceName: c.serviceName || contextId,
                flow: c.flow === "redirect" ? "redirect" : "popup",   // login UX; popup keeps the workspace
            };
        }),
    };
}

/**
 * The context whose credential this call may touch.
 *
 * `input.contextId` is client-supplied, so it names the request, not the
 * authority (AGENTS.md §7). The control that makes that safe here is NOT
 * `requireRpcAuthContext`: these methods are the credential DISPENSER for a
 * context, so demanding a verified bearer for the very context whose bearer only
 * this call can hand out is circular — and it refuses outright on any deployment
 * with no `core.server.secure.rpcVerifiers` block, which is the common case for a
 * viewer whose upstreams (not our own RPC) consume the token.
 *
 * What actually gates it: `policy` declares `requireSession: true` (session cookie
 * + CSRF), and `currentTokens`/`clearTokens` are scoped to the caller's OWN
 * session. Every context reachable from here therefore belongs to the caller
 * already, so naming another one is a choice among their own credentials, not an
 * escalation. Normalizing the id is what keeps `""`/`"default"`/`"core"` from
 * splitting one identity across several store keys.
 */
function resolveTokenContext(_ctx: any, requested: any): string {
    return normalizeContextId(typeof requested === "string" ? requested : "");
}

export async function getToken(ctx: any, input: any = {}): Promise<any> {
    const { contextId } = input || {};
    if (!contextId) throw new Error("getToken requires contextId.");
    const id = resolveTokenContext(ctx, contextId);
    return (await currentTokens(ctx, id)) || { access_token: null, id_token: null, expires_in: null };
}
export async function logout(ctx: any, input: any = {}): Promise<any> {
    // Normalize before clearing: an omitted / "" / "default" id is the MAIN
    // context, not "nothing to do". Returning {ok:true} without clearing left a
    // live access_token AND refresh_token behind after an explicit logout.
    const id = resolveTokenContext(ctx, (input || {}).contextId);
    clearTokens(ctx, id);
    return { ok: true };
}
