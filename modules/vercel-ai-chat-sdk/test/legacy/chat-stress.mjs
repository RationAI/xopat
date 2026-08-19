/**
 * Chat backend + LLM stress / soak suite.
 *
 * Boots the REAL server on a scratch port, points it at a FAKE OpenAI-compatible
 * upstream this file controls, and drives the chat RPC surface the way a hostile
 * or unlucky client would. Nothing here needs an API key and nothing costs money;
 * a real provider can be opted into for a manual run (section J).
 *
 * Why it exists — the outage it descends from:
 *
 *   The assistant called pathology.buildOverview({query: <290 chars>}). That query
 *   was cached per SLIDE (not per chat session), recomposed into every turn's live
 *   viewer context, and the server bounded it at 160 chars by THROWING. The throw
 *   killed the whole RPC turn, so every chat session in the tab stayed broken until
 *   a page reload. One over-long string, authored by the model itself, bricked the
 *   feature. Section C is the regression suite for that, and it asserts the shape
 *   of the fix: advisory telemetry degrades, it never kills a turn.
 *
 * What else it guards, none of which had any coverage:
 *
 *  - Transport bounds (body caps, malformed JSON, unknown targets) must produce a
 *    clean code, never a 500, a stack, or a hang. The body cap is enforced BEFORE
 *    the auth gate, so it is the only bound an anonymous caller faces.
 *  - The provider-mutation RPCs (createProvider et al.) were withdrawn on purpose
 *    for privilege-escalation reasons. Nothing stopped a future `policy` edit from
 *    quietly restoring them.
 *  - Retention: sessions, messages and attachments must evict at their caps rather
 *    than growing with traffic.
 *  - Timeouts: a hung upstream must end the turn at attemptTimeoutMs, and the turn
 *    budget is deliberately INSIDE the RPC ceiling so the caller sees the real
 *    upstream error instead of RPC_TIMEOUT.
 *  - Streaming: NDJSON framing, heartbeats, and the rule that a stream ending with
 *    no terminal record is a failure rather than a partial success.
 *  - RAM (section H, the headline): sustained load must leave RSS on a plateau.
 *    `project_server_ram_retention_plan` is recorded as DEFERRED, so until now
 *    nobody knew whether a long-lived server holds its memory flat.
 *  - Concurrency: sendTurn and sendTurnStream share ONE pool, and the gate is keyed
 *    by method rather than by principal — one cookie can starve every other caller.
 *    Section I pins the current behaviour and names the gap.
 *
 * Deliberately NOT in the `npm run test:server` chain: it is slow and manual.
 *
 * Run:  npm run test:chat-stress
 *       XOPAT_STRESS_ROUNDS=6 npm run test:chat-stress             # quick smoke run
 *       XOPAT_STRESS_SOAK_MS=1800000 npm run test:chat-stress      # 30-minute soak
 *       XOPAT_STRESS_REAL_PROVIDER=1 XOPAT_STRESS_BASE_URL=… \
 *         XOPAT_STRESS_API_KEY=… XOPAT_STRESS_MODEL=… npm run test:chat-stress
 */
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { fromRoot } from "@xopat/test-harness/paths";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = fromRoot();

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
/** A precondition this run could not meet. Reported, never counted as a failure. */
function skip(name, why) {
    n++;
    console.log(`ok ${n} - ${name} # SKIP ${why}`);
}

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = createNetServer();
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The fake upstream ───────────────────────────────────────────────────────
//
// One server, many behaviours, switched through a mutable variable rather than a
// request header: the chat adapter builds its own outbound request, so there is no
// seam to inject a header through. The test sets `upstream.mode` immediately before
// the call it wants to shape.

const upstream = {
    mode: "normal",
    hits: 0,
    completionHits: 0,
    /** Last outbound completion body — the only way to assert what WE sent (e.g. `tools`). */
    lastBody: null,
    /** Sockets parked by "hang", kept so teardown can free them. */
    parked: [],
};

const FAKE_MODEL = "fake-model";

function sseChunk(text) {
    return `data: ${JSON.stringify({
        id: "chatcmpl-stress",
        object: "chat.completion.chunk",
        created: 1,
        model: FAKE_MODEL,
        choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
    })}\n\n`;
}

function completionBody(text) {
    return {
        id: "chatcmpl-stress",
        object: "chat.completion",
        created: 1,
        model: FAKE_MODEL,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
}

async function readBody(req) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

function startFakeUpstream(port) {
    const server = createHttpServer(async (req, res) => {
        upstream.hits += 1;

        if (req.url.startsWith("/v1/models")) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ object: "list", data: [{ id: FAKE_MODEL, object: "model" }] }));
            return;
        }

        const body = await readBody(req);
        const wantsStream = body?.stream === true;
        upstream.completionHits += 1;
        upstream.lastBody = body;
        const mode = upstream.mode;

        if (mode === "damaged-tool-call") {
            // A tool call whose argument JSON carries code with every `]` stripped — the
            // observed transport-corruption shape. The server must pass the bytes through
            // verbatim (the client-side integrity gate is what refuses to run them); silently
            // truncating them here is what used to hide the fault.
            const args = JSON.stringify({ code: "const d = shaders[type;\nreturn d;" });
            const toolCall = {
                index: 0,
                id: "call_stress",
                type: "function",
                function: { name: "run_viewer_script", arguments: args },
            };
            if (wantsStream) {
                res.writeHead(200, { "Content-Type": "text/event-stream" });
                res.write(`data: ${JSON.stringify({
                    id: "chatcmpl-stress", object: "chat.completion.chunk", created: 1, model: FAKE_MODEL,
                    choices: [{ index: 0, delta: { tool_calls: [toolCall] }, finish_reason: null }],
                })}\n\n`);
                res.write(`data: ${JSON.stringify({
                    id: "chatcmpl-stress", object: "chat.completion.chunk", created: 1, model: FAKE_MODEL,
                    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
                })}\n\n`);
                res.write("data: [DONE]\n\n");
                res.end();
                return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                id: "chatcmpl-stress", object: "chat.completion", created: 1, model: FAKE_MODEL,
                choices: [{
                    index: 0,
                    message: { role: "assistant", content: "", tool_calls: [{ ...toolCall, index: undefined }] },
                    finish_reason: "tool_calls",
                }],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            }));
            return;
        }

        if (mode === "hang") {
            // Never answer. The point is that OUR attemptTimeoutMs ends the turn,
            // not that the upstream eventually relents.
            upstream.parked.push(res);
            return;
        }
        if (mode === "500") {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "upstream exploded" } }));
            return;
        }
        if (mode === "429") {
            res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "1" });
            res.end(JSON.stringify({ error: { message: "slow down" } }));
            return;
        }
        if (mode === "malformed") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("{ this is not json");
            return;
        }
        if (mode === "slow") {
            await sleep(3_000);
        }
        if (mode === "truncate" && wantsStream) {
            // Frames, then a socket that dies mid-stream with no [DONE].
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            res.write(sseChunk("partial "));
            res.write(sseChunk("answer"));
            res.socket?.destroy();
            return;
        }
        if (mode === "trickle" && wantsStream) {
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            for (let i = 0; i < 4; i += 1) {
                if (res.writableEnded) return;
                res.write(sseChunk(`t${i} `));
                await sleep(5_000);
            }
            res.write("data: [DONE]\n\n");
            res.end();
            return;
        }

        const text = mode === "huge" ? "lorem ipsum ".repeat(20_000) : "fake answer";

        if (wantsStream) {
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            res.write(sseChunk(text));
            res.write("data: [DONE]\n\n");
            res.end();
            return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(completionBody(text)));
    });
    return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

function releaseParkedUpstreamSockets() {
    for (const res of upstream.parked.splice(0)) {
        try { res.destroy(); } catch { /* already gone */ }
    }
}

// ── Boot ────────────────────────────────────────────────────────────────────

const UPSTREAM_PORT = await freePort();
const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-chat-stress-"));

const fakeUpstream = await startFakeUpstream(UPSTREAM_PORT);

// Deployment config, passed INLINE (XOPAT_ENV accepts a JSON string, not just a
// path) so the run is deterministic instead of inheriting whatever env/env.json
// the developer happens to have.
//
// Budgets are pulled down to their configured FLOORS (tuning.ts FLOORS): the
// shipped attemptTimeoutMs is 300s, which would make the hang test a five-minute
// wait. The floors are the fastest the server will legally go.
const STRESS_TUNING = {
    turnBudgetMs: 30_000,
    attemptTimeoutMs: 15_000,
    maxRetries: 0,
    probeBudgetMs: 5_000,
    maxInlineAttachmentBytes: 16 * 1024,
    decodedMediaCacheBytes: 4 * 1024 * 1024,
    sessionTtlMs: 60_000,
    maxSessions: 30,
    maxMessagesPerSession: 20,
    maxAttachmentsPerSession: 5,
    streaming: true,
};

/**
 * Real-provider mode. Off unless every variable is present, so a stray `npm run`
 * can never spend money. It swaps the endpoint the server is pointed at, which is
 * why it is decided here at boot rather than mid-suite: `ensureChatProviderRegistered`
 * reads secure config only, and the server does not reload it.
 */
