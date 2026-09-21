// Surface `APPLICATION_CONTEXT.networkStatus` to the user:
//   • an app-bar pill (red, pulsing) shown only while offline, and
//   • one-shot toasts on genuine transitions (warning on drop, success on
//     reconnect).
//
// Keeps UI concerns out of the NetworkStatus singleton — the singleton only
// owns state + the `network-status-changed` event; this helper subscribes and
// renders. Wired once from `app.ts` after `AppBar.init()`.

const BADGE_ID = "network";

/** Reflect the given connectivity into the app-bar pill. */
function renderPill(online: boolean): void {
    const appBar = (window as any).USER_INTERFACE?.AppBar;
    if (!appBar?.addBadge) return;

    if (online) {
        appBar.removeBadge(BADGE_ID);
    } else {
        appBar.addBadge(BADGE_ID, {
            label: $.t("network.offline"),
            color: "error",
            dot: true,
            pulse: true,
            title: $.t("network.offlineTooltip"),
        });
    }
}

/** Show a one-shot toast for a genuine connectivity transition. */
function notifyTransition(online: boolean): void {
    const dialogs = (window as any).Dialogs;
    if (!dialogs?.show) return;

    if (online) {
        // Dismiss the sticky offline toast, then a brief success toast.
        dialogs.hide(false);
        dialogs.show($.t("network.onlineToast"), 3000, dialogs.MSG_SUCCESS);
    } else {
        // delay < 1000 → sticks until connectivity returns / user closes it.
        dialogs.show($.t("network.offlineToast"), 0, dialogs.MSG_WARN);
    }
}

/**
 * Subscribe the pill + toasts to the connectivity singleton and apply the
 * initial state.
 * Idempotent-safe to call once at boot.
 */
export function wireNetworkStatusUi(): void {
    const net = (window as any).APPLICATION_CONTEXT?.networkStatus as NetworkStatusLike | undefined;
    if (!net?.addHandler) return;

    // Initial paint: show the pill if already offline, but do NOT toast on the
    // first frame — only genuine transitions after boot warrant a toast.
    renderPill(net.isOnline);

    net.addHandler("network-status-changed", ({ online }) => {
        renderPill(online);
        notifyTransition(online);
    });
}
