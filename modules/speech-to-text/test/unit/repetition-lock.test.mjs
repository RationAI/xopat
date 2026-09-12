/**
 * When a recognizer repeating itself is a bug, and what may be thrown away because of it.
 *
 * Continuous dictation feeds each segment the tail of the transcript so far as its biasing
 * prompt. That is a feedback path, and a prompt-obedient model (whisper-large-v3, in the
 * 9-10 reporting round) can lock onto its own last words: one 450 s dictation came back as
 * "I'm not the" for ten consecutive segments, while the whole-audio pass over the SAME
 * audio read as ordinary speech.
 *
 * `repetitionLock.ts` decides two separate things, and the asymmetry is the point — muting
 * the context costs accuracy on one segment, dropping a segment costs speech. Both
 * directions are asserted here: a lock must actually break, and a speaker who repeats
 * themselves must not be silenced.
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

const tmp = mkdtempSync(path.join(tmpdir(), "xopat-repetition-lock-"));
const esbuild = require("esbuild");

const outfile = path.join(tmp, "repetitionLock.mjs");
await esbuild.build({
    entryPoints: [path.join(moduleDir, "repetitionLock.ts")],
    outfile,
    bundle: true,
    platform: "neutral",
    format: "esm",
    logLevel: "silent",
});
const { createRepetitionLock, isContextEcho, repetitionKey } = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** The observed lock: the phrase is short, and it sits at the end of the tail it was fed. */
const LOCKED = "I'm not the";
const TAIL = "IPF and I'm not the I'm not the";

test("@unit a first utterance is never a repeat", () => {
    const lock = createRepetitionLock();
    const v = lock.note("the basic pattern is fibrotic IP", "");
    expect(v.drop).toBe(false);
    expect(v.locked).toBe(false);
    expect(lock.muted).toBe(false);
});

test("@unit a repeat that echoes its own context tail is dropped, and the tail is muted", () => {
    const lock = createRepetitionLock();
    expect(lock.note(LOCKED, TAIL).drop).toBe(false);          // first instance always survives

    const second = lock.note(LOCKED, TAIL);
    expect(second.drop).toBe(true);
    expect(second.locked).toBe(true);                          // reported once, on the transition
    expect(lock.muted).toBe(true);                             // next segment decoded unbiased
});

test("@unit a long lock reports once, not once per segment", () => {
    const lock = createRepetitionLock();
    lock.note(LOCKED, TAIL);
    const verdicts = Array.from({ length: 8 }, () => lock.note(LOCKED, TAIL));
    expect(verdicts.filter((v) => v.locked).length).toBe(1);
});

test("@unit muting is what breaks the loop: with no tail, nothing is called an echo", () => {
    const lock = createRepetitionLock();
    lock.note(LOCKED, TAIL);
    expect(lock.note(LOCKED, TAIL).drop).toBe(true);
    // Muted now, so the driver was given no context tail — an unbiased decoder still
    // emitting this is reporting what it heard, and the text must survive.
    expect(lock.note(LOCKED, "").drop).toBe(false);
    expect(lock.muted).toBe(true);
});

test("@unit a speaker genuinely repeating themselves keeps their words", () => {
    const lock = createRepetitionLock();
    // Nothing in the tail to copy from: this is speech, not an echo.
    expect(lock.note("moderate", "the dense fibrosis is").drop).toBe(false);
    expect(lock.note("moderate", "the dense fibrosis is").drop).toBe(false);
});

test("@unit output moving on restores the context tail", () => {
    const lock = createRepetitionLock();
    lock.note(LOCKED, TAIL);
    lock.note(LOCKED, TAIL);
    expect(lock.muted).toBe(true);

    const v = lock.note("yeah so this is a dense fibrosis", "");
    expect(v.drop).toBe(false);
    expect(v.muteContext).toBe(false);
    expect(lock.muted).toBe(false);
});

test("@unit repetition is judged past case, punctuation and spacing", () => {
    expect(repetitionKey("I'm not the")).toBe(repetitionKey("  i'm  NOT, the.  "));
    const lock = createRepetitionLock();
    lock.note("I'm not the", TAIL);
    expect(lock.note("i'm not the.", TAIL).drop).toBe(true);
});

test("@unit the echo test needs both a tail and text", () => {
    expect(isContextEcho(LOCKED, TAIL)).toBe(true);
    expect(isContextEcho(LOCKED, "")).toBe(false);
    expect(isContextEcho("", TAIL)).toBe(false);
    expect(isContextEcho("a finding never said before", TAIL)).toBe(false);
});
