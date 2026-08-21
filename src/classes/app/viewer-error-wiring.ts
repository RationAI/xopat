// Wires the user-facing error/warning broadcast handlers onto VIEWER_MANAGER.
// Extracted from src/app.ts. Three of these are documented as VIEWER events
// (`warn-user`, `error-user`, `add-item-failed`) — keeping the JSDoc bodies
// here so the doc generator picks them up.

import type OpenSeadragon from "openseadragon";
import { repairViewers, reopenViewerContent } from "./auth-recovery-ui";

export function wireViewerErrorHandlers(viewerManager: any): void {
    /**
     * Event to fire if you want to avoid explicit warning handling,
     * recommended in modules where module should give plugin chance hande it.
     * The core fires a dialog with provided message if not handled.
     * @property originType: `"module"`, `"plugin"` or other type of the source
     * @property originId: unique code component id, e.g. a plugin id
     * @property code: unique error identifier, e.g. W_MY_MODULE_ERROR
     * @property message: a brief description of the case
     * @property preventDefault: if true, the core will not fire default event
     * @property trace: optional data or context object, e.g. an error object from an exception caught
     * @memberOf OpenSeadragon.Viewer
     * @event warn-user
     */
    viewerManager.broadcastHandler('warn-user', (e: ErrorUserEvent) => {
        if (e.preventDefault || !e.message) return;
        Dialogs.show(e.message, Math.max(Math.min(50 * e.message.length, 15000), 5000), Dialogs.MSG_WARN, false);
    }, null, -Infinity);
    /**
     * Event to fire if you want to avoid explicit error handling,
     * recommended in modules where module should give plugin chance hande it.
     * The core fires an error dialog with provided message if not handled.
     * @property originType: `"module"`, `"plugin"` or other type of the source
     * @property originId: unique code component id, e.g. a plugin id
     * @property code: unique error identifier, e.g. W_MY_MODULE_ERROR
     * @property message: a brief description of the case
     * @property preventDefault: if true, the core will not fire default event
     * @property trace: optional data or context object, e.g. an error object from an exception caught
     * @memberOf OpenSeadragon.Viewer
     * @event error-user
     */
    viewerManager.broadcastHandler('error-user', (e: ErrorUserEvent) => {
        if (e.preventDefault || !e.message) return;
        Dialogs.show(e.message, Math.max(Math.min(50 * e.message.length, 15000), 5000), Dialogs.MSG_ERR, false);
    }, null, -Infinity);
    // `plugin-failed` / `module-failed` are raised on the manager itself, so they must
    // be subscribed there: `broadcastHandler` only attaches to viewer instances, which
    // is why the plugin-failed toast never actually fired.
    viewerManager.addHandler('plugin-failed', (e: PluginFailedEvent) => Dialogs.show(e.message, 6000, Dialogs.MSG_ERR));
    /**
     * A module was quarantined after its construction threw. The module is disabled
     * for the rest of the session; features depending on it degrade.
     * @property {string} id module id
     * @property {string} message
     * @memberOf VIEWER_MANAGER
     * @event module-failed
     */
    viewerManager.addHandler('module-failed', (e: ModuleFailedEvent) => Dialogs.show(e.message, 6000, Dialogs.MSG_ERR));

    // Retrospective tile-request failures: `source-marked-faulty` fires exactly
    // once per source when consecutive per-source tile failures cross the faulty
    // threshold (the registry resets on any successful tile, so healthy sources
    // never fire). Surface a single warning toast — the event itself is the
    // throttle, so no debounce is needed here.
    viewerManager.broadcastHandler('source-marked-faulty', () => {
        // networkStatus already shows a sticky offline toast + app-bar pill while
        // offline; tile failures then are expected/transient, so don't double-notify.
        if (APPLICATION_CONTEXT.networkStatus?.isOffline) return;
        // Generic message on purpose: Toast dedupes identical text into one toast
        // with a ×N badge, so several faulty slides collapse into one notification.
        Dialogs.show($.t('error.slide.tilesFaulty'), 8000, Dialogs.MSG_WARN);
    });

    let notified = false;

    /**
     * How many times a 401 has been answered with "the token arrived late, reopen
     * the slide" for one viewer, cleared the moment that viewer opens something.
     *
     * The reopen is the remedy for a boot race, and a boot race resolves on the
     * first retry. If the client believes it is authenticated but the upstream
     * keeps answering 401 — audience/scope mismatch, a token revoked server-side,
     * a proxy stripping the header — nothing about the retry changes, and the
     * settle verdict is memoized, so the reopen 401s, re-enters this handler and
     * reopens again: an unbounded loop against the store with nothing on screen to
     * explain it. The `reopening` WeakSet guards concurrency, not repetition.
     */
    const reopenAttempts = new WeakMap<object, number>();
    const MAX_AUTH_REOPENS = 1;
    viewerManager.broadcastHandler('open', (e: any) => {
        if (e?.eventSource) reopenAttempts.delete(e.eventSource);
        // A newly opened slide is entitled to its own diagnostics: the toast latch is
        // there to collapse a burst from ONE open, not to mute the rest of the session.
        notified = false;
    });

    /**
     * A 401 on a slide does NOT necessarily mean the user must sign in: at boot it
     * usually means the login attempt has not finished yet (a redirect return being
     * processed, a broker that discovers its contexts from the server). Blocking the
     * viewer with the recovery scrim at that moment is exactly wrong — it accuses the
     * user of an expired session while their login is mid-flight.
     *
     * So wait for the context to finish TRYING (bounded; `claimGraceMs` also covers a
     * context that no broker has claimed yet), and only then decide:
     *  - authenticated → the token merely arrived late; re-request the tiles that died.
     *  - not authenticated → genuine, flag it and let the recovery gate prompt.
     */
    /**
     * WHICH auth context did the dead request belong to?
     *
     * A slide resolved from a protocol that declares an `HttpClient` carries that
     * client on the TileSource (`__xopatHttpClient`, see `src/tile-source.ts`), and
     * the client knows its context. Assuming the main identity instead meant a 401
     * on a sub-context slide force-dropped `core`'s credential and raised a scrim
     * whose sign-in click targets a context that never failed — or, when `core` is
     * not configured at all, one that cannot be logged in.
     *
     * `undefined` (the main context) stays the answer when nothing is stamped: that
     * is what the bare-fetch tile path authenticates with.
     *
     * Only the FAILING source is consulted. Falling back to `world.getItemAt(0)`
     * looked harmless but is the same bug one level down: in a multi-image viewer
     * item 0 can belong to a different slide on a different context, so a 401 on an
     * overlay would be reported — with `force: true` — against a context that never
     * failed, dropping a working credential. An unidentifiable source is answered
     * with the documented default, not with someone else's context.
     */
    const contextOfFailedItem = (e: any): string | undefined => {
        const ctx = e?.options?.tileSource?.__xopatHttpClient?.authContextId;
        return typeof ctx === "string" && ctx ? ctx : undefined;
    };

    const handleSlideUnauthorized = async (viewer: any, contextId: string | undefined) => {
        const auth = (window as any).APPLICATION_CONTEXT?.auth;
        if (!auth?.markNeedsInteraction) {
            viewer?.getMenu?.()?.getNavigatorTab?.()?.setTitle($.t('main.global.tissue'), true);
            Dialogs.show($.t('error.slide.401'), 20000, Dialogs.MSG_ERR);
            XOpatUser.instance().logout();
            return;
        }
        // Read BEFORE the wait below. The 401 is proof about the credential that was
        // attached to the dead request; by the time we finish waiting, a newer one
        // may have landed, and reporting against that one would drop a credential
        // that never failed (after which everything 401s and "confirms" it).
        const epoch = auth.getCredentialEpoch?.(contextId);
        const authenticated = typeof auth.whenContextSettled === "function"
            && await auth.whenContextSettled(contextId, { claimGraceMs: 3000 });
        if (authenticated) {
            const attempts = (viewer ? reopenAttempts.get(viewer) ?? 0 : 0) + 1;
            if (viewer && attempts > MAX_AUTH_REOPENS) {
                // The credential says it is fine and the store keeps saying 401.
                // Retrying cannot resolve that disagreement, so stop and say so.
                console.warn(`xOpat: slide kept returning 401 for auth context ` +
                    `'${contextId ?? "core"}' after ${MAX_AUTH_REOPENS} reopen attempt(s), ` +
                    `while the context reports as authenticated. Likely an audience/scope ` +
                    `mismatch, a server-side revocation, or a proxy dropping the header.`);
                viewer?.getMenu?.()?.getNavigatorTab?.()?.setTitle($.t('main.global.tissue'), true);
                Dialogs.show($.t('error.slide.401'), 20000, Dialogs.MSG_ERR);
                return;
            }
            if (viewer) reopenAttempts.set(viewer, attempts);
            // Let a later, genuine 401 report again — this one was a boot race.
            notified = false;
            repairViewers();
            // `add-item-failed` means the image never entered the world, so
            // `resetItems()` has nothing to re-request — the slide itself has to be
            // opened again.
            await reopenViewerContent(viewer);
            return;
        }
        // Nothing claims this context, so there is no login to offer. Raising the
        // gate anyway produced a blocking, undismissable scrim whose click called
        // `auth.login(ctx)` — which throws for an unconfigured context — leaving the
        // user with "Sign-in did not complete" and no way forward. Report the 401 for
        // what it is instead.
        if (typeof auth.getContextConfig === "function" && !auth.getContextConfig(contextId)) {
            console.warn(`xOpat: slide request returned 401 for auth context '${contextId ?? "core"}', ` +
                `but no auth module claims it — cannot offer a sign-in. See src/AUTH.md.`);
            viewer?.getMenu?.()?.getNavigatorTab?.()?.setTitle($.t('main.global.tissue'), true);
            Dialogs.show($.t('error.slide.401'), 20000, Dialogs.MSG_ERR);
            return;
        }
        // `force`: a 401 from the resource the credential protects IS the proof that
        // it is unusable, so this is not a deferrable report (see markNeedsInteraction).
        auth.markNeedsInteraction(contextId, { reason: "slide-401", force: true, epoch });
    };

    //todo error?
    viewerManager.broadcastHandler('add-item-failed', (e: OpenSeadragon.ViewerEventMap["add-item-failed"] & OpenSeadragon.ViewerEvent) => {
        const msg = e.message;
        const statusCode = msg && typeof msg !== 'string' ? msg.statusCode : undefined;
        if (statusCode) {
            //todo check if the first background
            switch (statusCode) {
                case 401: {
                    // Request a login instead of logging out (which wiped every
                    // secret and told the user to reload). The recovery gate
                    // prompts on their next click and re-requests the tiles that
                    // died, so a slide that 401'd on an expired token recovers in
                    // place — but only once the login attempt has actually settled.
                    //
                    // Deliberately NOT behind `notified`. That latch exists to stop
                    // duplicate error toasts, and it was set by ANY status — so one
                    // 404 on one layer at boot silently disabled authentication
                    // recovery for the rest of the session. This branch shows no
                    // toast of its own and carries its own bounds (the settle wait
                    // and `MAX_AUTH_REOPENS`), so it needs no throttle.
                    void handleSlideUnauthorized(e.eventSource, contextOfFailedItem(e));
                    break;
                }
                case 403:
                    if (notified) break;
                    notified = true;
                    e.eventSource.getMenu().getNavigatorTab().setTitle($.t('main.global.tissue'), true);
                    Dialogs.show($.t('error.slide.403'),
                        20000, Dialogs.MSG_ERR);
                    break;
                case 404:
                    if (notified) break;
                    notified = true;
                    Dialogs.show($.t('error.slide.404'),
                        20000, Dialogs.MSG_ERR);
                    break;
                default:
                    break;
            }
        } else {
            // Error is thrown by OSD
            console.info('Item failed to load and the event does not contain reliable information to notify user. Notification was bypassed.');
        }
    });
}
