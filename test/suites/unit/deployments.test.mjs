/**
 * Named deployments: one ENV, several operator-defined configurations, the
 * (untrusted) session names which one is served.
 *
 * What these vectors pin:
 *  - the fallback chain — requested → defaultDeployment → base — never fails a
 *    load, whatever the request names;
 *  - the session only ever selects; it cannot reach keys a deployment may not
 *    carry (boot-only `core.server.*`), and `base` is not selectable by name;
 *  - getCore serves the merged result and a client-visible echo of what was
 *    asked, which is what stops the client's re-POST from looping;
 *  - the composer expands `$layers` and refuses what the server would ignore.
 */
import { test, expect } from "@xopat/test-harness";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require_ = createRequire(import.meta.url);
const { resolveDeployment, listDeploymentProblems, listAuthContextConflicts,
    selectBoundDeployment, bindSessionDeployment, sanitizeOverlay } =
    require_(path.join(REPO, "server/templates/javascript/deployments.js"));
const { getCore, deploymentDefsOf } = require_(path.join(REPO, "server/templates/javascript/core.js"));
const { composeDeployments } = await import("../../../server/utils/node/env-compose.mjs");

globalThis.window = globalThis.window ?? globalThis;
const { resolveDeploymentKey } = await import("../../../src/classes/app/deployment-key.ts");

const ENV = () => ({
    core: {
        active_client: "main",
        client: {
            main: { domain: "http://localhost:9000/", path: "/", default_background_protocol: "wsi" },
            dicom: { domain: "http://localhost:9000/", path: "/", default_background_protocol: "dicom" },
        },
        setup: { theme: "auto" },
    },
    defaultDeployment: "standalone",
    deployments: {
        standalone: { core: { setup: { theme: "light" } } },
        dicom: {
            $meta: { description: "DICOMweb backend" },
            core: { active_client: "dicom", server: { secure: { modules: { m: { key: "k" } } } } },
        },
    },
});

test("a defined name is served @unit", () => {
    const r = resolveDeployment(ENV(), "dicom");
    expect(r).toMatchObject({ id: "dicom", requested: "dicom", fellBack: false });
});

test("no name serves the default without flagging a fallback @unit", () => {
    expect(resolveDeployment(ENV(), undefined)).toMatchObject({ id: "standalone", requested: null, fellBack: false });
});

test("unknown, malformed and 'base' names fall back to the default @unit", () => {
    for (const name of ["nope", "../etc", "DICOM", "base", "x".repeat(200), "<script>"]) {
        const r = resolveDeployment(ENV(), name);
        expect(r.id).toBe("standalone");
        expect(r.fellBack).toBe(true);
        expect(r.requested.length).toBeLessThanOrEqual(64);
    }
    expect(resolveDeployment(ENV(), 42).requested).toBeNull();
});

test("a broken defaultDeployment degrades to the base ENV and is reported @unit", () => {
    const env = ENV();
    env.defaultDeployment = "missing";
    expect(resolveDeployment(env, null).id).toBe("base");
    expect(listDeploymentProblems(env).join("\n")).toMatch(/defaultDeployment 'missing'/);
});

test("an env without deployments serves the base @unit", () => {
    expect(resolveDeployment({ core: {} }, "dicom")).toMatchObject({ id: "base", fellBack: true });
});

test("boot-only server keys and foreign roots are stripped from an overlay @unit", () => {
    const env = ENV();
    env.deployments.dicom.core.server.logging = { level: "trace" };
    env.deployments.dicom.extra = {};
    const r = resolveDeployment(env, "dicom");
    expect(r.overlay.core.server).toEqual({ secure: { modules: { m: { key: "k" } } } });
    expect(r.overlay.extra).toBeUndefined();
    expect(r.overlay.$meta).toBeUndefined();
    expect(r.problems.join("\n")).toMatch(/core\.server\.logging/);
    expect(listDeploymentProblems(env).length).toBe(2);
});

function core(env, requested) {
    return getCore(REPO + "/", "/", fs.existsSync,
        (p) => fs.readFileSync(p, "utf8"),
        (key) => (key === "XOPAT_ENV" ? JSON.stringify(env) : undefined),
        true, { version: "test", deployment: requested });
}

test("getCore merges the served deployment and ships only the echo @unit", () => {
    const dicom = core(ENV(), "dicom");
    expect(dicom.CORE.client.default_background_protocol).toBe("dicom");
    expect(dicom.CORE.deployment).toEqual({ id: "dicom", requested: "dicom", fellBack: false });
    // Per-deployment secrets reach the server-only copy, never the page payload.
    expect(dicom.CORE_SECURE.modules.m.key).toBe("k");
    expect(dicom.CORE.server.secure).toBeUndefined();
    expect(JSON.stringify(dicom.CORE)).not.toMatch(/"deployments"/);

    const fallback = core(ENV(), "nope");
    expect(fallback.CORE.client.default_background_protocol).toBe("wsi");
    expect(fallback.CORE.setup.theme).toBe("light");
    expect(fallback.CORE.deployment).toEqual({ id: "standalone", requested: "nope", fellBack: true });
});

