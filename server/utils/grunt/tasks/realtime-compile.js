"use strict";

/**
 * Grunt task: twinc-merge
 * - One full Tailwind run at first boot (uses your tailwind.config.js content).
 * - Afterwards, only watch specified files. For each change:
 *      -> compile a chunk for just that file
 *      -> merge it onto the baseline CSS, LAYER BY LAYER
 *      -> minify (PostCSS/cssnano)
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
const mergeRules = require("postcss-merge-rules");
const cssnano = require("cssnano");

const { buildWorkspaceItem, buildUI, buildCore, inspectWorkspaceBundle } = require("../../mixins/build-logic");
const {pathsEqual} = require("../../mixins/pathsEqual");

const toPosix = (p) => p.replace(/\\/g, "/");
const abs = (root, p) => (path.isAbsolute(p) ? p : path.resolve(root, p));
const absPosix = (root, p) => toPosix(abs(root, p));
const exists = (p) => { try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; } };
const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });
const uniq = (a) => [...new Set(a)];
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
const nodeLogger = {
    log: (msg) => console.log(msg),
    warn: (msg) => console.warn(msg),
    error: (msg) => console.error(msg)
};

async function runTailwind({ grunt, configFile, inputCSS, outFile, contentGlobs, minify, inputOverride }) {
    const inputToUse = inputOverride || inputCSS;
    const args = [
        "-c", `"${toPosix(configFile)}"`,
        "-i", `"${toPosix(inputToUse)}"`,
        "-o", `"${toPosix(outFile)}"`
    ];

    if (contentGlobs && contentGlobs.length) {
        // Content globs also need to be quoted if they contain spaces
        const quotedGlobs = contentGlobs.map(g => `"${toPosix(g)}"`).join(",");
        args.push("--content", quotedGlobs);
    }
    if (!minify) args.push("--no-minify");

    grunt.log.writeln(`[twinc-merge] npx tailwindcss ${args.join(" ")}`);
    await new Promise((resolve, reject) => {
        const child = spawn("npx", ["tailwindcss", ...args], { stdio: "inherit", shell: process.platform === "win32" });
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tailwindcss exited ${code}`))));
    });
}

/**
 * The layer sentinels emitted by src/assets/tailwind-spec.css. See the header
 * comment there for why they exist and why they are plain (non-bang) comments.
 */
const LAYER_MARKER = /^twinc-layer:(base|components|utilities|end)$/;
/** Emission order. `pre`/`post` hold anything outside the sentinels. */
const SEGMENTS = ["pre", "base", "components", "utilities", "post"];
const hasLayerMarkers = (css) => css.includes("twinc-layer:");

/**
 * Split one compiled chunk into its Tailwind layers.
 *
 * Chunks are produced by two different calls (fullBuildOnce writes the
 * baseline, buildDeltaFor writes a per-file delta) but both feed the CLI the
 * same input file, so both carry the same four sentinels. The markers
 * themselves are dropped - they must not survive into the served artifact.
 */
function splitLayerSegments(root) {
    const out = { pre: [], base: [], components: [], utilities: [], post: [] };
    let current = "pre";
    for (const node of root.nodes || []) {
        if (node.type === "comment") {
            const m = LAYER_MARKER.exec(node.text.trim());
            if (m) { current = m[1] === "end" ? "post" : m[1]; continue; }
        }
        out[current].push(node);
    }
    return out;
}

/**
 * Conditional group rules, which are containers rather than values: two chunks
 * emitting `@media (hover:hover)` are emitting the SAME block with different
 * subsets of children, so they must be merged, not appended side by side.
 * `@keyframes` / `@font-face` / `@property` are deliberately absent - their
 * bodies are a unit and are compared whole.
 */
const GROUPING_AT_RULES = new Set(["media", "supports", "container"]);
const squash = (s) => s.replace(/\s+/g, " ").trim();
const newMergeState = () => ({ seen: new Set(), groups: new Map(), nested: new Map() });

