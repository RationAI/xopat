// Server side of the saml-auth provider. Loaded once at boot (core calls
// `register(serverApi)`) to mount the SAML HTTP routes; also exposes
// listContexts/getToken/logout RPC (session-scoped) so the client can pull the
// current token into XOpatUser.
//
// The IdP certificate, the SP private key and the token signing secret never
// leave the server — the browser only receives a short-lived HS256 token, which
// our own "saml" verifier checks. See src/AUTH.md + README.md.
import {
    normalizeContextId, listContextIds, getContextConfig, spFor, signRelayState, verifyRelayState,
    assertAssertionUnseen, assertionIdOf, parkResult, takeResult, saveSession, readSession,
    clearSession, currentToken, sessionFromProfile, logoutProfileOf,
    verifySamlToken, resolveVerifierContextId, mintLogoutNonce, takeLogoutNonce,
} from "./saml-flow";

const ROUTE_PREFIX = "/auth/saml";
const MAX_BODY_BYTES = 512 * 1024;      // a SAMLResponse is base64 XML: big, but bounded

/** Core logging broker channel (`module.saml-auth`); console only if core is older. */
function samlLog(): any {
    return (globalThis as any).XOPAT_SERVER?.log?.("module.saml-auth") || {
        warn: (...a: any[]) => console.warn("[saml-auth]", ...a),
        error: (...a: any[]) => console.error("[saml-auth]", ...a),
        info: (...a: any[]) => console.log("[saml-auth]", ...a),
        debug: () => {},
    };
}

/**
 * A status page. `body` must be a STATIC literal — never a request-derived
 * string. These pages render on the viewer's own origin, next to
 * XOPAT_CSRF_TOKEN and XOpatUser's in-memory secrets, so echoing an attacker's
 * path segment back here is a reflected XSS. Log the offending value instead.
 * If a page genuinely must render a dynamic value, take
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
try{var t=window.opener||window.parent;t&&t!==window&&t.postMessage({type:"xopat-saml:done",contextId:${cid}},${org});}catch(e){}
try{window.close();}catch(e){}
</script></body>`);
}
/**
 * Origins this deployment is willing to answer as, lowest-friction first:
 * an absolute `client.domain`, plus anything the operator listed under
 * `server.secure.modules["saml-auth"].allowedOrigins`.
 */
