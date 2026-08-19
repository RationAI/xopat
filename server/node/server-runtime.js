"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cluster = require("node:cluster");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { parse } = require("comment-json");
const {installGlobalServerHelpers} = require("./server-helpers");
const {getServerLogging} = require("./logging");
const {
    registerRpcAuthVerifier, registerProxyAuthVerifier, normalizePrincipalUser,
    resolveVerifierContext, getVerifierEntries, csrfTokenMatches,
} = require("./auth");

const REGISTER_FILE_RE = /(^|[\\/])register\.server\.(js|mjs|ts)$/i;

const {
    SERVER_BUILD_DIR,
    loadServerModuleFromFile,
} = require("./server-module-loader");

const SERVER_FILE_RE = /\.server\.(js|mjs|ts)$/i;
const DEFAULT_TIMEOUT_MS = 10_000;
/**
 * Body cap for a method whose policy declares none. A default is required, not a
 * nicety: an opt-in limit leaves every method written before anyone thought about
 * limits unbounded, and the body is read before the handler ever runs.
 */
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
/** Hard ceiling clamping any policy value. Attachments are the reason it is not smaller. */
const ABSOLUTE_MAX_BODY_BYTES = Math.max(
    64 * 1024,
    Number(process.env.XOPAT_RPC_MAX_BODY_BYTES) || 16 * 1024 * 1024
);

class RpcBodyError extends Error {
    constructor(message, code, status = 400) {
        super(message);
        this.name = "RpcBodyError";
        this.code = code;
        this.status = status;
    }
}

/** Ceiling on how much of a rejected body we are willing to read just to keep the connection usable. */
const ABANDONED_BODY_DRAIN_BYTES = 8 * 1024 * 1024;
/** ...and for how long. Whichever trips first ends the socket. */
const ABANDONED_BODY_DRAIN_MS = 5_000;

/**
 * Discard the remainder of a body we have already refused.
 *
 * HTTP/1.1 is full duplex: the 413 can go out while the sender is still writing.
 * But the connection is only reusable if the request stream reaches `end`, and
 * Node will not deliver the response cleanly on a socket it had to destroy
 * mid-body — which is why the naive `req.destroy()` turned every over-limit
 * request into a reset (a synthesized 502 behind a gateway).
 *
 * Reading forever is not an option either, so the drain is bounded on both
 * bytes and time; a sender that exceeds either was not going to finish politely
 * anyway and loses the socket. Nothing is buffered — bytes are counted and
 * dropped.
 */
function drainAbandonedBody(req, {
    maxBytes = ABANDONED_BODY_DRAIN_BYTES,
    maxMs = ABANDONED_BODY_DRAIN_MS,
} = {}) {
    if (!req || req.readableEnded || req.destroyed) return;
    // Only an actual stream has a socket worth keeping alive; anything merely
    // async-iterable has nothing to drain and no listeners to attach.
    if (typeof req.on !== "function" || typeof req.off !== "function" || typeof req.resume !== "function") return;

    let timer = null;
    const cleanup = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        req.off("data", onData);
        req.off("end", cleanup);
        req.off("error", cleanup);
        req.off("aborted", cleanup);
    };
    const giveUp = () => {
        cleanup();
        req.destroy();
    };
    let drained = 0;
    const onData = (chunk) => {
        drained += chunk.length;
        if (drained > maxBytes) giveUp();
    };

    timer = setTimeout(giveUp, maxMs);
    timer.unref?.();
    req.on("data", onData);
    req.once("end", cleanup);
    req.once("error", cleanup);
    req.once("aborted", cleanup);
    req.resume();
}

/**
 * Own-property read of an RPC body field.
 *
 * `#readJsonBody` already guarantees a plain object, so this is belt-and-braces
 * against a body like `{"__proto__": {...}}` reaching a field read.
 */
function readBodyField(body, key) {
    return Object.prototype.hasOwnProperty.call(body, key) ? body[key] : undefined;
}
/**
 * Streaming-RPC liveness ping period.
 *
 * The client's dead-pipe watchdog is DERIVED from this (see streamTimings) rather
 * than written down separately. The two used to be independent literals — 15s here
 * and 45s in the client template — which is exactly the kind of pair that drifts,
 * and when it drifts the symptom is a working turn killed by its own caller.
 */
const STREAM_HEARTBEAT_MS = 15_000;
/** Missed pings before the client calls a stream dead. */
const STREAM_STALL_HEARTBEATS = 3;
/**
 * Multiplier for the caller's PRE-header budget. A stream that has not answered
 * yet is not the same failure as one that went silent mid-flight: before the
 * headers the request may legitimately be waiting on admission, so it gets more
 * room, while an established stream keeps the tight dead-pipe detector.
 */
const STREAM_CONNECT_STALL_FACTOR = 2;

/**
 * Effective streaming timings, operator-overridable via
 * `core.server.rpc.streamHeartbeatMs` / `streamStallMs`. Floors keep a
 * misconfiguration from producing a watchdog that fires faster than the
 * heartbeat it is supposed to observe.
 */
function streamTimings(core) {
    const rpc = core?.CORE?.server?.rpc || {};
    const heartbeatMs = Math.max(1000, Number(rpc.streamHeartbeatMs) || STREAM_HEARTBEAT_MS);
    const stallMs = Math.max(
        heartbeatMs * 2,
        Number(rpc.streamStallMs) || heartbeatMs * STREAM_STALL_HEARTBEATS,
    );
    return { heartbeatMs, stallMs, connectMs: stallMs * STREAM_CONNECT_STALL_FACTOR };
}

/**
 * How many processes serve this deployment, for splitting cluster-wide budgets.
 *
 * `maxConcurrency` and `queueLimit` exist to protect an UPSTREAM — "no more than
 * 2 concurrent calls to this model endpoint". They were per-process, so forking
 * N workers silently multiplied every one of them by N and the protection
 * quietly stopped meaning what it said. A declared number is now a
 * deployment-wide budget, divided across the workers that share it.
 *
 * `XOPAT_WORKERS` is what `cluster-index.js` forked with; the availableParallelism
 * fallback mirrors its default. An operator running N replicas *without*
 * node:cluster sets XOPAT_SHARED_DEPLOYMENT_SIZE to say so.
 */
