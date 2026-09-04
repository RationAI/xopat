/**
 * A silent sign-in has two routes, and they fail in ways that mean opposite things.
 *
 * `"unknown"` tells core "we never reached the authority", which core answers by
 * removing the context from the interactive phase entirely — no redirect, no
 * interaction gate. That is right for a refresh grant that could not reach the token
 * endpoint, and wrong for the hidden `prompt=none` frame, which times out for reasons
 * that say nothing about reachability: the frame carries the viewer's own load cost,
 * providers commonly refuse to be framed, and one that rejects the `redirect_uri`
 * renders its own error page — unreadable cross-origin, so the only symptom is the
 * watchdog.
 *
 * Real symptom: a viewer whose identity provider answered `prompt=none` with a code
 * when asked by hand still booted with no credential at all, warned "could not reach
 * the authority", and sent every slide request unauthenticated into a 403.
 */
import { test, expect } from "@xopat/test-harness";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const MODULE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * `oidc-auth.js` is a classic script assigning `window.OIDCAuthClient`, so it cannot
 * be imported — evaluate it against the smallest globals it touches.
 *
 * @param {{silentRejection?: any}} opts what `userManager.signinSilent()` does.
 */
function loadClient(opts = {}) {
    const debugLines = [];
    const warnLines = [];

    const windowStub = {
        location: { href: "https://viewer.example.org/", search: "", origin: "https://viewer.example.org", pathname: "/" },
        history: { replaceState() {} },
        document: { title: "x" },
        APPLICATION_CONTEXT: { url: "https://viewer.example.org/", env: {} },
        moduleMeta: (id, key) => (id === "oidc-client-ts" && key === "path" ? "modules/oidc-client-ts/" : undefined),
    };
    windowStub.self = windowStub;
    windowStub.top = windowStub;
    windowStub.opener = null;

    const emptyStore = { async get() { return null; }, async set() {}, async remove() {} };

    const sandbox = {
        window: windowStub,
        console: {
            debug: (...a) => debugLines.push(a.join(" ")),
            info() {},
            warn: (...a) => warnLines.push(a.join(" ")),
            error() {},
        },
        URL, URLSearchParams, Promise, JSON, Date, Math, Set, Map, Error, Object, String,
        setTimeout, clearTimeout, setInterval, clearInterval,
        $: { t: (k) => k },
        Dialogs: { show() {}, MSG_ERR: "e", MSG_WARN: "w" },
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
            WebStorageStateStore: class { constructor(o) { Object.assign(this, o, emptyStore); } },
            UserManager: class {
                constructor(settings) {
                    this.settings = settings;
                    this.events = { addUserLoaded() {} };
                    this.signinSilent = () => Promise.reject(opts.silentRejection);
                }
                stopSilentRenew() {}
            },
        },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(join(MODULE_DIR, "oidc-auth.js"), "utf8"), sandbox, { filename: "oidc-auth.js" });

    const Client = windowStub.OIDCAuthClient;
    const make = (clientOptions = {}) => new Client(
        { authority: "https://idp.example", client_id: "abc", scope: "openid" },
        { userContextId: "core", ...clientOptions });
    return { make, debugLines, warnLines };
}

const timeout = () => Object.assign(new Error("IFrame timed out"), { name: "ErrorTimeout" });

/** No refresh token → `_silentSignIn` takes the hidden-frame probe. */
function frameRouteClient(make) {
    const client = make();
    client.getRefreshTokenExpiration = async () => null;
    return client;
}

/** A live refresh token → `_silentSignIn` calls the token endpoint. */
function refreshRouteClient(make) {
    const client = make();
    client.getRefreshTokenExpiration = async () => Date.now() / 1000 + 600;
    return client;
}

test("a frame-probe timeout reports no session, not an unreachable authority @unit", async () => {
    const { make } = loadClient({ silentRejection: timeout() });

    // `false` keeps the context in core's interactive phase, so a top-level redirect
    // (or the gate) can still run. `"unknown"` would remove it entirely.
    expect(await frameRouteClient(make).signInSilent()).toBe(false);
});

test("a refresh-grant timeout still reports unknown @unit", async () => {
    const { make } = loadClient({ silentRejection: timeout() });

    // This route is a plain fetch to the token endpoint, so a timeout IS evidence
    // about reachability — and core must not redirect to a host it just failed to
    // reach, which would replace the viewer with the browser's own error page.
    expect(await refreshRouteClient(make).signInSilent()).toBe("unknown");
});

test("the route taken is tagged on the rejection, not inferred later @unit", async () => {
    const rejection = timeout();
    const { make } = loadClient({ silentRejection: rejection });

    await frameRouteClient(make).signInSilent();
    expect(rejection.xopatSilentPath).toBe("frame");
});

test("a non-transient failure is unaffected by the route @unit", async () => {
    const refused = Object.assign(new Error("login_required"), { error: "login_required" });
    const { make } = loadClient({ silentRejection: refused });

    // The authority answered — that is a verdict, not a delivery failure.
    expect(await frameRouteClient(make).signInSilent()).toBe(false);
    expect(await refreshRouteClient(make).signInSilent()).toBe(false);
});

test("the frame-timeout warning names the redirect URI to check @unit", async () => {
    const { make, warnLines } = loadClient({ silentRejection: timeout() });

    await frameRouteClient(make).signInSilent();

    // The provider's own 400 page is unreadable cross-origin, so an unregistered URI
    // looks exactly like a slow frame. Naming it is the whole diagnostic.
    const warning = warnLines.join("\n");
    expect(warning).toContain("https://viewer.example.org/");
    expect(warning).toContain("registered");
});

test("the effective redirect URIs are logged on construction @unit", async () => {
    const { make, debugLines } = loadClient({ silentRejection: timeout() });
    make({ useCallbackPage: true });

    const logged = debugLines.join("\n");
    expect(logged).toContain("silent_redirect_uri=https://viewer.example.org/modules/oidc-client-ts/auth-callback.html");
    expect(logged).toContain("popup_redirect_uri=https://viewer.example.org/modules/oidc-client-ts/auth-callback.html");
    // The full-page flow always stays on the viewer page.
    expect(logged).toContain("redirect_uri=https://viewer.example.org/,");
});
