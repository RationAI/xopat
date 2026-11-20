/**
 * The packaged-build load path, exercised without building a binary.
 *
 * A release is a pkg/SEA snapshot: read-only files, no esbuild, and `import()`
 * of a snapshot file throws `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`. So server
 * element code must be loadable with nothing but `require` of a prebuilt bundle
 * named by the manifest — and must never try to compile or write.
 *
 * `XOPAT_PACKAGED=1` makes `constants.PACKAGED` true from a plain `node` run,
 * which is the whole reason that env var is part of the predicate: the alternative
 * is discovering a regression only when a release is cut.
 *
 * Runs in a child process: the assertions are about what that process loaded and
 * wrote, which cannot be observed from inside the test runner's own module graph.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PROBE = `
const root = process.env.XOPAT_PROBE_ROOT;
const loader = require(root + "/server/node/server-module-loader");
const helpers = require(root + "/server/node/server-helpers");
const constants = require(root + "/server/node/constants");
const roles = require(root + "/server/node/roles");
const { XopatServerRuntime } = require(root + "/server/node/server-runtime");

(async () => {
    const out = { packaged: constants.PACKAGED, kind: constants.PACKAGED_KIND };
    const sources = loader.manifestSources();
    out.sources = sources.length;

    const runtime = new XopatServerRuntime({ root, cacheDir: process.env.XOPAT_CACHE_DIR });
    runtime.scan();
    // Element discovery must survive without walking the tree: in a snapshot the
    // manifest is the only reliable list.
    out.elementsWithServerFiles = ["module", "plugin"]
        .flatMap(k => Object.values(runtime.registry[k] || {}))
        .filter(i => (i.files || []).length).length;

    // A TypeScript-authored entry, loaded with no compiler available.
    const ts = sources.find(s => /\\.server\\.ts$/i.test(s));
    out.tsEntry = ts && require("path").basename(ts);
    out.tsExports = ts ? Object.keys(await loader.loadServerModuleFromFile(ts, runtime)).length : 0;

    // The cross-element target four chat hosts resolve: proves tryServerFile
    // answers from the manifest rather than from the (absent) sources.
    out.crossElement = Object.keys(await helpers.importServerModule(
        { kind: "plugin", itemId: "chat-anthropic" }, runtime,
        "module:vercel-ai-chat-sdk/server/providerRegistration.server.ts")).length > 0;

    // Roles resolve from the prebuilt artifact, not an in-memory TS transform.
    out.rolesOk = roles.can({ user: { claims: {} } }, "probe.cap", { CORE: { roles: {} } }).ok;

    // Nothing may have pulled in the compiler.
    out.esbuildLoaded = Object.keys(require.cache).some(k => k.includes("esbuild"));

    // Compiling must be refused outright, not attempted and failed.
    try {
        await loader.compileServerTs(ts, runtime, {});
        out.compileRefused = false;
    } catch (e) {
        out.compileRefused = /packaged build/.test(e.message);
    }
    process.stdout.write(JSON.stringify(out));
})().catch(e => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });
`;

function runProbe(root, cacheDir) {
    const stdout = execFileSync(process.execPath, ["-e", PROBE], {
        env: { ...process.env, XOPAT_PACKAGED: "1", XOPAT_CACHE_DIR: cacheDir, XOPAT_PROBE_ROOT: root },
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(stdout);
}

test("a packaged build loads prebuilt server bundles without a compiler @unit", () => {
    const root = fromRoot();
    test.skip(!existsSync(path.join(root, "server", "node", "server-build-manifest.json")),
        "no server build manifest — run `npx grunt serverBuild` first");

    const cacheDir = mkdtempSync(path.join(tmpdir(), "xopat-packaged-test-"));
    const result = runProbe(root, cacheDir);

    expect(result.packaged, "constants.PACKAGED under XOPAT_PACKAGED=1").toBe(true);
    expect(result.kind).toBe("env");
    expect(result.sources, "manifest records server sources").toBeGreaterThan(0);
    expect(result.elementsWithServerFiles, "elements discovered from the manifest").toBeGreaterThan(0);
    expect(result.tsExports, `${result.tsEntry} loaded from its prebuilt bundle`).toBeGreaterThan(0);
    expect(result.crossElement, "cross-element server import resolves via the manifest").toBe(true);
    expect(result.rolesOk, "roles resolve from the prebuilt resolver").toBe(true);
    // The completeness test for the whole change: if anything on this path still
    // needs esbuild, a release still cannot run element server code.
    expect(result.esbuildLoaded, "esbuild must not be reachable on the packaged path").toBe(false);
    expect(result.compileRefused, "compiling is refused in a packaged build").toBe(true);
});

test("a packaged build writes nothing into the source tree @unit", () => {
    const root = fromRoot();
    const manifest = path.join(root, "server", "node", "server-build-manifest.json");
    test.skip(!existsSync(manifest), "no server build manifest — run `npx grunt serverBuild` first");

    const buildDirs = [];
    for (const kind of ["modules", "plugins"]) {
        const kindRoot = path.join(root, kind);
        if (!existsSync(kindRoot)) continue;
        for (const entry of readdirSync(kindRoot, { withFileTypes: true })) {
            const dir = path.join(kindRoot, entry.name, ".server-dist");
            if (entry.isDirectory() && existsSync(dir)) buildDirs.push(dir);
        }
    }

    const snapshot = () => buildDirs.flatMap(dir => readdirSync(dir, { recursive: true })
        .map(name => path.join(dir, String(name))));

    const before = snapshot();
    runProbe(root, mkdtempSync(path.join(tmpdir(), "xopat-packaged-test-")));
    const after = snapshot();

    // `.lock` / `.tmp-*` are what a build leaves behind; the snapshot is
    // read-only in a real release, so attempting any of it is the bug.
    const added = after.filter(f => !before.includes(f));
    expect(added, `files written under .server-dist by a packaged run:\n${added.join("\n")}`).toEqual([]);
});
