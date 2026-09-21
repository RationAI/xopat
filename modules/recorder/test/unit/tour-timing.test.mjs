/**
 * A script authoring a tour never watches it play, so whatever the defaults produce is
 * what ships. They used to produce a flip-book: `captureFrame()` with no timing fell
 * through to the module's `duration = 0.5`, and because `_moveSeconds` clamps the eased
 * move to the duration, the ENTIRE stop — movement included — was half a second. A tour
 * of nine regions was over in four seconds with nothing readable in it.
 *
 * The module keeps 0.5 s for the UI recorder, where a human clicks and then drags the
 * step out on a timeline in front of them. These vectors pin the scripted defaults.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

async function loadApi() {
    let api = null;
    globalThis.ScriptingManager = {
        XOpatScriptingApi: class {
            constructor(namespace, name, description) {
                Object.assign(this, { namespace, name, description });
            }
        },
        registerExternalApi: async (registrar) => {
            await registrar({ ingestApi: (instance) => { api = instance; } });
        },
    };
    const { registerRecorderScriptingApi } = await import("../../scripting/api.ts");
    registerRecorderScriptingApi();
    if (!api) throw new Error("the recorder namespace did not register");
    return api;
}

const api = await loadApi();

/** `_timingArgs` answers [delay, duration, springStiffness]. */
const durationOf = (timing, moving) => api._timingArgs(timing, moving)[1];
const delayOf = (timing, moving) => api._timingArgs(timing, moving)[0];

test("a captured view holds long enough to look at it", () => {
    // 1.8 s eased move + 2.5 s still hold. The move is not stored separately: the
    // module derives it as min(duration, 1.8), so the hold is what is left.
    const duration = durationOf(undefined, true);
    expect(duration).toBeCloseTo(4.3, 5);
    // The part a viewer can actually study.
    expect(duration - Math.min(duration, 1.8)).toBeGreaterThanOrEqual(2.5);
    // Not the old flip-book.
    expect(duration).toBeGreaterThan(0.5);
});

test("a hold pays for no movement, so it only needs the still time", () => {
    expect(durationOf(undefined, false)).toBeCloseTo(2.5, 5);
});

test("an explicit duration still wins", () => {
    expect(durationOf({ duration: 12 }, true)).toBe(12);
    expect(durationOf({ duration: 0.2 }, true)).toBe(0.2);
    expect(durationOf({ duration: 1 }, false)).toBe(1);
});

test("a step still outlasts its own movement", () => {
    // A long sweep with no duration of its own must not be cut off mid-move.
    expect(durationOf({ move: 9 }, true)).toBe(9);
    // …and the default already covers a move shorter than it.
    expect(durationOf({ move: 1 }, true)).toBeCloseTo(4.3, 5);
});

test("delay is untouched and defaults to none", () => {
    expect(delayOf(undefined, true)).toBe(0);
    expect(delayOf({ delay: 2 }, true)).toBe(2);
});

test("a negative or non-numeric timing is still refused", () => {
    for (const bad of [-1, "3", NaN, {}]) {
        expect(() => api._timingArgs({ duration: bad }, true), String(bad)).toThrow();
    }
});
