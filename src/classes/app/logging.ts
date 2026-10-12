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
/**
 * One attachment's ceiling. A ~90 s dictation window is a few hundred kB of
 * Opus; four megabytes leaves room for a long one without letting a single
 * record become the reason the RPC body limit is raised again.
 */
const DEFAULT_MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
/**
 * Ceiling on one forwarded BATCH, in bytes of JSON.
 *
 * `batchSize` alone counts records, and a record is not a fixed size: a deployment
 * that raises `maxStringLength` to read whole HTTP bodies back makes one record
 * hundreds of kB, and fifty of them a multi-megabyte POST. `ingestClientLogs`
 * answers that with a 413 and the batch is dropped — the forwarder does not retry —
 * so a count-only budget loses exactly the sessions that were worth recording.
 *
 * Comfortably under the RPC's own 256 kB default so the envelope and the growth
 * between measuring and sending cannot push a batch over.
 */
const DEFAULT_MAX_BATCH_BYTES = 180 * 1024;
/**
 * Ceiling on ONE forwarded record, mirroring the server's `client.maxRecordBytes`
 * default. Above it the server counts the record `oversized` and drops it whole, so
 * shipping it spends uplink on something dead on arrival — it is trimmed here
 * instead, which at least preserves the record's shape and its first lines.
 */
const DEFAULT_MAX_RECORD_BYTES = 32 * 1024;
/**
 * Ceiling on the bytes waiting to be shipped. Attachments are queued separately
 * from records precisely because they are large; without a byte bound a server
 * that is refusing them turns into a browser that is holding the whole session's
 * audio in RAM. Oldest first out, and counted.
 */
const DEFAULT_ATTACHMENT_QUEUE_BYTES = 32 * 1024 * 1024;

/** One emitted record. Shape mirrors the server's so both ends read alike. */
export interface ClientLogRecord {
    id: number;
    ts: string;
    level: LogLevelName;
    channel: string;
    message: string;
    fields?: Record<string, any>;
    sensitive?: boolean;
    /**
     * Base64 of an attachment's bytes. Present ONLY on the copy handed to the
     * transport — never on the record in the ring, which keeps the descriptor
     * (`fields.attachment`) and nothing else. A ring that held the bytes would
     * pin every recorded window's audio for the life of the page.
     */
    attachmentBytes?: string;
    /**
     * Present when the record was cut down to fit the server's per-record cap on its
     * way out. The record still arrives; this says it is not the whole of what the
     * browser saw, which a silently-shortened body could never admit.
     */
    truncatedForForward?: { originalBytes: number; maxBytes: number };
}

/** Bytes that belong with a record, carried out-of-band. */
export interface ClientLogAttachment {
    /** Path the destination writes the file at, relative to its attachment dir. */
    file: string;
    bytes?: ArrayBuffer | ArrayBufferView | null;
    /** Anything else worth putting on the line: mediaType, duration, indices. */
    [key: string]: any;
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
    /**
     * A record whose payload is BYTES — a recording, a screenshot, a file the
     * user added. The line describes it (`file`, size, whatever else is passed);
     * the bytes ride beside the record to the server, which writes them as a real
     * file next to the transcript. Sensitive by definition.
     */
    attachment(descriptor: ClientLogAttachment, message?: string): ClientLogRecord | null;
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

/** Anything byte-shaped a call site may hand `attachment()` → a `Uint8Array`, or null. */
function toBytes(value: ArrayBuffer | ArrayBufferView | null | undefined): Uint8Array | null {
    if (!value) return null;
    if (value instanceof Uint8Array) return value.byteLength ? value : null;
    if (ArrayBuffer.isView(value)) {
        const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return view.byteLength ? view : null;
    }
    if (value instanceof ArrayBuffer) {
        const view = new Uint8Array(value);
        return view.byteLength ? view : null;
    }
    return null;
}

/**
 * Bytes → base64, in chunks.
 *
 * `String.fromCharCode(...bytes)` on a megabyte blows the argument limit and
 * throws — which, on the logging path, would take down the caller rather than
 * lose a diagnostic. Chunked, it is linear and safe at any size the cap allows.
 */
function bytesToBase64(bytes: Uint8Array): string {
    const CHUNK = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes.subarray(i, i + CHUNK)) as any);
    }
    return btoa(binary);
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
        attachments: boolean;
        maxAttachmentBytes: number;
        attachmentQueueBytes: number;
        maxBatchBytes: number;
        maxRecordBytes: number;
    };
}

