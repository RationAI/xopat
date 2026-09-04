/**
 * A provider learns decisive things while its `init()` runs — above all that a
 * returning redirect callback came back `interaction_required`, the identity
 * provider's expected answer to an automatic `prompt=none` request. `init()` used to
 * return `void`, so the provider had two exits and both were wrong: start its own
 * navigation (bypassing the arbitration that stops two providers cancelling each
 * other's redirect), or call `markNeedsInteraction` — which dead-ends, because
 * nothing escalates afterwards, and which is swallowed entirely while a credential is
 * still alive.
 *
 * Real symptom: a viewer that came back from Google with `?error=interaction_required`
 * put up a blocking "Sign in required" scrim instead of simply redirecting the user to
 * sign in. The attempt marker that would have allowed the redirect had been spent by
 * the very request that produced the error.
 *
 * These vectors pin the channel that fixes it: `init()` reports, core escalates.
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
        logout(contextId, payload) {
            const ctx = ctxOf(contextId);
            identities.delete(ctx);
            user.raiseEvent(user.getEventName("logout", ctx), { contextId: ctx, ...(payload || {}) });
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

function signIn(user, contextId, subject = "subject-1") {
    user.login(subject, subject, "", contextId);
    user.setSecret(`token-${contextId}`, "jwt", contextId);
}

/** A redirect provider whose init reports the callback verdict it was handed. */
function redirectProvider(user, initVerdict, opts = {}) {
    const calls = { login: 0, silent: 0 };
    return {
        calls,
        broker: {
            init: () => initVerdict,
            loginSilent: () => { calls.silent++; return false; },
            canLoginWithoutGesture: () => true,
            navigatesOnLogin: () => true,
            login: (ctx) => {
                calls.login++;
                if (opts.succeeds) signIn(user, ctx);
                // A real redirect never returns; these tests need it to.
            },
        },
    };
}

test("a callback that came back interaction_required is escalated to a real sign-in", async () => {
    const user = installUser();
    const auth = await freshAuth();
    const gate = watchInteraction(user);

    const p = redirectProvider(user, { outcome: "interaction-required", reason: "interaction_required" },
        { succeeds: true });
    auth.registerBroker("oidc", p.broker);
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    const result = await auth.runAutoLogin({ timeoutMs: 2000 });

    // The whole point: a redirect, not a scrim.
    expect(p.calls.login).toBe(1);
    expect(gate.required).toBe(0);
    expect(auth.isInteractionRequired("core")).toBe(false);
    expect(result.verdicts.core).toBe(true);
});

test("the escalation does not re-ask the authority silently first", async () => {
    const user = installUser();
    const auth = await freshAuth();

    const p = redirectProvider(user, { outcome: "interaction-required" }, { succeeds: true });
    auth.registerBroker("oidc", p.broker);
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    await auth.runAutoLogin({ timeoutMs: 2000 });

    // "Needs a human" is already the answer to a silent request. Asking again in
    // phase 1 would spend a probe budget to learn nothing.
    expect(p.calls.silent).toBe(0);
});

test("the escalation is one-shot — a second round gates instead of redirecting again", async () => {
    const user = installUser();
    const auth = await freshAuth();
    const gate = watchInteraction(user);

    // Never signs in: the identity provider keeps refusing.
    const p = redirectProvider(user, { outcome: "interaction-required" });
    auth.registerBroker("oidc", p.broker);
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    await auth.runAutoLogin({ timeoutMs: 1000 });
    expect(p.calls.login).toBe(1);

    // Stands in for the next page load. Escalating again would bounce the user
    // between the viewer and the identity provider forever.
    const second = await auth.runAutoLogin({ timeoutMs: 1000 });

    expect(p.calls.login).toBe(1);              // NOT 2
    expect(gate.required).toBe(1);
    expect(second.deferred).toEqual(["core"]);
});

test("an unreachable authority is never escalated, but gates when there is no credential", async () => {
    const user = installUser();
    const auth = await freshAuth();
    const gate = watchInteraction(user);

    const p = redirectProvider(user, { outcome: "unreachable", reason: "timeout" });
    auth.registerBroker("oidc", p.broker);
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    const result = await auth.runAutoLogin({ timeoutMs: 1000 });

    // Still never escalated: redirecting to a host we just failed to reach would
    // replace the viewer with the browser's error page.
    expect(p.calls.login).toBe(0);
    expect(result.verdicts.core).toBe(false);

    // But with nothing in hand there is no session to protect, and silence means every
    // request bound to the context goes out bare and fails. The gate holds them behind
    // a scrim whose click can sign the user in instead.
    expect(gate.required).toBe(1);
    expect(result.deferred).toEqual(["core"]);
});

