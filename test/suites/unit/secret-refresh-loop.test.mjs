/**
 * A 401 asks the context owner for a fresh credential. That is right until the
 * refresh *succeeds* and the resource *still* rejects the result — then every
 * landing re-armed `XOpatUser`'s refresh budget, the retry 401'd, and the cycle ran
 * without bound.
 *
 * Real symptom: a deployed chat fired thousands of `POST /__rpc/.../…` in a few
 * seconds, all 401, each one driving another Keycloak token round trip until the
 * identity provider itself started timing out.
 *
 * These vectors pin the breaker: a landing proves the provider answered, only an
 * accepted request proves the credential works, and N distinct rejected credentials
 * end the asking and hand the context to the interactive gate.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

/** The slice of OpenSeadragon.EventSource that XOpatUser actually uses. */
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

/**
 * Fresh module instance per test: XOpatUser is a singleton guarded by a static, and
 * the breaker state lives on the instance.
 */
async function freshUser(interactionSink) {
    globalThis.window.OpenSeadragon = { EventSource: TestEventSource };
    globalThis.window.HttpClient = { knowsSecretType: () => true };
    globalThis.$ = globalThis.$ ?? { t: (k) => k };
    globalThis.document = globalThis.document ?? { getElementById: () => null };
    globalThis.USER_INTERFACE = { AppBar: { rightMenu: { getTab: () => ({ setTitle() {} }) } } };
    globalThis.Dialogs = { show() {}, MSG_ERR: "err" };
    globalThis.window.APPLICATION_CONTEXT = {
        auth: {
            markNeedsInteraction: (ctx, opts) => interactionSink?.push({ ctx, ...opts }),
        },
    };

    const mod = await import(`../../../src/classes/user.ts?t=${Math.random()}`);
    // The query cache-buster is not reliably honoured by the TS loader, so the module
    // — and with it the singleton's breaker state — can survive into the next test.
    // Drop the static explicitly; `__self` is private to TypeScript only.
    mod.XOpatUser.__self = undefined;
    return mod.XOpatUser.instance();
}

/**
 * A provider that always succeeds, handing back a DIFFERENT token every time — the
 * exact shape that used to loop forever. `tokens` records what it issued.
 */
function installAlwaysSucceedingProvider(user, contextId) {
    const tokens = [];
    user.addHandler(user.getEventName("secret-needs-update", contextId), () => {
        const token = `token-${tokens.length + 1}`;
        tokens.push(token);
        user.setSecret(token, "jwt", contextId);
    });
    return tokens;
}

/**
 * A provider that re-issues the SAME value every time — a SAML / OIDC-server broker
 * re-reading its server session's stored token, or basic-auth replaying the same
 * `{username, password}`. `calls` counts how often it was asked.
 */
function installSameTokenProvider(user, contextId, token = "token-static") {
    const calls = [];
    user.addHandler(user.getEventName("secret-needs-update", contextId), () => {
        calls.push(token);
        user.setSecret(token, "jwt", contextId);
    });
    return calls;
}

/**
 * One 401 round, mirroring `XOpatRemoteEndpoint._maybeRefreshSecrets`: report the
 * credential this request CARRIED as rejected, then ask for a refresh — unless it has
 * already been superseded, in which case the caller just retries with what is there.
 */
async function requestRoundTrip(user, contextId, sent) {
    const current = user.getSecret("jwt", contextId);
    const carried = sent !== undefined ? sent : current;
    user.reportSecretRejected(carried, "jwt", contextId);
    if (carried !== current) return "superseded";
    try {
        await user.requestSecretUpdate("jwt", contextId, 500);
        return "refreshed";
    } catch (e) {
        return "refused";
    }
}

test("a refresh that keeps succeeding into a rejected credential is stopped", async () => {
    const interactions = [];
    const user = await freshUser(interactions);
    const tokens = installAlwaysSucceedingProvider(user, "core");
    user.setSecret("token-0", "jwt", "core");

    const outcomes = [];
    for (let i = 0; i < 6; i++) outcomes.push(await requestRoundTrip(user, "core"));

    // Two distinct credentials refused is enough to conclude the source cannot
    // produce one this resource accepts: the first 401 buys one refresh, the second
    // 401 — now carrying the *refreshed* token — ends the asking. Before the fix all
    // six rounds refreshed, and it would have kept going for the life of the session.
    expect(outcomes.filter((o) => o === "refreshed").length).toBe(1);
    expect(tokens.length).toBe(1);

    // And the context is handed to the interactive gate with the proof that warrants
    // `force`: an actual 401 from the resource it protects.
    expect(interactions.length > 0).toBe(true);
    expect(interactions[0].ctx).toBe("core");
    expect(interactions[0].force).toBe(true);
});

