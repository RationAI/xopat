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
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse, stringify } from "comment-json";
import { fromRoot } from "./paths.mjs";

/** Deep merge, arrays replaced — mirrors the server's ENV-over-config overlay. */
function mergeDeep(base, overlay) {
    if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) return overlay ?? base;
    const out = Array.isArray(base) ? [...base] : { ...(base ?? {}) };
    for (const [key, value] of Object.entries(overlay)) {
        out[key] = value && typeof value === "object" && !Array.isArray(value)
            ? mergeDeep(out[key], value)
            : value;
    }
    return out;
}

/** Parse a JSONC file the same way the server does. Missing file → `{}`. */
export function readJsonc(file) {
    if (!existsSync(file)) return {};
    return parse(readFileSync(file, "utf8"), undefined, true) ?? {};
}

/** Marks a file as a patch over another ENV rather than a whole deployment. */
const BASE_KEY = "$base";

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
 * Files without `$base` are read as-is, so real deployment ENVs and the Cypress
 * fixtures are unaffected.
 */
export function loadEnvFile(repoRelativePath, seen = new Set()) {
    const absolute = fromRoot(repoRelativePath);
    if (seen.has(absolute)) {
        throw new Error(`[xopat-test] circular $base chain at ${repoRelativePath}`);
    }
    seen.add(absolute);

    const contents = readJsonc(absolute);
    const base = contents?.[BASE_KEY];
    if (typeof base !== "string" || !base.trim()) return contents;

    const { [BASE_KEY]: _dropped, ...patch } = contents;
    return mergeDeep(loadEnvFile(base, seen), patch);
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
 * @param {string|null} opts.envFile     repo-relative ENV file, or null for the deployment default
 * @param {string} opts.label            used in the temp dir name, for debuggability
 * @param {string} [opts.serverLogLevel] value for `core.server.logging.level`
 */
export function createEnvScratch({ envFile, label, serverLogLevel }) {
    const dir = mkdtempSync(path.join(tmpdir(), `xopat-test-${label}-`));
    const file = path.join(dir, "env.json");

    let current = loadEnvFile(envFile ?? "env/env.json");

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
        sourceFile: envFile ?? "env/env.json",
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