test("an authenticated context never reaches the unreachable branch at all", async () => {
    const user = installUser();
    const auth = await freshAuth();

    const p = redirectProvider(user, { outcome: "unreachable", reason: "timeout" });
    auth.registerBroker("oidc", p.broker);
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });
    signIn(user, "core");

    const gate = watchInteraction(user);
    const result = await auth.runAutoLogin({ timeoutMs: 1000 });

    // This is what makes gating the unreachable branch safe: phase 1 short-circuits a
    // context that already holds a credential, so a renew blip mid-session can never
    // reach the gate and tear that credential down.
    expect(gate.required).toBe(0);
    expect(user.getSecret("jwt", "core")).toBe("token-core");
    expect(result.verdicts.core).toBe(true);
    expect(result.deferred).toEqual([]);
});

test("a provider whose init returns nothing behaves exactly as before", async () => {
    const user = installUser();
    const auth = await freshAuth();

    const p = redirectProvider(user, undefined, { succeeds: true });
    auth.registerBroker("oidc", p.broker);
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    await auth.runAutoLogin({ timeoutMs: 2000 });

    // `void` means "idle" — the ordinary ladder runs: silent first, then interactive.
    expect(p.calls.silent).toBe(1);
    expect(p.calls.login).toBe(1);
});

test("an init that authenticated needs no rung at all", async () => {
    const user = installUser();
    const auth = await freshAuth();

    const calls = { login: 0, silent: 0 };
    auth.registerBroker("oidc", {
        init: (ctx) => { signIn(user, ctx); return { outcome: "authenticated" }; },
        loginSilent: () => { calls.silent++; return false; },
        canLoginWithoutGesture: () => true,
        navigatesOnLogin: () => true,
        login: () => { calls.login++; },
    });
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    const result = await auth.runAutoLogin({ timeoutMs: 1000 });

    expect(calls.silent).toBe(0);
    expect(calls.login).toBe(0);
    expect(result.verdicts.core).toBe(true);
});

test("no caller can shorten the wait on a login that is still running", async () => {
    installUser();
    const auth = await freshAuth();

    auth.registerBroker("oidc", {
        init() {},
        canLoginWithoutGesture: () => true,
        // Still pending — indistinguishable, from core, between "wedged" and "the user
        // is reading the consent screen". Core must assume the latter.
        login: () => new Promise(() => {}),
    });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    // `initTimeoutMs` is the only clock a caller gets, and it bounds INIT. Passing a
    // tiny one must not shorten the attempt: an interactive login ends when the
    // window closes. Core's own backstop is deliberately longer than any provider's
    // ceiling, so it cannot be reached here.
    const raced = await Promise.race([
        auth.login("core", { gesture: false, initTimeoutMs: 10 }).then(() => "answered"),
        new Promise((r) => setTimeout(() => r("still waiting"), 400)),
    ]);

    // Callers who must not block race the call — as `runAutoLogin` does — rather than
    // cutting the login short. That is the whole distinction this suite exists for.
    expect(raced).toBe("still waiting");
});

// ── nothing core awaits may be allowed to hang ────────────────────────────────
//
// A provider is explicitly permitted never to resolve: each one parks on
// `new Promise(() => {})` once it has started a navigation, and oidc-client-ts also
// parks when it decides the document is somebody else's auth callback. Core awaited
// `initContext` bare, so a provider that parked on a load which was NOT actually
// navigating away held the boot barrier open forever — a wordless spinner, no error,
// because a promise that never settles throws nothing. These pin every call site.

test("a provider whose init never settles does not hang runAutoLogin", async () => {
    const user = installUser();
    const auth = await freshAuth();

    auth.registerBroker("oidc", {
        init: () => new Promise(() => {}),      // parked, like a navigating provider
        loginSilent: () => false,
        canLoginWithoutGesture: () => true,
        navigatesOnLogin: () => true,
        login: () => {},
    });
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    const started = Date.now();
    const result = await auth.runAutoLogin({ timeoutMs: 150 });

    expect(Date.now() - started < 5000).toBe(true);
    expect(result.verdicts.core).toBe(false);
});

