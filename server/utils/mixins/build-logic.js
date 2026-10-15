"use strict";

const crossSpawn = require("cross-spawn");
const path = require("path");
const fs = require("fs");
const glob = require("glob");

// We route every child process through `cross-spawn` instead of the bare
// `child_process.spawn`. Two reasons:
//   1) Security — the original code flattened cmd + args into a single
//      shell string and wrapped each arg in `"..."`, which allowed
//      embedded double-quotes to break out of cmd.exe quoting and
//      execute arbitrary commands. `cross-spawn` does the correct
//      libuv-style escaping per argument.
//   2) Compatibility — Node 20+ refuses to spawn `.cmd` / `.bat` shims
//      (npm, npx, tailwindcss, …) without `shell: true`, throwing
//      `EINVAL`. `cross-spawn` invokes `cmd.exe /d /s /c` with the
//      escaped command line itself, so we don't pass `shell: true`
//      and don't lose argv quoting safety either.
function spawnAsync(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = crossSpawn(cmd, args, {
            stdio: "inherit",
            ...opts,
        });

        child.on("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} exited ${code}`));
        });

        child.on("error", (err) => reject(err));
    });
}

// Reject any string heading into a child-process argv that contains shell
// metacharacters, control bytes, or attempts directory traversal. The argv
// path is shell-free since we drop shell:true above, but defense-in-depth
// keeps malicious workspace items from injecting esbuild flags either.
const UNSAFE_ARG_CHARS = /[\x00-\x1f"`$&|;<>\r\n]/;

function isSafeRelativeEntry(value, baseDir) {
    if (typeof value !== "string" || value.length === 0) return false;
    if (UNSAFE_ARG_CHARS.test(value)) return false;
    if (path.isAbsolute(value)) return false;
    const resolved = path.resolve(baseDir, value);
    const rel = path.relative(baseDir, resolved);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
    return true;
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
 * Files a workspace bundle is built from, for a freshness comparison.
 *
 * Everything the item ships EXCEPT the build outputs themselves — an artifact
 * that counted as its own source would always look fresh — and except the
 * directories no bundle reads from.
 */
function collectWorkspaceSources(itemDirectory) {
    const found = [];
    function walk(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch { return; /* unreadable directory cannot make a bundle stale */ }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (
                    entry.name === "node_modules" ||
                    entry.name === ".git" ||
                    entry.name === ".server-dist" ||
                    entry.name === "test"
                ) continue;
                walk(full);
            } else if (
                !/^index\.workspace\./i.test(entry.name) &&
                !/\.map$/i.test(entry.name) &&
                !/\.min\.(js|mjs|css)$/i.test(entry.name)
            ) {
                found.push(full);
            }
        }
    }
    if (fs.existsSync(itemDirectory)) walk(itemDirectory);
    return found;
}

/**
 * Is this workspace item's bundle older than what it was built from?
 *
 * The dev watcher only rebuilds an item when chokidar reports a change, so any
 * edit made while it was NOT running — a `git checkout`, a merge, work done on
 * another machine — leaves the artifact behind forever. The app then runs the
 * previous commit's code with nothing in the page or the logs to say so, which
 * is close to undiagnosable from the browser (it presented as a `TypeError` in
 * a function whose source had already been fixed). Answering this question at
 * watcher startup is what closes that hole.
 *
 * @param {string} itemDirectory workspace item root
 * @param {object} packageData its parsed package.json
 * @returns {{stale: boolean, artifact: string, newestSource: string|null}}
 */
function inspectWorkspaceBundle(itemDirectory, packageData) {
    const artifact = path.join(itemDirectory, "index.workspace.js");
    const buildable = !!(packageData && (
        packageData.buildEntry ||
        (packageData.scripts && (packageData.scripts.dev || packageData.scripts.build))
    ));
    if (!buildable) return { stale: false, artifact, newestSource: null };

    let builtAt;
    try {
        builtAt = fs.statSync(artifact).mtimeMs;
    } catch {
        // Never built. A `scripts.build` item may legitimately emit something
        // else, but building it again is cheap and idempotent.
        return { stale: true, artifact, newestSource: null };
    }

    let newestSource = null;
    let newestAt = 0;
    for (const file of collectWorkspaceSources(itemDirectory)) {
        let mtimeMs;
        try { ({ mtimeMs } = fs.statSync(file)); } catch { continue; }
        if (mtimeMs > newestAt) { newestAt = mtimeMs; newestSource = file; }
    }
    return { stale: newestAt > builtAt, artifact, newestSource };
}

