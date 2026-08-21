// Voice input controls for the chat composer.
//
// Thin orchestration layer over the standalone `speech-to-text` module: it owns
// no audio/transcription logic (that lives in the module, reachable via the
// `singletonModule` global — no cross-boundary ES import). It renders a manual
// dictate button and a hands-free "auto conversation" toggle, and coordinates
// with the ChatPanel purely through the callbacks passed in `options`.
//
// UX guarantees:
//  - silence auto-stop (delegated to the module);
//  - never submit an empty transcript — and silence is never transcribed at all
//    (the module refuses to send speech-less audio to a model), so a quiet,
//    thinking user can never produce hallucinated "Thank you."-style turns;
//  - manual dictation fills the input for review (no surprise auto-send);
//  - auto mode runs ONE persistent listening session: the mic keeps capturing
//    even while the assistant computes a reply, completed turns are queued and
//    submitted as soon as the assistant is idle — user speech is never dropped,
//    only deferred;
//  - transcript-only (dictation/reporting) mode submits per transcribed SEGMENT
//    (see setSubmitPerSegment): utterances land in the transcript mid-monologue
//    instead of waiting for end-of-turn silence;
//  - an inactivity timer (idleAutoOffMs, default 5 min without real speech)
//    switches auto mode off so the microphone can never stay hot forever;
//  - editing the composer PAUSES hands-free capture (pauseForEdit): appended
//    speech rewrites the box and drags the caret, so the microphone steps aside
//    while the user types and comes back on send (resumeAuto) — nothing said in
//    between is dropped, it is parked and queued with the resume;
//  - speech captured while the assistant has been computing for longer than
//    `busyHoldMs` is HELD as an editable composer draft instead of being
//    auto-submitted (see shared/voice-hold.ts) — a long reply must not turn
//    thinking out loud into the next question.

import {matchHoldCommand, parsePhraseList, shouldHoldNow, type HoldPhrases} from "../shared/voice-hold";
import {decideLiveness} from "../shared/voice-liveness";

const {Button, FAIcon, PhIcon} = (globalThis as any).UI;
const {span} = (globalThis as any).van.tags;

/**
 * How long a graceful stop waits: for the trailing segment's transcription to land
 * (`finishTimeoutMs` on the dictation session) and then for the submit queue to
 * drain. One budget for both halves of "finish and submit" — a manual stop is a
 * promise that nothing said is dropped, and 20 s covers a full-length final segment
 * whose upload queued behind tile traffic.
 */
const FINISH_TIMEOUT_MS = 20000;

/**
 * How long the assistant may compute before hands-free speech stops being treated
 * as part of the conversation. Below this the user is still finishing the thought
 * they just asked about ("…and also the stroma"); well past it they are waiting,
 * and what they say is as likely to be a correction, a colleague, or thinking
 * aloud. Four seconds keeps every short reply behaving exactly as before.
 */
const DEFAULT_BUSY_HOLD_MS = 4000;

/** Period of the session heartbeat watchdog; also the baseline for its own tick lag. */
const WATCHDOG_PERIOD_MS = 1000;

/**
 * How long capture may go without a heartbeat before it is treated as stalled.
 * Deliberately short, because it no longer ends anything on its own: a stall first
 * re-opens the microphone in place (see `staleRestartAttempts`), and a tick that was
 * itself delayed past this window is discarded as evidence rather than acted on.
 */
const DEFAULT_STALE_SESSION_MS = 8000;

/** In-place microphone restarts before a stalled session is declared lost. */
const DEFAULT_STALE_RESTARTS = 2;

export interface ChatVoiceControllerOptions {
    /** Append recognized text to the composer input (for review). */
    fillInput: (text: string) => void;
    /** Programmatically send the current input; resolves when the turn finishes. */
    submit: () => Promise<void>;
    /** Is the composer ready to accept/send input (provider + login + consent)? */
    isReady: () => boolean;
    /** Is an assistant turn currently running? */
    isBusy: () => boolean;
    /** Reflect a short status string in the composer status line. */
    setStatus: (message: string) => void;
    /**
     * Remove text this controller appended to the composer, if it is still there
     * verbatim. Used when a held draft is discarded — the words were never sent, so
     * they should leave the box too. A consumer must leave the user's own edits
     * alone: their version of the text outranks our bookkeeping.
     */
    clearDraft?: (text: string) => void;
    /**
     * Drive the composer's recording UI. `listening` fires repeatedly with a live
     * 0..1 input level; `processing` while transcribing; `held` while a captured
     * draft is waiting for the user to send or discard it (the composer must stay
     * readable then); `paused` while hands-free is armed but the microphone is
     * released because the user is editing the draft; `idle` when done/hidden.
     */
    onVoiceUI?: (state: "listening" | "processing" | "held" | "idle" | "paused", level?: number) => void;
    /**
     * Notified when a held draft is opened (`active: true`, with the text captured
     * so far) and when it is released or discarded (`active: false`). Lets an
     * external observer show its own "waiting for you to send" affordance. Must not
     * throw.
     */
    onHold?: (state: { active: boolean; text: string }) => void;
    /**
     * Observe every recognized speech segment, accepted or rejected, before it is
     * submitted. Lets an external driver follow dictation without owning the mic
     * lifecycle; purely observational — the return value is ignored and a throwing
     * handler must not break capture (callers wrap it).
     */
    onSegment?: (segment: ChatVoiceSegmentPayload) => void;
    /**
     * Notified on every listening/auto transition — manual start/stop, hands-free
     * arm/disarm, and every self-shutoff (inactivity, watchdog, session end,
     * Send-flush) — including the edit pause, where `auto` stays true while
     * `listening` drops and `paused` rises. Lets an external observer (e.g. a
     * report-assist plugin) track the shared capture instead of polling `isAuto`
     * once. Must not throw.
     */
    onStateChange?: (state: { listening: boolean; auto: boolean; paused: boolean }) => void;
    /**
     * Notified when transcription of a captured segment begins (`active:true`) and
     * ends (`active:false`, success or failure). Lets an external observer show a
     * "transcribing…" indicator away from the composer. Must not throw.
     */
    onTranscribing?: (state: { active: boolean }) => void;
    /**
     * Notified when transcription fails outright (all drivers exhausted, or a
     * permanent driver-configuration error). In hands-free mode this is otherwise
     * silent — the segment just resolves empty — so an external observer (e.g. a
     * report-assist plugin) needs this to tell the user. Must not throw.
     */
    onVoiceError?: (info: { message: string; permanent: boolean; code?: string; recoverable?: boolean }) => void;
    /**
     * Notified when an archived dictation WINDOW (~90 s decoded with full surrounding
     * context, in the background) finishes transcribing. Far more accurate than the
     * per-segment text of the same stretch, so a consumer keeping an authoritative
     * transcript should prefer it. Must not throw.
     */
    onWindow?: (window: { index: number; text: string; fromSegment: number; toSegment: number; final: boolean }) => void;
    /** BCP-47 language hint forwarded to the transcription driver. */
    language?: string;
    /**
     * Domain/vocabulary biasing hint forwarded to the transcription driver
     * (Whisper `prompt`) so pathology homophones resolve correctly ("histology"
     * not "history"). A string, or a function evaluated lazily at each capture so
     * the hint can fold in live viewer terms. The module length-caps it.
     */
    prompt?: string | (() => string | undefined);
    /** Silence auto-stop window (ms). Falls back to the module's own default. */
    silenceMs?: number;
    /** Auto-submit a manual dictation instead of just filling the input. */
    autoSubmit?: boolean;
    /**
     * @deprecated No longer used: silence produces no captures at all (the module
     * never transcribes speech-less audio), so an "empty streak" cannot occur.
     * Superseded by `idleAutoOffMs`.
     */
    maxEmptyRetries?: number;
    /** Settle delay between an assistant reply and the next queued submission (ms). */
    reArmDelayMs?: number;
    /**
     * End-of-turn silence (ms) for hands-free auto mode. While the user keeps
     * talking (with only short pauses) the mic stays hot and segments are
     * transcribed and concatenated *during* capture — nothing is lost while a
     * segment is being transcribed. Once the user is quiet for this longer window
     * the concatenated turn is submitted. Should be larger than `silenceMs` (the
     * per-segment cut). Default 2000.
     */
    turnSilenceMs?: number;
    /**
     * VAD noise robustness: how far above the adaptive noise floor a peak must sit
     * to count as speech. Higher = more resistant to background noise, but risks
     * dropping a very quiet speaker. Default 3.0.
     */
    speechFloorMult?: number;
    /**
     * VAD noise robustness: minimum sustained ms above the speech gate before a peak
     * is treated as speech onset. Rejects brief blips/noise bursts. Default 200.
     */
    minSpeechMs?: number;
    /**
     * @deprecated No longer used: a silent user simply keeps the session waiting
     * (nothing is transcribed, nothing is submitted). Superseded by
     * `idleAutoOffMs`, the only remaining hands-free safety timer.
     */
    noValidContentMs?: number;
    /**
     * Hands-free inactivity auto-off (ms): after this long without any *valid*
     * speech turn, auto mode switches itself off (with a status note) so the
     * microphone can never stay hot forever. A thinking user is fine — the timer
     * is generous by default (300000 = 5 min) and resets on every real turn.
     */
    idleAutoOffMs?: number;
    /**
     * Minimum voiced milliseconds a segment must contain before it is transcribed
     * at all (forwarded to the speech-to-text module; falls back to the module's
     * own `minVoicedMs`, default 250).
     */
    minVoicedMs?: number;
    /**
     * Minimum letter/number count a capture must contain to be treated as speech.
     * Below this it is discarded as noise and never auto-submitted. Guards against
     * Whisper transcribing a stray sound or cough into a one-token fragment that
     * hands-free mode would otherwise fire off as a real turn.
     */
    minCaptureChars?: number;
    /**
     * Hard cap (ms) on one hands-free segment. Bounds how long an uninterrupted
     * monologue can go without partial text (and thus without any downstream
     * progress) — the segment is cut and transcribed at this bound even while
     * the speaker keeps talking. Default 10000.
     */
    maxSegmentMs?: number;
    /**
     * Called whenever a shutdown path would otherwise silently discard
     * captured-and-transcribed turns (watchdog / idle-off / not-ready stopAuto,
     * finishAuto drain timeout). Wrapped — a throwing handler is logged, never
     * fatal.
     *
     * `text` is the joined pending text — one utterance, for one transcript
     * message. `pieces` are the individual segment texts it was joined from, which
     * a consumer needs to re-report them one by one: each piece was already
     * delivered as its own accepted segment, so a downstream buffer can recognise
     * and drop a duplicate piece, while the join matches nothing and is banked a
     * second time.
     */
    onLostText?: (text: string, pieces: string[]) => void;
    /**
     * The user explicitly RETRACTED captured speech (the discard action on a held
     * draft) — the semantic opposite of `onLostText`. Salvage means "keep these
     * words, they never reached the transcript"; a retraction means "these words
     * were already reported and must now be taken back". A consumer that banked
     * the pieces as accepted segments has to remove them, not append them.
     *
     * `pieces` are the individual segment texts exactly as they were delivered
     * while capturing, so an exact match retracts what was banked; `text` is
     * their join, for a consumer that only keeps whole utterances.
     */
    onDiscardedText?: (text: string, pieces: string[]) => void;
    /**
     * Heartbeat staleness (ms): while auto-listening with a visible tab, if no
     * sign of life has arrived from CAPTURE for this long — recorder data, a level
     * tick, a transcribed segment — the session is treated as stalled. Default
     * 8000. 0 disables the watchdog entirely.
     *
     * A stall no longer ends the session by itself: it re-opens the microphone in
     * place up to `staleRestartAttempts` times first. And a watchdog tick that was
     * itself delayed longer than this window (a multi-second task on the main
     * thread, a frozen tab, a suspended machine) is discarded rather than acted on
     * — that gap measures the observer's outage, not the microphone's.
     */
    staleSessionMs?: number;
    /**
     * How many times a stalled capture is restarted IN PLACE before the session is
     * declared lost (default 2; 0 restores the old fail-immediately behaviour).
     * Restarts back off (0.5 s, 1 s, …) and keep the queued turns, the held draft,
     * the edit pause and the retained recording — only the microphone is re-opened.
     */
    staleRestartAttempts?: number;
    /**
     * How long the assistant may be computing before hands-free speech is HELD as
     * an editable composer draft instead of being auto-submitted when the reply
     * lands (default 4000). A long reply used to concatenate everything said while
     * waiting — corrections, side conversation, thinking aloud — into the next
     * question; past this window the user decides what goes out.
     *
     * 0 disables holding entirely and restores the pure auto-submit loop.
     * Ignored in transcript-only mode, which has no assistant turn to wait out.
     */
    busyHoldMs?: number;
    /**
     * Let a whole spoken utterance release a held draft ("send it") or drop it
     * ("scratch that"), so hands-free mode does not need a hand after every long
     * reply. Default true; the phrases themselves come from the locale (or the
     * overrides below) and only ever match a COMPLETE utterance.
     */
    holdVoiceCommands?: boolean;
    /** Override the spoken "send the draft" phrases. `|`-separated, or a list. */
    holdConfirmPhrases?: string | string[];
    /** Override the spoken "drop the draft" phrases. `|`-separated, or a list. */
    holdDiscardPhrases?: string | string[];
}

