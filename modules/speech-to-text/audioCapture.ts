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
    /** Page is not a secure context, so getUserMedia is unavailable (needs https or localhost). */
    | "insecure-context"
    /**
     * The Web Audio device/renderer failed — Chrome's "The AudioContext encountered an
     * error from the audio device or the WebAudio renderer." Causes: the input/output
     * device is busy, was unplugged, or a sample-rate mismatch. NOT a secure-context
     * problem. Non-fatal to MediaRecorder, so it is reported as a warning, not thrown.
     */
    | "audio-device"
    /**
     * The VAD gate repeatedly discarded segments that then transcribed to real
     * text — its speech threshold is misjudging this session (noise, AGC, quiet
     * speaker). The session switched to fail-open: everything is transcribed and
     * the VAD only labels. Reported as a warning, capture keeps running.
     */
    | "vad-degraded"
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
    /**
     * Emitted despite a discard verdict, to test whether the VAD gate is
     * misbehaving (after repeated consecutive discards). Consumers should
     * transcribe it and report real text back via `enterFailOpen`.
     */
    probe?: boolean;
    /** Session is in fail-open mode: VAD only labels, every segment is emitted. */
    failOpen?: boolean;
    /** Final flush on finish/end — always emitted regardless of speech evidence. */
    flush?: boolean;
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
     * Called when the Web Audio device/renderer fails (see {@link CaptureErrorCode}
     * `audio-device`). Non-fatal — MediaRecorder keeps recording, but VAD/metering
     * are dead — so the consumer should surface a warning rather than abort. Fires at
     * most once per capture.
     */
    onDeviceError?: (error: CaptureError) => void;
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
     * on a trailing-silence boundary (so the blob ends on silence, never mid-word);
     * the per-segment duration cap also cuts at the next word gap, and only forces a
     * mid-word cut once {@link HARD_CUT_GRACE_MS} of uninterrupted speech follows it.
     * Consecutive segments overlap slightly rather than leaving a gap, so no speech
     * is lost between them. `index` is a
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
    /**
     * Also record the whole session, continuously, into one self-contained blob
     * retrievable via {@link AudioCapture.getArchiveBlobs} after the session ends.
     *
     * Segments are transcribed independently and therefore carry none of the
     * surrounding context a Whisper-style model needs — short fragments are where
     * such models mis-hear domain vocabulary the most. A single pass over the whole
     * recording gives markedly better text, so consumers that can afford one extra
     * request at the end (a report submitted for review) can upgrade their
     * authoritative transcript from "concatenated fragments" to "whole audio".
     *
     * Independent of the segment recorder: enabling it never changes live behaviour,
     * and a failure to start it leaves dictation untouched.
     */
    archive?: boolean;
    /** Stop archiving past this many bytes (default 20 MB). See {@link archiveTruncated}. */
    archiveMaxBytes?: number;
    /** Stop archiving past this many ms (default 45 min). See {@link archiveTruncated}. */
    archiveMaxMs?: number;
    /**
     * Seal the archive into WINDOWS of roughly this length (ms) instead of one
     * recording per capture, handing each to {@link onWindow} as it closes.
     * Default {@link DEFAULT_WINDOW_MS}; `0` keeps the whole capture as one part.
     *
     * The point is *when* the work happens. A window carries a minute and a half of
     * surrounding speech — the context a transcription model needs to get domain
     * vocabulary right — but it closes while the pathologist is still talking, so it
     * can be transcribed in the background instead of leaving the entire recording to
     * be uploaded and decoded at review time.
     */
    windowMs?: number;
    /**
     * Called with each sealed window. When set, sealed parts are HANDED OVER rather
     * than retained (`getArchiveBlobs()` then returns only the still-open tail), so
     * the consumer owns the audio and can free it once transcribed.
     */
    onWindow?: (window: ArchiveWindow) => void;
}

/** One sealed slice of the archive — see {@link SegmentedOptions.windowMs}. */
export interface ArchiveWindow {
    blob: Blob;
    /** Monotonic within a dictation (survives pause/resume). */
    index: number;
    /**
     * Segment indices this window spans, inclusive-exclusive. Capture-relative:
     * `startSegmented` restarts segment numbering, so these order windows within one
     * capture rather than identifying segments globally.
     */
    fromSegment: number;
    toSegment: number;
    /** True for the window closed by the end of a capture (rather than by rotation). */
    final: boolean;
}

function mapGumError(e: any): CaptureError {
    const name = e?.name || "";
    // An insecure page hides getUserMedia entirely; but if it is present and still throws
    // SecurityError, that is the page being non-secure at call time — report it as such so
    // the user is told to use https/localhost rather than a generic "permission denied".
    if (name === "SecurityError" && (window as any).isSecureContext === false) {
        return new CaptureError("insecure-context");
    }
    if (name === "NotAllowedError" || name === "SecurityError") return new CaptureError("permission-denied");
    if (name === "NotFoundError" || name === "OverconstrainedError") return new CaptureError("no-microphone");
    return new CaptureError("capture-failed", e?.message);
}

/** A VAD-tick gap longer than this (ms) means the evidence loop stalled — the
 *  segment's "silence" verdict is a measurement hole, not real silence. */
const VAD_STALL_MS = 2000;

/** Silence long enough to be a word gap — where a duration-capped segment may cut. */
const SOFT_CUT_SILENCE_MS = 300;
/** How long past the duration cap we keep waiting for that word gap before forcing a cut. */
const HARD_CUT_GRACE_MS = 3000;

/** Archive recorder flush cadence — bounds how much tail is lost if teardown races. */
const ARCHIVE_TIMESLICE_MS = 2000;
/** ~20 MB of Opus is hours of speech, and stays under the 25 MB transcription RPC body cap. */
const DEFAULT_ARCHIVE_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_ARCHIVE_MAX_MS = 45 * 60 * 1000;

