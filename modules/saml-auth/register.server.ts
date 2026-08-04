// Server side of the saml-auth provider. Loaded once at boot (core calls
// `register(serverApi)`) to mount the SAML HTTP routes; also exposes
// listContexts/getToken/logout RPC (session-scoped) so the client can pull the
// current token into XOpatUser.
//
// The IdP certificate, the SP private key and the token signing secret never
// leave the server — the browser only receives a short-lived HS256 token, which
// the operator has the core "jwt" verifier check. See src/AUTH.md + README.md.
import {
    normalizeContextId, listContextIds, getContextConfig, spFor, signRelayState, verifyRelayState,
    assertAssertionUnseen, assertionIdOf, parkResult, takeResult, saveSession, readSession,
    clearSession, currentToken, sessionFromProfile, logoutProfileOf,
} from "./saml-flow";

const ROUTE_PREFIX = "/auth/saml";
const MAX_BODY_BYTES = 512 * 1024;      // a SAMLResponse is base64 XML: big, but bounded

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
try{var t=window.opener||window.parent;t&&t!==window&&t.postMessage({type:"xopat-saml:done",contextId:${cid}},${org});}catch(e){}
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
function safeReturn(req: any, ctx: any, candidate: string | null | undefined): string {
    const origin = viewerOrigin(req, ctx);
    if (candidate && candidate.startsWith(origin + "/")) return candidate;
    if (candidate === origin) return candidate;
    return origin + "/";
}
function spUrlsFor(req: any, ctx: any, prefix: string, contextId: string) {
    const origin = viewerOrigin(req, ctx);
    const id = encodeURIComponent(contextId);
    return {
        callbackUrl: `${origin}${prefix}/acs/${id}`,
        logoutCallbackUrl: `${origin}${prefix}/slo/${id}`,
    };
}

/** Read an `application/x-www-form-urlencoded` body, refusing anything oversized. */
function readFormBody(req: any): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
        const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
        if (type !== "application/x-www-form-urlencoded") {
            return reject(new Error(`Unexpected content type '${type}'.`));
        }
        let size = 0;
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => {
            size += c.length;
            if (size > MAX_BODY_BYTES) {
                req.destroy();
                return reject(new Error("SAML message too large."));
            }
            chunks.push(c);
        });
        req.on("error", reject);
        req.on("end", () => {
            const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
            const out: Record<string, string> = {};
            for (const [k, v] of params) out[k] = v;
            resolve(out);
        });
    });
}

/** Finish a completed sign-in: popup → close + notify opener, redirect → go back. */
function completeLogin(req: any, ctx: any, contextId: string, relay: any): void {
    if (relay?.display === "popup") return endPopupClose(ctx.res, contextId, viewerOrigin(req, ctx));
    return redirect(ctx.res, safeReturn(req, ctx, relay?.returnTo));
}

// ── Routes ───────────────────────────────────────────────────────────────────

async function handleMetadata(ctx: any, contextId: string, prefix: string): Promise<void> {
    const cfg = getContextConfig(ctx, contextId);
    const sp = await spFor(ctx, contextId, spUrlsFor(ctx.req, ctx, prefix, contextId));
    const cert = cfg.publicCert || null;
    const xml = sp.generateServiceProviderMetadata(cfg.decryptionCert || cert, cert);
    ctx.res.writeHead(200, {
        "Content-Type": "application/samlmetadata+xml; charset=utf-8",
        "Content-Disposition": `inline; filename="xopat-sp-${normalizeContextId(contextId)}.xml"`,
    });
    ctx.res.end(xml);
}

async function handleLogin(ctx: any, urlObj: any, contextId: string, prefix: string): Promise<void> {
    const { req, res } = ctx;
    const cfg = getContextConfig(ctx, contextId);
    const sp = await spFor(ctx, contextId, spUrlsFor(req, ctx, prefix, contextId));
    const display = urlObj.searchParams.get("display") === "popup" ? "popup" : "redirect";
    const relay = signRelayState(cfg, {
        contextId: normalizeContextId(contextId),
        returnTo: safeReturn(req, ctx, urlObj.searchParams.get("return")),
        display,
    });
    return redirect(res, await sp.getAuthorizeUrlAsync(relay, undefined, {}));
}