/**
 * The broker. One per application context; `APPLICATION_CONTEXT.log` IS this
 * object's `log()` bound method, so call sites read the same as the server's
 * (`APPLICATION_CONTEXT.log("module.x").warn(...)`).
 */
export class ClientLogging {
    /** UTF-8 ruler shared by every size decision. Absent only in exotic hosts; see `_recordBytes`. */
    private static _encoder: TextEncoder | null =
        typeof TextEncoder === "function" ? new TextEncoder() : null;
    private _ring: ClientLogRing;
    private _config: ResolvedClientLogConfig;
    private _levelCache = new Map<string, number>();
    private _nextId = 1;
    private _queue: ClientLogRecord[] = [];
    private _timer: any = null;
    private _flushing = false;
    private _originalConsole: Record<string, (...args: any[]) => void> = {};
    private _consoleAdopted = false;
    private _stats = {
        emitted: 0, suppressed: 0, sensitiveSuppressed: 0, forwarded: 0, forwardDropped: 0, forwardFailures: 0,
        attachmentsQueued: 0, attachmentsForwarded: 0, attachmentsDropped: 0, attachmentsOversized: 0,
        // Distinct from `forwardFailures`: a refused batch is a budget we got wrong,
        // a transport failure is the network. Conflating them hid the first behind
        // the second for a whole deployment.
        forwardRefused: 0, forwardTrimmed: 0,
    };
    /**
     * Attachments waiting to be shipped, with their bytes. Deliberately NOT the
     * record queue: one window of dictation outweighs a thousand log lines, so a
     * shared queue would either evict every record or be bounded by the wrong unit.
     * Bounded by total bytes, drained one file per request.
     */
    private _attachmentQueue: ClientLogRecord[] = [];
    private _attachmentBytes = 0;
    /** The drain in progress, so a concurrent `flushAttachments()` awaits it rather
     *  than returning while files are still in flight. */
    private _attachmentFlush: Promise<void> | null = null;
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
        // Adopted `console.*` output is recorded at `info` by default for the same
        // reason: `console.log` is what the crash-export page and a developer both
        // expect to find in the trace. Printing is not gated on this level at all
        // (see `adoptConsole`) — this only decides what reaches the ring/forwarder.
        channels.set("console", LOG_LEVELS.info);
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
                // A THIRD opt-in, on top of `enabled` and `includeSensitive`.
                // Recording bytes in the browser, sending records to the server and
                // sending the bytes themselves are three different decisions, and the
                // last one is the one that fills a disk. The server must also allow
                // them (`core.server.logging.client.attachments`).
                attachments: forward.attachments === true,
                maxAttachmentBytes: Math.max(1024, Number(forward.maxAttachmentBytes) || DEFAULT_MAX_ATTACHMENT_BYTES),
                attachmentQueueBytes: Math.max(
                    Math.max(1024, Number(forward.maxAttachmentBytes) || DEFAULT_MAX_ATTACHMENT_BYTES),
                    Number(forward.attachmentQueueBytes) || DEFAULT_ATTACHMENT_QUEUE_BYTES),
                // Both are also learned from the server's own answer — see `_adoptServerLimits`.
                maxBatchBytes: Math.max(4096, Number(forward.maxBatchBytes) || DEFAULT_MAX_BATCH_BYTES),
                maxRecordBytes: Math.max(512, Number(forward.maxRecordBytes) || DEFAULT_MAX_RECORD_BYTES),
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
            attachment: (descriptor: ClientLogAttachment, message = "ATTACHMENT") => {
                const { bytes, file, ...meta } = descriptor || ({} as ClientLogAttachment);
                const view = toBytes(bytes);
                const size = view ? view.byteLength : 0;
                return this._emit(name, "trace", true,
                    [{ attachment: { file, size, ...meta } }, message], true,
                    view ? { bytes: view, file: String(file ?? "") } : undefined);
            },
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

