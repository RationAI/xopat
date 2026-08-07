"use strict";

/**
 * The server-side logging broker — `XOPAT_SERVER.log`.
 *
 * Server code must not `console.log` directly and must not invent a per-module
 * `XOPAT_<FEATURE>_DEBUG` env var. Both are how the server ended up with no level
 * control, no per-subsystem granularity, no redaction (a debug switch that dumped
 * whole LLM conversations — potentially PHI — to stdout) and no destination a
 * monitoring pipeline could ever read.
 *
 * The model:
 *
 *   channel ("module.<id>:sub:sub")  -> LEVEL  (longest-prefix match, else root)
 *   record                           -> SINKS  (console, bounded ring, durable store)
 *
 * Configuration lives in `core.server.logging` (the PUBLIC part of the server
 * config — it holds no secrets, so the viewer session may carry it). Everything
 * is operator-controlled: a request can never raise a level or unlock sensitive
 * payload logging, because that decision would then be attacker-supplied (§7).
 *
 * See `server/LOGGING.md`.
 */

const util = require("node:util");
const crypto = require("node:crypto");

const LEVELS = Object.freeze({ trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: 99 });
const LEVEL_NAMES = Object.freeze(Object.keys(LEVELS));
/** console.* methods captured into the `console` channel. `log` maps onto info. */
const CONSOLE_LEVELS = Object.freeze(["debug", "info", "log", "warn", "error"]);

const DEFAULT_BUFFER_ENTRIES = 10_000;
const DEFAULT_MAX_STRING = 8_000;
const DEFAULT_STORE_ENTRIES_PER_DAY = 50_000;
/** Breadth caps — a log record is a diagnostic, never a data export. */
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 50;
const MAX_DEPTH = 8;

const REDACT_KEY_RE = /(api[-_]?key|secret|token|password|passwd|authorization|auth[-_]?header|cookie|jwt|bearer|credential|private[-_]?key)/i;
const REDACTED = "[redacted]";

function normalizeLevel(value, fallback = null) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const name = String(value ?? "").trim().toLowerCase();
    if (name in LEVELS) return LEVELS[name];
    if (name === "off" || name === "none") return LEVELS.silent;
    if (name === "verbose") return LEVELS.trace;
    if (name === "warning") return LEVELS.warn;
    return fallback;
}

function levelName(value) {
    for (const name of LEVEL_NAMES) if (LEVELS[name] === value) return name;
    return "info";
}

/**
 * Redacting serializer. Runs in the formatter, not at call sites — a call site
 * that must remember to scrub is a call site that eventually forgets.
 */
function sanitize(value, opts, extraKeyRe, depth = 0) {
    // Back-compat call shape: sanitize(value, maxStringNumber, extraKeyRe)
    const o = typeof opts === "number" ? { maxString: opts } : (opts || {});
    const maxString = o.maxString || DEFAULT_MAX_STRING;
    const maxItems = o.maxItems || MAX_ARRAY_ITEMS;
    const maxDepth = o.maxDepth || MAX_DEPTH;
    if (value === null || value === undefined) return value;
    const type = typeof value;
    if (type === "number" || type === "boolean") return value;
    if (type === "bigint") return `${value}n`;
    if (type === "function") return `[Function ${value.name || "anonymous"}]`;
    if (type === "symbol") return String(value);
    if (type === "string") {
        return value.length <= maxString
            ? value
            : `${value.slice(0, maxString)}\n...[truncated ${value.length - maxString} chars]`;
    }
    if (value instanceof Error) {
        return {
            name: value.name,
            message: sanitize(value.message, o, extraKeyRe, depth + 1),
            code: value.code,
            // The cause is where the real reason lives for wrapped transport
            // failures — global fetch reports every connect error as the same
            // opaque "fetch failed" and hides ECONNREFUSED/EAI_AGAIN one level
            // down. Dropping it made those logs undiagnosable. Depth-bounded
            // like everything else, so a self-referential chain cannot run away.
            ...(value.cause !== undefined && depth < maxDepth
                ? { cause: sanitize(value.cause, o, extraKeyRe, depth + 1) }
                : {}),
            stack: sanitize(value.stack, o, extraKeyRe, depth + 1),
        };
    }
    if (depth >= maxDepth) return "[max depth]";
    if (Array.isArray(value)) {
        const items = value.slice(0, maxItems)
            .map(item => sanitize(item, o, extraKeyRe, depth + 1));
        if (value.length > maxItems) items.push(`...[${value.length - maxItems} more]`);
        return items;
    }
    if (Buffer.isBuffer(value)) return `[Buffer ${value.length}B]`;
    if (value instanceof Date) return value.toISOString();
    if (type === "object") {
        const out = {};
        let count = 0;
        const maxKeys = o.maxItems || MAX_OBJECT_KEYS;
        for (const [key, item] of Object.entries(value)) {
            if (count >= maxKeys) { out["..."] = "[truncated]"; break; }
            count++;
            if (REDACT_KEY_RE.test(key) || (extraKeyRe && extraKeyRe.test(key))) {
                out[key] = REDACTED;
                continue;
            }
            out[key] = sanitize(item, o, extraKeyRe, depth + 1);
        }
        return out;
    }
    return String(value);
}

