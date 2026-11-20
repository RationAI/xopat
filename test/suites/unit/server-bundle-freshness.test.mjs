/**
 * The prebuilt server bundles in the working tree must be current AND complete.
 *
 * Both halves matter, for different reasons:
 *
 *  - **Current.** Each bundle is built with `bundle: true`, so it inlines its own
 *    copy of whatever the element depends on. Bundles from two build generations
 *    therefore run two dependency trees side by side, and what surfaces is a
 *    library's own version guard rejecting an object produced by its newer self —
 *    a message that names neither the stale bundle nor the fix.
 *  - **Complete.** A packaged release can never compile: an entry missing from
 *    the build is an RPC answering `RPC_UNKNOWN_METHOD` with the cause in one
 *    log line. The previous build ran only for elements that had a
 *    `package.json`, which silently skipped three modules shipping server code —
 *    this is the assertion that would have caught it.
 *
 * Static only — reads the manifest and `*.meta.json`, no server, no browser.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const loader = require(fromRoot("server", "node", "server-module-loader.js"));
const {
    SERVER_BUILD_DIR, ARTIFACT_EXT, BUILD_FORMAT_VERSION,
    getBuildKey, walkForServerFiles, builtServerPath, isArtifactFresh,
    readServerBuildManifest, fromManifestPath,
} = loader;

/** Every element directory under `modules/` and `plugins/`. */
function elementDirs() {
    const dirs = [];
    for (const kind of ["modules", "plugins"]) {
        const root = fromRoot(kind);
        if (!existsSync(root)) continue;
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (entry.isDirectory()) dirs.push({ kind: kind.slice(0, -1), dir: path.join(root, entry.name) });
        }
    }
    return dirs;
}

/** Entries that are expected to be built, with their artifact path. */
function expectedEntries() {
    const out = [];
    for (const { kind, dir } of elementDirs()) {
        for (const source of walkForServerFiles(dir)) {
            out.push({ kind, id: path.basename(dir), source, artifact: builtServerPath(dir, source) });
        }
    }
    return out;
}

const rel = (p) => path.relative(fromRoot(), p);

test("prebuilt server bundles are current @unit", () => {
    const entries = expectedEntries().filter(e => existsSync(e.artifact));
    test.skip(entries.length === 0, `no ${SERVER_BUILD_DIR} bundles in this tree — nothing to check`);

    const current = getBuildKey();
    const stale = entries
        .filter(e => !isArtifactFresh(e.source, e.artifact, current))
        .map(e => rel(e.artifact));

    expect(
        stale,
        `Stale server bundles. They inline a dependency tree that is no longer the one on disk, `
        + `which is how two library majors end up running at once. Run \`npm run build\` (or `
        + `\`npx grunt serverBuild\`) to rebuild.\ncurrent key: ${current}\n${stale.join("\n")}`,
    ).toEqual([]);
});

test("the server build manifest covers every server entry @unit", () => {
    const manifest = readServerBuildManifest();
    test.skip(!manifest, "no server build manifest — run `npx grunt serverBuild` first");

    expect(manifest.formatVersion, "manifest format version").toBe(BUILD_FORMAT_VERSION);
    expect(manifest.buildKey, "manifest build key is current").toBe(getBuildKey());

    const recorded = new Set();
    for (const element of Object.values(manifest.elements || {})) {
        for (const entry of element.entries || []) recorded.add(path.resolve(fromManifestPath(entry.source)));
    }

    const missing = [];
    for (const entry of expectedEntries()) {
        if (!recorded.has(path.resolve(entry.source))) {
            missing.push(`${rel(entry.source)} — not in the manifest`);
            continue;
        }
        if (!existsSync(entry.artifact)) missing.push(`${rel(entry.artifact)} — recorded but not on disk`);
    }

    expect(
        missing,
        `Server entries the build did not produce. A packaged release cannot compile them later, so each `
        + `one is an RPC that answers RPC_UNKNOWN_METHOD. Run \`npm run build\`.\n${missing.join("\n")}`,
    ).toEqual([]);
});

test("artifacts use the format the loader loads @unit", () => {
    const entries = expectedEntries().filter(e => existsSync(e.artifact));
    test.skip(entries.length === 0, "nothing built in this tree");
    // A bundle whose extension does not match ARTIFACT_EXT is one the loader
    // would reach for with the wrong mechanism (`require` vs `import()`).
    const wrong = entries.filter(e => !e.artifact.endsWith(ARTIFACT_EXT)).map(e => rel(e.artifact));
    expect(wrong, `artifacts not in ${ARTIFACT_EXT} form`).toEqual([]);
});
