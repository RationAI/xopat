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

async function compileServerTs(file, runtime, opts = {}) {
    const stat = fs.statSync(file);
    const outFile = getBuiltServerFile(runtime, file);
    const outDir = path.dirname(outFile);
    const metaFile = `${outFile}.meta.json`;

    fs.mkdirSync(outDir, { recursive: true });

    let needsBuild = true;
    if (fs.existsSync(outFile) && fs.existsSync(metaFile)) {
        try {
            const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
            needsBuild = meta.mtimeMs !== stat.mtimeMs;
        } catch {
            needsBuild = true;
        }
    }

    if (needsBuild) {
        const esbuild = require("esbuild");
        await esbuild.build({
            entryPoints: [file],
            outfile: outFile,
            bundle: true,
            platform: "node",
            format: "esm",
            sourcemap: true,
            logLevel: opts.logLevel || "silent",
        });
        fs.writeFileSync(metaFile, JSON.stringify({ mtimeMs: stat.mtimeMs }), "utf8");
    }

    return { file: outFile, mtimeMs: stat.mtimeMs };
}

async function loadServerModuleFromFile(file, runtime, opts = {}) {
    const stat = fs.statSync(file);
    const ext = path.extname(file).toLowerCase();

    if (ext === ".ts") {
        const built = await compileServerTs(file, runtime, opts);
        return import(pathToFileURL(built.file).href + `?v=${built.mtimeMs}`);
    }

    if (ext === ".mjs") {
        return import(pathToFileURL(file).href + `?v=${stat.mtimeMs}`);
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