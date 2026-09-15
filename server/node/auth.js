const {base64UrlToBuffer} = require("./utils");
const {getServerLogging} = require("./logging");
const nodeCrypto = require("node:crypto");

/**
 * Auth diagnostics on their own broker channel, so an operator can raise
 * `core.auth` without drowning in every other subsystem — the point of the
 * logging broker (`server/LOGGING.md`).
 *
 * Resolved per call, not at require time: this module is loaded before the
 * logging singleton is created, and a plain `console` fallback keeps the records
 * (installConsoleCapture routes them into the ring buffer either way).
 */
function authLog() {
    return getServerLogging()?.log("core.auth") || console;
}

/**
 * Constant-time string compare for secrets and signatures.
 *
 * `timingSafeEqual` throws on length mismatch — which would itself leak the
 * length — so hash both sides to a fixed width first and compare those.
 */
function timingSafeStringEqual(a, b) {
    const ha = nodeCrypto.createHash("sha256").update(String(a), "utf8").digest();
    const hb = nodeCrypto.createHash("sha256").update(String(b), "utf8").digest();
    return nodeCrypto.timingSafeEqual(ha, hb);
}

/**
 * CSRF token comparison. Same constant-time discipline as secret comparison —
 * the token is a bearer credential for state-changing requests, and `!==` on it
 * is the one remaining place a byte-at-a-time timing oracle applied.
 */
function csrfTokenMatches(provided, expected) {
    if (!provided || !expected) return false;
    return timingSafeStringEqual(provided, expected);
}

/**
 * The `server.auth` block.
 *
 * Server-built cores (`serverOnly`) keep it inline; client-bound cores have it
 * moved to `core.CORE_AUTH` by the strip in
 * `server/templates/javascript/core.js`, because it can carry a literal HMAC
 * `secret`. Read through this so a verifier works on either shape.
 */
function serverAuthConfig(core) {
    return (core && (core.CORE?.server?.auth || core.CORE_AUTH)) || {};
}

const proxyAuthVerifiers = Object.create(null);
const rpcAuthVerifiers = Object.create(null);

function registerProxyAuthVerifier(name, fn) {
    proxyAuthVerifiers[name] = fn;
}

function registerRpcAuthVerifier(name, fn) {
    rpcAuthVerifiers[name] = fn;
}

function getVerifierEntries(verifiers) {
    if (!verifiers) return [];
    if (Array.isArray(verifiers)) return verifiers.map(name => [name, {}]);
    if (typeof verifiers === "object") return Object.entries(verifiers);
    return [];
}

async function runVerifierSet(verifierRegistry, verifierEntries, mode, contextBuilder) {
    let passedCount = 0;
    let firstError = null;
    // Last *successful* verifier's return value + name. In "any" mode we return
    // on the first pass; in "all" mode every verifier must pass, and the last one
    // that produced a user wins (mirrors `req.user` being overwritten in order).
    let lastResult = null;
    let lastName = null;

    for (const [name, verifierConfig] of verifierEntries) {
        const verifier = verifierRegistry[name];
        if (!verifier) {
            firstError = firstError || new Error(`Unknown auth verifier '${name}'`);
            if (mode === "all") break;
            continue;
        }
        try {
            const result = await verifier(contextBuilder(name, verifierConfig || {}));
            const ok = result === undefined ? true : !!(result.ok === undefined ? result : result.ok);
            if (ok) {
                passedCount += 1;
                if (result && typeof result === "object" && result.user) {
                    lastResult = result;
                    lastName = name;
                } else if (lastResult === null) {
                    lastName = name;
                }
                if (mode === "any") {
                    return { ok: true, result, verifierName: name };
                }
            } else {
                firstError = firstError || new Error(`Verifier '${name}' failed`);
                if (mode === "all") break;
            }
        } catch (e) {
            firstError = firstError || e;
            if (mode === "all") break;
        }
    }

    const shouldPass =
        (mode === "all" && passedCount === verifierEntries.length) ||
        (mode === "any" && passedCount > 0);

    return { ok: shouldPass, error: firstError, result: lastResult, verifierName: lastName };
}

