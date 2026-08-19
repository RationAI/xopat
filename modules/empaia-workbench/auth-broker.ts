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
 * See src/AUTH.md.
 */

import {
    addTokenListener, requestNewToken, type Token,
} from "@empaia/vendor-app-communication-interface";

export const EMPAIA_AUTH_METHOD = "empaia-workbench";

/** How long `login()` waits for the embedder to answer a token request. */
const TOKEN_WAIT_MS = 30_000;

/** True when nothing frames us — there is no workbench to ask for a token. */
function notEmbedded(): boolean {
    return window.self === window.top;
}

/**
 * Callers waiting for a token that has not arrived yet. Resolved by the single
 * listener registered in `startForwarding`.
 */
let tokenWaiters: Array<(token: string) => void> = [];

/**
 * Resolve when the workbench delivers the NEXT token.
 *
 * Deliberately not implemented as a fresh `addTokenListener`: VACI's emitter
 * replays the last value synchronously to every new listener, so a per-call
 * listener would resolve immediately with the CURRENT token — which is exactly
 * the stale one the 401 refresh is trying to replace. Waiting on the shared
 * queue instead means only a genuinely new emission settles this, and no
 * listener is leaked per call (VACI's `removeTokenListener` cannot remove
 * index 0, so registering per call would accumulate).
 */
function nextToken(): Promise<string> {
    return new Promise<string>(resolve => tokenWaiters.push(resolve));
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

    const user = () => (window as any).XOpatUser?.instance?.();
    let forwarding = false;

    /**
     * Renewal, driven by `HttpClient`'s `refreshOn401`.
     *
     * This module is the auth PROVIDER for its context — the workbench mints the
     * scope token and pushes it over VACI, so nothing else can renew it. Without
     * a listener here `XOpatUser.requestSecretUpdate` rejects outright (it
     * refuses when no provider is subscribed) and `refreshOn401` can never
     * recover an expired token. Same contract `saml-auth` / `oidc-client-ts` /
     * `oidc-server-ts` / `basic-auth` implement.
     */
    const bindRefresh = (ctx: string) => {
        const u = user();
        if (!u) {
            console.warn("[empaia-workbench] XOpatUser unavailable — expired tokens will not be refreshed.");
            return;
        }
        u.addHandler(u.getEventName("secret-needs-update", ctx), async (e: any) => {
            if (e?.type && e.type !== "jwt") return;
            if (notEmbedded()) return;
            requestNewToken();
            await withTimeout(nextToken(), TOKEN_WAIT_MS,
                "EMPAIA Workbench did not answer the token refresh in time.")
                .catch(err => console.warn("[empaia-workbench] token refresh failed:", err?.message ?? err));
        });
    };

    /**
     * The single token listener: forwards every token into XOpatUser and wakes
     * anyone blocked in `nextToken()`. Registered once — see that function for
     * why per-call listeners are wrong here.
     */
    const startForwarding = (ctx: string) => {
        if (forwarding) return;
        forwarding = true;
        bindRefresh(ctx);
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

            const waiters = tokenWaiters;
            tokenWaiters = [];
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
            if (user()?.getSecret("jwt", ctx)) return;
            if (notEmbedded()) return;
            await nextToken().catch(() => { /* core owns the deadline */ });
        },
        async login(ctx: string) {
            startForwarding(ctx);
            if (notEmbedded()) {
                throw new Error("EMPAIA Workbench token is unavailable: the viewer is not embedded in a workbench client.");
            }
            // VACI posts `tokenRequest` to the origin it recorded from the last
            // inbound message, so this only works once a token has arrived —
            // which is exactly the case on the 401 refresh path that calls it.
            requestNewToken();
            await withTimeout(nextToken(), TOKEN_WAIT_MS,
                "EMPAIA Workbench did not answer the token request in time.");
        },
        async logout(ctx: string) {
            // The workbench owns the session lifetime; we only drop our copy.
            user()?.logout(ctx);
        },
        isAuthenticated(ctx: string): boolean {
            const u = user();
            return !!u && u.getIsLogged(ctx) && !!u.getSecret("jwt", ctx);
        },
        getToken(ctx: string) {
            return user()?.getSecret("jwt", ctx);
        },
    });

    await auth.configureContext({
        contextId,
        method: EMPAIA_AUTH_METHOD,
        serviceName: options.serviceName ?? "EMPAIA Workbench",
        secretTypes: ["jwt"],
    });
}

/**
 * Attach the workbench's human user identity to the context once the scope
 * record is known. Purely cosmetic (it names the identity in the UI); the token
 * is what authorizes anything.
 *
 * **Never `logout()` here.** On a non-core context `XOpatUser.logout()` also
 * clears that context's secrets (`user.ts` `_clearContextSecrets`) — so a
 * logout/login cycle silently threw away the workbench token, and the next
 * request went out with no `Authorization` header and got a 403. `login()`
 * overwrites the identity in place and never touches `_secret`, so re-asserting
 * is enough. Same pattern as `modules/saml-auth` `_applyToken`.
 */
export function setWorkbenchIdentity(contextId: string, userId: string): void {
    const u = (window as any).XOpatUser?.instance?.();
    if (!u || !userId) return;
    // Re-assert only on a real change, so an unchanged identity raises no event.
    if (!u.getIsLogged(contextId) || u.getUserId?.(contextId) !== userId) {
        u.login(userId, userId, "", contextId);
    }
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
