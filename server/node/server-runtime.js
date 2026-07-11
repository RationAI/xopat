"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { parse } = require("comment-json");
const {installGlobalServerHelpers} = require("./server-helpers");
const {registerRpcAuthVerifier, registerProxyAuthVerifier} = require("./auth");

const REGISTER_FILE_RE = /(^|[\\/])register\.server\.(js|mjs|ts)$/i;

const {
    SERVER_BUILD_DIR,
    loadServerModuleFromFile,
} = require("./server-module-loader");

const SERVER_FILE_RE = /\.server\.(js|mjs|ts)$/i;
const DEFAULT_TIMEOUT_MS = 10_000;

function safeReadJson(file) {
    try {
        return parse(fs.readFileSync(file, "utf8"));
    } catch {
        return null;
    }
}

function listDirs(root) {
    if (!root || !fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
}

function walkForServerFiles(rootDir, found = []) {
    if (!fs.existsSync(rootDir)) return found;
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
        const full = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            if (
                entry.name === "node_modules" ||
                entry.name === ".git" ||
                entry.name === ".server-dist"
            ) continue;
            walkForServerFiles(full, found);
        } else if (SERVER_FILE_RE.test(entry.name)) {
            found.push(full);
        }
    }
    return found;
}

function inferWorkspaceMeta(itemDir) {
    const pkgFile = path.join(itemDir, "package.json");
    const includeFile = path.join(itemDir, "include.json");
    const pkg = safeReadJson(pkgFile) || {};
    const include = safeReadJson(includeFile) || {};
    return {
        id: include.id || pkg.name || path.basename(itemDir),
        name: include.name || pkg.name || path.basename(itemDir),
        packageData: pkg,
        includeData: include,
    };
}

function buildEntryMap(serverFiles) {
    const methods = Object.create(null);
    const duplicates = [];

    for (const entry of serverFiles) {
        const mod = entry.module;
        const policy = mod.policy && typeof mod.policy === "object" ? mod.policy : {};

        for (const name of Object.keys(policy)) {
            const value = mod[name];
            if (typeof value !== "function") continue;

            if (methods[name]) {
                duplicates.push(name);
                continue;
            }

            methods[name] = {
                file: entry.file,
                fn: value,
                methodPolicy: policy[name] || {},
            };
        }
    }

    return { methods, duplicates };
}

class XopatServerRuntime {
    constructor(options = {}) {
        this.root = options.root || process.cwd();
        this.pluginsDir = options.pluginsDir || path.join(this.root, "plugins");
        this.modulesDir = options.modulesDir || path.join(this.root, "modules");
        this.cacheDir = options.cacheDir || process.env.XOPAT_CACHE_DIR || path.join(this.root, "server/.cache");
        this.serverBuildDirName = options.serverBuildDirName || SERVER_BUILD_DIR;
        this.logger = options.logger || console;
        this.auth = options.auth || {};
        this.devMode = options.devMode === true;
        this.devLogBuffer = options.devLogBuffer || null;
        this.version = options.version || "dev";
        this.startedAt = options.startedAt || new Date();
        fs.mkdirSync(this.cacheDir, { recursive: true });
        this.registry = { plugin: Object.create(null), module: Object.create(null) };
        // Generic server HTTP-route registry: modules register a path prefix →
        // handler at boot (via the serverApi in loadServerExtensions). Used e.g.
        // by oidc-server-ts for OAuth login/callback redirect endpoints.
        this._serverRoutes = new Map();
        this.scan();
    }

    /** Register a raw HTTP route prefix → handler(ctx, urlObj, prefix). */
    registerServerRoute(prefix, handler) {
        if (!prefix || typeof handler !== "function") return;
        const p = prefix.startsWith("/") ? prefix : "/" + prefix;
        this._serverRoutes.set(p, handler);
        this.logger.log?.(`[server-route] registered ${p}`);
    }

