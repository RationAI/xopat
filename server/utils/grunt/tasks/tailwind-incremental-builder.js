// server/utils/grunt/tasks/tailwind-incremental.js
"use strict";

/**
 * Grunt task: twinc (Tailwind Incremental)
 *
 * Features:
 * - Watch multiple "parts" at once (ui/modules/etc)
 * - Rebuilds only the part whose files changed
 * - Absolute-glob watching (no cwd issues)
 * - Optional polling for WSL/Docker/NFS
 * - Debounced rebuilds
 *
 * Config example in Gruntfile shown below.
 */

const globParent = require('glob-parent');
const micromatch = require('micromatch');
const fg = require('fast-glob');
const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const toPosix = (p) => p.replace(/\\/g, '/');

function toAbs(p, root) {
    const neg = p.startsWith('!');
    const body = neg ? p.slice(1) : p;
    const abs = path.isAbsolute(body) ? body : path.resolve(root, body);
    const posix = toPosix(abs);
    return neg ? '!' + posix : posix;
}

function absGlobs(globs, root) {
    return (globs || []).map((g) => toAbs(g, root));
}

function unique(arr) { return [...new Set(arr)]; }

function matchesPart(file, partAbsContent, partAbsIgnore) {
    const f = toPosix(file); // normalize file path

    // micromatch ignores must be *plain* (no leading !)
    const ignorePlain = partAbsIgnore.map((g) => g.replace(/^!/, ''));

    // micromatch can work with posix paths; explicitly set windows flag if you like
    const micromatchOpts = { windows: false }; // we already normalized to posix

    if (ignorePlain.length && micromatch.isMatch(f, ignorePlain, micromatchOpts)) return false;
    return micromatch.isMatch(f, partAbsContent, micromatchOpts);
}

function runTailwind({ grunt, inputCSS, outFile, configFile, contentGlobs, ignoreGlobs, minify }) {

    return new Promise((resolve, reject) => {
        const posixContent = contentGlobs.map(toPosix);
        const posixIgnores = ignoreGlobs.map((g) => (g.startsWith('!') ? g : '!' + g)).map(toPosix);

        const args = [
            '-c', toPosix(configFile),
            '-i', toPosix(inputCSS),
            '-o', toPosix(outFile),
            '--content', [...posixContent, ...posixIgnores].join(','),
        ];
        if (!minify) args.push('--no-minify');

        grunt.log.writeln(`[twinc] tailwindcss ${args.join(" ")}`);

        const child = spawn("npx", ["tailwindcss", ...args], {
            stdio: "inherit",
            shell: process.platform === "win32", // help Windows users
        });

        child.on("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`tailwindcss exited with code ${code}`));
        });
    });
}

