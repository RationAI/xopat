/**
 * Toolbar shape picking with locked presets.
 *
 * `enablePresetModify: false` locks the classes, not the drawing tool. The toolbar's
 * shape picker routes through `switchModeActive('custom', factoryId)`, which sets the
 * module's active factory and never writes into a preset: the shape is a tool choice,
 * the preset's own factory only a deprecated default.
 *
 * Pure mixin-level assertions against a hand-rolled `context`, no canvas and no browser.
 */
import { test, expect, installVan } from "@xopat/test-harness";

let presetMethods, navigationMethods;
const globalsBackup = {};
let dom;

test.beforeAll(async () => {
    // presets.mjs and presetCard.mjs read van.tags and UI.BaseComponent at module load.
    dom = await installVan();
    globalsBackup.UI = globalThis.UI;
    globalThis.UI = { BaseComponent: class {} };
    ({ presetMethods } = await import("../../methods/presets.mjs"));
    ({ navigationMethods } = await import("../../methods/navigation.mjs"));
});

test.afterAll(() => {
    dom?.restore();
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
        activeFactory: left.objectFactory,
        getActiveFactory() { return this.activeFactory; },
        setActiveFactory(id) {
            this.activeFactory = factory(id);
            this.raiseEvent("active-factory-change", { factory: this.activeFactory });
        },
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

test("toolbar shape pick swaps the tool, not the preset, even with presets locked", { tag: ["@unit"] }, () => {
    const context = fakeContext();
    const plugin = fakePlugin(context);

    plugin.switchModeActive("custom", "ellipse", true);

    expect(context.getActiveFactory().factoryID, "canvas draws what the toolbar shows").toBe("ellipse");
    expect(context.presets.left.objectFactory.factoryID, "the class keeps its default").toBe("polygon");
    expect(context.events.map(e => e.name)).toEqual(["active-factory-change"]);
});

test("locked presets still refuse class edits", { tag: ["@unit"] }, () => {
    const context = fakeContext();
    const plugin = fakePlugin(context);

    plugin.updatePresetWith("p1", "color", "#0f0");

    expect(context.presets.left.color).toBe("#f00");
    expect(context.updatePresetCalls).toHaveLength(0);
    expect(context.events).toHaveLength(0);
});

test("a preset's factory is not editable from the UI, locked or not", { tag: ["@unit"] }, () => {
    for (const enablePresetModify of [false, true]) {
        const context = fakeContext();
        const plugin = Object.assign(fakePlugin(context), { enablePresetModify });

        plugin.updatePresetWith("p1", "objectFactory", "ellipse");

        expect(context.presets.left.objectFactory.factoryID).toBe("polygon");
        expect(context.updatePresetCalls).toHaveLength(0);
        expect(context.events).toHaveLength(0);
    }
});
