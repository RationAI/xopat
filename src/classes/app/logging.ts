/**
 * The client-side logging broker — `APPLICATION_CONTEXT.log`.
 *
 * The server half of this (`server/node/logging.js`, `server/LOGGING.md`) has had
 * channels, per-channel levels, redaction and real sinks for a while. The client
 * had one thing: a bootstrap hook in `server/templates/index.html` that pushed
 * every `console.error`/`warn` argument into an **unbounded** `console.appTrace`
 * array of interleaved strings, read exactly once by the crash-export page. No
 * levels, no channels, no configuration, no bound — and no way for anything that
 * happened in the browser to reach the monitoring an operator actually watches.
 *
 * This is the same model as the server, deliberately:
 *
 *   channel ("module.<id>:sub")  -> LEVEL   (longest-prefix match, else root)
 *   record                       -> SINKS   (console, bounded ring, forwarder)
 *
 * Two rules carry over unchanged, and they are the reason this is not just a
 * nicer `console.log`:
 *
 * - **Configuration is operator-controlled** (`env.client.logging`), never
 *   `getOption`. A session bundle, a URL parameter or an embedding third-party
 *   app must not be able to switch payload logging on or aim the forwarder
 *   somewhere (AGENTS.md §7) — that config arrives from the deployment.
 * - **`sensitive()` is for payloads** (prompts, message bodies, script results)
 *   and is emitted only when the operator allowed it AND the channel is at
 *   `trace`. On real data those records are PHI.
 *
 * See `src/LOGGING.md`.
 */

/** Same ladder, same names, same numbers as the server broker. */
export const LOG_LEVELS = {
    trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: 99,
} as const;

export type LogLevelName = keyof typeof LOG_LEVELS;

/** Records kept in the browser when the deployment says nothing. */
const DEFAULT_RING_ENTRIES = 2_000;
const DEFAULT_FORWARD_BATCH = 50;
const DEFAULT_FORWARD_INTERVAL_MS = 5_000;
const DEFAULT_FORWARD_QUEUE = 1_000;
/** Strings longer than this are cut before a record is kept or sent. */
const DEFAULT_MAX_STRING = 8_000;

/** One emitted record. Shape mirrors the server's so both ends read alike. */
export interface ClientLogRecord {
    id: number;
    ts: string;
    level: LogLevelName;
    channel: string;
    message: string;
    fields?: Record<string, any>;
    sensitive?: boolean;
}

export interface ClientLogger {
    readonly channel: string;
    trace(...args: any[]): ClientLogRecord | null;
    debug(...args: any[]): ClientLogRecord | null;
    info(...args: any[]): ClientLogRecord | null;
    warn(...args: any[]): ClientLogRecord | null;
    error(...args: any[]): ClientLogRecord | null;
    /** Payload-bearing record. Operator opt-in + channel at trace, or nothing. */
    sensitive(...args: any[]): ClientLogRecord | null;
    /** Timing helper: returns a stop function that emits `durationMs`. */
    time(label: string, level?: LogLevelName): (fields?: Record<string, any>) => ClientLogRecord | null;
    child(sub: string): ClientLogger;
    isEnabled(level: LogLevelName): boolean;
    level(): LogLevelName;
}

function levelNumber(value: unknown, fallback: number | null = null): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const found = (LOG_LEVELS as Record<string, number>)[value.trim().toLowerCase()];
        if (typeof found === "number") return found;
    }
    return fallback;
}

function levelNameOf(value: number): LogLevelName {
    let best: LogLevelName = "trace";
    for (const [name, numeric] of Object.entries(LOG_LEVELS)) {
        if (value >= numeric) best = name as LogLevelName;
    }
    return best;
}

/** `Module.Foo:Bar ` → `module.foo:bar`. Channel identity must not depend on casing. */
function normalizeChannel(channel: unknown): string {
    return String(channel ?? "app").trim().toLowerCase().replace(/\s+/g, "-") || "app";
}

/**
 * A record is a diagnostic, never a data export.
 *
 * Unlike the server there is no second formatter downstream to clean up after a
 * careless call site, so breadth, depth and string length are capped here. Secret
 * REDACTION is deliberately not duplicated: the server redacts every forwarded
 * record on its way through `emit`, and a second, drifting copy of that key list
 * is how one of them ends up wrong.
 */
