"use strict";

/**
 * BoundedCache — the one in-process LRU/TTL engine for the whole server.
 *
 * Before this existed every server-side subsystem that needed to remember
 * something hand-rolled its own `Map` plus (sometimes) a bespoke sweeper: the
 * browser-session store, the SSRF host-verdict cache, the MIXTURE auth-verdict
 * cache, the chat model/media caches, the provider factory caches. Seven
 * implementations, seven schedules, no introspection, and several of them
 * unbounded.
 *
 * Two consumers:
 *  - `XOPAT_SERVER.cache` — direct use, for values that CANNOT be serialized
 *    (promises, KeyObjects, SDK client instances, decoded buffers).
 *  - the `memory` storage driver — the front tier of `XOPAT_SERVER.storage`.
 *
 * Design notes that matter:
 *  - **Idle TTL.** `expiresAt` is recomputed on `get`/`set`/`touch`, NOT on
 *    `peek` or iteration. An entry that is read stays alive; browsing the cache
 *    does not immortalize it.
 *  - **Per-entry TTL override** survives touches, so "anonymous sessions expire
 *    faster than authenticated ones" is one argument, not a second cache.
 *  - **`onEvict` fires on EVERY removal path** with a reason. That is what lets
 *    a caller release a side resource (a file on disk, a purge of derived
 *    state) without racing the cache.
 *  - **Never log values.** Entries hold API keys, tokens and patient-adjacent
 *    payloads; only keys and counts are ever printed.
 *  - The sweep timer is `.unref()`ed so a live cache never keeps the process
 *    alive.
 */

const registry = new Set();

/** Removal reasons passed to `onEvict`. Exhaustive by design. */
const EVICT_REASONS = Object.freeze({
    TTL: "ttl",
    LRU: "lru",
    BYTES: "bytes",
    REPLACE: "replace",
    DELETE: "delete",
    CLEAR: "clear",
});

const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

function positiveOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** Depth/breadth caps: bound the estimator's own cost on hostile shapes. */
const ESTIMATE_MAX_DEPTH = 6;
const ESTIMATE_MAX_NODES = 512;

/**
 * Cheap byte estimate for a value with no `sizeOf` provided. Deliberately rough
 * — the byte budget is a safety rail, not an accounting system — but it must at
 * least be proportional to the value.
 *
 * The flat 256 bytes it used to charge for *any* plain object made `maxBytes`
 * unable to bound anything that matters. The tiered driver's front tier stores
 * `{value, version}` ENVELOPES, so every cached record — a 5 MB decoded region
 * included — was accounted as 256 bytes, and `frontMaxBytes` was decorative.
 *
 * A bounded walk fixes that without becoming an accounting system: recursion
 * stops at ESTIMATE_MAX_DEPTH and after ESTIMATE_MAX_NODES visited nodes, so a
 * pathological graph costs a fixed amount to measure. Cyclic references are
 * tracked, because a cache value that is a live object graph is normal here.
 */
function estimateBytes(value) {
    let budget = ESTIMATE_MAX_NODES;
    const seen = new WeakSet();

    const walk = (v, depth) => {
        if (v == null) return 8;
        switch (typeof v) {
            case "string": return v.length * 2;
            case "number": case "boolean": return 8;
            case "bigint": return 16;
            case "object": break;
            default: return 64;
        }
        if (Buffer.isBuffer(v)) return v.byteLength;
        if (ArrayBuffer.isView(v)) return v.byteLength;
        if (v instanceof ArrayBuffer) return v.byteLength;

        // A promise, a KeyObject, an SDK client — no meaningful size, and
        // walking one would reach into internals. Nominal charge.
        if (typeof v.then === "function") return 256;
        if (seen.has(v)) return 0;
        seen.add(v);

        if (depth >= ESTIMATE_MAX_DEPTH || budget <= 0) return 256;

        let total = 32;                                  // container overhead
        if (Array.isArray(v)) {
            for (const item of v) {
                if (budget-- <= 0) { total += 256; break; }
                total += walk(item, depth + 1);
            }
            return total;
        }
        // Own enumerable properties only: a class instance's prototype methods
        // are shared, not per-entry cost.
        for (const key of Object.keys(v)) {
            if (budget-- <= 0) { total += 256; break; }
            total += key.length * 2 + walk(v[key], depth + 1);
        }
        return total;
    };

    return walk(value, 0);
}

