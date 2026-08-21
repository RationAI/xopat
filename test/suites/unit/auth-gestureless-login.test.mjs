/**
 * A login that no user gesture started may not try to open a window: `window.open`
 * without user activation is blocked by every browser. Core owns that rule so every
 * broker inherits it — a deployment whose boot login "did nothing" (no popup, no
 * error, every request unauthenticated) is what happens when it is left to each
 * broker to remember.
 *
 * The vectors pin the three outcomes of `login(ctx, {gesture:false})`:
 *  - a broker with no silent route never has its interactive `login()` called, and
 *    the interaction gate is raised instead,
 *  - a silent route that authenticates finishes the job with nothing on screen,
 *  - a broker whose interactive flow needs no gesture (redirect, server-side) is
 *    still allowed to run it.
 * Plus: `gesture` defaults to true, so every UI caller keeps today's behaviour.
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

test("a click-less login on a popup-only broker raises the gate instead of prompting", async () => {
    const user = installUser();
    const auth = await freshAuth();
    const seen = watchInteraction(user);

    let interactiveCalls = 0;
    auth.registerBroker("oidc", {
        init() {},
        login: () => { interactiveCalls++; },
        // No loginSilent, and no canLoginWithoutGesture — the default for a broker
        // whose interactive flow is a popup.
    });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    const ok = await auth.login("core", { gesture: false });

    expect(ok).toBe(false);
    expect(interactiveCalls).toBe(0);          // the popup was never attempted
    expect(seen.required).toBe(1);             // the user is asked on their next click
    expect(auth.isInteractionRequired("core")).toBe(true);
});

test("a silent route that works authenticates with nothing on screen", async () => {
    const user = installUser();
    const auth = await freshAuth();
    const seen = watchInteraction(user);

    let interactiveCalls = 0;
    auth.registerBroker("oidc", {
        init() {},
        login: () => { interactiveCalls++; },
        loginSilent: () => {
            // What a broker riding an existing identity-provider session does.
            user.login("subject-1", "One", "", "core");
            user.setSecret("token-1", "jwt", "core");
        },
    });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    const ok = await auth.login("core", { gesture: false });

    expect(ok).toBe(true);
    expect(interactiveCalls).toBe(0);
    expect(seen.required).toBe(0);             // no scrim, no toast
    expect(auth.isAuthenticated("core")).toBe(true);
});

test("a broker that can run interactively without a gesture is still allowed to", async () => {
    const user = installUser();
    const auth = await freshAuth();

    let interactiveCalls = 0;
    let gestureSeen;
    auth.registerBroker("oidc", {
        init() {},
        // The redirect flow: no window is opened, the page navigates.
        canLoginWithoutGesture: () => true,
        loginSilent: () => false,
        login: (ctx, cfg, opts) => {
            interactiveCalls++;
            gestureSeen = opts?.gesture;
            user.login("subject-1", "One", "", "core");
            user.setSecret("token-1", "jwt", "core");
        },
    });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    const ok = await auth.login("core", { gesture: false });

    expect(ok).toBe(true);
    expect(interactiveCalls).toBe(1);
    // The broker is told what it is dealing with, even when core allowed it.
    expect(gestureSeen).toBe(false);
});

test("the silent route is skipped entirely when a gesture is behind the call", async () => {
    const user = installUser();
    const auth = await freshAuth();

    let silentCalls = 0, interactiveCalls = 0;
    auth.registerBroker("oidc", {
        init() {},
        loginSilent: () => { silentCalls++; },
        login: () => {
            interactiveCalls++;
            user.login("subject-1", "One", "", "core");
            user.setSecret("token-1", "jwt", "core");
        },
    });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    // No options at all: a UI caller. The user asked to sign in — spending their
    // click on a silent probe that may answer "no" would waste the gesture.
    const ok = await auth.login("core");

    expect(ok).toBe(true);
    expect(silentCalls).toBe(0);
    expect(interactiveCalls).toBe(1);
});

test("loginSilent() never raises the gate — the caller decides what a failure means", async () => {
    const user = installUser();
    const auth = await freshAuth();
    const seen = watchInteraction(user);

    auth.registerBroker("oidc", { init() {}, login() {}, loginSilent: () => false });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    expect(await auth.loginSilent("core")).toBe(false);
    expect(seen.required).toBe(0);
    expect(auth.isInteractionRequired("core")).toBe(false);
});

test("listContexts() hands out snapshots, not the live registry", async () => {
    installUser();
    const auth = await freshAuth();

    auth.registerBroker("oidc", { init() {}, login() {} });
    await auth.configureContext({ contextId: "core", method: "oidc", serviceName: "Viewer" });
    await auth.configureContext({ contextId: "archive", method: "oidc", serviceName: "Archive" });

    const contexts = auth.listContexts();
    expect(contexts.map((c) => c.contextId)).toEqual(["core", "archive"]);

    contexts[0].serviceName = "tampered";
    expect(auth.getContextConfig("core").serviceName).toBe("Viewer");
});
