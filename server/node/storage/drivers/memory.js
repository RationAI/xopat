"use strict";

const { createBoundedCache } = require("../bounded-cache");

/**
 * In-process driver. `persistent: false`, `shared: false` — nothing survives a
 * restart and nothing is visible to a sibling cluster worker.
 *
 * Semantics note that matters for callers: this driver returns the STORED
 * REFERENCE, while a persistent driver necessarily returns a fresh copy. Code
 * must therefore never rely on mutating a returned value in place to persist it
 * — write it back explicitly. Doing so is what keeps a namespace re-bindable to
 * a durable driver without a behavior change (see the core session write-back
 * in `server/node/index.js`).
 */

const MAX_LOG_TAIL = 100_000;

function cacheNameFor(ns) {
    return `storage:${ns.shape}:${ns.ownerUid}/${ns.namespace}`;
}

function createMemoryDriver(options = {}) {
    /** @type {Map<string, import("../bounded-cache").BoundedCache>} */
    const caches = new Map();

    function cacheFor(ns) {
        let cache = caches.get(ns.id);
        if (!cache) {
            const policy = ns.policy || {};
            cache = createBoundedCache({
                name: cacheNameFor(ns),
                maxEntries: policy.maxEntries,
                ttlMs: policy.ttlMs,
                maxBytes: policy.maxBytes ?? options.maxBytes,
                sizeOf: ns.shape === "blob"
                    ? (v) => (v && v.data ? v.data.byteLength : 0)
                    : undefined,
                // The shared storage sweeper drives eviction; per-cache timers
                // would put one interval per namespace back on the process.
                sweepIntervalMs: 0,
                // A namespace's onEvict means "the STORE removed this", not
                // "something was removed". Caller-initiated removals
                // (delete/clear/replace) are already known to the caller, and
                // firing on them would double-notify — the file driver likewise
                // only reports its sweep. Reasons are therefore filtered here.
                onEvict: typeof ns.onEvict === "function"
                    ? (key, value, reason) => {
                        if (reason === "ttl" || reason === "lru" || reason === "bytes") {
                            return ns.onEvict(key, value, reason);
                        }
                        return undefined;
                    }
                    : undefined,
            });
            caches.set(ns.id, cache);
        }
        return cache;
    }

    return {
        id: options.id || "memory",
        supports: ["kv", "log", "blob"],
        persistent: false,
        shared: false,

        // ── kv ───────────────────────────────────────────────────────────────
        async get(ns, key) {
            const hit = cacheFor(ns).get(key);
            return hit === undefined ? null : hit;
        },
        async set(ns, key, value, meta = {}) {
            cacheFor(ns).set(key, value, { ttlMs: meta.ttlMs, bytes: meta.bytes });
        },
        async delete(ns, key) {
            return cacheFor(ns).delete(key);
        },
        async has(ns, key) {
            return cacheFor(ns).has(key);
        },
        async touch(ns, key) {
            return cacheFor(ns).touch(key);
        },
        async stat(ns, key) {
            const cache = cacheFor(ns);
            if (!cache.has(key)) return null;
            return { bytes: 0, updatedAt: null, version: null };
        },
        async *scan(ns, { prefix = "" } = {}) {
            for (const [key, value] of cacheFor(ns).entries()) {
                if (!prefix || key.startsWith(prefix)) yield [key, value];
            }
        },
        async keys(ns, { prefix = "", limit = 0 } = {}) {
            const out = [];
            for (const key of cacheFor(ns).keys()) {
                if (prefix && !key.startsWith(prefix)) continue;
                out.push(key);
                if (limit && out.length >= limit) break;
            }
            return out;
        },
        async clear(ns, { prefix = "" } = {}) {
            const cache = cacheFor(ns);
            if (!prefix) { cache.clear(); return; }
            for (const key of [...cache.keys()]) {
                if (key.startsWith(prefix)) cache.delete(key);
            }
        },

        // ── log ──────────────────────────────────────────────────────────────
        // Stored as a plain array behind the same cache entry, so a log key is
        // subject to the namespace TTL exactly like a kv key.
        async append(ns, key, entries) {
            const cache = cacheFor(ns);
            const current = cache.get(key) || [];
            const next = current.concat(entries);
            const cap = ns.policy?.maxEntries;
            const trimmed = cap && next.length > cap ? next.slice(next.length - cap) : next;
            cache.set(key, trimmed);
            return trimmed.length;
        },
        async range(ns, key, { from = 0, to, tail } = {}) {
            const current = cacheFor(ns).get(key) || [];
            if (tail) return current.slice(Math.max(0, current.length - Math.min(tail, MAX_LOG_TAIL)));
            return current.slice(from, to === undefined ? undefined : to);
        },
        async length(ns, key) {
            return (cacheFor(ns).peek(key) || []).length;
        },
        async trim(ns, key, keepTail) {
            const cache = cacheFor(ns);
            const current = cache.get(key);
            if (!current || current.length <= keepTail) return current ? current.length : 0;
            const next = current.slice(current.length - keepTail);
            cache.set(key, next);
            return next.length;
        },

        // ── blob ─────────────────────────────────────────────────────────────
        // `{ data: Buffer, contentType }`. Kept only so a namespace can be bound
        // to `memory` for tests / ephemeral deployments; production blobs belong
        // on a persistent driver by default.
        async put(ns, key, source, meta = {}) {
            const data = Buffer.isBuffer(source) ? source : await bufferOf(source);
            cacheFor(ns).set(key, { data, contentType: meta.contentType || null }, {
                ttlMs: meta.ttlMs,
                bytes: data.byteLength,
            });
            return { bytes: data.byteLength, etag: null };
        },
        async read(ns, key) {
            const hit = cacheFor(ns).get(key);
            return hit ? hit.data : null;
        },
        async open(ns, key) {
            const data = await this.read(ns, key);
            if (!data) return null;
            const { Readable } = require("node:stream");
            return Readable.from(data);
        },

        // ── lifecycle ────────────────────────────────────────────────────────
        async sweep(ns) {
            const cache = caches.get(ns.id);
            return cache ? cache.sweep() : 0;
        },
        reconfigure(ns) {
            const cache = caches.get(ns.id);
            if (cache) cache.reconfigure(ns.policy || {});
        },
        stats() {
            return [...caches.values()].map(c => c.stats());
        },
        dispose() {
            for (const cache of caches.values()) cache.dispose();
            caches.clear();
        },
    };
}

async function bufferOf(source) {
    if (Buffer.isBuffer(source)) return source;
    if (typeof source === "string") return Buffer.from(source, "utf8");
    if (ArrayBuffer.isView(source)) return Buffer.from(source.buffer, source.byteOffset, source.byteLength);
    const chunks = [];
    for await (const chunk of source) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
}

module.exports = { createMemoryDriver, bufferOf };
