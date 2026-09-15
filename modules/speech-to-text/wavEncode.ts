/**
 * Float32 PCM frames → a self-contained RIFF/WAVE blob (PCM16, mono).
 *
 * Under the Silero VAD the capture already holds every segment as 16 kHz Float32
 * frames, so the upload is built from those instead of a `MediaRecorder` container:
 * bytes ↔ samples is exact (no codec, no container variable, no flush latency) and
 * every transcription backend decodes WAV. Kept local — and dependency-free — so the
 * capture never imports the VAD library and this encoder is testable in Node.
 */

export const WAV_SAMPLE_RATE = 16000;
const HEADER_BYTES = 44;

/** Concatenate `frames` and wrap them in a 44-byte PCM16 mono WAV header. */
export function encodeWav16(frames: ArrayLike<Float32Array<ArrayBufferLike>>, sampleRate = WAV_SAMPLE_RATE): ArrayBuffer {
    let samples = 0;
    for (let i = 0; i < frames.length; i++) samples += frames[i]!.length;
    const dataBytes = samples * 2;
    const buf = new ArrayBuffer(HEADER_BYTES + dataBytes);
    const view = new DataView(buf);
    const tag = (offset: number, text: string) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    tag(0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    tag(8, "WAVE");
    tag(12, "fmt ");
    view.setUint32(16, 16, true);          // fmt chunk size
    view.setUint16(20, 1, true);           // PCM
    view.setUint16(22, 1, true);           // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true);           // block align
    view.setUint16(34, 16, true);          // bits per sample
    tag(36, "data");
    view.setUint32(40, dataBytes, true);
    let offset = HEADER_BYTES;
    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i]!;
        for (let j = 0; j < frame.length; j++) {
            const s = Math.max(-1, Math.min(1, frame[j] ?? 0));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            offset += 2;
        }
    }
    return buf;
}

/** The blob form the drivers upload; `audio/wav` selects the `.wav` filename in every driver. */
export function wavBlob(frames: ArrayLike<Float32Array<ArrayBufferLike>>, sampleRate = WAV_SAMPLE_RATE): Blob {
    return new Blob([encodeWav16(frames, sampleRate)], {type: "audio/wav"});
}
