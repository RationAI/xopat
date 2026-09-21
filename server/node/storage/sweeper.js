"use strict";

const fs = require("node:fs");
const path = require("node:path");
const cluster = require("node:cluster");

/**
 * ONE sweep timer for the whole process.
 *
 * Before this, every bounded map on the server ran its own interval on its own
 * schedule (`index.js` sessions, `ssrf-guard`, `saml-flow`, `mixture-interface`,
 * the chat caches). A single pass over registered namespaces replaces all of
 * them, and — more usefully — gives one place to see what reclaimed what.
 *
 * ## Leader election
 *
 * A persistent namespace lives on a filesystem shared by every cluster worker.
 * N workers sweeping the same directories would duplicate the walk and race each
 * other's `rm`. Only the leader sweeps the persistent tier; every worker always
 * sweeps its own in-process tier.
 *
 * Leadership is a **lease on a lock file**, for every topology. It used to be
 * `cluster.worker.id === 1` when clustered, which had a fatal property: cluster
 * ids are monotonic and never reused, and `cluster-index.js` re-forks on every
 * exit — so the moment worker 1 died, its replacement was id N+1 and *no worker
 * ever satisfied the test again*. The persistent tier then went unswept for the
 * lifetime of the primary, accumulating expired records on disk without bound,
 * and the lockfile fallback could not save it because the cluster branch
 * returned first.
 *
 * The lease also covers the topologies `cluster.isWorker` never saw: k8s
 * replicas, PM2 fork mode, a container per replica — all of which share a
 * filesystem while each believing it is alone.
 *
 * Acquisition is `O_EXCL` create, then read-back verification: two processes
 * racing an unlocked file cannot both conclude they won, because the loser's
 * create fails and its subsequent read shows the winner's id. The holder
 * refreshes while it still owns the lease; a lease that goes stale (holder
 * crashed) is stolen by whoever notices first.
 */

const LOCK_FILE = ".sweep.lock";
/** A lease older than this is assumed abandoned. Must exceed the sweep period. */
const LOCK_STALE_MS = 5 * 60_000;
/** Identifies this process in the lease. Distinct per worker within one host. */
const HOLDER_ID = `${process.pid}:${cluster.isWorker ? cluster.worker.id : 0}`;

function createSweeper({ intervalMs = 60_000, root, logger = console } = {}) {
    /** @type {Map<string, {ns: object, driver: object}>} */
    const namespaces = new Map();
    let timer = null;
    let running = false;
    let disposed = false;

    function register(ns, driver) {
        namespaces.set(ns.id, { ns, driver });
        ensureTimer();
    }

    function unregister(nsId) {
        namespaces.delete(nsId);
    }

    /** Read the current lease, or null when absent/corrupt. */
    function readLease(lock) {
        try {
            const raw = JSON.parse(fs.readFileSync(lock, "utf8"));
            if (!raw || typeof raw !== "object") return null;
            return { holder: String(raw.holder ?? raw.pid ?? ""), at: Number(raw.at || 0) };
        } catch {
            return null;
        }
    }

    function writeLease(lock) {
        fs.writeFileSync(lock, JSON.stringify({ holder: HOLDER_ID, at: Date.now() }), "utf8");
    }

    /** Whether this process may sweep the shared persistent tier right now. */
    function claimLeadership() {
        if (!root) return true;
        const lock = path.join(root, LOCK_FILE);

        try {
            fs.mkdirSync(root, { recursive: true });
        } catch {
            // Cannot even create the storage root: sweep anyway rather than let
            // records accumulate forever. Duplicated work is survivable; a store
            // that never reclaims is not.
            return true;
        }

        const lease = readLease(lock);

        // We already hold it: refresh and continue. A failed refresh is not
        // fatal — we keep sweeping this round and retry next time.
        if (lease && lease.holder === HOLDER_ID) {
            try { writeLease(lock); } catch { /* keep the lease we have */ }
            return true;
        }

        // Someone else holds a live lease.
        if (lease && Date.now() - lease.at < LOCK_STALE_MS) return false;

        if (!lease) {
            // No lease at all: race for it with an exclusive create, so exactly
            // one of N simultaneous starters wins.
            try {
                fs.writeFileSync(lock, JSON.stringify({ holder: HOLDER_ID, at: Date.now() }), { flag: "wx" });
                return true;
            } catch (e) {
                if (e && e.code === "EEXIST") return false;    // lost the race
                return true;                                    // unwritable FS: sweep anyway
            }
        }

        // A stale lease: steal it, then read back to confirm we are the one who
        // did. Without the read-back, two processes noticing staleness in the
        // same tick would both claim.
        try {
            writeLease(lock);
        } catch {
            return true;                                        // unwritable FS: sweep anyway
        }
        const confirmed = readLease(lock);
        return !confirmed || confirmed.holder === HOLDER_ID;
    }

    async function sweepOnce() {
        if (running || disposed) return { swept: 0, removed: 0 };
        running = true;
        const leader = claimLeadership();
        let removed = 0;
        let swept = 0;
        try {
            for (const { ns, driver } of [...namespaces.values()]) {
                try {
                    removed += (await driver.sweep(ns, { leader })) || 0;
                    swept += 1;
                } catch (e) {
                    // One namespace failing must not stop the others; never log
                    // the values, only the namespace.
                    logger.warn?.(`[storage] sweep failed for ${ns.id}: ${e?.message || e}`);
                }
            }
        } finally {
            running = false;
        }
        return { swept, removed, leader };
    }

    function ensureTimer() {
        if (timer || disposed || !intervalMs) return;
        timer = setInterval(() => { sweepOnce().catch(() => {}); }, intervalMs);
        timer.unref?.();
    }

    function dispose() {
        disposed = true;
        if (timer) { clearInterval(timer); timer = null; }
        namespaces.clear();
        // Hand the lease back on a clean shutdown, so the next process to start
        // sweeps immediately instead of waiting out LOCK_STALE_MS.
        if (root) {
            try {
                const lock = path.join(root, LOCK_FILE);
                if (readLease(lock)?.holder === HOLDER_ID) fs.unlinkSync(lock);
            } catch { /* best effort */ }
        }
    }

    return { register, unregister, sweepOnce, dispose, get size() { return namespaces.size; } };
}

module.exports = { createSweeper };
