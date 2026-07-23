const van = (globalThis as any).van;
const { div, span } = van.tags;

/** Trail entries kept expanded; older ones collapse into a single "+N earlier" line. */
const VISIBLE_TRAIL_STEPS = 4;
/** A note stays put at least this long before a newer one may replace it. */
const NOTE_MIN_DWELL_MS = 2500;
/** After this long on one activity, the activity line admits it is a long wait. */
const STILL_WORKING_AFTER_MS = 30000;

type TrailEntry = {
    label: string;
    startedAt: number;
    /** null while running; seconds once finished. */
    seconds: number | null;
    ok: boolean | null;
};

/**
 * The pending-turn bubble: what the assistant last said (sticky), what it is doing right now
 * (churning), and what it already did (trail).
 *
 * The chat is non-streaming — one whole model reply lands per step and nothing at all is known
 * in between — so the only honest liveness signal during a call is a clock. This owns it: a
 * single 1s interval that writes one van state. Everything else animates on the compositor
 * (daisyUI spinner, opacity pulse) and the DOM tree never churns after `node()` builds it.
 *
 * The note is deliberately separate from the activity. The model's own words are worth far more
 * than a generic phrase, so they persist across the next step (and its several silent seconds)
 * and are replaced only by newer model words — never by a fallback. See `setNote`.
 */
export class ChatProgress {
    _node: HTMLElement | null;
    _note: any;
    _activity: any;
    _stepLabel: any;
    _elapsed: any;
    _trail: any;
    _earlier: any;

    _startedAt: number;
    _activitySince: number;
    _noteSetAt: number;
    _pendingNote: string | null;
    _tickHandle: any;
    _dwellHandle: any;
    _entries: TrailEntry[];
    _running: TrailEntry | null;

    constructor() {
        this._node = null;
        this._note = van.state("");
        this._activity = van.state("");
        this._stepLabel = van.state("");
        this._elapsed = van.state("");
        this._trail = van.state([] as TrailEntry[]);
        this._earlier = van.state(0);

        this._startedAt = 0;
        this._activitySince = 0;
        this._noteSetAt = 0;
        this._pendingNote = null;
        this._tickHandle = null;
        this._dwellHandle = null;
        this._entries = [];
        this._running = null;
    }

    /** Builds on first call; the same node is reused across rerenders so state survives them. */
    node(): HTMLElement {
        if (this._node) return this._node;

        const meta = () => {
            const parts = [this._activity.val, this._stepLabel.val, this._elapsed.val].filter(Boolean);
            return parts.join(" · ");
        };

        this._node = div(
            { class: "flex mb-2 justify-start" },
            div(
                {
                    class: "flex flex-col gap-1 w-[88%] max-w-[100%] rounded-xl px-2 py-2 " +
                        "text-[12px] leading-snug bg-base-200/40 border border-base-300",
                },
                // The assistant's own words — no pulse, no spinner: this line is meant to be read.
                () => this._note.val
                    ? div({ class: "whitespace-pre-wrap opacity-90" }, this._note.val)
                    : span({ class: "hidden" }),
                div(
                    { class: "flex items-center gap-2" },
                    span({ class: "loading loading-spinner loading-xs shrink-0 opacity-60" }),
                    span({ class: "opacity-70 italic animate-pulse" }, meta),
                ),
                () => {
                    const entries = this._trail.val as TrailEntry[];
                    const earlier = this._earlier.val as number;
                    if (!entries.length && !earlier) return span({ class: "hidden" });
                    return div(
                        { class: "flex flex-col gap-0.5 pl-5 opacity-60 text-[11px]" },
                        earlier ? div({}, $.t('chat.progressEarlierSteps', { count: earlier })) : null,
                        ...entries.map((entry) => div(
                            { class: "flex items-center gap-1" },
                            span({ class: `shrink-0 ${this._trailIconClass(entry)}` }),
                            span({ class: "truncate" }, entry.label),
                            entry.seconds != null
                                ? span({ class: "opacity-70 shrink-0" },
                                    $.t('chat.progressElapsedSeconds', { seconds: entry.seconds }))
                                : null,
                        )),
                    );
                },
            ),
        ) as HTMLElement;
        return this._node;
    }

