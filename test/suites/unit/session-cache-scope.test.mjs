/**
 * `xoSessionCache` is the boot session cache — the one storage flow that runs
 * before IO_PIPELINE exists, and therefore the one nothing else can police.
 *
 * Two regressions live here, both of which made the deployment scoping look
 * implemented while doing nothing:
 *  - the key was computed from `window.ENV`, which no renderer assigns, so
 *    every deployment on one origin shared a single cache entry;
 *  - eviction of a FOREIGN entry was folded in with restoring one's own, behind
 *    `setup.bypassCache` — so a deployment that opted out of the cache left the
 *    previous deployment's session sitting in storage, ready to replay the
 *    moment the flag flipped or a different env booted on the same origin.
 *
 * `parse-input.js` is a plain script (it declares a global for `dist/app.js`),
 * so it is evaluated here rather than imported.
 */
import { test, expect } from "@xopat/test-harness";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
    fileURLToPath(new URL("../../../src/parse-input.js", import.meta.url)), "utf8");
const parseConfiguration = new Function(`${SOURCE}; return xOpatParseConfiguration;`)();

globalThis.window = globalThis.window ?? globalThis;

/** Minimal `Storage`, enough for the four calls the cache block makes. */
function makeStore(initial) {
    const map = new Map(initial ? Object.entries(initial) : []);
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
        get size() { return map.size; },
    };
}

const ENV_A = {
    name: "xOpat", version: "3.1.0", active_client: "localhost",
    client: { domain: "http://localhost:9000", path: "/", cacheKey: "env-a" },
};
const envWith = (cacheKey, extra = {}) => ({
    ...ENV_A, client: { ...ENV_A.client, cacheKey }, ...extra,
});

/** A stored entry as the save path writes it. */
const storedSession = (envKey) => JSON.stringify({
    __envKey: envKey,
    visualization: {
        __age: Date.now(),
        params: {}, data: ["slide"], background: [{ dataReference: 0 }], plugins: {},
    },
});

// The shipped resolver, so these vectors exercise the real fingerprint. It is
// installed on `window` explicitly rather than relying on the module's own
// side-effect assignment: unit suites share a worker, so that assignment has
// already happened (or not) depending on which file ran first.
const DEPLOYMENT_KEY = await import("../../../src/classes/app/deployment-key.ts");

const ORIGINAL = {};
test.beforeEach(() => {
    for (const k of ["localStorage", "sessionStorage", "XOpatStorageAvailability",
        "XOpatDeploymentKey", "location", "document"]) {
        ORIGINAL[k] = window[k];
    }
    window.XOpatStorageAvailability = { localStorage: true, sessionStorage: true };
    window.XOpatDeploymentKey = {
        resolve: DEPLOYMENT_KEY.resolveDeploymentKey,
        get: DEPLOYMENT_KEY.deploymentKey,
        init: DEPLOYMENT_KEY.initDeploymentKey,
    };
    window.location = { href: "http://localhost:9000/" };
});
test.afterEach(() => {
    for (const [k, v] of Object.entries(ORIGINAL)) {
        if (v === undefined) delete window[k];
        else window[k] = v;
    }
});

/** What `initXOpat` does before anything reads a persisted cache. */
function withDeploymentKey(ENV) {
    return DEPLOYMENT_KEY.initDeploymentKey(ENV, {}, {});
}

test("a session from another deployment is not restored @unit", () => {
    const foreign = withDeploymentKey(envWith("env-a"));
    window.localStorage = makeStore({ xoSessionCache: storedSession(foreign) });
    window.sessionStorage = makeStore();

    // Same origin, different env file.
    withDeploymentKey(envWith("env-b"));
    const out = parseConfiguration({}, { t: (x) => x }, false, envWith("env-b"));

    expect(out.visualization?.__fromLocalStorage).toBeFalsy();
    // Evicted, not merely ignored — otherwise it costs a read on every boot.
    expect(window.localStorage.size).toBe(0);
});

test("bypassCache does not license a foreign entry to survive @unit", () => {
    const foreign = withDeploymentKey(envWith("env-a"));
    window.localStorage = makeStore({ xoSessionCache: storedSession(foreign) });
    window.sessionStorage = makeStore({ xoSessionCache: storedSession(foreign) });

    const ENV_B = envWith("env-b", { setup: { bypassCache: true } });
    withDeploymentKey(ENV_B);
    parseConfiguration({}, { t: (x) => x }, false, ENV_B);

    // The flag says "do not use MY cache". It never said another deployment's
    // session may wait here until the flag flips.
    expect(window.localStorage.size).toBe(0);
    expect(window.sessionStorage.size).toBe(0);
});

test("a foreign entry is dropped even when this boot brought its own session @unit", () => {
    const foreign = withDeploymentKey(envWith("env-a"));
    window.localStorage = makeStore({ xoSessionCache: storedSession(foreign) });
    window.sessionStorage = makeStore();

    const ENV_B = envWith("env-b");
    const key = withDeploymentKey(ENV_B);
    const post = { visualization: { params: {}, data: ["s"], background: [{ dataReference: 0 }] } };
    parseConfiguration(post, { t: (x) => x }, false, ENV_B);

    // Rewritten under THIS deployment's key, not left carrying the old one.
    const stored = JSON.parse(window.localStorage.getItem("xoSessionCache"));
    expect(stored.__envKey).toBe(key);
});

