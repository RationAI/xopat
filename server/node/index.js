const http = require("node:http");
const {URL} = require('url');
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const querystring = require('querystring');
const crypto = require('node:crypto');
const cluster = require('node:cluster');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const i18n = require('../../src/libs/i18next.min');


const utils = require('./utils');
const { getCore } = require("../templates/javascript/core");
const { loadPlugins } = require("../templates/javascript/plugins");
const { throwFatalErrorIf } = require("./error");


const constants = require("./constants");
const {rawReqToString, RawBodyTooLargeError} = require("./utils");
const {verifyProxyAuth, verifyRpcAuth, csrfTokenMatches} = require("./auth");
const { XopatServerRuntime } = require("./server-runtime");
const { getServerLogging, setLoggingConfig } = require("./logging");
const { setServerConfigSnapshot } = require("./server-helpers");
const { getServerStorage, setStorageConfig } = require("./storage");


const PROJECT_PATH = "";

/**
 * JSON encoded for embedding inside an inline `<script>` block.
 *
 * `JSON.stringify` escapes quotes and backslashes but **not `<`**, so any value
 * containing `</script>` terminates the tag and everything after it is parsed as
 * HTML. For request-derived values (the POST body reflected into `initXOpat`)
 * that is a reflected XSS on the viewer's own origin, next to the CSRF token.
 * U+2028/U+2029 are escaped too: legal inside a JSON string, but literal line
 * terminators in JS source, so an unescaped one is a syntax error.
 *
 * Use this for EVERY interpolation into a `<script>` body — including values
 * that look operator-controlled today. `undefined` collapses to `null` so the
 * result is always valid JS (bare `JSON.stringify(undefined)` returns
 * `undefined`, not a string).
 */
const SCRIPT_UNSAFE_CHARS = /[<\u2028\u2029]/g;
const SCRIPT_ESCAPES = Object.freeze({
    "<": "\\u003c",
    ["\u2028"]: "\\u2028",
    ["\u2029"]: "\\u2029",
});
function jsonForScript(value) {
    return JSON.stringify(value === undefined ? null : value)
        .replace(SCRIPT_UNSAFE_CHARS, (ch) => SCRIPT_ESCAPES[ch]);
}

function readStartupVersion(defaultVersion = "dev") {
    try {
        const pkgPath = path.join(constants._ABSPATH_NO_SLASH || constants.ABSPATH, "package.json");
        if (!fs.existsSync(pkgPath)) return defaultVersion;

        const pkg = JSON.parse(fs.readFileSync(pkgPath, { encoding: "utf8", flag: "r" }));
        return pkg.version || defaultVersion;
    } catch (e) {
        console.warn(`Failed to read package.json version, falling back to '${defaultVersion}':`, e.message);
        return defaultVersion;
    }
}

const STARTUP_VERSION = readStartupVersion();
const DEV_MODE = constants.SERVER.DEV_MODE === true;

/**
 * Are we one of several processes serving the same deployment?
 *
 * `cluster.isWorker` covers `cluster-index.js`. It does NOT cover the other
 * multi-process shapes (k8s replicas, PM2 fork mode, one container per
 * replica), which look single-process from inside while sharing a filesystem
 * and a load balancer — so an operator can assert it with
 * `XOPAT_SHARED_DEPLOYMENT=1` and get the same shared-state defaults.
 */
const IS_CLUSTERED = cluster.isWorker
    || ["1", "true", "yes", "on"].includes(String(process.env.XOPAT_SHARED_DEPLOYMENT || "").toLowerCase());
const CLUSTER_WORKER_LABEL = cluster.isWorker ? `worker ${cluster.worker.id}` : `pid ${process.pid}`;

/**
 * The logging broker, constructed BEFORE anything else that could log. Its
 * configuration (`core.server.logging`) is published as soon as the core config
 * is parsed (bootStorageConfig below) and re-published per request build, so a
 * boot-time record still lands — under defaults — rather than being lost.
 *
 * The console capture is installed in every mode, not just dev: it is what feeds
 * the ring buffer, and a production server with no queryable log surface is
 * exactly the gap this replaces.
 */
const LOGGING = getServerLogging({
    devMode: DEV_MODE,
    baseConsole: console,
    // Lazy: the storage broker does not exist yet, and the store sink is opt-in.
    getStorage: () => getServerStorage()?.storage || null,
});
LOGGING.installConsoleCapture(console, { source: "server" });
const logger = LOGGING.log("core");

if (DEV_MODE) {
    logger.info("[dev-mode] enabled");
}

// Process-level safety net, installed UNCONDITIONALLY. It used to be dev-only,
// which meant production was the single environment without one: an unhandled
// rejection there took the process down silently while the same bug in dev was a
// logged warning. Backwards.
process.on('unhandledRejection', error => {
    logger.error('[process] unhandledRejection', error);
});
process.on('uncaughtException', error => {
    // An unknown-state process must not keep answering requests — it would serve
    // wrong answers rather than fail. Stop accepting, then exit non-zero so the
    // supervisor (docker/systemd/cluster-index) restarts us.
    logger.error('[process] uncaughtException — shutting down', error);
    try { server.close(); } catch (_) { /* server may not exist yet */ }
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 1000).unref();
});

const CACHE_DIR = process.env.XOPAT_CACHE_DIR
    || path.join(constants._ABSPATH_NO_SLASH || constants.ABSPATH, "server/.cache");

/**
 * Publish `server.secure.storage` (and the public `server.logging` block) before
 * the storage broker is constructed —
 * driver options (file root, memory budget) are read once at construction, while
 * bindings and retention stay lazy. A parse failure here is not fatal: the
 * per-request core build reports it properly, and the broker falls back to its
 * defaults meanwhile.
 */
/**
 * Extra static roots an operator opted into (`core.server.staticRoots`).
 * Read once at boot, alongside the storage config, because the static handler
 * must not pay for a core build per asset request.
 */
let EXTRA_STATIC_ROOTS = [];

/**
 * Baseline security-header policy, `core.server.security`. Read once at boot.
 *
 * Defaults are the safe-but-non-breaking set: framing denied to other origins
 * unless the deployment is in cross-site embedding mode, HSTS on when we are
 * actually behind TLS, no CSP until the inline scripts are nonce'd.
 */
const SECURITY_HEADERS = {
    frameOptions: process.env.XOPAT_CROSS_SITE_COOKIES === 'true' ? null : 'SAMEORIGIN',
    hstsMaxAge: 15552000,        // 180 days
    csp: null,
    cspReportOnly: true,
};

/**
 * Routes that expose the deployment's own shape — plugin defaults merged with
 * ENV, the raw `.d.ts` sources, the session-authoring form. Useful in
 * development, gratuitous disclosure in production. Dev mode enables them;
 * `core.server.exposeSchemeRoutes: true` is the explicit production opt-in.
 */
let EXPOSE_SCHEME_ROUTES = DEV_MODE;

(function bootStorageConfig() {
    try {
        const core = getCore(constants.ABSPATH, PROJECT_PATH,
            fs.existsSync,
            p => fs.readFileSync(p, { encoding: 'utf8', flag: 'r' }),
            key => process.env[key],
            false,                       // keep server.secure inline; nothing is served from this copy
            { version: STARTUP_VERSION },
        );
        setStorageConfig(core?.CORE?.server?.secure?.storage || core?.CORE_SECURE?.storage || {});
        setLoggingConfig(core?.CORE?.server?.logging || {});
        const roots = core?.CORE?.server?.staticRoots;
        if (Array.isArray(roots)) EXTRA_STATIC_ROOTS = roots.filter(r => typeof r === "string");

        const sec = core?.CORE?.server?.security;
        if (sec && typeof sec === "object") {
            // `frameOptions: false` (or "") disables the header entirely — the
            // knob an embedding deployment needs.
            if (Object.prototype.hasOwnProperty.call(sec, "frameOptions")) {
                SECURITY_HEADERS.frameOptions = sec.frameOptions ? String(sec.frameOptions) : null;
            }
            if (Number.isFinite(Number(sec.hstsMaxAge))) {
                SECURITY_HEADERS.hstsMaxAge = Math.max(0, Number(sec.hstsMaxAge));
            }
            if (typeof sec.csp === "string" && sec.csp.trim()) SECURITY_HEADERS.csp = sec.csp.trim();
            if (sec.cspReportOnly === false) SECURITY_HEADERS.cspReportOnly = false;
        }

        if (core?.CORE?.server?.exposeSchemeRoutes === true) EXPOSE_SCHEME_ROUTES = true;
    } catch (e) {
        logger.warn?.('[storage] could not pre-read storage config; using defaults:', e?.message || e);
        setStorageConfig({});
    }
})();

const { storage: SERVER_STORAGE, cache: SERVER_CACHE } = getServerStorage({ cacheDir: CACHE_DIR, logger });

