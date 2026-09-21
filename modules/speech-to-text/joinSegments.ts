/**
 * Join consecutive segment transcripts without repeating the seam.
 *
 * Segment recorders deliberately overlap: the successor starts before the predecessor is
 * stopped, so no speech falls into the gap. The price is that the last timeslice of one
 * recording is also the first of the next, and a recognizer that hears the same words in
 * both blobs transcribes them twice — `…mild peribronchiolar metaplasia,` +
 * `metaplasia, no dense fibrosis…` reads as a stutter in the transcript and, worse, as a
 * repeated finding to an extractor.
 *
 * Pure so the rule is pinned by tests: what may be removed from a medical transcript must
 * not drift.
 */

import {wordSpans, words} from "./textWords";

const WORD_RE = /[\p{L}\p{N}]+/gu;

/** Lower-cased alphanumeric core of a token; "" for punctuation-only tokens. */
function key(token: string): string {
    return (token.match(WORD_RE) || []).join("").toLowerCase();
}

export interface TrimResult {
    /** `next` with the repeated head removed (possibly unchanged, possibly empty). */
    text: string;
    /** How many words were cut from the head of `next`; 0 when nothing matched. */
    trimmedWords: number;
}

/** Longest seam considered, in words — a boundary overlap is a second or so of speech. */
const MAX_SEAM_WORDS = 6;
/** Below this overlap a one-word match is coincidence ("no … no"), not a shared second. */
const ONE_WORD_MIN_OVERLAP_MS = 300;
/** A one-word seam must be a real word, not a function word, to count. */
const ONE_WORD_MIN_CHARS = 4;

/**
 * Remove from the head of `next` the words that repeat the tail of `prev`.
 *
 * A seam of two or more words is trusted on its own; a single repeated word only when the
 * recordings did overlap (`overlapMs`) and the word is substantial. Punctuation attached to
 * the removed words goes with them; the remainder is trimmed of leading separators.
 */
export function trimOverlap(prev: string, next: string, overlapMs: number = 0): TrimResult {
    const nextText = String(next || "").trim();
    // Words by the segmenter (offsets kept), so a script without spaces is compared word
    // by word and cut at a word — a whitespace split made a Japanese segment one token.
    const nextSpans = wordSpans(nextText);
    const prevTokens = words(String(prev || "").trim());
    const nextTokens = nextSpans.map((w) => w.text);
    if (!nextTokens.length || !prevTokens.length) return {text: nextText, trimmedWords: 0};

    const tail = prevTokens.slice(-MAX_SEAM_WORDS).map(key);
    const head = nextTokens.slice(0, MAX_SEAM_WORDS).map(key);
    let best = 0;
    for (let k = Math.min(tail.length, head.length); k >= 1; k--) {
        let same = true;
        for (let i = 0; i < k; i++) {
            const a = tail[tail.length - k + i];
            const b = head[i];
            if (!a || !b || a !== b) { same = false; break; }
        }
        if (same) { best = k; break; }
    }
    if (best === 1) {
        const word = head[0] || "";
        if (overlapMs < ONE_WORD_MIN_OVERLAP_MS || word.length < ONE_WORD_MIN_CHARS) best = 0;
    }
    const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
    if (!best) return {text: collapse(nextText), trimmedWords: 0};
    // Cut the ORIGINAL text at the first kept word, so spacing and script survive.
    const cutAt = best < nextSpans.length ? nextSpans[best]!.index : nextText.length;
    const rest = collapse(nextText.slice(cutAt).replace(/^[\s,;:.\-–—、。]+/u, ""));
    return {text: rest, trimmedWords: best};
}
