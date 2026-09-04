/**
 * `questionnaire.listPageViewerSlots()` hands out the raw `viewer.uniqueId`.
 *
 * Viewer identity leaving toward an LLM goes through one chokepoint: the scripting
 * context's alias (`toPresentedViewerId` / `toInternalViewerId`), so the model only ever
 * handles `viewer-1` and core translates at the boundary — that is what
 * `application.getGlobalInfo` and `application.setActiveViewer` do. A slide id is
 * free-form and routinely carries the case: `winter-school-prostate-prostate14_HE-mrxs`.
 *
 * `_slotInfo` returns `slot.viewerId` untouched, so one call re-introduces the real id
 * into a session where every other surface was anonymized — and any handle the model then
 * echoes back no longer joins to the same map. The `recorder` namespace refuses this
 * exact shortcut on purpose ("a raw `viewerId` param would leak viewer identity past the
 * anonymization layer"); the questionnaire namespace does not.
 *
 * THE FIRST TEST FAILS TODAY. That failure is the bug report; the fix is not part of
 * this file.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.$ = globalThis.$ ?? { t: (key) => String(key).split(".").pop() };

const REAL_ID = "winter-school-prostate-prostate14_HE-mrxs";

const { XOpatScriptingApi } = await import("../../../../src/classes/scripting/abstract-api.ts");
const { registerQuestionnaireScriptingApi } = await import("../../scripting/api.ts");

/** The plugin the namespace adapts: only the one read this test exercises. */
const PLUGIN = {
    listPageViewerSlots: () => [{ index: 0, title: "Grade the tumour", viewerId: REAL_ID }],
};

/**
 * Build the namespace the way the runtime does: the class is declared inside
 * `registerQuestionnaireScriptingApi` against the runtime-global base, and handed to the
 * manager through `registerExternalApi`.
 */
async function questionnaireApi({ alias = false } = {}) {
    let register;
    globalThis.ScriptingManager = globalThis.window.ScriptingManager = {
        XOpatScriptingApi,
        registerExternalApi: (callback) => { register = callback; },
    };
    globalThis.plugin = globalThis.window.plugin = () => PLUGIN;

    registerQuestionnaireScriptingApi();

    let api;
    await register({ ingestApi: (instance) => { api = instance; } });

    return api.bindInvocationContext({
        scriptingContext: {
            id: "test-context",
            getActiveViewerContextId: () => null,
            setActiveViewerContextId() {},
            isConsentDialogBypassed: () => true,
            setBypassConsentDialog() {},
            ...(alias ? {
                toPresentedViewerId: (id) => (id === REAL_ID ? "viewer-1" : id),
                toInternalViewerId: (handle) => (handle === "viewer-1" ? REAL_ID : handle),
            } : {}),
        },
    });
}

test("listPageViewerSlots presents the viewer handle, not the real id", async () => {
    const [slot] = (await questionnaireApi({ alias: true })).listPageViewerSlots(0);

    expect(slot.viewerId).toBe("viewer-1");
    // The slot index is what every binding call takes, so nothing about the workflow
    // needs the real id in the first place.
    expect(slot.index).toBe(0);
});

test("listPageViewerSlots is identity for local scripting (no alias installed)", async () => {
    const [slot] = (await questionnaireApi()).listPageViewerSlots(0);

    expect(slot.viewerId).toBe(REAL_ID);
});
