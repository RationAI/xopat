const fs = require("fs");
const path = require("path");
const glob = require("glob");

/** Any scheme-qualified URL — such an include is not resolved against the item root. */
const ABSOLUTE_URL_RE = /^[a-z][a-z0-9.+-]*:\/\//i;

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

/** Newest mtime among `files`, or 0 when none can be stat'd. */
function newestMtime(files) {
    let newest = 0;
    for (const file of files) {
        try {
            const { mtimeMs } = fs.statSync(file);
            if (mtimeMs > newest) newest = mtimeMs;
        } catch { /* missing / unreadable sources cannot make a bundle stale */ }
    }
    return newest;
}

/**
 * Is a built bundle at least as new as everything it was built from?
 *
 * Selection used to be "the artifact exists", with no freshness test — and only
 * `grunt minify` ever regenerates these, never the dev watcher. So a source edit
 * left a stale bundle in place and production silently served the OLD code, with
 * nothing in the page or the logs to say so. That is close to undiagnosable from
 * the browser: the app runs, it just behaves like a previous commit.
 *
 * A stale bundle is skipped rather than served, which falls back to the raw
 * per-file includes — slower, but what the developer actually wrote.
 *
 * @param {string} artifact absolute path of the built file
 * @param {string[]} sources absolute paths it was built from
 * @param {string} itemDirectory for the log line
 * @returns {boolean}
 */
function isBundleFresh(artifact, sources, itemDirectory) {
    let builtAt;
    try {
        builtAt = fs.statSync(artifact).mtimeMs;
    } catch {
        return false;
    }
    const sourceAt = newestMtime(sources);
    // No readable source: nothing to compare against, so trust the artifact
    // (a vendored bundle whose sources are not shipped is a legitimate case).
    if (sourceAt === 0 || builtAt >= sourceAt) return true;

    console.warn(`[build] '${itemDirectory}': ${path.basename(artifact)} is older than its sources `
        + `(built ${new Date(builtAt).toISOString()}, newest source ${new Date(sourceAt).toISOString()}). `
        + "Serving the raw includes instead — run `npm run build` to refresh it.");
    return false;
}
module.exports.isBundleFresh = isBundleFresh;

/**
 * Freshness for the two CORE bundles, which `core.js` picks the same "artifact
 * exists → serve it" way and which are just as prone to going stale.
 *
 * Both are compared **artifact against artifact**, not against a source tree:
 * `ui/index.js` and `src/dist/*.js` are exactly what the dev watcher rebuilds, so
 * they are the honest reference, and globbing `ui/**` on every page render would
 * cost far more than it catches.
 *
 * @param {string} absUi absolute `ui/` directory, ending with a separator
 * @returns {boolean} whether `ui/index.min.js` may be served
 */
module.exports.isUiBundleFresh = function (absUi) {
    return isBundleFresh(absUi + "index.min.js", [absUi + "index.js"], "ui");
};

/**
 * @param {string} absSrc absolute `src/` directory, ending with a separator
 * @returns {boolean} whether `src/dist/xopat-core.min.js` may be served
 */
module.exports.isCoreBundleFresh = function (absSrc) {
    const dist = absSrc + "dist" + path.sep;
    let sources = [];
    try {
        sources = fs.readdirSync(dist)
            // The per-file dist outputs the watcher maintains — not the minified
            // bundle itself, and not source maps (which it also writes).
            .filter(f => f.endsWith(".js") && !f.endsWith(".min.js") && !f.endsWith(".map"))
            .map(f => dist + f);
    } catch { /* no dist dir: nothing to compare against */ }
    return isBundleFresh(dist + "xopat-core.min.js", sources, "src/dist");
};

/**
 * Compute the optional per-item `prodIncludes` list used in production. Leaves
 * the canonical `includes[]` untouched; the loader (server-print AND the client
 * dynamic loader) iterates `prodIncludes` when present, else `includes`.
 *
 * A `.min` artifact is used only when it is **newer than the sources it folds**.
 * See {@link isBundleFresh}.
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
        // The dev watcher rebuilds `index.workspace.js` from the item's sources
        // but never the `.min` copy, so the unminified bundle is the honest
        // freshness reference here — no need to know the item's TS entry points.
        if (!isBundleFresh(fullPath + "index.workspace.min.js",
                           [fullPath + "index.workspace.js"], fullPath)) return;
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
    const sourcesOfKind = (kind) => includes
        .filter(e => kindOf(e) === kind)
        .map(e => fullPath + e);

    const classicSources = sourcesOfKind("classic");
    const moduleSources  = sourcesOfKind("module");
    const classicOk = classicSources.length > 0
        && fileExists(fullPath + "index.min.js")
        && isBundleFresh(fullPath + "index.min.js", classicSources, fullPath);
    const moduleOk = moduleSources.length > 0
        && fileExists(fullPath + "index.min.mjs")
        && isBundleFresh(fullPath + "index.min.mjs", moduleSources, fullPath);
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
 *
 * Also validates that each resulting file exists. `printDependencies` emits
 * every entry as a bare `<script src=...>` with no `onerror`, and an unresolved
 * asset request is answered with a silent 404 — so a typo'd or uncompiled
 * include shows up only as a downstream `ReferenceError` in the browser, far
 * from its cause. This is the one place in the load path that has both the
 * item's root and `fs`, so the check belongs here (same spirit as the existing
 * "defines workspace but … is missing" warning in the module/plugin loaders).
 *
 * @param {string} basePath The absolute path to the directory.
 * @param {Array} includes The includes array from config.
 * @param {string} [label] Item id/path, for the warning message.
 * @returns {Array} The expanded includes array.
 */
module.exports.expandIncludeGlobs = function (basePath, includes, label = undefined) {
    const who = label || basePath;
    let expanded = [];
    for (let file of includes) {
        // Only expand strings that look like globs
        if (typeof file === "string" && (file.includes("*") || file.includes("?"))) {
            // sync is used here to match your existing synchronous loading pattern
            const matches = glob.sync(file, { cwd: basePath });
            if (matches.length > 0) {
                expanded.push(...matches);
            } else {
                // Silently dropping this used to make a renamed directory look
                // like "the feature just does nothing".
                console.warn(`[includes] ${who}: pattern '${file}' matched no files.`);
            }
        } else {
            // Object-form entries (`{src, integrity, async, …}`) are checked too,
            // but only when `src` is local — `printDependencies` leaves absolute
            // URLs untouched, and an upstream CDN is not ours to stat.
            const rel = typeof file === "string" ? file
                : (file && typeof file.src === "string" && !ABSOLUTE_URL_RE.test(file.src)
                    ? file.src : null);
            if (rel && !fs.existsSync(path.join(basePath, rel))) {
                console.warn(`[includes] ${who}: '${rel}' is listed but does not exist ` +
                    `— it will 404 at load time. Fix include.json, or build it first.`);
            }
            expanded.push(file);
        }
    }
    return expanded;
}
