/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../src/types/loader.d.ts" />

import {AudioCapture, CaptureError} from "./audioCapture";
import {TranscriptionDriver, TranscriptionOptions, TranscriptionResult} from "./drivers/driver";
import {RemoteWhisperConfig, RemoteWhisperDriver} from "./drivers/remoteWhisper";
import {WasmWhisperConfig, WasmWhisperDriver} from "./drivers/wasmWhisper";
import {MicButton, MicButtonOptions} from "./ui/MicButton";

/**
 * Handle returned by {@link SpeechToTextModule.startDictation}: lets the caller
 * stop capture and (for hands-free flows) await the final transcript.
 */
export interface DictationHandle {
    /** Stop capture; the pending transcription then resolves via `done`. */
    stop(): void;
    /** Resolves with the transcript once capture stops and the driver returns. */
    done: Promise<TranscriptionResult>;
}

/**
 * Speech-to-Text module.
 *
 * A standalone, viewer-agnostic capability: capture microphone audio and turn it
 * into text through a pluggable driver (remote self-hosted Whisper by default,
 * in-browser WASM fallback). It owns no UI beyond an optional reusable mic button
 * that any consumer (chat, annotations, plugins) can mount; consumers reach it
 * via `singletonModule('speech-to-text')`.
 *
 * Security: driver/endpoint selection comes only from `getStaticMeta` (ENV,
 * trusted), never from per-session `getOption` (§7). All upstream audio goes
 * through `HttpClient`; the WASM library is hash-verified before import.
 */
class SpeechToTextModule extends (XOpatModuleSingleton as any) {
    private _drivers: Map<string, TranscriptionDriver>;
    private _activeDriverId: string | null;
    private _capture: AudioCapture;
    private _defaults: { language?: string; silenceMs?: number };
    private _localeReady: Promise<void>;

    constructor() {
        super();
        this._drivers = new Map();
        this._activeDriverId = null;
        this._capture = new AudioCapture();
        this._localeReady = this.loadLocale().catch((e: any) =>
            console.warn("[speech-to-text] locale load failed:", e));

        const language = this.getStaticMeta("language", undefined) as string | undefined;
        const silenceMs = this.getStaticMeta("silenceMs", 0) as number;
        this._defaults = {language, silenceMs: this.getStaticMeta("autoStop", false) ? (silenceMs || 1500) : silenceMs};

        this._buildConfiguredDrivers();
    }

    /** Instantiate drivers declared in ENV/include.json and pick the active one. */
    private _buildConfiguredDrivers(): void {
        const requested = String(this.getStaticMeta("driver", "remote"));

        const remote = this.getStaticMeta("remote", null) as RemoteWhisperConfig | Record<string, RemoteWhisperConfig> | null;
        if (remote) {
            // Accept either a single endpoint object or a map of { id: config }.
            const entries: Array<[string, RemoteWhisperConfig]> = (remote as any).path
                ? [["remote", remote as RemoteWhisperConfig]]
                : Object.entries(remote as Record<string, RemoteWhisperConfig>);
            for (const [id, cfg] of entries) {
                try {
                    this.registerDriver(new RemoteWhisperDriver(id, cfg));
                } catch (e) {
                    console.error(`[speech-to-text] failed to build remote driver "${id}":`, e);
                }
            }
        }

        // WASM (in-browser transformers.js) driver. Built when configured OR when
        // it is the requested driver — it needs no config to work (sensible CDN
        // library + default Whisper model), so `"driver": "wasm"` is enough.
        const wasm = this.getStaticMeta("wasm", null) as WasmWhisperConfig | null;
        if (wasm || requested === "wasm") {
            try {
                this.registerDriver(new WasmWhisperDriver("wasm", wasm || {}));
            } catch (e) {
                console.error("[speech-to-text] failed to build wasm driver:", e);
            }
        }

        // Prefer the explicitly requested driver, else the first registered one.
        if (this._drivers.has(requested)) this._activeDriverId = requested;
        else if (this._drivers.size) this._activeDriverId = this._drivers.keys().next().value;
    }

    // ---- driver registry (consumers may add their own transport) ----

