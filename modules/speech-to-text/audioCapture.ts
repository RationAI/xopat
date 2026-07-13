/**
 * Microphone capture wrapper around getUserMedia + MediaRecorder.
 *
 * Two capture modes:
 *  - `record()` — emits a single audio `Blob` per utterance (one-shot).
 *  - `startSegmented()` — keeps the mic (getUserMedia + AudioContext + analyser)
 *    open continuously and emits one self-contained `Blob` per detected silence
 *    boundary via `onSegment`, restarting the recorder between segments *without*
 *    tearing down the stream. This is what lets a consumer keep listening while a
 *    previous segment is still being transcribed, so no speech is lost in the gap.
 *
 * Both optionally auto-stop/cut after a period of silence using a Web Audio
 * `AnalyserNode`. Errors are normalized to a small, translatable `code` so the
 * module can show the right localized message instead of leaking a raw browser
 * exception.
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
     * adaptive noise floor (speech must exceed ~2.5× the measured ambient peak).
     * Default 0.04.
     */
    silenceThreshold?: number;
    /**
     * Live input level callback (0..1), invoked each animation frame while
     * capturing. Drives the UI recording meter. Best-effort; only fires when
     * silence detection is active.
     */
    onLevel?: (level: number) => void;
    /**
     * If no speech onset is detected within this many ms, end the capture (empty).
     * Prevents a round from hanging on a silent user. Default 15000. Only applies
     * when silence auto-stop is enabled. Once speech starts it no longer applies.
     */
    speechOnsetTimeoutMs?: number;
    /** Hard cap on utterance length in ms (safety). Default 60000. */
    maxDurationMs?: number;
}

export interface SegmentedOptions extends CaptureOptions {
    /**
     * Called with each finalized segment blob, in capture order. A segment is cut
     * on a trailing-silence boundary (so the blob ends on silence, never mid-word)
     * or, rarely, on the per-segment max-duration safety cap. `index` is a
     * monotonic 0-based sequence number the consumer can use to keep results in
     * order even if transcriptions finish out of order.
     */
    onSegment: (blob: Blob, index: number) => void;
    /** Called if capture fails fatally (permission denied/lost, recorder error). */
    onError?: (error: CaptureError) => void;
    /**
     * Called once the session has fully ended and the last segment (if any) has
     * already been delivered via `onSegment`. Lets a consumer know no more
     * segments are coming so it can finalize a concatenated transcript.
     */
    onStopped?: () => void;
    /**
     * Longer, session-level silence (ms) that marks the end of a speaking "turn"
     * (measured across segment boundaries, so it does not misfire mid-monologue).
     * When set and the speaker has gone quiet for this long *after* having spoken,
     * `onTurnIdle` fires once. Capture keeps running — it's the consumer's choice to
     * `stop()`. 0/undefined disables it.
     */
    turnSilenceMs?: number;
    /** Fired once when `turnSilenceMs` of silence follows speech; re-arms on new speech. */
    onTurnIdle?: () => void;
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

