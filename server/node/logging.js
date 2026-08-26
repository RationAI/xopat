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
/**
 * Stream-sink defaults. The queue bound is the important one: a collector that
 * stops answering must cost bounded memory and counted drops, never backpressure
 * on a request thread.
 */
const DEFAULT_STREAM_BATCH = 100;
const DEFAULT_STREAM_FLUSH_MS = 2_000;
const DEFAULT_STREAM_QUEUE = 5_000;
const DEFAULT_STREAM_TIMEOUT_MS = 5_000;
/** Gap between repeated "this destination is failing" console warnings. */
const STREAM_WARN_INTERVAL_MS = 60_000;
/** One attachment file's ceiling. Above it the line records a skip. */
const DEFAULT_MAX_ATTACHMENT_BYTES = 8 << 20;
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

/**
 * One streaming destination: an HTTP collector, a plain file, or both.
 *
 * The sink that takes records OFF the box. Everything else a record can reach —
 * stdout, the ring, the storage log — requires someone to already be on the
 * machine (or scraping its stdout) to read it, which is not a monitoring story.
 *
 * Three properties are non-negotiable, and they are why this is a queue rather
 * than a write:
 *
 * - **Never backpressure.** `write` only appends and returns. A collector that
 *   hangs must cost a bounded queue and a counter, never a stalled request.
 * - **Never throw.** A logging failure that propagates turns an observability
 *   problem into an outage.
 * - **Never lose silently.** Drops are counted and reported through `stats()`;
 *   a stream whose `dropped` is climbing is a visible fact, not a mystery.
 *
 * Batching is per destination, so a slow collector does not delay the local file.
 */
class LogStreamDestination {
    constructor(config, deps = {}) {
        this.config = config;
        this.queue = [];
        this.flushing = false;
        this.timer = null;
        this.stats = {
            queued: 0, sent: 0, dropped: 0, failures: 0, lastError: null,
            attachmentsStored: 0, attachmentsSkipped: 0, attachmentsRefused: 0, attachmentsFailed: 0,
        };
        // Injectable for tests: the real transports open sockets and touch the
        // filesystem, and neither belongs in a unit test of the batching rules.
        this.transports = {
            http: deps.http || ((url, body, opts) => defaultHttpTransport(url, body, opts)),
            file: deps.file || ((path, body) => defaultFileTransport(path, body)),
            attachment: deps.attachment || ((dir, relative, bytes) => defaultAttachmentTransport(dir, relative, bytes)),
        };
        this.warn = deps.warn || (() => {});
        this.now = deps.now || (() => Date.now());
        this.lastWarnAt = 0;
    }

    /** Should this record leave the process at all? */
    accepts(record) {
        if (normalizeLevel(record.level, 0) < this.config.minLevel) return false;
        // A `sensitive` record already passed the operator gate to be EMITTED.
        // Leaving the deployment is a second, larger decision — on real data that
        // is PHI crossing a network boundary — so it needs its own opt-in (§7).
        if (record.sensitive && !this.config.includeSensitive) return false;
        if (!channelMatches(record.channel, this.config.channels)) return false;
        return true;
    }

    /**
     * Queue a record; `payload` is out-of-band bytes that must never be in the line.
     *
     * The line is copied before it is annotated — the same record object is in
     * the ring and in every other destination, and one destination's verdict
     * ("stored", "too-large") is not a fact about the others.
     */
    write(record, payload) {
        if (!this.accepts(record)) return;
        if (payload) {
            const line = { ...record, fields: { ...(record.fields || {}) } };
            this.writeAttachment(payload, line);
            record = line;
        }
        this.queue.push(record);
        this.stats.queued++;
        const overflow = this.queue.length - this.config.queueLimit;
        if (overflow > 0) {
            // Drop the OLDEST: when a destination is behind, the recent records
            // are the ones describing why.
            this.queue.splice(0, overflow);
            this.stats.dropped += overflow;
        }
        if (this.queue.length >= this.config.batchSize) {
            this.flush();
            return;
        }
        this.arm();
    }

