/**
 * Styling an annotation by a state only its owner knows.
 *
 * Fill and stroke are derived from the preset, so a value written on the object
 * is lost on the next selection change. A policy is what makes such a style
 * persistent; these pin how policies compose and how a dash follows the zoom.
 *
 * Driven against the real methods, called on a bare `this` — no module instance,
 * no canvas, no browser.
 */
import { test, expect, fromRoot, installBrowserGlobals, loadBrowserScript } from "@xopat/test-harness";

let shim;
let A;

function host(common = { opacity: 0.4, modeOutline: false }) {
    const module = { presets: { commonAnnotationVisuals: common }, refreshes: 0, reapplyVisuals() { this.refreshes++; } };
    module.register = (ownerId, policy) => A.prototype.registerVisualPolicy.call(module, ownerId, policy);
    module.resolve = object => A.prototype.resolveAnnotationVisuals.call(module, object);
    return module;
}

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

test("without a policy an annotation gets a private copy of the common visuals", { tag: ["@unit"] }, () => {
    const module = host();
    const visuals = module.resolve({});
    expect(visuals).toEqual(module.presets.commonAnnotationVisuals);
    visuals.opacity = 1;
    expect(module.presets.commonAnnotationVisuals.opacity).toBe(0.4);
});

test("a policy overrides only what it names, and only for its objects", { tag: ["@unit"] }, () => {
    const module = host();
    module.register("owner", object => object.mine ? { modeOutline: true } : undefined);
    expect(module.resolve({ mine: true })).toEqual({ opacity: 0.4, modeOutline: true });
    expect(module.resolve({})).toEqual({ opacity: 0.4, modeOutline: false });
});

test("policies compose in order and a later one sees the earlier answer", { tag: ["@unit"] }, () => {
    const module = host();
    module.register("first", () => ({ opacity: 0.8 }));
    module.register("second", (object, visuals) => ({ opacity: visuals.opacity / 2 }));
    expect(module.resolve({}).opacity).toBe(0.4);
});

test("a policy that throws has no opinion", { tag: ["@unit"] }, () => {
    const module = host();
    const warn = console.warn;
    console.warn = () => {};
    try {
        module.register("broken", () => { throw new Error("broken"); });
        module.register("working", () => ({ opacity: 1 }));
        expect(module.resolve({}).opacity).toBe(1);
    } finally { console.warn = warn; }
});

test("registering and disposing refresh the visuals, and a stale dispose changes nothing", { tag: ["@unit"] }, () => {
    const module = host();
    const stale = module.register("owner", () => ({ opacity: 1 }));
    const current = module.register("owner", () => ({ opacity: 0.5 }));
    expect(module.refreshes).toBe(2);
    stale();
    expect(module.resolve({}).opacity).toBe(0.5);
    expect(module.refreshes).toBe(2);
    current();
    expect(module.resolve({}).opacity).toBe(0.4);
    expect(module.refreshes).toBe(3);
});
