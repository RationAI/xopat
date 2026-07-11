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
    const cid = JSON.stringify(String(contextId));   // JSON.stringify escapes → no HTML/JS injection
    const org = JSON.stringify(String(origin));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:2rem">Signed in — you can close this window.<script>
try{var t=window.opener||window.parent;t&&t!==window&&t.postMessage({type:"xopat-oidc-server:done",contextId:${cid}},${org});}catch(e){}
try{window.close();}catch(e){}
</script></body>`);
}
function viewerOrigin(req: any, ctx: any): string {
    const d = ctx?.core?.CORE?.client?.domain;
    if (typeof d === "string" && /^https?:\/\//.test(d)) return d.replace(/\/$/, "");
    const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
    const host = req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
    return `${proto}://${host}`;
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
    const contextId = parts[1] ? decodeURIComponent(parts[1]) : "";
    if (!ctx.session) return endHtml(res, 401, "No session — reload the viewer first.");

    let cfg;
    try { cfg = getContextConfig(ctx, contextId); }
    catch { return endHtml(res, 404, `Unknown OIDC context '${contextId}'.`); }

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
            if (err) return endHtml(res, 400, `Login failed: ${err}. <a href="/">Return</a>.`);
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
    } catch (e) {
        console.error("[oidc-server] route error:", e);
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
        if (((verifierConfig || {}).forward) !== true) {
            delete upstream.headers["authorization"];
            delete upstream.headers["Authorization"];
        }
        return true;
    });
}

// ── Session-scoped RPC: the client pulls the current token into XOpatUser ─────
export const policy = {
    listContexts: { auth: { public: false, requireSession: true }, runtime: { timeoutMs: 3_000, maxBodyBytes: 2 * 1024 } },
    getToken:     { auth: { public: false, requireSession: true }, runtime: { timeoutMs: 8_000, maxBodyBytes: 8 * 1024 } },
    logout:       { auth: { public: false, requireSession: true }, runtime: { timeoutMs: 4_000, maxBodyBytes: 4 * 1024 } },
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

export async function getToken(ctx: any, input: any = {}): Promise<any> {
    const { contextId } = input || {};
    if (!contextId) throw new Error("getToken requires contextId.");
    return (await currentTokens(ctx, contextId)) || { access_token: null, id_token: null, expires_in: null };
}
export async function logout(ctx: any, input: any = {}): Promise<any> {
    const { contextId } = input || {};
    if (contextId) clearTokens(ctx, contextId);
    return { ok: true };
}
