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

const discoveryCache = new Map<string, { doc: any; at: number }>();
export async function discover(cfg: any): Promise<any> {
    const url = cfg.discoveryUrl || (String(cfg.issuer || "").replace(/\/$/, "") + "/.well-known/openid-configuration");
    if (!/^https?:\/\//.test(url)) throw new Error("OIDC context missing valid 'issuer'/'discoveryUrl'.");
    const c = discoveryCache.get(url);
    if (c && Date.now() - c.at < 3600_000) return c.doc;
    const res = await safeFetch()(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
    const doc = await res.json();
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

export function saveAuthState(ctx: any, contextId: string, state: string, verifier: string, returnTo: string, display: string = "redirect"): void {
    store(ctx).pending[state] = { contextId, verifier, returnTo, display, at: Date.now() };
}
export function takeAuthState(ctx: any, state: string): any {
    const p = store(ctx).pending;
    const v = p[state];
    if (v) delete p[state];
    return v || null;
}

function saveTokens(ctx: any, contextId: string, tok: any): void {
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
export async function currentTokens(ctx: any, contextId: string): Promise<any | null> {
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
export function clearTokens(ctx: any, contextId: string): void {
    delete store(ctx).tokens[contextId];
}

// ── RS256/JWKS verifier (self-contained; same approach as oidc-client-ts) ─────
const jwksCache = new Map<string, { keys: Map<string, KeyObject>; at: number }>();
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