    _trailIconClass(entry: TrailEntry): string {
        if (entry.ok === null) return "ph-light ph-circle-notch animate-spin";
        return entry.ok ? "ph-light ph-check text-success" : "ph-light ph-x text-error";
    }

    /** Starts the clock. Idempotent — restarting an already running progress keeps its state. */
    start(): void {
        if (this._tickHandle) return;
        const now = Date.now();
        this._startedAt = now;
        this._activitySince = now;
        this._tick();
        this._tickHandle = setInterval(() => this._tick(), 1000);
    }

    /** Stops every timer. Must be called on every turn exit, including aborts and errors. */
    stop(): void {
        if (this._tickHandle) clearInterval(this._tickHandle);
        if (this._dwellHandle) clearTimeout(this._dwellHandle);
        this._tickHandle = null;
        this._dwellHandle = null;
        this._pendingNote = null;
    }

    /**
     * The assistant's own sentence for what it is doing. Empty text is ignored — when the model
     * emitted script and no prose there is nothing better to say than what it said last time, so
     * the previous note stands. A note younger than the dwell window defers its replacement
     * rather than flashing.
     */
    setNote(text: string): void {
        const next = String(text || "").trim();
        if (!next || next === this._note.val) return;

        const age = Date.now() - this._noteSetAt;
        if (this._note.val && age < NOTE_MIN_DWELL_MS) {
            this._pendingNote = next;
            if (!this._dwellHandle) {
                this._dwellHandle = setTimeout(() => {
                    this._dwellHandle = null;
                    const queued = this._pendingNote;
                    this._pendingNote = null;
                    if (queued) this._commitNote(queued);
                }, NOTE_MIN_DWELL_MS - age);
            }
            return;
        }
        this._commitNote(next);
    }

    _commitNote(text: string): void {
        this._note.val = text;
        this._noteSetAt = Date.now();
    }

    /** The churning line — generic phrases belong here, never in the note. */
    setActivity(text: string): void {
        const next = String(text || "").trim();
        if (next === this._activity.val) return;
        this._activity.val = next;
        this._activitySince = Date.now();
        this._tick();
    }

    /**
     * A bare count, no total: the loop's cap is an abort threshold, not an estimate of the work
     * (and it grows when steps keep succeeding), so any denominator would be a prediction nobody
     * made. Hidden on the first step, where the spinner already says everything the count would.
     */
    setStep(index: number): void {
        this._stepLabel.val = index > 1 ? $.t('chat.progressStep', { index }) : "";
    }

    beginStep(label: string): void {
        const entry: TrailEntry = { label: String(label || ""), startedAt: Date.now(), seconds: null, ok: null };
        this._running = entry;
        this._entries.push(entry);
        this._publishTrail();
    }

    endStep(ok: boolean): void {
        const entry = this._running;
        if (!entry) return;
        entry.ok = !!ok;
        entry.seconds = Math.max(1, Math.round((Date.now() - entry.startedAt) / 1000));
        this._running = null;
        this._publishTrail();
    }

    _publishTrail(): void {
        this._earlier.val = Math.max(0, this._entries.length - VISIBLE_TRAIL_STEPS);
        this._trail.val = this._entries.slice(-VISIBLE_TRAIL_STEPS).map((entry) => ({ ...entry }));
    }

    _tick(): void {
        if (!this._startedAt) return; // activity may be set before the clock starts
        const seconds = Math.round((Date.now() - this._startedAt) / 1000);
        const waited = Date.now() - this._activitySince;
        const elapsed = seconds >= 60
            ? $.t('chat.progressElapsedMinutes', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
            : $.t('chat.progressElapsedSeconds', { seconds });
        this._elapsed.val = waited >= STILL_WORKING_AFTER_MS
            ? `${elapsed} · ${$.t('chat.progressStillWorking')}`
            : elapsed;
    }
}
