/**
 * `XOpatUser.login` on a sub-context is two operations wearing one name: a
 * re-assert (same subject, possibly a better label) and a swap (different
 * subject, which must drop the previous subject's credentials).
 *
 * The distinction is invisible at the call site and expensive to get wrong. A
 * broker that "refined" its display label by logging in with a different id
 * destroyed a live workbench token, and the only symptom was every later request
 * going out with no `Authorization` header — answered 403, never retried.
 *
 * These vectors pin both directions, and the warning that makes the destructive
 * one audible.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

/** The slice of OpenSeadragon.EventSource XOpatUser actually uses. */
function installOpenSeadragonEventSource() {
    class EventSource {
        constructor() { this.__handlers = new Map(); }
        addHandler(event, cb) {
            if (!this.__handlers.has(event)) this.__handlers.set(event, []);
            this.__handlers.get(event).push(cb);
        }
        removeHandler(event, cb) {
            const list = this.__handlers.get(event) || [];
            const i = list.indexOf(cb);
            if (i >= 0) list.splice(i, 1);
        }
        numberOfHandlers(event) { return (this.__handlers.get(event) || []).length; }
        raiseEvent(event, payload) {
            for (const cb of [...(this.__handlers.get(event) || [])]) cb(payload || {});
        }
        async raiseEventAwaiting(event, payload) {
            for (const cb of [...(this.__handlers.get(event) || [])]) await cb(payload || {});
        }
    }
    globalThis.window.OpenSeadragon = { ...(globalThis.window.OpenSeadragon || {}), EventSource };
}

async function freshUser() {
    installOpenSeadragonEventSource();
    globalThis.window.HttpClient = { knowsSecretType: () => true };
    globalThis.HttpClient = globalThis.window.HttpClient;
    globalThis.$ = globalThis.$ ?? { t: (k) => k };
    // No DOM here; the constructor looks for its app-bar panel. Probe for the
    // method rather than for *a* document — unit suites share a worker.
    if (typeof globalThis.document?.getElementById !== "function") {
        globalThis.document = { getElementById: () => null };
    }
    const mod = await import(`../../../src/classes/user.ts?t=${Math.random()}`);
    mod.XOpatUser.__self = undefined;
    return new mod.XOpatUser();
}

/** Capture console.warn for the duration of `fn`. */
async function withWarnings(fn) {
    const original = console.warn;
    const seen = [];
    console.warn = (...args) => seen.push(args.join(" "));
    try { await fn(); } finally { console.warn = original; }
    return seen;
}

test("re-asserting the same id keeps the context's secret @unit", async () => {
    // The empaia case: the scope id is installed when the token lands, and the
    // human user id arrives later as a nicer LABEL for the same subject.
    const user = await freshUser();
    user.login("scope-1", "EMPAIA", "", "empaia");
    user.setSecret("token-abc", "jwt", "empaia");

    user.login("scope-1", "dr-house@example.org", "", "empaia");

    expect(user.getSecret("jwt", "empaia")).toBe("token-abc");
    expect(user.getUserId("empaia")).toBe("scope-1");
    expect(user.getIsLogged("empaia")).toBe(true);
});

test("a genuine subject change still drops that context's secrets @unit", async () => {
    // The wipe is the point of the swap branch — an account switch at the IdP must
    // not leave the previous subject's bearer token attached.
    const user = await freshUser();
    user.login("subject-a", "A", "", "empaia");
    user.setSecret("token-a", "jwt", "empaia");

    user.login("subject-b", "B", "", "empaia");

    expect(user.getSecret("jwt", "empaia")).toBeFalsy();
    expect(user.getUserId("empaia")).toBe("subject-b");
});

test("discarding a live credential is announced @unit", async () => {
    // Silence here cost a full debugging session: the destruction happens in core,
    // the symptom appears in an unrelated module's network log.
    const user = await freshUser();
    user.login("subject-a", "A", "", "empaia");
    user.setSecret("token-a", "jwt", "empaia");

    const warnings = await withWarnings(() => user.login("subject-b", "B", "", "empaia"));

    expect(warnings.some(w => w.includes("empaia") && w.includes("subject-a") && w.includes("subject-b")))
        .toBe(true);
});

test("a swap with nothing to lose stays quiet @unit", async () => {
    const user = await freshUser();
    user.login("subject-a", "A", "", "empaia");

    const warnings = await withWarnings(() => user.login("subject-b", "B", "", "empaia"));

    expect(warnings.filter(w => w.includes("secrets are being discarded")).length).toBe(0);
});
