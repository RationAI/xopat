/**
 * An over-limit RPC body must come back as a 413 the caller can read.
 *
 * This is a regression test with a very specific history: the body reader used
 * to `req.destroy()` at the limit, which tore down the socket *before* the 413
 * could be written. Directly that looks like a connection reset; behind a
 * reverse proxy the gateway substitutes its own **502 Bad Gateway**, and the
 * declared `maxBodyBytes` becomes an unexplainable gateway error instead of the
 * limit it is. A chat turn that outgrew the cap therefore failed with no clue
 * anywhere as to why.
 *
 * The assertion is deliberately about the *response existing and being JSON*,
 * not merely about a status: fetch rejecting with a network error is the exact
 * bug, and the status alone would not distinguish it.
 */
import { test, expect } from "@xopat/test-harness";

/** Builtins declare no `maxBodyBytes`, so DEFAULT_MAX_BODY_BYTES (256 KiB) applies. */
const OVER_DEFAULT_LIMIT = "x".repeat(1024 * 1024);

test("answers 413 instead of resetting the connection", { tag: ["@integration"] }, async ({ xopatServer }) => {
    const res = await xopatServer.rpc("server", "core", "getLogChannels", { padding: OVER_DEFAULT_LIMIT });

    expect(res.status, "the limit is reported as 413, not as a reset or a 5xx").toBe(413);
    expect(res.body?.code).toBe("RPC_BODY_TOO_LARGE");
    expect(String(res.body?.error), "the message names the limit that was hit").toMatch(/byte limit/i);
});

test("stays usable after refusing an over-limit body", { tag: ["@integration"] }, async ({ xopatServer }) => {
    // The point of draining rather than destroying: the connection survives, so a
    // client that hit the cap once is not left with a poisoned keep-alive socket.
    const rejected = await xopatServer.rpc("server", "core", "getLogChannels", { padding: OVER_DEFAULT_LIMIT });
    expect(rejected.status).toBe(413);

    const next = await xopatServer.rpc("server", "core", "getLogChannels");
    expect(next.status, "the very next request on the same server is answered normally").not.toBe(413);
    expect(next.body?.code, "and it reaches the method's own gate, i.e. the body was read").not.toBe("RPC_BODY_TOO_LARGE");
});
