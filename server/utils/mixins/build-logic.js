"use strict";

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const glob = require("glob");

function spawnAsync(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const isWin = process.platform === "win32";

        // On Windows, we must use shell: true for npx/npm,
        // but we should pass the command and args as a single string
        // to avoid the "Invalid build flag" concatenation error.
        const fullCommand = isWin
            ? `${cmd} ${args.map(a => `"${a}"`).join(" ")}`
            : cmd;

        const spawnArgs = isWin ? [] : args;
        const options = {
            stdio: "inherit",
            shell: isWin,
            ...opts
        };

        const child = spawn(fullCommand, spawnArgs, options);

        child.on("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} exited ${code}`));
        });

        child.on("error", (err) => reject(err));
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



function findServerEntryFiles(itemDirectory) {
    const found = [];
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (
                    entry.name === "node_modules" ||
                    entry.name === ".git" ||
                    entry.name === ".server-dist"
                ) continue;

                walk(full);
            } else if (/\.server\.(ts|js|mjs)$/i.test(entry.name)) {
                found.push(full);
            }
        }
    }
    if (fs.existsSync(itemDirectory)) walk(itemDirectory);
    return found;
}

async function buildServerEntries(itemDirectory, logger, logPrefix) {
    const serverEntries = findServerEntryFiles(itemDirectory);
    if (!serverEntries.length) return;

    const outDir = path.join(itemDirectory, ".server-dist");
    fs.mkdirSync(outDir, { recursive: true });

    for (const serverEntry of serverEntries) {
        const rel = path.relative(itemDirectory, serverEntry);
        const ext = path.extname(serverEntry).toLowerCase();
        const outFile = path.join(outDir, rel).replace(/\.ts$/i, ".mjs");

        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        logger.log(`${logPrefix} building server entry ${rel}`);

        if (ext === ".ts") {
            await spawnAsync("npx", [
                "esbuild",
                serverEntry,
                "--bundle",
                "--platform=node",
                "--format=esm",
                `--outfile=${outFile}`,
                "--sourcemap"
            ]);
        } else if (ext === ".mjs") {
            _smartCopy(serverEntry, outFile, logger, logPrefix);
        } else {
            _smartCopy(serverEntry, outFile.replace(/\.mjs$/i, ".js"), logger, logPrefix);
        }
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

        // todo flexibility in minification...

        // 1. Check for explicit scripts first
        if (packageData.scripts && (packageData.scripts.dev || packageData.scripts.build)) {
            const script = packageData.scripts.dev ? "dev" : "build";
            logger.log(`${logPrefix} using script "npm run ${script}"`);
            await spawnAsync("npm", ["run", script], { cwd: itemDirectory });
        }
        // 2. Default fallback: Use esbuild if a buildEntry entry point is defined
        else if (packageData.buildEntry) {
            const outFile = path.join(itemDirectory, "index.workspace.js");

            const rawId = packageData.name || itemDirectory;
            const cleanId = rawId.replace('@xopat-npm-module/', '').replace(/[^a-zA-Z0-9_-]/g, '');
            // Determine Namespace
            let namespace = "xmodules";
            if (rawId.startsWith('@xopat-npm-module/')) namespace = "xnpm";
            else if (itemDirectory.includes(`${path.sep}plugins${path.sep}`)) namespace = "xplugins";

            const entryPoint = path.resolve(itemDirectory, packageData.buildEntry);
            logger.log(`[build] ${cleanId}: bundling into XOpat.${namespace}.${cleanId}`);

            await spawnAsync("npx", [
                "esbuild",
                entryPoint,
                "--bundle",
                "--format=iife",
                `--outfile=${outFile}`,
                "--sourcemap",
                "--minify", // Optional, but recommended for production
                `--global-name=window.${namespace}['${cleanId}']`,
                `--banner:js=window.${namespace} = window.${namespace} || {};`,
                `--footer:js=window.${namespace}['${cleanId}'] = window.${namespace}['${cleanId}'] || globalThis.__temp_bundle_export; delete globalThis.__temp_bundle_export;`
            ]);
        } else {
            logger.warn(`${logPrefix} No scripts or "buildEntry" entry point found. Skipping JS build.`);
        }

        // todo consider rebuilding only server parts that actually changed
        await buildServerEntries(itemDirectory, logger, logPrefix);

        // 3. Handle asset copying if defined
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

        const serverOutDir = path.join(itemDirectory, ".server-dist");
        if (fs.existsSync(serverOutDir)) {
            logger.log(`${logPrefix} removing ${serverOutDir}`);
            fs.rmSync(serverOutDir, { recursive: true, force: true });
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

    async buildUI(logger) {
        logger.log("[build] Compiling UI (ESM)...");
        return spawnAsync("npx", [
            "esbuild",
            "--bundle",
            "--sourcemap",
            "--format=esm",
            "--outfile=ui/index.js",
            "ui/index.mjs"
        ]);
    },

    async buildCore(logger) {
        logger.log("[build] Compiling Core (TypeScript)...");
        return spawnAsync("npx", [
            "esbuild",
            "src/**/*.ts",
            "--bundle",
            "--format=iife",
            "--target=es2019",
            "--outdir=src/dist",
            "--sourcemap"
        ]);
    },

    spawnAsync,
};

module.exports = BuildLogic;