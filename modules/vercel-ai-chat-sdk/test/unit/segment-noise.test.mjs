/**
 * When a transcribed segment is noise, and — far more expensive to get wrong — when it
 * is a pathologist answering in one word.
 *
 * Continuous dictation submits each segment as its own message, so a segment that decoded
 * to a single article becomes its own transcript line. A recorded review read
 * `…and associated fibrosis and interstitial / the / there is no honeycomb / the`, with
 * roughly half the dictated script missing around it.
 *
 * The trap is that spelling cannot tell those lines from real ones: "the", "yes" and
 * "UIP" are all three letters. A length rule that drops the first drops the other two,
 * and dropping a spoken answer is worse than keeping a stray article. So the rule asks
 * the AUDIO instead — a second and a half of voice yielding one word means the sentence
 * was lost; a genuine short answer is short audio — and declines to judge at all when the
 * capture had no VAD clock to measure with.
 *
 * The source is TypeScript; it is transpiled with the esbuild the repo already depends on
 * (same approach as voice-hold.test.mjs).
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharedDir = path.join(fromRoot(), "modules", "vercel-ai-chat-sdk", "shared");

const tmp = mkdtempSync(path.join(tmpdir(), "xopat-segment-noise-"));
const esbuild = require("esbuild");

const outfile = path.join(tmp, "segment-noise.mjs");
await esbuild.build({
    entryPoints: [path.join(sharedDir, "segment-noise.ts")],
    outfile,
    bundle: true,
    platform: "neutral",
    format: "esm",
    logLevel: "silent",
});
const { looksLikeSegmentNoise, LONE_WORD_MAX_VOICED_MS } = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A segment in which the speaker talked for a while. */
const SPOKE = { tracked: true, voicedMs: LONE_WORD_MAX_VOICED_MS + 2000, audioMs: LONE_WORD_MAX_VOICED_MS + 3000 };
/** A short answer: a moment of voice, and the segment is mostly that voice. */
const BRIEF = { tracked: true, voicedMs: 400, audioMs: 700 };

/* ------------------------------------------------------ the failure being fixed */

test("@unit seconds of speech that decoded to one article is noise", () => {
    expect(looksLikeSegmentNoise("the", { metrics: SPOKE })).toBe(true);
    expect(looksLikeSegmentNoise("and", { metrics: SPOKE })).toBe(true);
    expect(looksLikeSegmentNoise("uh", { metrics: SPOKE })).toBe(true);
});

test("@unit a lone word invented over near-silence is noise too", () => {
    // Both verbatim from one recorded dictation. The first cleared the old 250 ms voiced
    // floor with 3.3 % of the segment being speech; the second is the end-of-session
    // flush segment, which bypasses that floor by design and arrives with no voice at all.
    expect(looksLikeSegmentNoise("the", { metrics: { tracked: true, voicedMs: 359, audioMs: 10851 } })).toBe(true);
    expect(looksLikeSegmentNoise("the", { metrics: { tracked: true, voicedMs: 0, audioMs: 441 } })).toBe(true);
});

test("@unit a short answer filling its own short segment survives", () => {
    // The discriminator is the RATIO, not the absolute voiced time: 400 ms inside 700 ms
    // is someone answering; 400 ms inside eleven seconds is a model filling a silence.
    expect(looksLikeSegmentNoise("yes", { metrics: { tracked: true, voicedMs: 400, audioMs: 700 } })).toBe(false);
    expect(looksLikeSegmentNoise("yes", { metrics: { tracked: true, voicedMs: 400, audioMs: 11000 } })).toBe(true);
});

test("@unit with no audioMs the ratio half of the rule cannot fire", () => {
    // The RATIO needs a denominator; the voiced floor for a few words does not — 100 ms of
    // measured voice is evidence, and one word over it is the model filling silence.
    expect(looksLikeSegmentNoise("the", { metrics: { tracked: true, voicedMs: 100 } })).toBe(true);
    expect(looksLikeSegmentNoise("the", { metrics: { tracked: true, voicedMs: 600 } })).toBe(false);
    expect(looksLikeSegmentNoise("the", { metrics: { tracked: true, voicedMs: 9000 } })).toBe(true);
});

