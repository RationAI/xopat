/**
 * A tour authored by a script is written blind: every call succeeds, and nothing on the
 * way says the result is nine half-second stops with no captions — which is exactly what
 * one session shipped. `summarizeTour` is the one place that can say so, read by the
 * calls that FINISH a tour (recorder playback, questionnaire page binding).
 *
 * It never throws and never blocks: a half-finished draft is a legitimate thing to play.
 * The warnings are phrased as the edit to make, because their reader is usually a model
 * deciding what to do next.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
// `recorder-module.ts` publishes itself as `window.OpenSeadragon.Recorder` at import, so
// the namespace has to exist. Suites share a worker process, and other files detect this
// global with `globalThis.OpenSeadragon || { TileSource: class {} }` — leaving a bare
// `{}` here silently disarms that guard for whichever file runs after this one.
globalThis.OpenSeadragon = globalThis.OpenSeadragon ?? {};
globalThis.OpenSeadragon.TileSource = globalThis.OpenSeadragon.TileSource ?? class {};
globalThis.APPLICATION_CONTEXT = globalThis.APPLICATION_CONTEXT ?? {
    getOption: (key, def) => def,
    history: { registerProvider: () => () => {} },
};
globalThis.UTILITIES = globalThis.UTILITIES ?? {};
globalThis.VIEWER_MANAGER = globalThis.VIEWER_MANAGER ?? { viewers: [], addHandler: () => {} };
globalThis.XOpatModuleSingleton = globalThis.XOpatModuleSingleton ?? class {
    constructor() {}
    static instance() { return null; }
};

/** `recorder-module.ts` registers its class rather than exporting it. */
let RecorderClass = null;
globalThis.addModule = (id, ClassRef) => { if (id === "recorder") RecorderClass = ClassRef; };
await import("../../recorder-module.ts");
if (!RecorderClass) throw new Error("the recorder module did not register");

/** summarizeTour reads only the steps and the class's own thresholds. */
const recorder = Object.create(RecorderClass.prototype);
const summarize = (steps) => recorder.summarizeTour(steps);

/** A captured stop: a view of its own, optionally captioned. */
function stop({ duration = 4.3, moveDuration, caption, delay } = {}) {
    return {
        id: `s${Math.round(duration * 1000)}-${caption ? "c" : "u"}-${Math.random()}`,
        kind: "keyframe",
        point: { x: 0.5, y: 0.5 },
        zoomLevel: 2,
        duration,
        ...(moveDuration === undefined ? {} : { moveDuration }),
        ...(delay === undefined ? {} : { delay }),
        overlays: caption ? [{ id: "o1", kind: "composite", markdown: caption }] : [],
    };
}

const CAPTION = "Glands are back-to-back with no intervening stroma.";

test("a captioned, unhurried tour raises nothing", () => {
    const summary = summarize([stop({ caption: CAPTION }), stop({ caption: CAPTION })]);
    expect(summary.warnings).toEqual([]);
    expect(summary.stepCount).toBe(2);
    expect(summary.keyframeCount).toBe(2);
    expect(summary.narratedCount).toBe(2);
    expect(summary.totalSeconds).toBeCloseTo(8.6, 5);
});

test("a tour with no captions at all says so and names the fix", () => {
    const summary = summarize(Array.from({ length: 9 }, () => stop()));
    expect(summary.narratedCount).toBe(0);
    const joined = summary.warnings.join("\n");
    expect(joined).toContain("None of the 9 stop(s) has a caption");
    // The edit to make, not just the complaint.
    expect(joined).toContain("captureFrame");
    expect(joined).toContain("setStepNarration");
});

test("partial captioning lists the offending steps, counted from 1", () => {
    const summary = summarize([
        stop({ caption: CAPTION }),
        stop(),
        stop({ caption: CAPTION }),
        stop(),
    ]);
    expect(summary.narratedCount).toBe(2);
    const joined = summary.warnings.join("\n");
    expect(joined).toContain("2 of 4 stop(s) have no caption");
    expect(joined).toContain("step(s) 2, 4");
    expect(joined).not.toContain("None of the");
});

test("the old default is reported as the flash it is", () => {
    // Exactly what captureFrame() used to produce: 0.5 s, movement included.
    const summary = summarize(Array.from({ length: 9 }, () => stop({ duration: 0.5 })));
    const joined = summary.warnings.join("\n");
    expect(joined).toContain("leave under 1s on screen once the movement finishes");
    expect(summary.totalSeconds).toBeCloseTo(4.5, 5);
    expect(joined).toContain("The whole tour runs 4.5s");
});

test("a long move with a matching duration is not a rushed step", () => {
    // 6 s of sweeping plus 3 s of stillness — slow on purpose, not a mistake.
    const summary = summarize([stop({ duration: 9, moveDuration: 6, caption: CAPTION })]);
    expect(summary.warnings).toEqual([]);
});

test("holds and recorded paths are not stops a caption is missing from", () => {
    const summary = summarize([
        stop({ caption: CAPTION }),
        { id: "h", kind: "empty", duration: 2.5, overlays: [] },
        { id: "n", kind: "keyframe", duration: 6, navigation: { samples: [{ at: 0 }] }, overlays: [] },
    ]);
    expect(summary.stepCount).toBe(3);
    expect(summary.keyframeCount).toBe(1);
    expect(summary.narratedCount).toBe(1);
    expect(summary.warnings).toEqual([]);
});

test("delay counts toward the tour's length", () => {
    const summary = summarize([stop({ duration: 4, delay: 2, caption: CAPTION })]);
    expect(summary.totalSeconds).toBeCloseTo(6, 5);
});

test("an empty or absent recording is summarized, not refused", () => {
    for (const value of [[], null, undefined]) {
        const summary = summarize(value);
        expect(summary.stepCount).toBe(0);
        expect(summary.warnings).toEqual([]);
        expect(summary.shortestSeconds).toBe(0);
    }
});

test("a blank caption does not count as one", () => {
    const summary = summarize([stop({ caption: "   " })]);
    expect(summary.narratedCount).toBe(0);
});
