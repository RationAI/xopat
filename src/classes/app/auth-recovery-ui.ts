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

/**
 * Above `#fullscreen-loader` (999999, `server/templates/index.html`). The DaisyUI
 * `.modal` default is 999, which put the scrim UNDER the boot spinner: the spinner
 * is a full-viewport pointer-capturing layer, so the only way out of the scrim (its
 * own pointerdown) could never be clicked — a dead end for the user.
 */
const SCRIM_Z_INDEX = 1000001;

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
    // `close()` only strips `modal-open`; the node stays in `document.body`. Since
    // the Modal root now carries `id: this.id`, leaving it there means a second
    // expiry in one session puts TWO `#auth-recovery-scrim` nodes in the document —
    // and `BaseComponent.remove()` / `detachFrom()` resolve through
    // `document.getElementById(this.id)`, which returns the stale one, so the live
    // scrim could never be taken down again.
    try { scrim?.remove?.(); } catch (e) { /* already gone */ }
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
    // "Your session expired" is wrong — and confusing — for someone who never got
    // one: an automatic boot login that failed, or a 401 on a context that has not
    // authenticated in this session. Both need the same click, different words.
    // `markNeedsInteraction` drops the dead SECRETS but deliberately keeps the
    // identity, so "does XOpatUser know who this is" separates the two cases. It
    // cannot use the settle memo: marking invalidates it.
    const user = (window as any).XOpatUser?.instance?.();
    const neverAuthenticated = payload.reason === "auto-login-failed"
        || !user?.getIsLogged?.(payload.contextId);
    const body = document.createElement("div");
    body.className = "flex flex-col gap-2 text-center py-2";
    const line = document.createElement("div");
    line.textContent = neverAuthenticated
        ? $.t("auth.signInRequiredBody", { service })
        : $.t("auth.sessionExpiredBody", { service });
    const hint = document.createElement("div");
    hint.className = "opacity-70 text-sm";
    hint.textContent = $.t("auth.clickToSignIn");
    body.append(line, hint);

    scrim = new UI.Modal({
        id: "auth-recovery-scrim",
        header: neverAuthenticated ? $.t("auth.signInRequiredTitle") : $.t("auth.sessionExpiredTitle"),
        body,
        isBlocking: true,
        allowClose: false,
        zIndex: SCRIM_Z_INDEX,
    });
    scrimContextId = payload.contextId;
    scrim.create();
    scrim.mount(document.body);
    scrim.open();
    // Nothing can finish booting until the user signs in, so a spinning
    // #fullscreen-loader is not "still working" — it is a deadlock on top of the
    // only control the user has. `viewer-open-pipeline` owns it again afterwards.
    try { (window as any).USER_INTERFACE?.Loading?.show?.(false); } catch (e) { /* best effort */ }

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

/** Viewers with a reopen in flight, so two callers cannot restart one another. */
const reopening = new WeakSet<object>();

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
 *
 * A viewer whose image never entered the world (the 401 hit `addTiledImage`, not a
 * tile) needs the stronger remedy — see {@link reopenViewerContent}.
 */
export function repairViewers(): void {
    const manager = (window as any).VIEWER_MANAGER;
    const viewers = manager?.viewers || [];
    for (const viewer of viewers) {
        if (!viewer) continue;
        // Read BEFORE clearing: a source that could not be instantiated is not in
        // the world at all, so there is no tile state for `resetItems` to reset —
        // that slide comes back only by opening it again.
        let needsReopen = false;
        try { needsReopen = viewer.__faultySources?.hasInstantiationFaulty?.() === true; } catch (e) { /* best effort */ }
        try { viewer.__faultySources?.clear?.(); } catch (e) { /* best effort */ }
        try { viewer.world?.resetItems?.(); } catch (e) { /* best effort */ }
        if (needsReopen) void reopenViewerContent(viewer);
    }
}

/**
 * Re-run the open pipeline for one viewer, unchanged selection and all: `force`
 * because the selection fingerprint did not change (only its outcome did), and
 * `historyMode: "skip"` because a failed load is not a navigation step the user
 * should be able to undo into.
 */
