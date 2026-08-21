/**
 * Core, not each broker, drives the automatic (click-less) login.
 *
 * Every broker used to re-implement the ladder inside its own `init()`, and each
 * got a different subset right — one had no redirect-loop guard at all, one
 * bypassed the gesture rule outright, and the "only one context may navigate at
 * boot" invariant was enforced per-broker, so a deployment mixing two auth modules
 * had two guards each watching half the set and nothing watching the whole.
 *
 * These vectors pin what `runAutoLogin()` now owns:
 *  - silent routes run first, in parallel, and a success ends it with nothing on
 *    screen and no interactive call,
 *  - at most ONE navigating login runs, the main context wins, and the loser is
 *    demoted to on-demand rather than gated (the appbar already offers it),
 *  - a gesture-free but NON-navigating flow is not exclusive and still runs,
 *  - `"unknown"` from a silent route (the authority was never reached) does not
 *    escalate to a navigation and does not raise the gate,
 *  - a boot attempt already spent on a previous page load hands over to the gate
 *    instead of redirecting again,
 *  - `login`'s wait is bounded by `timeoutMs`, so the boot barrier cannot be held
 *    for the five-minute interactive default.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

/** Minimal XOpatUser: identity + secrets + the event surface XOpatAuth binds to. */
function installUser() {
    const handlers = new Map();
    const identities = new Map();
    const secrets = new Map();
    const ctxOf = (contextId) => contextId || "core";
    const key = (type, contextId) => `${ctxOf(contextId)}:${type}`;

    const user = {
        raised: [],
        getEventName(name, contextId) {
            const ctx = ctxOf(contextId);
            return ctx === "core" ? name : `${name}:${ctx}`;
        },
        addHandler(event, cb) {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event).push(cb);
        },
        removeHandler(event, cb) {
            const list = handlers.get(event) || [];
            const i = list.indexOf(cb);
            if (i >= 0) list.splice(i, 1);
        },
        numberOfHandlers: (event) => (handlers.get(event) || []).length,
        raiseEvent(event, payload) {
            user.raised.push({ event, payload });
            for (const cb of [...(handlers.get(event) || [])]) cb(payload || {});
        },
        getIsLogged: (contextId) => identities.has(ctxOf(contextId)),
        getUserId: (contextId) => identities.get(ctxOf(contextId)) ?? null,
        getSecret: (type, contextId) => secrets.get(key(type, contextId)),
        setSecret(secret, type, contextId) {
            const k = key(type, contextId);
            if (secret) {
                secrets.set(k, secret);
                user.raiseEvent(user.getEventName("secret-updated", contextId), { secret, type, contextId });
            } else if (secrets.has(k)) {
                secrets.delete(k);
                user.raiseEvent(user.getEventName("secret-removed", contextId), { type, contextId });
            }
        },
        login(id, name, icon, contextId) {
            const ctx = ctxOf(contextId);
            identities.set(ctx, id);
            user.raiseEvent(user.getEventName("login", ctx), { userId: id, contextId: ctx });
        },
        logout(contextId) {
            const ctx = ctxOf(contextId);
            identities.delete(ctx);
            user.raiseEvent(user.getEventName("logout", ctx), { contextId: ctx });
        },
    };

    globalThis.window.XOpatUser = { instance: () => user };
    return user;
}

function watchInteraction(user) {
    const seen = [];
    user.addHandler("auth-interaction-changed", (p) => seen.push(p.event));
    return { get required() { return seen.filter((e) => e === "auth-interaction-required").length; } };
}

async function freshAuth() {
    const mod = await import(`../../../src/classes/auth/xopat-auth.ts?t=${Math.random()}`);
    return new mod.XOpatAuth();
}

/** Sign `contextId` in the way a broker does: identity first, then the secret. */
function signIn(user, contextId, subject = "subject-1") {
    user.login(subject, subject, "", contextId);
    user.setSecret(`token-${contextId}`, "jwt", contextId);
}

test("the silent phase runs for every autoLogin context and skips the interactive one", async () => {
    const user = installUser();
    const auth = await freshAuth();
    const seen = watchInteraction(user);

    const silentFor = [];
    let interactiveCalls = 0;
    auth.registerBroker("oidc", {
        init() {},
        loginSilent: (ctx) => { silentFor.push(ctx); signIn(user, ctx); },
        canLoginWithoutGesture: () => true,
        login: () => { interactiveCalls++; },
    });
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });
    await auth.configureContext({ contextId: "archive", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    const result = await auth.runAutoLogin({ timeoutMs: 2000 });

    expect(silentFor.sort()).toEqual(["archive", "core"]);
    expect(interactiveCalls).toBe(0);          // silent was enough; nothing navigated
    expect(seen.required).toBe(0);
    expect(result.verdicts).toEqual({ core: true, archive: true });
    expect(result.demoted).toEqual([]);
});

