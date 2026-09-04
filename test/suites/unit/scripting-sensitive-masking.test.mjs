/**
 * "Patient info is disabled" must mean it, on every namespace.
 *
 * Chat denies the `patient` namespace by default (`defaultScriptConsentMode:
 * 'all-but-sensitive'`; the namespace is flagged `sensitive` in
 * `src/classes/scripting/patient-api.ts`). The promise that makes is: identifying slide
 * data does not reach the upstream LLM. Three non-sensitive namespaces re-export exactly
 * what `patient` gates, so today the switch does not hold:
 *
 *  - `visualization.captureState()` returns the whole `config.data` array verbatim —
 *    every raw slide path, the same strings `patient.getSlidePaths().serverPath` gates.
 *  - `visualization.describeData()` returns that path again as `dataId`, plus
 *    `tileSourceId` (for DICOMweb: the store URL with study/series UIDs in it) and
 *    `metadata` straight off the tile source. `plugins/dicom/tile-source.mjs` puts
 *    `studyUID`/`seriesUID`/`frameOfReferenceUID` in `getMetadata()` — its own comment
 *    calls them "opaque PHI identifiers".
 *  - (see `plugins/questionaire-new/test/unit/viewer-slot-identity.test.mjs` for the
 *    third one: raw `viewer.uniqueId` out of `listPageViewerSlots`.)
 *
 * `application.getGlobalInfo()` is the surface that got this right, and the two guard
 * tests below pin it — both directions, because it is also what a screenshot cannot
 * settle: the chat panel swaps handles back to real names at render time
 * (`presentTextForUser`), so a correctly-anonymized reply and a leaking one look the
 * same to the eye. Assert on the API, not on the bubble.
 *
 * THE MASKING ASSERTIONS FAIL TODAY. That failure is the bug report; the fix is not
 * part of this file.
 *
 * The gate: these tests install `mayExposeSensitiveData()` on the scripting context —
 * the same chokepoint shape the viewer alias already uses (`setViewerIdAlias` /
 * `toPresentedViewerId` on `HostScriptContext`). A fix is free to compute that flag
 * however it likes (e.g. from the `__self__` grant of every `sensitive` namespace) as
 * long as the context answers the question; only `context()` below would change.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

/** Values a real deployment would carry. Every one of them identifies a person. */
const REAL_PATH = "/data/patients/2024/PID-9981_lung_HE.tiff";
const REAL_ID = "case-9981-lung-HE";
const REAL_NAME = "Lung (H&E) — PID-9981";
const STUDY_UID = "1.2.840.113619.2.55.3.PID9981.1";
const SERIES_UID = "1.2.840.113619.2.55.3.PID9981.2";
const TILE_SOURCE_ID = `dicomweb:https://pacs.hospital.local/studies/${STUDY_UID}/series/${SERIES_UID}`;

/** Everything that must never leave the host when sensitive data is denied. */
const IDENTIFIERS = [REAL_PATH, REAL_ID, REAL_NAME, STUDY_UID, SERIES_UID];

const BACKGROUND = { id: REAL_ID, name: REAL_NAME, dataReference: 0, visualizationIndex: 0 };

function makeViewer() {
    const source = {
        tileSourceId: TILE_SOURCE_ID,
        // The DICOM shape: technical fields at the top level, identifiers under imageInfo.
        getMetadata: () => ({
            micronsX: 0.504,
            micronsY: 0.504,
            imageInfo: {
                studyUID: STUDY_UID,
                seriesUID: SERIES_UID,
                frameOfReferenceUID: `${SERIES_UID}.999`,
                tileWidth: 512,
                tileHeight: 512,
            },
        }),
    };
    const item = {
        source,
        getConfig: (type) => (type === "background" ? BACKGROUND : { dataReference: 0 }),
        getContentSize: () => ({ x: 4096, y: 8192 }),
    };
    return {
        uniqueId: REAL_ID,
        world: { getItemCount: () => 1, getItemAt: (i) => (i === 0 ? item : null) },
        scalebar: { getReferencedTiledImage: () => item },
    };
}

function installGlobals() {
    globalThis.APPLICATION_CONTEXT = globalThis.window.APPLICATION_CONTEXT = {
        url: "http://localhost/",
        config: {
            data: [REAL_PATH],
            background: [BACKGROUND],
            visualizations: [{ name: "H&E", shaders: {} }],
        },
        getOption: (key, def) => (key === "activeBackgroundIndex" ? [0] : def),
    };
    globalThis.VIEWER_MANAGER = globalThis.window.VIEWER_MANAGER = { viewers: [makeViewer()] };
}
installGlobals();

