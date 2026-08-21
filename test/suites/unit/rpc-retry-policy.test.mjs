/**
 * Our RPC boundary answers HTTP 500 for EVERY handler throw, so the status alone
 * cannot tell an overloaded gateway from an upstream 401 relayed through it. The
 * client used to replay both: a chat provider configured with a dead key cost
 * 1 + maxRetries round trips and ~7s of boot per model-discovery call, none of
 * which could have succeeded.
 *
 * The fix is an explicit `retriable` verdict set by the only party that holds the
 * upstream status (server/node/ssrf-guard.js, forwarded by `#rpcErrorPayload`).
 * These vectors pin that it overrules the heuristic in BOTH directions and that
 * the pre-existing status rules still apply when the flag is absent — a silent
 * regression here is invisible until an upstream starts flapping.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.window.OpenSeadragon = globalThis.window.OpenSeadragon ?? { TileSource: class TileSource {} };

const APP = { url: "https://viewer.example.org/", auth: undefined };
globalThis.APPLICATION_CONTEXT = globalThis.window.APPLICATION_CONTEXT = APP;
globalThis.XOpatUser = globalThis.window.XOpatUser = {
    instance: () => ({ getSecret: () => undefined, requestSecretUpdate: async () => {} }),
};

const { HttpClient } = await import("../../../src/classes/http-client.ts");

const client = new HttpClient({ baseURL: "https://viewer.example.org" });
/** `_isRetriable` is TS-private; privacy is compile-time, the policy is the unit. */
const isRetriable = (status, body) => client._isRetriable(status, body);
const rpcError = (fields) => JSON.stringify({ error: "boom", ...fields });

test("an upstream 4xx relayed as our 500 is not replayed @unit", () => {
    // Exactly the chat model-discovery shape: the upstream said 401, we say 500.
    const body = rpcError({ code: "UPSTREAM_STATUS", retriable: false });
    expect(isRetriable(500, body)).toBe(false);
});

test("retriable:true overrules the status in the other direction too @unit", () => {
    // A thrower that knows the failure IS transient must be able to say so even
    // at a status the heuristic would refuse — otherwise the flag is only half a
    // contract and callers go back to encoding retry policy in status codes.
    const body = rpcError({ code: "UPSTREAM_STATUS", retriable: true });
    expect(isRetriable(400, body)).toBe(true);
    expect(isRetriable(404, body)).toBe(true);
});

test("the status heuristic still governs when no verdict is declared @unit", () => {
    // Absent flag = "unknown", NOT "not retriable": a genuine gateway 5xx from a
    // proxy in front of us carries no payload of ours at all.
    expect(isRetriable(500, rpcError({ code: "RPC_INTERNAL_ERROR" }))).toBe(true);
    expect(isRetriable(500, undefined)).toBe(true);
    expect(isRetriable(502, "<html>bad gateway</html>")).toBe(true);
    expect(isRetriable(429, undefined)).toBe(true);
    expect(isRetriable(401, undefined)).toBe(false);
    expect(isRetriable(404, undefined)).toBe(false);
});

test("a non-boolean retriable field does not hijack the decision @unit", () => {
    // The body is upstream/attacker-adjacent data. Anything but a real boolean
    // falls through to the heuristic rather than being coerced.
    expect(isRetriable(500, rpcError({ retriable: "false" }))).toBe(true);
    expect(isRetriable(500, rpcError({ retriable: 0 }))).toBe(true);
    expect(isRetriable(500, rpcError({ retriable: null }))).toBe(true);
    expect(isRetriable(500, "not json at all")).toBe(true);
});

test("the RPC_TIMEOUT carve-out survives the new flag @unit", () => {
    // A server-side deadline is deterministic for this request; it predates
    // `retriable` and must keep working for throwers that never set one.
    expect(isRetriable(504, rpcError({ code: "RPC_TIMEOUT" }))).toBe(false);
    expect(isRetriable(504, rpcError({ code: "RPC_INTERNAL_ERROR" }))).toBe(true);
    // An explicit verdict still wins over the carve-out.
    expect(isRetriable(504, rpcError({ code: "RPC_TIMEOUT", retriable: true }))).toBe(true);
});
