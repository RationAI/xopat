/**
 * Server HTTP surface — end-to-end regression suite.
 *
 * Boots the REAL server on a scratch port and drives it over HTTP. That is the
 * point: the behaviours below live in `server/node/index.js`, which starts a
 * listener on require, so unit-importing its helpers would test a copy of the
 * logic rather than the thing that serves traffic. Every assertion here is one
 * an attacker or an operator could make themselves with curl.
 *
 * What it guards, all of which was broken:
 *
 *  - `</script>` in the POST body escaped the inline `<script>` and executed on
 *    the viewer's own origin, next to XOPAT_CSRF_TOKEN. Reachable with a plain
 *    cross-origin auto-submitting form, so no CSRF token needed.
 *  - Static serving was "any path with an extension that exists on disk", which
 *    published `env/env.json` (the deployment config, `server.secure` and all),
 *    the storage root, `*.server.ts` sources and `.server-dist` bundles.
 *  - No security headers at all.
 *  - `/scheme*` and `/dev_setup` published every plugin's merged config and the
 *    raw `.d.ts` sources to anonymous callers in production.
 *  - `/health` answered 200 even when server extensions had failed to load, so
 *    an orchestrator happily routed to a worker that could serve nothing.
 *  - The generic 500 echoed the raw exception text back to the caller.
 *
 * Run: npm run test:http-surface
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fromRoot } from "@xopat/test-harness/paths";
import { createServer } from "node:net";
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

const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;

// Dev mode OFF: production is the configuration whose exposure matters, and the
// /scheme gating only applies there.
const child = spawn(process.execPath, ["index.js"], {
    cwd: repoRoot,
    env: { ...process.env, XOPAT_NODE_PORT: String(PORT), XOPAT_DEV_MODE: "0" },
    stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
child.stdout.on("data", d => { serverLog += d; });
child.stderr.on("data", d => { serverLog += d; });

function shutdown() {
    try { child.kill(); } catch { /* already gone */ }
}
process.on("exit", shutdown);

