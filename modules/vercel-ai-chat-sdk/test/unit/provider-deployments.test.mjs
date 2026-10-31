/**
 * One env, several named deployments — one operator key each.
 *
 * Each deployment has its own `core.server.secure`, so a provider plugin registering its
 * managed provider reads THAT deployment's API key, endpoint and contexts allow-list. The
 * registry used to key the provider type by its id alone and dedup the managed instance by
 * `pluginId:typeId:default`, so whichever deployment registered last overwrote the other's
 * `fixedSecrets`: deployment B ran on deployment A's key, or the reverse.
 *
 * Pinned here: two deployments registering the same plugin provider keep separate records and
 * secrets, and a request under one deployment can neither list nor resolve the other's operator
 * instance — by id, by reference, or by session. The module never names a deployment: core runs
 * it inside the request's scope and `XOPAT_SERVER.state` hands it that deployment's registry.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const serverDir = path.join(fromRoot(), "modules", "vercel-ai-chat-sdk", "server");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-chat-deploy-"));

const outfile = path.join(tmp, "registry.mjs");
await esbuild.build({
    stdin: {
        contents: "export * from './providerRegistration.server.ts';\n" +
            "export { ChatServerRegistry, CHAT_ERR_UNKNOWN_PROVIDER } from './chatRegistry.server.ts';",
        resolveDir: serverDir,
        loader: "ts",
    },
    outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent",
    external: ["ai", "@ai-sdk/*"],
});
const { ensureManagedPluginProvider, ChatServerRegistry, CHAT_ERR_UNKNOWN_PROVIDER } =
    await import(pathToFileURL(outfile).href);

const { runInDeployment, deploymentState } = require(path.join(fromRoot(), "server", "node", "deployment-scope.js"));

const PLUGIN = "chat-openai-compatible";
const TYPE = "openai-compatible";
const MANAGED_KEY = `${PLUGIN}:${TYPE}:default`;

// A fresh owner per test: core's state outlives everything by design.
let run = 0;
const realServer = globalThis.XOPAT_SERVER;
test.beforeEach(() => {
    const owner = `test.${++run}`;
    globalThis.XOPAT_SERVER = { state: (_owner, factory) => deploymentState(owner, factory) };
});
test.afterAll(() => {
    globalThis.XOPAT_SERVER = realServer;
    rmSync(tmp, { recursive: true, force: true });
});

/** What a host does with `getSecurePluginConfig(ctx, pluginId)` — reduced to the values that differ. */
function register({ apiKey, baseUrl }) {
    return ensureManagedPluginProvider({}, {
        pluginId: PLUGIN,
        adapter: { id: "test-adapter", resolveModel: () => ({}) },
        providerType: {
            id: TYPE,
            label: "OpenAI-compatible",
            adapter: "test-adapter",
            configSchema: [{ key: "apiKey", secret: true }],
            fixedConfig: { baseUrl },
            fixedSecrets: { apiKey },
        },
        provider: { typeId: TYPE, label: "Operator provider", config: {}, secrets: {} },
    });
}

const inA = (fn) => runInDeployment("a", fn);
const inB = (fn) => runInDeployment("b", fn);
const registry = () => ChatServerRegistry.instance();
const runtime = (id, ctx = {}) => registry().getProviderRuntime(id, { ctx, userScope: null });
const asA = () => register({ apiKey: "key-a", baseUrl: "https://a.example/v1" });
const asB = () => register({ apiKey: "key-b", baseUrl: "https://b.example/v1" });

test("two deployments registering the same plugin provider keep their own secrets @unit", async () => {
    const base = await register({ apiKey: "key-base", baseUrl: "https://base.example/v1" });
    const a = await inA(asA);
    const b = await inB(asB);
    // Re-registration (every client boot does one) must update in place, not cross over.
    const aAgain = await inA(() => register({ apiKey: "key-a2", baseUrl: "https://a.example/v1" }));

    expect(new Set([base.providerId, a.providerId, b.providerId]).size).toBe(3);
    expect(aAgain.providerId, "dedup stays within the deployment").toBe(a.providerId);
    expect(aAgain.providerCreated).toBe(false);
    // The public identity is unchanged in every deployment: config names it the same way.
    for (const r of [base, a, b]) {
        expect(r.managedKey).toBe(MANAGED_KEY);
        expect(r.providerTypeId).toBe(TYPE);
    }

    expect((await runtime(base.providerId)).secrets.apiKey).toBe("key-base");
    expect((await inA(() => runtime(a.providerId))).secrets.apiKey).toBe("key-a2");
    expect((await inB(() => runtime(b.providerId))).secrets.apiKey).toBe("key-b");
    expect((await inB(() => runtime(b.providerId))).config.baseUrl).toBe("https://b.example/v1");
    expect(runInDeployment("c", () => registry().getProviderType(TYPE)),
        "no fallback to another deployment's type").toBeUndefined();
});

test("a request under one deployment cannot reach another deployment's managed instance @unit", async () => {
    const a = await inA(asA);
    const b = await inB(asB);

    // By id — a client may send any providerId.
    const err = await inB(() => runtime(a.providerId).then(() => null, (e) => e));
    expect(err, "B must not receive A's credentials").not.toBe(null);
    expect(err.code).toBe(CHAT_ERR_UNKNOWN_PROVIDER);
    await expect(runtime(a.providerId)).rejects.toMatchObject({ code: CHAT_ERR_UNKNOWN_PROVIDER });

    // By reference — the same managedKey names each deployment's own instance.
    const viaRef = await inB(() => registry().resolveProviderRuntime(MANAGED_KEY, { ctx: {}, userScope: null }));
    expect(viaRef.instance.id).toBe(b.providerId);
    expect(viaRef.secrets.apiKey).toBe("key-b");
    expect(inA(() => registry().resolveProviderRef(MANAGED_KEY)).id).toBe(a.providerId);
    expect(runInDeployment("c", () => registry().resolveProviderRef(MANAGED_KEY))).toBe(null);

    // By session — a session stamped under A does not re-bind to A's instance from B.
    const session = { providerId: a.providerId, providerTypeId: TYPE, metadata: { providerRef: { managedKey: MANAGED_KEY } } };
    expect(inA(() => registry().resolveSessionProviderId(session))).toBe(a.providerId);
    expect(inB(() => registry().resolveSessionProviderId(session))).toBe(b.providerId);

    // Listing — the picker only ever shows the request's own deployment.
    const listedB = await inB(() => registry().listProviderInstances({ ownerPrincipal: null }));
    expect(listedB.map((p) => p.id)).toEqual([b.providerId]);
    const typesB = inB(() => registry().listProviderTypes());
    expect(typesB).toHaveLength(1);
    expect(typesB[0].fixedSecrets, "the client projection never carries the key").toBeUndefined();
});

test("a user-created instance is confined to the deployment it was created in @unit", async () => {
    await inA(asA);
    await inB(asB);
    const mine = await inA(() => registry().createProviderInstance({ typeId: TYPE, label: "BYOK" }, "user:alice"));
    const ctx = { user: { id: "alice" } };

    expect(mine.config.baseUrl, "binds to its own deployment's type").toBe("https://a.example/v1");
    // Its owner reaches it in A — without the operator key, as before.
    const rt = await inA(() => runtime(mine.id, ctx));
    expect(rt.secrets.apiKey).toBeUndefined();
    // The same owner in B does not: B's endpoint/policy is not the one it was configured against.
    await expect(inB(() => runtime(mine.id, ctx))).rejects.toMatchObject({ code: CHAT_ERR_UNKNOWN_PROVIDER });
});
