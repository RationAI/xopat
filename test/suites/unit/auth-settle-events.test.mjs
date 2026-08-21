/**
 * `onSettled` / `auth-settled` must actually deliver the verdict — and exactly once.
 *
 * Three of the six settle outcomes returned through a fast path that memoized the
 * result and returned it without notifying anyone, so `"authenticated"`,
 * `"needs-interaction"` and `"unconfigured"` — between them the overwhelming
 * majority of verdicts — were invisible to subscribers. The naive repair is worse
 * than the bug: the authenticated fast path is taken by every authenticated request
 * that passes through `HttpClient`, so raising unconditionally turns `auth-settled`
 * into a per-request event. Publish on CHANGE.
 *
 * Also covered here: a context that was flagged and is then logged out must not
 * stay flagged forever, and replacing a broker must re-initialize its contexts
 * rather than leave them bound to the object that no longer serves them.
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

test("the authenticated verdict reaches subscribers, and only once across many waits", async () => {
    const user = installUser();
    const auth = await freshAuth();

    auth.registerBroker("oidc", { init() {}, login() {} });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });
    signIn(user, "core");

    const seen = [];
    auth.onSettled((r) => seen.push(r));

    // The hot path: every authenticated request through HttpClient lands here.
    for (let i = 0; i < 5; i++) expect(await auth.whenContextSettled("core")).toBe(true);

    expect(seen.length).toBe(1);
    expect(seen[0].reason).toBe("authenticated");
    expect(seen[0].contextId).toBe("core");
    // It also rides the XOpatUser surface (bare name for the main context).
    expect(user.raised.filter((e) => e.event === "auth-settled").length).toBe(1);
});

test("the unconfigured verdict is delivered too — an auth-less deployment is a verdict, not silence", async () => {
    installUser();
    const auth = await freshAuth();

    const seen = [];
    auth.onSettled((r) => seen.push(r));

    expect(await auth.whenContextSettled("nobody-declares-this")).toBe(false);

    expect(seen.length).toBe(1);
    expect(seen[0].reason).toBe("unconfigured");
});

test("a state change re-publishes, so the memo never hides a real transition", async () => {
    const user = installUser();
    const auth = await freshAuth();

    auth.registerBroker("oidc", { init() {}, login() {} });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });
    signIn(user, "core");

    const seen = [];
    auth.onSettled((r) => seen.push(r));
    await auth.whenContextSettled("core");

    // The credential dies for real.
    auth.markNeedsInteraction("core", { reason: "session-expired", force: true });
    expect(await auth.whenContextSettled("core")).toBe(false);

    expect(seen.map((r) => r.reason)).toEqual(["authenticated", "needs-interaction"]);
});

test("logging out clears the interaction flag instead of stranding it for the session", async () => {
    const user = installUser();
    const auth = await freshAuth();

    auth.registerBroker("oidc", { init() {}, login() {} });
    await auth.configureContext({ contextId: "archive", method: "oidc", secretTypes: ["jwt"] });
    signIn(user, "archive");
    auth.markNeedsInteraction("archive", { reason: "session-expired", force: true });
    expect(auth.listContextsNeedingInteraction()).toEqual(["archive"]);

    await auth.logout("archive");

    // Otherwise the context stays on the `needs-interaction` settle fast path and
    // every `awaitInteractive` caller keeps holding, for a session that is over.
    expect(auth.listContextsNeedingInteraction()).toEqual([]);
    expect(auth.isInteractionRequired("archive")).toBe(false);
    expect(user.raised.some((e) => e.event === "auth-interaction-resolved:archive")).toBe(true);
});

test("an identity SWITCH is not a logout and must not clear the flag", async () => {
    const user = installUser();
    const auth = await freshAuth();

    auth.registerBroker("oidc", { init() {}, login() {} });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });
    signIn(user, "core");
    auth.markNeedsInteraction("core", { reason: "session-expired", force: true });

    // What XOpatUser.login() raises while swapping identities, before the new one
    // is installed. Treating it as the end of a session would clear a flag that the
    // in-flight login has not actually resolved yet.
    user.logout("core", { switching: true });

    expect(auth.isInteractionRequired("core")).toBe(true);
});

test("logging out a context that was never flagged raises no spurious resolved event", async () => {
    const user = installUser();
    const auth = await freshAuth();

    auth.registerBroker("oidc", { init() {}, login() {} });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });
    signIn(user, "core");

    await auth.logout("core");

    expect(user.raised.some((e) => e.event === "auth-interaction-resolved")).toBe(false);
});

test("replacing a broker re-initializes its contexts rather than stranding them", async () => {
    installUser();
    const auth = await freshAuth();

    const initsA = [];
    auth.registerBroker("oidc", { init: (ctx) => { initsA.push(ctx); }, login() {} });
    await auth.configureContext({ contextId: "core", method: "oidc", secretTypes: ["jwt"] });
    expect(initsA).toEqual(["core"]);

    // Every lookup resolves to the NEW broker from here on, so leaving the context
    // marked initialized would bind it to an object whose init never ran for it.
    const initsB = [];
    auth.registerBroker("oidc", { init: (ctx) => { initsB.push(ctx); }, login() {} });
    await auth.initContext("core");

    expect(initsB).toEqual(["core"]);
});
