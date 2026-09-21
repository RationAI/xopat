"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const {
    findNearestItemRoot,
    getServerBuildDir,
    loadServerModuleFromFile: loadServerModuleFile,
} = require("./server-module-loader");

const {
    SsrfBlockedError,
    UpstreamRequestError,
    validateUpstreamUrl,
    safeFetch,
    safeRequest,
} = require("./ssrf-guard");

const {
    getServerStorage,
    setStorageConfig,
    StorageConfigError,
} = require("./storage");

const {
    getServerLogging,
    setLoggingConfig,
} = require("./logging");

const roles = require("./roles");

/**
 * The viewer core config a role decision resolves against.
 *
 * Every RPC ctx carries it; a server-route ctx may not, and a role check with
 * no config resolves against no definitions — which is "nothing is denied", the
 * same answer an unconfigured deployment gives everywhere else.
 */
function resolveCore(ctx) {
  return ctx?.core || {};
}

// `auth.js` only depends on ./utils, so this is cycle-free.
const {
    verifyJwtToken,
    normalizePrincipalUser,
    requireRpcAuthContext,
    resolveVerifierContext,
    RpcAuthContextError,
    setSessionAllowedProxies,
    proxyAliasAllowedForSession,
} = require("./auth");

/**
 * JSON safe to interpolate into a `<script>` body.
 *
 * `JSON.stringify` escapes quotes and backslashes but NOT `<`, so a value
 * containing `</script>` closes the tag and everything after it is parsed as
 * HTML. U+2028/U+2029 are escaped too: legal inside a JSON string, but literal
 * line terminators in JS source, so an unescaped one is a syntax error.
 *
 * Use this for EVERY interpolation into a `<script>` body — including values
 * that look operator-controlled today. `undefined` collapses to `null` so the
 * result is always valid JS.
 *
 * Lives here (not in index.js) so module server routes rendering their own
 * pages can reach it via `XOPAT_SERVER.jsonForScript`.
 */
// U+2028/U+2029 are built with fromCharCode: raw ones are LineTerminators
// (a syntax error inside a regex literal) and easy to mangle in transit.
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);
const SCRIPT_ESCAPES = Object.freeze({
    "<": "\\u003c",
    [LINE_SEP]: "\\u2028",
    [PARA_SEP]: "\\u2029",
});
const SCRIPT_UNSAFE_CHARS = new RegExp("[<" + LINE_SEP + PARA_SEP + "]", "g");
function jsonForScript(value) {
    return JSON.stringify(value === undefined ? null : value)
        .replace(SCRIPT_UNSAFE_CHARS, (ch) => SCRIPT_ESCAPES[ch]);
}

/**
 * Escape a value for interpolation into HTML *text* or an attribute value.
 * NOT a sanitizer — it does not make untrusted markup safe to render, it makes
 * a string render as that literal string. For a `<script>` body use
 * {@link jsonForScript} instead; escaping is not the same problem there.
 */
const HTML_UNSAFE_CHARS = /[&<>"']/g;
const HTML_ESCAPES = Object.freeze({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
});
function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
        .replace(HTML_UNSAFE_CHARS, (ch) => HTML_ESCAPES[ch]);
}

const SERVER_FILE_RE = /\.server\.(js|mjs|ts)$/i;

function getItemServerBuildDir(runtime, file) {
    return getServerBuildDir(runtime, file);
}

function getSecureRoot(ctx) {
  return ctx?.secure || ctx?.core?.CORE?.server?.secure || {};
}

// Canonical operator-set dev flag (XOPAT_DEV_MODE / --dev), baked onto
// core.CORE.server.devMode. Server modules should gate dev-only behavior on
// this instead of inventing their own XOPAT_*_DEBUG env var. Client-side, the
// equivalent is APPLICATION_CONTEXT.getOption("debugMode").
function isDevMode(ctx) {
  return ctx?.core?.CORE?.server?.devMode === true;
}

function getAuthorRoot(ctx) {
  return ctx?.core?.CORE_AUTHOR_SECURE || {};
}

function getSecureModules(ctx) {
  return getSecureRoot(ctx).modules || {};
}

function getSecurePlugins(ctx) {
  return getSecureRoot(ctx).plugins || {};
}

