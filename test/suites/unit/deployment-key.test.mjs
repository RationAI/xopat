/**
 * The deployment cache key decides whether browser-local boot state captured
 * under one deployment may be replayed under another.
 *
 * What these vectors pin:
 *  - an operator-pinned `client.cacheKey` wins outright, so a production that
 *    sets one never invalidates its users on an unrelated config edit;
 *  - the derived key changes when — and only when — configuration that decides
 *    whether a session's data references still RESOLVE changes. The previous
 *    implementation fingerprinted `window.ENV` (never assigned) and `ENV.plugins`
 *    (never shipped to the browser), so it was constant: every env file on one
 *    origin shared one cache entry. That is the regression these guard;
 *  - cosmetic config never participates, or every tweak throws the session away.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

const { resolveDeploymentKey, initDeploymentKey, deploymentKey, pluginsCookieKey } =
    await import("../../../src/classes/app/deployment-key.ts");

const baseEnv = () => ({
    name: "xOpat",
    version: "3.1.0",
    active_client: "localhost",
    client: {
        domain: "http://localhost:9000",
        path: "/",
        slide_protocols: { wsi: "`http://localhost:8080/v3/slides/${data}`" },
        default_background_protocol: "wsi",
    },
});

test("an operator-pinned cacheKey wins over the fingerprint @unit", () => {
    const env = baseEnv();
    env.client.cacheKey = "prod-2026";
    expect(resolveDeploymentKey(env)).toBe("prod-2026");

    // ...and stays put when the fingerprinted configuration changes underneath.
    env.client.slide_protocols = { other: "`http://elsewhere/${data}`" };
    expect(resolveDeploymentKey(env)).toBe("prod-2026");
});

test("the deprecated sessionCacheKey spellings still pin @unit", () => {
    const a = baseEnv();
    a.client.sessionCacheKey = "legacy-client";
    expect(resolveDeploymentKey(a)).toBe("legacy-client");

    const b = baseEnv();
    b.setup = { sessionCacheKey: "legacy-setup" };
    expect(resolveDeploymentKey(b)).toBe("legacy-setup");
});

test("a pinned key is storage-safe @unit", () => {
    const env = baseEnv();
    env.client.cacheKey = "prod env/2026 ⚑";
    // It ends up inside a cookie NAME; anything outside the sanitized set would
    // either be dropped by the jar or split the name.
    expect(resolveDeploymentKey(env)).toMatch(/^[A-Za-z0-9._-]+$/);
});

test("slide protocols separate two otherwise identical deployments @unit", () => {
    const a = baseEnv();
    const b = baseEnv();
    b.client.slide_protocols = { dicomweb: "`http://pacs/dicom-web/${data}`" };
    expect(resolveDeploymentKey(a)).not.toBe(resolveDeploymentKey(b));
});

test("the SHIPPED plugin/module registries participate @unit", () => {
    const env = baseEnv();
    const bare = resolveDeploymentKey(env, {}, {});
    const withDicom = resolveDeploymentKey(env, { dicom: {} }, {});
    // A factory protocol such as `dicom` is registered by a plugin, so a session
    // referencing it is invalid where that plugin is not part of the deployment.
    expect(bare).not.toBe(withDicom);

    // `enabled: false` is not shipped, so it must not change the key.
    expect(resolveDeploymentKey(env, { dicom: {}, other: { enabled: false } }, {}))
        .toBe(withDicom);

    // Registry order is irrelevant — the hash is over a stable stringification.
    expect(resolveDeploymentKey(env, { b: {}, a: {} }, {}))
        .toBe(resolveDeploymentKey(env, { a: {}, b: {} }, {}));
});

test("cosmetic configuration does not invalidate a session @unit", () => {
    const a = baseEnv();
    const b = baseEnv();
    b.setup = { theme: "dark", viewport: { zoomLevel: 3, point: { x: 1, y: 2 } } };
    b.client.osdOptions = { animationTime: 2 };
    expect(resolveDeploymentKey(a)).toBe(resolveDeploymentKey(b));
});

test("init publishes the key and names the autoload cookie @unit", () => {
    const key = initDeploymentKey(baseEnv(), { dicom: {} }, {});
    expect(deploymentKey()).toBe(key);
    expect(window.XOPAT_DEPLOYMENT_KEY).toBe(key);
    // Key-in-name: two deployments on one origin keep independent autoload lists
    // instead of overwriting each other's.
    expect(pluginsCookieKey()).toBe(`_plugins.${key}`);
});