// Server-side i18n, initialized after the cache broker exists — `getI18NData`
// reaches for the bake cache.
const language = constants.SERVER.LANGUAGE;
const languageServerConf = getI18NData(language);
languageServerConf.fallbackLng = 'en';
i18n.init(languageServerConf);

// Browser sessions. These are not just CSRF holders any more: an unauthenticated
// caller's PRINCIPAL is `sess:<id>` (see server-runtime #principalOf), so this
// store backs per-browser isolation of anything owned anonymously — chat
// transcripts, BYOK keys. Unbounded retention would be both a memory leak and a
// security smell, hence the TTL + cap.
//
// It is a storage namespace rather than a bare Map so an operator can move it:
// bound to `memory` (the default) the semantics are exactly what they were, but
// binding it to `tiered` makes sessions shared across cluster workers — which
// today they are NOT, so a multi-worker deployment loses sessions at random.
// `sensitivity: "secret"` is what stops that binding being made carelessly:
// sessions carry OIDC refresh tokens, so persisting them is an explicit
// operator decision (`allowPersistentSecrets`), never an accident.
const SESSION_TTL_MS = Math.max(60, Number(process.env.XOPAT_SESSION_TTL_SEC) || 24 * 60 * 60) * 1000;
const SESSION_MAX_ENTRIES = Math.max(100, Number(process.env.XOPAT_SESSION_MAX) || 50_000);
/** Notified with a session id whenever one is dropped, so owners can purge derived state. */
const sessionEvictionListeners = new Set();

function onSessionEvicted(listener) {
    sessionEvictionListeners.add(listener);
    return () => sessionEvictionListeners.delete(listener);
}

function notifySessionEvicted(id) {
    for (const listener of sessionEvictionListeners) {
        try { listener(id); } catch (e) { logger.warn?.('[session] eviction listener failed', e); }
    }
}

/**
 * A session is stored in TWO namespaces, and the split is the whole point.
 *
 * The identity half — id, CSRF token, timestamps — is what every request needs
 * in order to be *recognised*. It carries no credential worth protecting (the
 * CSRF token is meaningless without the cookie that names it), so it can live
 * on a shared driver. Under `cluster-index.js` it MUST: with the single
 * combined store, worker A minted a session that worker B could not see, so
 * roughly (N-1)/N of authenticated requests answered 401 RPC_NO_SESSION or 403
 * RPC_BAD_CSRF, the client re-minted onto a third worker, and the deployment
 * sat in permanent thrash.
 *
 * The secure half — everything a module hangs off the session
 * (`__oidcServer.pending` PKCE verifiers, `__saml.sessions`) — keeps
 * `sensitivity: "secret"` and stays memory-only. Sharing it means writing OIDC
 * refresh tokens to disk, which is an operator decision
 * (`allowPersistentSecrets`), not a default. See the cluster warning below for
 * what that costs and how to opt in.
 *
 * Splitting by a FIXED key list rather than a heuristic is deliberate: an
 * unknown key lands in the secure half, so a module that starts stashing
 * something new never silently gains persistence.
 */
const SESSION_SHARED_KEYS = Object.freeze(new Set([
    "id", "csrfToken", "createdAt", "lastSeenAt", "allowedProxies",
]));

function splitSession(session) {
    const shared = {};
    const secure = {};
    for (const [key, value] of Object.entries(session || {})) {
        (SESSION_SHARED_KEYS.has(key) ? shared : secure)[key] = value;
    }
    return { shared, secure };
}

/**
 * Identity half. `tiered` by default *only* when clustered, so a single-process
 * deployment behaves exactly as before (memory, nothing on disk) while a
 * clustered one is correct without the operator having to discover why sessions
 * were evaporating. `defaultBindings` is precedence 4 in `storage/policy.js`, so
 * an explicit `bindings` entry still wins.
 */
const sessionStore = SERVER_STORAGE.kv("core", "sessions", {
    ttlMs: SESSION_TTL_MS,
    maxEntries: SESSION_MAX_ENTRIES,
    sensitivity: "normal",
    defaultBindings: IS_CLUSTERED ? ["tiered"] : ["memory"],
    // Store-initiated removals only (TTL expiry, LRU eviction). Explicit drops
    // notify from `dropSession`, so `sess:`-scoped state (chat transcripts, BYOK
    // keys) is purged exactly once whichever path removed the session.
    onEvict: (id) => notifySessionEvicted(id),
});

/** Secure half: module-attached credentials. Never shared without consent. */
const sessionSecureStore = SERVER_STORAGE.kv("core", "sessions-secure", {
    ttlMs: SESSION_TTL_MS,
    maxEntries: SESSION_MAX_ENTRIES,
    sensitivity: "secret",
    defaultBindings: ["memory"],
});

if (IS_CLUSTERED && !sessionStore.driver?.shared) {
    logger.warn(
        `[session] running clustered (${CLUSTER_WORKER_LABEL}) but the session namespace is bound to ` +
        `the non-shared driver '${sessionStore.driver?.id}'. Sessions minted on one worker will not be ` +
        `visible on the others and authenticated requests will fail at random. Bind ` +
        `core.server.secure.storage.bindings.core["kv:sessions"] to ["tiered"] (or another shared driver).`
    );
}
if (IS_CLUSTERED && !sessionSecureStore.driver?.shared) {
    logger.info(
        `[session] module-attached session state (OIDC pending/PKCE, SAML assertions) is worker-local ` +
        `in cluster mode. Interactive login redirects therefore need the /login and the callback request ` +
        `to reach the same worker. To share it instead, set ` +
        `core.server.secure.storage.allowPersistentSecrets = true and bind ` +
        `bindings.core["kv:sessions-secure"] to ["tiered"] — that writes refresh tokens to disk, so ` +
        `restrict the storage root and have an at-rest encryption story first.`
    );
}

async function dropSession(id) {
    const [removedShared] = await Promise.all([
        sessionStore.delete(id),
        sessionSecureStore.delete(id).catch(e => logger.warn?.('[session] secure delete failed', e?.message || e)),
    ]);
    if (removedShared) notifySessionEvicted(id);
}

const serverRuntime = new XopatServerRuntime({
    root: constants._ABSPATH_NO_SLASH || constants.ABSPATH,
    cacheDir: CACHE_DIR,
    auth: { verifyRpcAuth },
    logger,
    devMode: DEV_MODE,
    logging: LOGGING,
    version: STARTUP_VERSION,
    startedAt: new Date(),
});

function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(';').forEach(pair => {
        const [name, ...rest] = pair.split('=');
        cookies[name.trim()] = decodeURIComponent(rest.join('=') || '');
    });
    return cookies;
}

// Idle-refresh writes are rate-limited: without this, a store bound to a durable
// driver would take one write per request just to move `lastSeenAt`.
const SESSION_TOUCH_INTERVAL_MS = Math.max(1000, Math.floor(SESSION_TTL_MS / 10));

/**
 * Persist a session at the end of the request that touched it.
 *
 * Modules mutate the session object in place (`session.__oidcServer.pending`,
 * `session.__saml.sessions` — see `src/AUTH.md`), which works for free only while
 * the store hands back a live reference. Comparing a snapshot taken at resolve
 * time against the object at response end makes that pattern correct for ANY
 * driver, so the namespace stays re-bindable without every auth module changing.
 *
 * `lastSeenAt` is excluded from the change comparison and refreshed on its own
 * schedule, so an idle poll does not rewrite the record on every request.
 */
/**
 * Apply this request's changes on top of whatever is stored NOW, rather than
 * overwriting the record with the copy we resolved at request start.
 *
 * The old code did a whole-object `set`, so two concurrent requests on one
 * session were last-writer-wins over the ENTIRE session: a request that only
 * bumped `lastSeenAt` would silently erase a concurrent login's
 * `__oidcServer.pending`. Diffing against the resolve-time snapshot and
 * replaying only the keys this request actually touched makes concurrent writes
 * to *different* keys both survive, which is the case that was really biting.
 *
 * It is still not a CAS — two requests writing the SAME key race, and the
 * driver has no compare-and-set to offer. That residue is acceptable; the
 * cross-key clobber was not.
 */
async function mergeSessionWriteBack(store, id, snapshot, current) {
    const changed = {};
    let hasChange = false;
    for (const [key, value] of Object.entries(current)) {
        if (JSON.stringify(value) !== JSON.stringify(snapshot[key])) {
            changed[key] = value;
            hasChange = true;
        }
    }
    const removed = Object.keys(snapshot).filter(k => !(k in current));
    if (!hasChange && !removed.length) return false;

    const stored = (await store.get(id)) || {};
    const next = { ...stored, ...changed };
    for (const key of removed) delete next[key];
    await store.set(id, next);
    return true;
}

