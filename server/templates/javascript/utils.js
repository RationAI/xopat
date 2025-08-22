const fs = require("fs");
const path = require("path");

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