    /** Find a registered route matching a pathname (exact or prefix/…). */
    matchServerRoute(pathname) {
        for (const [prefix, handler] of this._serverRoutes) {
            if (pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : prefix + "/")) {
                return { prefix, handler };
            }
        }
        return null;
    }

    /** Dispatch a matched server route. Returns true if handled. */
    async dispatchServerRoute(req, res, core, session, urlObj) {
        const match = this.matchServerRoute(urlObj.pathname);
        if (!match) return false;
        try {
            // Helpers are installed once at boot (loadServerExtensions); only
            // rebuild them here as a fallback if the global was never set up.
            if (!globalThis.XOPAT_SERVER) {
                installGlobalServerHelpers({
                    registry: this.registry,
                    cacheDir: this.cacheDir,
                    logger: this.logger,
                    serverBuildDirName: this.serverBuildDirName,
                });
            }
            const ctx = { req, res, core, session, secure: core?.CORE?.server?.secure || {} };
            await match.handler(ctx, urlObj, match.prefix);
        } catch (e) {
            this.logger.error?.(`[server-route] ${urlObj.pathname} failed`, e);
            if (!res.headersSent) { res.writeHead(500, { "Content-Type": "text/plain" }); res.end("Server route error"); }
        }
        return true;
    }

    scan() {
        this.registry.plugin = this.#scanKind("plugin", this.pluginsDir);
        this.registry.module = this.#scanKind("module", this.modulesDir);
        return this.registry;
    }

    #scanKind(kind, rootDir) {
        const items = Object.create(null);
        for (const dirName of listDirs(rootDir)) {
            const itemDir = path.join(rootDir, dirName);
            const meta = inferWorkspaceMeta(itemDir);
            const files = walkForServerFiles(itemDir);
            items[meta.id] = {
                id: meta.id,
                kind,
                directory: dirName,
                rootDir: itemDir,
                files,
                name: meta.name,
                packageData: meta.packageData,
                includeData: meta.includeData,
            };
        }
        return items;
    }

    getClientRuntimeSource() {
        return `
(function(global){
  function getDefaultHttpClient() {
    var app = global.APPLICATION_CONTEXT;
    if (!app || !app.httpClient) {
      throw new Error("APPLICATION_CONTEXT.httpClient is not available.");
    }
    return app.httpClient;
  }

  function normalizeRpcError(err) {
    if (!err) {
      var e = new Error("Unknown RPC error");
      e.code = "RPC_ERROR";
      return e;
    }

    if (err.name === "HTTPError" || typeof err.statusCode === "number") {
      try {
        if (err.textData) {
          var parsed = JSON.parse(err.textData);
          if (parsed && typeof parsed === "object") {
            err.code = parsed.code || err.code || "RPC_ERROR";
            err.details = parsed.details !== undefined ? parsed.details : err.details;
            if (parsed.error) err.message = parsed.error;
          }
        }
      } catch (_) {}
      err.status = err.status || err.statusCode;
      return err;
    }

    return err;
  }

  function tryNotifySessionExpiry(err) {
    var status = err && (err.status || err.statusCode);
    var code = err && err.code;
    var message = String((err && err.message) || "");
    var isSessionError =
      code === "RPC_NO_SESSION" ||
      code === "RPC_BAD_CSRF" ||
      (status === 401 && /missing or invalid session/i.test(message)) ||
      (status === 403 && /invalid csrf token/i.test(message));

    if (!isSessionError) return false;

    try {
      return !!global.XOpatSessionRecovery?.handle?.({
        status: status,
        code: code,
        message: message,
        source: "rpc"
      });
    } catch (_) {
      return false;
    }
  }

  function makeScope(kind, id, opts) {
    return new Proxy({}, {
      get: function(_, method) {
        if (typeof method !== "string") return undefined;

        return async function(payload, callOptions) {
          var client =
            (callOptions && callOptions.httpClient) ||
            (opts && opts.httpClient) ||
            getDefaultHttpClient();

          var viewerId =
            (callOptions && callOptions.viewerId) ||
            (opts && typeof opts.getViewerId === "function" ? opts.getViewerId() : undefined);

          try {
            var data = await client.request(
              "/__rpc/" + kind + "/" + encodeURIComponent(id) + "/" + encodeURIComponent(method),
              {
                method: "POST",
                body: {
                  args: payload === undefined ? [] : [payload],
                  viewerId: viewerId,
                  contextId: callOptions && callOptions.contextId
                },
                // http client attaches csrf only for proxies for now, guessing rpc routes would be overcomplicated
                headers: window?.XOPAT_CSRF_TOKEN ? { "X-XOPAT-CSRF": window.XOPAT_CSRF_TOKEN }  : {},
                expect: "json"
              }
            );
            return data && typeof data === "object" && "result" in data ? data.result : data;
          } catch (err) {
            var normalized = normalizeRpcError(err);
            tryNotifySessionExpiry(normalized);
            throw normalized;
          }
        };
      }
    });
  }

  global.XOpatServerRPC = {
    createClient: function(opts){
      return {
        plugin: new Proxy({}, { get: function(_, id){ return makeScope("plugin", id, opts); } }),
        module: new Proxy({}, { get: function(_, id){ return makeScope("module", id, opts); } }),
        server: new Proxy({}, { get: function(_, id){ return makeScope("server", id, opts); } })
      };
    }
  };
})(window);
`;
    }

    async handleRpc(req, res, core, session, urlObj) {
        const parts = urlObj.pathname.split("/").filter(Boolean);
        const [, kindRaw, idRaw, methodRaw] = parts;

        if (!["plugin", "module", "server"].includes(kindRaw) || !idRaw || !methodRaw) {
            return this.#writeJson(res, 404, {
                error: "RPC target not found",
                code: "RPC_NOT_FOUND"
            });
        }

        const kind = kindRaw;
        const id = decodeURIComponent(idRaw);
        const method = decodeURIComponent(methodRaw);

        let item = null;
        let target = null;

        if (kind === "server") {
            item = { id, kind, name: id, rootDir: this.root };
            target = this.#getBuiltinRpcTarget(id, method);
            if (!target) {
                return this.#writeJson(res, 404, {
                    error: `${kind} '${id}' not found`,
                    code: "RPC_UNKNOWN_TARGET"
                });
            }
        } else {
            item = this.registry[kind] && this.registry[kind][id];
            if (!item) {
                this.scan();
                item = this.registry[kind] && this.registry[kind][id];
            }

            if (!item) {
                return this.#writeJson(res, 404, {
                    error: `${kind} '${id}' not found`,
                    code: "RPC_UNKNOWN_TARGET"
                });
            }
        }

        let body;
        try {
            body = await this.#readJsonBody(req);
        } catch (error) {
            return this.#writeJson(res, 400, {
                error: error.message,
                code: "RPC_BAD_JSON"
            });
        }

        if (kind !== "server") {
            let loaded = await this.#loadItem(item);

            if (loaded.duplicates.length) {
                return this.#writeJson(res, 500, {
                    error: `Duplicate server exports: ${loaded.duplicates.join(", ")}`,
                    code: "RPC_DUPLICATE_EXPORT"
                });
            }

            target = loaded.methods[method];

            // re-scan once in case a new .server.* file appeared after startup
            if (!target) {
                this.scan();
                item = this.registry[kind] && this.registry[kind][id];

                if (item) {
                    loaded = await this.#loadItem(item);

                    if (loaded.duplicates.length) {
                        return this.#writeJson(res, 500, {
                            error: `Duplicate server exports: ${loaded.duplicates.join(", ")}`,
                            code: "RPC_DUPLICATE_EXPORT"
                        });
                    }

                    target = loaded.methods[method];
                }
            }

            if (!target) {
                return this.#writeJson(res, 404, {
                    error: `Method '${method}' not found`,
                    code: "RPC_UNKNOWN_METHOD"
                });
            }
        }

        const rawPolicy = target.methodPolicy || {};
        const runtime = rawPolicy.runtime || {};

        const policy = {
            auth: rawPolicy.auth || { required: false },
            timeoutMs: runtime.timeoutMs ?? rawPolicy.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            maxBodyBytes: runtime.maxBodyBytes ?? rawPolicy.maxBodyBytes,
            maxConcurrency: runtime.maxConcurrency ?? rawPolicy.maxConcurrency,
            queueLimit: runtime.queueLimit ?? rawPolicy.queueLimit,
            circuitBreaker: runtime.circuitBreaker ?? rawPolicy.circuitBreaker,
        };

        const authResult = await this.#verifyRpcRequest(
            req,
            res,
            core,
            session,
            policy,
            { kind, item, method, contextId: body.contextId }
        );
        if (!authResult.ok) return;

        const controller = new AbortController();
        const timeoutMs = Number.isFinite(policy.timeoutMs)
            ? Math.max(1, policy.timeoutMs)
            : DEFAULT_TIMEOUT_MS;

        const timeout = setTimeout(
            () => controller.abort(new Error(`RPC method timed out after ${timeoutMs}ms`)),
            timeoutMs
        );

        try {
            // Installed once at boot; fallback-only rebuild (see dispatchServerRoute).
            if (!globalThis.XOPAT_SERVER) {
                installGlobalServerHelpers({
                    registry: this.registry,
                    cacheDir: this.cacheDir,
                    logger: this.logger
                });
            }

            const ctx = {
                req,
                res,
                core,
                secure: core?.CORE?.server?.secure || {},
                session,
                user: authResult.user,
                viewerId: body.viewerId,
                contextId: body.contextId,
                kind,
                itemId: item.id,
                signal: controller.signal,
                requestId: crypto.randomUUID(),
            };

            const args = Array.isArray(body.args) ? body.args : [];
            const result = await target.fn(ctx, ...args);

            clearTimeout(timeout);
            return this.#writeJson(res, 200, {
                ok: true,
                result: result === undefined ? null : result
            });
        } catch (error) {
            clearTimeout(timeout);
            const aborted = controller.signal.aborted;
            this.logger.error(`[rpc] ${kind}/${item.id}/${method} failed`, error);

            return this.#writeJson(res, aborted ? 504 : 500, {
                error: aborted
                    ? `RPC timed out after ${timeoutMs}ms`
                    : (error && error.message) || "RPC failed",
                code: aborted ? "RPC_TIMEOUT" : "RPC_INTERNAL_ERROR",
            });
        }
    }


    #getBuiltinRpcTarget(scopeId, methodName) {
        if (!this.devMode) return null;
        const builtinTarget = this.#resolveBuiltinDevTarget(scopeId, methodName);
        if (!builtinTarget) return null;

        return {
            file: `[builtin]/server/${scopeId}`,
            fn: builtinTarget.fn,
            methodPolicy: {
                auth: { requireSession: true },
                runtime: { timeoutMs: 2_000 }
            },
        };
    }

    #resolveBuiltinDevTarget(scopeId, methodName) {
        const sharedTargets = {
            getLogs: {
                fn: (ctx, payload) => this.#readDevLogs(ctx, payload),
            },
        };

        if (scopeId === "core") {
            return {
                getStatus: {
                    fn: (ctx, payload) => this.#readDevStatus(ctx, payload),
                },
                ...sharedTargets,
            }[methodName] || null;
        }

        if (scopeId === "dev") {
            return sharedTargets[methodName] || null;
        }

        return null;
    }

    #readDevLogs(_ctx, payload = {}) {
        if (!this.devMode || !this.devLogBuffer) {
            const error = new Error("Server logs are only available in dev mode");
            error.code = "RPC_DEV_MODE_REQUIRED";
            throw error;
        }

        const snapshot = this.devLogBuffer.getEntries(payload || {});
        return {
            devMode: true,
            scope: "server/core/getLogs",
            ...snapshot,
        };
    }

    #readDevStatus(_ctx, payload = {}) {
        if (!this.devMode) {
            const error = new Error("Server status is only available in dev mode");
            error.code = "RPC_DEV_MODE_REQUIRED";
            throw error;
        }

        const includeRegistry = payload?.includeRegistry !== false;
        const now = new Date();
        const pluginIds = Object.keys(this.registry.plugin || {}).sort();
        const moduleIds = Object.keys(this.registry.module || {}).sort();

        return {
            devMode: true,
            scope: "server/core/getStatus",
            version: this.version,
            pid: process.pid,
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            uptimeMs: Math.max(0, now.getTime() - this.startedAt.getTime()),
            startedAt: this.startedAt.toISOString(),
            now: now.toISOString(),
            cacheDir: this.cacheDir,
            root: this.root,
            logBuffer: this.devLogBuffer ? {
                available: true,
                totalBuffered: this.devLogBuffer.entries.length,
                maxEntries: this.devLogBuffer.maxEntries,
            } : {
                available: false,
                totalBuffered: 0,
                maxEntries: 0,
            },
            registry: includeRegistry ? {
                pluginCount: pluginIds.length,
                moduleCount: moduleIds.length,
                plugins: pluginIds,
                modules: moduleIds,
            } : {
                pluginCount: pluginIds.length,
                moduleCount: moduleIds.length,
            },
        };
    }

    #rpcSessionWarned = new Set();

    #resolveRpcVerifierContext(core, contextId) {
        const secure = core?.CORE?.server?.secure || {};
        const contexts = secure.rpcVerifiers || secure.rpcAuth || {};
        // Prototype-walk lookups (e.g. contextId: "__proto__") can return
        // Object.prototype, which has no verifiers and was previously treated
        // as "no auth required". hasOwn-only lookups close that bypass.
        if (typeof contextId === "string" && contextId
            && Object.prototype.hasOwnProperty.call(contexts, contextId)) {
            return contexts[contextId];
        }
        if (Object.prototype.hasOwnProperty.call(contexts, "default")) {
            return contexts.default || null;
        }
        return null;
    }

    #isPublicAuth(publicValue, ctx) {
        if (typeof publicValue === "function") {
            try {
                return !!publicValue(ctx);
            } catch (e) {
                this.logger.warn?.("[rpc-auth] public predicate failed", e);
                return false;
            }
        }
        return publicValue === true;
    }

    async #verifyRpcRequest(req, res, core, session, policy, meta) {
        const authCfg = policy.auth === false ? { public: true, requireSession: false } : (policy.auth || {});
        let user = req.user || null;
        const publicAllowed = this.#isPublicAuth(authCfg.public, { req, res, core, session, policy, meta });
        const requireSession = authCfg.requireSession !== false;

        if (!requireSession) {
            const warnKey = `${meta.kind}/${meta.item?.id || meta.itemId}/${meta.method}`;
            if (!this.#rpcSessionWarned.has(warnKey)) {
                this.#rpcSessionWarned.add(warnKey);
                this.logger.warn?.(`[rpc-auth] ${warnKey} opts out of session requirement`);
            }
        }

        if (requireSession) {
            if (!session) {
                this.#writeJson(res, 401, { error: "Unauthorized: missing or invalid session", code: "RPC_NO_SESSION" });
                return { ok: false };
            }
            const clientToken = req.headers["x-xopat-csrf"];
            if (!clientToken || clientToken !== session.csrfToken) {
                this.#writeJson(res, 403, { error: "Forbidden: invalid CSRF token", code: "RPC_BAD_CSRF" });
                return { ok: false };
            }
        }

        if (!publicAllowed) {
            const contextId = meta?.contextId;
            const verifierContext = this.#resolveRpcVerifierContext(core, contextId);
            const explicitlyDisabled = !!(verifierContext && verifierContext.enabled === false);
            const hasVerifiers = !!(verifierContext
                && verifierContext.verifiers
                && typeof verifierContext.verifiers === "object"
                && Object.keys(verifierContext.verifiers).length > 0);

            // Fail-closed by default. The operator opts out *explicitly* via
            // `{ enabled: false }`, never by leaving the entry empty/missing.
            //
            //  - Real verifiers present → run them.
            //  - `enabled: false`       → accept (operator opt-out).
            //  - Empty / missing entry  → accept iff session also passed,
            //                              otherwise reject and tell the
            //                              operator how to configure it.
            if (hasVerifiers && this.auth && typeof this.auth.verifyRpcAuth === "function") {
                const result = await this.auth.verifyRpcAuth(req, res, core, verifierContext, meta);
                if (!result || result.ok === false) return { ok: false };
                user = result.user || user;
            } else if (!explicitlyDisabled && !requireSession) {
                const code = verifierContext ? "RPC_AUTH_NO_VERIFIERS" : "RPC_AUTH_NOT_CONFIGURED";
                const detail = verifierContext ? "no verifiers in" : "no";
                this.logger.warn?.(
                    `[rpc-auth] ${meta.kind}/${meta.item?.id || meta.itemId}/${meta.method} ` +
                    `is non-public, opted out of session, and has ${detail} verifier context ` +
                    `(contextId=${JSON.stringify(contextId)}); rejecting. ` +
                    `Add an explicit \`enabled: false\` to opt out, or configure verifiers under server.secure.rpcVerifiers.`
                );
                this.#writeJson(res, 401, { error: "Unauthorized: RPC auth not configured", code });
                return { ok: false };
            }
        }
        return { ok: true, user };
    }

    async #loadItem(item) {
        const loadedFiles = [];

        for (const file of item.files) {
            try {
                const mod = await this.#loadModuleFile(file);
                loadedFiles.push({ file, module: mod });
            } catch (e) {
                console.log("[rpc-file-fail]", file, {
                    message: e?.message,
                    stack: e?.stack,
                });
            }
        }

        return buildEntryMap(loadedFiles);
    }

    /**
     * Boot-time server-extension hook. Modules/plugins may ship a
     * `register.server.{ts,mjs,js}` at their root exporting `register(serverApi)`;
     * core loads each ONCE at startup and calls it, letting the item contribute
     * server-side capabilities (e.g. an auth verifier) into core's generic
     * registries. Core stays type-agnostic — it mirrors the client-side
     * `APPLICATION_CONTEXT.auth.registerBroker(...)` pattern. Node module server
     * files load lazily per-RPC, so this eager pass is what makes a
     * module-provided verifier available before the first gated request.
     * Per-item failures are logged, never fatal.
     */
    async loadServerExtensions() {
        installGlobalServerHelpers({
            registry: this.registry,
            cacheDir: this.cacheDir,
            logger: this.logger,
            serverBuildDirName: this.serverBuildDirName,
        });
        const serverApi = Object.assign({}, globalThis.XOPAT_SERVER, {
            registerRpcAuthVerifier,
            registerProxyAuthVerifier,
            registerServerRoute: (prefix, handler) => this.registerServerRoute(prefix, handler),
        });

        for (const kind of ["module", "plugin"]) {
            const items = this.registry[kind] || {};
            for (const id of Object.keys(items)) {
                const item = items[id];
                const file = (item.files || []).find(f => REGISTER_FILE_RE.test(f));
                if (!file) continue;
                try {
                    const mod = await this.#loadModuleFile(file);
                    const register = mod.register || (mod.default && mod.default.register) || mod.default;
                    if (typeof register === "function") {
                        await register(serverApi);
                        this.logger.log?.(`[server-ext] ${kind}:${id} registered`);
                    } else {
                        this.logger.warn?.(`[server-ext] ${kind}:${id} has register.server but no register() export`);
                    }
                } catch (e) {
                    this.logger.error?.(`[server-ext] ${kind}:${id} register failed`, e);
                }
            }
        }
    }

    async #loadModuleFile(file) {
        installGlobalServerHelpers({
            registry: this.registry,
            cacheDir: this.cacheDir,
            logger: this.logger,
            serverBuildDirName: this.serverBuildDirName,
        });

        return loadServerModuleFromFile(file, this, { logLevel: "debug" });
    }

    async #readJsonBody(req) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString("utf8");
        return raw ? JSON.parse(raw) : {};
    }

    #writeJson(res, status, body) {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(body));
    }
}

module.exports = {
    XopatServerRuntime,
};