function scheduleSessionWriteBack(res, session) {
    if (!res || res.__xoSessionWriteBack) return;
    res.__xoSessionWriteBack = true;

    const atResolve = splitSession(session);
    const seenAtResolve = session.lastSeenAt || 0;

    res.on('finish', () => {
        const now = splitSession(session);

        // `lastSeenAt` moves on every request; comparing it would make every
        // request a write. It is refreshed on its own rate-limited schedule.
        const sharedSnapshot = { ...atResolve.shared, lastSeenAt: now.shared.lastSeenAt };
        const touchDue = (now.shared.lastSeenAt || 0) - seenAtResolve >= SESSION_TOUCH_INTERVAL_MS;
        if (touchDue) delete sharedSnapshot.lastSeenAt;

        Promise.all([
            mergeSessionWriteBack(sessionStore, session.id, sharedSnapshot, now.shared),
            mergeSessionWriteBack(sessionSecureStore, session.id, atResolve.secure, now.secure),
        ]).catch(e => logger.warn?.('[session] write-back failed', e?.message || e));
    });
}

async function getSession(req, res) {
    const cookies = parseCookies(req.headers.cookie);
    const id = cookies['xopat_session'];
    if (!id) return null;

    // The identity half decides whether the session exists at all; the secure
    // half is best-effort, because in cluster mode it may live on a different
    // worker. A recognised session with no module state beats no session.
    const shared = await sessionStore.get(id);
    if (!shared) return null;
    const secure = await sessionSecureStore.get(id) || {};
    const session = { ...secure, ...shared };

    if (Date.now() - (session.lastSeenAt || session.createdAt) > SESSION_TTL_MS) {
        await dropSession(id);
        return null;
    }
    // Registered BEFORE `lastSeenAt` moves, so the snapshot records when this
    // session was last actually written — that is what rate-limits idle writes.
    scheduleSessionWriteBack(res, session);
    session.lastSeenAt = Date.now();
    // Recency touch, so an active session is never the next evicted. Free on the
    // memory driver; the durable path is rate-limited by the write-back above.
    await sessionStore.touch(id);
    sessionSecureStore.touch(id).catch(() => {});
    return session;
}

async function createSession(res, { isSecureRequest = false } = {}) {
    const id = crypto.randomUUID();
    const csrfToken = crypto.randomBytes(16).toString('hex');

    const session = {
        id,
        csrfToken,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        // you can attach extra flags here, e.g. which proxies are allowed
        allowedProxies: 'ALL'
    };

    // The store enforces the TTL and the entry cap itself, on the shared sweeper.
    // It used to be done inline here, and since any cookieless GET mints a
    // session that was O(n) work per anonymous request — O(n²) under a flood —
    // while the LRU eviction it triggered fired the listeners that purge
    // `sess:`-scoped state. A flood could therefore destroy every other
    // anonymous user's data.
    // Identity half only: a fresh session has no module state to store, and
    // writing an empty record to the secure namespace would just be garbage the
    // sweeper has to reclaim.
    await sessionStore.set(id, splitSession(session).shared);

    const isCrossSiteCookieMode = process.env.XOPAT_CROSS_SITE_COOKIES === 'true';

    const cookieParts = [
        `xopat_session=${encodeURIComponent(id)}`,
        'Path=/',
        'HttpOnly',
        isCrossSiteCookieMode ? 'SameSite=None' : 'SameSite=Lax'
    ];

    // SameSite=None is rejected by browsers unless Secure is also present.
    // In Colab/proxy mode this must be enabled even if NODE_ENV !== 'production'.
    //
    // `x-forwarded-proto: https` is the third trigger: a TLS-terminating proxy
    // with NODE_ENV unset used to ship the session cookie without Secure, i.e.
    // recoverable by any attacker who can force one plain-HTTP request. Adding
    // the flag when we can SEE we are on TLS is purely additive — a deployment
    // that genuinely serves plain HTTP never sets that header, so nothing that
    // works today stops working.
    if (process.env.NODE_ENV === 'production' || isCrossSiteCookieMode || isSecureRequest) {
        cookieParts.push('Secure');
    }
    const cookie = cookieParts.join('; ');

    // Preserve other Set-Cookie headers if any
    const existing = res.getHeader('Set-Cookie');
    if (existing) {
        res.setHeader('Set-Cookie', Array.isArray(existing) ? existing.concat(cookie) : [existing, cookie]);
    } else {
        res.setHeader('Set-Cookie', cookie);
    }

    scheduleSessionWriteBack(res, session);
    return session;
}

/**
 * Locales this deployment actually ships, read once from disk.
 *
 * `?lang=` reaches two production caches as part of their key. Unvalidated, a
 * caller could mint an unbounded number of distinct keys — and each entry of the
 * core cache is a full CORE+PLUGINS+MODULES scan, so that was a cheap way to
 * exhaust server memory. Anything not on disk collapses to `null` (server
 * default), which is also what the loader would have fallen back to anyway.
 */
const AVAILABLE_LOCALES = (() => {
    try {
        const dir = path.join(constants._ABSPATH_NO_SLASH || constants.ABSPATH, "src", "locales");
        return new Set(fs.readdirSync(dir)
            .filter(f => f.endsWith(".json"))
            .map(f => f.slice(0, -".json".length)));
    } catch (e) {
        console.warn("Failed to enumerate src/locales; language selection disabled:", e?.message || e);
        return new Set(["en"]);
    }
})();

function normalizeLanguage(raw) {
    if (!raw) return null;
    const value = String(raw);
    return AVAILABLE_LOCALES.has(value) ? value : null;
}

// Production-only core cache. The scan output (CORE + PLUGINS + MODULES)
// depends solely on disk, ENV and the requested language, yet every request
// re-parsed config.json and synchronously re-walked all plugins/modules
// directories — blocking the event loop and queueing concurrent requests
// behind it. Keyed by (serverOnly, withPlugins, language); invalidated only
// by process restart, which matches production semantics ("baked"). Dev mode
// never populates the cache, so include.json hot-editing keeps working.
//
// Bounded even though `normalizeLanguage` already caps the key space: each entry
// is large, and a bound plus `stats()` visibility is what keeps a future key
// change from silently becoming a leak again.
const _productionCoreCache = SERVER_CACHE.create({
    name: "core:production-core",
    maxEntries: 32,
});

/**
 * Request-facing view over a cached core. Writes shadow the cached master via
 * the prototype chain; `CORE` is deep-cloned because request handlers mutate
 * it, and printers track `_coreBundleEmitted` per page render. PLUGINS/MODULES
 * stay shared — request handlers treat them as read-only.
 */
function _perRequestCoreView(master) {
    const view = Object.create(master);
    view._coreBundleEmitted = false;
    view.CORE = JSON.parse(JSON.stringify(master.CORE));
    return view;
}

const initViewerCoreAndPlugins = (req, res, serverOnly=false, withPlugins=!serverOnly) => {
    //const locale = $_GET["lang"] ?? ($parsedParams->params->locale ?? "en");
    let language = null;
    if (!serverOnly) {
        let raw = req.url || "/";
        if (raw.startsWith("//")) raw = "/" + raw.replace(/^\/+/, ""); // prevent accidental issues with double slashes
        // use 'http', we don't care about the protocol
        const url = new URL(raw, `http://${req.headers.host}`);
        // TODO: support req.headers['accept-language'] - somma separated list, setup.locale should support multiple fallbacks
        language = normalizeLanguage(url.searchParams.get('lang'));
    }

    const cacheKey = `${serverOnly ? "s" : "c"}:${withPlugins ? "p" : "-"}:${language || ""}`;
    const cached = _productionCoreCache.get(cacheKey);
    if (cached) return _perRequestCoreView(cached);

    const core = getCore(constants.ABSPATH, PROJECT_PATH,
        fs.existsSync,
        path => fs.readFileSync(path, { encoding: 'utf8', flag: 'r' }),
        key => process.env[key],
        !serverOnly, // secure only when not on server
        { version: STARTUP_VERSION }
    );

    if (throwFatalErrorIf(core, res, core.exception, "Failed to parse the CORE initialization!", core.exception)) return null;
    core.CORE.server.name = "node";
    core.CORE.server.supportsPost = true;
    core.CORE.server.devMode = DEV_MODE;
    // Re-publish on every core build so a logging config edit applies without a
    // process restart (levels are resolved lazily against this snapshot).
    setLoggingConfig(core.CORE.server.logging || {});

    if (language) core.CORE.setup.locale = language;

    if (withPlugins) {
        loadPlugins(core, fs.existsSync, path => fs.readFileSync(path, { encoding: 'utf8', flag: 'r' }), i18n);
        if (throwFatalErrorIf(core, res, core.exception, "Failed to parse the MODULES or PLUGINS initialization!", core.exception)) return null;
        // Publish the composed (author ⊕ deployer) config so module state that is
        // built lazily — outside any request — can read its own block without a
        // ctx (XOPAT_SERVER.getStaticModuleConfig). Published after loadPlugins,
        // which is what stashes the author tier.
        setServerConfigSnapshot(core);
    }

    if (core.CORE?.client?.production === true && !core.exception) {
        _productionCoreCache.set(cacheKey, core);
        return _perRequestCoreView(core);
    }

    return core;
}