// ── The principal ────────────────────────────────────────────────────────────
//
// Claim → id precedence. `sub` first: it is the only claim an OIDC/SAML issuer
// guarantees stable and unique within the issuer. The rest are pragmatic
// fallbacks for IdPs that omit it (Azure `oid`/`upn`, legacy `email`).
const PRINCIPAL_CLAIMS = ["sub", "oid", "upn", "preferred_username", "email"];

const principalWarned = new Set();

/**
 * Normalize whatever a verifier returned into a user object carrying a stable
 * `id`. Verifiers are third-party plug-ins; requiring each of them to hand-roll
 * identity mapping is how one of them forgets. So core maps the common claims
 * centrally, while a verifier that knows better (SAML with a custom attribute
 * map, a module with a real user record) returns an explicit `user.id` and we
 * leave it alone.
 *
 * Fails CLOSED: a token from which no id can be derived yields `null`, not an
 * authenticated-but-anonymous user. Callers then degrade to a session principal.
 *
 * `raw` is spread first so existing readers of `ctx.user.sub` / `.email` /
 * `.groups` keep working — `id` is purely additive.
 */
function normalizePrincipalUser(raw, meta = {}) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id === "string" && raw.id) return raw;

    let id = null;
    for (const claim of PRINCIPAL_CLAIMS) {
        const value = raw[claim];
        if (typeof value === "string" && value.trim()) {
            id = value.trim();
            break;
        }
        if (typeof value === "number" && Number.isFinite(value)) {
            id = String(value);
            break;
        }
    }

    if (!id) {
        const key = meta.verifierName || "unknown";
        if (!principalWarned.has(key)) {
            principalWarned.add(key);
            authLog().warn(
                `[rpc-auth] verifier '${key}' produced no usable principal claim ` +
                `(looked for ${PRINCIPAL_CLAIMS.join(", ")}); treating the caller as unidentified.`
            );
        }
        return null;
    }

    return {
        ...raw,
        id,
        name: raw.name || raw.preferred_username || raw.given_name || undefined,
        email: raw.email || undefined,
        claims: raw,
        via: meta.verifierName,
        contextId: meta.contextId,
    };
}

// ── Proxy access policy ──────────────────────────────────────────────────────
//
// Two gates that run BEFORE the verifier set, because neither is about *who* the
// caller is:
//
//  - the per-session alias allowlist answers "may THIS session reach that alias",
//  - the credential gate answers "may this alias be reached with no auth at all".
//
// Both exist because session + CSRF is not authorization. A session is minted to
// any anonymous page load and the CSRF token is rendered into that page, so those
// two checks prove same-origin, nothing more. Without the gates below, an alias
// carrying an operator API key in `proxies.<alias>.headers` is an open relay to
// its upstream for every visitor.

/** `allowedProxies` sentinel: no per-session restriction (the minting default). */
const PROXY_ALLOW_ALL = "ALL";
/** `allowedProxies` sentinel: this session may reach no alias at all. */
const PROXY_ALLOW_NONE = "NONE";

/**
 * Whether `session.allowedProxies` permits `alias`.
 *
 * Missing / `'ALL'` means unrestricted — narrowing is opt-in, so no existing
 * deployment changes behaviour by upgrading. An auth module narrows it at login
 * (see {@link setSessionAllowedProxies}); the field lives in the session's SHARED
 * half (`session-writeback.js`), so the narrowing persists and every cluster
 * worker sees it.
 *
 * An unrecognised shape denies: the only reason the field is not one of the known
 * values is that something tried to restrict this session, and a restriction we
 * cannot read must not be read as "unrestricted".
 */
function proxyAliasAllowedForSession(session, alias) {
    const allowed = session?.allowedProxies;
    if (allowed === undefined || allowed === null || allowed === PROXY_ALLOW_ALL) return true;
    if (allowed === PROXY_ALLOW_NONE) return false;
    if (Array.isArray(allowed)) return allowed.includes(alias);
    return false;
}

/**
 * Narrow (or widen) the aliases a session may reach. For auth modules to call on
 * a completed login — `XOPAT_SERVER.setSessionAllowedProxies(ctx.session, [...])`.
 *
 * Pass an array of aliases, `'ALL'`, or `'NONE'`. Mutates in place, which is what
 * the deferred write-back picks up; there is no session-set API.
 */
