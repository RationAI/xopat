/**
 * Features that mean "is this context logged in?" must not subscribe to
 * `APPLICATION_CONTEXT.auth.onChange` — that is the raw feed and fires on every
 * silent token renew. The chat panel did, so each renew re-ran provider/model
 * discovery; once those calls started answering 401, each 401 drove another renew,
 * which fired the callback again. Thousands of requests.
 *
 * The correct signal already exists on `XOpatUser`. These vectors pin the two
 * properties that make it correct, so a future change cannot quietly break them:
 * a re-asserted identity raises no `login`, and a rotation raises `secret-updated`
 * ALONE.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

class TestEventSource {
    constructor() { this._h = new Map(); }
    addHandler(event, cb) {
        if (!this._h.has(event)) this._h.set(event, []);
        this._h.get(event).push(cb);
    }
    removeHandler(event, cb) {
        const list = this._h.get(event) || [];
        const i = list.indexOf(cb);
        if (i >= 0) list.splice(i, 1);
    }
    numberOfHandlers(event) { return (this._h.get(event) || []).length; }
    raiseEvent(event, payload) {
        for (const cb of [...(this._h.get(event) || [])]) cb(payload || {});
    }
    async raiseEventAwaiting(event, payload) {
        for (const cb of [...(this._h.get(event) || [])]) await cb(payload || {});
    }
}

async function freshUser() {
    globalThis.window.OpenSeadragon = { EventSource: TestEventSource };
    globalThis.window.HttpClient = { knowsSecretType: () => true };
    globalThis.$ = globalThis.$ ?? { t: (k) => k };
    globalThis.document = globalThis.document ?? { getElementById: () => null };
    globalThis.USER_INTERFACE = { AppBar: { rightMenu: { getTab: () => ({ setTitle() {} }) } } };
    globalThis.Dialogs = { show() {}, MSG_ERR: "err" };
    globalThis.window.APPLICATION_CONTEXT = { auth: { markNeedsInteraction: () => {} } };

    const mod = await import(`../../../src/classes/user.ts?t=${Math.random()}`);
    mod.XOpatUser.__self = undefined;   // the query cache-buster is not reliably honoured
    return mod.XOpatUser.instance();
}

/** What a feature subscribing the CORRECT way would see. */
function watchTransitions(user, contextId) {
    const seen = [];
    for (const base of ["login", "logout"]) {
        user.addHandler(user.getEventName(base, contextId), (e) => {
            if (e?.switching === true) return;   // intermediate step of an identity swap
            seen.push(base);
        });
    }
    return seen;
}

test("a token rotation raises secret-updated and nothing else", async () => {
    const user = await freshUser();
    user.login("subject-1", "Subject", "", undefined);

    const transitions = watchTransitions(user, undefined);
    const rotations = [];
    user.addHandler(user.getEventName("secret-updated", undefined), () => rotations.push(1));

    for (let i = 0; i < 5; i++) user.setSecret(`token-${i}`, "jwt", undefined);

    expect(rotations.length).toBe(5);
    expect(transitions.length).toBe(0);
});

test("re-asserting the same identity is not a new login", async () => {
    const user = await freshUser();
    user.login("subject-1", "Subject", "", undefined);

    const transitions = watchTransitions(user, undefined);
    // Every OIDC silent renew raises `userLoaded`; the broker only calls login() when
    // not already logged in, and login() itself is idempotent for core. Both belts.
    user.login("subject-1", "Subject", "", undefined);
    user.login("subject-1", "Renamed Subject", "", undefined);

    expect(transitions.length).toBe(0);
});

test("a real sign-out, and an identity swap, are reported once each", async () => {
    const user = await freshUser();
    user.login("subject-1", "Subject", "", undefined);
    const transitions = watchTransitions(user, undefined);

    // A swap raises logout{switching:true} then login. Only the login is a real
    // transition — counting the logout would flash a feature through "signed out".
    user.login("subject-2", "Other", "", undefined);
    expect(transitions).toEqual(["login"]);

    user.logout(undefined);
    expect(transitions).toEqual(["login", "logout"]);
});

test("a sub-context reports its own transitions, keyed by context", async () => {
    const user = await freshUser();
    const core = watchTransitions(user, undefined);
    const sub = watchTransitions(user, "anthropic");

    user.login("subject-1", "Subject", "", "anthropic");
    user.setSecret("token-a", "jwt", "anthropic");
    user.setSecret("token-b", "jwt", "anthropic");   // a renew

    expect(sub).toEqual(["login"]);
    expect(core.length).toBe(0);
});

test("re-asserting a SUB-CONTEXT identity is not a new login either", async () => {
    const user = await freshUser();
    user.login("subject-1", "Subject", "", "anthropic");
    const sub = watchTransitions(user, "anthropic");

    // This branch used to raise unconditionally, so whether a renew looked like a
    // sign-in depended on all five brokers guarding the call site. The invariant
    // belongs here, not in each of them.
    user.login("subject-1", "Subject", "", "anthropic");
    user.login("subject-1", "Renamed", "", "anthropic");

    expect(sub.length).toBe(0);
    // The display data is still refreshed by the re-assert.
    expect(user.getUserId("anthropic")).toBe("subject-1");
});

test("a sub-context identity swap drops the previous subject's secret", async () => {
    const user = await freshUser();
    user.login("subject-1", "Subject", "", "anthropic");
    user.setSecret("token-of-subject-1", "jwt", "anthropic");

    const swaps = [];
    user.addHandler(user.getEventName("logout", "anthropic"), (e) => swaps.push(!!e?.switching));
    const removed = [];
    user.addHandler(user.getEventName("secret-removed", "anthropic"), () => removed.push(1));

    user.login("subject-2", "Other", "", "anthropic");

    // Leaving subject-1's bearer token attached to subject-2 is exactly what the
    // brokers' subject-change guards were working around.
    expect(swaps).toEqual([true]);
    expect(removed.length).toBe(1);
    expect(user.getSecret("jwt", "anthropic")).toBeFalsy();
    expect(user.getUserId("anthropic")).toBe("subject-2");
});
