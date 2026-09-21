/**
 * `getMethodManifest` is what the chat host turns into the "Exact signatures of the API
 * methods your script referenced" block after a failed script — the model's only
 * correction channel.
 *
 * It used to answer every miss with a bare `found: false`, which the host rendered as
 * "DOES NOT EXIST — do not retry it". That sentence conflated two opposite situations
 * and answered neither:
 *
 *  - The right verb on the wrong namespace. A session asked for a questionnaire with a
 *    recorded tour; the model called `recorder.bindPageTour` (it lives on
 *    `questionnaire`), was told it does not exist, and retried the same wrong namespace
 *    three times because nothing said where the method actually was.
 *  - A method that exists but whose namespace this session was not granted. Telling the
 *    model it "does not exist" is simply false, and it never tries again — even after the
 *    user grants the namespace mid-session, which is exactly what happened here.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.window.APPLICATION_CONTEXT = globalThis.window.APPLICATION_CONTEXT ?? {
    getOption: (key, def) => def,
};

const { ScriptingManager } = await import("../../../src/classes/scripting-manager.ts");

/**
 * A manager stub carrying only the namespace schemas — `getMethodManifest` reads nothing
 * else, and building a real manager would need the whole app.
 */
function managerWith(namespaces) {
    const manager = Object.create(ScriptingManager.prototype);
    manager.namespaces = namespaces;
    return manager;
}

/** The shape `ingestApi` stores: method flags plus the doc side-tables. */
function namespace(methods, { self = true, signatures = {}, docs = {} } = {}) {
    const schema = { __self__: self, name: "ns", description: "" , _docs: docs, tsSignature: signatures };
    for (const [name, granted] of Object.entries(methods)) schema[name] = granted;
    return schema;
}

const NAMESPACES = {
    recorder: namespace(
        { createRecording: true, captureFrame: true },
        { signatures: { createRecording: "createRecording(name?: string): RecordingInfo" } },
    ),
    questionnaire: namespace(
        { setSchema: true, bindPageTour: true, listPageViewerSlots: true },
        {
            signatures: {
                bindPageTour: "bindPageTour(pageRef: string | number, opts?: { autoplay?: boolean }): Promise<object>",
            },
            docs: { bindPageTour: "Capture the viewer setup AND bind every viewer's active tour." },
        },
    ),
};

test("a method on the wrong namespace names the namespace that owns it", () => {
    const [entry] = managerWith(NAMESPACES).getMethodManifest([
        { namespace: "recorder", method: "bindPageTour" },
    ]);

    expect(entry.found).toBe(false);
    expect(entry.reason).toBe("unknown");
    expect(entry.availableOn).toEqual([{
        namespace: "questionnaire",
        tsSignature: "bindPageTour(pageRef: string | number, opts?: { autoplay?: boolean }): Promise<object>",
        description: "Capture the viewer setup AND bind every viewer's active tour.",
    }]);
    // The miss itself still carries no docs for the namespace that was asked about.
    expect(entry.tsSignature).toBeUndefined();
});

test("a method that exists nowhere reports no owner", () => {
    const [entry] = managerWith(NAMESPACES).getMethodManifest([
        { namespace: "recorder", method: "frobnicate" },
    ]);
    expect(entry.found).toBe(false);
    expect(entry.reason).toBe("unknown");
    expect(entry.availableOn).toBeUndefined();
});

test("an ungranted namespace is never suggested as an owner", () => {
    // `questionnaire` owns the method but the session may not call it.
    const gated = {
        recorder: NAMESPACES.recorder,
        questionnaire: namespace({ bindPageTour: false }, { self: false }),
    };
    const [entry] = managerWith(gated).getMethodManifest([
        { namespace: "recorder", method: "bindPageTour" },
    ]);
    expect(entry.found).toBe(false);
    expect(entry.availableOn).toBeUndefined();
});

test("a real but ungranted method is reported as not-consented, not as missing", () => {
    const gated = { questionnaire: namespace({ bindPageTour: false }, { self: false }) };
    const [entry] = managerWith(gated).getMethodManifest([
        { namespace: "questionnaire", method: "bindPageTour" },
    ]);
    expect(entry.found).toBe(false);
    expect(entry.reason).toBe("not-consented");
    // Still no documentation: the consent boundary is unchanged.
    expect(entry.tsSignature).toBeUndefined();
    expect(entry.description).toBeUndefined();
});

test("a granted method still returns its documentation", () => {
    const [entry] = managerWith(NAMESPACES).getMethodManifest([
        { namespace: "recorder", method: "createRecording" },
    ]);
    expect(entry.found).toBe(true);
    expect(entry.tsSignature).toBe("createRecording(name?: string): RecordingInfo");
    expect(entry.reason).toBeUndefined();
    expect(entry.availableOn).toBeUndefined();
});

test("an unknown namespace is a plain miss", () => {
    const [entry] = managerWith(NAMESPACES).getMethodManifest([
        { namespace: "nosuchns", method: "createRecording" },
    ]);
    expect(entry.found).toBe(false);
    expect(entry.reason).toBe("unknown");
    // …but the method name does exist elsewhere, so the caller is pointed there.
    expect(entry.availableOn?.[0]?.namespace).toBe("recorder");
});