/**
 * Server-side bundling.
 *
 * This is the release-critical half of the build: a packaged binary carries no
 * esbuild and a read-only filesystem, so anything not built here cannot be
 * compiled later — an element's RPC simply answers `RPC_UNKNOWN_METHOD`.
 *
 * It used to live inside `buildWorkspaceItem`, which made it ineffective three
 * ways: it ran only for items with a `package.json` (skipping every element that
 * ships only an `include.json`), it wrote no `.meta.json` so the runtime
 * discarded each artifact and rebuilt it, and it emitted bundles without the
 * `createRequire` banner. It is now one task over every element, using the
 * loader's own discovery, naming, options and freshness rule.
 */
const serverLoader = require("../../node/server-module-loader");

/**
 * An element's declared server build options, from `include.json`:
 *
 *   "server": { "external": ["sharp"], "assets": ["vendor/**\/*.node"] }
 *
 * `external` is for what cannot be inlined — a native addon, or a dependency
 * that must stay resolvable at runtime. The named package is copied next to the
 * bundle so the import resolves both in a source tree and inside a snapshot,
 * where the hoisted root `node_modules` does not exist. Deployment-trusted
 * config by construction (`include.json`), never a session value.
 */
function readServerDeclaration(itemDirectory) {
    let include = {};
    try {
        include = require("comment-json").parse(
            fs.readFileSync(path.join(itemDirectory, "include.json"), "utf8"));
    } catch { /* no include.json, or unparseable — the scan reports that already */ }
    const block = include && typeof include.server === "object" ? include.server : {};
    const list = (value) => (Array.isArray(value) ? value.filter(v => typeof v === "string") : []);
    return { external: list(block.external), assets: list(block.assets) };
}

/** Copy a declared-external package next to the bundle so it resolves there too. */
function vendorExternal(name, itemDirectory, outDir, logger, logPrefix) {
    let pkgRoot;
    try {
        pkgRoot = path.dirname(require.resolve(`${name}/package.json`,
            { paths: [itemDirectory, process.cwd()] }));
    } catch {
        throw new Error(`declared server.external "${name}" cannot be resolved`);
    }
    const target = path.join(outDir, "node_modules", name);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(pkgRoot, target, { recursive: true, dereference: true });
    logger.log(`${logPrefix} vendored external ${name}`);
}

/**
 * Build every server entry of every element and write the manifest.
 *
 * A failure is fatal, not degraded: in a source tree an unbuildable entry turns
 * into a runtime retry, but in a release there is no later attempt — so a build
 * that cannot produce an artifact must not produce a release either.
 *
 * @param {Array<{kind: string, directory: string}>} items element descriptors
 * @param logger grunt-style logger
 */