function setSessionAllowedProxies(session, aliases) {
    if (!session || typeof session !== "object") return;
    if (aliases === PROXY_ALLOW_ALL || aliases === PROXY_ALLOW_NONE) {
        session.allowedProxies = aliases;
        return;
    }
    if (!Array.isArray(aliases)) {
        throw new TypeError("setSessionAllowedProxies expects an array of aliases, 'ALL' or 'NONE'.");
    }
    session.allowedProxies = aliases.filter(a => typeof a === "string" && a);
}

/** Does this alias inject operator secrets (API keys) into the upstream request? */
function proxyCarriesOperatorCredentials(proxyConfig) {
    const headers = proxyConfig?.headers;
    return !!headers && typeof headers === "object" && Object.keys(headers).length > 0;
}

/** Will {@link verifyProxyAuth} actually run a verifier for this alias? */
function proxyAuthIsEnforced(proxyConfig) {
    const authCfg = proxyConfig?.auth;
    if (!authCfg || authCfg.enabled === false) return false;
    return getVerifierEntries(authCfg.verifiers).length > 0;
}

/** Aliases whose misconfiguration has already been logged (one per process). */
const proxyCredentialGateWarned = new Set();

/**
 * Refuse a credential-bearing alias that enforces no authentication.
 *
 * Fails CLOSED by default, and deliberately at the level of *config shape*: the
 * dangerous combination — "operator API key attached" + "anyone with a session may
 * call it" — is invisible in a config file until someone reads the proxy handler,
 * which is how it stays in a deployment for years.
 *
 * Two opt-outs, both explicit operator statements rather than omissions:
 *  - per-alias `auth: {"enabled": false}` — "this one is deliberately public",
 *  - deployment-wide `server.secure.proxyCredentialsRequireAuth: false`.
 *
 * @returns {{ok: true} | {ok: false, message: string}}
 */
function checkProxyCredentialGate(alias, proxyConfig, secureConfig) {
    if (!proxyCarriesOperatorCredentials(proxyConfig)) return { ok: true };
    if (proxyAuthIsEnforced(proxyConfig)) return { ok: true };
    // An `auth` block that says `enabled: false` is intent; a missing one is not.
    if (proxyConfig?.auth && proxyConfig.auth.enabled === false) return { ok: true };
    if (secureConfig?.proxyCredentialsRequireAuth === false) return { ok: true };

    if (!proxyCredentialGateWarned.has(alias)) {
        proxyCredentialGateWarned.add(alias);
        authLog().error(
            `[proxy] '${alias}' injects operator credentials (proxies.${alias}.headers) but enforces no ` +
            `authentication, which makes it an open relay to its upstream for every visitor — a session and ` +
            `a CSRF token are handed to any anonymous page load. Refusing the request. Fix it by configuring ` +
            `proxies.${alias}.auth.verifiers; declare it deliberately public with ` +
            `proxies.${alias}.auth = {"enabled": false}; or disable this check deployment-wide with ` +
            `server.secure.proxyCredentialsRequireAuth: false.`
        );
    }
    // Does not name the alias: this response renders on the viewer's own origin.
    return {
        ok: false,
        message: "Proxy target is misconfigured: a credential-bearing proxy must enforce authentication.",
    };
}

