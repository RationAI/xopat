/**
 * The auth recovery scrim is a BLOCKING, undismissable overlay whose only exit is
 * a successful login. It is raised by exactly one thing —
 * `XOpatAuth.markNeedsInteraction()` emitting `auth-interaction-required` — so
 * every false positive here is a viewer the user cannot use.
 *
 * These vectors pin the invariants that keep it honest:
 *  - a login in flight passes THROUGH an unauthenticated state; that must not be
 *    read as failure (the "scrim appears right after signing in" bug),
 *  - a stale report against a context that is authenticated again converges to
 *    resolved instead of re-raising,
 *  - declaring a context never waits for the login it describes (the boot barrier
 *    reads the declaration, so a slow login must not hide it),
 *  - `login()` answers as soon as the broker reports a definitive failure, rather
 *    than holding its caller for the interactive-login timeout.
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
        /** Mirrors XOpatUser.login: an identity SWAP logs the old one out first. */
        login(id, name, icon, contextId) {
            const ctx = ctxOf(contextId);
            if (identities.has(ctx) && identities.get(ctx) !== id) {
                identities.delete(ctx);
                user.raiseEvent(user.getEventName("logout", ctx), { contextId: ctx, switching: true });
            }
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

/** Collect the interaction events the recovery UI would react to. */
function watchInteraction(user) {
    const seen = [];
    user.addHandler("auth-interaction-changed", (p) => seen.push(p.event));
    return {
        get required() { return seen.filter((e) => e === "auth-interaction-required").length; },
        get resolved() { return seen.filter((e) => e === "auth-interaction-resolved").length; },
        all: seen,
    };
}

async function freshAuth() {
    // Fresh module instance per test: XOpatAuth keeps per-context state.
    const mod = await import(`../../../src/classes/auth/xopat-auth.ts?t=${Math.random()}`);
    return new mod.XOpatAuth();
}

test("a deferred report is not promoted while the login that fixes it is running", async () => {
    const user = installUser();
    const auth = await freshAuth();
    const seen = watchInteraction(user);

    let resolveLogin;
    const loginGate = new Promise((r) => { resolveLogin = r; });
    auth.registerBroker("oidc", { init() {}, login: () => loginGate });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    // A first sign-in, then a silent-renew hiccup reported while it still works.
    user.login("subject-1", "One", "", "core");
    user.setSecret("token-1", "jwt", "core");
    auth.markNeedsInteraction("core", { reason: "interaction_required" });
    expect(auth.isInteractionPending("core")).toBe(true);
    expect(seen.required).toBe(0);   // deferred, nothing on screen

    // Now a real login lands a DIFFERENT subject. XOpatUser raises
    // `logout {switching:true}` first, so there is a tick with no credential.
    const pending = auth.login("core");
    user.login("subject-2", "Two", "", "core");
    user.setSecret("token-2", "jwt", "core");
    resolveLogin();
    await pending;

    expect(seen.required).toBe(0);            // the scrim never appeared
    expect(auth.isAuthenticated("core")).toBe(true);
    expect(auth.isInteractionRequired("core")).toBe(false);
});

test("a deferred report IS promoted once the credential it warned about dies", async () => {
    const user = installUser();
    const auth = await freshAuth();
    const seen = watchInteraction(user);

    auth.registerBroker("oidc", { init() {}, login: async () => true });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    user.login("subject-1", "One", "", "core");
    user.setSecret("token-1", "jwt", "core");
    // A silent renew answered `interaction_required` while the token still worked.
    auth.markNeedsInteraction("core", { reason: "interaction_required" });
    expect(auth.isInteractionPending("core")).toBe(true);
    expect(seen.required).toBe(0);

    // The token now dies with no login in flight. This is the whole point of
    // parking the report — it must come off the shelf here. The mid-login test
    // above only proves the suppression side; suppressing ALWAYS (which is what a
    // "has this context ever initialized" check does) makes the mechanism dead
    // code and the user gets no recovery prompt, just endless 401s.
    user.setSecret(null, "jwt", "core");

    expect(auth.isAuthenticated("core")).toBe(false);
    expect(seen.required).toBe(1);
    expect(auth.isInteractionRequired("core")).toBe(true);
});

test("a stale report against a re-authenticated context resolves instead of re-raising", async () => {
    const user = installUser();
    const auth = await freshAuth();

    auth.registerBroker("oidc", { init() {}, login() {} });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });
    user.login("subject", "S", "", "core");
    user.setSecret("token", "jwt", "core");

    // A genuine failure flags the context and drops the credential.
    auth.markNeedsInteraction("core", { reason: "slide-401", force: true });
    expect(auth.isInteractionRequired("core")).toBe(true);
    expect(user.getSecret("jwt", "core")).toBeFalsy();

    const seen = watchInteraction(user);
    // A 401 against the DEAD token is in flight; the handler reads the generation
    // it concerns before it awaits anything.
    const epochOfDeadToken = auth.getCredentialEpoch("core");

    // The credential comes back — core clears the flag on the secret event.
    user.setSecret("token-2", "jwt", "core");
    expect(auth.isInteractionRequired("core")).toBe(false);
    expect(seen.resolved).toBe(1);
    expect(auth.getCredentialEpoch("core")).toBeGreaterThan(epochOfDeadToken);

    // Only NOW does the stale 401 get reported. It must not drop the credential
    // that never failed, nor reopen the gate on a working session.
    auth.markNeedsInteraction("core", { reason: "slide-401", force: true, epoch: epochOfDeadToken });
    expect(seen.required).toBe(0);
    expect(auth.isInteractionRequired("core")).toBe(false);
    expect(user.getSecret("jwt", "core")).toBe("token-2");

    // A report about the CURRENT credential is still believed — force must keep
    // working, or a genuinely dead token could never be reported.
    auth.markNeedsInteraction("core", {
        reason: "slide-401", force: true, epoch: auth.getCredentialEpoch("core"),
    });
    expect(seen.required).toBe(1);
    expect(auth.isInteractionRequired("core")).toBe(true);
});

