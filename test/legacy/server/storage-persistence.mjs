/**
 * Storage durability — "does this thing lose my data?" regression suite.
 *
 * The storage subsystem's whole claim is *bounded RAM without losing anything*:
 * a record evicted from the memory tier is still readable, and a record written
 * before a restart is still there after it. `hardening-units.mjs` pins the
 * individual rules that make that true; this suite asserts the property itself,
 * which is the one an operator actually cares about.
 *
 * Four phases, each with the failure it guards against:
 *
 *  A. Eviction is not deletion. The tiered driver's front tier is a cache, not
 *     the store. Blow it away mid-flight and the value must still be there.
 *  B. The REAL chat session store survives a process restart — loaded exactly
 *     the way the server loads it, not a reimplementation.
 *  C. The `sess:` principal survives a restart. This is the part everyone gets
 *     wrong: persisting the chat namespaces alone leaves the transcripts on disk
 *     and UNREACHABLE, because an anonymous owner's principal is derived from
 *     the browser-session record, which is memory-bound by default.
 *  D. Retention still reclaims. A "fix" for a data-loss complaint must not
 *     quietly disable the sweeper.
 *
 * Phases B and C each carry a NEGATIVE CONTROL — the same scenario bound to
 * `memory`, which must lose the data. Without them a suite that silently skipped
 * its assertions would still print all-ok.
 *
 * No LLM credentials required: nothing here calls a provider.
 *
 * Plain node, no framework — same shape as http-surface.mjs.
 * Run: npm run test:storage-persistence
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fromRoot } from "@xopat/test-harness/paths";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = fromRoot();
const require = createRequire(import.meta.url);
const R = (...p) => path.join(repoRoot, "server", "node", ...p);

let failed = 0;
let n = 0;
function ok(name, cond, detail) {
    n++;
    if (cond) {
        console.log(`ok ${n} - ${name}`);
    } else {
        failed++;
        console.log(`not ok ${n} - ${name}${detail ? `\n  ${detail}` : ""}`);
    }
}
function eq(name, actual, expected) {
    ok(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const scratch = mkdtempSync(path.join(tmpdir(), "xo-persist-"));
process.on("exit", () => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ } });

/** Every file under a directory, recursively. Used to prove a purge left nothing. */
function walkFiles(dir) {
    const out = [];
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walkFiles(full));
        else out.push(full);
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// A. Eviction is not deletion
// ─────────────────────────────────────────────────────────────────────────────
console.log("# A. tiered: the memory tier is a cache, not the store");
{
    const { createServerStorage } = require(R("storage", "index.js"));
    const root = path.join(scratch, "phase-a");
    const S = createServerStorage({
        cacheDir: root,
        getConfig: () => ({ root, defaultDriver: "tiered" }),
    });

    const kv = S.kv("module.test", "records");
    await kv.set("k1", { payload: "keep me" });

    // Destroy the front tier outright — the harshest form of "it was evicted".
    S.getDriver("memory").dispose();

    const afterEviction = await kv.get("k1");
    ok("value survives the memory tier being destroyed",
        afterEviction && afterEviction.payload === "keep me",
        `got ${JSON.stringify(afterEviction)}`);

    // Byte-budget eviction: every key must still read back through the tier below.
    const tight = createServerStorage({
        cacheDir: root,
        getConfig: () => ({
            root: path.join(root, "tight"),
            defaultDriver: "tiered",
            drivers: { tiered: { memory: { maxBytes: 4096 } } },
        }),
    });
    const many = tight.kv("module.test", "many");
    const written = [];
    for (let i = 0; i < 50; i++) {
        const key = `rec-${i}`;
        await many.set(key, { i, blob: "x".repeat(2000) });
        written.push(key);
    }
    const evicted = require(R("storage", "bounded-cache.js")).getAllCacheStats()
        .filter(c => c.name.includes("module.test/many"))
        .reduce((sum, c) => sum + c.evicted.bytes + c.evicted.lru, 0);
    ok("the front tier's byte budget actually evicted something", evicted > 0,
        `evicted=${evicted} — if this is 0 the next assertion proves nothing`);

    // A tiered log caches its tail under a separate front-tier key. Deleting the
    // record used to leave that window behind, so in `single` coherency — where
    // nothing revalidates — a deleted transcript still read back.
    const tieredLog = S.log("module.test", "transcripts", { coherency: "single" });
    await tieredLog.append("t1", [{ m: "one" }, { m: "two" }]);
    await tieredLog.tail("t1", 2);                       // populate the cached window
    await tieredLog.delete("t1");
    eq("a deleted tiered log does not read back from its cached tail",
        (await tieredLog.tail("t1", 2)).length, 0);

    let allReadable = true;
    let firstMissing = null;
    for (const key of written) {
        const value = await many.get(key);
        if (!value || value.blob.length !== 2000) { allReadable = false; firstMissing = key; break; }
    }
    ok("every evicted record still reads back in full", allReadable, `first missing: ${firstMissing}`);

    // Cascade: deleting the owning record must leave no orphaned bytes on disk.
    const cascadeRoot = path.join(root, "cascade");
    const C = createServerStorage({ cacheDir: cascadeRoot, getConfig: () => ({ root: cascadeRoot, defaultDriver: "file" }) });
    const cKv = C.kv("module.test", "sessions");
    const cLog = C.log("module.test", "messages");
    const cBlob = C.blob("module.test", "attachments");
    await cKv.set("s1", { id: "s1" });
    await cLog.append("s1", [{ m: 1 }, { m: 2 }]);
    await cBlob.scoped("s1").put("a1", Buffer.alloc(150_000, 9));
    ok("precondition: attachment bytes are on disk", walkFiles(cascadeRoot).length > 0);

    await cKv.delete("s1");
    await cLog.delete("s1");
    await cBlob.scoped("s1").clear();
    const leftovers = walkFiles(cascadeRoot).filter(f => statSync(f).size > 0);
    ok("purging a session leaves no orphaned files", leftovers.length === 0,
        `left behind: ${leftovers.join(", ")}`);
    // The sidecar carries the length; if `delete` drops only the data file, a
    // deleted transcript keeps reporting its old message count.
    eq("a deleted log reports length 0, not its pre-delete count", await cLog.length("s1"), 0);
    ok("and reads back empty", (await cLog.range("s1")).length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// B. The real chat store, across two processes
// ─────────────────────────────────────────────────────────────────────────────
console.log("# B. StorageChatSessionStore survives a process restart");

// Loaded through the server-module-loader, i.e. the same path the server takes
// (it compiles the .ts on load — that is the loader's job, not a manual build),
// so this exercises the shipped store rather than a copy of its logic.
const childSource = `
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = ${JSON.stringify(repoRoot)};
const R = (...p) => path.join(repoRoot, "server", "node", ...p);

const mode = process.argv[2];               // "write" | "read"
const root = process.argv[3];
const driver = process.argv[4];             // "file" | "memory"
const buildDir = process.argv[5];

const { createServerStorage } = require(R("storage", "index.js"));
const { loadServerModuleFromFile } = require(R("server-module-loader.js"));

const storage = createServerStorage({
    cacheDir: root,
    getConfig: () => ({
        root,
        bindings: { "vercel-ai-chat-sdk": {
            "kv:sessions": [driver], "log:messages": [driver],
            "log:attachment-index": [driver], "blob:attachments": [driver],
        } },
    }),
});

// No registry entry -> the loader builds into runtime.cacheDir instead of the
// repo tree, so the test never writes into modules/.
const mod = await loadServerModuleFromFile(
    path.join(repoRoot, "modules", "vercel-ai-chat-sdk", "server", "chatRegistry.server.ts"),
    { cacheDir: buildDir },
    { logLevel: "silent" },
);
const store = new mod.StorageChatSessionStore(storage);

const PAYLOAD = "data:image/png;base64," + "A".repeat(200000);

if (mode === "write") {
    await store.createSession({
        id: "sess_persist", title: "before restart", providerId: "p", providerTypeId: "pt",
        modelId: "m", personalityId: "default", contextId: null,
        metadata: { ownerPrincipal: "user:test-alice" },
    });
    for (let i = 0; i < 30; i++) {
        await store.appendMessages("sess_persist", [
            { id: "m_" + i, role: "user", parts: [{ type: "text", text: "line " + i }] },
        ]);
    }
    await store.uploadAttachment({
        id: "att_persist", sessionId: "sess_persist", kind: "image", name: "shot.png",
        mimeType: "image/png", sizeBytes: PAYLOAD.length, dataUrl: PAYLOAD,
        createdAt: new Date().toISOString(),
    });
    console.log(JSON.stringify({ wrote: true }));
} else {
    const owned = await store.listSessions({ ownerPrincipal: "user:test-alice" });
    const messages = await store.listMessages("sess_persist");
    const records = await store.listAttachments("sess_persist");
    const payload = await store.getAttachmentPayload("sess_persist", "att_persist");
    console.log(JSON.stringify({
        sessionIds: owned.map(s => s.id),
        title: owned[0] ? owned[0].title : null,
        messageCount: messages.length,
        firstMessageId: messages[0] ? messages[0].id : null,
        lastMessageId: messages.length ? messages[messages.length - 1].id : null,
        attachmentCount: records.length,
        recordHasInlinePayload: !!(records[0] && records[0].dataUrl),
        payloadMatches: payload === PAYLOAD,
    }));
}
`;
const childPath = path.join(scratch, "chat-store-child.mjs");
writeFileSync(childPath, childSource, "utf8");

function runChild(mode, root, driver, buildDir) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [childPath, mode, root, driver, buildDir], {
            cwd: repoRoot,
            env: { ...process.env, XOPAT_STORAGE_SWEEP_INTERVAL_MS: "3600000" },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "", err = "";
        child.stdout.on("data", d => { out += d; });
        child.stderr.on("data", d => { err += d; });
        child.on("error", reject);
        child.on("exit", code => {
            if (code !== 0) return reject(new Error(`child '${mode}' exited ${code}\n${err}\n${out}`));
            const line = out.trim().split("\n").filter(Boolean).pop();
            try { resolve(JSON.parse(line)); }
            catch { reject(new Error(`child '${mode}' printed no result\n${out}\n${err}`)); }
        });
    });
}

