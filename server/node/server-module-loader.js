"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const constants = require("./constants");

const SERVER_BUILD_DIR = ".server-dist";

/**
 * What counts as a server file, for discovery and for build output naming.
 *
 * All six module spellings, because the bundler decides the module system, not
 * the author: `bundle: true` inlines `import`, `require`, `import()`, an
 * ESM-only dependency and a CJS one indifferently, so refusing an extension
 * would restrict style for no gain. This used to be three regexes that
 * disagreed — two accepting `(js|mjs|ts)` and one (in `index.js`, guarding
 * static serving) also matching `.cjs`/`.cts`, i.e. a `.cts` server file was
 * denied as a static asset while never being discovered as a server file.
 */
const SERVER_FILE_RE = /\.server\.[mc]?[jt]s$/i;

/** Matches `register.server.*` at an element root (the boot-time hook). */
const REGISTER_FILE_RE = /(^|[\\/])register\.server\.[mc]?[jt]s$/i;

/**
 * The output format of a built server bundle, and nothing else decides it.
 *
 * **CJS, measured rather than assumed.** A packaged build runs its snapshot
 * entry through `vm` with no `importModuleDynamically` callback, so `import()`
 * of a snapshot file throws `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` — every
 * element's server code failed to register in a `@yao-pkg/pkg 6.23` binary with
 * exactly that error, while `require` of the same bundle works. ESM output
 * therefore cannot be loaded from a release at all.
 *
 * One format for dev AND release, not one each: a release artifact no developer
 * ever executes is what let the previous prebuild rot unnoticed for a year.
 *
 * The cost is explicit: **a `*.server.*` entry cannot use top-level await**, and
 * neither can anything in its dependency graph. esbuild refuses TLA under `cjs`,
 * so that fails at build time with a named file rather than at runtime.
 *
 * `bundle: true` is what keeps this from restricting authoring style: `import`,
 * `require`, `import()`, an ESM-only dependency (`ai@7`, `@ai-sdk/*`) and a CJS
 * one are all resolved at build time, where a real resolver exists.
 */
const BUILD_FORMAT = "cjs";
const ARTIFACT_EXT = BUILD_FORMAT === "cjs" ? ".cjs" : ".mjs";

/** Directories never walked when looking for server files. */
const SKIP_DIRS = new Set(["node_modules", ".git", SERVER_BUILD_DIR]);

/**
 * Every server file under `rootDir`, recursively.
 *
 * The single definition: the runtime scan, the request-time resolver and the
 * build-time task all have to agree on what will be built, and they used to
 * hold three copies of this walk (`server-runtime.js`, `server-helpers.js`, and
 * `build-logic.js`'s byte-for-byte duplicate) — which is how a build could
 * think an element had no server entries while the runtime found two.
 */
function walkForServerFiles(rootDir, found = []) {
    let entries;
    try {
        entries = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch {
        return found;
    }
    for (const entry of entries) {
        const full = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            walkForServerFiles(full, found);
        } else if (SERVER_FILE_RE.test(entry.name)) {
            found.push(full);
        }
    }
    return found;
}

/**
 * Bump whenever the esbuild options below change. It is part of the build cache
 * key, so a bump rebuilds every element's bundle instead of leaving bundles that
 * were produced by the previous options in place (their SOURCE mtime is
 * unchanged, so nothing else would notice).
 *
 * 2: added the createRequire banner (see BUILD_BANNER).
 * 3: dependency component became a lockfile CONTENT hash (see getBuildKey). The
 *    previous mtime+size component let bundles built against two different majors
 *    of the same dependency coexist; this bump discards every bundle produced
 *    under the old scheme.
 * 4: bundles are produced at BUILD time by `grunt serverBuild` and recorded in
 *    the server build manifest; `.mjs`/`.js`/`.cjs` sources are bundled rather
 *    than copied, and every entry carries a meta stamp. Bundles left by the old
 *    scheme have no manifest record, so they must not be honoured.
 */