test("this deployment's own session still restores @unit", () => {
    const ENV = envWith("env-a");
    const key = withDeploymentKey(ENV);
    window.localStorage = makeStore({ xoSessionCache: storedSession(key) });
    window.sessionStorage = makeStore();

    const out = parseConfiguration({}, { t: (x) => x }, false, ENV);
    expect(out.visualization?.__fromLocalStorage).toBe(true);
    expect(window.localStorage.size).toBe(1);
});

// ── the stamp carried by the session itself ────────────────────────────────
//
// The address-bar hash and a re-submitted POST body live in the history entry,
// so they outlive an ENV swap, a server restart and any cache eviction — and
// they are read BEFORE the boot cache. `serializeAppConfig` stamps `__envKey`
// on everything this viewer serializes so those transports can be judged too.

/** A session as `serializeAppConfig` emits it. */
const authoredSession = (envKey) => ({
    __envKey: envKey,
    params: {}, data: ["slide"], background: [{ dataReference: 0 }], plugins: {},
});

test("a session stamped by another deployment loads, but is never cached @unit", () => {
    const foreign = withDeploymentKey(envWith("env-a"));
    window.localStorage = makeStore({ xoSessionCache: storedSession(foreign) });
    window.sessionStorage = makeStore();

    const ENV_B = envWith("env-b");
    withDeploymentKey(ENV_B);
    const out = parseConfiguration(
        { visualization: authoredSession(foreign) }, { t: (x) => x }, false, ENV_B);

    // Loaded — deployments that differ only cosmetically fingerprint alike, so
    // refusing outright would break a genuinely shared link.
    expect(out.visualization?.data).toEqual(["slide"]);
    expect(out.visualization?.__foreignDeployment).toBe(true);
    // ...but NOT written back. Persisting it is the laundering step: it would be
    // stamped with env-b's key and restored legitimately on every later boot.
    expect(window.localStorage.size).toBe(0);
    expect(window.sessionStorage.size).toBe(0);
});

test("an unstamped session is accepted and cached — embedder back-compat @unit", () => {
    const ENV = envWith("env-a");
    const key = withDeploymentKey(ENV);
    window.localStorage = makeStore();
    window.sessionStorage = makeStore();

    // What a third-party embedding app, a demo link or a test POSTs: no stamp,
    // because `serializeAppConfig` never touched it.
    const post = { visualization: { params: {}, data: ["s"], background: [{ dataReference: 0 }] } };
    const out = parseConfiguration(post, { t: (x) => x }, false, ENV);

    expect(out.visualization?.__foreignDeployment).toBeFalsy();
    expect(JSON.parse(window.localStorage.getItem("xoSessionCache")).__envKey).toBe(key);
});

test("a session stamped by THIS deployment is cached as usual @unit", () => {
    const ENV = envWith("env-a");
    const key = withDeploymentKey(ENV);
    window.localStorage = makeStore();
    window.sessionStorage = makeStore();

    const out = parseConfiguration(
        { visualization: authoredSession(key) }, { t: (x) => x }, false, ENV);

    expect(out.visualization?.__foreignDeployment).toBeFalsy();
    expect(window.localStorage.size).toBe(1);
});

test("no deployment key available degrades CLOSED @unit", () => {
    // The module failed to load. Before, `envKey` was "" and an entry stamped ""
    // matched it — every deployment sharing one cache again, silently.
    window.XOpatDeploymentKey = undefined;
    window.localStorage = makeStore({ xoSessionCache: storedSession("") });
    window.sessionStorage = makeStore();

    const ENV = envWith("env-a");
    const out = parseConfiguration({}, { t: (x) => x }, false, ENV);
    expect(out.visualization?.__fromLocalStorage).toBeFalsy();

    // And nothing is written under a key we cannot compute.
    window.localStorage = makeStore();
    const post = { visualization: { params: {}, data: ["s"], background: [{ dataReference: 0 }] } };
    parseConfiguration(post, { t: (x) => x }, false, ENV);
    expect(window.localStorage.size).toBe(0);
});

test("bypassCacheLoadTime suppresses the cold restore only @unit", () => {
    const ENV = envWith("env-a", { setup: { bypassCacheLoadTime: true } });
    const key = withDeploymentKey(ENV);
    window.localStorage = makeStore({ xoSessionCache: storedSession(key) });
    window.sessionStorage = makeStore();

    // Cold load: its own key matches, and it is still not adopted.
    const cold = parseConfiguration({}, { t: (x) => x }, false, ENV);
    expect(cold.visualization?.__fromLocalStorage).toBeFalsy();

    // A boot that arrives WITH a session still saves — "load time" means the
    // cold path only, so an auth-redirect round trip keeps its context.
    window.localStorage = makeStore();
    const post = { visualization: { params: {}, data: ["s"], background: [{ dataReference: 0 }] } };
    parseConfiguration(post, { t: (x) => x }, false, ENV);
    expect(window.localStorage.size).toBe(1);
});