function normalizeSchemePluginRecords(plugins) {
    const result = {};
    const manifestKeys = new Set([
        'id', 'name', 'author', 'version', 'description', 'icon',
        'includes', 'modules', 'requires', 'permaLoad', 'enabled',
        'loaded', 'error', 'directory', 'path', 'styleSheet',
        'requiredConfig'
    ]);

    for (const [id, plugin] of Object.entries(plugins || {})) {
        if (!plugin || typeof plugin !== "object") {
            continue;
        }

        const meta = {};
        for (const key of [
            'id', 'name', 'author', 'version', 'description', 'icon',
            'modules', 'requires', 'permaLoad', 'enabled', 'loaded',
            'directory', 'requiredConfig'
        ]) {
            if (Object.prototype.hasOwnProperty.call(plugin, key)) {
                meta[key] = plugin[key];
            }
        }

        const defaults = {};
        for (const [key, value] of Object.entries(plugin)) {
            if (!manifestKeys.has(key)) {
                defaults[key] = value;
            }
        }

        result[id] = {
            meta,
            defaults
        };
    }

    return result;
}

// Production memo of the fully-baked i18n payload per requested language.
// The bake reads the core locale + every element locale from disk; doing that
// on every page render is wasted work when production semantics are
// restart-to-invalidate anyway (same as _productionCoreCache). Dev never
// caches, so locale files stay hot-editable.
// Created on first use: `getI18NData` runs once during module load (before this
// declaration is reached), so a plain `const` here would be a temporal-dead-zone
// crash the moment the production guard below stops short-circuiting.
let _i18nBakeCacheRef = null;
function _i18nBakeCache() {
    return _i18nBakeCacheRef ??= SERVER_CACHE.create({ name: "core:i18n-bake", maxEntries: 32 });
}

function getI18NData(language, core = undefined) {
    const production = !!core?.CORE?.client?.production;
    if (production && _i18nBakeCache().has(language)) return _i18nBakeCache().get(language);
    const requestedLanguage = language;

    const localeFile = `${constants.ABSPATH}/src/locales/${language}.json`;
    if (!fs.existsSync(localeFile)) {
        console.error("File with locales for language does not exist, defaulting to 'en'!", language, localeFile);
        language = 'en';
    }
    const data = fs.readFileSync(localeFile, {encoding: 'utf8', flag: 'r'});
    const resources = {
        [language]: JSON.parse(data),
    };

    // Production: bake module/plugin locale bundles into the page. The client's
    // loadLocale() short-circuits on hasResourceBundle(locale, id), so shipping
    // resources[lang][elementId] here removes one boot-time fetch per element
    // (shape-equivalent to addResourceBundle(locale, id, json)). Dev keeps the
    // runtime fetches so locale files stay hot-editable.
    if (core?.CORE?.client?.production) {
        const bakeElementLocales = (records, folder, lang) => {
            resources[lang] = resources[lang] || {};
            const target = resources[lang];
            for (const [id, record] of Object.entries(records || {})) {
                const dir = record && record["directory"];
                if (!dir) continue;
                const file = `${constants.ABSPATH}/${folder}/${dir}/locales/${lang}.json`;
                try {
                    if (!fs.existsSync(file)) continue;
                    if (target[id] !== undefined) {
                        logger.warn(`i18n bake: namespace collision for '${id}' (${lang}) - skipped.`);
                        continue;
                    }
                    target[id] = JSON.parse(fs.readFileSync(file, {encoding: 'utf8', flag: 'r'}));
                } catch (e) {
                    logger.warn(`i18n bake: cannot read locale of '${id}' (${lang}):`, e);
                }
            }
        };
        bakeElementLocales(core.MODULES, "modules", language);
        bakeElementLocales(core.PLUGINS, "plugins", language);
        if (language !== "en") {
            // English fallback bundles: i18next falls back per-namespace via
            // fallbackLng, which only works when the en bundle is registered.
            bakeElementLocales(core.MODULES, "modules", "en");
            bakeElementLocales(core.PLUGINS, "plugins", "en");
        }
    }

    const result = {
        resources,
        lng: language,
    };
    if (production) _i18nBakeCache().set(requestedLanguage, result);
    return result;
}

// Production-only registry of scripting `.d.ts` declaration files, inlined into
// the served page as `window.XOPAT_BAKED_DTS` so the client's fetchDtsCached
// (src/classes/scripting/dts-fetch.ts) resolves them without a network
// round-trip. Purely convention-based — no API introspection: core
// `src/classes/scripting/*.scripts.d.ts`, plus per scanned element
// `<dir>/scripting/*.d.ts` and `<dir>/*.scripts.d.ts` (the layouts documented
// in src/classes/scripting/README.md). Keys are app-relative paths — exactly
// what a client URL is after stripping APPLICATION_CONTEXT.url. Anything at a
// custom path just misses the registry and falls back to the cached fetch.
// Computed once per process; restart to invalidate (like _productionCoreCache).
const DTS_BAKE_MAX_BYTES = 256 * 1024;
let _dtsRegistryCache = null;

function getBakedDtsRegistry(core) {
    if (!core?.CORE?.client?.production) return null;
    if (_dtsRegistryCache) return _dtsRegistryCache;

    const registry = {};
    const addFile = (absPath, relPath) => {
        try {
            const stat = fs.statSync(absPath);
            if (!stat.isFile()) return;
            if (stat.size > DTS_BAKE_MAX_BYTES) {
                logger.warn(`dts bake: '${relPath}' exceeds ${DTS_BAKE_MAX_BYTES} bytes - skipped.`);
                return;
            }
            registry[relPath] = fs.readFileSync(absPath, {encoding: 'utf8', flag: 'r'});
        } catch (e) {
            logger.warn(`dts bake: cannot read '${relPath}':`, e);
        }
    };
    const listDir = (absDir) => {
        try { return fs.readdirSync(absDir); } catch (_) { return []; }
    };

    const coreDir = `${constants.ABSPATH}/src/classes/scripting`;
    for (const name of listDir(coreDir)) {
        if (name.endsWith(".scripts.d.ts")) addFile(`${coreDir}/${name}`, `src/classes/scripting/${name}`);
    }

    const bakeElementDts = (records, folder) => {
        for (const record of Object.values(records || {})) {
            const dir = record && record["directory"];
            if (!dir) continue;
            const base = `${constants.ABSPATH}/${folder}/${dir}`;
            for (const name of listDir(`${base}/scripting`)) {
                if (name.endsWith(".d.ts")) addFile(`${base}/scripting/${name}`, `${folder}/${dir}/scripting/${name}`);
            }
            for (const name of listDir(base)) {
                if (name.endsWith(".scripts.d.ts")) addFile(`${base}/${name}`, `${folder}/${dir}/${name}`);
            }
        }
    };
    bakeElementDts(core.MODULES, "modules");
    bakeElementDts(core.PLUGINS, "plugins");

    _dtsRegistryCache = registry;
    return registry;
}

/**
 * Directories (repo-root-relative) whose contents may be served as static files.
 *
 * Before this list existed the rule was "any path ending in `.xx`–`.xxxxx` that
 * exists on disk", i.e. the entire repository root — which served
 * `env/env.json` (the deployment config, `core.server.secure` and all), the
 * storage root under `server/.cache/`, `package.json`, and every `.server-dist`
 * bundle, all unauthenticated. The `delete CORE.server.secure` strip protects
 * the rendered page; it never protected the raw file.
 *
 * These four cover everything the client actually loads (`core.js` derives
 * PROJECT_SOURCES/UI_SOURCES/MODULES_FOLDER/PLUGINS_FOLDER from exactly them),
 * plus `server/static` for the scheme helper. A deployment that serves assets
 * from somewhere else (custom `setup.branding` icons, say) adds it with
 * `core.server.staticRoots: ["my-assets"]` rather than reopening the root.
 */
const DEFAULT_STATIC_ROOTS = Object.freeze([
    "src", "ui", "modules", "plugins",
    "server/static",        // scheme.js and friends
    "docs/assets",          // server/templates/index.html references the banner
]);

/** Case-insensitive on win32, where the filesystem is. */
const _samePathCase = (s) => (process.platform === "win32" ? s.toLowerCase() : s);

function pathIsInside(candidate, parent) {
    const c = _samePathCase(candidate);
    const p = _samePathCase(parent);
    return c === p || c.startsWith(p + path.sep);
}

