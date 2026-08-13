/**
 * Server hardening — unit regression suite.
 *
 * Covers the pieces of the 2026-08 security/cluster hardening that are testable
 * without an HTTP server. The end-to-end behaviours (static confinement, the
 * `</script>` escaping, response headers, session sharing) live in
 * `test/server/http-surface.mjs`, which boots the real server — that one is the
 * stronger evidence, this one pins the individual rules so a regression names
 * itself instead of showing up as a mysterious 404.
 *
 * Every assertion here corresponds to a bug that existed:
 *
 *  - JWT accepted tokens with no `exp` (a permanent credential) and skipped a
 *    configured `iss`/`aud` whenever the claim was simply absent.
 *  - CSRF was compared with `!==`.
 *  - Sweeper leadership was `cluster.worker.id === 1`; ids are never reused, so
 *    the first worker-1 death stopped the persistent tier reclaiming forever.
 *  - `maxConcurrency` was per-process, so forking N workers multiplied every
 *    upstream budget by N.
 *  - A handler ignoring `ctx.signal` held its concurrency slot forever.
 *  - `estimateBytes` charged a flat 256 bytes for any object, which made the
 *    tiered front tier's byte budget meaningless (every entry is an envelope).
 *  - The file driver's `touch` was a blind read-modify-write, run on every
 *    authenticated request; a blob's bytes were readable before its meta
 *    committed.
 *
 * Plain node, no framework — same shape as rpc-verifier-context.mjs.
 * Run: npm run test:hardening
 */
import { createRequire } from "node:module";
import { createHmac, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fromRoot } from "@xopat/test-harness/paths";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const R = (...p) => fromRoot("server", "node", ...p);

const auth = require(R("auth.js"));
const runtime = require(R("server-runtime.js"));
const boundedCache = require(R("storage", "bounded-cache.js"));
const { createSweeper } = require(R("storage", "sweeper.js"));
const { createFileDriver } = require(R("storage", "drivers", "file.js"));

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
function throws(name, fn, matcher) {
    try {
        fn();
        ok(name, false, "expected a throw, got none");
    } catch (e) {
        const msg = String(e?.message || e);
        ok(name, matcher ? matcher.test(msg) : true, `message was: ${msg}`);
    }
}

const tmpRoots = [];
function tmpRoot(tag) {
    const dir = mkdtempSync(path.join(tmpdir(), `xopat-${tag}-`));
    tmpRoots.push(dir);
    return dir;
}

// ── A. JWT claim enforcement ────────────────────────────────────────────────
console.log("# JWT claim enforcement");
{
    const SECRET = "unit-test-secret";
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const mint = (payload, header = { alg: "HS256", typ: "JWT" }) => {
        const h = b64(header), p = b64(payload);
        const s = createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
        return `${h}.${p}.${s}`;
    };
    const future = Math.floor(Date.now() / 1000) + 600;
    const cfg = (extra = {}) => ({ secret: SECRET, ...extra });

    ok("a well-formed token with exp verifies",
        auth.verifyJwtToken(mint({ sub: "alice", exp: future }), cfg())?.sub === "alice");

    // WAS: `typeof payload.exp === "number" && …` — no exp meant no expiry check
    // at all, i.e. a token that is valid forever.
    throws("a token with NO exp is refused",
        () => auth.verifyJwtToken(mint({ sub: "alice" }), cfg()),
        /no 'exp'|never expires/i);

    ok("…unless requireExpiry is explicitly disabled",
        auth.verifyJwtToken(mint({ sub: "alice" }), cfg({ requireExpiry: false }))?.sub === "alice");

    throws("an expired token is refused",
        () => auth.verifyJwtToken(mint({ sub: "a", exp: Math.floor(Date.now() / 1000) - 3600 }), cfg()),
        /expired/i);

    // WAS: `jwtCfg.issuer && payload.iss && …` — a token that simply omitted
    // `iss` sailed past an issuer-constrained config.
    throws("a token with NO iss fails an issuer-constrained config",
        () => auth.verifyJwtToken(mint({ sub: "a", exp: future }), cfg({ issuer: "https://idp" })),
        /issuer/i);
    throws("a token with the WRONG iss is refused",
        () => auth.verifyJwtToken(mint({ sub: "a", exp: future, iss: "https://evil" }), cfg({ issuer: "https://idp" })),
        /issuer/i);
    ok("a token with the right iss passes",
        auth.verifyJwtToken(mint({ sub: "a", exp: future, iss: "https://idp" }), cfg({ issuer: "https://idp" }))?.sub === "a");

    throws("a token with NO aud fails an audience-constrained config",
        () => auth.verifyJwtToken(mint({ sub: "a", exp: future }), cfg({ audience: "xopat" })),
        /audience/i);
    ok("an array aud containing the expected value passes",
        auth.verifyJwtToken(mint({ sub: "a", exp: future, aud: ["other", "xopat"] }), cfg({ audience: "xopat" }))?.sub === "a");
    throws("an array aud NOT containing it is refused",
        () => auth.verifyJwtToken(mint({ sub: "a", exp: future, aud: ["other"] }), cfg({ audience: "xopat" })),
        /audience/i);

    // Algorithm confusion / alg:none must stay closed.
    throws("alg:none is refused",
        () => auth.verifyJwtToken(mint({ sub: "a", exp: future }, { alg: "none", typ: "JWT" }), cfg()),
        /alg/i);
    throws("a tampered signature is refused",
        () => auth.verifyJwtToken(mint({ sub: "a", exp: future }).replace(/.$/, "X"), cfg()),
        /signature/i);
}