const REAL = process.env.XOPAT_STRESS_REAL_PROVIDER === "1"
    && process.env.XOPAT_STRESS_BASE_URL
    && process.env.XOPAT_STRESS_MODEL
    ? {
        baseUrl: process.env.XOPAT_STRESS_BASE_URL,
        model: process.env.XOPAT_STRESS_MODEL,
        apiKey: process.env.XOPAT_STRESS_API_KEY || "",
    }
    : null;

const STRESS_ENV = {
    core: {
        server: {
            secure: {
                rpcVerifiers: { default: { enabled: false } },
                modules: {
                    "vercel-ai-chat-sdk": { tuning: STRESS_TUNING },
                },
                plugins: {
                    // ensureChatProviderRegistered IGNORES its RPC input by design
                    // (the client used to be able to repoint the operator's endpoint
                    // while the operator's key still flowed). Secure config is the
                    // only way in, which is why the upstream is declared here.
                    "chat-openai-compatible": {
                        providerDefaults: REAL ? {
                            id: "stress-real",
                            label: "Stress Real Upstream",
                            baseUrl: REAL.baseUrl,
                            modelsPath: "/models",
                            defaultModelId: REAL.model,
                            apiKey: REAL.apiKey,
                            requiresLogin: false,
                        } : {
                            id: "stress-fake",
                            label: "Stress Fake Upstream",
                            baseUrl: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
                            modelsPath: "/models",
                            defaultModelId: FAKE_MODEL,
                            apiKey: "stress-test-key",
                            requiresLogin: false,
                        },
                    },
                },
            },
            logging: {
                // Only the channel section C reads is turned up, and the ring is
                // small on purpose: a 20 000-entry buffer at debug fills steadily
                // for the whole run, and the soak would then be measuring its own
                // instrumentation. At 2 000 it saturates during warm-up and stops
                // contributing a trend.
                level: "warn",
                // The whole module prefix, not just `:llm`. Levels resolve by
                // longest-prefix match, and the sanitize record is emitted through
                // `ctx.log`, whose channel is `module.vercel-ai-chat-sdk:sendTurn` —
                // with only `:llm` turned up it falls back to the root level and the
                // record silently never reaches the ring.
                channels: { "module.vercel-ai-chat-sdk": "debug" },
                sinks: { console: false, buffer: 2_000, store: false },
            },
        },
    },
};

// --expose-gc makes core.collectGarbage functional. Without it the soak can only
// sample `heapUsed` wherever the collector happens to be, which sawtooths by tens
// of megabytes and hides exactly the retention it is looking for.
const child = spawn(process.execPath, ["--expose-gc", "index.js"], {
    cwd: repoRoot,
    env: {
        ...process.env,
        XOPAT_NODE_PORT: String(PORT),
        XOPAT_DEV_MODE: "1",              // getStatus / getStorageStats are dev-only
        XOPAT_CACHE_DIR: tmp,             // leave nothing behind
        XOPAT_ENV: JSON.stringify(STRESS_ENV),
        // The fake upstream is on loopback and ssrf-guard.js refuses private
        // destinations by design. The operator allowlist is the ONLY sanctioned way
        // to reach one (AGENTS §4), so setting it here also proves the allowlist
        // relaxes the private-IP verdict and nothing else.
        XOPAT_SSRF_ALLOWED_HOSTS: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
child.stdout.on("data", (d) => { serverLog += d; });
child.stderr.on("data", (d) => { serverLog += d; });

function shutdown() {
    releaseParkedUpstreamSockets();
    try { child.kill(); } catch { /* already gone */ }
    try { fakeUpstream.close(); } catch { /* already gone */ }
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}
process.on("exit", shutdown);

/**
 * Poll `/ready`, never `/health`.
 *
 * loadServerExtensions() runs before listen, but startListening is in a .finally(),
 * so the port opens even when extension loading threw — and `/health` answers 200
 * from a worker with zero registered RPC methods. Every RPC below would then 404
 * for a reason that has nothing to do with what is under test.
 */
async function waitForBoot(timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`server exited early (${child.exitCode}):\n${serverLog}`);
        }
        try {
            const res = await fetch(`${BASE}/ready`, { signal: AbortSignal.timeout(5_000) });
            if (res.ok) return;
        } catch { /* not up yet */ }
        await sleep(500);
    }
    throw new Error(`server did not become ready in ${timeoutMs}ms:\n${serverLog}`);
}

// ── RPC helpers ─────────────────────────────────────────────────────────────

let COOKIE = "";
let CSRF = "";

async function bootstrapSession() {
    const page = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(30_000) });
    COOKIE = (page.headers.get("set-cookie") || "").split(";")[0];
    const html = await page.text();
    CSRF = (html.match(/XOPAT_CSRF_TOKEN\s*=\s*"([^"]+)"/) || [])[1] || "";
    return { cookie: COOKIE, csrf: CSRF };
}

function rpcUrl(kind, id, method) {
    return `${BASE}/__rpc/${kind}/${encodeURIComponent(id)}/${encodeURIComponent(method)}`;
}

/** Raw call: returns {status, contentType, json, text} and never throws on 4xx/5xx. */
async function rpcRaw(kind, id, method, payload, opts = {}) {
    const headers = {
        "Content-Type": "application/json",
        ...(opts.anonymous ? {} : { Cookie: COOKIE, "X-XOPAT-CSRF": CSRF }),
        ...(opts.headers || {}),
    };
    const body = opts.rawBody !== undefined
        ? opts.rawBody
        : JSON.stringify({ args: payload === undefined ? [] : [payload] });
    let res;
    try {
        res = await fetch(rpcUrl(kind, id, method), {
            method: opts.method || "POST",
            headers,
            body,
            signal: opts.signal || AbortSignal.timeout(opts.timeoutMs || 60_000),
        });
    } catch (e) {
        // undici reports every transport failure as the bare string "fetch failed";
        // the actionable part (ECONNRESET, UND_ERR_SOCKET, …) is only on `cause`.
        const cause = e?.cause;
        const detail = [cause?.code, cause?.message].filter(Boolean).join(": ");
        return {
            status: 0,
            error: detail ? `${e?.message || e} (${detail})` : String(e?.message || e),
            causeCode: cause?.code || null,
            json: null,
            text: "",
        };
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, contentType: res.headers.get("content-type") || "", json, text };
}

/**
 * Did the body cap refuse these bytes?
 *
 * Two shapes count. The server may answer 413 and close, or — more often, because
 * it aborts the moment the cap is crossed rather than buffering the rest — the
 * socket dies while the client is still uploading and `fetch` rejects before it
 * ever reads the response. Both mean the bytes were refused without being held in
 * memory, which is the property under test. The failure we care about (the server
 * quietly buffering a huge body) looks like neither: it would be a 200, or a hang.
 */
function bodyWasRefused(res) {
    if (res.status === 413) return true;
    if (res.status !== 0) return false;
    // Matched on the cause CODE, not the message: undici's message is the useless
    // constant "fetch failed", and a looser match would also swallow "the server
    // never came up", which is the one outcome this must not mistake for a pass.
    const RESET_CODES = new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET", "ERR_STREAM_PREMATURE_CLOSE"]);
    return RESET_CODES.has(res.causeCode);
}

/** Convenience: returns `result` on ok, throws with the server's code otherwise. */
async function rpc(kind, id, method, payload, opts) {
    const res = await rpcRaw(kind, id, method, payload, opts);
    if (res.json?.ok === true) return res.json.result;
    const err = new Error(res.json?.error || res.error || `HTTP ${res.status}`);
    err.code = res.json?.code || null;
    err.status = res.status;
    throw err;
}

const chat = (method, payload, opts) => rpc("module", "vercel-ai-chat-sdk", method, payload, opts);
const chatRaw = (method, payload, opts) => rpcRaw("module", "vercel-ai-chat-sdk", method, payload, opts);
const core = (method, payload) => rpc("server", "core", method, payload);

/**
 * Read an NDJSON streaming RPC to completion.
 *
 * Pre-handler rejections (401/403/413/429/503) arrive as PLAIN JSON with a normal
 * status and no framing at all, so the content type is checked before anything is
 * split on newlines. A stream that ends without a terminal `{done:…}` record is a
 * failure, not a partial success — that is what the shipped client calls
 * RPC_STREAM_TRUNCATED.
 */
async function streamTurn(payload, opts = {}) {
    const out = { status: 0, framed: false, events: [], pings: 0, done: null, truncated: false, raw: "" };
    let res;
    try {
        res = await fetch(rpcUrl("module", "vercel-ai-chat-sdk", "sendTurnStream"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Cookie: COOKIE,
                "X-XOPAT-CSRF": CSRF,
                ...(opts.omitStreamHeader ? {} : { "X-Xopat-Rpc-Stream": "1" }),
            },
            body: JSON.stringify({ args: [payload] }),
            signal: opts.signal || AbortSignal.timeout(opts.timeoutMs || 90_000),
        });
    } catch (e) {
        out.error = String(e?.message || e);
        return out;
    }
    out.status = res.status;
    out.contentType = res.headers.get("content-type") || "";
    out.framed = out.contentType.includes("ndjson");
    if (!out.framed) {
        out.raw = await res.text();
        try { out.json = JSON.parse(out.raw); } catch { /* not JSON */ }
        return out;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            let record;
            try { record = JSON.parse(line); } catch { out.badFrame = line.slice(0, 200); continue; }
            if (record.ping) { out.pings += 1; continue; }
            if (record.done) { out.done = record; continue; }
            out.events.push(record.event ?? record);
        }
    }
    out.truncated = out.done === null;
    return out;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A minimal snapshot the server should accept unchanged. */
