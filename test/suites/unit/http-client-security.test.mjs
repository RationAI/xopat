/**
 * Security properties of `HttpClient` / `XOpatRemoteEndpoint`:
 * - only the app origin may trigger xOpat session recovery (a page reload);
 * - only the app origin may declare a failure `retriable`;
 * - a relative path cannot escape `baseURL` through dot segments;
 * - error messages never carry a URL's query string, fragment or userinfo.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.window.OpenSeadragon = globalThis.window.OpenSeadragon ?? { TileSource: class TileSource {} };
const APP = { url: "https://viewer.example.org/", auth: undefined };
globalThis.APPLICATION_CONTEXT = globalThis.window.APPLICATION_CONTEXT = APP;
globalThis.XOpatUser = globalThis.window.XOpatUser = {
    instance: () => ({ getSecret: () => undefined, setSecret() {}, reportSecretRejected() {}, async requestSecretUpdate() {} }),
};
globalThis.window.XOPAT_CSRF_TOKEN = "csrf";

/** Every fetch answers `status` with `body`; returns the recorded calls and recovery hits. */
async function setup(status = 200, body = { ok: true }) {
    const calls = [];
    const recoveries = [];
    globalThis.window.XOpatSessionRecovery = { handle: (r) => { recoveries.push(r); return true; } };
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    };
    const { HttpClient } = await import(`../../../src/classes/http-client.ts?t=${Math.random()}`);
    return { HttpClient, calls, recoveries };
}

test("a foreign upstream cannot trigger session recovery @unit", async () => {
    const { HttpClient, recoveries } = await setup(401, { code: "RPC_NO_SESSION" });
    const foreign = new HttpClient({ baseURL: "https://whisper.example.org", maxRetries: 0 });
    await expect(foreign.request("v1/x")).rejects.toThrow(/401/);
    expect(recoveries).toHaveLength(0);
});

test("the app origin still triggers session recovery @unit", async () => {
    const { HttpClient, recoveries } = await setup(401, { code: "RPC_NO_SESSION" });
    const own = new HttpClient({ baseURL: "https://viewer.example.org/__rpc", maxRetries: 0 });
    await expect(own.request("server/core/x")).rejects.toThrow(/401/);
    expect(recoveries).toHaveLength(1);
});

test("a foreign URL through a proxied client cannot declare itself retriable @unit", async () => {
    const { HttpClient, calls } = await setup(400, { retriable: true });
    const proxied = new HttpClient({ proxy: "alias", maxRetries: 1 });
    await expect(proxied.request("https://foreign.example.org/x")).rejects.toThrow(/400/);
    expect(calls).toHaveLength(1);
});

test("dot segments cannot escape baseURL @unit", async () => {
    const { HttpClient, calls } = await setup();
    const proxied = new HttpClient({ proxy: "alias" });
    for (const path of ["../other/x", "a/../../other/x", "%2e%2e/other", "..\\other\\x", "/.."]) {
        await expect(proxied.request(path)).rejects.toThrow(/outside baseURL/);
        await expect(proxied.fetchRaw(path)).rejects.toThrow(/outside baseURL/);
    }
    expect(calls).toHaveLength(0);

    // Dot segments that stay inside the base are fine.
    await proxied.request("a/../b/./c.json");
    await proxied.request(".well-known/x");
    expect(calls).toHaveLength(2);
    expect(new URL(calls[0].url).pathname).toBe("/proxy/alias/b/c.json");
});

test("error messages omit query, fragment and userinfo @unit", async () => {
    const { HttpClient } = await setup(404, { error: "nope" });
    const client = new HttpClient({ baseURL: "https://api.example.org", maxRetries: 0 });
    const err = await client.request("slides/x?token=SECRET#frag").catch(e => e);
    expect(err.message).toContain("https://api.example.org/slides/x");
    expect(err.message).not.toContain("SECRET");
    expect(err.message).not.toContain("frag");

    const raw = await client.fetchRaw("y?sig=SECRET").catch(e => e);
    expect(raw.message).not.toContain("SECRET");
});
