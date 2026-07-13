const fs = require("fs");
const path = require("path");
const glob = require("glob");

module.exports.safeScanDir = function (directory) {
    let resolvedPaths = [];
    try {
        const entries = fs.readdirSync(directory);

        resolvedPaths = entries.map((entry) => {
            const fullPath = path.join(directory, entry);
            try {
                const realPath = fs.realpathSync(fullPath);
                fs.statSync(realPath);
                return entry;
            } catch (err) {
                console.error(`Failed to resolve or stat: ${fullPath}`, err.message);
                return null;
            }
        });
    } catch (err) {
        console.error(`Error scanning directory: ${directory}`, err.message);
    }
    return resolvedPaths.filter(Boolean);
}

/**
 * Resolve the active `pluginSelectionMode` from CORE.client. Falls back to
 * `"all"` for unset/invalid values and warns once. Shared by `plugins.js` and
 * `modules.js` so module and plugin filters agree.
 */
const VALID_SELECTION_MODES = ["all", "whitelist", "available"];
module.exports.resolvePluginSelectionMode = function (core) {
    const raw = core?.CORE?.client?.pluginSelectionMode;
    if (typeof raw === "string") {
        if (VALID_SELECTION_MODES.includes(raw)) return raw;
        console.warn(`Unknown pluginSelectionMode '${raw}' - falling back to 'all'.`);
    }
    return "all";
};

/**
 * Resolve a dot-path inside a record. Returns null when any path segment is
 * missing. Used by the "available" selection mode to test whether all
 * `requiredConfig` / `requiredServerConfig` paths are populated.
 */
module.exports.requiredConfigValue = function (data, path) {
    const segments = String(path).split(".");
    let cursor = data;
    for (const seg of segments) {
        if (cursor && typeof cursor === "object" && Object.prototype.hasOwnProperty.call(cursor, seg)) {
            cursor = cursor[seg];
        } else {
            return null;
        }
    }
    return cursor;
};

/**
 * "Configured" means: present and not undefined/null/empty-string. Booleans
 * `false` and the number `0` count as configured (intentional choices).
 */
module.exports.requiredConfigIsSet = function (value) {
    if (value === undefined || value === null) return false;
    if (typeof value === "string" && value === "") return false;
    return true;
};

/**
 * True iff every dot-path in `paths` resolves to a configured value in at
 * least one of the supplied `records`. A non-array / missing `paths` list
 * is treated as no gate (returns true). With no records, a non-empty
 * `paths` list returns false.
 *
 * Records are the deployment-supplied source-of-truth for the gate:
 *   - first record: pre-merge ENV block (`ENV.plugins[id]` / `ENV.modules[id]`).
 *   - second record: preserved server-secure block (`CORE_SECURE.plugins[id]` /
 *     `CORE_SECURE.modules[id]`) — see `core.CORE_SECURE` set in core.js
 *     before the strip. Pass an empty object when the secure block is
 *     unavailable in the current request context (e.g. static-preview);
 *     the gate then degrades to ENV-only.
 *
 * Include.json defaults are intentionally NOT consulted — the merged
 * record is never passed in.
 */
module.exports.requiredConfigSatisfied = function (paths, ...records) {
    if (!Array.isArray(paths)) return true;
    for (const reqPath of paths) {
        if (typeof reqPath !== "string" || reqPath === "") continue;
        let satisfied = false;
        for (const rec of records) {
            if (!rec || typeof rec !== "object") continue;
            const resolved = module.exports.requiredConfigValue(rec, reqPath);
            if (module.exports.requiredConfigIsSet(resolved)) {
                satisfied = true;
                break;
            }
        }
        if (!satisfied) return false;
    }
    return true;
};

/**
 * Classify a single `includes[]` entry into how it participates in production
 * bundling. The rule is derived purely from the entry's own shape — no per-file
 * authoring is needed — plus an explicit `bundle: false` opt-out for object-form
 * entries.
 *
 *   - `"classic"`: a plain, local, classic `.js` string. This INCLUDES local
 *      `.min.js` (already-minified vendored libs): they are concatenated into
 *      the per-item `index.min.js` in their original position so intra-item load
 *      order is preserved — e.g. `ext/rbush.min.js` must run before the folded
 *      `spatial-index.js` that reads its `window.RBush` global. (Re-minifying an
 *      already-minified file via terser is semantics-preserving; use `bundle:
 *      false` to keep a specific one standalone.)
 *   - `"module"`: a local `.mjs` ES module. esbuild-bundled + minified into the
 *      per-item `index.min.mjs` (served as `type="module"`).
 *   - `"separate"`: loaded as its own file, never bundled — remote `http(s)`
 *      URLs and any object-form include (SRI/attributes, or
 *      `{ "src": "x.worker.js", "bundle": false }` — the explicit marker for a
 *      local file that must stay standalone, e.g. a Web Worker source that only
 *      looks foldable by its `.js` suffix).
 *
 * Reused by the Grunt build tasks so each "kind" has exactly one definition
 * across build and serve.
 * @param {string|object} entry
 * @returns {"classic"|"module"|"separate"}
 */
