/**
 * The server-side allowance for a transcription biasing prompt.
 *
 * `runTranscription` slices the client's prompt to `promptCapFor(runtime.config)` and drops
 * it entirely at 0. Two things this pins: the DEFAULT is off (a provider that says nothing
 * sends no prompt — the whisper-large-v3 audio-dropping measurement is why), and a provider
 * cannot ask for more than the ceiling however its config is written.
 *
 * The adapters copy `providerDefaults.transcriptionPromptMaxChars` into `fixedConfig`; this
 * test covers the read side only. Before that copy existed the documented key reached
 * nothing — the plumbing is covered by the field-round trace (`contextChars > 0`), not here.
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
const moduleDir = path.join(fromRoot(), "modules", "vercel-ai-chat-sdk");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-stt-cap-"));

const outfile = path.join(tmp, "transcriptionPrompt.mjs");
await esbuild.build({
    entryPoints: [path.join(moduleDir, "shared", "transcriptionPrompt.ts")],
    outfile, bundle: true, platform: "neutral", format: "esm", logLevel: "silent",
});
const { promptCapFor, TRANSCRIBE_MAX_PROMPT_CHARS } = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test("@unit a provider that declares nothing allows no prompt", () => {
    expect(promptCapFor(undefined)).toBe(0);
    expect(promptCapFor({})).toBe(0);
    expect(promptCapFor({ transcriptionPromptMaxChars: undefined })).toBe(0);
});

test("@unit a non-numeric or non-positive value is off, not NaN and not negative", () => {
    expect(promptCapFor({ transcriptionPromptMaxChars: "abc" })).toBe(0);
    expect(promptCapFor({ transcriptionPromptMaxChars: -5 })).toBe(0);
    expect(promptCapFor({ transcriptionPromptMaxChars: 0 })).toBe(0);
    expect(promptCapFor({ transcriptionPromptMaxChars: Infinity })).toBe(0);
});

test("@unit a declared allowance is honoured, whole characters only", () => {
    expect(promptCapFor({ transcriptionPromptMaxChars: 60 })).toBe(60);
    expect(promptCapFor({ transcriptionPromptMaxChars: "60" })).toBe(60);
    expect(promptCapFor({ transcriptionPromptMaxChars: 12.7 })).toBe(12);
});

test("@unit no provider gets past the ceiling", () => {
    expect(promptCapFor({ transcriptionPromptMaxChars: 5000 })).toBe(TRANSCRIBE_MAX_PROMPT_CHARS);
    expect(TRANSCRIBE_MAX_PROMPT_CHARS).toBe(1000);
});
