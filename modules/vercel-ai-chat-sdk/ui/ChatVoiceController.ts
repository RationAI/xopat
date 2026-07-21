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
//  - an inactivity timer (idleAutoOffMs, default 5 min without real speech)
//    switches auto mode off so the microphone can never stay hot forever.

const {Button, FAIcon, PhIcon} = (globalThis as any).UI;
const {span} = (globalThis as any).van.tags;

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
     * Drive the composer's recording UI. `listening` fires repeatedly with a live
     * 0..1 input level; `processing` while transcribing; `idle` when done/hidden.
     */
    onVoiceUI?: (state: "listening" | "processing" | "idle", level?: number) => void;
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
     * Send-flush). Lets an external observer (e.g. a report-assist plugin) track
     * the shared capture instead of polling `isAuto` once. Must not throw.
     */
    onStateChange?: (state: { listening: boolean; auto: boolean }) => void;
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

    private _t(key: string, options?: any): string {
        try {
            if (this._stt?.t) return this._stt.t(key, options);
            return $.t(key, {ns: "speech-to-text", ...(options || {})});
        } catch (_e) {
            return key;
        }
    }

    /** Report the current listening/auto state to an external observer. Never throws. */
    private _emitState(): void {
        try {
            this._opts.onStateChange?.({listening: this._listening, auto: this._auto});
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
            this._stt.addHandler("transcription-error", this._onTranscribeEnd);
            this._stt.addHandler("capture-warning", this._onCaptureWarning);
            this._stt.addHandler("model-loading", this._onModelLoading);
        } catch (_e) { /* events are best-effort */ }

        void this._probeAvailability();
        return this._root;
    }

    private _onTranscribeStart = (): void => {
        if (this._micBtnEl) this._setMicTitle("micTooltipProcessing");
        this._opts.onVoiceUI?.("processing");
    };
    private _onTranscribeEnd = (): void => {
        if (this._micBtnEl) this._setMicTitle(this._listening ? "micTooltipListening" : "micTooltipIdle");
        this._opts.onVoiceUI?.("idle");
    };
    // A non-fatal audio-device / Web Audio failure during capture. Voice detection is
    // dead but recording may continue, so we tell the user why (in the composer status
    // and a toast) rather than letting it look like an unresponsive mic.
    private _onCaptureWarning = (e: any): void => {
        const code = e?.code || e?.error?.code;
        const key = code === "audio-device" ? "audioDevice"
            : code === "insecure-context" ? "insecureContext"
            : "captureFailed";
        const message = $.t(key, {ns: "speech-to-text"});
        try { this._opts.setStatus(message); } catch (_e) { /* ignore */ }
        try {
            (window as any).Dialogs?.show(message, 6000, (window as any).Dialogs?.MSG_WARN);
        } catch (_e) { /* toast is best-effort */ }
    };

    /** Forwarded live input level while capturing → drives the recording meter. */
    private _onLevel = (level: number): void => {
        this._opts.onVoiceUI?.("listening", level);
    };

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
        this._opts.onVoiceUI?.("listening", 0);
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
            this._opts.onVoiceUI?.("idle");
            this._setListening(false);
        }
    }

    /**
     * The user pressed Send while dictating. Stop the mic immediately and, for a
     * manual dictation, wait until its transcript has been flushed into the input
     * so the caller can send it in the same gesture. Hands-free auto mode is just
     * switched off (it manages its own submissions). No-op when not capturing.
     */
    async finishAndFlush(): Promise<void> {
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

        let handle: any = null;
        try {
            // ONE persistent continuous session for the whole hands-free lifetime.
            // The mic keeps listening even while the assistant computes a reply —
            // safe today because the chat plays no TTS audio that could echo into
            // the capture (if TTS is ever added, gate/duck the capture here).
            // Completed turns arrive via onTurn and are queued; nothing the user
            // says is ever dropped, only deferred until the assistant is idle.
            handle = this._stt.startContinuousDictation({
                language: this._opts.language,
                prompt: this._resolvePrompt(),
                silenceMs: this._opts.silenceMs,
                onLevel: this._onLevel,
                turnSilenceMs: this._opts.turnSilenceMs,
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
                    // Report rejections here — they never reach onTurn, so this is the
                    // only place an observer can see what the gates dropped.
                    if (!accepted && text) {
                        this._reportSegment({ text, index: this._segmentIndex, accepted: false, mode: "continuous" });
                    }
                    return accepted;
                },
                onTurn: (turn: any) => this._onTurn(String(turn?.text || "")),
            });
        } catch (_e) {
            return; // the module already surfaced a localized error toast
        }

        this._auto = true;
        this._contHandle = handle;
        this._pendingTurns = [];
        this._segmentIndex = 0;
        this._renderAutoState();
        this._setListening(true);
        this._opts.setStatus(this._t("autoModeListening"));
        this._opts.onVoiceUI?.("listening", 0);
        this._armIdleOff();
        // Bail if the composer becomes unusable (logout, panel closed, teardown)
        // so the mic can't keep listening in the background.
        this._watchdog = window.setInterval(() => {
            if (this._auto && !this._opts.isReady()) this.stopAuto();
        }, 1000);
        // The session ending on its own (capture error, external stop) must also
        // switch auto mode off; guard on the handle so a restarted session's
        // completion can't kill its successor.
        const sync = () => { if (this._auto && this._contHandle === handle) this.stopAuto(); };
        handle.done.then(sync, sync);
    }

    /** A completed (turn-idle-delimited) speech turn arrived from the session. */
    private _onTurn(text: string): void {
        const clean = text.trim();
        if (!this._auto || !clean) return;
        this._reportSegment({ text: clean, index: this._segmentIndex++, accepted: true, mode: "continuous" });
        if (!this._opts.isReady()) { this.stopAuto(); return; }
        this._pendingTurns.push(clean);
        this._armIdleOff();
        if (this._opts.isBusy()) this._opts.setStatus(this._t("autoModeQueued"));
        void this._maybeSubmit();
    }

    /**
     * Drain queued turns, one submission at a time. A turn completed while the
     * assistant was replying is held and goes out as the next message the moment
     * the reply finishes.
     */
    private async _maybeSubmit(): Promise<void> {
        if (this._submitting) return;
        this._submitting = true;
        try {
            while (this._auto && this._pendingTurns.length) {
                if (!this._opts.isReady()) { this.stopAuto(); return; }
                // Assistant mid-response: the turn may have been triggered by a
                // manual send too, so poll rather than rely on our own submit().
                if (this._opts.isBusy()) { await this._delay(150); continue; }
                const text = this._pendingTurns.splice(0).join(" ");
                this._opts.fillInput(text);
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
                await this._delay(this._opts.reArmDelayMs ?? 500); // let the reply settle
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
        if (!this._auto && !this._listening) { this._renderAutoState(); return; }
        this._auto = false;
        this._pendingTurns = [];
        this._contHandle = null;
        try { this._stt?.stop(); } catch (_e) { /* ignore */ }
        this._setListening(false);
        this._opts.onVoiceUI?.("idle");
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
            this._stt?.removeHandler("transcription-error", this._onTranscribeEnd);
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
            this._autoBtnEl.classList.toggle("animate-pulse", this._auto);
            const tip = this._auto ? this._t("autoModeTooltipOn") : this._t("autoModeTooltipOff");
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
