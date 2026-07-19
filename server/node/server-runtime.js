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
/** Streaming-RPC liveness ping period; client watchdogs assume ~3× this. */
const STREAM_HEARTBEAT_MS = 15_000;

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
        // Runtime-policy enforcement state (per method key / breaker key). The
        // policy fields (maxConcurrency, queueLimit, circuitBreaker) are declared
        // by *.server.* method policies and enforced in handleRpc.
        this._rpcGates = new Map();
        this._rpcBreakers = new Map();
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

  function resolveCallContext(kind, id, method, opts, callOptions) {
    return {
      client:
        (callOptions && callOptions.httpClient) ||
        (opts && opts.httpClient) ||
        getDefaultHttpClient(),
      viewerId:
        (callOptions && callOptions.viewerId) ||
        (opts && typeof opts.getViewerId === "function" ? opts.getViewerId() : undefined),
      url: "/__rpc/" + kind + "/" + encodeURIComponent(id) + "/" + encodeURIComponent(method)
    };
  }

  var STREAM_STALL_MS = 45000; // ~3x server heartbeat; zero bytes for this long = dead pipe

  /**
   * Invoke a streaming (NDJSON) RPC method. Returns
   *   { events: AsyncGenerator, result: Promise, abort(reason) }
   * The pump runs eagerly: "result" settles even if "events" is never
   * consumed. A stream that ends without a terminal record REJECTS
   * (RPC_STREAM_TRUNCATED) — partial data is never a success. Auth, CSRF,
   * proxy resolution and session-expiry recovery are identical to the
   * buffered path (both ride the shared HttpClient plumbing).
   */
  function invokeStream(kind, id, method, opts, payload, callOptions) {
    var ctx = resolveCallContext(kind, id, method, opts, callOptions);

    var controller = new AbortController();
    var external = callOptions && callOptions.signal;
    if (external) {
      if (external.aborted) controller.abort(external.reason);
      else external.addEventListener("abort", function () { controller.abort(external.reason); }, { once: true });
    }

    var stallTimer = null;
    function resetStall() {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(function () {
        var e = new Error("RPC stream stalled: no data for " + STREAM_STALL_MS + "ms");
        e.code = "RPC_STREAM_STALLED";
        controller.abort(e);
      }, STREAM_STALL_MS);
    }

    var resolveResult, rejectResult;
    var result = new Promise(function (res, rej) { resolveResult = res; rejectResult = rej; });
    result.catch(function () {}); // consumers may only iterate events

    // Tiny event queue bridging the eager pump to the consumer generator.
    var queue = [];
    var wake = null;
    var ended = false;
    var endError = null;
    function notify() { if (wake) { var w = wake; wake = null; w(); } }
    function pushEvent(ev) { queue.push(ev); notify(); }
    function end(err) { if (ended) return; ended = true; endError = err || null; notify(); }

    (async function pump() {
      var settled = false;
      function settleOk(value) { settled = true; resolveResult(value); end(null); }
      function settleErr(err) {
        var normalized = normalizeRpcError(err);
        tryNotifySessionExpiry(normalized);
        settled = true;
        rejectResult(normalized);
        end(normalized);
      }
      try {
        // Arm the stall timer BEFORE opening the stream: HttpClient.stream has no
        // internal timeout (lifetime is caller-owned) and this await blocks until
        // response headers arrive. Without this, an upstream that accepts the TCP
        // connection but never sends headers hangs the turn forever. resetStall()
        // re-arms on headers and on every event below.
        resetStall();
        var stream = await ctx.client.stream(ctx.url, {
          method: "POST",
          body: {
            args: payload === undefined ? [] : [payload],
            viewerId: ctx.viewerId,
            contextId: callOptions && callOptions.contextId
          },
          headers: Object.assign(
            { "X-Xopat-Rpc-Stream": "1" },
            window?.XOPAT_CSRF_TOKEN ? { "X-XOPAT-CSRF": window.XOPAT_CSRF_TOKEN } : {}
          ),
          signal: controller.signal
        });

        var contentType = String(stream.headers.get("content-type") || "").toLowerCase();
        if (contentType.indexOf("application/x-ndjson") < 0) {
          // Plain JSON answer (buffered result from a compat path) — treat as terminal.
          var text = await stream.raw.text();
          var data = null;
          try { data = JSON.parse(text); } catch (_) { data = null; }
          settleOk(data && typeof data === "object" && "result" in data ? data.result : data);
          return;
        }

        resetStall();
        for await (var line of stream.lines()) {
          resetStall();
          if (!line || typeof line !== "object") continue;
          if (line.ping) continue;
          if (line.done) {
            if (line.ok) {
              settleOk("result" in line ? line.result : null);
            } else {
              var e = new Error(line.error || "RPC failed");
              e.code = line.code || "RPC_INTERNAL_ERROR";
              e.status = line.status || 500;
              settleErr(e);
            }
            return;
          }
          if ("event" in line) pushEvent(line.event);
        }
        if (!settled) {
          var t = new Error("RPC stream ended without a terminal record");
          t.code = "RPC_STREAM_TRUNCATED";
          settleErr(t);
        }
      } catch (err) {
        if (!settled) settleErr(err);
      } finally {
        if (stallTimer) clearTimeout(stallTimer);
      }
    })();

    var events = (async function* () {
      while (true) {
        while (queue.length) yield queue.shift();
        if (ended) {
          if (endError) throw endError;
          return;
        }
        await new Promise(function (resolve) { wake = resolve; });
      }
    })();

    return {
      events: events,
      result: result,
      abort: function (reason) { controller.abort(reason); }
    };
  }

  function makeScope(kind, id, opts) {
    return new Proxy({}, {
      get: function(_, method) {
        if (typeof method !== "string") return undefined;

        // Reserved sub-scope for streaming methods:
        //   xserver.module[id].$stream.method(payload, callOptions) -> {events, result, abort}
        if (method === "$stream") {
          return new Proxy({}, {
            get: function(_, streamMethod) {
              if (typeof streamMethod !== "string") return undefined;
              return function(payload, callOptions) {
                return invokeStream(kind, id, streamMethod, opts, payload, callOptions);
              };
            }
          });
        }

        return async function(payload, callOptions) {
          var ctx = resolveCallContext(kind, id, method, opts, callOptions);

          try {
            var data = await ctx.client.request(
              ctx.url,
              {
                method: "POST",
                body: {
                  args: payload === undefined ? [] : [payload],
                  viewerId: ctx.viewerId,
                  contextId: callOptions && callOptions.contextId
                },
                // http client attaches csrf only for proxies for now, guessing rpc routes would be overcomplicated
                headers: window?.XOPAT_CSRF_TOKEN ? { "X-XOPAT-CSRF": window.XOPAT_CSRF_TOKEN }  : {},
                expect: "json",
                signal: callOptions && callOptions.signal,
                // Open-ended callers (e.g. a chat turn) pass timeoutMs: 0 so the
                // turn's own signal is the sole deadline; everyone else keeps the
                // client's timeout backstop.
                timeoutMs: callOptions && callOptions.timeoutMs
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
            // Streaming NDJSON response mode (see #handleRpc streaming branch).
            streaming: runtime.streaming === true,
            // Optional shared concurrency-gate key (mirrors circuitBreaker.key) so
            // sibling methods (e.g. buffered + streaming variants of one upstream
            // operation) share one slot pool instead of doubling it.
            concurrencyKey: runtime.concurrencyKey ?? rawPolicy.concurrencyKey,
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

        const methodKey = `${kind}/${item.id}/${method}`;
        const gateKey = policy.concurrencyKey ? `${kind}/${item.id}/${policy.concurrencyKey}` : methodKey;

        // The invocation mode must match the declared policy: a streaming method
        // answers NDJSON (the buffered client would try to JSON.parse a stream),
        // and a buffered method cannot honor a streaming consumer.
        const wantsStream = req.headers["x-xopat-rpc-stream"] === "1";
        if (policy.streaming !== wantsStream) {
            return this.#writeJson(res, 400, policy.streaming
                ? { error: `Method '${method}' is streaming-only; invoke it via the $stream client scope.`, code: "RPC_STREAM_REQUIRED" }
                : { error: `Method '${method}' does not support streaming invocation.`, code: "RPC_NOT_STREAMABLE" });
        }

        const circuit = policy.circuitBreaker
            ? this.#checkCircuit(policy.circuitBreaker, methodKey)
            : null;
        if (circuit && circuit.open) {
            return this.#writeJson(res, 503, {
                error: `Upstream circuit '${circuit.key}' is open; retry in ${Math.ceil(circuit.retryAfterMs / 1000)}s`,
                code: "RPC_CIRCUIT_OPEN",
            });
        }

        const slot = await this.#acquireRpcSlot(gateKey, policy, res);
        if (!slot.ok) {
            return this.#writeJson(res, 429, {
                error: `Too many concurrent '${method}' requests; queue is full`,
                code: "RPC_QUEUE_FULL",
            });
        }
        if (slot.cancelled) return; // client left while queued; socket is gone

        const controller = new AbortController();
        const timeoutMs = Number.isFinite(policy.timeoutMs)
            ? Math.max(1, policy.timeoutMs)
            : DEFAULT_TIMEOUT_MS;

        const timeout = setTimeout(
            () => controller.abort(new Error(`RPC method timed out after ${timeoutMs}ms`)),
            timeoutMs
        );
        // A client that disconnects (stop button, closed tab) must cancel the
        // handler's work — handlers thread ctx.signal into upstream calls (LLMs
        // etc.), so without this a stopped chat turn burns the upstream for the
        // full timeout. 'close' on res fires on premature disconnect; after a
        // normal completed response writableEnded is already true.
        const onClientClose = () => {
            if (!res.writableEnded) controller.abort(new Error("Client disconnected"));
        };
        res.on("close", onClientClose);

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

            if (policy.streaming) {
                return await this.#runStreamingRpc({
                    res, ctx, args, target, policy,
                    methodKey, kind, itemId: item.id, method,
                    controller, timeout, timeoutMs,
                });
            }

            const result = await target.fn(ctx, ...args);

            clearTimeout(timeout);
            if (policy.circuitBreaker) this.#recordCircuit(policy.circuitBreaker, methodKey, true);
            return this.#writeJson(res, 200, {
                ok: true,
                result: result === undefined ? null : result
            });
        } catch (error) {
            clearTimeout(timeout);
            const aborted = controller.signal.aborted;
            const disconnected = res.destroyed || res.writableEnded;
            // A disconnect-induced abort says nothing about upstream health — only
            // real failures (and timeouts) count against the breaker.
            if (policy.circuitBreaker && !(aborted && disconnected)) {
                this.#recordCircuit(policy.circuitBreaker, methodKey, false);
            }
            this.logger.error(`[rpc] ${kind}/${item.id}/${method} failed`, error);
            if (disconnected) return; // nobody to answer

            return this.#writeJson(res, aborted ? 504 : 500, {
                error: aborted
                    ? `RPC timed out after ${timeoutMs}ms`
                    : (error && error.message) || "RPC failed",
                code: aborted ? "RPC_TIMEOUT" : "RPC_INTERNAL_ERROR",
            });
        } finally {
            res.off("close", onClientClose);
            this.#releaseRpcSlot(gateKey, policy);
        }
    }

    /**
     * Streaming (NDJSON) RPC execution. Runs inside handleRpc's try/finally, so
     * the timeout, close-abort listener, slot release, and logging scaffolding
     * all wrap the stream's full lifetime. Headers are committed EAGERLY —
     * a handler may legitimately stay silent for minutes before its first
     * event (e.g. a reasoning model thinking), and a header-less connection
     * would die at typical reverse-proxy read timeouts; heartbeats keep the
     * pipe warm through intermediaries.
     *
     * Wire contract (one JSON object per newline):
     *   {"event": <opaque module payload>}   forwarded to the caller
     *   {"ping": true}                       liveness, consumed silently
     *   {"done": true, "ok": true, "result": ...}                  terminal
     *   {"done": true, "ok": false, "error", "code", "status"}     terminal
     * Pre-handler rejections (auth, queue-full, circuit-open, bad JSON) never
     * reach this method — they answer as plain JSON HTTP errors.
     */
    async #runStreamingRpc({ res, ctx, args, target, policy, methodKey, kind, itemId, method, controller, timeout, timeoutMs }) {
        res.writeHead(200, {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        });

        const writeLine = (obj) => {
            if (res.destroyed || res.writableEnded) return true;
            return res.write(JSON.stringify(obj) + "\n");
        };
        const heartbeat = setInterval(() => writeLine({ ping: true }), STREAM_HEARTBEAT_MS);

        // Module-facing emit: resolves on socket drain for backpressure. The
        // error/status shape of module events is the module's business — the
        // runtime treats them as opaque.
        ctx.emit = (event) => {
            const ok = writeLine({ event });
            if (ok !== false) return Promise.resolve();
            // Backpressure: wait for drain, but never past disconnect/abort/error.
            // Node emits no 'drain' on a destroyed socket, so a bare drain-wait
            // would hang the handler forever on a client disconnect (stop/closed
            // tab) — leaking the heartbeat and the concurrency slot.
            return new Promise((resolve) => {
                const settle = () => {
                    res.off("drain", settle);
                    res.off("close", settle);
                    res.off("error", settle);
                    controller.signal.removeEventListener("abort", settle);
                    resolve();
                };
                res.once("drain", settle);
                res.once("close", settle);
                res.once("error", settle);
                controller.signal.addEventListener("abort", settle, { once: true });
            });
        };

        try {
            const result = await target.fn(ctx, ...args);
            clearTimeout(timeout);
            if (policy.circuitBreaker) this.#recordCircuit(policy.circuitBreaker, methodKey, true);
            writeLine({ done: true, ok: true, result: result === undefined ? null : result });
        } catch (error) {
            clearTimeout(timeout);
            const aborted = controller.signal.aborted;
            const disconnected = res.destroyed || res.writableEnded;
            if (policy.circuitBreaker && !(aborted && disconnected)) {
                this.#recordCircuit(policy.circuitBreaker, methodKey, false);
            }
            this.logger.error(`[rpc] ${kind}/${itemId}/${method} stream failed`, error);
            // Same disclosure discipline as #writeJson: message + code + status only.
            writeLine({
                done: true,
                ok: false,
                error: aborted
                    ? `RPC timed out after ${timeoutMs}ms`
                    : ((error && error.message) || "RPC failed"),
                code: aborted ? "RPC_TIMEOUT" : ((error && error.code) || "RPC_INTERNAL_ERROR"),
                status: aborted ? 504 : 500,
            });
        } finally {
            clearInterval(heartbeat);
            if (!res.destroyed && !res.writableEnded) res.end();
        }
    }

    /**
     * Concurrency gate per method key. Ungated (no finite maxConcurrency) resolves
     * immediately. At capacity the request queues up to `queueLimit`; a queued
     * caller that disconnects is dropped from the queue without consuming a slot.
     */
    #acquireRpcSlot(methodKey, policy, res) {
        const max = Number(policy.maxConcurrency);
        if (!Number.isFinite(max) || max <= 0) return Promise.resolve({ ok: true });

        let gate = this._rpcGates.get(methodKey);
        if (!gate) {
            gate = { active: 0, queue: [] };
            this._rpcGates.set(methodKey, gate);
        }
        if (gate.active < max) {
            gate.active++;
            return Promise.resolve({ ok: true });
        }

        const queueLimit = Math.max(0, Number(policy.queueLimit) || 0);
        if (gate.queue.length >= queueLimit) return Promise.resolve({ ok: false });

        return new Promise((resolve) => {
            const entry = {};
            const onClose = () => {
                const idx = gate.queue.indexOf(entry);
                if (idx >= 0) gate.queue.splice(idx, 1);
                resolve({ ok: true, cancelled: true });
            };
            entry.grant = () => {
                res.off("close", onClose);
                gate.active++;
                resolve({ ok: true });
            };
            res.on("close", onClose);
            gate.queue.push(entry);
        });
    }

    #releaseRpcSlot(methodKey, policy) {
        const max = Number(policy.maxConcurrency);
        if (!Number.isFinite(max) || max <= 0) return;
        const gate = this._rpcGates.get(methodKey);
        if (!gate) return;
        gate.active = Math.max(0, gate.active - 1);
        while (gate.active < max && gate.queue.length) {
            gate.queue.shift().grant();
        }
        if (!gate.active && !gate.queue.length) this._rpcGates.delete(methodKey);
    }

    /**
     * Circuit breaker per `circuitBreaker.key` (falls back to the method key).
     * `failureThreshold` consecutive failures open the circuit for `resetAfterMs`;
     * once that elapses the breaker goes half-open — requests flow again with a
     * single remaining strike, so one more failure re-opens it immediately while
     * one success resets it fully.
     */
    #checkCircuit(cbPolicy, methodKey) {
        const key = cbPolicy.key || methodKey;
        const entry = this._rpcBreakers.get(key);
        if (!entry) return { key, open: false };
        if (entry.openUntil) {
            const now = Date.now();
            if (now < entry.openUntil) {
                return { key, open: true, retryAfterMs: entry.openUntil - now };
            }
            // Half-open: leave one strike on the counter.
            entry.openUntil = 0;
            const threshold = Math.max(1, Number(cbPolicy.failureThreshold) || 5);
            entry.failures = threshold - 1;
        }
        return { key, open: false };
    }

    #recordCircuit(cbPolicy, methodKey, success) {
        const key = cbPolicy.key || methodKey;
        if (success) {
            this._rpcBreakers.delete(key);
            return;
        }
        const threshold = Math.max(1, Number(cbPolicy.failureThreshold) || 5);
        const resetAfterMs = Math.max(1000, Number(cbPolicy.resetAfterMs) || 30_000);
        let entry = this._rpcBreakers.get(key);
        if (!entry) {
            entry = { failures: 0, openUntil: 0 };
            this._rpcBreakers.set(key, entry);
        }
        entry.failures++;
        if (entry.failures >= threshold && !entry.openUntil) {
            entry.openUntil = Date.now() + resetAfterMs;
            this.logger.warn?.(`[rpc] circuit '${key}' opened for ${resetAfterMs}ms after ${entry.failures} consecutive failures`);
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
        // The peer may have disconnected mid-dispatch (see onClientClose in
        // handleRpc) — writing to a torn-down response throws.
        if (res.destroyed || res.writableEnded || res.headersSent) return;
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(body));
    }
}

module.exports = {
    XopatServerRuntime,
};