export async function reopenViewerContent(viewer: any): Promise<void> {
    const slot = (window as any).VIEWER_MANAGER?.getViewerSlotIndex?.(viewer);
    if (!(slot >= 0)) return;
    // Both the 401 handler and `repairViewers` can ask for the same viewer in the
    // same tick; a second reopen would tear down the first one mid-flight.
    if (reopening.has(viewer)) return;
    reopening.add(viewer);
    try {
        await (window as any).APPLICATION_CONTEXT?.updateViewerSelection?.(
            slot, {}, { force: true, historyMode: "skip" });
    } catch (e) {
        console.warn("auth-recovery: reopening the slide after sign-in failed", e);
    } finally {
        reopening.delete(viewer);
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

    const CREDENTIAL_EVENTS = ["login", "secret-updated"];

    /**
     * A credential landing MUST take the scrim/notice down even if no `-resolved`
     * event accompanies it. `auth-interaction-resolved` is raised by core's own
     * state transition; this closes the loop on any path that writes a secret
     * without going through it, so a blocking overlay can never outlive a working
     * login.
     */
    const onCredential = (contextId: string): void => {
        // Only when this UI is actually showing something for that context —
        // otherwise every ordinary token refresh would run `repairViewers()`.
        const showing = scrimContextId === contextId
            || auth()?.isInteractionRequired?.(contextId) === true;
        if (!showing) return;
        if (!auth()?.isAuthenticated?.(contextId)) return;
        // Not followed by `clearNeedsInteraction` on purpose: that now always raises
        // `-resolved`, which would re-enter the handler below and repair twice. A
        // stale core flag is already harmless — `markNeedsInteraction` converges it
        // instead of re-raising once the context is authenticated again.
        resolve(contextId);
    };

    /**
     * Credential events are named per context — `XOpatUser.getEventName(base, ctx)`
     * gives the bare `secret-updated` for `core` and `secret-updated:<ctx>` for
     * anything else (`src/classes/user.ts`). Subscribing to the bare names alone
     * therefore hears only `core`, and this safety net did nothing for a sub-context
     * — including one that is `isMain` and so gets the undismissable scrim.
     *
     * Contexts are configured after boot (some only when a feature first needs
     * them), so they cannot be enumerated up front. They do not need to be: this
     * listener only ever acts while the UI is showing something for a context, so
     * it is attached exactly then and detached when that display is taken down.
     */
    const watchers = new Map<string, () => void>();
    const watchCredentials = (contextId: string): void => {
        if (watchers.has(contextId)) return;
        const handler = () => onCredential(contextId);
        const names = CREDENTIAL_EVENTS.map(base => user.getEventName(base, contextId));
        for (const name of names) user.addHandler(name, handler);
        watchers.set(contextId, () => {
            for (const name of names) user.removeHandler?.(name, handler);
        });
    };
    const unwatchCredentials = (contextId: string): void => {
        watchers.get(contextId)?.();
        watchers.delete(contextId);
    };

    const resolve = (contextId: string): void => {
        unwatchCredentials(contextId);
        if (scrimContextId === contextId) closeScrim();
        clearContextNotice(contextId);
        (window as any).Dialogs?.hide?.(false);
        repairViewers();
    };

    user.addHandler("auth-interaction-changed", (payload: AuthEventPayload & { event?: string }) => {
        if (!payload?.contextId) return;
        if (payload.event === "auth-interaction-required") {
            // Last line of defence: never block a context that can authenticate
            // right now. The state and the event can disagree — a report can land
            // after the login that fixed it — and a wrongly-opened scrim is
            // undismissable by design, so it must not be openable on a healthy
            // credential in the first place.
            if (auth()?.isAuthenticated?.(payload.contextId)) {
                console.debug(`auth-recovery: ignoring interaction-required for ` +
                    `'${payload.contextId}' — the context is authenticated.`);
                resolve(payload.contextId);
                return;
            }
            if (payload.isMain) openScrim(payload);
            else showContextNotice(payload);
            watchCredentials(payload.contextId);
            return;
        }
        if (payload.event === "auth-interaction-resolved") {
            resolve(payload.contextId);
        }
    });

    if (typeof auth()?.onSettled === "function") {
        auth().onSettled((result: { contextId: string; authenticated: boolean }) => {
            if (result?.authenticated && result.contextId) onCredential(result.contextId);
        });
    }
}