const { XOpatApplicationScriptApi } = await import("../../../src/classes/scripting/app-api.ts");
const { XOpatVisualizationScriptApi } = await import("../../../src/classes/scripting/visualization-api.ts");

/**
 * A host scripting context.
 *
 * `alias` mimics chat's `full` posture: real viewer id → `viewer-1`, and the name masked
 * to the same handle. `sensitiveAllowed` is the consent answer the masking is gated on.
 */
function context({ alias = false, sensitiveAllowed = false } = {}) {
    const handles = new Map([[REAL_ID, "viewer-1"]]);
    const reverse = new Map([["viewer-1", REAL_ID]]);
    return {
        id: "test-context",
        getActiveViewerContextId: () => null,
        setActiveViewerContextId() {},
        isConsentDialogBypassed: () => true,
        setBypassConsentDialog() {},
        mayExposeSensitiveData: () => sensitiveAllowed,
        ...(alias ? {
            toPresentedViewerId: (id) => handles.get(id) ?? id,
            toInternalViewerId: (handle) => reverse.get(handle) ?? handle,
            presentViewerName: (realId) => handles.get(realId) ?? null,
        } : {}),
    };
}

const appApi = (opts) =>
    new XOpatApplicationScriptApi("application").bindInvocationContext({ scriptingContext: context(opts) });
const vizApi = (opts) =>
    new XOpatVisualizationScriptApi("visualization").bindInvocationContext({ scriptingContext: context(opts) });

/**
 * Fails naming the value that escaped, rather than "expected false to be true".
 * Sweeps the serialized payload so a field that merely MOVES is still caught.
 */
function expectNoIdentifiers(label, value) {
    const text = JSON.stringify(value ?? null);
    const leaked = IDENTIFIERS.filter((secret) => text.includes(secret));
    expect(`${label} leaked: ${leaked.join(" | ") || "nothing"}`).toBe(`${label} leaked: nothing`);
}

test("getGlobalInfo presents opaque handles when an alias is installed", () => {
    const [info] = appApi({ alias: true }).getGlobalInfo();

    expect(info.contextId).toBe("viewer-1");
    expect(info.imageName).toBe("viewer-1");
    expect(info.background.id).toBe("viewer-1");
    expectNoIdentifiers("getGlobalInfo", info);
});

test("getGlobalInfo is identity for local scripting (no alias installed)", () => {
    const [info] = appApi().getGlobalInfo();

    // The user inspecting their own data must keep seeing their own data.
    expect(info.contextId).toBe(REAL_ID);
    expect(info.imageName).toBe(REAL_NAME);
    expect(info.background.id).toBe(REAL_ID);
});

test("captureState does not hand out raw slide paths when sensitive data is denied", () => {
    const snapshot = vizApi({ alias: true }).captureState();

    // The array must stay the same length: `dataReference` is an index into it, and every
    // shader layer, background and describeData row is keyed by that index.
    expect(snapshot.data.length).toBe(1);
    expectNoIdentifiers("captureState().data", snapshot.data);
});

test("captureState returns real paths once sensitive data is consented", () => {
    const snapshot = vizApi({ alias: true, sensitiveAllowed: true }).captureState();

    // The gate is the consent, not a blanket redaction.
    expect(snapshot.data).toEqual([REAL_PATH]);
});

test("describeData masks the source id and tile-source id when sensitive data is denied", () => {
    const [entry] = vizApi({ alias: true }).describeData();

    // The join key the model actually needs survives untouched...
    expect(entry.dataReference).toBe(0);
    expect(entry.width).toBe(4096);
    // ...the identifiers do not.
    expectNoIdentifiers("describeData().dataId", entry.dataId);
    expectNoIdentifiers("describeData().tileSourceId", entry.tileSourceId);
});

test("describeData does not forward tile-source metadata identifiers", () => {
    const [entry] = vizApi({ alias: true }).describeData();

    // Technical calibration is the point of the field and must survive.
    expect(entry.metadata.micronsX).toBe(0.504);
    // `getMetadata()` is contracted as non-identifying (src/tile-source.ts) but DICOM puts
    // study/series UIDs there for the SR pipeline, so the scripting boundary cannot trust it.
    expectNoIdentifiers("describeData().metadata", entry.metadata);
});

test("describeData leaks nothing anywhere in its payload", () => {
    expectNoIdentifiers("describeData()", vizApi({ alias: true }).describeData());
});

test("describeData returns real ids once sensitive data is consented", () => {
    const [entry] = vizApi({ alias: true, sensitiveAllowed: true }).describeData();

    expect(entry.dataId).toBe(REAL_PATH);
    expect(entry.tileSourceId).toBe(TILE_SOURCE_ID);
    expect(entry.metadata.imageInfo.studyUID).toBe(STUDY_UID);
});
