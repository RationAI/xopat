/**
 * Whether a transcribed segment is speech or noise.
 *
 * Two failure shapes, and they need different evidence. (Repetition loops are a third,
 * handled upstream at the driver boundary — see the note above `looksLikeSegmentNoise`.)
 *
 * **A near-empty transcript** — one or two characters, Whisper turning a cough or a click
 * into "어". Judged on length alone, counting Unicode letters/digits across any script so
 * CJK is handled fairly.
 *
 * **A whole segment that decoded to ONE short word.** Several seconds of speech in which
 * the recognizer found a single article. In per-segment dictation that becomes its own
 * chat message and its own transcript line, and a dictation review reads
 * `…and interstitial / the / there is no honeycomb / the` — observed, with roughly half
 * the dictated script missing around it.
 *
 * Spelling cannot judge the second one. "the", "yes" and "UIP" are all three letters, so
 * any length rule that rejects the first rejects the other two, and a pathologist's
 * one-word answer is exactly the kind of finding that must never be dropped. What
 * separates them is **how much voiced audio produced the word**, and a lone word is wrong
 * at BOTH extremes:
 *
 *   - **too much** — 9.5 s of speech yielding one article means the sentence was lost;
 *   - **too little** — 359 ms of voice inside a 10.8 s segment (3.3 %) means there was
 *     nothing there and the model filled the silence. Both shapes were observed in the
 *     same dictation, and the second is why the rule is a ratio and not a floor.
 *
 * A genuine short answer sits between them: brief audio that is mostly voice. So the rule
 * needs the capture's own measurement, and declines to judge when there is none — a guess
 * here costs findings.
 *
 * Rejecting is not discarding. The caller reports a rejected segment (`accepted: false`),
 * the extractor keeps it as "unclear speech" context, and its audio is still in the
 * archive for the whole-audio pass.
 */

/** Above this much voiced audio, a lone short word is a failed decode, not an answer. */
export const LONE_WORD_MAX_VOICED_MS = 1500;

/**
 * Below this share of the segment being voiced, a lone word is a silence hallucination.
 *
 * The other tail of the same rule. A segment of 10.8 s carrying 359 ms of voice — 3.3 % —
 * came back as "the": there was nothing there to transcribe, and the model filled the gap.
 * A real one-word answer occupies most of its (short) segment, so a ratio separates the
 * two where neither an absolute voiced floor nor the text can.
 */
export const LONE_WORD_MIN_VOICED_RATIO = 0.1;

/** Default floor for the near-empty check, when the caller configures none. */
import {words} from "./text-words";

export const DEFAULT_MIN_CAPTURE_CHARS = 2;

/**
 * A transcript of at most this many words backed by less than {@link FEW_WORDS_MIN_VOICED_MS}
 * of voice is the model filling silence, whatever the words are. This is the shape that
 * reached a confirmed report as "Thank you. Thank you." and "Hello.": two-word fillers over
 * 84–210 ms of "voice" in a 3–15 s segment. They arrive here only because the module's
 * voiced floor was bypassed — a probe, or the final flush at stop — so the gate has to hold
 * the same line the floor does.
 */
export const FEW_WORDS_MAX_TOKENS = 3;
export const FEW_WORDS_MIN_VOICED_MS = 400;

/**
 * Repetition loops are NOT handled here.
 *
 * `speech-to-text`'s `looksRepetitive` (drivers/driver.ts) already detects them, and it
 * runs inside `normalizeResult` — at the driver boundary, before the text reaches any
 * consumer, so it protects every caller rather than only this one. A second heuristic
 * here would be two thresholds to keep in step, drifting apart the first time either is
 * tuned.
 *
 * It missed the `L-Mass, L-Mass, … L-M-M-M-M-M…` loop for a tokenization reason (a
 * hyphen-joined mega-token counted as one word, staying under its length floor), which is
 * fixed there rather than worked around here.
 */

