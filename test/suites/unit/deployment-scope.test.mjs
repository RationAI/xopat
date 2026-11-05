/**
 * One process serves every named deployment of an env, each with its own
 * `core.server.secure`. Isolation between them is core's job: an element uses
 * `XOPAT_SERVER.state`, `storage`, `cache` and `getStatic*Config` and never names a
 * deployment. Handles are usually opened at module load, with no request in scope,
 * so the running deployment has to be resolved per access.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const core = (file) => require(path.join(fromRoot(), "server", "node", file));
const {
    currentDeployment, runInDeployment, setDefaultDeployment, deploymentState, partitionStorage, partitionCache,
} = core("deployment-scope.js");
const { createServerStorage } = core("storage/index.js");
const { createBoundedCache } = core("storage/bounded-cache.js");

const tmp = mkdtempSync(path.join(tmpdir(), "xopat-deployment-scope-"));
test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const cache = () => partitionCache({ create: createBoundedCache });

test("the scope follows async work and generators, and defaults outside a request @unit", async () => {
    setDefaultDeployment("base");
    expect(currentDeployment()).toBe("base");
    const seen = await runInDeployment("a", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        async function* stream() {
            await Promise.resolve();
            yield currentDeployment();
        }
        const out = [currentDeployment()];
        for await (const value of stream()) out.push(value);
        return out;
    });
    expect(seen).toEqual(["a", "a"]);
    expect(currentDeployment()).toBe("base");

    setDefaultDeployment("named-default");
    expect(currentDeployment()).toBe("named-default");
    expect(runInDeployment(undefined, currentDeployment)).toBe("named-default");
    setDefaultDeployment("base");
});

test("state() gives each deployment its own object, made once @unit", () => {
    let made = 0;
    const factory = () => ({ n: ++made });
    const owner = `test.${Date.now()}`;
    const a = runInDeployment("a", () => deploymentState(owner, factory));
    const b = runInDeployment("b", () => deploymentState(owner, factory));
    expect(a).not.toBe(b);
    expect(runInDeployment("a", () => deploymentState(owner, factory))).toBe(a);
    expect(made).toBe(2);
});

test("a cache opened with no request in scope isolates per access @unit", () => {
    const shared = cache().create({ name: "test:partition", maxEntries: 2, sweepIntervalMs: 0 });
    runInDeployment("a", () => shared.set("k", "from-a"));
    expect(runInDeployment("b", () => shared.get("k"))).toBeUndefined();
    expect(runInDeployment("a", () => shared.get("k"))).toBe("from-a");
    expect(shared.get("k"), "base is a deployment like any other").toBeUndefined();

    // The bound is per deployment: B cannot evict A.
    runInDeployment("b", () => { shared.set("1", 1); shared.set("2", 2); shared.set("3", 3); });
    expect(runInDeployment("a", () => shared.get("k"))).toBe("from-a");
    expect(runInDeployment("a", () => [...shared.keys()])).toEqual(["k"]);
    expect(runInDeployment("b", () => shared.size)).toBe(2);
});

test("crossDeployment keeps login state one cache @unit", () => {
    const replayGuard = cache().create({ name: "test:cross", maxEntries: 8, crossDeployment: true, sweepIntervalMs: 0 });
    runInDeployment("a", () => replayGuard.set("assertion", 1));
    expect(runInDeployment("b", () => replayGuard.get("assertion"))).toBe(1);
});

test("storage isolates per deployment and base keeps its physical namespace @unit", async () => {
    const root = path.join(tmp, "storage");
    const broker = createServerStorage({ cacheDir: root, getConfig: () => ({ bindings: { "test:*": { drivers: ["file"] } } }) });
    const storage = partitionStorage(broker);
    const kv = storage.kv("test", "records", { defaultBindings: ["file"] });

    await runInDeployment("a", () => kv.set("k", "from-a"));
    await runInDeployment("base", () => kv.set("k", "from-base"));
    expect(await runInDeployment("b", () => kv.get("k"))).toBe(null);
    expect(await runInDeployment("a", () => kv.get("k"))).toBe("from-a");
    expect(await runInDeployment("base", () => kv.get("k"))).toBe("from-base");

    const scoped = kv.scoped("user-1");
    await runInDeployment("a", () => scoped.set("k", "mine"));
    expect(await runInDeployment("b", () => scoped.get("k"))).toBe(null);
    expect(await runInDeployment("a", () => scoped.get("k"))).toBe("mine");

    const owners = readdirSync(root, { recursive: true }).map(String).join("|").replace(/\\/g, "/");
    expect(owners).toContain("test/records/");
    expect(owners).toContain("test/records.dp-a/");
});
