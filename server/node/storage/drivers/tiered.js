"use strict";

const cluster = require("node:cluster");

/**
 * Tiered driver: a bounded memory front over a durable back (default
 * `memory` + `file`). This is the default binding, and it is what makes the
 * two headline properties true at once:
 *
 *  - **Bounded RAM.** The front tier evicts by entries/bytes/TTL.
 *  - **No data loss on eviction.** Eviction drops only the cached copy; the back
 *    tier still answers, so a record that falls out of RAM mid-request simply
 *    costs one read instead of turning into an `Unknown session` error.
 *
 * ## Coherency
 *
 * `server/node/cluster-index.js` forks `XOPAT_WORKERS` processes. A naive memory
 * cache in front of a shared file store would serve stale data after a sibling
 * worker writes — which is exactly the class of bug that makes chat sessions
 * "randomly" lose history today.
 *
 * In `shared` mode every front-tier hit is validated against the back tier's
 * version stamp (an `fs.stat` — microseconds, and far cheaper than the JSON
 * parse it avoids). `single` mode skips that check. The mode is auto-detected
 * from `cluster.isWorker` and can be pinned per namespace.
 *
 * Blobs are never cached in the front tier: keeping attachment bytes resident is
 * the memory profile this whole subsystem exists to fix. Logs cache only a tail
 * window.
 */

const LOG_TAIL_CACHE = 64;

function autoCoherency() {
    return cluster.isWorker ? "shared" : "single";
}

function createTieredDriver(options = {}) {
    const front = options.front;
    const back = options.back;
    if (!front || !back) throw new Error("tiered storage driver requires front and back drivers.");

    /** Front-tier namespace view: its own policy so bounds apply to the cache. */
    function frontNs(ns) {
        return {
            ...ns,
            id: `${ns.id}#front`,
            policy: {
                ...(ns.policy || {}),
                maxBytes: ns.policy?.frontMaxBytes ?? options.memory?.maxBytes ?? ns.policy?.maxBytes,
            },
            // Front-tier eviction is not a deletion — the record still exists in
            // the back tier, so owner-visible onEvict must NOT fire here.
            onEvict: undefined,
        };
    }

    function coherencyOf(ns) {
        return ns.policy?.coherency || options.coherency || autoCoherency();
    }

    /** Cached `{value, version}` envelope so a stale front entry is detectable. */
    async function validated(ns, key, cached) {
        if (coherencyOf(ns) === "single") return cached.value;
        const stat = await back.stat(ns, key);
        if (!stat) return undefined;                    // deleted elsewhere
        if (stat.version !== cached.version) return undefined;
        return cached.value;
    }

    const driver = {
        id: options.id || "tiered",
        supports: ["kv", "log", "blob"],
        persistent: back.persistent === true,
        shared: back.shared === true,
        front,
        back,

        // ── kv ───────────────────────────────────────────────────────────────
        async get(ns, key) {
            const cached = await front.get(frontNs(ns), key);
            if (cached) {
                const value = await validated(ns, key, cached);
                if (value !== undefined) return value;
            }
            const value = await back.get(ns, key);
            if (value === null || value === undefined) return null;
            const stat = await back.stat(ns, key);
            await front.set(frontNs(ns), key, { value, version: stat?.version ?? null });
            return value;
        },
        async set(ns, key, value, meta = {}) {
            // Write-through: the back tier is the source of truth, so it must
            // land before anything can read the cached copy.
            await back.set(ns, key, value, meta);
            const stat = await back.stat(ns, key);
            await front.set(frontNs(ns), key, { value, version: stat?.version ?? null }, meta);
        },
        async delete(ns, key) {
            await front.delete(frontNs(ns), key);
            // A log's cached tail window lives under a separate front-tier key,
            // so dropping only the record left the window behind. In `shared`
            // coherency the stale entry is caught by the version check, but in
            // `single` mode nothing revalidates it and a deleted transcript kept
            // reading back.
            if (ns.shape === "log") await front.delete(frontNs(ns), `log:${key}`);
            return back.delete(ns, key);
        },
        async has(ns, key) {
            return back.has(ns, key);
        },
        async touch(ns, key) {
            await front.touch(frontNs(ns), key);
            return back.touch(ns, key);
        },
        async stat(ns, key) {
            return back.stat(ns, key);
        },
        async *scan(ns, opts) {
            // Listing always goes to the back tier: a partial cache would make
            // `listSessions` silently incomplete.
            yield* back.scan(ns, opts);
        },
        async keys(ns, opts) {
            return back.keys(ns, opts);
        },
        async clear(ns, opts) {
            await front.clear(frontNs(ns), opts);
            return back.clear(ns, opts);
        },

        // ── log ──────────────────────────────────────────────────────────────
        async append(ns, key, entries) {
            const length = await back.append(ns, key, entries);
            await front.delete(frontNs(ns), `log:${key}`);
            return length;
        },
        async range(ns, key, opts = {}) {
            const tail = opts.tail;
            if (!tail || tail > LOG_TAIL_CACHE) return back.range(ns, key, opts);
            const cacheKey = `log:${key}`;
            const cached = await front.get(frontNs(ns), cacheKey);
            if (cached) {
                const value = await validated(ns, key, cached);
                if (value !== undefined && value.length >= tail) {
                    return value.slice(value.length - tail);
                }
            }
            const window = await back.range(ns, key, { tail: LOG_TAIL_CACHE });
            const stat = await back.stat(ns, key);
            await front.set(frontNs(ns), cacheKey, { value: window, version: stat?.version ?? null });
            return window.slice(Math.max(0, window.length - tail));
        },
        async length(ns, key) {
            return back.length(ns, key);
        },
        async trim(ns, key, keepTail) {
            await front.delete(frontNs(ns), `log:${key}`);
            return back.trim(ns, key, keepTail);
        },

        // ── blob (never cached) ──────────────────────────────────────────────
        async put(ns, key, source, meta) { return back.put(ns, key, source, meta); },
        async read(ns, key) { return back.read(ns, key); },
        async open(ns, key) { return back.open(ns, key); },

        // ── lifecycle ────────────────────────────────────────────────────────
        async sweep(ns, opts = {}) {
            const dropped = await front.sweep(frontNs(ns));
            // Only the sweep leader touches the shared back tier; every worker
            // always reclaims its own front tier.
            if (opts.leader === false) return dropped;
            return dropped + await back.sweep(ns, opts);
        },
        reconfigure(ns) {
            front.reconfigure?.(frontNs(ns));
            back.reconfigure?.(ns);
        },
        stats() {
            return [...(front.stats?.() || []), ...(back.stats?.() || [])];
        },
        dispose() {
            front.dispose?.();
            back.dispose?.();
        },
    };

    return driver;
}

module.exports = { createTieredDriver };
