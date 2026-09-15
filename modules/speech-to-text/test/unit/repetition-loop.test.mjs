/**
 * Catching a decoder that got stuck, without catching a pathologist who repeats themselves.
 *
 * Whisper-family decoders degenerate: they lock onto a token and emit it until the audio
 * runs out. `looksRepetitive` has guarded against that from the start, and
 * `normalizeResult` blanks such a transcript at the driver boundary so no consumer ever
 * sees it.
 *
 * It missed this, verbatim from a pathology dictation:
 *
 *     "Las Matalum, L-Mass, L-Mass, L-Mass, … L-M-M-M-M-M-M-M-M-M-M-M…"
 *
 * for a tokenization reason rather than a threshold one. The word regex counts `-` as a
 * word character — correctly, for "two-year-old" and "airway-centered" — so the whole
 * `L-M-M-M-…-M` tail collapsed into ONE token. That single mega-token kept the count at 9
 * words (under the 12-word floor, immediate pass) and lifted the unique-word ratio to
 * 0.44, comfortably above the 0.35 threshold. A 60-token loop scored as clean speech and
 * was appended to a report transcript.
 *
 * The fix splits a token built from one or two distinct letters back into its parts. These
 * pin both directions, because a repetition guard that eats real dictation is worse than
 * no guard at all.
 *
 * The source is TypeScript; it is transpiled with the esbuild the repo already depends on
 * (same approach as capture-health.test.mjs).
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const moduleDir = path.join(fromRoot(), "modules", "speech-to-text");

const tmp = mkdtempSync(path.join(tmpdir(), "xopat-repetition-loop-"));
const esbuild = require("esbuild");

const outfile = path.join(tmp, "driver.mjs");
await esbuild.build({
    entryPoints: [path.join(moduleDir, "drivers", "driver.ts")],
    outfile,
    bundle: true,
    platform: "neutral",
    format: "esm",
    logLevel: "silent",
});
const { looksRepetitive, collapseRepetition, normalizeResult, bareMediaType, bareTypeBlob } =
    await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Verbatim from the failing session. */
const LOOP = "Las Matalum, L-Mass, L-Mass, L-Mass, L-Mass, L-Mass, L-Mass, "
    + "L-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M-M";

test("@unit the hyphen-joined degeneration is caught", () => {
    expect(looksRepetitive(LOOP)).toBe(true);
});

test("@unit and normalizeResult blanks it, so no consumer sees it", () => {
    // Blanking at the driver boundary is what makes this protect every caller rather than
    // whichever one remembered to check.
    expect(normalizeResult({ text: LOOP }).text).toBe("");
});

test("@unit hyphenated medical vocabulary is not a loop", () => {
    // The regression this fix could plausibly cause, so it is pinned explicitly.
    expect(looksRepetitive("the two-year-old had a non-necrotizing granuloma and a t-cell "
        + "rich infiltrate with x-ray correlation and clinical follow-up planned")).toBe(false);
    expect(looksRepetitive("Transbronchial biopsies, adequate. Cellular interstitial pneumonia, "
        + "diffuse distribution with airway-centered bronchiolocentric accentuation.")).toBe(false);
});

test("@unit a pathologist repeating an intensity is not a loop", () => {
    // Also verbatim from a real session, and a real finding.
    expect(looksRepetitive("No dense fibrosis, no honeycombing, no fibroblastic foci, not UIP, "
        + "findings are typical for chronic hypersensitivity pneumonitis overall.")).toBe(false);
    expect(normalizeResult({ text: "moderate moderate moderate moderate, microscopic honeycomb" }).text)
        .toContain("honeycomb");
});

test("@unit short transcripts are never flagged", () => {
    // The floor exists to protect real speech; a one-word answer must always survive.
    expect(looksRepetitive("yes")).toBe(false);
    expect(looksRepetitive("no no thanks")).toBe(false);
    expect(looksRepetitive("")).toBe(false);
});

/* ------------------------------------------------- the outgoing media type */

