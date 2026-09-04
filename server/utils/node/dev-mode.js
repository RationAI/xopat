const { spawn, spawnSync } = require("child_process");
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

const children = [];

const isWindows = process.platform === "win32";

function run(name, cmd, args) {
    const p = spawn(cmd, args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: isWindows,
        // Own process group, so killTree can take the whole subtree below `npm`
        // down with one signal. `npm run watch-all` is npm -> sh -> grunt;
        // signalling npm alone leaves grunt watching files forever.
        detached: !isWindows,
        env: childEnv,
    });
    const log = (data) => process.stdout.write(`[${name}] ${data.toString()}`);
    p.stdout.on("data", log);
    p.stderr.on("data", log);
    children.push({ name, proc: p });
    return p;
}

/**
 * Kill a child and everything it spawned.
 *
 * On Windows `shell: true` above means our direct child is cmd.exe, and killing
 * cmd.exe leaves the real `node` / `grunt` underneath it running — still holding
 * the port, still watching files. `taskkill /T` walks the tree instead.
 *
 * `spawnSync`, not `spawn`: this also runs from the `exit` handler, where the
 * event loop is already done and an async spawn would never start.
 */
function killTree(proc) {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
    if (isWindows) {
        try { spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
        return;
    }
    // Negative pid = the whole group created by `detached` above.
    try { process.kill(-proc.pid, "SIGTERM"); } catch { try { proc.kill("SIGTERM"); } catch {} }
}

let shuttingDown = false;
function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const { proc } of children) killTree(proc);
    process.exitCode = code;
}

// Without these, Ctrl+C returns the prompt while the watcher and the server keep
// running in the background: the next `npm run dev` then fails on a port that
// looks free but is not, or worse, silently runs a second watcher against the
// same .dev-cache.
process.on("SIGINT", () => { shutdown(0); process.exit(); });
process.on("SIGTERM", () => { shutdown(0); process.exit(); });
process.on("exit", () => shutdown(process.exitCode ?? 0));

let serverProc;
function startServer() {
    serverProc = run("SERVER", "node", ["index.js", "--dev"]);
    // A dead server with a live watcher looks like a working dev loop until you
    // reload the page. Take the whole thing down and say why.
    serverProc.on("exit", (code, signal) => {
        if (shuttingDown) return;
        process.stdout.write(`[SERVER] exited (${signal || `code ${code}`}); stopping the watcher too.\n`);
        shutdown(typeof code === "number" ? code : 1);
        process.exit();
    });
}

if (process.env.WATCH_PATTERN) {
    run("WATCH", "grunt", ["twinc"]);
} else {
    run("WATCH", "npm", ["run", "watch-all"]);
}

startServer();
