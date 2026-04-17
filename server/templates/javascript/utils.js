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