/**
 * `pretty` = indented JSON for object arguments.
 *
 * Used for `sensitive` records, which exist to be READ by a human debugging a
 * conversation — `util.format`'s compact inspection turns a message list into an
 * unscannable wall. This is the shape the old per-feature debug dumps produced.
 */
function formatMessage(args, opts, extraKeyRe, pretty = false) {
    const sanitized = args.map(arg => sanitize(arg, opts, extraKeyRe));
    const maxString = (typeof opts === "number" ? opts : opts?.maxString) || DEFAULT_MAX_STRING;
    if (pretty) {
        return sanitized.map(arg => {
            if (typeof arg === "string") return arg;
            try { return JSON.stringify(arg, null, 2); } catch { return String(arg); }
        }).join(" ");
    }
    try {
        return util.formatWithOptions(
            { colors: false, depth: 5, maxArrayLength: MAX_ARRAY_ITEMS, maxStringLength: maxString, breakLength: 120, compact: 3 },
            ...sanitized
        );
    } catch {
        return sanitized.map(arg => {
            if (typeof arg === "string") return arg;
            try { return JSON.stringify(arg); } catch { return String(arg); }
        }).join(" ");
    }
}

/**
 * Bounded in-memory ring. Present in EVERY mode now (it used to be dev-only,
 * which is why production had no queryable log surface at all).
 *
 * `getEntries` keeps the cursor contract the dev console already polls with
 * (`afterId` / `limit` / `level` / `search`) and adds a `channel` filter.
 */
class LogRingBuffer {
    constructor(maxEntries = DEFAULT_BUFFER_ENTRIES) {
        this.maxEntries = Math.max(10, Number(maxEntries) || DEFAULT_BUFFER_ENTRIES);
        this.entries = [];
        this.nextId = 1;
        this.dropped = 0;
    }

    resize(maxEntries) {
        const next = Math.max(10, Number(maxEntries) || DEFAULT_BUFFER_ENTRIES);
        if (next === this.maxEntries) return;
        this.maxEntries = next;
        const overflow = this.entries.length - next;
        if (overflow > 0) {
            this.entries.splice(0, overflow);
            this.dropped += overflow;
        }
    }

    push(record) {
        const entry = { id: this.nextId++, ...record };
        this.entries.push(entry);
        const overflow = this.entries.length - this.maxEntries;
        if (overflow > 0) {
            this.entries.splice(0, overflow);
            this.dropped += overflow;
        }
        return entry;
    }