const BUILD_FORMAT_VERSION = 4;

/**
 * esbuild's ESM output rewrites a CJS dependency's `require("x")` into a shim
 * that reads `typeof require !== "undefined" ? require : (x) => { throw … }`.
 * With no `require` in an ES module that shim throws at import time and takes
 * the whole server module down — the failure mode is an RPC that reports
 * "Method 'X' not found", because the module never registered anything.
 *
 * Handing the bundle a real `require` fixes every such dependency at once
 * rather than one alias/external per offender. (`ai@7` → `@ai-sdk/gateway` →
 * `@vercel/oidc`, whose CJS build requires "path", is what surfaced this.)
 * Resolution is relative to the emitted `.mjs` inside `<element>/.server-dist/`,
 * so builtins and hoisted packages both resolve.
 */
const BUILD_BANNER = 'import { createRequire as __xopatCreateRequire } from "node:module";\n'
    + 'const require = __xopatCreateRequire(import.meta.url);';

/**
 * The CJS counterpart of the banner above, used only if `BUILD_FORMAT` is
 * flipped. `require` is genuinely in scope there, so the banner's job shrinks to
 * `import.meta`: esbuild merely WARNS (`empty-import-meta`) and substitutes
 * `{}`, so a bundled dependency reading `import.meta.url` would silently get
 * `undefined` rather than fail. Define it, do not hope.
 */
const BUILD_BANNER_CJS =
    'const __xopatImportMetaUrl = require("node:url").pathToFileURL(__filename).href;';

/**
 * The esbuild options for a server bundle — shared verbatim by the build-time
 * Grunt task and the dev-time on-demand compile, so the two cannot drift into
 * producing differently-shaped artifacts (they already had, once: the Grunt path
 * emitted bundles with no `createRequire` banner and no meta stamp, so the
 * runtime discarded every one of them and rebuilt it).
 *
 * `external` comes from an element's declared `server.external` (see
 * modules/README.md): a native addon or a dependency that must stay resolvable
 * at runtime cannot be inlined, and declaring it is the supported way out.
 */
function serverBuildOptions({ file, outfile, external = [], logLevel = "silent" }) {
    const options = {
        entryPoints: [file],
        outfile,
        bundle: true,
        platform: "node",
        format: BUILD_FORMAT,
        sourcemap: true,
        // Metafile paths are relative to the working directory, and the
        // freshness stamp stores them: pinning it to the application root keeps
        // a bundle built by `grunt` (cwd = repo root) and one built by a server
        // started from somewhere else describing the same inputs.
        absWorkingDir: constants._ABSPATH_NO_SLASH,
        // The input list is the freshness signal for the whole graph, not just the
        // entry — see isArtifactFresh.
        metafile: true,
        logLevel,
    };
    if (external.length) options.external = [...external];
    if (BUILD_FORMAT === "cjs") {
        options.banner = { js: BUILD_BANNER_CJS };
        options.define = {
            "import.meta.url": "__xopatImportMetaUrl",
            "import.meta.dirname": "__dirname",
        };
    } else {
        options.banner = { js: BUILD_BANNER };
    }
    return options;
}

/**
 * Identity of the toolchain + installed dependencies, mixed into the build cache
 * key so an `npm install` invalidates bundles. Source mtime alone cannot see a
 * dependency upgrade: nothing in `*.server.ts` changes when `ai` goes 6 → 7, so
 * every element that was not edited would keep serving a bundle with the OLD
 * major inlined — a deployment silently running two SDK majors at once.
 *
 * The dependency component is a CONTENT hash, not `mtime-size`: a mtime is
 * rewritten by file-sync clients and differs for a byte-identical tree in a
 * container or on CI, so it churned identical trees while still letting a CHANGED
 * tree keep an old key. It also must not be frozen for the process lifetime — a
 * dev server started before an `npm install` would otherwise keep both honouring
 * and stamping the pre-install key forever. Memoized behind a stat of the same
 * file, so the recheck costs one stat.
 *
 * Degrades gracefully but not silently: an unreadable lockfile yields an explicit
 * `dNONE`, so a degraded key cannot be mistaken for a healthy one in the meta.
 */