async function buildAllServerEntries(items, logger) {
    const esbuild = require("esbuild");
    const buildKey = serverLoader.getBuildKey();
    const manifest = {
        formatVersion: serverLoader.BUILD_FORMAT_VERSION,
        format: serverLoader.BUILD_FORMAT,
        buildKey,
        builtAt: new Date().toISOString(),
        elements: {},
    };
    const failures = [];
    let built = 0;
    let fresh = 0;

    for (const item of items) {
        const itemDirectory = item.directory;
        const entries = serverLoader.walkForServerFiles(itemDirectory);
        if (!entries.length) continue;

        const logPrefix = `[server-build] ${item.kind}:${item.id}:`;
        const declaration = readServerDeclaration(itemDirectory);
        const outDir = path.join(itemDirectory, serverLoader.SERVER_BUILD_DIR);
        const records = [];

        for (const name of declaration.external) {
            try {
                vendorExternal(name, itemDirectory, outDir, logger, logPrefix);
            } catch (e) {
                failures.push(`${item.kind}:${item.id}: ${e.message}`);
            }
        }

        for (const sourceFile of entries) {
            const outFile = serverLoader.builtServerPath(itemDirectory, sourceFile);
            const rel = path.relative(itemDirectory, sourceFile);
            records.push({
                source: serverLoader.toManifestPath(sourceFile),
                artifact: serverLoader.toManifestPath(outFile),
                ...(declaration.external.length ? { external: declaration.external } : {}),
            });

            // The runtime's own freshness rule, imported rather than restated:
            // it covers the whole input graph, so editing a file the entry
            // imports rebuilds (an entry-mtime-only check reported "up to date"
            // and shipped the previous bundle).
            if (serverLoader.isArtifactFresh(sourceFile, outFile, buildKey)) {
                fresh++;
                continue;
            }

            try {
                fs.mkdirSync(path.dirname(outFile), { recursive: true });
                const result = await esbuild.build(serverLoader.serverBuildOptions({
                    file: sourceFile,
                    outfile: outFile,
                    external: declaration.external,
                    logLevel: "warning",
                }));
                // Meta LAST: it is the freshness signal, so it must never claim
                // an artifact that is not on disk yet.
                serverLoader.writeArtifactMeta(outFile, {
                    entryFile: sourceFile,
                    buildKey,
                    inputs: serverLoader.collectBuildInputs(result.metafile, outFile),
                });
                built++;
                logger.log(`${logPrefix} built ${rel}`);
            } catch (e) {
                failures.push(`${item.kind}:${item.id}/${rel}: ${e.message}`);
            }
        }

        manifest.elements[`${item.kind}/${item.id}`] = {
            kind: item.kind,
            id: item.id,
            rootDir: serverLoader.toManifestPath(itemDirectory),
            entries: records,
            ...(declaration.assets.length ? { assets: declaration.assets } : {}),
        };
    }

    // The shared role resolver: `server/node/roles.js` requires this artifact
    // rather than transforming the TypeScript at runtime, which is what made
    // role capabilities unresolvable in every packaged build.
    const rolesOut = path.join(__dirname, "..", "..", "..", "src", "dist", "user-roles-core.cjs");
    const rolesSrc = path.join(__dirname, "..", "..", "..", "src", "classes", "user-roles-core.ts");
    try {
        if (serverLoader.isArtifactFresh(rolesSrc, rolesOut, buildKey)) {
            fresh++;
        } else {
            fs.mkdirSync(path.dirname(rolesOut), { recursive: true });
            // `bundle: false` on purpose: the source is deliberately
            // dependency-free, and bundling would hide a future stray import
            // instead of surfacing it.
            const rolesResult = await esbuild.build({
                entryPoints: [rolesSrc], outfile: rolesOut, bundle: false,
                platform: "node", format: "cjs", target: "node22",
                metafile: true, absWorkingDir: path.resolve(__dirname, "..", "..", ".."),
                logLevel: "warning",
            });
            serverLoader.writeArtifactMeta(rolesOut, {
                entryFile: rolesSrc,
                buildKey,
                inputs: serverLoader.collectBuildInputs(rolesResult.metafile, rolesOut),
            });
            built++;
            logger.log(`[server-build] core: built src/dist/user-roles-core.cjs`);
        }
    } catch (e) {
        failures.push(`core/user-roles-core: ${e.message}`);
    }

    if (failures.length) {
        throw new Error(`server build failed for ${failures.length} entr${failures.length === 1 ? "y" : "ies"}:\n  `
            + failures.join("\n  "));
    }

    serverLoader.writeServerBuildManifest(manifest);
    logger.log(`[server-build] ${built} built, ${fresh} up to date, `
        + `${Object.keys(manifest.elements).length} elements with server code`);
    return manifest;
}

/**
 * Portable logic to build, copy, or clean workspace items.
 */
