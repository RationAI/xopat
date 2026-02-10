"use strict";

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const glob = require("glob");

function spawnAsync(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const options = { stdio: "inherit", shell: process.platform === "win32", ...opts };
        const child = spawn(cmd, args, options);
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    });
}

function executeCopy(itemDirectory, copyMap, logger, prefix) {
    Object.entries(copyMap).forEach(([srcPattern, dest]) => {
        const fullSrcPattern = path.resolve(itemDirectory, srcPattern);
        const fullDestBase = path.resolve(itemDirectory, dest);

        // 1. Resolve all files matching the pattern
        const matchedFiles = glob.sync(fullSrcPattern, { nodir: true });

        if (matchedFiles.length === 0) {
            // Handle directory-to-directory copy if no glob is used
            if (fs.existsSync(fullSrcPattern) && fs.statSync(fullSrcPattern).isDirectory()) {
                _smartCopy(fullSrcPattern, fullDestBase, logger, prefix);
            } else {
                logger.warn(`${prefix} No files found for pattern: ${srcPattern}`);
            }
            return;
        }

        // 2. Process each matched file
        matchedFiles.forEach(srcFile => {
            // FORCE DIRECTORY BEHAVIOR:
            // If dest ends with a slash, or if we have multiple files matching a glob,
            // we must treat 'dest' as a folder and append the filename.
            let targetFile = fullDestBase;

            const isExplicitDir = dest.endsWith('/') || dest.endsWith('\\');

            if (isExplicitDir || matchedFiles.length > 1) {
                // Ensure the directory exists first
                if (!fs.existsSync(fullDestBase)) {
                    fs.mkdirSync(fullDestBase, { recursive: true });
                }
                targetFile = path.join(fullDestBase, path.basename(srcFile));
            }

            _smartCopy(srcFile, targetFile, logger, prefix);
        });
    });
}

/**
 * Internal helper to compare timestamps before copying
 */
function _smartCopy(src, dest, logger, prefix) {
    try {
        const srcStat = fs.statSync(src);
        let destStat = null;
        try { destStat = fs.statSync(dest); } catch (e) { /* dest missing */ }

        // Only copy if destination is missing or source is newer
        if (!destStat || srcStat.mtimeMs > destStat.mtimeMs) {
            logger.log(`${prefix} Copying: ${path.basename(src)} -> ${dest}`);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(src, dest);
        }
    } catch (err) {
        logger.error(`${prefix} Failed to copy ${src}: ${err.message}`);
    }
}

/**
 * Portable logic to build, copy, or clean workspace items.
 */
const BuildLogic = {
    /**
     * Executes the build/copy flow for a workspace item.
     */
    async buildWorkspaceItem(itemDirectory, packageData, logger) {
        const logPrefix = `[build] ${packageData.name || itemDirectory}:`;
        // The server expects this exact filename
        const outFile = path.join(itemDirectory, "index.workspace.js");

        /**
         * TODO: we should be more flexible in build and minidication:
         *  - if index.workspace.js in not defined but index.workspace.min.js or index.min.js exists, use it
         *  - letting users specify the output file name
         *
         *  Places that need update: npm+php server load + asset printing logics, these utilities and dev task
         */
        if (packageData.scripts && (packageData.scripts.dev || packageData.scripts.build)) {
            const script = packageData.scripts.dev ? "dev" : "build";
            logger.log(`${logPrefix} using script "npm run ${script}"`);
            await spawnAsync("npm", ["run", script], { cwd: itemDirectory });
        } else if (packageData.main) {
            // Source is flexible (packageData.main), output is standardized
            logger.log(`${logPrefix} compiling ${packageData.main} -> index.workspace.js`);
            await spawnAsync("npx", [
                "esbuild", "--bundle", "--sourcemap", "--format=esm",
                `--outfile=${outFile}`, path.resolve(itemDirectory, packageData.main)
            ]);
        }

        if (packageData.copy) {
            executeCopy(itemDirectory, packageData.copy, logger, logPrefix);
        }
    },

    /**
     * Removes files specified in the copy directives and the default workspace output.
     */
    async cleanWorkspaceItem(itemDirectory, packageData, logger) {
        const logPrefix = `[clean] ${packageData.name || itemDirectory}:`;

        // Remove default build artifact
        const defaultBuild = path.join(itemDirectory, "index.workspace.js");
        if (fs.existsSync(defaultBuild)) {
            logger.log(`${logPrefix} removing ${defaultBuild}`);
            fs.unlinkSync(defaultBuild);
        }

        // Remove copy directive targets
        if (packageData.copy) {
            Object.values(packageData.copy).forEach(dest => {
                const fullDest = path.resolve(itemDirectory, dest);
                if (fs.existsSync(fullDest)) {
                    logger.log(`${logPrefix} removing ${dest}`);
                    fs.rmSync(fullDest, { recursive: true, force: true });
                }
            });
        }
    },

    spawnAsync,
};

module.exports = BuildLogic;