/**
 * Default archive window. Long enough that a transcription model sees whole
 * sentences of surrounding speech (which is where its accuracy on domain vocabulary
 * comes from), short enough that the upload stays small, memory stays bounded, and
 * the wait at review time is one window rather than the whole case.
 */
const DEFAULT_WINDOW_MS = 90_000;
/** Rotate regardless once the window has run this much over, if speech never pauses. */
const WINDOW_HARD_FACTOR = 1.5;

/**
 * One segment recorder and everything needed to finalize it *after* its successor
 * has already started. Speech evidence lives on the capture instance while a
 * segment is open, but is snapshotted here the moment the segment is closed —
 * otherwise a recorder still flushing would read its successor's counters.
 */
interface SegmentRecording {
    rec: MediaRecorder;
    chunks: Blob[];
    startedAt: number;
    /** What happens once this recorder's `onstop` has been handled. */
    action: "restart" | "restart-discard" | "end";
    /** Evidence as of the cut; null while the segment is still open. */
    evidence: { voicedMs: number; heardSpeech: boolean; tracked: boolean; maxPeak: number } | null;
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

    /** URL of the peak-meter AudioWorklet module (vad-worklet.js), if provided. */
    private readonly _workletUrl: string | undefined;
    /** Live worklet meter node, when the worklet drives the VAD instead of rAF. */
    private _workletNode: AudioWorkletNode | null = null;

    /**
     * @param opts.workletUrl URL of the AudioWorklet peak-meter module. When set
     *   and loadable, VAD ticks are driven from the audio render thread — which
     *   hidden tabs do NOT throttle — instead of requestAnimationFrame (which
     *   they pause, silently freezing all speech evidence). Optional: without it
     *   (or when addModule fails, e.g. CSP) the rAF loop remains the driver.
     */
    constructor(opts: { workletUrl?: string } = {}) {
        this._workletUrl = opts.workletUrl;
    }

    /** Consumer sink for a non-fatal Web Audio device failure (set per capture). */
    private _onDeviceError: ((err: CaptureError) => void) | undefined = undefined;
    /** One report per capture — the device error can surface from several places at once. */
    private _deviceErrorReported = false;

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
    /** The open segment recorder plus its private chunk buffer and evidence snapshot. */
    private _segRec: SegmentRecording | null = null;
    /** Re-entrancy guard for a cut in progress (the cut itself is synchronous). */
    private _cutting = false;
    /** The duration cap elapsed: cut at the next word gap, or when the hard cap fires. */
    private _segWantCut = false;
    /** Hard backstop timer armed alongside the soft duration cap. */
    private _hardTimer: number | null = null;
    private _segStartAt = 0;
    private _segHeardSpeech = false;
    private _segSilentSince = 0;
    private _segMaxDurationMs = 0;
    /** Accumulated voiced ms within the current segment. */
    private _segVoicedMs = 0;
    /** True while the segmented analyser is feeding speech evidence. */
    private _segEvidenceTracked = false;
    /** Fail-open mode: VAD misjudged real speech — emit everything, only label. */
    private _segFailOpen = false;
    /** Consecutive discarded segments; at the threshold the next one probes. */
    private _segConsecDiscards = 0;
    /** Diagnostic: highest peak observed within the current segment. */
    private _segMaxPeak = 0;
    /** Cached `xopat-stt-debug` flag for gated VAD diagnostics. */
    private _vadDebug = false;
    /** Timestamp of the last VAD tick (rAF or worklet). Stall watchdog input. */
    private _lastVadTickAt = 0;
    /** True when a >VAD_STALL_MS tick gap was seen within the current segment —
     *  its speech evidence has holes and must not be trusted to discard audio. */
    private _segVadStalled = false;

    // ---- whole-session archive (see SegmentedOptions.archive) ----
    private _archiveRec: MediaRecorder | null = null;
    /** Chunks of the capture session currently recording. */
    private _archiveChunks: Blob[] = [];
    /**
     * Completed capture sessions, oldest first. Dictation is routinely paused and
     * resumed (the consumer stops and restarts capture), and each capture produces
     * its own self-contained container that cannot be byte-concatenated with the
     * others — so the archive is a LIST of recordings covering one logical dictation,
     * not a single blob. Survives teardown; cleared only via {@link clearArchive}.
     */
    private _archiveParts: Blob[] = [];
    /** Total retained bytes across parts — the cap spans the whole dictation. */
    private _archiveBytes = 0;
    private _archiveMime: string | undefined = undefined;
    private _archiveTruncated = false;

    // ---- archive windows (see SegmentedOptions.windowMs) ----
    /** Mutable meta of the open window; the seal reads it, rotation/stop flag it. */
    private _archiveMeta: { index: number; fromSegment: number; toSegment: number; final: boolean } | null = null;
    /**
     * Held separately from `_segOpts` because the FINAL window is sealed during
     * teardown, which has already nulled `_segOpts` — and that window is the one
     * carrying the last thing the pathologist said.
     */
    private _onArchiveWindow: ((w: ArchiveWindow) => void) | null = null;
    private _windowMs = 0;
    /** Monotonic across pause/resume within a dictation; reset by clearArchive. */
    private _windowIndex = 0;
    /** The window's length elapsed: rotate at the next segment cut (a silence boundary). */
    private _windowWantRotate = false;
    private _windowTimer: number | null = null;
    private _windowHardTimer: number | null = null;

    get isRecording(): boolean {
        return this._recording;
    }

    static isSupported(): boolean {
        return AudioCapture.supportIssue() === null;
    }