test("only one navigating login runs, and the main context is the one that wins", async () => {
    const user = installUser();
    const auth = await freshAuth();

    const navigated = [];
    auth.registerBroker("oidc", {
        init() {},
        loginSilent: () => false,
        canLoginWithoutGesture: () => true,
        navigatesOnLogin: () => true,
        login: (ctx) => { navigated.push(ctx); signIn(user, ctx); },
    });
    // Declared FIRST, so "first declared" would pick it — the main context must win
    // on being main, not on ordering.
    await auth.configureContext({ contextId: "archive", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    const result = await auth.runAutoLogin({ timeoutMs: 2000 });

    expect(navigated).toEqual(["core"]);
    expect(result.demoted).toEqual(["archive"]);
    // Demoted, NOT gated: the appbar user menu already offers a per-context sign-in,
    // which is the right affordance for a context nobody has asked for yet.
    expect(auth.isInteractionRequired("archive")).toBe(false);
});

test("a gesture-free flow that does not navigate is not exclusive and still runs", async () => {
    const user = installUser();
    const auth = await freshAuth();

    const ran = [];
    auth.registerBroker("oidc", {
        init() {},
        loginSilent: () => false,
        canLoginWithoutGesture: () => true,
        navigatesOnLogin: () => true,
        login: (ctx) => { ran.push(ctx); signIn(user, ctx); },
    });
    // A postMessage handover / in-page modal: click-less, but nothing unloads.
    auth.registerBroker("workbench", {
        init() {},
        loginSilent: () => false,
        canLoginWithoutGesture: () => true,
        navigatesOnLogin: () => false,
        login: (ctx) => { ran.push(ctx); signIn(user, ctx); },
    });
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });
    await auth.configureContext({ contextId: "empaia", method: "workbench", autoLogin: true, secretTypes: ["jwt"] });

    await auth.runAutoLogin({ timeoutMs: 2000 });

    // Both ran: only NAVIGATION is exclusive. Keying the invariant off
    // `canLoginWithoutGesture` alone would have starved the workbench context.
    expect(ran.sort()).toEqual(["core", "empaia"]);
});

test('"unknown" from a silent route never escalates to a navigation', async () => {
    const user = installUser();
    const auth = await freshAuth();
    const seen = watchInteraction(user);

    let interactiveCalls = 0;
    auth.registerBroker("oidc", {
        init() {},
        // The authority was never reached — a network blip, an RPC that did not
        // arrive. Redirecting here would replace the viewer with the browser's own
        // error page and take the unsaved workspace with it.
        loginSilent: () => "unknown",
        canLoginWithoutGesture: () => true,
        navigatesOnLogin: () => true,
        login: () => { interactiveCalls++; },
    });
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    const result = await auth.runAutoLogin({ timeoutMs: 2000 });

    expect(interactiveCalls).toBe(0);
    // Nor is the gate raised: we have no evidence the session is actually gone.
    expect(seen.required).toBe(0);
    expect(auth.isInteractionRequired("core")).toBe(false);
    expect(result.verdicts.core).toBe(false);
});

test("a boot attempt already spent hands over to the gate instead of redirecting again", async () => {
    const user = installUser();
    const auth = await freshAuth();
    const seen = watchInteraction(user);

    let interactiveCalls = 0;
    auth.registerBroker("oidc", {
        init() {},
        loginSilent: () => false,
        canLoginWithoutGesture: () => true,
        navigatesOnLogin: () => true,
        // Never signs in: the identity provider sends us back empty-handed.
        login: () => { interactiveCalls++; },
    });
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    await auth.runAutoLogin({ timeoutMs: 1000 });
    expect(interactiveCalls).toBe(1);

    // The second run stands in for the next page load: the marker claimed above says
    // the automatic path already had its turn. Going round again would trap the user
    // at the identity provider.
    const result = await auth.runAutoLogin({ timeoutMs: 1000 });

    expect(interactiveCalls).toBe(1);          // NOT 2
    expect(seen.required).toBe(1);
    expect(auth.isInteractionRequired("core")).toBe(true);
    expect(result.deferred).toEqual(["core"]);
});

test("a broker that logs in from init() is not logged in a second time", async () => {
    const user = installUser();
    const auth = await freshAuth();

    let interactiveCalls = 0, silentCalls = 0;
    auth.registerBroker("oidc", {
        // A broker that has not been migrated, or one that legitimately adopts an
        // existing session during init.
        init: (ctx) => { signIn(user, ctx); },
        loginSilent: () => { silentCalls++; },
        canLoginWithoutGesture: () => true,
        navigatesOnLogin: () => true,
        login: () => { interactiveCalls++; },
    });
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    const result = await auth.runAutoLogin({ timeoutMs: 1000 });

    expect(interactiveCalls).toBe(0);
    expect(silentCalls).toBe(0);               // the isAuthenticated-after-init guard
    expect(result.verdicts.core).toBe(true);
});

test("login() answers as soon as the provider is done, with no verdict and no credential", async () => {
    installUser();
    const auth = await freshAuth();

    auth.registerBroker("oidc", {
        init() {},
        canLoginWithoutGesture: () => true,
        // Resolves, deposits nothing, returns nothing — a popup the user closed
        // without signing in. The attempt is OVER; there is no event coming.
        login: () => {},
    });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    const started = Date.now();
    const ok = await auth.login("core", { gesture: false });
    const elapsed = Date.now() - started;

    expect(ok).toBe(false);
    // `broker.login` RESOLVING is the signal that the attempt finished. Core used to
    // keep waiting on the credential event for the full interactive timeout — five
    // minutes of "working…" after the user's window had already closed. There is no
    // caller-supplied clock here any more, and there should not need to be.
    expect(elapsed < 5000).toBe(true);
});

test("runAutoLogin ignores contexts that did not ask for it", async () => {
    installUser();
    const auth = await freshAuth();

    let touched = 0;
    auth.registerBroker("oidc", {
        init() {},
        loginSilent: () => { touched++; },
        login: () => { touched++; },
    });
    // Declared and required, but no `autoLogin`: a feature triggers it on demand.
    await auth.configureContext({ contextId: "chat", method: "oidc", secretTypes: ["jwt"] });

    const result = await auth.runAutoLogin({ timeoutMs: 500 });

    expect(touched).toBe(0);
    expect(result.verdicts).toEqual({});
});
