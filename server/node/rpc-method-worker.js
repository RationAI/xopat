"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const { installGlobalServerHelpers } = require("./server-helpers");
const { loadServerModuleFromFile } = require("./server-module-loader");

// The one loader, rather than a private copy of it: this file's own version
// dispatched on the extension and had no `.ts` branch at all, so a TypeScript
// server method would have been `require`d as TypeScript. `workerData.runtime`
// is a structured clone — it carries `registry`/`cacheDir`/`serverBuildDirName`,
// which is all the artifact lookup needs.
const loadModule = (loadPath) => loadServerModuleFromFile(loadPath, workerData.runtime);

(async () => {
    try {
        if (workerData.runtime) {
            installGlobalServerHelpers(workerData.runtime);
        }
        // NOTE: `workerData.ctx` is a structured clone, so it carries no `req`/`res`.
        // If this path is ever wired up, `ctx.principal` / `ctx.principalKind` MUST be
        // in the serialized set (identity would otherwise vanish inside the worker),
        // and `XOPAT_SERVER.requireRpcAuthContext` cannot run here — it needs `req`.
        const mod = await loadModule(workerData.loadPath);
        const fn = mod[workerData.exportName];
        if (typeof fn !== "function") {
            throw new Error(`Export '${workerData.exportName}' is not a function`);
        }
        const result = await fn(workerData.ctx, ...(Array.isArray(workerData.args) ? workerData.args : []));
        parentPort.postMessage({ ok: true, result: result === undefined ? null : result });
    } catch (error) {
        parentPort.postMessage({
            ok: false,
            error: {
                name: error && error.name,
                message: error && error.message,
                stack: error && error.stack,
                code: error && error.code,
                details: error && error.details,
            }
        });
    }
})();