test("boot judges auth contexts against the pre-overlay base, not the default's view @unit", () => {
    // Base = IdP Y; the default deployment 'a' overrides to X; 'b' inherits Y at
    // runtime. The served core's ENV already carries 'a', so checking against it
    // would see X everywhere and boot a split identity provider.
    const env = ENV();
    env.core.server = { auth: { jwt: { issuer: "https://y" } } };
    env.defaultDeployment = "a";
    env.deployments = { a: { core: { server: { auth: { jwt: { issuer: "https://x" } } } } }, b: { core: {} } };
    const c = core(env, null);
    const defs = deploymentDefsOf(c);
    expect(defs.baseServer).toEqual({ auth: { jwt: { issuer: "https://y" } } });
    const merged = { core: { server: c.CORE_AUTH ? { auth: c.CORE_AUTH } : {} }, ...defs };
    expect(listAuthContextConflicts(merged)).toEqual([]);   // the bug: hidden
    const checked = { core: { server: defs.baseServer }, deployments: defs.deployments, defaultDeployment: defs.defaultDeployment };
    expect(listAuthContextConflicts(checked).length).toBe(1);
});

test("the deployment key separates named deployments, base keys are unchanged @unit", () => {
    const env = { client: { domain: "http://x/", path: "/" } };
    const base = resolveDeploymentKey(env);
    expect(resolveDeploymentKey({ ...env, deployment: { id: "base" } })).toBe(base);
    const a = resolveDeploymentKey({ ...env, deployment: { id: "dicom" } });
    expect(a).not.toBe(base);
    // Cookie-token safe; `~` only ever comes from the deployment suffix.
    expect(a).toMatch(/^[A-Za-z0-9._~-]+$/);
    // A pinned key still separates them.
    const pinned = { client: { ...env.client, cacheKey: "prod" } };
    expect(resolveDeploymentKey({ ...pinned, deployment: { id: "dicom" } })).toBe("prod~dp-dicom");
});

test("@security a pinned key cannot spell another deployment's key @unit", () => {
    const env = { client: { domain: "http://x/", path: "/" } };
    const spoof = resolveDeploymentKey({ client: { ...env.client, cacheKey: "x~dp-a" } });
    const real = resolveDeploymentKey({ client: { ...env.client, cacheKey: "x" }, deployment: { id: "a" } });
    expect(spoof).not.toBe(real);
});

test("@security a session is confined to the deployments it entered @unit", () => {
    const ENV = { deployments: { a: { core: {} }, b: { core: {} } }, defaultDeployment: "a" };
    // Naming one the session never entered is refused, whatever the session holds.
    expect(selectBoundDeployment(ENV, "b", ["a"]).ok).toBe(false);
    expect(selectBoundDeployment(ENV, "b", undefined).ok).toBe(false);
    // Entered: allowed.
    expect(selectBoundDeployment(ENV, "b", ["a", "b"])).toEqual({ ok: true, requested: "b", id: "b" });
    // An unknown name resolves to the default and is judged as the default.
    expect(selectBoundDeployment(ENV, "nope", ["a"]).ok).toBe(true);
    expect(selectBoundDeployment(ENV, "nope", ["b"]).ok).toBe(false);
    // No name (an OAuth callback): the most recently entered one.
    expect(selectBoundDeployment(ENV, null, ["a", "b"])).toEqual({ ok: true, requested: "b", id: "b" });
    expect(selectBoundDeployment(ENV, null, []).id).toBe("a");
    // A deployment removed from the env is skipped, not resolved to the default.
    expect(selectBoundDeployment(ENV, null, ["b", "gone"])).toEqual({ ok: true, requested: "b", id: "b" });
    expect(selectBoundDeployment(ENV, null, ["gone"]).id).toBe("a");
    // Without named deployments there is nothing to bind.
    expect(selectBoundDeployment({}, "b", []).ok).toBe(true);
});

test("binding a session records each deployment once, most recent last @unit", () => {
    const session = {};
    expect(bindSessionDeployment(session, "a")).toBe(true);
    expect(bindSessionDeployment(session, "b")).toBe(true);
    expect(bindSessionDeployment(session, "b")).toBe(false);
    expect(bindSessionDeployment(session, "a")).toBe(true);
    expect(session.deployments).toEqual(["b", "a"]);
});

