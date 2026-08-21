/**
 * A module can only change session state by MUTATING IT IN PLACE — there is no
 * session-set API, so `ctx.session.__saml.sessions[x] = state` is the whole
 * vocabulary. The per-request write-back has to notice that.
 *
 * It did not. `splitSession` copies references, and the write-back's "snapshot" was
 * one of those splits, so the change detector stringified a mutated object against
 * itself and concluded nothing had changed. A newly ADDED top-level key still
 * differed and so still persisted, which made it look like state worked exactly
 * once and never again.
 *
 * What that cost in practice: a SAML popup login completed, `/finish` ran,
 * `saveSession` wrote the token into `ctx.session.__saml.sessions.core` — and the
 * next request read the stale, empty state. The viewer sat on a blocking "not
 * authenticated" overlay while the server had a perfectly good token. Nothing
 * failed, nothing logged, and 435 passing tests saw none of it.
 */
import { test, expect } from "@xopat/test-harness";

const load = () => import("../../../server/node/session-writeback.js");

/** The store shape the write-back needs: `get`, `set`, plus a record of writes. */
function fakeStore(initial = {}) {
    let data = { ...initial };
    const writes = [];
    return {
        get writes() { return writes; },
        get data() { return data; },
        async get() { return data; },
        async set(id, value) { data = value; writes.push(value); },
    };
}

/** Snapshot a session the way the request path does, at resolve time. */
async function snapshotOf(session) {
    const { splitSession, serializeSessionHalf } = await load();
    const half = splitSession(session).secure;
    return { snapshot: serializeSessionHalf(half), live: session };
}

test("a NESTED mutation of an existing key is persisted", async () => {
    const { splitSession, mergeSessionWriteBack } = await load();

    // `__saml` already exists — which it does after ANY earlier read, because the
    // module's store accessor creates it on read as well as on write. That is what
    // armed the trap before the user ever clicked.
    const session = { id: "s1", __saml: { sessions: {} } };
    const { snapshot } = await snapshotOf(session);

    // What `saveSession` does.
    session.__saml.sessions.core = { token: "tok", claims: { sub: "u1" } };

    const store = fakeStore();
    const wrote = await mergeSessionWriteBack(store, "s1", snapshot, splitSession(session).secure);

    expect(wrote).toBe(true);
    expect(store.data.__saml.sessions.core.token).toBe("tok");
});

test("a newly ADDED top-level key is persisted — the case that always worked", async () => {
    const { splitSession, mergeSessionWriteBack } = await load();

    const session = { id: "s1" };
    const { snapshot } = await snapshotOf(session);
    session.__saml = { sessions: { core: { token: "tok" } } };

    const store = fakeStore();
    expect(await mergeSessionWriteBack(store, "s1", snapshot, splitSession(session).secure)).toBe(true);
    expect(store.data.__saml.sessions.core.token).toBe("tok");
});

test("an untouched session writes nothing", async () => {
    const { splitSession, mergeSessionWriteBack } = await load();

    const session = { id: "s1", __saml: { sessions: { core: { token: "tok" } } } };
    const { snapshot } = await snapshotOf(session);

    const store = fakeStore();
    expect(await mergeSessionWriteBack(store, "s1", snapshot, splitSession(session).secure)).toBe(false);
    expect(store.writes.length).toBe(0);
});

test("a deleted key is removed rather than left behind", async () => {
    const { splitSession, mergeSessionWriteBack } = await load();

    const session = { id: "s1", __saml: { sessions: { core: {} } }, __other: { a: 1 } };
    const { snapshot } = await snapshotOf(session);
    delete session.__saml;                       // what `clearSession` amounts to

    const store = fakeStore({ __saml: { sessions: { core: {} } }, __other: { a: 1 } });
    expect(await mergeSessionWriteBack(store, "s1", snapshot, splitSession(session).secure)).toBe(true);
    expect("__saml" in store.data).toBe(false);
    expect(store.data.__other.a).toBe(1);
});

test("the write merges into what is stored rather than replacing it", async () => {
    const { splitSession, mergeSessionWriteBack } = await load();

    const session = { id: "s1", __saml: { sessions: {} } };
    const { snapshot } = await snapshotOf(session);
    session.__saml.sessions.core = { token: "tok" };

    // Another worker/request wrote an unrelated key meanwhile.
    const store = fakeStore({ __somethingElse: { keep: true } });
    await mergeSessionWriteBack(store, "s1", snapshot, splitSession(session).secure);

    expect(store.data.__somethingElse.keep).toBe(true);
    expect(store.data.__saml.sessions.core.token).toBe("tok");
});

test("the identity half is split off and never lands in the secure half", async () => {
    const { splitSession } = await load();

    const { shared, secure } = splitSession({
        id: "s1", csrfToken: "c", createdAt: 1, lastSeenAt: 2, allowedProxies: "ALL",
        __saml: { sessions: {} },
    });

    expect(Object.keys(shared).sort())
        .toEqual(["allowedProxies", "createdAt", "csrfToken", "id", "lastSeenAt"]);
    // An unknown key defaults to the secure half — a module never silently gains
    // persistence by inventing a key.
    expect(Object.keys(secure)).toEqual(["__saml"]);
});

test("serializeSessionHalf does not alias the live objects", async () => {
    const { splitSession, serializeSessionHalf } = await load();

    const session = { id: "s1", __saml: { sessions: {} } };
    const snapshot = serializeSessionHalf(splitSession(session).secure);
    session.__saml.sessions.core = { token: "tok" };

    // The point of the whole exercise, stated directly: the snapshot must describe
    // the past, not follow the present.
    expect(snapshot.__saml).toBe(JSON.stringify({ sessions: {} }));
});