    /**
     * Why capture cannot start here, or null when the environment supports it.
     *
     * Distinguishes the two very different failure modes an operator confuses:
     *  - **insecure-context** — the page is not a secure context, so the browser hides
     *    `navigator.mediaDevices` entirely. Fix: serve over https or use localhost. Note
     *    that localhost and https (incl. a self-signed cert, once trusted) ARE secure
     *    contexts; only plain http on a non-loopback host is not.
     *  - **unsupported** — a secure page on a browser that simply lacks getUserMedia or
     *    MediaRecorder.
     */
    static supportIssue(): CaptureErrorCode | null {
        const hasGum = !!(navigator.mediaDevices?.getUserMedia);
        if (!hasGum) {
            // getUserMedia is absent off a secure origin; `isSecureContext === false`
            // confirms that is the reason rather than an old browser.
            return (window as any).isSecureContext === false ? "insecure-context" : "unsupported";
        }
        if (typeof (window as any).MediaRecorder !== "function") return "unsupported";
        return null;
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
        const issue = AudioCapture.supportIssue();
        if (issue) throw new CaptureError(issue);
        if (this._recording) throw new CaptureError("capture-failed", "already recording");

        this._onDeviceError = opts.onDeviceError;
        this._deviceErrorReported = false;

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
        this._lastVadTickAt = 0;

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
                // A stalled VAD clock (e.g. rAF paused in a hidden tab before the
                // worklet upgrade landed) means the "no speech" verdict is a
                // measurement hole — degrade open rather than discard real speech.
                const stalledNow = this._evidenceTracked && this._lastVadTickAt > 0
                    && (performance.now() - this._lastVadTickAt) > VAD_STALL_MS;
                const tracked = this._evidenceTracked && !stalledNow;
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

    /**
     * Arm the per-segment duration cap independently of analyser-backed VAD, as a
     * SOFT cap plus a hard backstop.
     *
     * Cutting the instant the cap elapses splits whatever word is being spoken
     * across two independently-transcribed blobs, and a transcription model asked
     * to decode half a word invents a whole one — the dominant source of garbled
     * domain vocabulary in long dictation. So the soft expiry only *requests* a cut,
     * which the VAD then performs at the next {@link SOFT_CUT_SILENCE_MS} word gap;
     * the hard timer forces it {@link HARD_CUT_GRACE_MS} later if the speaker never
     * pauses. A segment with no speech at all is still cut immediately — there is no
     * word to protect and the blob must not grow unbounded.
     */
    private _armSegmentMaxDuration(): void {
        this._clearSegmentTimers();
        if (!(this._segMaxDurationMs > 0)) return;
        this._maxTimer = window.setTimeout(() => {
            this._maxTimer = null;
            if (!this._segmented || !this._recording || this._cutting) return;
            if (!this._segHeardSpeech) {
                this._cutSegment(!this._segFailOpen);
                return;
            }
            this._segWantCut = true;
        }, this._segMaxDurationMs);
        this._hardTimer = window.setTimeout(() => {
            this._hardTimer = null;
            if (!this._segmented || !this._recording || this._cutting) return;
            if (this._vadDebug) console.log("[speech-to-text] cut: hard duration cap");
            this._cutSegment(this._segFailOpen ? false : !this._segHeardSpeech);
        }, this._segMaxDurationMs + HARD_CUT_GRACE_MS);
    }

    /** Drop both duration timers (soft cap + hard backstop). */
    private _clearSegmentTimers(): void {
        if (this._maxTimer) { clearTimeout(this._maxTimer); this._maxTimer = null; }
        if (this._hardTimer) { clearTimeout(this._hardTimer); this._hardTimer = null; }
    }

    /**
     * Open an `AudioContext` + `AnalyserNode` on the live `_stream` for VAD/level
     * metering. Returns null if Web Audio is unavailable (silence detection is
     * best-effort; recording via MediaRecorder still works without it).
     */
    private _createAnalyser(): { analyser: AnalyserNode; buf: Float32Array } | null {
        try {
            const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
            if (!AC) return null; // no Web Audio: VAD/metering off, recording still works
            this._audioCtx = new AC();
            // Async device/renderer failures (device busy, unplugged, sample-rate
            // mismatch) surface here as an `error` event or a rejected resume() — this
            // is the "AudioContext encountered an error from the audio device or the
            // WebAudio renderer." message. Route it to the consumer as a warning.
            try { this._audioCtx.addEventListener?.("error", (ev: any) => this._reportDeviceError(ev?.error)); }
            catch (_e) { /* addEventListener unsupported — resume().catch still covers it */ }
            // The context can start "suspended" without a user gesture (autoplay
            // policy); resume it or the analyser reads all-zero and every round
            // looks silent. A rejection here is the device error, not autoplay.
            this._audioCtx.resume?.().catch((e: any) => this._reportDeviceError(e));
            const src = this._audioCtx.createMediaStreamSource(this._stream!);
            const analyser = this._audioCtx.createAnalyser();
            analyser.fftSize = 2048;
            src.connect(analyser);
            return {analyser, buf: new Float32Array(analyser.fftSize)};
        } catch (e) {
            // Synchronous construction/wiring failure — same device/renderer class.
            this._reportDeviceError(e);
            return null;
        }
    }

    /**
     * Report a non-fatal Web Audio device failure once per capture. Recording via
     * MediaRecorder is unaffected, so this never aborts — it only tells the consumer
     * why VAD and the level meter went dead.
     */
    private _reportDeviceError(e?: any): void {
        if (this._deviceErrorReported) return;
        this._deviceErrorReported = true;
        try { this._onDeviceError?.(new CaptureError("audio-device", e?.message)); }
        catch (_e) { /* consumer callback error is theirs */ }
    }

    /**
     * Upgrade the VAD clock from requestAnimationFrame to an AudioWorklet peak
     * meter. rAF is paused entirely for hidden tabs, which used to freeze all
     * speech evidence the moment the viewer lost visibility — the mic kept
     * recording but every segment was then judged speechless and discarded. The
     * worklet runs on the audio render thread (never throttled) and posts a
     * batched max-abs peak every ~50 ms; `onPeak` runs the exact same VAD logic
     * the rAF tick does.
     *
     * Best-effort: resolves true only when the node is live — the caller then
     * cancels its rAF loop. Any failure (no AudioWorklet, CSP blocking the
     * module, teardown racing addModule) resolves false and the rAF loop simply
     * stays the driver.
     */
    private async _attachWorkletMeter(onPeak: (peak: number) => void): Promise<boolean> {
        const ctx: any = this._audioCtx;
        if (!this._workletUrl || !ctx?.audioWorklet || !this._stream) return false;
        try {
            await ctx.audioWorklet.addModule(this._workletUrl);
            // The capture may have been torn down (or restarted on a fresh
            // context) while the module loaded — never attach to a stale graph.
            if (!this._recording || ctx !== this._audioCtx || !this._stream) return false;
            const node = new AudioWorkletNode(ctx, "xopat-vad-meter");
            const src = ctx.createMediaStreamSource(this._stream);
            src.connect(node);
            node.port.onmessage = (ev: MessageEvent) => {
                if (!this._recording) return;
                const peak = typeof ev.data === "number" ? ev.data : 0;
                onPeak(peak);
            };
            this._workletNode = node;
            return true;
        } catch (e) {
            if (this._vadDebug) console.log("[speech-to-text] VAD worklet unavailable, staying on rAF", e);
            return false;
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

            // The VAD logic, driven per peak sample by either the rAF tick below
            // or (preferred) the AudioWorklet meter — hidden tabs pause rAF, and
            // with it all speech evidence, while the worklet keeps ticking.
            // Returns false once the capture was auto-stopped.
            const processPeak = (peak: number): boolean => {
                if (peak > maxPeak) maxPeak = peak;

                // Emit a normalized level for the UI meter (0.25 peak ≈ full scale).
                if (onLevel) {
                    try { onLevel(Math.max(0, Math.min(1, peak / 0.25))); }
                    catch (_e) { /* consumer callback error is theirs */ }
                }

                // Track ambient as the running minimum; it drifts up very slowly on
                // NON-speech frames only (see below) so it can recover if the
                // environment gets louder — drifting during speech would drag the
                // floor toward the speaker's own level and push the gate above
                // their voice (false-silence runaway).
                if (peak < noiseFloor) noiseFloor = peak;
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
                if (!isSpeech && peak >= noiseFloor && isFinite(noiseFloor)) {
                    noiseFloor += (peak - noiseFloor) * 0.0005;
                }

                // Accumulate speech evidence for the capture result; the consumer
                // uses it to refuse transcribing speech-less audio. The onset
                // run-up (the minSpeechMs the gate withheld) is credited on the
                // transition frame so short words aren't undercounted.
                const dt = lastTickAt ? now - lastTickAt : 0;
                lastTickAt = now;
                this._lastVadTickAt = now;
                if (isSpeech) this._voicedMs += (!heardSpeech && speechRunStart) ? (now - speechRunStart) : dt;

                if (isSpeech) {
                    heardSpeech = true;
                    this._heardSpeech = true;
                    silentSince = 0;
                } else if (!autoStop) {
                    // Push-to-talk: evidence + metering only, no auto-stop cuts.
                } else if (heardSpeech) {
                    if (!silentSince) silentSince = now;
                    else if (now - silentSince >= silenceMs) { dbgStop("trailing-silence"); this.stop(); return false; }
                } else if (elapsed >= onsetTimeoutMs) {
                    dbgStop("no-speech-onset"); this.stop(); // user never started speaking
                    return false;
                }
                return true;
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
                if (!processPeak(peak)) return;
                this._rafId = requestAnimationFrame(tick);
            };
            this._rafId = requestAnimationFrame(tick);
            // Upgrade to the worklet clock; on success the rAF loop is redundant.
            void this._attachWorkletMeter(processPeak).then((ok) => {
                if (ok && this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
            });
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
        const issue = AudioCapture.supportIssue();
        if (issue) throw new CaptureError(issue);
        if (this._recording || this._segmented) throw new CaptureError("capture-failed", "already recording");
        if (typeof opts.onSegment !== "function") throw new CaptureError("capture-failed", "onSegment required");

        this._onDeviceError = opts.onDeviceError;
        this._deviceErrorReported = false;

        const sessionToken = ++this._segSessionToken;
        this._segmented = true;
        this._segOpts = opts;
        this._segIndex = 0;
        this._segMaxDurationMs = opts.maxDurationMs ?? 60000;
        this._segMime = this._pickMimeType(opts.mimeType);
        this._segFailOpen = false;
        this._segConsecDiscards = 0;
        // NOTE: the archive is deliberately NOT cleared here. Pausing and resuming
        // dictation is one logical session to the consumer, and wiping it on resume
        // would silently reduce the "whole recording" to its last stretch — a partial
        // transcript that still looks complete. The consumer clears it explicitly
        // (clearArchive) when a new dictation begins or the audio has been used.
        try { this._vadDebug = !!window.localStorage?.getItem("xopat-stt-debug"); } catch (_e) { this._vadDebug = false; }

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
            if (opts.archive) this._startArchiveRecorder(opts);
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

    /**
     * The retained recordings, in order, when {@link SegmentedOptions.archive} was set.
     * One entry per capture session (pause/resume produces several), each a complete,
     * independently decodable container. Meaningful once capture has ended — a live
     * read misses everything after the last {@link ARCHIVE_TIMESLICE_MS} flush.
     * Survives teardown; retained until {@link clearArchive}.
     */
    getArchiveBlobs(): Blob[] {
        const out = [...this._archiveParts];
        if (this._archiveChunks.length) {
            out.push(new Blob(this._archiveChunks, {type: this._archiveMime || this._archiveChunks[0]?.type || "audio/webm"}));
        }
        return out;
    }

    /** True when the archive hit its size/duration cap and stops short of the session end. */
    get archiveTruncated(): boolean {
        return this._archiveTruncated;
    }

    /** Drop every retained recording (audio is sensitive — free it once used). */
    clearArchive(): void {
        this._archiveChunks = [];
        this._archiveParts = [];
        this._archiveBytes = 0;
        this._archiveTruncated = false;
        this._windowIndex = 0;
    }

    /**
     * Seal one archive recorder's chunks. Called from its `onstop`, i.e. after the
     * final `dataavailable` — sealing at stop-request time would drop the tail. Takes
     * the recorder's own array so a part still flushing while its successor records
     * cannot mix the two.
     *
     * With an `onWindow` consumer the blob is HANDED OVER, not retained: it is about
     * to be transcribed and the text is what matters afterwards, so keeping a second
     * reference here would only double the memory a long dictation holds.
     * @private
     */
    private _sealArchivePart(chunks: Blob[], meta: { index: number; fromSegment: number; toSegment: number; final: boolean } | null): void {
        if (this._archiveChunks === chunks) this._archiveChunks = [];
        if (this._archiveMeta === meta) this._archiveMeta = null;
        if (!chunks.length) return;
        const type = this._archiveMime || chunks[0]?.type || "audio/webm";
        const blob = new Blob(chunks, {type});
        const onWindow = this._onArchiveWindow;
        if (!onWindow) { this._archiveParts.push(blob); return; }
        try {
            onWindow({
                blob,
                index: meta ? meta.index : this._windowIndex++,
                fromSegment: meta ? meta.fromSegment : 0,
                toSegment: meta ? meta.toSegment : this._segIndex,
                final: !!meta?.final,
            });
        } catch (_e) { /* consumer error is theirs */ }
    }

    /**
     * Close the open window and open the next one, mid-capture.
     *
     * Called at a segment cut, which is a trailing-silence boundary, so a window never
     * ends mid-word. The successor recorder starts BEFORE the current one stops (the
     * same ordering `_cutSegment` uses) — `MediaRecorder.stop()` only flushes what was
     * already captured, so building the replacement afterwards would leave the gap
     * between them unrecorded.
     * @private
     */
    private _rotateArchive(): void {
        const rec = this._archiveRec;
        if (!rec || !this._segmented || !this._stream) return;
        this._windowWantRotate = false;
        this._clearWindowTimers();
        if (this._archiveMeta) this._archiveMeta.toSegment = this._segIndex;
        this._archiveRec = null;
        // Starts the successor, re-points _archiveChunks/_archiveMeta at it and re-arms
        // the window timers. The outgoing recorder keeps its own closed-over chunks.
        this._startArchiveRecorder(this._segOpts || {} as SegmentedOptions);
        try {
            if (rec.state === "recording") rec.requestData();
            if (rec.state !== "inactive") rec.stop();
        } catch (_e) { /* best-effort */ }
    }

    /** @private arm the soft rotation request + the hard backstop for the open window. */
    private _armWindowTimers(): void {
        this._clearWindowTimers();
        if (!(this._windowMs > 0)) return;
        // Soft: ask for a rotation, taken at the next silence boundary (see _cutSegment).
        this._windowTimer = window.setTimeout(() => {
            this._windowTimer = null;
            this._windowWantRotate = true;
        }, this._windowMs);
        // Hard: an uninterrupted monologue offers no boundary — rotate anyway rather
        // than letting one window grow without bound.
        this._windowHardTimer = window.setTimeout(() => {
            this._windowHardTimer = null;
            this._rotateArchive();
        }, Math.round(this._windowMs * WINDOW_HARD_FACTOR));
    }

    /** @private */
    private _clearWindowTimers(): void {
        if (this._windowTimer) { clearTimeout(this._windowTimer); this._windowTimer = null; }
        if (this._windowHardTimer) { clearTimeout(this._windowHardTimer); this._windowHardTimer = null; }
    }

    /**
     * Start the whole-session recorder on the live stream. Entirely independent of
     * the segment recorder — a failure here (browser refusing a second recorder on
     * one stream, memory pressure) must never disturb dictation, so every path
     * degrades to "no archive".
     */
    private _startArchiveRecorder(opts: SegmentedOptions): void {
        if (!this._stream) return;
        const maxBytes = opts.archiveMaxBytes ?? DEFAULT_ARCHIVE_MAX_BYTES;
        const maxMs = opts.archiveMaxMs ?? DEFAULT_ARCHIVE_MAX_MS;
        let rec: MediaRecorder;
        try {
            rec = new (window as any).MediaRecorder(this._stream, this._segMime ? {mimeType: this._segMime} : undefined);
        } catch (_e) {
            return; // no archive this session; dictation is unaffected
        }
        this._archiveRec = rec;
        this._archiveMime = this._segMime;
        this._onArchiveWindow = opts.onWindow || null;
        this._windowMs = this._onArchiveWindow
            ? Math.max(0, opts.windowMs ?? DEFAULT_WINDOW_MS)
            : 0; // no consumer for windows ⇒ one part per capture, as before
        const chunks: Blob[] = [];
        this._archiveChunks = chunks;
        // Per-recorder meta, so a window still flushing while its successor records
        // reports its OWN range rather than the successor's.
        const meta = { index: this._windowIndex++, fromSegment: this._segIndex, toSegment: this._segIndex, final: false };
        this._archiveMeta = meta;
        const startedAt = performance.now();
        rec.ondataavailable = (ev: BlobEvent) => {
            if (!ev.data || ev.data.size <= 0) return;
            // Past a cap, keep what we have rather than growing without bound: the
            // recording is uploaded in one request and held wholly in memory on both
            // ends. The byte cap spans the whole dictation, the time cap one capture.
            if (this._archiveBytes + ev.data.size > maxBytes || (performance.now() - startedAt) > maxMs) {
                this._archiveTruncated = true;
                this._stopArchive();
                return;
            }
            chunks.push(ev.data);
            this._archiveBytes += ev.data.size;
        };
        rec.onstop = () => this._sealArchivePart(chunks, meta);
        rec.onerror = () => this._stopArchive();
        try {
            rec.start(ARCHIVE_TIMESLICE_MS);
            this._armWindowTimers();
        } catch (_e) {
            this._archiveRec = null;
        }
    }

    /** Flush and stop the archive recorder for good; its window is sealed as final. */
    private _stopArchive(): void {
        const rec = this._archiveRec;
        if (!rec) return;
        this._archiveRec = null;
        this._clearWindowTimers();
        this._windowWantRotate = false;
        if (this._archiveMeta) {
            this._archiveMeta.final = true;
            this._archiveMeta.toSegment = this._segIndex;
        }
        try {
            // requestData() first: teardown stops the tracks moments later, and the
            // final timeslice would otherwise be lost.
            if (rec.state === "recording") rec.requestData();
            if (rec.state !== "inactive") rec.stop();
        } catch (_e) { /* best-effort */ }
    }

    /**
     * A probe segment transcribed to real text — the VAD gate is misjudging
     * speech this session. From now on every segment is emitted (VAD evidence
     * only labels); the consumer's text filters remain the gate against
     * silence hallucinations.
     */
    enterFailOpen(): void {
        if (!this._segmented) return;
        this._segFailOpen = true;
        this._segConsecDiscards = 0;
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
        // Each recording owns its chunk buffer: with the successor started before
        // the predecessor has flushed, a shared buffer would interleave the two.
        const recording: SegmentRecording = {
            rec,
            chunks: [],
            startedAt: performance.now(),
            action: "restart",
            evidence: null,
        };
        this._segRec = recording;
        this._recorder = rec;
        this._segStartAt = recording.startedAt;
        this._segHeardSpeech = false;
        this._segSilentSince = 0;
        this._segVoicedMs = 0;
        this._segMaxPeak = 0;
        this._segVadStalled = false;
        this._segWantCut = false;
        this._cutting = false;

        rec.ondataavailable = (ev: BlobEvent) => {
            if (ev.data && ev.data.size > 0) recording.chunks.push(ev.data);
        };
        rec.onerror = (ev: any) => {
            const err = new CaptureError("capture-failed", ev?.error?.message);
            const cb = this._segOpts?.onError;
            this._segmented = false;
            this._teardown();
            try { cb?.(err); } catch (_e) { /* ignore */ }
        };
        rec.onstop = () => this._finishSegmentRecording(recording);
        rec.start();
        this._armSegmentMaxDuration();
    }

    /** Speech evidence for the segment that is being closed right now. */
    private _snapshotSegmentEvidence(): NonNullable<SegmentRecording["evidence"]> {
        // A stalled VAD clock (rAF paused in a hidden tab before the worklet
        // upgrade landed) means the "no speech" verdict is a measurement hole,
        // not real silence — report it untracked so the audio is transcribed.
        const stalled = this._segVadStalled || (this._segEvidenceTracked
            && this._lastVadTickAt > 0
            && (performance.now() - this._lastVadTickAt) > VAD_STALL_MS);
        const tracked = this._segEvidenceTracked && !stalled;
        return {
            voicedMs: this._segVoicedMs,
            // Degrade open: without an analyser there is no evidence either way.
            heardSpeech: tracked ? this._segHeardSpeech : true,
            tracked,
            maxPeak: this._segMaxPeak,
        };
    }

    /**
     * Apply the emit policy to a stopped recording and hand its blob to the consumer.
     *
     * The VAD's speech-evidence gate exists to keep silent room tone away from
     * Whisper-style models (which hallucinate "Thank you." / "Okay." turns out of
     * thin air). But the gate must never silently destroy real speech, so it fails
     * open on three paths:
     *  - the final flush on session end always emits (explicit user intent;
     *    text-side filters catch any hallucination),
     *  - fail-open mode emits everything (the gate proved itself broken),
     *  - after repeated consecutive discards the next one is emitted as a PROBE:
     *    if it transcribes to real text, `enterFailOpen()` flips the session
     *    (self-healing against gate misjudgment).
     */
    private _finishSegmentRecording(recording: SegmentRecording): void {
        if (this._segRec === recording) this._segRec = null;
        const type = this._segMime || (recording.chunks[0]?.type) || "audio/webm";
        const blob = new Blob(recording.chunks, {type});
        const action = recording.action;
        const {voicedMs, heardSpeech: heard, tracked, maxPeak} = recording.evidence ?? this._snapshotSegmentEvidence();
        const isFinal = action === "end";
        let emit = blob.size > 0 && !!this._segOpts;
        let probe = false;
        if (emit && !isFinal && !this._segFailOpen) {
            if (action === "restart-discard" || !heard) {
                if (this._segConsecDiscards >= 2) {
                    probe = true;
                    this._segConsecDiscards = 0;
                } else {
                    this._segConsecDiscards++;
                    emit = false;
                }
            } else {
                this._segConsecDiscards = 0;
            }
        }
        if (this._vadDebug) console.log("[speech-to-text] segment onstop", {action, blobSize: blob.size, heard, tracked, voicedMs, maxPeak, probe, failOpen: this._segFailOpen, emit});
        if (emit && this._segOpts) {
            const meta: SegmentMeta = {
                voicedMs,
                durationMs: performance.now() - recording.startedAt,
                tracked,
                ...(probe ? {probe: true} : {}),
                ...(this._segFailOpen ? {failOpen: true} : {}),
                ...(isFinal ? {flush: true} : {}),
            };
            // The index is consumed only by an EMITTED segment: the consumer's ordered
            // drain waits for every index in sequence, so a discarded segment must not
            // burn one or the drain would stall on a number that never arrives.
            // Recordings stop in creation order, so emit order stays capture order.
            try { this._segOpts.onSegment(blob, this._segIndex++, meta); } catch (_e) { /* consumer error is theirs */ }
        }
        if (isFinal) this._finishSegmented();
    }

    /**
     * Close the current segment. `discard` drops it (a leading-silence stretch with
     * no speech) instead of emitting it.
     *
     * The successor recorder is started BEFORE the current one is stopped.
     * `MediaRecorder.stop()` only flushes audio already captured, so constructing the
     * replacement inside `onstop` (as this used to) left the stop→flush→start window
     * unrecorded: every single cut silently dropped a sliver of speech, and at a
     * multi-second segment cadence that is a word lost every few sentences. Starting
     * first makes the two recordings overlap by the flush latency instead — no
     * deliberate pre-roll, since audio present in both blobs would be transcribed
     * twice and duplicate words in the concatenated transcript.
     */
    private _cutSegment(discard: boolean): void {
        if (this._cutting) return;
        const current = this._segRec;
        if (!current) return;
        this._clearSegmentTimers();
        this._cutting = true;
        current.action = discard ? "restart-discard" : "restart";
        current.evidence = this._snapshotSegmentEvidence();
        this._startSegmentRecorder();
        try {
            if (current.rec.state !== "inactive") current.rec.stop();
            else this._finishSegmentRecording(current);
        } catch (_e) {
            this._finishSegmentRecording(current);
        }
        // A cut is a trailing-silence boundary, which is exactly where an archive
        // window may close without splitting a word. The window length only REQUESTS
        // a rotation; it is taken here.
        if (this._windowWantRotate) this._rotateArchive();
    }

    /** Persistent VAD/level loop for a continuous session (survives segment cuts). */
    private _armSegmentedVad(silenceMs: number, threshold: number, onsetTimeoutMs: number, onLevel?: (level: number) => void, turnSilenceMs = 0, onTurnIdle?: () => void, speechFloorMult = 3.0, minSpeechMs = 200): void {
        this._segEvidenceTracked = false;
        const setup = this._createAnalyser();
        if (!setup) return;
        const {analyser, buf} = setup;
        this._segEvidenceTracked = true;
        this._lastVadTickAt = 0;
        let lastTickAt = 0;

        // Noise floor persists across segments so the room-relative speech
        // threshold keeps stabilizing instead of resetting each segment.
        let noiseFloor = Infinity;
        let maxPeak = 0;
        // Start of the current above-gate run (acoustic, persists across cuts) for
        // sustained-onset gating; rejects brief blips that aren't real speech.
        let speechRunStart = 0;
        // Decaying maximum of speech-frame peaks. Caps the gate so an adaptive
        // floor polluted by long speech (or AGC swings) can never climb above the
        // level the speaker is demonstrably talking at — the runaway that made
        // every post-first segment read as silence and get discarded.
        let recentSpeechPeak = 0;
        // Session-level (cross-segment) speech tracking for the turn-idle signal.
        let heardAnySpeech = false;
        let lastSpeechAt = 0;
        let turnIdleFired = false;

        // The VAD logic, driven per peak sample by either the rAF tick below or
        // (preferred) the AudioWorklet meter. Hidden tabs pause rAF entirely —
        // which used to freeze all evidence so every backgrounded segment was
        // judged speechless and discarded; the worklet clock keeps ticking.
        const processPeak = (peak: number): void => {
            if (peak > maxPeak) maxPeak = peak;
            if (peak > this._segMaxPeak) this._segMaxPeak = peak;
            if (onLevel) onLevel(Math.max(0, Math.min(1, peak / 0.25)));

            if (peak < noiseFloor) noiseFloor = peak;
            const nf = isFinite(noiseFloor) ? noiseFloor : 0;
            let speechPeak = Math.max(threshold, nf * speechFloorMult);
            // Gate cap: once the session heard speech, the gate may never exceed
            // half the demonstrated speech level (absolute threshold still floors it).
            if (heardAnySpeech && recentSpeechPeak > 0) {
                speechPeak = Math.max(threshold, Math.min(speechPeak, recentSpeechPeak * 0.5));
            }

            const now = performance.now();
            if (peak >= speechPeak) {
                if (!speechRunStart) speechRunStart = now;
            } else {
                speechRunStart = 0;
            }
            // Sustained-onset gate for the session's FIRST speech only (blip
            // rejection while nothing is known about the speaker). Once the session
            // has heard speech, per-segment re-arm uses the plain gate — requiring a
            // fresh 200ms sustained run after every cut is what clipped/discarded
            // segment onsets mid-dictation.
            const sustainedOnset = speechRunStart > 0 && (now - speechRunStart) >= minSpeechMs;
            const isSpeech = this._segHeardSpeech ? (peak >= speechPeak)
                : heardAnySpeech ? (peak >= speechPeak)
                : sustainedOnset;

            // Adaptive floor drifts up only on NON-speech frames: drifting during
            // speech drags the floor toward the speaker's own level and (×mult)
            // pushes the gate above their voice — the silent-discard runaway.
            if (!isSpeech && peak >= noiseFloor && isFinite(noiseFloor)) {
                noiseFloor += (peak - noiseFloor) * 0.0005;
            }
            if (isSpeech) {
                recentSpeechPeak = Math.max(recentSpeechPeak, peak);
            } else if (recentSpeechPeak > 0) {
                recentSpeechPeak *= 0.9998; // slow decay so the cap tracks real level changes
            }

            // Session-level turn tracking (independent of segment cuts, so a long
            // continuous monologue never trips the turn-idle timer between words).
            if (isSpeech) { heardAnySpeech = true; lastSpeechAt = now; turnIdleFired = false; }
            if (onTurnIdle && turnSilenceMs > 0 && heardAnySpeech && !turnIdleFired
                && (now - lastSpeechAt) >= turnSilenceMs) {
                turnIdleFired = true;
                if (this._vadDebug) console.log("[speech-to-text] turn idle");
                try { onTurnIdle(); } catch (_e) { /* consumer error is theirs */ }
            }

            // Don't evaluate cut conditions while a cut/restart is mid-flight.
            const dt = lastTickAt ? now - lastTickAt : 0;
            lastTickAt = now;
            // Stall watchdog: a long tick gap means the evidence for this segment
            // has a hole — its silence verdict must not be trusted (onstop then
            // reports it untracked so the audio is transcribed, not discarded).
            if (dt > VAD_STALL_MS) this._segVadStalled = true;
            this._lastVadTickAt = now;
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
                    else {
                        const silentFor = now - this._segSilentSince;
                        if (silentFor >= silenceMs) {
                            if (this._vadDebug) console.log("[speech-to-text] cut: trailing-silence", {noiseFloor: nf, speechPeak, recentSpeechPeak, segMaxPeak: this._segMaxPeak, voicedMs: this._segVoicedMs, failOpen: this._segFailOpen});
                            this._cutSegment(false);
                        } else if (this._segWantCut && silentFor >= SOFT_CUT_SILENCE_MS) {
                            // Duration cap elapsed mid-monologue: take the first real
                            // word gap rather than slicing through a word.
                            if (this._vadDebug) console.log("[speech-to-text] cut: duration cap at word gap", {silentFor, voicedMs: this._segVoicedMs});
                            this._cutSegment(false);
                        }
                    }
                } else if (segElapsed >= onsetTimeoutMs) {
                    // Prolonged leading silence: re-arm so the session never grows
                    // an unbounded silent blob. In fail-open mode the blob is
                    // emitted (VAD only labels); otherwise it enters the
                    // discard/probe policy in onstop.
                    if (this._vadDebug) console.log("[speech-to-text] cut: onset-timeout", {noiseFloor: nf, speechPeak, recentSpeechPeak, segMaxPeak: this._segMaxPeak, voicedMs: this._segVoicedMs, failOpen: this._segFailOpen});
                    this._cutSegment(this._segFailOpen ? false : true);
                }
            }
        };

        const tick = () => {
            if (!this._recording) return;
            analyser.getFloatTimeDomainData(buf);
            let peak = 0;
            for (let i = 0; i < buf.length; i++) {
                const v = buf[i] < 0 ? -buf[i] : buf[i];
                if (v > peak) peak = v;
            }
            processPeak(peak);
            this._rafId = requestAnimationFrame(tick);
        };
        this._rafId = requestAnimationFrame(tick);
        // Upgrade to the worklet clock; on success the rAF loop is redundant.
        void this._attachWorkletMeter(processPeak).then((ok) => {
            if (ok && this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
        });
    }

    /** End a continuous session: flush the final segment, then tear down. */
    private _endSegmented(): void {
        if (!this._segmented) return;
        this._recording = false; // stops the VAD loop from cutting further
        this._cutting = true;
        this._clearSegmentTimers();
        // The archive is NOT stopped here: the final segment is still being flushed,
        // and those last words are exactly the ones a stop-then-review flow must not
        // lose. _teardown stops it once the flush has been emitted.
        const current = this._segRec;
        if (current) {
            current.action = "end";
            current.evidence = this._snapshotSegmentEvidence();
        }
        try {
            if (current && current.rec.state !== "inactive") {
                current.rec.stop(); // final onstop emits the flush segment
            } else {
                this._finishSegmented(); // never started (or already inactive): finish now
            }
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
        this._segWantCut = false;
        this._segRec = null;
        this._segMaxDurationMs = 0;
        this._segFailOpen = false;
        this._segConsecDiscards = 0;
        // Stop the archive recorder but KEEP its chunks: the consumer retrieves the
        // session recording after the session has ended (see getArchiveBlobs). The
        // final window seals from the recorder's own onstop, which fires after this —
        // hence `_onArchiveWindow` living outside `_segOpts`, which is nulled here.
        this._stopArchive();
        this._clearWindowTimers();
        this._windowWantRotate = false;
        if (this._silenceTimer) { clearTimeout(this._silenceTimer); this._silenceTimer = null; }
        this._clearSegmentTimers();
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
        if (this._workletNode) {
            try { this._workletNode.port.onmessage = null; this._workletNode.disconnect(); }
            catch (_e) { /* ignore */ }
            this._workletNode = null;
        }
        try { this._audioCtx?.close(); } catch (_e) { /* ignore */ }
        this._audioCtx = null;
        try { this._stream?.getTracks().forEach(t => t.stop()); } catch (_e) { /* ignore */ }
        this._stream = null;
        this._recorder = null;
        this._onDeviceError = undefined;
    }
}
