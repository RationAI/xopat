/**
 * Captioning a stop used to take a second call, which made the UNCAPTIONED tour the
 * shorter thing to write — and that is what got written. `captureFrame({ narration })`
 * makes the good path the short one, and it must do so by REUSING `setStepNarration`
 * rather than growing a second narration implementation: the 400-char cap, the placement
 * mapping and the raise of `duration` to reading time all live there.
 *
 * These tests drive `_finishStop` — the step of the capture that applies an explicit
 * move and then the caption — against recording stubs, so no viewer is needed.
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

/**
 * A capture api bound to one in-memory step. Only the calls `_finishStop` makes are
 * stubbed; everything else is the real implementation under test.
 */
function apiOverStep(step) {
    const calls = [];
    const instance = Object.create(Object.getPrototypeOf(api));
    Object.assign(instance, api);
    instance._requireEditableActiveRecording = () => ({ steps: [step] });
    instance._requireActiveRecording = () => ({ steps: [step], name: "Tour" });
    instance._resolveStep = () => ({ step, index: 0, recording: { steps: [step], name: "Tour" } });
    instance._settle = async () => {};
    instance._vid = () => "viewer-1";
    instance._newOverlayId = () => "overlay-1";
    instance._recorder = () => ({
        updateStep: (_id, mutate) => { calls.push("updateStep"); mutate(step); },
        stepCapturesViewport: () => true,
        stepCapturesVisualization: () => false,
        stepCapturesNavigation: () => false,
    });
    return { instance, calls };
}

function keyframe(duration = 4.3) {
    return { id: "step-1", kind: "keyframe", duration, overlays: [] };
}

const CAPTION = "Glands are back-to-back with no intervening stroma.";

test("a narration passed to the capture lands on the step", async () => {
    const step = keyframe();
    const { instance } = apiOverStep(step);
    const info = await instance._finishStop({ id: step.id, index: 0 }, { narration: CAPTION });

    expect(step.overlays).toHaveLength(1);
    expect(step.overlays[0].markdown).toBe(CAPTION);
    expect(info.overlays[0].markdown).toBe(CAPTION);
    // The returned info is the one AFTER captioning — the caller needs the raised
    // duration, not the pre-caption snapshot.
    expect(info.duration).toBe(step.duration);
});

test("the caption stretches the step to reading time", async () => {
    // A default stop already holds long enough for a short caption…
    const short = keyframe();
    await apiOverStep(short).instance._finishStop({ id: short.id, index: 0 }, { narration: "Necrosis." });
    expect(short.duration).toBeGreaterThanOrEqual(4.3);

    // …and a step someone shortened is stretched back out to fit the text.
    const tight = keyframe(1);
    await apiOverStep(tight).instance._finishStop({ id: tight.id, index: 0 }, { narration: CAPTION });
    expect(tight.duration).toBeGreaterThan(1);
});

test("placement travels with the caption", async () => {
    const step = keyframe();
    const { instance } = apiOverStep(step);
    await instance._finishStop({ id: step.id, index: 0 }, { narration: CAPTION, placement: "top" });
    expect(step.overlays[0].placement).toBeTruthy();
    expect(JSON.stringify(step.overlays[0].placement)).toContain("t");
});

test("the narration cap applies to this path too", async () => {
    const step = keyframe();
    const { instance } = apiOverStep(step);
    await expect(
        instance._finishStop({ id: step.id, index: 0 }, { narration: "x".repeat(401) })
    ).rejects.toThrow(/401 characters/);
    // Nothing was written.
    expect(step.overlays).toHaveLength(0);
});

test("a timing-only capture behaves exactly as before", async () => {
    const step = keyframe();
    const { instance, calls } = apiOverStep(step);
    const info = await instance._finishStop({ id: step.id, index: 0 }, { duration: 6 });
    // No move and no narration were asked for, so nothing was touched after capture.
    expect(calls).toEqual([]);
    expect(step.overlays).toHaveLength(0);
    expect(info.id).toBe(step.id);

    const bare = keyframe();
    const plain = apiOverStep(bare);
    await plain.instance._finishStop({ id: bare.id, index: 0 }, undefined);
    expect(plain.calls).toEqual([]);
});

test("a blank narration is not a caption", async () => {
    const step = keyframe();
    const { instance, calls } = apiOverStep(step);
    await instance._finishStop({ id: step.id, index: 0 }, { narration: "   " });
    expect(calls).toEqual([]);
    expect(step.overlays).toHaveLength(0);
});
