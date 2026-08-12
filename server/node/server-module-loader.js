"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SERVER_BUILD_DIR = ".server-dist";

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

async function doCompileServerTs(file, outFile, opts = {}) {
    const stat = fs.statSync(file);
    const outDir = path.dirname(outFile);
    const metaFile = `${outFile}.meta.json`;

    fs.mkdirSync(outDir, { recursive: true });

    const isFresh = () => {
        if (opts.force) return false;
        if (!fs.existsSync(outFile) || !fs.existsSync(metaFile)) return false;
        try {
            return JSON.parse(fs.readFileSync(metaFile, "utf8")).mtimeMs === stat.mtimeMs;
        } catch {
            return false;
        }
    };

    if (isFresh()) return { file: outFile, mtimeMs: stat.mtimeMs };

    await withBuildLock(outFile, async () => {
        // Re-check under the lock: while we waited, the holder probably built
        // exactly what we were about to build.
        if (isFresh()) return;

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
                logLevel: opts.logLevel || "silent",
            });
            fs.renameSync(tmpOut, outFile);
            try { fs.renameSync(`${tmpOut}.map`, `${outFile}.map`); } catch { /* no map emitted */ }
            // Meta LAST: it is the freshness signal, so it must never claim a
            // bundle that is not on disk yet.
            fs.writeFileSync(metaFile, JSON.stringify({ mtimeMs: stat.mtimeMs }), "utf8");
        } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
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
    findNearestItemRoot,
    getServerBuildDir,
    getBuiltServerFile,
    compileServerTs,
    loadServerModuleFromFile,
};