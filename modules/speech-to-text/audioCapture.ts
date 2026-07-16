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

/**
 * Result of a one-shot {@link AudioCapture.record} capture. Besides the audio
 * itself it carries the VAD's *speech evidence*, so consumers can refuse to hand
 * speech-less audio to a transcription model — silence/room tone is precisely
 * what Whisper-style models hallucinate plausible phrases from ("Thank you.",
 * "Okay.", …), and those hallucinations are model-dependent, so no text-side
 * filter can catch them reliably. Not sending the audio is the only robust fix.
 */
export interface CaptureResult {
    /** The recorded audio. */
    blob: Blob;
    /**
     * True when sustained speech was detected during the capture. Degrades open:
     * when speech evidence could not be tracked (`tracked` false) this is `true`
     * so transcription still works without Web Audio.
     */
    heardSpeech: boolean;
    /** Total detected voiced duration (ms). Only meaningful when `tracked`. */
    voicedMs: number;
    /** False when Web Audio was unavailable and no VAD evidence exists. */
    tracked: boolean;
}

/** Per-segment speech evidence delivered alongside each segmented-capture blob. */
export interface SegmentMeta {
    /** Total detected voiced duration (ms) within the segment. */
    voicedMs: number;
    /** Wall-clock length of the segment (ms), including leading/trailing silence. */
    durationMs: number;
    /** False when Web Audio was unavailable and no VAD evidence exists. */
    tracked: boolean;
}

export interface CaptureOptions {
    /** Preferred MIME type for the recorder; falls back to browser default. */
    mimeType?: string;
    /** Auto-stop after this many ms of detected silence. 0/undefined disables it. */
    silenceMs?: number;
    /**
     * Minimum peak amplitude (0..1) that counts as speech. Combined with an
     * adaptive noise floor (speech must exceed `speechFloorMult`× the measured
     * ambient peak). Default 0.04.
     */
    silenceThreshold?: number;
    /**
     * How far above the adaptive noise floor a peak must sit to count as speech:
     * `speechPeak = max(silenceThreshold, noiseFloor * speechFloorMult)`. Higher =
     * more robust to background noise (fewer false speech triggers) but risks
     * dropping a very quiet speaker. Default 3.0.
     */
    speechFloorMult?: number;
    /**
     * Minimum sustained duration (ms) a peak must stay above the speech gate before
     * it's treated as real speech onset. Rejects brief transient blips (a click, a
     * door, a keyboard tap) and short noise bursts. Default 200. 0 disables.
     */
    minSpeechMs?: number;
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
     * order even if transcriptions finish out of order. Only segments in which
     * the VAD heard sustained speech are ever emitted — speech-less audio (the
     * turn-end silence tail, leading-silence stretches) is discarded so it can
     * never reach a transcription model. `meta` carries the segment's speech
     * evidence for finer consumer-side gating.
     */
    onSegment: (blob: Blob, index: number, meta: SegmentMeta) => void;
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

    // ---- one-shot speech evidence (mirrors of the VAD tick's findings) ----
    /** True once sustained speech was heard during the current one-shot capture. */
    private _heardSpeech = false;
    /** Accumulated voiced ms during the current one-shot capture. */
    private _voicedMs = 0;
    /** True while an analyser is actually feeding the evidence above. */
    private _evidenceTracked = false;

    // ---- continuous (segmented) capture state ----
    private _segmented = false;
    private _segSessionToken = 0;
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
    private _segMaxDurationMs = 0;
    /** Accumulated voiced ms within the current segment. */
    private _segVoicedMs = 0;
    /** True while the segmented analyser is feeding speech evidence. */
    private _segEvidenceTracked = false;

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
     * Record one utterance and resolve to a single audio blob plus its speech
     * evidence (see {@link CaptureResult}). Resolves when the recorder stops
     * (silence auto-stop, max duration, or an explicit `stop()`). The VAD/level
     * analyser is armed even when silence auto-stop is disabled (`silenceMs` 0),
     * so push-to-talk captures still get metering and speech evidence.
     */
    async record(opts: CaptureOptions = {}): Promise<CaptureResult> {
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
        this._heardSpeech = false;
        this._voicedMs = 0;
        this._evidenceTracked = false;

        const done = new Promise<CaptureResult>((resolve, reject) => {
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
                const tracked = this._evidenceTracked;
                // Degrade open: without an analyser we have no evidence either
                // way, so report speech to keep transcription functional.
                const result: CaptureResult = {
                    blob,
                    heardSpeech: tracked ? this._heardSpeech : true,
                    voicedMs: this._voicedMs,
                    tracked,
                };
                this._teardown();
                resolve(result);
            };
        });