async function verifyProxyAuth(req, res, core, alias, proxyConfig, upstream) {
    const authCfg = proxyConfig.auth;
    if (!authCfg || authCfg.enabled === false) {
        return true;
    }

    const verifierEntries = getVerifierEntries(authCfg.verifiers);
    const mode = authCfg.mode === "any" ? "any" : "all";

    if (!verifierEntries.length) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Proxy '${alias}' auth misconfigured: auth.enabled=true but no verifiers specified.`);
        return false;
    }

    const result = await runVerifierSet(proxyAuthVerifiers, verifierEntries, mode, (name, verifierConfig) => ({
        req, core, alias, proxyConfig, upstream, verifierName: name, verifierConfig
    }));
    if (!result.ok) {
        authLog().warn(`Proxy auth failed for alias '${alias}':`, result.error || "all verifiers failed");
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end(`Unauthorized: proxy auth failed for '${alias}'`);
        return false;
    }

    return true;
}

/**
 * Run a verifier context's verifier set and report the outcome. Never touches
 * `res` — the caller decides how to answer. This is the reusable core behind
 * both the request-time gate (`verifyRpcAuth`) and the on-demand, resource-driven
 * gate (`requireRpcAuthContext`).
 *
 * Returns `{ok, user, error}` with `user` already normalized to carry a stable
 * `id` (see normalizePrincipalUser). `user` may be `null` on a successful verify
 * when the verifier is identity-less (e.g. the "bearer" shared-secret gate).
 */
async function runRpcVerifiers(req, core, verifierContextCfg, meta = {}) {
    // The runtime in server-runtime.js owns the policy decisions (no entry /
    // empty entry / enabled:false / session-only). By the time we reach here
    // the caller has decided there *are* verifiers worth running, so we just
    // run them. Empty / disabled inputs are still treated permissively as a
    // belt-and-braces measure, but they should not be observable in practice.
    if (!verifierContextCfg || verifierContextCfg.enabled === false) {
        return { ok: true, user: normalizePrincipalUser(req.user, meta) };
    }

    const verifierEntries = getVerifierEntries(verifierContextCfg.verifiers);
    if (!verifierEntries.length) {
        return { ok: true, user: normalizePrincipalUser(req.user, meta) };
    }

    const mode = verifierContextCfg.mode === "any" ? "any" : "all";
    // Snapshot `req.user` and restore it around this verifier set.
    //
    // Verifiers write `req.user` as a side effect, and `req` is shared by EVERY
    // context evaluated during one request. Without this, an identity-less
    // verifier in context B (e.g. the shared-secret "bearer" gate) inherited the
    // identity that context A had established, and the
    // RPC_AUTH_CONTEXT_NO_PRINCIPAL guarantee — "this context yielded no user" —
    // silently stopped holding. Identity must come from the verifiers that
    // actually ran for THIS context.
    const priorUser = req.user;
    req.user = undefined;
    let result;
    try {
        result = await runVerifierSet(rpcAuthVerifiers, verifierEntries, mode, (name, verifierConfig) => ({
            req,
            res: undefined,
            core,
            verifierContextCfg,
            verifierName: name,
            verifierConfig,
            meta,
        }));
    } finally {
        // A successful verify keeps its own `req.user` (proxy verifiers and
        // downstream readers rely on the raw claim payload being there); a failed
        // or identity-less one must not leave the previous context's user behind.
        if (req.user === undefined) req.user = priorUser;
    }
    if (!result.ok) return { ok: false, user: null, error: result.error };

    // Prefer the verifier's explicit return value over the `req.user` side
    // channel: the former may already be a mapped principal, the latter is the
    // raw claim payload proxy verifiers need to forward upstream. Only a user
    // produced by THIS verifier set counts.
    const raw = result.result?.user || (req.user !== priorUser ? req.user : null) || null;
    return {
        ok: true,
        user: normalizePrincipalUser(raw, { ...meta, verifierName: result.verifierName }),
    };
}

async function verifyRpcAuth(req, res, core, verifierContextCfg, meta = {}) {
    const result = await runRpcVerifiers(req, core, verifierContextCfg, meta);
    if (!result.ok) {
        authLog().warn(
            `[rpc-auth] failed for ${meta.kind || "unknown"}/${meta.item?.id || meta.itemId || "unknown"}/${meta.method || "unknown"}:`,
            result.error || "all verifiers failed"
        );
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Unauthorized: RPC auth failed`, code: "RPC_AUTH_FAILED" }));
        return { ok: false };
    }
    return { ok: true, user: result.user };
}

// ── On-demand, resource-driven context verification ──────────────────────────

class RpcAuthContextError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "RpcAuthContextError";
        this.code = code;
    }
}

// ── Verifier-context resolution ──────────────────────────────────────────────
//
// The MAIN (viewer) auth context has two historical spellings and they mean the
// SAME context. The client canonicalizes to "core" everywhere (XOpatAuth._ctx /
// XOpatUser._sanitizeContextId / XOpatElement.authContextId, all
// `contextId || "core"`); this registry has always keyed its main entry
// "default". Nothing aliased them, so a deployment that configured
// `rpcVerifiers.default` — the documented way, and what nearly every env file
// does — rejected every RPC that named "core". They are aliases now.
//
// A *sub*-context (any other id) is still matched exactly and still denied when
// it has no entry: that strictness is what stops a caller picking its own
// verifier set by naming a context that does not exist.

