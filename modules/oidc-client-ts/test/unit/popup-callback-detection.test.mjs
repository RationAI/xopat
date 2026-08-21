/**
 * A popup sign-in callback must be recognised WITHOUT reading storage.
 *
 * It used to be recognised by looking up the returning `state` in the sign-in
 * state store, and for a popup that can never succeed: oidc-client-ts creates the
 * window inside `PopupNavigator.prepare()` and only the following `_signinStart`
 * writes the state entry, while `sessionStorage` (the default store) is
 * snapshot-cloned into a new browsing context at `window.open()` time. The clone
 * therefore predates the write. Every popup login booted a second viewer and then
 * accused the browser of blocking site storage on a perfectly healthy origin.
 *
 * No browser store is guaranteed to cross a window boundary, and the ones that
 * might are operator-rebindable — so these vectors pin that the decision comes
 * from `window.opener` / `window.parent` and from nothing else. The stores below
 * are deliberately left EMPTY: if a vector starts depending on one, it fails.
 */
import { test, expect } from "@xopat/test-harness";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const MODULE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * `oidc-auth.js` is a classic script that assigns `window.OIDCAuthClient`, so it
 * cannot be imported — evaluate it against the smallest globals it touches.
 *
 * @param {{opener?: boolean, framed?: boolean, search?: string}} win how this
 *   document is related to the window that started the flow.
 */
function loadClient(win = {}) {
    const calls = [];
    const dialogs = [];
    const record = (name) => (...args) => { calls.push({ name, args }); return Promise.resolve(); };

    const windowStub = {
        location: {
            href: `https://viewer.example.org/${win.search || ""}`,
            search: win.search || "",
            origin: "https://viewer.example.org",
            pathname: "/",
        },
        history: { replaceState() {} },
        document: { title: "x" },
        APPLICATION_CONTEXT: { url: "https://viewer.example.org/", env: {} },
        moduleMeta: (id, key) => (id === "oidc-client-ts" && key === "path" ? "modules/oidc-client-ts/" : undefined),
    };
    // `self !== top` is what "am I framed" means; `opener !== window` likewise.
    windowStub.self = windowStub;
    windowStub.top = win.framed ? { name: "outer" } : windowStub;
    windowStub.opener = win.opener ? { name: "opener" } : null;

    /** A store that is present but EMPTY — the popup's real situation. */
    const emptyStore = { async get() { return null; }, async set() {}, async remove() {} };

    const sandbox = {
        window: windowStub,
        console: { debug() {}, info() {}, warn() {}, error() {} },
        URL, URLSearchParams, Promise, JSON, Date, Math, Set, Map, Error,
        setTimeout, clearTimeout, setInterval, clearInterval,
        $: { t: (k) => k },
        Dialogs: { show: (msg) => dialogs.push(msg), MSG_ERR: "e", MSG_WARN: "w" },
        USER_INTERFACE: { Loading: { text() {} } },
        UTILITIES: { storePageState: () => true },
        XOpatUser: {
            instance: () => ({
                addHandler() {}, getEventName: (n) => n,
                getIsLogged: () => false, getSecret: () => undefined,
            }),
        },
        XOpatStorage: { Session: class { getStore() { return emptyStore; } } },
        APPLICATION_CONTEXT: windowStub.APPLICATION_CONTEXT,
        oidc: {
            InMemoryWebStorage: class {},
            WebStorageStateStore: class {
                constructor(o) { Object.assign(this, o, emptyStore); }
            },
            UserManager: class {
                constructor(settings) {
                    this.settings = settings;
                    this.events = { addUserLoaded() {} };
                    this.signinPopupCallback = record("signinPopupCallback");
                    this.signinSilentCallback = record("signinSilentCallback");
                    this.signinRedirectCallback = record("signinRedirectCallback");
                }
                stopSilentRenew() {}
            },
        },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(join(MODULE_DIR, "oidc-auth.js"), "utf8"), sandbox, { filename: "oidc-auth.js" });

    const Client = windowStub.OIDCAuthClient;
    const make = (options = {}) => new Client(
        { authority: "https://idp.example", client_id: "abc", scope: "openid" },
        { userContextId: "anthropic", ...options });
    return { Client, make, calls, dialogs };
}

const named = (calls) => calls.map((c) => c.name);

test("a document with an opener is answered as a popup callback, with an EMPTY state store @unit", async () => {
    const { make, calls } = loadClient({ opener: true, search: "?state=abc&code=xyz" });
    const client = make();

    expect(await client._handleForeignAuthCallback()).toBe(true);
    // The store holds nothing — as it always does in a popup. Detection must not care.
    expect(named(calls)).toEqual(["signinPopupCallback"]);
});