class BoundedCache {
    /**
     * @param {object} opts
     * @param {string} opts.name                 stable id, shown in stats()
     * @param {number} [opts.maxEntries]         entry-count cap (LRU)
     * @param {number} [opts.ttlMs]              idle lifetime, refreshed on read
     * @param {number} [opts.maxBytes]           byte budget (LRU by bytes)
     * @param {(v:any, k:string)=>number} [opts.sizeOf]
     * @param {(k:string, v:any, reason:string)=>void} [opts.onEvict]
     * @param {number} [opts.sweepIntervalMs]    0 disables the timer (the shared
     *                                           storage sweeper drives it instead)
     */
    constructor(opts = {}) {
        if (!opts.name) throw new Error("BoundedCache requires a name.");
        this.name = String(opts.name);
        this.maxEntries = positiveOrNull(opts.maxEntries);
        this.ttlMs = positiveOrNull(opts.ttlMs);
        this.maxBytes = positiveOrNull(opts.maxBytes);
        this.sizeOf = typeof opts.sizeOf === "function" ? opts.sizeOf : null;
        this.onEvict = typeof opts.onEvict === "function" ? opts.onEvict : null;

        /** @type {Map<string, {value:any, bytes:number, expiresAt:number|null, ttlMs:number|null}>} */
        this._map = new Map();
        this._bytes = 0;
        this._stats = { hits: 0, misses: 0, ttl: 0, lru: 0, bytes: 0 };
        this._disposed = false;

        const sweepEvery = opts.sweepIntervalMs === 0
            ? 0
            : (positiveOrNull(opts.sweepIntervalMs) ?? DEFAULT_SWEEP_INTERVAL_MS);
        this._timer = null;
        if (sweepEvery && this.ttlMs) {
            this._timer = setInterval(() => {
                try { this.sweep(); } catch { /* a cache sweep must never crash the process */ }
            }, Math.min(sweepEvery, this.ttlMs));
            this._timer.unref?.();
        }

        registry.add(this);
    }

    get size() { return this._map.size; }
    get bytes() { return this._bytes; }

    /** Read + LRU touch + idle-TTL refresh. Lazily expires. */
    get(key) {
        const entry = this._map.get(key);
        if (!entry) { this._stats.misses += 1; return undefined; }
        if (this._expired(entry)) {
            this._remove(key, entry, EVICT_REASONS.TTL);
            this._stats.misses += 1;
            this._stats.ttl += 1;
            return undefined;
        }
        this._stats.hits += 1;
        // delete+set re-inserts at the back: Map iterates in insertion order, so
        // the front is always the least-recently-used entry.
        this._map.delete(key);
        this._refresh(entry);
        this._map.set(key, entry);
        return entry.value;
    }

    /** Read WITHOUT touching recency or refreshing the TTL. */
    peek(key) {
        const entry = this._map.get(key);
        if (!entry) return undefined;
        if (this._expired(entry)) {
            this._remove(key, entry, EVICT_REASONS.TTL);
            this._stats.ttl += 1;
            return undefined;
        }
        return entry.value;
    }

    has(key) { return this.peek(key) !== undefined; }

    /**
     * @param {string} key
     * @param {any} value
     * @param {{ttlMs?:number, bytes?:number}} [options] per-entry TTL override
     *        (survives touches) and an explicit byte size.
     */
    set(key, value, options = {}) {
        if (this._disposed) return;
        const existing = this._map.get(key);
        if (existing) this._remove(key, existing, EVICT_REASONS.REPLACE);

        const bytes = positiveOrNull(options.bytes)
            ?? (this.sizeOf ? Number(this.sizeOf(value, key)) || 0 : estimateBytes(value));
        const entryTtl = positiveOrNull(options.ttlMs) ?? this.ttlMs;
        const entry = {
            value,
            bytes,
            ttlMs: positiveOrNull(options.ttlMs),
            expiresAt: entryTtl ? Date.now() + entryTtl : null,
        };
        this._map.set(key, entry);
        this._bytes += bytes;
        this._enforce();
    }