// Author tier (server.json contents minus `requiredConfig`) layered under
// the deployer tier. Deployer values win on overlap; nested keys merge
// per-leaf when `core.objectMergeRecursiveDistinct` is available.
function composeSecure(ctx, author, deployer) {
  const hasAuthor = author && typeof author === "object" && Object.keys(author).length > 0;
  const hasDeployer = deployer && typeof deployer === "object" && Object.keys(deployer).length > 0;
  if (!hasAuthor) return hasDeployer ? deployer : {};
  if (!hasDeployer) return author;
  // objectMergeRecursiveDistinct uses `this` for recursion, so call it as
  // a method on core (not an unbound reference).
  if (ctx?.core && typeof ctx.core.objectMergeRecursiveDistinct === "function") {
    return ctx.core.objectMergeRecursiveDistinct(JSON.parse(JSON.stringify(author)), deployer);
  }
  return { ...author, ...deployer };
}

function getSecureModuleConfig(ctx, moduleId) {
  const id = moduleId || ctx?.itemId;
  const deployer = getSecureModules(ctx)?.[id] || {};
  const author = (getAuthorRoot(ctx).modules || {})[id] || {};
  return composeSecure(ctx, author, deployer);
}

function getSecurePluginConfig(ctx, pluginId) {
  const id = pluginId || ctx?.itemId;
  const deployer = getSecurePlugins(ctx)?.[id] || {};
  const author = (getAuthorRoot(ctx).plugins || {})[id] || {};
  return composeSecure(ctx, author, deployer);
}

function getSecureItemConfig(ctx, explicitId) {
  const id = explicitId || ctx?.itemId;
  if (ctx?.kind === "module") return getSecureModuleConfig(ctx, id);
  if (ctx?.kind === "plugin") return getSecurePluginConfig(ctx, id);
  return {};
}

// ── Ctx-free config access ───────────────────────────────────────────────────
//
// Every accessor above needs a request `ctx`. A lot of module state is built
// LAZILY and outside any request (a store constructed on first use, a retention
// policy read at import), which is exactly how modules ended up reading
// `process.env` instead of the server config. The snapshot closes that gap: core
// republishes the composed config on every core build, and module code reads its
// own block without a ctx.
//
// A ctx, when you have one, is still preferable — it is the live per-request
// config rather than the last published build.
const CONFIG_SNAPSHOT_KEY = "__XOPAT_SERVER_CONFIG_SNAPSHOT__";

/** Publish the composed server config. Called by core on every core build. */
function setServerConfigSnapshot(core) {
  const secure = core?.CORE?.server?.secure || core?.CORE_SECURE || {};
  globalThis[CONFIG_SNAPSHOT_KEY] = {
    CORE: {
      server: { secure, devMode: core?.CORE?.server?.devMode === true },
    },
    CORE_AUTHOR_SECURE: core?.CORE_AUTHOR_SECURE || { plugins: {}, modules: {} },
    objectMergeRecursiveDistinct: typeof core?.objectMergeRecursiveDistinct === "function"
      ? core.objectMergeRecursiveDistinct.bind(core)
      : undefined,
  };
}

/** A synthetic ctx over the published snapshot, or `null` before the first build. */
function snapshotCtx(kind, itemId) {
  const core = globalThis[CONFIG_SNAPSHOT_KEY];
  if (!core) return null;
  return { core, kind, itemId, secure: core.CORE.server.secure };
}

/**
 * The composed (author ⊕ deployer) server config of a plugin/module, without a
 * request ctx. Returns `{}` before core has published a snapshot — treat that as
 * "defaults", never as "configured empty".
 */
function getStaticItemConfig(kind, id) {
  const ctx = snapshotCtx(kind, id);
  return ctx ? getSecureItemConfig(ctx, id) : {};
}

function getSecureValue(ctx, pathLike, fallback) {
  const parts = Array.isArray(pathLike) ? pathLike : String(pathLike || "").split(".").filter(Boolean);
  let cur = getSecureRoot(ctx);
  for (const key of parts) {
    if (!cur || typeof cur !== "object" || !(key in cur)) return fallback;
    cur = cur[key];
  }
  return cur === undefined ? fallback : cur;
}