let _staticRootsCache = null;
function staticRoots() {
    if (_staticRootsCache) return _staticRootsCache;
    const root = constants._ABSPATH_NO_SLASH || constants.ABSPATH;
    const extra = Array.isArray(EXTRA_STATIC_ROOTS) ? EXTRA_STATIC_ROOTS : [];
    const seen = new Set();
    const out = [];
    for (const rel of [...DEFAULT_STATIC_ROOTS, ...extra]) {
        if (typeof rel !== "string" || !rel.trim()) continue;
        const abs = path.resolve(root, rel.replace(/[\\/]+/g, path.sep));
        // An operator-configured root that escapes the repo is a configuration
        // bug, not a feature — refuse it loudly instead of honouring it.
        if (!pathIsInside(abs, root)) {
            logger.warn(`[static] ignoring staticRoots entry '${rel}': resolves outside the application root.`);
            continue;
        }
        const key = _samePathCase(abs);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(abs);
    }
    _staticRootsCache = out;
    return out;
}

/**
 * Second gate, applied *inside* the allowed roots. The roots already exclude
 * `env/` and `server/.cache/`; this is what keeps server-side material that
 * legitimately lives next to client code from leaking.
 */
function isDeniedStaticPath(relPath) {
    for (const seg of relPath.split("/")) {
        if (!seg) continue;
        // `.server-dist`, `.git`, `.env`, `.cache`, editor droppings.
        if (seg.startsWith(".")) return true;
        // `*.server.ts` / `.server.mjs` — server-side sources sitting in a
        // plugin/module directory alongside the client bundle.
        if (/\.server\.[cm]?[jt]s$/i.test(seg)) return true;
        // Author server manifest: config, never fetched by the client.
        if (seg.toLowerCase() === "server.json") return true;
    }
    return false;
}

/**
 * Resolve a request path to a real file inside an allowed root, or `null`.
 *
 * The pathname is NOT percent-decoded — matching the previous behaviour exactly,
 * so no URL that used to resolve stops resolving. Containment is checked twice:
 * once on the resolved path (traversal) and once on the realpath (a symlink
 * inside an allowed root pointing out of it).
 */
async function resolveStaticTarget(pathname) {
    // Backslash is not a path separator to the URL parser but IS one to `fs` on
    // Windows, so `/x\..\..\package.json` was a live traversal there.
    const rel = String(pathname).replace(/^\/+/, "").replace(/\\/g, "/");
    if (!rel || isDeniedStaticPath(rel)) return null;

    const root = constants._ABSPATH_NO_SLASH || constants.ABSPATH;
    const candidate = path.resolve(root, rel);
    const roots = staticRoots();
    if (!roots.some(r => pathIsInside(candidate, r))) return null;

    let real;
    try {
        real = await fsp.realpath(candidate);
    } catch (_) {
        return null;                       // missing, or a broken symlink
    }
    if (!roots.some(r => pathIsInside(real, r))) return null;

    let stat;
    try {
        stat = await fsp.stat(real);
    } catch (_) {
        return null;
    }
    // A directory used to reach `fs.readFile` and answer 500 with the errno.
    if (!stat.isFile()) return null;

    return { path: real, stat };
}

async function responseStaticFile(req, res, target, urlObj) {
    const contentType = utils.mimeOf(target.path);
    const version = urlObj?.searchParams?.get("v") || urlObj?.searchParams?.get("version");

    // Cheap, correct validators — the previous handler had none, so an
    // unversioned asset was re-read and re-sent in full on every request.
    const etag = `W/"${target.stat.size.toString(16)}-${Math.floor(target.stat.mtimeMs).toString(16)}"`;
    const lastModified = target.stat.mtime.toUTCString();

    const headers = {
        "Content-Type": contentType,
        "ETag": etag,
        "Last-Modified": lastModified,
    };
    if (version) {
        headers["Cache-Control"] = "public, max-age=31536000, immutable";
    } else {
        headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
        headers["Pragma"] = "no-cache";
        headers["Expires"] = "0";
    }

    const inm = req.headers["if-none-match"];
    if (inm && inm.split(",").some(t => t.trim() === etag)) {
        res.writeHead(304, headers);
        return res.end();
    }

    let content;
    try {
        content = await fsp.readFile(target.path);
    } catch (e) {
        logger.warn(`[static] read failed for '${target.path}':`, e?.code || e);
        res.writeHead(500, { "Content-Type": "text/plain" });
        return res.end("Sorry, check with the site admin.");
    }

    headers["Content-Length"] = content.length;
    res.writeHead(200, headers);
    res.end(content);
}

/**
 * Request headers forwarded upstream, lowercase.
 *
 * This used to be a denylist of four (`host`, `connection`, `origin`,
 * `referer`) spread over `{...req.headers}`, which meant the browser's
 * `Cookie: xopat_session=…`, its `Authorization`, and `X-XOPAT-CSRF` were all
 * handed to whatever third party `baseUrl` pointed at. A denylist is the wrong
 * shape here: every header added to the web platform defaults to "leaked".
 *
 * Anything an upstream legitimately needs beyond this list is the operator's
 * decision, expressed as `proxies.<alias>.headers` or written by a proxy auth
 * verifier into `upstream.headers` — both of which are merged after this.
 */
const PROXY_FORWARDED_REQUEST_HEADERS = Object.freeze(new Set([
    "accept", "accept-language", "accept-encoding",
    "content-type", "content-length",
    "range", "if-range", "if-none-match", "if-modified-since",
    "user-agent",
]));

/**
 * Response headers NEVER passed back to the browser.
 *
 * `set-cookie` is the important one: an upstream could otherwise set cookies on
 * the viewer's origin. `content-encoding`/`content-length` go because undici has
 * already decoded the body, so both describe bytes we are not sending; letting
 * Node re-chunk is correct. The rest are hop-by-hop.
 */
const PROXY_STRIPPED_RESPONSE_HEADERS = Object.freeze(new Set([
    "set-cookie", "set-cookie2",
    "content-encoding", "content-length",
    "connection", "keep-alive", "transfer-encoding", "upgrade",
    "proxy-authenticate", "proxy-authorization", "te", "trailer",
]));

/** Redirect hops followed before giving up. */
const PROXY_MAX_REDIRECTS = 5;
/**
 * Generous by design: proxied upstreams here are slide/tile servers and LLM
 * endpoints, where a cold model load or a large region render legitimately runs
 * for minutes. Matches XOPAT_SSRF_TIMEOUT_MS's reasoning; override per
 * deployment with `proxies.<alias>.timeoutMs`.
 */
const PROXY_DEFAULT_TIMEOUT_MS = Math.max(
    1000,
    Number(process.env.XOPAT_PROXY_TIMEOUT_MS) || 300_000,
);

function sameOrigin(a, b) {
    try {
        const ua = new URL(a);
        const ub = new URL(b);
        return ua.protocol === ub.protocol && ua.host === ub.host;
    } catch (_) {
        return false;
    }
}

