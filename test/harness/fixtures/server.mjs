/**
 * Worker-scoped xOpat server.
 *
 * Replaces `test/run-env.sh`: same idea (boot `node index.js` with a given
 * `XOPAT_ENV` on a side port, run tests against it, shut it down) minus the
 * bash dependency, plus per-worker isolation so projects and workers can run in
 * parallel.
 *
 * Two corrections over the shell version:
 *
 *  - it gates on **`/ready`**, not `/`. The listener opens before
 *    `loadServerExtensions()` resolves, so `/` can answer 200 while plugin and
 *    module extensions failed to load — a green boot followed by inexplicable
 *    failures. `/ready` reports `{ready, extensions, ...}`.
 *  - cache and storage roots are per-worker temp dirs, so two workers cannot
 *    fight over `server/.cache` or the storage root.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { repoRoot } from "../paths.mjs";
import { captureOutput, killTree } from "../proc.mjs";
import { createEnvScratch } from "../env-scratch.mjs";

/** Ports are keyed by `parallelIndex`, which is unique among live workers. */
const PORT_BASE = 9300;

/**
 * Servers currently running in this worker process.
 *
 * The diagnostics fixture reads this instead of depending on `xopatServer`,
 * because a fixture dependency is unconditional: an auto-fixture that asked for
 * the server would boot one for every unit test too.
 */
export const activeServers = new Set();

const CSRF_IN_PAGE = /XOPAT_CSRF_TOKEN\s*=\s*"([^"]+)"/;

class XOpatServer {
    #child = null;
    #captured = null;
    #session = null;

    constructor({ scratch, port, devMode, extraEnv = {} }) {
        this.scratch = scratch;
        this.port = port;
        this.devMode = devMode;
        this.extraEnv = extraEnv;
        // `localhost`, not `127.0.0.1`: every ENV file in the repo writes
        // `client.domain` as `http://localhost:<port>`, and the client builds
        // absolute URLs from it. Browsing the numeric address instead makes the
        // page's own origin differ from its configured domain, so every asset —
        // tile descriptors, scripting `.d.ts` bundles — becomes a cross-origin
        // fetch and dies on CORS. The listener stays on the default host so
        // both spellings resolve.
        this.baseURL = `http://localhost:${port}`;
        this.cacheDir = mkdtempSync(path.join(tmpdir(), `xopat-cache-${port}-`));
        this.storageRoot = mkdtempSync(path.join(tmpdir(), `xopat-storage-${port}-`));
    }

