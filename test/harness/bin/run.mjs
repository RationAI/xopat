#!/usr/bin/env node
/**
 * `npm test` entry point.
 *
 * All it does beyond invoking the runner is decide one thing: whether Node must
 * resolve modules **through** symlinks.
 *
 * An element developed in its own repository is linked into `plugins/` or
 * `modules/` (the mechanism `plugins/README.md` documents, and the one the
 * server's scanner already follows). Node's ESM resolver normally rewrites such
 * a path to its target before resolving that file's imports — so the element's
 * `import "@xopat/test-harness"` starts its `node_modules` walk from wherever
 * the element really lives, outside this repository, and fails. With
 * `--preserve-symlinks` the walk starts at `plugins/<id>/…` and reaches the
 * repository's `node_modules`, where the harness workspace is.
 *
 * The flag has to be present when the *worker* process starts, which rules out
 * setting it from the config (workers load the config themselves, far too
 * late). Hence this wrapper — and hence it is applied only when something is
 * actually linked in, so an ordinary checkout runs with stock resolution.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { discoverElementTests } from "../discover.mjs";
import { repoRoot } from "../paths.mjs";

const require = createRequire(import.meta.url);
const cli = require.resolve("@playwright/test/cli");

const linkedIn = discoverElementTests().filter(element => element.external);
const env = { ...process.env };

if (linkedIn.length) {
    const existing = env.NODE_OPTIONS ?? "";
    if (!existing.includes("--preserve-symlinks")) {
        env.NODE_OPTIONS = `${existing} --preserve-symlinks`.trim();
    }
    const names = linkedIn.map(element => `${element.kind}:${element.id}`).join(", ");
    console.log(`[xopat-test] resolving through links for externally developed elements: ${names}`);
}

const child = spawn(process.execPath, [cli, "test", ...process.argv.slice(2)], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
});
child.on("close", (code, signal) => process.exit(signal ? 1 : code ?? 1));
child.on("error", (error) => {
    console.error(`[xopat-test] could not start the runner: ${error.message}`);
    process.exit(1);
});
