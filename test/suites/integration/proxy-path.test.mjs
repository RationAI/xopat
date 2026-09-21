/**
 * `/proxy/<alias>/<rest>` — what reaches the upstream.
 *
 * The path is rebuilt rather than forwarded: `pathname.split('/').filter(Boolean)`
 * drops the empty segments that would otherwise let `/proxy/<alias>//evil.com/x`
 * or a pasted absolute URL reconstruct a second origin. That collapse is
 * load-bearing and is pinned here.
 *
 * It also used to drop a TRAILING slash, which upstreams distinguish: the
 * wsi-service answers `/v3/cases/` with a listing and `/v3/cases` with a 307 to
 * itself, and the redirect guard then refuses the loopback hop with a 502 — so
 * the WSI file browser could not be proxied at all. The slash is restored
 * explicitly; it cannot carry an origin.
 *
 * The upstream is a throwaway server started by the test, so this asserts the
 * mechanism on any checkout with no container and no fixture data.
 */
import { test, expect } from "@xopat/test-harness";
import http from "node:http";

/** Echo the request line back, so the assertion is on what the upstream SAW. */
async function startEcho() {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ url: req.url }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        stop: () => new Promise((resolve) => server.close(resolve)),
    };
}

async function withAlias(xopatServer, baseUrl, body) {
    const original = xopatServer.scratch.read();
    await xopatServer.setEnv({
        core: { server: { secure: { proxies: { "test-echo": { baseUrl } } } } },
    });
    await xopatServer.restart();
    try {
        await body();
    } finally {
        await xopatServer.replaceEnv(original);
        await xopatServer.restart();
    }
}

test("the proxy forwards the path it was given, trailing slash included", {
    tag: ["@integration", "@security"],
}, async ({ xopatServer }) => {
    const echo = await startEcho();
    try {
        await withAlias(xopatServer, echo.baseUrl, async () => {
            const { cookie, csrf } = await xopatServer.session();
            const get = (path) => fetch(`${xopatServer.baseURL}${path}`, {
                headers: { Cookie: cookie, "X-XOPAT-CSRF": csrf },
                redirect: "manual",
                signal: AbortSignal.timeout(30_000),
            });

            // A collection endpoint and a resource endpoint are different URLs.
            const collection = await get("/proxy/test-echo/v3/cases/?context=");
            expect(collection.status).toBe(200);
            expect((await collection.json()).url).toBe("/v3/cases/?context=");

            const resource = await get("/proxy/test-echo/v3/slides/info?slide_id=a%2Fb.tif");
            expect(resource.status).toBe(200);
            expect((await resource.json()).url).toBe("/v3/slides/info?slide_id=a%2Fb.tif");

            // The alias alone addresses the upstream root.
            const root = await get("/proxy/test-echo/");
            expect((await root.json()).url).toBe("/");

            // Empty segments are still collapsed, so nothing in the remainder can
            // introduce an origin of its own.
            const injected = await get("/proxy/test-echo//example.com/v3/cases/");
            expect((await injected.json()).url).toBe("/example.com/v3/cases/");

            const absolute = await get("/proxy/test-echo/http://example.com/v3/cases/");
            expect((await absolute.json()).url).toBe("/http:/example.com/v3/cases/");
        });
    } finally {
        await echo.stop();
    }
});

test("an alias the deployment does not configure is refused", {
    tag: ["@integration", "@security"],
}, async ({ xopatServer }) => {
    const { cookie, csrf } = await xopatServer.session();
    const res = await fetch(`${xopatServer.baseURL}/proxy/not-a-configured-alias/v3/cases/`, {
        headers: { Cookie: cookie, "X-XOPAT-CSRF": csrf },
        signal: AbortSignal.timeout(30_000),
    });
    expect(res.status).toBe(403);
    // Deliberately the same answer a session-refused alias gets, and it never
    // echoes the alias back.
    expect(await res.text()).toBe("Proxy target alias is not allowed or not configured.");
});
