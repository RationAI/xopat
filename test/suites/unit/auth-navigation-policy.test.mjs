/**
 * Whether a login may UNLOAD the document is policy, and it belongs to core.
 *
 * A provider knows whether its flow navigates — a capability. It cannot know whether
 * navigating is acceptable right now: it cannot see that the user has drawn
 * annotations, that the viewer is embedded in someone else's page, or that another
 * provider already claimed the one navigation this page load gets. Leaving the
 * decision to providers produced both halves of the bug users hit: a boot with
 * nothing to lose that asked "click to sign in" instead of simply redirecting, and a
 * provider that opened a popup because its own config said `flow: "popup"` even
 * though no gesture existed to open one with.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

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

/** Stand in for the app: boot state + the undo stack that says "user did something". */
function installApp({ booted = false, canUndo = false } = {}) {
    globalThis.window.APPLICATION_CONTEXT = {
        isUiBootComplete: () => booted,
        history: { canUndo: () => canUndo },
    };
}

async function freshAuth() {
    const mod = await import(`../../../src/classes/auth/xopat-auth.ts?t=${Math.random()}`);
    return new mod.XOpatAuth();
}

function signIn(user, contextId, subject = "subject-1") {
    user.login(subject, subject, "", contextId);
    user.setSecret(`token-${contextId}`, "jwt", contextId);
}

/** Records the `mayNavigate` core handed down. */
function recordingProvider(user, { succeeds = true } = {}) {
    const seen = { login: 0, mayNavigate: undefined };
    return {
        seen,
        broker: {
            init() {},
            loginSilent: () => false,
            canLoginWithoutGesture: () => true,
            navigatesOnLogin: () => true,
            login: (ctx, cfg, options) => {
                seen.login++;
                seen.mayNavigate = options?.mayNavigate;
                if (succeeds) signIn(user, ctx);
            },
        },
    };
}

test("a boot with nothing to lose navigates, and never asks for a click", async () => {
    const user = installUser();
    installApp({ booted: false });
    const auth = await freshAuth();
    const gate = [];
    user.addHandler("auth-interaction-changed", (p) => gate.push(p.event));

    const p = recordingProvider(user);
    auth.registerBroker("oidc", p.broker);
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    await auth.runAutoLogin({ timeoutMs: 2000 });

    expect(p.seen.login).toBe(1);
    expect(p.seen.mayNavigate).toBe(true);
    // The panel users were shown for a login that could simply have happened.
    expect(gate.filter((e) => e === "auth-interaction-required").length).toBe(0);
});

test("a viewer embedded in someone else's page never navigates", async () => {
    const user = installUser();
    installApp({ booted: false });
    const auth = await freshAuth();
    const gate = [];
    user.addHandler("auth-interaction-changed", (p) => gate.push(p.event));

    // A frame: a top-level navigation would take the embedder's page with it, and
    // identity providers refuse to render inside one.
    const realTop = globalThis.window.top;
    globalThis.window.top = { different: true };
    try {
        const p = recordingProvider(user);
        auth.registerBroker("oidc", p.broker);
        await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

        expect(auth.canNavigateAway()).toEqual({ ok: false, reason: "framed" });
        await auth.runAutoLogin({ timeoutMs: 2000 });

        expect(p.seen.login).toBe(0);
        // THIS is what the gate is for — a click can open a popup; nothing else can.
        expect(gate.filter((e) => e === "auth-interaction-required").length).toBe(1);
    } finally {
        globalThis.window.top = realTop;
    }
});

test("a session holding the user's work is not thrown away for a login", async () => {
    const user = installUser();
    installApp({ booted: true, canUndo: true });
    const auth = await freshAuth();
    const gate = [];
    user.addHandler("auth-interaction-changed", (p) => gate.push(p.event));

    const p = recordingProvider(user);
    auth.registerBroker("oidc", p.broker);
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    expect(auth.canNavigateAway()).toEqual({ ok: false, reason: "unsaved-work" });
    await auth.runAutoLogin({ timeoutMs: 2000 });

    expect(p.seen.login).toBe(0);
    expect(gate.filter((e) => e === "auth-interaction-required").length).toBe(1);
});

test("a booted session the user has not touched may still navigate", async () => {
    const user = installUser();
    installApp({ booted: true, canUndo: false });
    const auth = await freshAuth();

    const p = recordingProvider(user);
    auth.registerBroker("oidc", p.broker);
    await auth.configureContext({ contextId: "core", method: "oidc", autoLogin: true, secretTypes: ["jwt"] });

    expect(auth.canNavigateAway().ok).toBe(true);
    await auth.runAutoLogin({ timeoutMs: 2000 });

    expect(p.seen.mayNavigate).toBe(true);
});

test("a non-navigating provider is told so, and still runs", async () => {
    const user = installUser();
    installApp({ booted: false });
    const auth = await freshAuth();

    const seen = { login: 0, mayNavigate: undefined };
    auth.registerBroker("workbench", {
        init() {},
        loginSilent: () => false,
        canLoginWithoutGesture: () => true,
        navigatesOnLogin: () => false,        // a postMessage handover / in-page modal
        login: (ctx, cfg, options) => { seen.login++; seen.mayNavigate = options?.mayNavigate; signIn(user, ctx); },
    });
    await auth.configureContext({ contextId: "empaia", method: "workbench", autoLogin: true, secretTypes: ["jwt"] });

    await auth.runAutoLogin({ timeoutMs: 2000 });

    expect(seen.login).toBe(1);
    // Policy would allow a navigation, but this provider does not do one — so it is
    // told `false` rather than being left to infer it.
    expect(seen.mayNavigate).toBe(false);
});

test("an explicit caller opinion outranks policy", async () => {
    const user = installUser();
    installApp({ booted: false });          // policy would say "navigate freely"
    const auth = await freshAuth();

    const p = recordingProvider(user);
    auth.registerBroker("oidc", p.broker);
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });

    // The recovery scrim's click: a popup keeps the page, which is the whole reason
    // the user was asked to click instead of being redirected.
    await auth.login("core", { gesture: true, mayNavigate: false });

    expect(p.seen.mayNavigate).toBe(false);
});