let cachedBuildKey = null;
let cachedLockKey = null;
function getBuildKey() {
    const repoRoot = path.resolve(__dirname, "..", "..");
    // `node_modules/.package-lock.json` is rewritten by npm on every install,
    // including installs that only move a transitive dependency, so it tracks
    // what is ACTUALLY on disk better than the committed lockfile does.
    let lock = null;
    for (const candidate of [
        path.join(repoRoot, "node_modules", ".package-lock.json"),
        path.join(repoRoot, "package-lock.json"),
    ]) {
        try {
            const s = fs.statSync(candidate);
            lock = { file: candidate, key: `${candidate}:${Math.trunc(s.mtimeMs)}-${s.size}` };
            break;
        } catch { /* try the next candidate */ }
    }

    const lockKey = lock ? lock.key : "none";
    if (cachedBuildKey && cachedLockKey === lockKey) return cachedBuildKey;

    const parts = [`f${BUILD_FORMAT_VERSION}`];
    try {
        parts.push(`e${require("esbuild/package.json").version}`);
    } catch { /* esbuild resolved differently — format version still keys the cache */ }

    let digest = null;
    try {
        if (lock) digest = crypto.createHash("sha256").update(fs.readFileSync(lock.file)).digest("hex").slice(0, 12);
    } catch { /* readable a moment ago, gone now */ }
    parts.push(digest ? `d${digest}` : "dNONE");

    cachedLockKey = lockKey;
    cachedBuildKey = parts.join(":");
    return cachedBuildKey;
}

function findNearestItemRoot(runtime, file) {
    const abs = path.resolve(file);
    for (const kind of ["plugin", "module"]) {
        const items = runtime?.registry?.[kind] || {};
        for (const item of Object.values(items)) {
            const root = path.resolve(item.rootDir);
            if (abs === root || abs.startsWith(root + path.sep)) {
                return item;
            }
        }
    }
    return null;
}

function getServerBuildDir(runtime, fileOrItem) {
    const dirName = runtime?.serverBuildDirName || SERVER_BUILD_DIR;

    if (fileOrItem && typeof fileOrItem === "object" && fileOrItem.rootDir) {
        return path.join(fileOrItem.rootDir, dirName);
    }

    const item = fileOrItem ? findNearestItemRoot(runtime, fileOrItem) : null;
    if (item?.rootDir) {
        return path.join(item.rootDir, dirName);
    }

    return runtime?.cacheDir || constants.DEFAULT_CACHE_DIR;
}

/**
 * Where an element's server file is built to — runtime-free, so the build-time
 * Grunt task names artifacts with the same function the loader looks them up
 * with instead of re-deriving the convention.
 */
function builtServerPath(itemRootDir, file, dirName = SERVER_BUILD_DIR) {
    const rel = path.relative(itemRootDir, file);
    return path.join(itemRootDir, dirName, rel).replace(/\.[mc]?[jt]s$/i, ARTIFACT_EXT);
}

function getBuiltServerFile(runtime, file) {
    const item = findNearestItemRoot(runtime, file);
    if (item?.rootDir) {
        return builtServerPath(item.rootDir, file, runtime?.serverBuildDirName || SERVER_BUILD_DIR);
    }
    const rel = path.basename(file);
    return path.join(getServerBuildDir(runtime, file), rel)
        .replace(/\.[mc]?[jt]s$/i, ARTIFACT_EXT);
}

/**
 * The build manifest: what `grunt serverBuild` produced, in repo-root-relative
 * POSIX paths so a `/snapshot/` prefix is never baked in.
 *
 * `{ formatVersion, buildKey, builtAt, elements: { "<kind>/<id>": { rootDir,
 *    entries: [ { source, artifact, external?, assets? } ] } } }`
 *
 * Why a manifest instead of walking the tree at runtime: in a packaged build the
 * walk reads a virtual filesystem, and an empty `readdirSync` there is
 * indistinguishable from "this element ships no server code" — it surfaces as
 * `RPC_UNKNOWN_METHOD` with nothing logged anywhere. The manifest also means
 * sources need not be packaged at all, and it gives the packaged loader
 * something actionable to say when an artifact is missing.
 */