function declaredOrigins(ctx: any): string[] {
    const out: string[] = [];
    const domain = ctx?.core?.CORE?.client?.domain;
    if (typeof domain === "string" && /^https?:\/\//.test(domain)) out.push(domain.replace(/\/$/, ""));
    const declared = ctx?.core?.CORE?.server?.secure?.modules?.["saml-auth"]?.allowedOrigins
        ?? ctx?.secure?.modules?.["saml-auth"]?.allowedOrigins;
    if (Array.isArray(declared)) {
        for (const entry of declared) {
            if (typeof entry === "string" && /^https?:\/\//.test(entry)) out.push(entry.replace(/\/$/, ""));
        }
    }
    return out;
}

/**
 * The origin this SAML flow runs on.
 *
 * When the operator declared any origin, the request's Host / X-Forwarded-Host
 * is only honored if it matches one of them. That header is attacker-controlled
 * and this origin is not cosmetic: it becomes the SP `callbackUrl` signed into
 * the AuthnRequest, the `safeReturn` same-origin test, and the `postMessage`
 * target — so an unchecked Host lets a caller point an otherwise valid SAML
 * flow at a domain they control. With nothing declared (a dev box), the header
 * is still used, which is why `client.domain` should be set in production.
 */
function viewerOrigin(req: any, ctx: any): string {
    const allowed = declaredOrigins(ctx);
    if (allowed.length === 1) return allowed[0];

    const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
    const host = req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
    const derived = `${proto}://${host}`;
    if (!allowed.length) return derived;
    if (allowed.includes(derived)) return derived;
    // Degrade closed onto the first declared origin rather than trusting the
    // header — the flow still completes, just never on an origin we never agreed to.
    samlLog().warn(`request origin '${derived}' is not declared; using '${allowed[0]}'.`);
    return allowed[0];
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

    // SP-initiated: nothing from the IdP yet. This branch mutates our session and
    // can trigger an IdP-wide logout, and it is reachable by a cross-site top-level
    // GET (SameSite=Lax sends the cookie), so it needs a binding a third-party page
    // cannot produce: a single-use nonce from the session + CSRF gated `beginLogout`
    // RPC. The IdP-initiated branches below are authenticated by the signed SAML
    // message instead and take no nonce.
    if (!params.SAMLRequest && !params.SAMLResponse) {
        if (!takeLogoutNonce(ctx, urlObj.searchParams.get("n"))) {
            samlLog().warn(`SP-initiated SLO for context '${normalizeContextId(contextId)}' rejected: missing or stale nonce.`);
            return endHtml(res, 403, `This sign-out link is not valid. <a href="/">Return</a>.`);
        }
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
    // Decode inside a guard: a lone `%` raises URIError, which would otherwise
    // escape handleRoute as a generic 500.
    let rawContextId = "";
    try { rawContextId = parts[1] ? decodeURIComponent(parts[1]) : ""; }
    catch { return endHtml(res, 404, "Not found."); }
    const contextId = rawContextId;

    try { getContextConfig(ctx, contextId); }
    catch {
        // Static body: `contextId` is request-derived and this page renders on
        // our own origin (see endHtml).
        samlLog().warn(`unknown SAML context requested: ${JSON.stringify(rawContextId)}`);
        return endHtml(res, 404, "Unknown SAML context.");
    }

    // Server routes bypass the RPC gate entirely — no verifier, no CSRF check, and
    // `ctx.session` may be null. Anything that MUTATES session state therefore
    // needs its own binding, or a cross-site top-level GET (SameSite=Lax still
    // sends the cookie on those) becomes a forced-logout / state-clobber CSRF —
    // and under XOPAT_CROSS_SITE_COOKIES=true every method is cross-site reachable.
    //
    // `metadata` is public by nature (it IS the SP descriptor). `login` starts a
    // fresh flow and carries a signed RelayState. `acs` is the IdP's cross-site
    // POST and is authenticated by the signed assertion + InResponseTo + the
    // one-time assertion-id cache. `finish` and `slo` mutate our session, so they
    // require one.
    if ((action === "finish" || action === "slo") && !ctx.session) {
        return endHtml(res, 401, "No active session. <a href=\"/\">Return</a>.");
    }

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
        samlLog().error(`${action} failed for context '${normalizeContextId(contextId)}':`, e?.message || e);
        return endHtml(res, 400, `SAML sign-in failed. <a href="/">Return</a>.`);
    }
}

/** Bearer token off the request, or throw. */
function bearerOf(req: any): string {
    const header = req.headers["authorization"] || req.headers["Authorization"];
    if (!header || !String(header).startsWith("Bearer ")) throw new Error("Missing Bearer token");
    return String(header).slice("Bearer ".length).trim();
}

/**
 * The verifier callback receives `{req, core, ...}`, but saml-flow's config
 * readers want a ctx shaped like an RPC ctx (`ctx.secure` / `ctx.core`).
 */
function verifierCtx(core: any): any {
    return { core, secure: core?.CORE?.server?.secure };
}

/**
 * Verify a token this module minted, and map it onto the core principal shape.
 * `id` is the `sub` claim — i.e. `attributeMap.sub` or the assertion NameID —
 * which is the same value the client hands to `user.login(p.sub, …)`, so the
 * client-side and server-side identities agree by construction.
 */
function verifiedUser(core: any, verifierConfig: any, meta: any, token: string) {
    const contextId = resolveVerifierContextId(verifierConfig, meta);
    const claims = verifySamlToken(verifierCtx(core), contextId, token);
    return {
        contextId,
        claims,
        user: {
            id: String(claims.sub),
            name: claims.name,
            email: claims.email,
            groups: claims.groups,
            claims,
            via: "saml",
            contextId,
        },
    };
}

/**
 * Boot hook: mount the routes and register the verifiers.
 *
 * The verifier reads the signing secret from this module's own
 * `contexts.<ctx>.token.*` block, so the operator writes `verifiers: {"saml": {}}`
 * and never duplicates the secret. Core's generic "jwt" verifier pointed at the
 * same secret remains a working legacy alternative.
 */
export function register(serverApi: any): void {
    serverApi.registerServerRoute(ROUTE_PREFIX, (ctx: any, urlObj: any, prefix: string) => handleRoute(ctx, urlObj, prefix));

    serverApi.registerRpcAuthVerifier("saml", async ({ req, core, verifierConfig, meta }: any) => {
        const { claims, user } = verifiedUser(core, verifierConfig, meta, bearerOf(req));
        req.user = claims;              // raw claim set, parity with core's "jwt" verifier
        return { ok: true, user };
    });

    serverApi.registerProxyAuthVerifier("saml", async ({ req, core, upstream, verifierConfig }: any) => {
        const { claims } = verifiedUser(core, verifierConfig, null, bearerOf(req));
        req.user = claims;
        // Our token is an internal credential: never leak it upstream unless the
        // operator says the upstream expects it. Core builds `upstream.headers`
        // from an allowlist that omits `authorization`, so forwarding is an
        // explicit add; the delete stays as a scrub in case an earlier verifier
        // put one there.
        if (verifierConfig?.forward === true) {
            // bearerOf() strips the scheme; put it back for the wire.
            upstream.headers["authorization"] = `Bearer ${bearerOf(req)}`;
        } else {
            delete upstream.headers["authorization"];
            delete upstream.headers["Authorization"];
        }
        const userClaimHeader = verifierConfig?.userClaimHeader;
        if (userClaimHeader && claims.sub) {
            upstream.headers[String(userClaimHeader).toLowerCase()] = String(claims.sub);
        }
        return true;
    });
}

// ── Bootstrap RPC: the client pulls the current token into XOpatUser ──────────
//
// These three are `public: true` on purpose: **a login mechanism cannot be gated
// on its own outcome.** They carry no `contextId`, so they resolve against the
// MAIN verifier context — the very context SAML is there to establish. Gating
// them on it deadlocks a cold browser: `getToken` would need a valid SAML token
// in order to hand you the SAML token.
//
// They leak nothing. `listContexts` returns public client-behaviour flags only
// (no IdP endpoints, no certs, no secrets); `getToken` returns a token only for
// an assertion already bound to THIS server session, so it cannot mint identity
// for a caller who has not completed the IdP round-trip; `logout` is idempotent.
//
// `requireSession` stays true — the session is what binds the assertion — so
// these keep their CSRF protection.
export const policy = {
    listContexts: { auth: { public: true, requireSession: true }, runtime: { timeoutMs: 3_000, maxBodyBytes: 2 * 1024 } },
    getToken:     { auth: { public: true, requireSession: true }, runtime: { timeoutMs: 8_000, maxBodyBytes: 8 * 1024 } },
    logout:       { auth: { public: true, requireSession: true }, runtime: { timeoutMs: 4_000, maxBodyBytes: 4 * 1024 } },
    // Mints the single-use nonce that authorizes an SP-initiated `/slo/<ctx>`.
    // `requireSession: true` is what makes it CSRF-gated, which is the whole
    // point: the server route itself has no CSRF check.
    beginLogout:  { auth: { public: true, requireSession: true }, runtime: { timeoutMs: 3_000, maxBodyBytes: 2 * 1024 } },
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
    // Normalize: an omitted / "" / "default" id is the MAIN context, not
    // "nothing to do" — returning ok without clearing left a live session behind.
    clearSession(ctx, normalizeContextId((input || {}).contextId));
    return { ok: true };
}

/**
 * Authorize one SP-initiated single-logout. Returns a single-use nonce the
 * client appends as `?n=` when navigating to `/auth/saml/slo/<ctx>`.
 *
 * This RPC is session + CSRF gated; the server route is not. Without it, a
 * cross-site top-level GET would be a forced logout (see handleSlo).
 */
export async function beginLogout(ctx: any, input: any = {}): Promise<any> {
    const contextId = normalizeContextId((input || {}).contextId);
    getContextConfig(ctx, contextId);       // reject an unknown context
    return { nonce: mintLogoutNonce(ctx), contextId };
}
