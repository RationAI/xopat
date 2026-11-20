/**
 * The chat renders namespace-declared assistant hints generically: which namespaces are
 * documented in full, the always-on `framing`, the tier-following `guidance`, and the
 * recommended-pattern examples. No namespace name is special-cased in the chat module.
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
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-namespace-assistant-"));
const outfile = path.join(tmp, "namespace-assistant.mjs");
await esbuild.build({
    entryPoints: [path.join(fromRoot(), "modules", "vercel-ai-chat-sdk", "shared", "namespace-assistant.ts")],
    outfile, bundle: true, platform: "neutral", format: "esm", logLevel: "silent",
});
const {
    defaultFullNamespaces, namespaceAssistantBlocks, recommendedPatternsBlock, ASSISTANT_TEXT_MAX,
} = await import(pathToFileURL(outfile).href);
rmSync(tmp, { recursive: true, force: true });

const ns = (namespace, assistant) => ({ namespace, name: namespace, methods: [], ...(assistant ? { assistant } : {}) });

const manifest = {
    namespaces: [
        ns("application", { promptTier: "full", examples: ["A: `a()`"] }),
        ns("viewer", { promptTier: "full", examples: ["V: `v()`"] }),
        ns("visualization", { framing: "### Viz framing", guidance: "### Viz guidance" }),
        ns("ui", { framing: "### UI framing" }),
        ns("plain"),
    ],
};

test("the full tier is what namespaces declare", () => {
    expect([...defaultFullNamespaces(manifest)].sort()).toEqual(["application", "viewer"]);
    expect(defaultFullNamespaces(undefined).size).toBe(0);
});

test("framing is always on, in manifest order", () => {
    expect(namespaceAssistantBlocks(manifest.namespaces, "framing")).toBe("\n### Viz framing\n\n### UI framing\n");
});

test("guidance renders only for the namespaces passed (the full-rendered ones)", () => {
    const full = manifest.namespaces.filter((n) => defaultFullNamespaces(manifest).has(n.namespace));
    expect(namespaceAssistantBlocks(full, "guidance")).toBe("");
    const expanded = manifest.namespaces.filter((n) => n.namespace === "visualization");
    expect(namespaceAssistantBlocks(expanded, "guidance")).toBe("\n### Viz guidance\n");
});

test("oversize or non-string text is dropped whole, never truncated", () => {
    const big = ns("big", { framing: "x".repeat(ASSISTANT_TEXT_MAX + 1), guidance: 42 });
    expect(namespaceAssistantBlocks([big], "framing")).toBe("");
    expect(namespaceAssistantBlocks([big], "guidance")).toBe("");
});

test("recommended patterns collect examples in manifest order", () => {
    expect(recommendedPatternsBlock(manifest)).toBe("\nRecommended patterns:\n- A: `a()`\n- V: `v()`\n");
    expect(recommendedPatternsBlock({ namespaces: [ns("plain")] })).toBe("");
});