    /** Refresh recency + idle TTL without reading. Returns false if absent. */
    touch(key) {
        const entry = this._map.get(key);
        if (!entry || this._expired(entry)) return false;
        this._map.delete(key);
        this._refresh(entry);
        this._map.set(key, entry);
        return true;
    }

    delete(key) {
        const entry = this._map.get(key);
        if (!entry) return false;
        this._remove(key, entry, EVICT_REASONS.DELETE);
        return true;
    }

    clear() {
        for (const [key, entry] of [...this._map]) {
            this._remove(key, entry, EVICT_REASONS.CLEAR);
        }
        this._map.clear();
        this._bytes = 0;
    }

    /** Non-touching iterators. Expired entries are skipped, not reaped. */
    *keys() { for (const [k, e] of this._map) if (!this._expired(e)) yield k; }
    *values() { for (const [, e] of this._map) if (!this._expired(e)) yield e.value; }
    *entries() { for (const [k, e] of this._map) if (!this._expired(e)) yield [k, e.value]; }
    [Symbol.iterator]() { return this.entries(); }

    /** Drop every expired entry now. Returns how many went. */
    sweep() {
        let removed = 0;
        for (const [key, entry] of [...this._map]) {
            if (this._expired(entry)) {
                this._remove(key, entry, EVICT_REASONS.TTL);
                this._stats.ttl += 1;
                removed += 1;
            }
        }
        return removed;
    }

    /** Runtime limit update; re-enforces immediately. */
    reconfigure(partial = {}) {
        if ("maxEntries" in partial) this.maxEntries = positiveOrNull(partial.maxEntries);
        if ("ttlMs" in partial) this.ttlMs = positiveOrNull(partial.ttlMs);
        if ("maxBytes" in partial) this.maxBytes = positiveOrNull(partial.maxBytes);
        this._enforce();
    }

    stats() {
        return {
            name: this.name,
            size: this._map.size,
            bytes: this._bytes,
            maxEntries: this.maxEntries,
            maxBytes: this.maxBytes,
            ttlMs: this.ttlMs,
            hits: this._stats.hits,
            misses: this._stats.misses,
            evicted: { ttl: this._stats.ttl, lru: this._stats.lru, bytes: this._stats.bytes },
        };
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        this.clear();
        registry.delete(this);
    }

    // ── internals ────────────────────────────────────────────────────────────

    _expired(entry) {
        return entry.expiresAt !== null && entry.expiresAt <= Date.now();
    }

    _refresh(entry) {
        const ttl = entry.ttlMs ?? this.ttlMs;
        entry.expiresAt = ttl ? Date.now() + ttl : null;
    }

    /**
     * Single removal chokepoint so `onEvict` can never be skipped and the byte
     * counter can never drift. Listener failures are swallowed — an eviction
     * hook must not be able to corrupt the cache or crash a request.
     */
    _remove(key, entry, reason) {
        this._map.delete(key);
        this._bytes -= entry.bytes;
        if (this._bytes < 0) this._bytes = 0;
        if (!this.onEvict) return;
        try {
            const r = this.onEvict(key, entry.value, reason);
            if (r && typeof r.catch === "function") r.catch(() => {});
        } catch { /* never log the value */ }
    }

    _enforce() {
        if (this.maxEntries) {
            while (this._map.size > this.maxEntries) {
                const oldest = this._map.keys().next();
                if (oldest.done) break;
                this._remove(oldest.value, this._map.get(oldest.value), EVICT_REASONS.LRU);
                this._stats.lru += 1;
            }
        }
        if (this.maxBytes) {
            while (this._bytes > this.maxBytes && this._map.size > 0) {
                const oldest = this._map.keys().next();
                if (oldest.done) break;
                this._remove(oldest.value, this._map.get(oldest.value), EVICT_REASONS.BYTES);
                this._stats.bytes += 1;
            }
        }
    }
}

function createBoundedCache(opts) {
    return new BoundedCache(opts);
}

/** Snapshot of every live cache — the dev introspection route reads this. */
function getAllCacheStats() {
    return [...registry].map(c => c.stats());
}

module.exports = {
    BoundedCache,
    createBoundedCache,
    getAllCacheStats,
    EVICT_REASONS,
    // Exported for tests: the byte budget is only as good as this estimate, and
    // "every object counts as 256 bytes" regressed silently once already.
    estimateBytes,
};