// ── B. CSRF comparison ──────────────────────────────────────────────────────
console.log("# CSRF comparison");
{
    const tok = randomUUID().replace(/-/g, "");
    ok("matching tokens compare equal", auth.csrfTokenMatches(tok, tok));
    ok("different tokens do not", !auth.csrfTokenMatches(tok, tok.replace(/.$/, "0")));
    // These four were the `!clientToken ||` half of the old check; keep them
    // explicit so nobody "simplifies" the guard away.
    ok("undefined provided is refused", !auth.csrfTokenMatches(undefined, tok));
    ok("empty provided is refused", !auth.csrfTokenMatches("", tok));
    ok("undefined expected is refused", !auth.csrfTokenMatches(tok, undefined));
    ok("both empty is refused (not vacuously true)", !auth.csrfTokenMatches("", ""));
    // Length mismatch must not throw — timingSafeEqual does, hence the hashing.
    ok("a length mismatch compares false rather than throwing",
        auth.csrfTokenMatches("short", tok) === false);
}

// ── C. Cluster-wide budget division ─────────────────────────────────────────
console.log("# cluster-wide budget division");
{
    const { perProcessBudget, DEPLOYMENT_PROCESS_COUNT: N } = runtime;
    // In-process the suite is single, so N is 1 and values pass through. The
    // rule under test is the arithmetic, so assert it relative to N.
    eq("a budget divides by the process count", perProcessBudget(8 * N), 8);
    ok("never drops below 1 — a worker allowed zero can only deadlock",
        perProcessBudget(1) === 1 && perProcessBudget(N) === 1);
    eq("undefined stays undefined (ungated method)", perProcessBudget(undefined), undefined);
    eq("zero stays zero (ungated)", perProcessBudget(0), 0);
    eq("a non-number passes through untouched", perProcessBudget("nope"), "nope");
}

// ── D. Abort grace: a handler ignoring ctx.signal must not hang forever ─────
console.log("# RPC abort grace");
{
    const { settleWithinAbortGrace } = runtime;

    // Fast path: a handler that settles normally is untouched.
    const ac1 = new AbortController();
    const v = await settleWithinAbortGrace(Promise.resolve("done"), ac1.signal);
    eq("a resolving handler resolves", v, "done");

    // A handler that honours the abort rejects immediately, not after the grace.
    const ac2 = new AbortController();
    const started = Date.now();
    ac2.abort(new Error("Client disconnected"));
    let err = null;
    try {
        await settleWithinAbortGrace(new Promise((_, rej) => setTimeout(() => rej(new Error("late")), 5)), ac2.signal);
    } catch (e) { err = e; }
    ok("an already-aborted signal still lets a prompt rejection through", !!err);
    ok("…and does not wait out the grace window", Date.now() - started < 5000);

    // The real regression: a handler that NEVER settles. Patch the grace to
    // something testable by aborting and waiting — we cannot wait 60s, so use a
    // signal that is already aborted plus a promise that never settles, and
    // assert we do not resolve before the grace (i.e. it is still pending).
    const ac3 = new AbortController();
    const never = new Promise(() => {});
    ac3.abort(new Error("timeout"));
    const pending = settleWithinAbortGrace(never, ac3.signal);
    const outcome = await Promise.race([
        pending.then(() => "settled", () => "rejected"),
        new Promise(r => setTimeout(() => r("still-waiting"), 250)),
    ]);
    eq("a never-settling handler is still held during the grace window", outcome, "still-waiting");
    // Swallow the eventual rejection so the process does not warn.
    pending.catch(() => {});
    ok("the grace window is generous (>= 10s) so a slow-but-fine handler survives",
        runtime.RPC_ABORT_GRACE_MS >= 10_000);
}

