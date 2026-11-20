/**
 * user-actions end to end, on the synthetic slide with the demo deployment
 * actions (env/parts/flags/user-actions-demo.json):
 *  - a deployment action mounts on its surfaces and runs with no model involved;
 *  - the trigger reaches the script as the read-only `input` global;
 *  - an assistant proposal saves nothing until the user approves it.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

test.use({ xopatEnv: "modules/user-actions/test/env/actions.json" });

const slide = ensureSyntheticSlide();

const session = () => ({
    data: [slide.dataId],
    background: [{ dataReference: 0, name: "Synthetic" }],
    params: { bypassCookies: true, bypassCache: true, disablePluginsAutoload: true, debugMode: false },
});

async function launch(xopat) {
    await xopat.launch(session());
    await xopat.waitForViewer();
    await xopat.page.waitForFunction(() => {
        try { return !!window.singletonModule("user-actions"); } catch (_) { return false; }
    });
    await xopat.page.evaluate(() => window.singletonModule("user-actions").whenReady());
}

test("deployment actions mount on their surfaces", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await launch(xopat);
    const state = await xopat.page.evaluate(() => {
        const ui = window.USER_INTERFACE;
        return {
            quick: !!ui.AppBar.Actions.get("custom:user-actions.count-per-class"),
            pinned: ui.AppBar.QuickActions.isPinned("custom:user-actions.count-per-class"),
            toolsRun: ui.AppBar.Tools.has("user-actions.run.trigger-info"),
            toolsManage: ui.AppBar.Tools.has("user-actions.manage"),
            control: ui.ViewerControls.has("user-actions.trigger-info"),
            shortcut: window.APPLICATION_CONTEXT.shortcuts.getBinding("user-actions.count-per-class"),
        };
    });
    expect(state.quick).toBe(true);
    expect(state.pinned).toBe(true);
    expect(state.toolsRun).toBe(true);
    expect(state.toolsManage).toBe(true);
    expect(state.control).toBe(true);
    expect(state.shortcut?.combos).toEqual(["Alt+KeyC"]);
});

test("a viewer control run receives its trigger in `input`", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await launch(xopat);
    const outcome = await xopat.page.evaluate(async () => {
        const module = window.singletonModule("user-actions");
        const action = module.store.get("trigger-info");
        return await module.invoke(action, "viewer-control", window.VIEWER_MANAGER.viewers[0]);
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.result).toEqual({ trigger: "viewer-control", hasViewer: true, hasPosition: false });
    // output: "window" → a floating window titled with the label, showing the table.
    const win = xopat.page.locator("#user-actions-result-trigger-info");
    await expect(win).toBeVisible();
    await expect(win).toContainText("viewer-control");
});

test("an assistant proposal saves nothing until approved", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await launch(xopat);
    const page = xopat.page;
    await page.evaluate(() => {
        window.__actions = window.APPLICATION_CONTEXT.Scripting.getApi("actions").bindInvocationContext({
            scriptingContext: {
                id: "__actions_test__",
                getActiveViewerContextId: () => null,
                activeViewerContextId: null,
                // Even a consent-bypassing context must not skip the approval dialog.
                isConsentDialogBypassed: () => true,
            },
        });
    });
    const spec = {
        id: "answer", label: "Answer", script: "return 42;",
        placements: [{ surface: "quick" }],
    };

    const validation = await page.evaluate((s) => window.__actions.validateAction(s), spec);
    expect(validation.ok).toBe(true);

    // Decline.
    const declined = page.evaluate((s) => window.__actions.proposeAction(s), spec);
    await page.getByRole("button", { name: "Decline" }).click();
    expect((await declined).status).toBe("declined");
    expect(await page.evaluate(() => !!window.USER_INTERFACE.AppBar.Actions.get("custom:user-actions.answer"))).toBe(false);

    // Approve.
    const approved = page.evaluate((s) => window.__actions.proposeAction(s), spec);
    await page.getByRole("button", { name: "Approve and save" }).click();
    expect((await approved).status).toBe("approved");
    expect(await page.evaluate(() => !!window.USER_INTERFACE.AppBar.Actions.get("custom:user-actions.answer"))).toBe(true);

    const run = await page.evaluate(() => window.__actions.runAction("answer"));
    expect(run).toMatchObject({ ok: true, result: 42 });

    // Deployment ids are not the assistant's to change.
    const reserved = await page.evaluate(() => window.__actions.validateAction({
        id: "count-per-class", label: "x", script: "return 1;", placements: [],
    }));
    expect(reserved.errors.map(e => e.code)).toContain("reservedId");
});
