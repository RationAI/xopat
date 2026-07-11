/**
 * Microphone capture wrapper around getUserMedia + MediaRecorder.
 *
 * Emits a single audio `Blob` per utterance (`record()`), or a live chunk stream
 * (`startStreaming`) for future streaming drivers. Optionally auto-stops after a
 * period of silence using a Web Audio `AnalyserNode`. Errors are normalized to a
 * small, translatable `code` so the module can show the right localized message
 * instead of leaking a raw browser exception.
 */

export type CaptureErrorCode =
    | "permission-denied"
    | "no-microphone"
    | "unsupported"
    | "capture-failed";

export class CaptureError extends Error {
    code: CaptureErrorCode;
    constructor(code: CaptureErrorCode, message?: string) {
        super(message || code);
        this.name = "CaptureError";
        this.code = code;
    }
}

export interface CaptureOptions {
    /** Preferred MIME type for the recorder; falls back to browser default. */
    mimeType?: string;
    /** Auto-stop after this many ms of detected silence. 0/undefined disables it. */
    silenceMs?: number;
    /**
     * Minimum peak amplitude (0..1) that counts as speech. Combined with an
     * adaptive noise floor (speech must exceed 2× the measured ambient peak).
     * Default 0.05.
     */
    silenceThreshold?: number;
    /**
     * If no speech onset is detected within this many ms, end the capture (empty).
     * Prevents a round from hanging on a silent user. Default 8000. Only applies
     * when silence auto-stop is enabled.
     */
    speechOnsetTimeoutMs?: number;
    /** Hard cap on utterance length in ms (safety). Default 60000. */
    maxDurationMs?: number;
}

function mapGumError(e: any): CaptureError {
    const name = e?.name || "";
    if (name === "NotAllowedError" || name === "SecurityError") return new CaptureError("permission-denied");
    if (name === "NotFoundError" || name === "OverconstrainedError") return new CaptureError("no-microphone");
    return new CaptureError("capture-failed", e?.message);
}

export class AudioCapture {
    private _stream: MediaStream | null = null;
    private _recorder: MediaRecorder | null = null;
    private _chunks: Blob[] = [];
    private _audioCtx: AudioContext | null = null;
    private _silenceTimer: number | null = null;
    private _maxTimer: number | null = null;
    private _rafId: number | null = null;
    private _recording = false;

    get isRecording(): boolean {
        return this._recording;
    }

    static isSupported(): boolean {
        return !!(navigator.mediaDevices?.getUserMedia) && typeof (window as any).MediaRecorder === "function";
    }

    /** Best-effort permission check without leaving a stream open. */
    async canCapture(): Promise<boolean> {
        if (!AudioCapture.isSupported()) return false;
        try {
            const perms = (navigator as any).permissions;
            if (perms?.query) {
                const st = await perms.query({name: "microphone" as any});
                if (st?.state === "denied") return false;
            }
        } catch (_e) {
            // permissions API not available for microphone — fall through
        }
        return true;
    }

