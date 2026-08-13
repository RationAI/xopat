/**
 * RPC verifier-context resolution — regression suite.
 *
 * Guards two things that broke a live deployment:
 *
 *  1. The MAIN auth context has two spellings. The client canonicalizes it to
 *     "core"; this registry has always keyed it "default". Nothing aliased them,
 *     so `rpcVerifiers.default` — the documented configuration, and what nearly
 *     every shipped env uses — rejected every RPC that named "core".
 *  2. A named SUB-context that has no entry must still be refused, not
 *     downgraded onto the main entry. That is the bypass the strictness exists
 *     for, and fixing (1) must not weaken it.
 *
 * Plain node, no framework — same shape as test/dicom/derived-conformance.mjs.
 * Run: npm run test:auth-context
 */
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fromRoot } from "@xopat/test-harness/paths";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const auth = require(fromRoot("server", "node","auth.js"));
const helpers = require(fromRoot("server", "node","server-helpers.js"));

const { resolveVerifierContext, requireRpcAuthContext, normalizeRpcContextId } = auth;

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

// ── fixtures ────────────────────────────────────────────────────────────────
const SECRET = "unit-test-secret";
function mintHs256(payload, secret = SECRET) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const h = b64({ alg: "HS256", typ: "JWT" });
    const p = b64(payload);
    const s = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
    return `${h}.${p}.${s}`;
}
function makeCtx(rpcVerifiers, authHeader) {
    return {
        core: { CORE: { server: { secure: { rpcVerifiers } } } },
        req: { headers: authHeader ? { authorization: authHeader } : {} },
    };
}
const validToken = () => mintHs256({ sub: "alice", exp: Math.floor(Date.now() / 1000) + 600 });
const JWT_CTX = { verifiers: { jwt: { secret: SECRET } }, mode: "all" };

async function codeOf(promise) {
    try { await promise; return null; } catch (e) { return e?.code || e?.message; }
}

// ── A. resolveVerifierContext — pure policy ─────────────────────────────────
console.log("# resolveVerifierContext");

const D = { enabled: false };
const C = { verifiers: { saml: {} } };
const A = { verifiers: { oidc: {} } };

eq("{default} + 'core' resolves to default  (THE reported regression)",
    resolveVerifierContext({ default: D }, "core").key, "default");
eq("{default:[verifiers]} + 'core' resolves  (the MIXTURE deployment shape)",
    resolveVerifierContext({ default: { verifiers: ["mixture-session"], mode: "all" } }, "core").key, "default");
eq("{core} + absent resolves core  (no downgrade by omitting the field)",
    resolveVerifierContext({ core: C }, undefined).key, "core");

// A DIFFERING main-context split is a configuration error, not a routing rule.
// It used to be a shipped pattern (env.saml.json: default:{enabled:false} +
// core:{saml}) — and because the CLIENT writes the spelling, sending
// contextId:"default" (or omitting it) landed on the disabled entry and skipped
// SAML entirely. Both spellings name the same context, so no request-time rule
// can be correct; only the operator can say which entry they meant.
{
    let threw = false;
    try { auth.canonicalizeRpcVerifierContexts({ default: D, core: C }); } catch { threw = true; }
    ok("differing main-context split is refused outright", threw);
}
{
    let threw = false;
    try { auth.canonicalizeRpcVerifierContexts({ default: C, core: { ...C } }); } catch { threw = true; }
    ok("identical main spellings collapse silently", !threw);
}
// One entry serves every spelling — the caller's spelling selects nothing.
for (const spelling of ["core", "", "default", null, undefined]) {
    eq(`single {default} serves ${JSON.stringify(spelling)}`,
        resolveVerifierContext({ default: C }, spelling).entry, C);
    eq(`single {core} is NOT downgradable via ${JSON.stringify(spelling)}`,
        resolveVerifierContext({ core: C }, spelling).entry, C);
}
eq("{''} + 'core' resolves the empty-string spelling",
    resolveVerifierContext({ "": C }, "core").key, "");
eq("{core} + 'default' aliases in the other direction",
    resolveVerifierContext({ core: C }, "default").key, "core");
eq("{default} + '' resolves",
    resolveVerifierContext({ default: D }, "").key, "default");
eq("{default} + null resolves",
    resolveVerifierContext({ default: D }, null).key, "default");

{
    const r = resolveVerifierContext({}, "core");
    ok("{} + 'core' is unconfigured, NOT unknown  (zero-config deployments)",
        r.found === false && r.unknown === false && r.main === true, JSON.stringify(r));
}
{
    const r = resolveVerifierContext({}, undefined);
    ok("{} + absent is unconfigured, not unknown", r.found === false && r.unknown === false, JSON.stringify(r));
}
{
    const r = resolveVerifierContext({ default: D }, "anthropic");
    ok("unknown SUB-context is refused, never downgraded onto default",
        r.found === false && r.unknown === true, JSON.stringify(r));
}
eq("known sub-context resolves exactly",
    resolveVerifierContext({ default: D, anthropic: A }, "anthropic").key, "anthropic");

