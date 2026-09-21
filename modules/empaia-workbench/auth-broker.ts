/// <reference path="../../src/types/globals.d.ts" />

/**
 * Auth broker for the EMPAIA Workbench.
 *
 * The workbench is the identity provider here: it mints the scope token and
 * pushes it over `postMessage`. There is no interactive login and no redirect —
 * "logging in" means "ask the embedder for a token and wait for it".
 *
 * Registered under the method name `"empaia-workbench"` and bound to the
 * context declared in `include.json::authContext` (default `"empaia"`). Every
 * consumer then goes through the normal path: `HttpClient` with
 * `auth: { contextId, types: APPLICATION_CONTEXT.auth.getSecretTypes(contextId) }`,
 * and a 401 drives `login()` → `tokenRequest` → new token → retry. This is the
 * same behaviour the reference AppUI implements by hand with
 * `retryOnAction(errors, actions$, setAccessToken, requestNewToken)`.
 *
 * The token's `exp` is load-bearing in two places — see `token-expiry.ts` for why
 * decoding it locally is the only option, and `isAuthenticated` / `scheduleRenew`
 * below for what it buys.
 *
 * See src/AUTH.md.
 */

import {
    addTokenListener, requestNewToken, type Token,
} from "@empaia/vendor-app-communication-interface";
import { isTokenLive, jwtExpiresInSec, renewDelayMs } from "./token-expiry";

export const EMPAIA_AUTH_METHOD = "empaia-workbench";

/**
 * How long `login()` waits for the embedder to answer a token request.
 *
 * Deliberately **under** core's own refresh window: `XOpatUser.requestSecretUpdate`
 * defaults to 20 s (`src/classes/user.ts`) and `_maybeRefreshSecrets` does not override it,
 * so a longer wait here means core gives up first, removes its `secret-updated` handler and
 * retries the request with the credential that just failed — while this broker is still
 * waiting for the replacement. A token landing at 25 s was written *after* the retry had
 * already gone out. Answering inside core's window instead makes the refresh one round trip.
 */
const TOKEN_WAIT_MS = 15_000;

/** True when nothing frames us — there is no workbench to ask for a token. */
function notEmbedded(): boolean {
    return window.self === window.top;
}

function log(): any {
    return (window as any).APPLICATION_CONTEXT?.log?.("module.empaia-workbench:auth");
}

/** Seconds left on the credential in hand, for a diagnostic. `null` when unknowable. */
function secretLifeSec(ctx: string): number | null {
    const secret = (window as any).XOpatUser?.instance?.()?.getSecret?.("jwt", ctx);
    const left = jwtExpiresInSec(secret);
    return left === null ? null : Math.round(left);
}

/**
 * Is the credential currently held for `ctx` usable?
 *
 * Presence alone is not the question, and answering it that way is what made a long session
 * unrecoverable: an EXPIRED token is still a non-empty string, so the context reported itself
 * authenticated, `whenContextSettled` resolved instantly, the job poller resumed straight into
 * another 401, and the escalation branch below (guarded on the token being *absent*) never ran.
 *
 * A token this module cannot parse is trusted, exactly as before — the workbench is the
 * authority on its own tokens and a format we do not recognise must not lock the session out.
 */
function hasLiveSecret(ctx: string): boolean {
    const u = (window as any).XOpatUser?.instance?.();
    if (!u || !u.getIsLogged(ctx)) return false;
    return isTokenLive(u.getSecret("jwt", ctx));
}

/**
 * Callers waiting for a token that has not arrived yet. Resolved by the single listener
 * registered in `startForwarding`.
 *
 * A `Set` rather than an array because every waiter must be removable: `withTimeout` used to
 * reject and leave its resolver behind, so each failed login/refresh cycle appended one dead
 * entry for the life of the session — and they all fired at once if a token ever landed.
 */
const tokenWaiters = new Set<(token: string) => void>();

/**
 * Resolve when the workbench delivers the NEXT token; `dispose()` withdraws the wait.
 *
 * Deliberately not implemented as a fresh `addTokenListener`: VACI's emitter replays the last
 * value synchronously to every new listener, so a per-call listener would resolve immediately
 * with the CURRENT token — which is exactly the stale one the 401 refresh is trying to replace.
 * Waiting on the shared queue instead means only a genuinely new emission settles this, and no
 * listener is leaked per call (VACI's `removeTokenListener` cannot remove index 0, so
 * registering per call would accumulate).
 */
function nextToken(): { promise: Promise<string>; dispose: () => void } {
    let resolver!: (token: string) => void;
    const promise = new Promise<string>(resolve => {
        resolver = resolve;
        tokenWaiters.add(resolve);
    });
    return { promise, dispose: () => { tokenWaiters.delete(resolver); } };
}