const MANIFEST_FILE = path.join(__dirname, "server-build-manifest.json");

function toManifestPath(abs) {
    return path.relative(constants._ABSPATH_NO_SLASH, abs).split(path.sep).join("/");
}

function fromManifestPath(rel) {
    return path.resolve(constants._ABSPATH_NO_SLASH, rel);
}

function writeServerBuildManifest(manifest) {
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    cachedManifest = undefined;
    cachedArtifactIndex = undefined;
}

let cachedManifest;
/** The manifest, or `null` when this tree was never built. Memoized. */
function readServerBuildManifest() {
    if (cachedManifest !== undefined) return cachedManifest;
    try {
        const parsed = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
        cachedManifest = parsed && parsed.formatVersion === BUILD_FORMAT_VERSION ? parsed : null;
    } catch {
        cachedManifest = null;
    }
    return cachedManifest;
}

/** `source -> artifact` over every manifest entry, absolute paths. Memoized. */
let cachedArtifactIndex;
function artifactIndex() {
    if (cachedArtifactIndex) return cachedArtifactIndex;
    const index = new Map();
    const manifest = readServerBuildManifest();
    for (const element of Object.values(manifest?.elements || {})) {
        for (const entry of element.entries || []) {
            index.set(fromManifestPath(entry.source), fromManifestPath(entry.artifact));
        }
    }
    cachedArtifactIndex = index;
    return index;
}

/** Did the build see this source file? The packaged stand-in for `existsSync`. */
function manifestHasSource(file) {
    return artifactIndex().has(path.resolve(file));
}

/** Every source file the build recorded, absolute. */
function manifestSources() {
    return [...artifactIndex().keys()];
}

/**
 * The elements the build recorded, as `{ kind, id, rootDir }` with an absolute
 * `rootDir`. A packaged build uses this to recover its own element list: a
 * `readdirSync` of `plugins/` over the snapshot filesystem is not something to
 * stake RPC availability on, and an element whose directory listing came back
 * empty would simply have no server methods, silently.
 */
function manifestElements() {
    const manifest = readServerBuildManifest();
    return Object.entries(manifest?.elements || {}).map(([key, element]) => {
        const slash = key.indexOf("/");
        return {
            kind: element.kind || (slash > 0 ? key.slice(0, slash) : null),
            id: element.id || (slash > 0 ? key.slice(slash + 1) : key),
            rootDir: fromManifestPath(element.rootDir),
        };
    });
}

/**
 * The built artifact for a source file: what the build recorded, else the
 * conventional path. The manifest wins so that a packaged build never depends
 * on `findNearestItemRoot` (hence on a runtime registry) to find its own code.
 */
function resolveArtifact(file, runtime) {
    const fromManifest = artifactIndex().get(path.resolve(file));
    if (fromManifest) return fromManifest;
    if (constants.PACKAGED) return null;
    return getBuiltServerFile(runtime, file);
}

/**
 * On-disk identity of each `.cjs` artifact as last `require`d, keyed by its
 * absolute path. Bounded by the number of server entries on disk.
 */
const loadedArtifactStamps = new Map();

function artifactStamp(artifact) {
    try {
        const { mtimeMs, size } = fs.statSync(artifact);
        return `${mtimeMs}:${size}`;
    } catch {
        return null;
    }
}

