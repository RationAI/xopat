/**
 * RequestScheduler — a per-origin admission gate for *background* HTTP.
 *
 * The browser serves at most ~6 concurrent HTTP/1.1 connections per host. When
 * tiles and long-lived work (e.g. LLM vision-inference RPCs) resolve to the same
 * origin (tiles proxied through the app server), those slow POSTs occupy
 * connection slots and interactive tile requests queue behind them — navigation
 * stalls. There is otherwise no cross-cutting priority across all the native
 * `fetch` traffic in the app.
 *
 * This scheduler is the single client-side concurrency bound for background
 * traffic. Only the `background` lane is gated; `high`/`normal` requests never
 * enter here (the tile path — `HttpClient.fetchRaw` — is untouched). Background
 * admission is capped per origin so a bounded share of the connection pool is
 * always left for tiles, and the cap drops further while tiles are actively
 * loading:
 *
 *   - busy (any viewer's `imageLoader.jobsInProgress > 0`) → {@link _busyLimit}
 *   - idle                                                 → {@link _idleLimit}
 *
 * With the defaults (2 idle / **0 busy**) background HARD-yields while tiles load —
 * tiles get the whole ~6-slot pool — while idle it runs 2 at a time. To keep
 * background from freezing under sustained navigation, a queued request that has
 * waited `maxStarveMs` (default 1500) is admitted anyway, capped at
 * {@link STARVE_MAX_INFLIGHT}=1. A ~150 ms lane heartbeat re-checks admission so a
 * busy→idle transition resumes background within ~150 ms without tile-event wiring.
 * All three are plain performance preferences (non-security, so `getOption` is
 * fine) — `requestSchedulerBgIdle` / `requestSchedulerBgBusy` /
 * `requestSchedulerMaxStarveMs`.
 *
 * **Reserved urgent slot.** Some background traffic is latency-critical rather
 * than bulk: live dictation transcription is useless if it lands 10 s late, and a
 * dropped/aborted segment loses words permanently. Callers mark it with
 * {@link AcquireOptions.jumpQueue} (`priority: "background-urgent"`), which — beyond
 * queue-jumping — reserves {@link DEFAULT_URGENT_RESERVED}=1 concurrent slot that is
 * granted *even while tiles load*, and shortens its starvation window to
 * {@link DEFAULT_URGENT_STARVE_MS}=250 ms. Bulk background still hard-yields at
 * busy-limit 0, so tiles keep all but one connection slot. Knobs:
 * `requestSchedulerUrgentReserved` / `requestSchedulerUrgentStarveMs`.
 *
 * Exposed as `APPLICATION_CONTEXT.requestScheduler` (constructed by the
 * application-context factory alongside `httpClient` / `networkStatus`).
 * `HttpClient.request` acquires a slot when the caller passes
 * `priority: "background"`; inference + transcription RPCs and the z-plane
 * prefetcher tag their traffic that way.
 */

interface AcquireOptions {
    /** Aborts a *queued* wait — a superseded/cancelled caller frees its slot. */
    signal?: AbortSignal;
    /**
     * Enqueue ahead of bulk background waiters AND claim the reserved urgent slot
     * (see the file header): admitted even while tiles load, with a 250 ms
     * starvation window instead of 1500 ms. For latency-sensitive background
     * traffic — e.g. dictation transcription, where a late or aborted request
     * loses spoken words. FIFO is preserved among jumpers.
     */
    jumpQueue?: boolean;
}

interface Lane {
    inFlight: number;
    /** Subset of `inFlight` admitted as urgent — bounded by `_urgentReserved`. */
    urgentInFlight: number;
    queue: Array<{
        grant: () => void;
        reject: (reason?: any) => void;
        signal?: AbortSignal;
        onAbort?: () => void;
        /** Wall-clock enqueue time, for anti-starvation admission. */
        enqueuedAt: number;
        /** True = queued ahead of bulk waiters (see {@link AcquireOptions.jumpQueue}). */
        jump: boolean;
    }>;
    /** ~RETRY_INTERVAL_MS heartbeat while `queue` is non-empty (picks up busy→idle + starvation). */
    retryTimer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_IDLE_LIMIT = 2;
/** While tiles load, admit ZERO background (tiles take the whole pool); starvation is the escape. */
const DEFAULT_BUSY_LIMIT = 0;
/** A queued background request waiting this long is admitted even while busy, so it never freezes. */
const DEFAULT_MAX_STARVE_MS = 1500;
/** Max concurrent background admitted *via starvation* while busy — keep tiles maximally free. */
const STARVE_MAX_INFLIGHT = 1;
/** Concurrent slots held open for `jumpQueue` traffic regardless of the busy cap. */
const DEFAULT_URGENT_RESERVED = 1;
/** Starvation window for `jumpQueue` waiters that exceed the reserved slots. */
const DEFAULT_URGENT_STARVE_MS = 250;
/** Re-check cadence while the queue is backed up (no tile-event wiring needed). */
const RETRY_INTERVAL_MS = 150;

function abortReason(signal?: AbortSignal): any {
    if (signal && (signal as any).reason !== undefined) return (signal as any).reason;
    try { return new DOMException("Aborted", "AbortError"); }
    catch (_) { const e = new Error("Aborted"); (e as any).name = "AbortError"; return e; }
}

export class RequestScheduler {
    private static _instance: RequestScheduler | null = null;