/** Every accepted spelling of the main context, in canonical-preference order. */
const MAIN_RPC_CONTEXT_ALIASES = Object.freeze(["core", "", "default"]);
/** The canonical id we report and memoize the main context under. */
const MAIN_RPC_CONTEXT_ID = "core";

function isMainRpcContextId(contextId) {
    return contextId === undefined || contextId === null
        || (typeof contextId === "string" && MAIN_RPC_CONTEXT_ALIASES.includes(contextId));
}

/** Canonical form: every main spelling → "core"; a sub-context passes through. */
function normalizeRpcContextId(contextId) {
    return isMainRpcContextId(contextId) ? MAIN_RPC_CONTEXT_ID : contextId;
}

/** Memoized main-entry resolution, keyed by the contexts object itself. */
const mainContextCache = new WeakMap();

function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

/**
 * Resolve the ONE entry that governs the main context, whatever it is spelled.
 *
 * A conflicting split is a **fatal configuration error**, not a routing rule.
 * The caller writes the `contextId` field, so as long as two *different* main
 * entries are reachable the caller chooses which one governs their own request —
 * and where one of them is `{enabled:false}` (as shipped), naming it skips the
 * gate entirely. Since both spellings denote the same context, no request-time
 * rule can be correct here; only the operator can say which entry they meant.
 *
 * Refusing at boot is loud, deterministic, happens before a single request is
 * served, and depends solely on operator config — so it is not a DoS vector.
 *
 * @throws {Error} when ≥2 main spellings carry different entries.
 */
function canonicalizeRpcVerifierContexts(contexts) {
    const map = contexts || {};
    if (mainContextCache.has(map)) return mainContextCache.get(map);

    const present = MAIN_RPC_CONTEXT_ALIASES
        .filter(alias => Object.prototype.hasOwnProperty.call(map, alias));

    let resolved;
    if (!present.length) {
        resolved = { found: false, key: null, entry: undefined };
    } else if (present.length === 1 || present.every(a => deepEqual(map[a], map[present[0]]))) {
        resolved = { found: true, key: present[0], entry: map[present[0]] };
    } else {
        throw new Error(
            `server.secure.rpcVerifiers defines several spellings of the MAIN auth context ` +
            `(${present.map(a => JSON.stringify(a)).join(", ")}) with DIFFERENT settings. ` +
            `"", "core" and "default" are aliases of one context, and the client chooses which ` +
            `spelling it sends — so a split lets a caller pick the weaker entry and skip the gate. ` +
            `Collapse them into a single key. To leave specific endpoints open, mark those methods ` +
            `\`auth: { public: true }\` in their own policy; to gate only some features, give them a ` +
            `named sub-context instead.`
        );
    }

    mainContextCache.set(map, resolved);
    return resolved;
}

/**
 * Resolve a verifier-context entry out of the raw `rpcVerifiers` map. Pure — all
 * policy lives here so it is testable without a runtime.
 *
 * @returns {{found: boolean, key: string|null, entry: any, main: boolean,
 *            unknown: boolean, canonicalId: string|null}}
 *   `unknown` marks a *named* context with no entry (deny), never a main context
 *   with no entry (that is the zero-config deployment and must keep working).
 */
function resolveVerifierContext(contexts, contextId) {
    const map = contexts || {};
    const absent = contextId === undefined || contextId === null;

    if (!absent && typeof contextId !== "string") {
        return { found: false, key: null, entry: undefined, main: false, unknown: true, canonicalId: null };
    }

    if (absent || isMainRpcContextId(contextId)) {
        // ONE entry serves every spelling. The caller's spelling selects nothing —
        // that is the whole point (see canonicalizeRpcVerifierContexts).
        const main = canonicalizeRpcVerifierContexts(map);
        return {
            found: main.found,
            key: main.key,
            entry: main.entry,
            main: true,
            // A main context with no entry is not "unknown" — it is unconfigured,
            // the out-of-the-box state of most shipped env files.
            unknown: false,
            canonicalId: MAIN_RPC_CONTEXT_ID,
        };
    }

    // Named sub-context: exact match only, and unknown means deny.
    // hasOwn-only: a claimed contextId like "__proto__" must not walk the prototype.
    if (Object.prototype.hasOwnProperty.call(map, contextId)) {
        return { found: true, key: contextId, entry: map[contextId], main: false, unknown: false, canonicalId: contextId };
    }
    return { found: false, key: null, entry: undefined, main: false, unknown: true, canonicalId: contextId };
}