for (const evil of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
    ok(`prototype key ${JSON.stringify(evil)} is unknown, never walked`,
        resolveVerifierContext({ default: D }, evil).unknown === true);
}
{
    const inherited = Object.create({ sneaky: { verifiers: {} } });
    inherited.default = D;
    ok("inherited key is not found (prototype walk closed)",
        resolveVerifierContext(inherited, "sneaky").unknown === true);
}
for (const bad of [123, {}, ["core"], true]) {
    ok(`non-string contextId ${JSON.stringify(bad)} is unknown`,
        resolveVerifierContext({ default: D }, bad).unknown === true);
}
eq("normalizeRpcContextId collapses every main spelling",
    ["core", "", "default", null, undefined].map(normalizeRpcContextId).join(","), "core,core,core,core,core");
eq("normalizeRpcContextId passes a sub-context through", normalizeRpcContextId("anthropic"), "anthropic");

// ── B. requireRpcAuthContext ────────────────────────────────────────────────
console.log("# requireRpcAuthContext");

{
    // The headline: "default should work with default login".
    const ctx = makeCtx({ default: JWT_CTX }, `Bearer ${validToken()}`);
    const res = await requireRpcAuthContext(ctx, "core");
    eq("'core' verifies against rpcVerifiers.default", res.contextId, "core");
    eq("  …and reports which key matched", res.matchedKey, "default");
    eq("  …and yields the principal", res.principal, "user:alice");
}
eq("missing Bearer fails verification",
    await codeOf(requireRpcAuthContext(makeCtx({ default: JWT_CTX }), "core")),
    "RPC_AUTH_CONTEXT_FAILED");
eq("{default:{enabled:false}} + 'core' reports DISABLED, not UNCONFIGURED  (proves the alias fired)",
    await codeOf(requireRpcAuthContext(makeCtx({ default: D }, "Bearer x"), "core")),
    "RPC_AUTH_CONTEXT_DISABLED");
// `bearer` is a SHARED-SECRET gate. It used to check only that the header started
// with "Bearer " — no secret read, nothing compared — so any context using it was
// unauthenticated while its name and docs claimed otherwise.
eq("bearer with no configured secret fails closed (was: accepted anything)",
    await codeOf(requireRpcAuthContext(makeCtx({ default: { verifiers: { bearer: {} } } }, "Bearer x"), "core")),
    "RPC_AUTH_CONTEXT_FAILED");
eq("bearer with the wrong token fails",
    await codeOf(requireRpcAuthContext(
        makeCtx({ default: { verifiers: { bearer: { secret: "s3cr3t" } } } }, "Bearer wrong"), "core")),
    "RPC_AUTH_CONTEXT_FAILED");
eq("bearer with the right token passes but yields NO principal",
    await codeOf(requireRpcAuthContext(
        makeCtx({ default: { verifiers: { bearer: { secret: "s3cr3t" } } } }, "Bearer s3cr3t"), "core")),
    "RPC_AUTH_CONTEXT_NO_PRINCIPAL");
eq("a sub-context entry never satisfies the main context",
    await codeOf(requireRpcAuthContext(makeCtx({ anthropic: A }, "Bearer x"), "core")),
    "RPC_AUTH_CONTEXT_UNCONFIGURED");
eq("undefined contextId is invalid — a resource must name its context",
    await codeOf(requireRpcAuthContext(makeCtx({ default: JWT_CTX }, "Bearer x"), undefined)),
    "RPC_AUTH_CONTEXT_INVALID");