    registerDriver(driver: TranscriptionDriver): void {
        if (!driver?.id || typeof driver.transcribe !== "function") {
            throw new Error("[speech-to-text] a driver needs an id and a transcribe() method.");
        }
        this._drivers.set(driver.id, driver);
        if (!this._activeDriverId) this._activeDriverId = driver.id;
        this.raiseEvent("drivers-changed");
    }

    unregisterDriver(id: string): void {
        const d = this._drivers.get(id);
        try { d?.dispose?.(); } catch (_e) { /* ignore */ }
        this._drivers.delete(id);
        if (this._activeDriverId === id) {
            this._activeDriverId = this._drivers.size ? this._drivers.keys().next().value : null;
        }
        this.raiseEvent("drivers-changed");
    }

    listDrivers(): Array<{ id: string; label: string; local: boolean; active: boolean }> {
        return Array.from(this._drivers.values()).map(d => ({
            id: d.id, label: d.label, local: d.local, active: d.id === this._activeDriverId,
        }));
    }

    getActiveDriverId(): string | null {
        return this._activeDriverId;
    }

    /** Switch the active driver by id (no-op if unknown). */
    setActiveDriver(id: string): boolean {
        if (!this._drivers.has(id)) return false;
        this._activeDriverId = id;
        this.raiseEvent("active-driver-changed", {id});
        return true;
    }

    private _activeDriver(): TranscriptionDriver | null {
        return this._activeDriverId ? this._drivers.get(this._activeDriverId) || null : null;
    }

    // ---- capability probe ----

    /** True when capture is supported, permission is grantable, and a driver is reachable. */
    async isAvailable(): Promise<boolean> {
        const driver = this._activeDriver();
        if (!driver) return false;
        if (!(await this._capture.canCapture())) return false;
        try {
            return await driver.isAvailable();
        } catch (_e) {
            return false;
        }
    }

    // ---- transcription ----

    /**
     * Capture a single utterance and resolve to its transcript. Auto-stops on
     * silence when `silenceMs`/`autoStop` is configured; otherwise stops at the
     * safety max duration or when {@link stop} is called.
     */
    async transcribeOnce(opts: TranscriptionOptions & { silenceMs?: number } = {}): Promise<TranscriptionResult> {
        const driver = this._activeDriver();
        if (!driver) throw new CaptureError("capture-failed", "no transcription driver");

        this.raiseEvent("recording-started");
        let audio: Blob;
        try {
            audio = await this._capture.record({
                silenceMs: opts.silenceMs ?? this._defaults.silenceMs,
            });
        } finally {
            this.raiseEvent("recording-stopped");
        }

        this.raiseEvent("transcription-started");
        try {
            const result = await driver.transcribe(audio, {
                language: opts.language ?? this._defaults.language,
                signal: opts.signal,
            });
            this.raiseEvent("transcription", {result});
            return result;
        } catch (e) {
            this.raiseEvent("transcription-error", {error: e});
            throw e;
        }
    }

    /**
     * Start manual (push-to-talk) dictation. Returns a handle whose `stop()`
     * ends capture; `done` resolves with the transcript. Useful when the caller
     * drives start/stop from its own UI instead of silence detection.
     */
    startDictation(opts: TranscriptionOptions = {}): DictationHandle {
        const done = this.transcribeOnce({...opts, silenceMs: 0});
        return {
            stop: () => this._capture.stop(),
            done,
        };
    }

    /** Stop any in-progress capture (resolves the pending transcription). */
    stop(): void {
        this._capture.stop();
    }

    // ---- UI factory (consumers can't ES-import across boundaries) ----

    /**
     * Build a reusable mic button bound to this module. Mount it anywhere:
     * `singletonModule('speech-to-text').createMicButton({onResult}).attachTo(el)`.
     */
    createMicButton(options: MicButtonOptions = {}): MicButton {
        return new MicButton({...options, module: this});
    }

    /** Resolve a localized string from this module's namespace. */
    t(key: string, options?: any): string {
        return $.t(key, {ns: this.id, ...(options || {})});
    }

    /** Await first-time locale load (mainly for UI that renders labels immediately). */
    whenLocaleReady(): Promise<void> {
        return this._localeReady;
    }
}

addModule("speech-to-text", SpeechToTextModule as any, true);

export {SpeechToTextModule};