function contextsOf(core) {
    const secure = (core && core.CORE && core.CORE.server && core.CORE.server.secure) || {};
    return secure.rpcVerifiers || secure.rpcAuth || {};
}

/**
 * Own-property lookup of a verifier context, main-context aliases applied.
 * Deliberately WITHOUT a fallback for a *named* context: this is used when the
 * *resource* names the context it needs, and silently substituting a different
 * (usually disabled) entry would defeat the whole point.
 */
function lookupVerifierContext(core, contextId) {
    const contexts = contextsOf(core);
    return resolveVerifierContext(contexts, contextId).entry;
}

/**
 * Verify a NAMED auth context on demand, mid-request.
 *
 * The request-time gate can only check the context the CLIENT put in the request
 * body — a claim, not a fact. This is the counterpart for code that knows which
 * context a resource actually requires (a provider record, a proxy binding, …)
 * and must enforce *that* one. It cannot be steered by the caller.
 *
 * Fails closed at every step, including `enabled: false`: at a credential
 * chokepoint, "the operator turned verification off" is not a licence to dispense
 * a key. Requires a real user principal — a browser session is not enough.
 *
 * @returns {Promise<{contextId: string, user: object, principal: string}>}
 * @throws {RpcAuthContextError}
 */
async function requireRpcAuthContext(ctx, contextId) {
    // A resource must name its context, but may spell the main one any accepted
    // way ("core" / "default" / ""). `undefined` means it named nothing at all.
    if (contextId === undefined || (contextId !== null && typeof contextId !== "string")) {
        throw new RpcAuthContextError("An auth context id is required.", "RPC_AUTH_CONTEXT_INVALID");
    }
    const canonicalId = normalizeRpcContextId(contextId);
    const main = isMainRpcContextId(contextId);

    const req = ctx && ctx.req;
    if (!req) {
        throw new RpcAuthContextError(
            `Cannot verify auth context '${canonicalId}': no request in scope.`,
            "RPC_AUTH_CONTEXT_NO_REQUEST"
        );
    }

    // One verification per (ctx, context). Keyed by the CANONICAL id so "core"
    // and "default" in the same turn run the verifier once — a single turn reaches
    // the credential chokepoint from several paths and a verifier may fetch JWKS.
    let cache = ctx.__rpcAuthContexts;
    if (!cache) {
        cache = new Map();
        Object.defineProperty(ctx, "__rpcAuthContexts", { value: cache, enumerable: false, configurable: true });
    }
    if (cache.has(canonicalId)) {
        const cached = cache.get(canonicalId);
        if (cached instanceof Error) throw cached;
        return cached;
    }

    const run = async () => {
        const contexts = contextsOf(ctx.core);
            const resolved = resolveVerifierContext(contexts, contextId);
        const entry = resolved.entry;
        if (!entry) {
            // Name every key the operator could add, so the message is actionable.
            const where = main
                ? `server.secure.rpcVerifiers.core OR server.secure.rpcVerifiers.default ` +
                  `(aliases of the same context)`
                : `server.secure.rpcVerifiers.${canonicalId}`;
            throw new RpcAuthContextError(
                `Auth context '${canonicalId}'${main ? " (the viewer's main identity)" : ""} ` +
                `has no verifier configuration. Configure ${where}; refusing.`,
                "RPC_AUTH_CONTEXT_UNCONFIGURED"
            );
        }
        if (entry.enabled === false) {
            throw new RpcAuthContextError(
                `Auth context '${canonicalId}' has verification explicitly disabled; ` +
                `refusing to authorize a resource that requires it.`,
                "RPC_AUTH_CONTEXT_DISABLED"
            );
        }
        if (!getVerifierEntries(entry.verifiers).length) {
            throw new RpcAuthContextError(
                `Auth context '${canonicalId}' configures no verifiers; refusing.`,
                "RPC_AUTH_CONTEXT_NO_VERIFIERS"
            );
        }

        const result = await runRpcVerifiers(req, ctx.core, entry, {
            contextId: canonicalId,
            kind: ctx.kind,
            itemId: ctx.itemId,
            method: ctx.method,
        });
        if (!result.ok) {
            throw new RpcAuthContextError(
                `Auth context '${canonicalId}' verification failed: ${result.error?.message || "all verifiers failed"}`,
                "RPC_AUTH_CONTEXT_FAILED"
            );
        }
        if (!result.user || !result.user.id) {
            throw new RpcAuthContextError(
                `Auth context '${canonicalId}' verified but yielded no user identity ` +
                `(an identity-less verifier such as "bearer" cannot satisfy it).`,
                "RPC_AUTH_CONTEXT_NO_PRINCIPAL"
            );
        }
        // `matchedKey` is diagnostic only — downstream compares the canonical id.
        return { contextId: canonicalId, matchedKey: resolved.key, user: result.user, principal: `user:${result.user.id}` };
    };

    try {
        const value = await run();
        cache.set(canonicalId, value);
        return value;
    } catch (e) {
        cache.set(canonicalId, e);
        throw e;
    }
}