/**
 * Load one built artifact. The ONE place that knows the bundle format: `.cjs`
 * goes through `require`, anything else through `import()`. `version` busts
 * Node's ESM cache after a rebuild and is omitted in a packaged build, where
 * nothing under the snapshot can change.
 *
 * A `.cjs` artifact is evicted from `require.cache` ONLY when the bundle on
 * disk changed since it was last loaded. This runs on every RPC to an item, so
 * evicting unconditionally re-executed the whole bundle per request and threw
 * away its module-level state (registries, caches, whatever `register()` set
 * up at boot). A rebuild replaces the file (rename), which changes the stamp,
 * so dev edits still take effect on the next call. A failed `require` leaves
 * nothing in the cache, so a retry re-executes regardless.
 */
function loadArtifact(artifact, version) {
    if (artifact.endsWith(".cjs")) {
        if (!constants.PACKAGED) {
            const stamp = artifactStamp(artifact);
            if (loadedArtifactStamps.get(artifact) !== stamp) {
                delete require.cache[artifact];
                loadedArtifactStamps.set(artifact, stamp);
            }
        }
        return require(artifact);
    }
    return import(pathToFileURL(artifact).href + (version ? `?v=${version}` : ""));
}

/**
 * Freshness of a built bundle, over its WHOLE input graph.
 *
 * The entry's own mtime is not enough: a bundle is `bundle: true`, so editing
 * any file it imports changes the output while leaving the entry untouched.
 * That is not theoretical — `modules/saml-auth/register.server.ts` imports
 * `saml-flow.ts`, and an edit to the latter left both the build task and the
 * dev-time compile reporting "up to date" while serving the previous bundle.
 *
 * The inputs come from esbuild's own metafile, so the list is exactly what was
 * read. `node_modules` inputs are excluded on purpose: a dependency change is
 * already covered by the lockfile hash in `getBuildKey()`, and stat-ing a few
 * thousand vendored files per entry per RPC is not affordable on the dev path.
 */
function collectBuildInputs(metafile, outFile) {
    const out = metafile?.outputs?.[Object.keys(metafile.outputs || {}).find(k => !k.endsWith(".map"))];
    const inputs = Object.keys(out?.inputs || metafile?.inputs || {});
    return inputs
        .filter(rel => !rel.split(/[\\/]/).includes("node_modules"))
        // Relative to `absWorkingDir` (the application root), which is also what
        // `fromManifestPath` resolves against.
        .map(rel => toManifestPath(path.resolve(constants._ABSPATH_NO_SLASH, rel)));
}

function newestInputMs(inputs) {
    let newest = 0;
    for (const rel of inputs || []) {
        try {
            const { mtimeMs } = fs.statSync(fromManifestPath(rel));
            if (mtimeMs > newest) newest = mtimeMs;
        } catch {
            return Infinity;        // an input we cannot stat means "rebuild"
        }
    }
    return newest;
}

function artifactMetaFile(outFile) {
    return `${outFile}.meta.json`;
}

/**
 * Snapshot taken BEFORE a build, handed to {@link writeArtifactMeta}.
 *
 * The stamp is written after the build, so stat-ing then would record an edit
 * made DURING the build as already included, and the stale bundle would be
 * served until some other edit. The start time is read off the filesystem's
 * own clock (a probe file's mtime) rather than `Date.now()`, so a network or
 * synced filesystem with a skewed clock cannot make every build look stale.
 */
function beginArtifactBuild(entryFile, outFile) {
    const entryMtimeMs = fs.statSync(entryFile).mtimeMs;
    const probe = `${outFile}.build-start-${process.pid}`;
    let startedMs = Date.now();
    try {
        fs.writeFileSync(probe, "");
        startedMs = fs.statSync(probe).mtimeMs;
    } catch { /* fall back to the process clock */ }
    try { fs.unlinkSync(probe); } catch { /* already gone */ }
    return { entryMtimeMs, startedMs };
}