async function responseProxy(req, res, requestUrl) {
    // 1. todo parse just core for now, no need to load plugins
    const core = initViewerCoreAndPlugins(req, res, true);
    if (!core) return;

    // 2. Extract alias from /proxy/alias/v1/...
    const parts = requestUrl.pathname.split('/').filter(Boolean);
    const alias = parts[1];
    const targetPath = '/' + parts.slice(2).join('/') + (requestUrl.search || '');

    // 3. Match against the "secure.proxies" definition. `hasOwnProperty`, not a
    // bare index: `alias` is client-supplied, so `/proxy/constructor/...` would
    // otherwise resolve a prototype member.
    const serverConf = core.CORE.server || core.CORE.serverStatus || {};
    const proxies = serverConf.secure?.proxies;
    const proxyConfig = (proxies && Object.prototype.hasOwnProperty.call(proxies, alias))
        ? proxies[alias]
        : undefined;

    if (!proxyConfig || typeof proxyConfig.baseUrl !== "string") {
        // Do not echo the alias — it is request input, and this response is the
        // one place it would be reflected back.
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('Proxy target alias is not allowed or not configured.');
    }

    const baseUrl = proxyConfig.baseUrl.replace(/\/$/, '');
    const targetUrl = baseUrl + targetPath;

    // 4. Read the body as BYTES. Decoding to a JS string here corrupted every
    // binary upload (STOW-RS, audio) and made the forwarded Content-Length lie.
    let bodyContent = undefined;
    if (!['GET', 'HEAD'].includes(req.method)) {
        bodyContent = await utils.rawReqToBuffer(req);
        if (bodyContent.length === 0) bodyContent = undefined;
    }

    // 5. Build the upstream headers from an ALLOWLIST of the incoming ones.
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
        const key = name.toLowerCase();
        if (!PROXY_FORWARDED_REQUEST_HEADERS.has(key)) continue;
        if (value === undefined) continue;
        headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }
    // We re-encode the body ourselves; a forwarded length can only be wrong.
    delete headers['content-length'];

    // 5b. Let auth verifiers inspect/validate the request and *mutate* upstream headers
    const upstreamState = { headers, targetPath };
    const authOk = await verifyProxyAuth(req, res, core, alias, proxyConfig, upstreamState);
    if (!authOk) {
        // verifyProxyAuth already wrote the error response
        return;
    }

    // 5c. Safely merge the expanded secure headers (e.g. API keys)
    if (proxyConfig.headers) {
        Object.assign(headers, proxyConfig.headers);
    }
    // Snapshot the operator-injected names: these are the credentials, and they
    // must not survive a cross-origin redirect (see the hop loop below).
    const injectedHeaderNames = Object.keys(proxyConfig.headers || {});

    // 6. Forward the request.
    const timeoutMs = Math.max(1000, Number(proxyConfig.timeoutMs) || PROXY_DEFAULT_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Proxy upstream timeout")), timeoutMs);
    timer.unref?.();
    // A browser that navigated away must not leave us holding an upstream
    // socket and buffering its response into nothing.
    const onClientGone = () => controller.abort(new Error("Client disconnected"));
    res.on('close', onClientGone);

    try {
        if (DEV_MODE) {
            logger.debug(`Proxying ${targetPath} -> ${targetUrl}`);
        }

        // Redirects are followed HERE rather than by undici, because undici
        // would replay `proxyConfig.headers` — the operator's API keys — to
        // whatever host the upstream names. A hostile or compromised upstream
        // answering 302 was a credential-harvesting primitive. We re-derive the
        // credential set per hop instead, and only keep it while we are still
        // talking to the configured origin.
        let currentUrl = targetUrl;
        let currentHeaders = headers;
        let fetchRes = null;
        for (let hop = 0; hop <= PROXY_MAX_REDIRECTS; hop += 1) {
            fetchRes = await fetch(currentUrl, {
                method: req.method,
                headers: currentHeaders,
                body: bodyContent,
                redirect: "manual",
                signal: controller.signal,
            });

            if (![301, 302, 303, 307, 308].includes(fetchRes.status)) break;
            const location = fetchRes.headers.get("location");
            if (!location) break;

            const nextUrl = new URL(location, currentUrl).toString();
            if (!sameOrigin(nextUrl, baseUrl)) {
                currentHeaders = { ...currentHeaders };
                for (const name of injectedHeaderNames) delete currentHeaders[name.toLowerCase()];
                delete currentHeaders["authorization"];
                logger.warn(`[proxy] '${alias}' redirected off-origin; injected credentials dropped for the remaining hops.`);
            }
            // 303, and 301/302 on POST, become GET without a body — same rule
            // browsers and undici follow.
            if (fetchRes.status === 303 || (bodyContent && [301, 302].includes(fetchRes.status))) {
                bodyContent = undefined;
            }
            currentUrl = nextUrl;
            if (hop === PROXY_MAX_REDIRECTS) {
                logger.warn(`[proxy] '${alias}' exceeded ${PROXY_MAX_REDIRECTS} redirects.`);
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                return res.end("Bad Gateway: too many redirects from the proxied service.");
            }
        }

        const resHeaders = {};
        for (const [name, value] of fetchRes.headers.entries()) {
            if (PROXY_STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
            resHeaders[name] = value;
        }

        res.writeHead(fetchRes.status, resHeaders);

        if (!fetchRes.body || req.method === 'HEAD') {
            return res.end();
        }
        // Streamed, not buffered: this is the WSI tile and DICOMweb path, and
        // `arrayBuffer()` + `Buffer.from` held every response fully resident and
        // copied it twice. Backpressure now belongs to the socket.
        await pipeline(Readable.fromWeb(fetchRes.body), res);
    } catch (e) {
        if (controller.signal.aborted && res.writableEnded) return;   // client left mid-stream
        logger.error(`Proxy error routing to ${alias}:`, e);
        if (res.headersSent) {
            // Already streaming — the only honest signal left is a truncated
            // body, so destroy rather than append a misleading tail.
            return res.destroy();
        }
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end("Bad Gateway: Error communicating with the proxied service.");
    } finally {
        clearTimeout(timer);
        res.off('close', onClientGone);
    }
}

async function responseViewer(req, res, session) {
    // Parse the request url
    let rawData = req.method === 'POST' ? await rawReqToString(req) : undefined;
    let postData;

    function readPostDataItem(item) {
        // The object can come in double-encoded, try encoding if necessary
        try {
            return JSON.parse(item);
        } catch {
            return item;
        }
    }

    function parsePostData(data) {
        const result = {};
        for (const key in data) {
            const topLevelKey = key.split('[')[0];
            const nestedKeyMatch = key.match(/\[([^\]]+)\]/);

            if (nestedKeyMatch) {
                const nestedKey = nestedKeyMatch[1];
                if (!result[topLevelKey]) {
                    result[topLevelKey] = {};
                }
                result[topLevelKey][nestedKey] = readPostDataItem(data[key]);
            } else {
                result[topLevelKey] = readPostDataItem(data[key]);
            }
        }
        return result;
    }

    try {
        switch (req.headers['content-type']) {
            case 'application/x-www-form-urlencoded':
                postData = querystring.parse(rawData || "");
                break;

            case 'application/json':
            default:
                postData = rawData && JSON.parse(rawData) || {};
                break;
        }

        // Parse structure
        postData = parsePostData(postData);
    } catch (e) {
        //be silent for now
        //todo: maybe notify the user somehow through the session set error prop or something
        logger.warn(e);
        postData = {};
    }
    const core = initViewerCoreAndPlugins(req, res);
    if (!core) return;

    const replacer = function(match, p1) {
        try {
            switch (p1) {
            case "branding":
                return core.requireBrandingHead();

            case "head":
                return `
${core.requireOpenseadragon()}
${core.requireLibs()}
${core.requireExternal()}
${core.requireUI()}
${core.requireCore("loader")}
${core.requireCore("deps")}
${core.requireCore("app")}
${core.requireCore("env")}
<script src="${constants.SERVER_ROOT}client-rpc.js"></script>
<script>
window.XOPAT_CSRF_TOKEN = ${jsonForScript(session ? session.csrfToken : "")};
window.XOPAT_DEV_MODE = ${jsonForScript(DEV_MODE)};
window.xserver = window.xserver || XOpatServerRPC.createClient({
  getViewerId: () => window.VIEWER?.id || undefined
});
</script>
`;

            case "app": {
                const dtsRegistry = getBakedDtsRegistry(core);
                // EVERY value below goes through `jsonForScript`, not bare
                // `JSON.stringify`: `postData` is the request body, so an
                // unescaped `<` there closes this tag and executes attacker HTML
                // on our own origin, next to XOPAT_CSRF_TOKEN. The rest are
                // operator-controlled today and escaped anyway — the invariant
                // is "nothing reaches a <script> body unescaped", because that
                // is the only form of it that survives future edits.
                const dtsLine = dtsRegistry && Object.keys(dtsRegistry).length
                    ? `window.XOPAT_BAKED_DTS = ${jsonForScript(dtsRegistry)};\n    `
                    : "";
                return `
    <script type="text/javascript">
    ${dtsLine}initXOpat(
        ${jsonForScript(core.PLUGINS)},
        ${jsonForScript(core.MODULES)},
        ${jsonForScript(core.CORE)},
        ${jsonForScript(postData)},
        ${jsonForScript(core.PLUGINS_FOLDER)},
        ${jsonForScript(core.MODULES_FOLDER)},
        ${jsonForScript(core.VERSION)},
        ${jsonForScript(getI18NData(core.CORE.setup.locale, core))}
    );
    </script>`;
            }

            case "modules":
                return core.requireModules(core.CORE.client.production);

            case "plugins":
                return core.requirePlugins(core.CORE.client.production);

            case "ui":
                return core.requireUI(core.CORE.client.production);

            default:
                //todo warn
                return "";
            }
        } catch (e) {
            //todo err
            throw e;
        }
    };

    const html = fs.readFileSync(constants.ABSPATH + "server/templates/index.html", { encoding: 'utf8', flag: 'r' })
        .replace(constants.TEMPLATE_PATTERN, replacer);
    // Declaring the type is not optional: applySecurityHeaders sends
    // X-Content-Type-Options: nosniff, which forbids the browser from guessing.
    // Without this header the viewer is delivered as plain text and the user sees
    // the page source.
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.write(html);
    res.end();
}