function verifyJwtToken(token, jwtCfg = {}) {
    if (!token) {
        throw new Error("Missing Bearer token");
    }

    const parts = token.split(".");
    if (parts.length !== 3) {
        throw new Error("Invalid JWT format");
    }

    const [hB64, pB64, sB64] = parts;
    let header, payload;
    try {
        header = JSON.parse(base64UrlToBuffer(hB64).toString("utf8"));
        payload = JSON.parse(base64UrlToBuffer(pB64).toString("utf8"));
    } catch (e) {
        throw new Error("Failed to parse JWT header/payload");
    }

    if (!header || header.typ !== "JWT") {
        throw new Error("Invalid JWT header typ");
    }
    if (!header.alg || header.alg !== "HS256") {
        throw new Error(`Unsupported JWT alg '${header.alg}', expected HS256`);
    }

    let secret = jwtCfg.secret;
    if (!secret && jwtCfg.secretEnv) {
        secret = process.env[jwtCfg.secretEnv];
    }
    if (!secret) {
        throw new Error(`JWT verification requires secret or secretEnv`);
    }

    const crypto = require("node:crypto");
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(`${hB64}.${pB64}`);
    const expectedSig = hmac.digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    if (!timingSafeStringEqual(expectedSig, sB64)) {
        throw new Error("Invalid JWT signature");
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const skew = typeof jwtCfg.clockSkewSec === "number" ? jwtCfg.clockSkewSec : 60;

    // A token with no `exp` never expires — a permanent credential handed out by
    // accident. Required by default; `requireExpiry: false` is the escape hatch
    // for an issuer that genuinely mints non-expiring service tokens.
    if (typeof payload.exp !== "number") {
        if (jwtCfg.requireExpiry !== false) {
            throw new Error("JWT has no 'exp' claim; refusing a token that never expires " +
                "(set auth.jwt.requireExpiry = false to accept one).");
        }
    } else if (nowSec > payload.exp + skew) {
        throw new Error("JWT has expired");
    }

    if (typeof payload.nbf === "number" && nowSec < payload.nbf - skew) throw new Error("JWT not yet valid");

    // A CONFIGURED issuer/audience is a requirement, not a hint. These used to
    // be skipped when the claim was absent (`jwtCfg.issuer && payload.iss &&
    // …`), so a token minted without `iss` sailed past an issuer-constrained
    // config — which is precisely the token an attacker would craft.
    if (jwtCfg.issuer) {
        if (payload.iss !== jwtCfg.issuer) {
            throw new Error(`Unexpected JWT issuer '${payload.iss ?? "(absent)"}'`);
        }
    }
    if (jwtCfg.audience) {
        const expectedAud = jwtCfg.audience;
        const aud = payload.aud;
        const ok = Array.isArray(aud) ? aud.includes(expectedAud) : aud === expectedAud;
        if (!ok) {
            throw new Error(`Unexpected JWT audience '${Array.isArray(aud) ? aud.join(",") : (aud ?? "(absent)")}'`);
        }
    }
    return payload;
}

registerProxyAuthVerifier("jwt", async ({ req, core, proxyConfig, upstream, verifierConfig }) => {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new Error("Missing Bearer token for JWT verifier");
    }
    const token = authHeader.slice("Bearer ".length).trim();
    const globalJwt = serverAuthConfig(core).jwt || {};
    const payload = verifyJwtToken(token, { ...globalJwt, ...(verifierConfig || {}) });
    req.user = payload;
    const jwtForward = ((verifierConfig || {}).forward ?? globalJwt.forward) === true;
    // `upstream.headers` is now built from an ALLOWLIST that deliberately omits
    // `authorization` (see PROXY_FORWARDED_REQUEST_HEADERS in index.js) — the
    // browser's credentials are not a third party's business by default. So
    // forwarding is an explicit ADD here rather than "skip the delete", and the
    // non-forwarding case stays a delete purely so a verifier ordering that put
    // it there earlier still gets scrubbed.
    if (jwtForward) {
        upstream.headers["authorization"] = authHeader;
    } else {
        delete upstream.headers["authorization"];
        delete upstream.headers["Authorization"];
    }
    const userClaimHeader = (verifierConfig || {}).userClaimHeader || globalJwt.userClaimHeader;
    if (userClaimHeader && payload.sub) {
        upstream.headers[String(userClaimHeader).toLowerCase()] = String(payload.sub);
    }
    return true;
});