function shrink(value: any, maxString: number, depth = 0): any {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return value.length > maxString ? `${value.slice(0, maxString)}…[+${value.length - maxString}]` : value;
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (value instanceof Error) return { name: value.name, message: value.message, stack: shrink(value.stack, maxString, depth) };
    if (depth >= 6) return "[depth]";
    if (Array.isArray(value)) return value.slice(0, 50).map(item => shrink(item, maxString, depth + 1));
    if (typeof value === "object") {
        const out: Record<string, any> = {};
        for (const [key, item] of Object.entries(value).slice(0, 50)) out[key] = shrink(item, maxString, depth + 1);
        return out;
    }
    // Functions, symbols: named, never invoked or serialized.
    return `[${typeof value}]`;
}

function formatMessage(args: any[], maxString: number): string {
    return args.map(arg => {
        // Strings go through `shrink` too, so an over-long one is cut with the
        // marker that says how much it lost. A bare `slice` at the end would
        // silently truncate the most common case of all — a long message string.
        if (typeof arg === "string") return shrink(arg, maxString);
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
        try { return JSON.stringify(shrink(arg, maxString)); } catch { return String(arg); }
    }).join(" ");
}

/** Bounded FIFO of records. What the crash export reads, and what forwarding drains. */
class ClientLogRing {
    entries: ClientLogRecord[] = [];
    dropped = 0;

    constructor(public maxEntries: number) {}

    push(record: ClientLogRecord): ClientLogRecord {
        this.entries.push(record);
        const overflow = this.entries.length - this.maxEntries;
        if (overflow > 0) {
            this.entries.splice(0, overflow);
            this.dropped += overflow;
        }
        return record;
    }

    resize(maxEntries: number): void {
        this.maxEntries = Math.max(50, maxEntries);
        const overflow = this.entries.length - this.maxEntries;
        if (overflow > 0) {
            this.entries.splice(0, overflow);
            this.dropped += overflow;
        }
    }
}

interface ResolvedClientLogConfig {
    level: number;
    channels: Map<string, number>;
    console: boolean;
    ring: number;
    maxString: number;
    allowSensitive: boolean;
    forward: {
        enabled: boolean;
        minLevel: number;
        includeSensitive: boolean;
        batchSize: number;
        intervalMs: number;
        queueLimit: number;
    };
}

/**
 * The broker. One per application context; `APPLICATION_CONTEXT.log` IS this
 * object's `log()` bound method, so call sites read the same as the server's
 * (`APPLICATION_CONTEXT.log("module.x").warn(...)`).
 */
export class ClientLogging {
    private _ring: ClientLogRing;
    private _config: ResolvedClientLogConfig;
    private _levelCache = new Map<string, number>();
    private _nextId = 1;
    private _queue: ClientLogRecord[] = [];
    private _timer: any = null;
    private _flushing = false;
    private _originalConsole: Record<string, (...args: any[]) => void> = {};
    private _consoleAdopted = false;
    private _stats = { emitted: 0, suppressed: 0, sensitiveSuppressed: 0, forwarded: 0, forwardDropped: 0, forwardFailures: 0 };
    /** Injectable so the forwarder can be tested without a server or a browser. */
    private _transport: ((records: ClientLogRecord[], sessionId?: string) => Promise<any>) | null = null;

    /**
     * This browser sitting, named.
     *
     * Not an identity and not a login: a random token minted at boot, so every
     * record from one page-load groups together. It is what makes a pilot session
     * reconstructible without putting a participant's name in a log file — the
     * server pairs it with the hashed principal it already knows, and whoever ran
     * the pilot maps that to a person from their own participant list.
     *
     * A new page load is a new sitting, deliberately: that is what it is.
     */
    readonly sessionId: string;

    constructor(rawConfig?: any, options?: { transport?: (records: ClientLogRecord[]) => Promise<any>; sessionId?: string }) {
        this._config = ClientLogging.resolveConfig(rawConfig);
        this._ring = new ClientLogRing(this._config.ring);
        if (options?.transport) this._transport = options.transport;
        this.sessionId = options?.sessionId || ClientLogging.newSessionId();
    }

