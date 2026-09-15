/**
 * What the vision model was shown, kept as an asset.
 *
 * A pathology run ships up to twenty-eight off-screen renders to a foundation
 * model; the session that comes back reports conclusions and the images are
 * gone. These pin the record that fixes that: one line naming which slide and
 * box was read, one file holding the pixels, and — the property that makes it
 * safe to enable — nothing about it reaching the model.
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
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-vision-log-"));
const esbuild = require("esbuild");

const outfile = path.join(tmp, "vision-log.mjs");
await esbuild.build({
    entryPoints: [path.join(serverDir, "vision-log.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
});
const { logVisionCall, visionAssetPath, extensionForMedia } = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A logger that records what it was asked to emit. */
function spyLogger({ enabled = true } = {}) {
    const records = [];
    const attachments = [];
    return {
        records,
        attachments,
        isEnabled: () => enabled,
        sensitive: (fields, message) => records.push({ fields, message }),
        attachment: (payload) => attachments.push(payload),
        debug: (fields, message) => records.push({ fields, message, level: "debug" }),
    };
}

/** One field read of a slide, as the pathology broker describes it. */
const CONTEXT = {
    feature: "analyze",
    label: "region 2.1",
    region: { x: 3211, y: 191429, width: 14221, height: 6079 },
    viewerId: "viewer-1",
    tileSourceId: "slide-abc",
    deliveredMpp: 1.598,
};

const INPUT = {
    prompt: "Describe the tissue in this field.",
    system: "You are a pathology assistant.",
    // "PNG" in base64 — enough to prove the bytes were decoded, not copied.
    imageBase64: "iVBORw0KGgo=",
    mediaType: "image/png",
    context: CONTEXT,
};

const OUTCOME = { providerId: "medgemma", model: "medgemma-4b", text: "Prostatic acini.", durationMs: 812 };

// ---- the gate -------------------------------------------------------------------

test("a disabled channel costs nothing — no record, no decode @unit", { tag: ["@unit"] }, () => {
    // The reason this can be shipped on by default in the code and off by default
    // in config: with the channel down it is a level lookup and a return.
    const logger = spyLogger({ enabled: false });
    logVisionCall(logger, "req-1", INPUT, OUTCOME);

    expect(logger.records.length).toBe(0);
    expect(logger.attachments.length).toBe(0);
});

test("a logging failure never reaches the inference call @unit", { tag: ["@unit"] }, () => {
    // A diagnostic that breaks the thing it observes is worse than a missing one.
    const broken = {
        isEnabled: () => true,
        sensitive: () => { throw new Error("sink exploded"); },
        attachment: () => { throw new Error("sink exploded"); },
        debug: () => {},
    };
    expect(() => logVisionCall(broken, "req-1", INPUT, OUTCOME)).not.toThrow();
});

// ---- the asset ------------------------------------------------------------------

test("the image is an attachment, and the line points at it @unit", { tag: ["@unit"] }, () => {
    const logger = spyLogger();
    logVisionCall(logger, "req-42", INPUT, OUTCOME);

    expect(logger.attachments.length).toBe(1);
    expect(logger.records.length).toBe(1);

    const [asset] = logger.attachments;
    const [line] = logger.records;
    expect(line.message).toBe("VISION_CALL");
    expect(line.fields.image, "the line names the file that holds the pixels").toBe(asset.file);
    expect(asset.file).toMatch(/^vision\/\d{4}-\d{2}-\d{2}\/req-42\.png$/);
});

test("the bytes are decoded, not carried as base64 @unit", { tag: ["@unit"] }, () => {
    // Base64 in a log line is the repetition problem in another costume — and a
    // file of base64 is not an image anyone can look at.
    const logger = spyLogger();
    logVisionCall(logger, "req-1", INPUT, OUTCOME);

    const [asset] = logger.attachments;
    expect(Array.from(asset.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(JSON.stringify(logger.records[0]), "and never in the record").not.toContain("iVBORw");
});

test("a text-only call logs no image and claims none @unit", { tag: ["@unit"] }, () => {
    // A line pointing at a file nobody wrote is worse than no line.
    const logger = spyLogger();
    logVisionCall(logger, "req-1", { ...INPUT, imageBase64: null }, OUTCOME);

    expect(logger.attachments.length).toBe(0);
    expect(logger.records[0].fields.image).toBeUndefined();
});

// ---- what the record says -------------------------------------------------------

test("the record says WHICH slide and box was reviewed @unit", { tag: ["@unit"] }, () => {
    // The whole point: a conclusion you can trace back to a place on a slide.
    const logger = spyLogger();
    logVisionCall(logger, "req-1", INPUT, OUTCOME);

    const { fields } = logger.records[0];
    expect(fields.tileSourceId).toBe("slide-abc");
    expect(fields.region).toEqual(CONTEXT.region);
    expect(fields.label).toBe("region 2.1");
    expect(fields.deliveredMpp, "how closely it was actually read").toBe(1.598);
    expect(fields.model).toBe("medgemma-4b");
    expect(fields.findings).toBe("Prostatic acini.");
    expect(fields.durationMs).toBe(812);
});

test("the context describes the image on the attachment too @unit", { tag: ["@unit"] }, () => {
    // The sidecar file is browsable on its own; its line has to be self-describing.
    const logger = spyLogger();
    logVisionCall(logger, "req-1", INPUT, OUTCOME);
    expect(logger.attachments[0].tileSourceId).toBe("slide-abc");
    expect(logger.attachments[0].mediaType).toBe("image/png");
});

test("a call with no context still produces a usable record @unit", { tag: ["@unit"] }, () => {
    // Callers other than the pathology broker (mixture extraction) pass none.
    const logger = spyLogger();
    logVisionCall(logger, "req-1", { ...INPUT, context: null }, OUTCOME);

    expect(logger.records.length).toBe(1);
    expect(logger.records[0].fields.model).toBe("medgemma-4b");
    expect(logger.records[0].fields.region).toBeUndefined();
});

test("the caller's input is never mutated — logging cannot change the call @unit", { tag: ["@unit"] }, () => {
    // The invariant that makes this safe to enable in production: the context is
    // read for the record and never folded into what the model is asked.
    const input = { ...INPUT, context: { ...CONTEXT } };
    const before = JSON.stringify(input);
    logVisionCall(spyLogger(), "req-1", input, OUTCOME);
    expect(JSON.stringify(input)).toBe(before);
});

// ---- paths ----------------------------------------------------------------------

test("the asset path is grouped by day and named by call @unit", { tag: ["@unit"] }, () => {
    expect(visionAssetPath("req-7", "image/png", "2026-08-25")).toBe("vision/2026-08-25/req-7.png");
});

test("a hostile call id cannot escape the directory @unit", { tag: ["@unit"] }, () => {
    // The id comes from the request layer today. That is exactly the assumption
    // that stops holding the first time it does not.
    expect(visionAssetPath("../../etc/passwd", "image/png", "2026-08-25"))
        .toBe("vision/2026-08-25/etcpasswd.png");
    expect(visionAssetPath("", "image/png", "2026-08-25")).toBe("vision/2026-08-25/call.png");
});

test("the extension is one a person can double-click @unit", { tag: ["@unit"] }, () => {
    expect(extensionForMedia("image/png")).toBe("png");
    expect(extensionForMedia("image/jpeg")).toBe("jpg");
    expect(extensionForMedia("image/svg+xml")).toBe("svg");
    expect(extensionForMedia(null)).toBe("png");
    expect(extensionForMedia("nonsense")).toBe("bin");
});
