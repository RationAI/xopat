/**
 * Words in scripts with and without spaces — the tokenizer under the module's text
 * filters (prompt echo, repetition, seam trimming).
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const moduleDir = path.join(fromRoot(), "modules", "speech-to-text");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-text-words-"));
const esbuild = require("esbuild");
const outfile = path.join(tmp, "textWords.mjs");
await esbuild.build({
    entryPoints: [path.join(moduleDir, "textWords.ts")],
    outfile, bundle: true, platform: "neutral", format: "esm", logLevel: "silent",
});
const { words, wordSpans, hasCJK, normalizeKey } = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test("English words split as before, hyphens and apostrophes intact", { tag: ["@unit"] }, () => {
    expect(words("airway-centered fibrosis, I'm sure.")).toEqual(["airway", "centered", "fibrosis", "I'm", "sure"]);
});

test("a Japanese sentence has many words, with offsets into the source", { tag: ["@unit"] }, () => {
    const text = "間質性肺炎です。蜂巣肺はありません。";
    const spans = wordSpans(text, "ja");
    expect(spans.length).toBeGreaterThanOrEqual(4);
    for (const s of spans) expect(text.slice(s.index, s.index + s.text.length)).toBe(s.text);
});

test("mixed-script text keeps the Latin term as one word", { tag: ["@unit"] }, () => {
    expect(words("UIP パターンです", "ja")).toContain("UIP");
});

test("hasCJK and normalizeKey", { tag: ["@unit"] }, () => {
    expect(hasCJK("間質性肺炎")).toBe(true);
    expect(hasCJK("interstitial pneumonia")).toBe(false);
    expect(normalizeKey("ＵＩＰ pattern, 2+!")).toBe("uippattern2");
});
