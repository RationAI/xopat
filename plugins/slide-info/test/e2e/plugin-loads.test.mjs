/**
 * Reference element e2e test: a plugin, tested from its own directory.
 *
 * Nothing here is registered centrally. The runner finds this file because it
 * matches `plugins/*\/test/e2e/**` and because `include.json` declares a
 * `tests` block; an element developed in its own repository and symlinked into
 * `plugins/` is discovered by the exact same rule.
 *
 * What it pins is the wiring, not the feature: that the deployment's
 * `permaLoad` really produces a live instance. That link breaks quietly — the
 * plugin list still shows the entry, the UI just never appears.
 */
import { test, expect } from "@xopat/test-harness";

const PLUGIN_ID = "slide-info";

test("is offered by the deployment", { tag: ["@e2e"] }, async ({ xopat }) => {
    await xopat.launch();

    // `pluginMeta` reads the include.json record merged with `ENV.plugins.<id>`
    // — i.e. what the deployment actually decided about this plugin. It answers
    // only for an allowlisted set of keys (`PUBLIC_META_KEYS` in `src/loader.ts`),
    // so `undefined` here means "not in the registry", not "key absent".
    const meta = await xopat.page.evaluate((id) => ({
        name: window.pluginMeta(id, "name"),
        version: window.pluginMeta(id, "version"),
        author: window.pluginMeta(id, "author"),
        label: window.elementName("plugins", id),
    }), PLUGIN_ID);

    expect(meta.version, `${PLUGIN_ID} is not in the deployment's plugin registry`).toBeTruthy();
    expect(meta.author).toBe("RationAI");
    // `%meta.name%` is a locale reference; it must be resolved, never shown raw.
    expect(meta.name, "the %meta.name% reference resolved").toBeTruthy();
    expect(meta.name).not.toMatch(/^%.*%$/);
    expect(meta.label, "elementName degrades to the id only when unresolved").not.toBe(PLUGIN_ID);
});

test("reaches a live instance", { tag: ["@e2e"] }, async ({ xopat }) => {
    // No `disablePluginsAutoload` here on purpose: autoload is the thing under
    // test.
    await xopat.launch({ params: { bypassCookies: true, bypassCache: true } });

    await xopat.page.waitForFunction(
        (id) => { try { return Boolean(window.plugin(id)); } catch { return false; } },
        PLUGIN_ID,
        { timeout: 30_000 },
    );

    const identity = await xopat.page.evaluate((id) => {
        const instance = window.plugin(id);
        return { uid: instance.uid, hasOptions: typeof instance.getOption === "function" };
    }, PLUGIN_ID);

    // `uid` is namespaced by kind — the element's identity in IO, storage and
    // the scripting registry, not the bare directory name.
    expect(identity.uid).toBe(`plugin.${PLUGIN_ID}`);
    expect(identity.hasOptions, "the instance is a real XOpatPlugin, not a stub").toBe(true);
});