/** `nextToken()` under a deadline, with the waiter withdrawn however the wait ends. */
async function awaitNextToken(ms: number, message: string): Promise<string> {
    const { promise, dispose } = nextToken();
    try {
        return await withTimeout(promise, ms, message);
    } finally {
        dispose();
    }
}

export interface RegisterAuthBrokerOptions {
    contextId: string;
    /** Scope id, used as the identity label until the scope record arrives. */
    getScopeId(): string | undefined;
    serviceName?: string;
}

/**
 * Register the broker and claim the context. Safe to call once per session;
 * later `configureContext` calls for the same context are refused by core.
 *
 * @returns a promise resolving when the context has been configured (the broker
 *          `init` hook has run and token forwarding is live).
 */
export async function registerWorkbenchAuthBroker(options: RegisterAuthBrokerOptions): Promise<void> {
    const { contextId } = options;
    const auth = (window as any).APPLICATION_CONTEXT?.auth;
    if (!auth?.registerBroker) {
        console.warn("[empaia-workbench] APPLICATION_CONTEXT.auth unavailable — token will not be brokered.");
        return;
    }

    // Announce the discovery SYNCHRONOUSLY, before the first await: this function
    // declares its context asynchronously, so without this the boot barrier can
    // look at `listAutoLoginContexts()` before the context exists, find nothing to
    // wait for, and open the first slide against a token that has not landed.
    // Must always settle — core awaits it — hence the `finally` at the end.
    let discoveryDone: () => void = () => {};
    if (typeof auth.registerContextDiscovery === "function") {
        auth.registerContextDiscovery(new Promise<void>((resolve) => { discoveryDone = resolve; }));
    }

    const user = () => (window as any).XOpatUser?.instance?.();
    /** The VACI listener is one-shot (index 0 can never be removed). */
    let listening = false;
    /** The `secret-needs-update` subscription; tracked separately — see `startForwarding`. */
    let refreshBound = false;
    /** The proactive renew, armed off the token's own `exp`. */
    let renewTimer: any = null;
    /** Whether the user has already been told this session that the workbench stopped answering. */
    let toldToReopen = false;

    /**
     * Ask for the next token BEFORE the current one dies.
     *
     * Without this the module only ever asks after a request has already failed, which is one
     * guaranteed 401 per token lifetime (src/AUTH.md, "Both server brokers also report the
     * lifetime … Without that, nothing asked for a new token until something failed") — and it
     * asks at the worst possible moment, when the workbench may no longer be answering for this
     * frame at all. Every other broker in the repo renews ahead of expiry; this is that.
     *
     * A token whose lifetime cannot be read, or is too short to schedule inside, arms nothing:
     * the reactive `secret-needs-update` path is then exactly what it was.
     */
    const scheduleRenew = (token: string) => {
        if (renewTimer) { clearTimeout(renewTimer); renewTimer = null; }
        const left = jwtExpiresInSec(token);
        const delay = renewDelayMs(left);
        if (delay === null) {
            log()?.debug({ expiresInSec: left === null ? null : Math.round(left) },
                "no proactive renew armed; falling back to the 401 path");
            return;
        }
        log()?.debug({ expiresInSec: Math.round(left as number), renewInMs: delay },
            "workbench token accepted; renew armed");
        renewTimer = setTimeout(() => {
            renewTimer = null;
            if (notEmbedded()) return;
            log()?.debug({ expiresInSec: secretLifeSec(contextId) }, "renewing the workbench token");
            requestNewToken();
        }, delay);
    };

    /**
     * Tell the user the one thing that can actually fix this.
     *
     * Core's generic recovery offers "Sign in", whose click lands back in `login()` →
     * `requestNewToken()`. When the workbench has stopped answering for this frame — which is
     * what an expired app-frontend token looks like from in here — no number of clicks can
     * produce a token, and only reopening the app in the Workbench mints a new signed URL.
     * Said once per session; a token landing re-arms it.
     */
    const tellUserToReopen = () => {
        if (toldToReopen) return;
        toldToReopen = true;
        const dialogs = (globalThis as any).Dialogs;
        // delay < 1000 → sticks until dismissed; this is not something to blink past.
        dialogs?.show?.($.t("error.tokenUnrecoverable", { ns: "empaia-workbench" }),
            0, dialogs?.MSG_WARN);
    };

    /**
     * Renewal, driven by `HttpClient`'s `refreshOn401`.
     *
     * This module is the auth PROVIDER for its context — the workbench mints the
     * scope token and pushes it over VACI, so nothing else can renew it. Without
     * a listener here `XOpatUser.requestSecretUpdate` rejects outright (it
     * refuses when no provider is subscribed) and `refreshOn401` can never
     * recover an expired token. Same contract `saml-auth` / `oidc-client-ts` /
     * `oidc-server-ts` / `basic-auth` implement.
     *
     * @returns whether the subscription is now in place.
     */
    const bindRefresh = (ctx: string): boolean => {
        const u = user();
        if (!u) {
            console.warn("[empaia-workbench] XOpatUser unavailable — retrying the refresh binding later.");
            return false;
        }
        u.addHandler(u.getEventName("secret-needs-update", ctx), async (e: any) => {
            if (e?.type && e.type !== "jwt") return;
            if (notEmbedded()) return;
            log()?.debug({ expiresInSec: secretLifeSec(ctx) }, "refresh requested");
            requestNewToken();
            await awaitNextToken(TOKEN_WAIT_MS,
                "EMPAIA Workbench did not answer the token refresh in time.")
                .catch(err => console.warn("[empaia-workbench] token refresh failed:", err?.message ?? err));
            // Report, so this module gets the same recovery as every other broker:
            // without it `isInteractionRequired`, the appbar badge, the
            // `awaitInteractive` request hold and the recovery scrim were all dead
            // surface here, and a workbench whose token stopped renewing left the
            // context silently unauthenticated behind a single console warning.
            //
            // The test is whether the credential in hand is USABLE, not whether one
            // exists. Guarding on absence made this branch dead in the one case it was
            // written for: an expired token is never removed, so `getSecret` stayed
            // truthy and nothing was ever reported.
            //
            // Guarded on being embedded (checked again — the frame relationship
            // cannot change, but `login()` throws when un-embedded, so a scrim there
            // would have no recovery behind its click). Never `force`: a refresh
            // timing out is not proof the token in hand is dead.
            if (!hasLiveSecret(ctx)) {
                log()?.warn({ expiresInSec: secretLifeSec(ctx) },
                    "the workbench did not deliver a usable token");
                (window as any).APPLICATION_CONTEXT?.auth?.markNeedsInteraction?.(
                    ctx, { reason: "workbench-token-timeout" });
                tellUserToReopen();
            }
        });
        return true;
    };

    /**
     * The single token listener: forwards every token into XOpatUser and wakes
     * anyone blocked in `nextToken()`. Registered once — see that function for
     * why per-call listeners are wrong here.
     *
     * The refresh binding is latched SEPARATELY. Latching both together meant that a call
     * arriving before `XOpatUser` existed registered the VACI listener, failed to bind the
     * refresh, and marked the whole thing done — after which `requestSecretUpdate` rejected
     * with "no provider listens for 'secret-needs-update:<ctx>'" for the rest of the session.
     */
    const startForwarding = (ctx: string) => {
        if (!refreshBound) refreshBound = bindRefresh(ctx);
        if (listening) return;
        listening = true;
        addTokenListener((token: Token) => {
            if (!token?.value) return;

            const u = user();
            if (u) {
                // A non-core context is only "logged in" once an identity exists
                // for it; the scope id is the stable per-session identity the
                // workbench gives us (the human user id arrives later with the
                // scope record and is folded in by `setWorkbenchIdentity`).
                if (!u.getIsLogged(ctx)) {
                    u.login(options.getScopeId() ?? "empaia-scope", "EMPAIA", "", ctx);
                }
                u.setSecret(token.value, "jwt", ctx);
            }
            // A token landed, so the workbench is answering again — and the next failure
            // deserves to be reported as freshly as the first.
            toldToReopen = false;
            scheduleRenew(token.value);

            const waiters = Array.from(tokenWaiters);
            tokenWaiters.clear();
            for (const resolve of waiters) resolve(token.value);
        });
    };

    auth.registerBroker(EMPAIA_AUTH_METHOD, {
        async init(ctx: string) {
            startForwarding(ctx);
        },
        /**
         * Report readiness precisely instead of letting core guess.
         *
         * `init()` only *registers* the VACI listener — the token lands later —
         * which is exactly the case this hook exists for. Without it core falls
         * back to a fixed 1.5 s grace before every early request. Must not start
         * an interactive login, and must resolve: core races it against its own
         * deadline.
         */
        async whenSettled(ctx: string) {
            if (hasLiveSecret(ctx)) return;
            if (notEmbedded()) return;
            // Bounded even though core owns the deadline: an unbounded wait leaves a live
            // waiter behind on every settle that times out, and core's own bound (8 s) is
            // shorter than this one anyway, so nothing observable changes.
            await awaitNextToken(TOKEN_WAIT_MS, "EMPAIA Workbench did not send a token in time.")
                .catch(() => { /* core owns the deadline */ });
        },
        /**
         * The token handover IS non-interactive: it is a `postMessage` round trip,
         * with no window, no navigation and nothing on screen. Exposing it under the
         * contract name is what lets core's automatic ladder use it — and, because
         * this broker cannot navigate, is the only rung it can offer.
         */
        async loginSilent(ctx: string) {
            startForwarding(ctx);
            if (notEmbedded()) return false;
            requestNewToken();
            await awaitNextToken(TOKEN_WAIT_MS,
                "EMPAIA Workbench did not answer the token request in time.")
                .catch(() => { /* the credential below is the verdict */ });
            return hasLiveSecret(ctx);
        },
        // Gesture-free (nothing a popup blocker can refuse) but NOT navigating, so
        // it must not consume the single boot-navigation slot core arbitrates.
        // Exactly the case the two hooks are split for.
        canLoginWithoutGesture: () => true,
        navigatesOnLogin: () => false,
        async login(ctx: string) {
            startForwarding(ctx);
            if (notEmbedded()) {
                throw new Error($.t("error.notEmbedded", { ns: "empaia-workbench" }));
            }
            // VACI posts `tokenRequest` to the origin it recorded from the last
            // inbound message, so this only works once a token has arrived —
            // which is exactly the case on the 401 refresh path that calls it.
            requestNewToken();
            try {
                await awaitNextToken(TOKEN_WAIT_MS,
                    "EMPAIA Workbench did not answer the token request in time.");
            } catch (e) {
                // The user clicked "Sign in" and there is nothing behind that click but this
                // request. Saying so is the difference between a button they will press again
                // and the one action that can actually recover the session.
                tellUserToReopen();
                throw e;
            }
        },
        async logout(ctx: string) {
            // The workbench owns the session lifetime; we only drop our copy.
            if (renewTimer) { clearTimeout(renewTimer); renewTimer = null; }
            user()?.logout(ctx);
        },
        isAuthenticated(ctx: string): boolean {
            return hasLiveSecret(ctx);
        },
        getToken(ctx: string) {
            return user()?.getSecret("jwt", ctx);
        },
    });

    try {
        await auth.configureContext({
            contextId,
            method: EMPAIA_AUTH_METHOD,
            serviceName: options.serviceName ?? "EMPAIA Workbench",
            secretTypes: ["jwt"],
            // Embedded, the token handover IS an automatic login — gesture-free and
            // non-navigating, exactly what core's silent phase is for. Declaring it
            // makes the boot barrier wait for the token instead of opening the first
            // slide against a credential that has not landed. Un-embedded there is no
            // workbench to ask, so there is nothing to wait for.
            //
            // Not a config decision, so no getOption: it is `window.self === window.top`.
            autoLogin: !notEmbedded(),
        });
    } finally {
        discoveryDone();
    }
}

