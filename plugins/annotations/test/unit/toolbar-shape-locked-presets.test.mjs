/**
 * Toolbar shape picking with locked presets.
 *
 * `enablePresetModify: false` locks the classes, not the drawing tool. The toolbar's
 * shape picker routes through `switchModeActive('custom', factoryId)`, which used to
 * swap the factory via `updatePresetWith` — gated on the lock, so the toolbar showed
 * the new shape while the canvas kept drawing the preset's old one.
 *
 * Pure mixin-level assertions against a hand-rolled `context`, no canvas and no browser.
 */
import { test, expect } from "@xopat/test-harness";

let presetMethods, navigationMethods;
const globalsBackup = {};

test.beforeAll(async () => {
    // presets.mjs and presetCard.mjs read van.tags and UI.BaseComponent at module load.
    globalsBackup.van = globalThis.van;
    globalsBackup.UI = globalThis.UI;
    globalThis.van = { tags: new Proxy({}, { get: () => () => null }) };
    globalThis.UI = { BaseComponent: class {} };
    ({ presetMethods } = await import("../../methods/presets.mjs"));
    ({ navigationMethods } = await import("../../methods/navigation.mjs"));
});

test.afterAll(() => {
    for (const [key, value] of Object.entries(globalsBackup)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
    }
});

/** The slice of `OSDAnnotations` the shape swap touches. */
function fakeContext() {
    const factories = new Map();
    const factory = (id) => {
        if (!factories.has(id)) factories.set(id, { factoryID: id });
        return factories.get(id);
    };
    const left = { presetID: "p1", objectFactory: factory("polygon"), color: "#f00" };
    let modeId = "auto";

    return {
        events: [],
        updatePresetCalls: [],
        mode: { getId: () => modeId, _lastUsed: null },
        presets: {
            left,
            get: (id) => (id === left.presetID ? left : undefined),
            getActivePreset: (isLeft) => (isLeft ? left : undefined),
            updatePreset(id, props) { this.owner.updatePresetCalls.push({ id, props }); },
        },
        getAnnotationObjectFactory: factory,
        raiseEvent(name, payload) { this.events.push({ name, payload }); },
        setModeById(id) { modeId = id; },
    };
}

function fakePlugin(context) {
    context.presets.owner = context;
    return Object.assign({}, presetMethods, navigationMethods, {
        context,
        enablePresetModify: false,
        updatePresetsHTML() {},   // the preset panel DOM is out of scope here
    });
}

test("toolbar shape pick swaps the factory even with presets locked", { tag: ["@unit"] }, () => {
    const context = fakeContext();
    const plugin = fakePlugin(context);

    plugin.switchModeActive("custom", "ellipse", true);

    expect(context.presets.left.objectFactory.factoryID, "canvas draws what the toolbar shows").toBe("ellipse");
    expect(context.events.map(e => e.name)).toContain("preset-update");
});

test("locked presets still refuse class edits", { tag: ["@unit"] }, () => {
    const context = fakeContext();
    const plugin = fakePlugin(context);

    plugin.updatePresetWith("p1", "color", "#0f0");

    expect(context.presets.left.color).toBe("#f00");
    expect(context.updatePresetCalls).toHaveLength(0);
    expect(context.events).toHaveLength(0);
});

test("the preset card's shape dropdown stays locked", { tag: ["@unit"] }, () => {
    const context = fakeContext();
    const plugin = fakePlugin(context);

    plugin.updatePresetWith("p1", "objectFactory", "ellipse");

    expect(context.presets.left.objectFactory.factoryID).toBe("polygon");
    expect(context.events).toHaveLength(0);
});
