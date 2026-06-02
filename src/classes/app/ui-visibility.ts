// Apply `params.ui.*` initial-visibility flags once at boot, after UI services
// and VIEWER_MANAGER are constructed. Each `false` flag flips the matching
// component to its hidden state; the user can still toggle them back via the
// settings menu, the hide-UI button, or per-component openers.
//
// Per-viewer wiring for `scaleBar` and `navigator` lives in `loader.ts` next
// to the scalebar block — it already runs on every `viewer.open`, so it
// handles late-attached viewports too. This helper only takes care of the
// app-bar-level and global-menu defaults that need to be applied once after
// the singleton services exist.

export function applyInitialUiVisibility(): void {
    const ac = (window as any).APPLICATION_CONTEXT;
    const ui = (window as any).USER_INTERFACE;
    if (!ac?.getUiOption) return;

    if (!ac.getUiOption("mainMenu")) {
        ui?.FullscreenMenu?.close?.();
    }

    if (!ac.getUiOption("statusBar")) {
        const el = document.getElementById("viewer-status-bar");
        el?.classList.add("hidden");
    }

    if (!ac.getUiOption("toolBar")) {
        document.querySelectorAll('div[id^="toolbar-"]').forEach(el => el.classList.add("hidden"));
    }

    // `appBar: false` boots with the hide-UI toggle pre-applied — every
    // Chrome-registered component (which by now includes scalebar, navigator
    // and the main menu) is collapsed in one shot.
    if (!ac.getUiOption("appBar")) {
        ui?.AppBar?.Chrome?.hide?.();
    }
}