    get logs() { return this.#captured?.text ?? ""; }

    async start({ bootTimeoutMs = 120_000 } = {}) {
        this.#child = spawn(process.execPath, ["index.js"], {
            cwd: repoRoot,
            env: {
                ...process.env,
                XOPAT_ENV: this.scratch.path,
                XOPAT_NODE_PORT: String(this.port),
                XOPAT_DEV_MODE: this.devMode ? "1" : "0",
                XOPAT_CACHE_DIR: this.cacheDir,
                XOPAT_STORAGE_ROOT: this.storageRoot,
                // Project-declared bootstrap vars, last so a project can also
                // override the defaults above. A deployment needing a secret or
                // an SSRF allowlist entry (the SAML project needs both) states
                // it in `playwright.config.mjs` rather than relying on whatever
                // the developer happened to export.
                ...this.extraEnv,
            },
            stdio: ["ignore", "pipe", "pipe"],
            detached: process.platform !== "win32",
        });
        this.#captured = captureOutput(this.#child);
        this.#session = null;
        await this.#waitForReady(bootTimeoutMs);
        return this;
    }

    async #waitForReady(timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        let lastDetail = "never answered";
        while (Date.now() < deadline) {
            if (this.#child.exitCode !== null) {
                throw new Error(`xOpat server exited early (code ${this.#child.exitCode})\n${this.logs}`);
            }
            try {
                const res = await fetch(`${this.baseURL}/ready`, { signal: AbortSignal.timeout(2_000) });
                if (res.ok) return;
                lastDetail = `/ready → ${res.status} ${await res.text().catch(() => "")}`.slice(0, 500);
            } catch (e) {
                lastDetail = String(e?.message ?? e);
            }
            await new Promise(r => setTimeout(r, 250));
        }
        throw new Error(`xOpat server not ready within ${timeoutMs}ms (${lastDetail})\n${this.logs}`);
    }

    async stop() {
        await killTree(this.#child);
        this.#child = null;
    }

    async restart() {
        await this.stop();
        await this.start();
    }

    /**
     * Rewrite the deployment ENV this server reads.
     *
     * Normally instant — the config is re-read per request. Under
     * `client.production` it is memoized until restart, so restart is the only
     * honest way to apply it; doing that silently here keeps callers from
     * having to special-case the production project.
     *
     * @param {object} partial merged over the current ENV
     */
    async setEnv(partial) {
        const wasProduction = this.scratch.isProduction;
        this.scratch.patch(partial);
        if (wasProduction || this.scratch.isProduction) await this.restart();
        this.#session = null;
        return this.scratch.read();
    }

    /** Replace the whole ENV rather than merging. */
    async replaceEnv(next) {
        const wasProduction = this.scratch.isProduction;
        this.scratch.write(next);
        if (wasProduction || this.scratch.isProduction) await this.restart();
        this.#session = null;
        return next;
    }

    /**
     * A session cookie plus the CSRF token minted for it. `/__rpc/*` and
     * `/proxy/*` reject anything missing either half.
     */
    async session() {
        if (this.#session) return this.#session;
        const res = await fetch(`${this.baseURL}/`, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
        const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
        const csrf = CSRF_IN_PAGE.exec(await res.text())?.[1];
        if (!cookie || !csrf) {
            throw new Error(`could not establish a session (cookie=${JSON.stringify(cookie)}, csrf=${Boolean(csrf)})`);
        }
        this.#session = { cookie, csrf };
        return this.#session;
    }

    /**
     * Call a server RPC method the way the client does.
     *
     * The method lives in the **path**, not the body — `/__rpc/<kind>/<id>/<method>`
     * — and the body *is* the argument payload (see `resolveCallContext` in
     * `server/node/server-runtime.js`).
     *
     * @param {"server"|"module"|"plugin"} kind
     * @param {string} id    e.g. `"core"`
     * @param {string} method e.g. `"getLogs"`
     * @param {object} [args] request payload
     * @param {{headers?: Record<string,string>, omitCsrf?: boolean, omitCookie?: boolean}} [opts]
     */
    async rpc(kind, id, method, args = {}, opts = {}) {
        const { cookie, csrf } = await this.session();
        const headers = { "Content-Type": "application/json", ...opts.headers };
        if (!opts.omitCookie) headers.Cookie = cookie;
        if (!opts.omitCsrf) headers["X-XOPAT-CSRF"] = csrf;

        const url = `${this.baseURL}/__rpc/${kind}/${encodeURIComponent(id)}/${encodeURIComponent(method)}`;
        const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(args),
            signal: AbortSignal.timeout(60_000),
        });
        const text = await res.text();
        let body;
        try { body = JSON.parse(text); } catch { body = text; }
        return { status: res.status, body };
    }

    /**
     * Server-side log ring buffer.
     *
     * Reachable in production builds, but **gated**: dev mode, or a caller
     * matching the `core.server.logging.access` operator allowlist. A default
     * deployment allowlists nobody, so this usually returns `{unavailable}` and
     * `logs` (the captured stdout) is the diagnostic channel that always works.
     */
    async getLogs(args = { limit: 200 }) {
        try {
            const { status, body } = await this.rpc("server", "core", "getLogs", args);
            return status === 200 ? body : { unavailable: true, status, body };
        } catch (e) {
            return { unavailable: true, error: String(e?.message ?? e) };
        }
    }

    dispose() {
        rmSync(this.cacheDir, { recursive: true, force: true });
        rmSync(this.storageRoot, { recursive: true, force: true });
        this.scratch.dispose();
    }
}

/**
 * Fixtures contributed to the harness `test` object.
 *
 * `xopatEnv` / `xopatDevMode` / `xopatServerLogLevel` are worker-scoped options
 * — projects set them in `use`, which is what makes the ENV matrix work.
 */
export const serverFixtures = {
    /** Repo-relative deployment ENV file; `null` uses `env/env.json`. */
    xopatEnv: [null, { option: true, scope: "worker" }],
    /** Boot with `XOPAT_DEV_MODE`. Off by default: production is the shape that matters. */
    xopatDevMode: [false, { option: true, scope: "worker" }],
    /** `core.server.logging.level` for the spawned server. */
    xopatServerLogLevel: [process.env.XOPAT_TEST_SERVER_LOG || null, { option: true, scope: "worker" }],
    /**
     * Extra environment for the spawned server. For bootstrap values read before
     * any config — a secret, an SSRF allowlist entry — which by definition
     * cannot come from the ENV file itself.
     */
    xopatServerEnv: [{}, { option: true, scope: "worker" }],
    /**
     * Pin the server port instead of deriving it from the worker index.
     *
     * Needed when something OUTSIDE the repo has the URL baked in: an identity
     * provider's registered redirect URIs, for instance. A project that sets
     * this must also set `workers: 1`, or two workers fight over the port.
     */
    xopatPort: [null, { option: true, scope: "worker" }],

    xopatServer: [
        async ({ xopatEnv, xopatDevMode, xopatServerLogLevel, xopatServerEnv, xopatPort }, use, workerInfo) => {
            const scratch = createEnvScratch({
                envFile: xopatEnv,
                label: `${workerInfo.project.name.replace(/[^\w.-]+/g, "-")}-w${workerInfo.parallelIndex}`,
                serverLogLevel: xopatServerLogLevel,
            });
            const server = new XOpatServer({
                scratch,
                port: xopatPort ?? (PORT_BASE + workerInfo.parallelIndex),
                devMode: xopatDevMode,
                extraEnv: xopatServerEnv,
            });
            activeServers.add(server);
            try {
                await server.start();
                await use(server);
            } finally {
                activeServers.delete(server);
                await server.stop();
                server.dispose();
            }
        },
        { scope: "worker" },
    ],
};

export { XOpatServer };