    /** Start the idle timer, if one is not already pending. */
    arm() {
        if (this.timer || !this.queue.length) return;
        this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.config.flushIntervalMs);
        // A logging timer must never be the reason a process stays alive.
        this.timer.unref?.();
    }

    /**
     * Send what is queued. Serialized: a second flush while one is in flight
     * would reorder the stream, and a log whose lines are shuffled is not a log.
     */
    flush() {
        if (this.flushing || !this.queue.length) return this.pending || Promise.resolve();
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        const batch = this.queue;
        this.queue = [];
        this.flushing = true;
        const body = `${batch.map(record => safeJsonLine(record)).join("\n")}\n`;

        const targets = [];
        if (this.config.url) targets.push(this.transports.http(this.config.url, body, this.config));
        if (this.config.file) targets.push(this.transports.file(this.filePath(), body));

        this.pending = Promise.allSettled(targets)
            .then(results => {
                const failed = results.filter(r => r.status === "rejected");
                if (failed.length) {
                    this.stats.failures += failed.length;
                    this.stats.dropped += batch.length;
                    this.stats.lastError = String(failed[0].reason?.message || failed[0].reason);
                    const at = this.now();
                    if (at - this.lastWarnAt > STREAM_WARN_INTERVAL_MS) {
                        this.lastWarnAt = at;
                        this.warn(`[logging] stream destination ${this.describe()} failing: ${this.stats.lastError}`);
                    }
                } else {
                    this.stats.sent += batch.length;
                }
            })
            .finally(() => {
                this.flushing = false;
                // Records that arrived during the flight: keep draining rather
                // than waiting for the next timer tick.
                if (this.queue.length >= this.config.batchSize) this.flush();
                else this.arm();
            });
        return this.pending;
    }

    /**
     * Write one attachment beside the transcript, or refuse it and say so.
     *
     * The artifact this produces is `<transcript>.ndjson` + `<transcript>.files/`,
     * which a person can open in a file browser — that is the whole point of
     * "so we can see the attachments too". Inlining the bytes in the line would
     * technically work and is exactly what must not happen: one base64 screenshot
     * per line is the repetition problem in another costume.
     *
     * Refusal is normal and is REPORTED on the line (`stored: false` plus a
     * reason), never silent — a transcript that quietly lost its images is worse
     * than one that says it did.
     */
    writeAttachment(attachment, line) {
        const note = (stored, reason) => {
            const described = line.fields?.attachment;
            if (described && typeof described === "object") {
                line.fields.attachment = { ...described, stored, ...(reason ? { reason } : {}) };
            }
        };
        if (!this.config.file) {
            // An HTTP collector has no sidecar to write into. Counted rather than
            // dropped quietly, so a deployment streaming to a collector can see
            // that its attachments are not being kept anywhere.
            this.stats.attachmentsRefused++;
            note(false, "no-file-destination");
            return;
        }
        if (!this.config.attachments) {
            this.stats.attachmentsRefused++;
            note(false, "destination-opted-out");
            return;
        }
        const bytes = attachment.bytes;
        const size = bytes ? (bytes.byteLength ?? bytes.length ?? 0) : 0;
        if (!size) { this.stats.attachmentsRefused++; note(false, "empty"); return; }
        if (size > this.config.maxAttachmentBytes) {
            this.stats.attachmentsSkipped++;
            note(false, "too-large");
            return;
        }

        const relative = safeRelativePath(attachment.file);
        if (!relative) { this.stats.attachmentsRefused++; note(false, "bad-path"); return; }

        // Fire-and-forget, like every other write here: an attachment must not
        // delay the turn that produced it.
        Promise.resolve(this.transports.attachment(this.attachmentDir(), relative, bytes))
            .then(() => { this.stats.attachmentsStored++; })
            .catch(e => {
                this.stats.attachmentsFailed++;
                this.stats.lastError = String(e?.message || e);
            });
        note(true);
    }

    /** `…/chat-transcript.ndjson` → `…/chat-transcript.files`. */
    attachmentDir() {
        const path = this.filePath();
        const cut = path.lastIndexOf(".");
        const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
        return `${cut > slash ? path.slice(0, cut) : path}.files`;
    }

    /**
     * The file this batch appends to.
     *
     * Daily rotation is the default because an unbounded single file is a
     * deployment footgun, and `perProcess` exists for the cluster case: with
     * several workers appending large `sensitive` payload records, one file
     * cannot promise that a record stays on one line.
     */
    filePath() {
        const path = this.config.file;
        if (!path) return path;
        const suffixes = [];
        if (this.config.rotate === "daily") suffixes.push(new Date().toISOString().slice(0, 10));
        if (this.config.perProcess) suffixes.push(String(process.pid));
        if (!suffixes.length) return path;
        const cut = path.lastIndexOf(".");
        const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
        const stem = cut > slash ? path.slice(0, cut) : path;
        const ext = cut > slash ? path.slice(cut) : "";
        return `${stem}.${suffixes.join(".")}${ext}`;
    }

    describe() {
        return this.config.url || this.config.file || "(empty)";
    }

    snapshot() {
        return {
            ...(this.config.url ? { url: this.config.url } : {}),
            ...(this.config.file ? { file: this.config.file, resolvedFile: this.filePath() } : {}),
            ...(this.config.channels.length ? { channels: this.config.channels } : {}),
            ...(this.config.attachments ? { attachmentDir: this.attachmentDir() } : {}),
            minLevel: levelName(this.config.minLevel),
            includeSensitive: this.config.includeSensitive,
            batchSize: this.config.batchSize,
            queued: this.queue.length,
            ...this.stats,
        };
    }

    close() {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        return this.flush();
    }
}

