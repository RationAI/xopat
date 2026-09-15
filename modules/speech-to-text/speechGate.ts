/**
 * The one speech verdict of the capture.
 *
 * Both VAD engines feed it, one frame at a time, and every timer, cut and turn
 * decision in `audioCapture.ts` reads its answer — so there is exactly one place
 * that decides "is this speech", and it is pure: no clock, no DOM, no audio graph.
 * The caller supplies `t` (ms) with each frame.
 *
 * - **Silero** frames carry `prob` (0..1). The verdict is a hysteresis on the model's
 *   probability: on at `positiveSpeechThreshold`, off below `negativeSpeechThreshold`.
 * - **Amplitude** frames carry only `peak`. The verdict is the adaptive gate this
 *   module has always used: `max(threshold, noiseFloor × speechFloorMult)`, the floor
 *   a running minimum that drifts up on NON-speech frames only, and (segmented
 *   sessions) a cap at half the demonstrated speech level so a floor polluted by long
 *   speech can never climb above the speaker's voice.
 *
 * Shared by both: the session's FIRST onset must stay above the gate for
 * `minSpeechMs` (blip rejection while nothing is known about the speaker); once the
 * session has heard speech, a per-segment re-arm is the plain gate — requiring a
 * fresh sustained run after every cut is what used to clip segment onsets. The
 * withheld run-up is credited to `voicedDeltaMs` on the transition frame so a short
 * word is not undercounted.
 */

/** Which engine produced a session's speech evidence. */
export type VadEngine = "silero" | "amplitude" | "none";

/** Longest gap one frame may credit as voiced time (Silero ~32 ms, amplitude ~50 ms). */
export const MAX_FRAME_MS = 250;

export interface GateOptions {
    /** Absolute peak floor: true silence never counts as speech (amplitude). */
    threshold: number;
    /** How far above the noise floor a peak must sit (amplitude). */
    speechFloorMult: number;
    /** Sustained ms above the gate before the session's first onset counts. */
    minSpeechMs: number;
    /** Silero: probability at which speech turns on. */
    positiveSpeechThreshold: number;
    /** Silero: probability below which speech turns off. */
    negativeSpeechThreshold: number;
    /** Amplitude: cap the gate at half the demonstrated speech level (segmented sessions). */
    capGate: boolean;
}

export interface GateInput {
    /** Frame timestamp, ms (any monotonic clock). */
    t: number;
    /** Max-abs sample of the frame, 0..1. */
    peak: number;
    /** Silero speech probability; its presence selects the Silero verdict. */
    prob?: number;
}

export interface GateVerdict {
    isSpeech: boolean;
    /** Voiced ms this frame adds (includes the withheld onset run-up on the transition frame). */
    voicedDeltaMs: number;
    /** Normalized UI level, 0..1 (0.25 peak ≈ full scale). */
    level: number;
    peak: number;
    /** ms since the previous frame; 0 on the first. */
    dt: number;
    /** Start of the above-gate run this frame belongs to; `t` when not in a run. */
    onsetAt: number;
}

export class SpeechGate {
    private readonly _o: GateOptions;
    private _noiseFloor = Infinity;
    private _recentSpeechPeak = 0;
    private _runStart = 0;
    private _heardAny = false;
    private _segHeard = false;
    /** Silero hysteresis state (raw, before the onset rule). */
    private _active = false;
    private _lastT = 0;
    private _gate = 0;
    private _mode: VadEngine = "none";

    constructor(opts: GateOptions) {
        this._o = opts;
    }

    /** True once the session has heard speech (survives segment re-arms). */
    get heardAnySpeech(): boolean {
        return this._heardAny;
    }

    /** A new segment opened: its own "heard" flag resets, session state persists. */
    beginSegment(): void {
        this._segHeard = false;
    }

