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

    constructor(options: ChatVoiceControllerOptions) {
        this._opts = options;
        // Silence auto-stop is what makes hands-free (and click-free dictation)
        // work; default it so voice mode is usable without extra config. A
        // deployment can still override or disable it (0) via `voice.silenceMs`.
        if (this._opts.silenceMs === undefined || this._opts.silenceMs === null) {
            this._opts.silenceMs = 2000;
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
    };
    private _onTranscribeEnd = (): void => {
        if (this._micBtnEl) this._setMicTitle(this._listening ? "micTooltipListening" : "micTooltipIdle");
    };

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
        try {
            const {text} = await this._stt.transcribeOnce({
                language: this._opts.language,
                silenceMs: this._opts.silenceMs,
            });
            const clean = String(text || "").trim();
            if (!clean) {
                this._opts.setStatus(this._t("noSpeechDetected"));
                return;
            }
            this._opts.setStatus("");
            this._opts.fillInput(clean);
            if (this._opts.autoSubmit) await this._opts.submit();
        } catch (_e) {
            // The module already surfaces a localized toast; keep the composer quiet.
            this._opts.setStatus("");
        } finally {
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
            let text = "";
            try {
                const r = await this._stt.transcribeOnce({
                    language: this._opts.language,
                    silenceMs: this._opts.silenceMs,
                });
                text = String(r?.text || "").trim();
            } catch (_e) {
                this._stopAuto();
                break;
            } finally {
                this._setListening(false);
            }

            if (!this._auto) break; // toggled off during capture — discard

            if (!text) {
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

    private _stopAuto(): void {
        if (!this._auto && !this._listening) { this._renderAutoState(); return; }
        this._auto = false;
        try { this._stt?.stop(); } catch (_e) { /* ignore */ }
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