/**
 * Does `channel` belong to one of `wanted`?
 *
 * The same rule the ring's `getEntries` filter uses — a name matches itself and
 * everything under it (`a` matches `a:b`) — deliberately shared rather than
 * re-derived, so "give me this subsystem" means one thing across the whole
 * broker. No filter means everything, which is what a destination without a
 * `channels` list has always done.
 */
function channelMatches(channel, wanted) {
    if (!wanted || !wanted.length) return true;
    const name = String(channel || "");
    return wanted.some(prefix => name === prefix || name.startsWith(`${prefix}:`));
}

/** A record that cannot be serialized must not take the whole batch down. */
function safeJsonLine(record) {
    try {
        return JSON.stringify(record);
    } catch (e) {
        return JSON.stringify({
            ts: record?.ts || new Date().toISOString(),
            level: record?.level || "error",
            channel: record?.channel || "logging",
            message: `[unserializable log record: ${e?.message || e}]`,
        });
    }
}

/**
 * HTTP transport: batched NDJSON through the core SSRF guard.
 *
 * The guard is required lazily — logging is loaded on every server-module load,
 * and the guard pulls in DNS and a bounded cache that a deployment with no HTTP
 * destination should never pay for. A collector on a private address is reachable
 * only through the operator allowlist (`XOPAT_SSRF_ALLOWED_HOSTS`/`_CIDRS`), the
 * same as any other upstream: a log destination is not a reason to open a hole
 * (AGENTS.md §4).
 */
async function defaultHttpTransport(url, body, config) {
    const { safeRequest } = require("./ssrf-guard");
    const res = await safeRequest(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-ndjson", ...(config.headers || {}) },
        body,
        timeoutMs: config.timeoutMs,
    });
    const status = res?.status ?? 0;
    if (status < 200 || status >= 300) throw new Error(`collector answered ${status}`);
    return status;
}

/**
 * File transport: ONE append per batch, so a record never interleaves mid-line.
 *
 * The parent directory is created on first use. Without it, a path whose
 * directory does not exist yet fails on every batch forever — counted as drops,
 * which is honest but useless: the operator configured a destination and got
 * silence. Creating it is what they meant.
 */
let fileDirsEnsured = new Set();
async function defaultFileTransport(path, body) {
    const fs = require("node:fs/promises");
    const nodePath = require("node:path");
    const dir = nodePath.dirname(path);
    if (!fileDirsEnsured.has(dir)) {
        await fs.mkdir(dir, { recursive: true });
        fileDirsEnsured.add(dir);
    }
    await fs.appendFile(path, body, "utf8");
}

/**
 * Attachment transport: the bytes as a file under the transcript's sidecar dir.
 *
 * Written once and never rewritten — the same attachment re-referenced by a later
 * message resolves to the same path, so an existing file is left alone rather
 * than re-serialized (`wx` fails with EEXIST, which is a success here).
 */
async function defaultAttachmentTransport(dir, relative, bytes) {
    const fs = require("node:fs/promises");
    const nodePath = require("node:path");
    const target = nodePath.join(dir, relative);
    await fs.mkdir(nodePath.dirname(target), { recursive: true });
    try {
        await fs.writeFile(target, bytes, { flag: "wx" });
    } catch (e) {
        if (e?.code !== "EEXIST") throw e;
    }
}

/**
 * A caller-supplied relative path, forced to stay inside the sidecar directory.
 *
 * The ids that build these paths are server-generated today, which is exactly
 * the argument that stops being true the first time an attachment name comes
 * from somewhere else. Traversal, absolute paths and Windows drive letters are
 * rejected outright rather than sanitized into something surprising; the rest is
 * reduced to a conservative character set.
 */
