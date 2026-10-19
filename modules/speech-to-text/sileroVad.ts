/**
 * Silero VAD engine — the module's persistent speech detector.
 *
 * Wraps `@ricky0123/vad-web`'s `MicVAD` (Silero v6 over onnxruntime-web, WASM
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
    /**
     * How long a STARTING session waits for the model before running on the amplitude
     * gate instead. Enforced by `AudioCapture._selectVad`, and capped there by
     * `VAD_START_GRACE_MS` so it can only shorten the wait: the load continues in the
     * background either way and lands into the next session, so a slow link costs the
     * first dictation its Silero gate, never the microphone itself.
     */
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
    /**
     * Frames emitted since the current attach.
     *
     * The capture's health poll can only see that frames are ABSENT; it cannot tell
     * "the engine never produced one" from "it produced some and stopped", and those
     * are different faults with different fixes. The count makes the fallback warning
     * answer that instead of merely announcing it.
     */
    private _frames = 0;
    /**
     * A silent path from this context to its destination.
     *
     * Chrome does not run the render thread for a context whose graph reaches no
     * destination, and `@ricky0123/vad-web`'s AudioWorklet path connects only
     * `source -> vadNode` (`real-time-vad.js`, the `uninitialized` branch of
     * `start()`). Its own ScriptProcessor path DOES connect to the destination, with
     * the comment `we need to connect an output or will not work due to chrome bug`
     * (webaudio issue #345) — the worklet path simply never got the same treatment.
     *
     * Without this the engine loads, installs its worklet, reports `started micVAD`
     * and then emits nothing at all: `currentTime` never advances, the capture's
     * health poll reads a running-but-frozen context and demotes every session to
     * the amplitude gate within two seconds.
     *
     * A zero-offset ConstantSourceNode through a zero-gain node, rather than routing
     * the VAD node itself: it keeps the context rendering without reaching into the
     * library's internals, and it outputs silence so nothing is ever audible. The
     * same trick, for the same reason, is in `audioCapture.ts` for the module's own
     * amplitude worklet.
     */
    private _keepAlive: { source: ConstantSourceNode; sink: GainNode } | null = null;
    /**
     * Serializes every `start()` / `pause()` on the library.
     *
     * `MicVAD.start()` is a state machine with two SILENT no-ops: called while
     * `initializing` it logs `start called while initializing` and returns having
     * wired nothing, and called while already `listening` it returns immediately.
     * Both leave the caller believing the engine is attached to its stream when it
     * is attached to nothing — the session then records ~15 s segments that are all
     * discarded as `silent`, and a manual stop/start is the only way out.
     *
     * The capture's stale-session watchdog restarts a dictation without waiting for
     * the previous attach to settle, which is exactly how the second call lands
     * mid-`initializing`. Chaining the operations makes that impossible.
     */
    private _ops: Promise<unknown> = Promise.resolve();

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

    /** Frames emitted since the current {@link attach}. Zero = the engine never ran. */
    get frames(): number {
        return this._frames;
    }

    /** The engine-owned context, for the capture's health poll (state, clock, resume). */
    get context(): AudioContext | null {
        return this._ctx;
    }

    /** Configured patience for the load, in ms. The engine no longer enforces it; the caller does. */
    get loadTimeoutMs(): number {
        return Math.max(0, Number(this._o.loadTimeoutMs) || 0);
    }

    /**
     * Load the model once. Memoized while loading/ready; a failure clears the memo so
     * the next session retries, and rejects with a `CaptureError("vad-fallback")`
     * naming the reason.
     *
     * Deliberately UNBOUNDED. It used to race `loadTimeoutMs` and, on a slow link,
     * lose: the race rejected, the engine was pinned `failed` for the life of the
     * page, and the `MicVAD` that finished building two seconds later was assigned
     * to `_vad` where nothing would ever look at it again — so every later session
     * re-entered the same download and the same timeout, and the whole dictation
     * ran on the amplitude gate with a 16 MB model sitting ready in memory.
     *
     * How long to WAIT for this is the caller's decision, not the engine's, because
     * only the caller knows what is blocked behind it (`AudioCapture._selectVad`
     * waits a short grace and starts on amplitude; the load lands into the next
     * session). The engine's job is only to say, eventually and once, whether the
     * model is usable.
     */
    load(caller = "?"): Promise<void> {
        if (this._load) return this._load;
        this._state = "loading";
        // [vad-debug] TEMPORARY load timing — remove after diagnosis.
        const dbgT0 = performance.now();
        log().info({caller, t0: Math.round(dbgT0)}, "[vad-debug] silero load start");
        const attempt = (async () => {
            if (!SileroVadEngine.isSupported()) throw new CaptureError("vad-fallback", "silero unsupported in this browser");
            if (!this._ctx) {
                const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
                this._ctx = new AC();
            }
            const ctx = this._ctx!;
            const o = this._o;
            const vad = await MicVAD.new({
                // v6, and vad-web >= 0.0.31. Earlier vad-web fed v5 bare 512-sample
                // frames without the 64-sample context window silero-vad's own
                // wrapper prepends; the model then under-scored real speech so badly
                // that whole 15 s segments of dictation were discarded as no-speech.
                // Offline on a recorded session: 114 frames >= 0.5 without context,
                // 274 with (v5), 707 with (v6) — v6 also catches speech replayed
                // through a phone speaker, and still scores silence ~0.
                model: "v6",
                startOnLoad: false,
                processorType: "AudioWorklet",
                baseAssetPath: o.assetsUrl,
                onnxWASMBasePath: o.assetsUrl,
                ortConfig: (ort: any) => {
                    // Single-threaded: no SharedArrayBuffer (COOP/COEP) requirement and no
                    // blob: workers for a CSP to refuse. Silero is ~1 ms/frame either way.
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
            log().info({caller, micVadNewMs: Math.round(performance.now() - dbgT0)}, "[vad-debug] MicVAD.new resolved"); // [vad-debug]
            this._vad = vad;
            this._armKeepAlive(ctx);
        })();
        this._load = attempt.then(() => {
            this._state = "ready";
            log().debug("silero VAD ready");
            log().info({caller, totalMs: Math.round(performance.now() - dbgT0)}, "[vad-debug] silero load ready"); // [vad-debug]
        }, (e: any) => {
            this._state = "failed";
            this._load = null;
            log().info({caller, totalMs: Math.round(performance.now() - dbgT0), error: String(e?.message || e)}, "[vad-debug] silero load failed"); // [vad-debug]
            const err = e instanceof CaptureError ? e : new CaptureError("vad-fallback", e?.message || String(e));
            log().warn({error: err.message}, "silero VAD unavailable, amplitude gate will be used");
            throw err;
        });
        // A caller that gave up waiting (grace expired) is no longer holding this
        // promise, and its eventual rejection must not surface as an unhandled one.
        // The memo above still hands the real rejection to anyone who does await it.
        this._load.catch(() => { /* reported by the handler above */ });
        return this._load;
    }

    /**
     * Give the context a silent path to its destination, once. See {@link _keepAlive}.
     *
     * Best-effort: a browser without `createConstantSource` (or a context that
     * refuses the connection) simply gets the old behaviour, which the capture's
     * health poll already handles by falling back to the amplitude gate.
     */
    private _armKeepAlive(ctx: AudioContext): void {
        if (this._keepAlive) return;
        try {
            const sink = ctx.createGain();
            sink.gain.value = 0;
            sink.connect(ctx.destination);
            const source = ctx.createConstantSource();
            source.offset.value = 0;
            source.connect(sink);
            source.start();
            this._keepAlive = {source, sink};
        } catch (e) {
            log().warn(e, "silero context keep-alive not installed; frames may never be pulled");
        }
    }

    /**
     * Run one library operation after every operation queued before it.
     *
     * Failures do not break the chain — the next operation still runs — because a
     * failed attach must not leave the engine permanently unusable for the rest of
     * the page's life.
     * @private
     */
    private _serial<T>(op: () => Promise<T>): Promise<T> {
        const next = this._ops.then(op, op);
        this._ops = next.then(() => undefined, () => undefined);
        return next;
    }

    /** Start scoring `stream`; frames arrive on `onFrame` until {@link detach}. */
    attach(stream: MediaStream, onFrame: (f: SileroFrame) => void): Promise<void> {
        if (!this._vad || this._state !== "ready") {
            return Promise.reject(new CaptureError("vad-fallback", "silero not loaded"));
        }
        const vad = this._vad;
        return this._serial(async () => {
            // Settle a previous session unconditionally. MicVAD.pause() already
            // returns early when it is not listening, so a `vad.listening` test here
            // only duplicated the library's check — and duplicated it wrongly: the
            // flag is FALSE for the whole window this is meant to cover, while an
            // earlier start() is still initializing. What actually keeps that race
            // unreachable is `_serial`, which holds this body until the previous
            // attach/detach has settled; the unconditional call is what keeps it
            // correct if that ever stops being true.
            try { await vad.pause(); } catch (_e) { /* ignore */ }
            this._stream = stream;
            this._onFrame = onFrame;
            this._frames = 0;
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
            // `start()` reports nothing when it declines to act. Without this check a
            // swallowed call is indistinguishable from a successful attach, and the
            // session runs deaf — every segment discarded as silent — instead of
            // falling back to the amplitude gate, which at least hears.
            if (!vad.listening) {
                this._onFrame = null;
                throw new CaptureError("vad-fallback", "silero start did not take effect");
            }
        });
    }

    /**
     * Stop scoring; the model and worklet stay warm for the next session.
     *
     * The frame callback is dropped synchronously — a consumer that detached must
     * never see another frame — but the library's `pause()` joins the operation
     * chain, so the next `attach()` cannot start on top of a pause still in flight.
     */
    detach(): void {
        this._onFrame = null;
        this._stream = null;
        const vad = this._vad;
        if (!vad) return;
        void this._serial(async () => {
            if (!vad.listening) return;
            try { await vad.pause(); } catch (_e) { /* ignore */ }
        });
    }

    /** Release the model and the context. Module lifetime only. */
    dispose(): void {
        this.detach();
        const vad = this._vad;
        this._vad = null;
        this._load = null;
        this._state = "idle";
        try { this._keepAlive?.source.stop(); } catch (_e) { /* ignore */ }
        try { this._keepAlive?.source.disconnect(); this._keepAlive?.sink.disconnect(); } catch (_e) { /* ignore */ }
        this._keepAlive = null;
        try { void vad?.destroy(); } catch (_e) { /* ignore */ }
        try { void this._ctx?.close(); } catch (_e) { /* ignore */ }
        this._ctx = null;
    }

    private _emit(prob: number, frame: Float32Array): void {
        const cb = this._onFrame;
        if (!cb) return;
        // The first frame is the moment the engine demonstrably works: the model is
        // loaded, the worklet is installed AND the renderer is pulling the graph. A
        // session that never reaches this line and one that stops after it look
        // identical from the health poll, so say when it happened.
        if (this._frames++ === 0) {
            log().debug({
                contextState: this._ctx?.state ?? "none",
                contextTime: this._ctx?.currentTime ?? -1,
            }, "silero first frame");
        }
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
