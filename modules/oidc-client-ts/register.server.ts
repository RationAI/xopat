// Server-side registration for the "oidc" auth type. Core loads this ONCE at
// boot via XopatServerRuntime.loadServerExtensions and calls register(serverApi),
// keeping core auth-agnostic: the OIDC RS256/JWKS verifier lives here, in the
// module that provides OIDC. A future SAML module registers the same way.
// See src/AUTH.md.
import { createPublicKey, createVerify, type KeyObject } from "node:crypto";

const JWKS_TTL_MS = 60 * 60 * 1000;
const jwksCache = new Map<string, { keys: Map<string, KeyObject>; at: number }>();

function b64url(s: string): Buffer {
    return Buffer.from(s, "base64url");
}

const JWKS_FETCH_TIMEOUT_MS = 15 * 1000;

async function fetchJwks(jwksUri: string, safeFetch: any): Promise<Map<string, KeyObject>> {
    const doFetch = safeFetch || fetch;
    // Bound the request: an attacker can send tokens with arbitrary `kid` values to
    // force JWKS refetches (getKey below), so a slow/unresponsive JWKS endpoint must
    // not hang verification requests and exhaust server resources.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), JWKS_FETCH_TIMEOUT_MS);
    let res: any;
    try {
        res = await doFetch(jwksUri, { method: "GET", headers: { Accept: "application/json" }, signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const json = await res.json();
    const keys = new Map<string, KeyObject>();
    for (const jwk of (json.keys || [])) {
        if (!jwk.kid) continue;
        try { keys.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" as any })); } catch { /* skip unsupported */ }
    }
    return keys;
}

async function getKey(jwksUri: string, kid: string | undefined, safeFetch: any, force = false): Promise<KeyObject | null> {
    let entry = jwksCache.get(jwksUri);
    const fresh = entry && (Date.now() - entry.at) < JWKS_TTL_MS;
    if (force || !entry || !fresh || (kid && !entry.keys.has(kid))) {
        try { entry = { keys: await fetchJwks(jwksUri, safeFetch), at: Date.now() }; jwksCache.set(jwksUri, entry); }
        catch (e) { if (!entry) throw e; }
    }
    if (kid && entry!.keys.has(kid)) return entry!.keys.get(kid)!;
    return entry!.keys.size === 1 ? entry!.keys.values().next().value : null;
}

/** Verify an RS256 JWT (id/access token) against the IdP JWKS. */
async function verifyOidcToken(token: string, cfg: any, safeFetch: any): Promise<any> {
    if (!token) throw new Error("Missing Bearer token");
    if (!cfg.jwksUri) throw new Error("oidc verifier requires 'jwksUri'");
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid JWT format");
    const [h, p, s] = parts;
    let header: any, payload: any;
    try { header = JSON.parse(b64url(h).toString("utf8")); payload = JSON.parse(b64url(p).toString("utf8")); }
    catch { throw new Error("Failed to parse JWT header/payload"); }

    const algos = Array.isArray(cfg.algorithms) && cfg.algorithms.length ? cfg.algorithms : ["RS256"];
    if (!header.alg || !algos.includes(header.alg)) throw new Error(`Unsupported JWT alg '${header.alg}'`);
    if (header.alg !== "RS256") throw new Error(`oidc verifier: alg '${header.alg}' not implemented (RS256 only)`);

    const data = Buffer.from(`${h}.${p}`);
    const signature = b64url(s);
    const rsaVerify = (key: KeyObject | null) => {
        if (!key) return false;
        const v = createVerify("RSA-SHA256"); v.update(data); v.end();
        return v.verify(key, signature);
    };
    let ok = rsaVerify(await getKey(cfg.jwksUri, header.kid, safeFetch));
    if (!ok) ok = rsaVerify(await getKey(cfg.jwksUri, header.kid, safeFetch, true)); // key rotation retry
    if (!ok) throw new Error("Invalid JWT signature");

    const now = Math.floor(Date.now() / 1000);
    const skew = typeof cfg.clockSkewSec === "number" ? cfg.clockSkewSec : 60;
    // Fail CLOSED on missing claims (AGENTS.md §7): a token with no exp must not
    // be treated as non-expiring, and when an issuer/audience is configured an
    // absent iss/aud must not bypass the check (cross-audience substitution).
    if (typeof payload.exp !== "number") throw new Error("JWT missing 'exp'");
    if (now > payload.exp + skew) throw new Error("JWT has expired");
    if (typeof payload.nbf === "number" && now < payload.nbf - skew) throw new Error("JWT not yet valid");
    if (cfg.issuer && payload.iss !== cfg.issuer) throw new Error(`Unexpected JWT issuer '${payload.iss}'`);
    if (cfg.audience) {
        const exp = cfg.audience;
        const aud = payload.aud;
        const ok = Array.isArray(aud) ? aud.includes(exp) : aud === exp;
        if (!ok) throw new Error("JWT audience does not include expected value");
    }
    return payload;
}

const globalOidc = (core: any) => (core?.CORE?.server?.auth?.oidc) || {};

/**
 * Called once at boot with the core server API. Registers the "oidc" RS256/JWKS
 * verifier for both RPC and proxy. Verifier config comes from the per-context
 * `rpcVerifiers.<ctx>.verifiers.oidc` (or `proxies.<alias>.auth.jwt/oidc`) entry:
 * `{ jwksUri, issuer, audience, algorithms?, clockSkewSec?, forward?, userClaimHeader? }`.
 */
export function register(serverApi: any): void {
    const safeFetch = serverApi?.safeFetch;

    serverApi.registerProxyAuthVerifier("oidc", async ({ req, core, upstream, verifierConfig }: any) => {
        const authHeader = req.headers["authorization"] || req.headers["Authorization"];
        if (!authHeader || !authHeader.startsWith("Bearer ")) throw new Error("Missing Bearer token for oidc verifier");
        const token = authHeader.slice(7).trim();
        const payload = await verifyOidcToken(token, { ...globalOidc(core), ...(verifierConfig || {}) }, safeFetch);
        req.user = payload;
        const forward = ((verifierConfig || {}).forward ?? globalOidc(core).forward) === true;
        if (!forward) { delete upstream.headers["authorization"]; delete upstream.headers["Authorization"]; }
        const uch = (verifierConfig || {}).userClaimHeader || globalOidc(core).userClaimHeader;
        if (uch && payload.sub) upstream.headers[String(uch).toLowerCase()] = String(payload.sub);
        return true;
    });

    serverApi.registerRpcAuthVerifier("oidc", async ({ req, core, verifierConfig }: any) => {
        const authHeader = req.headers["authorization"] || req.headers["Authorization"];
        if (!authHeader || !authHeader.startsWith("Bearer ")) throw new Error("Missing Bearer token");
        const token = authHeader.slice(7).trim();
        const payload = await verifyOidcToken(token, { ...globalOidc(core), ...(verifierConfig || {}) }, safeFetch);
        req.user = payload;
        return { ok: true, user: payload };
    });
}
