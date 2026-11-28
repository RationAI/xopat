/**
 * Binding a class to a mouse button.
 *
 * Every surface (side panel, toolbar picker, class editor, canvas context menu)
 * goes through `_bindPreset`. Two things it must get right:
 *
 *   - a class picked by ID binds to a button that has nothing bound yet. The old
 *     code compared `presetID` of an id *string* against the unbound button's
 *     `undefined`, concluded "already active" and unbound instead;
 *   - a plain click on the class that is already active is not a request to
 *     release it. Only the explicit bind button toggles.
 *
 * Pure mixin-level assertions against a hand-rolled `context`.
 */
import { test, expect, installVan } from "@xopat/test-harness";

let presetMethods;
const globalsBackup = {};
let dom;

test.beforeAll(async () => {
    // presets.mjs and its components read van.tags and UI.BaseComponent at module load.
    dom = await installVan();
    globalsBackup.UI = globalThis.UI;
    globalThis.UI = { BaseComponent: class {} };
    ({ presetMethods } = await import("../../methods/presets.mjs"));
});

test.afterAll(() => {
    dom?.restore();
    for (const [key, value] of Object.entries(globalsBackup)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
    }
});

function fakePlugin({ left, right } = {}) {
    const presets = new Map(["a", "b"].map(id => [id, { presetID: id }]));
    const bound = { true: presets.get(left), false: presets.get(right) };
    const context = {
        disabledInteraction: false,
        calls: [],
        presets: { get: (id) => presets.get(id) },
        getPreset: (isLeft) => bound[!!isLeft],
        setPreset(preset, isLeft) {
            this.calls.push([preset?.presetID, isLeft]);
            bound[!!isLeft] = preset;
        },
    };
    return Object.assign({ context }, presetMethods);
}

test("a class picked by id binds to a button with nothing bound", { tag: ["@unit"] }, () => {
    const plugin = fakePlugin();
    // The canvas context menu stores the picked id, then asks for the bind.
    plugin._presetSelection = "a";

    plugin._clickPresetSelect(true);
    plugin._clickPresetSelect(false, "b");

    expect(plugin.context.calls).toEqual([["a", true], ["b", false]]);
});

test("clicking the active class again does not unbind it", { tag: ["@unit"] }, () => {
    const plugin = fakePlugin({ left: "a" });

    expect(plugin._bindPreset("a", true)).toBe(false);
    expect(plugin.context.calls).toEqual([]);
});

test("the explicit bind button releases the binding", { tag: ["@unit"] }, () => {
    const plugin = fakePlugin({ left: "a" });

    expect(plugin._bindPreset("a", true, { toggle: true })).toBe(true);
    expect(plugin.context.calls).toEqual([[undefined, true]]);
});

test("each mouse button is bound on its own", { tag: ["@unit"] }, () => {
    const plugin = fakePlugin({ left: "a" });

    plugin._bindPreset("a", false);
    plugin._bindPreset("b", true);

    expect(plugin.context.calls).toEqual([["a", false], ["b", true]]);
});

test("nothing binds without a class, an unknown class, or with annotations disabled", { tag: ["@unit"] }, () => {
    const plugin = fakePlugin();

    expect(plugin._bindPreset(undefined, true)).toBe(false);
    expect(plugin._bindPreset("missing", true)).toBe(false);
    plugin.context.disabledInteraction = true;
    expect(plugin._bindPreset("a", true)).toBe(false);

    expect(plugin.context.calls).toEqual([]);
});