const DEPLOYMENT_PROCESS_COUNT = (() => {
    const explicit = Number(process.env.XOPAT_SHARED_DEPLOYMENT_SIZE);
    if (Number.isFinite(explicit) && explicit >= 1) return Math.floor(explicit);
    if (!cluster.isWorker) return 1;
    const workers = Number(process.env.XOPAT_WORKERS);
    if (Number.isFinite(workers) && workers >= 1) return Math.floor(workers);
    return Math.max(1, os.availableParallelism?.() || os.cpus().length || 1);
})();

/**
 * This process's share of a cluster-wide budget, never below 1 — a worker that
 * may run zero of something can only deadlock.
 */
function perProcessBudget(total) {
    const n = Number(total);
    if (!Number.isFinite(n) || n <= 0) return total;
    return Math.max(1, Math.floor(n / DEPLOYMENT_PROCESS_COUNT));
}

/**
 * Extra time a handler gets to unwind AFTER its abort fires, before the runtime
 * stops waiting for it.
 *
 * `ctx.signal` is advisory: nothing can kill a promise. A handler that ignores
 * it and never settles used to hold its concurrency slot, its `res.on("close")`
 * listener, its heartbeat interval and its socket forever — `finally` cannot run
 * if the `await` never returns, so the leak was permanent and cumulative.
 *
 * Deliberately generous, because the failure mode of being too eager is worse
 * than the failure mode of being too patient: a handler that would have
 * succeeded 5s after its timeout now still succeeds. Only one that is genuinely
 * stuck pays.
 */
const RPC_ABORT_GRACE_MS = Math.max(1000, Number(process.env.XOPAT_RPC_ABORT_GRACE_MS) || 60_000);

/** Minimum spacing between request-triggered rescans (dev only). */
const RESCAN_MIN_INTERVAL_MS = Math.max(0, Number(process.env.XOPAT_RESCAN_INTERVAL_MS) || 2000);

/**
 * Resolve/reject with `promise`, but stop waiting once `signal` has been
 * aborted for RPC_ABORT_GRACE_MS. The underlying work is not cancelled — it
 * cannot be — but the request stops being hostage to it.
 */