/**
 * Attach the workbench's human user identity to the context once the scope
 * record is known. Purely cosmetic (it names the identity in the UI); the token
 * is what authorizes anything.
 *
 * **Never change the identity ID of a live context here — and never `logout()`.**
 * On a non-core context both are secret-destroying operations: `logout()` and the
 * identity-swap branch of `login()` (a `login()` whose id differs from the one in
 * place) run `user.ts` `_clearContextSecrets`, which deletes `<ctx>:jwt`. The
 * workbench token has no other source than VACI, so the next request goes out with
 * no `Authorization` header and the backend answers `403 {"detail":"Not
 * authenticated"}` — FastAPI's bearer scheme reports a *missing* header as 403, not
 * 401. That is exactly what happened here: the token listener installs the scope id
 * as the identity, this function then arrived with `scope.user_id`, and every
 * request after it was unauthenticated.
 *
 * So the identity id stays whatever was installed first (the scope id — a stable
 * per-session subject) and the human user id becomes the *display name*: passing the
 * current id back takes `login()`'s re-assert path, which refreshes `{id,name,icon}`,
 * raises no event and does not touch `_secret`. Consequence worth knowing:
 * `getUserId(contextId)` reports the scope id, not the workbench user id.
 */
export function setWorkbenchIdentity(contextId: string, userId: string): void {
    const u = (window as any).XOpatUser?.instance?.();
    if (!u || !userId) return;
    const current: string | null | undefined = u.getUserId?.(contextId);
    if (!current) {
        // No identity yet (no token has landed): installing one clears nothing.
        u.login(userId, userId, "", contextId);
        return;
    }
    // Same id, refined label. Never `userId` as the id — see above.
    u.login(current, userId, "", contextId);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms);
        promise.then(
            v => { clearTimeout(timer); resolve(v); },
            e => { clearTimeout(timer); reject(e); }
        );
    });
}