    // ---- continuous (segmented) capture state ----
    private _segmented = false;
    private _segOpts: SegmentedOptions | null = null;
    private _segIndex = 0;
    private _segMime: string | undefined = undefined;
    /** What onstop does when the current recorder stops: keep going, drop a silent
     *  segment, or end the whole session. */
    private _afterStop: "restart" | "restart-discard" | "end" = "restart";
    /** True between a cut request and the next recorder starting — suppresses the
     *  VAD from cutting again during the stop→onstop→restart gap. */
    private _cutting = false;
    private _segStartAt = 0;
    private _segHeardSpeech = false;
    private _segSilentSince = 0;

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
                opts.silenceThreshold ?? 0.04,
                opts.speechOnsetTimeoutMs ?? 15000,
                opts.onLevel,
            );
        }
        return done;
    }

    /**
     * Stop the current capture. For `record()` this resolves its promise; for a
     * continuous {@link startSegmented} session this flushes the final segment and
     * ends it.
     */
    stop(): void {
        if (this._segmented) { this._endSegmented(); return; }
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

    /**
     * Open an `AudioContext` + `AnalyserNode` on the live `_stream` for VAD/level
     * metering. Returns null if Web Audio is unavailable (silence detection is
     * best-effort; recording via MediaRecorder still works without it).
     */
    private _createAnalyser(): { analyser: AnalyserNode; buf: Float32Array } | null {
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
            return {analyser, buf: new Float32Array(analyser.fftSize)};
        } catch (_e) {
            return null;
        }
    }

    private _armSilenceDetection(silenceMs: number, threshold: number, onsetTimeoutMs: number, onLevel?: (level: number) => void): void {
        try {
            const setup = this._createAnalyser();
            if (!setup) return;
            const {analyser, buf} = setup;

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

                // Emit a normalized level for the UI meter (0.25 peak ≈ full scale).
                if (onLevel) onLevel(Math.max(0, Math.min(1, peak / 0.25)));

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
                const speechPeak = Math.max(threshold, nf * 2.5);

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

    // ---- continuous (segmented) capture ----

    /**
     * Start continuous capture. Opens the microphone once and keeps it (and the
     * analyser) alive across many segments, emitting one self-contained `Blob` per
     * silence boundary via `opts.onSegment`. The stream is *not* torn down between
     * segments, so a consumer can transcribe segment N while segment N+1 is already
     * being recorded — nothing the user says during transcription is lost.
     *
     * Returns immediately after arming (getUserMedia resolves asynchronously). Call
     * {@link stop} to end the session; the final in-flight segment is flushed first.
     */
    startSegmented(opts: SegmentedOptions): void {
        if (!AudioCapture.isSupported()) throw new CaptureError("unsupported");
        if (this._recording || this._segmented) throw new CaptureError("capture-failed", "already recording");
        if (typeof opts.onSegment !== "function") throw new CaptureError("capture-failed", "onSegment required");

        this._segmented = true;
        this._segOpts = opts;
        this._segIndex = 0;
        this._segMime = this._pickMimeType(opts.mimeType);

        navigator.mediaDevices.getUserMedia({audio: true}).then((stream) => {
            // The session may have been stopped before permission resolved.
            if (!this._segmented) {
                try { stream.getTracks().forEach(t => t.stop()); } catch (_e) { /* ignore */ }
                return;
            }
            this._stream = stream;
            this._recording = true;
            // Segments need a silence boundary to be cut; fall back to a sensible
            // window if the caller left it unset (0 = "manual only" makes no sense
            // for continuous mode).
            const segSilence = opts.silenceMs && opts.silenceMs > 0 ? opts.silenceMs : 1500;
            this._armSegmentedVad(
                segSilence,
                opts.silenceThreshold ?? 0.04,
                opts.speechOnsetTimeoutMs ?? 15000,
                opts.maxDurationMs ?? 60000,
                opts.onLevel,
                opts.turnSilenceMs ?? 0,
                opts.onTurnIdle,
            );
            this._startSegmentRecorder();
        }).catch((e) => {
            const err = mapGumError(e);
            this._segmented = false;
            this._teardown();
            try { opts.onError?.(err); } catch (_e) { /* ignore */ }
        });
    }

    /** True while a continuous (segmented) session is active. */
    get isSegmenting(): boolean {
        return this._segmented;
    }

    /** Spin up a fresh recorder on the persistent stream for the next segment. */
    private _startSegmentRecorder(): void {
        if (!this._segmented || !this._stream) return;
        let rec: MediaRecorder;
        try {
            rec = new (window as any).MediaRecorder(this._stream, this._segMime ? {mimeType: this._segMime} : undefined);
        } catch (e) {
            const err = new CaptureError("capture-failed", (e as any)?.message);
            const cb = this._segOpts?.onError;
            this._segmented = false;
            this._teardown();
            try { cb?.(err); } catch (_e) { /* ignore */ }
            return;
        }
        this._recorder = rec;
        this._chunks = [];
        this._segStartAt = performance.now();
        this._segHeardSpeech = false;
        this._segSilentSince = 0;
        this._afterStop = "restart";
        this._cutting = false;

        rec.ondataavailable = (ev: BlobEvent) => {
            if (ev.data && ev.data.size > 0) this._chunks.push(ev.data);
        };
        rec.onerror = (ev: any) => {
            const err = new CaptureError("capture-failed", ev?.error?.message);
            const cb = this._segOpts?.onError;
            this._segmented = false;
            this._teardown();
            try { cb?.(err); } catch (_e) { /* ignore */ }
        };
        rec.onstop = () => {
            const type = this._segMime || (this._chunks[0]?.type) || "audio/webm";
            const blob = new Blob(this._chunks, {type});
            const action = this._afterStop;
            // Emit unless this segment was a discarded leading-silence stretch.
            if (action !== "restart-discard" && blob.size > 0 && this._segOpts) {
                try { this._segOpts.onSegment(blob, this._segIndex++); } catch (_e) { /* consumer error is theirs */ }
            }
            if (action === "end") { this._finishSegmented(); return; }
            this._startSegmentRecorder();
        };
        rec.start();
    }

    /**
     * Close the current segment. `discard` drops it (a leading-silence stretch with
     * no speech) instead of emitting it. The recorder restarts in `onstop`.
     */
    private _cutSegment(discard: boolean): void {
        if (this._cutting) return;
        this._cutting = true;
        this._afterStop = discard ? "restart-discard" : "restart";
        try {
            if (this._recorder && this._recorder.state !== "inactive") this._recorder.stop();
            else this._startSegmentRecorder();
        } catch (_e) {
            this._startSegmentRecorder();
        }
    }

    /** Persistent VAD/level loop for a continuous session (survives segment cuts). */
    private _armSegmentedVad(silenceMs: number, threshold: number, onsetTimeoutMs: number, maxDurationMs: number, onLevel?: (level: number) => void, turnSilenceMs = 0, onTurnIdle?: () => void): void {
        const setup = this._createAnalyser();
        if (!setup) return;
        const {analyser, buf} = setup;

        // Noise floor persists across segments so the room-relative speech
        // threshold keeps stabilizing instead of resetting each segment.
        let noiseFloor = Infinity;
        let maxPeak = 0;
        // Session-level (cross-segment) speech tracking for the turn-idle signal.
        let heardAnySpeech = false;
        let lastSpeechAt = 0;
        let turnIdleFired = false;
        let debug = false;
        try { debug = !!window.localStorage?.getItem("xopat-stt-debug"); } catch (_e) { /* ignore */ }

        const tick = () => {
            if (!this._recording) return;
            analyser.getFloatTimeDomainData(buf);
            let peak = 0;
            for (let i = 0; i < buf.length; i++) {
                const v = buf[i] < 0 ? -buf[i] : buf[i];
                if (v > peak) peak = v;
            }
            if (peak > maxPeak) maxPeak = peak;
            if (onLevel) onLevel(Math.max(0, Math.min(1, peak / 0.25)));

            if (peak < noiseFloor) noiseFloor = peak;
            else if (isFinite(noiseFloor)) noiseFloor += (peak - noiseFloor) * 0.0005;
            const nf = isFinite(noiseFloor) ? noiseFloor : 0;
            const speechPeak = Math.max(threshold, nf * 2.5);

            const now = performance.now();
            const isSpeech = peak >= speechPeak;

            // Session-level turn tracking (independent of segment cuts, so a long
            // continuous monologue never trips the turn-idle timer between words).
            if (isSpeech) { heardAnySpeech = true; lastSpeechAt = now; turnIdleFired = false; }
            if (onTurnIdle && turnSilenceMs > 0 && heardAnySpeech && !turnIdleFired
                && (now - lastSpeechAt) >= turnSilenceMs) {
                turnIdleFired = true;
                if (debug) console.log("[speech-to-text] turn idle");
                try { onTurnIdle(); } catch (_e) { /* consumer error is theirs */ }
            }

            // Don't evaluate cut conditions while a cut/restart is mid-flight.
            if (!this._cutting) {
                const segElapsed = now - this._segStartAt;
                if (isSpeech) {
                    this._segHeardSpeech = true;
                    this._segSilentSince = 0;
                } else if (this._segHeardSpeech) {
                    if (!this._segSilentSince) this._segSilentSince = now;
                    else if (now - this._segSilentSince >= silenceMs) {
                        if (debug) console.log("[speech-to-text] segment cut: trailing-silence");
                        this._cutSegment(false);
                    }
                } else if (segElapsed >= onsetTimeoutMs) {
                    // Prolonged leading silence: drop the empty segment and re-arm so
                    // the session can keep waiting without an unbounded silent blob.
                    this._cutSegment(true);
                }
                // Safety cap: cut even mid-speech (the one case a word may split).
                if (!this._cutting && segElapsed >= maxDurationMs) {
                    if (debug) console.log("[speech-to-text] segment cut: max-duration");
                    this._cutSegment(!this._segHeardSpeech);
                }
            }
            this._rafId = requestAnimationFrame(tick);
        };
        this._rafId = requestAnimationFrame(tick);
    }

    /** End a continuous session: flush the final segment, then tear down. */
    private _endSegmented(): void {
        if (!this._segmented) return;
        this._recording = false; // stops the VAD loop from cutting further
        this._afterStop = "end";
        this._cutting = true;
        try {
            if (this._recorder && this._recorder.state !== "inactive") this._recorder.stop();
            else this._finishSegmented(); // never started (or already inactive): finish now
        } catch (_e) {
            this._finishSegmented();
        }
    }

    /** Tear down a continuous session and notify the consumer it has ended. */
    private _finishSegmented(): void {
        const cb = this._segOpts?.onStopped;
        this._teardown(); // clears _segOpts
        try { cb?.(); } catch (_e) { /* ignore */ }
    }

    private _teardown(): void {
        this._recording = false;
        this._segmented = false;
        this._segOpts = null;
        this._cutting = false;
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