/**
 * Move `nodes` into `container`, merging group rules and skipping what is
 * already there.
 *
 * `filter` is false for the baseline (it is authoritative and may legitimately
 * repeat a selector in order to override it) and true for every later chunk.
 * Either way the keys are recorded, so a delta is compared against the
 * baseline too. Keys are per-container, so `.p-2` inside `@media print` never
 * shadows the top-level `.p-2`.
 */
function mergeNodesInto(container, nodes, filter, state) {
    for (const node of nodes) {
        if (node.type === "atrule" && GROUPING_AT_RULES.has(node.name.toLowerCase())) {
            const key = `@${node.name} ${squash(node.params)}`;
            let target = state.groups.get(key);
            if (!target) {
                target = node.clone();
                target.removeAll();
                container.append(target);
                state.groups.set(key, target);
                state.nested.set(key, newMergeState());
            }
            mergeNodesInto(target, [...node.nodes], filter, state.nested.get(key));
            continue;
        }
        const key = squash(node.toString());
        if (filter && state.seen.has(key)) continue;
        state.seen.add(key);
        container.append(node);
    }
}

/**
 * Merge chunks BY LAYER, not by concatenation.
 *
 * Every delta is a complete build of tailwind-spec.css scoped to one content
 * file, so it re-emits preflight plus whatever DaisyUI components that file
 * mentions. Joining the files as text put those components after the
 * baseline's utilities, and `postcss-discard-duplicates` then made it stick:
 * it walks BACKWARDS and strips the declarations from the EARLIER copy, so the
 * baseline's correctly placed `.btn` was gutted and the relocated one survived.
 * Same specificity, later wins -> `.btn`'s own colour and padding beat every
 * `text-*` / `p-*` utility on the same element.
 *
 * So: bucket each chunk, emit all `base` before any `components` before any
 * `utilities`, and dedupe KEEP-FIRST across chunks. Keep-first matters as much
 * as the bucketing - keeping the last copy would also relocate a utility
 * within its own layer, and Tailwind's intra-layer order is meaningful
 * (`.p-2` must precede `.pt-1`). The baseline is authoritative; a delta only
 * contributes what the baseline does not already have, verbatim.
 *
 * Dedupe is exact-string and only ACROSS chunks, never within one: the spec
 * file deliberately declares `.er-control__input--colormap` twice so the
 * second overrides the first, and each chunk reproduces that pair identically.
 *
 * cssnano is ~70 % of this merge (measured: 1228 ms vs 372 ms on baseline +
 * 17 deltas), and the merge runs on every save.
 *
 * It stays ON by default anyway, because `outFile` is `src/libs/tailwind.min.css`
 * - a tracked file that the deployment serves as-is. The tailwind CLI is never
 * invoked with `--minify` here (runTailwind only ever passes `--no-minify`, and
 * only when twinc.minify is false), so cssnano is the ONLY thing minifying that
 * artifact. Turning it off makes every dev session leave an unminified file
 * under a `.min.css` name, ready to be committed.
 *
 * Set `twinc.minifyMerge: false` in the Gruntfile to trade that for the speed,
 * on the understanding that `src/libs/tailwind.min.css` must then be rebuilt
 * before it is committed.
 */
