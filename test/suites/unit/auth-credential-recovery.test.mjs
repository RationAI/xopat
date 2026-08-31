/**
 * What happens when a request goes out with NO credential at all.
 *
 * Two independent gaps let one lost token kill a session for the life of the tab,
 * and an EMPAIA Workbench embedding hit both at once:
 *
 *  - the refresh cycle fired only on 401, while FastAPI's bearer scheme reports a
 *    MISSING `Authorization` header as **403** (401 means "present and rejected"),
 *    so nothing ever retried; and
 *  - `_maybeRefreshSecrets` read "this request carried nothing" as "already
 *    superseded, just retry", so the provider that could have re-issued the token
 *    was never asked.
 *
 * Both are policy, not transport — pinned here at the unit the policy lives in.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.window.OpenSeadragon = globalThis.window.OpenSeadragon ?? { TileSource: class TileSource {} };

const APP = { url: "https://viewer.example.org/", auth: undefined };
globalThis.APPLICATION_CONTEXT = globalThis.window.APPLICATION_CONTEXT = APP;

/** A stand-in secret store recording what the endpoint asked it for. */
function storeWith({ secrets = {}, onUpdate = null } = {}) {
    const calls = { rejected: [], updates: [] };
    const store = {
        getSecret: (type, ctx) => secrets[`${ctx ?? "core"}:${type}`],
        setSecret: (v, type, ctx) => { secrets[`${ctx ?? "core"}:${type}`] = v; },
        reportSecretRejected: (secret, type, ctx) => calls.rejected.push({ secret, type, ctx }),
        requestSecretUpdate: async (type, ctx) => {
            calls.updates.push({ type, ctx });
            if (onUpdate) await onUpdate(type, ctx, store);
        },
    };
    return { store, calls, secrets };
}

async function clientWith(store, auth = {}) {
    globalThis.XOpatUser = globalThis.window.XOpatUser = { instance: () => store };
    const { HttpClient } = await import(`../../../src/classes/http-client.ts?t=${Math.random()}`);
    return new HttpClient({ baseURL: "https://wbs.example.org", auth });
}

test("the refresh cycle fires on 401 only, unless the caller widens it @unit", async () => {
    const { store } = storeWith();
    const dflt = await clientWith(store, { contextId: "empaia" });

    expect(dflt.refreshesOnStatus(401)).toBe(true);
    // 403 is "authenticated but not allowed" for most upstreams — spending an
    // identity-provider round trip on it by default would be wrong.
    expect(dflt.refreshesOnStatus(403)).toBe(false);
    expect(dflt.refreshesOnStatus(500)).toBe(false);

    const widened = await clientWith(store, { contextId: "empaia", refreshOnStatuses: [401, 403] });
    expect(widened.refreshesOnStatus(401)).toBe(true);
    expect(widened.refreshesOnStatus(403)).toBe(true);
    expect(widened.refreshesOnStatus(404)).toBe(false);
});

test("refreshOn401:false still disables everything the list names @unit", async () => {
    // The opt-out predates the list and callers rely on it; a widened list must
    // not become a way around it.
    const { store } = storeWith();
    const client = await clientWith(store, {
        contextId: "empaia", refreshOn401: false, refreshOnStatuses: [401, 403],
    });
    expect(client.refreshesOnStatus(401)).toBe(false);
    expect(client.refreshesOnStatus(403)).toBe(false);
});

test("a request that carried NO credential asks the provider @unit", async () => {
    // The empaia shape: an identity swap dropped `empaia:jwt`, so every request
    // goes out bare. Retrying bare reproduces the failure forever — the only
    // thing that can fix it is asking the provider for a token.
    const { store, calls, secrets } = storeWith({
        onUpdate: (type, ctx, s) => s.setSecret("fresh-token", type, ctx),
    });
    const client = await clientWith(store, { contextId: "empaia", types: ["jwt"] });

    const refreshed = await client._maybeRefreshSecrets({});

    expect(calls.updates).toEqual([{ type: "jwt", ctx: "empaia" }]);
    expect(secrets["empaia:jwt"]).toBe("fresh-token");
    expect(refreshed).toBe(true);
    // Nothing was sent, so nothing can be accused of being rejected.
    expect(calls.rejected.length).toBe(0);
});

test("a provider that cannot deliver reports failure instead of a blind retry @unit", async () => {
    // `requestSecretUpdate` rejects outright when no auth module listens on the
    // context. Reporting "refreshed" there would spend the caller's single retry
    // on an identical bare request and hide the upstream's own error.
    const { store } = storeWith({ onUpdate: () => { throw new Error("no provider listens"); } });
    const client = await clientWith(store, { contextId: "empaia", types: ["jwt"] });

    expect(await client._maybeRefreshSecrets({})).toBe(false);
});

test("a credential already replaced in flight is retried, not re-requested @unit", async () => {
    // A burst sharing one expired token: the first 401 refreshes it, the late
    // ones must not each buy another round trip.
    const { store, calls } = storeWith({ secrets: { "empaia:jwt": "new-token" } });
    const client = await clientWith(store, { contextId: "empaia", types: ["jwt"] });

    const refreshed = await client._maybeRefreshSecrets({ jwt: "old-token" });

    expect(refreshed).toBe(true);
    expect(calls.updates.length).toBe(0);
    expect(calls.rejected).toEqual([{ secret: "old-token", type: "jwt", ctx: "empaia" }]);
});

test("the credential a failing request DID carry is still refreshed @unit", async () => {
    const { store, calls } = storeWith({
        secrets: { "empaia:jwt": "stale" },
        onUpdate: (type, ctx, s) => s.setSecret("fresh", type, ctx),
    });
    const client = await clientWith(store, { contextId: "empaia", types: ["jwt"] });

    expect(await client._maybeRefreshSecrets({ jwt: "stale" })).toBe(true);
    expect(calls.updates).toEqual([{ type: "jwt", ctx: "empaia" }]);
    expect(calls.rejected).toEqual([{ secret: "stale", type: "jwt", ctx: "empaia" }]);
});
