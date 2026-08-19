/**
 * The two rules that keep a turn request from growing without bound.
 *
 * Both exist because of the same incident: a ~1 MB image was uploaded to the
 * attachment store AND re-sent inline inside the turn's `messagesDelta`, the
 * body crossed `maxBodyBytes`, and — since the sync cursor does not advance on a
 * failed turn — every later turn in that session re-sent the same oversized
 * delta. The session was unusable until reload.
 *
 * 1. `stripDuplicatedPartPayloads` removes the bytes that the `attachmentId`
 *    already addresses, without mutating what the UI renders from.
 * 2. `hashScriptApiManifest` is the handle that lets the manifest — identical on
 *    every turn of a session — be sent once. Client and server derive it from
 *    the same function, so the property that matters is that it is stable
 *    against irrelevant differences (key order) and sensitive to real ones.
 *
 * The sources are TypeScript; they are transpiled with the esbuild the repo
 * already depends on (same approach as test/legacy/chat-script-text.mjs).
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharedDir = path.join(fromRoot(), "modules", "vercel-ai-chat-sdk", "shared");

const tmp = mkdtempSync(path.join(tmpdir(), "xopat-chat-payload-"));
const esbuild = require("esbuild");

async function loadShared(name) {
    const outfile = path.join(tmp, `${name}.mjs`);
    await esbuild.build({
        entryPoints: [path.join(sharedDir, `${name}.ts`)],
        outfile,
        bundle: true,
        platform: "neutral",
        format: "esm",
        logLevel: "silent",
    });
    return import(pathToFileURL(outfile).href);
}

const { stripDuplicatedPartPayloads, stripDuplicatedMessagePayloads } = await loadShared("attachment-parts");
const { hashScriptApiManifest } = await loadShared("manifest-handle");

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test("drops an inline payload the attachmentId already addresses", { tag: ["@unit"] }, () => {
    const message = {
        role: "tool",
        parts: [
            { type: "image", attachmentId: "att_1", mimeType: "image/png", dataUrl: "data:image/png;base64,AAAA" },
            { type: "text", text: "kept" },
        ],
    };

    const stripped = stripDuplicatedPartPayloads(message);

    expect(stripped.parts[0].dataUrl, "the duplicated bytes are gone").toBeUndefined();
    expect(stripped.parts[0].attachmentId, "the address that replaces them stays").toBe("att_1");
    expect(stripped.parts[1], "unrelated parts are passed through untouched").toEqual({ type: "text", text: "kept" });
});

test("never mutates the caller's message", { tag: ["@unit"] }, () => {
    // The UI renders from the stored message; stripping is a wire-format concern
    // and must not reach back into what the user is looking at.
    const part = { type: "image", attachmentId: "att_1", mimeType: "image/png", dataUrl: "data:image/png;base64,AAAA" };
    const message = { role: "user", parts: [part] };

    stripDuplicatedPartPayloads(message);

    expect(part.dataUrl, "the original part keeps its payload").toBe("data:image/png;base64,AAAA");
    expect(message.parts[0]).toBe(part);
});

test("leaves a payload that nothing else holds", { tag: ["@unit"] }, () => {
    // No attachmentId means the store does not have these bytes — dropping them
    // would lose the content, not deduplicate it.
    const message = { role: "user", parts: [{ type: "image", dataUrl: "data:image/png;base64,AAAA" }] };
    expect(stripDuplicatedPartPayloads(message), "same object back when nothing changed").toBe(message);
});

test("strips across a message list", { tag: ["@unit"] }, () => {
    const clean = { role: "user", parts: [{ type: "text", text: "hi" }] };
    const dirty = { role: "tool", parts: [{ type: "file", attachmentId: "att_2", mimeType: "text/csv", name: "a.csv", dataUrl: "data:text/csv;base64,QQ==" }] };

    const out = stripDuplicatedMessagePayloads([clean, dirty]);

    expect(out[0], "untouched messages keep their identity").toBe(clean);
    expect(out[1].parts[0].dataUrl).toBeUndefined();
    expect(out[1].parts[0].name, "everything but the payload survives").toBe("a.csv");
});

test("manifest hash ignores key order but not content", { tag: ["@unit"] }, () => {
    // Client and server hash independently. If serialization order leaked in,
    // they would disagree and every turn would take the miss-and-resend path —
    // strictly worse than not having a handle at all.
    const a = { namespaces: [{ namespace: "viewer", methods: [{ name: "zoom" }], description: "d" }] };
    const b = { namespaces: [{ description: "d", methods: [{ name: "zoom" }], namespace: "viewer" }] };
    const changed = { namespaces: [{ namespace: "viewer", methods: [{ name: "pan" }], description: "d" }] };

    expect(hashScriptApiManifest(a)).toBe(hashScriptApiManifest(b));
    expect(hashScriptApiManifest(a)).not.toBe(hashScriptApiManifest(changed));
});

test("an empty manifest has no handle", { tag: ["@unit"] }, () => {
    // `null` is what tells the client there is nothing to address, so it must not
    // be confused with a hash of an empty object.
    expect(hashScriptApiManifest(undefined)).toBeNull();
    expect(hashScriptApiManifest({ namespaces: [] })).toBeNull();
});
