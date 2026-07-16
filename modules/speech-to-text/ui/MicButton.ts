/// <reference path="../../../src/types/globals.d.ts" />

import type {SpeechToTextModule, DictationHandle} from "../speech-to-text";
import type {TranscriptionResult} from "../drivers/driver";

// Cross-boundary UI access is via the global UI/van namespaces, never ES imports
// from `ui/` (§0/§5). BaseComponent gives us reactive class/prop state for free.
const {BaseComponent} = (globalThis as any).UI;
const {button, i} = (globalThis as any).van.tags;

type MicState = "idle" | "listening" | "processing" | "unavailable";

export interface MicButtonOptions {
    id?: string;
    /** Injected by `SpeechToTextModule.createMicButton`; not set by consumers. */
    module?: SpeechToTextModule;
    /** Called with the final transcript text (and full result). */
    onResult?: (text: string, result: TranscriptionResult) => void;
    /** Called on capture/transcription failure (already shown as a toast too). */
    onError?: (error: any) => void;
    /** BCP-47 language hint passed to the driver. */
    language?: string;
    /** Extra classes/props forwarded to BaseComponent. */
    extraClasses?: any;
    extraProperties?: any;
}

/**
 * Reusable microphone toggle button. Click to start dictation, click again to
 * stop; the transcript is delivered via `onResult`. Purely a thin control over
 * `SpeechToTextModule` — it holds no transcription logic itself, so it behaves
 * identically regardless of which driver is active.
 */
export class MicButton extends BaseComponent {
    private _module: SpeechToTextModule;
    private _opts: MicButtonOptions;
    private _state: any;               // van.state<MicState>
    private _iconClass: any;           // van.state<string>
    private _title: any;               // van.state<string>
    private _handle: DictationHandle | null = null;

    constructor(options: MicButtonOptions = {}) {
        options = (super(options) as any).options;
        this._opts = options;
        this._module = options.module as SpeechToTextModule;
        this.id = options.id || "speech-to-text-mic";

        const van = (globalThis as any).van;
        this._state = van.state("idle" as MicState);
        this._iconClass = van.state(this._iconFor("idle"));
        this._title = van.state("");

        this.classMap = {
            ...(this.classMap || {}),
            base: "btn btn-ghost btn-sm btn-circle",
        };
        this.refreshClassState();

        // Reflect availability once, then keep the button usable; a stale probe
        // shouldn't permanently disable dictation, so failures degrade to "idle".
        this._refreshAvailability();
    }

    private _iconFor(state: MicState): string {
        switch (state) {
            case "listening": return "ph-light ph-microphone text-error animate-pulse";
            case "processing": return "ph-light ph-circle-notch animate-spin";
            case "unavailable": return "ph-light ph-microphone-slash opacity-50";
            default: return "ph-light ph-microphone";
        }
    }

    private _t(key: string): string {
        try { return this._module ? this._module.t(key) : $.t(key, {ns: "speech-to-text"}); }
        catch (_e) { return key; }
    }

    private _titleFor(state: MicState): string {
        if (state === "listening") return this._t("micTooltipListening");
        if (state === "unavailable") return this._t("micTooltipUnavailable");
        return this._t("micTooltipIdle");
    }

    private _setState(state: MicState): void {
        this._state.val = state;
        this._iconClass.val = this._iconFor(state);
        this._title.val = this._titleFor(state);
    }

    private async _refreshAvailability(): Promise<void> {
        try {
            await this._module?.whenLocaleReady?.();
        } catch (_e) { /* ignore */ }
        let ok = false;
        try { ok = !!(await this._module?.isAvailable()); } catch (_e) { ok = false; }
        this._setState(ok ? "idle" : "unavailable");
    }

    private async _onClick(): Promise<void> {
        const state = this._state.val as MicState;
        if (state === "processing") return;

        if (state === "listening") {
            // Second click ends capture; the pending promise resolves below.
            this._setState("processing");
            this._handle?.stop();
            return;
        }

        // Start dictation (works even if a prior availability probe said otherwise —
        // getUserMedia will surface the real permission state).
        let handle: DictationHandle;
        try {
            handle = this._module.startDictation({language: this._opts.language});
        } catch (e) {
            this._fail(e);
            return;
        }
        this._handle = handle;
        this._setState("listening");

        try {
            const result = await handle.done;
            this._setState("idle");
            if (!result.text) {
                // Silence / noise-only capture: the module never transcribed it
                // (no hallucinated text exists) — tell the user instead of
                // silently doing nothing, and don't bother the consumer.
                try {
                    (window as any).Dialogs?.show(this._t("noSpeechDetected"), 3000, (window as any).Dialogs?.MSG_INFO);
                } catch (_e) { /* toast is best-effort */ }
                return;
            }
            this._opts.onResult?.(result.text, result);
        } catch (e) {
            this._fail(e);
        } finally {
            this._handle = null;
        }
    }

    private _fail(error: any): void {
        this._setState("idle");
        const code = error?.code;
        const key = code === "permission-denied" ? "permissionDenied"
            : code === "no-microphone" ? "noMicrophone"
            : code === "unsupported" || code === "capture-failed" ? "captureFailed"
            : "transcriptionFailed";
        try {
            (window as any).Dialogs?.show(this._t(key), 4000, (window as any).Dialogs?.MSG_WARN);
        } catch (_e) { /* toast is best-effort */ }
        this._opts.onError?.(error);
    }

    /** @override */
    create(): Node {
        return button(
            {
                ...this.commonProperties,
                type: "button",
                title: this._title,
                "aria-label": this._title,
                onclick: () => { this._onClick(); },
                ...this.extraProperties,
            },
            i({class: this._iconClass}),
        );
    }
}
