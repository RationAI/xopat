"use strict";

/**
 * Grunt task: twinc-merge
 * - One full Tailwind run at first boot (uses your tailwind.config.js content).
 * - Afterwards, only watch specified files. For each change:
 *      -> compile utilities for just that file
 *      -> merge with the baseline CSS
 *      -> remove duplicate rules (PostCSS)
 *
 * NOTE: Classes that become unused won't be removed until a new full build.
 */

const chokidar = require("chokidar");
const micromatch = require("micromatch");
const globParent = require("glob-parent");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, exec} = require("child_process");
const postcss = require("postcss");
const discardDuplicates = require("postcss-discard-duplicates");
const mergeRules = require("postcss-merge-rules");
const cssnano = require("cssnano");
const esbuildArgs = require("../../esbuild-args");

const toPosix = (p) => p.replace(/\\/g, "/");
const abs = (root, p) => (path.isAbsolute(p) ? p : path.resolve(root, p));
const absPosix = (root, p) => toPosix(abs(root, p));
const exists = (p) => { try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; } };
const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });
const uniq = (a) => [...new Set(a)];
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

async function runTailwind({ grunt, configFile, inputCSS, outFile, contentGlobs, minify, inputOverride }) {
    const inputToUse = inputOverride || inputCSS;
    const args = ["-c", toPosix(configFile), "-i", toPosix(inputToUse), "-o", toPosix(outFile)];
    // For the initial full build we DO NOT pass --content (uses config's default).
    if (contentGlobs && contentGlobs.length) args.push("--content", contentGlobs.join(","));
    if (!minify) args.push("--no-minify");

    grunt.log.writeln(`[twinc-merge] npx tailwindcss ${args.join(" ")}`);
    await new Promise((resolve, reject) => {
        const child = spawn("npx", ["tailwindcss", ...args], { stdio: "inherit", shell: process.platform === "win32" });
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tailwindcss exited ${code}`))));
    });
}

async function postcssMergeAndMinify({ inputs, outFile, minify }) {
    const css = inputs.map((p) => fs.readFileSync(p, "utf8")).join("\n");
    const plugins = [discardDuplicates(), mergeRules()];
    if (minify) plugins.push(cssnano({ preset: ["default", { discardComments: { removeAll: true } }] }));
    const result = await postcss(plugins).process(css, { from: undefined });
    const tmp = `${outFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, result.css);
    fs.renameSync(tmp, outFile);
}

module.exports = function (grunt) {
    return function (mode = "watch") {
        const done = this.async();

        const cfg = grunt.config.get("twinc") || {};
        const root = path.resolve(process.cwd());
        const inputCSS   = abs(root, cfg.inputCSS   || "./src/assets/tailwind.css");
        const configFile = abs(root, cfg.configFile || "./tailwind.config.js");
        const outFile    = abs(root, cfg.outFile    || "./src/libs/tailwind.min.css");
        const cacheDir   = abs(root, "./.dev-cache");
        const baselineCss = path.join(cacheDir, "baseline.css"); // snapshot of the one-time full build
        const stateFile  = path.join(cacheDir, "state.json");
        const debounceMs = cfg.debounceMs ?? 150;
        const minify     = cfg.minify !== false; // default true
        const mmOpts     = { windows: false };

        const watchGlobs = process.env.WATCH_PATTERN ? [absPosix(root, process.env.WATCH_PATTERN)] :
            (cfg.watch || []).map((g) => absPosix(root, g));
        const ignoreGlobs = (cfg.ignore || []).map((g) => absPosix(root, g));
        if (!watchGlobs.length) return grunt.fail.fatal("[twinc-merge] Provide twinc.watch globs.");
        if (!exists(inputCSS))  return grunt.fail.fatal(`[twinc-merge] inputCSS not found: ${inputCSS}`);
        if (!exists(configFile))return grunt.fail.fatal(`[twinc-merge] configFile not found: ${configFile}`);

        ensureDir(cacheDir);

        // Per-file delta chunks
        const manifestPath = path.join(cacheDir, "manifest.json");
        let manifest = exists(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};
        const chunkPathFor = (fileAbsPosix) => path.join(cacheDir, `delta-${hash(fileAbsPosix)}.css`);

        async function fullBuildOnce() {
            // 1) One-time full build to OUTFILE (uses config's default content)
            grunt.log.writeln("[twinc-merge] Full build (one-time)...");
            await runTailwind({ grunt, configFile, inputCSS, outFile, contentGlobs: null, minify });

            // 2) Snapshot this as our baseline
            fs.copyFileSync(outFile, baselineCss);
            fs.writeFileSync(stateFile, JSON.stringify({ createdAt: Date.now() }, null, 2));
            grunt.log.ok("[twinc-merge] Baseline created.");
        }

        async function detectAndRebuildWorkspaceElements(files) {
            async function rebuildWorkspaceItem(childPath) {
                let itemPath = path.dirname(childPath);
                while (itemPath !== root && itemPath && itemPath.length > 4) {
                    const workspaceItem = path.join(itemPath, "package.json");
                    if (exists(workspaceItem)) {
                        // todo avoid parsing unless the file itself changed? cache somehow
                        const workspace = JSON.parse(fs.readFileSync(workspaceItem, "utf8"));
                        // todo in future let the workspace item redefine default build
                        // if (workspace.scripts?.build) {
                        //     grunt.log.writeln(`[twinc-merge] Rebuild workspace item ${workspaceItem}...`);
                        //     await new Promise((resolve, reject) => {
                        //         const child = spawn("npm", ["run", "dev"], { cwd: itemPath, stdio: "inherit", shell: process.platform === "win32" });
                        //         child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`npm run dev exited ${code}`))));
                        //     });
                        //     return;
                        // }
                        if (workspace["main"]) {
                            return new Promise((resolve, reject) => {
                                const child = spawn("npx", ["esbuild", ...esbuildArgs,
                                        `--outfile=${itemPath}/index.workspace.js`, `${itemPath}/${workspace["main"]}`],
                                    {stdio: "inherit", shell: process.platform === "win32"});
                                child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`npx esbuild exited ${code}`))));
                            });
                        } else {
                            grunt.log.warn(`[twinc-merge] No "main" field found in ${workspaceItem}.`);
                        }
                        break;
                    }
                    if (exists(path.join(itemPath, "include.json"))) {
                        break;
                    }
                    itemPath = path.dirname(itemPath);
                }
            }
            return Promise.all(files.map(rebuildWorkspaceItem));
        }

        async function rebuildUI() {
            // 1) One-time full build to OUTFILE (uses config's default content)
            grunt.log.writeln("[twinc-merge] Rebuild UI...");

            return new Promise((resolve, reject) => {
                const child = spawn("npx", ["esbuild", "--bundle", "--sourcemap", "--format=esm", "--outfile=ui/index.js", "ui/index.mjs"],
                    { stdio: "inherit", shell: process.platform === "win32" });
                child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`npx esbuild exited ${code}`))));
            });
        }

        async function buildDeltaFor(fileAbsPosix, chunkPath) {
            // Build utilities-only for that single file (fast)
            const tmp = path.join(cacheDir, "utils.input.css");

            if (!fs.existsSync(tmp)) {
                const srcCss = path.resolve(root, "src/assets/tailwind-spec.css");
                if (!fs.existsSync(srcCss)) {
                    throw new Error(`Tailwind build not found at ${srcCss}.`);
                }
                fs.mkdirSync(path.dirname(tmp), { recursive: true });
                fs.copyFileSync(srcCss, tmp);
            }

            await runTailwind({
                grunt,
                configFile,
                inputCSS,
                outFile: chunkPath,
                contentGlobs: [fileAbsPosix],
                minify,
                inputOverride: tmp,
            });
            try { fs.unlinkSync(tmp); } catch {}
        }

        async function mergeAll() {
            // Merge baseline + all current deltas, remove duplicates, write to outFile
            const inputs = [baselineCss, ...Object.keys(manifest).sort().map((f) => path.join(cacheDir, manifest[f]))]
                .filter((p) => exists(p));
            await postcssMergeAndMinify({ inputs, outFile, minify });
            grunt.log.ok(`[twinc-merge] Merged baseline + ${inputs.length - 1} delta(s) -> ${toPosix(outFile)}`);
        }

        const LOCK = path.join(cacheDir, ".full.lock");
        const lockExistsRecent = () => exists(LOCK) && (Date.now() - fs.statSync(LOCK).mtimeMs < 15 * 60 * 1000);

        async function ensureInitialOnce() {
            if (!exists(stateFile) || !exists(baselineCss) || !exists(outFile)) {
                if (lockExistsRecent()) { grunt.log.writeln("[twinc-merge] Full build in progress/recent; skipping."); return; }
                fs.writeFileSync(LOCK, String(Date.now()));
                try {
                    await fullBuildOnce();
                    return true;
                } finally {
                    try { fs.unlinkSync(LOCK); } catch {}
                }
                return false;
            }
        }

        // BUILD MODE (force a new baseline and exit)
        if (mode === "build") {
            (async () => {
                try {
                    try { fs.unlinkSync(stateFile); } catch {}
                    await ensureInitialOnce();
                    done();
                } catch (e) {
                    grunt.fail.warn(e.message);
                    done(false);
                }
            })();
            return;
        }

        // WATCH MODE
        (async () => {
            // Start watcher FIRST
            const watchRoots = uniq(watchGlobs.map(globParent));
            const watcher = chokidar.watch(watchRoots, {
                persistent: true,
                ignoreInitial: true,
                awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 75 },
                usePolling: cfg.usePolling || process.env.CHOKIDAR_USEPOLLING === "1",
                interval: Number(cfg.interval || process.env.CHOKIDAR_INTERVAL || 250),
                ignorePermissionErrors: true,
                ignored: [
                    toPosix(cacheDir + "/**"),
                    toPosix(path.dirname(outFile) + "/**"),
                    toPosix(outFile),
                    "**/node_modules/**",
                    "**/.git/**",
                    "**/.idea/**",
                ],
            });

            // Debounce/serialize
            let isBuilding = false;
            let flushTimer = null;
            const pendingFiles = new Set();
            let pendingNeedsUI = false;
            let pendingMergeOnly = false;

            function queueDelta(fileAbsPosix) {
                pendingFiles.add(fileAbsPosix);
                if (fileAbsPosix.includes('/ui/')) pendingNeedsUI = true; // posix path here
                scheduleFlush();
            }

            function queueMergeOnly() {
                pendingMergeOnly = true;
                scheduleFlush();
            }

            function scheduleFlush() {
                if (flushTimer) clearTimeout(flushTimer);
                flushTimer = setTimeout(runBuildCycle, debounceMs);
            }

            async function runBuildCycle(retry = true) {
                if (isBuilding && retry) return;               // don't drop; the pending flags/sets remain queued
                isBuilding = true;

                // take a snapshot of the current queue
                const files = Array.from(pendingFiles);
                pendingFiles.clear();
                const needUI = pendingNeedsUI;
                pendingNeedsUI = false;
                const mergeOnly = pendingMergeOnly;
                pendingMergeOnly = false;

                try {
                    // rebuild deltas for queued files
                    for (const f of files) {
                        const chunk = chunkPathFor(f);
                        await buildDeltaFor(f, chunk);
                        manifest[f] = path.relative(cacheDir, chunk);
                    }
                    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

                    // merge baseline + deltas (also when only unlink happened)
                    await mergeAll();

                    // one UI rebuild per cycle if any /ui/ file changed (no matter how many)
                    if (needUI) {
                        await rebuildUI();
                    }
                    await detectAndRebuildWorkspaceElements(files);
                } catch (e) {
                    grunt.log.error(e.message);
                    if (retry && e.message?.includes("ENOENT")) {
                        if (await ensureInitialOnce()) {
                            await runBuildCycle(false);
                        }
                    }
                } finally {
                    isBuilding = false;
                    // if more work arrived while we were building, run another cycle
                    if (pendingFiles.size || pendingNeedsUI || pendingMergeOnly) {
                        scheduleFlush();
                    }
                }
            }

            const matchesWatch = (file) => {
                const f = toPosix(file);
                if (ignoreGlobs.length && micromatch.isMatch(f, ignoreGlobs, mmOpts)) return false;
                return micromatch.isMatch(f, watchGlobs, mmOpts);
            };

            function onEvt(evt) {
                return (p) => {
                    const file = absPosix(root, p);
                    try { if (!fs.statSync(file).isFile()) return; } catch { return; }
                    if (!matchesWatch(file)) return;

                    grunt.log.writeln(`[twinc-merge] ${evt}: ${file}`);

                    if (evt === "unlink") {
                        const rel = manifest[file];
                        if (rel) {
                            try { fs.unlinkSync(path.join(cacheDir, rel)); } catch {}
                            delete manifest[file];
                            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
                        }
                        // If the removed file was under /ui/, ensure we also kick a UI bundle rebuild
                        if (file.includes('/ui/')) pendingNeedsUI = true;
                        queueMergeOnly();
                        return;
                    }

                    // add/change → queue delta; UI flag will be set inside queueDelta()
                    queueDelta(file);
                };
            }

            watcher
                .on("add", onEvt("add"))
                .on("change", onEvt("change"))
                .on("unlink", onEvt("unlink"))
                .on("ready", async () => {
                    const w = watcher.getWatched();
                    const dirCount = Object.keys(w).length;
                    const fileCount = Object.values(w).reduce((a, v) => a + v.length, 0);
                    for (const entry of watchRoots) {
                        grunt.log.writeln(`[twinc-merge] Watching ${entry}...`);
                    }
                    grunt.log.writeln(`[twinc-merge] Watched entries (dirs/files): ${dirCount}/${fileCount}`);
                    try { await ensureInitialOnce(); } catch (e) { grunt.fail.warn(e.message); }
                    grunt.log.ok("[twinc-merge] Watcher started.");
                })
                .on("error", (e) => grunt.log.error("[twinc-merge] watcher error:", e));
            // keep task alive
        })();
    };
};
