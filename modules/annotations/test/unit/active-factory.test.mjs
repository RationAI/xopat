/**
 * The drawing tool (active factory) is independent of the active preset (class).
 *
 * A preset used to *be* the tool: every click read `preset.objectFactory`, so picking
 * another class silently changed the shape being drawn. The tool is now module state;
 * a preset's factory is only a deprecated default that seeds it once.
 *
 * Pure assertions on the two module methods against a hand-rolled `this`.
 */
import { test, expect, fromRoot, installBrowserGlobals, loadBrowserScript } from "@xopat/test-harness";

let shim;
let A;

const FACTORIES = Object.fromEntries(["polygon", "point", "rect"].map(id => [id, { factoryID: id }]));

/** The slice of the module `getActiveFactory` / `setActiveFactory` touch. */
function fakeModule({ cached, left, right } = {}) {
    const store = new Map(cached ? [["tool.factory", cached]] : []);
    const module = {
        events: [],
        store,
        cache: { get: (key) => store.get(key), set: (key, value) => store.set(key, value) },
        polygonFactory: FACTORIES.polygon,
        presets: {
            left, right,
            getActivePreset(isLeft) { return isLeft ? this.left : this.right; },
        },
        getAnnotationObjectFactory: (id) => FACTORIES[id],
        raiseEvent(name, payload) { this.events.push({ name, payload }); },
    };
    module.getActiveFactory = A.prototype.getActiveFactory;
    module.setActiveFactory = A.prototype.setActiveFactory;
    return module;
}

const preset = (factoryID) => ({ objectFactory: FACTORIES[factoryID] });

test.beforeAll(async () => {
    shim = installBrowserGlobals({
        extra: {
            XOpatModuleSingleton: class {},
            XOpatHistory: { XOpatHistoryProvider: class {} },
            addModule: () => {},
        },
    });
    A = await loadBrowserScript(fromRoot("modules", "annotations", "annotations.js"), "OSDAnnotations");
});

test.afterAll(() => shim?.restore());

test("selecting another class does not change the tool", { tag: ["@unit"] }, () => {
    const module = fakeModule({ left: preset("point") });
    expect(module.getActiveFactory().factoryID, "the first preset's default seeds the tool").toBe("point");

    module.presets.left = preset("polygon");
    expect(module.getActiveFactory().factoryID).toBe("point");
    expect(module.getActiveFactory(false).factoryID, "both buttons share the tool").toBe("point");
});

test("an explicit tool wins over the preset default and is remembered", { tag: ["@unit"] }, () => {
    const module = fakeModule({ left: preset("polygon") });

    expect(module.setActiveFactory("rect")).toBe(true);
    expect(module.getActiveFactory().factoryID).toBe("rect");
    expect(module.store.get("tool.factory")).toBe("rect");
    expect(module.events.map(e => e.name)).toEqual(["active-factory-change"]);

    module.setActiveFactory(FACTORIES.rect);
    expect(module.events, "no event without a change").toHaveLength(1);
    expect(module.setActiveFactory("nonexistent")).toBe(false);
    expect(module.getActiveFactory().factoryID).toBe("rect");
});

test("the tool of the last session outranks the preset default", { tag: ["@unit"] }, () => {
    const module = fakeModule({ cached: "rect", left: preset("point") });
    expect(module.getActiveFactory().factoryID).toBe("rect");
});

test("an unknown cached tool falls through to the preset default", { tag: ["@unit"] }, () => {
    const module = fakeModule({ cached: "retired-shape", left: preset("point") });
    expect(module.getActiveFactory().factoryID).toBe("point");
});

test("with no preset the answer is polygon, and a later preset still seeds the tool", { tag: ["@unit"] }, () => {
    const module = fakeModule();
    expect(module.getActiveFactory().factoryID).toBe("polygon");

    module.presets.right = preset("point");
    expect(module.getActiveFactory().factoryID, "falls back to the other button's preset").toBe("point");
});