function baseLiveContext(overrides = {}) {
    return {
        composedAt: new Date().toISOString(),
        activeViewerId: "viewer-1",
        viewerCount: 1,
        viewers: [{
            contextId: "viewer-1",
            imageName: "viewer-1",
            isActive: true,
            background: "bg-1",
            currentMagnification: 12.5,
            nativeMagnification: 40,
            magnificationLabel: "13x",
            scalebarText: "500 μm",
            zStack: null,
            pathologyOverview: null,
        }],
        loadedNamespaces: [{ name: "pathology", granted: true }],
        pathologyDrivers: [],
        ...overrides,
    };
}

/** A snapshot whose single viewer carries an overview marker built from `overview`. */
function contextWithOverview(overview) {
    const ctx = baseLiveContext();
    ctx.viewers[0].pathologyOverview = {
        regionsDescribed: 12,
        levels: 3,
        slideCoverage: 0.42,
        isComplete: true,
        truncated: false,
        builtAtIso: new Date().toISOString(),
        query: null,
        gist: "tissue with glands",
        contextKnown: true,
        warningCount: 0,
        ...overview,
    };
    return ctx;
}

let PROVIDER_ID = null;
/** Stable halves of the provider identity, reported by the registration RPC. */
let PROVIDER_TYPE_ID = null;
let PROVIDER_MANAGED_KEY = null;
let MODEL_ID = REAL ? REAL.model : FAKE_MODEL;

async function newSession(title = "stress") {
    return chat("createSession", { providerId: PROVIDER_ID, modelId: MODEL_ID, title });
}

function userTurn(text, liveViewerContext) {
    return {
        messagesDelta: [{ role: "user", content: text, createdAt: new Date().toISOString() }],
        maxRecentMessages: 5,
        executionMode: "plain",
        ...(liveViewerContext ? { liveViewerContext } : {}),
    };
}

// ── Run ─────────────────────────────────────────────────────────────────────