function requireSecureValue(ctx, pathLike) {
  const value = getSecureValue(ctx, pathLike, undefined);
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing secure configuration: ${Array.isArray(pathLike) ? pathLike.join(".") : pathLike}`);
  }
  return value;
}

/**
 * The verifier-context entry for a context id, main-context aliases applied
 * ("core" / "default" / "" all name the viewer's main identity).
 *
 * BREAKING (was: `rpcAuth[key] || rpcAuth.default`): an unknown *named* context
 * now returns `null` instead of silently falling back to `default`, and the
 * lookup no longer walks the prototype — `getRpcAuthConfig(ctx, "__proto__")`
 * used to hand back `Object.prototype`. Three lookups that disagreed on the
 * fallback rule is what produced this whole class of bug; they share one
 * resolver now.
 */
function getRpcAuthConfig(ctx, contextId) {
  const secure = getSecureRoot(ctx);
  const contexts = secure.rpcVerifiers || secure.rpcAuth || {};
  const key = contextId || ctx?.contextId;
  const resolved = resolveVerifierContext(contexts, key);
  return resolved.found ? (resolved.entry ?? null) : null;
}

function getProxyConfig(ctx, alias) {
  return getSecureRoot(ctx).proxies?.[alias] || null;
}

// ── The principal ────────────────────────────────────────────────────────────

/**
 * The caller's identity, as one opaque string: `user:<id>` when a verifier
 * established an identity, `sess:<id>` for an anonymous-but-tracked browser.
 *
 * THROWS when neither exists. A request with no principal is unauthorized; it
 * must never fall through to a shared bucket. Use this for ownership stamps and
 * per-user storage scopes — never `ctx.user?.id ?? null`, which collapses every
 * anonymous caller into one mutually-readable identity.
 *
 * `ctx.principal` is populated by the RPC runtime; the fallback derivation keeps
 * modules working against an older core and on non-RPC ctx shapes (server routes).
 */
function resolvePrincipal(ctx) {
  const principal = tryResolvePrincipal(ctx);
  if (!principal) {
    throw new Error("Cannot resolve principal: no authenticated user and no server session.");
  }
  return principal;
}

/** {@link resolvePrincipal} that reports `null` instead of throwing. */
function tryResolvePrincipal(ctx) {
  if (typeof ctx?.principal === "string" && ctx.principal) return ctx.principal;
  const userId = ctx?.user?.id;
  if (typeof userId === "string" && userId) return `user:${userId}`;
  const sessionId = ctx?.session?.id;
  if (sessionId) return `sess:${String(sessionId)}`;
  return null;
}

function parseServerTarget(target) {
  if (!target) throw new Error("Server target is required.");
  if (typeof target === "object") return target;

  const value = String(target).trim();
  const match = value.match(/^(plugin|module):([^/]+)(?:\/(.+))?$/);
  if (match) {
    return { kind: match[1], id: match[2], path: match[3] || "index" };
  }

  if (value.startsWith("./") || value.startsWith("../")) {
    return { kind: "self", path: value };
  }

  throw new Error(`Unsupported server target '${value}'. Use 'plugin:<id>/<path>' or 'module:<id>/<path>'.`);
}

function getItemFromRuntime(runtime, kind, id) {
  if (!runtime?.registry?.[kind]?.[id]) {
    throw new Error(`Unknown ${kind} '${id}'.`);
  }
  return runtime.registry[kind][id];
}

function tryServerFile(basePath) {
  const candidates = [];
  if (SERVER_FILE_RE.test(basePath)) {
    candidates.push(basePath);
  } else {
    candidates.push(`${basePath}.server.ts`, `${basePath}.server.mjs`, `${basePath}.server.js`);
    candidates.push(path.join(basePath, "index.server.ts"), path.join(basePath, "index.server.mjs"), path.join(basePath, "index.server.js"));
  }
  return candidates.find(p => fs.existsSync(p)) || null;
}

function resolveServerFile(runtime, ctx, target) {
  const parsed = parseServerTarget(target);

  let item;
  let relPath;

  if (parsed.kind === "self") {
    const current = getItemFromRuntime(runtime, ctx?.kind, ctx?.itemId);
    item = current;
    relPath = parsed.path;
  } else {
    item = getItemFromRuntime(runtime, parsed.kind, parsed.id);
    relPath = parsed.path || "index";
  }

  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const basePath = path.resolve(item.rootDir, normalized);
  const rootResolved = path.resolve(item.rootDir);

  if (!basePath.startsWith(rootResolved)) {
    throw new Error(`Server target path escapes item root: ${relPath}`);
  }

  const found = tryServerFile(basePath);
  if (!found) {
    throw new Error(`Unable to resolve server file '${relPath}' in ${item.kind} '${item.id}'.`);
  }
  return { item, file: found };
}

/**
 * Load a resolved server file.
 *
 * This used to be a SECOND, independently-drifted copy of the TypeScript
 * compiler: no in-flight dedup, no stale-failed-import retry, and its freshness
 * meta at `<outDir>/.meta.json` — one record per DIRECTORY, so two
 * `*.server.ts` files in the same folder overwrote each other's build stamp and
 * the two loaders never saw each other's cache while racing on the same
 * `.server-dist` tree. There is now exactly one compiler
 * (`server-module-loader.js`), which also holds the cross-process build lock.
 */
async function loadServerModuleFromFile(file, runtime) {
  return loadServerModuleFile(file, runtime);
}

async function importServerModule(ctx, runtime, target) {
    const resolved = resolveServerFile(runtime, ctx, target);
    return loadServerModuleFromFile(resolved.file, runtime);
}

async function importServerExport(ctx, runtime, target, exportName = "default") {
  const mod = await importServerModule(ctx, runtime, target);
  const value = exportName === "default" ? (mod.default ?? mod) : mod[exportName];
  if (value === undefined) {
    throw new Error(`Export '${exportName}' was not found for target '${typeof target === "string" ? target : JSON.stringify(target)}'.`);
  }
  return value;
}

const CACHE_SUBDIR_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/**
 * An absolute, created directory under the server runtime cache
 * (`XOPAT_CACHE_DIR`, default `<root>/server/.cache`).
 *
 * For working files a module owns outright. State that should be bounded,
 * swept, or operator-routable belongs in `XOPAT_SERVER.storage` instead — this
 * is the escape hatch, not the default.
 */
function getServerCacheDir(runtime, subdir) {
  const base = runtime?.cacheDir || path.join(process.cwd(), "server/.cache");
  if (subdir === undefined || subdir === null || subdir === "") {
    fs.mkdirSync(base, { recursive: true });
    return path.resolve(base);
  }
  const rel = String(subdir).replace(/\\/g, "/");
  if (!CACHE_SUBDIR_RE.test(rel) || rel.includes("..")) {
    throw new Error(`Invalid server cache subdirectory: ${JSON.stringify(subdir)}`);
  }
  const baseResolved = path.resolve(base);
  const full = path.resolve(baseResolved, rel);
  if (!full.startsWith(baseResolved + path.sep)) {
    throw new Error("Server cache subdirectory escapes the cache root.");
  }
  fs.mkdirSync(full, { recursive: true });
  return full;
}

function createServerHelpers(runtime) {
  // Created once per process and parked on a global — see storage/index.js.
  const stores = getServerStorage(runtime) || {};
  // Same technique for the logging broker: this function runs on EVERY lazy
  // server-module load, and re-creating the broker would reset the ring buffer.
  const logging = getServerLogging({
    devMode: runtime?.devMode === true,
    baseConsole: console,
    getStorage: () => getServerStorage()?.storage || null,
  });
  return {
    getSecureRoot,
    isDevMode,
  findNearestItemRoot,
      getItemServerBuildDir,
    getSecureModules,
    getSecurePlugins,
    getSecureModuleConfig,
    getSecurePluginConfig,
    getSecureItemConfig,
    // Ctx-free reads of the same config, for lazily-built state that has no
    // request in scope. Prefer the ctx variants when a ctx exists.
    getStaticItemConfig,
    getStaticModuleConfig: (id) => getStaticItemConfig("module", id),
    getStaticPluginConfig: (id) => getStaticItemConfig("plugin", id),
    getSecureValue,
    requireSecureValue,
    getRpcAuthConfig,
    getProxyConfig,
    // Which `/proxy/<alias>` targets a session may reach. Sessions start
    // unrestricted ('ALL') because they are minted anonymously; an auth module
    // narrows this on a completed login — `setSessionAllowedProxies(ctx.session,
    // ["cerit"])`, or 'NONE'. It is UI-independent authorization, enforced in the
    // proxy handler, and it survives the session write-back.
    setSessionAllowedProxies,
    proxyAliasAllowedForSession,
    // Caller identity. Prefer these over reading ctx.user directly — see the
    // "The principal" section of server/node/README.md.
    resolvePrincipal,
    tryResolvePrincipal,
    // Caller ROLES, resolved from the verified token — the half of the roles
    // system that is authorization rather than UI gating. Prefer the
    // declarative `policy.<method>.capabilities` key over calling these; reach
    // for them when the answer depends on the record being touched (this
    // annotation's owner) rather than on the method alone.
    resolveRoles: (ctx) => roles.resolveRoles(ctx, resolveCore(ctx)),
    can: (ctx, capabilityId) => roles.can(ctx, capabilityId, resolveCore(ctx)).ok,
    explainCapability: (ctx, capabilityId) => roles.can(ctx, capabilityId, resolveCore(ctx)),
    // Enforce the auth context a RESOURCE requires, mid-request. Unlike the
    // request-time gate this cannot be steered by the caller: the context comes
    // from your record, not from the request body. Main-context spellings
    // ("core" / "default" / "") are aliases; a named sub-context never falls back.
    requireRpcAuthContext,
    RpcAuthContextError,
    // HS256 verify primitive, so a module that mints its own token (saml-auth)
    // can verify it without re-implementing JWT parsing.
    verifyJwtToken,
    normalizePrincipalUser,
    resolveServerFile: (ctx, target) => resolveServerFile(runtime, ctx, target),
    importServerModule: (ctx, target) => importServerModule(ctx, runtime, target),
    importServerExport: (ctx, target, exportName) => importServerExport(ctx, runtime, target, exportName),
    // SSRF-safe outbound HTTP. See server/node/ssrf-guard.js for the threat
    // model and what they do (and don't) cover. `safeRequest` is TOCTOU-safe
    // (connect-time validation) — prefer it for untrusted hostnames; `safeFetch`
    // is the global-fetch convenience for trusted/operator-configured upstreams.
    safeFetch,
    safeRequest,
    validateUpstreamUrl,
    SsrfBlockedError,
    // Classified transport failure (`code` UPSTREAM_UNREACHABLE / _TIMEOUT / _DNS
    // / _TLS, host-free `publicMessage`, original error as `cause`). Throw it —
    // or copy its `code`/`publicMessage` onto your own error — when you want the
    // RPC layer to tell the client WHY without naming the upstream in production.
    UpstreamRequestError,
    // Server-side state. Two surfaces, picked by one question — can the value be
    // serialized? `cache` for promises / SDK clients / KeyObjects (in-process,
    // bounded, lost on restart by design); `storage` for anything that should be
    // bounded AND survivable AND operator-routable. A bare module-level `Map` is
    // neither, which is how the server grew unbounded in the first place.
    // See server/STORAGE.md.
    storage: stores.storage,
    cache: stores.cache,
    StorageConfigError,
    // Server-side logging. `log(channel)` for a module-scoped logger
    // ("module.<id>[:sub]"); inside an RPC method prefer the pre-scoped `ctx.log`,
    // which already carries the request id and the hashed principal. Levels are
    // operator-controlled per channel via `core.server.logging` — do NOT add a
    // per-module debug env var, and put payload dumps on `log.sensitive(...)`
    // so they stay off unless an operator opted in. See server/LOGGING.md.
    log: (channel) => logging.log(channel),
    logFor: (ctx, sub) => logging.forCtx(ctx, sub),
    logging,
    // Output encoding for module server routes that render their own HTML.
    // `jsonForScript` for EVERY interpolation into a <script> body (JSON.stringify
    // does NOT escape `<`, so `</script>` in a value closes the tag); `escapeHtml`
    // for HTML text/attributes. Neither is a sanitizer — prefer not echoing
    // untrusted input at all, and log it instead.
    jsonForScript,
    escapeHtml,
    getServerCacheDir: (subdir) => getServerCacheDir(runtime, subdir),
  };
}

function installGlobalServerHelpers(runtime) {
  const helpers = createServerHelpers(runtime);
  globalThis.XOPAT_SERVER = Object.assign(globalThis.XOPAT_SERVER || {}, helpers);
  return globalThis.XOPAT_SERVER;
}

module.exports = {
  jsonForScript,
  escapeHtml,
  getSecureRoot,
  findNearestItemRoot,
  getSecureModules,
  getSecurePlugins,
  getSecureModuleConfig,
  getSecurePluginConfig,
  getSecureItemConfig,
  getStaticItemConfig,
  setServerConfigSnapshot,
  getSecureValue,
  requireSecureValue,
  getRpcAuthConfig,
  getProxyConfig,
  resolvePrincipal,
  tryResolvePrincipal,
  resolveRoles: roles.resolveRoles,
  canRole: roles.can,
  checkCapabilities: roles.checkCapabilities,
  parseServerTarget,
  resolveServerFile,
  loadServerModuleFromFile,
  importServerModule,
  importServerExport,
  createServerHelpers,
  installGlobalServerHelpers,
  getServerCacheDir,
  setStorageConfig,
  setLoggingConfig,
};
