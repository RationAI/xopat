/**
 * What the model actually receives.
 *
 * The failure mode of message conversion is SILENT: a part in the wrong shape
 * still satisfies the AI SDK's prompt schema and is simply sent as the wrong
 * thing. The bug these tests exist for: a remote attachment passed as
 * `{ type: 'file', data: "https://…" }` — a bare string in `data` means INLINE
 * BASE64 by the schema, so the URL text was base64-decoded into garbage bytes and
 * shipped upstream without a single error anywhere.
 *
 * So the assertions are made against the SDK itself rather than against our own
 * expectations of it: a stub language model captures the prompt the provider
 * would have been given, after the SDK's own standardization. A future SDK major
 * that changes those rules fails here instead of corrupting payloads in
 * production.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-chat-shapes-"));

const serverDir = path.join(fromRoot(), "modules", "vercel-ai-chat-sdk", "server");

async function loadServerModule(name) {
    const outfile = path.join(tmp, `${name}.mjs`);
    await esbuild.build({
        entryPoints: [path.join(serverDir, `${name}.ts`)],
        outfile,
        bundle: true,
        platform: "node",
        format: "esm",
        logLevel: "silent",
    });
    return import(pathToFileURL(outfile).href);
}

const { toModelMessage } = await loadServerModule("model-messages");
const { createGuardedDownload } = await loadServerModule("asset-download");
const { generateText, streamText } = await import("ai");

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";
const REMOTE_IMAGE = "https://example.org/slide/thumb.png";
const REMOTE_FILE = "https://example.org/report.pdf";

const userMessage = (parts) => ({ id: "m1", role: "user", parts, createdAt: "2026-01-01T00:00:00.000Z" });

/**
 * A v4 language model that answers nothing and records what it was asked.
 *
 * `supportedUrls` says the model takes remote URLs itself, which is what keeps a
 * URL a URL all the way to the provider. Without it the SDK resolves the asset in
 * OUR process instead — see the guarded-download test below.
 */
function stubModel() {
    const seen = { prompt: null };
    return {
        seen,
        model: {
            specificationVersion: "v4",
            provider: "stub",
            modelId: "stub-1",
            supportedUrls: { "*": [/^https?:\/\//] },
            async doGenerate(options) {
                seen.prompt = options.prompt;
                return {
                    content: [{ type: "text", text: "ok" }],
                    finishReason: "stop",
                    usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 }, totalTokens: 2 },
                    warnings: [],
                };
            },
        },
    };
}

/** The content parts the provider would receive for one converted message. */
async function promptPartsFor(message, capabilities) {
    const { model, seen } = stubModel();
    await generateText({
        model,
        instructions: "SYSTEM",
        messages: [toModelMessage(message, undefined, capabilities)],
        allowSystemInMessages: true,
    });
    const last = seen.prompt.at(-1);
    return Array.isArray(last.content) ? last.content : [{ type: "text", text: last.content }];
}

test("an inline image becomes a file part carrying raw bytes @unit", async () => {
    const parts = await promptPartsFor(userMessage([
        { type: "image", mimeType: "image/png", dataUrl: PNG_DATA_URL, name: "shot.png" },
        { type: "text", text: "what is this" },
    ]));

    const file = parts.find((p) => p.type === "file");
    expect(file, "the image must survive as a file part").toBeTruthy();
    expect(file.mediaType).toBe("image/png");
    // Tagged as data (bytes), never as a URL — the payload was inline.
    expect(file.data.type ?? "data").toBe("data");
});

test("a remote image is sent as a URL, not as base64 @unit", async () => {
    const parts = await promptPartsFor(userMessage([
        { type: "image", mimeType: "image/png", url: REMOTE_IMAGE },
    ]));

    const file = parts.find((p) => p.type === "file");
    expect(file).toBeTruthy();
    expect(String(file.data.url ?? file.data)).toBe(REMOTE_IMAGE);
    expect(typeof file.data === "string",
        "a bare string in `data` means inline base64 — the URL would be decoded as bytes").toBe(false);
});

test("a remote file is sent as a URL, not as base64 @unit", async () => {
    const parts = await promptPartsFor(userMessage([
        { type: "file", mimeType: "application/pdf", url: REMOTE_FILE, name: "report.pdf" },
    ]));

    const file = parts.find((p) => p.type === "file");
    expect(file).toBeTruthy();
    expect(String(file.data.url ?? file.data)).toBe(REMOTE_FILE);
    expect(typeof file.data === "string").toBe(false);
});