test("a framed document is answered as a silent-renew callback @unit", async () => {
    const { make, calls } = loadClient({ framed: true, search: "?state=abc&code=xyz" });
    const client = make();

    expect(await client._handleForeignAuthCallback()).toBe(true);
    expect(named(calls)).toEqual(["signinSilentCallback"]);
});

test("an opener wins over being framed — only the opener is awaiting us @unit", async () => {
    const { make, calls } = loadClient({ opener: true, framed: true, search: "?state=abc" });
    const client = make();

    expect(await client._handleForeignAuthCallback()).toBe(true);
    expect(named(calls)).toEqual(["signinPopupCallback"]);
});

test("a top-level document owns its own redirect and falls through @unit", async () => {
    const { make, calls } = loadClient({ search: "?state=abc&code=xyz" });
    const client = make();

    // Not a child window: `_doInit` must decide, using the state store — which is
    // correct there, because a redirect never leaves the tab.
    expect(await client._handleForeignAuthCallback()).toBe(false);
    expect(named(calls)).toEqual([]);
});

test("no returning state is never a callback, whatever the window role @unit", async () => {
    for (const role of [{ opener: true }, { framed: true }, {}]) {
        const { make, calls } = loadClient({ ...role, search: "" });
        expect(await make()._handleForeignAuthCallback()).toBe(false);
        expect(named(calls)).toEqual([]);
    }
});

/**
 * Drive `_doInit` to the "returning state we cannot attribute" branch: pretend the
 * document was not claimed as a callback and holds no usable session, which is
 * where the storage verdict lives.
 */
async function initWithUnattributableState(win) {
    const { make, dialogs } = loadClient({ ...win, search: "?state=abc&code=xyz" });
    const client = make();
    client._handleForeignAuthCallback = async () => false;
    client.handleUserDataChanged = async () => false;
    client._ownsSigninState = async () => false;
    await client._doInit();
    return dialogs;
}

test("a child window never reports the opener's storage as broken @unit", async () => {
    // The user-visible symptom: with two contexts configured, the one that did NOT
    // start the login reached this verdict and accused the browser — naming the
    // wrong service — while the login itself was completing fine in the opener.
    // A child window is never the owner of the state, so the verdict is unsound.
    expect(await initWithUnattributableState({ opener: true })).toEqual([]);
    expect(await initWithUnattributableState({ framed: true })).toEqual([]);
});

test("a top-level document with an unattributable state still reports it @unit", async () => {
    // The guard must not silence the case it was written for: here the store
    // genuinely did not survive the redirect, and saying nothing would leave the
    // user on a viewer that had quietly given up mid-login.
    expect(await initWithUnattributableState({})).toEqual(["oidc.storageNotPersisting"]);
});

test("the sign-in window is named per context, so an abandoned tab is never reused @unit", async () => {
    const { make } = loadClient();
    const a = make({ userContextId: "anthropic" })._popupTarget();
    const b = make({ userContextId: "other" })._popupTarget();

    expect(a).not.toBe(b);
    // Shared naming is what made a retry navigate an already-open tab instead of
    // opening its own — which reads as the flow switching to a redirect.
    expect(a.includes("anthropic")).toBe(true);
});

test("useCallbackPage redirects only the popup and silent flows @unit", async () => {
    const { make } = loadClient();
    const on = make({ useCallbackPage: true }).configuration;

    expect(on.popup_redirect_uri).toBe("https://viewer.example.org/modules/oidc-client-ts/auth-callback.html");
    expect(on.silent_redirect_uri).toBe(on.popup_redirect_uri);
    // The full-page flow must still land on the application.
    expect(on.redirect_uri).toBe("https://viewer.example.org/");

    const off = make().configuration;
    expect(off.popup_redirect_uri).toBe(undefined);
    expect(off.silent_redirect_uri).toBe(undefined);
});

test("an explicit popup_redirect_uri is never overwritten @unit", async () => {
    const { Client } = loadClient();
    const client = new Client(
        {
            authority: "https://idp.example", client_id: "abc", scope: "openid",
            popup_redirect_uri: "https://viewer.example.org/mine.html",
        },
        { userContextId: "anthropic", useCallbackPage: true });

    expect(client.configuration.popup_redirect_uri).toBe("https://viewer.example.org/mine.html");
    // The one it did not pin still gets the default.
    expect(client.configuration.silent_redirect_uri)
        .toBe("https://viewer.example.org/modules/oidc-client-ts/auth-callback.html");
});
