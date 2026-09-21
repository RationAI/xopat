/**
 * The capture's error vocabulary — a small, translatable `code` so the module can
 * show the right localized message instead of leaking a raw browser exception.
 * Split out of `audioCapture.ts` so the VAD engine can raise one without importing
 * the capture (which imports the engine).
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
     * The amplitude VAD gate repeatedly discarded segments that then transcribed to
     * real text — its speech threshold is misjudging this session (noise, AGC, quiet
     * speaker). The session switched to fail-open: everything is transcribed and
     * the VAD only labels. Reported as a warning, capture keeps running.
     */
    | "vad-degraded"
    /**
     * The Silero VAD could not be used (assets missing, load timed out, worklet or
     * WebAssembly refused, or its frames stopped mid-session) and the session runs on
     * the amplitude gate instead. Reported as a warning, capture keeps running.
     */
    | "vad-fallback"
    | "capture-failed";

export class CaptureError extends Error {
    code: CaptureErrorCode;
    constructor(code: CaptureErrorCode, message?: string) {
        super(message || code);
        this.name = "CaptureError";
        this.code = code;
    }
}
