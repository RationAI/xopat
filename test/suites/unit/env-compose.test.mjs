/**
 * The ENV composer turns a list of layers into one deployment configuration.
 *
 * What these vectors pin:
 *  - the merge matches the server's (`objectMergeRecursiveDistinct`): deep for
 *    objects, wholesale replacement for arrays. A composer that unioned arrays
 *    would produce a config the server never sees;
 *  - conflicts are DETECTED rather than resolved. Silent last-wins is what made
 *    the pre-composition `env/` directory untrustworthy — 35 near-identical
 *    files with nothing recording which lines differed;
 *  - `role: "base"` and explicit overrides are exempt, or every fragment
 *    stacking on `base/core` would be a conflict and the mechanism unusable;
 *  - `<% VAR %>` placeholders survive composition untouched. The composed
 *    artifact must stay secret-free: the server substitutes at read time;
 *  - the fragment library still reproduces `env/env.default.json` exactly, so
 *    splitting the shipped deployment into layers lost nothing.
 */
import { test, expect } from "@xopat/test-harness";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const composer = await import(
    path.resolve(here, "../../../server/utils/node/env-compose.mjs").replace(/\\/g, "/"));

const {
    mergeDeep, composeEnv, composeLayers, readJsonc, loadEnvFile,
    collectPlaceholders, scanForLiteralSecrets, listFragments, loadPresets,
} = composer;

const layer = (id, data, extra = {}) =>
    ({ id, kind: "fragment", file: `env/parts/${id}.json`, role: "layer", dimension: null, meta: {}, data, ...extra });

const sorted = (v) => Array.isArray(v) ? v.map(sorted)
    : (v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);

/* ------------------------------------------------------------------- merge */

test("merge is deep for objects and wholesale for arrays @unit", () => {
    const merged = mergeDeep(
        { a: { keep: 1, replace: 2 }, list: [1, 2, 3] },
        { a: { replace: 9, add: 3 }, list: [7] });
    expect(merged).toEqual({ a: { keep: 1, replace: 9, add: 3 }, list: [7] });
});

test("merge never aliases or mutates its inputs @unit", () => {
    const base = { nested: { deep: { value: 1 } } };
    const merged = mergeDeep(base, { other: true });
    merged.nested.deep.value = 2;
    expect(base.nested.deep.value).toBe(1);
});

/* --------------------------------------------------------------- conflicts */