    /** `cs_<random>` — a correlation token, never derived from anything about the user. */
    static newSessionId(): string {
        const random = (globalThis as any).crypto?.randomUUID?.()
            ?? `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
        return `cs_${String(random).replace(/-/g, '').slice(0, 24)}`;
    }

    /**
     * `env.client.logging` → the resolved policy.
     *
     * Everything is optional and everything degrades to "quiet but useful":
     * warnings and errors in the console and the ring, nothing forwarded. A
     * deployment that never heard of this block behaves as it always did.
     */
    static resolveConfig(raw: any): ResolvedClientLogConfig {
        const config = raw && typeof raw === "object" ? raw : {};
        const channels = new Map<string, number>();
        // The session timeline is on by default while the root level is not.
        //
        // It is about a dozen content-free records per sitting — boot, which
        // slides opened, auth, end — and it is what makes every OTHER record
        // interpretable: a warning with no idea which slide was open or whether
        // the viewer even finished loading is a warning you cannot act on. An
        // explicit `channels.session` below overrides this, including to silence.
        channels.set("session", LOG_LEVELS.info);
        if (config.channels && typeof config.channels === "object") {
            for (const [key, value] of Object.entries(config.channels)) {
                const numeric = levelNumber(value, null);
                if (numeric !== null) channels.set(normalizeChannel(key), numeric);
            }
        }
        const forward = config.forward && typeof config.forward === "object" ? config.forward : {};
        return {
            level: levelNumber(config.level, LOG_LEVELS.warn) as number,
            channels,
            console: config.console !== false,
            ring: Math.max(50, Number(config.ring) || DEFAULT_RING_ENTRIES),
            maxString: Math.max(200, Number(config.maxStringLength) || DEFAULT_MAX_STRING),
            // Never true by default, and never read from anything session-scoped.
            allowSensitive: config.allowSensitive === true,
            forward: {
                enabled: forward.enabled === true,
                minLevel: levelNumber(forward.minLevel, LOG_LEVELS.warn) as number,
                // Sending payloads to the server is a second decision beyond
                // recording them locally, exactly as it is server-side.
                includeSensitive: forward.includeSensitive === true,
                batchSize: Math.max(1, Number(forward.batchSize) || DEFAULT_FORWARD_BATCH),
                intervalMs: Math.max(500, Number(forward.intervalMs) || DEFAULT_FORWARD_INTERVAL_MS),
                queueLimit: Math.max(10, Number(forward.queueLimit) || DEFAULT_FORWARD_QUEUE),
            },
        };
    }

    /** Re-read the deployment config (used when ENV lands after construction). */
    configure(rawConfig: any): void {
        this._config = ClientLogging.resolveConfig(rawConfig);
        this._levelCache.clear();
        this._ring.resize(this._config.ring);
    }

    /** Longest-prefix match over the `:`-separated channel hierarchy. */
    levelFor(channel: string): number {
        const cached = this._levelCache.get(channel);
        if (cached !== undefined) return cached;
        let current = channel;
        let level: number | null = null;
        while (current) {
            if (this._config.channels.has(current)) { level = this._config.channels.get(current)!; break; }
            const cut = current.lastIndexOf(":");
            if (cut < 0) break;
            current = current.slice(0, cut);
        }
        if (level === null) level = this._config.level;
        this._levelCache.set(channel, level);
        return level;
    }

    log(channel: string): ClientLogger {
        const name = normalizeChannel(channel);
        const emit = (level: LogLevelName, sensitive: boolean, args: any[]) => this._emit(name, level, sensitive, args);
        const logger: ClientLogger = {
            channel: name,
            trace: (...args: any[]) => emit("trace", false, args),
            debug: (...args: any[]) => emit("debug", false, args),
            info: (...args: any[]) => emit("info", false, args),
            warn: (...args: any[]) => emit("warn", false, args),
            error: (...args: any[]) => emit("error", false, args),
            sensitive: (...args: any[]) => emit("trace", true, args),
            time: (label: string, level: LogLevelName = "debug") => {
                const started = performance.now();
                return (fields?: Record<string, any>) => emit(level, false, [
                    { ...(fields || {}), durationMs: Math.round((performance.now() - started) * 100) / 100 },
                    label,
                ]);
            },
            child: (sub: string) => this.log(sub ? `${name}:${normalizeChannel(sub)}` : name),
            isEnabled: (level: LogLevelName) => (levelNumber(level, LOG_LEVELS.info) as number) >= this.levelFor(name),
            level: () => levelNameOf(this.levelFor(name)),
        };
        return logger;
    }

    private _emit(channel: string, level: LogLevelName, sensitive: boolean, args: any[]): ClientLogRecord | null {
        const threshold = this.levelFor(channel);
        if (LOG_LEVELS[level] < threshold || threshold >= LOG_LEVELS.silent) {
            this._stats.suppressed++;
            return null;
        }
        if (sensitive && (!this._config.allowSensitive || threshold > LOG_LEVELS.trace)) {
            this._stats.sensitiveSuppressed++;
            return null;
        }

        // A leading plain object is structured fields, everything after it is the
        // message — the same call convention the server logger uses, so a snippet
        // moves between the two without rewriting.
        let fields: Record<string, any> | undefined;
        let messageArgs = args;
        const [first] = args;
        if (first && typeof first === "object" && !Array.isArray(first) && !(first instanceof Error)) {
            fields = shrink(first, this._config.maxString);
            messageArgs = args.slice(1);
        }

        const record: ClientLogRecord = {
            id: this._nextId++,
            ts: new Date().toISOString(),
            level,
            channel,
            message: formatMessage(messageArgs, this._config.maxString),
            ...(fields ? { fields } : {}),
            ...(sensitive ? { sensitive: true } : {}),
        };

        this._stats.emitted++;
        this._ring.push(record);
        this._writeConsole(record);
        this._enqueueForward(record);
        return record;
    }

    private _writeConsole(record: ClientLogRecord): void {
        if (!this._config.console) return;
        const method = record.level === "error" ? "error"
            : record.level === "warn" ? "warn"
                : record.level === "trace" || record.level === "debug" ? "debug" : "log";
        const target = this._originalConsole[method] || (console as any)[method] || console.log;
        const parts: any[] = [`${record.level.toUpperCase().padEnd(5)} [${record.channel}]`, record.message];
        if (record.fields) parts.push(record.fields);
        try { target.apply(console, parts); } catch { /* a broken console must not break the app */ }
    }

    // ---- forwarding -------------------------------------------------------

    private _enqueueForward(record: ClientLogRecord): void {
        const forward = this._config.forward;
        if (!forward.enabled) return;
        if ((levelNumber(record.level, 0) as number) < forward.minLevel) return;
        if (record.sensitive && !forward.includeSensitive) return;

        this._queue.push(record);
        const overflow = this._queue.length - forward.queueLimit;
        if (overflow > 0) {
            // Drop the OLDEST: when the queue is backing up, the newest records
            // are the ones describing why.
            this._queue.splice(0, overflow);
            this._stats.forwardDropped += overflow;
        }
        if (this._queue.length >= forward.batchSize) { void this.flush(); return; }
        if (!this._timer) {
            this._timer = setTimeout(() => { this._timer = null; void this.flush(); }, forward.intervalMs);
        }
    }

    /**
     * Send what is queued.
     *
     * Serialized, and failure-tolerant in one direction only: a batch that could
     * not be delivered is DROPPED, not retried. A logging forwarder that retries
     * turns a server hiccup into a growing client-side queue, and the records
     * that matter most are usually the ones still arriving.
     */
    async flush(): Promise<void> {
        if (this._flushing || !this._queue.length) return;
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        const batch = this._queue;
        this._queue = [];
        this._flushing = true;
        try {
            const transport = this._transport || ClientLogging._defaultTransport;
            // Sent once per batch, not stamped on every record: it is constant for
            // the page-load, and the server re-attaches it to each record anyway.
            await transport(batch, this.sessionId);
            this._stats.forwarded += batch.length;
        } catch (e) {
            this._stats.forwardFailures++;
            this._stats.forwardDropped += batch.length;
        } finally {
            this._flushing = false;
            if (this._queue.length >= this._config.forward.batchSize) void this.flush();
        }
    }

    /**
     * Default transport: the generated RPC client, which is HttpClient-backed
     * (so it carries session/CSRF and honours the background lane) rather than a
     * bare `fetch` (AGENTS.md §0.3).
     */
    private static _defaultTransport(records: ClientLogRecord[], sessionId?: string): Promise<any> {
        const rpc = (globalThis as any).xserver?.server?.core;
        if (!rpc?.ingestClientLogs) return Promise.reject(new Error("Server RPC is unavailable."));
        return rpc.ingestClientLogs({ records, sessionId }, { priority: "background" });
    }

    // ---- console adoption -------------------------------------------------

    /**
     * Take over the bootstrap console hook installed in `index.html`.
     *
     * That hook exists because errors happen before any bundle is parsed, and it
     * is the only capture that can. What it must not do is keep growing for the
     * life of the session, or stay a separate mechanism once a real broker
     * exists — so this drains what it captured, routes `console.*` into the
     * `console` channel, and re-points `console.appTrace` at a BOUNDED view for
     * the crash-export page, which keeps reading it unchanged.
     */
    adoptConsole(target: any = console): void {
        if (this._consoleAdopted) return;
        this._consoleAdopted = true;

        const existing = Array.isArray(target.appTrace) ? target.appTrace.slice() : [];
        for (const level of ["debug", "info", "log", "warn", "error"] as const) {
            this._originalConsole[level] = typeof target[level] === "function"
                ? target[level].bind(target)
                : (...args: any[]) => {};
        }
        if (existing.length) {
            this._emit("console", "info", false, [`[pre-boot] ${existing.join(" ").trim()}`]);
        }

        for (const level of ["debug", "info", "log", "warn", "error"] as const) {
            const mapped: LogLevelName = level === "log" ? "info" : (level as LogLevelName);
            target[level] = (...args: any[]) => { this._emit("console", mapped, false, args); };
        }

        // Tells the pre-boot hook in `server/templates/index.html` to stop
        // collecting: from here the ring is the buffer, and a second one filling
        // up behind it is the unbounded array this replaces.
        target.__appTraceOwned = true;

        // The export page joins this array into a <pre>. Keeping it a real array
        // of strings — bounded by the ring — is what makes this a replacement
        // rather than a breaking change (`src/loader.ts`).
        Object.defineProperty(target, "appTrace", {
            configurable: true,
            get: () => this._ring.entries.map(r => `${r.level.toUpperCase().padEnd(5)} ${r.ts} [${r.channel}] ${r.message}\n`),
        });
    }

    /**
     * Flush what is queued when the page goes away.
     *
     * `visibilitychange` rather than `unload`: it is the last event a modern
     * browser reliably delivers (a backgrounded tab may never see `unload` at
     * all), and it fires on tab-switch too, so a session that ends by closing
     * the laptop still lands its records.
     */
    installLifecycleFlush(target: any = globalThis): void {
        if (typeof target?.addEventListener !== "function") return;
        target.addEventListener("visibilitychange", () => {
            if ((globalThis as any).document?.visibilityState === "hidden") void this.flush();
        });
        target.addEventListener("pagehide", () => { void this.flush(); });
    }

    // ---- reads ------------------------------------------------------------

    /** Buffered records, newest last. Filterable the same way the server's are. */
    getEntries(query: { afterId?: number; limit?: number; minLevel?: LogLevelName; channel?: string; search?: string } = {}): ClientLogRecord[] {
        const afterId = Number(query.afterId) || 0;
        const limit = Math.min(2000, Math.max(1, Number(query.limit) || 500));
        const minLevel = query.minLevel ? levelNumber(query.minLevel, null) : null;
        const channel = query.channel ? normalizeChannel(query.channel) : null;
        const search = query.search ? String(query.search).toLowerCase() : "";

        let out = this._ring.entries.filter(entry => entry.id > afterId);
        if (minLevel !== null) out = out.filter(entry => (levelNumber(entry.level, 0) as number) >= minLevel);
        if (channel) out = out.filter(entry => entry.channel === channel || entry.channel.startsWith(`${channel}:`));
        if (search) out = out.filter(entry => entry.message.toLowerCase().includes(search) || entry.channel.includes(search));
        return out.slice(-limit);
    }

    stats(): Record<string, any> {
        return {
            rootLevel: levelNameOf(this._config.level),
            allowSensitive: this._config.allowSensitive,
            ring: { maxEntries: this._ring.maxEntries, buffered: this._ring.entries.length, dropped: this._ring.dropped },
            forward: { ...this._config.forward, minLevel: levelNameOf(this._config.forward.minLevel), queued: this._queue.length },
            counters: { ...this._stats },
        };
    }
}
