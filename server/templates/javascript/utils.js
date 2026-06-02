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
