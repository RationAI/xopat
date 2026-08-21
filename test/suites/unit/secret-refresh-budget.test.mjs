/**
 * `XOpatUser.requestSecretUpdate` is core's fan-out to whatever can re-provision a
 * credential. Deduplicating only the IN-FLIGHT attempt is not enough: a provider
 * that cannot re-provision right now still cannot a second later, while every
 * failing request keeps asking. A captured session turned that into repeated
 * identity-provider round trips for the rest of its life, each several seconds
 * long, none of which could have succeeded.
 *
 * The budget must also not become a trap: a credential landing is proof the
 * provider works again and re-arms everything.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

async function freshUser({ cooldownMs = 60_000, maxFailures = 2 } = {}) {
    // XOpatUser extends window.OpenSeadragon.EventSource and touches a few globals
    // at import time; supply the smallest surface that satisfies it.
    installOpenSeadragonEventSource();
    globalThis.window.HttpClient = { knowsSecretType: () => true };
    globalThis.$ = globalThis.$ ?? { t: (k) => k };
    globalThis.HttpClient = globalThis.window.HttpClient;
    // The constructor looks for its app-bar panel; there is no DOM here.
    globalThis.document = globalThis.document ?? { getElementById: () => null };

    const mod = await import(`../../../src/classes/user.ts?t=${Math.random()}`);
    mod.XOpatUser.REFRESH_COOLDOWN_MS = cooldownMs;
    mod.XOpatUser.MAX_REFRESH_FAILURES = maxFailures;
    // XOpatUser is a singleton and the loader may hand back a module instance a
    // previous test already constructed — release the claim so each vector starts
    // from clean per-secret state.
    mod.XOpatUser.__self = undefined;
    return new mod.XOpatUser();
}

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

test("a burst of failing requests produces ONE refresh attempt", async () => {
    const user = await freshUser();
    let attempts = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    user.addHandler("secret-needs-update", async () => { attempts++; await gate; });

    const all = [
        user.requestSecretUpdate("jwt").catch(() => "rejected"),
        user.requestSecretUpdate("jwt").catch(() => "rejected"),
        user.requestSecretUpdate("jwt").catch(() => "rejected"),
    ];
    // The provider answers without providing anything — the common failure.
    release();
    user.setSecret("token", "jwt");
    await Promise.all(all);

    expect(attempts).toBe(1);
});

test("a fresh attempt inside the cooldown is refused without touching the provider", async () => {
    const user = await freshUser();
    let attempts = 0;
    user.addHandler("secret-needs-update", async () => { attempts++; /* provides nothing */ });

    await user.requestSecretUpdate("jwt", undefined, 20).catch(() => {});
    expect(attempts).toBe(1);

    const second = await user.requestSecretUpdate("jwt", undefined, 20).catch((e) => e);
    expect(attempts).toBe(1);                       // provider left alone
    expect(String(second)).toContain("cooldown");
});

test("after the failure cap, further requests reject immediately", async () => {
    const user = await freshUser({ cooldownMs: 0, maxFailures: 2 });
    let attempts = 0;
    user.addHandler("secret-needs-update", async () => { attempts++; });

    await user.requestSecretUpdate("jwt", undefined, 20).catch(() => {});
    await user.requestSecretUpdate("jwt", undefined, 20).catch(() => {});
    expect(attempts).toBe(2);

    const capped = await user.requestSecretUpdate("jwt", undefined, 20).catch((e) => e);
    expect(attempts).toBe(2);
    expect(String(capped)).toContain("giving up");
});

test("a credential landing re-arms the budget", async () => {
    const user = await freshUser({ cooldownMs: 0, maxFailures: 1 });
    let attempts = 0;
    user.addHandler("secret-needs-update", async () => { attempts++; });

    await user.requestSecretUpdate("jwt", undefined, 20).catch(() => {});
    expect(attempts).toBe(1);
    // Capped now…
    await user.requestSecretUpdate("jwt", undefined, 20).catch(() => {});
    expect(attempts).toBe(1);

    // …until a login (interactive or otherwise) deposits one.
    user.setSecret("token", "jwt");

    await user.requestSecretUpdate("jwt", undefined, 20).catch(() => {});
    expect(attempts).toBe(2);
});

test("the budget is per (type, context) — one dead context does not gag another", async () => {
    const user = await freshUser({ cooldownMs: 0, maxFailures: 1 });
    const seen = [];
    user.addHandler("secret-needs-update", async (e) => { seen.push(`core:${e.type}`); });
    user.addHandler("secret-needs-update:archive", async (e) => { seen.push(`archive:${e.type}`); });

    await user.requestSecretUpdate("jwt", undefined, 20).catch(() => {});
    await user.requestSecretUpdate("jwt", undefined, 20).catch(() => {});   // capped
    await user.requestSecretUpdate("jwt", "archive", 20).catch(() => {});   // unaffected

    expect(seen).toEqual(["core:jwt", "archive:jwt"]);
});
