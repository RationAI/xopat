/**
 * Per-worker scratch copy of a deployment ENV file.
 *
 * ## Why a copy
 *
 * The server re-reads its configuration on **every request**
 * (`initViewerCoreAndPlugins`, `server/node/index.js`), which makes rewriting
 * the ENV file the cheapest possible way to test a different deployment shape.
 * The catch is that the file is shared: the pre-runner suite could only do this
 * against one hardcoded scratch path (`test/env/runtime.json`) and had to skip
 * itself everywhere else, because otherwise a test would scribble on the
 * developer's real `env/env.json`.
 *
 * Copying the project's ENV file into a per-worker temp path removes both
 * problems at once: every project becomes rewritable, and parallel workers
 * cannot see each other's writes.
 *
 * ## The production exception
 *
 * With `client.production === true` the server memoizes the parsed config in
 * `_productionCoreCache` until the process restarts, so a rewrite is *not*
 * picked up. `isProduction` is surfaced here so the server fixture knows it has
 * to restart instead of just writing.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stringify } from "comment-json";
import { fromRoot } from "./paths.mjs";

/**
 * The merge, `$base` resolution and conflict detection live in
 * `server/utils/node/env-compose.mjs`, shared with the `npm run up` runner —
 * one implementation of "what does this ENV actually say", used by both the
 * deployment matrix and the developer running the thing by hand.
 *
 * Loaded through `fromRoot` + a file URL rather than a relative specifier: this
 * module is also reachable as `node_modules/@xopat/test-harness/env-scratch.mjs`,
 * and under `--preserve-symlinks` (which the runner enables when an externally
 * developed element is linked in) `../../server/…` would resolve inside
 * `node_modules`.
 */
const compose = await import(pathToFileURL(fromRoot("server/utils/node/env-compose.mjs")).href);

/** Deep merge, arrays replaced — mirrors the server's ENV-over-config overlay. */
const { mergeDeep, readJsonc } = compose;
export { mergeDeep, readJsonc };

/**
 * Load an ENV file, following `$base` if present.
 *
 * A matrix entry differs from the ordinary deployment in one respect — secure
 * mode, production mode, where slides come from. Spelling out a whole ENV for
 * each of those is not just duplication: it silently moves *other* variables
 * too (an omitted `plugins` block deploys a viewer with no plugins), and then a
 * failure cannot be attributed to the one thing the project was supposed to
 * change. So a matrix file states only its difference:
 *
 * ```jsonc
 * { "$base": "env/env.default.json",
 *   "core": { "client": { "localhost": { "secureMode": true } } } }
 * ```
 *
 * `$base` also accepts an ARRAY, whose entries are composer selectors — a
 * fragment id under `env/parts/`, a preset name, or a path. That is how the
 * `saml` and `oidc` fixtures share one copy of the blocks they used to keep
 * byte-identical by hand.
 *
 * Files without `$base` are read as-is, so real deployment ENVs and the Cypress
 * fixtures are unaffected.
 */
export function loadEnvFile(repoRelativePath, seen) {
    return compose.loadEnvFile(repoRelativePath, seen);
}

/**
 * Compose an ordered selector list (fragments, presets, files) into one ENV,
 * refusing anything the composer reports as ambiguous.
 *
 * Conflicts throw here rather than resolving last-wins: a project whose layers
 * disagree about a value is a project whose failures cannot be attributed, and
 * that is the exact defect the matrix exists to rule out.
 */
export function composeEnvFiles(selectors) {
    const { env, conflicts } = compose.composeEnv(selectors, {});
    if (conflicts.length) {
        throw new Error(`[xopat-test] conflicting ENV layers\n${compose.formatConflicts(conflicts)}`);
    }
    return env;
}

/**
 * Resolve the client-side flags a given ENV would produce, by replaying the
 * server's cascade: `src/config.json` overlaid with the ENV's `core` block,
 * then `client` flattened from `client[active_client]`.
 *
 * @returns {{activeClient: string, secureMode: boolean, production: boolean}}
 */
export function effectiveClient(envObject) {
    const core = mergeDeep(readJsonc(fromRoot("src", "config.json")), envObject?.core ?? {});
    const activeClient = core.active_client ?? "dev";
    const client = core.client?.[activeClient] ?? {};
    // The server tolerates the string "false"; mirror that so a test asserting
    // on secureMode agrees with `src/app.ts`.
    const truthy = (v) => Boolean(v) && String(v) !== "false";
    return {
        activeClient,
        secureMode: truthy(client.secureMode),
        production: truthy(client.production),
    };
}

/**
 * @param {object} opts
 * @param {string|string[]|null} opts.envFile  repo-relative ENV file, an ordered
 *        list of composer selectors, or null for the deployment default
 * @param {string} opts.label            used in the temp dir name, for debuggability
 * @param {string} [opts.serverLogLevel] value for `core.server.logging.level`
 */
export function createEnvScratch({ envFile, label, serverLogLevel }) {
    const dir = mkdtempSync(path.join(tmpdir(), `xopat-test-${label}-`));
    const file = path.join(dir, "env.json");

    let current = Array.isArray(envFile) ? composeEnvFiles(envFile) : loadEnvFile(envFile ?? "env/env.json");

    if (serverLogLevel) {
        // Route verbosity through the existing logging broker rather than
        // inventing a second knob. See `server/LOGGING.md`.
        current = mergeDeep(current, { core: { server: { logging: { level: serverLogLevel } } } });
    }

    const flush = () => writeFileSync(file, stringify(current, null, 2), "utf8");
    flush();

    return {
        /** Absolute path to hand to `XOPAT_ENV`. */
        path: file,
        /** Where this scratch came from, for failure diagnostics. */
        sourceFile: Array.isArray(envFile) ? envFile.join(" + ") : (envFile ?? "env/env.json"),
        get isProduction() { return effectiveClient(current).production; },
        get flags() { return effectiveClient(current); },
        read() { return current; },
        /** Replace the whole ENV. */
        write(next) { current = next; flush(); },
        /** Merge a partial ENV over the current one. */
        patch(partial) { current = mergeDeep(current, partial); flush(); return current; },
        dispose() { rmSync(dir, { recursive: true, force: true }); },
    };
}
