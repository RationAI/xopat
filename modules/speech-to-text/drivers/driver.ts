/**
 * Transcription driver contract.
 *
 * A driver turns a captured audio `Blob` into text. The module owns capture and
 * lifecycle; drivers are pure transports/compute so the same `SpeechToTextModule`
 * can run against a remote self-hosted Whisper endpoint (default) or an in-browser
 * WASM model without any consumer-visible change. Drivers never reach for a viewer
 * or DOM — they only see audio in, text out.
 */

import {hasCJK, words as segmentWords} from "../textWords";

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
    /**
     * Per-call network deadline in ms for transport drivers, overriding their
     * configured default. Needed because one call is not like another: a 15 s
     * utterance and a 40-minute session archive share the same code path. `0`
     * means "no client-side timer" (the server deadline still applies). Compute
     * drivers with no transport (WASM) ignore it.
     */
    timeoutMs?: number;
}

export interface TranscriptionResult {
    /** Plain, already-sanitized transcript text. Consumers get text, never HTML. */
    text: string;
    /** Detected/echoed language, when the backend reports it. */
    language?: string;
    /** 0..1 confidence, when the backend reports it. */
    confidence?: number;
    /**
     * Audio duration the BACKEND measured, in seconds, when it reports one.
     *
     * Diagnostic, and the cheapest possible answer to "did the upload decode at all".
     * `MediaRecorder` writes a live-stream container whose header carries no duration; a
     * decoder that reads that as zero transcribes nothing and returns no error, which is
     * indistinguishable from silence at every other layer. A megabyte of audio reported
     * back as ~0 s says the file was never really decoded — and a megabyte reported as
     * its true length says the fault is elsewhere.
     */
    durationInSeconds?: number;
    /**
     * Whisper's own per-decode verdicts, when the backend returns `verbose_json`:
     * mean `no_speech_prob` (≈1 = the model heard silence), mean `avg_logprob`
     * (below ≈-1 = a low-confidence decode) and the maximum `compression_ratio`
     * (above ≈2.4 = a repetition loop). These are the numbers Whisper's own fallback
     * ladder thresholds on; a consumer that has them needs no text heuristic to tell a
     * hallucinated "The" over room tone from a real one-word answer. Absent when the
     * backend does not report segments.
     */
    noSpeechProb?: number;
    avgLogprob?: number;
    compressionRatio?: number;
    /**
     * Which driver and model actually produced this text — set by the module from the
     * driver that ANSWERED, not the one that was configured. The two differ whenever a
     * fallback served the request, and a trace that stamps the configured model on a
     * fallback's output attributes the fallback's quality to the wrong recognizer.
     */
    driverId?: string;
    model?: string;
    /**
     * Text filters that changed the driver's raw output on the way here
     * (`"repetition"`, `"non-speech"`, `"prompt-echo"`, `"operator-filter"`). Present
     * only when something was altered, so a consumer can tell a genuinely empty decode
     * from one a filter emptied — the second kind is worth surfacing, the first is not.
     */
    filtered?: string[];
    /**
     * True when the capture's VAD heard no (or too little) speech and the audio
     * was therefore never sent to any driver — the empty `text` is a verdict,
     * not a transcription. Set by the module, never by drivers.
     */
    noSpeech?: boolean;
}

/**
 * A non-transient driver failure caused by configuration — e.g. the vercel
 * driver bound to a provider whose adapter does not support transcription.
 * Retrying with the same config cannot succeed, so the module surfaces it
 * loudly (an error-level log + `driver-error` event with `permanent: true`) instead
 * of quietly burning the fallback chain on every utterance.
 */
export class DriverConfigurationError extends Error {
    readonly permanent = true;
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "DriverConfigurationError";
    }
}