async function responseDeveloperSetup(req, res) {
    // Parse the request url
    const core = initViewerCoreAndPlugins(req, res);
    if (!core) return;

    const replacer = function (match, p1) {
        try {
            switch (p1) {
                case "head":
                    return `
${core.requireOpenseadragon()}
${core.requireLibs()}
${core.requireUI()}
${core.requireCore("env")}
${core.requireCore("deps")}`;
                case "form-init":
                    return `
    <script type="text/javascript">
    window.formInit = ${jsonForScript({
        location: `${constants.PROJECT_ROOT}/`,
        lang: { ready: "Ready!" },
    })};
    </script>`;

                default:
                    return "";
            }
        } catch (e) {
            //todo err
            throw e;
        }
    };

    const html = fs.readFileSync(constants.ABSPATH + "server/templates/dev-setup.html", { encoding: 'utf8', flag: 'r' })
        .replace(constants.TEMPLATE_PATTERN, replacer);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });   // nosniff: see responseViewer
    res.write(html);
    res.end();
}

async function responseScheme(req, res, templateName="scheme.html") {
    const core = initViewerCoreAndPlugins(req, res);
    if (!core) return;

    const payload = {
        viewer: {
            name: core.CORE?.name || "xOpat",
            version: core.VERSION || STARTUP_VERSION,
        },
        paramsDefaults: core.CORE?.setup || {},
        clientDefaults: {
            // New slide-protocol registry (preferred).
            slide_protocols: core.CORE?.client?.slide_protocols ?? null,
            default_background_protocol: core.CORE?.client?.default_background_protocol ?? null,
            default_visualization_protocol: core.CORE?.client?.default_visualization_protocol ?? null,
            // Legacy fields kept for one deprecation cycle. Auto-synthesized into
            // __legacy_bg / __legacy_viz registry entries client-side.
            image_group_server: core.CORE?.client?.image_group_server ?? null,
            image_group_protocol: core.CORE?.client?.image_group_protocol ?? null,
            data_group_server: core.CORE?.client?.data_group_server ?? null,
            data_group_protocol: core.CORE?.client?.data_group_protocol ?? null,
        },
        plugins: normalizeSchemePluginRecords(core.PLUGINS),
        typesSource: fs.readFileSync(
            path.join(constants._ABSPATH_NO_SLASH || constants.ABSPATH, "src/types/app.d.ts"),
            { encoding: "utf8", flag: "r" }
        ),
        configTypesSource: fs.readFileSync(
            path.join(constants._ABSPATH_NO_SLASH || constants.ABSPATH, "src/types/config.d.ts"),
            { encoding: "utf8", flag: "r" }
        )
    };

    const replacer = function (match, p1) {
        try {
            switch (p1) {
                case "head":
                    return `
${core.requireOpenseadragon()}
${core.requireLibs()}
${core.requireCore("env")}`;
                case "page-init":
                    // `typesSource`/`configTypesSource` are raw `.d.ts` text and
                    // routinely contain `<` (generics) — bare JSON.stringify
                    // would only need one `</script` in a doc comment to break
                    // the page open.
                    return `
    <script type="text/javascript">
    window.schemeInit = ${jsonForScript(payload)};
    </script>`;
                case "shared-scheme-script":
                    return `
    <script type="text/javascript">
${fs.readFileSync(
    path.join(constants._ABSPATH_NO_SLASH || constants.ABSPATH, "server/static/scheme.js"),
    { encoding: "utf8", flag: "r" }
)}
    </script>`;
                default:
                    return "";
            }
        } catch (e) {
            throw e;
        }
    };

    const html = fs.readFileSync(
        path.join(constants._ABSPATH_NO_SLASH || constants.ABSPATH, `server/templates/${templateName}`),
        { encoding: "utf8", flag: "r" }
    ).replace(constants.TEMPLATE_PATTERN, replacer);

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });   // nosniff: see responseViewer
    res.write(html);
    res.end();
}

/**
 * Baseline response headers, applied to every response before routing.
 *
 * There were none at all — no nosniff, no framing policy, no referrer policy.
 * Deliberately NOT including a CSP: the viewer page is built on inline
 * `<script>` blocks (`initXOpat(...)`, the CSRF/dev-mode block), so any
 * enforcing policy strict enough to be worth having would break the app. The
 * honest sequence is nonce-ing those blocks first; until then a report-only
 * policy can be switched on per deployment with `core.server.csp`.
 *
 * `X-Frame-Options` is configurable because xOpat is legitimately embedded by
 * third-party apps (the whole POST_DATA integration story, and
 * XOPAT_CROSS_SITE_COOKIES exists for exactly that). Cross-site cookie mode
 * therefore defaults to no framing restriction rather than silently breaking
 * the embedders it was added for.
 */
function applySecurityHeaders(res, { isSecure }) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

    if (SECURITY_HEADERS.frameOptions) {
        res.setHeader('X-Frame-Options', SECURITY_HEADERS.frameOptions);
    }
    if (SECURITY_HEADERS.csp) {
        res.setHeader(
            SECURITY_HEADERS.cspReportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy',
            SECURITY_HEADERS.csp,
        );
    }
    // Only over TLS: sending HSTS on a plain-HTTP dev server would pin
    // localhost to https in the developer's browser, which is a nasty thing to
    // do to someone and survives long after the server is gone.
    if (isSecure && SECURITY_HEADERS.hstsMaxAge > 0) {
        res.setHeader('Strict-Transport-Security', `max-age=${SECURITY_HEADERS.hstsMaxAge}`);
    }
}

const server = http.createServer(async (req, res) => {
    try {
        const protocol = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
        const host = req.headers.host || 'localhost';
        applySecurityHeaders(res, { isSecure: protocol === 'https' });

        // Ensure request target starts with exactly one leading slash.
        // This prevents paths like "//foo" becoming "http://host//foo".
        let requestPath = req.url || '/';
        requestPath = '/' + requestPath.replace(/^\/+/, '');
        const urlObj = new URL(requestPath, `${protocol}://${host}`);

        // Liveness: "this process is running". Deliberately says nothing about
        // whether it can serve — that is /ready's job.
        if (urlObj.pathname.startsWith("/health")) {
            res.writeHead(200);
            res.end();
            return;
        }

        // Readiness: "this process can serve traffic". Non-200 while extensions
        // are still loading, when they failed, and for the whole drain window —
        // which is what lets a load balancer take a worker out BEFORE its
        // sockets start closing.
        if (urlObj.pathname.startsWith("/ready")) {
            const ok = EXTENSIONS_READY && !shuttingDown;
            res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ready: ok,
                shuttingDown,
                extensions: EXTENSIONS_ERROR ? "failed" : (EXTENSIONS_READY ? "loaded" : "loading"),
                pid: process.pid,
                worker: cluster.isWorker ? cluster.worker.id : null,
            }));
            return;
        }

        if (urlObj.pathname === "/server/client-rpc.js") {
            res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
            res.end(serverRuntime.getClientRuntimeSource());
            return;
        }

        if (urlObj.pathname.startsWith("/__rpc/")) {
            // withPlugins populates core.CORE_AUTHOR_SECURE so
            // getSecurePluginConfig can fall back on author-shipped server.json
            // defaults during RPC. serverOnly mode preserves CORE.server.secure
            // (deployer tier); loading plugins additionally fills the author
            // tier — and in production the scan comes from the core cache
            // instead of re-walking the plugin directories per RPC call.
            const core = initViewerCoreAndPlugins(req, res, true, true);
            if (!core) return;
            const session = await getSession(req, res);
            // `return await`, not a bare `return`: a bare return resolves AFTER the
            // try block exits, so the catch below never observes a rejection and it
            // surfaces as an unhandled rejection instead of a 500.
            return await serverRuntime.handleRpc(req, res, core, session, urlObj);
        }

        // --- New: proxy endpoint with session check ---
        if (urlObj.pathname.startsWith("/proxy/")) {
            const session = await getSession(req, res);
            if (!session) {
                res.writeHead(401, { 'Content-Type': 'text/plain' });
                return res.end('Unauthorized: missing or invalid session');
            }

            // optional: CSRF header check
            const clientToken = req.headers['x-xopat-csrf'];
            if (!csrfTokenMatches(clientToken, session.csrfToken)) {
                res.writeHead(403, { 'Content-Type': 'text/plain' });
                return res.end('Forbidden: invalid CSRF token');
            }

            return await responseProxy(req, res, urlObj, session);
        }
        // --- end new proxy route ---

        // --- Module-registered server routes (generic; e.g. oidc-server-ts OAuth
        // login/callback). Modules register a prefix→handler at boot via the
        // server-extension serverApi. Core stays auth-agnostic. See src/AUTH.md. ---
        if (serverRuntime.matchServerRoute(urlObj.pathname)) {
            const core = initViewerCoreAndPlugins(req, res, true);
            if (!core) return;
            const session = await getSession(req, res);
            return void await serverRuntime.dispatchServerRoute(req, res, core, session, urlObj);
        }
        // --- end module server routes ---

        // Treat suffix paths as attempt to access existing files. Resolution is
        // confined to the allowed roots (see DEFAULT_STATIC_ROOTS) — a path that
        // exists but sits outside them is a 404, not a download.
        if (urlObj.pathname.match(/.+\..{2,5}$/g)) {
            const target = await resolveStaticTarget(urlObj.pathname);
            if (target) {
                return await responseStaticFile(req, res, target, urlObj);
            }
            res.writeHead(404);
            res.end();
            return;
        }

        // These four publish the deployment's own configuration surface — every
        // plugin's `include.json` merged with its `ENV.plugins.<id>` block, plus
        // the full text of src/types/*.d.ts. That is a development aid, not
        // something an anonymous visitor to a production deployment needs.
        if (urlObj.pathname.startsWith("/dev_setup")
            || urlObj.pathname.startsWith("/scheme")) {
            if (!EXPOSE_SCHEME_ROUTES) {
                res.writeHead(404);
                res.end();
                return;
            }
            if (urlObj.pathname.startsWith("/dev_setup")) {
                return responseDeveloperSetup(req, res);
            }
            if (urlObj.pathname.startsWith("/scheme_raw_extended")) {
                return responseScheme(req, res, "scheme-raw-extended.html");
            }
            if (urlObj.pathname.startsWith("/scheme_raw")) {
                return responseScheme(req, res, "scheme-raw.html");
            }
            return responseScheme(req, res);
        }

        let session = await getSession(req, res);
        if (!session) {
            session = await createSession(res, { isSecureRequest: protocol === 'https' });
        }

        return await responseViewer(req, res, session);
    } catch (e) {
        // An oversized body is the caller's fault and has its own status — it
        // must not be reported as an internal error, and its message must not be
        // echoed back verbatim like the generic branch does.
        if (e instanceof RawBodyTooLargeError) {
            // `Connection: close` because the request body was left unread — the
            // socket cannot be reused for a keep-alive follow-up.
            if (!res.headersSent) {
                res.writeHead(413, { 'Content-Type': 'text/plain', 'Connection': 'close' });
            }
            return res.end('Payload too large');
        }
        // The exception text used to be echoed to the caller verbatim, which
        // leaks filesystem paths and parse internals (a malformed Cookie header
        // alone produced `URIError: URI malformed` with a stack-shaped message).
        // The detail belongs in the log; the caller gets a correlation id.
        const errorId = crypto.randomUUID();
        logger.error(`[request] unhandled error ${errorId}`, e);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(`Internal server error. Reference: ${errorId}`);
        } else {
            res.end();
        }
    }
});