function safeRelativePath(value) {
    const raw = String(value || "").replace(/\\/g, "/").trim();
    if (!raw || raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) return null;
    const parts = [];
    for (const segment of raw.split("/")) {
        if (!segment || segment === ".") continue;
        if (segment === "..") return null;
        const clean = segment.replace(/[^A-Za-z0-9._-]/g, "_");
        if (!clean || clean === "." || clean === "..") return null;
        parts.push(clean.slice(0, 120));
    }
    return parts.length && parts.length <= 8 ? parts.join("/") : null;
}

/**
 * `sinks.stream` → a list of destination configs.
 *
 * Accepts one object or an array of them, because "ship to the collector AND
 * keep a local file" is the normal shape rather than an exotic one. A config
 * naming neither a `url` nor a `file` is dropped: it would otherwise queue
 * records forever against nothing.
 */
function normalizeStreamConfigs(value) {
    if (!value) return [];
    const list = Array.isArray(value) ? value : [value];
    const out = [];
    for (const raw of list) {
        if (!raw || typeof raw !== "object") continue;
        const url = typeof raw.url === "string" && raw.url.trim() ? raw.url.trim() : null;
        const file = typeof raw.file === "string" && raw.file.trim() ? raw.file.trim() : null;
        if (!url && !file) continue;
        out.push({
            url,
            file,
            headers: raw.headers && typeof raw.headers === "object" ? { ...raw.headers } : null,
            rotate: String(raw.rotate ?? "daily").toLowerCase() === "none" ? "none" : "daily",
            perProcess: raw.perProcess === true,
            minLevel: normalizeLevel(raw.minLevel, LEVELS.info),
            // Never defaults to true, and never reads a request-supplied value.
            includeSensitive: raw.includeSensitive === true,
            // Empty = every channel, which is what a destination without a filter
            // has always meant. A named list makes a purpose-built file possible
            // (one destination for the chat transcript, another for everything).
            channels: Array.isArray(raw.channels)
                ? raw.channels.map(c => normalizeChannel(c)).filter(Boolean)
                : [],
            // Bytes beside the transcript. Off unless asked for, and impossible
            // for a `url` destination, which has no sidecar to write into.
            attachments: raw.attachments === true,
            maxAttachmentBytes: Math.max(1024, Number(raw.maxAttachmentBytes) || DEFAULT_MAX_ATTACHMENT_BYTES),
            batchSize: Math.max(1, Number(raw.batchSize) || DEFAULT_STREAM_BATCH),
            flushIntervalMs: Math.max(100, Number(raw.flushIntervalMs) || DEFAULT_STREAM_FLUSH_MS),
            queueLimit: Math.max(10, Number(raw.queueLimit) || DEFAULT_STREAM_QUEUE),
            timeoutMs: Math.max(250, Number(raw.timeoutMs) || DEFAULT_STREAM_TIMEOUT_MS),
        });
    }
    return out;
}