export interface SegmentNoiseEvidence {
    /** Detected voiced duration in the segment, in ms. */
    voicedMs?: number;
    /** Wall-clock length of the segment, silence included. */
    audioMs?: number;
    /**
     * From the first detected speech to the last, in ms — the segment minus its leading
     * and trailing silence. This is the denominator the ratio rule needs: the wall-clock
     * length always includes the trailing-silence window that CUT the segment (1.5 s by
     * default) plus whatever pause preceded the word, so "UIP" spoken after a 2.5 s think
     * scored 0.09 against wall time and was rejected as a hallucination.
     */
    speechSpanMs?: number;
    /** The trailing-silence window that ends a segment, in ms, when `speechSpanMs` is absent. */
    silenceMs?: number;
    /** False when the capture had no VAD clock — then `voicedMs` is absent, not zero. */
    tracked?: boolean;
    /**
     * Whisper's own silence verdict for the decode (`no_speech_prob`, 0..1), when the
     * backend reported one. Above {@link NO_SPEECH_PROB_REJECT} the model itself says
     * there was nothing to transcribe — no audio heuristic needed.
     */
    noSpeechProb?: number;
}

/** Whisper's own `no_speech_prob` above which a lone word is the model filling silence. */
export const NO_SPEECH_PROB_REJECT = 0.6;

export interface SegmentNoiseOptions {
    minCaptureChars?: number;
    /** Audio the text was decoded from; omit when the capture measured none. */
    metrics?: SegmentNoiseEvidence | null;
    loneWordMaxVoicedMs?: number;
    loneWordMinVoicedRatio?: number;
    /** Voiced floor for a ≤3-word transcript (see FEW_WORDS_MIN_VOICED_MS). */
    fewWordsMinVoicedMs?: number;
}

/**
 * True when this segment's transcript should not enter the conversation.
 * @param text the segment transcript, post text-filters
 */
export function looksLikeSegmentNoise(text: string, opts: SegmentNoiseOptions = {}): boolean {
    const t = String(text || "").trim();
    if (!t) return true;

    const letters = (t.match(/[\p{L}\p{N}]/gu) || []).length;
    if (letters < (opts.minCaptureChars ?? DEFAULT_MIN_CAPTURE_CHARS)) return true;

    const metrics = opts.metrics;
    // No VAD evidence ⇒ no basis to call a short word anything. Keep it.
    if (!metrics?.tracked) return false;

    // Words by the segmenter: a Japanese sentence is written without spaces, and a
    // whitespace split made every one of them a "lone word" over too much voice.
    const tokens = words(t);
    // A few words over (almost) no voice: the segment never carried enough speech for them.
    // A digit is exempt below for the same reason as the lone-word rule.
    const voicedForFew = Number(metrics.voicedMs);
    if (tokens.length <= FEW_WORDS_MAX_TOKENS && Number.isFinite(voicedForFew)
        && voicedForFew < (opts.fewWordsMinVoicedMs ?? FEW_WORDS_MIN_VOICED_MS)
        && !/[\p{N}]/u.test(t)) {
        return true;
    }
    if (tokens.length !== 1) return false;
    // A digit is a grade, a count or a level — never the residue of a lost sentence,
    // and never what a model invents over silence.
    if (/[\p{N}]/u.test(t)) return false;

    // The model's own verdict, when it gave one, outranks every audio heuristic below.
    const noSpeechProb = Number(metrics.noSpeechProb);
    if (Number.isFinite(noSpeechProb) && noSpeechProb >= NO_SPEECH_PROB_REJECT) return true;

    const voicedMs = Number(metrics.voicedMs);
    if (!Number.isFinite(voicedMs)) return false;

    // Too MUCH speech for one word: the sentence was lost.
    if (voicedMs > (opts.loneWordMaxVoicedMs ?? LONE_WORD_MAX_VOICED_MS)) return true;

    // Too LITTLE: the model filled a silence. Judged as a share of the segment's SPEECH
    // SPAN — not its wall-clock length, which always carries the trailing-silence window
    // that cut it and any pause before the word. An absolute floor cannot tell 400 ms
    // inside a 500 ms span (a real quick answer) from 400 ms spread thin across eleven
    // seconds of room tone (a hallucination).
    const span = Number(metrics.speechSpanMs);
    const audioMs = Number(metrics.audioMs);
    const silenceMs = Number(metrics.silenceMs);
    const denominator = Number.isFinite(span) && span > 0 ? span
        : Number.isFinite(audioMs) && audioMs > 0 ? Math.max(1, audioMs - (Number.isFinite(silenceMs) ? silenceMs : 0))
        : 0;
    if (denominator <= 0) return false;
    return (voicedMs / denominator) < (opts.loneWordMinVoicedRatio ?? LONE_WORD_MIN_VOICED_RATIO);
}
