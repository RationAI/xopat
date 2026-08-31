/**
 * What a chat message looks like in a log file.
 *
 * The transcript exists because the `llm` diagnostics could not answer "what was
 * said in this session": they describe one TURN's assembly and re-log the whole
 * conversation each time, so an N-turn session cost O(N²) and the thing you
 * actually wanted to read was buried in N copies of itself.
 *
 * These pin the projection — the part that decides what ends up on a line. The
 * "exactly once" property is a property of the CALL SITE
 * (`SessionStore.appendMessages`, which only ever sees newly-stored messages),
 * not of these functions.
 *
 * The source is TypeScript; it is transpiled with the esbuild the repo already
 * depends on, the same way payload-slimming.test.mjs does it.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const serverDir = path.join(fromRoot(), "modules", "vercel-ai-chat-sdk", "server");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-chat-transcript-"));
const esbuild = require("esbuild");

const outfile = path.join(tmp, "transcript.mjs");
await esbuild.build({
    entryPoints: [path.join(serverDir, "transcript.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
});
const {
    attachmentFilePath, extensionFor, decodeDataUrl, describeMessageAttachments, transcriptRecord,
} = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// ---- the path both sides have to agree on -------------------------------------

test("the attachment path is derived from ids, not coordinated @unit", { tag: ["@unit"] }, () => {
    // The message record and the attachment bytes are written by different calls
    // at different times. They agree because the path is a function of the ids.
    const fromRecord = attachmentFilePath({ id: "att_1", sessionId: "sess_1", mimeType: "image/png" });
    const fromPart = describeMessageAttachments({
        sessionId: "sess_1",
        parts: [{ type: "image", attachmentId: "att_1", mimeType: "image/png" }],
    })[0].file;

    expect(fromRecord).toBe("sess_1/att_1.png");
    expect(fromPart, "the line points at the file the writer will create").toBe(fromRecord);
});

test("the extension is one a human can double-click @unit", { tag: ["@unit"] }, () => {
    expect(extensionFor("image/png")).toBe(".png");
    expect(extensionFor("image/jpeg"), "jpeg is spelled jpg on disk").toBe(".jpg");
    expect(extensionFor("image/svg+xml")).toBe(".svg");
    // The user's own filename wins — it is what they called it.
    expect(extensionFor("application/octet-stream", "scan.tiff")).toBe(".tiff");
    // Never empty: a directory of extensionless blobs is not "so we can see them".
    expect(extensionFor(undefined, undefined)).toBe(".bin");
    expect(extensionFor("nonsense")).toBe(".bin");
});

// ---- what is on the line -------------------------------------------------------

test("a record carries the message, and NAMES its attachments @unit", { tag: ["@unit"] }, () => {
    const record = transcriptRecord({
        id: "msg_1", sessionId: "sess_1", role: "user", createdAt: "2026-08-25T10:00:00.000Z",
        content: "what is on this slide?",
        parts: [
            { type: "text", text: "what is on this slide?" },
            { type: "image", attachmentId: "att_9", mimeType: "image/png", name: "shot.png" },
        ],
    });

    expect(record.messageId).toBe("msg_1");
    expect(record.role).toBe("user");
    expect(record.content, "the words are the point of a transcript").toBe("what is on this slide?");
    expect(record.attachments).toEqual([
        { id: "att_9", mimeType: "image/png", name: "shot.png", file: "sess_1/att_9.png" },
    ]);
});

test("an inline dataUrl is described, never inlined @unit", { tag: ["@unit"] }, () => {
    // One base64 screenshot per line is the repetition problem in a new costume.
    const record = transcriptRecord({
        id: "msg_2", sessionId: "sess_1", role: "user",
        parts: [{ type: "image", attachmentId: "att_2", mimeType: "image/png", dataUrl: "data:image/png;base64,AAAA" }],
    });

    expect(record.attachments[0].file).toBe("sess_1/att_2.png");
    expect(JSON.stringify(record.attachments)).not.toContain("base64");
});

test("a message with no attachments says nothing about them @unit", { tag: ["@unit"] }, () => {
    const record = transcriptRecord({
        id: "msg_3", sessionId: "sess_1", role: "assistant", content: "a prostate needle biopsy",
        parts: [{ type: "text", text: "a prostate needle biopsy" }],
    });
    expect(record.attachments).toBeUndefined();
});

test("script results are kept in full — they explain the answer @unit", { tag: ["@unit"] }, () => {
    // The reason a transcript beats a summary: the model's reply usually only
    // makes sense next to what the script handed it.
    const result = JSON.stringify({ status: "ok", regions: [{ label: "region 1" }] });
    const record = transcriptRecord({
        id: "msg_4", sessionId: "sess_1", role: "tool",
        parts: [{ type: "script-result", text: result }],
    });
    expect(JSON.stringify(record.parts)).toContain("region 1");
});

// ---- bytes ---------------------------------------------------------------------

test("a base64 data URL decodes to its bytes @unit", { tag: ["@unit"] }, () => {
    const png = decodeDataUrl("data:image/png;base64,iVBORw0KGgo=");
    expect(png?.length).toBe(8);
    expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

test("anything that is not base64 bytes decodes to nothing @unit", { tag: ["@unit"] }, () => {
    // Refusing is the right answer: a half-decoded attachment on disk is worse
    // than an absent one, and the line says it was not stored.
    expect(decodeDataUrl("data:text/plain,hello")).toBe(null);
    expect(decodeDataUrl("https://example.org/x.png")).toBe(null);
    expect(decodeDataUrl("data:image/png;base64,")).toBe(null);
});