type Stt = any;

export class ChatVoiceController {
    private _opts: ChatVoiceControllerOptions;
    private _stt: Stt | null;
    private _available = false;

    private _root: HTMLElement | null = null;
    private _micBtnEl: HTMLButtonElement | null = null;
    private _micIcon: any = null;      // PhIcon; swapped microphone <-> microphone-slash
    private _autoBtnEl: HTMLButtonElement | null = null;
    /** In-flight manual dictation (transcribe + fill), awaited by finishAndFlush. */
    private _activeDictation: Promise<void> | null = null;

    private _listening = false;
    private _auto = false;
    private _disabled = false;
    /** The persistent continuous session handle while auto mode is on. */
    private _contHandle: any = null;
    /** Completed turns awaiting submission (filled while the assistant is busy). */
    private _pendingTurns: string[] = [];
    /** True while `_maybeSubmit` drains the queue (one submission at a time). */
    private _submitting = false;
    /** Inactivity auto-off timer (see `idleAutoOffMs`). */
    private _idleTimer: number | null = null;
    /** Interval watching `isReady()` so the mic never lingers past a teardown. */
    private _watchdog: number | null = null;
    /** Monotonic segment counter within the current continuous session (for onSegment). */
    private _segmentIndex = 0;
    /** Panel-set re-arm override (e.g. 0 in transcript-only mode); null = use configured value. */
    private _reArmOverride: number | null = null;
    /** Panel-set segment-cap override (shorter in transcript-only mode); null = use configured value. */
    private _maxSegmentOverride: number | null = null;
    /** Panel-set: submit each accepted segment immediately as its own utterance (transcript-only mode). */
    private _submitPerSegment = false;
    /** Record the whole session for an end-of-dictation single-pass re-transcription. */
    private _archiveAudio = false;
    /** Archive window length override; null = the module default. */
    private _windowOverride: number | null = null;
    /** Last transcribing state emitted, so observers only see transitions (and teardown can force-clear). */
    private _transcribingActive = false;
    /** Transcriptions this controller started without a live capture (session re-transcribe). */
    private _ownedTranscribes = 0;
    /** Timestamp of the last sign of life from capture (heartbeat/level/turn/transcribing). */
    private _lastAliveAt = 0;
    /**
     * Capture has proven itself at least once this session, so silence now means
     * something. Before that, a quiet session is a START failure — a different
     * problem with a different message — and the watchdog stays out of it.
     */
    private _sawAlive = false;
    /** When the watchdog last ran, so a tick can measure how late IT was. */
    private _lastTickAt = 0;
    /** In-place restarts attempted for the current stall; reset by a healthy heartbeat. */
    private _staleAttempts = 0;
    /** Re-entrancy guard for `_restartSession`, which awaits the old session's flush. */
    private _restarting = false;
    /** Ring of the last 10 watchdog ticks; logged when a stall is acted on. */
    private _tickLog: any[] = [];
    /** `_submitPerSegment` as captured at startAuto — the running session's mode. */
    private _sessionPerSegment = false;
    /** When the assistant became busy (epoch ms), 0 while idle. Drives the hold grace. */
    private _busySince = 0;
    /** Fires at the end of the grace window and opens the hold. */
    private _holdTimer: number | null = null;
    /** True while a captured draft waits in the composer for an explicit send/discard. */
    private _held = false;
    /** The utterances that make up the held draft, in the order they were appended. */
    private _heldPieces: string[] = [];
    /** Drain instruction: submit the composer as it stands (a released hold). */
    private _submitComposer = false;
    /**
     * True while hands-free is armed but the microphone is released because the user
     * is editing the composer. Capture appending text (and moving the caret) under a
     * typing user is the interference this exists to stop; the send resumes it.
     */
    private _paused = false;
    /** Speech that landed while paused (the trailing utterance of the finished session). */
    private _pausedPieces: string[] = [];

