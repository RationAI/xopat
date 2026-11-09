/**
 * What `HttpClient` puts on the wire for each kind of body.
 *
 * `request()` and `stream()` used to JSON-encode every body and label it
 * `application/json`. A `FormData` has no enumerable fields, so it went out as
 * `"{}"` — and the JSON content type made a cross-origin call non-simple, so a
 * self-hosted Whisper server without CORS answered the preflight `OPTIONS` with
 * 405 and the `remote` speech-to-text driver never sent a byte of audio.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.window.OpenSeadragon = globalThis.window.OpenSeadragon ?? { TileSource: class TileSource {} };
const APP = { url: "https://viewer.example.org/", auth: undefined };
globalThis.APPLICATION_CONTEXT = globalThis.window.APPLICATION_CONTEXT = APP;
globalThis.XOpatUser = globalThis.window.XOpatUser = {
    instance: () => ({ getSecret: () => undefined, setSecret() {}, reportSecretRejected() {}, async requestSecretUpdate() {} }),
};

/** A client whose `fetch` records every call and answers `{ok:true}`. */
async function recordingClient() {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const { HttpClient } = await import(`../../../src/classes/http-client.ts?t=${Math.random()}`);
    return { client: new HttpClient({ baseURL: "https://whisper.example.org" }), calls };
}

const contentType = (init) => Object.entries(init.headers || {})
    .find(([k]) => k.toLowerCase() === "content-type")?.[1];

test("FormData reaches fetch untouched, with no Content-Type @unit", async () => {
    const { client, calls } = await recordingClient();
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), "audio.webm");
    form.append("model", "whisper-1");

    await client.request("v1/audio/transcriptions", { method: "POST", body: form });

    expect(calls).toHaveLength(1);
    expect(calls[0].init.body).toBe(form);
    // The browser must set it: only it knows the multipart boundary.
    expect(contentType(calls[0].init)).toBe(undefined);
});

test("Blob, URLSearchParams and binary bodies pass through @unit", async () => {
    const { client, calls } = await recordingClient();
    const bodies = [
        new Blob(["x"], { type: "text/plain" }),
        new URLSearchParams({ a: "1" }),
        new Uint8Array([1, 2]).buffer,
        new Uint8Array([3, 4]),
    ];
    for (const body of bodies) await client.request("x", { method: "POST", body });

    expect(calls.map(c => c.init.body)).toEqual(bodies);
    for (const c of calls) expect(contentType(c.init)).toBe(undefined);
});

test("plain objects and strings stay JSON @unit", async () => {
    const { client, calls } = await recordingClient();
    await client.request("x", { method: "POST", body: { a: 1 } });
    await client.request("x", { method: "POST", body: "{\"b\":2}" });

    expect(calls[0].init.body).toBe("{\"a\":1}");
    expect(contentType(calls[0].init)).toBe("application/json");
    expect(calls[1].init.body).toBe("{\"b\":2}");
    expect(contentType(calls[1].init)).toBe("application/json");
});

test("a caller Content-Type still wins @unit", async () => {
    const { client, calls } = await recordingClient();
    await client.request("x", { method: "POST", body: new Blob(["<a/>"]), headers: { "Content-Type": "application/xml" } });
    await client.request("x", { method: "POST", body: { a: 1 }, headers: { "Content-Type": "application/merge-patch+json" } });

    expect(contentType(calls[0].init)).toBe("application/xml");
    expect(contentType(calls[1].init)).toBe("application/merge-patch+json");
});

test("a caller Content-Type in any casing replaces ours instead of joining it @unit", async () => {
    const { client, calls } = await recordingClient();
    await client.request("x", { method: "POST", body: { a: 1 }, headers: { "content-type": "application/merge-patch+json" } });
    const s = await client.stream("x", { body: { a: 1 }, headers: { "CONTENT-TYPE": "application/x-ndjson" } });
    s.cancel?.();

    // Exactly one value after `Headers` normalization — no "application/json, …" join.
    expect(new Headers(calls[0].init.headers).get("content-type")).toBe("application/merge-patch+json");
    expect(new Headers(calls[1].init.headers).get("content-type")).toBe("application/x-ndjson");
});

test("stream() encodes bodies the same way @unit", async () => {
    const { client, calls } = await recordingClient();
    const form = new FormData();
    form.append("q", "1");
    const s = await client.stream("x", { body: form });
    s.cancel?.();

    expect(calls[0].init.body).toBe(form);
    expect(contentType(calls[0].init)).toBe(undefined);
});
