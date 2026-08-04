// Shared server-side SAML 2.0 helpers for the saml-auth module. Everything that
// touches the IdP certificate, the SP private key or the token signing secret
// lives here (server-only); the browser only ever receives a short-lived HS256
// token minted from a validated assertion.
//
// Config: server.secure.modules["saml-auth"].contexts.<ctx> — see README.md.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";

// These three are loaded through createRequire, NOT a static import, on purpose.
// The server-module-loader bundles us with esbuild as `format: "esm"`, and
// node-saml pulls in `debug`, which does `require("tty")` at load time — a
// dynamic require of a builtin, which esbuild cannot express in ESM output and
// which therefore throws "Dynamic require of \"tty\" is not supported" the moment
// the bundle is imported (the whole module then 404s every RPC). Requiring them
// at runtime keeps them OUT of the bundle and lets Node resolve them normally
// from the hoisted node_modules. Do not "tidy" these back into imports.
const _require = createRequire(import.meta.url);
const { SAML } = _require("@node-saml/node-saml");
const { DOMParser } = _require("@xmldom/xmldom");
const xpath = _require("xpath");

/** node-saml's SAML instance — typed loosely because it is required at runtime. */
type SamlSp = any;

const MODULE_ID = "saml-auth";

const SAML_NS = {
    md: "urn:oasis:names:tc:SAML:2.0:metadata",
    ds: "http://www.w3.org/2000/09/xmldsig#",
};
const BINDING_REDIRECT = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";
const BINDING_POST = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";

/** Common attribute names an IdP may use, tried in order when unmapped. */
const DEFAULT_ATTRIBUTE_CANDIDATES: Record<string, string[]> = {
    name: [
        "displayName", "cn", "urn:oid:2.16.840.1.113730.3.1.241", "urn:oid:2.5.4.3",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
    ],
    email: [
        "email", "mail", "urn:oid:0.9.2342.19200300.100.1.3",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
    ],
    groups: [
        "groups", "memberOf", "eduPersonAffiliation", "urn:oid:1.3.6.1.4.1.5923.1.1.1.1",
        "http://schemas.xmlsoap.org/claims/Group",
    ],
};

export interface SamlSessionState {
    /** Claims we minted the token from — lets us re-mint without an IdP round-trip. */
    claims: Record<string, any>;
    /** Kept for Single Logout (the IdP needs both to terminate the right session). */
    nameID: string | null;
    nameIDFormat: string | null;
    sessionIndex: string | null;
    /** Absolute ms after which we stop re-minting and require an interactive login. */
    sessionExpiresAt: number;
    token: string | null;
    tokenExpiresAt: number;
}

/**
 * Canonical default-context id. The default/main context may be written in JSON
 * as an empty string, null, omitted, or the literal "core" (all equivalent),
 * matching XOpatUser/XOpatAuth on the client. Sub-context ids pass through.
 */
export function normalizeContextId(contextId: string | null | undefined): string {
    return contextId || "core";
}

function secureModuleConfig(ctx: any): any {
    const helper = (globalThis as any).XOPAT_SERVER?.getSecureModuleConfig;
    if (typeof helper === "function") {
        try {
            // The helper returns {} (not undefined) when it finds nothing, and {} is
            // truthy — accepting it would swallow the raw-tree fallback below and
            // leave us with zero contexts, i.e. a silently login-less deployment.
            const cfg = helper(ctx, MODULE_ID);
            if (cfg && Object.keys(cfg).length) return cfg;
        } catch { /* fall through to the raw secure tree */ }
    }
    const secure = ctx?.secure || ctx?.core?.CORE?.server?.secure || {};
    return (secure.modules && secure.modules[MODULE_ID]) || {};
}

/** All context ids declared by the operator, emitted in canonical form. */
export function listContextIds(ctx: any): string[] {
    const contexts = secureModuleConfig(ctx).contexts || {};
    const seen = new Set<string>();
    for (const raw of Object.keys(contexts)) seen.add(normalizeContextId(raw));
    return [...seen];
}

export function getContextConfig(ctx: any, contextId: string): any {
    const contexts = secureModuleConfig(ctx).contexts || {};
    // Resolve the default context regardless of how the operator keyed it in JSON
    // ("" / "core" / "default"), while an explicit sub-context matches exactly.
    const norm = normalizeContextId(contextId);
    const candidates = norm === "core" ? [contextId, "core", "", "default"] : [contextId];
    for (const k of candidates) {
        if (k != null && Object.prototype.hasOwnProperty.call(contexts, k)) return contexts[k];
    }
    throw new Error(`No server SAML config for context '${norm}'.`);
}