export interface TranscriptionDriver {
    /** Stable id, unique across registered drivers. */
    readonly id: string;
    /** Human-friendly label for pickers/diagnostics. */
    readonly label: string;
    /** True when audio never leaves the browser (privacy signalling for UI). */
    readonly local: boolean;
    /**
     * Which model this driver transcribes with, when it knows — the configured id, or
     * whatever the endpoint defaults to when none was configured (then `undefined`).
     *
     * Diagnostics only, and worth the field: recognizer behaviour is model-specific in
     * ways that look like microphone or code faults (prompt obedience, silence
     * hallucinations, repetition), and a session trace that does not name the model
     * cannot distinguish them without reading deployment config that is not in the dump.
     */
    readonly modelId?: string;

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
    // Whisper's short silence fillers, observed as whole-segment transcripts of room tone in
    // dictation traces ("Thank you." ×2 and "Hello." reached a confirmed pathology report).
    // Whole-string matches only: a real sentence containing one is untouched, and clinical
    // one-word answers ("yes", "no", "okay") are deliberately NOT here.
    "thank you", "thank you very much", "thanks", "thank you so much",
    "hello", "hi", "bye", "goodbye", "you", "the", "so", "um", "uh", "hmm", "mm-hmm",
    "silence", "[silence]", "(silence)",
    // The same fillers in Japanese — Whisper's subtitle training shows through in every
    // language it decodes. Compared after NFKC folding with the Japanese full stop and
    // comma stripped, so 「ご視聴ありがとうございました。」 matches.
    "ご視聴ありがとうございました", "ご視聴ありがとうございます", "ありがとうございました",
    "ありがとうございます", "お疲れ様でした", "チャンネル登録お願いします", "字幕",
];

/** Punctuation that may trail a stock phrase: ASCII, and the Japanese full stop / comma / marks. */
const TRAILING_PUNCT_RE = /[.!?,\s。、！？]+$/gu;

/**
 * Subtitle and translation CREDITS, in the languages Whisper learned them from — a Czech
 * dictation ended with "Titulky vytvořil JohnyX." over 0 ms of voice. Matched against the
 * WHOLE segment (NFKC-folded, lower-cased, trailing punctuation stripped), so a sentence
 * that merely mentions subtitles is untouched: only a bare credit is nothing but a credit.
 */
const HALLUCINATION_PATTERNS: RegExp[] = [
    // cs: "Titulky vytvořil X", "Titulky: X", "Překlad: X", "Přeložil X"
    /^titulky(\s+(vytvořil|vytvořila|vytvořili|přeložil|přeložila|od|by)\b.*|\s*[:\-–]\s*\S.*|\s+\S+)$/u,
    /^(překlad|přeložil|přeložila)\b.*$/u,
    // sk
    /^titulky\s+(vytvoril|vytvorila|preložil|preložila)\b.*$/u,
    // de / nl
    /^untertitel(ung)?\b.*$/u,
    /^ondertitel(s|ing|d)?\b.*$/u,
    // fr / es / pt / it / pl
    /^sous-titr(es|age)\b.*$/u,
    /^subt[ií]tulos\b.*$/u,
    /^legendas?\b.*$/u,
    /^sottotitoli\b.*$/u,
    /^napisy\b.*$/u,
    // ja / ko / zh
    /^字幕.*$/u,
    /^자막.*$/u,
    // en credits: "subtitles by X", "transcribed by X", "translated by X", "captions by X"
    /^(subtitles?|transcription|transcribed|translated|translation|captions?|captioned)\s+by\b.*$/u,
    // A bare web credit: "www.example.org", "www.zeoranger.co.uk", "amara.org". A lone
    // domain-shaped token — labels of letters/digits/hyphens, a letters-only TLD of two or
    // more, so "2.5" or "e.g" never match.
    /^(www\.)?[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)*\.\p{L}{2,}$/u,
    /amara\.org/u,
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
    // Drop (…), […], {…} caption segments and musical note glyphs + their content —
    // and their full-width Japanese counterparts, which a Japanese decode uses.
    t = t.replace(/[([{][^)\]}]*[)\]}]/g, " ");
    t = t.replace(/[（【〔][^）】〕]*[）】〕]/gu, " ");
    t = t.replace(/[「『][^」』]*[」』]/gu, " ");
    // Asterisk-wrapped stage directions some models emit for non-speech audio
    // (*Buzzing*, *sips*, *sounds of a plane*). Speech ASR never contains literal
    // asterisks, so this is safe; a real sentence around one keeps its words.
    t = t.replace(/\*[^*]+\*/g, " ");
    t = t.replace(/[♪♫🎵🎶][^♪♫🎵🎶]*[♪♫🎵🎶]/gu, " ");
    t = t.replace(/[♪♫🎵🎶]/gu, " ");
    t = t.replace(/\s+/g, " ").trim();

    if (!t) return "";
    // If the entire remainder is just a stock caption phrase, treat as no-speech.
    const bare = t.normalize("NFKC").toLowerCase().replace(TRAILING_PUNCT_RE, "").trim();
    if (HALLUCINATION_PHRASES.includes(bare)) return "";
    if (HALLUCINATION_PATTERNS.some((re) => re.test(bare))) return "";
    return t;
}

