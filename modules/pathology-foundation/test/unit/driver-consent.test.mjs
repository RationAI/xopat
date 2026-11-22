/**
 * Consent to send slide pixels is consent for ONE model, so the id asked about has to be the
 * id the walk uses.
 *
 * Three ways they used to differ:
 *  - `runPlan` asked about `edits.driver` (or the default) while the walk used the driver
 *    fixed at `planOverview`;
 *  - `refineOverview` asked nothing and forwarded whatever driver the script named;
 *  - `buildOverview` asked about the default as resolved at that moment, and the walk
 *    resolved it again per call — a driver registering meanwhile took over.
 *
 * The adapter is exercised against a stub engine: what is pinned here is which id reaches
 * the consent dialog and which id is handed on.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.$ = globalThis.$ ?? { t: (key) => String(key).split(".").pop() };

const VIEWER_ID = "viewer-1";

const { XOpatScriptingApi } = await import("../../../../src/classes/scripting/abstract-api.ts");
const { registerPathologyScriptingApi } = await import("../../scripting/api.ts");

/** A stub engine with two remote analyze drivers; `defaultId` is what an absent id resolves to. */
function makeEngine({ defaultId = "assistant", planDriver, overviewDriver } = {}) {
    const engine = {
        defaultId,
        calls: [],
        getStaticMeta: (_key, fallback) => fallback,
        getSlideContext: () => ({ stain: "H&E", organ: "Lung" }),
        describeDriverForFeature: (_feature, id) => {
            const resolved = id || engine.defaultId;
            if (!["assistant", "medgemma", "other"].includes(resolved)) {
                throw new Error(`Unknown pathology driver "${resolved}".`);
            }
            return { id: resolved, label: resolved, local: false, fallback: resolved === "assistant" };
        },
        planAnalyzeDriver: () => planDriver,
        overviewAnalyzeDriver: () => overviewDriver,
        runPlan: async (_viewer, planId, edits) => {
            engine.calls.push(["runPlan", planId, edits]);
            return { status: "ok" };
        },
        refineOverview: async (_viewer, options) => {
            engine.calls.push(["refineOverview", options]);
            return { status: "ok" };
        },
        analyzeRegion: async (_viewer, options) => {
            engine.calls.push(["analyzeRegion", options.driver]);
            return { findings: "ok" };
        },
        interrogateRegion: async (_viewer, options) => {
            engine.calls.push(["interrogateRegion", options.driver, options.analyzeDriver]);
            return { status: "ok" };
        },
    };
    return engine;
}

async function pathologyApi(engine) {
    globalThis.APPLICATION_CONTEXT = globalThis.window.APPLICATION_CONTEXT = {
        url: "http://localhost/", config: { data: [] }, Scripting: { getApi: () => null },
    };
    globalThis.VIEWER_MANAGER = globalThis.window.VIEWER_MANAGER = {
        viewers: [{ uniqueId: VIEWER_ID, world: { getItemCount: () => 0 } }],
    };
    globalThis.singletonModule = globalThis.window.singletonModule = () => engine;

    let register;
    globalThis.ScriptingManager = globalThis.window.ScriptingManager = {
        XOpatScriptingApi,
        registerExternalApi: (callback) => { register = callback; },
    };
    registerPathologyScriptingApi();

    let api;
    await register({ ingestApi: (instance) => { api = instance; } });
    const bound = api.bindInvocationContext({
        scriptingContext: {
            id: "test-context",
            getActiveViewerContextId: () => VIEWER_ID,
            activeViewerContextId: VIEWER_ID,
            setActiveViewerContextId() {},
            isConsentDialogBypassed: () => true,
            setBypassConsentDialog() {},
        },
    });
    const asked = [];
    bound.requireActionConsent = async (request) => { asked.push(request.cacheKey); };
    return { api: bound, asked };
}

test("runPlan asks about the driver the plan is pinned to, not the default @unit @security", async () => {
    // The plan was drawn up for medgemma; the deployment default is the assistant.
    const engine = makeEngine({ defaultId: "assistant", planDriver: "medgemma" });
    const { api, asked } = await pathologyApi(engine);

    await api.runPlan("p1");

    expect(asked).toEqual(["pathology:analyze:medgemma:overview"]);
    expect(engine.calls).toEqual([["runPlan", "p1", {}]]);
});

test("runPlan asks about the pinned driver even when the edit names another @unit @security", async () => {
    const engine = makeEngine({ planDriver: "medgemma" });
    const { api, asked } = await pathologyApi(engine);

    // The engine refuses the mismatch; what matters here is that consent was never
    // collected for a driver the walk would not use.
    await api.runPlan("p1", { driver: "other" });

    expect(asked).toEqual(["pathology:analyze:medgemma:overview"]);
});

test("runPlan on an expired plan asks nothing @unit", async () => {
    const engine = makeEngine({ planDriver: undefined });
    const { api, asked } = await pathologyApi(engine);

    await api.runPlan("gone");

    expect(asked).toEqual([]);
});

test("refineOverview asks again only when the driver changes @unit @security", async () => {
    const engine = makeEngine({ overviewDriver: "medgemma" });
    const { api, asked } = await pathologyApi(engine);

    await api.refineOverview({ addCalls: 4 });
    await api.refineOverview({ driver: "medgemma" });
    expect(asked, "continuing the approved walk must not prompt").toEqual([]);

    await api.refineOverview({ driver: "other" });
    expect(asked).toEqual(["pathology:analyze:other:overview"]);
});

test("refineOverview refuses an unknown driver before anything is sent @unit @security", async () => {
    const engine = makeEngine({ overviewDriver: "medgemma" });
    const { api } = await pathologyApi(engine);

    await expect(api.refineOverview({ driver: "nope" })).rejects.toThrow(/Unknown pathology driver/);
    expect(engine.calls).toEqual([]);
});

// Plugins register drivers asynchronously, and the consent dialog can stay open for a
// while. The id asked about must be the id used, even when the default moves meanwhile.
test("a driver registering during the consent dialog does not receive the pixels @unit @security", async () => {
    const engine = makeEngine({ defaultId: "assistant" });
    const { api, asked } = await pathologyApi(engine);
    api.requireActionConsent = async (request) => {
        asked.push(request.cacheKey);
        engine.defaultId = "medgemma";          // registered while the user was reading
    };

    await api.analyzeRegion("what is this");
    engine.defaultId = "assistant";
    await api.interrogateRegion({ x: 0, y: 0, width: 10, height: 10 }, {});

    expect(asked).toEqual(["pathology:analyze:assistant", "pathology:analyze:assistant:interrogate"]);
    expect(engine.calls).toEqual([
        ["analyzeRegion", "assistant"],
        // `driver` stays the caller's own (absent) option; the feature call is pinned.
        ["interrogateRegion", undefined, "assistant"],
    ]);
});