    constructor(options: ChatVoiceControllerOptions) {
        this._opts = options;
        // Silence auto-stop is what makes hands-free (and click-free dictation)
        // work; default it so voice mode is usable without extra config. A
        // deployment can still override or disable it (0) via `voice.silenceMs`.
        if (this._opts.silenceMs === undefined || this._opts.silenceMs === null) {
            this._opts.silenceMs = 1500;
        }
        if (this._opts.minCaptureChars === undefined || this._opts.minCaptureChars === null) {
            this._opts.minCaptureChars = 2;
        }
        // End-of-turn silence for hands-free mode. Must exceed the per-segment
        // silence so a normal between-sentence pause doesn't end the turn early.
        if (this._opts.turnSilenceMs === undefined || this._opts.turnSilenceMs === null) {
            this._opts.turnSilenceMs = Math.max(2000, (this._opts.silenceMs ?? 0) + 500);
        }
        // Resolve the standalone module if it is loaded; absent => controls hide.
        this._stt = (window as any).singletonModule?.("speech-to-text") || null;
    }

    /** True once the module reports a usable driver + mic permission. */
    get available(): boolean {
        return this._available;
    }

    /**
     * Override the post-submit re-arm delay. The panel sets 0 while in
     * transcript-only mode (no assistant reply to let settle); null restores
     * the configured `reArmDelayMs`.
     */
    setReArmDelayMs(ms: number | null): void {
        this._reArmOverride = ms;
    }

    /**
     * Override the hands-free per-segment hard cap (`maxSegmentMs`). The panel
     * sets a shorter cap while in transcript-only (dictation/reporting) mode so
     * a non-stop monologue yields transcribed segments — and thus downstream
     * extraction progress — more often; null restores the configured value.
     * Takes effect from the next continuous session (a running one keeps its cap).
     */
    setMaxSegmentMs(ms: number | null): void {
        this._maxSegmentOverride = ms;
    }

    /**
     * Submit every accepted transcribed segment immediately as its own utterance
     * instead of waiting for the end-of-turn silence. The panel sets this while
     * in transcript-only (dictation/reporting) mode: there is no assistant reply
     * to batch a complete thought for, and downstream extraction wants progress
     * mid-monologue. Takes effect from the next continuous session (same
     * semantics as `setMaxSegmentMs`), so a live toggle can never double- or
     * drop-submit a turn already in flight.
     */
    setSubmitPerSegment(on: boolean): void {
        this._submitPerSegment = !!on;
    }

    /**
     * Record the whole hands-free session so it can be re-transcribed in one pass
     * when dictation ends. Live segments are decoded independently and therefore
     * mis-hear domain vocabulary far more than a single whole-audio pass does, so a
     * consumer that keeps an authoritative transcript (a dictated report) can
     * upgrade it at submit time. Takes effect from the next continuous session.
     */
    setArchiveAudio(on: boolean): void {
        this._archiveAudio = !!on;
    }

    /**
     * Length of the archive windows transcribed in the background during dictation
     * (`null` = the module default, ~90 s; `0` = no windowing, one pass at the end).
     * Takes effect from the next continuous session, like the other capture overrides.
     */
    setWindowMs(ms: number | null): void {
        this._windowOverride = ms;
    }

    /**
     * Every window transcribed so far, in seal order. A pull counterpart to the
     * `onWindow` push, for a consumer that attached late or wants to re-read the set
     * without having buffered the events.
     */
    getSessionWindows(): Array<{ index: number; text: string; fromSegment: number; toSegment: number; final: boolean }> {
        try { return this._stt?.getSessionWindows?.() || []; }
        catch (_e) { return []; }
    }

    /** True when the archive hit its cap, so any transcript from it is incomplete. */
    isSessionAudioTruncated(): boolean {
        try { return !!this._stt?.sessionAudioTruncated; }
        catch (_e) { return false; }
    }

    /** The retained dictation recordings, or null. Read after dictation ends. */
    getSessionAudio(): { blobs: Blob[]; truncated: boolean } | null {
        try { return this._stt?.getSessionAudio?.() ?? null; }
        catch (_e) { return null; }
    }

