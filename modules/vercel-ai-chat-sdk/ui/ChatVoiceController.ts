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
//  - never submit an empty transcript;
//  - manual dictation fills the input for review (no surprise auto-send);
//  - auto mode listens only while the assistant is idle (it awaits `submit()`
//    before re-arming), and gives up after a streak of empty captures so the
//    microphone can never stay hot forever.

const {Button, FAIcon} = (globalThis as any).UI;
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
    /** BCP-47 language hint forwarded to the transcription driver. */
    language?: string;
    /** Silence auto-stop window (ms). Falls back to the module's own default. */
    silenceMs?: number;
    /** Auto-submit a manual dictation instead of just filling the input. */
    autoSubmit?: boolean;
    /** Consecutive empty captures in auto mode before it switches itself off. */
    maxEmptyRetries?: number;
    /** Delay before re-arming the mic after the assistant replies (ms). */
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
    private _autoBtnEl: HTMLButtonElement | null = null;

    private _listening = false;
    private _auto = false;
    private _disabled = false;
    /** Active continuous session handle while an auto-mode turn is being captured. */
    private _contHandle: any = null;

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

    private _t(key: string): string {
        try {
            if (this._stt?.t) return this._stt.t(key);
            return $.t(key, {ns: "speech-to-text"});
        } catch (_e) {
            return key;
        }
    }

    /** Build the DOM (mic + auto toggle). Returns an empty, hidden span if unusable. */
    create(): HTMLElement {
        this._root = span({class: "flex items-center gap-1"}) as HTMLElement;

        if (!this._stt) {
            this._root.classList.add("hidden");
            return this._root;
        }

        this._micBtnEl = new Button(
            {
                base: "btn btn-sm btn-circle btn-ghost",
                type: Button.TYPE.NONE,
                extraProperties: {title: this._t("micTooltipIdle"), "aria-label": this._t("micTooltipIdle")},
                onClick: () => { void this._onMicClick(); },
            },
            new FAIcon({name: "fa-microphone"})
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
    private _wrongLanguage(result: any): boolean {
        const want = this._opts.language;
        const got = result?.language;
        if (!want || !got) return false;
        const base = (s: string) => String(s).toLowerCase().split(/[-_]/)[0];
        return base(want) !== base(got);
    }

    /** Stop the in-progress capture (used by the recording overlay's click). */
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

    // ---- manual dictation ----

    private async _onMicClick(): Promise<void> {
        if (this._auto) return;
        if (this._listening) { this._stt.stop(); return; } // click again = stop early
        if (!this._opts.isReady() || this._opts.isBusy()) return;

        this._setListening(true);
        this._opts.setStatus(this._t("listening"));
        this._opts.onVoiceUI?.("listening", 0);
        try {
            const r = await this._stt.transcribeOnce({
                language: this._opts.language,
                silenceMs: this._opts.silenceMs,
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
            this._opts.setStatus("");
            this._opts.fillInput(clean);
            if (this._opts.autoSubmit && !this._looksLikeNoise(clean) && !this._wrongLanguage(r)) {
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

    // ---- hands-free conversation loop ----

    private _onAutoClick(): void {
        if (this._auto) { this._stopAuto(); return; }
        void this._startAuto();
    }

    private async _startAuto(): Promise<void> {
        if (this._auto) return;
        if (!this._opts.isReady()) return;
        this._auto = true;
        this._renderAutoState();

        const maxEmpty = Math.max(1, this._opts.maxEmptyRetries ?? 3);
        let empties = 0;

        while (this._auto) {
            // Bail if the composer is no longer usable (logout, panel closed,
            // setup incomplete) so the mic can't keep listening in the background.
            if (!this._opts.isReady()) { this._stopAuto(); break; }
            // Never capture while the assistant is mid-response.
            if (this._opts.isBusy()) { await this._delay(150); continue; }

            this._setListening(true);
            this._opts.setStatus(this._t("autoModeListening"));
            this._opts.onVoiceUI?.("listening", 0);
            let text = "";
            let result: any = null;
            try {
                // Continuous capture: the mic stays open across the whole turn, so
                // each silence-delimited segment is transcribed *while the next is
                // still being recorded* and the pieces are concatenated. Nothing the
                // user says during a segment's transcription is lost. The turn ends
                // on a longer end-of-turn silence (turnSilenceMs).
                result = await this._captureTurn();
                text = String(result?.text || "").trim();
            } catch (_e) {
                this._opts.onVoiceUI?.("idle");
                this._stopAuto();
                break;
            } finally {
                this._setListening(false);
            }

            if (!this._auto) break; // toggled off during capture — discard

            // Treat empty, sub-threshold ("어"), or wrong-language ("Música", a
            // Japanese non-sequitur) captures as no-speech so hands-free mode never
            // submits a mistranscribed noise burst as a real conversational turn.
            if (!text || this._looksLikeNoise(text) || this._wrongLanguage(result)) {
                if (++empties >= maxEmpty) {
                    this._opts.setStatus(this._t("autoModeEnded"));
                    this._stopAuto();
                    break;
                }
                this._opts.setStatus(this._t("noSpeechDetected"));
                continue; // re-arm
            }
            empties = 0;

            this._opts.fillInput(text);
            this._opts.setStatus(this._t("autoModeWaiting"));
            try {
                await this._opts.submit(); // resolves when the assistant turn ends
            } catch (_e) {
                this._stopAuto();
                break;
            }
            if (!this._auto) break;
            await this._delay(this._opts.reArmDelayMs ?? 500); // let the reply settle
        }
    }

    /**
     * Capture one hands-free turn with continuous dictation. Resolves with the
     * concatenated transcript once the user pauses for `turnSilenceMs` (turn-idle),
     * the session is stopped externally, or an onset window elapses with no speech
     * (so a silent turn feeds the empty-retry logic that eventually stops auto mode).
     */
    private _captureTurn(): Promise<any> {
        return new Promise((resolve, reject) => {
            const turnSilenceMs = this._opts.turnSilenceMs ?? 2000;
            // Give up on a fully silent turn after a generous window; cleared as soon
            // as any speech begins to be transcribed.
            const onsetTimeoutMs = Math.max(6000, turnSilenceMs * 3);
            let finished = false;
            let onsetTimer: any = setTimeout(() => this._endTurn(), onsetTimeoutMs);
            let handle: any = null;

            const settle = (fn: (v: any) => void, v: any): void => {
                if (finished) return;
                finished = true;
                if (onsetTimer) { clearTimeout(onsetTimer); onsetTimer = null; }
                this._contHandle = null;
                fn(v);
            };

            try {
                handle = this._stt.startContinuousDictation({
                    language: this._opts.language,
                    silenceMs: this._opts.silenceMs,
                    onLevel: this._onLevel,
                    turnSilenceMs,
                    onTurnIdle: () => this._endTurn(),
                    onPartial: () => {
                        // Speech is being transcribed — cancel the silent-turn giveup.
                        if (onsetTimer) { clearTimeout(onsetTimer); onsetTimer = null; }
                    },
                });
            } catch (e) {
                if (onsetTimer) { clearTimeout(onsetTimer); onsetTimer = null; }
                reject(e);
                return;
            }
            this._contHandle = handle;
            // `done` resolves when capture ended (turn-idle stop, external stop, or
            // error) and every segment finished transcribing → the final transcript.
            handle.done.then((r: any) => settle(resolve, r), (e: any) => settle(reject, e));
        });
    }

    /** End the in-progress continuous turn; its `done` then resolves the transcript. */
    private _endTurn(): void {
        try { this._contHandle?.stop(); } catch (_e) { /* ignore */ }
    }

    private _stopAuto(): void {
        if (!this._auto && !this._listening) { this._renderAutoState(); return; }
        this._auto = false;
        try { this._stt?.stop(); } catch (_e) { /* ignore */ }
        this._opts.onVoiceUI?.("idle");
        this._renderAutoState();
    }

    /** Stop everything (called by the panel on teardown / hard reset). */
    stopAll(): void {
        this._stopAuto();
        // Release the singleton speech-to-text handlers so this controller (and
        // its closures) don't stay reachable through the long-lived module.
        try {
            this._stt?.removeHandler("transcription-started", this._onTranscribeStart);
            this._stt?.removeHandler("transcription", this._onTranscribeEnd);
            this._stt?.removeHandler("transcription-error", this._onTranscribeEnd);
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
        if (!this._micBtnEl) return;
        this._micBtnEl.classList.toggle("text-error", on);
        this._micBtnEl.classList.toggle("animate-pulse", on);
        this._setMicTitle(on ? "micTooltipListening" : "micTooltipIdle");
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
