"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { parse } = require("comment-json");

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
            if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".xopat-server") continue;
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
        for (const [name, value] of Object.entries(mod)) {
            if (name === "policy" || name === "default") continue;
            if (typeof value !== "function") continue;
            if (methods[name]) {
                duplicates.push(name);
                continue;
            }
            methods[name] = {
                file: entry.file,
                fn: value,
                methodPolicy: policy[name] && typeof policy[name] === "object" ? policy[name] : {},
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
        this.cacheDir = options.cacheDir || path.join(this.root, "server/.cache");
        this.logger = options.logger || console;
        this.auth = options.auth || {};
        fs.mkdirSync(this.cacheDir, { recursive: true });
        this.registry = { plugin: Object.create(null), module: Object.create(null) };
        this.scan();
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

    getClientBootstrap() {
        return `
<script src="/server/client-rpc.js"></script>
<script>
window.xserver = window.xserver || XOpatServerRPC.createClient({
  getViewerId: () => window.VIEWER?.id || undefined
});
</script>`;
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
            throw normalizeRpcError(err);
          }
        };
      }
    });
  }

  global.XOpatServerRPC = {
    createClient: function(opts){
      return {
        plugin: new Proxy({}, { get: function(_, id){ return makeScope("plugin", id, opts); } }),
        module: new Proxy({}, { get: function(_, id){ return makeScope("module", id, opts); } })
      };
    }
  };
})(window);
`;
    }

    async handleRpc(req, res, core, session, urlObj) {
        const parts = urlObj.pathname.split("/").filter(Boolean);
        const [, kind, id, method] = parts;
        if (!["plugin", "module"].includes(kind) || !id || !method) {
            return this.#writeJson(res, 404, { error: "RPC target not found", code: "RPC_NOT_FOUND" });
        }

        const item = this.registry[kind] && this.registry[kind][decodeURIComponent(id)];
        if (!item) {
            return this.#writeJson(res, 404, { error: `${kind} '${decodeURIComponent(id)}' not found`, code: "RPC_UNKNOWN_TARGET" });
        }

        let body;
        try {
            body = await this.#readJsonBody(req);
        } catch (error) {
            return this.#writeJson(res, 400, { error: error.message, code: "RPC_BAD_JSON" });
        }

        const loaded = await this.#loadItem(item);
        if (loaded.duplicates.length) {
            return this.#writeJson(res, 500, { error: `Duplicate server exports: ${loaded.duplicates.join(", ")}`, code: "RPC_DUPLICATE_EXPORT" });
        }
        const target = loaded.methods[decodeURIComponent(method)];
        if (!target) {
            return this.#writeJson(res, 404, { error: `Method '${decodeURIComponent(method)}' not found`, code: "RPC_UNKNOWN_METHOD" });
        }

        const policy = Object.assign({ auth: { required: false }, timeoutMs: DEFAULT_TIMEOUT_MS }, target.methodPolicy);
        const authResult = await this.#verifyRpcRequest(req, res, core, session, policy, { kind, item, method: decodeURIComponent(method), contextId: body.contextId });
        if (!authResult.ok) return;

        const controller = new AbortController();
        const timeoutMs = Number.isFinite(policy.timeoutMs) ? Math.max(1, policy.timeoutMs) : DEFAULT_TIMEOUT_MS;
        const timeout = setTimeout(() => controller.abort(new Error(`RPC method timed out after ${timeoutMs}ms`)), timeoutMs);

        try {
            const ctx = {
                req,
                res,
                core,
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
            return this.#writeJson(res, 200, { ok: true, result: result === undefined ? null : result });
        } catch (error) {
            clearTimeout(timeout);
            const aborted = controller.signal.aborted;
            this.logger.error(`[rpc] ${kind}/${item.id}/${decodeURIComponent(method)} failed`, error);
            return this.#writeJson(res, aborted ? 504 : 500, {
                error: aborted ? `RPC timed out after ${timeoutMs}ms` : (error && error.message) || "RPC failed",
                code: aborted ? "RPC_TIMEOUT" : "RPC_INTERNAL_ERROR",
            });
        }
    }

    #rpcSessionWarned = new Set();

    #resolveRpcVerifierContext(core, contextId) {
        const secure = core?.CORE?.server?.secure || {};
        const contexts = secure.rpcVerifiers || secure.rpcAuth || {};
        if (contextId && contexts[contextId]) return contexts[contextId];
        return contexts.default || null;
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
            if (this.auth && typeof this.auth.verifyRpcAuth === "function") {
                const result = await this.auth.verifyRpcAuth(req, res, core, verifierContext, meta);
                if (!result || result.ok === false) return { ok: false };
                user = result.user || user;
            }
        }
        return { ok: true, user };
    }

    async #loadItem(item) {
        const loadedFiles = [];
        for (const file of item.files) {
            loadedFiles.push({ file, module: await this.#loadModuleFile(file) });
        }
        return buildEntryMap(loadedFiles);
    }

    async #loadModuleFile(file) {
        const stat = fs.statSync(file);
        const ext = path.extname(file).toLowerCase();
        let loadPath = file;
        if (ext === ".ts") {
            loadPath = await this.#compileTs(file, stat.mtimeMs);
            return import(pathToFileURL(loadPath).href + `?v=${stat.mtimeMs}`);
        }
        if (ext === ".mjs") {
            return import(pathToFileURL(file).href + `?v=${stat.mtimeMs}`);
        }
        delete require.cache[require.resolve(file)];
        return require(file);
    }

    async #compileTs(file, mtimeMs) {
        const hash = crypto.createHash("sha1").update(file).digest("hex").slice(0, 12);
        const outDir = path.join(this.cacheDir, hash);
        const outFile = path.join(outDir, path.basename(file).replace(/\.ts$/i, ".mjs"));
        const metaFile = path.join(outDir, ".meta.json");
        fs.mkdirSync(outDir, { recursive: true });
        let needsBuild = true;
        if (fs.existsSync(outFile) && fs.existsSync(metaFile)) {
            try {
                const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
                needsBuild = meta.mtimeMs !== mtimeMs;
            } catch {
                needsBuild = true;
            }
        }
        if (needsBuild) {
            const esbuild = require("esbuild");

            try {
                await esbuild.build({
                    entryPoints: [file],
                    outfile: outFile,
                    bundle: true,
                    platform: "node",
                    format: "esm",
                    sourcemap: true,
                    logLevel: "debug",
                });
            } catch (err) {
                const details = [];

                if (Array.isArray(err.errors)) {
                    for (const e of err.errors) {
                        const loc = e.location
                            ? `${e.location.file}:${e.location.line}:${e.location.column}`
                            : file;
                        details.push(`${loc} - ${e.text}`);
                    }
                }

                throw new Error(
                    [
                        `Failed to compile server TS file '${file}'`,
                        err.message || "",
                        details.length ? details.join("\n") : ""
                    ].filter(Boolean).join("\n")
                );
            }
        }
        return outFile;
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
