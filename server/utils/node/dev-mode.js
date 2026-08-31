const { spawn } = require("child_process");
const path = require("node:path");
const { readDotEnv, layerEnv } = require("./dotenv.js");

/**
 * Secrets for the dev loop.
 *
 * `npm run dev` is the command people actually type, so it has to see the same
 * `env/.env` the composer-based runner does — otherwise a configuration
 * referencing `<% ANTHROPIC_API_KEY %>` works under `npm run up` and silently
 * resolves to `""` here. Shell exports still win: filling only absent keys is
 * what keeps `FOO=bar npm run dev` meaningful.
 *
 * The server itself is deliberately not taught to read this file — see
 * `./dotenv.js` for why.
 */
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const childEnv = layerEnv({ ...process.env }, readDotEnv(path.join(repoRoot, "env", ".env")));

function run(name, cmd, args) {
    const p = spawn(cmd, args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
        env: childEnv,
    });
    const log = (data) => process.stdout.write(`[${name}] ${data.toString()}`);
    p.stdout.on("data", log);
    p.stderr.on("data", log);
    return p;
}

let serverProc;
function startServer() {
    serverProc = run("SERVER", "node", ["index.js", "--dev"]);
}

if (process.env.WATCH_PATTERN) {
    run("WATCH", "grunt", ["twinc"]);
} else {
    run("WATCH", "npm", ["run", "watch-all"]);
}

startServer();