// ── E. Byte estimation ──────────────────────────────────────────────────────
console.log("# cache byte estimation");
{
    const { estimateBytes } = boundedCache;

    eq("a buffer reports its real length", estimateBytes(Buffer.alloc(4096)), 4096);
    ok("a long string is proportional to its length",
        estimateBytes("x".repeat(10_000)) >= 20_000);

    // THE regression: the tiered front tier stores {value, version} envelopes,
    // so a flat per-object charge made `maxBytes` unable to see anything.
    const small = { value: "x".repeat(10), version: "1" };
    const large = { value: "x".repeat(100_000), version: "1" };
    ok("an envelope around a large string costs far more than one around a small string",
        estimateBytes(large) > estimateBytes(small) * 100,
        `small=${estimateBytes(small)} large=${estimateBytes(large)}`);
    ok("a large envelope is accounted in the right order of magnitude (not 256 bytes)",
        estimateBytes(large) > 100_000, `got ${estimateBytes(large)}`);

    ok("nested objects are counted",
        estimateBytes({ a: { b: { c: "y".repeat(5000) } } }) > 5000);
    ok("arrays are counted",
        estimateBytes(["z".repeat(2000), "z".repeat(2000)]) > 6000);

    // The estimator must not become a liability itself.
    const cyclic = { name: "root" };
    cyclic.self = cyclic;
    ok("a cyclic graph terminates", Number.isFinite(estimateBytes(cyclic)));

    let deep = { leaf: "v" };
    for (let i = 0; i < 200; i += 1) deep = { deep };
    ok("a very deep graph terminates and stays bounded",
        Number.isFinite(estimateBytes(deep)) && estimateBytes(deep) < 5_000_000);

    // The node cap is what makes this bounded: without it the estimator walks
    // 50k properties on every `set`. Assert the cap by cost RELATIVE to a
    // trivial value rather than by wall clock, so a loaded CI box cannot fail it.
    const wide = {};
    for (let i = 0; i < 50_000; i += 1) wide[`k${i}`] = i;
    const wideBytes = estimateBytes(wide);
    ok("a very wide object stays finite", Number.isFinite(wideBytes));
    ok("…and is node-capped, not walked in full",
        wideBytes < 50_000 * 8, `got ${wideBytes} for 50k numeric props`);

    ok("a promise gets a nominal charge, not a walk of its internals",
        estimateBytes(Promise.resolve("x")) <= 256);
}