{
    let message = "";
    try { await requireRpcAuthContext(makeCtx({}, "Bearer x"), "core"); } catch (e) { message = e.message; }
    ok("unconfigured MAIN context names both accepted spellings",
        message.includes("rpcVerifiers.core") && message.includes("rpcVerifiers.default"), message);
}
{
    let message = "";
    try { await requireRpcAuthContext(makeCtx({}, "Bearer x"), "anthropic"); } catch (e) { message = e.message; }
    ok("unconfigured SUB-context names only itself (not misleading 'default' advice)",
        message.includes("rpcVerifiers.anthropic") && !message.includes("rpcVerifiers.default"), message);
}
{
    let calls = 0;
    auth.registerRpcAuthVerifier("__count", async () => { calls++; return { ok: true, user: { id: "u" } }; });
    const ctx = makeCtx({ default: { verifiers: { __count: {} } } }, "Bearer x");
    await requireRpcAuthContext(ctx, "core");
    await requireRpcAuthContext(ctx, "default");
    await requireRpcAuthContext(ctx, "");
    eq("all main spellings share one memoized verification", calls, 1);
}
{
    const ctx = makeCtx({ default: JWT_CTX }, "Bearer nope");
    const a = await requireRpcAuthContext(ctx, "core").catch(e => e);
    const b = await requireRpcAuthContext(ctx, "core").catch(e => e);
    ok("failures are memoized too (same Error rethrown)", a === b);
}
{
    // Cross-context identity bleed: every verifier writes `req.user` as a side
    // effect and `req` is shared across contexts in one request, so an
    // identity-less verifier in context B used to inherit context A's user and
    // satisfy the "this context yielded a principal" check.
    const token = validToken();
    const ctx = makeCtx({
        default: JWT_CTX,                                        // identity
        weak: { verifiers: { bearer: { secret: "shared" } } },   // no identity
    }, `Bearer ${token}`);
    // Establish an identity on the main context first.
    const main = await requireRpcAuthContext(ctx, "core");
    eq("  (main context still yields its principal)", main.principal, "user:alice");
    // The weak context sees the same Authorization header; it must NOT inherit.
    ctx.req.headers.authorization = "Bearer shared";
    eq("identity from context A does not satisfy context B",
        await codeOf(requireRpcAuthContext(ctx, "weak")),
        "RPC_AUTH_CONTEXT_NO_PRINCIPAL");
}

// ── C. getRpcAuthConfig ─────────────────────────────────────────────────────
console.log("# getRpcAuthConfig");

const helperCtx = (rpcVerifiers, extra = {}) => ({ secure: { rpcVerifiers }, ...extra });
eq("'core' finds the default entry", helpers.getRpcAuthConfig(helperCtx({ default: D }), "core"), D);
eq("unknown named key returns null (BEHAVIOUR CHANGE: was the default entry)",
    helpers.getRpcAuthConfig(helperCtx({ default: D }), "anthropic"), null);
eq("'__proto__' returns null, no prototype walk",
    helpers.getRpcAuthConfig(helperCtx({ default: D }), "__proto__"), null);
eq("legacy rpcAuth key still honoured",
    helpers.getRpcAuthConfig({ secure: { rpcAuth: { default: D } } }, "core"), D);
eq("ctx.contextId precedence preserved",
    helpers.getRpcAuthConfig(helperCtx({ default: D }, { contextId: "core" })), D);

// ── D. RPC body hardening ───────────────────────────────────────────────────
// A body of the literal text `null` used to reach `body.contextId` OUTSIDE the
// try and BEFORE any auth check, from an unauthenticated request — TypeError,
// unhandled rejection, process exit (the uncaughtException handler was dev-only).
console.log("# RPC body hardening");

{
    const { XopatServerRuntime } = require(fromRoot("server", "node","server-runtime.js"));
    const repoRoot = fromRoot();

    // devMode gives us a real builtin target ("server/core/getStatus") whose policy
    // is `requireSession: true` — so a 400 proves the body was rejected BEFORE the
    // auth gate, which is where the crash used to happen.
    const runtime = new XopatServerRuntime({
        root: repoRoot,
        auth: { verifyRpcAuth: auth.verifyRpcAuth },
        logger: { log() {}, warn() {}, error() {}, info() {} },
        devMode: true,
        version: "test",
        startedAt: new Date(),
    });

    function fakeReq(raw) {
        const chunks = raw === null ? [] : [Buffer.from(raw, "utf8")];
        return {
            headers: {},
            destroyed: false,
            destroy() { this.destroyed = true; },
            async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; },
        };
    }
    function fakeRes() {
        return {
            destroyed: false, writableEnded: false, headersSent: false,
            status: 0, payload: "",
            writeHead(status) { this.status = status; this.headersSent = true; },
            end(body) { this.payload = body || ""; this.writableEnded = true; },
            write(body) { this.payload += body || ""; },
            on() {}, removeListener() {},
        };
    }
    async function callRpc(raw, urlPath = "/__rpc/server/core/getStatus") {
        const res = fakeRes();
        const urlObj = new URL(`http://localhost${urlPath}`);
        await runtime.handleRpc(fakeReq(raw), res, { CORE: { server: { secure: {} } } }, null, urlObj);
        let body = {};
        try { body = JSON.parse(res.payload || "{}"); } catch { /* non-JSON */ }
        return { status: res.status, code: body.code };
    }

    for (const hostile of ["null", "5", '"x"', "[]", "[1,2]", "true"]) {
        const r = await callRpc(hostile);
        ok(`body ${hostile} → 400 RPC_BAD_JSON (no crash)`,
            r.status === 400 && r.code === "RPC_BAD_JSON", JSON.stringify(r));
    }
    {
        const r = await callRpc("{not json");
        ok("malformed JSON → 400 RPC_BAD_JSON", r.status === 400 && r.code === "RPC_BAD_JSON", JSON.stringify(r));
    }
    {
        // A valid object still reaches the auth gate — proving the body check did
        // not swallow the request, and that the gate is what rejects it.
        const r = await callRpc('{"args":[]}');
        ok("valid object body reaches the auth gate (401, not 400)",
            r.status === 401, JSON.stringify(r));
    }
    {
        // maxBodyBytes: the builtin policy declares none, so the 256 KiB default applies.
        const r = await callRpc(`{"args":[${JSON.stringify("x".repeat(300 * 1024))}]}`);
        ok("over-cap body → 413 RPC_BODY_TOO_LARGE (was: buffered unbounded, pre-auth)",
            r.status === 413 && r.code === "RPC_BODY_TOO_LARGE", JSON.stringify(r));
    }
    {
        // An unknown target must 404 without reading the body at all.
        const r = await callRpc("null", "/__rpc/module/no-such-module/nope");
        ok("unknown target 404s without touching the body", r.status === 404, JSON.stringify(r));
    }
}