const BuildLogic = {
    buildAllServerEntries,

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
            if (!isSafeRelativeEntry(packageData.buildEntry, itemDirectory)) {
                logger.error(`${logPrefix} refusing to build: "buildEntry" must be a safe relative path inside the workspace item (got ${JSON.stringify(packageData.buildEntry)}).`);
                return;
            }

            const outFile = path.join(itemDirectory, "index.workspace.js");

            const rawId = packageData.name || itemDirectory;
            const cleanId = rawId.replace('@xopat-npm-module/', '').replace(/[^a-zA-Z0-9_-]/g, '');
            // Determine Namespace - for now only npm modules are exported automatically
            let namespace = false;
            if (rawId.startsWith('@xopat-npm-module/')) namespace = "xnpm";

            const entryPoint = path.resolve(itemDirectory, packageData.buildEntry);
            logger.log(`[build] ${rawId}: bundling entry point ${packageData.buildEntry}`);
            const buildArgs = [
                "esbuild",
                entryPoint,
                "--bundle",
                "--format=iife",
                `--outfile=${outFile}`,
                "--sourcemap",
                "--minify", // Optional, but recommended for production
            ];
            if (namespace) buildArgs.push(
                `--global-name=window.${namespace}['${cleanId}']`,
                `--banner:js=window.${namespace} = window.${namespace} || {};`,
                `--footer:js=window.${namespace}['${cleanId}'] = window.${namespace}['${cleanId}'] || globalThis.__temp_bundle_export; delete globalThis.__temp_bundle_export;`
            );
            await spawnAsync("npx", buildArgs);

            // Production single-file artifact. Only fabricated here, in the
            // esbuild `--minify` branch, where we KNOW the output is minified —
            // so `index.workspace.min.js` (what printDependencies/prodIncludes
            // look for in production) is a faithful copy. Custom `scripts.*`
            // builds and prebuilt-shipped bundles are NOT copied, since we can't
            // assume they are minified; such items must ship their own
            // index.workspace.min.js or they fall back to raw serving. (.mjs
            // workspace bundles are served as-is and need no classic min copy.)
            if (fs.existsSync(outFile)) {
                fs.copyFileSync(outFile, path.join(itemDirectory, "index.workspace.min.js"));
                logger.log(`${logPrefix} wrote index.workspace.min.js`);
            }
        } else {
            logger.log(`${logPrefix} No scripts or "buildEntry" entry point found. Skipping JS build.`);
        }

        // Server entries are NOT built here any more: they are one task over
        // every element (`grunt serverBuild` → buildAllServerEntries), because
        // this function only runs for items that have a `package.json` and three
        // elements shipping server code have only an `include.json`.

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

        // Remove default build artifact + its production min copy
        for (const artifact of ["index.workspace.js", "index.workspace.min.js"]) {
            const p = path.join(itemDirectory, artifact);
            if (fs.existsSync(p)) {
                logger.log(`${logPrefix} removing ${p}`);
                fs.unlinkSync(p);
            }
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

    /**
     * Bundle a NON-workspace item's `.mjs` includes into a single minified ESM
     * file `index.min.mjs` (served as `type="module"` in production). A single
     * `.mjs` include is bundled directly; multiple independent module scripts
     * are sequenced through a generated wrapper that imports each in order, so
     * side-effect order matches loading them as separate module scripts. Item
     * globals (USER_INTERFACE, VIEWER_MANAGER, …) are left as global refs by
     * esbuild; only real `import`s are inlined. On failure the artifact is
     * absent and serving falls back to raw `.mjs` per file.
     * @param {string} itemDirectory
     * @param {string[]} moduleIncludes ordered relative `.mjs` paths to bundle
     */
    async buildItemModuleBundle(itemDirectory, moduleIncludes, logger) {
        if (!Array.isArray(moduleIncludes) || moduleIncludes.length === 0) return;
        const outFile = path.join(itemDirectory, "index.min.mjs");
        // Remove any prior artifact up front, so a failed (re)build leaves it
        // ABSENT — production then falls back to raw `.mjs` per file instead of
        // silently serving a stale bundle (matches the documented behavior).
        for (const stale of [outFile, outFile + ".map"]) {
            if (fs.existsSync(stale)) fs.unlinkSync(stale);
        }
        let entry, tmp = null;
        if (moduleIncludes.length === 1) {
            entry = path.join(itemDirectory, moduleIncludes[0]);
        } else {
            tmp = path.join(itemDirectory, ".xopat-mjs-entry.mjs");
            fs.writeFileSync(tmp, moduleIncludes.map(f => `import ${JSON.stringify("./" + f)};`).join("\n") + "\n");
            entry = tmp;
        }
        try {
            // No --target downlevel: these are served natively as ES modules
            // (type="module"), and the raw `.mjs` already run untransformed, so
            // downleveling (which e.g. blanks out `import.meta.url`) would change
            // behavior. esbuild defaults to esnext, preserving the source syntax.
            await spawnAsync("npx", [
                "esbuild", entry, "--bundle", "--format=esm", "--minify",
                "--sourcemap", `--outfile=${outFile}`
            ]);
            logger.log(`[build] wrote ${outFile}`);
        } finally {
            if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp);
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
        await spawnAsync("npx", [
            "esbuild",
            "src/**/*.ts",
            "--bundle",
            "--format=iife",
            "--target=es2019",
            "--outdir=src/dist",
            "--sourcemap"
        ]);

        // Production single-file core. The per-file dev build above stays the
        // dev serving path; here we additionally concatenate the ordered core
        // scripts (from config.json `js.src`) into one minified bundle served by
        // requireCore in production. If this fails the artifact is simply absent
        // and serving falls back per-file, so it never blocks a build.
        try {
            await BuildLogic.buildCoreBundle(logger);
        } catch (e) {
            logger.error ? logger.error(`[build] core bundle skipped: ${e && e.message || e}`)
                : logger.log(`[build] core bundle skipped: ${e && e.message || e}`);
        }
    },

    /**
     * Concatenate the ordered core JS (config.json `js.src`: loader → deps →
     * app, dist IIFE outputs + the hand-authored classic scripts) in exact load
     * order and minify to src/dist/xopat-core.min.js. Concatenation (not module
     * bundling) preserves the classic multi-script execution + global-assignment
     * semantics; esbuild `--minify` will fail loudly on a genuine duplicate
     * top-level declaration rather than silently miscompile.
     */
    async buildCoreBundle(logger) {
        const CommentJSON = require("comment-json");
        const distDir = path.join("src", "dist");
        const outFile = path.join(distDir, "xopat-core.min.js");
        // Remove any prior bundle up front, so every early-exit / failure path
        // below leaves it ABSENT — production then falls back to per-file core
        // serving instead of shipping a stale bundle.
        for (const stale of [outFile, outFile + ".map"]) {
            if (fs.existsSync(stale)) fs.unlinkSync(stale);
        }

        const configPath = path.join("src", "config.json");
        if (!fs.existsSync(configPath)) return;
        const config = CommentJSON.parse(fs.readFileSync(configPath, "utf8"), null, true);
        const src = (config && config.js && config.js.src) || {};
        const ordered = [...(src.loader || []), ...(src.deps || []), ...(src.app || [])];
        if (!ordered.length) { logger.log("[build] core bundle: empty js.src, skipped"); return; }

        let combined = "";
        for (const rel of ordered) {
            const p = path.join("src", rel);
            if (!fs.existsSync(p)) {
                logger.log(`[build] core bundle: missing ${rel} — skipping bundle`);
                return; // never emit a partial bundle
            }
            // Leading `;` + newline guards against ASI hazards when a file that
            // ends without a semicolon is followed by one starting with ( or [.
            combined += `\n;/* ${rel} */\n${fs.readFileSync(p, "utf8")}\n`;
        }

        if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
        const tmp = path.join(distDir, ".xopat-core.bundle.js");
        fs.writeFileSync(tmp, combined);
        try {
            await spawnAsync("npx", [
                "esbuild", tmp, "--minify", "--target=es2019",
                `--outfile=${outFile}`
            ]);
            logger.log("[build] wrote src/dist/xopat-core.min.js");
        } finally {
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        }
    },

    inspectWorkspaceBundle,

    spawnAsync,
};

module.exports = BuildLogic;