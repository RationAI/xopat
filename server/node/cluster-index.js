"use strict";

/**
 * Cluster supervisor: forks `XOPAT_WORKERS` copies of `index.js` and keeps them
 * alive.
 *
 * ## What this must get right
 *
 * The previous version was four lines of `cluster.fork()` and an unconditional
 * re-fork on `exit`. Three things went wrong with that:
 *
 * 1. **A deterministic boot failure became an infinite fork loop.** A bad
 *    `env.json`, an occupied port, a storage namespace that throws at
 *    construction — every one of them produced a worker that died immediately
 *    and was replaced immediately, burning a core and flooding the log. There
 *    is now backoff and a crash budget: if workers keep dying young, the
 *    supervisor gives up and exits non-zero so the orchestrator restarts (or
 *    stops restarting) the whole container, which is the level where a human
 *    will actually notice.
 *
 * 2. **Deliberate exits were treated as crashes.** `worker.exitedAfterDisconnect`
 *    is what distinguishes "we asked it to stop" from "it fell over"; without
 *    the check, shutting down re-forked everything we had just drained.
 *
 * 3. **There was no shutdown at all.** No SIGTERM handler anywhere in the tree,
 *    so `docker stop` killed workers mid-request: in-flight NDJSON streams cut
 *    without a terminal record, pending session write-backs (`res.on('finish')`)
 *    dropped. The supervisor now forwards the signal and gives workers a real
 *    drain window before escalating to SIGKILL.
 */

const cluster = require("node:cluster");
const os = require("node:os");
const path = require("node:path");

const workers = Math.max(1, Number(process.env.XOPAT_WORKERS || os.availableParallelism?.() || os.cpus().length || 1));
const entry = path.join(__dirname, "index.js");

/** A worker that dies sooner than this counts against the crash budget. */
const HEALTHY_UPTIME_MS = Math.max(1000, Number(process.env.XOPAT_WORKER_HEALTHY_MS) || 30_000);
/** Consecutive young deaths tolerated before the supervisor gives up. */
const CRASH_BUDGET = Math.max(1, Number(process.env.XOPAT_WORKER_CRASH_BUDGET) || 10);
/** Respawn backoff bounds. Doubles per consecutive young death, resets on a healthy one. */
const RESPAWN_BACKOFF_MIN_MS = 250;
const RESPAWN_BACKOFF_MAX_MS = 30_000;
/**
 * How long a worker gets to finish in-flight work on shutdown. Generous on
 * purpose: an LLM turn or a large region render legitimately takes minutes, and
 * killing one mid-stream is exactly the failure this window exists to avoid.
 * Keep it below the orchestrator's own kill timeout
 * (`docker stop -t`, k8s `terminationGracePeriodSeconds`).
 */
const SHUTDOWN_GRACE_MS = Math.max(1000, Number(process.env.XOPAT_SHUTDOWN_GRACE_MS) || 120_000);

function log(level, event, extra = {}) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, event, pid: process.pid, ...extra });
    if (level === "error") console.error(line);
    else console.log(line);
}

if (!cluster.isPrimary) {
    require(entry);
    return;
}

/** Wall-clock start per worker id, so we can tell a crash-loop from a one-off. */
const startedAt = new Map();
let consecutiveYoungDeaths = 0;
let shuttingDown = false;

function spawn() {
    if (shuttingDown) return;
    const worker = cluster.fork();
    startedAt.set(worker.id, Date.now());
}

log("info", "cluster.start", { workers });
for (let i = 0; i < workers; i += 1) spawn();

cluster.on("exit", (worker, code, signal) => {
    const began = startedAt.get(worker.id) || Date.now();
    const uptimeMs = Date.now() - began;
    startedAt.delete(worker.id);

    if (shuttingDown) {
        log("info", "cluster.worker_exit", { workerPid: worker.process.pid, code, signal, uptimeMs, duringShutdown: true });
        return;
    }

    // We asked for this one (drain / reload). Replacing it would undo the ask.
    if (worker.exitedAfterDisconnect) {
        log("info", "cluster.worker_retired", { workerPid: worker.process.pid, code, signal, uptimeMs });
        spawn();
        return;
    }

    log("error", "cluster.worker_exit", { workerPid: worker.process.pid, code, signal, uptimeMs });

    if (uptimeMs >= HEALTHY_UPTIME_MS) {
        // Ran long enough to have served traffic: a normal crash, not a boot
        // failure. Replace it immediately and forget the history.
        consecutiveYoungDeaths = 0;
        spawn();
        return;
    }

    consecutiveYoungDeaths += 1;
    if (consecutiveYoungDeaths >= CRASH_BUDGET) {
        log("error", "cluster.crash_budget_exhausted", {
            deaths: consecutiveYoungDeaths,
            healthyUptimeMs: HEALTHY_UPTIME_MS,
            hint: "workers are failing during startup; check the worker log above for the underlying error",
        });
        shuttingDown = true;
        // Non-zero so the supervisor above us (docker/systemd/k8s) sees a
        // failure rather than a clean stop.
        process.exit(1);
    }

    const delay = Math.min(
        RESPAWN_BACKOFF_MAX_MS,
        RESPAWN_BACKOFF_MIN_MS * Math.pow(2, consecutiveYoungDeaths - 1),
    );
    log("error", "cluster.respawn_backoff", { delayMs: delay, consecutiveYoungDeaths });
    setTimeout(spawn, delay).unref();
});

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log("info", "cluster.shutdown", { signal, graceMs: SHUTDOWN_GRACE_MS });

    // Forward rather than disconnect(): index.js installs its own handler and
    // knows how to end streams with a terminal record and flush session
    // write-backs. `disconnect()` alone would close the channel underneath it.
    for (const worker of Object.values(cluster.workers || {})) {
        try { worker.process.kill(signal); } catch (_) { /* already gone */ }
    }

    const deadline = setTimeout(() => {
        log("error", "cluster.shutdown_timeout", { graceMs: SHUTDOWN_GRACE_MS });
        for (const worker of Object.values(cluster.workers || {})) {
            try { worker.process.kill("SIGKILL"); } catch (_) { /* already gone */ }
        }
        process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    deadline.unref();

    const poll = setInterval(() => {
        if (Object.keys(cluster.workers || {}).length === 0) {
            clearInterval(poll);
            clearTimeout(deadline);
            log("info", "cluster.shutdown_complete", { signal });
            process.exit(0);
        }
    }, 200);
    poll.unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
