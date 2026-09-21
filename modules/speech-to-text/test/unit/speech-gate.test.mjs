/**
 * The speech verdict, frame by frame.
 *
 * `speechGate.ts` is the single decision point behind every cut, timer and
 * discard in the capture, fed either by the Silero probability or by the
 * amplitude meter. These tests pin the rules that field sessions taught us:
 * the first onset needs sustain (blip rejection), a re-arm after a cut does
 * not (or segment onsets get clipped), the withheld onset run-up is credited
 * on the transition frame, the amplitude floor never drifts during speech,
 * and Silero switches on and off with hysteresis.
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

const tmp = mkdtempSync(path.join(tmpdir(), "xopat-speech-gate-"));
const esbuild = require("esbuild");

const outfile = path.join(tmp, "speechGate.mjs");
await esbuild.build({
    entryPoints: [path.join(moduleDir, "speechGate.ts")],
    outfile,
    bundle: true,
    platform: "neutral",
    format: "esm",
    logLevel: "silent",
});
const { SpeechGate, pickVadEngine } = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const OPTS = {
    threshold: 0.04,
    speechFloorMult: 3.0,
    minSpeechMs: 200,
    positiveSpeechThreshold: 0.5,
    negativeSpeechThreshold: 0.35,
    capGate: true,
};
const gate = (overrides = {}) => new SpeechGate({ ...OPTS, ...overrides });

/** Feed frames `stepMs` apart starting at `t0`; returns the verdicts. */
const feed = (g, frames, t0 = 1000, stepMs = 50) =>
    frames.map((f, i) => g.process({ t: t0 + i * stepMs, ...f }));

// ---- amplitude -------------------------------------------------------------

test("amplitude: a blip shorter than minSpeechMs is never speech", { tag: ["@unit"] }, () => {
    const g = gate();
    // Room tone establishes the floor, then three loud frames (150 ms), then quiet.
    const v = feed(g, [
        { peak: 0.01 }, { peak: 0.01 }, { peak: 0.01 },
        { peak: 0.3 }, { peak: 0.3 }, { peak: 0.3 },
        { peak: 0.01 }, { peak: 0.01 },
    ]);
    expect(v.some(x => x.isSpeech)).toBe(false);
    expect(g.heardAnySpeech).toBe(false);
});

test("amplitude: the first onset flips on the frame that completes the sustain and credits the run-up", { tag: ["@unit"] }, () => {
    const g = gate();
    const v = feed(g, [
        { peak: 0.01 }, { peak: 0.01 },
        { peak: 0.3 }, { peak: 0.3 }, { peak: 0.3 }, { peak: 0.3 }, { peak: 0.3 },
    ]);
    // Run starts at t=1100; 200 ms of sustain is complete at t=1300 (index 6).
    expect(v.slice(0, 6).some(x => x.isSpeech)).toBe(false);
    expect(v[6].isSpeech).toBe(true);
    expect(v[6].voicedDeltaMs).toBe(200);
    expect(v[6].onsetAt).toBe(1100);
    expect(g.heardAnySpeech).toBe(true);
});

test("amplitude: after a segment re-arm a single above-gate frame is speech", { tag: ["@unit"] }, () => {
    const g = gate();
    feed(g, [{ peak: 0.01 }, { peak: 0.3 }, { peak: 0.3 }, { peak: 0.3 }, { peak: 0.3 }, { peak: 0.3 }]);
    expect(g.heardAnySpeech).toBe(true);
    g.beginSegment();
    const [v] = feed(g, [{ peak: 0.3 }], 5000);
    expect(v.isSpeech).toBe(true);
    // A plain-gate frame credits its dt, not a run-up — and a gap this long is a
    // stall, so the credit is capped at one frame's worth (MAX_FRAME_MS).
    expect(v.voicedDeltaMs).toBe(250);
    const [w] = feed(g, [{ peak: 0.3 }], 5050);
    expect(w.voicedDeltaMs).toBe(50);
});

test("amplitude: the floor tracks the room and never drifts during speech", { tag: ["@unit"] }, () => {
    const g = gate();
    feed(g, Array.from({ length: 20 }, () => ({ peak: 0.02 })));
    expect(g.snapshot().noiseFloor).toBeCloseTo(0.02, 5);
    // Onset: the withheld sustain frames are non-speech and may drift the floor a hair.
    feed(g, Array.from({ length: 6 }, () => ({ peak: 0.4 })), 2000);
    expect(g.heardAnySpeech).toBe(true);
    const floorBefore = g.snapshot().noiseFloor;
    // Long loud speech: the floor must stay put (it drifts only on non-speech frames).
    feed(g, Array.from({ length: 200 }, () => ({ peak: 0.4 })), 2300);
    expect(g.snapshot().noiseFloor).toBe(floorBefore);
    expect(g.snapshot().gate).toBeLessThanOrEqual(0.4 * 0.5 + 1e-9);
});