function settleWithinAbortGrace(promise, signal) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let graceTimer = null;

        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            if (graceTimer) clearTimeout(graceTimer);
            signal.removeEventListener("abort", onAbort);
            fn(value);
        };
        const giveUp = () => finish(reject, signal.reason instanceof Error
            ? signal.reason
            : new Error("RPC handler did not settle after abort"));
        const onAbort = () => {
            graceTimer = setTimeout(giveUp, RPC_ABORT_GRACE_MS);
            graceTimer.unref?.();
        };

        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });

        // Both branches route through `finish`, so a late settle after we gave
        // up is swallowed rather than becoming an unhandled rejection.
        promise.then(v => finish(resolve, v), e => finish(reject, e));
    });
}

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
        // The logging broker (server/node/logging.js). Falls back to the process
        // singleton so a runtime constructed without one still logs.
        this.logging = options.logging || getServerLogging() || null;
        // Per-area channels, so an operator can silence RPC noise while keeping
        // auth warnings, or the other way round. Falls back to the plain logger
        // when the broker is absent (a runtime constructed by a test harness).
        const channel = (name) => (this.logging ? this.logging.log(name) : this.logger);
        this.rpcLog = channel("rpc");
        this.authLog = channel("rpc.auth");
        this.routeLog = channel("server-route");
        this.extLog = channel("server-ext");
        this.version = options.version || "dev";
        this.startedAt = options.startedAt || new Date();
        fs.mkdirSync(this.cacheDir, { recursive: true });
        this.registry = { plugin: Object.create(null), module: Object.create(null) };
        // Runtime-policy enforcement state (per method key / breaker key). The
        // policy fields (maxConcurrency, queueLimit, circuitBreaker) are declared
        // by *.server.* method policies and enforced in handleRpc.
        this._rpcGates = new Map();
        this._rpcBreakers = new Map();
        /** In-flight NDJSON streams, so shutdown can end them politely. */
        this._activeStreams = new Set();
        /** file -> {signature, count}: dedupes repeated load-failure logging. */
        this._loadFailures = new Map();
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
        this.routeLog.info(`registered ${p}`);
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
            ctx.log = this.logging ? this.logging.log(`server-route${match.prefix.replace(/\//g, ":")}`) : this.logger;
            await match.handler(ctx, urlObj, match.prefix);
        } catch (e) {
            this.routeLog.error(`${urlObj.pathname} failed`, e);
            if (!res.headersSent) { res.writeHead(500, { "Content-Type": "text/plain" }); res.end("Server route error"); }
        }
        return true;
    }

    scan() {
        this.registry.plugin = this.#scanKind("plugin", this.pluginsDir);
        this.registry.module = this.#scanKind("module", this.modulesDir);
        this._lastScanAt = Date.now();
        return this.registry;
    }

    /**
     * Rescan triggered from the REQUEST path, when a lookup misses.
     *
     * The bare `scan()` behind an unknown id was the cheapest unauthenticated
     * denial of service in the server: it is a synchronous recursive
     * `readdirSync` over all of `plugins/` and `modules/` plus a `comment-json`
     * parse of every manifest (~146ms of blocked event loop on a dev checkout),
     * it sat BEFORE the body read and BEFORE the auth gate, and two of them were
     * reachable per request. `POST /__rpc/module/x/y` in a loop was enough to
     * stall the process for everybody.
     *
     * So: in production, never — the filesystem does not grow a new plugin
     * without a restart, and pretending otherwise bought nothing. In dev, at
     * most once per RESCAN_MIN_INTERVAL_MS, which keeps "add a file, call it"
     * working without handing anyone a repeat trigger.
     */
    #rescanOnMiss() {
        if (!this.devMode) return false;
        const now = Date.now();
        if (now - (this._lastScanAt || 0) < RESCAN_MIN_INTERVAL_MS) return false;
        this.scan();
        return true;
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

    /**
     * The browser-side RPC client, emitted as source.
     *
     * `core` is optional and only supplies the streaming timings — they are
     * interpolated from the SERVER's effective heartbeat so the caller's watchdog
     * can never be tighter than the liveness signal it watches for.
     */
    getClientRuntimeSource(core = null) {
        const timings = streamTimings(core);
        return `
(function(global){
  var STREAM_STALL_MS = ${Number(timings.stallMs)};
  var STREAM_CONNECT_MS = ${Number(timings.connectMs)};
  function getDefaultHttpClient() {
    var app = global.APPLICATION_CONTEXT;
    if (!app || !app.httpClient) {
      throw new Error("APPLICATION_CONTEXT.httpClient is not available.");
    }
    return app.httpClient;
  }

  // Session identification for our own server. The CSRF header is the normal
  // path; X-XOPAT-Session is the cookieless fallback used when the viewer runs
  // in a third-party frame with no usable cookie jar (blocked third-party
  // cookies, or a sandboxed opaque origin). Undefined outside that mode.
  function sessionHeaders() {
    var out = {};
    if (global.XOPAT_CSRF_TOKEN) out["X-XOPAT-CSRF"] = global.XOPAT_CSRF_TOKEN;
    if (global.XOPAT_SESSION_ID) out["X-XOPAT-Session"] = global.XOPAT_SESSION_ID;
    return out;
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

    // Two windows, not one. Before the response headers the request may still be
    // waiting for admission (concurrency gate, auth, module load) and there is
    // nothing it could have sent; once the stream is established, silence longer
    // than a few heartbeats means a dead pipe. Collapsing both into one tight
    // timer is what turned a legitimately queued turn into "RPC stream stalled".
    var stallTimer = null;
    var debugStream = null;
    function streamDebug(what, extra) {
      if (debugStream === null) {
        try {
          debugStream = !!(global.APPLICATION_CONTEXT
            && global.APPLICATION_CONTEXT.getOption
            && global.APPLICATION_CONTEXT.getOption("debugMode"));
        } catch (_) { debugStream = false; }
      }
      if (!debugStream) return;
      console.debug("[rpc-stream]", kind + "/" + id + "/" + method, what, extra === undefined ? "" : extra);
    }
    function resetStall(windowMs) {
      var ms = windowMs || STREAM_STALL_MS;
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(function () {
        var e = new Error("RPC stream stalled: no data for " + ms + "ms");
        e.code = "RPC_STREAM_STALLED";
        streamDebug("stalled", ms + "ms");
        controller.abort(e);
      }, ms);
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
        // Arm the CONNECT window before opening the stream: HttpClient.stream has
        // no internal timeout (lifetime is caller-owned) and this await blocks
        // until response headers arrive. Without it, an upstream that accepts the
        // TCP connection but never sends headers hangs the turn forever.
        resetStall(STREAM_CONNECT_MS);
        var stream = await ctx.client.stream(ctx.url, {
          method: "POST",
          body: {
            args: payload === undefined ? [] : [payload],
            viewerId: ctx.viewerId,
            contextId: callOptions && callOptions.contextId
          },
          headers: Object.assign({ "X-Xopat-Rpc-Stream": "1" }, sessionHeaders()),
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

        // Headers are in: from here the tight dead-pipe window applies, because the
        // server heartbeats every STREAM_STALL_MS/3 no matter how long the handler
        // itself stays silent.
        var openedAt = Date.now();
        var lastAt = openedAt;
        streamDebug("open");
        resetStall();
        for await (var line of stream.lines()) {
          resetStall();
          if (!line || typeof line !== "object") continue;
          if (line.ping) {
            streamDebug("ping", (Date.now() - lastAt) + "ms since last line");
            lastAt = Date.now();
            continue;
          }
          streamDebug(line.done ? "done" : "event",
            (Date.now() - lastAt) + "ms since last line, " + (Date.now() - openedAt) + "ms total");
          lastAt = Date.now();
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
                headers: sessionHeaders(),
                expect: "json",
                signal: callOptions && callOptions.signal,
                // Open-ended callers (e.g. a chat turn) pass timeoutMs: 0 so the
                // turn's own signal is the sole deadline; everyone else keeps the
                // client's timeout backstop.
                timeoutMs: callOptions && callOptions.timeoutMs,
                // Connection-pool priority: background RPCs (e.g. vision inference)
                // yield slots to interactive tile loading via the request scheduler.
                priority: callOptions && callOptions.priority
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
            if (!item && this.#rescanOnMiss()) {
                item = this.registry[kind] && this.registry[kind][id];
            }

            if (!item) {
                return this.#writeJson(res, 404, {
                    error: `${kind} '${id}' not found`,
                    code: "RPC_UNKNOWN_TARGET"
                });
            }

            // The registry is built by walking the filesystem, so it lists every
            // plugin/module on disk regardless of configuration. An operator who
            // writes `enabled: false` reasonably reads that as "off" — but the
            // item's whole RPC surface stayed callable. Honour the merged config
            // here, where it is available.
            //
            // ABSENCE counts as disabled too, not just an explicit `false`.
            // `pluginSelectionMode: "whitelist"` / `"available"` excludes an item
            // by leaving it OUT of the map entirely (see
            // server/templates/javascript/plugins.js `shouldInclude`), so the
            // `configured[id] && …` shape meant the one mode whose entire purpose
            // is "ship less than what is on disk" removed the plugin from the UI
            // while leaving its RPCs open to anyone who knew the id.
            const configured = (kind === "plugin" ? core?.PLUGINS : core?.MODULES) || {};
            const configuredKnown = Object.keys(configured).length > 0;
            const entry = Object.prototype.hasOwnProperty.call(configured, id) ? configured[id] : undefined;
            // An empty map means "this core build did not load plugins/modules"
            // (serverOnly without withPlugins), NOT "everything is disabled" —
            // inferring disablement from it would 404 every RPC on that path.
            const disabled = entry
                ? entry.enabled === false
                : configuredKnown;
            if (disabled) {
                return this.#writeJson(res, 404, {
                    error: `${kind} '${id}' is disabled in this deployment`,
                    code: "RPC_ITEM_DISABLED"
                });
            }
        }

        // NOTE: the body is read further down, AFTER the method's policy is known.
        // Reading it here would buffer an unbounded request for a method that may
        // not exist and whose maxBodyBytes we have not looked at yet.
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
            // (dev only, rate-limited — see #rescanOnMiss)
            if (!target && this.#rescanOnMiss()) {
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
            // Divided by the worker count: these bound an upstream, and the
            // upstream sees the whole deployment, not one process.
            maxConcurrency: perProcessBudget(runtime.maxConcurrency ?? rawPolicy.maxConcurrency),
            queueLimit: perProcessBudget(runtime.queueLimit ?? rawPolicy.queueLimit),
            circuitBreaker: runtime.circuitBreaker ?? rawPolicy.circuitBreaker,
            // Streaming NDJSON response mode (see #handleRpc streaming branch).
            streaming: runtime.streaming === true,
            // Optional shared concurrency-gate key (mirrors circuitBreaker.key) so
            // sibling methods (e.g. buffered + streaming variants of one upstream
            // operation) share one slot pool instead of doubling it.
            concurrencyKey: runtime.concurrencyKey ?? rawPolicy.concurrencyKey,
        };

        // Read the body only now: the method (and therefore its size limit) is
        // resolved, and an unknown target has already 404'd without buffering.
        let body;
        try {
            body = await this.#readJsonBody(req, this.#bodyLimitFor(policy));
        } catch (error) {
            if (error && error.code === "RPC_BODY_TOO_LARGE") {
                // Warn, not debug: a caller that keeps hitting this sees only a
                // failed request, so the limit it hit has to be findable here.
                this.rpcLog.warn(
                    `${kind}/${item.id}/${method} rejected: body over the ${this.#bodyLimitFor(policy)} byte limit`
                );
            }
            return this.#writeJson(res, error.status || 400, {
                error: error.message,
                code: error.code || "RPC_BAD_JSON"
            });
        }

        const authResult = await this.#verifyRpcRequest(
            req,
            res,
            core,
            session,
            policy,
            { kind, item, method, contextId: readBodyField(body, "contextId") }
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

        // Commit the NDJSON headers and start the heartbeat HERE, before the circuit
        // check and — the one that matters — before the concurrency gate, which can
        // WAIT. Everything between the request arriving and the first byte is
        // invisible to the caller, and the client aborts a stream that sends nothing
        // for STREAM_STALL_MS: a turn queued behind a full gate used to burn that
        // watchdog while the server was working exactly as designed. From this point
        // on a streaming request answers in-band, so both rejections below become
        // terminal records rather than HTTP status codes (the client pump maps them
        // to the same code/status). Everything BEFORE this point — unknown method,
        // body too large, auth — still answers as a plain HTTP error, which is why
        // the stream cannot open any earlier.
        const timings = streamTimings(core);
        const stream = policy.streaming ? this.#openStream(res, methodKey, timings.heartbeatMs) : null;

        const circuit = policy.circuitBreaker
            ? this.#checkCircuit(policy.circuitBreaker, methodKey)
            : null;
        if (circuit && circuit.open) {
            const payload = {
                error: `Upstream circuit '${circuit.key}' is open; retry in ${Math.ceil(circuit.retryAfterMs / 1000)}s`,
                code: "RPC_CIRCUIT_OPEN",
            };
            return stream
                ? stream.fail({ ...payload, status: 503 })
                : this.#writeJson(res, 503, payload);
        }

        const slotWaitStart = Date.now();
        const slot = await this.#acquireRpcSlot(gateKey, policy, res);
        const slotWaitMs = Date.now() - slotWaitStart;
        if (slotWaitMs > timings.heartbeatMs) {
            // A gate that holds callers longer than one heartbeat is a saturated
            // upstream budget, not a hiccup — name it, or the only symptom is
            // "the app got slow".
            this.rpcLog.warn(
                `${methodKey} waited ${slotWaitMs}ms for a '${gateKey}' concurrency slot `
                + `(maxConcurrency ${policy.maxConcurrency}, queueLimit ${policy.queueLimit})`
            );
        }
        if (!slot.ok) {
            const payload = {
                error: `Too many concurrent '${method}' requests; queue is full`,
                code: "RPC_QUEUE_FULL",
            };
            return stream
                ? stream.fail({ ...payload, status: 429 })
                : this.#writeJson(res, 429, payload);
        }
        if (slot.cancelled) {
            stream?.close();
            return;                                     // client left while queued; socket is gone
        }

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
                // Never-null-when-known caller identity; see #principalOf. Use
                // this (or XOPAT_SERVER.resolvePrincipal) for ownership and
                // per-user storage scoping instead of `user?.id ?? null`.
                principal: authResult.principal,
                principalKind: authResult.principalKind,
                viewerId: readBodyField(body, "viewerId"),
                // CLIENT-SUPPLIED. It selects the request-time verifier context,
                // so it is a claim, not a fact. Never derive an authorization
                // decision from it — see XOPAT_SERVER.requireRpcAuthContext.
                contextId: readBodyField(body, "contextId"),
                kind,
                itemId: item.id,
                method,
                signal: controller.signal,
                requestId: crypto.randomUUID(),
            };
            // Pre-scoped logger: channel "<kind>.<itemId>:<method>", request id and
            // the HASHED principal already bound. A module logs with zero setup and
            // an operator can silence/raise exactly that method — see server/LOGGING.md.
            ctx.log = this.logging
                ? this.logging.forCtx(ctx)
                : this.logger;

            const rawArgs = readBodyField(body, "args");
            const args = Array.isArray(rawArgs) ? rawArgs : [];

            if (policy.streaming) {
                return await this.#runStreamingRpc({
                    res, ctx, args, target, policy, stream,
                    methodKey, kind, itemId: item.id, method,
                    controller, timeout, timeoutMs,
                });
            }

            const result = await settleWithinAbortGrace(
                Promise.resolve().then(() => target.fn(ctx, ...args)),
                controller.signal,
            );

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
            this.rpcLog.error(`${kind}/${item.id}/${method} failed`, error);
            if (disconnected) return; // nobody to answer

            const payload = this.#rpcErrorPayload(error, aborted, timeoutMs);
            const status = aborted ? 504 : 500;
            // Headers are already out for a streaming request, so the answer must be
            // a terminal record; #writeJson would throw ERR_HTTP_HEADERS_SENT and
            // leave the caller reading a stream nobody will ever end.
            if (stream) return stream.fail({ ...payload, status });
            return this.#writeJson(res, status, payload);
        } finally {
            res.off("close", onClientClose);
            this.#releaseRpcSlot(gateKey, policy);
            // Idempotent — #runStreamingRpc already closed it on its own paths. This
            // covers a throw between opening the stream and reaching that method,
            // which would otherwise leak the heartbeat and the open socket.
            stream?.close();
        }
    }

    /**
     * Open an NDJSON response: commit the headers and start the liveness
     * heartbeat. Called as soon as the request is known to answer in-band — i.e.
     * BEFORE the circuit and concurrency gates, so a queued or rejected stream is
     * still a live pipe rather than dead air the caller has to time out on.
     *
     * Wire contract (one JSON object per newline):
     *   {"event": <opaque module payload>}   forwarded to the caller
     *   {"ping": true}                       liveness, consumed silently
     *   {"done": true, "ok": true, "result": ...}                  terminal
     *   {"done": true, "ok": false, "error", "code", "status"}     terminal
     *
     * `close()` is idempotent: several unwind paths may reach it.
     */
    #openStream(res, methodKey, heartbeatMs = STREAM_HEARTBEAT_MS) {
        res.writeHead(200, {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        });

        const writeLine = (obj) => {
            if (res.destroyed || res.writableEnded) return true;
            return res.write(JSON.stringify(obj) + "\n");
        };
        // Pings also self-report lateness: the interval can only be late if the
        // event loop was blocked, and a blocked loop is exactly what makes a client
        // declare a healthy stream dead. Without this the symptom ("no data for
        // 45s") is visible only in the browser, where its cause is invisible.
        let lastPingAt = Date.now();
        const heartbeat = setInterval(() => {
            const late = Date.now() - lastPingAt - heartbeatMs;
            lastPingAt = Date.now();
            if (late > heartbeatMs) {
                this.rpcLog.warn(
                    `${methodKey} heartbeat fired ${late}ms late — the event loop was blocked, `
                    + `which starves every stream on this process`
                );
            }
            writeLine({ ping: true });
        }, heartbeatMs);
        // Unref'd: a stream stuck open must not be the reason the process cannot
        // exit. Shutdown ends these deliberately (see closeActiveStreams).
        heartbeat.unref?.();

        // Registered so a graceful shutdown can close the stream with a terminal
        // record instead of severing the socket — a cut NDJSON stream surfaces
        // client-side as RPC_STREAM_TRUNCATED with no indication of why.
        const entry = { res, writeLine, methodKey };
        this._activeStreams.add(entry);

        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            clearInterval(heartbeat);
            this._activeStreams.delete(entry);
            if (!res.destroyed && !res.writableEnded) res.end();
        };

        return {
            writeLine,
            close,
            /** Terminal error record + close, for a rejection that never reaches a handler. */
            fail(payload) {
                writeLine({ done: true, ok: false, ...payload });
                close();
            },
        };
    }

    /**
     * Streaming (NDJSON) RPC execution. Runs inside handleRpc's try/finally, so
     * the timeout, close-abort listener, slot release, and logging scaffolding
     * all wrap the stream's full lifetime. The stream itself was already opened
     * by the caller (see #openStream) — a handler may legitimately stay silent
     * for minutes before its first event (a reasoning model thinking), and a
     * header-less connection would die at typical reverse-proxy read timeouts.
     *
     * Rejections that precede the stream (auth, body too large, unknown method)
     * never reach this method — they answer as plain JSON HTTP errors.
     */
    async #runStreamingRpc({ res, ctx, args, target, policy, stream, methodKey, kind, itemId, method, controller, timeout, timeoutMs }) {
        const { writeLine } = stream;
        const startedAt = Date.now();
        let events = 0;

        // Module-facing emit: resolves on socket drain for backpressure. The
        // error/status shape of module events is the module's business — the
        // runtime treats them as opaque.
        ctx.emit = (event) => {
            events++;
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
            const result = await settleWithinAbortGrace(
                Promise.resolve().then(() => target.fn(ctx, ...args)),
                controller.signal,
            );
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
            this.rpcLog.error(`${kind}/${itemId}/${method} stream failed`, error);
            // Same disclosure discipline as #writeJson: message + code + status only.
            writeLine({
                done: true,
                ok: false,
                ...this.#rpcErrorPayload(error, aborted, timeoutMs),
                status: aborted ? 504 : 500,
            });
        } finally {
            this.rpcLog.debug(
                `${kind}/${itemId}/${method} stream closed after ${Date.now() - startedAt}ms, ${events} events`
            );
            stream.close();
        }
    }

    /**
     * End every in-flight NDJSON stream with a terminal record.
     *
     * Called from the shutdown path. Without it, `server.close()` plus process
     * exit severs the sockets mid-stream and the client reports
     * RPC_STREAM_TRUNCATED — indistinguishable from a network fault, and for a
     * chat/dictation transcript it means the user cannot tell whether their turn
     * was persisted.
     */
    closeActiveStreams(reason = "Server is shutting down") {
        const entries = [...this._activeStreams];
        this._activeStreams.clear();
        for (const entry of entries) {
            try {
                entry.writeLine({
                    done: true, ok: false, error: reason,
                    code: "RPC_SERVER_SHUTDOWN", status: 503,
                });
                if (!entry.res.destroyed && !entry.res.writableEnded) entry.res.end();
            } catch (e) {
                this.rpcLog?.warn?.(`failed to close stream ${entry.methodKey}: ${e?.message || e}`);
            }
        }
        return entries.length;
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
            this.rpcLog.warn(`circuit '${key}' opened for ${resetAfterMs}ms after ${entry.failures} consecutive failures`);
        }
    }


    /**
     * Log reads are the one builtin that also exists in production — an operator
     * debugging a live deployment should not need a redeploy to see the server's
     * own records. Everything else stays dev-only, and the log methods still run
     * their own access check (`#assertLogReadAllowed`) inside the handler.
     */
    static #PROD_BUILTIN_METHODS = new Set(["getLogs", "getLogChannels"]);

    #getBuiltinRpcTarget(scopeId, methodName) {
        if (!this.devMode && !XopatServerRuntime.#PROD_BUILTIN_METHODS.has(methodName)) return null;
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
                fn: (ctx, payload) => this.#readLogs(ctx, payload),
            },
            getLogChannels: {
                fn: (ctx) => this.#readLogChannels(ctx),
            },
        };

        if (scopeId === "core") {
            return {
                getStatus: {
                    fn: (ctx, payload) => this.#readDevStatus(ctx, payload),
                },
                getStorageStats: {
                    fn: (ctx, payload) => this.#readStorageStats(ctx, payload),
                },
                collectGarbage: {
                    fn: (ctx, payload) => this.#collectGarbage(ctx, payload),
                },
                setLogLevel: {
                    fn: (ctx, payload) => this.#setLogLevel(ctx, payload),
                },
                ...sharedTargets,
            }[methodName] || null;
        }

        if (scopeId === "dev") {
            return sharedTargets[methodName] || null;
        }

        return null;
    }

    /**
     * Gate for the log-read builtins.
     *
     * Dev mode is open (it always was). In production the caller must match the
     * operator allowlist in `core.server.logging.access` — matched server-side
     * against the VERIFIED principal and its claims, never against anything the
     * request body carries. Empty allowlist = nobody, so a deployment that never
     * configured it behaves exactly as before.
     */
    #assertLogReadAllowed(ctx) {
        if (!this.logging) {
            const error = new Error("The logging broker is not available");
            error.code = "RPC_LOGGING_UNAVAILABLE";
            throw error;
        }
        if (this.devMode) return;
        if (this.logging.canRead(ctx)) return;
        const error = new Error("Server logs are only available in dev mode, or to an operator listed in server.logging.access");
        error.code = "RPC_FORBIDDEN";
        error.status = 403;
        throw error;
    }

    #readLogs(ctx, payload = {}) {
        this.#assertLogReadAllowed(ctx);
        const snapshot = this.logging.getEntries(payload || {});
        return {
            devMode: this.devMode,
            scope: "server/core/getLogs",
            pid: process.pid,
            ...snapshot,
        };
    }

    /**
     * Every channel seen since boot (plus every configured one) with its effective
     * level — the discovery surface for "what can I turn up?".
     */
    #readLogChannels(ctx) {
        this.#assertLogReadAllowed(ctx);
        return {
            devMode: this.devMode,
            scope: "server/core/getLogChannels",
            pid: process.pid,
            channels: this.logging.channels(),
            ...this.logging.stats(),
        };
    }

    /**
     * Ephemeral, dev-only level override. Deliberately NOT available in
     * production: raising a level there is a config change (auditable, reviewable,
     * and applied to every cluster worker) rather than a live RPC that only moves
     * the worker that happened to answer.
     */
    #setLogLevel(_ctx, payload = {}) {
        if (!this.devMode || !this.logging) {
            const error = new Error("Log level overrides are only available in dev mode");
            error.code = "RPC_DEV_MODE_REQUIRED";
            throw error;
        }
        const channel = payload?.channel;
        if (!channel) {
            const error = new Error("A channel is required. Use server/core/getLogChannels to list them.");
            error.code = "RPC_BAD_ARGUMENT";
            throw error;
        }
        return {
            scope: "server/core/setLogLevel",
            pid: process.pid,
            ...this.logging.setLevelOverride(channel, payload.level ?? null),
        };
    }

    /**
     * Every registered storage namespace and every live bounded cache, with hit
     * / miss / eviction counters.
     *
     * The point is that an unbounded map is *visible* before it is a production
     * incident: `evicted` staying at zero while `size` climbs to the cap is the
     * signature of an under-configured retention policy, and a namespace missing
     * from this list is state that is not going through the broker at all.
     *
     * Values are never included — these namespaces hold tokens and patient-
     * adjacent payloads. Names, counts and policy only.
     */
    #readStorageStats(_ctx, _payload = {}) {
        if (!this.devMode) {
            const error = new Error("Storage stats are only available in dev mode");
            error.code = "RPC_DEV_MODE_REQUIRED";
            throw error;
        }
        const XS = globalThis.XOPAT_SERVER;
        return {
            devMode: true,
            scope: "server/core/getStorageStats",
            pid: process.pid,
            storage: XS?.storage?.stats?.() ?? null,
            caches: XS?.cache?.stats?.() ?? [],
        };
    }

    /**
     * Force a collection and report the memory on both sides of it.
     *
     * Leak hunting needs the POST-collection baseline: `heapUsed` sampled wherever
     * the collector happens to be sawtooths by tens of megabytes between adjacent
     * requests, which is enough noise to hide a real retention. Comparing troughs
     * only works if a collection is known to have happened.
     *
     * Dev mode only, like every other builtin here, and additionally inert unless
     * the process was started with `--expose-gc` — so on a normal deployment this is
     * unreachable twice over. It is a diagnostic, not a tuning knob: a forced major
     * GC pauses the process, which is exactly why it must never be callable in
     * production.
     */
    #collectGarbage(_ctx, _payload = {}) {
        if (!this.devMode) {
            const error = new Error("Forced garbage collection is only available in dev mode");
            error.code = "RPC_DEV_MODE_REQUIRED";
            throw error;
        }
        const before = process.memoryUsage();
        if (typeof globalThis.gc !== "function") {
            return { devMode: true, pid: process.pid, available: false, before, after: before, freedBytes: 0 };
        }
        const startedAt = process.hrtime.bigint();
        globalThis.gc();
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const after = process.memoryUsage();
        return {
            devMode: true,
            pid: process.pid,
            available: true,
            durationMs,
            before,
            after,
            freedBytes: before.heapUsed - after.heapUsed,
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
            // Process memory, for leak hunting. Deliberately HERE and not on
            // getLogs/getLogChannels: those two are the only builtins reachable in
            // production (#PROD_BUILTIN_METHODS), and this method already refuses
            // outside dev mode. `rss` alone cannot tell a bounded cache filling to
            // its cap from a real leak — the heap/external split is the signal, so
            // all of memoryUsage() goes across rather than one number.
            memory: process.memoryUsage(),
            resourceUsage: { maxRSS: process.resourceUsage().maxRSS },
            logging: this.logging ? this.logging.stats() : { available: false },
            logBuffer: this.logging ? {
                available: true,
                totalBuffered: this.logging.ring.entries.length,
                maxEntries: this.logging.ring.maxEntries,
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

    /** Sentinel: the caller named a context that does not exist. */
    static #UNKNOWN_CONTEXT = Object.freeze({ __unknownContext: true });
    /** Sentinel: the verifier config itself is ambiguous — refuse everything non-public. */
    static #MISCONFIGURED_CONTEXT = Object.freeze({ __misconfiguredContext: true });

    #strictContextWarned = false;
    #mainContextConflictLogged = false;

    /**
     * All policy lives in auth.js `resolveVerifierContext` so the request-time
     * gate, the on-demand gate and `getRpcAuthConfig` cannot drift apart. Main
     * context spellings ("core" / "default" / "") are aliases; a NAMED-but-unknown
     * sub-context is refused rather than downgraded onto `default` (typically
     * `{enabled:false}`), which is how a stale or forged id became a bypass.
     */
    #resolveRpcVerifierContext(core, contextId) {
        const secure = core?.CORE?.server?.secure || {};
        const contexts = secure.rpcVerifiers || secure.rpcAuth || {};
        let resolved;
        try {
            resolved = resolveVerifierContext(contexts, contextId);
        } catch (e) {
            // A conflicting main-context split. Refuse EVERY non-public RPC while
            // the config is ambiguous — serving requests under it is precisely the
            // downgrade this check exists to stop. Loud once, then silent.
            if (!this.#mainContextConflictLogged) {
                this.#mainContextConflictLogged = true;
                this.authLog.error(`FATAL CONFIGURATION: ${e.message}`);
            }
            return XopatServerRuntime.#MISCONFIGURED_CONTEXT;
        }
        if (!resolved.unknown) return resolved.entry ?? null;

        if (secure.rpcVerifierStrictContext !== false) {
            return XopatServerRuntime.#UNKNOWN_CONTEXT;
        }
        if (!this.#strictContextWarned) {
            this.#strictContextWarned = true;
            this.authLog.warn(
                "server.secure.rpcVerifierStrictContext=false — an unknown auth sub-context " +
                "falls back to the main context, so a client can pick its own verifier set by naming a " +
                "context that does not exist. Fix the configuration and remove this flag."
            );
        }
        return resolveVerifierContext(contexts, undefined).entry ?? null;
    }

    #isPublicAuth(publicValue, ctx) {
        if (typeof publicValue === "function") {
            try {
                return !!publicValue(ctx);
            } catch (e) {
                this.authLog.warn("public predicate failed", e);
                return false;
            }
        }
        return publicValue === true;
    }

    /**
     * The caller's principal: `user:<id>` when a verifier established an
     * identity, `sess:<id>` for an anonymous-but-tracked browser, `null` when
     * neither exists. Never a shared bucket — two anonymous browsers are two
     * principals. Consumers should read `ctx.principal` (or
     * `XOPAT_SERVER.resolvePrincipal(ctx)`), never `ctx.user?.id ?? null`.
     */
    #principalOf(user, session) {
        if (user && typeof user.id === "string" && user.id) return { principal: `user:${user.id}`, principalKind: "user" };
        if (session && session.id) return { principal: `sess:${session.id}`, principalKind: "session" };
        return { principal: null, principalKind: null };
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
                this.authLog.warn(`${warnKey} opts out of session requirement`);
            }
        }

        if (requireSession) {
            if (!session) {
                this.#writeJson(res, 401, { error: "Unauthorized: missing or invalid session", code: "RPC_NO_SESSION" });
                return { ok: false };
            }
            const clientToken = req.headers["x-xopat-csrf"];
            if (!csrfTokenMatches(clientToken, session.csrfToken)) {
                this.#writeJson(res, 403, { error: "Forbidden: invalid CSRF token", code: "RPC_BAD_CSRF" });
                return { ok: false };
            }
        }

        if (!publicAllowed) {
            const contextId = meta?.contextId;
            const verifierContext = this.#resolveRpcVerifierContext(core, contextId);
            if (verifierContext === XopatServerRuntime.#MISCONFIGURED_CONTEXT) {
                this.#writeJson(res, 500, {
                    error: "Server auth configuration is ambiguous; refusing to authorize.",
                    code: "RPC_AUTH_MISCONFIGURED",
                });
                return { ok: false };
            }
            if (verifierContext === XopatServerRuntime.#UNKNOWN_CONTEXT) {
                this.authLog.warn(
                    `${meta.kind}/${meta.item?.id || meta.itemId}/${meta.method} named an unknown ` +
                    `auth sub-context ${JSON.stringify(contextId)}; rejecting rather than falling back to the ` +
                    `main context. Configure it under server.secure.rpcVerifiers, or set ` +
                    `server.secure.rpcVerifierStrictContext=false to restore the legacy fallback. ` +
                    `(The main context is spelled "core" / "default" / "" — those are aliases and never land here.)`
                );
                this.#writeJson(res, 401, {
                    error: `Unauthorized: unknown auth context`,
                    code: "RPC_AUTH_UNKNOWN_CONTEXT",
                });
                return { ok: false };
            }
            const explicitlyDisabled = !!(verifierContext && verifierContext.enabled === false);
            // Same helper requireRpcAuthContext uses, so the array form
            // (`"verifiers": ["<system-name>-session"]`) is judged identically here.
            const hasVerifiers = getVerifierEntries(verifierContext && verifierContext.verifiers).length > 0;

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
                this.authLog.warn(
                    `${meta.kind}/${meta.item?.id || meta.itemId}/${meta.method} ` +
                    `is non-public, opted out of session, and has ${detail} verifier context ` +
                    `(contextId=${JSON.stringify(contextId)}); rejecting. ` +
                    `Add an explicit \`enabled: false\` to opt out, or configure verifiers under server.secure.rpcVerifiers.`
                );
                this.#writeJson(res, 401, { error: "Unauthorized: RPC auth not configured", code });
                return { ok: false };
            }
        }
        // `user` is already normalized when a verifier ran; the public /
        // session-only paths may still carry a raw `req.user`, so normalize once
        // more here (idempotent — an object with a string `id` passes through).
        user = normalizePrincipalUser(user, { contextId: meta?.contextId });
        return { ok: true, user, ...this.#principalOf(user, session) };
    }

    async #loadItem(item) {
        const loadedFiles = [];

        for (const file of item.files) {
            try {
                const mod = await this.#loadModuleFile(file);
                loadedFiles.push({ file, module: mod });
                this._loadFailures.delete(file);
            } catch (e) {
                // Deduped per (file, message). This runs on EVERY RPC to the
                // item, and #loadItem is reached before the auth gate — so one
                // unbuildable `.server.ts` plus a request loop was an
                // unauthenticated way to write unbounded stack traces to stdout,
                // where nothing rotates them. The first occurrence carries the
                // stack; repeats are a counted one-liner.
                const signature = `${file}::${e?.message}`;
                const seen = this._loadFailures.get(file);
                if (seen?.signature === signature) {
                    seen.count += 1;
                    if (seen.count % 100 === 0) {
                        this.rpcLog.warn(`server file still failing to load (${seen.count}x): ${file}`);
                    }
                } else {
                    this._loadFailures.set(file, { signature, count: 1 });
                    this.rpcLog.error({ file, stack: e?.stack }, `server file failed to load: ${e?.message}`);
                }
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
                        this.extLog.info(`${kind}:${id} registered`);
                    } else {
                        this.extLog.warn(`${kind}:${id} has register.server but no register() export`);
                    }
                } catch (e) {
                    this.extLog.error(`${kind}:${id} register failed`, e);
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

    /** The effective body cap for a method: its policy value, clamped by the ceiling. */
    #bodyLimitFor(policy) {
        const declared = Number(policy && policy.maxBodyBytes);
        const limit = Number.isFinite(declared) && declared > 0 ? declared : DEFAULT_MAX_BODY_BYTES;
        return Math.min(limit, ABSOLUTE_MAX_BODY_BYTES);
    }

    /**
     * Read and validate an RPC body.
     *
     * Two guarantees callers depend on:
     *  - It never returns anything but a PLAIN OBJECT. `JSON.parse` happily yields
     *    `null`, a number, a string or an array; `null` in particular used to reach
     *    `body.contextId` and throw a TypeError *before* any auth check, from an
     *    unauthenticated request. Rejecting rather than coercing to `{}` means no
     *    field read needs a guard and a later author cannot reintroduce the crash.
     *  - It stops reading at `maxBytes` instead of buffering the whole stream, so a
     *    policy that declares a limit actually gets one. This runs before the
     *    session/CSRF/verifier gate, so the cap is the only thing bounding an
     *    unauthenticated caller.
     */
    async #readJsonBody(req, maxBytes = DEFAULT_MAX_BODY_BYTES) {
        const chunks = [];
        let size = 0;
        // `destroyOnReturn: false` is load-bearing, not a style choice: the default
        // async iterator destroys the stream when the loop exits early, so throwing
        // the over-limit error below would tear the socket down anyway — exactly
        // the failure this code is written to avoid. Anything that is merely
        // async-iterable (a test double, a non-stream body source) is read as-is.
        const source = typeof req.iterator === "function"
            ? req.iterator({ destroyOnReturn: false })
            : req;
        for await (const chunk of source) {
            size += chunk.length;
            if (size > maxBytes) {
                // Deliberately NOT `req.destroy()`. Destroying the request tears
                // down the socket, so the 413 this throw produces never reaches
                // the caller: directly it looks like a reset, and behind a
                // reverse proxy the gateway substitutes its own 502. A declared
                // `maxBodyBytes` then surfaces as an unexplainable Bad Gateway
                // instead of the limit it is. Discard the rest instead — bounded,
                // so a hostile sender cannot hold the socket by trickling.
                drainAbandonedBody(req);
                throw new RpcBodyError(
                    `Request body exceeds the ${maxBytes} byte limit for this method.`,
                    "RPC_BODY_TOO_LARGE",
                    413
                );
            }
            chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw) return {};

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            throw new RpcBodyError("Malformed JSON body.", "RPC_BAD_JSON");
        }
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new RpcBodyError("RPC body must be a JSON object.", "RPC_BAD_JSON");
        }
        return parsed;
    }

    /**
     * The single place an RPC failure becomes a wire payload — buffered and
     * streaming both go through it, so the disclosure rules cannot drift apart.
     *
     * Two rules:
     *   - `code` is forwarded when the thrower set a stable, enum-shaped one
     *     (UPSTREAM_UNREACHABLE, SSRF_BLOCKED, …), so a client can branch on the
     *     failure class instead of string-matching a message. Anything else
     *     stays RPC_INTERNAL_ERROR.
     *   - the message is `publicMessage` when the error offers one and the
     *     deployment is not in dev mode. A detailed `message` names the upstream
     *     URL / host — operator topology that has no business in a non-admin's
     *     UI. The full text always reaches the server log; only the client view
     *     narrows. Gating on the operator dev flag (never on request input) is
     *     the same rule as `log.sensitive` (§7 / server/LOGGING.md).
     */
    #rpcErrorPayload(error, aborted, timeoutMs) {
        if (aborted) return { error: `RPC timed out after ${timeoutMs}ms`, code: "RPC_TIMEOUT" };
        const rawCode = error && typeof error.code === "string" ? error.code : "";
        const publicMessage = error && typeof error.publicMessage === "string" ? error.publicMessage : "";
        return {
            error: (!this.devMode && publicMessage) || (error && error.message) || "RPC failed",
            code: /^[A-Z][A-Z0-9_]*$/.test(rawCode) ? rawCode : "RPC_INTERNAL_ERROR",
        };
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
    // Exported for tests: pure policy functions with no runtime state. Both
    // encode a rule that is easy to regress silently — a cluster-wide budget
    // quietly becoming per-process again, and an abort that stops being
    // enforced — so they are worth pinning directly.
    perProcessBudget,
    settleWithinAbortGrace,
    DEPLOYMENT_PROCESS_COUNT,
    RPC_ABORT_GRACE_MS,
};
