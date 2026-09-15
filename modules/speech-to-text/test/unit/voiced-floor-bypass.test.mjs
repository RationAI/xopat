/**
 * Which segments may skip the voiced-content floor and reach a driver.
 *
 * The floor exists so audio the VAD barely heard never leaves the browser — no egress, no
 * hallucination. Three kinds of segment are allowed past it because the VAD's verdict is
 * suspect or overridden: a probe, a fail-open session, and the capture's final flush.
 *
 * The flush bypass cost a dictation its integrity once the rolling context prompt was
 * enabled. The last segment of a 09-14 session carried `voicedMs: 0` and `maxPeak: 0.06` —
 * silence by both the Silero verdict and the meter — went out with a 153-character context
 * tail as its prompt, and came back with a tidied rewrite of that tail:
 *
 *     "Forceps biopsy was not used. It shows subpleural … UIP area is 2+."
 *
 * Three sentences the pathologist had already dictated, appended to the transcript a
 * second time. The prompt-echo stripper could not catch it because it matches text and
 * this was a paraphrase. So a flush with no voiced audio at all is no longer a bypass —
 * and a flush with any voiced audio still is, because that is speech a manual stop must
 * not cut off.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const moduleDir = path.join(fromRoot(), "modules", "speech-to-text");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-voiced-floor-"));

const outfile = path.join(tmp, "speechGate.mjs");
await esbuild.build({
    entryPoints: [path.join(moduleDir, "speechGate.ts")],
    outfile, bundle: true, platform: "neutral", format: "esm", logLevel: "silent",
});
const { bypassesVoicedFloor } = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test("@unit an ordinary segment is judged by the floor", () => {
    expect(bypassesVoicedFloor({ tracked: true, voicedMs: 0 })).toBe(false);
    expect(bypassesVoicedFloor({ tracked: true, voicedMs: 5000 })).toBe(false);
    expect(bypassesVoicedFloor(null)).toBe(false);
    expect(bypassesVoicedFloor(undefined)).toBe(false);
});

test("@unit a probe or a fail-open session goes through whatever the VAD said", () => {
    expect(bypassesVoicedFloor({ probe: true, tracked: true, voicedMs: 0 })).toBe(true);
    expect(bypassesVoicedFloor({ failOpen: true, tracked: true, voicedMs: 0 })).toBe(true);
});

test("@unit the 09-14 flush segment — silence with a prompt — no longer goes out", () => {
    expect(bypassesVoicedFloor({ flush: true, tracked: true, voicedMs: 0, maxPeak: 0.0605 })).toBe(false);
});

test("@unit a flush carrying speech still bypasses the threshold", () => {
    // The whole point of the flush: a manual stop must not lose the trailing utterance,
    // even when it is below the floor a steady speaker would clear.
    expect(bypassesVoicedFloor({ flush: true, tracked: true, voicedMs: 120 })).toBe(true);
    expect(bypassesVoicedFloor({ flush: true, tracked: true, voicedMs: 4000 })).toBe(true);
});

test("@unit an untracked flush has no verdict to second-guess", () => {
    // No VAD evidence at all (an engine that never loaded): the text filters judge it,
    // exactly as before.
    expect(bypassesVoicedFloor({ flush: true, tracked: false, voicedMs: 0 })).toBe(true);
    expect(bypassesVoicedFloor({ flush: true })).toBe(true);
});
