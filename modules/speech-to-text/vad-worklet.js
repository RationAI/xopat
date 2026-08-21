/**
 * Peak meter AudioWorkletProcessor backing the capture VAD.
 *
 * Runs on the audio render thread, which browsers do NOT throttle for hidden
 * tabs — unlike requestAnimationFrame, which pauses entirely and used to freeze
 * all speech-evidence tracking the moment the viewer tab lost visibility (the
 * mic kept recording, but every segment was then judged speechless and
 * discarded). The main thread keeps the exact same VAD logic; this processor
 * only replaces the analyser-polling clock: it accumulates the max-abs peak of
 * the input and posts it over the MessagePort every ~50 ms.
 *
 * Loaded as a static module asset (never bundled) via
 * `audioWorklet.addModule(<MODULE_ROOT>/vad-worklet.js)`; when loading fails
 * (no AudioWorklet, restrictive CSP) capture falls back to the rAF loop.
 */
class XOpatVadMeterProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._peak = 0;
        this._frames = 0;
        // ~50ms batches: fast enough for silence-boundary cuts and the level
        // meter, slow enough to keep MessagePort traffic negligible.
        this._batchFrames = Math.max(128, Math.round(sampleRate * 0.05));
    }

    process(inputs) {
        const channels = inputs[0];
        if (channels && channels.length) {
            let peak = this._peak;
            for (let c = 0; c < channels.length; c++) {
                const samples = channels[c];
                for (let i = 0; i < samples.length; i++) {
                    const v = samples[i] < 0 ? -samples[i] : samples[i];
                    if (v > peak) peak = v;
                }
            }
            this._peak = peak;
            this._frames += channels[0] ? channels[0].length : 128;
        } else {
            // No input quantum (source starved) still advances the clock so the
            // main thread keeps observing silence instead of stalling.
            this._frames += 128;
        }
        if (this._frames >= this._batchFrames) {
            this.port.postMessage(this._peak);
            this._peak = 0;
            this._frames = 0;
        }
        return true;
    }
}

registerProcessor("xopat-vad-meter", XOpatVadMeterProcessor);