    process(input: GateInput): GateVerdict {
        const o = this._o;
        const {t, peak} = input;
        let above: boolean;
        if (typeof input.prob === "number") {
            this._mode = "silero";
            above = this._active ? input.prob >= o.negativeSpeechThreshold : input.prob >= o.positiveSpeechThreshold;
            this._active = above;
        } else {
            this._mode = "amplitude";
            if (peak < this._noiseFloor) this._noiseFloor = peak;
            const nf = isFinite(this._noiseFloor) ? this._noiseFloor : 0;
            let gate = Math.max(o.threshold, nf * o.speechFloorMult);
            if (o.capGate && this._heardAny && this._recentSpeechPeak > 0) {
                gate = Math.max(o.threshold, Math.min(gate, this._recentSpeechPeak * 0.5));
            }
            this._gate = gate;
            above = peak >= gate;
        }

        if (above) {
            if (!this._runStart) this._runStart = t;
        } else {
            this._runStart = 0;
        }
        const sustained = this._runStart > 0 && (t - this._runStart) >= o.minSpeechMs;
        const isSpeech = (this._segHeard || this._heardAny) ? above : sustained;

        if (this._mode === "amplitude") {
            if (!isSpeech && peak >= this._noiseFloor && isFinite(this._noiseFloor)) {
                this._noiseFloor += (peak - this._noiseFloor) * 0.0005;
            }
            if (isSpeech) this._recentSpeechPeak = Math.max(this._recentSpeechPeak, peak);
            else if (this._recentSpeechPeak > 0) this._recentSpeechPeak *= 0.9998;
        }

        // A frame credits at most one frame's worth of time: a gap longer than any
        // clock's cadence is a stall (the capture flags it), not voice — crediting it
        // would turn a paused tab or an engine switch into seconds of "speech".
        const dt = this._lastT ? Math.min(MAX_FRAME_MS, t - this._lastT) : 0;
        this._lastT = t;
        // The run-up is only ever withheld before the session's FIRST speech; after
        // that the gate is plain and a frame credits its own dt. (Crediting `t - runStart`
        // on a segment re-arm mid-run used to inflate the new segment's voicedMs by the
        // whole run that a duration-cap cut had just split.)
        const voicedDeltaMs = isSpeech ? ((!this._heardAny && this._runStart) ? t - this._runStart : dt) : 0;
        const onsetAt = this._runStart || t;
        if (isSpeech) {
            this._heardAny = true;
            this._segHeard = true;
        }
        return {
            isSpeech,
            voicedDeltaMs,
            level: Math.max(0, Math.min(1, peak / 0.25)),
            peak,
            dt,
            onsetAt,
        };
    }

    /** Diagnostics for the `:vad` debug channel. */
    snapshot(): { mode: VadEngine; noiseFloor: number; gate: number; recentSpeechPeak: number; heardAny: boolean; segHeard: boolean } {
        return {
            mode: this._mode,
            noiseFloor: isFinite(this._noiseFloor) ? this._noiseFloor : 0,
            gate: this._gate,
            recentSpeechPeak: this._recentSpeechPeak,
            heardAny: this._heardAny,
            segHeard: this._segHeard,
        };
    }
}

/** Which engine a session runs on: Silero only when asked for, supported and loaded. */
export function pickVadEngine(i: { requested: VadEngine; supported: boolean; load: "idle" | "loading" | "ready" | "failed" }): VadEngine {
    return i.requested === "silero" && i.supported && i.load === "ready" ? "silero" : "amplitude";
}

/**
 * May a captured segment skip the voiced-content floor and reach a driver anyway?
 *
 * Three kinds of segment are allowed past it, each because the VAD's verdict is either
 * suspect or overridden: a `probe` (the discard ladder testing whether the gate is
 * misjudging a quiet speaker), a `failOpen` session (the gate already proved wrong), and
 * the capture's final `flush` (a manual stop must not cut off the trailing utterance).
 * An untracked segment has no verdict to bypass in the first place.
 *
 * The flush case has one exception, learned from a dictation that ended with a duplicated
 * paragraph. The bypass is there to save trailing SPEECH; a flush carrying `voicedMs: 0`
 * has none — it is silence being uploaded with a biasing prompt attached, which is the
 * exact condition under which a recognizer answers by reciting that prompt back. It came
 * back as a tidied rewrite of the rolling context tail, so the prompt-echo stripper (which
 * matches text, not meaning) passed it through, and three sentences of already-transcribed
 * speech were appended to a medical transcript a second time.
 *
 * Zero is the only case taken back, because zero is the only unambiguous one: a flush with
 * any voiced audio at all still bypasses the threshold, and nothing a speaker said is lost.
 */
export function bypassesVoicedFloor(
    meta: { probe?: boolean; failOpen?: boolean; flush?: boolean; tracked?: boolean; voicedMs?: number } | null | undefined,
): boolean {
    if (!meta) return false;
    if (meta.flush && meta.tracked && !(Number(meta.voicedMs) > 0)) return false;
    return !!(meta.probe || meta.failOpen || meta.flush);
}
