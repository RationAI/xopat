/**
 * The server fixture itself — the thing every other integration test stands on.
 *
 * `/health` versus `/ready` is the assertion that matters here: the listener
 * opens before server extensions finish loading, so a harness that gates on
 * `/health` (or on `/`, as the shell runner did) can hand a test a server whose
 * plugins never loaded. Everything downstream then fails for reasons that look
 * nothing like the cause.
 */
import { test, expect } from "@xopat/test-harness";

test("boots and reports ready", { tag: ["@integration"] }, async ({ xopatServer }) => {
    const health = await fetch(`${xopatServer.baseURL}/health`);
    expect(health.ok, "/health answers once the listener is open").toBe(true);

    const ready = await fetch(`${xopatServer.baseURL}/ready`);
    expect(ready.status, "/ready is 200 only once extensions resolved").toBe(200);

    const body = await ready.json();
    expect(body.ready).toBe(true);
    expect(body.shuttingDown).toBeFalsy();
});

test("serves the viewer with a session and a CSRF token", { tag: ["@integration"] }, async ({ xopatServer }) => {
    const { cookie, csrf } = await xopatServer.session();
    expect(cookie, "a session cookie is minted on the viewer page").toMatch(/^xopat_session=/);
    expect(csrf.length, "the CSRF token is long enough to be one").toBeGreaterThanOrEqual(16);
});

test("rejects an RPC without CSRF", { tag: ["@integration", "@security"] }, async ({ xopatServer }) => {
    const noCsrf = await xopatServer.rpc("server", "core", "getLogChannels", {}, { omitCsrf: true });
    expect(noCsrf.status, "a session alone must not be enough").toBe(403);
    expect(noCsrf.body?.code).toBe("RPC_BAD_CSRF");

    // With the token the request gets past the CSRF gate — whatever the method
    // itself then decides is a separate question (see the log-access test).
    const withCsrf = await xopatServer.rpc("server", "core", "getLogChannels");
    expect(withCsrf.body?.code, "the CSRF gate must not fire when the token is present").not.toBe("RPC_BAD_CSRF");
});

test("refuses log reads outside dev mode", { tag: ["@integration", "@security"] }, async ({ xopatServer }) => {
    // The default integration deployment is non-dev and configures no operator
    // allowlist, so `core.server.logging.access` is empty — which per
    // `server/LOGGING.md` means nobody. An anonymous session must not be able to
    // read another caller's request logs.
    const res = await xopatServer.rpc("server", "core", "getLogs", { limit: 10 });
    expect(res.body?.code).toBe("RPC_FORBIDDEN");
});

test("captures server output for failure diagnostics", { tag: ["@integration"] }, async ({ xopatServer }) => {
    // stdout is the diagnostic channel that always works: the RPC log buffer is
    // gated (above), so the fixture's captured output is what a failing test
    // actually gets attached to it.
    expect(xopatServer.logs.length, "the fixture captured the server's output").toBeGreaterThan(0);
    const firstRecord = xopatServer.logs.split("\n").find(l => l.trim().startsWith("{"));
    expect(firstRecord, "records are structured JSON, not free text").toBeTruthy();
    expect(JSON.parse(firstRecord)).toMatchObject({ level: expect.any(String), channel: expect.any(String) });
});