// Shared-secret gate. Yields NO identity, so a context verified only by "bearer"
// can never satisfy a resource that requires a user principal — pair it with an
// identity verifier (jwt / oidc / saml) if you need one.
//
// It used to check only that the header STARTED WITH "Bearer " — it read no
// configured secret and compared nothing, so `Authorization: Bearer x` satisfied
// it and any context using it was unauthenticated while its name and docs said
// otherwise. A secret is now REQUIRED: an unconfigured entry fails closed rather
// than degrading to presence-only.
registerRpcAuthVerifier("bearer", async ({ req, core, verifierConfig }) => {
    const cfg = verifierConfig || {};
    const globalBearer = serverAuthConfig(core).bearer || {};
    const expected = cfg.secret
        || (cfg.secretEnv ? process.env[cfg.secretEnv] : undefined)
        || globalBearer.secret
        || (globalBearer.secretEnv ? process.env[globalBearer.secretEnv] : undefined);
    if (!expected) {
        throw new Error(
            "The 'bearer' verifier requires a shared secret (verifierConfig.secret or .secretEnv). " +
            "Without one it authenticates nothing; refusing."
        );
    }

    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new Error("Missing Bearer token");
    }
    if (!timingSafeStringEqual(authHeader.slice("Bearer ".length).trim(), String(expected))) {
        throw new Error("Invalid Bearer token");
    }
    return { ok: true, user: null };
});

registerRpcAuthVerifier("jwt", async ({ req, core, verifierConfig, verifierName, meta }) => {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new Error("Missing Bearer token");
    }
    const token = authHeader.slice("Bearer ".length).trim();
    const globalJwt = serverAuthConfig(core).jwt || {};
    const payload = verifyJwtToken(token, { ...globalJwt, ...(verifierConfig || {}) });
    // `req.user` stays the RAW payload: proxy verifiers forward `payload.sub`
    // upstream and downstream code has always seen the claim set here.
    req.user = payload;
    return { ok: true, user: normalizePrincipalUser(payload, { verifierName, contextId: meta?.contextId }) };
});

module.exports = {
    registerProxyAuthVerifier,
    verifyProxyAuth,
    proxyAliasAllowedForSession,
    setSessionAllowedProxies,
    checkProxyCredentialGate,
    proxyAuthIsEnforced,
    proxyCarriesOperatorCredentials,
    PROXY_ALLOW_ALL,
    PROXY_ALLOW_NONE,
    registerRpcAuthVerifier,
    verifyRpcAuth,
    runRpcVerifiers,
    requireRpcAuthContext,
    lookupVerifierContext,
    resolveVerifierContext,
    canonicalizeRpcVerifierContexts,
    isMainRpcContextId,
    normalizeRpcContextId,
    MAIN_RPC_CONTEXT_ALIASES,
    MAIN_RPC_CONTEXT_ID,
    getVerifierEntries,
    RpcAuthContextError,
    verifyJwtToken,
    normalizePrincipalUser,
    timingSafeStringEqual,
    csrfTokenMatches,
};
