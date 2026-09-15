/**
 * `background[i].fill` is the per-background canvas clear color — the override of
 * the session-wide `setup.backgroundColor`.
 *
 * What these vectors pin:
 *  - only a hex literal reaches the renderer. `setBackground` accepts anything and
 *    silently clears to transparent on a value it cannot parse, so a typo ("black",
 *    "rgb(0,0,0)") must be refused HERE and fall back, not blank the viewport;
 *  - an entry without `fill` resolves to the session default, which is what makes
 *    switching away from a `fill`-carrying slide restore the deployment backdrop
 *    instead of keeping the previous slide's color;
 *  - a virtualized parent's `fill` is inherited by its expanded children — a crop
 *    of a slide renders on the same backdrop as the slide.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

let sessionDefault = null;
globalThis.APPLICATION_CONTEXT = {
    getOption: (key) => (key === "backgroundColor" ? sessionDefault : undefined),
    config: { data: [] },
    _dangerouslyAccessConfig: () => globalThis.APPLICATION_CONTEXT.config,
};
globalThis.UTILITIES = {
    sanitizeID: (id) => String(id).replace(/[^a-zA-Z0-9_:-]/g, "_"),
    generateID: (seed) => `gen-${String(seed).length}`,
};

const { BackgroundConfig } = await import("../../../src/classes/background-config.ts");

test("fill accepts every hex form and refuses everything else @unit", () => {
    for (const value of ["#000", "#0000", "#00ff00", "#00ff0080", "  #ABCDEF  "]) {
        expect(BackgroundConfig.fillColor({ fill: value })).toBe(value.trim());
    }
    for (const value of ["black", "rgb(0,0,0)", "#12345", "", "   ", "#gggggg", 0x000000, null]) {
        expect(BackgroundConfig.fillColor({ fill: value })).toBe(undefined);
    }
    expect(BackgroundConfig.fillColor(undefined)).toBe(undefined);
});

test("an entry without a usable fill falls back to the session default @unit", () => {
    sessionDefault = "#101010";
    expect(BackgroundConfig.resolveFillColor({})).toBe("#101010");
    // Malformed is the same as absent — never passed through.
    expect(BackgroundConfig.resolveFillColor({ fill: "black" })).toBe("#101010");
    expect(BackgroundConfig.resolveFillColor({ fill: "#fff" })).toBe("#fff");

    sessionDefault = null;
    expect(BackgroundConfig.resolveFillColor({})).toBe(undefined);
    expect(BackgroundConfig.resolveFillColor({ fill: "#fff" })).toBe("#fff");
});

test("expanded virtual children inherit the parent's fill @unit", () => {
    const config = {
        data: ["slide.tiff"],
        background: [{
            id: "parent",
            dataReference: 0,
            fill: "#0b0b0b",
            virtualization: {
                regions: [
                    { id: "left", region: { x: 0, y: 0, w: 0.5, h: 1 }, transform: {} },
                    { id: "right", region: { x: 0.5, y: 0, w: 0.5, h: 1 }, transform: {} },
                ],
            },
        }],
    };
    globalThis.APPLICATION_CONTEXT.config = config;

    BackgroundConfig.expandVirtualBackgrounds(config);

    const children = config.background.filter((bg) => bg.virtualOf === "parent");
    expect(children.length).toBe(2);
    for (const child of children) {
        expect(child.fill).toBe("#0b0b0b");
    }
});