/**
 * Detect a Whisper repetition-loop hallucination. On noisy/ambiguous audio the
 * greedy decoder gets stuck emitting the same n-gram over and over ("the
 * information of the information of the information…", "the two-year-old, the
 * two-year-old, …"). Such a transcript is not speech and must never be submitted.
 *
 * A single O(n) pass, Whisper's own compression-ratio defense in spirit:
 *  - long loops fail the **unique-word ratio** (few distinct words over many);
 *  - shorter loops fail the **max consecutive phrase run** (a 1–4-word phrase
 *    repeated back-to-back ≥ 4×).
 * Short transcripts (< 12 words) are never flagged, and natural repetition
 * ("no no thanks") stays under both thresholds, so real dictation is untouched.
 */
/**
 * A hyphen-joined token spelled out of almost no alphabet — `l-m-m-m-m-m-m…`.
 *
 * Real hyphenated words ("two-year-old", "airway-centered", "non-necrotizing") draw on a
 * normal alphabet; a stuck decoder emits one letter. Two distinct letters is the bound
 * that keeps "x-ray" and "t-cell" out of it while catching the degenerate shape.
 */
function isSpelledOut(token: string): boolean {
    if (!token.includes("-")) return false;
    const letters = token.replace(/[^\p{L}\p{N}]+/gu, "");
    return letters.length >= 6 && new Set(letters).size <= 2;
}

/**
 * Above this many words the unique-word-ratio rule is no longer a loop detector: the
 * type–token ratio of ordinary prose falls with length and crosses 0.35 somewhere in the
 * low thousands, so a whole-session pass (20 minutes of dictation) would be blanked as a
 * "loop" on statistics alone. The consecutive-run rule has no such length dependence and
 * keeps guarding long texts.
 */
const RATIO_RULE_MAX_WORDS = 300;

export function looksRepetitive(text: string): boolean {
    // Hyphens are word characters here ("two-year-old", "airway-centered"), which a
    // degenerate decoder can exploit: `L-M-M-M-M-…-M` is ONE token to this regex. That
    // single mega-token both kept `n` under the 12-word floor and inflated the unique
    // ratio to 0.44, so a real 60-token loop scored as clean speech and was appended to a
    // pathology transcript. A token built from one or two distinct letters is not a word,
    // so it is split back into its parts before counting.
    // Words by the segmenter, so a Japanese loop (written without spaces) is as many
    // words as it has; hyphenated runs stay whole here for the mega-token rule below.
    const words = (hasCJK(text) ? segmentWords(text).map((w) => w.toLowerCase())
        : (String(text || "").toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) || []))
        .flatMap((w) => (isSpelledOut(w) ? w.split(/-+/).filter(Boolean) : [w]));
    const n = words.length;
    if (n < 12) return false; // too short to be a runaway loop; protect real speech

    // Long loops: very few distinct words across a long transcript. Bounded in length
    // (see RATIO_RULE_MAX_WORDS) so a long *normal* transcript is not mistaken for one.
    const unique = new Set(words).size;
    if (n <= RATIO_RULE_MAX_WORDS && unique / n < 0.35) return true;

    // Shorter loops the ratio misses: a phrase (period 1..4) repeated back-to-back.
    // A p-gram repeated k× consecutively yields (k-1)·p contiguous matches of
    // words[i] === words[i-p]; so repeats = floor(matchRun / p) + 1.
    for (let p = 1; p <= 4; p++) {
        let matchRun = 0;
        for (let i = p; i < n; i++) {
            if (words[i] === words[i - p]) {
                matchRun++;
                if (Math.floor(matchRun / p) + 1 >= 4) return true; // phrase repeated ≥ 4×
            } else {
                matchRun = 0;
            }
        }
    }
    return false;
}

