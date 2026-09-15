"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");

const SERVER_BUILD_DIR = ".server-dist";

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
 */
const BUILD_FORMAT_VERSION = 3;

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

    return runtime?.cacheDir || path.join(process.cwd(), "server/.cache");
}

function getBuiltServerFile(runtime, file) {
    const item = findNearestItemRoot(runtime, file);
    const rel = item?.rootDir ? path.relative(item.rootDir, file) : path.basename(file);
    return path.join(getServerBuildDir(runtime, file), rel).replace(/\.ts$/i, ".mjs");
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
    const stat = fs.statSync(file);
    const outDir = path.dirname(outFile);
    const metaFile = `${outFile}.meta.json`;

    fs.mkdirSync(outDir, { recursive: true });

    const buildKey = getBuildKey();
    const isFresh = () => {
        if (opts.force) return false;
        if (!fs.existsSync(outFile) || !fs.existsSync(metaFile)) return false;
        try {
            const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
            // Both must match: the source can be untouched while the dependency
            // tree or the build options underneath it changed.
            return meta.mtimeMs === stat.mtimeMs && meta.buildKey === buildKey;
        } catch {
            return false;
        }
    };

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
            await esbuild.build({
                entryPoints: [file],
                outfile: tmpOut,
                bundle: true,
                platform: "node",
                format: "esm",
                sourcemap: true,
                banner: { js: BUILD_BANNER },
                logLevel: opts.logLevel || "silent",
            });
            fs.renameSync(tmpOut, outFile);
            try { fs.renameSync(`${tmpOut}.map`, `${outFile}.map`); } catch { /* no map emitted */ }
            // Meta LAST: it is the freshness signal, so it must never claim a
            // bundle that is not on disk yet.
            fs.writeFileSync(metaFile, JSON.stringify({ mtimeMs: stat.mtimeMs, buildKey }), "utf8");
        } finally {
            await removeTempBuildDir(tmpDir);
        }
    });

    return { file: outFile, mtimeMs: stat.mtimeMs };
}

async function loadServerModuleFromFile(file, runtime, opts = {}) {
    const stat = fs.statSync(file);
    const ext = path.extname(file).toLowerCase();

    if (ext === ".ts") {
        const built = await compileServerTs(file, runtime, opts);
        try {
            return await import(pathToFileURL(built.file).href + `?v=${built.mtimeMs}`);
        } catch (error) {
            // The failure may be a stale cached-failed import (see note on
            // inflightBuilds). Rebuild and import under a fresh URL so the
            // ESM cache cannot serve the old failure.
            const rebuilt = await compileServerTs(file, runtime, { ...opts, force: true });
            return import(pathToFileURL(rebuilt.file).href + `?v=${rebuilt.mtimeMs}-r${Date.now()}`);
        }
    }

    if (ext === ".mjs") {
        try {
            return await import(pathToFileURL(file).href + `?v=${stat.mtimeMs}`);
        } catch (error) {
            // Same stale-cached-failure hazard as the .ts path: Node's ESM
            // loader caches a FAILED import against its URL, and the URL is the
            // source mtime — so one transient failure (a half-written file, a
            // dependency not yet built) poisoned this module until someone
            // touched the source. Retry once under a URL that cannot be cached.
            if (opts.noRetry) throw error;
            return await import(pathToFileURL(file).href + `?v=${stat.mtimeMs}-r${Date.now()}`);
        }
    }

    delete require.cache[require.resolve(file)];
    return require(file);
}

module.exports = {
    SERVER_BUILD_DIR,
    getBuildKey,
    findNearestItemRoot,
    getServerBuildDir,
    getBuiltServerFile,
    compileServerTs,
    loadServerModuleFromFile,
};