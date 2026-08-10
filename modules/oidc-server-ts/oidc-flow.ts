// Shared server-side OIDC flow helpers for the oidc-server-ts module. The
// client_secret + refresh_token live only here (on the server / xOpat session);
// only short-lived access/id tokens are ever handed to the browser. Config:
//   server.secure.modules["oidc-server-ts"].contexts.<ctx> =
//     { issuer | discoveryUrl, clientId, clientSecret, scope, authMethod }
import { createHash, randomBytes, createPublicKey, createVerify, type KeyObject } from "node:crypto";

function safeFetch(): any {
    return (globalThis as any).XOPAT_SERVER?.safeFetch || fetch;
}

/**
 * Bounded in-process cache from core (`server/STORAGE.md`). Values here are
 * `KeyObject`s and parsed discovery documents — not serializable, cheap to
 * refetch, so this is the `cache` surface rather than `storage`. Falls back to a
 * plain Map against a core that predates it.
 */
function boundedCache<V>(name: string, options: { maxEntries?: number; ttlMs?: number }): Map<string, V> {
    const create = (globalThis as any).XOPAT_SERVER?.cache?.create;
    if (typeof create === "function") return create({ name, ...options }) as any;
    return new Map<string, V>();
}

/**
 * Canonical default-context id. The default/main context may be written in JSON
 * as an empty string, null, omitted, or the literal "core" (all equivalent),
 * matching XOpatUser/XOpatAuth on the client. Sub-context ids pass through.
 */
export function normalizeContextId(contextId: string | null | undefined): string {
    return contextId || "core";
}

export function getContextConfig(ctx: any, contextId: string): any {
    const secure = ctx?.secure || ctx?.core?.CORE?.server?.secure || {};
    const mod = (secure.modules && secure.modules["oidc-server-ts"]) || {};
    const contexts = mod.contexts || {};
    // Resolve the default context regardless of how the operator keyed it in JSON
    // ("" / "core" / "default"), while an explicit sub-context matches exactly.
    const norm = normalizeContextId(contextId);
    const candidates = norm === "core" ? [contextId, "core", "", "default"] : [contextId];
    let cfg;
    for (const k of candidates) {
        if (k != null && Object.prototype.hasOwnProperty.call(contexts, k)) { cfg = contexts[k]; break; }
    }
    if (!cfg) throw new Error(`No server OIDC config for context '${contextId}'.`);
    return cfg;
}

// Keyed by an operator-configured discovery URL — small key space, but the TTL
// was only ever consulted on read, so entries for removed contexts stayed
// resident for the process lifetime.
const discoveryCache = boundedCache<{ doc: any; at: number }>(
    "oidc-server:discovery", { maxEntries: 32, ttlMs: 3600_000 });
/**
 * Endpoints from the discovery document must belong to the issuer we pinned.
 *
 * `safeFetch`'s SSRF guard blocks private/loopback destinations; it does not
 * stop "some other public host". Since postToken() sends the confidential
 * client_secret to `token_endpoint`, a substituted discovery document would
 * exfiltrate exactly the secret this module exists to keep server-side.
 */
function assertEndpointBelongsToIssuer(issuer: string, endpoint: any, what: string): void {
    if (typeof endpoint !== "string" || !endpoint) throw new Error(`IdP discovery has no ${what}`);
    let url: URL, iss: URL;
    try { url = new URL(endpoint); iss = new URL(issuer); }
    catch { throw new Error(`IdP discovery has a malformed ${what}`); }
    // Not a host-equality check: legitimate IdPs split these across hosts
    // (Google issues from accounts.google.com but tokens from oauth2.googleapis.com).
    // The binding that matters is the issuer equality check in discover(); here we
    // only refuse to downgrade the transport carrying the client_secret.
    if (url.protocol !== "https:" && iss.protocol === "https:") {
        throw new Error(`IdP discovery ${what} is not HTTPS`);
    }
}

