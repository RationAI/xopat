/**
 * Word tokenization that does not assume spaces between words.
 *
 * Every text filter in this module used to split on whitespace or keep only `[a-z0-9]`,
 * which made a Japanese sentence one "word" with an empty key — and then blanked it as
 * prompt echo, or let a repetition loop through. `Intl.Segmenter` knows where words are
 * in scripts without spaces (dictionary-based for Japanese/Chinese/Thai in every current
 * browser and in Node's full ICU); where it is missing, runs of letters/digits are the
 * words, which is today's behaviour for English.
 *
 * Deliberately duplicated in the chat and mixture modules (`shared/text-words.ts`,
 * `text-words.mjs`): modules do not import each other.
 */

export interface WordSpan {
    /** The word as written. */
    text: string;
    /** Offset of the word in the source string. */
    index: number;
}

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const RUN_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/** True when the text contains Han, kana or Hangul — scripts written without spaces. */
export function hasCJK(text: string): boolean {
    return CJK_RE.test(String(text ?? ""));
}

const segmenters = new Map<string, any>();
function segmenter(lang?: string): any | null {
    const Seg = (globalThis as any).Intl?.Segmenter;
    if (typeof Seg !== "function") return null;
    const key = lang || "";
    if (segmenters.has(key)) return segmenters.get(key);
    let seg: any = null;
    try { seg = new Seg(lang || undefined, {granularity: "word"}); }
    catch (_e) { try { seg = new Seg(undefined, {granularity: "word"}); } catch (_e2) { seg = null; } }
    segmenters.set(key, seg);
    return seg;
}

/** Word-like segments with their offsets; punctuation and spaces are not words. */
export function wordSpans(text: string, lang?: string): WordSpan[] {
    const s = String(text ?? "");
    const out: WordSpan[] = [];
    const seg = segmenter(lang);
    if (seg) {
        for (const part of seg.segment(s)) {
            if (part.isWordLike) out.push({text: part.segment, index: part.index});
        }
        return out;
    }
    let m: RegExpExecArray | null;
    RUN_RE.lastIndex = 0;
    while ((m = RUN_RE.exec(s)) !== null) out.push({text: m[0], index: m.index});
    return out;
}

/** The words of `text`, in order. */
export function words(text: string, lang?: string): string[] {
    return wordSpans(text, lang).map((w) => w.text);
}

/** Comparison key: NFKC-folded, lower-case letters and digits only (full-width included). */
export function normalizeKey(text: string): string {
    return String(text ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
