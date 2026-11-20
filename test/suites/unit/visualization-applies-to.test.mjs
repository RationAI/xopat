/**
 * A visualization tagged with `backgrounds: [...]` belongs to those slides only.
 *
 * What these vectors pin:
 *  - the default selection (`migrateLegacyConfig` step 3) never binds a background
 *    to another slide's overlay — that is how a slide opened next to slide A used
 *    to render A's job masks;
 *  - untagged visualizations still apply everywhere (legacy sessions unchanged);
 *  - an explicit `null` ("no overlays") survives.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.APPLICATION_CONTEXT = {
    getOption: () => undefined,
    config: { data: [] },
    _dangerouslyAccessConfig: () => globalThis.APPLICATION_CONTEXT.config,
};
globalThis.UTILITIES = {
    sanitizeID: (id) => String(id).replace(/[^a-zA-Z0-9_:-]/g, "_"),
    generateID: (seed) => `gen-${String(seed).length}`,
};

const { BackgroundConfig } = await import("../../../src/classes/background-config.ts");

test("a tagged visualization applies only to its slides @unit", () => {
    const data = ["slideA", { dataID: "slideB" }];
    const viz = { backgrounds: ["slideA"] };
    expect(BackgroundConfig.visualizationAppliesTo(viz, { id: "a", dataReference: 0 }, data)).toBe(true);
    expect(BackgroundConfig.visualizationAppliesTo(viz, { id: "b", dataReference: 1 }, data)).toBe(false);
    expect(BackgroundConfig.visualizationAppliesTo({ backgrounds: ["b"] }, { id: "b", dataReference: 1 }, data)).toBe(true);
    expect(BackgroundConfig.visualizationAppliesTo({}, { id: "b", dataReference: 1 }, data)).toBe(true);
});

test("the default selection never binds another slide's overlay @unit", () => {
    const config = {
        data: ["slideA", "slideB", "slideC", "maskA", "maskB"],
        visualizations: [
            { name: "A", backgrounds: ["slideA"], shaders: {} },
            { name: "B", backgrounds: ["slideB"], shaders: {} },
        ],
        background: [
            { id: "a", dataReference: 0 },
            { id: "b", dataReference: 1 },
            { id: "c", dataReference: 2 },
            { id: "a2", dataReference: 0, visualizationIndex: null },
        ],
    };
    BackgroundConfig.migrateLegacyConfig(config);
    expect(config.background[0].visualizationIndex).toBe(0);
    expect(config.background[1].visualizationIndex).toBe(1);
    expect(config.background[2].visualizationIndex).toBe(undefined);
    expect(config.background[3].visualizationIndex).toBe(null);
});

test("untagged visualizations keep the first-visualization default @unit", () => {
    const config = {
        data: ["slideA", "slideB"],
        visualizations: [{ name: "any", shaders: {} }],
        background: [{ id: "a", dataReference: 0 }, { id: "b", dataReference: 1 }],
    };
    BackgroundConfig.migrateLegacyConfig(config);
    expect(config.background.map(bg => bg.visualizationIndex)).toEqual([0, 0]);
});