export async function discover(cfg: any): Promise<any> {
    // The issuer must be configured: it is the value everything else is pinned
    // against, so deriving it from the document would be circular.
    const issuer = String(cfg.issuer || "").replace(/\/$/, "");
    if (!/^https?:\/\//.test(issuer)) throw new Error("OIDC context missing valid 'issuer'.");
    const url = cfg.discoveryUrl || (issuer + "/.well-known/openid-configuration");
    if (!/^https?:\/\//.test(url)) throw new Error("OIDC context missing valid 'issuer'/'discoveryUrl'.");
    const c = discoveryCache.get(url);
    if (c && Date.now() - c.at < 3600_000) return c.doc;
    const res = await safeFetch()(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
    const doc = await res.json();

    // OIDC Discovery §4.3 — the document must claim the issuer we asked for.
    // Validate BEFORE caching so a bad document is not remembered for an hour.
    const claimed = String(doc?.issuer || "").replace(/\/$/, "");
    if (claimed !== issuer) {
        throw new Error("OIDC discovery issuer does not match the configured issuer");
    }
    assertEndpointBelongsToIssuer(issuer, doc.authorization_endpoint, "authorization_endpoint");
    assertEndpointBelongsToIssuer(issuer, doc.token_endpoint, "token_endpoint");

    discoveryCache.set(url, { doc, at: Date.now() });
    return doc;
}

async function postToken(cfg: any, disco: any, params: URLSearchParams): Promise<any> {
    if (!disco.token_endpoint) throw new Error("IdP discovery has no token_endpoint");
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
    if (String(cfg.authMethod || "basic").toLowerCase() === "post") {
        if (cfg.clientId && !params.has("client_id")) params.set("client_id", cfg.clientId);
        params.set("client_secret", String(cfg.clientSecret || ""));
    } else {
        headers["Authorization"] = "Basic " + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
    }
    const res = await safeFetch()(disco.token_endpoint, { method: "POST", headers, body: params.toString() });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Token endpoint ${res.status}: ${json.error || ""} ${json.error_description || ""}`.trim());
    return json;
}

// ── Session-backed token + auth-state store (server-only) ────────────────────
function store(ctx: any): any {
    if (!ctx.session) throw new Error("No xOpat session for OIDC flow.");
    if (!ctx.session.__oidcServer) ctx.session.__oidcServer = { tokens: {}, pending: {} };
    return ctx.session.__oidcServer;
}

export function b64url(buf: Buffer): string {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function makeState(): string { return b64url(randomBytes(24)); }
export function makePkce(): { verifier: string; challenge: string } {
    const verifier = b64url(randomBytes(48));
    return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

/** Pending logins kept per session, and how long an unfinished one lingers. */
const MAX_PENDING_AUTH = 8;
const PENDING_AUTH_TTL_MS = 10 * 60_000;

/**
 * Park PKCE state for one in-flight login.
 *
 * Bounded and expiring, because an entry is only removed when its matching
 * callback arrives — and a login that is abandoned (user closes the tab, IdP
 * errors) never produces one. Every `GET …/login/<ctx>` therefore used to add a
 * permanent entry to the session, so a caller could grow their own session
 * record without limit, and the OIDC state rode along into whatever the session
 * store is bound to.
 */
export function saveAuthState(ctx: any, contextId: string, state: string, verifier: string, returnTo: string, display: string = "redirect"): void {
    const pending = store(ctx).pending;
    const now = Date.now();
    for (const [key, value] of Object.entries(pending) as [string, any][]) {
        if (!value || now - (value.at || 0) > PENDING_AUTH_TTL_MS) delete pending[key];
    }
    // Still over the cap after expiry: drop the oldest. A user with more than
    // MAX_PENDING_AUTH simultaneous unfinished logins has abandoned the earliest.
    const keys = Object.keys(pending);
    if (keys.length >= MAX_PENDING_AUTH) {
        keys.sort((a, b) => (pending[a]?.at || 0) - (pending[b]?.at || 0));
        for (const key of keys.slice(0, keys.length - MAX_PENDING_AUTH + 1)) delete pending[key];
    }
    pending[state] = { contextId, verifier, returnTo, display, at: now };
}
export function takeAuthState(ctx: any, state: string): any {
    const p = store(ctx).pending;
    const v = p[state];
    if (v) delete p[state];
    if (!v) return null;
    // An expired verifier must not complete a login: the callback it belongs to
    // is minutes stale, and the entry only survived because the sweep above is
    // write-triggered.
    if (Date.now() - (v.at || 0) > PENDING_AUTH_TTL_MS) return null;
    return v;
}

// Every token-store access goes through the canonical id. getContextConfig
// resolves "" / "core" / "default" to the same config, and listContexts emits
// "core", so keying the store by the raw path segment let one login store under
// "default" while the client asked for "core" — a permanent "not logged in".
function saveTokens(ctx: any, rawContextId: string, tok: any): void {
    const contextId = normalizeContextId(rawContextId);
    const t = store(ctx).tokens;
    const prev = t[contextId] || {};
    t[contextId] = {
        access_token: tok.access_token || prev.access_token || null,
        id_token: tok.id_token || prev.id_token || null,
        // Keep the existing refresh_token if the IdP didn't rotate it.
        refresh_token: tok.refresh_token || prev.refresh_token || null,
        expires_at: typeof tok.expires_in === "number" ? Date.now() + (tok.expires_in - 30) * 1000 : 0,
    };
}

export async function exchangeCode(ctx: any, contextId: string, code: string, verifier: string, redirectUri: string): Promise<void> {
    const cfg = getContextConfig(ctx, contextId);
    const disco = await discover(cfg);
    const params = new URLSearchParams();
    params.set("grant_type", "authorization_code");
    params.set("code", code);
    params.set("redirect_uri", redirectUri);
    if (verifier) params.set("code_verifier", verifier);
    if (cfg.clientId) params.set("client_id", cfg.clientId);
    saveTokens(ctx, contextId, await postToken(cfg, disco, params));
}

/** Return the current browser-safe tokens for a context, refreshing server-side if expired. */
export async function currentTokens(ctx: any, rawContextId: string): Promise<any | null> {
    const contextId = normalizeContextId(rawContextId);
    const t = store(ctx).tokens[contextId];
    if (!t) return null;
    if (t.expires_at && Date.now() >= t.expires_at && t.refresh_token) {
        const cfg = getContextConfig(ctx, contextId);
        const disco = await discover(cfg);
        const params = new URLSearchParams();
        params.set("grant_type", "refresh_token");
        params.set("refresh_token", t.refresh_token);
        if (cfg.clientId) params.set("client_id", cfg.clientId);
        saveTokens(ctx, contextId, await postToken(cfg, disco, params));
    }
    const cur = store(ctx).tokens[contextId];
    return {
        access_token: cur.access_token || null,
        id_token: cur.id_token || null,
        expires_in: cur.expires_at ? Math.max(0, Math.floor((cur.expires_at - Date.now()) / 1000)) : null,
    };
}
export function clearTokens(ctx: any, rawContextId: string): void {
    delete store(ctx).tokens[normalizeContextId(rawContextId)];
}

// ── RS256/JWKS verifier (self-contained; same approach as oidc-client-ts) ─────
const jwksCache = boundedCache<{ keys: Map<string, KeyObject>; at: number }>(
    "oidc-server:jwks", { maxEntries: 32, ttlMs: 3600_000 });
async function jwksKey(jwksUri: string, kid: string | undefined, force = false): Promise<KeyObject | null> {
    let e = jwksCache.get(jwksUri);
    if (force || !e || Date.now() - e.at > 3600_000 || (kid && !e.keys.has(kid))) {
        try {
            const res = await safeFetch()(jwksUri, { headers: { Accept: "application/json" } });
            if (!res.ok) throw new Error(`JWKS ${res.status}`);
            const json = await res.json();
            const keys = new Map<string, KeyObject>();
            for (const jwk of (json.keys || [])) {
                if (jwk.kid) { try { keys.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" as any })); } catch { /* skip */ } }
            }
            e = { keys, at: Date.now() }; jwksCache.set(jwksUri, e);
        } catch (err) { if (!e) throw err; }
    }
    if (kid && e!.keys.has(kid)) return e!.keys.get(kid)!;
    return e!.keys.size === 1 ? e!.keys.values().next().value : null;
}
export async function verifyToken(token: string, vcfg: any): Promise<any> {
    if (!token) throw new Error("Missing Bearer token");
    if (!vcfg.jwksUri) throw new Error("oidc-server verifier requires 'jwksUri'");
    const [h, p, sig] = token.split(".");
    if (!sig) throw new Error("Invalid JWT format");
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (header.alg !== "RS256") throw new Error(`oidc-server verifier: alg '${header.alg}' not supported (RS256 only)`);
    const data = Buffer.from(`${h}.${p}`);
    const signature = Buffer.from(sig, "base64url");
    const check = (k: KeyObject | null) => { if (!k) return false; const v = createVerify("RSA-SHA256"); v.update(data); v.end(); return v.verify(k, signature); };
    let ok = check(await jwksKey(vcfg.jwksUri, header.kid));
    if (!ok) ok = check(await jwksKey(vcfg.jwksUri, header.kid, true));
    if (!ok) throw new Error("Invalid JWT signature");
    const now = Math.floor(Date.now() / 1000);
    const skew = typeof vcfg.clockSkewSec === "number" ? vcfg.clockSkewSec : 60;
    // Fail CLOSED on missing claims (AGENTS.md §7). A token that simply omits
    // exp/iss/aud must not silently pass: no exp → never-expiring bearer; and
    // when an issuer/audience IS configured, an absent iss/aud enables cross-
    // audience token substitution against a shared JWKS. Require what we check.
    if (typeof payload.exp !== "number") throw new Error("JWT missing 'exp'");
    if (now > payload.exp + skew) throw new Error("JWT has expired");
    if (typeof payload.nbf === "number" && now < payload.nbf - skew) throw new Error("JWT not yet valid");
    if (vcfg.issuer && payload.iss !== vcfg.issuer) throw new Error(`Unexpected JWT issuer '${payload.iss}'`);
    if (vcfg.audience) {
        const a = payload.aud;
        const ok = Array.isArray(a) ? a.includes(vcfg.audience) : a === vcfg.audience;
        if (!ok) throw new Error("JWT audience mismatch");
    }
    return payload;
}
