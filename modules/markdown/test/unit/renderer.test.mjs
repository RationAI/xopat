/**
 * The rendering pipeline's three load-bearing properties:
 *
 *  1. it degrades CLOSED — no sanitizer means plain text, never raw `marked` output.
 *     This exact bug shipped once (the chat renderer used to `return html` unchanged
 *     when the sanitizer was missing), so it is pinned here rather than trusted;
 *  2. plain prose never reaches the parser at all — the questionnaire re-renders its
 *     whole preview on every keystroke, and that is only affordable because most
 *     descriptions take the fast path;
 *  3. a repeated string is a cache hit, for the same reason.
 *
 * The source is TypeScript; transpiled with the esbuild the repo already depends on
 * (same approach as the chat module's shared/* tests).
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
const moduleDir = path.join(fromRoot(), "modules", "markdown");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-markdown-"));

const build = async (name) => {
    const outfile = path.join(tmp, `${name}.mjs`);
    await esbuild.build({
        entryPoints: [path.join(moduleDir, `${name}.ts`)],
        outfile,
        bundle: true,
        platform: "neutral",
        format: "esm",
        logLevel: "silent",
    });
    return import(pathToFileURL(outfile).href);
};

const { MarkdownRenderer, needsMarkdown } = await build("renderer");
const { XOpatLinks } = await build("links");

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const links = () => new XOpatLinks((key) => key);
const renderer = () => new MarkdownRenderer(links());

/** Minimal stand-in for the sanitize-html module: strips <script> and javascript: hrefs. */
const installSanitizer = (impl) => {
    const previous = globalThis.SanitizeHtml;
    globalThis.SanitizeHtml = impl ?? ((html) => html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/href="javascript:[^"]*"/gi, 'href="#"'));
    return () => { globalThis.SanitizeHtml = previous; };
};

test("plain prose takes the fast path (never parsed)", () => {
    expect(needsMarkdown("Answer the questions about this slide.")).toBe(false);
    expect(needsMarkdown("Explore **region 3.6** below.")).toBe(true);
    expect(needsMarkdown("See [the region](#xopat-region?x=1&y=2).")).toBe(true);
    expect(needsMarkdown("1. First step")).toBe(true);
});

test("no sanitizer means null — never raw parser output", () => {
    const previous = globalThis.SanitizeHtml;
    globalThis.SanitizeHtml = undefined;
    try {
        expect(renderer().renderToHtml("**bold**")).toBe(null);
    } finally {
        globalThis.SanitizeHtml = previous;
    }
});

test("script tags and javascript: hrefs do not survive", () => {
    const restore = installSanitizer();
    try {
        const html = renderer().renderToHtml("hi <script>alert(1)</script> [x](javascript:alert(1))");
        expect(html).not.toContain("<script");
        expect(html).not.toContain("javascript:");
    } finally {
        restore();
    }
});

test("the same string renders once and is served from cache afterwards", () => {
    let calls = 0;
    const restore = installSanitizer((html) => { calls++; return html; });
    try {
        const md = renderer();
        const first = md.renderToHtml("**bold** text");
        const second = md.renderToHtml("**bold** text");
        expect(second).toBe(first);
        expect(calls).toBe(1);
    } finally {
        restore();
    }
});

test("inline rendering emits no block wrapper", () => {
    const restore = installSanitizer((html) => html);
    try {
        const md = renderer();
        expect(md.renderToHtml("**bold**", { inline: true })).not.toContain("<p>");
        expect(md.renderToHtml("**bold**")).toContain("<p>");
    } finally {
        restore();
    }
});

test("a caller allowlist is merged over the default, not ignored", () => {
    let seen = null;
    const restore = installSanitizer((html, config) => { seen = config; return html; });
    try {
        renderer().renderToHtml("**bold**", { sanitize: { allowedTags: ["b"] } });
        expect(seen.allowedTags).toEqual(["b"]);
        // Untouched keys still come from the module default.
        expect(seen.allowedSchemes).toContain("https");
    } finally {
        restore();
    }
});

test("region links survive parsing as fragment hrefs", () => {
    const restore = installSanitizer((html) => html);
    try {
        const html = renderer().renderToHtml("Explore [region 3.6](#xopat-region?viewer=viewer-1&x=45911&y=131490&w=6806&h=5616).");
        expect(html).toContain("#xopat-region?viewer=viewer-1");
        // No scheme, so it is not rewritten into an external link.
        expect(html).not.toContain('target="_blank"');
    } finally {
        restore();
    }
});
