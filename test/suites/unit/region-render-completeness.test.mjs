/**
 * An off-screen pass has no next frame, so "what tiles happened to be resident when it ran" IS the
 * whole result — and for a long time nothing in the result said so. A whole-slide survey read one
 * corner of a biopsy, reported it complete, cached that as the tissue mask, and answered every
 * later question from it.
 *
 * The renderer now owns all of that: it waits for the tiles it schedules, scopes completeness to
 * the images it was told to wait on (`waitImages` — mirrors on the off-screen path, live world
 * items on the steal-live-state one), and reports `{fullyLoaded, stalled}` per call.
 *
 * What is left on the xOpat side is one rule, and this file is its whole test surface: **read the
 * renderer's answer, and degrade CLOSED when there is no answer to read.** Every consumer uses the
 * flag to decide whether pixels may be measured, cached, or described to a model, so "we could not
 * tell" must never come back as yes.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.window.OpenSeadragon = globalThis.window.OpenSeadragon ?? { Point: function Point() {}, Rect: function Rect() {} };
globalThis.OpenSeadragon = globalThis.window.OpenSeadragon;
globalThis.APPLICATION_CONTEXT = globalThis.APPLICATION_CONTEXT ?? { getOption: (_k, d) => d };
globalThis.$ = globalThis.$ ?? { t: (k) => String(k).split(".").pop() };

const { XOpatVisualizationScriptApi } = await import("../../../src/classes/scripting/visualization-api.ts");

/**
 * `unwrapExtract` is `protected`: an internal contract, not scripting API. Reach it through the
 * prototype rather than constructing the class, which would demand a live viewer, a renderer and a
 * shader configurator to exercise one pure decision.
 */
const proto = XOpatVisualizationScriptApi.prototype;
const unwrap = (out, msg = "render failed") => proto.unwrapExtract.call(proto, out, msg);

const canvas = { __canvas: true };
const envelope = (fullyLoaded, stalled = false) => ({ data: canvas, fullyLoaded, stalled });

test("the envelope is read verbatim — the pass already scoped its own wait @unit", () => {
    expect(unwrap(envelope(true))).toEqual({ canvas, isComplete: true, stalled: false });
    expect(unwrap(envelope(false))).toEqual({ canvas, isComplete: false, stalled: false });
});

test("stalled rides along, so a caller can tell 'slow' from 'will never arrive' @unit", () => {
    // `!isComplete && !stalled` means the budget ran out and a longer one may help; `stalled` means
    // it will not. And a slide with permanently missing tiles can report complete OVER holes, since
    // OSD drops a 404'd tile from the computation — so `isComplete && !stalled` is the only fully
    // trustworthy read, and both flags have to survive the unwrap for a caller to apply it.
    expect(unwrap(envelope(false, true)).stalled).toBe(true);
    expect(unwrap(envelope(true, true))).toEqual({ canvas, isComplete: true, stalled: true });
    expect(unwrap(envelope(false, false)).stalled).toBe(false);
});

test("a renderer that reports nothing degrades closed @unit", () => {
    // A bare canvas is a renderer predating the wait: completeness is unknown, and unknown is not
    // "yes". This is the only fallback left, so it has to hold.
    expect(unwrap(canvas)).toEqual({ canvas, isComplete: false, stalled: false });
});

test("only a literal false is incomplete — a renderer omitting the detail is not @unit", () => {
    // `"fullyLoaded" in out` is the discriminator. Once the envelope is there it is authoritative,
    // including when a field the caller does not set comes back undefined.
    expect(unwrap({ data: canvas, fullyLoaded: true }).stalled).toBe(false);
    expect(unwrap({ data: canvas, fullyLoaded: undefined }).isComplete).toBe(true);
    expect(unwrap({ data: canvas, fullyLoaded: false }).isComplete).toBe(false);
});

test("a missing canvas throws rather than returning nothing @unit", () => {
    expect(() => unwrap(null, "boom")).toThrow("boom");
    expect(() => unwrap({ data: null, fullyLoaded: true }, "boom")).toThrow("boom");
});