    getEntries(query = {}) {
        const afterId = Number.isFinite(Number(query.afterId)) ? Number(query.afterId) : 0;
        const limit = Math.min(500, Math.max(1, Number.isFinite(Number(query.limit)) ? Number(query.limit) : 200));
        const search = query.search ? String(query.search).toLowerCase() : "";
        const levels = normalizeFilterSet(query.level ?? query.levels);
        const channels = normalizeFilterSet(query.channel ?? query.channels);
        const minLevel = query.minLevel !== undefined ? normalizeLevel(query.minLevel, null) : null;

        let filtered = this.entries.filter(entry => entry.id > afterId);
        if (levels && levels.size) filtered = filtered.filter(entry => levels.has(entry.level));
        if (minLevel !== null) filtered = filtered.filter(entry => normalizeLevel(entry.level, 0) >= minLevel);
        if (channels && channels.size) {
            filtered = filtered.filter(entry => {
                const channel = String(entry.channel || "");
                for (const wanted of channels) {
                    if (channel === wanted || channel.startsWith(`${wanted}:`)) return true;
                }
                return false;
            });
        }
        if (search) {
            filtered = filtered.filter(entry =>
                String(entry.message || "").toLowerCase().includes(search) ||
                String(entry.channel || "").toLowerCase().includes(search) ||
                String(entry.source || "").toLowerCase().includes(search));
        }

        const hasMore = filtered.length > limit;
        const entries = hasMore ? filtered.slice(filtered.length - limit) : filtered;
        const nextAfterId = this.entries.length ? this.entries[this.entries.length - 1].id : afterId;

        return {
            entries,
            nextAfterId,
            hasMore,
            totalBuffered: this.entries.length,
            maxEntries: this.maxEntries,
            droppedFromBuffer: this.dropped,
        };
    }
}

function normalizeFilterSet(value) {
    if (value === undefined || value === null || value === "") return null;
    const values = Array.isArray(value) ? value : [value];
    const normalized = values
        .flatMap(item => String(item).split(","))
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
    return normalized.length ? new Set(normalized) : null;
}

/** Stable, non-reversible caller tag — a principal id must never land in a log file. */
function hashPrincipal(principal) {
    if (!principal) return undefined;
    return `p_${crypto.createHash("sha256").update(String(principal)).digest("hex").slice(0, 12)}`;
}

function normalizeChannel(channel) {
    const value = String(channel ?? "").trim().toLowerCase();
    if (!value) return "core";
    return value.replace(/[^a-z0-9._:@/-]+/g, "-").replace(/^:+|:+$/g, "") || "core";
}

/**
 * The broker.
 *
 * `getConfig()` is read lazily on every resolve, so an operator config reload
 * moves levels without a restart, while the resolved-level cache is invalidated
 * by config identity rather than on a timer.
 */