// ── F. Sweeper leadership lease ─────────────────────────────────────────────
console.log("# sweeper leadership lease");
{
    const root = tmpRoot("sweep");
    const lockPath = path.join(root, ".sweep.lock");

    const makeNs = (id) => ({ id });
    const sweptBy = [];
    const driverFor = (tag) => ({
        async sweep(ns, opts) { sweptBy.push([tag, opts.leader]); return 0; },
    });

    const a = createSweeper({ root, intervalMs: 0, logger: { warn() {} } });
    a.register(makeNs("ns-a"), driverFor("a"));
    const first = await a.sweepOnce();
    ok("the first process takes the lease", first.leader === true);
    ok("a lease file is written", existsSync(lockPath));

    const lease = JSON.parse(readFileSync(lockPath, "utf8"));
    ok("the lease records a holder id, not a bare pid",
        typeof lease.holder === "string" && lease.holder.includes(":"),
        JSON.stringify(lease));

    // A live lease held by somebody else must be respected.
    writeFileSync(lockPath, JSON.stringify({ holder: "99999:7", at: Date.now() }), "utf8");
    const second = await a.sweepOnce();
    eq("a live lease held by another process blocks us", second.leader, false);

    // A stale lease is stealable — this is what makes a crashed leader recover,
    // and what `cluster.worker.id === 1` could never do.
    writeFileSync(lockPath, JSON.stringify({ holder: "99999:7", at: Date.now() - 10 * 60_000 }), "utf8");
    const third = await a.sweepOnce();
    eq("a stale lease is stolen", third.leader, true);

    // Backwards compatibility: a lease written by the previous format.
    writeFileSync(lockPath, JSON.stringify({ pid: 4242, at: Date.now() }), "utf8");
    const fourth = await a.sweepOnce();
    eq("an old-format {pid,at} lease is still understood as held", fourth.leader, false);

    // Every process sweeps its own in-process tier regardless of leadership.
    ok("the driver is swept on every pass, leader or not", sweptBy.length === 4);
    ok("…and is told whether this pass owns the shared tier",
        sweptBy.every(([, l]) => typeof l === "boolean"));

    // Clean shutdown returns the lease so the next process does not wait it out.
    writeFileSync(lockPath, JSON.stringify({ holder: "99999:7", at: Date.now() }), "utf8");
    a.dispose();
    ok("dispose() does NOT delete a lease held by someone else", existsSync(lockPath));

    const b = createSweeper({ root, intervalMs: 0, logger: { warn() {} } });
    b.register(makeNs("ns-b"), driverFor("b"));
    rmSync(lockPath, { force: true });
    await b.sweepOnce();
    ok("a fresh sweeper takes the freed lease", existsSync(lockPath));
    b.dispose();
    ok("dispose() releases our OWN lease", !existsSync(lockPath));
}

// ── G. File driver: touch CAS and blob commit ordering ──────────────────────
console.log("# file driver concurrency");
{
    const root = tmpRoot("filedrv");
    const driver = createFileDriver({ root, fsync: false });
    const kvNs = { id: "t/kv:x", ownerUid: "t", namespace: "x", shape: "kv", capabilityId: "kv:x", policy: { ttlMs: 60_000 } };

    await driver.set(kvNs, "k1", { hello: "world" }, {});
    const got = await driver.get(kvNs, "k1");
    eq("kv round-trips", got?.hello, "world");

    ok("touch on a live record succeeds", (await driver.touch(kvNs, "k1")) === true);
    eq("touch does not alter the value", (await driver.get(kvNs, "k1"))?.hello, "world");
    ok("touch on a missing record reports false", (await driver.touch(kvNs, "nope")) === false);

    // Concurrency limit, stated honestly.
    //
    // `touch` is a read-modify-write on a file other processes also write, and
    // the driver offers no compare-and-set. The content guard closes the wide
    // window (it re-reads and retries when the bytes changed under it, which is
    // what makes it robust where an mtime check is not — NTFS mtime granularity
    // hides sub-millisecond writes) but a `set` landing between the guard's
    // re-read and the write still wins-then-loses. Closing that needs a lock on
    // every authenticated request, which is not worth paying for: the shared
    // session half is effectively immutable apart from `lastSeenAt`, so the
    // realistic cost of losing this race is one skipped recency bump.
    //
    // So what is asserted is the invariant that MUST hold: the record survives
    // intact and readable, holding one of the two values actually written —
    // never a corrupt record, never a resurrected third state.
    await driver.set(kvNs, "race", { v: "old" }, {});
    await Promise.all([
        driver.touch(kvNs, "race"),
        driver.set(kvNs, "race", { v: "new" }, {}),
    ]);
    const raced = await driver.get(kvNs, "race");
    ok("a touch/set race leaves an intact record holding one of the written values",
        raced && (raced.v === "new" || raced.v === "old"),
        `got ${JSON.stringify(raced)}`);

    // What the guard DOES guarantee unconditionally: touch never resurrects a
    // record that is gone. This is the failure that would actually hurt —
    // a deleted session coming back because a concurrent request touched it.
    await driver.set(kvNs, "gone", { v: 1 }, {});
    await driver.delete(kvNs, "gone");
    ok("touch after delete does not resurrect the record",
        (await driver.touch(kvNs, "gone")) === false
        && (await driver.get(kvNs, "gone")) === null);

    // And it must refresh the TTL it was asked to refresh, uncontended.
    await driver.set(kvNs, "ttl", { v: 1 }, {});
    const before = (await driver.stat(kvNs, "ttl"))?.updatedAt;
    await new Promise(r => setTimeout(r, 25));
    await driver.touch(kvNs, "ttl");
    const after = (await driver.stat(kvNs, "ttl"))?.updatedAt;
    ok("an uncontended touch really does refresh the record", after > before,
        `before=${before} after=${after}`);

    // Blob: meta is the commit record, so bytes must never be readable without it.
    const blobNs = { id: "t/blob:b", ownerUid: "t", namespace: "b", shape: "blob", capabilityId: "blob:b", policy: {} };
    await driver.put(blobNs, "img", Buffer.from("PAYLOAD"), { contentType: "application/octet-stream" });
    const read = await driver.read(blobNs, "img");
    eq("a committed blob reads back", read?.toString(), "PAYLOAD");

    // Simulate the mid-put window by removing the meta sidecar.
    const metaCandidates = [];
    const walkDir = (d) => {
        for (const e of require("node:fs").readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walkDir(p);
            else if (/\.meta\.json$/.test(e.name) || /meta/.test(e.name)) metaCandidates.push(p);
        }
    };
    walkDir(root);
    if (metaCandidates.length) {
        rmSync(metaCandidates[0], { force: true });
        const orphan = await driver.read(blobNs, "img");
        eq("bytes without a committed meta read as absent, not as half-written data", orphan, null);
    } else {
        ok("blob meta sidecar located", false, "no meta file found under the storage root");
    }
}

