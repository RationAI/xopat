/**
 * Every prebuilt `*.server.ts` bundle in the working tree must have been produced
 * by the CURRENT build key.
 *
 * `server-module-loader.js` bundles each server file with `bundle: true`, so every
 * bundle inlines its own copy of whatever the element depends on. Bundles from two
 * build generations therefore run two dependency trees side by side, and what
 * surfaces is a library's own version guard rejecting an object produced by its
 * newer self — a message that names neither the stale bundle nor the fix. The
 * loader invalidates on the build key, but only for files it actually loads, so a
 * mixed tree can sit on disk unnoticed until a request touches it.
 *
 * Static only — reads `*.meta.json`, no server, no browser, no network.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { SERVER_BUILD_DIR, getBuildKey } = require(fromRoot("server", "node", "server-module-loader.js"));

/** Every `*.mjs.meta.json` under any element's build dir. */
function collectBuildMetas() {
    const metas = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".mjs.meta.json")) metas.push(full);
        }
    };
    for (const kind of ["modules", "plugins"]) {
        const root = fromRoot(kind);
        if (!existsSync(root)) continue;
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const buildDir = path.join(root, entry.name, SERVER_BUILD_DIR);
            if (existsSync(buildDir)) walk(buildDir);
        }
    }
    return metas;
}

test("prebuilt server bundles all come from the current build key @unit", () => {
    const metas = collectBuildMetas();
    test.skip(metas.length === 0, `no ${SERVER_BUILD_DIR} bundles in this tree — nothing to check`);

    const current = getBuildKey();
    const stale = [];
    for (const file of metas) {
        let meta = null;
        try {
            meta = JSON.parse(readFileSync(file, "utf8"));
        } catch {
            stale.push(`${path.relative(fromRoot(), file)} — unreadable meta`);
            continue;
        }
        const rel = path.relative(fromRoot(), file);
        if (meta.buildKey !== current) {
            stale.push(`${rel} — built with '${meta.buildKey}'`);
            continue;
        }
        // The source can also have moved on without the key changing.
        const source = file.replace(/\.meta\.json$/, "").replace(/\.mjs$/, ".ts");
        const sourceFile = source.split(path.sep + SERVER_BUILD_DIR + path.sep).join(path.sep);
        try {
            if (statSync(sourceFile).mtimeMs !== meta.mtimeMs) stale.push(`${rel} — source changed since build`);
        } catch { /* source moved or renamed; the orphan bundle is harmless */ }
    }

    expect(
        stale,
        `Stale server bundles. They inline a dependency tree that is no longer the one on disk, `
        + `which is how two library majors end up running at once. Delete every ${SERVER_BUILD_DIR} `
        + `directory and restart the server to rebuild.\ncurrent key: ${current}\n${stale.join("\n")}`,
    ).toEqual([]);
});