const buildDir = path.join(scratch, "build");
{
    const root = path.join(scratch, "phase-b-file");
    await runChild("write", root, "file", buildDir);
    const read = await runChild("read", root, "file", buildDir);

    ok("the session is still owned and listed after a restart",
        read.sessionIds.includes("sess_persist"), JSON.stringify(read.sessionIds));
    eq("its title survived", read.title, "before restart");
    eq("all 30 messages survived", read.messageCount, 30);
    eq("in order — oldest first", read.firstMessageId, "m_0");
    eq("in order — newest last", read.lastMessageId, "m_29");
    eq("the attachment record survived", read.attachmentCount, 1);
    // Guarded on the record existing: "no payload" is trivially true of no record.
    ok("the stored record still carries no inline payload",
        read.attachmentCount === 1 && read.recordHasInlinePayload === false);
    ok("the attachment bytes are byte-identical after the restart", read.payloadMatches === true);
}
{
    // Negative control: the same code bound to `memory` MUST lose everything.
    // If this ever passes, the assertions above are not testing persistence.
    const root = path.join(scratch, "phase-b-memory");
    await runChild("write", root, "memory", buildDir);
    const read = await runChild("read", root, "memory", buildDir);
    eq("control: memory-bound chat state is gone after a restart", read.sessionIds.length, 0);
    eq("control: its messages are gone too", read.messageCount, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// C. The browser session — the prerequisite everyone misses
// ─────────────────────────────────────────────────────────────────────────────
console.log("# C. a persisted `sess:` principal survives a restart");

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

function bootServer(port, cacheDir, storageConfig) {
    const child = spawn(process.execPath, ["index.js"], {
        cwd: repoRoot,
        env: {
            ...process.env,
            XOPAT_NODE_PORT: String(port),
            XOPAT_DEV_MODE: "0",
            XOPAT_CACHE_DIR: cacheDir,
            XOPAT_ENV: JSON.stringify({ core: { server: { secure: { storage: storageConfig } } } }),
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", d => { log += d; });
    child.stderr.on("data", d => { log += d; });
    child.getLog = () => log;
    return child;
}

async function waitForBoot(child, base, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})\n${child.getLog()}`);
        try {
            const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
            if (res.ok) return;
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`server did not boot within ${timeoutMs}ms\n${child.getLog()}`);
}

function stopServer(child) {
    return new Promise(resolve => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill("SIGKILL");   // a crash, not a graceful drain — the harsher test
    });
}

function cookieOf(res) {
    const raw = res.headers.get("set-cookie");
    if (!raw) return null;
    const m = /xopat_session=([^;]+)/.exec(raw);
    return m ? decodeURIComponent(m[1]) : null;
}

async function csrfOf(base, cookie) {
    const res = await fetch(base, { headers: cookie ? { Cookie: `xopat_session=${cookie}` } : {} });
    const body = await res.text();
    // `window.XOPAT_CSRF_TOKEN = <json>` — accept either quote style, since the
    // value goes through jsonForScript rather than a literal.
    const m = /XOPAT_CSRF_TOKEN\s*=\s*["']([a-f0-9]+)["']/.exec(body);
    return { csrf: m ? m[1] : null, mintedCookie: cookieOf(res) };
}

/**
 * @returns whether the pre-restart cookie was still recognised after the restart.
 */
async function restartScenario(storageConfig) {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const cacheDir = path.join(scratch, `srv-${port}`);

    let child = bootServer(port, cacheDir, storageConfig);
    try {
        await waitForBoot(child, base);
        const first = await fetch(base);
        const cookie = cookieOf(first);
        if (!cookie) throw new Error("server did not mint a session cookie");
        const before = await csrfOf(base, cookie);

        await stopServer(child);

        child = bootServer(port, cacheDir, storageConfig);
        await waitForBoot(child, base);

        const after = await fetch(base, { headers: { Cookie: `xopat_session=${cookie}` } });
        const reminted = cookieOf(after);
        const afterCsrf = await csrfOf(base, cookie);

        // A recognised session answers 403 (CSRF header missing/wrong); an
        // unrecognised one answers 401. That distinction is the actual proof.
        const proxy = await fetch(`${base}/proxy/x`, {
            headers: { Cookie: `xopat_session=${cookie}`, "x-xopat-csrf": before.csrf || "" },
        });

        return {
            recognised: reminted === null,
            csrfPreserved: !!before.csrf && before.csrf === afterCsrf.csrf,
            proxyStatus: proxy.status,
        };
    } finally {
        await stopServer(child);
    }
}

{
    const persisted = await restartScenario({
        bindings: { core: { "kv:sessions": ["tiered"] } },
    });
    ok("the pre-restart cookie is still recognised (no new Set-Cookie)", persisted.recognised);
    ok("its CSRF token survived with it", persisted.csrfPreserved);
    eq("a proxy call with the old CSRF gets 403, not 401 (the session exists)",
        persisted.proxyStatus, 403);
}
{
    // Negative control: default bindings leave `kv:sessions` in memory, so the
    // principal changes and any persisted chat becomes unreachable. This is the
    // failure mode the docs warn about — assert it really happens.
    const ephemeral = await restartScenario({});
    ok("control: with default bindings the session is NOT recognised after a restart",
        ephemeral.recognised === false);
    eq("control: and the proxy answers 401 (no session at all)", ephemeral.proxyStatus, 401);
}

// ─────────────────────────────────────────────────────────────────────────────
// D. Retention still reclaims
// ─────────────────────────────────────────────────────────────────────────────
console.log("# D. bounding still bounds");
{
    const { createServerStorage } = require(R("storage", "index.js"));
    const root = path.join(scratch, "phase-d");
    const S = createServerStorage({
        cacheDir: root,
        getConfig: () => ({
            root,
            defaultDriver: "file",
            retention: { test: { "kv:records": { maxEntries: 3 } } },
        }),
    });
    const kv = S.kv("module.test", "records");
    for (let i = 0; i < 8; i++) {
        await kv.set(`r${i}`, { i });
        await new Promise(r => setTimeout(r, 3));   // distinct updatedAt for the LRU order
    }
    await S.sweep();
    const survivors = (await kv.keys()).sort();
    eq("the entry cap is enforced by the sweeper", survivors.length, 3);
    ok("and it kept the NEWEST records", survivors.join(",") === "r5,r6,r7", survivors.join(","));

    const expiring = S.kv("module.test", "expiring", { ttlMs: 50 });
    await expiring.set("gone", 1);
    await new Promise(r => setTimeout(r, 90));
    await S.sweep();
    eq("expired records are reclaimed", await expiring.get("gone"), null);
}

console.log(`\n1..${n}`);
if (failed) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("\nall storage-persistence checks passed");
