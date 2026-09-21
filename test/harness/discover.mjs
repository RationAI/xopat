/**
 * Element (plugin / module) test discovery.
 *
 * ## External elements need no configuration
 *
 * The scan mirrors the server's own (`safeScanDir` in
 * `server/templates/javascript/utils.js`): read the directory, `realpathSync`
 * each entry, keep the directories. That is what makes an element developed in
 * its own repository work — `ln -s /path/to/my-plugin plugins/my-plugin` (or a
 * junction on Windows) is indistinguishable from a real directory to the
 * scanner, and therefore to the runner. There is deliberately no
 * `XOPAT_PLUGINS_DIR`-style knob: one mechanism, already documented in
 * `plugins/README.md`, already used by the server.
 *
 * ## The `tests` block
 *
 * `include.json` may carry an optional block describing what an element's tests
 * need. Absent, the defaults are "unit tests everywhere, deployment tests in
 * every matrix project":
 *
 * ```json
 * "tests": {
 *   "dir": "test",
 *   "envs": ["default", "secure"],
 *   "requires": { "browser": true, "server": true, "slides": false },
 *   "tags": ["@slow"]
 * }
 * ```
 *
 * `envs` is the useful one: a plugin that is only enabled in some deployments
 * would otherwise fail in the projects that never load it, and the honest fix
 * is a declaration, not a `test.skip` copied into every spec.
 */
import { readdirSync, existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { readJsonc } from "./env-scratch.mjs";
import { fromRoot } from "./paths.mjs";

const KINDS = [
    { kind: "plugin", dir: "plugins" },
    { kind: "module", dir: "modules" },
];

/** Suite kinds an element may ship, mirroring `test/suites/`. */
export const SUITE_KINDS = ["unit", "integration", "e2e"];

/**
 * @typedef {object} ElementTests
 * @property {"plugin"|"module"} kind
 * @property {string} id            directory name (the id the loader uses)
 * @property {string} testsRoot     repo-relative, POSIX separators
 * @property {string[]|null} envs   matrix projects this element's tests apply to
 * @property {object} requires
 * @property {string[]} tags
 */

function scanKind({ kind, dir }) {
    const root = fromRoot(dir);
    if (!existsSync(root)) return [];

    /** @type {ElementTests[]} */
    const found = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;

        const full = path.join(root, entry.name);
        let real;
        try {
            // `realpathSync` first: a symlink/junction reports as a link, not a
            // directory, so `entry.isDirectory()` alone would drop external
            // elements — exactly the case this has to support.
            real = realpathSync(full);
            if (!statSync(real).isDirectory()) continue;
        } catch {
            continue;
        }

        const include = readJsonc(path.join(real, "include.json"));
        if (!include || typeof include !== "object") continue;

        const declared = include.tests ?? {};
        const testsDir = typeof declared.dir === "string" && declared.dir.trim() ? declared.dir.trim() : "test";
        if (!existsSync(path.join(real, testsDir))) continue;

        found.push({
            kind,
            id: include.id ?? entry.name,
            testsRoot: `${dir}/${entry.name}/${testsDir}`.replace(/\\/g, "/"),
            // Where the files really are. For a linked-in element this is
            // outside the repository, which the runner's own file scan will not
            // walk into — see `externalTestFiles`.
            realTestsRoot: path.join(real, testsDir),
            external: real !== full,
            envs: Array.isArray(declared.envs) ? declared.envs : null,
            requires: declared.requires ?? {},
            tags: Array.isArray(declared.tags) ? declared.tags : [],
        });
    }
    return found;
}

let _cache = null;

/** All elements that ship tests. Cached: the config is evaluated per worker. */
export function discoverElementTests() {
    if (!_cache) _cache = KINDS.flatMap(scanKind);
    return _cache;
}

/**
 * Globs to ignore so that elements which did not declare `project` in their
 * `envs` are skipped there.
 *
 * @param {string} project matrix project name
 * @returns {string[]}
 */
export function elementIgnoresFor(project) {
    return discoverElementTests()
        .filter(element => element.envs !== null && !element.envs.includes(project))
        .map(element => `${element.testsRoot}/**`);
}

/**
 * Test files belonging to elements that are **linked in** rather than living in
 * the repository.
 *
 * The runner's file scan resolves a junction/symlink as a link, not a
 * directory, and does not descend into it — so an element developed in its own
 * repository would be discovered by `discoverElementTests` (which follows the
 * link, exactly like the server's scanner) and then silently contribute zero
 * tests. `test/harness/external/*.test.mjs` closes that gap by importing these
 * files, which registers their tests in the normal way.
 *
 * Elements that physically live in the repository are found by the scan and are
 * deliberately NOT listed here, or they would register twice.
 *
 * @param {"unit"|"integration"|"e2e"} kind
 * @param {string|null} [project] apply `tests.envs` gating for a matrix project
 * @returns {string[]} absolute paths
 */
export function externalTestFiles(kind, project = null) {
    /** @type {string[]} */
    const files = [];
    for (const element of discoverElementTests()) {
        if (!element.external) continue;
        if (project && element.envs !== null && !element.envs.includes(project)) continue;

        const dir = fromRoot(element.testsRoot, kind);
        if (!existsSync(dir)) continue;
        collectTests(dir, files);
    }
    return files.sort();
}

/**
 * Collect `*.test.mjs`, keeping the path **through the link**.
 *
 * This matters: Node resolves a module's bare imports by walking `node_modules`
 * up from the importing file's URL. Import the real path and the walk starts
 * outside the repository, so `@xopat/test-harness` is unresolvable and the
 * element's tests die on import. Import the linked path and the walk reaches
 * the repository's `node_modules` — which is where the harness workspace is —
 * so an external element needs no install of its own.
 */
function collectTests(dir, out) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        try {
            if (statSync(realpathSync(full)).isDirectory()) { collectTests(full, out); continue; }
        } catch {
            continue;
        }
        if (/\.test\.mjs$/.test(entry.name)) out.push(full);
    }
}
