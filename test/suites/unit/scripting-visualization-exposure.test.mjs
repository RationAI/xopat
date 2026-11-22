/**
 * What a script can reach in the `visualization` namespace.
 *
 * `ingestApi` exposes every own-prototype method whose name does not start with `_`.
 * TypeScript `protected` is erased at runtime and the `.d.ts` only documents, so an
 * "internal" helper without the underscore is a public scripting method. Five of them
 * returned exactly what their public wrappers exist to guard: slide pixels without the
 * pixel-read consent, raw data paths without the sensitive mask, and a state write
 * without the review step.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.$ = globalThis.$ ?? { t: (key) => String(key).split(".").pop() };

const { XOpatVisualizationScriptApi } = await import("../../../src/classes/scripting/visualization-api.ts");

/**
 * The rule `ScriptingManager.ingestApi` applies (src/classes/scripting-manager.ts). Read
 * through descriptors: the prototype carries getters that need a live renderer.
 */
const exposed = Object.entries(Object.getOwnPropertyDescriptors(XOpatVisualizationScriptApi.prototype))
    .filter(([name, descriptor]) => name !== "constructor" && !name.startsWith("_")
        && typeof descriptor.value === "function")
    .map(([name]) => name);

const GUARDED_HELPERS = [
    "regionPngDetailed",
    "activeBackgroundEntry",
    "activeBackgroundSnapshot",
    "buildVisualizationStateSnapshot",
    "applyVisualizationStateSnapshot",
];

test("unchecked helpers are not script-callable @unit @security", () => {
    for (const name of GUARDED_HELPERS) {
        expect(exposed, `${name} must stay behind its checked public wrapper`).not.toContain(name);
        expect(typeof XOpatVisualizationScriptApi.prototype[`_${name}`], `_${name} should exist`).toBe("function");
    }
    // The checked entry points are what a script gets instead.
    for (const name of ["renderRegionPng", "getBackgroundShaders", "captureState", "restoreState"]) {
        expect(exposed).toContain(name);
    }
});

test("extractCurrentFirstPassLayer asks for pixel-read consent before reading @unit @security", async () => {
    const order = [];
    const self = {
        activeViewer: { drawer: { renderer: {} } },
        requirePixelReadConsent: async () => {
            order.push("consent");
            throw new Error("declined");
        },
        getCurrentStandaloneDrawer: () => {
            order.push("drawer");
            return { extract: async () => new Uint8Array(4), renderer: { canvas: { width: 1, height: 1 } } };
        },
    };

    await expect(XOpatVisualizationScriptApi.prototype.extractCurrentFirstPassLayer.call(self, {}))
        .rejects.toThrow("declined");
    expect(order, "nothing may be read once consent is declined").toEqual(["consent"]);
});
