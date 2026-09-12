/**
 * Quick-draw's one-shot return to navigation.
 *
 * A quick-draw press enters manual (`custom`) mode and arms a one-shot listener that
 * hands the canvas back to AUTO once the shape is committed. The arming cancels itself
 * when the mode leaves `custom` by any other route, so an explicit user tool choice is
 * never fought.
 *
 * The bug these tests pin: entering `custom` from ANY non-AUTO mode emits a transient
 * `mode-changed {mode: AUTO}` first — `setMode` tears the previous mode down through
 * `_setModeToAuto(true)`, and `switchModeActive` additionally bounces auto->custom when
 * `custom` is already active. Armed before the switch, quick-draw cancelled itself on its
 * own entry transient and the user stayed stuck in manual mode.
 *
 * Pure mixin-level assertions: the methods run against a hand-rolled `context` that
 * replays the real event order, no canvas and no browser.
 */
import { test, expect } from "@xopat/test-harness";
import { quickDrawMethods } from "../../methods/quickDraw.mjs";

/** The slice of `OSDAnnotations` quick-draw touches, with annotations.js's event order. */
function fakeContext(options = {}) {
    const { refuseCustom = false } = options;
    const AUTO = { getId: () => "auto" };
    const CUSTOM = { getId: () => "custom" };

    return {
        Modes: { AUTO, CUSTOM },
        mode: AUTO,
        disabledInteraction: false,
        events: [],
        handlers: new Map(),
        fabricHandlers: new Map(),
        presets: {
            left: { presetID: "p1", objectFactory: { factoryID: "rect" } },
            ensureActivePreset: () => true,
        },

        getPreset() { return this.presets.left; },
        setPreset() {},

        addHandler(name, fn) { this._add(this.handlers, name, fn); },
        removeHandler(name, fn) { this._remove(this.handlers, name, fn); },
        addFabricHandler(name, fn) { this._add(this.fabricHandlers, name, fn); },
        removeFabricHandler(name, fn) { this._remove(this.fabricHandlers, name, fn); },
        _add(map, name, fn) {
            if (!map.has(name)) map.set(name, []);
            map.get(name).push(fn);
        },
        _remove(map, name, fn) {
            const list = map.get(name);
            if (!list) return;
            const i = list.indexOf(fn);
            if (i >= 0) list.splice(i, 1);
            if (!list.length) map.delete(name);
        },
        raise(map, name, payload) {
            for (const fn of [...(map.get(name) || [])]) fn(payload);
        },
        /** Emit the commit event a finished shape raises. */
        commitShape() { this.raise(this.fabricHandlers, "annotation-create", { object: {} }); },

        _enter(mode) {
            this.mode = mode;
            this.events.push(mode.getId());
            this.raise(this.handlers, "mode-changed", { mode });
        },
        // Mirrors annotations.js setMode(): a mode->mode switch always passes through
        // AUTO first, and a mode may refuse to activate and leave us in AUTO.
        setMode(mode) {
            if (this.disabledInteraction || mode === this.mode) return;
            if (this.mode !== this.Modes.AUTO) this._enter(this.Modes.AUTO);
            if (mode === this.Modes.AUTO) return;
            if (mode === this.Modes.CUSTOM && refuseCustom) return;
            this._enter(mode);
        },
        setModeById(id) { this.setMode(id === "custom" ? this.Modes.CUSTOM : this.Modes.AUTO); },
    };
}

/** The mixin over the plugin surface it uses, with navigation.mjs's same-mode bounce. */
function fakePlugin(context) {
    return Object.assign({
        context,
        _allowedFactories: ["rect", "polygon"],
        t: (key) => key,
        switchModeActive(id, _factory, _isLeft) {
            if (this.context.mode.getId() === id) {
                // navigation.mjs bounces auto->custom so the mode picks up the new factory
                if (id === "custom") {
                    this.context.setModeById("auto");
                    this.context.setModeById("custom");
                }
                return;
            }
            this.context.setModeById(id);
        },
    }, quickDrawMethods);
}