/**
 * Collapse a repetition loop to what it repeats, instead of throwing the transcript away.
 *
 * A stuck decoder emits the loop AFTER whatever it decoded correctly: "Cellular
 * interstitial infiltrate of lymphocytes, L-Mass, L-Mass, L-Mass, …". Blanking the whole
 * result for the loop discards the sentence in front of it — for a 90 s archive window
 * that is a minute and a half of dictation lost to a defect in its last five seconds.
 * So a 1–4-word phrase repeated four or more times back-to-back is reduced to ONE
 * instance, spelled-out junk tokens (`L-M-M-M-M`) are dropped, and the surrounding text
 * is kept verbatim.
 *
 * Returns the collapsed text and whether anything was removed. A result that was
 * NOTHING but loop (fewer than three real words survive out of twelve or more) is
 * returned empty: that decode never contained speech, only the loop.
 */
export function collapseRepetition(text: string): { text: string; collapsed: boolean } {
    const raw = String(text || "").replace(/\s+/g, " ").trim();
    if (!raw) return {text: raw, collapsed: false};
    // Rebuilding text by joining tokens with spaces would rewrite a script written
    // without them; a CJK loop is still caught (and blanked) by looksRepetitive.
    if (hasCJK(raw)) return {text: raw, collapsed: false};
    const tokens = raw.split(" ");
    const key = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}'’-]+/gu, "");
    // Drop spelled-out mega-tokens outright: they are not words in any language.
    let out: string[] = [];
    let collapsed = false;
    for (const t of tokens) {
        if (isSpelledOut(key(t))) { collapsed = true; continue; }
        out.push(t);
    }
    if (out.length >= 8) {
        const keys = out.map(key);
        const kept: string[] = [];
        let i = 0;
        while (i < out.length) {
            let matched = false;
            for (let p = 1; p <= 4 && i + p <= out.length; p++) {
                // Count how many times the phrase at [i, i+p) repeats back-to-back.
                let k = 1;
                while (i + (k + 1) * p <= out.length) {
                    let same = true;
                    for (let j = 0; j < p; j++) {
                        if (keys[i + j] !== keys[i + k * p + j] || !keys[i + j]) { same = false; break; }
                    }
                    if (!same) break;
                    k++;
                }
                if (k >= 4) {
                    kept.push(...out.slice(i, i + p));
                    i += k * p;
                    matched = true;
                    collapsed = true;
                    break;
                }
            }
            if (!matched) { kept.push(out[i]!); i++; }
        }
        out = kept;
    }
    if (!collapsed) return {text: raw, collapsed: false};
    const realWords = out.filter((t) => key(t).length > 0).length;
    // Twelve or more tokens of which three quarters were loop, leaving three words or
    // fewer, were a loop and nothing else — the decode carried no speech to keep.
    // A spelled-out mega-token counts as the run it is: `L-M-M-M-…-M` is sixty tokens of
    // loop to the decoder, one token to a whitespace split.
    const expanded = tokens.reduce((n, t) => n + (isSpelledOut(key(t)) ? key(t).split(/-+/).filter(Boolean).length : 1), 0);
    const removed = 1 - realWords / Math.max(1, expanded);
    if (expanded >= 12 && realWords <= 3 && removed >= 0.75) return {text: "", collapsed: true};
    return {text: out.join(" ").replace(/\s+/g, " ").trim(), collapsed: true};
}

/**
 * Mean of the finite numbers in `values`, or undefined when there are none. `null` is
 * absent, not zero: a backend that reports `no_speech_prob: null` (observed) must not read
 * as "certainly speech".
 */