test("clearNeedsInteraction always emits resolved, so a duplicate scrim can still close", async () => {
    const user = installUser();
    const auth = await freshAuth();
    const seen = watchInteraction(user);

    // Flag never set: the UI may still be showing something raised before it
    // subscribed, so the close signal must go out regardless.
    auth.clearNeedsInteraction("core");
    expect(seen.resolved).toBe(1);
});

test("configureContext declares the context without waiting for the broker login", async () => {
    const user = installUser();
    const auth = await freshAuth();

    let initStarted = false;
    // A boot redirect never resolves init — the page is unloading.
    auth.registerBroker("oidc", { init() { initStarted = true; return new Promise(() => {}); }, login() {} });

    await auth.configureContext({
        contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"],
    });
    // A second context must be reachable even though the first one's init hangs.
    await auth.configureContext({
        contextId: "chat", method: "oidc", autoLogin: true, secretTypes: ["jwt"],
    });

    expect(initStarted).toBe(true);
    expect(auth.listAutoLoginContexts().sort()).toEqual(["chat", "core"]);
});

test("a context announced through registerContextDiscovery is visible to the boot barrier", async () => {
    installUser();
    const auth = await freshAuth();

    // A broker that has not declared anything yet — the state the boot barrier used
    // to look at, find empty, and wait for nothing (after which the first slide goes
    // out unauthenticated and 401s on a perfectly good session).
    let declare;
    const discovery = new Promise((r) => { declare = r; });
    auth.registerContextDiscovery(discovery);
    auth.registerBroker("oidc", { init() {}, login() {} });

    expect(auth.listAutoLoginContexts()).toEqual([]);

    setTimeout(async () => {
        await auth.configureContext({
            contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"],
        });
        declare();
    }, 50);

    await auth.whenContextsDiscovered();
    expect(auth.listAutoLoginContexts()).toEqual(["core"]);
});

test("login() returns promptly when the broker reports a definitive failure", async () => {
    const user = installUser();
    const auth = await freshAuth();

    // `false` = popup closed / modal cancelled. Nothing will ever land.
    auth.registerBroker("basic", { init() {}, login: async () => false });
    await auth.configureContext({ contextId: "core", method: "basic", secretTypes: ["basic"] });

    const started = Date.now();
    const ok = await auth.login("core");
    const elapsed = Date.now() - started;

    expect(ok).toBe(false);
    // The interactive-login timeout is 5 minutes; anything near it is the bug.
    expect(elapsed).toBeLessThan(5000);
});