/** Two stream configs are the same destination when every knob matches. */
function sameStreamConfig(a, b) {
    if (!a || !b) return false;
    const keys = ["url", "file", "rotate", "perProcess", "minLevel", "includeSensitive",
        "batchSize", "flushIntervalMs", "queueLimit", "timeoutMs", "attachments", "maxAttachmentBytes"];
    if (keys.some(key => a[key] !== b[key])) return false;
    if ((a.channels || []).join("|") !== (b.channels || []).join("|")) return false;
    return JSON.stringify(a.headers || null) === JSON.stringify(b.headers || null);
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
function createLogging({ getConfig, getStorage, devMode = false, baseConsole = console, streamTransports } = {}) {
    const readConfig = typeof getConfig === "function" ? getConfig : () => ({});
    const pid = process.pid;
    /** Live streaming destinations, reconciled from config on every reload. */
    let streams = [];
    const streamDeps = streamTransports || {};

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
        const stream = normalizeStreamConfigs(sinks.stream);

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
            stream,
            // Browser-supplied records. Off by default: this is the one INBOUND
            // path into the logs, so it stays a deliberate operator decision.
            client: {
                ingest: raw.client?.ingest === true,
                maxRecordsPerBatch: Math.max(1, Number(raw.client?.maxRecordsPerBatch) || 200),
                maxRecordBytes: Math.max(256, Number(raw.client?.maxRecordBytes) || 32_768),
                maxRecordsPerMinute: Math.max(10, Number(raw.client?.maxRecordsPerMinute) || 2_000),
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
        syncStreamDestinations(resolved.stream);
        return resolved;
    }

    /**
     * Reconcile the live destinations with the configured ones.
     *
     * Matched by VALUE, not by index: a config reload that only touched an
     * unrelated block must not tear down a working destination and lose what it
     * had queued. A destination that disappeared is closed, which flushes it.
     */
    function syncStreamDestinations(configs) {
        const kept = [];
        const survivors = new Set();
        for (const config of configs) {
            const existing = streams.find(d => !survivors.has(d) && sameStreamConfig(d.config, config));
            if (existing) { survivors.add(existing); kept.push(existing); continue; }
            kept.push(new LogStreamDestination(config, {
                ...streamDeps,
                warn: message => baseConsole.warn?.(message),
            }));
        }
        for (const destination of streams) {
            if (!kept.includes(destination)) destination.close();
        }
        streams = kept;
    }

    function writeStream(record, payload) {
        for (const destination of streams) destination.write(record, payload);
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

    /**
     * `payload` is out-of-band BYTES (an attachment) that belong with this record
     * but must never be serialized into it. It reaches the stream sink only: the
     * ring would pin megabytes of buffers for the life of the buffer, and the
     * console and the store have nowhere to put them.
     */
    function emit(channel, level, sensitive, args, bound, payload) {
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
        // One browser sitting. Pseudonymous by construction — it is a token the
        // client minted, not anything derived from the person — and it is what
        // makes a session reconstructible from a file full of interleaved records.
        if (bound?.clientSession) record.clientSession = bound.clientSession;
        if (sensitive) record.sensitive = true;

        stats.emitted++;
        const entry = cfg.buffer ? ring.push(record) : record;
        writeConsole(cfg, entry);
        if (cfg.store) writeStore(cfg, entry);
        if (streams.length) writeStream(entry, payload);
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
            /**
             * A record whose payload is BYTES — an attachment, a screenshot, an
             * uploaded file — carried out-of-band.
             *
             * The line gets a description (`file`, size, mime, whatever else is
             * passed); the bytes ride on the record under a symbol and never
             * reach `JSON.stringify`, so a destination that can hold them writes
             * a real file beside the transcript and one that cannot says so on
             * the line. Base64 in a log line is the thing this exists to avoid.
             *
             * Sensitive by definition: an attachment is user content.
             */
            attachment: ({ bytes, file, ...meta }, message = "ATTACHMENT") => {
                const size = bytes ? (bytes.byteLength ?? bytes.length ?? 0) : 0;
                return emit(name, "trace", true,
                    [{ attachment: { file, size, ...meta } }, message], bound,
                    bytes ? { bytes, file } : undefined);
            },
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
                    // Reported per destination: a stream that is silently failing
                    // (rising `failures`/`dropped`) is the thing an operator needs
                    // to see, and it is invisible from the record side.
                    stream: streams.length ? streams.map(d => d.snapshot()) : false,
                },
                clientIngest: cfg.client.ingest,
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
        /**
         * Push every stream destination now instead of at its next tick.
         *
         * For shutdown and for tests. Deliberately NOT called per record: the
         * whole point of the queue is that a request never waits on a collector.
         */
        flushStreams: () => Promise.all(streams.map(d => d.flush())).then(() => undefined),
        /**
         * The browser-ingest policy, resolved. Read by the RPC builtin — the
         * gate and its caps are config, so they live with the rest of the config
         * rather than being re-derived at the call site.
         */
        clientIngestPolicy: () => ({ ...resolveConfig().client }),
        /**
         * Accept records the BROWSER produced.
         *
         * Everything identifying is re-stamped from the verified context here,
         * because the body is attacker-controlled: a client says what happened,
         * never who it was or when the server saw it. The record then goes
         * through the ordinary `emit`, so channel levels, redaction and every
         * sink treat it exactly like a server record — which is the point of
         * accepting it at all.
         */
        ingestClientRecord({ channel, level, message, fields, sensitive }, bound = {}) {
            const cfg = resolveConfig();
            if (!cfg.client.ingest) return null;
            if (sensitive && !cfg.allowSensitive) return null;
            const name = `client:${normalizeChannel(channel || "app")}`;
            const args = fields && typeof fields === "object" ? [fields, String(message ?? "")] : [String(message ?? "")];
            return emit(name, normalizeLevel(level, null) === null ? "info" : levelName(normalizeLevel(level, LEVELS.info)),
                sensitive === true, args, { ...bound, source: "client" });
        },
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
    LogStreamDestination,
    normalizeStreamConfigs,
    createLogging,
    getServerLogging,
    setLoggingConfig,
    getLoggingConfig,
    normalizeLevel,
    levelName,
    sanitize,
};
