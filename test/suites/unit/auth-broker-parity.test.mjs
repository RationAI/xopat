/**
 * Binding to the core mechanism must CONFER the features — that is the whole point
 * of a broker registry. It did not: silent-attempt coalescing and a probe budget
 * existed in exactly one broker, so a cold boot on the others asked the same
 * authority the same question four to six times; the post-init secret grace was paid
 * blind by everyone; and the boot-barrier diagnostic named four brokers by hand and
 * went quiet for the fifth.
 *
 * These vectors pin the capabilities core now provides on every broker's behalf.
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

async function freshAuth() {
    const mod = await import(`../../../src/classes/auth/xopat-auth.ts?t=${Math.random()}`);
    return new mod.XOpatAuth();
}

function signIn(user, contextId, subject = "subject-1") {
    user.login(subject, subject, "", contextId);
    user.setSecret(`token-${contextId}`, "jwt", contextId);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── silent coalescing + memo ──────────────────────────────────────────────────

test("concurrent silent callers share one attempt on the broker", async () => {
    installUser();
    const auth = await freshAuth();

    let calls = 0;
    auth.registerBroker("oidc", {
        init() {},
        login() {},
        loginSilent: async () => { calls++; await sleep(30); return false; },
    });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    const answers = await Promise.all([
        auth.loginSilent("core"), auth.loginSilent("core"), auth.loginSilent("core"),
    ]);

    expect(answers).toEqual([false, false, false]);
    // A burst of callers must become ONE question to the authority. Only
    // oidc-client-ts used to guarantee this; now core does, for every broker.
    expect(calls).toBe(1);
});

test("the silent rung runs once across both phases of runAutoLogin", async () => {
    installUser();
    const auth = await freshAuth();

    let silentCalls = 0, interactiveCalls = 0;
    auth.registerBroker("oidc", {
        init() {},
        loginSilent: async () => { silentCalls++; return false; },
        canLoginWithoutGesture: () => true,
        navigatesOnLogin: () => true,
        login: () => { interactiveCalls++; },
    });
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    await auth.runAutoLogin({ timeoutMs: 2000 });

    // Phase 1 asks; phase 2's `login()` re-runs the rung and must reuse the answer.
    expect(silentCalls).toBe(1);
    expect(interactiveCalls).toBe(1);
});

test("an auth transition re-arms the memo — a stale no is never pinned", async () => {
    const user = installUser();
    const auth = await freshAuth();

    let calls = 0;
    auth.registerBroker("oidc", { init() {}, login() {}, loginSilent: async () => { calls++; return false; } });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    expect(await auth.loginSilent("core")).toBe(false);
    expect(await auth.loginSilent("core")).toBe(false);
    expect(calls).toBe(1);                      // memoized

    // The user signed in and out by some other route. Whatever the authority would
    // have said before, it is not evidence any more.
    signIn(user, "core");
    await auth.logout("core");

    expect(await auth.loginSilent("core")).toBe(false);
    expect(calls).toBe(2);
});

test("force bypasses the memo for a caller that knows the answer changed", async () => {
    installUser();
    const auth = await freshAuth();

    let calls = 0;
    auth.registerBroker("oidc", { init() {}, login() {}, loginSilent: async () => { calls++; return false; } });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    await auth.loginSilent("core");
    await auth.loginSilent("core", { force: true });

    expect(calls).toBe(2);
});

test('an "unknown" verdict is coalesced too, and still reads false to a boolean caller', async () => {
    installUser();
    const auth = await freshAuth();

    let calls = 0;
    auth.registerBroker("oidc", { init() {}, login() {}, loginSilent: async () => { calls++; return "unknown"; } });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    // `loginSilent` collapses the tri-state: only the automatic ladder needs the
    // distinction, to decide whether a navigation is justified.
    expect(await auth.loginSilent("core")).toBe(false);
    expect(await auth.loginSilent("core")).toBe(false);
    expect(calls).toBe(1);
    // (Its memo window is deliberately shorter than a definite `false` — a network
    // outage ends — but both exceed what a unit test should sit and wait for.)
});

// ── settle grace ──────────────────────────────────────────────────────────────

test("a broker that writes nothing during init settles without paying the secret grace", async () => {
    installUser();
    const auth = await freshAuth();

    auth.registerBroker("oidc", { init: async () => {}, login() {} });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    const started = Date.now();
    expect(await auth.whenContextSettled("core")).toBe(false);
    const elapsed = Date.now() - started;

    // Silence during init means there is no partial write to wait for. The blind
    // 1500 ms was pure latency on every unauthenticated settle — boot, and each
    // HttpClient awaitContext.
    expect(elapsed < 600).toBe(true);
});

test("a broker that raised an event during init still gets the full grace", async () => {
    const user = installUser();
    const auth = await freshAuth();

    auth.registerBroker("oidc", {
        // Identity first, secret second — the shape every shipped broker uses, and
        // the evidence core reads. This is the vector proving the inference is not
        // simply "always skip".
        init: async (ctx) => {
            user.login("subject-1", "One", "", ctx);
            setTimeout(() => user.setSecret("token-1", "jwt", ctx), 120);
        },
        login() {},
    });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    expect(await auth.whenContextSettled("core")).toBe(true);
});

// ── diagnostics ───────────────────────────────────────────────────────────────

test("listBrokerMethods reflects the registry, so diagnostics need no hardcoded list", async () => {
    installUser();
    const auth = await freshAuth();

    expect(auth.listBrokerMethods()).toEqual([]);
    auth.registerBroker("oidc", { init() {}, login() {} });
    auth.registerBroker("empaia-workbench", { init() {}, login() {} });

    // The boot barrier used to test a hardcoded ["oidc","oidc-server","saml","basic"],
    // so its "no autoLogin context declared" warning was silent for exactly the
    // brokers most likely to trip it.
    expect(auth.listBrokerMethods().sort()).toEqual(["empaia-workbench", "oidc"]);
});
