/**
 * One patient per study, even when two viewers are open.
 *
 * `before-open` is raised once per viewer and this plugin answers it without
 * awaiting, so a multi-viewport open of two studies puts two study QIDOs in
 * flight against one cache at the same time. While that cache was a single
 * `activePatientDetails` slot, whichever query resolved last won it — and
 * because the TileSource accessor resolves lazily at call time, the OTHER
 * viewer's source then reported that patient.
 *
 * That is not only a wrong card. The same record is what
 * `_resolveDicomSlide` hands to the SR writer, which stamps it into
 * `PatientID`/`PatientName` (`annotation-convertor.mjs`) — so the losing viewer
 * could STOW a report carrying one patient's identifiers against another
 * patient's study. These tests pin the isolation at both ends: the accessor a
 * source carries, and the record the SR path reads.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.OpenSeadragon = globalThis.OpenSeadragon || { TileSource: class {} };
globalThis.HTTPError = globalThis.HTTPError || class HTTPError extends Error {};
globalThis.XOpatPlugin = globalThis.XOpatPlugin || class {};
globalThis.VIEWER_MANAGER = globalThis.VIEWER_MANAGER || { addHandler() {} };
globalThis.APPLICATION_CONTEXT = globalThis.APPLICATION_CONTEXT || { config: {} };
// The accessor logs through the broker when a source arrives without a study.
globalThis.APPLICATION_CONTEXT.log = globalThis.APPLICATION_CONTEXT.log
    || (() => ({ error() {}, warn() {}, info() {}, debug() {}, trace() {} }));
globalThis.window = globalThis.window || globalThis;
globalThis.window.SLIDE_PROTOCOLS = globalThis.window.SLIDE_PROTOCOLS || { register() {} };

let Captured = null;
const previousAddPlugin = globalThis.addPlugin;
globalThis.addPlugin = (id, cls) => {
    if (id === "dicom") Captured = cls;
    previousAddPlugin?.(id, cls);
};

// A distinct specifier, so this gets its own module instance.
//
// Suites share a worker and the plugin registers itself as an import side
// effect, which fires once per module instance. Every sibling here installs an
// `addPlugin` stub and imports the plain path — so whichever file ran first
// consumed the registration and the rest captured `null`. Importing under a
// unique specifier takes this file out of that race instead of joining it.
await import("../../index.workspace.mjs?patient-study-isolation");

globalThis.addPlugin = previousAddPlugin;

const STUDY_A = "1.2.840.999.1";
const STUDY_B = "1.2.840.999.2";
const PATIENT_A = { patientID: "PID-0001", name: "PATIENT^A", sex: "F", birthDate: "19700101" };
const PATIENT_B = { patientID: "PID-0002", name: "PATIENT^B", sex: "M", birthDate: "19800202" };

/**
 * The plugin with only the state these paths touch. Built off the prototype so
 * the methods under test are the real ones, not re-implementations.
 */
function plugin({ patients = [] } = {}) {
    const p = Object.create(Captured.prototype);
    p.state = {
        seriesByStudy: new Map(),
        patientByStudy: new Map(patients),
        studyDetailsByUID: new Map(),
    };
    return p;
}

/** A viewer whose slide reports `studyUID`, the shape `_resolveDicomSlide` reads. */
function viewerShowing(studyUID) {
    const source = {
        getMetadata: () => ({
            imageInfo: {
                studyUID,
                seriesUID: `${studyUID}.1`,
                frameOfReferenceUID: `${studyUID}.frame`,
            },
        }),
    };
    return { scalebar: { getReferencedTiledImage: () => ({ source }) } };
}

test("each study's accessor resolves its own patient, whatever landed last", () => {
    const p = plugin();
    // Two sources built before either query answered — the real order, since
    // `before-open` does not await the study context.
    const forA = p.patientAccessorFor(STUDY_A);
    const forB = p.patientAccessorFor(STUDY_B);

    expect(forA()).toBe(null);
    expect(forB()).toBe(null);

    // B answers first, then A. A single slot would now hold A for both.
    p.state.patientByStudy.set(STUDY_B, PATIENT_B);
    p.state.patientByStudy.set(STUDY_A, PATIENT_A);

    expect(forA().patientID).toBe(PATIENT_A.patientID);
    expect(forB().patientID).toBe(PATIENT_B.patientID);
});

test("a study with no patient yet reports nothing, never another study's", () => {
    const p = plugin({ patients: [[STUDY_B, PATIENT_B]] });

    // The failure this replaces: A's source borrowing B's patient because B is
    // simply what the plugin last saw.
    expect(p.patientAccessorFor(STUDY_A)()).toBe(null);
    expect(p.patientAccessorFor(STUDY_B)().patientID).toBe(PATIENT_B.patientID);
});

test("a source built without a study resolves nothing rather than guessing", () => {
    const p = plugin({ patients: [[STUDY_A, PATIENT_A]] });

    expect(p.patientAccessorFor(undefined)()).toBe(null);
    expect(p.patientAccessorFor("")()).toBe(null);
});

test("the SR path reads the patient of the viewer's own study", () => {
    const p = plugin({ patients: [[STUDY_A, PATIENT_A], [STUDY_B, PATIENT_B]] });

    const a = p._resolveDicomSlide(viewerShowing(STUDY_A));
    const b = p._resolveDicomSlide(viewerShowing(STUDY_B));

    // What `annotation-convertor` stamps into PatientID / PatientName.
    expect(a.meta.patient.patientID).toBe(PATIENT_A.patientID);
    expect(a.meta.patient.name).toBe(PATIENT_A.name);
    expect(b.meta.patient.patientID).toBe(PATIENT_B.patientID);
    expect(b.meta.patient.name).toBe(PATIENT_B.name);
});

test("an unknown study yields no patient, so an SR cannot inherit one", () => {
    const p = plugin({ patients: [[STUDY_A, PATIENT_A]] });

    const slide = p._resolveDicomSlide(viewerShowing(STUDY_B));

    // Null is what the convertor turns into "ANONYMOUS"; a wrong PatientID is
    // the outcome worth failing over.
    expect(slide.meta.patient).toBe(null);
});

test("getPatientDetails and getStudyDetails answer per study", () => {
    const p = plugin({ patients: [[STUDY_A, PATIENT_A]] });
    p.state.studyDetailsByUID.set(STUDY_A, { studyUID: STUDY_A, description: "Study A" });

    expect(p.getPatientDetails(STUDY_A).patientID).toBe(PATIENT_A.patientID);
    expect(p.getPatientDetails(STUDY_B)).toBe(null);
    expect(p.getStudyDetails(STUDY_A).description).toBe("Study A");
    expect(p.getStudyDetails(STUDY_B)).toBe(null);
});