    private _pickMimeType(preferred?: string): string | undefined {
        const MR = (window as any).MediaRecorder;
        const candidates = [preferred, "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
            .filter(Boolean) as string[];
        for (const c of candidates) {
            try {
                if (MR.isTypeSupported?.(c)) return c;
            } catch (_e) { /* ignore */ }
        }
        return undefined;
    }

    /**
     * Record one utterance and resolve to a single audio Blob. Resolves when the
     * recorder stops (silence auto-stop, max duration, or an explicit `stop()`).
     */
    async record(opts: CaptureOptions = {}): Promise<Blob> {
        if (!AudioCapture.isSupported()) throw new CaptureError("unsupported");
        if (this._recording) throw new CaptureError("capture-failed", "already recording");

        try {
            this._stream = await navigator.mediaDevices.getUserMedia({audio: true});
        } catch (e) {
            throw mapGumError(e);
        }

        const mimeType = this._pickMimeType(opts.mimeType);
        try {
            this._recorder = new (window as any).MediaRecorder(this._stream, mimeType ? {mimeType} : undefined);
        } catch (e) {
            this._teardown();
            throw new CaptureError("capture-failed", (e as any)?.message);
        }

        this._chunks = [];
        this._recording = true;

        const done = new Promise<Blob>((resolve, reject) => {
            const rec = this._recorder!;
            rec.ondataavailable = (ev: BlobEvent) => {
                if (ev.data && ev.data.size > 0) this._chunks.push(ev.data);
            };
            rec.onerror = (ev: any) => {
                this._teardown();
                reject(new CaptureError("capture-failed", ev?.error?.message));
            };
            rec.onstop = () => {
                const type = mimeType || (this._chunks[0]?.type) || "audio/webm";
                const blob = new Blob(this._chunks, {type});
                this._teardown();
                resolve(blob);
            };
        });

        this._recorder.start();
        this._armMaxDuration(opts.maxDurationMs ?? 60000);
        if (opts.silenceMs && opts.silenceMs > 0) {
            this._armSilenceDetection(
                opts.silenceMs,
                opts.silenceThreshold ?? 0.05,
                opts.speechOnsetTimeoutMs ?? 8000,
            );
        }
        return done;
    }

    /** Stop the current recording; `record()`'s promise then resolves. */
    stop(): void {
        try {
            if (this._recorder && this._recorder.state !== "inactive") this._recorder.stop();
        } catch (_e) { /* ignore */ }
    }

    /** Abort without producing a usable blob (used on teardown/error paths). */
    cancel(): void {
        this._teardown();
    }

    private _armMaxDuration(ms: number): void {
        this._maxTimer = window.setTimeout(() => this.stop(), ms);
    }

    private _armSilenceDetection(silenceMs: number, threshold: number, onsetTimeoutMs: number): void {
        try {
            const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
            this._audioCtx = new AC();
            // The context can start "suspended" without a user gesture (autoplay
            // policy); resume it or the analyser reads all-zero and every round
            // looks silent. Best-effort — recording via MediaRecorder is unaffected.
            this._audioCtx.resume?.().catch(() => { /* ignore */ });
            const src = this._audioCtx.createMediaStreamSource(this._stream!);
            const analyser = this._audioCtx.createAnalyser();
            analyser.fftSize = 2048;
            src.connect(analyser);
            const buf = new Float32Array(analyser.fftSize);

            const startedAt = performance.now();
            let silentSince = 0;
            // Only arm the trailing-silence timer AFTER speech is first heard, so the
            // leading pause before the user starts talking doesn't instantly end the
            // round (the multi-round hands-free bug).
            let heardSpeech = false;
            // Running-minimum noise floor: the quietest recent frame ≈ true ambient
            // level, tracked continuously (with a very slow upward drift). This does
            // NOT get polluted by the user's voice the way a fixed calibration window
            // does, so the speech threshold stays tied to the room, not the speaker —
            // which is what prevents normal-volume words from being read as silence
            // and cutting a sentence mid-pause.
            let noiseFloor = Infinity;
            let maxPeak = 0;
            // Opt-in diagnostics: run `localStorage.setItem('xopat-stt-debug','1')`.
            let debug = false;
            try { debug = !!window.localStorage?.getItem("xopat-stt-debug"); } catch (_e) { /* ignore */ }
            const dbgStop = (reason: string) => {
                if (debug) console.log(`[speech-to-text] stop: ${reason} · noiseFloor=${(isFinite(noiseFloor) ? noiseFloor : 0).toFixed(4)} maxPeak=${maxPeak.toFixed(4)} heardSpeech=${heardSpeech}`);
            };

            const tick = () => {
                if (!this._recording) return;
                analyser.getFloatTimeDomainData(buf);
                // Peak amplitude tracks voice far more reliably than RMS — speech
                // has high transient peaks even when its RMS is low.
                let peak = 0;
                for (let i = 0; i < buf.length; i++) {
                    const v = buf[i] < 0 ? -buf[i] : buf[i];
                    if (v > peak) peak = v;
                }
                if (peak > maxPeak) maxPeak = peak;

                // Track ambient as the running minimum; let it drift up very slowly so
                // it can recover if the environment gets louder, but never chase a
                // loud voice down into a false-silence state.
                if (peak < noiseFloor) noiseFloor = peak;
                else if (isFinite(noiseFloor)) noiseFloor += (peak - noiseFloor) * 0.0005;
                const nf = isFinite(noiseFloor) ? noiseFloor : 0;

                const now = performance.now();
                const elapsed = now - startedAt;

                // Speech must clearly exceed ambient, but never fall below a small
                // absolute floor (so true silence never counts as speech).
                const speechPeak = Math.max(threshold, nf * 3);

                if (peak >= speechPeak) {
                    heardSpeech = true;
                    silentSince = 0;
                } else if (heardSpeech) {
                    if (!silentSince) silentSince = now;
                    else if (now - silentSince >= silenceMs) { dbgStop("trailing-silence"); this.stop(); return; }
                } else if (elapsed >= onsetTimeoutMs) {
                    dbgStop("no-speech-onset"); this.stop(); // user never started speaking
                    return;
                }
                this._rafId = requestAnimationFrame(tick);
            };
            this._rafId = requestAnimationFrame(tick);
        } catch (_e) {
            // Silence detection is best-effort; recording still works without it.
        }
    }

    private _teardown(): void {
        this._recording = false;
        if (this._silenceTimer) { clearTimeout(this._silenceTimer); this._silenceTimer = null; }
        if (this._maxTimer) { clearTimeout(this._maxTimer); this._maxTimer = null; }
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
        try { this._audioCtx?.close(); } catch (_e) { /* ignore */ }
        this._audioCtx = null;
        try { this._stream?.getTracks().forEach(t => t.stop()); } catch (_e) { /* ignore */ }
        this._stream = null;
        this._recorder = null;
    }
}