/** Assertion Consumer Service — a CROSS-SITE POST from the IdP (no session cookie). */
async function handleAcs(ctx: any, contextId: string, prefix: string): Promise<void> {
    const { req, res } = ctx;
    const cfg = getContextConfig(ctx, contextId);
    const sp = await spFor(ctx, contextId, spUrlsFor(req, ctx, prefix, contextId));
    const body = await readFormBody(req);
    if (!body.SAMLResponse) return endHtml(res, 400, `Missing SAML response. <a href="/">Return</a>.`);

    const { profile } = await sp.validatePostResponseAsync({ SAMLResponse: body.SAMLResponse });
    if (!profile) return endHtml(res, 400, `SAML response carried no assertion. <a href="/">Return</a>.`);

    // Unsolicited responses are only accepted when the operator opted in; for
    // solicited ones node-saml already consumed the matching request id.
    if (!profile.inResponseTo && cfg.allowIdpInitiated !== true) {
        throw new Error("Unsolicited SAML response rejected (allowIdpInitiated is off).");
    }
    assertAssertionUnseen(assertionIdOf(profile), (cfg.sessionTtlSec || 28800) * 1000);

    // The session cookie is SameSite=Lax and therefore absent on this cross-site
    // POST. Park the result and bounce through a top-level GET, which carries it.
    const relay = verifyRelayState(cfg, body.RelayState);
    const code = parkResult({
        contextId: normalizeContextId(contextId),
        state: sessionFromProfile(cfg, profile),
        relay,
    });
    return redirect(res, `${viewerOrigin(req, ctx)}${prefix}/finish/${encodeURIComponent(contextId)}?code=${encodeURIComponent(code)}`);
}

/** Top-level GET after the ACS — here the session cookie IS sent, so we can persist. */
async function handleFinish(ctx: any, urlObj: any, contextId: string): Promise<void> {
    const { req, res } = ctx;
    if (!ctx.session) return endHtml(res, 401, "No session — reload the viewer and sign in again.");
    const parked = takeResult(urlObj.searchParams.get("code"));
    if (!parked || parked.contextId !== normalizeContextId(contextId)) {
        return endHtml(res, 400, `Sign-in link expired or already used. <a href="/">Return</a>.`);
    }
    saveSession(ctx, contextId, parked.state);
    return completeLogin(req, ctx, contextId, parked.relay);
}

/**
 * Single Logout. Three shapes arrive here:
 *  - no SAML parameter  → SP-initiated: build a LogoutRequest for the IdP.
 *  - SAMLRequest        → IdP-initiated logout: validate, clear, answer.
 *  - SAMLResponse       → the IdP's answer to our LogoutRequest: clear, return.
 */
async function handleSlo(ctx: any, urlObj: any, contextId: string, prefix: string): Promise<void> {
    const { req, res } = ctx;
    const cfg = getContextConfig(ctx, contextId);
    const sp = await spFor(ctx, contextId, spUrlsFor(req, ctx, prefix, contextId));
    const isPost = String(req.method || "GET").toUpperCase() === "POST";
    const body = isPost ? await readFormBody(req) : {};
    const params: Record<string, string> = isPost
        ? body
        : Object.fromEntries(urlObj.searchParams.entries());

    // SP-initiated: nothing from the IdP yet.
    if (!params.SAMLRequest && !params.SAMLResponse) {
        const state = ctx.session ? readSession(ctx, contextId) : null;
        const payload = {
            contextId: normalizeContextId(contextId),
            returnTo: safeReturn(req, ctx, urlObj.searchParams.get("return")),
            display: (urlObj.searchParams.get("display") === "popup" ? "popup" : "redirect") as "popup" | "redirect",
        };
        if (ctx.session) clearSession(ctx, contextId);            // local session goes first
        if (!state || !state.nameID) return completeLogin(req, ctx, contextId, payload);
        return redirect(res, await sp.getLogoutUrlAsync(logoutProfileOf(cfg, state) as any, signRelayState(cfg, payload), {}));
    }

    // IdP-initiated logout request.
    if (params.SAMLRequest) {
        const validated = isPost
            ? await sp.validatePostRequestAsync({ SAMLRequest: params.SAMLRequest })
            : await sp.validateRedirectAsync(params as any, urlObj.search.replace(/^\?/, ""));
        // A cross-site POST has no session cookie, so clearing is best-effort here;
        // the HTTP-Redirect binding (a top-level GET) does carry the cookie.
        if (ctx.session) clearSession(ctx, contextId);
        if (validated?.profile) {
            // RelayState on an IdP-initiated request is the IdP's, not ours — echo it back verbatim.
            return redirect(res, await sp.getLogoutResponseUrlAsync(validated.profile as any, params.RelayState || "", {}, true));
        }
        return endHtml(res, 200, `Signed out. <a href="/">Return</a>.`);
    }

    // The IdP's LogoutResponse to our own LogoutRequest.
    if (isPost) await sp.validatePostResponseAsync({ SAMLResponse: params.SAMLResponse });
    else await sp.validateRedirectAsync(params as any, urlObj.search.replace(/^\?/, ""));
    if (ctx.session) clearSession(ctx, contextId);
    return completeLogin(req, ctx, contextId, verifyRelayState(cfg, params.RelayState));
}