/* ------------------------------------------- what must survive it, at all costs */

test("@unit a one-word answer is speech, because it is SHORT audio", () => {
    for (const word of ["yes", "no", "UIP", "mild", "marked", "absent"]) {
        expect(looksLikeSegmentNoise(word, { metrics: BRIEF })).toBe(false);
    }
});

test("@unit a lone token carrying a digit is never noise", () => {
    // A grade or a level, and the exact thing a corrector was caught deleting.
    expect(looksLikeSegmentNoise("2.5", { metrics: SPOKE })).toBe(false);
    expect(looksLikeSegmentNoise("12", { metrics: SPOKE })).toBe(false);
});

test("@unit a SINGLE character is still caught by the older near-empty floor", () => {
    // Pinned as prior behaviour, not as a consequence of the lone-word rule: one
    // alphanumeric character has never cleared `minCaptureChars` (default 2), so a bare
    // "2" is dropped before the digit exemption is ever consulted. Graded findings are
    // spoken as "2 plus" / "grade 2" and reach the transcript as two tokens.
    expect(looksLikeSegmentNoise("2", { metrics: BRIEF })).toBe(true);
    expect(looksLikeSegmentNoise("2 plus", { metrics: BRIEF })).toBe(false);
    expect(looksLikeSegmentNoise("grade 2", { metrics: SPOKE })).toBe(false);
});

test("@unit more than one word is dictation regardless of how long it took", () => {
    expect(looksLikeSegmentNoise("2 plus", { metrics: SPOKE })).toBe(false);
    expect(looksLikeSegmentNoise("no honeycomb", { metrics: SPOKE })).toBe(false);
    expect(looksLikeSegmentNoise("the denudation of the alveolar lining", { metrics: SPOKE })).toBe(false);
});

test("@unit without VAD evidence the rule declines to judge", () => {
    // Guessing here costs findings, so an unmeasured capture keeps its text.
    expect(looksLikeSegmentNoise("the", { metrics: { tracked: false, voicedMs: 9999 } })).toBe(false);
    expect(looksLikeSegmentNoise("the", {})).toBe(false);
    expect(looksLikeSegmentNoise("the", { metrics: { tracked: true } })).toBe(false);
});

test("@unit the boundary is exclusive, so a segment exactly at the bound is kept", () => {
    expect(looksLikeSegmentNoise("the", { metrics: { tracked: true, voicedMs: LONE_WORD_MAX_VOICED_MS } })).toBe(false);
    expect(looksLikeSegmentNoise("the", { metrics: { tracked: true, voicedMs: LONE_WORD_MAX_VOICED_MS + 1 } })).toBe(true);
});

/* ------------------------------------------------- the original near-empty rule */

test("@unit a near-empty transcript is noise on length alone", () => {
    expect(looksLikeSegmentNoise("", { metrics: BRIEF })).toBe(true);
    expect(looksLikeSegmentNoise("   ", { metrics: BRIEF })).toBe(true);
    expect(looksLikeSegmentNoise("어", { metrics: BRIEF })).toBe(true);
    expect(looksLikeSegmentNoise(".", { metrics: BRIEF })).toBe(true);
});

test("@unit letters are counted across scripts", () => {
    // Two CJK characters clear the floor exactly as two Latin ones do.
    expect(looksLikeSegmentNoise("네네", { metrics: BRIEF })).toBe(false);
});

test("@unit minCaptureChars still governs the near-empty rule", () => {
    expect(looksLikeSegmentNoise("ok", { minCaptureChars: 3, metrics: BRIEF })).toBe(true);
    expect(looksLikeSegmentNoise("ok", { minCaptureChars: 2, metrics: BRIEF })).toBe(false);
});

// ---- the denominator is the speech span, not the recorder's wall clock ----
//
// Wall time always carries the trailing-silence window that CUT the segment (1.5 s) plus
// whatever pause preceded the word. "UIP" after a 2.5 s think: 400 ms voiced in a 4.4 s
// recorder = 0.09, and the ratio rule rejected a diagnosis as a hallucination.