// ── E. chat registry survives a hot reload ──────────────────────────────────
// The outage this suite was written for: the registry used to park its INSTANCE
// on globalThis, so after a module hot reload the surviving object had the old
// prototype and new code calling a new method on it 500'd every chat RPC.
console.log("# chat registry hot reload");

{
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, copyFileSync, rmSync } = await import("node:fs");
    const os = await import("node:os");

    const repoRoot = fromRoot();
    const entry = path.join(repoRoot, "modules", "vercel-ai-chat-sdk", "server", "chatRegistry.server.ts");
    const tmp = mkdtempSync(path.join(os.tmpdir(), "xopat-reg-"));
    try {
        // Two independently-loaded copies of the same source = two distinct classes,
        // which is exactly what the server-module loader produces across a reload.
        execFileSync("node", [
            path.join(repoRoot, "node_modules", "esbuild", "bin", "esbuild"),
            entry, "--bundle", "--platform=node", "--format=esm",
            `--outfile=${path.join(tmp, "a.mjs")}`, "--log-level=error",
        ], { cwd: repoRoot, stdio: ["ignore", "ignore", "pipe"] });
        copyFileSync(path.join(tmp, "a.mjs"), path.join(tmp, "b.mjs"));

        const script = `
            import { pathToFileURL } from "node:url";
            // A pre-state-bag instance left behind by an older build: it has the
            // data but none of the methods the current class added.
            globalThis.__XOPAT_CHAT_SERVER_REGISTRY__ = {
                providerTypes: new Map([["legacy", { id: "legacy" }]]),
                providerInstances: new Map(), providerAdapters: new Map(),
                providerSecrets: new Map(), personalities: new Map(),
                sessionPrincipal: new Map(), modelCapabilities: new Map(),
            };
            const A = await import(pathToFileURL(${JSON.stringify(path.join(tmp, "a.mjs"))}).href);
            const r1 = A.ChatServerRegistry.instance();
            r1.registerAdapter({ id: "t", resolveModel: async () => ({}) });
            r1.upsertProviderType({ id: "pt", adapter: "t", label: "PT" });
            const B = await import(pathToFileURL(${JSON.stringify(path.join(tmp, "b.mjs"))}).href);
            const r2 = B.ChatServerRegistry.instance();
            console.log(JSON.stringify({
                differentClass: A.ChatServerRegistry !== B.ChatServerRegistry,
                differentInstance: r1 !== r2,
                sharedState: r1.state === r2.state,
                legacyAdopted: !!r1.getProviderType("legacy"),
                legacyGlobalCleared: globalThis.__XOPAT_CHAT_SERVER_REGISTRY__ === undefined,
                stateSurvived: !!r2.getProviderType("pt"),
            }));
        `;
        const out = execFileSync("node", ["--input-type=module", "-e", script], {
            cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        });
        const r = JSON.parse(out.trim().split("\n").pop());
        ok("a reload really does produce a different class", r.differentClass);
        ok("…and a different instance", r.differentInstance);
        ok("…sharing one state bag", r.sharedState);
        ok("state survives the reload (no 'is not a function')", r.stateSurvived);
        ok("a pre-state-bag global is adopted", r.legacyAdopted);
        ok("…and then removed", r.legacyGlobalCleared);
    } catch (e) {
        ok("chat registry hot-reload check ran", false, String(e?.stderr || e?.message || e));
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

// ── done ────────────────────────────────────────────────────────────────────
console.log(failed ? `\n# ${failed} of ${n} FAILED` : `\n# all ${n} passed`);
process.exit(failed ? 1 : 0);
