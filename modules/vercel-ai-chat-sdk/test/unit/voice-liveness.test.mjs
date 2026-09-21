/**
 * When a quiet microphone is allowed to end a dictation.
 *
 * The hands-free watchdog compares "now" against the last capture heartbeat, and
 * used to end the session the moment that gap exceeded its budget. That rule cannot
 * tell a dead microphone from a watchdog that simply did not run — and during report
 * dictation, where an extraction pass fires roughly once a second and grows with the
 * transcript, the main thread stalls long enough to look identical. Perfectly
 * healthy dictations were killed; raising the threshold to 45 s "fixed" it, which is
 * the proof that capture was never the problem.
 *
 * `shared/voice-liveness.ts` is the decision layer that separates the two, and the
 * expensive mistakes are symmetrical: exonerate too much and a genuinely dead
 * microphone is never reported, exonerate too little and the user loses their words.
 *
 * The source is TypeScript; it is transpiled with the esbuild the repo already
 * depends on (same approach as test/unit/voice-hold.test.mjs).
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

const tmp = mkdtempSync(path.join(tmpdir(), "xopat-voice-liveness-"));
const esbuild = require("esbuild");

async function loadShared(name) {
    const outfile = path.join(tmp, `${name}.mjs`);
    await esbuild.build({
        entryPoints: [path.join(sharedDir, `${name}.ts`)],
        outfile,
        bundle: true,
        platform: "neutral",
        format: "esm",
        logLevel: "silent",
    });
    return import(pathToFileURL(outfile).href);
}

const { decideLiveness } = await loadShared("voice-liveness");

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A stalled-looking tick that arrived exactly on time. */
const stalled = (overrides = {}) => ({
    idleMs: 9000,
    staleMs: 8000,
    armed: true,
    visible: true,
    tickLagMs: 0,
    attempts: 0,
    maxAttempts: 2,
    ...overrides,
});

test("a heartbeat within the budget is not a stall", { tag: ["@unit"] }, () => {
    expect(decideLiveness(stalled({ idleMs: 3000 }))).toBe("ok");
    // Exactly at the budget is still fine — the test is strictly greater.
    expect(decideLiveness(stalled({ idleMs: 8000 }))).toBe("ok");
});

test("staleMs 0 disables the watchdog outright", { tag: ["@unit"] }, () => {
    // The documented off switch: a deployment that turns it off must never have a
    // session ended by it, no matter how long capture has been silent.
    expect(decideLiveness(stalled({ staleMs: 0, idleMs: 10 * 60_000 }))).toBe("ok");
});

test("a session that never produced a heartbeat is not this rule's problem", { tag: ["@unit"] }, () => {
    // Nothing ever arrived, so silence carries no information. Reporting it as a
    // stall would hide a START failure behind the wrong message.
    expect(decideLiveness(stalled({ armed: false, idleMs: 60_000 }))).toBe("ok");
});

test("a hidden tab throttles capture legitimately", { tag: ["@unit"] }, () => {
    expect(decideLiveness(stalled({ visible: false, idleMs: 60_000 }))).toBe("ok");
});

test("a watchdog tick that was itself late proves nothing about the microphone", { tag: ["@unit"] }, () => {
    // THE regression test. A 30 s main-thread block (or a suspended laptop) makes
    // the tick fire 30 s late and see a 31 s gap — indistinguishable from a dead
    // capture by idleMs alone. The dictation must survive it.
    expect(decideLiveness(stalled({ tickLagMs: 30_000, idleMs: 31_000 }))).toBe("wait");
    // A lag inside the budget is normal timer jitter and must NOT excuse a stall.
    expect(decideLiveness(stalled({ tickLagMs: 500, idleMs: 31_000 }))).toBe("restart");
});

test("a genuine stall re-opens the microphone before anyone is told it is over", { tag: ["@unit"] }, () => {
    expect(decideLiveness(stalled({ attempts: 0 }))).toBe("restart");
    expect(decideLiveness(stalled({ attempts: 1 }))).toBe("restart");
});

test("the session is declared lost only once recovery is exhausted", { tag: ["@unit"] }, () => {
    expect(decideLiveness(stalled({ attempts: 2, maxAttempts: 2 }))).toBe("lost");
    expect(decideLiveness(stalled({ attempts: 5, maxAttempts: 2 }))).toBe("lost");
});

test("maxAttempts 0 keeps the old fail-immediately behaviour expressible", { tag: ["@unit"] }, () => {
    expect(decideLiveness(stalled({ maxAttempts: 0 }))).toBe("lost");
});
