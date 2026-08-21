/**
 * What a quiet microphone is allowed to mean.
 *
 * `captureHealth.ts` decides whether a capture that stopped producing level ticks is
 * broken or merely blind. Getting that backwards is expensive in both directions: a
 * false "dead" ends a dictation the user is still speaking into, and a false
 * "healthy" leaves them talking to a microphone that records nothing. The rule leans
 * on the fact that MediaRecorder and Web Audio fail independently — recorder bytes
 * are the ground truth, the level clock is not.
 *
 * The source is TypeScript; it is transpiled with the esbuild the repo already
 * depends on (same approach as modules/vercel-ai-chat-sdk/test/unit/voice-hold.test.mjs).
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

const tmp = mkdtempSync(path.join(tmpdir(), "xopat-capture-health-"));
const esbuild = require("esbuild");

const outfile = path.join(tmp, "captureHealth.mjs");
await esbuild.build({
    entryPoints: [path.join(moduleDir, "captureHealth.ts")],
    outfile,
    bundle: true,
    platform: "neutral",
    format: "esm",
    logLevel: "silent",
});
const { classifyCapture } = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const THRESHOLDS = { vadStallMs: 2000, dataStallMs: 8000 };

/** A capture with everything moving. */
const alive = (overrides = {}) => ({
    recording: true,
    contextState: "running",
    trackState: "live",
    trackMuted: false,
    msSinceVadTick: 50,
    msSinceRecorderData: 900,
    contextTimeAdvancing: true,
    ...overrides,
});

const verdict = (overrides) => classifyCapture(alive(overrides), THRESHOLDS);

test("everything moving is healthy", { tag: ["@unit"] }, () => {
    expect(verdict({})).toBe("healthy");
});

test("a stalled level clock over live audio degrades, it is never dead", { tag: ["@unit"] }, () => {
    // THE core assertion: recorder bytes are still landing, so the user's speech is
    // being captured. Only the VAD went blind — evidence has holes, capture does not.
    expect(verdict({ msSinceVadTick: 30_000, msSinceRecorderData: 900 })).toBe("vad-stalled");
});

test("a context that claims to run but whose clock is frozen is the same failure", { tag: ["@unit"] }, () => {
    // The render thread is gone. Same consequence for the consumer: degrade.
    expect(verdict({ contextTimeAdvancing: false })).toBe("vad-stalled");
});

test("a suspended context names its own cure", { tag: ["@unit"] }, () => {
    expect(verdict({ contextState: "suspended", msSinceVadTick: 30_000 })).toBe("context-suspended");
    expect(verdict({ contextState: "interrupted", msSinceVadTick: 30_000 })).toBe("context-suspended");
});

test("an ended or OS-muted track is a device loss, not a stall", { tag: ["@unit"] }, () => {
    // Reported ahead of everything else: no amount of resuming brings this back,
    // only a fresh getUserMedia.
    expect(verdict({ trackState: "ended" })).toBe("device-lost");
    expect(verdict({ trackMuted: true })).toBe("device-lost");
});

test("silence from the recorder itself is the only thing that means dead", { tag: ["@unit"] }, () => {
    expect(verdict({ msSinceRecorderData: 30_000 })).toBe("dead");
    // …and it outranks a suspended context, so a dead recorder is never mis-reported
    // as something a resume() would fix.
    expect(verdict({ msSinceRecorderData: 30_000, contextState: "suspended" })).toBe("dead");
    expect(verdict({ recording: false })).toBe("dead");
});

test("a subsystem that never reported is not evidence against the capture", { tag: ["@unit"] }, () => {
    // -1 means "never happened" (no archive configured, no VAD tick yet). Treating
    // that as an infinite gap would declare a just-started capture dead.
    expect(verdict({ msSinceRecorderData: -1, msSinceVadTick: -1 })).toBe("healthy");
});
