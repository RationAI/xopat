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

test("the declaration is the allowlist: an undeclared helper is not script-callable @unit @security", async () => {
    const { readFileSync } = await import("node:fs");
    const { ScriptingManager, scriptCallableMethodNames } = await import("../../../src/classes/scripting-manager.ts");

    // The real parser over the real declaration, as `ingestApi` runs it.
    const dts = readFileSync(new URL("../../../src/classes/scripting/visualization-api.scripts.d.ts", import.meta.url), "utf8");
    const api = Object.create(XOpatVisualizationScriptApi.prototype);
    const parsed = Object.create(ScriptingManager.prototype).parseDtsForApi(api, dts);
    const { exposed, withheld } = scriptCallableMethodNames(api, Object.keys(parsed.tsSignature));

    // No underscore, never declared: helpers that hand out canvases, pixels and raw configuration.
    for (const name of ["extractRegionCanvas", "extractBackgroundCanvas", "readCanvasPixels", "harvestBackgroundConfiguration"]) {
        expect(typeof XOpatVisualizationScriptApi.prototype[name], `${name} should exist`).toBe("function");
        expect(exposed).not.toContain(name);
        expect(withheld).toContain(name);
    }
    for (const name of ["renderRegionPng", "getBackgroundShaders", "captureState", "restoreState"]) {
        expect(exposed).toContain(name);
    }
    // Everything exposed is declared, and nothing declared was lost to the filter.
    expect(exposed.every(name => name in parsed.tsSignature)).toBe(true);
    expect(Object.keys(parsed.tsSignature).filter(name => typeof XOpatVisualizationScriptApi.prototype[name] === "function" && !Object.getOwnPropertyDescriptor(XOpatVisualizationScriptApi.prototype, name)?.get).sort())
        .toEqual([...exposed].sort());
});

test("without a declaration the underscore convention still applies @unit @security", async () => {
    const { scriptCallableMethodNames } = await import("../../../src/classes/scripting-manager.ts");
    class Api { open() {} helper() {} _hidden() {} }
    expect(scriptCallableMethodNames(new Api()).exposed.sort()).toEqual(["helper", "open"]);
    expect(scriptCallableMethodNames(new Api(), ["open"])).toEqual({ exposed: ["open"], withheld: ["helper"] });
});
