/**
 * The session switcher is a fixed-height, one-line control. A title that wraps is
 * clipped mid-glyph by the button, which is what shipped: the auto-title was a raw
 * 80-character slice of the first user message, so a normal sentence produced a
 * two-line title cut through the middle of the text.
 *
 * These assertions pin the three properties the control depends on: one line, a cut
 * that lands between words, and a visible ellipsis when a cut happened.
 *
 * The source is TypeScript; it is transpiled with the esbuild the repo already
 * depends on (same approach as payload-slimming.test.mjs).
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
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-chat-title-"));
const esbuild = require("esbuild");

const outfile = path.join(tmp, "session-title.mjs");
await esbuild.build({
    entryPoints: [path.join(sharedDir, "session-title.ts")],
    outfile,
    bundle: true,
    platform: "neutral",
    format: "esm",
    logLevel: "silent",
});
const { titleFromFirstMessage, TITLE_MAX_CHARS, DEFAULT_SESSION_TITLE } =
    await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test("a short message is the title verbatim", () => {
    expect(titleFromFirstMessage("how many slides are open?")).toBe("how many slides are open?");
});

test("empty and whitespace-only messages fall back to the default title", () => {
    expect(titleFromFirstMessage("")).toBe(DEFAULT_SESSION_TITLE);
    expect(titleFromFirstMessage("   \n\t ")).toBe(DEFAULT_SESSION_TITLE);
    expect(titleFromFirstMessage(null)).toBe(DEFAULT_SESSION_TITLE);
    expect(titleFromFirstMessage(undefined)).toBe(DEFAULT_SESSION_TITLE);
});

test("newlines are collapsed — the control renders one line", () => {
    const title = titleFromFirstMessage("first line\nsecond line\r\n\tthird");
    expect(title).toBe("first line second line third");
    expect(title).not.toContain("\n");
});

test("a long message is cut on a word boundary and marked with an ellipsis", () => {
    // The message from the bug report.
    const title = titleFromFirstMessage(
        "the visualization I am viewing is not nice, can you improve it to suitably show the data"
    );
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX_CHARS + 1);
    // Cut between words: no partial word before the ellipsis.
    expect(title).toBe("the visualization I am viewing is not nice, can you improve…");
});

test("a single unbroken token is hard-cut rather than lost", () => {
    const blob = "x".repeat(200);
    const title = titleFromFirstMessage(blob);
    expect(title).toBe("x".repeat(TITLE_MAX_CHARS) + "…");
});

test("trailing punctuation is not left dangling before the ellipsis", () => {
    const title = titleFromFirstMessage(`${"word ".repeat(11)}, tail that overflows the budget`);
    expect(title.endsWith("…")).toBe(true);
    expect(/[\s,;:.\-]…$/.test(title)).toBe(false);
});

test("a message exactly at the budget is not truncated", () => {
    const exact = "a".repeat(TITLE_MAX_CHARS);
    expect(titleFromFirstMessage(exact)).toBe(exact);
});