    private _emit(channel: string, level: LogLevelName, sensitive: boolean, args: any[], mirror = true,
                  payload?: { bytes: Uint8Array; file: string }): ClientLogRecord | null {
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
        if (mirror) this._writeConsole(record);
        this._enqueueForward(record, payload);
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

    private _enqueueForward(record: ClientLogRecord, payload?: { bytes: Uint8Array; file: string }): void {
        const forward = this._config.forward;
        if (!forward.enabled) return;
        // `minLevel` is a gate on ordinary log LINES. Payload records — `sensitive()`
        // and attachments — are not lines: they always emit at `trace`, and each
        // already carries its own dedicated opt-in below (`includeSensitive`,
        // `attachments`) on top of the two the record needed to exist at all.
        //
        // Applying the level gate to them makes those opt-ins UNREACHABLE at every
        // `minLevel` above trace — including the default `warn` — so a deployment
        // that set `includeSensitive: true` forwarded no payloads whatsoever and had
        // nothing to say why. That is how a remote deployment recorded dictation
        // locally and stored none of it: the transcript is a `sensitive` record, and
        // its `minLevel: "info"` dropped every one before the queue.
        const payloadRecord = !!payload || record.sensitive === true;
        if (!payloadRecord && (levelNumber(record.level, 0) as number) < forward.minLevel) return;
        // The gate that actually decides for a payload: a deployment saying its
        // content must not leave the browser. Dictation is the most sensitive of it.
        if (record.sensitive && !forward.includeSensitive) return;

        if (payload) { this._enqueueAttachment(record, payload); return; }

        this._queue.push(this._fitRecord(record, forward.maxRecordBytes));
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
     * Bytes one record costs on the wire. Never throws; a value it cannot measure is assumed large.
     *
     * Measured in UTF-8, because that is what the server measures
     * (`Buffer.byteLength`) and what the body limit counts. `String.length` is
     * UTF-16 code units, so it under-reports every non-ASCII character by 2-3x —
     * which is exactly the traffic this carries (multilingual dictation
     * transcripts). A record "trimmed to fit" `maxRecordBytes` by that ruler
     * arrives at double the cap and is dropped whole, and a batch built to
     * `maxBatchBytes` clears the RPC body limit and comes back 413 — and this
     * forwarder does not retry, so both are silent data loss.
     */
    private _recordBytes(record: ClientLogRecord): number {
        try {
            const json = JSON.stringify(record);
            if (ClientLogging._encoder) return ClientLogging._encoder.encode(json).length;
            return json.length;
        } catch { return Number.MAX_SAFE_INTEGER; }
    }

    /**
     * Cut a record down to what the server will actually accept.
     *
     * The server drops an over-cap record WHOLE (`maxRecordBytes`), so sending one
     * costs uplink and yields nothing. Trimming here keeps the record's identity —
     * channel, level, message, the start of its fields — and says how much went, which
     * is strictly better than a record that silently never arrives.
     */
    private _fitRecord(record: ClientLogRecord, maxBytes: number): ClientLogRecord {
        const size = this._recordBytes(record);
        if (size <= maxBytes) return record;
        this._stats.forwardTrimmed++;
        // Re-shrink the fields against a budget derived from the overshoot rather than
        // dropping them: the first lines of a body are usually the diagnostic.
        const ratio = Math.max(0.05, maxBytes / size);
        const cap = Math.max(200, Math.floor(this._config.maxString * ratio));
        const trimmed: ClientLogRecord = {
            ...record,
            message: shrink(record.message, cap),
            ...(record.fields ? { fields: shrink(record.fields, cap) } : {}),
            truncatedForForward: { originalBytes: size, maxBytes },
        } as ClientLogRecord;
        // Still too big (a record with thousands of small fields): keep the head only.
        if (this._recordBytes(trimmed) > maxBytes) {
            delete (trimmed as any).fields;
            trimmed.message = shrink(record.message, Math.max(200, Math.floor(maxBytes / 2)));
        }
        return trimmed;
    }

    /**
     * Adopt the caps the server reports, so the client stops guessing them.
     *
     * The two ends had independent numbers, and the client's were the optimistic
     * ones — which is how a batch the server could never accept was sent every five
     * seconds. Only ever tightens within this session: a server that answers with a
     * larger cap is not a reason to start sending bigger batches mid-flight.
     */
    private _adoptServerLimits(result: any): void {
        const forward = this._config.forward;
        const perBatch = Number(result?.maxRecordsPerBatch);
        if (Number.isFinite(perBatch) && perBatch > 0 && perBatch < forward.batchSize) {
            forward.batchSize = Math.max(1, Math.floor(perBatch));
        }
        const perRecord = Number(result?.maxRecordBytes);
        if (Number.isFinite(perRecord) && perRecord > 0 && perRecord < forward.maxRecordBytes) {
            forward.maxRecordBytes = Math.max(512, Math.floor(perRecord));
        }
        // The attachment verdict, one level down, and the one that costs the most
        // to ignore: a deployment with `forward.attachments` on and the server's
        // `client.attachments` off base64-encodes and uploads every dictation
        // window for the whole session, and the server refuses the bytes of each.
        // That is raw patient audio crossing the network repeatedly for nothing,
        // invisible in both ends' stats. Same one-way rule as the caps above: this
        // can only turn forwarding OFF, never back on mid-session.
        const attachments = result?.attachments;
        if (attachments && typeof attachments === "object") {
            if (attachments.accepted === false) forward.attachments = false;
            const maxAttachment = Number(attachments.maxBytes);
            if (Number.isFinite(maxAttachment) && maxAttachment > 0
                && maxAttachment < forward.maxAttachmentBytes) {
                forward.maxAttachmentBytes = Math.max(1024, Math.floor(maxAttachment));
            }
        }
    }

    /**
     * Mark the descriptor in the ring: this file was not kept, and why.
     *
     * Reaches the ring's record because the queued copy is a shallow spread —
     * `fields` is the SAME object — which is deliberate: the answer to "why is
     * there no audio for this window" has to live on the record that remains.
     */
    private _noteAttachment(record: ClientLogRecord, reason: string): void {
        // `_ringAttachment` is set when the queued line was trimmed and therefore
        // carries a REBUILT descriptor; marking that copy would leave the ring —
        // the crash export, the thing that outlives the queue — saying nothing.
        const described = (record as any)._ringAttachment ?? record.fields?.attachment;
        if (described && typeof described === "object") {
            (described as any).stored = false;
            (described as any).reason = reason;
        }
    }

    /**
     * Trim an attachment record's own LINE to `maxRecordBytes`.
     *
     * The bytes are exempt from that cap (they are a file, not a line) but the
     * descriptor around them is not, and this path used to skip `_fitRecord`
     * entirely: a window record carrying a transcript or per-segment metadata was
     * shipped over the cap, and the server — which measures the line with the
     * bytes already split off — dropped it whole AFTER accepting the payload. The
     * file went nowhere and both ends' counters said it arrived.
     *
     * What survives the trim verbatim is the descriptor's POINTER — `file`, `size`,
     * `mediaType` — because a truncated path makes the stored bytes unfindable,
     * which is worse than the oversize it would have fixed. The rest of the
     * descriptor is ordinary diagnostic metadata (`attachment()` folds every extra
     * key into it) and is trimmed like any other field; restoring the whole object
     * would re-inflate the record and defeat the trim in the exact case that
     * needs it.
     */
    private _fitAttachmentLine(record: ClientLogRecord): ClientLogRecord {
        const max = this._config.forward.maxRecordBytes;
        if (this._recordBytes(record) <= max) return record;
        const descriptor: any = record.fields?.attachment;
        const line = this._fitRecord(record, max);
        if (descriptor && typeof descriptor === "object") {
            if (!line.fields) (line as any).fields = {};
            const pointer: Record<string, any> = {};
            for (const key of ["file", "size", "mediaType", "stored", "reason"]) {
                if (descriptor[key] !== undefined) pointer[key] = descriptor[key];
            }
            const kept = (line.fields as any).attachment;
            (line.fields as any).attachment =
                kept && typeof kept === "object" ? { ...kept, ...pointer } : pointer;
        }
        return line;
    }

    /**
     * Learn the attachment cap from a 413 — the one verdict the server's own
     * answer cannot deliver.
     *
     * `_adoptServerLimits` only runs on SUCCESS, and a body the reader refuses
     * never reaches the handler that reports `attachments.accepted` / `maxBytes`.
     * So a deployment whose body limit sits below the client's attachment cap
     * (`client.attachments` off leaves the 256 kB default against a 4 MB cap) used
     * to re-encode and re-upload every sealed dictation window for the whole
     * session: raw patient audio crossing the network repeatedly for guaranteed
     * nothing. Tighten from the size that was refused, and refuse the rest of the
     * queue locally rather than one pointless upload at a time.
     */
    private _tightenAttachmentCap(refused: ClientLogRecord): void {
        const forward = this._config.forward;
        // base64 is 4 chars per 3 bytes; halve on top so the next window is not
        // another near-miss against the same reader.
        const raw = Math.floor(((refused.attachmentBytes?.length || 0) * 3) / 4);
        const next = Math.max(1024, Math.floor(raw / 2));
        if (next < forward.maxAttachmentBytes) forward.maxAttachmentBytes = next;
        const kept: ClientLogRecord[] = [];
        for (const queued of this._attachmentQueue) {
            const bytes = Math.floor(((queued.attachmentBytes?.length || 0) * 3) / 4);
            if (bytes > forward.maxAttachmentBytes) {
                this._stats.attachmentsOversized++;
                this._noteAttachment(queued, "too-large");
                continue;
            }
            kept.push(queued);
        }
        this._attachmentQueue = kept;
        // The running total is only re-derived when the drain finishes; a concurrent
        // enqueue would otherwise evict against bytes that are no longer queued.
        this._attachmentBytes = kept.reduce((n, r) => n + (r.attachmentBytes?.length || 0), 0);
    }

    /**
     * Queue one attachment, or say on its own line why it will never be shipped.
     *
     * The descriptor is already in the ring either way — a record pointing at a
     * file nobody kept is still the answer to "why is there no audio for this
     * window", and that answer is the thing a silent drop destroys. `stored` on
     * the descriptor is what tells the two apart when the file is read later.
     */
    private _enqueueAttachment(record: ClientLogRecord, payload: { bytes: Uint8Array; file: string }): void {
        const forward = this._config.forward;
        const note = (reason: string) => this._noteAttachment(record, reason);
        if (!forward.attachments) { this._stats.attachmentsDropped++; note("not-forwarded"); return; }
        if (payload.bytes.byteLength > forward.maxAttachmentBytes) {
            this._stats.attachmentsOversized++;
            note("too-large");
            return;
        }

        let encoded: string;
        try { encoded = bytesToBase64(payload.bytes); }
        catch { this._stats.attachmentsDropped++; note("encode-failed"); return; }

        // The queued copy carries the bytes; the ring's record never does.
        const line = this._fitAttachmentLine(record);
        const queued: ClientLogRecord = { ...line, attachmentBytes: encoded };
        const ringDescriptor = record.fields?.attachment;
        if (line !== record && ringDescriptor && typeof ringDescriptor === "object") {
            // Non-enumerable: a back-reference for `_noteAttachment`, never a field
            // on the wire.
            Object.defineProperty(queued, "_ringAttachment", {
                value: ringDescriptor, enumerable: false, configurable: true,
            });
        }
        this._attachmentQueue.push(queued);
        this._attachmentBytes += encoded.length;
        this._stats.attachmentsQueued++;
        // Oldest out first: a queue that is backing up is one the server is not
        // draining, and the newest recording is the one still being discussed.
        while (this._attachmentBytes > forward.attachmentQueueBytes && this._attachmentQueue.length > 1) {
            const evicted = this._attachmentQueue.shift();
            this._attachmentBytes -= (evicted?.attachmentBytes?.length || 0);
            this._stats.attachmentsDropped++;
        }
        void this.flushAttachments();
    }

    /**
     * Ship queued attachments, one file per request.
     *
     * One per request on purpose: an attachment is orders of magnitude bigger
     * than a log line, so batching them only makes the body limit a moving
     * target and turns one rejected file into a rejected batch. Failures are
     * dropped and counted, exactly like a record batch — a retry loop holding
     * megabytes of patient dictation is the failure mode this must not have.
     */
    flushAttachments(): Promise<void> {
        // Returning the RUNNING drain, not undefined: a caller awaiting this on
        // page-hide would otherwise be told "done" while the files are still in
        // flight, which is precisely when the last window of a session is queued.
        if (this._attachmentFlush) return this._attachmentFlush;
        if (!this._attachmentQueue.length) return Promise.resolve();
        this._attachmentFlush = this._drainAttachments()
            .finally(() => { this._attachmentFlush = null; });
        return this._attachmentFlush;
    }

    /** @private */
    private async _drainAttachments(): Promise<void> {
        try {
            while (this._attachmentQueue.length) {
                const record = this._attachmentQueue.shift()!;
                this._attachmentBytes -= (record.attachmentBytes?.length || 0);
                try {
                    const transport = this._transport || ClientLogging._defaultTransport;
                    const result = await transport([record], this.sessionId);
                    this._stats.forwarded++;
                    const body = (result as any)?.result ?? result;
                    // The reply is the ONLY place a client learns the deployment
                    // refuses attachments — the upload itself succeeds, the bytes
                    // are simply thrown away. Discarding it here is what let a
                    // whole session of dictation audio ship into a void.
                    this._adoptServerLimits(body);
                    // Delivered is not kept: the request succeeded while this
                    // particular file was refused (attachments off) or its line was
                    // dropped over `maxRecordBytes`. Counting it `forwarded` on the
                    // transport's verdict alone is what made a lost file invisible.
                    const stored = Number(body?.attachments?.stored);
                    if (Number.isFinite(stored) && stored < 1) {
                        this._stats.attachmentsDropped++;
                        this._noteAttachment(record,
                            Number(body?.oversized) > 0 ? "record-oversized" : "refused");
                    } else {
                        this._stats.attachmentsForwarded++;
                    }
                } catch (e) {
                    // A 413 is the body reader, not the network: the handler never
                    // ran, so no verdict is coming back and only this branch can
                    // stop the session from re-uploading the same megabytes.
                    if (ClientLogging._isTooLarge(e)) {
                        this._stats.forwardRefused++;
                        this._stats.attachmentsOversized++;
                        this._noteAttachment(record, "too-large");
                        this._tightenAttachmentCap(record);
                    } else {
                        this._stats.forwardFailures++;
                        this._stats.attachmentsDropped++;
                        this._noteAttachment(record, "transport-failed");
                    }
                }
                // Refused by this deployment: stop paying for the rest of the queue
                // now rather than one pointless upload at a time.
                if (!this._config.forward.attachments) {
                    this._stats.attachmentsDropped += this._attachmentQueue.length;
                    this._attachmentQueue.length = 0;
                    break;
                }
            }
        } finally {
            this._attachmentBytes = this._attachmentQueue.reduce((n, r) => n + (r.attachmentBytes?.length || 0), 0);
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
        const forward = this._config.forward;
        // Fill by BYTES as well as by count. Records are not a fixed size, and the
        // receiving RPC has a body limit — a count-only batch of large records is
        // refused with a 413 and, since this forwarder never retries, lost.
        const batch: ClientLogRecord[] = [];
        let bytes = 0;
        while (this._queue.length && batch.length < forward.batchSize) {
            const next = this._queue[0]!;
            const cost = this._recordBytes(next) + 1;   // +1 for the separating comma
            // Always take at least one: a single record over the batch budget has
            // already been trimmed to `maxRecordBytes`, so this cannot spin.
            if (batch.length && bytes + cost > forward.maxBatchBytes) break;
            this._queue.shift();
            batch.push(next);
            bytes += cost;
        }
        if (!batch.length) return;
        this._flushing = true;
        try {
            const transport = this._transport || ClientLogging._defaultTransport;
            // Sent once per batch, not stamped on every record: it is constant for
            // the page-load, and the server re-attaches it to each record anyway.
            const result = await transport(batch, this.sessionId);
            this._stats.forwarded += batch.length;
            this._adoptServerLimits((result as any)?.result ?? result);
        } catch (e) {
            // A refused batch is a budget we got wrong; tighten so the next one fits
            // rather than repeating the same rejection every interval.
            if (ClientLogging._isTooLarge(e)) {
                this._stats.forwardRefused++;
                forward.maxBatchBytes = Math.max(8192, Math.floor(bytes / 2));
            } else {
                this._stats.forwardFailures++;
            }
            this._stats.forwardDropped += batch.length;
        } finally {
            this._flushing = false;
            if (this._queue.length >= forward.batchSize) void this.flush();
            else if (this._queue.length && !this._timer) {
                this._timer = setTimeout(() => { this._timer = null; void this.flush(); }, forward.intervalMs);
            }
        }
    }

    /** Did the server refuse this batch for its size? (413, or the RPC's own code.) */
    private static _isTooLarge(error: any): boolean {
        const status = Number(error?.status ?? error?.statusCode);
        if (status === 413) return true;
        const text = String(error?.code ?? error?.message ?? "");
        return text.includes("RPC_BODY_TOO_LARGE") || text.includes("413");
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

        // A `console.log` is an explicit request to PRINT — from app code and from
        // a developer typing into devtools alike. So the original method is always
        // called, with the original arguments (objects stay expandable, no
        // `[console]` prefix, no stringification), and the record it also produces
        // is written with `mirror: false` so this does not double-print. The
        // channel level therefore governs the ring and the forwarder only; it must
        // never be able to swallow console output, which is what made
        // `console.log("HI")` print nothing at the default root level of `warn`.
        for (const level of ["debug", "info", "log", "warn", "error"] as const) {
            const mapped: LogLevelName = level === "log" ? "info" : (level as LogLevelName);
            const original = this._originalConsole[level];
            target[level] = (...args: any[]) => {
                if (this._config.console) original(...args);
                this._emit("console", mapped, false, args, false);
            };
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
            if ((globalThis as any).document?.visibilityState !== "hidden") return;
            void this.flush();
            void this.flushAttachments();
        });
        target.addEventListener("pagehide", () => { void this.flush(); void this.flushAttachments(); });
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
            forward: {
                ...this._config.forward,
                minLevel: levelNameOf(this._config.forward.minLevel),
                queued: this._queue.length,
                attachmentsQueued: this._attachmentQueue.length,
                attachmentQueueBytesUsed: this._attachmentBytes,
                queuedBytes: this._queue.reduce((n, r) => n + this._recordBytes(r), 0),
            },
            counters: { ...this._stats },
        };
    }
}
