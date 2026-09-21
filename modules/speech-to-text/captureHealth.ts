/**
 * What a quiet capture actually means.
 *
 * A microphone that stops producing level callbacks looks, from the outside, exactly
 * like a microphone that stopped recording — and treating the two the same is what
 * made a healthy dictation end with "voice capture stopped responding". They are not
 * the same, and the difference is observable: MediaRecorder and Web Audio are
 * independent subsystems on the same stream, so recorder bytes can keep arriving long
 * after the audio graph has gone silent, and `AudioContext.currentTime` advances only
 * while the render thread genuinely renders.
 *
 * This module turns those observations into one verdict. It is deliberately pure —
 * no `window`, no DOM, no timers — so the discriminations can be tested without a
 * microphone, and so the recovery ladder in AudioCapture stays a dispatcher over a
 * rule rather than a pile of nested conditions.
 */

/** Everything the verdict is derived from. Durations in ms; -1 = never happened. */
export interface CaptureHealthInput {
    /** The capture believes it is running (nobody called stop/teardown). */
    recording: boolean;
    /** `AudioContext.state`, or "none" when there is no context. */
    contextState: string;
    /** `MediaStreamTrack.readyState`, or "none" when there is no track. */
    trackState: string;
    /** `MediaStreamTrack.muted` — the OS took the input away, or "unknown" (null). */
    trackMuted: boolean | null;
    /** Since the last VAD/level tick. */
    msSinceVadTick: number;
    /** Since the last recorder flush (segment or archive). */
    msSinceRecorderData: number;
    /** `AudioContext.currentTime` moved since the previous observation. */
    contextTimeAdvancing: boolean;
}

/** Thresholds, so the caller owns the policy and this file owns the logic. */
export interface CaptureHealthThresholds {
    /** A VAD gap beyond this is a stalled level clock. */
    vadStallMs: number;
    /** A recorder gap beyond this means audio genuinely stopped flowing. */
    dataStallMs: number;
}

/**
 * - `healthy` — everything is moving.
 * - `vad-stalled` — the level clock died but audio is still being recorded. Degrade:
 *   speech evidence has holes (so nothing may be discarded as "silence"), but the
 *   dictation itself is fine and must not be interrupted.
 * - `context-suspended` — the AudioContext is not running; `resume()` usually fixes it.
 * - `device-lost` — the track ended or was muted by the OS: a new `getUserMedia` is
 *   the only way back.
 * - `dead` — no recorder data either. This is the only verdict that means the user
 *   is talking into nothing.
 */
export type CaptureVerdict = "healthy" | "vad-stalled" | "context-suspended" | "device-lost" | "dead";

/**
 * Classify a live capture.
 *
 * Ordered most-specific-cause first, and biased to keep dictation alive: the device
 * and the context are asked about before the level clock, because they name a cause
 * with a known cure, while `dead` is reserved for the case where the recorder itself
 * has gone quiet — the only evidence that no audio is being captured at all.
 */
export function classifyCapture(input: CaptureHealthInput, thresholds: CaptureHealthThresholds): CaptureVerdict {
    const {recording, contextState, trackState, trackMuted, msSinceVadTick, msSinceRecorderData, contextTimeAdvancing} =
        input || ({} as CaptureHealthInput);
    const vadStallMs = thresholds?.vadStallMs ?? 2000;
    const dataStallMs = thresholds?.dataStallMs ?? 8000;

    if (!recording) return "dead";
    if (trackState === "ended" || trackMuted === true) return "device-lost";

    // No recorder bytes for this long and the capture is not producing audio,
    // whatever Web Audio thinks. Checked before the context so a dead recorder is
    // never reported as a merely suspended context.
    const dataStalled = msSinceRecorderData >= 0 && msSinceRecorderData > dataStallMs;
    if (dataStalled) return "dead";

    if (contextState !== "running") return "context-suspended";

    // The context claims to run but its clock is frozen: the render thread is gone,
    // which presents to a consumer exactly like a stalled level clock and has the
    // same consequence — degrade, don't stop.
    if (!contextTimeAdvancing) return "vad-stalled";
    if (msSinceVadTick >= 0 && msSinceVadTick > vadStallMs) return "vad-stalled";
    return "healthy";
}
