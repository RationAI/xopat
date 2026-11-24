/**
 * Class slot shortcuts: slot N addresses the Nth annotation class, resolved at press time.
 *
 * "select" activates the class for the left mouse button; "assign" relabels the
 * annotations selected in the viewer the stroke came from and leaves the active class
 * alone. Pure mixin-level assertions against a hand-rolled `context`.
 */
import { test, expect } from "@xopat/test-harness";
import { classSlotMethods } from "../../methods/classSlots.mjs";

function fakeFabric(selected) {
    return {
        changed: [],
        getSelectedAnnotations: () => selected,
        changeAnnotationPreset(annotation, presetID) {
            this.changed.push([annotation.id, presetID]);
            annotation.presetID = presetID;
            return true;
        },
    };
}

function fakePlugin(presetIds, fabrics = new Map()) {
    const presets = new Map(presetIds.map(id => [id, { presetID: id }]));
    const context = {
        disabledInteraction: false,
        setPresetCalls: [],
        presets: {
            getExistingIds: () => presets.keys(),
            get: (id) => presets.get(id),
        },
        setPreset(preset, isLeft) { this.setPresetCalls.push([preset.presetID, isLeft]); },
        getFabric: (viewer) => fabrics.get(viewer),
    };
    return Object.assign({ context }, classSlotMethods);
}

test("class slot select activates the Nth class for the left button", { tag: ["@unit"] }, () => {
    const plugin = fakePlugin(["a", "b", "c"]);
    plugin._selectClassSlot(1);
    expect(plugin.context.setPresetCalls).toEqual([["b", true]]);
});

test("class slot select on an empty slot does nothing", { tag: ["@unit"] }, () => {
    const plugin = fakePlugin(["a"]);
    plugin._selectClassSlot(1);
    plugin._selectClassSlot(-1);
    plugin._selectClassSlot(9);
    expect(plugin.context.setPresetCalls).toEqual([]);
});

test("class slot assign relabels only differing annotations of the stroke's viewer", { tag: ["@unit"] }, () => {
    const viewerA = {}, viewerB = {};
    const fabricA = fakeFabric([{ id: 1, presetID: "a" }]);
    const fabricB = fakeFabric([{ id: 2, presetID: "a" }, { id: 3, presetID: "c" }]);
    const plugin = fakePlugin(["a", "b", "c"], new Map([[viewerA, fabricA], [viewerB, fabricB]]));

    expect(plugin._assignClassSlot(2, viewerB)).toBe(1);
    expect(fabricB.changed).toEqual([[2, "c"]]);
    expect(fabricA.changed, "other viewport untouched").toEqual([]);
    expect(plugin.context.setPresetCalls, "active class untouched").toEqual([]);
});

test("class slot assign without viewer, selection or slot does nothing", { tag: ["@unit"] }, () => {
    const viewer = {};
    const fabric = fakeFabric([]);
    const plugin = fakePlugin(["a"], new Map([[viewer, fabric]]));

    expect(plugin._assignClassSlot(0, null)).toBe(0);
    expect(plugin._assignClassSlot(0, viewer)).toBe(0);
    expect(plugin._assignClassSlot(5, viewer)).toBe(0);
    expect(fabric.changed).toEqual([]);
});
