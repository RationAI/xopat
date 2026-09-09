/**
 * Which right-side panels a deployment boots open.
 *
 * `ui.sideMenuTabs` exists so a deployment can hand a pathologist a clean
 * viewer — navigator open, everything else collapsed — without per-user setup.
 * Three things make it easy to get wrong and impossible to see from the outside:
 *
 *  - it is NOT a `getUiOption` flag. That helper is boolean-only and defaults
 *    every unset key to `true`, so a per-tab map has to resolve by hand — and
 *    "resolve by hand" is exactly where precedence quietly diverges from the
 *    rest of the `ui.*` namespace.
 *  - the user's cached `<tabId>-open` toggle outranks the deployment default,
 *    deliberately. Invert that and a panel the user opened snaps shut on every
 *    reload; drop it and an operator's default never reaches a returning user.
 *  - `"*"` is the fallback for tabs the map does not name, which is the only
 *    reason `{"*": false, "navigator": true}` covers panels appended later by
 *    plugins the operator has never heard of.
 *
 * The resolver lives in a leaf module (no DOM, no Van.js) precisely so this can
 * be asserted without booting a browser.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

const { resolveSideMenuTabOpen } = await import(
    "../../../ui/classes/components/sideMenuPreferences.mjs");

/**
 * @param {object} opts
 * @param {*} [opts.params] value of `params.ui.sideMenuTabs`
 * @param {*} [opts.defaults] value of `defaultParams.ui.sideMenuTabs`
 * @param {object} [opts.cache] AppCache contents, e.g. `{"shaders-open": true}`
 */
function withContext({ params, defaults, cache = {} } = {}) {
    globalThis.APPLICATION_CONTEXT = {
        config: {
            params: params === undefined ? {} : { ui: { sideMenuTabs: params } },
            defaultParams: defaults === undefined ? {} : { ui: { sideMenuTabs: defaults } },
        },
        AppCache: { get: (key) => (key in cache ? cache[key] : undefined) },
    };
}

test("unset config opens every panel", async () => {
    withContext({});
    expect(resolveSideMenuTabOpen("navigator")).toBe(true);
    expect(resolveSideMenuTabOpen("shaders")).toBe(true);
});

test("a boolean applies to every tab", async () => {
    withContext({ defaults: false });
    expect(resolveSideMenuTabOpen("navigator")).toBe(false);
    expect(resolveSideMenuTabOpen("anything-a-plugin-adds")).toBe(false);
});

test('"*" covers tabs the map does not name', async () => {
    withContext({ defaults: { "*": false, navigator: true } });
    expect(resolveSideMenuTabOpen("navigator")).toBe(true);
    expect(resolveSideMenuTabOpen("shaders")).toBe(false);
    // The case the deployment cannot enumerate: a panel appended by a plugin.
    expect(resolveSideMenuTabOpen("slide-info-panel")).toBe(false);
});

test("a map with no star leaves unnamed tabs open", async () => {
    withContext({ defaults: { navigator: false } });
    expect(resolveSideMenuTabOpen("navigator")).toBe(false);
    expect(resolveSideMenuTabOpen("shaders")).toBe(true);
});

test("the user's cached toggle outranks the deployment default", async () => {
    withContext({ defaults: { "*": false }, cache: { "shaders-open": true } });
    expect(resolveSideMenuTabOpen("shaders")).toBe(true);
    expect(resolveSideMenuTabOpen("navigator")).toBe(false);
    // Storage round-trips booleans as strings on some drivers.
    withContext({ defaults: true, cache: { "shaders-open": "false" } });
    expect(resolveSideMenuTabOpen("shaders")).toBe(false);
});

test("a session param outranks both the cache and the deployment default", async () => {
    withContext({
        params: { "*": false, navigator: true },
        defaults: true,
        cache: { "shaders-open": true, "navigator-open": false },
    });
    expect(resolveSideMenuTabOpen("shaders")).toBe(false);
    expect(resolveSideMenuTabOpen("navigator")).toBe(true);
});