test("media is replaced by text when the model cannot take it @unit", async () => {
    const parts = await promptPartsFor(
        userMessage([{ type: "image", mimeType: "image/png", dataUrl: PNG_DATA_URL, name: "shot.png" }]),
        { text: "supported", images: "unsupported", files: "unsupported", source: "probe" },
    );

    expect(parts.some((p) => p.type === "file")).toBe(false);
    expect(parts.map((p) => p.text).join(" ")).toContain("Image omitted");
});

test("the system prompt travels as instructions, not as a message @unit", async () => {
    const { model, seen } = stubModel();
    await generateText({
        model,
        instructions: "SYSTEM-PROMPT",
        messages: [toModelMessage(userMessage([{ type: "text", text: "hi" }]))],
    });

    const roles = seen.prompt.map((m) => m.role);
    expect(roles.filter((r) => r === "system")).toHaveLength(1);
    expect(JSON.stringify(seen.prompt[0])).toContain("SYSTEM-PROMPT");
    expect(roles.at(-1)).toBe("user");
});

test("a remote asset the model cannot take is fetched through the SSRF guard @unit", async () => {
    // Without this hook the SDK resolves the URL with plain `fetch` from the server
    // process — a client-supplied address turning into a server-side request. The
    // stub model deliberately supports NO urls, which is what triggers that path.
    const asked = [];
    const previous = globalThis.XOPAT_SERVER;
    globalThis.XOPAT_SERVER = {
        safeRequest: async (href) => {
            asked.push(href);
            return {
                ok: true,
                status: 200,
                headers: { "content-type": "image/png" },
                arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
            };
        },
    };
    try {
        const { model, seen } = stubModel();
        model.supportedUrls = {};                       // provider cannot fetch it itself
        await generateText({
            model,
            instructions: "S",
            messages: [toModelMessage(userMessage([{ type: "image", mimeType: "image/png", url: REMOTE_IMAGE }]))],
            experimental_download: createGuardedDownload(),
        });

        expect(asked, "the guard, not plain fetch, must perform the download").toEqual([REMOTE_IMAGE]);
        const file = (seen.prompt.at(-1).content || []).find((p) => p.type === "file");
        // The SDK hands the model what the hook returned, tagged as inline data.
        expect(file.data.data ?? file.data).toBeInstanceOf(Uint8Array);
    } finally {
        globalThis.XOPAT_SERVER = previous;
    }
});

test("a remote asset is refused when the SSRF guard is unavailable @unit", async () => {
    const previous = globalThis.XOPAT_SERVER;
    globalThis.XOPAT_SERVER = {};                       // no safeRequest — degrade closed
    try {
        const { model } = stubModel();
        model.supportedUrls = {};
        await expect(generateText({
            model,
            instructions: "S",
            messages: [toModelMessage(userMessage([{ type: "image", mimeType: "image/png", url: REMOTE_IMAGE }]))],
            experimental_download: createGuardedDownload(),
        })).rejects.toThrow(/SSRF guard/i);
    } finally {
        globalThis.XOPAT_SERVER = previous;
    }
});

test("a cut stream reports an abort part rather than ending cleanly @unit", async () => {
    // The turn loop treats `abort` as terminal. If a future SDK stopped emitting it,
    // that branch would become dead code and a truncated reply would be persisted as
    // a complete answer — which is exactly what this pins.
    const controller = new AbortController();
    const model = {
        specificationVersion: "v4",
        provider: "stub",
        modelId: "stub-1",
        supportedUrls: {},
        async doStream({ abortSignal }) {
            return {
                stream: new ReadableStream({
                    start(c) {
                        c.enqueue({ type: "stream-start", warnings: [] });
                        c.enqueue({ type: "text-start", id: "1" });
                        c.enqueue({ type: "text-delta", id: "1", delta: "partial" });
                        // No `finish` part — like a provider whose connection is cut
                        // mid-answer. The consumer's abort is what ends it.
                        abortSignal?.addEventListener("abort", () => {
                            try { c.close(); } catch { /* already closed */ }
                        }, { once: true });
                    },
                }),
            };
        },
    };

    const seen = [];
    const result = streamText({
        model,
        instructions: "S",
        messages: [{ role: "user", content: "hi" }],
        abortSignal: controller.signal,
        onError: () => { /* the abort surfaces as a part, not as a throw */ },
    });
    try {
        for await (const part of result.stream) {
            seen.push(part.type);
            if (part.type === "text-delta") controller.abort();
        }
    } catch (_) { /* an abort may also end the iteration */ }

    expect(seen).toContain("text-delta");
    expect(seen, "an aborted stream must be distinguishable from a finished one")
        .toContain("abort");
});
