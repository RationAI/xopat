/**
 * `scrollRequiresCtrl` was renamed to `scrollRequiresClick`. An embedder (or an
 * exported session) still sending the old name must keep working, which takes two
 * things that are easy to undo separately:
 *
 *  - the old key stays DECLARED in the `setup` schema. Session params are filtered
 *    against that schema at boot (`sanitizeAgainst` in `src/app.ts`); an undeclared
 *    key is dropped before the controller could ever read it;
 *  - the controller honours either name.
 */
import { test, expect } from "@xopat/test-harness";
import { readFileSync } from "node:fs";
import { fromRoot } from "@xopat/test-harness/paths";

globalThis.window = globalThis.window ?? globalThis;
globalThis.window.addEventListener ??= () => {};

const { ViewerScrollZoomController } =
    await import("../../../src/classes/app/viewer-scroll-zoom-controller.ts");

test("the deprecated key is still declared in the setup schema, defaulting to unset @unit", () => {
    const source = readFileSync(fromRoot("src", "config.json"), "utf8");
    expect(source).toMatch(/"scrollRequiresCtrl"\s*:\s*null\s*,/);
    expect(source).toMatch(/"scrollRequiresClick"\s*:\s*false\s*,/);
});

test("the controller honours the old name, the new one, and neither @unit", () => {
    const withOptions = (options) => {
        globalThis.window.APPLICATION_CONTEXT = { getOption: (key) => options[key] };
        return new ViewerScrollZoomController({ element: null }).scrollRequiresClick;
    };
    try {
        expect(withOptions({ scrollRequiresCtrl: true })).toBe(true);
        expect(withOptions({ scrollRequiresClick: true })).toBe(true);
        // The declared default of the alias is null: it must not switch the mode on.
        expect(withOptions({ scrollRequiresCtrl: null, scrollRequiresClick: false })).toBe(false);
        expect(withOptions({})).toBe(false);
    } finally {
        delete globalThis.window.APPLICATION_CONTEXT;
    }
});

test("the Settings checkbox clears the old key along with the new one @unit", () => {
    // Otherwise a stored legacy `true` stays OR-ed in and the switch cannot be turned off.
    const source = readFileSync(fromRoot("ui", "services", "fullscreenMenus.mjs"), "utf8");
    const at = source.indexOf('"scroll-requires-click-checkbox"');
    expect(at).toBeGreaterThan(-1);
    const handler = source.slice(at, at + 900);
    expect(handler).toContain("setOption('scrollRequiresCtrl', undefined)");
    expect(handler).toContain("setOption('scrollRequiresClick', this.checked)");
});