/** The auto-return is deferred out of the `annotation-create` stack on purpose. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

let dialogsBackup;

test.beforeAll(() => {
    dialogsBackup = globalThis.Dialogs;
    globalThis.Dialogs = { show: () => {}, MSG_WARN: "warn" };
});

test.afterAll(() => {
    if (dialogsBackup === undefined) delete globalThis.Dialogs;
    else globalThis.Dialogs = dialogsBackup;
});

test("quick-draw from navigation returns to navigation once the shape commits", { tag: ["@unit"] }, async () => {
    const context = fakeContext();
    const plugin = fakePlugin(context);

    plugin._fireQuickDraw({ factory: "rect", side: "left" });
    expect(context.mode).toBe(context.Modes.CUSTOM);

    context.commitShape();
    await flush();
    expect(context.mode, "one-shot gesture hands the canvas back").toBe(context.Modes.AUTO);
});

test("quick-draw pressed again while already drawing still auto-returns", { tag: ["@unit"] }, async () => {
    // The regression: the second press bounces auto->custom, and the arming used to
    // cancel itself on that transient AUTO event.
    const context = fakeContext();
    const plugin = fakePlugin(context);

    plugin._fireQuickDraw({ factory: "rect", side: "left" });
    plugin._fireQuickDraw({ factory: "polygon", side: "left" });
    expect(context.mode).toBe(context.Modes.CUSTOM);
    expect(context.events, "the entry transient really is emitted").toEqual(["custom", "auto", "custom"]);

    context.commitShape();
    await flush();
    expect(context.mode).toBe(context.Modes.AUTO);
});

test("quick-draw from another drawing mode still auto-returns", { tag: ["@unit"] }, async () => {
    const context = fakeContext();
    const FREE_FORM = { getId: () => "free-form-tool-add" };
    context.Modes.FREE_FORM_TOOL_ADD = FREE_FORM;
    context.mode = FREE_FORM;
    const plugin = fakePlugin(context);

    plugin._fireQuickDraw({ factory: "rect", side: "left" });
    expect(context.events, "setMode passes through AUTO on a mode->mode switch").toEqual(["auto", "custom"]);

    context.commitShape();
    await flush();
    expect(context.mode).toBe(context.Modes.AUTO);
});

test("preset-only quick-draw arms the same one-shot", { tag: ["@unit"] }, async () => {
    const context = fakeContext();
    const plugin = fakePlugin(context);

    plugin._fireQuickDraw({ side: "left" });
    expect(context.mode).toBe(context.Modes.CUSTOM);

    context.commitShape();
    await flush();
    expect(context.mode).toBe(context.Modes.AUTO);
});

test("leaving custom mode by another route disarms without forcing navigation", { tag: ["@unit"] }, async () => {
    const context = fakeContext();
    const plugin = fakePlugin(context);
    plugin._fireQuickDraw({ factory: "rect", side: "left" });

    // The user picks a different tool: mode leaves custom, arming must drop.
    const EDIT = { getId: () => "edit-selection" };
    context.setMode(EDIT);
    expect(context.mode).toBe(EDIT);

    context.commitShape();
    await flush();
    expect(context.mode, "an unrelated later annotation must not force AUTO").toBe(EDIT);
    expect(context.fabricHandlers.size, "no dangling listener").toBe(0);
    expect(context.handlers.size).toBe(0);
});

test("a refused custom mode arms nothing", { tag: ["@unit"] }, async () => {
    // _setModeFromAuto bounces back to AUTO when the mode cannot activate.
    const context = fakeContext({ refuseCustom: true });
    const plugin = fakePlugin(context);

    plugin._fireQuickDraw({ factory: "rect", side: "left" });
    expect(context.mode).toBe(context.Modes.AUTO);
    expect(context.fabricHandlers.size).toBe(0);
    expect(context.handlers.size).toBe(0);
});

test("a committed shape leaves no listeners behind", { tag: ["@unit"] }, async () => {
    const context = fakeContext();
    const plugin = fakePlugin(context);

    plugin._fireQuickDraw({ factory: "rect", side: "left" });
    expect(context.fabricHandlers.get("annotation-create")).toHaveLength(1);
    expect(context.handlers.get("mode-changed")).toHaveLength(1);

    context.commitShape();
    await flush();
    expect(context.fabricHandlers.size, "removed by the same reference").toBe(0);
    expect(context.handlers.size).toBe(0);
});

test("the mode change is deferred out of the annotation-create stack", { tag: ["@unit"] }, async () => {
    // Factories raise annotation-create BEFORE clearing `_current` (polygon, text);
    // a synchronous setMode(AUTO) re-enters finishIndirect and duplicates the shape.
    const context = fakeContext();
    const plugin = fakePlugin(context);
    plugin._fireQuickDraw({ factory: "polygon", side: "left" });

    context.commitShape();
    expect(context.mode, "still custom while the factory's own frame runs").toBe(context.Modes.CUSTOM);

    await flush();
    expect(context.mode).toBe(context.Modes.AUTO);
});
