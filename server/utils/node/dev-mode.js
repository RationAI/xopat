const { spawn } = require("child_process");

function run(name, cmd, args) {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    const log = (data) =>
        process.stdout.write(`[${name}] ${data.toString()}`);
    p.stdout.on("data", log);
    p.stderr.on("data", log);
}

run("WATCH", "npm", ["run", "watch-ui"]);
run("SERVER", "node", ["index.js"]);