test("@security an overlay cannot carry boot-only secure config @unit", () => {
    const { overlay, problems } = sanitizeOverlay("x", {
        core: { server: { secure: { storage: { a: 1 }, proxies: { p: {} } } } },
    });
    expect(overlay.core.server.secure).toEqual({ proxies: { p: {} } });
    expect(problems.length).toBe(1);
});

test("@security plugin login contexts take part in the one-IdP check @unit", () => {
    const ENV = {
        core: { server: { secure: { plugins: { p: { contexts: { c: { issuer: "A" } } } } } } },
        deployments: { b: { core: { server: { secure: { plugins: { p: { contexts: { c: { issuer: "B" } } } } } } } } },
    };
    expect(listAuthContextConflicts(ENV).length).toBe(1);
});

test("the composer expands $layers into a deployment and keeps inline keys on top @unit", () => {
    const env = {
        core: {},
        deployments: {
            synth: { $layers: ["data/synthetic-dzi"], core: { setup: { theme: "dark" } } },
        },
    };
    const { conflicts } = composeDeployments(env);
    expect(conflicts).toEqual([]);
    expect(env.deployments.synth.$layers).toBeUndefined();
    expect(env.deployments.synth.core.setup.theme).toBe("dark");
    expect(Object.keys(env.deployments.synth.core).length).toBeGreaterThan(1);
    // Boot-only server config the fragment needs (its static roots) is
    // process-wide: hoisted to the base, not left where the server ignores it.
    expect(env.deployments.synth.core.server?.staticRoots).toBeUndefined();
    expect(env.core.server.staticRoots.length).toBeGreaterThan(0);
});

test("hoisted boot config that disagrees with the base is a conflict @unit", () => {
    const env = {
        core: { server: { staticRoots: ["a/"], compression: false } },
        deployments: { synth: { $layers: ["data/synthetic-dzi"] } },
    };
    env.deployments.synth.$layers = ["data/synthetic-dzi"];
    const { conflicts } = composeDeployments(env);
    // Arrays union rather than conflict.
    expect(env.core.server.staticRoots[0]).toBe("a/");
    expect(env.core.server.staticRoots.length).toBeGreaterThan(1);
    expect(conflicts.filter((c) => /staticRoots/.test(c.message))).toEqual([]);
});

test("the composer refuses what the server would ignore @unit", () => {
    const env = { core: {}, defaultDeployment: "ghost", deployments: { a: { core: { server: { staticRoots: [] } } } } };
    const kinds = composeDeployments(env).conflicts.map((c) => c.kind);
    expect(kinds).toEqual(["deployment", "deployment"]);
});

test("server.auth may vary per deployment @unit", () => {
    const env = ENV();
    env.deployments.dicom.core.server.auth = { jwt: { secretEnv: "DICOM_JWT" } };
    const r = resolveDeployment(env, "dicom");
    expect(r.overlay.core.server.auth).toEqual({ jwt: { secretEnv: "DICOM_JWT" } });
    expect(r.problems).toEqual([]);
});

test("@security one auth context id must mean one identity provider in every deployment @unit", () => {
    const env = ENV();
    env.core.server = { secure: { rpcVerifiers: { lab: { type: "oidc", issuer: "https://a" } } } };
    // Same id, same config (inherited from the base or restated): single sign-on, fine.
    env.deployments.standalone.core.server = { secure: { rpcVerifiers: { lab: { type: "oidc", issuer: "https://a" } } } };
    expect(listAuthContextConflicts(env)).toEqual([]);

    // Same id, other IdP: login state is shared per context id — refused.
    env.deployments.dicom.core.server.secure.rpcVerifiers = { lab: { type: "oidc", issuer: "https://b" } };
    expect(listAuthContextConflicts(env).join("\n")).toMatch(/'lab'.*'base' and 'dicom'/s);

    // Separate logins: separate ids.
    env.deployments.dicom.core.server.secure.rpcVerifiers = { "dicom-lab": { type: "oidc", issuer: "https://b" } };
    expect(listAuthContextConflicts(env)).toEqual([]);

    // Main-context spellings are one context; server.auth is part of its identity.
    env.core.server.secure.rpcVerifiers = { core: { type: "jwt" } };
    env.deployments.dicom.core.server.auth = { jwt: { secretEnv: "OTHER" } };
    expect(listAuthContextConflicts(env).length).toBe(1);

    // Module login brokers (secure.modules.<m>.contexts) are checked too.
    const m = { core: { server: { secure: { modules: { "oidc-server-ts": { contexts: { x: { clientId: "a" } } } } } } },
        deployments: { b: { core: { server: { secure: { modules: { "oidc-server-ts": { contexts: { x: { clientId: "b" } } } } } } } } } };
    expect(listAuthContextConflicts(m).join("\n")).toMatch(/oidc-server-ts/);
    expect(listDeploymentProblems(m).length).toBe(1);
});
