/**
 * The `ui` scripting namespace over `AppBar.Catalog`.
 *
 * The assistant learns the interface only through these calls, so what they
 * pin is the contract it relies on: the core UI is enumerable under stable ids,
 * opening/closing acts on the real components, a bad id answers with
 * suggestions instead of a bare failure, and model text shown to the user
 * stays text.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const slide = ensureSyntheticSlide();

const session = () => ({
    data: [slide.dataId],
    background: [{ dataReference: 0, name: "Synthetic" }],
    params: {
        bypassCookies: true,
        bypassCache: true,
        disablePluginsAutoload: true,
        debugMode: false,
    },
});

/** Page-side: bind the `ui` namespace to a consent-bypassing context as `window.__ui`. */
function bindUi() {
    window.__ui = window.APPLICATION_CONTEXT.Scripting.getApi("ui").bindInvocationContext({
        scriptingContext: {
            id: "__ui_catalog_test__",
            getActiveViewerContextId: () => window.VIEWER.uniqueId,
            activeViewerContextId: window.VIEWER.uniqueId,
            isConsentDialogBypassed: () => true,
        },
    });
}

async function launch(xopat) {
    await xopat.launch(session());
    await xopat.waitForViewer();
    await xopat.page.evaluate(bindUi);
}

test("lists the core UI under stable ids", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await launch(xopat);

    const result = await xopat.page.evaluate(async () => {
        const ui = window.__ui;
        const roots = ui.listUi({ limit: 300 });
        const keymap = ui.listUi({ query: "keymap" });
        const describedView = ui.describeUi("appbar:view");
        return {
            rootIds: roots.items.map(i => i.id),
            rootsHaveNoParent: roots.items.every(i => !i.parent || !roots.items.some(r => r.id === i.parent)),
            keymapIds: keymap.items.map(i => i.id),
            viewChildren: describedView.children.length,
            navigator: ui.describeUi("viewer-tab:navigator"),
        };
    });

    expect(result.rootIds).toContain("appbar:view");
    expect(result.rootIds).toContain("appbar:settings");
    expect(result.rootIds).toContain("fullscreen:settings-menu");
    expect(result.rootIds).toContain("viewer-tab:navigator");
    expect(result.rootIds).toContain("viewer-tab:shaders");
    expect(result.rootsHaveNoParent, "browsing without a filter returns roots only").toBe(true);
    expect(result.keymapIds).toContain("fullscreen:keymap-menu");
    expect(result.viewChildren, "View toggles are children of the View menu").toBeGreaterThan(0);
    expect(result.navigator.viewerScoped).toBe(true);
    expect(result.navigator.ops).toEqual(expect.arrayContaining(["open", "close", "show"]));
});

test("opens and closes real components", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await launch(xopat);

    const result = await xopat.page.evaluate(async () => {
        const ui = window.__ui;
        const menus = window.UI.Services.FullscreenMenus;

        const opened = await ui.openUi("fullscreen:keymap-menu");
        const focusedAfterOpen = menus.getFocusedId();
        const openIds = ui.getUiState().open.map(i => i.id);
        ui.closeUi("fullscreen:keymap-menu");
        const focusedAfterClose = menus.getFocusedId();

        ui.closeUi("viewer-tab:shaders");
        const closedShaders = ui.describeUi("viewer-tab:shaders").state.open;
        // Opening twice must not toggle the panel shut (Menu.focus toggles).
        await ui.openUi("viewer-tab:shaders");
        await ui.openUi("viewer-tab:shaders");
        const openShaders = ui.describeUi("viewer-tab:shaders").state.open;

        return { opened, focusedAfterOpen, openIds, focusedAfterClose, closedShaders, openShaders };
    });

    expect(result.opened.state.open).toBe(true);
    expect(result.focusedAfterOpen).toBe("keymap-menu");
    expect(result.openIds).toContain("fullscreen:keymap-menu");
    expect(result.focusedAfterClose).toBeUndefined();
    expect(result.closedShaders).toBe(false);
    expect(result.openShaders).toBe(true);
});

test("an unknown id fails with suggestions", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await launch(xopat);

    const message = await xopat.page.evaluate(async () => {
        try {
            window.__ui.describeUi("fullscreen:keymap");
            return null;
        } catch (e) {
            return String(e.message);
        }
    });

    expect(message).toContain("Unknown UI element 'fullscreen:keymap'");
    expect(message).toContain("fullscreen:keymap-menu");
});

test("showUi renders the message as text", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await launch(xopat);

    const result = await xopat.page.evaluate(async () => {
        window.__xss = false;
        const shown = await window.__ui.showUi("appbar:settings", {
            message: `<img src=x onerror="window.__xss = true">Open settings here`,
        });
        await new Promise(r => setTimeout(r, 300));
        const label = document.querySelector(".xo-tour-label, [class*='xo-tour']");
        const injected = !!document.querySelector("[class*='xo-tour'] img");
        window.APPLICATION_CONTEXT.tutorials.stop();
        return { shown, xss: window.__xss, injected, hasLabel: !!label };
    });

    expect(result.shown.shown).toBe(true);
    expect(result.shown.target).toBe("appbar:settings");
    expect(result.xss).toBe(false);
    expect(result.injected).toBe(false);
});

test("invokeUiAction runs an action and refuses non-actions", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await launch(xopat);

    const result = await xopat.page.evaluate(async () => {
        const ui = window.__ui;
        const toggle = ui.listUi({ parent: "appbar:view", limit: 300 }).items.find(i => i.state.selected !== undefined);
        const before = toggle?.state.selected;
        const ran = toggle ? await ui.invokeUiAction(toggle.id) : null;
        const after = toggle ? ui.describeUi(toggle.id).state.selected : null;

        let refusal = null;
        try { await ui.invokeUiAction("viewer-tab:navigator"); } catch (e) { refusal = String(e.message); }
        return { toggleId: toggle?.id, before, ran, after, refusal };
    });

    expect(result.toggleId, "a View toggle exists").toBeTruthy();
    expect(result.ran).toEqual({ invoked: true });
    expect(result.after).toBe(!result.before);
    expect(result.refusal).toContain("has no action");
});