module.exports = function (grunt) {
    return function (mode = "watch") {
        const done = this.async();

        const cfg = grunt.config.get("twinc") || {};
        const root = path.resolve(process.cwd());
        const inputCSS = cfg.inputCSS || "./src/assets/tailwind-spec.css";
        const configFile = cfg.configFile || "./tailwind.config.js";
        const minify = cfg.minify !== false; // default true
        const debounceMs = cfg.debounceMs ?? 200;
        const usePolling = !!cfg.usePolling || process.env.CHOKIDAR_USEPOLLING === "1";
        const interval = Number(cfg.interval || process.env.CHOKIDAR_INTERVAL || 250);

        if (!Array.isArray(cfg.parts) || cfg.parts.length === 0) {
            grunt.fail.fatal("[twinc] No parts configured. Add twinc.parts in Gruntfile.");
            return;
        }

        // sanity checks
        const absInput = path.isAbsolute(inputCSS) ? inputCSS : path.resolve(root, inputCSS);
        const absConfig = path.isAbsolute(configFile) ? configFile : path.resolve(root, configFile);
        if (!fs.existsSync(absInput)) grunt.fail.fatal(`[twinc] inputCSS not found: ${absInput}`);
        if (!fs.existsSync(absConfig)) grunt.fail.fatal(`[twinc] configFile not found: ${absConfig}`);


        // 1) absolute, POSIX patterns
        const parts = cfg.parts.map((p) => ({
            name: p.name,
            outFile: path.isAbsolute(p.outFile) ? toPosix(p.outFile) : toPosix(path.resolve(root, p.outFile)),
            contentAbs: absGlobs(p.content, root),
            ignoreAbs:  absGlobs(p.ignore || [], root),
        }));

        const allContentAbs = unique(parts.flatMap(p => p.contentAbs));
        const allIgnorePlain = unique(parts.flatMap(p => p.ignoreAbs.map(g => g.replace(/^!/, ''))));

        if (mode === 'build') {
            (async () => {
                try {
                    for (const p of parts) {
                        await runTailwind({
                            grunt,
                            inputCSS: absInput,
                            outFile: p.outFile,
                            configFile: absConfig,
                            contentGlobs: p.contentAbs,
                            ignoreGlobs: p.ignoreAbs,
                            minify,
                        });
                        grunt.log.ok(`[twinc] Built: ${p.name} -> ${p.outFile}`);
                    }
                    done();
                } catch (e) {
                    grunt.fail.warn(e.message);
                    done(false);
                }
            })();
            return;
        }

// 2) derive real directories to watch (glob parents)
        const watchDirs = unique(allContentAbs.map(globParent)).map(toPosix);

// (Optional) sanity: ensure dirs exist; if not, walk up to first existing parent
        function nearestExistingDir(p) {
            const { sep } = path.posix;
            let cur = p;
            while (cur && cur !== sep && cur.length > 1 && !require('fs').existsSync(cur)) {
                cur = cur.slice(0, cur.lastIndexOf(sep)) || sep;
            }
            return cur;
        }
        const watchRoots = unique(watchDirs.map(nearestExistingDir));

// 3) pre-scan (for your “68 files” debug)
        (async () => {
            const files = await fg(allContentAbs, { ignore: allIgnorePlain, onlyFiles: true, dot: false });
            grunt.log.writeln(`[twinc] Pre-scan matched ${files.length} file(s).`);
        })();

// 4) start watcher on directories (not the glob patterns)
        const watcher = chokidar.watch(watchRoots, {
            persistent: true,
            ignoreInitial: false, // see initial adds, helps confirm roots
            awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 75 },
            usePolling: cfg.usePolling || process.env.CHOKIDAR_USEPOLLING === '1',
            interval: Number(cfg.interval || process.env.CHOKIDAR_INTERVAL || 250),
            ignorePermissionErrors: true,
        });

        // Debounced per-part build scheduler
        const scheduled = new Map(); // name -> timeout
        function scheduleBuild(part) {
            const prev = scheduled.get(part.name);
            if (prev) clearTimeout(prev);
            const t = setTimeout(async () => {
                scheduled.delete(part.name);
                try {
                    await runTailwind({
                        grunt,
                        inputCSS: absInput,
                        outFile: part.outFile,
                        configFile: absConfig,
                        contentGlobs: part.contentAbs,
                        ignoreGlobs: part.ignoreAbs,
                        minify,
                    });
                    grunt.log.ok(`[twinc] Rebuilt: ${part.name} -> ${part.outFile}`);
                } catch (err) {
                    grunt.log.error(`[twinc] ${part.name} build failed: ${err.message}`);
                }
            }, debounceMs);
            scheduled.set(part.name, t);
        }

// 5) log watched dirs/files
        watcher.on('ready', () => {
            const watched = watcher.getWatched();
            const dirCount = Object.keys(watched).length;
            const fileCount = Object.values(watched).reduce((a, arr) => a + arr.length, 0);
            grunt.log.writeln('[twinc] Watcher ready.');
            grunt.log.writeln(`[twinc] Watched entries (dirs/files): ${dirCount}/${fileCount}`);
            grunt.log.writeln('[twinc] Roots:'); watchRoots.forEach(r => grunt.log.writeln('  ' + r));

            if (mode === 'watch' && cfg.initialBuild !== false) {
                parts.forEach((p) => scheduleBuild(p));
            }
        });

// 6) filter events against your original globs (contentAbs/ignoreAbs)
        const mmOpts = { windows: false };
        const matchesAnyPart = (file) => {
            const f = toPosix(file);
            if (allIgnorePlain.length && micromatch.isMatch(f, allIgnorePlain, mmOpts)) return null;
            for (const part of parts) {
                if (micromatch.isMatch(f, part.contentAbs, mmOpts)) return part;
            }
            return null;
        };

        const onEvt = (evt) => async (file) => {
            const part = matchesAnyPart(file);
            if (!part) return;
            grunt.log.writeln(`[twinc] ${evt}: ${toPosix(file)} -> ${part.name}`);
            scheduleBuild(part);
        };

        watcher
            .on('add', onEvt('add'))
            .on('change', onEvt('change'))
            .on('unlink', onEvt('unlink'))
            .on('error', (e) => grunt.log.error('[twinc] watcher error:', e));



        // // normalize parts
        // const parts = cfg.parts.map((p) => {
        //     const name = p.name || "part";
        //     const outFile = path.isAbsolute(p.outFile) ? p.outFile : path.resolve(root, p.outFile);
        //     const contentAbs = absGlobs(p.content, root);
        //     const ignoreAbs = absGlobs(p.ignore || [], root);
        //     return { name, outFile, contentAbs, ignoreAbs };
        // });
        //
        // const allContentAbs = [...new Set(parts.flatMap((p) => p.contentAbs))];
        // const allIgnoreAbs = [...new Set(parts.flatMap((p) => p.ignoreAbs))];
        //
        // // BUILD-ONLY MODE
        // if (mode === "build") {
        //     (async () => {
        //         try {
        //             for (const p of parts) {
        //                 await runTailwind({
        //                     grunt,
        //                     inputCSS: absInput,
        //                     outFile: p.outFile,
        //                     configFile: absConfig,
        //                     contentGlobs: p.contentAbs,
        //                     ignoreGlobs: p.ignoreAbs,
        //                     minify,
        //                 });
        //                 grunt.log.ok(`[twinc] Built: ${p.name} -> ${p.outFile}`);
        //             }
        //             done();
        //         } catch (err) {
        //             grunt.fail.warn(err.message);
        //             done(false);
        //         }
        //     })();
        //     return;
        // }
        //
        // // WATCH MODE
        // // Pre-scan to validate globs
        // (async () => {
        //     const ignorePlain = allIgnoreAbs.map((g) => g.replace(/^!/, '')); // strip !
        //     // patterns/ignores are already absolute+posix from absGlobs()
        //     const files = await fg(allContentAbs, {
        //         ignore: ignorePlain,
        //         onlyFiles: true,
        //         dot: false,
        //         followSymbolicLinks: true,
        //         unique: true,
        //     });
        //     grunt.log.writeln(`[twinc] Pre-scan matched ${files.length} file(s).`);
        //     if (files.length === 0) {
        //         // quick hints
        //         grunt.log.writeln('[twinc] Debug: first few content patterns:');
        //         allContentAbs.slice(0, 5).forEach((p) => grunt.log.writeln('  ' p));
        //     }
        // })();
        //
        // const watcher = chokidar.watch(allContentAbs, {
        //     persistent: true,
        //     ignoreInitial: false, // initial "add" helps getWatched() sanity
        //     ignored: allIgnoreAbs,
        //     awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 75 },
        //     usePolling,
        //     interval,
        //     ignorePermissionErrors: true,
        // });
        //
        // const scheduled = new Map(); // name -> timeout
        //
        // function scheduleBuild(part) {
        //     const prev = scheduled.get(part.name);
        //     if (prev) clearTimeout(prev);
        //     const t = setTimeout(async () => {
        //         scheduled.delete(part.name);
        //         try {
        //             await runTailwind({
        //                 grunt,
        //                 inputCSS: absInput,
        //                 outFile: part.outFile,
        //                 configFile: absConfig,
        //                 contentGlobs: part.contentAbs,
        //                 ignoreGlobs: part.ignoreAbs,
        //                 minify,
        //             });
        //             grunt.log.ok(`[twinc] Rebuilt: ${part.name}`);
        //         } catch (err) {
        //             grunt.log.error(`[twinc] ${part.name} build failed: ${err.message}`);
        //         }
        //     }, debounceMs);
        //     scheduled.set(part.name, t);
        // }
        //
        // watcher.on("ready", () => {
        //     const watched = watcher.getWatched();
        //     const dirCount = Object.keys(watched).length;
        //     const fileCount = Object.values(watched).reduce((acc, arr) => acc + arr.length, 0);
        //     grunt.log.writeln("[twinc] Watcher ready.");
        //     grunt.log.writeln(`[twinc] Watched entries (dirs/files): ${dirCount}/${fileCount}`);
        //     grunt.log.writeln("[twinc] Watching (abs globs):");
        //     allContentAbs.forEach((g) => grunt.log.writeln("  " + g));
        //     if (allIgnoreAbs.length) {
        //         grunt.log.writeln("[twinc] Ignoring (abs globs):");
        //         allIgnoreAbs.forEach((g) => grunt.log.writeln("  " + g));
        //     }
        // });
        //
        // const onChange = (evt) => (file) => {
        //     grunt.log.writeln(`[twinc] ${evt}: ${file}`);
        //     for (const part of parts) {
        //         if (matchesPart(file, part.contentAbs, part.ignoreAbs.map((g) => g.replace(/^!/, "")))) {
        //             scheduleBuild(part);
        //         }
        //     }
        // };
        //
        // watcher
        //     .on("add", onChange("add"))
        //     .on("change", onChange("change"))
        //     .on("unlink", onChange("unlink"))
        //     .on("error", (err) => grunt.log.error("[twinc] watcher error:", err));

        // Keep the task alive
        // (Grunt will keep running since we don't call done(); Ctrl+C to exit)
    };
};
