// Apply `params.ui.*` initial-visibility flags once at boot, after UI services
// and VIEWER_MANAGER are constructed. Each `false` flag flips the matching
// component to its hidden state; the user can still toggle them back via the
// settings menu, the hide-UI button, or per-component openers.
//
// Per-viewer wiring for `scaleBar` and `navigator` lives in `loader.ts` next
// to the scalebar block — it already runs on every `viewer.open`, so it
// handles late-attached viewports too.
//
// `globalMenu` and `toolBar` are *not* handled here — they self-gate at the
// component level (MainLayout reads `getInitialUiOption("globalMenu")` in its
// constructor; Toolbar reads `getInitialUiOption("toolBar")` in `create()`).
// Reading the flag at the component covers plugin- and module-spawned
// components that are not yet constructed when this boot helper runs, and the
// boot-phase variant ensures the flag stops applying once the initial viewer
// has opened.
//
// `statusBar` is handled NOWHERE, and that is not an omission here: core never
// constructs a `UI.StatusBar`, so `#viewer-status-bar` does not exist and the
// Settings checkbox for it toggles nothing. Wiring it up means mounting one and
// registering its VisibilityManager with AppBar.View — until then the flag is
// inert.

export function applyInitialUiVisibility(): void {
    const ac = (window as any).APPLICATION_CONTEXT;
    const ui = (window as any).USER_INTERFACE;
    if (!ac?.getInitialUiOption) return;

    if (!ac.getInitialUiOption("mainMenu")) {
        // FullscreenMenu self-registers with AppBar.Chrome, so the hide-UI
        // button and any future "open settings" flow restore it.
        ui?.FullscreenMenu?.close?.();
    }

    // `appBar: false` boots with the hide-UI toggle pre-applied — every
    // Chrome-registered component (which by now includes scalebar, navigator,
    // the main menu and the MainLayout dock) is collapsed in one shot.
    if (!ac.getInitialUiOption("appBar")) {
        ui?.AppBar?.Chrome?.hide?.();
    }
}
