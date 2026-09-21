/**
 * Word tokenization that does not assume spaces between words.
 *
 * The segment-noise gate counted words by splitting on whitespace, which made every
 * Japanese sentence a single "lone word" over too much voice — and rejected it. With
 * `Intl.Segmenter` (dictionary-based for Japanese/Chinese/Thai in every current browser
 * and in Node's full ICU) a sentence has as many words as it has; where the API is
 * missing, runs of letters/digits are the words, which is today's behaviour for English.
 *
 * Deliberately duplicated in the speech-to-text and mixture modules: modules do not
 * import each other.
 */

export interface WordSpan {
    text: string;
    index: number;
}

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const RUN_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

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

export function words(text: string, lang?: string): string[] {
    return wordSpans(text, lang).map((w) => w.text);
}

export function normalizeKey(text: string): string {
    return String(text ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