module.exports.classifyIncludeKind = function (entry) {
    if (typeof entry === "string") {
        if (/^https?:\/\//.test(entry)) return "separate";
        if (entry.endsWith(".mjs")) return "module";
        // Local `.js` (including `.min.js`) folds into index.min.js. Keeping
        // `.min.js` OUT of the bundle would reorder it relative to the folded
        // classic files that depend on its globals (RBush load-order bug).
        if (entry.endsWith(".js")) return "classic";
        return "separate";
    }
    // Object-form includes are never bundled: they either carry SRI/attributes
    // or are explicitly marked `bundle: false`.
    return "separate";
};

/** Back-compat convenience: the classic-concat predicate used by `prepMinify`. */
module.exports.classifyIncludeFoldable = function (entry) {
    return module.exports.classifyIncludeKind(entry) === "classic";
};

/**
 * Compute the optional per-item `prodIncludes` list used in production. Leaves
 * the canonical `includes[]` untouched; the loader (server-print AND the client
 * dynamic loader) iterates `prodIncludes` when present, else `includes`.
 *
 * Foldable includes collapse into a single `index.min.js` (non-workspace) or the
 * already-minified `index.workspace.min.js` (workspace items) placed at the
 * position of the first foldable entry; non-foldable entries keep loading in
 * their original positions. If nothing is foldable, or the expected `.min`
 * artifact does not exist yet, `prodIncludes` is left unset (graceful fallback).
 *
 * @param {string} fullPath absolute item directory, ending with a slash
 * @param {object} data parsed item metadata (mutated: sets data.prodIncludes)
 * @param {boolean} production
 * @param {function(string):boolean} fileExists
 */
module.exports.buildProdIncludes = function (fullPath, data, production, fileExists) {
    if (!production || !data) return;
    const includes = data["includes"];
    if (!Array.isArray(includes) || includes.length === 0) return;

    const kindOf = module.exports.classifyIncludeKind;

    // Workspace item: its bundle (already esbuild-minified) is the copied
    // index.workspace.min.js. The workspace entry is always includes[0].
    const wsEntry = includes[0];
    if (wsEntry === "index.workspace.js") {
        if (!fileExists(fullPath + "index.workspace.min.js")) return;
        // Fold nothing else; keep any extra includes as their own files.
        data["prodIncludes"] = ["index.workspace.min.js", ...includes.slice(1)];
        return;
    }
    // .mjs workspace bundles / `main` entries are served as-is.
    if (typeof wsEntry === "string" && wsEntry.startsWith("index.workspace.")) return;

    // Two independent single-file bundles: classic `.js` → index.min.js (IIFE),
    // `.mjs` modules → index.min.mjs (ESM). Either may be present; each is used
    // only if it has ≥1 member and its artifact exists (else those entries fall
    // back to raw per-file serving). "separate" entries always stay in place.
    const hasClassic = includes.some(e => kindOf(e) === "classic");
    const hasModule  = includes.some(e => kindOf(e) === "module");
    const classicOk = hasClassic && fileExists(fullPath + "index.min.js");
    const moduleOk  = hasModule  && fileExists(fullPath + "index.min.mjs");
    if (!classicOk && !moduleOk) return;

    const result = [];
    let classicPlaced = false, modulePlaced = false;
    for (const entry of includes) {
        const kind = kindOf(entry);
        if (kind === "classic" && classicOk) {
            if (!classicPlaced) { result.push("index.min.js"); classicPlaced = true; }
        } else if (kind === "module" && moduleOk) {
            if (!modulePlaced) { result.push("index.min.mjs"); modulePlaced = true; }
        } else {
            result.push(entry); // separate, or a kind whose bundle wasn't built
        }
    }
    data["prodIncludes"] = result;
};

/**
 * Expands glob patterns within an array of includes.
 * @param {string} basePath The absolute path to the directory.
 * @param {Array} includes The includes array from config.
 * @returns {Array} The expanded includes array.
 */
module.exports.expandIncludeGlobs = function (basePath, includes) {
    let expanded = [];
    for (let file of includes) {
        // Only expand strings that look like globs
        if (typeof file === "string" && (file.includes("*") || file.includes("?"))) {
            // sync is used here to match your existing synchronous loading pattern
            const matches = glob.sync(file, { cwd: basePath });
            if (matches.length > 0) {
                expanded.push(...matches);
            }
        } else {
            expanded.push(file);
        }
    }
    return expanded;
}
