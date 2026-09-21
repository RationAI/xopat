/**
 * The deployment matrix itself.
 *
 * These assertions are the reason projects exist: they are not reachable from a
 * session bundle, only from how the server was deployed. `secureMode` in
 * particular is filtered out of `params` by the boot sanitizer in `src/app.ts`
 * precisely so that a hostile session cannot turn it off — which also means the
 * only honest way to test it is a server that was started with it on.
 */
import { test, expect } from "@xopat/test-harness";

test("the client learns its secure mode from the deployment", { tag: ["@e2e"] }, async ({ xopat, xopatServer }) => {
    await xopat.launch();
    const secureMode = await xopat.page.evaluate(() => window.APPLICATION_CONTEXT.secureMode);
    expect(secureMode, "must agree with the ENV this project deployed").toBe(xopatServer.scratch.flags.secureMode);
});

test("every matrix deployment ships the same elements", { tag: ["@e2e"] }, async ({ xopat }) => {
    // Each matrix ENV is a `$base` patch over `env/env.default.json` stating
    // only its own difference. A project that also changed which plugins load
    // could not attribute a failure to the variable it exists to test — and
    // that is not hypothetical: these files were full copies once, and the
    // `secure` one had dropped the plugin block entirely.
    await xopat.launch();
    const version = await xopat.page.evaluate(() => window.pluginMeta("slide-info", "version"));
    expect(version, "the base deployment's plugins are inherited by this project").toBeTruthy();
});

test("secure mode is on here", { tag: ["@e2e", "@secure-only"] }, async ({ xopat }) => {
    await xopat.launch();
    expect(await xopat.page.evaluate(() => window.APPLICATION_CONTEXT.secureMode)).toBe(true);
});

test("a session cannot turn secure mode off", { tag: ["@e2e", "@secure-only", "@security"] }, async ({ xopat }) => {
    // `secureMode` is absent from the `setup` schema, so `sanitizeAgainst`
    // drops it. If this ever regresses, an imported peer session becomes a
    // privilege-escalation vector.
    await xopat.launch({ params: { secureMode: false } });
    expect(await xopat.page.evaluate(() => window.APPLICATION_CONTEXT.secureMode)).toBe(true);
});

test("the production client build is what is being served", { tag: ["@e2e", "@production-only"] }, async ({ xopat }) => {
    await xopat.launch();
    const flags = await xopat.page.evaluate(() => ({
        production: window.APPLICATION_CONTEXT.env.client.production,
        // Production bakes per-element assets into the page instead of
        // fetching them at runtime.
        baked: typeof window.XOPAT_BAKED_DTS !== "undefined",
    }));
    expect(flags.production).toBeTruthy();
    expect(flags.baked, "declaration bundles are baked in production").toBe(true);
});

test("the deployment ENV can be rewritten mid-run", { tag: ["@e2e"] }, async ({ xopat, xopatServer }) => {
    // The pre-runner suite could only do this against one hardcoded scratch
    // file and skipped itself everywhere else. Every project gets its own
    // scratch copy now, so this runs in all of them — including `production`,
    // where the fixture restarts the server because the config is memoized.
    const baseline = structuredClone(xopatServer.scratch.read());
    try {
        await xopatServer.setEnv({ core: { setup: { theme: "dark" } } });
        await xopat.launch();

        // Assert on the raw ENV, not `getOption("theme")`: the boot call passes
        // an explicit "auto" default, and an explicit caller default outranks
        // the ENV `setup` block in the core resolver.
        const theme = await xopat.page.evaluate(() => window.APPLICATION_CONTEXT.env.setup.theme);
        expect(theme).toBe("dark");
    } finally {
        await xopatServer.replaceEnv(baseline);
    }
});
