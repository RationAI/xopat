"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const {
    findNearestItemRoot,
    getServerBuildDir,
} = require("./server-module-loader");

const SERVER_FILE_RE = /\.server\.(js|mjs|ts)$/i;

function getItemServerBuildDir(runtime, file) {
    return getServerBuildDir(runtime, file);
}

function getSecureRoot(ctx) {
  return ctx?.secure || ctx?.core?.CORE?.server?.secure || {};
}

function getSecureModules(ctx) {
  return getSecureRoot(ctx).modules || {};
}

function getSecurePlugins(ctx) {
  return getSecureRoot(ctx).plugins || {};
}

function getSecureModuleConfig(ctx, moduleId) {
  const id = moduleId || ctx?.itemId;
  return getSecureModules(ctx)?.[id] || {};
}

function getSecurePluginConfig(ctx, pluginId) {
  const id = pluginId || ctx?.itemId;
  return getSecurePlugins(ctx)?.[id] || {};
}

function getSecureItemConfig(ctx, explicitId) {
  const id = explicitId || ctx?.itemId;
  if (ctx?.kind === "module") return getSecureModuleConfig(ctx, id);
  if (ctx?.kind === "plugin") return getSecurePluginConfig(ctx, id);
  return {};
}

function getSecureValue(ctx, pathLike, fallback) {
  const parts = Array.isArray(pathLike) ? pathLike : String(pathLike || "").split(".").filter(Boolean);
  let cur = getSecureRoot(ctx);
  for (const key of parts) {
    if (!cur || typeof cur !== "object" || !(key in cur)) return fallback;
    cur = cur[key];
  }
  return cur === undefined ? fallback : cur;
}

