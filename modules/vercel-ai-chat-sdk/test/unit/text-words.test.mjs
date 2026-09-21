/**
 * Words in scripts with and without spaces — the tokenizer under the segment-noise gate.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const moduleDir = path.join(fromRoot(), "modules", "vercel-ai-chat-sdk");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-chat-text-words-"));
const esbuild = require("esbuild");
const outfile = path.join(tmp, "text-words.mjs");
await esbuild.build({
    entryPoints: [path.join(moduleDir, "shared", "text-words.ts")],
    outfile, bundle: true, platform: "neutral", format: "esm", logLevel: "silent",
});
const { words, hasCJK, normalizeKey } = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test("English words split as before", { tag: ["@unit"] }, () => {
    expect(words("no dense fibrosis, no honeycombing.")).toEqual(["no", "dense", "fibrosis", "no", "honeycombing"]);
});

test("a Japanese sentence has many words", { tag: ["@unit"] }, () => {
    expect(words("間質性肺炎です。蜂巣肺はありません。", "ja").length).toBeGreaterThanOrEqual(4);
    expect(hasCJK("間質性肺炎")).toBe(true);
    expect(normalizeKey("ＵＩＰ！")).toBe("uip");
});