async function handleRoute(ctx: any, urlObj: any, prefix: string): Promise<void> {
    const { res } = ctx;
    const sub = urlObj.pathname.slice(prefix.length);        // "/login/<ctx>" | "/acs/<ctx>" | …
    const parts = sub.split("/").filter(Boolean);
    const action = parts[0];
    const contextId = parts[1] ? decodeURIComponent(parts[1]) : "";

    try { getContextConfig(ctx, contextId); }
    catch { return endHtml(res, 404, `Unknown SAML context '${normalizeContextId(contextId)}'.`); }

    try {
        switch (action) {
            case "metadata": return await handleMetadata(ctx, contextId, prefix);
            case "login":    return await handleLogin(ctx, urlObj, contextId, prefix);
            case "acs":      return await handleAcs(ctx, contextId, prefix);
            case "finish":   return await handleFinish(ctx, urlObj, contextId);
            case "slo":      return await handleSlo(ctx, urlObj, contextId, prefix);
            default:         return endHtml(res, 404, "Not found.");
        }
    } catch (e: any) {
        // Log the reason, never the assertion or the token.
        console.error(`[saml-auth] ${action} failed for context '${normalizeContextId(contextId)}':`, e?.message || e);
        return endHtml(res, 400, `SAML sign-in failed. <a href="/">Return</a>.`);
    }
}

/**
 * Boot hook: mount the routes. No verifier is registered — the token we mint is
 * HS256, so the operator enables core's built-in "jwt" verifier for the context
 * with the same secret (see README.md).
 */
export function register(serverApi: any): void {
    serverApi.registerServerRoute(ROUTE_PREFIX, (ctx: any, urlObj: any, prefix: string) => handleRoute(ctx, urlObj, prefix));
}

// ── Session-scoped RPC: the client pulls the current token into XOpatUser ─────
export const policy = {
    listContexts: { auth: { public: false, requireSession: true }, runtime: { timeoutMs: 3_000, maxBodyBytes: 2 * 1024 } },
    getToken:     { auth: { public: false, requireSession: true }, runtime: { timeoutMs: 8_000, maxBodyBytes: 8 * 1024 } },
    logout:       { auth: { public: false, requireSession: true }, runtime: { timeoutMs: 4_000, maxBodyBytes: 4 * 1024 } },
} as const;

/** Public per-context client-behavior flags (NO secrets, no IdP endpoints). */
export async function listContexts(ctx: any): Promise<any> {
    const contexts = [];
    for (const contextId of listContextIds(ctx)) {
        let cfg: any;
        try { cfg = getContextConfig(ctx, contextId); } catch { continue; }
        contexts.push({
            contextId,
            autoLogin: cfg.autoLogin === true,
            serviceName: cfg.serviceName || contextId,
            flow: cfg.flow === "redirect" ? "redirect" : "popup",   // login UX; popup keeps the workspace
            sloEnabled: !!(cfg.logoutUrl || cfg.idpMetadataUrl),
        });
    }
    return { contexts };
}

export async function getToken(ctx: any, input: any = {}): Promise<any> {
    const { contextId } = input || {};
    if (!contextId) throw new Error("getToken requires contextId.");
    getContextConfig(ctx, contextId);       // 404-equivalent for an unknown context
    return currentToken(ctx, contextId) || { token: null, expiresIn: null };
}

export async function logout(ctx: any, input: any = {}): Promise<any> {
    const { contextId } = input || {};
    if (contextId) clearSession(ctx, contextId);
    return { ok: true };
}