// ── H. Build lock serializes compilation across callers ─────────────────────
console.log("# server-module-loader build lock");
{
    const loader = require(R("server-module-loader.js"));
    ok("compileServerTs is exported", typeof loader.compileServerTs === "function");
    ok("loadServerModuleFromFile is exported (the single canonical loader)",
        typeof loader.loadServerModuleFromFile === "function");

    // server-helpers must delegate rather than carry its own second compiler —
    // the duplicate used a per-DIRECTORY .meta.json, so two *.server.ts in one
    // folder clobbered each other's freshness stamp.
    const helpersSrc = readFileSync(R("server-helpers.js"), "utf8");
    ok("server-helpers no longer defines its own compileTs",
        !/async function compileTs\s*\(/.test(helpersSrc));
    ok("…and no longer writes a directory-level .meta.json",
        !/join\(outDir,\s*['"]\.meta\.json['"]\)/.test(helpersSrc));

    const loaderSrc = readFileSync(R("server-module-loader.js"), "utf8");
    ok("the compiler builds via a temp path and renames into place",
        /renameSync\(/.test(loaderSrc) && /tmpDir/.test(loaderSrc));
    ok("…and takes a cross-process lock",
        /withBuildLock/.test(loaderSrc) && /wx/.test(loaderSrc));
    ok("the meta stamp is written after the rename, never before",
        loaderSrc.indexOf("renameSync(tmpOut, outFile)") < loaderSrc.indexOf("writeFileSync(metaFile"));
}

// ── I. Cluster supervisor policy ────────────────────────────────────────────
console.log("# cluster supervisor policy");
{
    const src = readFileSync(R("cluster-index.js"), "utf8");
    ok("a deliberate exit is not treated as a crash", /exitedAfterDisconnect/.test(src));
    ok("respawn backs off instead of tight-looping", /RESPAWN_BACKOFF|backoff/i.test(src));
    ok("a crash budget stops an unbounded fork loop", /CRASH_BUDGET/.test(src));
    ok("SIGTERM and SIGINT are handled", /SIGTERM/.test(src) && /SIGINT/.test(src));
    ok("workers get a drain window before SIGKILL", /SIGKILL/.test(src) && /GRACE/.test(src));
}

// ── done ────────────────────────────────────────────────────────────────────
for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n# ${failed} of ${n} FAILED` : `\n# all ${n} passed`);
process.exit(failed ? 1 : 0);