async function waitForBoot(timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})\n${serverLog}`);
        try {
            const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
            if (res.ok) return;
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`server did not boot within ${timeoutMs}ms\n${serverLog}`);
}

/** Never follow redirects — a 3xx is an answer we want to see, not traverse. */
const get = (p, init = {}) => fetch(BASE + p, { redirect: "manual", signal: AbortSignal.timeout(60_000), ...init });
const status = async (p, init) => (await get(p, init)).status;

try {
    await waitForBoot();

    // ── A. Static serving is confined to the allowlist ──────────────────────
    console.log("# static serving confinement");
    {
        const mustDeny = [
            ["the deployment config", "/env/env.json"],
            ["sibling env files", "/env/env.default.json"],
            ["the package manifest", "/package.json"],
            ["server-side TypeScript sources", "/modules/oidc-client-ts/register.server.ts"],
            ["compiled server bundles", "/modules/oidc-client-ts/.server-dist/register.server.mjs"],
            ["author server manifests", "/modules/vercel-ai-chat-sdk/server.json"],
            ["anything under the storage/cache root", "/server/.cache/storage/x.json"],
            ["dot-segment paths", "/src/.server-dist/anything.mjs"],
        ];
        for (const [what, p] of mustDeny) {
            eq(`404: ${what} (${p})`, await status(p), 404);
        }

        // `/.gitignore` has no extension by the router's definition, so it never
        // reaches the static handler at all — it renders the viewer page. A 200
        // there is not a disclosure, but the CONTENT would be, so assert that
        // rather than the status.
        const dotfile = await get("/.gitignore");
        const dotBody = await dotfile.text();
        ok("an extension-less dotfile never yields its own contents",
            !dotBody.includes("node_modules") || dotBody.includes("initXOpat"),
            dotBody.slice(0, 120));

        // The other half of the contract: the viewer must still load. A
        // confinement change that breaks these is worse than the hole.
        const mustServe = [
            "/src/config.json",
            "/src/locales/en.json",
            "/src/assets/favicon-32x32.png",
            "/docs/assets/xopat-banner.png",
            "/server/client-rpc.js",
        ];
        for (const p of mustServe) {
            eq(`200: ${p}`, await status(p), 200);
        }

        // Backslash is not a URL separator but IS one for `fs` on Windows, so
        // this was a live traversal there.
        for (const p of ["/src\\..\\..\\package.json", "/src/../package.json", "/src/%2e%2e/package.json"]) {
            ok(`traversal refused: ${p}`, [404, 400].includes(await status(p)));
        }
    }

    // ── B. Reflected XSS in the rendered page ───────────────────────────────
    console.log("# script-context escaping");
    {
        const payload = "</script><script>alert(1)</script>";
        const res = await get("/", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ visualization: payload }).toString(),
        });
        eq("the POST-driven viewer page still renders", res.status, 200);
        const html = await res.text();

        ok("the page is a real render, not an error stub", html.length > 10_000, `${html.length} bytes`);
        ok("the raw payload never appears verbatim",
            !html.includes("</script><script>alert(1)"),
            "an unescaped `</script>` reached the document");
        ok("…it appears escaped instead", html.includes("u003c/script"));
        ok("initXOpat is still invoked", html.includes("initXOpat"));

        // Count the script tags an attacker could have opened. The payload
        // contributes none when escaping works.
        const opens = (html.match(/<script/gi) || []).length;
        const closes = (html.match(/<\/script>/gi) || []).length;
        eq("script tags stay balanced", opens, closes);

        // The same sink, reached through the JSON content type.
        const jsonRes = await get("/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ visualization: payload }),
        });
        const jsonHtml = await jsonRes.text();
        ok("the JSON body path is escaped too",
            !jsonHtml.includes("</script><script>alert(1)"));

        // U+2028 is legal in a JSON string but is a literal line terminator in
        // JS source — unescaped it is a syntax error that blanks the page.
        const lsRes = await get("/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ visualization: "a b" }),
        });
        const lsHtml = await lsRes.text();
        ok("U+2028 is escaped, not emitted raw", !lsHtml.includes(" "));
    }

    // ── C. Baseline security headers ────────────────────────────────────────
    console.log("# security headers");
    {
        const res = await get("/");
        const h = (k) => res.headers.get(k);
        eq("X-Content-Type-Options", h("x-content-type-options"), "nosniff");
        eq("Referrer-Policy", h("referrer-policy"), "same-origin");
        eq("X-Frame-Options", h("x-frame-options"), "SAMEORIGIN");
        ok("no HSTS over plain HTTP (it would pin localhost to https)",
            h("strict-transport-security") === null);

        const tls = await get("/", { headers: { "X-Forwarded-Proto": "https" } });
        ok("HSTS IS sent when the request arrived over TLS",
            (tls.headers.get("strict-transport-security") || "").includes("max-age="));

        // The session cookie must gain Secure exactly when we can see TLS.
        const plainCookie = res.headers.get("set-cookie") || "";
        const tlsCookie = tls.headers.get("set-cookie") || "";
        ok("session cookie is HttpOnly", /HttpOnly/i.test(plainCookie), plainCookie);
        ok("session cookie is SameSite-constrained", /SameSite=/i.test(plainCookie), plainCookie);
        ok("no Secure flag on plain HTTP (it would break the cookie)",
            !/;\s*Secure/i.test(plainCookie), plainCookie);
        ok("Secure IS set behind TLS", /;\s*Secure/i.test(tlsCookie), tlsCookie);
    }

    // ── D. Schema/dev routes are not public in production ───────────────────
    console.log("# scheme + dev_setup gating");
    {
        for (const p of ["/scheme", "/scheme_raw", "/scheme_raw_extended", "/dev_setup"]) {
            eq(`404 outside dev mode: ${p}`, await status(p), 404);
        }
    }

    // ── E. Liveness vs readiness ────────────────────────────────────────────
    console.log("# health and readiness");
    {
        eq("/health is 200", await status("/health"), 200);
        const res = await get("/ready");
        eq("/ready is 200 once extensions loaded", res.status, 200);
        const body = await res.json();
        eq("…and says so", body.extensions, "loaded");
        eq("…and reports it is not draining", body.shuttingDown, false);
        ok("…and identifies the process", Number.isInteger(body.pid));
    }

    // ── F. Session + CSRF round trip ────────────────────────────────────────
    console.log("# session and CSRF");
    {
        const page = await get("/");
        const cookie = (page.headers.get("set-cookie") || "").split(";")[0];
        const html = await page.text();
        const token = (html.match(/XOPAT_CSRF_TOKEN\s*=\s*"([^"]+)"/) || [])[1];

        ok("a session cookie is minted", /^xopat_session=/.test(cookie), cookie);
        ok("a CSRF token is embedded as a JSON string literal", !!token && token.length >= 16);

        // The cookieless embedding fallback must be entirely absent here: the id
        // is not published, and the header is inert even when it carries the
        // caller's own genuine session id.
        ok("no session id is published outside embedding mode",
            !html.includes("XOPAT_SESSION_ID"));
        eq("the X-XOPAT-Session header is ignored outside embedding mode",
            (await get("/proxy/no-such-alias/x", {
                headers: { "X-XOPAT-Session": cookie.split("=")[1], "X-XOPAT-CSRF": token },
            })).status, 401);

        const rpc = (headers) => get("/__rpc/module/oidc-server-ts/listContexts", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify({ args: [] }),
        });

        eq("no session → 401", (await rpc({})).status, 401);
        eq("session but no CSRF → 403", (await rpc({ Cookie: cookie })).status, 403);
        eq("session + wrong CSRF → 403", (await rpc({ Cookie: cookie, "X-XOPAT-CSRF": "nope" })).status, 403);

        // The session must be readable on the request AFTER the one that minted
        // it — this is the assertion that fails when the session store is not
        // shared across workers.
        const okRes = await rpc({ Cookie: cookie, "X-XOPAT-CSRF": token });
        eq("session + correct CSRF → 200", okRes.status, 200);
        const payload = await okRes.json();
        ok("…and the RPC actually ran", payload?.ok === true, JSON.stringify(payload));

        // Unknown targets must not be a cheap way to make the server work: this
        // used to trigger a full synchronous plugin/module tree walk, pre-auth.
        const t0 = Date.now();
        for (let i = 0; i < 20; i += 1) {
            await get(`/__rpc/module/does-not-exist-${i}/nope`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            });
        }
        const perCall = (Date.now() - t0) / 20;
        ok("20 unknown-target RPCs stay cheap (no rescan per call)",
            perCall < 150, `${perCall.toFixed(1)}ms per call`);
    }

    // ── G. Error disclosure and body caps ───────────────────────────────────
    console.log("# error disclosure and limits");
    {
        // A malformed cookie reaches decodeURIComponent and used to surface as
        // `URIError: URI malformed` in the response body.
        const res = await get("/", { headers: { Cookie: "xopat_session=%E0%A4%A" } });
        const body = await res.text();
        eq("a malformed cookie is a 500", res.status, 500);
        ok("…that discloses no exception text", !/URIError|at Object\.|node:internal/.test(body), body.slice(0, 200));
        ok("…but does give a correlation id to grep the log for",
            /Reference:\s*[0-9a-f-]{8,}/i.test(body), body.slice(0, 200));

        const big = "a".repeat(20 * 1024 * 1024);
        eq("an oversized body is 413, not OOM", await status("/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: big,
        }), 413);
    }

    // ── H. Caching validators ───────────────────────────────────────────────
    console.log("# static caching");
    {
        const res = await get("/src/locales/en.json");
        const etag = res.headers.get("etag");
        ok("an ETag is issued", !!etag, String(etag));
        eq("a matching If-None-Match revalidates to 304",
            await status("/src/locales/en.json", { headers: { "If-None-Match": etag } }), 304);
        eq("a stale If-None-Match still returns the body",
            await status("/src/locales/en.json", { headers: { "If-None-Match": 'W/"stale"' } }), 200);

        const versioned = await get("/src/locales/en.json?v=123");
        ok("a versioned asset is immutably cacheable",
            (versioned.headers.get("cache-control") || "").includes("immutable"));
        ok("an unversioned asset is not",
            !(res.headers.get("cache-control") || "").includes("immutable"));
    }

    // ── I. The viewer page is never cached ──────────────────────────────────
    console.log("# viewer page caching");
    {
        const res = await get("/");
        ok("the viewer page is no-store (it carries this session's CSRF token)",
            /no-store/i.test(res.headers.get("cache-control") || ""),
            String(res.headers.get("cache-control")));
    }

    // ── J. Embedding mode: cross-site cookie + cookieless session ───────────
    // A second server, because these are boot-time decisions. This is the mode
    // an iframe deployment runs in, and every assertion here is something that
    // silently 401s the whole viewer when it regresses.
    console.log("# cross-site embedding mode");
    {
        const embedPort = await freePort();
        const embedBase = `http://127.0.0.1:${embedPort}`;
        const embed = spawn(process.execPath, ["index.js"], {
            cwd: repoRoot,
            env: {
                ...process.env,
                XOPAT_NODE_PORT: String(embedPort),
                XOPAT_DEV_MODE: "0",
                XOPAT_CROSS_SITE_COOKIES: "true",
            },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let embedLog = "";
        embed.stdout.on("data", d => { embedLog += d; });
        embed.stderr.on("data", d => { embedLog += d; });
        const stopEmbed = () => { try { embed.kill(); } catch { /* already gone */ } };
        process.on("exit", stopEmbed);

        try {
            const deadline = Date.now() + 120_000;
            for (;;) {
                if (embed.exitCode !== null) throw new Error(`embed server exited (${embed.exitCode})\n${embedLog}`);
                try {
                    if ((await fetch(`${embedBase}/health`, { signal: AbortSignal.timeout(2000) })).ok) break;
                } catch { /* not up yet */ }
                if (Date.now() > deadline) throw new Error(`embed server did not boot\n${embedLog}`);
                await new Promise(r => setTimeout(r, 500));
            }

            const page = await fetch(`${embedBase}/`, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
            const setCookie = page.headers.get("set-cookie") || "";
            const html = await page.text();

            ok("no X-Frame-Options in embedding mode", page.headers.get("x-frame-options") === null,
                String(page.headers.get("x-frame-options")));
            ok("cookie is SameSite=None (a Lax cookie is not sent from a frame)",
                /SameSite=None/i.test(setCookie), setCookie);
            ok("…and Secure, which SameSite=None requires", /;\s*Secure/i.test(setCookie), setCookie);
            ok("…and Partitioned (CHIPS), for jars that block third-party cookies",
                /;\s*Partitioned/i.test(setCookie), setCookie);

            // The cookieless path: everything below deliberately sends NO cookie.
            const sessionId = (html.match(/XOPAT_SESSION_ID\s*=\s*"([^"]+)"/) || [])[1];
            const token = (html.match(/XOPAT_CSRF_TOKEN\s*=\s*"([^"]+)"/) || [])[1];
            ok("the session id is published to the framed document", !!sessionId, String(sessionId));

            // `/proxy/` rather than an RPC target: it runs the identical
            // session-then-CSRF gate but exists in every deployment, so this
            // section does not depend on which modules the env enables. The
            // alias is deliberately unknown — getting *past* both gates to the
            // alias check is the assertion.
            const proxy = (headers) => fetch(`${embedBase}/proxy/no-such-alias/x`, {
                redirect: "manual",
                signal: AbortSignal.timeout(60_000),
                headers,
            });
            const bodyOf = async (res) => (await res.text()).slice(0, 120);

            eq("no cookie and no session header → 401",
                (await proxy({ "X-XOPAT-CSRF": token })).status, 401);
            eq("a forged session id is not a session → 401",
                (await proxy({ "X-XOPAT-Session": "11111111-2222-3333-4444-555555555555", "X-XOPAT-CSRF": token })).status,
                401);
            eq("a non-uuid session header is rejected before it reaches the store → 401",
                (await proxy({ "X-XOPAT-Session": "../../etc/passwd", "X-XOPAT-CSRF": token })).status, 401);
            eq("the real session header still needs the CSRF token → 403",
                (await proxy({ "X-XOPAT-Session": sessionId, "X-XOPAT-CSRF": "nope" })).status, 403);

            const passed = await proxy({ "X-XOPAT-Session": sessionId, "X-XOPAT-CSRF": token });
            const passedBody = await bodyOf(passed);
            ok("session header + CSRF, no cookie at all, clears both gates",
                /alias is not allowed|not configured/i.test(passedBody), `${passed.status} ${passedBody}`);
        } finally {
            stopEmbed();
        }
    }
} catch (e) {
    ok("the suite ran to completion", false, String(e?.stack || e));
} finally {
    shutdown();
}

console.log(failed ? `\n# ${failed} of ${n} FAILED` : `\n# all ${n} passed`);
process.exit(failed ? 1 : 0);