    private _lanes = new Map<string, Lane>();
    private _idleLimit = DEFAULT_IDLE_LIMIT;
    private _busyLimit = DEFAULT_BUSY_LIMIT;
    private _maxStarveMs = DEFAULT_MAX_STARVE_MS;
    private _urgentReserved = DEFAULT_URGENT_RESERVED;
    private _urgentStarveMs = DEFAULT_URGENT_STARVE_MS;
    private _limitsRead = false;

    private constructor() {}

    /** Lazy singleton accessor. */
    static instance(): RequestScheduler {
        if (!RequestScheduler._instance) {
            RequestScheduler._instance = new RequestScheduler();
        }
        return RequestScheduler._instance;
    }

    /**
     * Acquire a background slot for `origin`. Resolves with a `release()` once a
     * slot is free (immediately when under the current cap, otherwise FIFO). If
     * `signal` aborts while queued, the entry is dropped and the promise rejects
     * so a stale caller never wastes a slot. `release()` is idempotent.
     */
    acquire(origin: string, opts: AcquireOptions = {}): Promise<() => void> {
        const { signal, jumpQueue } = opts;
        if (signal?.aborted) return Promise.reject(abortReason(signal));

        const jump = !!jumpQueue;
        const lane = this._lane(origin);
        return new Promise<() => void>((resolve, reject) => {
            const grant = () => {
                lane.inFlight++;
                if (jump) lane.urgentInFlight++;
                let released = false;
                resolve(() => {
                    if (released) return;
                    released = true;
                    lane.inFlight--;
                    if (jump) lane.urgentInFlight--;
                    this._pump(origin);
                });
            };

            // Fast path: no contention under the live cap. An urgent caller may
            // also take its reserved slot immediately — it must not queue behind
            // bulk waiters that the busy cap is (correctly) holding back.
            const noneAhead = jump
                ? !lane.queue.some((q) => q.jump)
                : lane.queue.length === 0;
            if (noneAhead && (lane.inFlight < this._bgLimit() || (jump && lane.urgentInFlight < this._urgentSlots()))) {
                grant();
                return;
            }

            const entry: Lane["queue"][number] = { grant, reject, signal, enqueuedAt: Date.now(), jump };
            if (signal) {
                entry.onAbort = () => {
                    const i = lane.queue.indexOf(entry);
                    if (i >= 0) lane.queue.splice(i, 1);
                    this._syncRetryTimer(origin, lane);
                    reject(abortReason(signal));
                };
                signal.addEventListener("abort", entry.onAbort, { once: true });
            }
            if (jump) {
                // Insert after the last existing jumper — ahead of all bulk waiters,
                // FIFO among jumpers.
                let i = 0;
                while (i < lane.queue.length && lane.queue[i].jump) i++;
                lane.queue.splice(i, 0, entry);
            } else {
                lane.queue.push(entry);
            }
            // Attempt admission now (covers idle-with-queue: a slot may be free but
            // FIFO made us queue) and arm the heartbeat for whatever stays queued.
            this._pump(origin);
        });
    }

    /** Debug/verify snapshot: per-origin background occupancy and the live cap. */
    stats(): Record<string, { inFlight: number; urgentInFlight: number; queued: number; urgentQueued: number; bgLimit: number; urgentSlots: number; busy: boolean; oldestWaitMs: number }> {
        this._ensureLimits();
        const busy = this._busy();
        const limit = busy ? this._busyLimit : this._idleLimit;
        const now = Date.now();
        const out: Record<string, { inFlight: number; urgentInFlight: number; queued: number; urgentQueued: number; bgLimit: number; urgentSlots: number; busy: boolean; oldestWaitMs: number }> = {};
        for (const [origin, lane] of this._lanes) {
            const head = lane.queue[0];
            out[origin] = {
                inFlight: lane.inFlight,
                urgentInFlight: lane.urgentInFlight,
                queued: lane.queue.length,
                urgentQueued: lane.queue.reduce((n, q) => n + (q.jump ? 1 : 0), 0),
                bgLimit: limit,
                urgentSlots: this._urgentReserved,
                busy,
                oldestWaitMs: head ? now - head.enqueuedAt : 0,
            };
        }
        return out;
    }