        this._recorder.start();
        this._armMaxDuration(opts.maxDurationMs ?? 60000);
        this._armSilenceDetection(
            opts.silenceMs ?? 0,
            opts.silenceThreshold ?? 0.04,
            opts.speechOnsetTimeoutMs ?? 15000,
            opts.onLevel,
            opts.speechFloorMult ?? 3.0,
            opts.minSpeechMs ?? 200,
        );
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
        if (this._maxTimer) clearTimeout(this._maxTimer);
        this._maxTimer = window.setTimeout(() => this.stop(), ms);
    }

    /** Arm the hard per-segment safety cap independently of analyser-backed VAD. */
    private _armSegmentMaxDuration(): void {
        if (this._maxTimer) { clearTimeout(this._maxTimer); this._maxTimer = null; }
        if (!(this._segMaxDurationMs > 0)) return;
        this._maxTimer = window.setTimeout(() => {
            this._maxTimer = null;
            if (!this._segmented || !this._recording || this._cutting) return;
            this._cutSegment(!this._segHeardSpeech);
        }, this._segMaxDurationMs);
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

    /**
     * Arm the VAD/level loop for a one-shot capture. Always tracks speech
     * evidence (heardSpeech/voicedMs) and emits `onLevel`; the auto-stop cut
     * conditions (trailing silence, onset timeout) only apply when `silenceMs`
     * is positive — `silenceMs` 0 means "record until an explicit stop".
     */
    private _armSilenceDetection(silenceMs: number, threshold: number, onsetTimeoutMs: number, onLevel?: (level: number) => void, speechFloorMult = 3.0, minSpeechMs = 200): void {
        try {
            const setup = this._createAnalyser();
            if (!setup) return;
            const {analyser, buf} = setup;
            this._evidenceTracked = true;
            const autoStop = silenceMs > 0;

            const startedAt = performance.now();
            let lastTickAt = 0;
            let silentSince = 0;
            // Only arm the trailing-silence timer AFTER speech is first heard, so the
            // leading pause before the user starts talking doesn't instantly end the
            // round (the multi-round hands-free bug).
            let heardSpeech = false;
            // Start of the current above-gate run; speech must be sustained for
            // minSpeechMs before it counts, so brief noise blips don't register.
            let speechRunStart = 0;
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
                if (onLevel) {
                    try { onLevel(Math.max(0, Math.min(1, peak / 0.25))); }
                    catch (_e) { /* consumer callback error is theirs */ }
                }

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
                const speechPeak = Math.max(threshold, nf * speechFloorMult);
                if (peak >= speechPeak) {
                    if (!speechRunStart) speechRunStart = now;
                } else {
                    speechRunStart = 0;
                }
                // A blip only becomes speech ONSET after staying above the gate for
                // minSpeechMs continuously (rejects transient noise). Once speech is
                // established, any above-gate peak keeps it alive so rapid short words
                // aren't clipped.
                const sustainedOnset = speechRunStart > 0 && (now - speechRunStart) >= minSpeechMs;
                const isSpeech = heardSpeech ? (peak >= speechPeak) : sustainedOnset;

                // Accumulate speech evidence for the capture result; the consumer
                // uses it to refuse transcribing speech-less audio. The onset
                // run-up (the minSpeechMs the gate withheld) is credited on the
                // transition frame so short words aren't undercounted.
                const dt = lastTickAt ? now - lastTickAt : 0;
                lastTickAt = now;
                if (isSpeech) this._voicedMs += (!heardSpeech && speechRunStart) ? (now - speechRunStart) : dt;

                if (isSpeech) {
                    heardSpeech = true;
                    this._heardSpeech = true;
                    silentSince = 0;
                } else if (!autoStop) {
                    // Push-to-talk: evidence + metering only, no auto-stop cuts.
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

        const sessionToken = ++this._segSessionToken;
        this._segmented = true;
        this._segOpts = opts;
        this._segIndex = 0;
        this._segMaxDurationMs = opts.maxDurationMs ?? 60000;
        this._segMime = this._pickMimeType(opts.mimeType);

        navigator.mediaDevices.getUserMedia({audio: true}).then((stream) => {
            // The session may have been stopped/replaced before permission resolved.
            if (sessionToken !== this._segSessionToken || !this._segmented) {
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
                opts.onLevel,
                opts.turnSilenceMs ?? 0,
                opts.onTurnIdle,
                opts.speechFloorMult ?? 3.0,
                opts.minSpeechMs ?? 200,
            );
            this._startSegmentRecorder();
        }).catch((e) => {
            if (sessionToken !== this._segSessionToken || !this._segmented) return;
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
        this._segVoicedMs = 0;
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
            // Emit only segments in which the VAD actually heard sustained speech
            // (`_segHeardSpeech` still describes the just-ended segment — it is
            // reset in `_startSegmentRecorder`). This crucially covers the final
            // flush on session end: after the last spoken segment was cut, the
            // recorder holds only the end-of-turn silence tail, and shipping that
            // to Whisper is what used to hallucinate "Thank you." / "Okay." /
            // "Silence." turns out of thin air. Without an analyser there is no
            // evidence either way — degrade open and emit.
            const heard = this._segEvidenceTracked ? this._segHeardSpeech : true;
            if (action !== "restart-discard" && blob.size > 0 && heard && this._segOpts) {
                const meta: SegmentMeta = {
                    voicedMs: this._segVoicedMs,
                    durationMs: performance.now() - this._segStartAt,
                    tracked: this._segEvidenceTracked,
                };
                try { this._segOpts.onSegment(blob, this._segIndex++, meta); } catch (_e) { /* consumer error is theirs */ }
            }
            if (action === "end") { this._finishSegmented(); return; }
            this._startSegmentRecorder();
        };
        rec.start();
        this._armSegmentMaxDuration();
    }

    /**
     * Close the current segment. `discard` drops it (a leading-silence stretch with
     * no speech) instead of emitting it. The recorder restarts in `onstop`.
     */
    private _cutSegment(discard: boolean): void {
        if (this._cutting) return;
        if (this._maxTimer) { clearTimeout(this._maxTimer); this._maxTimer = null; }
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
    private _armSegmentedVad(silenceMs: number, threshold: number, onsetTimeoutMs: number, onLevel?: (level: number) => void, turnSilenceMs = 0, onTurnIdle?: () => void, speechFloorMult = 3.0, minSpeechMs = 200): void {
        this._segEvidenceTracked = false;
        const setup = this._createAnalyser();
        if (!setup) return;
        const {analyser, buf} = setup;
        this._segEvidenceTracked = true;
        let lastTickAt = 0;

        // Noise floor persists across segments so the room-relative speech
        // threshold keeps stabilizing instead of resetting each segment.
        let noiseFloor = Infinity;
        let maxPeak = 0;
        // Start of the current above-gate run (acoustic, persists across cuts) for
        // sustained-onset gating; rejects brief blips that aren't real speech.
        let speechRunStart = 0;
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
            const speechPeak = Math.max(threshold, nf * speechFloorMult);

            const now = performance.now();
            if (peak >= speechPeak) {
                if (!speechRunStart) speechRunStart = now;
            } else {
                speechRunStart = 0;
            }
            // Sustained-onset gate: a peak only starts a new speech run after staying
            // above the gate for minSpeechMs (blip rejection). Once the current
            // segment has speech, any above-gate peak keeps it alive (no clipping of
            // rapid short words).
            const sustainedOnset = speechRunStart > 0 && (now - speechRunStart) >= minSpeechMs;
            const isSpeech = this._segHeardSpeech ? (peak >= speechPeak) : sustainedOnset;

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
            const dt = lastTickAt ? now - lastTickAt : 0;
            lastTickAt = now;
            if (!this._cutting) {
                const segElapsed = now - this._segStartAt;
                if (isSpeech) {
                    // Credit the withheld onset run-up on the transition frame so
                    // a short word ("okay") isn't undercounted below minVoicedMs.
                    this._segVoicedMs += (!this._segHeardSpeech && speechRunStart) ? (now - speechRunStart) : dt;
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
        this._segSessionToken++;
        this._recording = false;
        this._segmented = false;
        this._segOpts = null;
        this._cutting = false;
        this._segMaxDurationMs = 0;
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