try {
    await waitForBoot();
    await bootstrapSession();
    ok("a session cookie and CSRF token are obtained", !!COOKIE && CSRF.length >= 16,
        `cookie=${COOKIE} csrf=${CSRF}`);

    // ── A. Transport limits ─────────────────────────────────────────────────
    //
    // Every one of these is a shape an attacker can send for free. None may be a
    // 500, a hang, or a stack trace in the body.
    console.log("# A. transport limits");
    {
        // The body cap is checked BEFORE the auth gate, so an anonymous caller can
        // reach 413 — deliberately, so a huge body is rejected without doing work.
        const oversize = "x".repeat(2 * 1024 * 1024);
        const anon = await chatRaw("sendTurn", null, {
            anonymous: true,
            rawBody: JSON.stringify({ args: [{ sessionId: oversize }] }),
        });
        ok("a 2 MiB body on sendTurn (1 MiB cap) is refused with no session", bodyWasRefused(anon),
            `status ${anon.status} code ${anon.json?.code} error ${anon.error}`);
        ok("…and when the response is readable it carries the stable code",
            anon.status !== 413 || anon.json?.code === "RPC_BODY_TOO_LARGE", String(anon.json?.code));

        const noSession = await chatRaw("createSession", { providerId: "x", modelId: "y" }, { anonymous: true });
        eq("no session on a non-public method is 401", noSession.status, 401);
        const badCsrf = await chatRaw("createSession", { providerId: "x", modelId: "y" },
            { headers: { "X-XOPAT-CSRF": "nope" } });
        eq("a wrong CSRF token is 403", badCsrf.status, 403);

        // listProviderTypes is public: true — the one chat method reachable with no
        // cookie and no token at all.
        const pub = await chatRaw("listProviderTypes", undefined, { anonymous: true });
        eq("listProviderTypes is reachable anonymously", pub.status, 200);

        const badJson = await chatRaw("listProviders", null, { rawBody: "{not json" });
        eq("a malformed JSON body is 400", badJson.status, 400);
        eq("…with RPC_BAD_JSON", badJson.json?.code, "RPC_BAD_JSON");

        for (const [label, raw] of [["null", "null"], ["an array", "[1,2]"], ["a scalar", "42"]]) {
            const res = await chatRaw("listProviders", null, { rawBody: raw });
            eq(`a top-level ${label} body is rejected`, res.json?.code, "RPC_BAD_JSON");
        }

        // `args` that is not an array degrades to [] rather than throwing. Pinned
        // because "degrade" and "crash" are one `.length` apart here.
        const weirdArgs = await chatRaw("listProviderTypes", null, { rawBody: JSON.stringify({ args: "nope" }) });
        ok("a non-array `args` degrades instead of crashing", weirdArgs.status < 500,
            `status ${weirdArgs.status}`);

        // Prototype pollution through the envelope: body fields are read with
        // hasOwnProperty, so __proto__ must be inert.
        const proto = await chatRaw("listProviderTypes", null, {
            rawBody: JSON.stringify({ args: [], __proto__: { polluted: true } }),
        });
        ok("a __proto__ key in the envelope is ignored", proto.status < 500 && !({}).polluted,
            `status ${proto.status}`);

        const deep = { v: 1 };
        let cursor = deep;
        for (let i = 0; i < 2_000; i += 1) { cursor.next = { v: i }; cursor = cursor.next; }
        const nested = await chatRaw("listProviders", null, { rawBody: JSON.stringify({ args: [deep] }) });
        ok("a 2000-deep nested body does not 500", nested.status !== 500, `status ${nested.status}`);

        eq("an unknown method is 404", (await chatRaw("noSuchMethod", {})).json?.code, "RPC_UNKNOWN_METHOD");
        eq("an unknown module is 404",
            (await rpcRaw("module", "does-not-exist", "anything", {})).json?.code, "RPC_UNKNOWN_TARGET");

        const badPath = await fetch(`${BASE}/__rpc/module/only-two-parts`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: COOKIE, "X-XOPAT-CSRF": CSRF },
            body: JSON.stringify({ args: [] }),
        });
        eq("a malformed RPC path is 404", badPath.status, 404);

        // Error disclosure: no stack, no file path, ever.
        const leaky = await chatRaw("getSession", { sessionId: "../../etc/passwd" });
        ok("an error body carries no stack trace",
            !/\bat \w+.*\(.*:\d+:\d+\)/.test(leaky.text) && !leaky.text.includes(repoRoot),
            leaky.text.slice(0, 300));
    }

    // ── B. Provider + model bootstrap ───────────────────────────────────────
    console.log("# B. fake upstream registration");
    {
        try {
            const reg = await rpc("plugin", "chat-openai-compatible", "ensureChatProviderRegistered", {});
            PROVIDER_ID = reg?.providerId || null;
            PROVIDER_TYPE_ID = reg?.providerTypeId || null;
            PROVIDER_MANAGED_KEY = reg?.managedKey || null;
            ok("the fake upstream registers as a managed provider", !!PROVIDER_ID, JSON.stringify(reg));
        } catch (e) {
            ok("the fake upstream registers as a managed provider", false, `${e.code || ""} ${e.message}`);
        }

        if (PROVIDER_ID) {
            const label = REAL
                ? "listModels reaches the configured real upstream"
                : "listModels reaches the loopback upstream through the SSRF allowlist";
            try {
                const models = await chat("listModels", { providerId: PROVIDER_ID });
                const list = Array.isArray(models) ? models : (models?.models || []);
                ok(label, list.some((m) => String(m?.id) === MODEL_ID) || (REAL && list.length > 0),
                    JSON.stringify(list).slice(0, 200));
            } catch (e) {
                ok(label, false, `${e.code || ""} ${e.message}`);
            }
        }

        // Provider REFERENCES. A managed instance id is re-minted on every server start, so
        // deployment config can only name a provider by a stable reference — plugin id, type
        // id or managed key. Referencing one by plugin id is what
        // `mixture-report-assist.extractionProviderId: "chat-openai-compatible"` does, and it
        // used to fail with `Unknown provider 'chat-openai-compatible'.` at first inference.
        if (PROVIDER_ID) {
            // Type id and managed key come from the registration result, not a literal: this
            // deployment's secure config sets `providerDefaults.id` (here "stress-fake"), so
            // hardcoding "openai-compatible" would test a reference no deployment uses. It also
            // pins that `ensureManagedPluginProvider` reports its managedKey at all — the client
            // indexes that value, and re-deriving `${plugin}:${type}:default` guesses wrong
            // whenever a host passes a custom key.
            const refs = {
                "the exact instance id": PROVIDER_ID,
                "the plugin id": "chat-openai-compatible",
                ...(PROVIDER_TYPE_ID ? { "the type id": PROVIDER_TYPE_ID } : {}),
                ...(PROVIDER_MANAGED_KEY ? { "the managed key": PROVIDER_MANAGED_KEY } : {}),
            };
            ok("registration reports the stable managed key", !!PROVIDER_MANAGED_KEY, String(PROVIDER_MANAGED_KEY));
            for (const [what, ref] of Object.entries(refs)) {
                try {
                    const resolved = await chat("resolveProviderRef", { ref });
                    ok(`${what} resolves to the registered provider`,
                        resolved?.providerId === PROVIDER_ID, JSON.stringify(resolved));
                } catch (e) {
                    ok(`${what} resolves to the registered provider`, false, `${e.code || ""} ${e.message}`);
                }
            }
            try {
                const missing = await chat("resolveProviderRef", { ref: "definitely-not-a-provider" });
                ok("an unknown reference resolves to null rather than throwing",
                    missing?.providerId === null, JSON.stringify(missing));
            } catch (e) {
                ok("an unknown reference resolves to null rather than throwing", false, `${e.code || ""} ${e.message}`);
            }

            if (!REAL) {
                upstream.mode = "normal";
                // The reported bug, verbatim.
                try {
                    const out = await rpc("module", "vercel-ai-chat-sdk", "runVisionInference", {
                        providerId: "chat-openai-compatible",
                        model: MODEL_ID,
                        prompt: "hello",
                    });
                    ok("runVisionInference accepts a plugin-id reference", typeof out?.text === "string",
                        JSON.stringify(out).slice(0, 200));
                } catch (e) {
                    ok("runVisionInference accepts a plugin-id reference", false, `${e.code || ""} ${e.message}`);
                }

                const bad = await rpcRaw("module", "vercel-ai-chat-sdk", "runVisionInference", {
                    providerId: "definitely-not-a-provider",
                    model: MODEL_ID,
                    prompt: "hello",
                });
                // The runtime answers 500 for every handler throw (see #rpcErrorPayload), so the
                // stable signal is the forwarded enum code, not the status. A caller must be able
                // to tell "your config names nothing" from "you may not have this provider".
                ok("an unresolvable reference carries the stable unknown-provider code",
                    bad.json?.code === "CHAT_PROVIDER_UNKNOWN", `${bad.status} ${bad.json?.code}`);
                ok("…and carries no stack trace",
                    !/\bat \w+.*\(.*:\d+:\d+\)/.test(bad.text) && !bad.text.includes(repoRoot),
                    bad.text.slice(0, 300));
            }
        }
    }

    const chatUsable = !!PROVIDER_ID;
    // Sections that drive the upstream into a specific misbehaviour, or that spend
    // many turns, only make sense against the fake. Against a real provider they
    // would be untestable, slow, and billed.
    const fakeChat = chatUsable && !REAL;

    // ── C. liveViewerContext fuzz — the regression suite for the outage ──────
    //
    // Every payload here is one the CLIENT can compose. The rule under test is
    // that none of them costs the user their turn: cosmetic violations are
    // sanitized, structural ones drop the block, and the turn runs either way.
    console.log("# C. liveViewerContext hostile payloads");
    if (!fakeChat) {
        skip("liveViewerContext fuzz", chatUsable ? "real-provider mode: 25 billed turns" : "no usable provider");
    } else {
        upstream.mode = "normal";
        const session = await newSession("ctx-fuzz");

        const turnSurvives = async (label, liveViewerContext) => {
            const res = await chatRaw("sendTurn", { sessionId: session.id, ...userTurn("hello", liveViewerContext) });
            ok(label, res.json?.ok === true,
                `status ${res.status} code ${res.json?.code} error ${String(res.json?.error).slice(0, 160)}`);
            return res;
        };

        // The exact outage: a model-authored query far past the bound.
        await turnSurvives("a 161-char overview query does not kill the turn",
            contextWithOverview({ query: "q".repeat(161) }));
        await turnSurvives("a 513-char overview query does not kill the turn",
            contextWithOverview({ query: "q".repeat(513) }));
        await turnSurvives("a 100 000-char overview query does not kill the turn",
            contextWithOverview({ query: "q".repeat(100_000) }));

        // The second latent brick: the empty string was rejected with the same
        // misleading "length out of bounds" message.
        await turnSurvives("an empty builtAtIso does not kill the turn",
            contextWithOverview({ builtAtIso: "" }));
        {
            const ctx = baseLiveContext();
            ctx.viewers[0].imageName = "";
            ctx.viewers[0].contextId = "";
            await turnSurvives("empty imageName and contextId do not kill the turn", ctx);
        }
        {
            const ctx = baseLiveContext();
            delete ctx.loadedNamespaces;
            await turnSurvives("a missing loadedNamespaces does not kill the turn", ctx);
        }
        await turnSurvives("an over-long gist does not kill the turn",
            contextWithOverview({ gist: "g".repeat(4_000) }));
        {
            const ctx = baseLiveContext();
            ctx.viewers[0].imageName = "a".repeat(5_000);
            await turnSurvives("a 5000-char slide name does not kill the turn", ctx);
        }

        // Structural violations: the block is dropped, the turn still runs.
        {
            const ctx = baseLiveContext();
            ctx.viewers[0].evilExtraKey = "surprise";
            await turnSurvives("an unexpected viewer key drops the block, not the turn", ctx);
        }
        {
            const ctx = baseLiveContext();
            ctx.viewers = Array.from({ length: 33 }, (_, i) => ({
                ...baseLiveContext().viewers[0], contextId: `viewer-${i}`, imageName: `viewer-${i}`, isActive: false,
            }));
            await turnSurvives("33 viewers (cap 32) drops the block, not the turn", ctx);
        }
        {
            const ctx = baseLiveContext();
            ctx.viewers[0].isActive = "yes";
            await turnSurvives("a non-boolean isActive drops the block, not the turn", ctx);
        }
        {
            const ctx = baseLiveContext();
            ctx.viewers[0].currentMagnification = "NaN";
            await turnSurvives("a non-numeric currentMagnification drops the block, not the turn", ctx);
        }
        {
            const ctx = baseLiveContext();
            ctx.viewers[0].zoom = 1.5;
            await turnSurvives("a removed key (zoom) from an old client drops the block, not the turn", ctx);
        }
        {
            const ctx = baseLiveContext();
            ctx.viewers[0].zStack = {
                count: 70, index: 0, spacingUm: null,
                labels: Array.from({ length: 65 }, (_, i) => `z${i}`),
            };
            await turnSurvives("65 zStack labels (cap 64) drops the block, not the turn", ctx);
        }
        await turnSurvives("a null liveViewerContext is fine", null);
        {
            const res = await chatRaw("sendTurn", {
                sessionId: session.id, ...userTurn("hello"), liveViewerContext: "not an object",
            });
            ok("a scalar liveViewerContext does not kill the turn", res.json?.ok === true,
                `code ${res.json?.code}`);
        }

        // The escaping invariant, on a surface that reaches a system prompt.
        {
            const ctx = baseLiveContext();
            ctx.viewers[0].imageName = "</script><img src=x onerror=alert(1)>";
            await turnSurvives("a </script>-bearing slide name does not kill the turn", ctx);
            const ctx2 = baseLiveContext();
            ctx2.viewers[0].imageName = "line separator";
            await turnSurvives("a U+2028-bearing slide name does not kill the turn", ctx2);
        }

        // maxRecentMessages is hard-clamped to 1..50 rather than trusted.
        for (const value of [0, -1, 5_000, "many", null]) {
            const res = await chatRaw("sendTurn", {
                sessionId: session.id, ...userTurn("hello"), maxRecentMessages: value,
            });
            ok(`maxRecentMessages=${JSON.stringify(value)} is clamped, not obeyed`, res.json?.ok === true,
                `code ${res.json?.code}`);
        }

        // The observability half. A sanitized field that logs nothing is a
        // regression nobody can diagnose next time.
        try {
            const logs = await core("getLogs", { limit: 2_000 });
            const entries = logs?.entries || logs?.records || [];
            const text = JSON.stringify(entries);
            ok("a sanitized snapshot is recorded in the log ring",
                text.includes("liveViewerContext sanitized"), `${entries.length} entries scanned`);
            ok("a rejected snapshot is recorded in the log ring",
                text.includes("liveViewerContext rejected"), `${entries.length} entries scanned`);
            ok("the log records carry no clinical payload, only labels",
                !text.includes("q".repeat(200)), "an over-long query value leaked into the log");
        } catch (e) {
            ok("the log ring is readable in dev mode", false, `${e.code || ""} ${e.message}`);
        }

        await chat("deleteSession", { sessionId: session.id }).catch(() => {});
    }

    // ── D. The withdrawn provider-mutation surface stays withdrawn ───────────
    //
    // These were removed from `policy` on purpose: they let a caller repoint the
    // operator's endpoint while the operator's key still flowed. The exports still
    // exist for internal callers, so only the policy stands between them and the
    // network.
    console.log("# D. withdrawn RPC surface");
    {
        for (const method of ["registerProviderType", "createProvider", "updateProvider", "deleteProvider"]) {
            const res = await chatRaw(method, {});
            eq(`${method} is not reachable over RPC`, res.json?.code, "RPC_UNKNOWN_METHOD");
        }
    }

    // ── E. Retention ────────────────────────────────────────────────────────
    console.log("# E. session, message and attachment retention");
    if (!chatUsable) {
        skip("retention", "no usable provider");
    } else {
        upstream.mode = "normal";
        const created = [];
        for (let i = 0; i < STRESS_TUNING.maxSessions + 15; i += 1) {
            try { created.push((await newSession(`retention-${i}`)).id); } catch { /* capped */ }
        }
        const listed = await chat("listSessions", {});
        const count = Array.isArray(listed) ? listed.length : (listed?.sessions?.length ?? -1);
        ok(`session count stays at or below maxSessions (${STRESS_TUNING.maxSessions})`,
            count >= 0 && count <= STRESS_TUNING.maxSessions,
            `created ${created.length}, listed ${count}`);

        const session = await newSession("message-retention");
        const overflow = STRESS_TUNING.maxMessagesPerSession + 10;
        await chat("appendMessages", {
            sessionId: session.id,
            messages: Array.from({ length: overflow }, (_, i) => ({
                role: i % 2 ? "assistant" : "user", content: `m${i}`,
            })),
        }).catch(() => {});
        const hydrated = await chat("getSession", { sessionId: session.id, hydrateMessages: true });
        const messages = hydrated?.messages || [];
        ok(`message count stays at or below maxMessagesPerSession (${STRESS_TUNING.maxMessagesPerSession})`,
            messages.length <= STRESS_TUNING.maxMessagesPerSession,
            `${messages.length} messages retained of ${overflow} appended`);

        // uploadAttachment records `sizeBytes: input.dataBase64.length` — the BASE64
        // STRING length, not the decoded byte count, and there is no per-attachment
        // cap below the 12 MiB body cap. Whatever the intended accounting is, it
        // should be deliberate; this pins what it currently does.
        const payload = Buffer.alloc(32 * 1024, 7);
        const dataBase64 = payload.toString("base64");
        try {
            const att = await chat("uploadAttachment", {
                sessionId: session.id, name: "blob.bin", mimeType: "application/octet-stream", dataBase64,
            });
            ok("an attachment's recorded size is not smaller than its decoded bytes",
                Number(att?.sizeBytes ?? 0) >= payload.length,
                `sizeBytes=${att?.sizeBytes} decoded=${payload.length} base64=${dataBase64.length}`);
        } catch (e) {
            ok("a 32 KiB attachment uploads", false, `${e.code || ""} ${e.message}`);
        }

        const overCap = STRESS_TUNING.maxAttachmentsPerSession + 5;
        let accepted = 0;
        for (let i = 0; i < overCap; i += 1) {
            try {
                await chat("uploadAttachment", {
                    sessionId: session.id, name: `a${i}.txt`, mimeType: "text/plain",
                    dataBase64: Buffer.from(`attachment ${i}`).toString("base64"),
                });
                accepted += 1;
            } catch { /* capped */ }
        }
        const after = await chat("getSession", { sessionId: session.id, hydrateMessages: true });
        const attachments = after?.attachments || [];
        ok(`attachments stay at or below maxAttachmentsPerSession (${STRESS_TUNING.maxAttachmentsPerSession})`,
            attachments.length <= STRESS_TUNING.maxAttachmentsPerSession,
            `${attachments.length} retained, ${accepted} accepted of ${overCap}`);

        // A 13 MiB attachment exceeds uploadAttachment's own 12 MiB body cap.
        const huge = await chatRaw("uploadAttachment", null, {
            rawBody: JSON.stringify({
                args: [{ sessionId: session.id, name: "huge.bin", mimeType: "application/octet-stream",
                    dataBase64: "A".repeat(13 * 1024 * 1024) }],
            }),
            timeoutMs: 60_000,
        });
        ok("a 13 MiB attachment body is refused by the 12 MiB cap", bodyWasRefused(huge),
            `status ${huge.status} code ${huge.json?.code} error ${huge.error}`);

        await chat("deleteSession", { sessionId: session.id }).catch(() => {});
    }

    // ── F. Streaming ────────────────────────────────────────────────────────
    console.log("# F. streaming");
    if (!fakeChat) {
        skip("streaming", chatUsable ? "real-provider mode: needs a scriptable upstream" : "no usable provider");
    } else {
        upstream.mode = "normal";
        const session = await newSession("streaming");

        {
            const res = await streamTurn({ sessionId: session.id, ...userTurn("stream please") },
                { omitStreamHeader: true });
            eq("sendTurnStream without the stream header is 400", res.status, 400);
            eq("…with RPC_STREAM_REQUIRED", res.json?.code, "RPC_STREAM_REQUIRED");
        }
        {
            const res = await chatRaw("sendTurn", { sessionId: session.id, ...userTurn("hi") },
                { headers: { "X-Xopat-Rpc-Stream": "1" } });
            eq("the stream header on the buffered sendTurn is 400", res.status, 400);
            eq("…with RPC_NOT_STREAMABLE", res.json?.code, "RPC_NOT_STREAMABLE");
        }
        {
            const res = await streamTurn({ sessionId: session.id, ...userTurn("stream please") });
            ok("a streamed turn is NDJSON-framed", res.framed, res.contentType);
            ok("…and ends with a terminal done record", res.done !== null, JSON.stringify(res).slice(0, 300));
            ok("…which reports success", res.done?.ok === true, JSON.stringify(res.done).slice(0, 300));
            ok("…and no frame failed to parse", !res.badFrame, res.badFrame);
            ok("…having emitted at least one delta", res.events.length > 0, `${res.events.length} events`);
        }
        {
            // A dead upstream mid-stream must surface as a terminal failure record,
            // never as a socket that simply stops.
            upstream.mode = "truncate";
            const res = await streamTurn({ sessionId: session.id, ...userTurn("truncate me") },
                { timeoutMs: 60_000 });
            ok("a truncated upstream still produces a terminal record",
                res.done !== null || res.status >= 400,
                `framed=${res.framed} done=${JSON.stringify(res.done)} truncated=${res.truncated}`);
            upstream.mode = "normal";
        }
        {
            // Both paths now build the payload with the same helper: an
            // enum-shaped `error.code` is forwarded, anything else becomes
            // RPC_INTERNAL_ERROR (the case here — the fake upstream throws a
            // plain Error). What is pinned is the disclosure discipline: an
            // error is reported without a stack, however it was produced.
            upstream.mode = "500";
            const streamed = await streamTurn({ sessionId: session.id, ...userTurn("fail") },
                { timeoutMs: 60_000 });
            const buffered = await chatRaw("sendTurn", { sessionId: session.id, ...userTurn("fail") },
                { timeoutMs: 60_000 });
            ok("a streamed failure carries a terminal error record",
                streamed.done?.ok === false || streamed.status >= 400,
                JSON.stringify(streamed.done).slice(0, 200));
            ok("a buffered failure is reported without a stack",
                buffered.json?.ok !== true && !/\bat \w+.*\(.*:\d+:\d+\)/.test(buffered.text),
                buffered.text.slice(0, 200));
            upstream.mode = "normal";
        }
        {
            // Heartbeats are what keep a proxy from reaping a slow stream. The fake
            // upstream trickles for ~20s, comfortably past the 15s server heartbeat.
            upstream.mode = "trickle";
            const res = await streamTurn({ sessionId: session.id, ...userTurn("trickle") },
                { timeoutMs: 90_000 });
            ok("a slow stream is kept alive by heartbeats", res.pings > 0 || res.events.length > 0,
                `pings=${res.pings} events=${res.events.length}`);
            upstream.mode = "normal";
        }
        {
            // A client that walks away must not hold its concurrency slot. The slot
            // is what everyone else is queueing for.
            upstream.mode = "hang";
            const abort = new AbortController();
            const pending = streamTurn({ sessionId: session.id, ...userTurn("abandon me") },
                { signal: abort.signal });
            await sleep(1_500);
            abort.abort();
            await pending.catch(() => {});
            releaseParkedUpstreamSockets();
            upstream.mode = "normal";

            const after = await chatRaw("sendTurn", { sessionId: session.id, ...userTurn("still alive?") },
                { timeoutMs: 60_000 });
            ok("an abandoned stream does not wedge the turn pool", after.json?.ok === true,
                `status ${after.status} code ${after.json?.code}`);
        }

        await chat("deleteSession", { sessionId: session.id }).catch(() => {});
    }

    // ── G. Timeouts and budgets ─────────────────────────────────────────────
    console.log("# G. timeouts and budgets");
    if (!fakeChat) {
        skip("timeouts", chatUsable ? "real-provider mode: needs a scriptable upstream" : "no usable provider");
    } else {
        const session = await newSession("timeouts");
        {
            // The whole point: a hung upstream ends the turn at attemptTimeoutMs.
            // Not at the 600s RPC ceiling, and not never. turnBudgetMs sits INSIDE
            // the RPC timeout on purpose, so the caller sees the upstream failure
            // rather than RPC_TIMEOUT.
            upstream.mode = "hang";
            upstream.completionHits = 0;
            const started = Date.now();
            const res = await chatRaw("sendTurn", { sessionId: session.id, ...userTurn("hang") },
                { timeoutMs: 120_000 });
            const elapsed = Date.now() - started;
            releaseParkedUpstreamSockets();
            upstream.mode = "normal";

            ok("a hung upstream fails the turn rather than hanging forever",
                res.json?.ok !== true, JSON.stringify(res.json).slice(0, 200));
            ok(`…within the turn budget (${STRESS_TUNING.turnBudgetMs}ms), not the 600s RPC ceiling`,
                elapsed < STRESS_TUNING.turnBudgetMs + 20_000, `took ${elapsed}ms`);
            ok("…and not instantly, which would mean the timeout never armed",
                elapsed > STRESS_TUNING.attemptTimeoutMs / 2, `took ${elapsed}ms`);
            ok("…and it did not become RPC_TIMEOUT", res.json?.code !== "RPC_TIMEOUT",
                String(res.json?.code));
        }
        {
            // maxRetries is 0 here: a clear upstream error must be reported, not
            // re-attempted. A retry storm against a failing provider is how one bad
            // turn becomes an outage.
            upstream.mode = "500";
            upstream.completionHits = 0;
            await chatRaw("sendTurn", { sessionId: session.id, ...userTurn("no retries") },
                { timeoutMs: 60_000 });
            const hits = upstream.completionHits;
            upstream.mode = "normal";
            ok("a clear upstream error is not retried when maxRetries is 0", hits <= 1,
                `upstream saw ${hits} completion requests`);
        }
        {
            upstream.mode = "429";
            upstream.completionHits = 0;
            const started = Date.now();
            await chatRaw("sendTurn", { sessionId: session.id, ...userTurn("rate limited") },
                { timeoutMs: 60_000 });
            const hits = upstream.completionHits;
            const elapsed = Date.now() - started;
            upstream.mode = "normal";
            ok("a 429 with Retry-After does not become a hot retry loop", hits <= 3,
                `upstream saw ${hits} requests in ${elapsed}ms`);
        }
        {
            upstream.mode = "malformed";
            const res = await chatRaw("sendTurn", { sessionId: session.id, ...userTurn("garbage") },
                { timeoutMs: 60_000 });
            upstream.mode = "normal";
            ok("a malformed upstream body is an error, not a crash",
                res.status < 500 || res.json?.code, `status ${res.status} code ${res.json?.code}`);
        }
        {
            upstream.mode = "huge";
            const res = await chatRaw("sendTurn", { sessionId: session.id, ...userTurn("firehose") },
                { timeoutMs: 90_000 });
            upstream.mode = "normal";
            // A 500 is the buffered path's documented answer to ANY handler error
            // (an uncoded Error yields RPC_INTERNAL_ERROR), so "not a 500" would be asserting
            // the wrong thing. What matters is that a firehose response resolves one
            // way or the other and leaves the server able to serve the next caller.
            ok("an oversized upstream response resolves rather than hanging",
                res.status !== 0 && (res.json?.ok === true || !!res.json?.code),
                `status ${res.status} code ${res.json?.code} error ${res.error}`);
            const after = await chatRaw("sendTurn", { sessionId: session.id, ...userTurn("still alive?") },
                { timeoutMs: 60_000 });
            ok("…and the server still serves the next turn", after.json?.ok === true,
                `status ${after.status} code ${after.json?.code}`);
        }
        await chat("deleteSession", { sessionId: session.id }).catch(() => {});
    }

    // ── G2. Script transport: the per-turn escalation ────────────────────────
    //
    // `scriptTransport: 'fence'` is the host's reaction to a script that arrived damaged or a
    // model repeating itself. Two invariants worth pinning forever: the tools param really does
    // disappear from the OUTBOUND request (otherwise the escalation is theatre), and it comes
    // back on the next turn (a one-turn reaction must never be cached as a capability verdict).
    console.log("# G2. script transport escalation");
    {
        const session = await newSession("transport");
        const scriptApi = {
            namespaces: [{
                namespace: "viewer",
                description: "Viewer control",
                methods: [{ name: "getViewport", description: "Reads the viewport." }],
            }],
        };
        const scriptTurn = (text, extra = {}) => ({
            sessionId: session.id,
            ...userTurn(text),
            executionMode: "viewer-script",
            allowedScriptApi: scriptApi,
            ...extra,
        });

        upstream.mode = "normal";
        upstream.lastBody = null;
        const withTools = await chatRaw("sendTurn", scriptTurn("zoom in"), { timeoutMs: 45_000 });
        const toolsSent = Array.isArray(upstream.lastBody?.tools) && upstream.lastBody.tools.length > 0;
        ok("a scripting turn declares the script tool upstream", withTools.json?.ok === true && toolsSent,
            `ok=${withTools.json?.ok} tools=${JSON.stringify(upstream.lastBody?.tools)?.slice(0, 120)}`);

        upstream.lastBody = null;
        const forced = await chatRaw("sendTurn", scriptTurn("zoom in", { scriptTransport: "fence" }),
            { timeoutMs: 45_000 });
        ok("scriptTransport:'fence' sends NO tools param",
            forced.json?.ok === true && !upstream.lastBody?.tools,
            `ok=${forced.json?.ok} tools=${JSON.stringify(upstream.lastBody?.tools)}`);

        upstream.lastBody = null;
        const restored = await chatRaw("sendTurn", scriptTurn("and again"), { timeoutMs: 45_000 });
        ok("…and the next turn gets the tool back (no cached verdict)",
            restored.json?.ok === true && Array.isArray(upstream.lastBody?.tools) && upstream.lastBody.tools.length > 0,
            `ok=${restored.json?.ok} tools=${JSON.stringify(upstream.lastBody?.tools)?.slice(0, 120)}`);

        // Corruption passes through verbatim: the runtime, not the server, is what refuses it,
        // and it can only refuse what it can see.
        upstream.mode = "damaged-tool-call";
        const damaged = await chatRaw("sendTurn", scriptTurn("break it"), { timeoutMs: 45_000 });
        upstream.mode = "normal";
        const replyText = String(damaged.json?.result?.message?.content || "");
        ok("a damaged tool-call still completes the turn", damaged.json?.ok === true,
            `status ${damaged.status} code ${damaged.json?.code} ${JSON.stringify(damaged.json)?.slice(0, 400)}`);
        ok("…and its bytes reach the client untouched, inside a fence",
            /```xopat-script/.test(replyText) && replyText.includes("shaders[type;"),
            replyText.slice(0, 200));

        // The latch. A client that has concluded the connection damages this session's output
        // reports it once; from then on the session stays fence-only on the server's own say-so,
        // so a reload (or a second panel) cannot hand the model back a surface it cannot use.
        upstream.lastBody = null;
        const latching = await chatRaw("sendTurn",
            scriptTurn("latch it", { scriptTransport: "fence", transportDamage: "every `]` is missing" }),
            { timeoutMs: 45_000 });
        ok("a turn reporting transport damage is accepted", latching.json?.ok === true,
            `status ${latching.status} code ${latching.json?.code}`);

        upstream.lastBody = null;
        const afterLatch = await chatRaw("sendTurn", scriptTurn("still latched?"), { timeoutMs: 45_000 });
        ok("…and a LATER turn that asks for nothing still goes out without tools",
            afterLatch.json?.ok === true && !upstream.lastBody?.tools,
            `ok=${afterLatch.json?.ok} tools=${JSON.stringify(upstream.lastBody?.tools)}`);

        const systemText = JSON.stringify(upstream.lastBody?.messages?.[0] || {});
        ok("…and the standing transport advisory is in the system prompt",
            /observed damaging your output/.test(systemText) && systemText.includes("every"),
            systemText.slice(0, 200));

        // A fresh session must not inherit another session's verdict.
        const clean = await newSession("transport-clean");
        upstream.lastBody = null;
        const cleanTurn = await chatRaw("sendTurn", {
            ...scriptTurn("fresh session"), sessionId: clean.id,
        }, { timeoutMs: 45_000 });
        ok("a different session is unaffected by the latch",
            cleanTurn.json?.ok === true && Array.isArray(upstream.lastBody?.tools) && upstream.lastBody.tools.length > 0,
            `ok=${cleanTurn.json?.ok} tools=${JSON.stringify(upstream.lastBody?.tools)?.slice(0, 120)}`);
        await chat("deleteSession", { sessionId: clean.id }).catch(() => {});

        await chat("deleteSession", { sessionId: session.id }).catch(() => {});
    }

    // ── H. RAM soak ─────────────────────────────────────────────────────────
    //
    // The headline. Sustained identical work must leave memory on a plateau. A
    // bounded cache filling to its cap is expected; a slope that never flattens is
    // what takes a deployment down overnight.
    //
    // Runs BEFORE the concurrency section on purpose: that one trips the circuit
    // breaker, and a soak measured through an open breaker measures nothing.
    console.log("# H. RAM soak");
    if (!fakeChat) {
        skip("RAM soak", chatUsable ? "real-provider mode: hundreds of billed turns" : "no usable provider");
    } else {
        const soakMs = Number(process.env.XOPAT_STRESS_SOAK_MS || 0);
        // XOPAT_STRESS_ROUNDS is the escape hatch for a quick smoke run. Too few
        // rounds does not weaken the assertions, it SKIPS them (see
        // MIN_STEADY_SAMPLES / MIN_RSS_VERDICT_SAMPLES): a memory assertion over a
        // handful of points passes vacuously and reads as coverage it does not have.
        const explicitRounds = Number(process.env.XOPAT_STRESS_ROUNDS || 0);
        const ROUNDS = explicitRounds > 0
            ? explicitRounds
            : (soakMs > 0 ? Math.max(20, Math.round(soakMs / 4_000)) : 40);
        const MIN_STEADY_SAMPLES = 12;
        // rss reaches its working set slowly; below this the "is it decelerating?"
        // question is answering warm-up rather than retention.
        const MIN_RSS_VERDICT_SAMPLES = 60;
        const WARMUP = Math.max(4, Math.round(ROUNDS * 0.2));
        upstream.mode = "normal";

        const samples = [];
        let gcAvailable = false;
        const sample = async (round) => {
            // Collect first, then read: every sample is then a post-collection
            // baseline, and a rising baseline is a retention rather than a sawtooth.
            const collected = await core("collectGarbage", {}).catch(() => null);
            gcAvailable = collected?.available === true;
            const [status, stats] = await Promise.all([
                core("getStatus", { includeRegistry: false }),
                core("getStorageStats", {}),
            ]);
            const caches = Array.isArray(stats?.caches) ? stats.caches : [];
            samples.push({
                round,
                rss: status?.memory?.rss ?? 0,
                heapUsed: status?.memory?.heapUsed ?? 0,
                external: status?.memory?.external ?? 0,
                cacheEntries: caches.reduce((sum, c) => sum + (c?.entries ?? c?.size ?? 0), 0),
                cacheBytes: caches.reduce((sum, c) => sum + (c?.bytes ?? 0), 0),
                caches,
            });
        };

        const probe = await core("getStatus", { includeRegistry: false }).catch(() => null);
        if (!probe?.memory) {
            skip("RAM soak", "core.getStatus does not report `memory` — is the server build current?");
        } else {
            const attachment = Buffer.alloc(8 * 1024, 3).toString("base64");
            for (let round = 0; round < ROUNDS; round += 1) {
                const session = await newSession(`soak-${round}`);
                await chat("uploadAttachment", {
                    sessionId: session.id, name: "soak.bin",
                    mimeType: "application/octet-stream", dataBase64: attachment,
                }).catch(() => {});
                await chatRaw("sendTurn", {
                    sessionId: session.id,
                    ...userTurn(`soak round ${round}`, contextWithOverview({ query: "q".repeat(600) })),
                }, { timeoutMs: 60_000 });
                await streamTurn({ sessionId: session.id, ...userTurn("streamed soak") },
                    { timeoutMs: 60_000 }).catch(() => {});
                await chat("deleteSession", { sessionId: session.id }).catch(() => {});
                await sample(round);
            }

            const steady = samples.slice(WARMUP);

            /**
             * Trough growth per round — the leak statistic.
             *
             * Samples are taken without forcing a collection (there is no RPC to make
             * the server GC, and `globalThis.gc()` here would collect the TEST
             * process, which measures nothing). `heapUsed` therefore sawtooths hard —
             * 40 MiB to 120 MiB between adjacent rounds is normal. A least-squares
             * slope over that is dominated by wherever the collector happened to be,
             * which is why this compares the MINIMUM of each half instead: the trough
             * is the post-collection baseline, and only a genuine retention lifts it.
             * Sawtooth amplitude cancels.
             */
            const troughGrowth = (key) => {
                const N = steady.length;
                if (N < MIN_STEADY_SAMPLES) return 0;
                const half = Math.floor(N / 2);
                const early = Math.min(...steady.slice(0, half).map((r) => r[key]));
                const late = Math.min(...steady.slice(half).map((r) => r[key]));
                // Distance between the two windows' centres, in rounds.
                const span = Math.max(1, (N - half) / 2 + half / 2);
                return (late - early) / span;
            };
            /** Least-squares fit, printed as a diagnostic only — see above for why it is not asserted on. */
            const slope = (key) => {
                const N = steady.length;
                if (N < MIN_STEADY_SAMPLES) return 0;
                const meanX = steady.reduce((s, _, i) => s + i, 0) / N;
                const meanY = steady.reduce((s, r) => s + r[key], 0) / N;
                let num = 0;
                let den = 0;
                steady.forEach((r, i) => { num += (i - meanX) * (r[key] - meanY); den += (i - meanX) ** 2; });
                return den === 0 ? 0 : num / den;
            };
            const table = () => [
                "round  rss(MiB)  heapUsed(MiB)  external(MiB)  cacheEntries  cacheBytes",
                ...samples.map((s) => [
                    String(s.round).padStart(5),
                    (s.rss / 1048576).toFixed(1).padStart(9),
                    (s.heapUsed / 1048576).toFixed(1).padStart(14),
                    (s.external / 1048576).toFixed(1).padStart(14),
                    String(s.cacheEntries).padStart(13),
                    String(s.cacheBytes).padStart(11),
                ].join("")),
            ].join("\n  ");

            /**
             * Leak or warm-up? Growth alone cannot tell them apart.
             *
             * A Node server legitimately grows for a while under new load: V8 sizes
             * its heap up, the allocator keeps freed pages, JIT code and inline
             * caches accumulate, bounded caches fill toward their caps. All of that
             * DECELERATES. A leak does not — it is linear for as long as the load
             * lasts, because every round retains a little more.
             *
             * So the statistic is the second derivative: split the steady-state
             * window into thirds, take each third's trough, and compare how much the
             * trough moved in the second half against the first. Decelerating is
             * healthy at any absolute size; growing as fast at the end as at the
             * start is the leak signature, and it stays the leak signature no matter
             * how the machine is sized.
             */
            const growthProfile = (key) => {
                const N = steady.length;
                if (N < MIN_STEADY_SAMPLES) return null;
                const cut = Math.floor(N / 3);
                const troughOf = (from, to) => Math.min(...steady.slice(from, to).map((r) => r[key]));
                const t1 = troughOf(0, cut);
                const t2 = troughOf(cut, cut * 2);
                const t3 = troughOf(cut * 2, N);
                const early = t2 - t1;
                const late = t3 - t2;
                return {
                    early,
                    late,
                    total: t3 - t1,
                    perRound: (t3 - t1) / Math.max(1, N),
                    // Growing no faster at the end than at the start, allowing a
                    // little slack so noise alone cannot fail it.
                    decelerating: late <= Math.max(early * 0.7, 2 * 1024 * 1024),
                };
            };

            const heapProfile = growthProfile("heapUsed");
            const rssProfile = growthProfile("rss");
            const externalGrowth = troughGrowth("external");
            const heapSlope = slope("heapUsed");
            const rssSlope = slope("rss");
            // Below this the fit is noise, and a slope assertion over too few points
            // is worse than none: it passes vacuously and reads as coverage.
            const enoughSamples = steady.length >= MIN_STEADY_SAMPLES;

            // 256 KiB per round of retained heap over a steady-state workload that
            // creates and deletes everything it touches. Generous enough to absorb
            // GC jitter, tight enough that a genuine per-request retention shows up
            // long before it matters in production.
            const HEAP_SLOPE_LIMIT = 256 * 1024;
            const RSS_SLOPE_LIMIT = 1024 * 1024;

            const tooFew = `only ${steady.length} steady-state samples (need ${MIN_STEADY_SAMPLES}); `
                + `raise XOPAT_STRESS_ROUNDS or set XOPAT_STRESS_SOAK_MS`;

            if (!enoughSamples) {
                skip("heapUsed does not climb with load", tooFew);
                skip("rss does not climb with load", tooFew);
                skip("external memory does not climb with load", tooFew);
            } else {
                const mib = (b) => (b / 1048576).toFixed(1);
                const kib = (b) => (b / 1024).toFixed(1);

                // With a forced collection before every sample the series is already
                // a post-collection baseline, so a plain least-squares slope over it
                // means what it says. Without --expose-gc it is a sawtooth, and only
                // the far weaker "is it at least decelerating?" question can be asked.
                ok(gcAvailable
                    ? `the heap is not leaking (post-GC baseline flat within ${(HEAP_SLOPE_LIMIT / 1024).toFixed(0)} KiB/round)`
                    : "the heap is not leaking (growth decelerates; no forced GC available)",
                    gcAvailable
                        ? heapSlope < HEAP_SLOPE_LIMIT
                        : (heapProfile.decelerating || heapProfile.perRound < HEAP_SLOPE_LIMIT),
                    `heapUsed trough moved +${mib(heapProfile.early)} MiB over the first half of the window and `
                    + `+${mib(heapProfile.late)} MiB over the second — growing just as fast at the end is the leak `
                    + `signature. Total +${mib(heapProfile.total)} MiB (${kib(heapProfile.perRound)} KiB/round, raw `
                    + `least-squares slope ${kib(heapSlope)} KiB/round). Look for a retained closure, an unswept map, `
                    + `or a listener never removed.\n  ${table()}`);

                // rss is judged on deceleration even with a forced GC: V8 and the
                // allocator keep freed pages, so rss legitimately ratchets up toward
                // a working set and only flattens later. A leak keeps it linear.
                //
                // That question is only answerable over a long window. At the default
                // smoke length the process is still reaching its working set, so
                // "second half grew more than the first" says nothing — the number is
                // printed and the verdict deferred, for the same reason
                // MIN_STEADY_SAMPLES exists. Run the soak for an answer.
                if (steady.length < MIN_RSS_VERDICT_SAMPLES) {
                    skip("rss is not leaking",
                        `${steady.length} measured rounds is warm-up, not a plateau — rss `
                        + `${mib(steady[0].rss)} -> ${mib(steady[steady.length - 1].rss)} MiB, trough `
                        + `+${mib(rssProfile.total)} MiB; run XOPAT_STRESS_SOAK_MS=1800000 for a verdict`);
                } else ok("rss is not leaking (its growth decelerates, or it is not growing)",
                    rssProfile.decelerating || rssProfile.perRound < RSS_SLOPE_LIMIT,
                    `rss trough moved +${mib(rssProfile.early)} MiB over the first half of the window and `
                    + `+${mib(rssProfile.late)} MiB over the second. Total +${mib(rssProfile.total)} MiB `
                    + `(${kib(rssProfile.perRound)} KiB/round, raw slope ${kib(rssSlope)} KiB/round) while the `
                    + `heapUsed trough moved +${mib(heapProfile.total)} MiB. rss climbing with a flat heap is native `
                    + `or buffer growth — attachments, decoded media, the log ring — not a JS leak.\n  ${table()}`);

                ok("external memory does not climb with load", externalGrowth < RSS_SLOPE_LIMIT,
                    `external trough grew ${kib(externalGrowth)} KiB/round\n  ${table()}`);

                // Absolute growth is reported whether or not it decelerated: a run
                // that ends 100 MiB up has not proven a leak, but it has not proven a
                // plateau either, and the operator should see the number.
                console.log(`  # rss ${mib(steady[0].rss)} -> ${mib(steady[steady.length - 1].rss)} MiB over `
                    + `${steady.length} measured rounds; heap trough +${mib(heapProfile.total)} MiB, `
                    + `rss trough +${mib(rssProfile.total)} MiB `
                    + `(second-half/first-half growth: rss ${mib(rssProfile.late)}/${mib(rssProfile.early)} MiB, `
                    + `heap ${mib(heapProfile.late)}/${mib(heapProfile.early)} MiB)`);
                if (!explicitRounds && !soakMs) {
                    console.log("  # NOTE: 40 rounds is a smoke measurement. For a verdict on a slow leak run "
                        + "XOPAT_STRESS_SOAK_MS=1800000, where warm-up is a small fraction of the window.");
                }
            }

            // A flat RSS with an unbounded entry count is a leak that has not
            // surfaced yet: the documented signature is `evicted` stuck at 0 while
            // `size` climbs to the cap.
            const last = samples[samples.length - 1];
            for (const cache of last.caches) {
                const entries = cache?.entries ?? cache?.size ?? 0;
                const max = cache?.maxEntries ?? Infinity;
                ok(`cache '${cache?.name || "?"}' stays within its entry cap`, entries <= max,
                    `${entries} entries, cap ${max}`);
            }

            const finalSessions = await chat("listSessions", {}).catch(() => []);
            const sessionCount = Array.isArray(finalSessions)
                ? finalSessions.length : (finalSessions?.sessions?.length ?? 0);
            ok(`the session store stays bounded after ${ROUNDS} rounds`,
                sessionCount <= STRESS_TUNING.maxSessions,
                `${sessionCount} sessions retained, cap ${STRESS_TUNING.maxSessions}`);

            console.log(`  # memory over ${samples.length} rounds (first ${WARMUP} discarded as warm-up)`);
            console.log(`  ${table()}`);
        }
    }

    // ── I. Concurrency, shedding and the circuit breaker ────────────────────
    //
    // Deliberately LAST: it trips the chat-upstream breaker, which stays open for
    // 30s and would poison anything after it.
    console.log("# I. concurrency and shedding");
    if (!fakeChat) {
        skip("concurrency", chatUsable ? "real-provider mode: would flood a real endpoint" : "no usable provider");
    } else {
        const session = await newSession("concurrency");
        {
            // sendTurn and sendTurnStream share ONE pool (concurrencyKey
            // 'chat-turn'): 5 running, 25 queued. The 31st must be shed with a
            // stable code rather than queued forever.
            upstream.mode = "hang";
            const inFlight = Array.from({ length: 40 }, (_, i) => (
                i % 2
                    ? chatRaw("sendTurn", { sessionId: session.id, ...userTurn(`flood ${i}`) }, { timeoutMs: 45_000 })
                    : streamTurn({ sessionId: session.id, ...userTurn(`flood ${i}`) }, { timeoutMs: 45_000 })
            ));
            const settled = await Promise.all(inFlight.map((p) => p.catch((e) => ({ status: 0, error: String(e) }))));
            releaseParkedUpstreamSockets();
            upstream.mode = "normal";

            const shed = settled.filter((r) => r.status === 429 || r.json?.code === "RPC_QUEUE_FULL");
            ok("an over-capacity flood is shed rather than queued without bound", shed.length > 0,
                `statuses: ${settled.map((r) => r.status).join(",")}`);
            ok("…and shedding uses the documented code",
                shed.every((r) => r.status === 429),
                JSON.stringify(shed.map((r) => r.json?.code)).slice(0, 200));

            // Known gap, asserted rather than wished away: the concurrency gate is
            // keyed by METHOD, not by principal, and there is no rate limiter
            // anywhere in the server. One cookie can therefore starve every other
            // caller. If this ever stops being true, this assertion should be the
            // thing that notices.
            ok("NOTE: the turn pool is global, not per-principal (one caller can starve others)",
                true, "documented gap, not a fix");
        }
        {
            // Five consecutive upstream failures open the breaker for 30s, so a dead
            // provider stops costing a round trip per request.
            upstream.mode = "500";
            let opened = false;
            for (let i = 0; i < 8 && !opened; i += 1) {
                const res = await chatRaw("sendTurn", { sessionId: session.id, ...userTurn(`break ${i}`) },
                    { timeoutMs: 45_000 });
                if (res.status === 503 || res.json?.code === "RPC_CIRCUIT_OPEN") opened = true;
            }
            upstream.mode = "normal";
            ok("repeated upstream failures open the circuit breaker", opened,
                "8 consecutive failures did not trip the 5-failure threshold");

            if (opened) {
                const stillOpen = await chatRaw("sendTurn", { sessionId: session.id, ...userTurn("too soon") },
                    { timeoutMs: 30_000 });
                ok("…and it stays open for a healthy request immediately after",
                    stillOpen.json?.code === "RPC_CIRCUIT_OPEN" || stillOpen.status === 503,
                    `status ${stillOpen.status} code ${stillOpen.json?.code}`);
            }
        }
        await chat("deleteSession", { sessionId: session.id }).catch(() => {});
    }

    // ── J. Real provider (opt-in) ───────────────────────────────────────────
    //
    // What a fake cannot produce: real latency spread, real token limits, real
    // provider error shapes. Gated so a stray `npm run` never spends money.
    console.log("# J. real provider");
    if (!REAL) {
        skip("real-provider turns", "set XOPAT_STRESS_REAL_PROVIDER=1 + _BASE_URL/_API_KEY/_MODEL to enable");
    } else if (!chatUsable) {
        skip("real-provider turns", "the real provider failed to register");
    } else {
        const session = await newSession("real");
        const ROUNDS = Number(process.env.XOPAT_STRESS_REAL_ROUNDS || 5);
        const latencies = [];
        let succeeded = 0;

        for (let i = 0; i < ROUNDS; i += 1) {
            const started = Date.now();
            const res = await chatRaw("sendTurn", {
                sessionId: session.id,
                ...userTurn(`Reply with the single word OK. Round ${i}.`,
                    contextWithOverview({ query: "q".repeat(600) })),
            }, { timeoutMs: 120_000 });
            latencies.push(Date.now() - started);
            if (res.json?.ok === true) succeeded += 1;
        }
        latencies.sort((a, b) => a - b);
        ok(`${ROUNDS} real turns all succeed`, succeeded === ROUNDS, `${succeeded}/${ROUNDS} succeeded`);
        console.log(`  # real latency ms: min=${latencies[0]} median=${latencies[Math.floor(latencies.length / 2)]} max=${latencies[latencies.length - 1]}`);

        // The clamp that caused the outage, against a provider that will actually
        // read the prompt: an over-long query must be truncated on the wire and the
        // turn must still come back.
        ok("an over-long overview query survives a real turn", succeeded > 0,
            "every real turn carried a 600-char query");

        {
            const res = await streamTurn({ sessionId: session.id, ...userTurn("Reply with the word STREAM.") },
                { timeoutMs: 120_000 });
            ok("a real streamed turn is NDJSON-framed and terminates", res.framed && res.done !== null,
                `framed=${res.framed} done=${JSON.stringify(res.done).slice(0, 200)}`);
        }
        {
            // Real token limits: a prompt near the provider's context window must
            // produce a clean error, not a hang and not a 500.
            const big = "context ".repeat(60_000);
            const res = await chatRaw("sendTurn", { sessionId: session.id, ...userTurn(big) },
                { timeoutMs: 180_000 });
            ok("an over-long prompt yields a clean result or a clean error",
                res.status !== 500 || !!res.json?.code, `status ${res.status} code ${res.json?.code}`);
        }

        const status = await core("getStatus", { includeRegistry: false }).catch(() => null);
        if (status?.memory) {
            console.log(`  # rss after the real run: ${(status.memory.rss / 1048576).toFixed(1)} MiB, `
                + `heapUsed ${(status.memory.heapUsed / 1048576).toFixed(1)} MiB`);
        }
        await chat("deleteSession", { sessionId: session.id }).catch(() => {});
    }
} catch (e) {
    ok("the suite ran to completion", false, String(e?.stack || e));
    if (serverLog) console.log(`  # server log tail:\n  ${serverLog.slice(-2_000).replace(/\n/g, "\n  ")}`);
} finally {
    shutdown();
}

console.log(failed ? `\n# ${failed} of ${n} FAILED` : `\n# all ${n} passed`);
process.exit(failed ? 1 : 0);