function requireSecureValue(ctx, pathLike) {
  const value = getSecureValue(ctx, pathLike, undefined);
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing secure configuration: ${Array.isArray(pathLike) ? pathLike.join(".") : pathLike}`);
  }
  return value;
}

function getRpcAuthConfig(ctx, contextId) {
  const secure = getSecureRoot(ctx);
  const rpcAuth = secure.rpcVerifiers || secure.rpcAuth || {};
  const key = contextId || ctx?.contextId;
  return (key && rpcAuth[key]) || rpcAuth.default || null;
}

function getProxyConfig(ctx, alias) {
  return getSecureRoot(ctx).proxies?.[alias] || null;
}

function parseServerTarget(target) {
  if (!target) throw new Error("Server target is required.");
  if (typeof target === "object") return target;

  const value = String(target).trim();
  const match = value.match(/^(plugin|module):([^/]+)(?:\/(.+))?$/);
  if (match) {
    return { kind: match[1], id: match[2], path: match[3] || "index" };
  }

  if (value.startsWith("./") || value.startsWith("../")) {
    return { kind: "self", path: value };
  }

  throw new Error(`Unsupported server target '${value}'. Use 'plugin:<id>/<path>' or 'module:<id>/<path>'.`);
}

function getItemFromRuntime(runtime, kind, id) {
  if (!runtime?.registry?.[kind]?.[id]) {
    throw new Error(`Unknown ${kind} '${id}'.`);
  }
  return runtime.registry[kind][id];
}

function tryServerFile(basePath) {
  const candidates = [];
  if (SERVER_FILE_RE.test(basePath)) {
    candidates.push(basePath);
  } else {
    candidates.push(`${basePath}.server.ts`, `${basePath}.server.mjs`, `${basePath}.server.js`);
    candidates.push(path.join(basePath, "index.server.ts"), path.join(basePath, "index.server.mjs"), path.join(basePath, "index.server.js"));
  }
  return candidates.find(p => fs.existsSync(p)) || null;
}

function resolveServerFile(runtime, ctx, target) {
  const parsed = parseServerTarget(target);

  let item;
  let relPath;

  if (parsed.kind === "self") {
    const current = getItemFromRuntime(runtime, ctx?.kind, ctx?.itemId);
    item = current;
    relPath = parsed.path;
  } else {
    item = getItemFromRuntime(runtime, parsed.kind, parsed.id);
    relPath = parsed.path || "index";
  }

  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const basePath = path.resolve(item.rootDir, normalized);
  const rootResolved = path.resolve(item.rootDir);

  if (!basePath.startsWith(rootResolved)) {
    throw new Error(`Server target path escapes item root: ${relPath}`);
  }

  const found = tryServerFile(basePath);
  console.log("found", found, basePath);
  if (!found) {
    throw new Error(`Unable to resolve server file '${relPath}' in ${item.kind} '${item.id}'.`);
  }
  return { item, file: found };
}

async function compileTs(file, runtime) {
  const stat = fs.statSync(file);
  const cacheDir = getItemServerBuildDir(runtime, file);
  const item = findNearestItemRoot(runtime, file);
  const rel = item?.rootDir ? path.relative(item.rootDir, file) : path.basename(file);
  const safeRel = rel.replace(/\.ts$/i, '.mjs');
  const outFile = path.join(cacheDir, safeRel);
  const outDir = path.dirname(outFile);
  const metaFile = path.join(outDir, '.meta.json');
  fs.mkdirSync(outDir, { recursive: true });

  let needsBuild = true;
  if (fs.existsSync(outFile) && fs.existsSync(metaFile)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      needsBuild = meta.mtimeMs !== stat.mtimeMs;
    } catch {
      needsBuild = true;
    }
  }

  if (needsBuild) {
    const esbuild = require('esbuild');
    await esbuild.build({
      entryPoints: [file],
      outfile: outFile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      sourcemap: true,
      logLevel: 'silent',
    });
    fs.writeFileSync(metaFile, JSON.stringify({ mtimeMs: stat.mtimeMs }), 'utf8');
  }

  return { file: outFile, mtimeMs: stat.mtimeMs };
}

async function loadServerModuleFromFile(file, runtime) {
  const stat = fs.statSync(file);
  const ext = path.extname(file).toLowerCase();

  if (ext === ".ts") {
    const built = await compileTs(file, runtime);
    return import(pathToFileURL(built.file).href + `?v=${built.mtimeMs}`);
  }
  if (ext === ".mjs") {
    return import(pathToFileURL(file).href + `?v=${stat.mtimeMs}`);
  }
  delete require.cache[require.resolve(file)];
  return require(file);
}

async function importServerModule(ctx, runtime, target) {
    const resolved = resolveServerFile(runtime, ctx, target);
    return loadServerModuleFromFile(resolved.file, runtime);
}

async function importServerExport(ctx, runtime, target, exportName = "default") {
  const mod = await importServerModule(ctx, runtime, target);
  const value = exportName === "default" ? (mod.default ?? mod) : mod[exportName];
  if (value === undefined) {
    throw new Error(`Export '${exportName}' was not found for target '${typeof target === "string" ? target : JSON.stringify(target)}'.`);
  }
  return value;
}

function createServerHelpers(runtime) {
  return {
    getSecureRoot,
  findNearestItemRoot,
      getItemServerBuildDir,
    getSecureModules,
    getSecurePlugins,
    getSecureModuleConfig,
    getSecurePluginConfig,
    getSecureItemConfig,
    getSecureValue,
    requireSecureValue,
    getRpcAuthConfig,
    getProxyConfig,
    resolveServerFile: (ctx, target) => resolveServerFile(runtime, ctx, target),
    importServerModule: (ctx, target) => importServerModule(ctx, runtime, target),
    importServerExport: (ctx, target, exportName) => importServerExport(ctx, runtime, target, exportName),
  };
}

function installGlobalServerHelpers(runtime) {
  const helpers = createServerHelpers(runtime);
  globalThis.XOPAT_SERVER = Object.assign(globalThis.XOPAT_SERVER || {}, helpers);
  return globalThis.XOPAT_SERVER;
}

module.exports = {
  getSecureRoot,
  findNearestItemRoot,
  getSecureModules,
  getSecurePlugins,
  getSecureModuleConfig,
  getSecurePluginConfig,
  getSecureItemConfig,
  getSecureValue,
  requireSecureValue,
  getRpcAuthConfig,
  getProxyConfig,
  parseServerTarget,
  resolveServerFile,
  loadServerModuleFromFile,
  importServerModule,
  importServerExport,
  createServerHelpers,
  installGlobalServerHelpers,
};