function createLogging({ getConfig, getStorage, devMode = false, baseConsole = console } = {}) {
    const readConfig = typeof getConfig === "function" ? getConfig : () => ({});
    const pid = process.pid;

    let configSnapshot = null;
    let resolved = null;                 // normalized config
    let levelCache = new Map();          // channel -> numeric level
    const overrides = new Map();         // dev-only runtime overrides
    const seenChannels = new Map();      // channel -> last-used level name
    let storeHandle = undefined;         // undefined = not resolved yet, null = unavailable
    let storeDropped = 0;
    let storeWrites = 0;
    const stats = { emitted: 0, suppressed: 0, sensitiveSuppressed: 0 };

    function resolveConfig() {
        const raw = readConfig() || {};
        if (raw === configSnapshot && resolved) return resolved;
        configSnapshot = raw;

        const sinks = raw.sinks && typeof raw.sinks === "object" ? raw.sinks : {};
        const redact = raw.redact && typeof raw.redact === "object" ? raw.redact : {};
        const extraKeys = Array.isArray(redact.extraKeys)
            ? redact.extraKeys.map(k => String(k)).filter(Boolean) : [];

        const channels = new Map();
        if (raw.channels && typeof raw.channels === "object") {
            for (const [key, value] of Object.entries(raw.channels)) {
                const level = normalizeLevel(value, null);
                if (level !== null) channels.set(normalizeChannel(key), level);
            }
        }

        let consoleMode = sinks.console;
        if (consoleMode === undefined || consoleMode === null) consoleMode = devMode ? "pretty" : "json";
        else if (consoleMode === true) consoleMode = devMode ? "pretty" : "json";
        else if (consoleMode === false) consoleMode = false;
        else consoleMode = String(consoleMode).toLowerCase() === "pretty" ? "pretty" : "json";

        const store = sinks.store === true ? {} : (sinks.store && typeof sinks.store === "object" ? sinks.store : null);

        resolved = {
            level: normalizeLevel(raw.level, devMode ? LEVELS.debug : LEVELS.info),
            channels,
            console: consoleMode,
            buffer: sinks.buffer === false ? 0 : Math.max(0, Number(sinks.buffer) || DEFAULT_BUFFER_ENTRIES),
            store: store && {
                minLevel: normalizeLevel(store.minLevel, LEVELS.info),
                maxEntriesPerDay: Math.max(100, Number(store.maxEntriesPerDay) || DEFAULT_STORE_ENTRIES_PER_DAY),
                namespace: typeof store.namespace === "string" && store.namespace ? store.namespace : "logs",
            },
            // Serialization caps. Raising these is how you get a full conversation
            // dump out of a `sensitive` record instead of a truncated one.
            redact: {
                maxString: Math.max(200, Number(redact.maxStringLength) || DEFAULT_MAX_STRING),
                maxItems: Math.max(5, Number(redact.maxItems) || MAX_ARRAY_ITEMS),
                maxDepth: Math.max(2, Number(redact.maxDepth) || MAX_DEPTH),
            },
            extraKeyRe: extraKeys.length ? new RegExp(extraKeys.join("|"), "i") : null,
            // Full prompts / tool payloads / request bodies. OPERATOR-only, and
            // never on by default outside dev — this is the switch that used to be
            // a bare env var dumping conversation content into stdout.
            allowSensitive: raw.allowSensitive === undefined || raw.allowSensitive === null
                ? devMode === true
                : raw.allowSensitive === true,
            access: raw.access && typeof raw.access === "object" ? raw.access : {},
        };
        levelCache = new Map();
        if (ring) ring.resize(resolved.buffer || DEFAULT_BUFFER_ENTRIES);
        // A store rebind must be picked up; the handle is re-resolved lazily.
        storeHandle = undefined;
        return resolved;
    }

    const ring = new LogRingBuffer(DEFAULT_BUFFER_ENTRIES);

    /** Longest-prefix match over the `:`-separated channel hierarchy. */
    function levelFor(channel) {
        const override = overrides.get(channel);
        if (override !== undefined) return override;
        // Resolve FIRST: a config swap invalidates the cache, and consulting the
        // cache before that check is how a level change silently failed to apply.
        const cfg = resolveConfig();
        const cached = levelCache.get(channel);
        if (cached !== undefined) return cached;

        let current = channel;
        let level = null;
        while (current) {
            if (cfg.channels.has(current)) { level = cfg.channels.get(current); break; }
            const cut = current.lastIndexOf(":");
            if (cut < 0) break;
            current = current.slice(0, cut);
        }
        if (level === null) level = cfg.level;
        levelCache.set(channel, level);
        return level;
    }

    function storeFor(cfg) {
        if (storeHandle !== undefined) return storeHandle;
        if (!cfg.store) { storeHandle = null; return null; }
        try {
            const storage = typeof getStorage === "function" ? getStorage() : null;
            // The broker may not exist yet at boot. Do NOT cache that as "no
            // store" — leave it unresolved so the next record retries, or every
            // record after the first would silently skip the sink.
            if (!storage?.log) return null;
            storeHandle = storage.log("core", cfg.store.namespace, {
                maxEntries: cfg.store.maxEntriesPerDay,
                defaultBindings: ["file"],
            });
        } catch (e) {
            storeHandle = null;
            baseConsole.warn?.(`[logging] store sink unavailable: ${e?.message || e}`);
        }
        return storeHandle;
    }

    /**
     * Serializes store appends. Records are written fire-and-forget, so without a
     * chain concurrent appends land out of order — a log whose lines are shuffled
     * is not a log. One chain per day-key, dropped when it settles.
     */
    const storeChains = new Map();

    function appendSerialized(handle, key, record, cfg) {
        const previous = storeChains.get(key) || Promise.resolve();
        const next = previous
            .then(() => handle.append(key, record))
            .then(length => {
                if (length > cfg.store.maxEntriesPerDay * 1.1) return handle.trim(key, cfg.store.maxEntriesPerDay);
                storeWrites++;
                return undefined;
            })
            .catch(() => { storeDropped++; });
        storeChains.set(key, next);
        next.finally(() => { if (storeChains.get(key) === next) storeChains.delete(key); });
        return next;
    }

    function writeConsole(cfg, record) {
        if (!cfg.console) return;
        const method = record.level === "error" ? "error"
            : record.level === "warn" ? "warn"
            : record.level === "debug" || record.level === "trace" ? "debug" : "log";
        const target = originalConsole[method] || originalConsole.log;
        if (cfg.console === "json") {
            try { target(JSON.stringify(record)); return; } catch { /* fall through to pretty */ }
        }
        const parts = [`${record.ts} ${record.level.toUpperCase().padEnd(5)} [${record.channel}]`, record.message];
        if (record.fields) {
            try { parts.push(JSON.stringify(record.fields)); } catch { /* unserializable fields are dropped from the pretty line only */ }
        }
        if (record.requestId) parts.push(`(req ${record.requestId})`);
        target(parts.join(" "));
    }

    function writeStore(cfg, record) {
        const handle = storeFor(cfg);
        if (!handle) return;
        if (normalizeLevel(record.level, 0) < cfg.store.minLevel) return;
        const key = record.ts.slice(0, 10); // UTC day
        // Fire-and-forget: a log sink must never apply backpressure to a request.
        appendSerialized(handle, key, record, cfg);
    }

    function emit(channel, level, sensitive, args, bound) {
        const threshold = levelFor(channel);
        const numeric = LEVELS[level];
        seenChannels.set(channel, levelName(threshold));
        if (numeric < threshold || threshold >= LEVELS.silent) {
            stats.suppressed++;
            return null;
        }

        const cfg = resolveConfig();
        // Sensitive payloads need BOTH an operator opt-in and a trace-level channel.
        if (sensitive && (!cfg.allowSensitive || threshold > LEVELS.trace)) {
            stats.sensitiveSuppressed++;
            return null;
        }

        let fields;
        let messageArgs = args;
        if (args.length && args[0] && typeof args[0] === "object" && !Array.isArray(args[0]) && !(args[0] instanceof Error)) {
            const { sensitive: _s, ...rest } = args[0];
            if (Object.keys(rest).length) fields = sanitize(rest, cfg.redact, cfg.extraKeyRe);
            messageArgs = args.slice(1);
        }

        const record = {
            ts: new Date().toISOString(),
            level,
            channel,
            message: formatMessage(messageArgs, cfg.redact, cfg.extraKeyRe, sensitive),
            pid,
        };
        if (fields) record.fields = fields;
        if (bound?.requestId) record.requestId = bound.requestId;
        if (bound?.principal) record.principal = bound.principal;
        if (bound?.source) record.source = bound.source;
        if (sensitive) record.sensitive = true;

        stats.emitted++;
        const entry = cfg.buffer ? ring.push(record) : record;
        writeConsole(cfg, entry);
        if (cfg.store) writeStore(cfg, entry);
        return entry;
    }

    function makeLogger(channel, bound = {}) {
        const name = normalizeChannel(channel);
        const logger = {
            channel: name,
            /** A sub-channel: `log('a').child('b')` logs on `a:b`. */
            child: (sub, extraBound) => makeLogger(sub ? `${name}:${normalizeChannel(sub)}` : name, { ...bound, ...(extraBound || {}) }),
            /** Same channel, extra bound fields (requestId, principal). */
            with: (extraBound) => makeLogger(name, { ...bound, ...(extraBound || {}) }),
            isEnabled: (level) => normalizeLevel(level, LEVELS.info) >= levelFor(name),
            level: () => levelName(levelFor(name)),
            /**
             * Timing helper — the point of "computational logs". Returns a stop
             * function emitting `durationMs` at `level` (debug by default).
             *
             *   const done = log.time("tile-decode");
             *   ... ; done({ tiles: 12 });
             */
            time: (label, level = "debug") => {
                const started = process.hrtime.bigint();
                return (extraFields) => {
                    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
                    return logger[level]({ ...(extraFields || {}), durationMs: Math.round(durationMs * 100) / 100 }, label);
                };
            },
            /**
             * Payload-bearing record (prompts, request bodies, tool arguments).
             * Emitted ONLY when the channel is at trace AND the operator set
             * `logging.allowSensitive`. Use it instead of a bespoke debug flag.
             */
            sensitive: (...args) => emit(name, "trace", true, args, bound),
        };
        for (const level of ["trace", "debug", "info", "warn", "error"]) {
            logger[level] = (...args) => emit(name, level, false, args, bound);
        }
        // Console-shaped aliases so a logger can stand in for `console` where core
        // code (and the storage broker) calls `logger.log?.(...)`.
        logger.log = logger.info;
        return logger;
    }

    const originalConsole = Object.create(null);
    let consoleCaptured = false;

    /**
     * Route stray `console.*` into the `console` channel so nothing that exists
     * today is lost, while still reaching the ring and the store.
     */
    function installConsoleCapture(targetConsole = baseConsole, options = {}) {
        if (consoleCaptured) return targetConsole;
        consoleCaptured = true;
        for (const level of CONSOLE_LEVELS) {
            originalConsole[level] = typeof targetConsole[level] === "function"
                ? targetConsole[level].bind(targetConsole)
                : (...args) => process.stdout.write(`${args.join(" ")}\n`);
        }
        const source = options.source || "console";
        for (const level of CONSOLE_LEVELS) {
            const mapped = level === "log" ? "info" : level;
            targetConsole[level] = (...args) => {
                // The console sink writes through `originalConsole`, so this cannot recurse.
                emit("console", mapped, false, args, { source });
            };
        }
        return targetConsole;
    }

    // Until capture is installed, the console sink writes through the raw console.
    for (const level of CONSOLE_LEVELS) {
        originalConsole[level] = typeof baseConsole[level] === "function"
            ? baseConsole[level].bind(baseConsole)
            : (...args) => process.stdout.write(`${args.join(" ")}\n`);
    }

    const api = {
        LEVELS,
        LEVEL_NAMES,
        ring,
        /** A logger for a channel. `log("module.foo:bar")`. */
        log: (channel) => makeLogger(channel),
        /**
         * A logger pre-scoped to an RPC/server-route ctx: channel
         * `<kind>.<itemId>[:<method>]`, with the request id and the HASHED
         * principal bound. Handed to modules as `ctx.log`.
         */
        forCtx: (ctx, sub) => {
            const kind = ctx?.kind, id = ctx?.itemId;
            let channel = kind && id ? `${kind}.${id}` : "core";
            if (sub) channel += `:${sub}`;
            else if (ctx?.method) channel += `:${ctx.method}`;
            let principal;
            try {
                principal = hashPrincipal(ctx?.principal
                    || (ctx?.user?.id && `user:${ctx.user.id}`)
                    || (ctx?.session?.id && `sess:${ctx.session.id}`));
            } catch { /* identity is optional for logging */ }
            return makeLogger(channel, { requestId: ctx?.requestId, principal });
        },
        hashPrincipal,
        installConsoleCapture,
        /** Effective level of a channel (respecting runtime overrides). */
        levelOf: (channel) => levelName(levelFor(normalizeChannel(channel))),
        /**
         * Ephemeral runtime override — dev tooling only, never persisted. Pass
         * `null` to clear.
         */
        setLevelOverride(channel, level) {
            const name = normalizeChannel(channel);
            if (level === null || level === undefined || level === "") {
                overrides.delete(name);
                return { channel: name, level: levelName(levelFor(name)), override: null };
            }
            const numeric = normalizeLevel(level, null);
            if (numeric === null) throw new Error(`Unknown log level '${level}'. Use one of: ${LEVEL_NAMES.join(", ")}.`);
            overrides.set(name, numeric);
            return { channel: name, level: levelName(numeric), override: levelName(numeric) };
        },
        clearLevelOverrides() { overrides.clear(); },
        /** Channels that have emitted (or been suppressed) since boot + their level. */
        channels() {
            const cfg = resolveConfig();
            const out = [];
            const names = new Set([...seenChannels.keys(), ...cfg.channels.keys(), ...overrides.keys()]);
            for (const name of [...names].sort()) {
                out.push({
                    channel: name,
                    level: levelName(levelFor(name)),
                    configured: cfg.channels.has(name) ? levelName(cfg.channels.get(name)) : null,
                    override: overrides.has(name) ? levelName(overrides.get(name)) : null,
                });
            }
            return out;
        },
        stats() {
            const cfg = resolveConfig();
            return {
                pid,
                devMode,
                rootLevel: levelName(cfg.level),
                allowSensitive: cfg.allowSensitive,
                sinks: {
                    console: cfg.console,
                    buffer: { maxEntries: ring.maxEntries, buffered: ring.entries.length, dropped: ring.dropped },
                    store: cfg.store
                        ? { ...cfg.store, minLevel: levelName(cfg.store.minLevel), bound: !!storeFor(cfg), writes: storeWrites, dropped: storeDropped }
                        : false,
                },
                counters: { ...stats },
            };
        },
        /**
         * Is this caller allowed to READ buffered logs in production?
         * Degrade-closed: an empty allowlist means dev-only, as before. Matching is
         * done here (server-side) against the verified principal — never against
         * anything the request body carries.
         */
        canRead(ctx) {
            const cfg = resolveConfig();
            const access = cfg.access || {};
            const principals = Array.isArray(access.principals) ? access.principals.map(String) : [];
            const claims = access.claims && typeof access.claims === "object" ? access.claims : {};
            if (!principals.length && !Object.keys(claims).length) return false;

            const principal = typeof ctx?.principal === "string" ? ctx.principal
                : (ctx?.user?.id ? `user:${ctx.user.id}` : null);
            if (principal && principals.includes(principal)) return true;
            if (principal && ctx?.user?.id && principals.includes(String(ctx.user.id))) return true;

            for (const [claim, expected] of Object.entries(claims)) {
                const actual = ctx?.user?.[claim];
                const wanted = Array.isArray(expected) ? expected.map(String) : [String(expected)];
                if (actual === undefined || actual === null) continue;
                const actualList = Array.isArray(actual) ? actual.map(String) : [String(actual)];
                if (actualList.some(v => wanted.includes(v))) return true;
            }
            return false;
        },
        getEntries: (query) => ring.getEntries(query),
    };
    return api;
}