async function postcssMergeAndMinify({ inputs, outFile, minify }) {
    const merged = postcss.root();

    for (const segment of SEGMENTS) {
        // One key space per segment: a rule may appear in both `components` and
        // `utilities` and each copy has to stay where its layer puts it.
        const state = newMergeState();
        for (let i = 0; i < inputs.length; i++) {
            mergeNodesInto(merged, inputs[i].segments[segment], i > 0, state);
        }
    }

    const plugins = [mergeRules()];
    if (minify) plugins.push(cssnano({ preset: ["default", { discardComments: { removeAll: true } }] }));
    const result = await postcss(plugins).process(merged, { from: undefined });
    const tmp = `${outFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, result.css);
    fs.renameSync(tmp, outFile);
}

const twincMerge = function (grunt) {
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

        /**
         * Split on top-level commas, ignoring commas inside a `{a,b}` group.
         *
         * WATCH_PATTERN used to be a single glob, so covering two directories
         * meant a brace group - and `glob-parent` on `{a,b}/**` gives up and
         * returns the repo root. chokidar then walked the whole checkout:
         * 13k directories / 111k files, minutes of startup on a network or
         * cloud-synced drive, to watch two folders. A comma list keeps each
         * root intact. Matching still uses the full globs, so brace groups
         * inside one entry keep working.
         */
        function splitPatterns(value) {
            const out = [];
            let depth = 0, current = "";
            for (const ch of value) {
                if (ch === "{") depth++;
                else if (ch === "}") depth--;
                if (ch === "," && depth === 0) { out.push(current); current = ""; continue; }
                current += ch;
            }
            out.push(current);
            return out.map((s) => s.trim()).filter(Boolean);
        }

        const watchGlobs = process.env.WATCH_PATTERN ?
            splitPatterns(process.env.WATCH_PATTERN).map((g) => absPosix(root, g)) :
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

        // Atomic: two watchers on one checkout, or a Ctrl+C mid-write, must not
        // leave a half-written manifest that throws on the next startup.
        function writeManifest() {
            const tmp = `${manifestPath}.${process.pid}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
            fs.renameSync(tmp, manifestPath);
        }

        function dropAllDeltas(reason) {
            // Sweep the directory, not just the manifest. A delta whose manifest
            // entry was lost - two watchers overwriting manifest.json, a crash
            // between the chunk write and the manifest write - is unreachable
            // debris that nothing else ever deletes.
            let count = 0;
            try {
                for (const name of fs.readdirSync(cacheDir)) {
                    if (!/^delta-.*\.css$/.test(name)) continue;
                    try { fs.unlinkSync(path.join(cacheDir, name)); count++; } catch {}
                }
            } catch {}
            manifest = {};
            writeManifest();
            if (count) grunt.log.ok(`[twinc-merge] Dropped ${count} delta(s): ${reason}.`);
        }

        /**
         * Deltas whose source no longer exists.
         *
         * The `unlink` handler only sees deletions that happen while the watcher
         * is running. A branch switch, a `git clean`, or a rename done from an
         * editor while this was down leaves the delta behind forever, and every
         * later save pays to merge it.
         */
        function pruneOrphanDeltas() {
            let dropped = 0;
            for (const src of Object.keys(manifest)) {
                if (exists(src)) continue;
                try { fs.unlinkSync(path.join(cacheDir, manifest[src])); } catch {}
                delete manifest[src];
                dropped++;
            }
            if (dropped) {
                writeManifest();
                grunt.log.ok(`[twinc-merge] Pruned ${dropped} delta(s) whose source is gone.`);
            }
        }

        /**
         * Identity of the two inputs the baseline is compiled FROM.
         *
         * Nothing used to stat them, so editing `tailwind-spec.css` or
         * `tailwind.config.js` left the previous `@layer components` frozen in
         * the baseline for the rest of the session - a second, quieter way to
         * get wrong colours and paddings in dev (Gruntfile.js documents it as
         * "the only way to get a correct stylesheet is grunt css").
         */
        function inputsFingerprint() {
            return hash([inputCSS, configFile].map((p) => {
                try { return `${p}:${fs.readFileSync(p, "utf8")}`; } catch { return `${p}:<missing>`; }
            }).join("\n"));
        }

        function readState() {
            try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { return null; }
        }

        async function fullBuildOnce() {
            // 1) One-time full build to OUTFILE (uses config's default content)
            grunt.log.writeln("[twinc-merge] Full build (one-time)...");
            await runTailwind({ grunt, configFile, inputCSS, outFile, contentGlobs: null, minify });

            // 2) Snapshot this as our baseline
            fs.copyFileSync(outFile, baselineCss);
            fs.writeFileSync(stateFile, JSON.stringify({
                createdAt: Date.now(),
                inputs: inputsFingerprint(),
            }, null, 2));

            // 3) A fresh baseline scans the same sources the deltas were built
            //    from, so every existing delta is now redundant. Keeping them
            //    made .dev-cache grow without bound across sessions - hundreds of
            //    files, tens of MB - and the merge cost grows with it, on every
            //    single save. This is the only place that can safely reset it.
            dropAllDeltas("subsumed by the new baseline");

            // The CLI is never given --minify (see runTailwind), so what was
            // just written to the tracked `.min.css` is 280 KB of pretty-printed
            // CSS with the spec's source comments in it. Run the merge once so
            // the artifact is in its normal state even if no save follows.
            await mergeAll();
            grunt.log.ok("[twinc-merge] Baseline created.");
        }

        async function detectAndRebuildWorkspaceElements(files) {
            const processedDirs = new Set();
            for (const f of files) {
                let itemPath = path.dirname(f);
                // Traverse upwards to find the nearest package.json (workspace root)
                while (itemPath && itemPath.length > root.length - 1) {
                    if (pathsEqual(itemPath, root)) break;

                    const pkgPath = path.join(itemPath, "package.json");
                    if (fs.existsSync(pkgPath)) {
                        if (!processedDirs.has(itemPath)) {
                            try {
                                processedDirs.add(itemPath);
                                const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

                                grunt.log.writeln(`[twinc-merge] Rebuilding workspace: ${pkg.name || itemPath}`);

                                // Call the shared build logic
                                await buildWorkspaceItem(itemPath, pkg, nodeLogger);
                            } catch (e) {
                                grunt.log.error(`[twinc-merge] Error processing workspace: ${itemPath}`);
                                grunt.log.error(e.message);
                                grunt.log.error(e.stack);
                            }
                        }
                        // Once we find the nearest package.json, we stop bubbling up for this file
                        break;
                    }
                    itemPath = path.dirname(itemPath);
                }
            }
        }

        /**
         * Rebuild every workspace item whose bundle is older than its sources.
         *
         * The watcher below only reacts to changes it SEES. Anything edited
         * while it was not running — a branch switch, a merge, an edit from
         * another machine — keeps a stale `index.workspace.js` forever, and the
         * app silently runs the previous version of that plugin or module. That
         * is invisible from the browser: the code simply behaves like an older
         * commit. So ask the question once at startup, before the watcher takes
         * over.
         */
        async function rebuildStaleWorkspaces() {
            const items = [];
            const collect = (acc, data) => {
                // `data.directory` is repo-relative ("modules/recorder"); the
                // rest of this task works in absolute paths.
                const directory = abs(root, data.directory);
                const pkgPath = path.join(directory, "package.json");
                if (!exists(pkgPath)) return acc;
                try {
                    items.push({ directory, pkg: JSON.parse(fs.readFileSync(pkgPath, "utf8")) });
                } catch (e) {
                    grunt.log.error(`[twinc-merge] Unreadable package.json in ${data.directory}: ${e.message}`);
                }
                return acc;
            };
            grunt.util.reduceModules(collect, []);
            grunt.util.reducePlugins(collect, []);

            let rebuilt = 0;
            for (const { directory, pkg } of items) {
                const { stale, newestSource } = inspectWorkspaceBundle(directory, pkg);
                if (!stale) continue;
                rebuilt++;
                const because = newestSource
                    ? `bundle older than ${toPosix(path.relative(root, newestSource))}`
                    : "no bundle built yet";
                grunt.log.writeln(`[twinc-merge] Rebuilding stale workspace: ${pkg.name || directory} (${because})`);
                try {
                    // Sequential and before the watcher starts, so a rebuild
                    // cannot race a live edit of the same item.
                    await buildWorkspaceItem(directory, pkg, nodeLogger);
                } catch (e) {
                    // One broken element must not stop the dev server.
                    grunt.log.error(`[twinc-merge] Failed to rebuild ${directory}: ${e.message}`);
                }
            }
            // A silent sweep is indistinguishable from a sweep that never ran.
            grunt.log.ok(`[twinc-merge] Workspace freshness check: ${items.length} item(s), ${rebuilt} rebuilt.`);
        }

        async function rebuildUI() {
            return buildUI(nodeLogger);
        }

        async function rebuildCore() {
            return buildCore(nodeLogger);
        }

        async function buildDeltaFor(fileAbsPosix, chunkPath) {
            // NOT a utilities-only build, despite the name "delta": the input is
            // the whole spec, so the chunk carries preflight, the DaisyUI theme
            // blocks and every component class this one file mentions, on top of
            // its utilities. Only `--content` is narrowed. That is precisely why
            // mergeAll must splice the chunks together LAYER BY LAYER - see
            // postcssMergeAndMinify.
            //
            // Per-pid: this file is created, handed to tailwind, then unlinked.
            // Under a shared name a second watcher on the same checkout deletes
            // it out from under the first one mid-build, which surfaces as a
            // random "input file not found" or a silently empty delta.
            const tmp = path.join(cacheDir, `utils.input.${process.pid}.css`);
            if (!exists(inputCSS)) {
                throw new Error(`Tailwind input not found at ${inputCSS}.`);
            }
            ensureDir(path.dirname(tmp));
            fs.copyFileSync(inputCSS, tmp);

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
            // Merge baseline + all current deltas layer by layer, write to outFile.
            // The baseline MUST stay first: postcssMergeAndMinify treats it as
            // authoritative and only lets later chunks add what it lacks.
            const files = [baselineCss, ...Object.keys(manifest).sort().map((f) => path.join(cacheDir, manifest[f]))]
                .filter((p) => exists(p));

            const inputs = [];
            let dropped = false;
            for (const file of files) {
                const css = fs.readFileSync(file, "utf8");
                if (!hasLayerMarkers(css)) {
                    // A chunk compiled before the sentinels existed. Splitting it
                    // would drop its whole payload into `pre`, i.e. silently back
                    // to the concatenation this replaces. The baseline is
                    // re-checked at startup, so this can only be a stale delta:
                    // discard it and let the file's next save rebuild it.
                    grunt.log.warn(`[twinc-merge] Dropping marker-less chunk ${toPosix(path.basename(file))}.`);
                    for (const [src, rel] of Object.entries(manifest)) {
                        if (path.join(cacheDir, rel) !== file) continue;
                        delete manifest[src];
                        try { fs.unlinkSync(file); } catch {}
                        dropped = true;
                    }
                    continue;
                }
                inputs.push({ file, segments: splitLayerSegments(postcss.parse(css, { from: file })) });
            }
            if (dropped) writeManifest();

            // `minifyMerge` defaults ON - see postcssMergeAndMinify for why, and
            // for what you are accepting if you turn it off.
            await postcssMergeAndMinify({ inputs, outFile, minify: cfg.minifyMerge !== false });
            grunt.log.ok(`[twinc-merge] Merged baseline + ${inputs.length - 1} delta(s) -> ${toPosix(outFile)}`);
        }

        const LOCK = path.join(cacheDir, ".full.lock");
        const lockExistsRecent = () => exists(LOCK) && (Date.now() - fs.statSync(LOCK).mtimeMs < 15 * 60 * 1000);

        /**
         * Why the baseline has to be thrown away, or "" if it is still usable.
         *
         * Three questions, and only the first one used to be asked: is it there,
         * was it built from the current inputs, and does it carry the layer
         * markers the merge needs.
         */
        function baselineInvalidReason() {
            if (!exists(stateFile) || !exists(baselineCss) || !exists(outFile)) return "no baseline yet";
            const state = readState();
            if (!state || state.inputs !== inputsFingerprint()) {
                return "tailwind-spec.css or tailwind.config.js changed";
            }
            try {
                if (!hasLayerMarkers(fs.readFileSync(baselineCss, "utf8"))) return "baseline predates the layer markers";
            } catch { return "baseline unreadable"; }
            return "";
        }

        async function ensureInitialOnce() {
            await rebuildUI();
            // Cheap, and it runs before the first merge: whatever survives here
            // is paid for on every save until the next full build.
            pruneOrphanDeltas();
            const invalid = baselineInvalidReason();
            if (invalid) {
                grunt.log.writeln(`[twinc-merge] Rebaselining: ${invalid}.`);
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
            /**
             * The two files the BASELINE is compiled from. They are not source
             * files, so `matchesWatch` rejects them and they get their own
             * branch in `onEvt`: editing either invalidates every chunk in the
             * cache, so the answer is a rebaseline, not a delta. `configFile`
             * sits at the repo root, outside every watch root - watch it
             * explicitly rather than adding the root as a chokidar entry.
             */
            const rebaselineFiles = new Set([absPosix(root, inputCSS), absPosix(root, configFile)]);
            const watcher = chokidar.watch([...watchRoots, ...rebaselineFiles], {
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
            let pendingNeedsCore = false;
            let pendingRebaseline = false;
            /** One retry per failure streak; cleared by any cycle that completes. */
            let rearmedAfterFailure = false;

            function queueDelta(fileAbsPosix) {
                pendingFiles.add(fileAbsPosix);
                if (fileAbsPosix.includes('/ui/')) pendingNeedsUI = true;
                if (fileAbsPosix.includes('/src/')) pendingNeedsCore = true; // NEW: Detect TS
                scheduleFlush();
            }

            function queueMergeOnly() {
                pendingMergeOnly = true;
                scheduleFlush();
            }

            function queueRebaseline() {
                pendingRebaseline = true;
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
                const needCore = pendingNeedsCore;
                pendingNeedsCore = false;
                const mergeOnly = pendingMergeOnly;
                pendingMergeOnly = false;
                const rebaseline = pendingRebaseline;
                pendingRebaseline = false;

                try {
                    // The JS bundle and the CSS write to different outputs and
                    // neither reads the other, so start esbuild first and let it
                    // run alongside the Tailwind work below. It used to be last,
                    // which meant a .ts edit that touched no class names still
                    // waited out the whole CSS pass before the code it changed
                    // was rebuilt. Failures are reported per item inside, so this
                    // promise settles rather than rejecting.
                    const workspaces = detectAndRebuildWorkspaceElements(files)
                        .catch((e) => grunt.log.error(`[twinc-merge] Workspace rebuild failed: ${e.message}`));

                    if (rebaseline) {
                        // The spec or the config changed, so every cached chunk
                        // was compiled from an input that no longer exists.
                        // fullBuildOnce drops them, rescans everything (queued
                        // files included) and merges, so there is no delta work
                        // left to do this cycle.
                        try { fs.unlinkSync(stateFile); } catch {}
                        await fullBuildOnce();
                    } else {
                        // rebuild deltas for queued files
                        for (const f of files) {
                            const chunk = chunkPathFor(f);
                            await buildDeltaFor(f, chunk);
                            manifest[f] = path.relative(cacheDir, chunk);
                        }
                        writeManifest();

                        // merge baseline + deltas (also when only unlink happened)
                        await mergeAll();
                    }

                    // one UI rebuild per cycle if any /ui/ file changed (no matter how many)
                    if (needUI) {
                        await rebuildUI();
                    }

                    if (needCore) {
                        await rebuildCore();
                    }

                    await workspaces;
                    // A cycle that got all the way here refreshes the retry
                    // budget, so a later unrelated failure is still retried once.
                    rearmedAfterFailure = false;
                } catch (e) {
                    grunt.log.error(e.message);
                    // Re-arm the work this cycle claimed but did not finish.
                    //
                    // The flags are consumed at the top, before anything that can
                    // throw — and the UI/core rebuilds run LAST. So a failure
                    // anywhere earlier (a Tailwind delta, the merge) silently ate
                    // the core rebuild, and because the flag was already cleared
                    // no later cycle retried it: the dev server kept happily
                    // rebuilding CSS and the UI bundle while `src/dist` stayed
                    // hours stale, which reads as "my code change did nothing".
                    //
                    // Bounded to ONE retry per failure streak: `finally`
                    // reschedules whenever a flag is pending, so unconditional
                    // re-arming would spin forever on a persistent error.
                    if (!rearmedAfterFailure && (needUI || needCore || rebaseline)) {
                        rearmedAfterFailure = true;
                        if (needUI) pendingNeedsUI = true;
                        if (needCore) pendingNeedsCore = true;
                        // A dropped rebaseline is worse than a dropped delta: the
                        // cache stays keyed to inputs that no longer exist.
                        if (rebaseline) pendingRebaseline = true;
                    }
                    if (retry && e.message?.includes("ENOENT")) {
                        if (await ensureInitialOnce()) {
                            await runBuildCycle(false);
                        }
                    }
                } finally {
                    isBuilding = false;
                    if (pendingFiles.size || pendingNeedsUI || pendingNeedsCore || pendingMergeOnly || pendingRebaseline) {
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

                    // 0. The baseline's own inputs. Not source files, so they
                    //    never match the watch globs - and a delta cannot express
                    //    what changed in them anyway.
                    if (rebaselineFiles.has(file)) {
                        if (evt === "unlink") return;   // mid-save churn; the add/change follows
                        grunt.log.writeln(`[twinc-merge] ${evt}: ${file} (rebaseline)`);
                        queueRebaseline();
                        return;
                    }

                    // 1. Check matching first
                    if (!matchesWatch(file)) {
                        // Uncomment the line below to debug path mismatches
                        // grunt.log.writeln(`[DEBUG] Ignored (no match): ${file}`);
                        return;
                    }

                    // 2. Handle Deletion
                    if (evt === "unlink") {
                        grunt.log.writeln(`[twinc-merge] ${evt}: ${file}`);
                        const rel = manifest[file];
                        if (rel) {
                            try { fs.unlinkSync(path.join(cacheDir, rel)); } catch {}
                            delete manifest[file];
                            writeManifest();
                        }
                        if (file.includes('/ui/')) pendingNeedsUI = true;
                        queueMergeOnly();
                        return;
                    }

                    // 3. Handle Add/Change (Only stat if it's not a deletion)
                    try {
                        if (!fs.statSync(file).isFile()) return;
                    } catch (e) {
                        return; // File vanished between event and stat
                    }

                    grunt.log.writeln(`[twinc-merge] ${evt}: ${file}`);
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
                    // After the CSS baseline, before the first page load: catch
                    // up on everything edited while the watcher was down.
                    try { await rebuildStaleWorkspaces(); } catch (e) { grunt.log.error(`[twinc-merge] Workspace freshness check failed: ${e.message}`); }
                    grunt.log.ok("[twinc-merge] Watcher started.");
                })
                .on("error", (e) => grunt.log.error("[twinc-merge] watcher error:", e));
            // keep task alive
        })();
    };
};

module.exports = twincMerge;
/**
 * The layer-merge internals, exposed so the cascade contract can be asserted
 * without booting grunt or a watcher. The merge is the part of this task that
 * silently produced a wrong stylesheet for weeks; it deserves to be testable.
 */
module.exports.hasLayerMarkers = hasLayerMarkers;
module.exports.splitLayerSegments = splitLayerSegments;
module.exports.postcssMergeAndMinify = postcssMergeAndMinify;
