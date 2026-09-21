/**
 * Every recorder write answers with a RecordingInfo / StepInfo / AssetInfo, so
 * feeding that object into the next call is the natural next line to write.
 * It used to be refused with `No recording '[object Object]' on this viewer`,
 * which names the symptom and not the fix — an authoring session lost a turn to
 * exactly that. `_id` / `_ref` accept the object and use its `id`; anything else
 * still fails, but says what to pass.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

/**
 * The namespace is registered against a runtime-global base class, so stand one
 * in and capture the class the module builds on top of it.
 */
async function loadApiClass() {
    let ApiClass = null;
    globalThis.ScriptingManager = {
        XOpatScriptingApi: class {
            constructor(namespace, name, description) {
                Object.assign(this, { namespace, name, description });
            }
        },
        registerExternalApi: async (registrar) => {
            await registrar({ ingestApi: (instance) => { ApiClass = instance; } });
        },
    };
    const { registerRecorderScriptingApi } = await import("../../scripting/api.ts");
    registerRecorderScriptingApi();
    // registerExternalApi is awaited above, so the instance is in hand.
    if (!ApiClass) throw new Error("the recorder namespace did not register");
    return ApiClass;
}

const api = await loadApiClass();

test("_id accepts an id string and the object a previous call returned", () => {
    expect(api._id("rec-1", "setActiveRecording(recordingId)")).toBe("rec-1");
    expect(api._id({ id: "rec-1", name: "Tour", stepCount: 3 }, "setActiveRecording(recordingId)")).toBe("rec-1");
});

test("_id refuses anything else with the argument named", () => {
    for (const bad of [undefined, null, 42, "", "   ", [], { name: "Tour" }]) {
        let error = null;
        try { api._id(bad, "setActiveRecording(recordingId)"); } catch (e) { error = e; }
        expect(error, `expected ${JSON.stringify(bad)} to be refused`).toBeTruthy();
        expect(error.message).toContain("setActiveRecording(recordingId)");
        // The fix, not just the complaint.
        expect(error.message).toContain("the object a previous call returned");
    }
});

test("_id says what an object was missing", () => {
    let error = null;
    try { api._id({ name: "Tour", stepCount: 3 }, "deleteRecording(recordingId)"); } catch (e) { error = e; }
    expect(error.message).toContain("without a usable 'id'");
    expect(error.message).toContain("name");
});

test("_ref additionally accepts a 0-based index", () => {
    expect(api._ref(0, "getStep(idOrIndex)")).toBe(0);
    expect(api._ref(3, "getStep(idOrIndex)")).toBe(3);
    expect(api._ref("step-9", "getStep(idOrIndex)")).toBe("step-9");
    expect(api._ref({ id: "step-9", index: 2 }, "getStep(idOrIndex)")).toBe("step-9");
});

test("_ref refuses a non-integer or negative index by name", () => {
    for (const bad of [-1, 1.5, NaN]) {
        let error = null;
        try { api._ref(bad, "goToIndex(index)"); } catch (e) { error = e; }
        expect(error, `expected ${bad} to be refused`).toBeTruthy();
        expect(error.message).toContain("goToIndex(index)");
        expect(error.message).toContain("whole number from 0 upwards");
    }
});

test("the declarations handed to the model say the object form works", () => {
    const dts = api.constructor.ScriptApiMetadata.dtypesSource.value;
    expect(dts).toContain("export type RecordingRef = string | RecordingInfo;");
    expect(dts).toContain("setActiveRecording(recording: RecordingRef): RecordingInfo;");
    expect(dts).toContain("setStepNarration(step: StepRef, markdown: string");
});