// ── Token signing secret ─────────────────────────────────────────────────────
/**
 * The HS256 key the minted token is signed with — the SAME value the operator
 * configures on the core "jwt" verifier. Fails CLOSED: we never mint an
 * unsigned or default-secret token (AGENTS.md §7).
 */
export function tokenSecret(cfg: any): string {
    const token = cfg.token || {};
    const secret = token.secretEnv ? process.env[token.secretEnv] : token.secret;
    if (!secret) {
        throw new Error(
            "saml-auth: context is missing a token signing secret " +
            "(set contexts.<ctx>.token.secretEnv or .token.secret)."
        );
    }
    return String(secret);
}

// ── IdP metadata (optional alternative to an inline idpCert) ─────────────────
interface IdpDescriptor { idpCert: string[]; entryPoint?: string; logoutUrl?: string; idpIssuer?: string }
const metadataCache = new Map<string, { doc: IdpDescriptor; at: number }>();

function pickLocation(nodes: any[], binding: string): string | undefined {
    for (const n of nodes) {
        if (n.getAttribute("Binding") === binding) return n.getAttribute("Location") || undefined;
    }
    return undefined;
}

async function loadIdpMetadata(url: string): Promise<IdpDescriptor> {
    if (!/^https?:\/\//.test(url)) throw new Error("saml-auth: 'idpMetadataUrl' must be an http(s) URL.");
    const cached = metadataCache.get(url);
    if (cached && Date.now() - cached.at < 3600_000) return cached.doc;

    const fetchImpl = (globalThis as any).XOPAT_SERVER?.safeFetch || fetch;
    const res = await fetchImpl(url, { headers: { Accept: "application/samlmetadata+xml, application/xml, text/xml" } });
    if (!res.ok) throw new Error(`saml-auth: IdP metadata fetch failed: ${res.status}`);
    const xml = await res.text();

    const dom = new DOMParser().parseFromString(xml, "text/xml");
    const select = xpath.useNamespaces(SAML_NS);
    const idpNode = select("//md:IDPSSODescriptor", dom as any)[0] as any;
    if (!idpNode) throw new Error("saml-auth: IdP metadata has no IDPSSODescriptor.");

    const certs = (select(".//ds:X509Certificate", idpNode) as any[])
        .map((n) => String(n.textContent || "").replace(/\s+/g, ""))
        .filter(Boolean);
    if (!certs.length) throw new Error("saml-auth: IdP metadata carries no X509Certificate.");

    const ssoNodes = select("./md:SingleSignOnService", idpNode) as any[];
    const sloNodes = select("./md:SingleLogoutService", idpNode) as any[];
    const entityNode = select("//md:EntityDescriptor", dom as any)[0] as any;

    const doc: IdpDescriptor = {
        idpCert: certs,
        entryPoint: pickLocation(ssoNodes, BINDING_REDIRECT) || pickLocation(ssoNodes, BINDING_POST),
        logoutUrl: pickLocation(sloNodes, BINDING_REDIRECT) || pickLocation(sloNodes, BINDING_POST),
        idpIssuer: entityNode?.getAttribute("entityID") || undefined,
    };
    metadataCache.set(url, { doc, at: Date.now() });
    return doc;
}

// ── Service Provider instances (cached per context + origin) ─────────────────
const spCache = new Map<string, SamlSp>();

export interface SpUrls { callbackUrl: string; logoutCallbackUrl: string }

/**
 * Build (or reuse) the SAML SP for a context. Signature checking and the
 * audience restriction are ON unless the operator explicitly opts out, and the
 * IdP material must be present — we refuse to construct an SP that would accept
 * an unverifiable assertion.
 */
export async function spFor(ctx: any, contextId: string, urls: SpUrls): Promise<SamlSp> {
    const cfg = getContextConfig(ctx, contextId);
    const key = `${normalizeContextId(contextId)}\n${urls.callbackUrl}`;
    const cached = spCache.get(key);
    if (cached) return cached;

    if (!cfg.issuer) throw new Error("saml-auth: context is missing 'issuer' (the SP entityID).");

    let idpCert: string | string[] | undefined = cfg.idpCert;
    let entryPoint: string | undefined = cfg.entryPoint;
    let logoutUrl: string | undefined = cfg.logoutUrl;
    let idpIssuer: string | undefined = cfg.idpIssuer;
    if (cfg.idpMetadataUrl) {
        const meta = await loadIdpMetadata(cfg.idpMetadataUrl);
        idpCert = idpCert || meta.idpCert;
        entryPoint = entryPoint || meta.entryPoint;
        logoutUrl = logoutUrl || meta.logoutUrl;
        idpIssuer = idpIssuer || meta.idpIssuer;
    }
    if (!idpCert || (Array.isArray(idpCert) && !idpCert.length)) {
        throw new Error("saml-auth: context is missing 'idpCert' (or a usable 'idpMetadataUrl').");
    }
    if (!entryPoint) throw new Error("saml-auth: context is missing 'entryPoint' (the IdP SSO URL).");

    // Default the audience to our own entityID: an assertion minted for someone
    // else must not be accepted here. `audience: false` disables the check and is
    // an explicit, logged operator decision.
    let audience: string | false = cfg.audience === undefined ? cfg.issuer : cfg.audience;
    if (audience === false) {
        console.warn(`[saml-auth] context '${normalizeContextId(contextId)}' runs with the audience restriction DISABLED.`);
    }

    const sp = new SAML({
        // Identity of both ends
        issuer: cfg.issuer,
        idpCert: idpCert as any,
        idpIssuer,
        entryPoint,
        audience,
        // Our endpoints
        callbackUrl: urls.callbackUrl,
        logoutUrl: logoutUrl || "",
        logoutCallbackUrl: urls.logoutCallbackUrl,
        // Signing material for AuthnRequest / LogoutRequest (optional but recommended)
        privateKey: cfg.privateKey,
        publicCert: cfg.publicCert,
        signatureAlgorithm: cfg.signatureAlgorithm || "sha256",
        digestAlgorithm: cfg.digestAlgorithm || "sha256",
        signMetadata: cfg.signMetadata === true,
        // Verification policy — closed by default
        wantAssertionsSigned: cfg.wantAssertionsSigned !== false,
        wantAuthnResponseSigned: cfg.wantAuthnResponseSigned !== false,
        // Bind every response to a request WE issued. Unsolicited (IdP-initiated)
        // responses are only tolerated when the operator opted in.
        validateInResponseTo: cfg.allowIdpInitiated === true ? "ifPresent" as any : "always" as any,
        requestIdExpirationPeriodMs: numberOr(cfg.requestTtlSec, 600) * 1000,
        acceptedClockSkewMs: numberOr(cfg.clockSkewSec, 60) * 1000,
        maxAssertionAgeMs: numberOr(cfg.maxAssertionAgeSec, 0) * 1000,
        // Request shape
        identifierFormat: cfg.identifierFormat === undefined
            ? "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified"
            : cfg.identifierFormat,
        disableRequestedAuthnContext: cfg.disableRequestedAuthnContext !== false,
        racComparison: cfg.racComparison || "exact",
        forceAuthn: cfg.forceAuthn === true,
        authnRequestBinding: cfg.authnRequestBinding || "HTTP-Redirect",
        decryptionPvk: cfg.decryptionPvk || cfg.privateKey,
    } as any);

    spCache.set(key, sp);
    return sp;
}

function numberOr(value: any, fallback: number): number {
    return typeof value === "number" && isFinite(value) ? value : fallback;
}

// ── RelayState: signed, so the IdP round-trip cannot forge our return target ──
export interface RelayPayload { contextId: string; returnTo: string; display: "popup" | "redirect" }

export function b64url(buf: Buffer): string {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signRelayState(cfg: any, payload: RelayPayload): string {
    const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
    const mac = b64url(createHmac("sha256", tokenSecret(cfg)).update(body).digest());
    return `${body}.${mac}`;
}

/** Returns null for anything we did not sign — the caller then uses safe defaults. */
export function verifyRelayState(cfg: any, relay: string | null | undefined): RelayPayload | null {
    if (!relay || typeof relay !== "string") return null;
    const dot = relay.lastIndexOf(".");
    if (dot <= 0) return null;
    const body = relay.slice(0, dot);
    const mac = relay.slice(dot + 1);
    let expected: string;
    try { expected = b64url(createHmac("sha256", tokenSecret(cfg)).update(body).digest()); }
    catch { return null; }
    const a = Buffer.from(mac, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")); }
    catch { return null; }
}

// ── Assertion replay cache ───────────────────────────────────────────────────
// node-saml already binds SP-initiated responses to a request id (one-time use).
// This is the second line of defence, and the ONLY one for IdP-initiated flows
// where there is no InResponseTo to consume.
const seenAssertions = new Map<string, number>();

export function assertAssertionUnseen(assertionId: string | null | undefined, ttlMs: number): void {
    const now = Date.now();
    if (seenAssertions.size > 5000) {
        for (const [k, exp] of seenAssertions) if (exp <= now) seenAssertions.delete(k);
    }
    if (!assertionId) throw new Error("Assertion has no ID — refusing (cannot detect replay).");
    const known = seenAssertions.get(assertionId);
    if (known && known > now) throw new Error("Assertion replay detected.");
    seenAssertions.set(assertionId, now + Math.max(60_000, ttlMs));
}

/** The assertion id, dug out of the parsed assertion node-saml hands back. */
export function assertionIdOf(profile: any): string | null {
    try { return profile?.getAssertion?.()?.Assertion?.$?.ID || null; }
    catch { return null; }
}

// ── One-time ACS → finish hand-off ───────────────────────────────────────────
// The IdP POSTs the assertion cross-site, so the SameSite=Lax session cookie is
// NOT sent with it. We park the result under a single-use code and bounce the
// browser through a top-level GET, which does carry the cookie.
const HANDOFF_TTL_MS = 60_000;
const handoff = new Map<string, { payload: any; exp: number }>();

export function parkResult(payload: any): string {
    const now = Date.now();
    for (const [k, v] of handoff) if (v.exp <= now) handoff.delete(k);
    const code = b64url(randomBytes(24));
    handoff.set(code, { payload, exp: now + HANDOFF_TTL_MS });
    return code;
}

export function takeResult(code: string | null | undefined): any | null {
    if (!code) return null;
    const entry = handoff.get(code);
    if (!entry) return null;
    handoff.delete(code);                       // single use
    return entry.exp > Date.now() ? entry.payload : null;
}

// ── Session-backed token store ───────────────────────────────────────────────
function store(ctx: any): Record<string, SamlSessionState> {
    if (!ctx.session) throw new Error("No xOpat session for the SAML flow.");
    if (!ctx.session.__saml) ctx.session.__saml = { sessions: {} };
    return ctx.session.__saml.sessions;
}

export function saveSession(ctx: any, contextId: string, state: SamlSessionState): void {
    store(ctx)[normalizeContextId(contextId)] = state;
}
export function readSession(ctx: any, contextId: string): SamlSessionState | null {
    return store(ctx)[normalizeContextId(contextId)] || null;
}
export function clearSession(ctx: any, contextId: string): void {
    delete store(ctx)[normalizeContextId(contextId)];
}

// ── Claims + HS256 token ─────────────────────────────────────────────────────
function firstAttribute(profile: any, names: string[]): any {
    for (const n of names) {
        const v = profile?.[n];
        if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
}

/** Map a validated SAML profile onto the claim set we sign. */
export function profileToClaims(cfg: any, profile: any): Record<string, any> {
    const map = cfg.attributeMap || {};
    const pick = (key: string) => (map[key]
        ? firstAttribute(profile, [map[key]])
        : firstAttribute(profile, DEFAULT_ATTRIBUTE_CANDIDATES[key] || []));

    const sub = (map.sub ? firstAttribute(profile, [map.sub]) : undefined) || profile?.nameID;
    if (!sub) throw new Error("Assertion carries no usable subject (NameID).");

    const groups = pick("groups");
    const claims: Record<string, any> = {
        sub: String(sub),
        name: pick("name") ? String(pick("name")) : undefined,
        email: pick("email") ? String(pick("email")) : undefined,
        groups: groups === undefined ? undefined : (Array.isArray(groups) ? groups.map(String) : [String(groups)]),
    };
    for (const extra of (cfg.extraClaims || [])) {
        const v = firstAttribute(profile, [extra]);
        if (v !== undefined) claims[extra] = v;
    }
    for (const k of Object.keys(claims)) if (claims[k] === undefined) delete claims[k];
    return claims;
}

/**
 * HS256. Verified by our own "saml" verifier (register.server.ts) — and, since
 * the shape is a plain HS256 JWT, also by core's generic "jwt" verifier when an
 * operator points it at the same secret (legacy path).
 *
 * Whatever changes here MUST change in {@link verifySamlToken} too: the two are
 * the two halves of one contract and live in this file precisely so they cannot
 * drift.
 */
export function mintToken(cfg: any, claims: Record<string, any>): { token: string; expiresAt: number } {
    const token = cfg.token || {};
    const ttlSec = numberOr(token.ttlSec, 3600);
    const nowSec = Math.floor(Date.now() / 1000);
    const payload: Record<string, any> = {
        ...claims,
        iss: token.issuer || "xopat-saml",
        iat: nowSec,
        nbf: nowSec,
        exp: nowSec + ttlSec,
    };
    if (token.audience) payload.aud = token.audience;

    const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf8"));
    const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
    const sig = b64url(createHmac("sha256", tokenSecret(cfg)).update(`${header}.${body}`).digest());
    return { token: `${header}.${body}.${sig}`, expiresAt: (nowSec + ttlSec) * 1000 };
}

/**
 * The inverse of {@link mintToken}: verify a token THIS module issued for
 * `contextId`, using this module's own per-context config.
 *
 * This is what lets the operator write `verifiers: { "saml": {} }` instead of
 * hand-copying the signing secret into a second `jwt` verifier block — the
 * minting and verifying halves read the same `contexts.<ctx>.token.*` entry, so
 * issuer/audience/secret cannot drift apart.
 *
 * Fails CLOSED at every step: unknown context, missing secret (`tokenSecret`),
 * bad signature/exp/iss/aud, or a token with no subject all throw.
 */
export function verifySamlToken(ctx: any, contextId: string, token: string): Record<string, any> {
    const cfg = getContextConfig(ctx, contextId);   // throws for an unknown context
    const tokenCfg = cfg.token || {};

    const verify = (globalThis as any).XOPAT_SERVER?.verifyJwtToken;
    if (typeof verify !== "function") {
        throw new Error("saml-auth: core does not expose XOPAT_SERVER.verifyJwtToken; cannot verify.");
    }

    // Mirror mintToken's defaults exactly: `iss` falls back to "xopat-saml",
    // and `aud` is only asserted when the operator configured an audience.
    const payload = verify(token, {
        secret: tokenSecret(cfg),
        issuer: tokenCfg.issuer || "xopat-saml",
        audience: tokenCfg.audience || undefined,
        clockSkewSec: numberOr(cfg.clockSkewSec, 60),
    });

    // profileToClaims always sets `sub`, so its absence means the token was not
    // minted by this module (or by this context) even if the secret matched.
    if (!payload || typeof payload.sub !== "string" || !payload.sub) {
        throw new Error("saml-auth: token carries no subject claim.");
    }
    return payload;
}

/**
 * Which SAML context a verifier entry applies to. Operator config wins over the
 * request: `meta.contextId` comes from the RPC body and is a client claim, so it
 * may only pick the context when the operator did not pin one.
 */
export function resolveVerifierContextId(verifierConfig: any, meta: any): string {
    return normalizeContextId(verifierConfig?.contextId || meta?.contextId);
}

/**
 * The browser-facing token for a context. Re-mints from the stored claims when
 * the current one is about to expire — SAML has no refresh_token, so this is
 * what keeps a long viewer session alive without bouncing through the IdP.
 * Once the SAML session itself is over, we stop and interactive login is needed.
 */
export function currentToken(ctx: any, contextId: string): { token: string; expiresIn: number } | null {
    const state = readSession(ctx, contextId);
    if (!state) return null;
    const now = Date.now();
    if (state.sessionExpiresAt && now >= state.sessionExpiresAt) {
        clearSession(ctx, contextId);
        return null;
    }
    if (!state.token || now >= state.tokenExpiresAt - 60_000) {
        const cfg = getContextConfig(ctx, contextId);
        const minted = mintToken(cfg, state.claims);
        state.token = minted.token;
        state.tokenExpiresAt = minted.expiresAt;
        saveSession(ctx, contextId, state);
    }
    return { token: state.token!, expiresIn: Math.max(0, Math.floor((state.tokenExpiresAt - now) / 1000)) };
}

/** Build the session state from a freshly validated assertion. */
export function sessionFromProfile(cfg: any, profile: any): SamlSessionState {
    const claims = profileToClaims(cfg, profile);
    const minted = mintToken(cfg, claims);
    return {
        claims,
        nameID: profile?.nameID ?? null,
        nameIDFormat: profile?.nameIDFormat ?? null,
        sessionIndex: profile?.sessionIndex ?? null,
        sessionExpiresAt: Date.now() + numberOr(cfg.sessionTtlSec, 28800) * 1000,
        token: minted.token,
        tokenExpiresAt: minted.expiresAt,
    };
}

/** The Profile shape node-saml needs to build a LogoutRequest for this session. */
export function logoutProfileOf(cfg: any, state: SamlSessionState): any {
    return {
        issuer: cfg.idpIssuer || cfg.issuer,
        nameID: state.nameID,
        nameIDFormat: state.nameIDFormat,
        sessionIndex: state.sessionIndex,
    };
}