/**
 * Socket-level timeouts. None of these were configured, so Node's defaults
 * applied — in particular a 5s `keepAliveTimeout`, which is the classic source
 * of sporadic 502s behind a reverse proxy that assumes it may reuse an idle
 * connection for longer than the origin will hold it.
 *
 * `requestTimeout` is deliberately generous rather than tight: streaming RPC
 * responses (chat turns, dictation) legitimately stay open for many minutes,
 * and cutting one is a data-loss event for the user, not a tidy-up. The
 * protections that actually bound work are the per-method `timeoutMs`, the body
 * caps, and the concurrency gates — not this.
 */
server.keepAliveTimeout = Math.max(1000, Number(process.env.XOPAT_KEEPALIVE_TIMEOUT_MS) || 75_000);
// Must exceed keepAliveTimeout, or a connection can be closed between the
// headers arriving and the handler seeing them.
server.headersTimeout = Math.max(server.keepAliveTimeout + 5000,
    Number(process.env.XOPAT_HEADERS_TIMEOUT_MS) || 90_000);
server.requestTimeout = Math.max(0, Number(process.env.XOPAT_REQUEST_TIMEOUT_MS) ?? 0) || 0;
server.maxHeadersCount = 200;

// Load module/plugin server extensions (e.g. auth verifiers) BEFORE accepting
// connections, so a module-provided verifier is registered ahead of the first
// gated request. See XopatServerRuntime.loadServerExtensions / src/AUTH.md.
function startListening() {
    server.listen(constants.SERVER.PORT, constants.SERVER.HOST, onListening);
}

/**
 * Readiness, distinct from liveness.
 *
 * `/health` answers 200 from the very top of the handler and always has — but
 * `startListening` runs in `.finally()`, so the port opens even when
 * `loadServerExtensions()` rejected. A worker with no registered RPC methods
 * therefore looked perfectly healthy to an orchestrator, which would happily
 * route traffic to it. `/ready` is the one that knows the difference.
 */
let EXTENSIONS_READY = false;
let EXTENSIONS_ERROR = null;

Promise.resolve()
    .then(() => serverRuntime.loadServerExtensions())
    // Anonymous principals are derived from the browser session, so anything a
    // module stores under `sess:<id>` must die with it. Publish the hook rather
    // than coupling this file to any module that keeps such state.
    .then(() => { if (globalThis.XOPAT_SERVER) globalThis.XOPAT_SERVER.onSessionEvicted = onSessionEvicted; })
    .then(() => { EXTENSIONS_READY = true; })
    .catch(e => {
        EXTENSIONS_ERROR = e;
        logger.error("Server extension registration failed:", e);
    })
    .finally(startListening);

/**
 * Ordered, bounded shutdown.
 *
 * Previously there was no SIGTERM/SIGINT handler anywhere in `server/`, so
 * `docker stop` killed the process outright: in-flight NDJSON streams were
 * severed without a terminal record, and session write-backs queued on
 * `res.on('finish')` never ran. Both are user-visible losses.
 *
 * The grace window is long on purpose (see cluster-index.js) — keep it under
 * the orchestrator's own kill timeout.
 */
const SHUTDOWN_GRACE_MS = Math.max(1000, Number(process.env.XOPAT_SHUTDOWN_GRACE_MS) || 120_000);
let shuttingDown = false;

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    EXTENSIONS_READY = false;          // fail readiness immediately: stop new traffic
    logger.info(`[process] ${signal} received — draining (grace ${SHUTDOWN_GRACE_MS}ms)`);

    const hardStop = setTimeout(() => {
        logger.error('[process] drain exceeded the grace window; exiting anyway');
        process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    hardStop.unref();

    try {
        // 1. Stop accepting. In-flight requests keep running.
        await new Promise((resolve) => server.close(resolve));

        // 2. End streams with a terminal record rather than a severed socket.
        const closed = serverRuntime.closeActiveStreams?.('Server is shutting down') || 0;
        if (closed) logger.info(`[process] closed ${closed} in-flight stream(s)`);

        // 3. Let the 'finish' handlers that persist sessions actually run.
        await new Promise((resolve) => setImmediate(resolve));

        // 4. Release storage: flushes what the drivers hold and hands back the
        // sweeper lease so the next process does not wait it out.
        // `getServerStorage()` hands back `{storage, cache}`; the broker with the
        // sweeper lease and the drivers is the `storage` half.
        await getServerStorage()?.storage?.dispose?.();
    } catch (e) {
        logger.error('[process] error during shutdown', e);
    } finally {
        clearTimeout(hardStop);
        logger.info('[process] shutdown complete');
        process.exit(0);
    }
}

process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });
function onListening() {
    const ENV = process.env.XOPAT_ENV;
    const existsDefaultLocation = fs.existsSync(`${ABSPATH}env${path.sep}env.json`);
    if (!ENV && existsDefaultLocation) {
        logger.info("Using env/env.json..");
    } else if (ENV) {
        if (fs.existsSync(ENV)) logger.info("Using static ENV from ", ENV);
        else logger.info("Using configuration from XOPAT_ENV: ", ENV.substring(0, 31) + "...");
    } else {
        logger.info("Using default ENV (no overrides).");
    }

    const port = constants.SERVER.PORT;
    const scheme = port === 443 ? "https" : "http";
    const host = constants.SERVER.HOST === "0.0.0.0" ? "localhost" : constants.SERVER.HOST;
    const url = ["80", "443"].includes(port) ? `${scheme}://${host}` : `${scheme}://${host}:${port}`;
    logger.info(`The server is listening on ${url} ...`);
    if (EXPOSE_SCHEME_ROUTES) {
        logger.info(`  To manually create and run a session, open ${url}/dev_setup`);
        logger.info(`  To inspect the deployment-aware session schema, open ${url}/scheme`);
        logger.info(`  To inspect the raw machine-readable schema output, open ${url}/scheme_raw`);
        logger.info(`  To inspect the raw extended schema output, open ${url}/scheme_raw_extended`);
    } else {
        logger.info(`  /dev_setup and /scheme* are disabled (not dev mode). Enable with core.server.exposeSchemeRoutes.`);
    }
    logger.info(`  To open using GET, provide ${url}?slides=slide,list&masks=mask,list`);
    logger.info(`  To open using JSON session, provide ${url}#urlEncodedSessionJSONHere`);
    logger.info(`                                      or sent the data using HTTP POST`);
    logger.info(`  The session description is available in src/README.md`);
}