/** Write the freshness stamp. Always LAST: it must never claim a missing bundle. */
function writeArtifactMeta(outFile, { entryFile, buildKey, inputs, snapshot }) {
    let inputsMs = newestInputMs(inputs);
    // An input touched after the build started may not be what the bundle
    // holds, and an input we cannot stat is unknown: either way the stamp must
    // say "stale" so the next check rebuilds. (`Infinity` would serialize as
    // `null` and, worse, compare as "nothing newer" forever.)
    if (!Number.isFinite(inputsMs) || (snapshot && inputsMs > snapshot.startedMs)) inputsMs = -1;
    fs.writeFileSync(artifactMetaFile(outFile), JSON.stringify({
        mtimeMs: snapshot ? snapshot.entryMtimeMs : fs.statSync(entryFile).mtimeMs,
        buildKey,
        inputs,
        inputsMs,
    }), "utf8");
}

function isArtifactFresh(entryFile, outFile, buildKey) {
    if (!fs.existsSync(outFile)) return false;
    let meta;
    try {
        meta = JSON.parse(fs.readFileSync(artifactMetaFile(outFile), "utf8"));
    } catch {
        return false;
    }
    if (meta.buildKey !== buildKey) return false;
    try {
        if (meta.mtimeMs !== fs.statSync(entryFile).mtimeMs) return false;
    } catch {
        return false;
    }
    // Pre-`inputs` stamps cannot answer the graph question, so they are stale by
    // definition rather than trusted on the entry alone.
    if (!Array.isArray(meta.inputs)) return false;
    return newestInputMs(meta.inputs) <= meta.inputsMs;
}

// Concurrent RPC calls during startup can each trigger a build of the same
// entry; without dedup, one import can read a half-written outfile. Worse,
// Node's ESM loader caches FAILED imports per URL, so a single raced import
// would keep failing for as long as the URL (source mtime) stays the same.
const inflightBuilds = new Map();

async function compileServerTs(file, runtime, opts = {}) {
    const outFile = getBuiltServerFile(runtime, file);
    const existing = inflightBuilds.get(outFile);
    if (existing) return existing;

    const promise = doCompileServerTs(file, outFile, opts)
        .finally(() => inflightBuilds.delete(outFile));
    inflightBuilds.set(outFile, promise);
    return promise;
}

/** Cross-process build lock: how long a lock may sit before it is stolen. */
const BUILD_LOCK_STALE_MS = 120_000;
const BUILD_LOCK_POLL_MS = 50;
const sleep = (ms) => new Promise(r => setTimeout(r, ms).unref?.());

/**
 * Serialize a build across PROCESSES, not just within one.
 *
 * `inflightBuilds` dedups inside a single process. Under `cluster-index.js`
 * there are N of those, all forked at once, all seeing an empty `.server-dist`
 * on a cold start, all running `esbuild.build()` against the SAME `outfile` —
 * and esbuild writes the output directly rather than temp-then-rename, so a
 * sibling worker can `import()` a half-written file. The lock turns that into
 * one build and N cheap waits.
 *
 * Losing the lock is never fatal: a stale lock is stolen, and an unwritable
 * filesystem falls through to building anyway. Correctness here is "somebody
 * builds it", not "exactly one builds it".
 */
async function withBuildLock(outFile, fn) {
    const lockFile = `${outFile}.lock`;
    const deadline = Date.now() + BUILD_LOCK_STALE_MS;

    for (;;) {
        try {
            fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
            break;                                     // acquired
        } catch (e) {
            if (!e || e.code !== "EEXIST") return fn(); // cannot lock at all — just build
        }
        let age = Infinity;
        try {
            age = Date.now() - fs.statSync(lockFile).mtimeMs;
        } catch {
            continue;                                   // holder released it; retry acquire
        }
        if (age > BUILD_LOCK_STALE_MS) {
            try { fs.unlinkSync(lockFile); } catch { /* someone beat us to it */ }
            continue;
        }
        if (Date.now() > deadline) return fn();         // waited long enough; build anyway
        await sleep(BUILD_LOCK_POLL_MS);
    }

    try {
        return await fn();
    } finally {
        try { fs.unlinkSync(lockFile); } catch { /* already gone */ }
    }
}

