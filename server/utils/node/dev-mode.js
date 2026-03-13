const { spawn } = require("child_process");
const fs = require("node:fs");
const path = require("node:path");

function run(name, cmd, args) {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    const log = (data) => process.stdout.write(`[${name}] ${data.toString()}`);
    p.stdout.on("data", log);
    p.stderr.on("data", log);
    return p;
}

let serverProc;
function startServer() {
    serverProc = run("SERVER", "node", ["index.js"]);
}
function restartServer() {
    if (serverProc && !serverProc.killed) serverProc.kill();
    startServer();
}

if (process.env.WATCH_PATTERN) {
    run("WATCH", "grunt", ["twinc"]);
} else {
    run("WATCH", "npm", ["run", "watch-core"]);
}

startServer();

const watchRoots = ["plugins", "modules"];
const debounce = new Map();
for (const root of watchRoots) {
    const full = path.resolve(process.cwd(), root);
    if (!fs.existsSync(full)) continue;
    fs.watch(full, { recursive: true }, (_, filename) => {
        if (!filename || !/\.server\.(js|mjs|ts)$/i.test(filename)) return;
        clearTimeout(debounce.get(filename));
        debounce.set(filename, setTimeout(() => {
            process.stdout.write(`[DEV] server source changed: ${filename}\n`);
            restartServer();
        }, 150));
    });
}
