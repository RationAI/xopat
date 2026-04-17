"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { installGlobalServerHelpers } = require("./server-helpers");

async function loadModule(loadPath) {
    const ext = path.extname(loadPath).toLowerCase();
    if (ext === ".mjs") {
        return import(pathToFileURL(loadPath).href + `?v=${Date.now()}`);
    }
    delete require.cache[require.resolve(loadPath)];
    return require(loadPath);
}

(async () => {
    try {
        if (workerData.runtime) {
            installGlobalServerHelpers(workerData.runtime);
        }
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