/**
 * Remove a finished build's temp directory. On Windows (and OneDrive-backed
 * checkouts especially) the freshly written bundle can still be held for a
 * moment after `rename`, so a single `rmSync` loses the race and leaves a
 * `.tmp-*` directory behind forever. Retry briefly, then give up — the sweep
 * below collects whatever still survived.
 */
async function removeTempBuildDir(tmpDir) {
    for (let attempt = 0; attempt < 3; attempt++) {
        if (removeDirTree(tmpDir)) return;
        await sleep(BUILD_LOCK_POLL_MS);
    }
    removeDirTree(tmpDir);                              // last try; the sweep gets the rest
}

/**
 * Delete a directory tree, unlink-then-rmdir rather than `fs.rmSync({recursive})`.
 * The latter silently no-ops on some Windows setups (OneDrive-backed checkouts
 * reproduce it: it returns without error and the directory is still there), which
 * is how hundreds of empty `.tmp-*` directories piled up under `.server-dist`.
 * Returns whether the directory is gone.
 */
function removeDirTree(target) {
    let entries;
    try {
        entries = fs.readdirSync(target, { withFileTypes: true });
    } catch (e) {
        return e?.code === "ENOENT";
    }
    for (const entry of entries) {
        const full = path.join(target, entry.name);
        if (entry.isDirectory()) {
            if (!removeDirTree(full)) return false;
            continue;
        }
        try {
            fs.unlinkSync(full);
        } catch (e) {
            if (e?.code !== "ENOENT") return false;
        }
    }
    try {
        fs.rmdirSync(target);
    } catch (e) {
        return e?.code === "ENOENT";
    }
    return true;
}

/**
 * Collect temp dirs abandoned by a previous build (or a killed process).
 *
 * Once per directory per process, and only on a path that is already about to
 * build. This is SYNCHRONOUS filesystem work on the request path — `#loadItem`
 * runs on every RPC, so sweeping unconditionally meant a readdir + a stat per
 * leftover directory per server file per request, which on a network/synced
 * filesystem blocks the event loop long enough to starve the streaming
 * heartbeat that keeps client watchdogs quiet.
 */
const sweptBuildDirs = new Set();
function sweepStaleTempBuildDirs(outDir) {
    if (sweptBuildDirs.has(outDir)) return;
    sweptBuildDirs.add(outDir);

    let entries;
    try {
        entries = fs.readdirSync(outDir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith(".tmp-")) continue;
        const full = path.join(outDir, entry.name);
        try {
            if (Date.now() - fs.statSync(full).mtimeMs <= BUILD_LOCK_STALE_MS) continue;
            removeDirTree(full);
        } catch { /* in use or already gone */ }
    }
}

