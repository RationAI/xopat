/**
 * Silero VAD engine — the module's persistent speech detector.
 *
 * Wraps `@ricky0123/vad-web`'s `MicVAD` (Silero v5 over onnxruntime-web, WASM
 * backend) so the capture can consume it as a plain frame source: every ~32 ms a
 * `{t, peak, prob, frame}` — the 16 kHz Float32 frame the model just scored, its
 * speech probability, and its max-abs peak. The capture's own gate turns the
 * probability into the speech verdict; the frames themselves become the WAV segment
 * uploads, so the audio a transcription model receives is exactly the audio the
 * VAD judged.
 *
 * ONE instance per module, alive for the page: it owns its `AudioContext` (never the
 * capture's, which is created and closed per session), loads the model once, and per
 * session `attach`es the capture's stream (`MicVAD.start()`) and `detach`es it
 * (`MicVAD.pause()`). The library's default `pauseStream` STOPS the tracks — the
 * capture owns those, so both stream hooks are no-ops that hand back the live stream.
 *
 * The library's own segmenter (`onSpeechStart`/`onSpeechEnd`, redemption, padding)
 * is neutralised: `audioCapture.ts` has the timers, cuts and turn logic already, and
 * one decision point is the whole idea.
 *
 * Assets (worklet bundle, ONNX model, onnxruntime-web glue + wasm) are served from
 * the same origin under `assetsUrl` — copied out of `node_modules` by the module's
 * `package.json` `copy` directive — so no CDN, no hash pinning, and nothing needed
 * from `secureMode`. Threads are off (`numThreads = 1`): no COOP/COEP requirement,
 * no blob workers for a CSP to block.
 */

import {MicVAD} from "@ricky0123/vad-web";
import {CaptureError} from "./captureError";

export interface SileroOptions {
    /** Same-origin directory holding the vendored assets; must end with "/". */
    assetsUrl: string;
    /** Probability at which speech turns on. */
    positiveSpeechThreshold: number;
    /** Probability below which speech turns off. */
    negativeSpeechThreshold: number;
    /** Bound on the first-ever model/wasm load; past it the session falls back to amplitude. */
    loadTimeoutMs: number;
}

export interface SileroFrame {
    /** `performance.now()` at scoring time. */
    t: number;
    /** Max-abs sample of the frame, 0..1. */
    peak: number;
    /** Silero speech probability, 0..1. */
    prob: number;
    /** The scored 16 kHz Float32 frame (512 samples). Owned by the library: copy to retain. */
    frame: Float32Array;
}

export type SileroState = "idle" | "loading" | "ready" | "failed";

const log = () => APPLICATION_CONTEXT.log("module.speech-to-text:vad");

export class SileroVadEngine {
    private readonly _o: SileroOptions;
    private _ctx: AudioContext | null = null;
    private _vad: MicVAD | null = null;
    private _load: Promise<void> | null = null;
    private _state: SileroState = "idle";
    private _stream: MediaStream | null = null;
    private _onFrame: ((f: SileroFrame) => void) | null = null;

    constructor(opts: SileroOptions) {
        this._o = opts;
    }

    /** Web Audio worklets + WebAssembly are all the engine needs from the browser. */
    static isSupported(): boolean {
        try {
            const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
            return !!AC && typeof (window as any).AudioWorkletNode === "function"
                && typeof (window as any).WebAssembly === "object";
        } catch (_e) {
            return false;
        }
    }

    get state(): SileroState {
        return this._state;
    }

    /** The engine-owned context, for the capture's health poll (state, clock, resume). */
    get context(): AudioContext | null {
        return this._ctx;
    }

