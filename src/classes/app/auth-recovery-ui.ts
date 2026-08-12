// Surface an expired auth context to the user and let them fix it with ONE
// click, then repair the viewer without a reload.
//
// Why a click matters: a silent renew that answers `interaction_required` can
// only be resolved by an interactive login, and every browser blocks
// `window.open` that is not called from a real user gesture. So the recovery
// cannot be automatic — it has to be driven by something the user does. That is
// what the scrim is for: it blocks the viewer, and its own pointerdown IS the
// gesture that opens the IdP popup.
//
// Split of responsibilities mirrors `network-status-ui.ts`: `APPLICATION_CONTEXT.auth`
// owns the state + the `auth-interaction-required` / `-resolved` events, this
// helper only renders and repairs. Wired once from `app.ts`.

type AuthEventPayload = {
    contextId: string;
    isMain?: boolean;
    serviceName?: string;
    reason?: string;
};

const BADGE_PREFIX = "auth:";

/** The blocking scrim, at most one at a time (only the main context gets one). */
let scrim: any = null;
let scrimContextId: string | null = null;
let gestureHandler: ((ev: Event) => void) | null = null;

function auth(): any {
    return (window as any).APPLICATION_CONTEXT?.auth;
}

// ── the main-context scrim ───────────────────────────────────────────────────

function closeScrim(): void {
    if (gestureHandler && scrim?.root) {
        scrim.root.removeEventListener("pointerdown", gestureHandler, { capture: true } as any);
    }
    gestureHandler = null;
    try { scrim?.close?.(); } catch (e) { /* already gone */ }
    scrim = null;
    scrimContextId = null;
}

/**
 * Block the viewer until the user clicks. `isBlocking: true` leaves the DaisyUI
 * backdrop inert (no close-on-backdrop handler is installed) and `allowClose:
 * false` omits the ✕, so there is no dismissal path — the only way out is to
 * sign in. The backdrop is a full-viewport, pointer-events-capturing layer, so
 * it also covers the OpenSeadragon canvas; no canvas-press bridge is needed.
 */
function openScrim(payload: AuthEventPayload): void {
    const UI = (window as any).UI;
    if (!UI?.Modal) return;
    if (scrim && scrimContextId === payload.contextId) return;
    if (scrim) closeScrim();

    const service = payload.serviceName || payload.contextId;
    const body = document.createElement("div");
    body.className = "flex flex-col gap-2 text-center py-2";
    const line = document.createElement("div");
    line.textContent = $.t("auth.sessionExpiredBody", { service });
    const hint = document.createElement("div");
    hint.className = "opacity-70 text-sm";
    hint.textContent = $.t("auth.clickToSignIn");
    body.append(line, hint);

    scrim = new UI.Modal({
        id: "auth-recovery-scrim",
        header: $.t("auth.sessionExpiredTitle"),
        body,
        isBlocking: true,
        allowClose: false,
    });
    scrimContextId = payload.contextId;
    scrim.create();
    scrim.mount(document.body);
    scrim.open();

    let signingIn = false;
    gestureHandler = async (ev: Event) => {
        // The gesture must reach `login()` synchronously enough that the popup
        // is still attributed to it — do not await anything before the call.
        if (signingIn) return;
        signingIn = true;
        ev.stopPropagation();
        hint.textContent = $.t("common.working");
        try {
            const ok = await auth()?.login(payload.contextId);
            if (ok) return;                       // `-resolved` closes the scrim
            hint.textContent = $.t("auth.signInFailed");
        } catch (e) {
            console.warn("auth-recovery: interactive login failed", e);
            hint.textContent = $.t("auth.signInFailed");
        } finally {
            signingIn = false;
        }
    };
    scrim.root.addEventListener("pointerdown", gestureHandler, { capture: true });
}

// ── sub-context: badge + sticky toast, viewer stays usable ───────────────────

function showContextNotice(payload: AuthEventPayload): void {
    const service = payload.serviceName || payload.contextId;
    const appBar = (window as any).USER_INTERFACE?.AppBar;
    const signIn = () => { auth()?.login(payload.contextId); };

    if (appBar?.addBadge) {
        appBar.addBadge(BADGE_PREFIX + payload.contextId, {
            label: $.t("auth.signIn"),
            color: "warning",
            icon: "ph-lock-key",
            title: $.t("auth.contextExpiredToast", { service }),
            // A badge onClick is a real user gesture, so the popup is allowed.
            onClick: signIn,
        });
    }
    const dialogs = (window as any).Dialogs;
    // delay < 1000 → sticks until resolved or dismissed.
    dialogs?.show?.($.t("auth.contextExpiredToast", { service }), 0, dialogs.MSG_WARN, {
        actions: { signin: signIn },
    });
}

function clearContextNotice(contextId: string): void {
    (window as any).USER_INTERFACE?.AppBar?.removeBadge?.(BADGE_PREFIX + contextId);
}

// ── repair after a successful re-login ──────────────────────────────────────

/**
 * A tile that failed while the credential was dead is not retried by
 * OpenSeadragon: `_onTileLoad` sets `tile.exists = false` and `tileRetryMax` is
 * 0, so the tile is skipped by both the draw and the load pass forever — panning
 * back does not re-request it, and `forceRedraw()` does not help because the
 * load pass returns early on `!tile.exists`. `world.resetItems()` drops the
 * per-image tile state, which is what actually re-requests them.
 *
 * Faulty marks are cleared for the same reason: 401s during the outage may have
 * pushed a source past the failure threshold, and nothing else un-faults it.
 */
function repairViewers(): void {
    const manager = (window as any).VIEWER_MANAGER;
    const viewers = manager?.viewers || [];
    for (const viewer of viewers) {
        if (!viewer) continue;
        try { viewer.__faultySources?.clear?.(); } catch (e) { /* best effort */ }
        try { viewer.world?.resetItems?.(); } catch (e) { /* best effort */ }
    }
}

// ── wiring ──────────────────────────────────────────────────────────────────

/**
 * Subscribe the gate to the auth singleton. Idempotent-safe to call once at boot.
 *
 * Uses the single global `auth-interaction-changed` channel rather than the
 * per-context `<base>:<ctx>` names: contexts are configured after boot (and some
 * only when a feature first needs them), so an app-wide listener must not have to
 * enumerate them up front. The context id travels in the payload.
 */
export function wireAuthRecoveryUi(): void {
    const user = (window as any).XOpatUser?.instance?.();
    if (!user?.addHandler) return;

    user.addHandler("auth-interaction-changed", (payload: AuthEventPayload & { event?: string }) => {
        if (!payload?.contextId) return;
        if (payload.event === "auth-interaction-required") {
            if (payload.isMain) openScrim(payload);
            else showContextNotice(payload);
            return;
        }
        if (payload.event === "auth-interaction-resolved") {
            if (scrimContextId === payload.contextId) closeScrim();
            clearContextNotice(payload.contextId);
            (window as any).Dialogs?.hide?.(false);
            repairViewers();
        }
    });
}