function meanOf(values: unknown[]): number | undefined {
    const nums = values.filter((v) => v !== null && v !== undefined && v !== "").map(Number).filter((v) => Number.isFinite(v));
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined;
}
/** `Number(v)` for a present value; undefined for null/undefined/"" (never 0 by coercion). */
function numOrUndefined(v: unknown): number | undefined {
    if (v === null || v === undefined || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

/**
 * Coerce an arbitrary backend payload into a safe {@link TranscriptionResult}.
 * Backend responses are untrusted (§7): force `text` to a bounded plain string
 * and drop everything else we don't recognise. Also strips Whisper's non-speech
 * hallucinations (see {@link stripNonSpeech}) and collapses repetition loops
 * (see {@link collapseRepetition}); every alteration is recorded in `filtered`.
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
    const filtered: string[] = [];
    const original = String(text).replace(/\s+/g, " ").trim();
    text = stripNonSpeech(original);
    if (text !== original) filtered.push("non-speech");
    // A repetition loop is a decoder fault, not speech. Collapse it so the words decoded
    // before the decoder got stuck survive; a decode that was nothing but loop empties.
    if (text) {
        const c = collapseRepetition(text);
        if (c.collapsed) { text = c.text; filtered.push("repetition"); }
        else if (looksRepetitive(text)) { text = ""; filtered.push("repetition"); }
    }
    if (text.length > maxLen) { text = text.slice(0, maxLen); filtered.push("truncated"); }

    const out: TranscriptionResult = { text };
    if (filtered.length) out.filtered = filtered;
    if (raw && typeof raw === "object") {
        // Whisper's own decode verdicts, when a verbose backend reports them — either
        // summarized by the server or as raw per-segment fields.
        const segs: any[] = Array.isArray(raw.segments) ? raw.segments : [];
        const noSpeech = numOrUndefined(raw.noSpeechProb) ?? meanOf(segs.map((s) => s?.no_speech_prob ?? s?.noSpeechProb));
        const logprob = numOrUndefined(raw.avgLogprob) ?? meanOf(segs.map((s) => s?.avg_logprob ?? s?.avgLogprob));
        const ratios = segs.map((s) => numOrUndefined(s?.compression_ratio ?? s?.compressionRatio)).filter((v): v is number => v !== undefined);
        const ratio = numOrUndefined(raw.compressionRatio) ?? (ratios.length ? Math.max(...ratios) : undefined);
        if (noSpeech !== undefined) out.noSpeechProb = Math.max(0, Math.min(1, noSpeech));
        if (logprob !== undefined) out.avgLogprob = logprob;
        if (ratio !== undefined) out.compressionRatio = ratio;
        if (typeof raw.language === "string") out.language = raw.language.slice(0, 16);
        if (typeof raw.confidence === "number" && isFinite(raw.confidence)) {
            out.confidence = Math.max(0, Math.min(1, raw.confidence));
        }
        // Kept even when `text` ends up blank — especially then. An empty transcript
        // beside a duration of ~0 for a megabyte of audio is a decode failure; beside a
        // correct duration it is genuinely silence, or a model problem. Nothing else
        // downstream can tell those apart.
        const seconds = Number(raw.durationInSeconds ?? raw.duration);
        if (Number.isFinite(seconds) && seconds >= 0) out.durationInSeconds = seconds;
    }
    return out;
}

/**
 * The media type WITHOUT its parameters — `audio/webm;codecs=opus` → `audio/webm`.
 *
 * `MediaRecorder` is asked for `audio/webm;codecs=opus` because the browser needs the
 * codec to pick an encoder, and that full string becomes the recording Blob's `type`.
 * Sent as-is it becomes a multipart part's `Content-Type`, and upstreams that parse the
 * audio format out of that header reject the parameterised value verbatim —
 * `Unsupported file format webm;codecs=opus`, observed against gpt-4o-transcribe.
 *
 * The container is what an upstream needs to know; the codec is inside the file. So
 * recordings keep their codec-qualified type and only the OUTGOING label is stripped.
 */
export function bareMediaType(mediaType?: string | null): string {
    return String(mediaType || "").split(";")[0].trim() || "audio/webm";
}

/** The same blob relabelled with {@link bareMediaType}; returns it unchanged when already bare. */
export function bareTypeBlob(audio: Blob): Blob {
    const bare = bareMediaType(audio.type);
    return audio.type === bare ? audio : new Blob([audio], {type: bare});
}