test("a provider whose init never settles does not hang login()", async () => {
    installUser();
    const auth = await freshAuth();

    auth.registerBroker("oidc", {
        init: () => new Promise(() => {}),
        canLoginWithoutGesture: () => true,
        login: () => {},
    });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    const started = Date.now();
    const ok = await auth.login("core", { gesture: false, initTimeoutMs: 120 });

    expect(ok).toBe(false);
    expect(Date.now() - started < 5000).toBe(true);
});

test("a provider whose init never settles does not hang loginSilent()", async () => {
    installUser();
    const auth = await freshAuth();

    auth.registerBroker("oidc", { init: () => new Promise(() => {}), login() {}, loginSilent: () => false });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    // No caller-supplied bound here — the backstop is core's own, and it is the
    // SILENT budget (SETTLE_TIMEOUT_MS, 8 s), not the interactive one. The window
    // below only has to exceed that; the property being pinned is "answers at all".
    const raced = await Promise.race([
        auth.loginSilent("core").then(() => "answered"),
        new Promise((r) => setTimeout(() => r("hung"), 12000)),
    ]);
    expect(raced).toBe("answered");
});

// ── machine patience is not human patience ───────────────────────────────────
//
// The boot barrier's job is "do not hold the viewer hostage". It used to hand its
// 8-second budget down into `login()`, where it became the limit on how long a
// person had to sign in: "broker 'saml' did not answer login for 'core' within
// 7998ms". An interactive login is over when the WINDOW CLOSES, not when a clock
// expires — a timer there is only a backstop against a provider that has wedged.

test("the boot barrier stops WAITING without stopping the login", async () => {
    const user = installUser();
    const auth = await freshAuth();

    let resolveLogin;
    const started = Date.now();
    auth.registerBroker("oidc", {
        init() {},
        loginSilent: () => false,
        canLoginWithoutGesture: () => true,
        navigatesOnLogin: () => true,
        // A human at an identity provider: answers only when they are done.
        login: () => new Promise((r) => { resolveLogin = r; }),
    });
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    // The barrier gives up quickly — that is correct and is its whole power.
    const result = await auth.runAutoLogin({ timeoutMs: 120 });
    expect(Date.now() - started < 3000).toBe(true);
    expect(result.verdicts.core).toBe(false);

    // …but the attempt was NOT cancelled. The user finishes later.
    signIn(user, "core");
    resolveLogin();
    await new Promise((r) => setTimeout(r, 20));

    expect(auth.isAuthenticated("core")).toBe(true);
});

test("a credential landing after the barrier gave up still reaches subscribers", async () => {
    const user = installUser();
    const auth = await freshAuth();

    let resolveLogin;
    auth.registerBroker("oidc", {
        init() {},
        loginSilent: () => false,
        canLoginWithoutGesture: () => true,
        navigatesOnLogin: () => true,
        login: () => new Promise((r) => { resolveLogin = r; }),
    });
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    const seen = [];
    auth.onChange((ctx) => seen.push(ctx));
    await auth.runAutoLogin({ timeoutMs: 120 });

    // This is what makes "stop waiting, keep trying" safe: the UI recovers off this
    // signal, with no scrim and no barrier involved.
    signIn(user, "core");
    resolveLogin();
    await new Promise((r) => setTimeout(r, 20));

    expect(seen.includes("core")).toBe(true);
});

test("initTimeoutMs bounds init only — it does not shorten the login", async () => {
    const user = installUser();
    const auth = await freshAuth();

    let loginCalled = false;
    auth.registerBroker("oidc", {
        init: () => new Promise(() => {}),        // never settles
        canLoginWithoutGesture: () => true,
        login: () => { loginCalled = true; signIn(user, "core"); },
    });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    const started = Date.now();
    const ok = await auth.login("core", { gesture: false, initTimeoutMs: 80 });

    // Init was abandoned quickly; the login itself still ran and succeeded.
    expect(Date.now() - started < 3000).toBe(true);
    expect(loginCalled).toBe(true);
    expect(ok).toBe(true);
});