    /**
     * Re-transcribe the recorded dictation in one pass per recording and return the
     * joined text. Rejects (rather than degrading to the in-browser fallback model)
     * when the configured driver fails — a worse-than-the-segments transcript
     * silently replacing the good one is the failure this must not have. Returns
     * null when nothing was recorded.
     */
    async transcribeSessionAudio(opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<string | null> {
        if (!this._stt?.transcribeSessionAudio) return null;
        // This runs at review time, with no capture of our own: claim ownership of
        // the module's transcription events for its duration so an observer's
        // "transcribing…" indicator still tracks it (see _ownsCapture).
        this._ownedTranscribes++;
        try {
            const text = await this._stt.transcribeSessionAudio({
                language: this._opts.language,
                prompt: this._resolvePrompt(),
                signal: opts.signal,
                timeoutMs: opts.timeoutMs,
            });
            return String(text || "").trim() || null;
        } finally {
            this._ownedTranscribes--;
            // An aborted or timed-out pass raises no terminal event; force the
            // indicator down rather than leave the observer's spinner running.
            this._emitTranscribing(false);
        }
    }

    /** Drop the retained dictation recordings (sensitive audio — free once used). */
    clearSessionAudio(): void {
        try { this._stt?.clearSessionAudio?.(); } catch (_e) { /* nothing retained */ }
    }

    private _t(key: string, options?: any): string {
        try {
            if (this._stt?.t) return this._stt.t(key, options);
            return $.t(key, {ns: "speech-to-text", ...(options || {})});
        } catch (_e) {
            return key;
        }
    }

    /**
     * Drive the composer's recording UI — except while a draft is held.
     *
     * The recording overlay covers the input, and the level callback repaints it
     * ~60×/s, so letting `listening`/`processing` through during a hold would bury
     * the very text the user has to read, edit and send. The hold owns that surface
     * until it is released.
     */
    private _voiceUi(state: "listening" | "processing" | "held" | "idle" | "paused", level?: number): void {
        // While paused NOTHING else may paint: the trailing segment of the finished
        // session still reports "processing", and that overlay covers the input the
        // user is editing. The pause ends through resume/stop, which set their own UI.
        if (this._paused && state !== "paused") return;
        // `paused` passes a hold: both hide the overlay, and "you are editing, the
        // mic is off" is the more urgent of the two states to show.
        if (this._held && state !== "held" && state !== "paused") return;
        this._opts.onVoiceUI?.(state, level);
    }

    /** Report the current listening/auto state to an external observer. Never throws. */
    private _emitState(): void {
        try {
            this._opts.onStateChange?.({listening: this._listening, auto: this._auto, paused: this._paused});
        } catch (error) {
            console.error("[ChatVoiceController] onStateChange handler failed:", error);
        }
    }

    /**
     * The active driver is loading its model (e.g. the ~40 MB in-browser Whisper on
     * first use). Reflect progress in the composer status so a slow first load
     * reads as "loading", not "frozen". Only annotate while a capture is active,
     * and let the terminal tick fall through to the normal status.
     */
    private _onModelLoading = (e: any): void => {
        if (!this._listening && !this._auto) return;
        if (e?.done) return;
        // Prefer a %, deriving it from loaded/total when the library omits `progress`
        // (the proxy strips content-length). When even the total is unknown, show the
        // downloaded MB so a length-less streaming download still visibly advances.
        let pct: number | null = typeof e?.progress === "number" ? Math.round(e.progress * 100) : null;
        if (pct === null && typeof e?.loaded === "number" && typeof e?.total === "number" && e.total > 0) {
            pct = Math.round((e.loaded / e.total) * 100);
        }
        let msg: string;
        if (pct !== null) {
            msg = this._t("modelLoadingPct", {pct});
        } else if (typeof e?.loaded === "number" && e.loaded > 0) {
            msg = this._t("modelLoadingMb", {mb: (e.loaded / 1048576).toFixed(1)});
        } else {
            msg = this._t("modelLoading");
        }
        try { this._opts.setStatus(msg); } catch (_e) { /* ignore */ }
    };

    /** Build the DOM (mic + auto toggle). Returns an empty, hidden span if unusable. */
    create(): HTMLElement {
        this._root = span({class: "flex items-center gap-1"}) as HTMLElement;

        if (!this._stt) {
            this._root.classList.add("hidden");
            return this._root;
        }

        this._micIcon = new PhIcon({name: "ph-microphone"});
        this._micBtnEl = new Button(
            {
                base: "btn btn-sm btn-circle btn-ghost",
                type: Button.TYPE.NONE,
                extraProperties: {title: this._t("micTooltipIdle"), "aria-label": this._t("micTooltipIdle")},
                onClick: () => { void this._onMicClick(); },
            },
            this._micIcon
        ).create();

        this._autoBtnEl = new Button(
            {
                base: "btn btn-sm btn-circle btn-ghost",
                type: Button.TYPE.NONE,
                extraProperties: {title: this._t("autoModeTooltipOff"), "aria-label": this._t("autoModeTooltipOff")},
                onClick: () => { this._onAutoClick(); },
            },
            new FAIcon({name: "fa-headset"})
        ).create();

        this._root.appendChild(this._micBtnEl);
        this._root.appendChild(this._autoBtnEl);
        this._root.classList.add("hidden"); // shown once availability resolves

        // Reflect the capture→transcribe transition on the mic tooltip.
        try {
            this._stt.addHandler("transcription-started", this._onTranscribeStart);
            this._stt.addHandler("transcription", this._onTranscribeEnd);
            this._stt.addHandler("transcription-error", this._onTranscribeError);
            this._stt.addHandler("capture-warning", this._onCaptureWarning);
            this._stt.addHandler("model-loading", this._onModelLoading);
        } catch (_e) { /* events are best-effort */ }

        void this._probeAvailability();
        return this._root;
    }

    /**
     * True while this controller owns a capture. The speech-to-text module is a
     * SINGLETON: its events describe whoever is currently using the microphone,
     * which is not necessarily us. Only a capture we started may raise this
     * composer's indicators — otherwise another consumer's dictation paints
     * "Transcribing…" over an idle chat input, and a stray start event with no
     * matching end (an aborted session's trailing flush) hides it for good.
     *
     * A whole-session re-transcription we started counts as ours too, even though no
     * capture is running — see transcribeSessionAudio.
     */
    private _ownsCapture(): boolean {
        return this._listening || this._auto || this._ownedTranscribes > 0;
    }

    private _onTranscribeStart = (): void => {
        if (!this._ownsCapture()) return;
        if (this._micBtnEl) this._setMicTitle("micTooltipProcessing");
        this._voiceUi("processing");
        this._emitTranscribing(true);
    };
    private _onTranscribeEnd = (): void => {
        if (this._micBtnEl) this._setMicTitle(this._listening ? "micTooltipListening" : "micTooltipIdle");
        this._voiceUi("idle");
        this._emitTranscribing(false);
    };
    // All transcription drivers failed for a segment. In hands-free mode this is
    // otherwise invisible (the segment resolves empty and the session continues),
    // so tell the user: a toast + composer status here, and onVoiceError so an
    // external observer (report-assist) can raise its own prominent notice.
    private _onTranscribeError = (e: any): void => {
        if (this._micBtnEl) this._setMicTitle(this._listening ? "micTooltipListening" : "micTooltipIdle");
        // Clearing an indicator is always safe, whoever the failure belonged to.
        this._voiceUi("idle");
        this._emitTranscribing(false);
        // Reporting it is not: a failure in someone else's capture is not this
        // composer's message to deliver (see _ownsCapture).
        if (!this._ownsCapture()) return;
        const err = e?.error;
        // The module now propagates the chain's permanent (config/auth) error as
        // both the event `permanent` flag and the surfaced `error`; read either so a
        // misconfiguration isn't reported as a transient "Transcription failed".
        const permanent = e?.permanent === true || !!err?.permanent;
        const key = permanent ? "transcriptionConfigError" : "transcriptionFailed";
        const message = this._t(key);
        try { this._opts.setStatus(message); } catch (_e) { /* ignore */ }
        try {
            (window as any).Dialogs?.show(message, 6000, (window as any).Dialogs?.MSG_WARN);
        } catch (_e) { /* toast is best-effort */ }
        try {
            this._opts.onVoiceError?.({message, permanent, code: err?.code});
        } catch (error) {
            console.error("[ChatVoiceController] onVoiceError handler failed:", error);
        }
    };
    /**
     * Reflect the capture→transcribe→done transition to an external observer.
     * Emits only on transitions — an aborted in-flight blob raises neither
     * `transcription` nor `transcription-error` (the module rethrows the abort),
     * so teardown paths force-clear with `_emitTranscribing(false)` and the guard
     * makes that a no-op when the indicator is already down. Never throws.
     */
    private _emitTranscribing(active: boolean): void {
        this._lastAliveAt = Date.now();
        if (active === this._transcribingActive) return;
        this._transcribingActive = active;
        try {
            this._opts.onTranscribing?.({active});
        } catch (error) {
            console.error("[ChatVoiceController] onTranscribing handler failed:", error);
        }
    }
    // A non-fatal audio-device / Web Audio failure during capture. Voice detection is
    // dead but recording may continue, so we tell the user why (in the composer status
    // and a toast) rather than letting it look like an unresponsive mic.
    private _onCaptureWarning = (e: any): void => {
        const code = e?.code || e?.error?.code;
        const key = code === "audio-device" ? "audioDevice"
            : code === "insecure-context" ? "insecureContext"
            : code === "vad-degraded" ? "vadDegraded"
            : "captureFailed";
        const message = $.t(key, {ns: "speech-to-text"});
        try { this._opts.setStatus(message); } catch (_e) { /* ignore */ }
        try {
            (window as any).Dialogs?.show(message, 6000, (window as any).Dialogs?.MSG_WARN);
        } catch (_e) { /* toast is best-effort */ }
    };

    /** Forwarded live input level while capturing → drives the recording meter. */
    private _onLevel = (level: number): void => {
        this._noteAlive();
        this._voiceUi("listening", level);
    };

    /**
     * Record a sign of life from capture. A level tick, a recorder heartbeat, a
     * transcribed segment — any of them proves the microphone is still there, and
     * a healthy beat also closes any recovery episode in progress, so two unrelated
     * stalls minutes apart don't add up to a lost session.
     */
    private _noteAlive(): void {
        this._lastAliveAt = Date.now();
        this._sawAlive = true;
        this._staleAttempts = 0;
    }

    /**
     * True when a transcript is too short to be real speech (a lone token or a
     * single character, e.g. Whisper turning a cough or click into "어"). Counts
     * Unicode letters/digits across any script so CJK is handled fairly.
     */
    private _looksLikeNoise(text: string): boolean {
        const t = String(text || "").trim();
        if (!t) return true;
        const letters = (t.match(/[\p{L}\p{N}]/gu) || []).length;
        return letters < (this._opts.minCaptureChars ?? 2);
    }

    /**
     * True when a language lock is configured and the driver detected a different
     * language for this utterance — i.e. Whisper free-detected a wrong language on
     * noise/cross-talk that should not be sent
     * to the assistant. Compares only the primary subtag (`en` vs `en-US`). No
     * lock configured, or no detected language reported => never drops.
     */
    /** Resolve the biasing prompt (static string or lazy builder). Never throws. */
    private _resolvePrompt(): string | undefined {
        const p = this._opts.prompt;
        try {
            const s = typeof p === "function" ? p() : p;
            const t = String(s ?? "").trim();
            return t || undefined;
        } catch (_e) {
            return undefined;
        }
    }

    private _wrongLanguage(result: any): boolean {
        const want = this._opts.language;
        const got = result?.language;
        if (!want || !got) return false;
        const base = (s: string) => String(s).toLowerCase().split(/[-_]/)[0];
        return base(want) !== base(got);
    }

    /**
     * Stop the in-progress capture (used by the recording overlay's click).
     * During hands-free mode this ends the whole listening session — the
     * session's `done` handler then switches auto mode off cleanly.
     */
    stopCapture(): void {
        try { this._stt?.stop(); } catch (_e) { /* ignore */ }
    }

    private async _probeAvailability(): Promise<void> {
        let ok = false;
        try { ok = !!(await this._stt?.isAvailable()); } catch (_e) { ok = false; }
        this._available = ok;
        if (this._root) this._root.classList.toggle("hidden", !ok);
    }

    /** Re-probe (e.g. after config changes); safe to call anytime. */
    refreshAvailability(): void {
        if (this._stt) void this._probeAvailability();
    }

    /** Reflect composer readiness/running state on the controls. */
    setState(ready: boolean, busy: boolean): void {
        this._disabled = !ready;
        // Manual mic is disabled while a turn runs or when not ready; the auto
        // toggle stays clickable so the user can arm/disarm around a response.
        if (this._micBtnEl) this._micBtnEl.disabled = !ready || busy || this._auto;
        if (this._autoBtnEl) this._autoBtnEl.disabled = !ready;
        this._trackBusy(busy);
    }

    // ---- holding speech said while the assistant computes ----

    /**
     * Follow the assistant's busy edges. The panel calls setState() from every
     * `_updateInputState()`, including turn start and turn end, so this is an exact
     * edge — no polling, and no second source of truth to drift from the one the
     * Send button already uses. Repeated same-value calls are ignored.
     */
    private _trackBusy(busy: boolean): void {
        const wasBusy = this._busySince > 0;
        if (busy === wasBusy) return;
        if (busy) {
            this._busySince = Date.now();
            this._armHoldTimer();
            return;
        }
        this._busySince = 0;
        this._clearHoldTimer();
    }

    private _holdGraceMs(): number {
        const configured = this._opts.busyHoldMs;
        return configured === undefined || configured === null ? DEFAULT_BUSY_HOLD_MS : Math.max(0, configured);
    }

    /**
     * Open the hold the moment the grace expires rather than at turn end: the user
     * should see the mode change while they are still talking, not discover it
     * afterwards.
     */
    private _armHoldTimer(): void {
        this._clearHoldTimer();
        const grace = this._holdGraceMs();
        if (!grace || this._held || this._paused || !this._auto || this._sessionPerSegment) return;
        this._holdTimer = window.setTimeout(() => {
            this._holdTimer = null;
            if (this._auto && this._busySince > 0) this._enterHold();
        }, grace);
    }

    private _clearHoldTimer(): void {
        if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
    }

    /** The grace rule, evaluated now (covers a turn that lands before the timer fires). */
    private _shouldHoldNow(): boolean {
        return shouldHoldNow({
            auto: this._auto,
            perSegment: this._sessionPerSegment,
            busySince: this._busySince,
            now: Date.now(),
            busyHoldMs: this._holdGraceMs(),
        });
    }

    /** Spoken release commands, resolved from the locale unless overridden. */
    private _holdPhrases(): HoldPhrases {
        if (this._opts.holdVoiceCommands === false) return {confirm: [], discard: []};
        const resolve = (override: string | string[] | undefined, key: string): string[] => {
            if (override) return parsePhraseList(override);
            return parsePhraseList(this._t(key), key);
        };
        return {
            confirm: resolve(this._opts.holdConfirmPhrases, "autoModeConfirmPhrases"),
            discard: resolve(this._opts.holdDiscardPhrases, "autoModeDiscardPhrases"),
        };
    }

    /**
     * Switch from "queue and auto-submit" to "collect a draft the user releases".
     * Idempotent, and valid with an empty queue — it then simply means "from here
     * on, hold". Anything already queued joins the draft rather than going out on
     * its own: it was said BEFORE the held text, so auto-submitting it would either
     * split one thought across two messages or sweep the visible draft into the
     * same send (submit() reads the composer, not the queue).
     */
    private _enterHold(): void {
        if (this._held || !this._auto) return;
        this._held = true;
        this._clearHoldTimer();
        const queued = this._pendingTurns.splice(0).filter(Boolean);
        if (queued.length) {
            this._heldPieces.push(...queued);
            this._opts.fillInput(queued.join(" "));
        }
        this._opts.setStatus(this._t("autoModeHeld"));
        this._voiceUi("held");
        this._emitHold(true);
    }

    /** True while captured speech is waiting in the composer for the user to decide. */
    get hasHeldText(): boolean {
        return this._held;
    }

    /**
     * Leave the hold without submitting — for a consumer that is sending the
     * composer itself in this same gesture (Send / Ctrl+Enter). Auto mode
     * keeps running: releasing a draft must not end the conversation.
     * Returns true when there was a hold to release.
     */
    clearHold(): boolean {
        if (!this._held) return false;
        this._held = false;
        this._heldPieces = [];
        // A pending "submit the composer" instruction belongs to the hold that
        // asked for it; leaving it armed would fire at the next unrelated turn.
        this._submitComposer = false;
        this._clearHoldTimer();
        this._emitHold(false);
        if (this._auto) {
            const paused = this._paused;
            this._opts.setStatus(this._t(paused ? "autoModePausedEdit" : "autoModeListening"));
            this._voiceUi(paused ? "paused" : "listening", 0);
        }
        return true;
    }

    /** Release the held draft and send it through the normal submit path. */
    submitHeld(): boolean {
        if (!this.clearHold()) return false;
        this._submitComposer = true;
        void this._maybeSubmit();
        return true;
    }

    /**
     * Drop the held draft: strip it back out of the composer and RETRACT it.
     *
     * This is a deliberate user gesture ("that was not for you"), not a shutdown
     * salvage — so the words go to `onDiscardedText`, never to `onLostText`. The
     * distinction is load-bearing: the salvage channel appends to the chat
     * transcript, which is how a discarded utterance used to end up submitted as
     * a message. Consumers that already banked the pieces (each was reported as
     * an accepted segment while capturing) take them back out.
     *
     * Speech parked during an edit pause belongs to the same retracted utterance
     * and goes with it — otherwise the resume below would push it straight back
     * into the composer the user just emptied.
     */
    discardHeld(): boolean {
        if (!this._held) return false;
        const pieces = this._heldPieces
            .concat(this._pausedPieces.splice(0))
            .map((p) => String(p || "").trim())
            .filter(Boolean);
        const text = pieces.join(" ").trim();
        if (!this.clearHold()) return false;
        if (text) {
            try { this._opts.clearDraft?.(text); }
            catch (error) { console.error("[ChatVoiceController] clearDraft handler failed:", error); }
        }
        // The microphone was released for editing; the draft is gone, so there is
        // nothing left to edit — put it back to work rather than leaving hands-free
        // armed over a dead microphone (which is what "still listening" would mean).
        if (this._paused) this.resumeAuto();
        if (text) {
            try { this._opts.onDiscardedText?.(text, pieces); }
            catch (error) { console.error("[ChatVoiceController] onDiscardedText handler failed:", error); }
        }
        if (this._auto) this._opts.setStatus(this._t("autoModeHeldCleared"));
        return true;
    }

    /**
     * Forget the hold on teardown WITHOUT touching the composer: the draft is the
     * user's text now, and a session ending (idle-off, watchdog, a manual stop) is
     * no reason to take it away — they can still read it, edit it and send it.
     */
    private _releaseHoldState(): void {
        this._clearHoldTimer();
        this._busySince = 0;
        this._submitComposer = false;
        if (!this._held) return;
        this._held = false;
        this._heldPieces = [];
        this._emitHold(false);
    }

    private _emitHold(active: boolean): void {
        try {
            this._opts.onHold?.({active, text: this._heldPieces.join(" ").trim()});
        } catch (error) {
            console.error("[ChatVoiceController] onHold handler failed:", error);
        }
    }

    // ---- pausing while the user edits the draft ----

    /**
     * The user started editing the composer: release the microphone but keep
     * hands-free armed.
     *
     * Capture and manual editing cannot share the box — every appended utterance
     * rewrites `value` and drags the caret to the end, so a user fixing a mis-heard
     * word loses their place mid-keystroke. Rather than arbitrating that, the
     * microphone steps aside: the session is finished gracefully (its trailing
     * utterance is parked, never dropped), and the send — or emptying the box —
     * brings it back. Idempotent; a no-op unless hands-free is running.
     */
    pauseForEdit(): void {
        if (!this._auto || this._paused) return;
        this._paused = true;
        this._clearHoldTimer();
        if (this._watchdog) { clearInterval(this._watchdog); this._watchdog = null; }
        // Detach before finishing, as finishAuto does: the handle's `done` teardown
        // would otherwise read the graceful stop as the session dying and switch
        // hands-free off entirely.
        const handle = this._contHandle;
        this._contHandle = null;
        try {
            if (handle?.finish) void Promise.resolve(handle.finish()).catch(() => { /* trailing text is parked below */ });
            else this._stt?.stop();
        } catch (_e) { /* releasing the mic is best-effort */ }
        this._setListening(false);
        this._renderAutoState();
        this._voiceUi("paused");
        this._opts.setStatus(this._t("autoModePausedEdit"));
        // The mic is off, but hands-free still holds the UI: expire it like any
        // other idle session instead of leaving it armed forever.
        this._armIdleOff();
    }

    /**
     * Put the microphone back to work after an edit pause. Called on send and when
     * the user empties the composer. Anything captured during the pause is appended
     * to the composer first, so the words said while typing go out with the message
     * rather than vanishing. A failed restart switches hands-free off (an armed
     * toggle over a dead microphone is worse than an honest "off").
     */
    resumeAuto(): void {
        if (!this._auto || !this._paused) return;
        const handle = this._openSession(this._sessionPerSegment);
        if (!handle) {
            const message = this._t("captureFailed");
            this._opts.setStatus(message);
            try { this._opts.onVoiceError?.({message, permanent: false, code: "resume-failed"}); }
            catch (error) { console.error("[ChatVoiceController] onVoiceError handler failed:", error); }
            this.stopAuto();
            return;
        }
        this._paused = false;
        // Parked speech goes into the COMPOSER, not the submit queue: the resume
        // happens inside the user's own send gesture, so queueing it would start a
        // second submission racing the one they just asked for. In the box it is
        // simply part of the message going out — and visible before it does.
        const parked = this._pausedPieces.splice(0).map((p) => String(p || "").trim()).filter(Boolean);
        if (parked.length) this._opts.fillInput(parked.join(" "));
        this._armSession(handle);
    }

    /** True while hands-free is armed but the microphone is released for editing. */
    get isPaused(): boolean {
        return this._paused;
    }

    /** True while hands-free mode owns the microphone. */
    get isAuto(): boolean {
        return this._auto;
    }

    /** True while any capture (manual or hands-free) is running. */
    get isListening(): boolean {
        return this._listening;
    }

    /** Report a segment to the observer; never let a handler break capture. */
    private _reportSegment(segment: ChatVoiceSegmentPayload): void {
        try {
            this._opts.onSegment?.(segment);
        } catch (error) {
            console.error("[ChatVoiceController] onSegment handler failed:", error);
        }
    }

    /**
     * Hand would-be-discarded pending turn text to the consumer instead of
     * silently dropping it — a shutdown path must never destroy transcribed
     * speech. Never throws.
     */
    private _flushLostText(extra?: string): void {
        const pieces = [...this._pendingTurns];
        if (extra && extra.trim()) pieces.push(extra.trim());
        const text = pieces.join(" ").trim();
        if (!text) return;
        try {
            this._opts.onLostText?.(text, pieces.map((p) => String(p || "").trim()).filter(Boolean));
        } catch (error) {
            console.error("[ChatVoiceController] onLostText handler failed:", error);
        }
    }

    // ---- manual dictation ----

    private _onMicClick(): Promise<void> {
        return this.dictateOnce();
    }

    /**
     * Run one manual dictation: capture until the silence window closes, fill the
     * composer, and auto-submit if configured and the content passes the gates.
     * Public so an external driver can trigger the same flow the mic button does.
     */
    async dictateOnce(): Promise<void> {
        if (this._auto) return;
        if (this._listening) { this._stt.stop(); return; } // click again = stop early
        if (!this._opts.isReady() || this._opts.isBusy()) return;

        this._setListening(true);
        this._opts.setStatus(this._t("listening"));
        this._voiceUi("listening", 0);
        // Track the transcribe+fill as one awaitable so a direct Send can flush it.
        this._activeDictation = this._runDictation();
        try { await this._activeDictation; }
        finally { this._activeDictation = null; }
    }

    private async _runDictation(): Promise<void> {
        try {
            const r = await this._stt.transcribeOnce({
                language: this._opts.language,
                prompt: this._resolvePrompt(),
                silenceMs: this._opts.silenceMs,
                minVoicedMs: this._opts.minVoicedMs,
                onLevel: this._onLevel,
            });
            const clean = String(r?.text || "").trim();
            if (!clean) {
                this._opts.setStatus(this._t("noSpeechDetected"));
                return;
            }
            // Manual dictation always fills the input for review — the user sees and
            // can edit it. Only the optional auto-submit is gated, so a noisy or
            // wrong-language capture never fires off a turn without a human glance.
            const accepted = !this._looksLikeNoise(clean) && !this._wrongLanguage(r);
            this._opts.setStatus("");
            this._opts.fillInput(clean);
            this._reportSegment({ text: clean, index: -1, accepted, mode: "once" });
            if (this._opts.autoSubmit && accepted) {
                await this._opts.submit();
            }
        } catch (_e) {
            // The module already surfaces a localized toast; keep the composer quiet.
            this._opts.setStatus("");
        } finally {
            this._voiceUi("idle");
            this._setListening(false);
        }
    }

    /**
     * The user pressed Send while dictating. Stop the mic immediately and, for a
     * manual dictation, wait until its transcript has been flushed into the input
     * so the caller can send it in the same gesture. Hands-free auto mode is just
     * switched off (it manages its own submissions). No-op when not capturing.
     *
     * The exception is a held draft: Send (or Ctrl/Cmd+Enter) is then the release
     * gesture the hold was waiting for, and ending the conversation because the user
     * answered it would be backwards. The hold is cleared, auto mode keeps
     * listening, and the caller sends the composer.
     *
     * An edit pause is the same shape: the send ends the edit, so it releases the
     * pause (and any hold the draft came from) and the microphone comes back —
     * pausing to fix a word was never a request to end the conversation.
     */
    async finishAndFlush(): Promise<void> {
        if (this._paused) { this.clearHold(); this.resumeAuto(); return; }
        if (this._held) { this.clearHold(); return; }
        if (this._auto) { this.stopAuto(); return; }
        if (!this._listening) return;
        try { this._stt?.stop(); } catch (_e) { /* ignore */ }
        if (this._activeDictation) { try { await this._activeDictation; } catch (_e) { /* ignore */ } }
    }

    // ---- hands-free conversation loop ----

    private _onAutoClick(): void {
        if (this._auto) { this.stopAuto(); return; }
        this.startAuto();
    }

    /**
     * Start hands-free capture. Public so an external driver can run continuous
     * dictation without the panel's auto button; idempotent and a no-op when the
     * composer is not ready.
     */
    startAuto(): void {
        if (this._auto) return;
        if (!this._opts.isReady()) return;

        // Captured once per session (same semantics as the segment-cap override):
        // a transcript-only toggle mid-session applies to the NEXT session, so a
        // turn already flowing through one submission path can't leak into the other.
        const perSegment = this._submitPerSegment;
        const handle = this._openSession(perSegment);
        if (!handle) return; // the module already surfaced a localized error toast

        this._auto = true;
        this._pendingTurns = [];
        this._segmentIndex = 0;
        this._sessionPerSegment = perSegment;
        this._held = false;
        this._heldPieces = [];
        this._submitComposer = false;
        this._paused = false;
        this._pausedPieces = [];
        // Re-stamp the busy clock from now: the grace timer can only be armed once
        // auto mode owns the mic, and arming mid-reply is itself the user choosing
        // to talk to the assistant, so the grace should start over from here.
        this._trackBusy(false);
        this._trackBusy(this._opts.isBusy());
        this._armSession(handle);
    }

    /**
     * Open ONE continuous dictation session carrying the hands-free option block.
     * Returns null when the module refused (it has already surfaced a localized
     * error toast). Shared by the initial start and by a resume after an edit pause,
     * so the two can never drift in what they ask the module for.
     */
    private _openSession(perSegment: boolean): any {
        try {
            // ONE persistent continuous session for the whole hands-free lifetime.
            // The mic keeps listening even while the assistant computes a reply —
            // safe today because the chat plays no TTS audio that could echo into
            // the capture (if TTS is ever added, gate/duck the capture here).
            // Completed turns arrive via onTurn and are queued; nothing the user
            // says is ever dropped, only deferred until the assistant is idle.
            return this._stt.startContinuousDictation({
                language: this._opts.language,
                prompt: this._resolvePrompt(),
                silenceMs: this._opts.silenceMs,
                onLevel: this._onLevel,
                // The watchdog's real evidence: recorder bytes landing, or a health
                // poll that confirmed a running context on a live track. The level
                // meter is a nice-to-have on top — it stalls for reasons that have
                // nothing to do with the microphone.
                onAlive: () => this._noteAlive(),
                turnSilenceMs: this._opts.turnSilenceMs,
                // Bound how long an uninterrupted monologue can go without partial
                // text — segments cut at this cap keep observers (extraction,
                // progress UI) fed while the speaker never pauses.
                maxSegmentMs: this._maxSegmentOverride ?? this._opts.maxSegmentMs ?? 10000,
                // A manual stop means "finish and submit", so the trailing utterance
                // must survive its transcription. The module default (8 s) is below
                // what a full-length final segment can need once the request queues
                // behind tile traffic — it expired, the trailing transcription was
                // aborted, and the last thing said vanished. Match the queue-drain
                // budget in finishAuto() instead.
                finishTimeoutMs: FINISH_TIMEOUT_MS,
                archive: this._archiveAudio,
                ...(this._windowOverride === null ? {} : {windowMs: this._windowOverride}),
                // Background window transcripts: the same speech decoded with a minute
                // and a half of context instead of a few seconds of it.
                onWindow: (w: any) => {
                    this._noteAlive();
                    try { this._opts.onWindow?.(w); }
                    catch (error) { console.error("[ChatVoiceController] onWindow handler failed:", error); }
                },
                speechFloorMult: this._opts.speechFloorMult,
                minSpeechMs: this._opts.minSpeechMs,
                minVoicedMs: this._opts.minVoicedMs,
                // Content gate: reject noise / wrong-language mistranscriptions so
                // they never enter a turn. Silence never even gets here — the
                // module refuses to transcribe speech-less audio — so a quiet,
                // thinking user simply keeps the session waiting.
                validateSegment: (r: any) => {
                    const accepted = !this._looksLikeNoise(r?.text) && !this._wrongLanguage(r);
                    const text = String(r?.text || "").trim();
                    // Report rejections here — they never reach onPartial/onTurn, so
                    // this is the only place an observer can see what the gates dropped.
                    if (!accepted && text) {
                        this._reportSegment({ text, index: this._segmentIndex, accepted: false, mode: "continuous" });
                    }
                    return accepted;
                },
                // Per-segment delivery: every accepted, transcribed segment is
                // reported the moment it drains — mid-monologue, well before the
                // turn boundary — so observers see live progress. The turn-level
                // report in _onTurn was dropped in favor of this (its text is the
                // join of these pieces; reporting both would double-count).
                // In per-segment mode the piece is also SUBMITTED right away via
                // the regular turn machinery (queue + _maybeSubmit), so dictation
                // lands in the transcript without waiting for turn silence.
                onPartial: (p: any) => {
                    this._noteAlive();
                    const piece = String(p?.appended || "").trim();
                    if (piece) {
                        this._reportSegment({ text: piece, index: this._segmentIndex++, accepted: true, mode: "continuous" });
                        if (perSegment) this._onTurn(piece);
                    }
                },
                onTurn: (turn: any) => {
                    // Per-segment mode: the turn text is exactly the join of the
                    // onPartial pieces already queued above — re-queuing it would
                    // submit everything twice. Keep the heartbeat tick only.
                    if (perSegment) { this._noteAlive(); return; }
                    this._onTurn(String(turn?.text || ""));
                },
            });
        } catch (_e) {
            return null; // the module already surfaced a localized error toast
        }
    }

    /**
     * Bind a freshly opened session: heartbeat, watchdog, listening UI. Shared by
     * `startAuto` and `resumeAuto` — a resume must arm exactly what a start does,
     * or the microphone comes back without its safety timers.
     */
    private _armSession(handle: any): void {
        if (this._watchdog) { clearInterval(this._watchdog); this._watchdog = null; }
        this._contHandle = handle;
        this._lastAliveAt = Date.now();
        // A fresh capture has proven nothing yet; `_staleAttempts` deliberately
        // survives, so a restart that stalls again counts toward the same episode.
        this._sawAlive = false;
        this._lastTickAt = 0;
        this._renderAutoState();
        this._setListening(true);
        this._opts.setStatus(this._t("autoModeListening"));
        this._voiceUi("listening", 0);
        this._armIdleOff();
        // Bail if the composer becomes unusable (logout, panel closed, teardown) so
        // the mic can't keep listening in the background. Also watch for a DEAD
        // speech session (handle.done never resolves, no callbacks flow): without
        // this the UI would show "listening" forever while nothing is captured.
        // The verdict itself lives in shared/voice-liveness.ts — notably, a tick
        // that was itself delayed past the staleness window is thrown away rather
        // than acted on, because that gap measures OUR outage, not the microphone's.
        this._lastTickAt = 0;
        this._dbgRing = [];
        this._watchdog = window.setInterval(() => {
            const now = Date.now();
            const tickLagMs = this._lastTickAt ? (now - this._lastTickAt - WATCHDOG_PERIOD_MS) : 0;
            this._lastTickAt = now;
            // Kept as the forensic trail behind a stall: `t` is the wall clock the
            // staleness test uses and `perf` the monotonic one, so a wall jump with no
            // matching perf jump is a machine suspend and a large `lag` a blocked main
            // thread. Ten entries of plain data, logged only when a stall is acted on.
            this._tickLog.push({
                t: now, perf: Math.round(performance.now()), lag: tickLagMs,
                idle: now - this._lastAliveAt, sawAlive: this._sawAlive,
                attempts: this._staleAttempts, vis: document.visibilityState,
                health: (() => { try { return this._stt?.getCaptureHealth?.(); } catch (_e) { return "throw"; } })(),
            });
            if (this._tickLog.length > 10) this._tickLog.shift();

            if (!this._auto) return;
            if (!this._opts.isReady()) { this.stopAuto(); return; }
            const staleMs = this._opts.staleSessionMs ?? DEFAULT_STALE_SESSION_MS;
            const action = decideLiveness({
                idleMs: now - this._lastAliveAt,
                staleMs,
                armed: this._sawAlive,
                visible: document.visibilityState === "visible",
                tickLagMs,
                attempts: this._staleAttempts,
                maxAttempts: this._opts.staleRestartAttempts ?? DEFAULT_STALE_RESTARTS,
            });
            if (action === "ok") return;
            if (action === "wait") {
                // We were away, not the microphone. Re-stamp so the next tick judges
                // a window we actually observed.
                this._lastAliveAt = now;
                return;
            }
            console.warn(`[ChatVoiceController] capture stalled → ${action}`, {staleMs, ticks: this._tickLog});
            if (action === "restart") { void this._restartSession(); return; }
            this._declareSessionLost();
        }, WATCHDOG_PERIOD_MS);
        // The session ending on its own (capture error, external stop) must also
        // switch auto mode off; guard on the handle so a restarted session's
        // completion can't kill its successor.
        const sync = () => { if (this._auto && this._contHandle === handle) this.stopAuto(); };
        handle.done.then(sync, sync);
    }

    /**
     * Capture stalled and could not be brought back: tell the user and finish
     * gracefully, so everything already transcribed is still submitted and saved.
     * Reached only once `staleRestartAttempts` in-place restarts have failed.
     */
    private _declareSessionLost(): void {
        const message = this._t("voiceSessionLost");
        this._opts.setStatus(message);
        try { this._opts.onVoiceError?.({message, permanent: false, code: "stale-session"}); }
        catch (error) { console.error("[ChatVoiceController] onVoiceError handler failed:", error); }
        void this.finishAuto(); // graceful: flush pending turns, then release
    }

    /**
     * Re-open the microphone IN PLACE after a stall, without ending the hands-free
     * session.
     *
     * Everything downstream of the capture belongs to the DICTATION, not to one
     * capture: the pending turn queue, the held draft, an edit pause, the segment
     * counter, and — critically — the module's retained recording, which the report
     * flow re-transcribes as a whole at review. A restart must therefore touch none
     * of it; only the microphone is replaced.
     *
     * The trailing audio is flushed through `finish()` rather than discarded by
     * `stop()`, so the last thing said before the stall still reaches the transcript
     * via the old session's own callbacks. The cost is a gap in the recording equal
     * to the stall plus the backoff; that is not marked as truncation, because
     * "truncated" means "stops short of the end" and would make a consumer abandon
     * the whole-audio transcript entirely.
     */
    private async _restartSession(): Promise<void> {
        if (this._restarting || !this._auto) return;
        this._restarting = true;
        const attempt = ++this._staleAttempts;
        try {
            const message = this._t("voiceSessionRecovering");
            this._opts.setStatus(message);
            try { this._opts.onVoiceError?.({message, permanent: false, code: "stale-session", recoverable: true}); }
            catch (error) { console.error("[ChatVoiceController] onVoiceError handler failed:", error); }

            // Detach the handle BEFORE finishing it: `done` drives a teardown that
            // would read this stop as the session dying and wipe the pending queue.
            const old = this._contHandle;
            this._contHandle = null;
            if (this._watchdog) { clearInterval(this._watchdog); this._watchdog = null; }
            if (old) {
                try { await old.finish(); } catch (_e) { /* the flush is best-effort */ }
            }
            if (!this._auto) return; // stopped while we were flushing

            // A device that just went away is not back a millisecond later.
            await this._delay(Math.min(4000, 500 * Math.pow(2, attempt - 1)));
            if (!this._auto) return;

            // Reuse the mode captured at startAuto: a restart must never silently
            // switch delivery modes mid-dictation.
            const handle = this._openSession(this._sessionPerSegment);
            if (!handle) { this._declareSessionLost(); return; }
            this._armSession(handle);
        } finally {
            this._restarting = false;
        }
    }

    /**
     * A completed (turn-idle-delimited) speech turn arrived from the session —
     * or, in per-segment mode, a single transcribed segment (queued here directly
     * from onPartial). The pieces were already reported via onSegment — this
     * only queues the text for chat submission.
     */
    private _onTurn(text: string): void {
        const clean = text.trim();
        if (!this._auto || !clean) return;
        this._noteAlive();
        if (!this._opts.isReady()) {
            // The turn never reached the queue — hand it to the lost-text sink
            // along with anything still pending, then clear so stopAuto's own
            // flush cannot deliver the same pending text twice.
            this._flushLostText(clean);
            this._pendingTurns = [];
            this.stopAuto();
            return;
        }
        // Paused for an edit: the trailing utterance of the finished session (or
        // anything the tail of the stream still delivers) is parked, NOT written to
        // the composer — the whole point of the pause is to leave the user's caret
        // and text alone. It goes out with the resume.
        if (this._paused) {
            this._pausedPieces.push(clean);
            return;
        }
        // The assistant has been computing long enough that this is probably not
        // addressed to it — collect a draft instead of queueing a submission. Also
        // checked here, not only on the timer, so a turn landing in the same tick as
        // the grace expiry is held rather than sent.
        if (!this._held && this._shouldHoldNow()) this._enterHold();

        if (this._held) {
            // A whole utterance that is exactly "send it" / "scratch that" is the
            // user operating the hold, not dictating into it.
            const command = matchHoldCommand(clean, this._holdPhrases());
            if (command === "confirm") { this._armIdleOff(); this.submitHeld(); return; }
            if (command === "discard") { this._armIdleOff(); this.discardHeld(); return; }
            // Append live: the user watches their words land in the box, which is the
            // feedback that tells them nothing is being fired off behind their back.
            this._heldPieces.push(clean);
            this._opts.fillInput(clean);
            this._armIdleOff();
            this._opts.setStatus(this._t("autoModeHeld"));
            this._emitHold(true);
            return;
        }

        this._pendingTurns.push(clean);
        this._armIdleOff();
        if (this._opts.isBusy()) this._opts.setStatus(this._t("autoModeQueued"));
        void this._maybeSubmit();
    }

    /**
     * Drain queued turns, one submission at a time. A turn completed while the
     * assistant was replying is held and goes out as the next message the moment
     * the reply finishes — unless the wait ran long enough to open a hold, in which
     * case the draft is the user's to send and this loop keeps its hands off it.
     */
    private async _maybeSubmit(): Promise<void> {
        if (this._submitting) return;
        this._submitting = true;
        try {
            while (this._auto && (this._pendingTurns.length || this._submitComposer)) {
                if (!this._opts.isReady()) { this.stopAuto(); return; }
                // A hold owns the composer until the user releases it; whatever is
                // queued was folded into the draft by _enterHold(). An edit pause
                // owns it just as exclusively — the user is typing in it.
                if (this._held || this._paused) return;
                // Assistant mid-response: the turn may have been triggered by a
                // manual send too, so poll rather than rely on our own submit().
                if (this._opts.isBusy()) { await this._delay(150); continue; }
                // A released hold submits the composer as it stands — including any
                // edit the user made to it, which outranks what we transcribed.
                if (this._submitComposer) this._submitComposer = false;
                else this._opts.fillInput(this._pendingTurns.splice(0).join(" "));
                this._opts.setStatus(this._t("autoModeWaiting"));
                try {
                    await this._opts.submit(); // resolves when the assistant turn ends
                } catch (_e) {
                    this.stopAuto();
                    return;
                }
                this._armIdleOff();
                if (!this._auto) return;
                this._opts.setStatus(this._t("autoModeListening"));
                const reArm = this._reArmOverride ?? this._opts.reArmDelayMs ?? 500;
                if (reArm > 0) await this._delay(reArm); // let the reply settle
            }
        } finally {
            this._submitting = false;
        }
    }

    /** (Re)arm the inactivity auto-off so the microphone can never stay hot forever. */
    private _armIdleOff(): void {
        if (this._idleTimer) clearTimeout(this._idleTimer);
        this._idleTimer = window.setTimeout(() => {
            if (!this._auto) return;
            this._opts.setStatus(this._t("autoModeIdleOff"));
            this.stopAuto();
        }, Math.max(30000, this._opts.idleAutoOffMs ?? 300000));
    }

    /** Stop hands-free capture and release the microphone. Idempotent. */
    stopAuto(): void {
        if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
        if (this._watchdog) { clearInterval(this._watchdog); this._watchdog = null; }
        this._releaseHoldState();
        this._paused = false;
        // Recovery bookkeeping belongs to one session; the next start begins fresh.
        this._staleAttempts = 0;
        if (!this._auto && !this._listening) { this._pausedPieces = []; this._renderAutoState(); return; }
        this._auto = false;
        // Transcribed-but-unsubmitted turns must not die with the session — hand
        // them to the lost-text sink (covers watchdog / idle-off / not-ready /
        // submit-throw / session-died paths, which all route through here).
        // Speech parked by an edit pause is exactly as unsubmitted, so it joins them.
        if (this._pausedPieces.length) this._pendingTurns.push(...this._pausedPieces.splice(0));
        this._flushLostText();
        this._pendingTurns = [];
        this._contHandle = null;
        try { this._stt?.stop(); } catch (_e) { /* ignore */ }
        // A blob aborted mid-transcription emits no end event — force the
        // transcribing indicator down (transition-guarded no-op otherwise).
        this._emitTranscribing(false);
        this._setListening(false);
        this._voiceUi("idle");
        this._renderAutoState();
    }

    /**
     * Finish hands-free capture GRACEFULLY: flush the last utterance and submit
     * everything captured, then release the microphone. The counterpart of
     * `stopAuto()` (which discards the mid-turn) — use when a manual stop means
     * "finish and submit". Resolves once the queue has drained (bounded, so a stuck
     * assistant can't hang it). No-op-ish when not in auto mode (falls back to stop).
     */
    async finishAuto(): Promise<void> {
        if (!this._auto) { this.stopAuto(); return; }

        const handle = this._contHandle;
        // Detach the done-driven teardown so the graceful finalize below (which
        // resolves `done`) can't trip stopAuto() and wipe the pending queue.
        this._contHandle = null;
        if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
        if (this._watchdog) { clearInterval(this._watchdog); this._watchdog = null; }
        // An edit pause already released the mic; its parked speech is the tail of
        // this session and goes out with the drain below rather than being lost.
        if (this._paused) {
            this._paused = false;
            if (this._pausedPieces.length) this._pendingTurns.push(...this._pausedPieces.splice(0));
        }
        this._opts.setStatus(this._t("autoModeFinishing"));

        try {
            // Graceful stop: the trailing utterance is delivered via onTurn (or,
            // in per-segment mode, via the tail onPartial) into _pendingTurns
            // before this resolves. Keep _auto true so _onTurn accepts it and
            // _maybeSubmit drains it.
            if (handle?.finish) await handle.finish();
            else { try { this._stt?.stop(); } catch (_e) { /* ignore */ } }
        } catch (_e) { /* submit whatever we did capture */ }

        // Drain the queue through submit(). Bounded so Stop never hangs if the
        // assistant is stuck mid-reply.
        try {
            void this._maybeSubmit();
            const startedAt = Date.now();
            while ((this._pendingTurns.length || this._submitting) && (Date.now() - startedAt) < FINISH_TIMEOUT_MS) {
                await this._delay(100);
            }
        } catch (_e) { /* ignore */ }

        if (this._pendingTurns.length) {
            console.warn("[ChatVoiceController] finishAuto drain timed out — flushing pending turns to the lost-text sink", this._pendingTurns.length);
            this._flushLostText();
        }
        // Now tear down for real. A held draft stays in the composer for review —
        // "finish and submit" cannot mean sending words the user was never shown.
        this._releaseHoldState();
        this._auto = false;
        this._pendingTurns = [];
        try { this._stt?.stop(); } catch (_e) { /* ensure the mic is released */ }
        // As in stopAuto: an aborted in-flight blob leaves no end event behind.
        this._emitTranscribing(false);
        this._setListening(false);
        this._voiceUi("idle");
        this._renderAutoState();
    }

    /** Stop everything (called by the panel on teardown / hard reset). */
    stopAll(): void {
        this.stopAuto();
        // Release the singleton speech-to-text handlers so this controller (and
        // its closures) don't stay reachable through the long-lived module.
        try {
            this._stt?.removeHandler("transcription-started", this._onTranscribeStart);
            this._stt?.removeHandler("transcription", this._onTranscribeEnd);
            this._stt?.removeHandler("transcription-error", this._onTranscribeError);
            this._stt?.removeHandler("capture-warning", this._onCaptureWarning);
            this._stt?.removeHandler("model-loading", this._onModelLoading);
        } catch (_e) { /* best-effort */ }
    }

    // ---- visual state ----

    private _setMicTitle(key: string): void {
        if (!this._micBtnEl) return;
        const tip = this._t(key);
        this._micBtnEl.title = tip;
        this._micBtnEl.setAttribute("aria-label", tip);
    }

    private _setListening(on: boolean): void {
        this._listening = on;
        // Swap to a slashed mic while recording: an unambiguous "click to stop"
        // affordance the user can't confuse with the idle state.
        this._micIcon?.changeIcon(on ? "ph-microphone-slash" : "ph-microphone");
        if (!this._micBtnEl) return;
        this._micBtnEl.classList.toggle("text-error", on);
        this._micBtnEl.classList.toggle("animate-pulse", on);
        this._setMicTitle(on ? "micTooltipListening" : "micTooltipIdle");
        // Single choke point for every listening transition (manual + auto, and
        // every self-shutoff, since those all route through here) — notify observers.
        this._emitState();
    }

    private _renderAutoState(): void {
        if (this._autoBtnEl) {
            this._autoBtnEl.classList.toggle("btn-primary", this._auto);
            // Armed but not hot while paused: the pulse means "the microphone is
            // capturing right now", and during an edit it is not.
            this._autoBtnEl.classList.toggle("animate-pulse", this._auto && !this._paused);
            const tip = this._auto
                ? (this._paused ? this._t("autoModePausedEdit") : this._t("autoModeTooltipOn"))
                : this._t("autoModeTooltipOff");
            this._autoBtnEl.title = tip;
            this._autoBtnEl.setAttribute("aria-label", tip);
        }
        // Keep the manual mic disabled while auto owns the microphone.
        this.setState(!this._disabled, this._opts.isBusy());
    }

    private _delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
