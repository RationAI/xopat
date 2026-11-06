/**
 * Refuse to run a browser test against a stale client bundle.
 *
 * The harness serves whatever is compiled into `src/dist` and `ui/index.js`; it
 * does not build (the dev watcher does, `npm run dev`). With the watcher down, a
 * source edit is invisible to every browser project, and the result reads as a
 * regression: `visualization-layer-edit` failed for a week against a bundle that
 * predated the commit that introduced it, and was blamed on a library update.
 *
 * Compares the newest source file of each bundle with the bundle itself. Checked
 * once per worker, only when a test asks for a browser page. Set
 * `XOPAT_TEST_ALLOW_STALE_BUNDLE=1` to run anyway (e.g. bisecting old bundles).
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.mjs";

/** Newer-by tolerance: a watcher writes the bundle a moment after the save. */
const SLACK_MS = 2000;

const BUNDLES = [
    {
        name: "core (src/dist)",
        outputs: ["src/dist/app.js", "src/dist/loader.js"],
        roots: ["src"],
        skipDirs: new Set(["libs", "dist", "types", "locales", "assets"]),
        accept: (file) => file.endsWith(".ts") && !file.endsWith(".d.ts"),
    },
    {
        name: "UI (ui/index.js)",
        outputs: ["ui/index.js"],
        roots: ["ui"],
        skipDirs: new Set(["node_modules"]),
        accept: (file) => /\.(mjs|js)$/.test(file) && !/^index(\.min)?\.js$/.test(path.basename(file)),
    },
];

function newestSource(dir, bundle, best = { file: null, mtimeMs: 0 }) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return best;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!bundle.skipDirs.has(entry.name)) newestSource(full, bundle, best);
            continue;
        }
        if (!entry.isFile() || !bundle.accept(full)) continue;
        const { mtimeMs } = statSync(full);
        if (mtimeMs > best.mtimeMs) {
            best.file = full;
            best.mtimeMs = mtimeMs;
        }
    }
    return best;
}

/**
 * @return {string[]} one line per stale bundle; empty when everything is current
 */
export function findStaleBundles() {
    const problems = [];
    for (const bundle of BUNDLES) {
        const outputs = bundle.outputs.map(rel => path.join(repoRoot, rel));
        const missing = outputs.filter(file => !existsSync(file));
        if (missing.length) {
            problems.push(`${bundle.name}: missing ${missing.map(f => path.relative(repoRoot, f)).join(", ")}`);
            continue;
        }
        const built = Math.min(...outputs.map(file => statSync(file).mtimeMs));
        let newest = { file: null, mtimeMs: 0 };
        for (const root of bundle.roots) newest = newestSource(path.join(repoRoot, root), bundle, newest);
        if (newest.file && newest.mtimeMs > built + SLACK_MS) {
            problems.push(`${bundle.name}: built ${new Date(built).toISOString()}, but ` +
                `${path.relative(repoRoot, newest.file)} changed ${new Date(newest.mtimeMs).toISOString()}`);
        }
    }
    return problems;
}

let verdict = null;

/** Throws when a bundle is older than its sources (memoized per worker). */
export function assertBundlesFresh() {
    if (process.env.XOPAT_TEST_ALLOW_STALE_BUNDLE === "1") return;
    verdict ??= findStaleBundles();
    if (verdict.length) {
        throw new Error(
            "[xopat-test] the client bundle is older than its sources, so this browser test would run old code:\n  " +
            verdict.join("\n  ") +
            "\nStart the dev watcher (`npm run dev`) and let it rebuild, or set XOPAT_TEST_ALLOW_STALE_BUNDLE=1 to run anyway."
        );
    }
}