test("@unit the codec parameter is stripped from the outgoing media type", () => {
    // `MediaRecorder` needs `;codecs=opus` to pick an encoder, but sending it as the file
    // part's Content-Type made gpt-4o-transcribe reject the upload outright:
    // "Unsupported file format webm;codecs=opus".
    expect(bareMediaType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(bareMediaType("audio/ogg; codecs=opus")).toBe("audio/ogg");
    expect(bareMediaType("audio/webm")).toBe("audio/webm");
    expect(bareMediaType("")).toBe("audio/webm");
    expect(bareMediaType(undefined)).toBe("audio/webm");
});

/* ------------------------------------------- the backend's measured duration */

test("@unit the backend's reported duration survives normalizeResult", () => {
    // The diagnostic for "did this upload decode at all". A megabyte of audio measured
    // back as ~0 s never decoded; the same megabyte measured at its true length means the
    // audio arrived intact and the emptiness came from somewhere else. Nothing downstream
    // can distinguish those two without this number.
    expect(normalizeResult({ text: "hello there", duration: 12.5 }).durationInSeconds).toBe(12.5);
    expect(normalizeResult({ text: "hello there", durationInSeconds: 3 }).durationInSeconds).toBe(3);
});

test("@unit it survives even when the transcript came back EMPTY", () => {
    // Especially then — an empty transcript is exactly when the duration decides whether
    // the file was silent or simply never decoded.
    const out = normalizeResult({ text: "", duration: 0 });
    expect(out.text).toBe("");
    expect(out.durationInSeconds).toBe(0);
});

test("@unit a missing or nonsense duration is simply absent", () => {
    expect(normalizeResult({ text: "hi there friend" }).durationInSeconds).toBe(undefined);
    expect(normalizeResult({ text: "hi there friend", duration: "abc" }).durationInSeconds).toBe(undefined);
    expect(normalizeResult({ text: "hi there friend", duration: -5 }).durationInSeconds).toBe(undefined);
});

test("@unit an already-bare blob is passed through untouched", () => {
    const bare = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    expect(bareTypeBlob(bare)).toBe(bare);

    const tagged = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm;codecs=opus" });
    const out = bareTypeBlob(tagged);
    expect(out.type).toBe("audio/webm");
    expect(out.size).toBe(tagged.size);
});

// ---- collapsing instead of blanking ----
//
// A stuck decoder emits its loop AFTER whatever it decoded correctly. Blanking the whole
// result for the loop threw away the sentence in front of it — for a 90 s archive window,
// a minute and a half of dictation lost to a defect in its last five seconds.

test("@unit a loop after real speech is collapsed, the speech is kept", () => {
    const text = "Cellular interstitial infiltrate of lymphocytes and plasma cells, " +
        "no honeycomb, no honeycomb, no honeycomb, no honeycomb, no honeycomb, no honeycomb";
    const out = normalizeResult({ text });
    expect(out.text).toBe("Cellular interstitial infiltrate of lymphocytes and plasma cells, no honeycomb,");
    expect(out.filtered).toEqual(["repetition"]);
});

test("@unit a spelled-out mega-token loop is dropped and the words before it survive", () => {
    const out = normalizeResult({ text: "Cellular infiltrate of lymphocytes, " + LOOP });
    expect(out.text).toBe("Cellular infiltrate of lymphocytes, Las Matalum, L-Mass,");
    expect(out.filtered).toContain("repetition");
});

test("@unit a result that was nothing but loop is still empty", () => {
    expect(collapseRepetition(LOOP).text).toBe("");
    expect(normalizeResult({ text: "negative, ".repeat(12).trim() }).text).toBe("");
});

test("@unit ordinary dictation is returned verbatim with no `filtered` mark", () => {
    const text = "No dense fibrosis, no honeycombing, no fibroblastic foci, not UIP, " +
        "findings are typical for chronic hypersensitivity pneumonitis.";
    const out = normalizeResult({ text });
    expect(out.text).toBe(text);
    expect(out.filtered).toBe(undefined);
    expect(collapseRepetition(text).collapsed).toBe(false);
});

test("@unit a long ordinary transcript is not a loop on statistics alone", () => {
    // Type-token ratio falls with length; a 400-word transcript of a 40-word vocabulary
    // used to be blanked as a "loop" by the unique-ratio rule.
    const vocab = ("the of and in with no mild moderate chronic interstitial infiltrate " +
        "lymphocytes plasma cells fibrosis honeycomb granuloma bronchiolitis foci " +
        "organizing pneumonia diffuse patchy peribronchiolar metaplasia giant multinucleated " +
        "airway centred accentuation findings typical hypersensitivity pneumonitis exposure " +
        "removed prognosis favourable stable biopsy adequate cellular").split(" ");
    const words = [];
    for (let i = 0; i < 400; i++) words.push(vocab[(i * 7 + (i % 5)) % vocab.length]);
    const text = words.join(" ");
    expect(looksRepetitive(text)).toBe(false);
    expect(normalizeResult({ text }).text).toBe(text);
});

// ---- Whisper's own verdicts ----

test("@unit verbose_json verdicts are carried through normalizeResult", () => {
    const out = normalizeResult({
        text: "The",
        segments: [
            { text: "The", no_speech_prob: 0.92, avg_logprob: -1.4, compression_ratio: 0.6 },
        ],
    });
    expect(out.noSpeechProb).toBeCloseTo(0.92, 5);
    expect(out.avgLogprob).toBeCloseTo(-1.4, 5);
    expect(out.compressionRatio).toBeCloseTo(0.6, 5);
});

test("@unit server-summarized verdicts win over per-segment fields", () => {
    const out = normalizeResult({ text: "hello there friend", noSpeechProb: 0.1, avgLogprob: -0.2, compressionRatio: 1.1,
        segments: [{ text: "hello", no_speech_prob: 0.9 }] });
    expect(out.noSpeechProb).toBeCloseTo(0.1, 5);
});

test("@unit a null verdict from the backend is absent, not zero", () => {
    // The deployment's endpoint reports `no_speech_prob: null`; coerced to 0 it would read
    // as "certainly speech" and silence every audio heuristic downstream.
    const out = normalizeResult({ text: "The", segments: [{ text: "The", no_speech_prob: null, avg_logprob: null, compression_ratio: null }] });
    expect(out.noSpeechProb).toBe(undefined);
    expect(out.avgLogprob).toBe(undefined);
    expect(out.compressionRatio).toBe(undefined);
    expect(normalizeResult({ text: "hi there friend", noSpeechProb: null }).noSpeechProb).toBe(undefined);
});

test("@unit Whisper's short silence fillers are blanked as whole transcripts only", () => {
    expect(normalizeResult({ text: "Thank you." }).text).toBe("");
    expect(normalizeResult({ text: "Hello." }).text).toBe("");
    expect(normalizeResult({ text: "Thank you very much." }).text).toBe("");
    // Inside a sentence they stay; clinical one-word answers are not fillers.
    expect(normalizeResult({ text: "Thank you, that concludes the findings." }).text).toBe("Thank you, that concludes the findings.");
    expect(normalizeResult({ text: "yes" }).text).toBe("yes");
    expect(normalizeResult({ text: "No." }).text).toBe("No.");
});

// ---- scripts without spaces --------------------------------------------------------

test("@unit Whisper's Japanese subtitle filler is blanked like its English one", () => {
    expect(normalizeResult({ text: "ご視聴ありがとうございました。" }).text).toBe("");
    expect(normalizeResult({ text: "（拍手）" }).text).toBe("");
});

test("@unit a Japanese repetition loop is caught; a normal sentence is not", () => {
    const loop = Array.from({ length: 30 }, () => "間質性肺炎です").join("");
    expect(looksRepetitive(loop)).toBe(true);
    expect(looksRepetitive("間質性肺炎です。蜂巣肺はありません。肉芽腫はありません。線維化は軽度です。")).toBe(false);
    // collapseRepetition leaves scripts without spaces alone (it would re-space them).
    const kept = "間質性肺炎です。蜂巣肺はありません。";
    expect(collapseRepetition(kept)).toEqual({ text: kept, collapsed: false });
});

// ---- subtitle / translation credits ---------------------------------------------

test("@unit a bare subtitle credit in any language is non-speech", () => {
    for (const s of [
        "Titulky vytvořil JohnyX.",
        "Titulky: JohnyX",
        "Překlad: Karel Novák.",
        "Untertitel im Auftrag des ZDF, 2020",
        "Sous-titres réalisés par la communauté d'Amara.org",
        "Subtítulos realizados por la comunidad de Amara.org",
        "Legendas pela comunidade Amara.org",
        "Napisy stworzone przez społeczność Amara.org",
        "Subtitles by the Amara.org community",
        "Transcribed by ESO, translated by —",
        "字幕 by Amara.org",
        "www.zeoranger.co.uk",
    ]) {
        expect(normalizeResult({ text: s }).text).toBe("");
    }
});

test("@unit a sentence that merely mentions subtitles is kept", () => {
    for (const s of [
        "Titulky nejsou součástí nálezu, pokračujeme s popisem.",
        "The subtitles of the slide scan were unreadable, but the tissue is adequate.",
        "Překladová tabulka kódů byla doplněna do zprávy včera odpoledne.",
    ]) {
        expect(normalizeResult({ text: s }).text).toBe(s);
    }
});