    /**
     * Load the model once. Memoized while loading/ready; a failure clears the memo so
     * the next session retries (still bounded by `loadTimeoutMs`), and rejects with a
     * `CaptureError("vad-fallback")` naming the reason.
     */
    load(): Promise<void> {
        if (this._load) return this._load;
        this._state = "loading";
        const attempt = (async () => {
            if (!SileroVadEngine.isSupported()) throw new CaptureError("vad-fallback", "silero unsupported in this browser");
            if (!this._ctx) {
                const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
                this._ctx = new AC();
            }
            const ctx = this._ctx!;
            const o = this._o;
            const vad = await MicVAD.new({
                model: "v5",
                startOnLoad: false,
                processorType: "AudioWorklet",
                baseAssetPath: o.assetsUrl,
                onnxWASMBasePath: o.assetsUrl,
                ortConfig: (ort: any) => {
                    // Single-threaded: no SharedArrayBuffer (COOP/COEP) requirement and no
                    // blob: workers for a CSP to refuse. Silero v5 is ~1 ms/frame either way.
                    ort.env.wasm.numThreads = 1;
                    ort.env.wasm.proxy = false;
                },
                audioContext: ctx,
                getStream: async () => this._stream!,
                resumeStream: async () => this._stream!,
                // The library default stops the tracks; the capture owns them.
                pauseStream: async () => { /* no-op */ },
                positiveSpeechThreshold: o.positiveSpeechThreshold,
                negativeSpeechThreshold: o.negativeSpeechThreshold,
                // The capture's gate owns onset/offset timing; the library's segmenter is idle.
                minSpeechMs: 0,
                preSpeechPadMs: 0,
                redemptionMs: 0,
                onFrameProcessed: (p: { isSpeech: number }, frame: Float32Array) => this._emit(p?.isSpeech ?? 0, frame),
                onSpeechStart: () => { /* unused */ },
                onSpeechEnd: () => { /* unused */ },
                onVADMisfire: () => { /* unused */ },
            } as any);
            this._vad = vad;
        })();
        let timer: number | null = null;
        const timeout = new Promise<never>((_, reject) => {
            timer = window.setTimeout(() => reject(new CaptureError("vad-fallback", `silero load timed out after ${this._o.loadTimeoutMs} ms`)), Math.max(1000, this._o.loadTimeoutMs));
        });
        this._load = Promise.race([attempt, timeout]).then(() => {
            this._state = "ready";
            log().debug("silero VAD ready");
        }, (e: any) => {
            this._state = "failed";
            this._load = null;
            const err = e instanceof CaptureError ? e : new CaptureError("vad-fallback", e?.message || String(e));
            log().warn({error: err.message}, "silero VAD unavailable, amplitude gate will be used");
            throw err;
        }).finally(() => {
            if (timer) clearTimeout(timer);
        });
        return this._load;
    }

    /** Start scoring `stream`; frames arrive on `onFrame` until {@link detach}. */
    async attach(stream: MediaStream, onFrame: (f: SileroFrame) => void): Promise<void> {
        if (!this._vad || this._state !== "ready") throw new CaptureError("vad-fallback", "silero not loaded");
        const vad = this._vad;
        // A previous session's start() may still be in flight (its detach found nothing
        // to pause yet); settle it before wiring the new stream.
        if (vad.listening) { try { await vad.pause(); } catch (_e) { /* ignore */ } }
        this._stream = stream;
        this._onFrame = onFrame;
        try { await this._ctx?.resume?.(); } catch (_e) { /* the health poll retries */ }
        // First call → getStream; later calls → resumeStream + a fresh source node.
        await vad.start();
        if (this._onFrame !== onFrame) {
            // Detached while starting: the session is gone, don't leave it listening.
            try { await vad.pause(); } catch (_e) { /* ignore */ }
            return;
        }
        if (vad.errored) {
            this._onFrame = null;
            throw new CaptureError("vad-fallback", String(vad.errored));
        }
    }

    /** Stop scoring; the model and worklet stay warm for the next session. */
    detach(): void {
        this._onFrame = null;
        const vad = this._vad;
        if (!vad || !vad.listening) { this._stream = null; return; }
        try { void vad.pause(); } catch (_e) { /* ignore */ }
        this._stream = null;
    }

    /** Release the model and the context. Module lifetime only. */
    dispose(): void {
        this.detach();
        const vad = this._vad;
        this._vad = null;
        this._load = null;
        this._state = "idle";
        try { void vad?.destroy(); } catch (_e) { /* ignore */ }
        try { void this._ctx?.close(); } catch (_e) { /* ignore */ }
        this._ctx = null;
    }

    private _emit(prob: number, frame: Float32Array): void {
        const cb = this._onFrame;
        if (!cb) return;
        let peak = 0;
        for (let i = 0; i < frame.length; i++) {
            const s = frame[i] ?? 0;
            const v = s < 0 ? -s : s;
            if (v > peak) peak = v;
        }
        try { cb({t: performance.now(), peak, prob, frame}); }
        catch (e) { log().error(e, "silero frame handler failed"); }
    }
}
