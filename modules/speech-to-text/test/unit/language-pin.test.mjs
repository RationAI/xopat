/**
 * The language hint a session sends: nothing until two segments agree, then that
 * language for the rest of the session; a fixed code always.
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
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-language-pin-"));
const esbuild = require("esbuild");
const outfile = path.join(tmp, "languagePin.mjs");
await esbuild.build({
    entryPoints: [path.join(moduleDir, "languagePin.ts")],
    outfile, bundle: true, platform: "neutral", format: "esm", logLevel: "silent",
});
const { LanguagePin, primaryLanguage } = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test("a fixed code is always the hint and never votes", { tag: ["@unit"] }, () => {
    const p = new LanguagePin("cs");
    expect(p.mode).toBe("fixed");
    expect(p.hint()).toBe("cs");
    expect(p.vote("ja")).toBe(false);
    expect(p.vote("ja")).toBe(false);
    expect(p.hint()).toBe("cs");
});

test("auto sends nothing until two consecutive segments agree", { tag: ["@unit"] }, () => {
    for (const mode of ["auto", "AUTO", "", undefined, null]) {
        const p = new LanguagePin(mode);
        expect(p.mode).toBe("auto");
        expect(p.hint()).toBeUndefined();
        expect(p.vote("ja")).toBe(false);
        expect(p.hint()).toBeUndefined();
        expect(p.vote("ja")).toBe(true);
        expect(p.hint()).toBe("ja");
        expect(p.language).toBe("ja");
    }
});

test("a disagreeing vote restarts the count", { tag: ["@unit"] }, () => {
    const p = new LanguagePin("auto");
    expect(p.vote("ja")).toBe(false);
    expect(p.vote("en")).toBe(false);
    expect(p.hint()).toBeUndefined();
    expect(p.vote("en")).toBe(true);
    expect(p.hint()).toBe("en");
});

test("region subtags agree with their language; junk votes are ignored", { tag: ["@unit"] }, () => {
    const p = new LanguagePin("auto");
    expect(p.vote("ja-JP")).toBe(false);
    expect(p.vote(undefined)).toBe(false);
    expect(p.vote("")).toBe(false);
    expect(p.vote("auto")).toBe(false);
    expect(p.vote("JA")).toBe(true);
    expect(p.hint()).toBe("ja");
    expect(primaryLanguage("en_US")).toBe("en");
    expect(primaryLanguage("auto")).toBe("");
});

test("once pinned the session stays pinned; reset starts over", { tag: ["@unit"] }, () => {
    const p = new LanguagePin("auto");
    p.vote("ja"); p.vote("ja");
    expect(p.vote("en")).toBe(false);
    expect(p.vote("en")).toBe(false);
    expect(p.hint()).toBe("ja");
    p.reset();
    expect(p.hint()).toBeUndefined();
    expect(p.vote("en")).toBe(false);
    expect(p.vote("en")).toBe(true);
    expect(p.hint()).toBe("en");
});
