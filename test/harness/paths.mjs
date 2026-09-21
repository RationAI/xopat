/**
 * Repo-root anchored paths for the test harness.
 *
 * Everything the harness spawns (`node index.js`, legacy `.mjs` scripts) runs
 * with `cwd = repoRoot`, so paths in manifests and configs stay repo-relative
 * and readable regardless of where the runner was invoked from.
 *
 * The root is *searched for* rather than computed as "two directories up",
 * because this file is reachable by two different paths: directly at
 * `test/harness/paths.mjs`, and through the workspace link at
 * `node_modules/@xopat/test-harness/paths.mjs`. Under `--preserve-symlinks`
 * (which the runner enables when an externally developed element is linked in)
 * the second path is the one Node reports, and counting directories would
 * silently land on `node_modules`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function findRepoRoot(start) {
    let dir = start;
    for (;;) {
        const manifest = path.join(dir, "package.json");
        if (existsSync(manifest)) {
            try {
                const pkg = JSON.parse(readFileSync(manifest, "utf8"));
                // The application manifest, not the harness's own or a vendored one.
                if (pkg.name === "xopat" && existsSync(path.join(dir, "src", "config.json"))) return dir;
            } catch { /* unreadable manifest — keep walking */ }
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error(`[xopat-test] could not locate the repository root above ${start}`);
        }
        dir = parent;
    }
}

/** Absolute path of the xOpat checkout this harness belongs to. */
export const repoRoot = findRepoRoot(import.meta.dirname);

/** Resolve a repo-relative path. */
export const fromRoot = (...parts) => path.resolve(repoRoot, ...parts);