async function doCompileServerTs(file, outFile, opts = {}) {
    // A packaged build has no compiler and a read-only filesystem. The single
    // gate is in `loadServerModuleFromFile`; this assertion exists so a future
    // caller cannot quietly reintroduce a build-on-request path.
    if (constants.PACKAGED) {
        throw new Error(`refusing to compile ${file} in a packaged build — server bundles must be prebuilt`);
    }
    const stat = fs.statSync(file);
    const outDir = path.dirname(outFile);

    fs.mkdirSync(outDir, { recursive: true });

    const buildKey = getBuildKey();
    // Freshness covers the whole input graph, not just this entry — see
    // isArtifactFresh. The build task applies the identical rule.
    const isFresh = () => !opts.force && isArtifactFresh(file, outFile, buildKey);

    if (isFresh()) return { file: outFile, mtimeMs: stat.mtimeMs };

    await withBuildLock(outFile, async () => {
        // Re-check under the lock: while we waited, the holder probably built
        // exactly what we were about to build.
        if (isFresh()) return;

        // Only on a path that is actually going to build — never on the
        // every-RPC fast path (see sweepStaleTempBuildDirs).
        sweepStaleTempBuildDirs(outDir);

        const esbuild = require("esbuild");
        // Build into a private temp DIRECTORY, then rename into place. `rename`
        // is atomic, so a concurrent reader sees either the old bundle or the
        // new one — never the half-written middle, which is what made a cold
        // multi-worker boot produce random import failures.
        //
        // A temp *directory* rather than a temp filename, because esbuild emits
        // `//# sourceMappingURL=<basename>.map` into the bundle: keeping the
        // final basename is what stops the renamed file pointing at a map that
        // no longer exists.
        const base = path.basename(outFile);
        const tmpDir = path.join(outDir, `.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
        const tmpOut = path.join(tmpDir, base);
        try {
            fs.mkdirSync(tmpDir, { recursive: true });
            const snapshot = beginArtifactBuild(file, outFile);
            const result = await esbuild.build(serverBuildOptions({
                file,
                outfile: tmpOut,
                external: opts.external,
                logLevel: opts.logLevel || "silent",
            }));
            fs.renameSync(tmpOut, outFile);
            try { fs.renameSync(`${tmpOut}.map`, `${outFile}.map`); } catch { /* no map emitted */ }
            // Meta LAST: it is the freshness signal, so it must never claim a
            // bundle that is not on disk yet.
            writeArtifactMeta(outFile, {
                entryFile: file,
                buildKey,
                inputs: collectBuildInputs(result.metafile, outFile),
                snapshot,
            });
        } finally {
            await removeTempBuildDir(tmpDir);
        }
    });

    return { file: outFile, mtimeMs: stat.mtimeMs };
}

/**
 * Load a plugin/module server file — the one entry point, for every extension.
 *
 * There is no per-extension branch any more: the build bundles `.ts`, `.mts`,
 * `.cts`, `.js`, `.mjs` and `.cjs` the same way, so what is loaded is always a
 * built artifact. That is what makes the author's module style irrelevant —
 * `import`, `require`, `import()`, an ESM-only dependency and a CJS one all
 * resolve at build time, where a real resolver exists.
 *
 * A packaged build never compiles: no toolchain, read-only filesystem. It
 * resolves through the manifest and says so plainly when an entry is absent,
 * because the alternative (what used to happen) is an RPC answering
 * `RPC_UNKNOWN_METHOD` with the real cause buried in one log line.
 */
async function loadServerModuleFromFile(file, runtime, opts = {}) {
    if (constants.PACKAGED) {
        const artifact = resolveArtifact(file, runtime);
        if (!artifact) {
            throw new Error(`no prebuilt server bundle for ${file} — this build was packaged `
                + `without 'grunt serverBuild'; rebuild (npm run build) and repackage`);
        }
        return loadArtifact(artifact);
    }

    const built = await compileServerTs(file, runtime, opts);
    try {
        return await loadArtifact(built.file, built.mtimeMs);
    } catch (error) {
        // Node's ESM loader caches a FAILED import against its URL, and the URL
        // carries the source mtime — so one transient failure (a half-written
        // file, a dependency not yet built) poisoned this module until someone
        // touched the source. Rebuild and load under a URL that cannot be cached.
        if (opts.noRetry) throw error;
        const rebuilt = await compileServerTs(file, runtime, { ...opts, force: true });
        return loadArtifact(rebuilt.file, `${rebuilt.mtimeMs}-r${Date.now()}`);
    }
}

module.exports = {
    SERVER_BUILD_DIR,
    SERVER_FILE_RE,
    REGISTER_FILE_RE,
    ARTIFACT_EXT,
    BUILD_FORMAT,
    BUILD_FORMAT_VERSION,
    walkForServerFiles,
    getBuildKey,
    findNearestItemRoot,
    getServerBuildDir,
    getBuiltServerFile,
    builtServerPath,
    serverBuildOptions,
    compileServerTs,
    loadServerModuleFromFile,
    loadArtifact,
    resolveArtifact,
    manifestHasSource,
    manifestSources,
    manifestElements,
    isArtifactFresh,
    beginArtifactBuild,
    writeArtifactMeta,
    collectBuildInputs,
    readServerBuildManifest,
    writeServerBuildManifest,
    toManifestPath,
    fromManifestPath,
    MANIFEST_FILE,
};