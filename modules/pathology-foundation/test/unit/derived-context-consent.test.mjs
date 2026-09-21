/**
 * "Patient info is disabled" has to hold for facts DERIVED from patient data, not just for
 * the data itself.
 *
 * The reported incident: with the `patient` namespace denied, the assistant opened with
 * *"The specimen site was read from the slide metadata as lung — correct me if that's
 * wrong."* Nobody had said lung. `_deriveContext` had read `patient.getSlidePaths().fileName`
 * through a SYNTHETIC scripting context — and `getApi()` is the trusted main-thread path,
 * which does not consult the namespace grant (only the worker dispatcher does).
 *
 * The closed vocabulary in `_matchVocabulary` was the reason this looked safe: it can only
 * ever emit a configured `label`, so the raw file name could not escape. But a specimen site
 * is itself a clinical fact about a person, and revoking `patient` revokes exactly that. The
 * vocabulary bounds WHAT may be emitted; it never answered WHETHER anything may be.
 *
 * Both directions are asserted, because refusing always would be its own bug: a consenting
 * caller must still get the derivation, and local scripting installs no policy at all.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.$ = globalThis.$ ?? { t: (key) => String(key).split(".").pop() };

/** The shape that started it: the organ is in the file name, nowhere else. */
const REAL_PATH = "/data/patients/2024/PID-9981_lung_HE.tiff";
const FILE_NAME = "PID-9981_lung_HE.tiff";
const VIEWER_ID = "case-9981";

const VOCABULARY = {
    organs: [{ label: "Lung", match: ["lung", "pulmonary"] }],
    stains: [{ label: "H&E", match: ["he", "h&e", "hematoxylin"] }],
};

const { XOpatScriptingApi } = await import("../../../../src/classes/scripting/abstract-api.ts");
const { registerPathologyScriptingApi } = await import("../../scripting/api.ts");

/** Records every read so "never called" can be asserted, not just "returned nothing". */
function makePatientApi(reads) {
    const api = {
        bindInvocationContext: () => api,
        getPatientMetadata: () => {
            reads.push("getPatientMetadata");
            return {};
        },
        getSlidePaths: () => {
            reads.push("getSlidePaths");
            return { serverPath: REAL_PATH, fileName: FILE_NAME };
        },
    };
    return api;
}

function installGlobals(reads) {
    const patient = makePatientApi(reads);
    globalThis.APPLICATION_CONTEXT = globalThis.window.APPLICATION_CONTEXT = {
        url: "http://localhost/",
        config: { data: [REAL_PATH] },
        Scripting: {
            // `viewer` is deliberately absent: the channel-name haystack is a second route
            // into the same vocabulary and must not be needed to reproduce the leak.
            getApi: (namespace) => (namespace === "patient" ? patient : null),
        },
    };
    globalThis.VIEWER_MANAGER = globalThis.window.VIEWER_MANAGER = {
        viewers: [{ uniqueId: VIEWER_ID, world: { getItemCount: () => 0 } }],
    };
    globalThis.singletonModule = globalThis.window.singletonModule = () => ({
        getStaticMeta: (key, fallback) =>
            key === "contextVocabulary" ? VOCABULARY : fallback,
    });
}

/**
 * Build the namespace the way the runtime does — the class is declared inside
 * `registerPathologyScriptingApi` against the runtime-global base.
 */
async function pathologyApi({ sensitiveAllowed }) {
    let register;
    globalThis.ScriptingManager = globalThis.window.ScriptingManager = {
        XOpatScriptingApi,
        registerExternalApi: (callback) => { register = callback; },
    };

    registerPathologyScriptingApi();

    let api;
    await register({ ingestApi: (instance) => { api = instance; } });

    return api.bindInvocationContext({
        scriptingContext: {
            id: "test-context",
            getActiveViewerContextId: () => VIEWER_ID,
            activeViewerContextId: VIEWER_ID,
            setActiveViewerContextId() {},
            isConsentDialogBypassed: () => true,
            setBypassConsentDialog() {},
            // The policy under test. Omitting it entirely is the local-scripting case,
            // covered by the third test.
            ...(sensitiveAllowed === undefined
                ? {}
                : { mayExposeSensitiveData: () => sensitiveAllowed }),
        },
    });
}

test("derives nothing — and reads nothing — when sensitive data is denied", async () => {
    const reads = [];
    installGlobals(reads);

    const derived = await (await pathologyApi({ sensitiveAllowed: false }))._deriveContext();

    // "unknown" is what routes the caller into ASKING the user, which is the behaviour the
    // incident should have produced: state nothing, ask for stain and site.
    expect(derived).toEqual({ source: "unknown" });
    // Not merely filtered afterwards: the sensitive namespace is never touched at all.
    expect(reads).toEqual([]);
});

test("derives the context once sensitive data is consented", async () => {
    const reads = [];
    installGlobals(reads);

    const derived = await (await pathologyApi({ sensitiveAllowed: true }))._deriveContext();

    expect(derived.source).toBe("derived");
    expect(derived.organ).toBe("Lung");
    expect(reads).toContain("getSlidePaths");
    // Only the vocabulary label travels — never the text it was matched in.
    const text = JSON.stringify(derived);
    expect(text.includes(FILE_NAME) || text.includes(REAL_PATH)).toBe(false);
});

test("is unchanged for local scripting (no policy installed)", async () => {
    const reads = [];
    installGlobals(reads);

    const derived = await (await pathologyApi({ sensitiveAllowed: undefined }))._deriveContext();

    // A user inspecting their own slide must keep seeing their own data.
    expect(derived.organ).toBe("Lung");
});