/**
 * `installGlobalServerHelpers` runs on EVERY lazy server-module load, so the
 * broker — like the storage broker — is created once and parked on a global.
 * Otherwise each module import would reset the ring and re-install capture.
 */
const SINGLETON_KEY = "__XOPAT_SERVER_LOGGING__";
const CONFIG_KEY = "__XOPAT_LOGGING_CONFIG__";

/** Publish `core.server.logging`. Safe to call repeatedly (config reload). */
function setLoggingConfig(config) {
    globalThis[CONFIG_KEY] = config && typeof config === "object" ? config : {};
}

function getLoggingConfig() {
    return globalThis[CONFIG_KEY] || {};
}

function getServerLogging(options) {
    const existing = globalThis[SINGLETON_KEY];
    if (existing) return existing;
    if (!options) return null;
    const created = createLogging({
        getConfig: getLoggingConfig,
        getStorage: options.getStorage,
        devMode: options.devMode === true,
        baseConsole: options.baseConsole || console,
    });
    globalThis[SINGLETON_KEY] = created;
    return created;
}

module.exports = {
    LEVELS,
    LEVEL_NAMES,
    LogRingBuffer,
    createLogging,
    getServerLogging,
    setLoggingConfig,
    getLoggingConfig,
    normalizeLevel,
    levelName,
    sanitize,
};