test("every credential landing still raises secret-updated", async () => {
    const user = await freshUser([]);
    const tokens = installAlwaysSucceedingProvider(user, "core");

    const seen = [];
    user.addHandler(user.getEventName("secret-updated", "core"), (e) => seen.push(e.secret));

    user.setSecret("token-0", "jwt", "core");
    for (let i = 0; i < 4; i++) await requestRoundTrip(user, "core");
    expect(tokens.length).toBe(1);

    // Withholding the event to quieten the loop would strand requestSecretUpdate on
    // its timeout and freeze every consumer holding the token. The signal always
    // flows; only the BUDGET is conditional.
    expect(seen.length).toBe(2);          // the initial one + the single refresh
    expect(seen[seen.length - 1]).toBe("token-1");
});

test("a provider that re-issues the SAME rejected credential is stopped too", async () => {
    const interactions = [];
    const user = await freshUser(interactions);
    const calls = installSameTokenProvider(user, "core");
    user.setSecret("token-static", "jwt", "core");

    const outcomes = [];
    for (let i = 0; i < 6; i++) outcomes.push(await requestRoundTrip(user, "core"));

    // The within-burst dedup must not become an excuse for a provider that keeps
    // handing back the same refused value — a SAML/OIDC server session re-reading its
    // stored token, or basic-auth replaying the same credentials. Each landing means a
    // refresh completed, so the next 401 is fresh evidence whatever its bytes.
    expect(outcomes.filter((o) => o === "refreshed").length).toBe(1);
    expect(calls.length).toBe(1);
    expect(interactions.length > 0).toBe(true);
});

test("a stale burst does not accuse the credential that replaced it", async () => {
    const user = await freshUser([]);
    const tokens = installAlwaysSucceedingProvider(user, "core");
    user.setSecret("token-0", "jwt", "core");

    // One request 401s and drives a refresh; token-1 is now attached.
    expect(await requestRoundTrip(user, "core", "token-0")).toBe("refreshed");
    expect(tokens).toEqual(["token-1"]);

    // The rest of that in-flight burst now reports its 401s. They carried token-0, the
    // credential that really was refused. Reading the store instead would blame
    // token-1 and park a context whose new credential nothing has tested yet — and
    // asking again would spend one IdP round trip per member of the burst.
    for (let i = 0; i < 5; i++) {
        expect(await requestRoundTrip(user, "core", "token-0")).toBe("superseded");
    }
    expect(tokens).toEqual(["token-1"]);

    // And the context is still usable — a genuine 401 on token-1 still gets its turn.
    expect(await requestRoundTrip(user, "core", "token-1")).toBe("refused");
});

test("repeats of one dead credential count as a single rejection", async () => {
    const user = await freshUser([]);
    const tokens = installAlwaysSucceedingProvider(user, "core");
    user.setSecret("token-0", "jwt", "core");

    // A tile burst: many parallel requests all carrying the same dead token. If each
    // counted, one burst would exhaust the streak before any refresh ran.
    for (let i = 0; i < 10; i++) user.reportSecretRejected("token-0", "jwt", "core");

    expect(await requestRoundTrip(user, "core")).toBe("refreshed");
    expect(tokens.length).toBe(1);
});

test("an accepted request re-arms the breaker", async () => {
    const user = await freshUser([]);
    installAlwaysSucceedingProvider(user, "core");
    user.setSecret("token-0", "jwt", "core");

    for (let i = 0; i < 4; i++) await requestRoundTrip(user, "core");
    expect(await requestRoundTrip(user, "core")).toBe("refused");

    // The only evidence that the credential source works again.
    user.reportSecretAccepted("jwt", "core");
    expect(await requestRoundTrip(user, "core")).toBe("refreshed");
});

test("a synchronous provider does not strand the in-flight refresh entry", async () => {
    const user = await freshUser([]);
    const tokens = installAlwaysSucceedingProvider(user, "core");
    user.setSecret("token-0", "jwt", "core");

    // `_refreshing[key] = new Promise(executor)` runs the executor BEFORE the
    // assignment, so a provider that calls setSecret synchronously used to clear the
    // entry first and leave the settled promise behind forever — after which every
    // caller got an instant "refreshed" for a refresh that never ran, and the streak
    // could never advance.
    await user.requestSecretUpdate("jwt", "core", 500);
    expect(tokens.length).toBe(1);

    user.reportSecretAccepted("jwt", "core");
    await user.requestSecretUpdate("jwt", "core", 500);
    expect(tokens.length).toBe(2);
});

test("signing out clears the streak so a fresh session is not judged by the old one", async () => {
    const user = await freshUser([]);
    installAlwaysSucceedingProvider(user, "sub");
    user.login("subject-1", "Subject", "", "sub");
    user.setSecret("token-0", "jwt", "sub");

    for (let i = 0; i < 4; i++) await requestRoundTrip(user, "sub");
    expect(await requestRoundTrip(user, "sub")).toBe("refused");

    user.logout("sub");
    user.login("subject-1", "Subject", "", "sub");
    expect(await requestRoundTrip(user, "sub")).toBe("refreshed");
});
