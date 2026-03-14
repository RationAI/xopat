"use strict";

const cluster = require("node:cluster");
const os = require("node:os");
const path = require("node:path");

const workers = Math.max(1, Number(process.env.XOPAT_WORKERS || os.availableParallelism?.() || os.cpus().length || 1));
const entry = path.join(__dirname, "index.js");

if (cluster.isPrimary) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", event: "cluster.start", workers, pid: process.pid }));
    for (let i = 0; i < workers; i += 1) cluster.fork();
    cluster.on("exit", (worker, code, signal) => {
        console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", event: "cluster.worker_exit", pid: process.pid, workerPid: worker.process.pid, code, signal }));
        cluster.fork();
    });
} else {
    require(entry);
}