test("@unit a short answer after a pause is kept when the speech span is known", () => {
    expect(looksLikeSegmentNoise("UIP", {
        metrics: { tracked: true, voicedMs: 400, audioMs: 4400, speechSpanMs: 420, silenceMs: 1500 },
    })).toBe(false);
});

test("@unit without a span, the trailing-silence window is at least discounted", () => {
    // 400 ms voiced; 4400 ms wall; 1500 ms of that is the cut window → 400 / 2900 = 0.14.
    expect(looksLikeSegmentNoise("UIP", {
        metrics: { tracked: true, voicedMs: 400, audioMs: 4400, silenceMs: 1500 },
    })).toBe(false);
});

test("@unit a word spread thin across a long segment is still a hallucination", () => {
    // 359 ms voiced across a 10.8 s segment whose speech span is most of it.
    expect(looksLikeSegmentNoise("the", {
        metrics: { tracked: true, voicedMs: 359, audioMs: 10800, speechSpanMs: 9000, silenceMs: 1500 },
    })).toBe(true);
});

test("@unit Whisper's own no_speech_prob outranks the audio heuristics", () => {
    // Plenty of "voice" by the amplitude meter, but the model says it heard silence.
    expect(looksLikeSegmentNoise("The", {
        metrics: { tracked: true, voicedMs: 1200, audioMs: 8000, speechSpanMs: 1200, noSpeechProb: 0.91 },
    })).toBe(true);
    // And a confident decode of a real one-word answer is kept.
    expect(looksLikeSegmentNoise("Yes", {
        metrics: { tracked: true, voicedMs: 500, audioMs: 2000, speechSpanMs: 500, noSpeechProb: 0.05 },
    })).toBe(false);
});

// ---- a few words over no voice ----
//
// Observed reaching a confirmed report: "Thank you." over 84 ms of voice (the flush segment),
// "Thank you." over 149 ms (a probe — which then flipped the session fail-open), "Hello." over
// 210 ms of a 15 s segment. Two-word fillers slip past the lone-word rule; the voiced floor has
// to hold here too, because probe and flush segments bypass the module's.

test("@unit a two-word filler over almost no voice is noise", () => {
    expect(looksLikeSegmentNoise("Thank you.", { metrics: { tracked: true, voicedMs: 84, audioMs: 2612, speechSpanMs: 1460 } })).toBe(true);
    expect(looksLikeSegmentNoise("Hello.", { metrics: { tracked: true, voicedMs: 210, audioMs: 15053, speechSpanMs: 210 } })).toBe(true);
    expect(looksLikeSegmentNoise("Okay, thank you", { metrics: { tracked: true, voicedMs: 149, audioMs: 8411, speechSpanMs: 310 } })).toBe(true);
});

test("@unit a short answer with real voice behind it is kept", () => {
    expect(looksLikeSegmentNoise("Not UIP.", { metrics: { tracked: true, voicedMs: 700, audioMs: 3000, speechSpanMs: 800 } })).toBe(false);
    expect(looksLikeSegmentNoise("Grade 2", { metrics: { tracked: true, voicedMs: 300, audioMs: 2000, speechSpanMs: 400 } })).toBe(false);
});

// ---- scripts without spaces --------------------------------------------------------

test("@unit a Japanese sentence over seconds of voice is speech, not a lone word", () => {
    // A whitespace split saw one token and rejected every sentence longer than 1.5 s.
    const text = "間質性肺炎です。蜂巣肺はありません。肉芽腫はありません。";
    expect(looksLikeSegmentNoise(text, {
        metrics: { tracked: true, voicedMs: 6000, audioMs: 8000, speechSpanMs: 6500, silenceMs: 1500 },
    })).toBe(false);
});

test("@unit a lone Japanese word still follows the lone-word rules", () => {
    expect(looksLikeSegmentNoise("はい", {
        metrics: { tracked: true, voicedMs: LONE_WORD_MAX_VOICED_MS + 1000, audioMs: 9000, speechSpanMs: 7000 },
    })).toBe(true);
});