test("amplitude: a peak under floor x mult is not speech", { tag: ["@unit"] }, () => {
    const g = gate();
    feed(g, Array.from({ length: 10 }, () => ({ peak: 0.05 })));
    const v = feed(g, Array.from({ length: 10 }, () => ({ peak: 0.12 })), 2000); // 0.12 < 0.15
    expect(v.some(x => x.isSpeech)).toBe(false);
});

test("amplitude: the gate cap (segmented only) keeps a quiet speaker above a polluted floor", { tag: ["@unit"] }, () => {
    // A noisy room (floor 0.1 → gate 0.3) and a speaker who talks at 0.35.
    const noisy = () => [
        ...Array.from({ length: 10 }, () => ({ peak: 0.1 })),
        ...Array.from({ length: 6 }, () => ({ peak: 0.35 })),
    ];
    const capped = gate({ capGate: true });
    feed(capped, noisy());
    expect(capped.heardAnySpeech).toBe(true);
    // Half the demonstrated speech level (0.175) now bounds the gate: 0.2 is speech.
    expect(feed(capped, [{ peak: 0.2 }], 3000)[0].isSpeech).toBe(true);
    expect(capped.snapshot().gate).toBeCloseTo(0.175, 5);

    const uncapped = gate({ capGate: false });
    feed(uncapped, noisy());
    expect(uncapped.heardAnySpeech).toBe(true);
    // One-shot captures keep the plain floor x mult gate: 0.2 stays under ~0.3.
    expect(feed(uncapped, [{ peak: 0.2 }], 3000)[0].isSpeech).toBe(false);
    expect(uncapped.snapshot().gate).toBeGreaterThan(0.29);
});

// ---- silero ----------------------------------------------------------------

test("silero: hysteresis - on at positive, stays on above negative, off below it", { tag: ["@unit"] }, () => {
    const g = gate();
    // Establish speech first (sustain), then probe the hysteresis band.
    feed(g, Array.from({ length: 6 }, () => ({ peak: 0.2, prob: 0.9 })));
    expect(g.heardAnySpeech).toBe(true);
    const v = feed(g, [
        { peak: 0.2, prob: 0.4 },   // between thresholds while on: stays on
        { peak: 0.2, prob: 0.3 },   // below negative: off
        { peak: 0.2, prob: 0.45 },  // between thresholds while off: stays off
        { peak: 0.2, prob: 0.6 },   // above positive: on
    ], 5000);
    expect(v.map(x => x.isSpeech)).toEqual([true, false, false, true]);
});

test("silero: the first onset needs minSpeechMs of speech probability", { tag: ["@unit"] }, () => {
    const g = gate();
    const v = feed(g, [
        { peak: 0.2, prob: 0.9 }, { peak: 0.2, prob: 0.9 }, { peak: 0.2, prob: 0.9 },
        { peak: 0.2, prob: 0.1 },
        { peak: 0.2, prob: 0.9 }, { peak: 0.2, prob: 0.9 }, { peak: 0.2, prob: 0.9 },
        { peak: 0.2, prob: 0.9 }, { peak: 0.2, prob: 0.9 },
    ]);
    // First run (150 ms) breaks before the sustain; the second completes at +200 ms.
    expect(v.slice(0, 8).some(x => x.isSpeech)).toBe(false);
    expect(v[8].isSpeech).toBe(true);
    expect(v[8].voicedDeltaMs).toBe(200);
});

test("silero: room tone with low probability is never speech, whatever the peak", { tag: ["@unit"] }, () => {
    const g = gate();
    const v = feed(g, Array.from({ length: 40 }, () => ({ peak: 0.5, prob: 0.05 })));
    expect(v.some(x => x.isSpeech)).toBe(false);
    expect(v.every(x => x.voicedDeltaMs === 0)).toBe(true);
    expect(v[1].level).toBe(1); // the meter still follows the peak
});

test("silero: snapshot names the engine", { tag: ["@unit"] }, () => {
    const g = gate();
    feed(g, [{ peak: 0.1, prob: 0.2 }]);
    expect(g.snapshot().mode).toBe("silero");
    feed(g, [{ peak: 0.1 }]);
    expect(g.snapshot().mode).toBe("amplitude");
});

// ---- engine selection -------------------------------------------------------

test("pickVadEngine: silero only when requested, supported and loaded", { tag: ["@unit"] }, () => {
    expect(pickVadEngine({ requested: "silero", supported: true, load: "ready" })).toBe("silero");
    expect(pickVadEngine({ requested: "silero", supported: true, load: "loading" })).toBe("amplitude");
    expect(pickVadEngine({ requested: "silero", supported: true, load: "idle" })).toBe("amplitude");
    expect(pickVadEngine({ requested: "silero", supported: true, load: "failed" })).toBe("amplitude");
    expect(pickVadEngine({ requested: "silero", supported: false, load: "ready" })).toBe("amplitude");
    expect(pickVadEngine({ requested: "amplitude", supported: true, load: "ready" })).toBe("amplitude");
});
