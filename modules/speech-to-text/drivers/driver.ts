/**
 * Transcription driver contract.
 *
 * A driver turns a captured audio `Blob` into text. The module owns capture and
 * lifecycle; drivers are pure transports/compute so the same `SpeechToTextModule`
 * can run against a remote self-hosted Whisper endpoint (default) or an in-browser
 * WASM model without any consumer-visible change. Drivers never reach for a viewer
 * or DOM — they only see audio in, text out.
 */

export interface TranscriptionOptions {
    /** BCP-47 hint (e.g. "en", "cs"); drivers may ignore it. */
    language?: string;
    /**
     * Domain/vocabulary biasing hint (Whisper `prompt` / whisper.cpp
     * `initial_prompt`, ~224-token soft bias). Free text seeded with the terms
     * and spellings the transcript should favour (e.g. a pathology glossary), so
     * homophones resolve toward the domain — "histology" over "history". A soft
     * hint, not a hard constraint; drivers with no prompt support (in-browser
     * WASM) ignore it. Kept domain-agnostic here — callers supply the content.
     */
    prompt?: string;
    /** Abort in-flight transcription (upload or compute). */
    signal?: AbortSignal;
}

export interface TranscriptionResult {
    /** Plain, already-sanitized transcript text. Consumers get text, never HTML. */
    text: string;
    /** Detected/echoed language, when the backend reports it. */
    language?: string;
    /** 0..1 confidence, when the backend reports it. */
    confidence?: number;
    /**
     * True when the capture's VAD heard no (or too little) speech and the audio
     * was therefore never sent to any driver — the empty `text` is a verdict,
     * not a transcription. Set by the module, never by drivers.
     */
    noSpeech?: boolean;
}

export interface TranscriptionDriver {
    /** Stable id, unique across registered drivers. */
    readonly id: string;
    /** Human-friendly label for pickers/diagnostics. */
    readonly label: string;
    /** True when audio never leaves the browser (privacy signalling for UI). */
    readonly local: boolean;

    /**
     * Probe reachability lazily — only called when this driver is actually
     * selected, so an unused remote endpoint is never contacted. Must not throw;
     * resolve `false` on any failure.
     */
    isAvailable(): Promise<boolean>;

    /** Transcribe one utterance. Rejects on failure (caller wraps for the user). */
    transcribe(audio: Blob, opts?: TranscriptionOptions): Promise<TranscriptionResult>;

    /**
     * Optional: begin loading heavy resources (models) ahead of time so the first
     * transcription isn't cold. Called at recording-start so the load overlaps the
     * user speaking. Must be idempotent and must not throw.
     */
    prewarm?(): void;

    /** Release models/clients if the driver holds any. */
    dispose?(): void;
}

// Whole-string filler phrases Whisper emits on non-speech audio (learned from
// subtitle/caption training data). Matched case-insensitively against the entire
// stripped transcript, so a real sentence that merely contains one is untouched.
const HALLUCINATION_PHRASES = [
    "thanks for watching", "thank you for watching", "thanks for listening",
    "please subscribe", "like and subscribe", "see you next time",
    "subtitles by", "transcription by", "amara.org",
];

/**
 * Remove Whisper's non-speech artifacts. On silence/room-tone/noise Whisper
 * hallucinates caption tokens — parenthesised/bracketed stage directions
 * (`(dramatic music)`, `[MUSIC]`), musical glyphs (`♪♫`), or stock end-card
 * phrases. We strip bracketed/musical segments in place (keeping any real speech
 * around them) and blank the result entirely if what remains is only a known
 * filler phrase. A blank transcript is treated by callers as "no speech" and is
 * never submitted.
 */
export function stripNonSpeech(text: string): string {
    let t = String(text || "");
    // Drop (…), […], {…} caption segments and musical note glyphs + their content.
    t = t.replace(/[([{][^)\]}]*[)\]}]/g, " ");
    // Asterisk-wrapped stage directions some models emit for non-speech audio
    // (*Buzzing*, *sips*, *sounds of a plane*). Speech ASR never contains literal
    // asterisks, so this is safe; a real sentence around one keeps its words.
    t = t.replace(/\*[^*]+\*/g, " ");
    t = t.replace(/[♪♫🎵🎶][^♪♫🎵🎶]*[♪♫🎵🎶]/gu, " ");
    t = t.replace(/[♪♫🎵🎶]/gu, " ");
    t = t.replace(/\s+/g, " ").trim();

    if (!t) return "";
    // If the entire remainder is just a stock caption phrase, treat as no-speech.
    const bare = t.toLowerCase().replace(/[.!?,\s]+$/g, "").trim();
    if (HALLUCINATION_PHRASES.includes(bare)) return "";
    return t;
}

/**
 * Coerce an arbitrary backend payload into a safe {@link TranscriptionResult}.
 * Backend responses are untrusted (§7): force `text` to a bounded plain string
 * and drop everything else we don't recognise. Also strips Whisper's non-speech
 * hallucinations (see {@link stripNonSpeech}).
 */
export function normalizeResult(raw: any, maxLen = 20000): TranscriptionResult {
    let text = "";
    if (typeof raw === "string") text = raw;
    else if (raw && typeof raw === "object") {
        // Accept the common Whisper/OpenAI shapes: { text } or { results:[{text}] }.
        if (typeof raw.text === "string") text = raw.text;
        else if (Array.isArray(raw.segments)) {
            text = raw.segments.map((s: any) => (typeof s?.text === "string" ? s.text : "")).join(" ");
        }
    }
    text = stripNonSpeech(String(text).replace(/\s+/g, " ").trim());
    if (text.length > maxLen) text = text.slice(0, maxLen);

    const out: TranscriptionResult = { text };
    if (raw && typeof raw === "object") {
        if (typeof raw.language === "string") out.language = raw.language.slice(0, 16);
        if (typeof raw.confidence === "number" && isFinite(raw.confidence)) {
            out.confidence = Math.max(0, Math.min(1, raw.confidence));
        }
    }
    return out;
}
