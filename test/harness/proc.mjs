/**
 * Child-process helpers shared by the legacy adapter and the server fixture.
 *
 * The one non-obvious thing here is killing on Windows: `child.kill()` signals
 * only the direct child, so a spawned `node index.js` that itself forked (the
 * cluster supervisor, an esbuild service) leaves orphans holding the port —
 * which then makes the *next* worker's boot fail with a confusing EADDRINUSE.
 * `taskkill /T` walks the tree.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const isWindows = process.platform === "win32";

/** Bind :0, read the port back, release it. Racy in theory, fine in practice. */
export function freePort() {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

/** Terminate a child and everything it spawned. Never throws. */
export async function killTree(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const pid = child.pid;
    if (!pid) return;

    if (isWindows) {
        await new Promise(resolve => {
            const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
            killer.on("close", resolve);
            killer.on("error", resolve);
        });
    } else {
        try { process.kill(-pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* gone */ } }
    }

    // Give it a beat to actually die before the caller reuses the port.
    await Promise.race([
        new Promise(resolve => child.once("exit", resolve)),
        new Promise(resolve => setTimeout(resolve, 5_000)),
    ]);
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
}

/** Bounded in-memory capture of a child's output, newest kept. */
export function captureOutput(child, { maxBytes = 512 * 1024 } = {}) {
    const state = { text: "", truncated: false };
    const append = (chunk) => {
        state.text += chunk;
        if (state.text.length > maxBytes) {
            state.text = state.text.slice(-maxBytes);
            state.truncated = true;
        }
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    return state;
}
