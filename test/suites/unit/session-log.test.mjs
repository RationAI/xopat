/**
 * The `session` channel must put auth settling on the record.
 *
 * It listened for a `context-settled` event on an object that was not an
 * EventSource, so the guard was always false and the record never appeared.
 * `APPLICATION_CONTEXT.auth` now raises `auth-settled`; a verdict reached before
 * the log is wired (boot autoLogin) must be replayed, like the opening slide.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

function fakeAuth(lastByContext = {}) {
    const handlers = new Map();
    return {
        addHandler(event, cb) {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event).push(cb);
        },
        raiseEvent(event, payload) {
            for (const cb of handlers.get(event) || []) cb(payload);
        },
        listContexts: () => Object.keys(lastByContext).map((contextId) => ({ contextId, method: "oidc" })),
        getLastSettleResult: (id) => lastByContext[id],
    };
}

function installContext(auth) {
    const records = [];
    globalThis.APPLICATION_CONTEXT = {
        env: {}, secureMode: false, auth,
        log: () => ({
            info: (fields, msg) => records.push({ level: "info", fields, msg }),
            debug: (fields, msg) => records.push({ level: "debug", fields, msg }),
        }),
    };
    delete globalThis.VIEWER_MANAGER;
    return records;
}

async function wire() {
    const mod = await import("../../../src/classes/app/session-log.ts");
    mod.wireSessionLog();
}

const authRecords = (records) => records.filter((r) => r.msg === "auth settled");

test("a verdict reached before wiring is replayed, and later ones are followed", async () => {
    const auth = fakeAuth({
        core: { contextId: "core", authenticated: true, reason: "authenticated" },
        archive: undefined,
    });
    const records = installContext(auth);
    await wire();

    expect(authRecords(records).map((r) => r.fields)).toEqual([
        { contextId: "core", authenticated: true, reason: "authenticated" },
    ]);

    auth.raiseEvent("auth-settled", { contextId: "archive", authenticated: false, reason: "timeout" });
    expect(authRecords(records).length).toBe(2);
    expect(authRecords(records)[1].fields).toEqual({ contextId: "archive", authenticated: false, reason: "timeout" });
});

test("no auth broker is not an error", async () => {
    const records = installContext(undefined);
    await wire();
    expect(authRecords(records)).toEqual([]);
    expect(records.some((r) => r.msg === "session started")).toBe(true);
});