test("two peers writing the same leaf differently is a conflict @unit", () => {
    const { conflicts } = composeLayers([
        layer("data/a", { core: { client: { localhost: { default_background_protocol: "wsi_service" } } } }),
        layer("data/b", { core: { client: { localhost: { default_background_protocol: "tiff" } } } }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("differing-leaf");
    expect(conflicts[0].path).toBe("core.client.localhost.default_background_protocol");
    expect(conflicts[0].parties.map((p) => p.layer)).toEqual(["data/a", "data/b"]);
});

test("restating the same value is not a conflict @unit", () => {
    const { conflicts } = composeLayers([
        layer("a", { core: { active_client: "localhost" } }),
        layer("b", { core: { active_client: "localhost" } }),
    ]);
    expect(conflicts).toEqual([]);
});

test("arrays are reported even though the merge would silently replace them @unit", () => {
    const { conflicts, env } = composeLayers([
        layer("a", { core: { roles: { default: ["guest"] } } }),
        layer("b", { core: { roles: { default: ["viewer"] } } }),
    ]);
    expect(conflicts[0].kind).toBe("array-replacement");
    // Still merged last-wins, so --force has something to hand back.
    expect(env.core.roles.default).toEqual(["viewer"]);
});

test("a base layer exists to be overridden, so overriding it is not a conflict @unit", () => {
    const { conflicts } = composeLayers([
        layer("base/core", { core: { client: { localhost: { secureMode: false } } } }, { role: "base" }),
        layer("flags/secure-mode", { core: { client: { localhost: { secureMode: true } } } }),
    ]);
    expect(conflicts).toEqual([]);
});

test("an explicit override is always the last word @unit", () => {
    const { conflicts, env } = composeLayers([
        layer("a", { core: { client: { localhost: { production: false } } } }),
        layer("--set", { core: { client: { localhost: { production: true } } } }, { role: "override" }),
    ]);
    expect(conflicts).toEqual([]);
    expect(env.core.client.localhost.production).toBe(true);
});

test("two fragments in one dimension conflict even with no overlapping keys @unit", () => {
    const { conflicts } = composeLayers([
        layer("auth/saml", { modules: { "saml-auth": { enabled: true } } }, { dimension: "auth" }),
        layer("auth/oidc", { modules: { "oidc-client-ts": { enabled: true } } }, { dimension: "auth" }),
    ]);
    expect(conflicts.map((c) => c.kind)).toContain("dimension");
});

test("a leaf overwritten by a subtree, and vice versa, are both reported @unit", () => {
    const objectOverLeaf = composeLayers([
        layer("a", { plugins: { dicom: true } }),
        layer("b", { plugins: { dicom: { enabled: true } } }),
    ]);
    expect(objectOverLeaf.conflicts[0].kind).toBe("object-over-leaf");

    const leafOverSubtree = composeLayers([
        layer("a", { plugins: { dicom: { enabled: true } } }),
        layer("b", { plugins: { dicom: false } }),
    ]);
    expect(leafOverSubtree.conflicts[0].kind).toBe("leaf-over-subtree");
});

test("provenance names the layer that won every leaf @unit", () => {
    const { provenance } = composeLayers([
        layer("base", { core: { a: 1, b: 2 } }, { role: "base" }),
        layer("over", { core: { b: 3 } }),
    ]);
    expect(provenance["core.a"]).toBe("base");
    expect(provenance["core.b"]).toBe("over");
});

/* ------------------------------------------------------------ placeholders */

test("placeholders are collected, never substituted @unit", () => {
    const env = { a: "<% ANTHROPIC_API_KEY %>", b: "port <% WSI_PORT:-8080 %>" };
    const found = collectPlaceholders(env);
    expect(found.get("ANTHROPIC_API_KEY").hasDefault).toBe(false);
    expect(found.get("WSI_PORT").hasDefault).toBe(true);
    // The composer must not resolve them: the artifact stays secret-free and
    // the server (and the PHP backend) own substitution.
    expect(mergeDeep({}, env).a).toBe("<% ANTHROPIC_API_KEY %>");
});

test("literal credentials are detected, placeholders are not @unit", () => {
    const hits = scanForLiteralSecrets({
        real: { apiKey: "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA" },
        templated: { apiKey: "<% ANTHROPIC_API_KEY %>" },
        proxy: { headers: { Authorization: "Bearer <% GITHUB_TOKEN %>" } },
    });
    expect(hits.map((h) => h.path)).toEqual(["real.apiKey"]);
});

/* ---------------------------------------------------- the shipped library */

test("base/core + data/wsi-service reproduces env/env.default.json exactly @unit", () => {
    const composed = composeEnv(["base/core", "data/wsi-service"], {}).env;
    expect(sorted(composed)).toEqual(sorted(readJsonc("env/env.default.json")));
});

test("every shipped preset composes without conflicts @unit", () => {
    for (const name of Object.keys(loadPresets())) {
        const { conflicts } = composeEnv([name], {});
        expect(conflicts, `preset "${name}"`).toEqual([]);
    }
});

test("no tracked fragment carries a literal credential @unit", () => {
    for (const fragment of listFragments()) {
        expect(scanForLiteralSecrets(readJsonc(fragment.file)), fragment.id).toEqual([]);
    }
});

test("an unknown selector fails loudly instead of composing nothing @unit", () => {
    expect(() => composeEnv(["data/no-such-source"], {})).toThrow(/unknown selector/);
});

/* --------------------------------------------------------- $base back-compat */

test("a string $base still resolves, and the key never reaches the ENV @unit", () => {
    const env = loadEnvFile("test/env/secure.json");
    expect(env.$base).toBeUndefined();
    // The patch applied...
    expect(env.core.client.localhost.secureMode).toBe(true);
    // ...on top of everything the base contributed.
    expect(env.core.active_client).toBe("localhost");
    expect(env.plugins["slide-info"]).toBeTruthy();
});

test("an array $base composes several layers, and the twins differ by one @unit", () => {
    const saml = readJsonc("test/env/saml.json").$base;
    const oidc = readJsonc("test/env/oidc.json").$base;
    expect(Array.isArray(saml) && Array.isArray(oidc)).toBe(true);
    const differing = saml.filter((s) => !oidc.includes(s));
    expect(differing).toEqual(["auth/keycloak-saml"]);

    // ...and the role rules they share are one object, not two copies.
    const a = loadEnvFile("test/env/saml.json").core.roles;
    const b = loadEnvFile("test/env/oidc.json").core.roles;
    expect(a).toEqual(b);
});

test("a missing ENV file still yields an empty object @unit", () => {
    expect(loadEnvFile("env/does-not-exist.json")).toEqual({});
});