    private _lane(origin: string): Lane {
        let lane = this._lanes.get(origin);
        if (!lane) { lane = { inFlight: 0, urgentInFlight: 0, queue: [], retryTimer: null }; this._lanes.set(origin, lane); }
        return lane;
    }

    /**
     * Admit queued waiters (called on release, on enqueue, and on the retry
     * heartbeat). Normally admits up to `bgLimit` (0 while tiles load); the head
     * is also admitted once it has starved (`maxStarveMs`), capped at
     * `STARVE_MAX_INFLIGHT`, so background never freezes under sustained tile load.
     */
    private _pump(origin: string): void {
        const lane = this._lanes.get(origin);
        if (!lane) return;
        while (lane.queue.length && this._canAdmitHead(lane)) {
            const entry = lane.queue.shift()!;
            if (entry.onAbort && entry.signal) entry.signal.removeEventListener("abort", entry.onAbort);
            entry.grant();
        }
        this._syncRetryTimer(origin, lane);
    }

    /**
     * Whether the queue head may be admitted right now: under the live cap, else
     * (urgent only) into a reserved slot, else via the starvation escape — whose
     * window is shorter for urgent waiters.
     *
     * Jumpers are always queued ahead of bulk waiters, so inspecting the head alone
     * never hides an admissible urgent request behind a blocked bulk one.
     */
    private _canAdmitHead(lane: Lane): boolean {
        const head = lane.queue[0];
        if (!head) return false;
        if (lane.inFlight < this._bgLimit()) return true;
        if (head.jump) {
            const slots = this._urgentSlots();
            if (lane.urgentInFlight < slots) return true;
            return (Date.now() - head.enqueuedAt) >= this._urgentStarveMs
                && lane.inFlight < Math.max(STARVE_MAX_INFLIGHT, slots);
        }
        return (Date.now() - head.enqueuedAt) >= this._maxStarveMs
            && lane.inFlight < STARVE_MAX_INFLIGHT;
    }

    /** Concurrent slots held open for urgent traffic irrespective of the busy cap. */
    private _urgentSlots(): number {
        this._ensureLimits();
        return this._urgentReserved;
    }

    /** Keep a ~RETRY_INTERVAL_MS heartbeat alive iff the queue is non-empty. */
    private _syncRetryTimer(origin: string, lane: Lane): void {
        if (lane.queue.length > 0) {
            if (lane.retryTimer === null) {
                lane.retryTimer = setTimeout(() => { lane.retryTimer = null; this._pump(origin); }, RETRY_INTERVAL_MS);
            }
        } else if (lane.retryTimer !== null) {
            clearTimeout(lane.retryTimer);
            lane.retryTimer = null;
        }
    }

    private _bgLimit(): number {
        this._ensureLimits();
        return this._busy() ? this._busyLimit : this._idleLimit;
    }

    /** True while any viewer is actively loading tiles — reserve the pool then. */
    private _busy(): boolean {
        try {
            const vm = (globalThis as any).VIEWER_MANAGER;
            const viewers: any[] = vm?.viewers;
            if (!Array.isArray(viewers)) return false;
            for (const v of viewers) {
                if ((v?.imageLoader?.jobsInProgress || 0) > 0) return true;
            }
        } catch (_) { /* degrade to "idle" — never block on a probe failure */ }
        return false;
    }

    /** Read the perf caps once, lazily (getOption isn't ready at construction). */
    private _ensureLimits(): void {
        if (this._limitsRead) return;
        try {
            const ac = (globalThis as any).APPLICATION_CONTEXT;
            if (ac && typeof ac.getOption === "function") {
                // No caller defaults: the DEFAULT_* constants already seed the
                // private fields, and a literal here would shadow the
                // deployment `ENV.setup` value (see getOption precedence).
                const idle = Number(ac.getOption("requestSchedulerBgIdle"));
                const busy = Number(ac.getOption("requestSchedulerBgBusy"));
                const starve = Number(ac.getOption("requestSchedulerMaxStarveMs"));
                const urgent = Number(ac.getOption("requestSchedulerUrgentReserved"));
                const urgentStarve = Number(ac.getOption("requestSchedulerUrgentStarveMs"));
                if (Number.isFinite(idle) && idle >= 1) this._idleLimit = Math.floor(idle);
                if (Number.isFinite(busy) && busy >= 0) this._busyLimit = Math.floor(busy);
                if (Number.isFinite(starve) && starve >= 0) this._maxStarveMs = Math.floor(starve);
                if (Number.isFinite(urgent) && urgent >= 0) this._urgentReserved = Math.floor(urgent);
                if (Number.isFinite(urgentStarve) && urgentStarve >= 0) this._urgentStarveMs = Math.floor(urgentStarve);
                this._limitsRead = true;
            }
        } catch (_) { /* keep defaults */ }
    }
}
