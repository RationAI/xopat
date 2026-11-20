/**
 * Result presentation. Values come out of a script, so everything that becomes
 * markdown is escaped first — a cell holding a link or a tag reads as text.
 */
import { test, expect } from "@xopat/test-harness";
import { presentResult, escapeMarkdown, escapeHtml, previewResult } from "../../output.ts";

const labels = { key: "Name", value: "Value", truncated: (s, t) => `${s}/${t}` };

test("short scalars become a notification, nothing becomes 'done'", { tag: ["@unit"] }, () => {
    expect(presentResult("12 cells", "auto", labels)).toEqual({ kind: "toast", text: "12 cells" });
    expect(presentResult(42, "auto", labels)).toEqual({ kind: "toast", text: "42" });
    expect(presentResult(undefined, "auto", labels)).toEqual({ kind: "done" });
    expect(presentResult({ a: 1 }, "silent", labels)).toEqual({ kind: "none" });
});

test("flat object becomes an escaped key/value table", { tag: ["@unit"] }, () => {
    const p = presentResult({ "tumor|x": 3, "[x](javascript:alert(1))": 1 }, "auto", labels);
    expect(p.kind).toBe("markdown");
    expect(p.text.split("\n")[0]).toBe("| Name | Value |");
    expect(p.text).toContain("tumor\\|x");
    expect(p.text).toContain("\\[x\\]\\(javascript:alert\\(1\\)\\)");
});

test("array of flat objects becomes a table with the union of columns", { tag: ["@unit"] }, () => {
    const p = presentResult([{ cls: "a", n: 1 }, { cls: "b", area: 2.123456789 }], "auto", labels);
    const lines = p.text.split("\n");
    expect(lines[0]).toBe("| cls | n | area |");
    expect(lines[3]).toBe("| b |  | 2\\.12346 |");
});

test("long rows are truncated with a note", { tag: ["@unit"] }, () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ i }));
    const p = presentResult(rows, "auto", labels);
    expect(p.text).toContain("200/250");
});

test("nested values fall back to a fenced JSON block that cannot be escaped from", { tag: ["@unit"] }, () => {
    const p = presentResult({ nested: { s: "```" } }, "auto", labels);
    expect(p.text.startsWith("````json\n")).toBe(true);
    expect(p.text.endsWith("\n````")).toBe(true);
});

test("forced window keeps scalars as markdown, forced toast flattens objects", { tag: ["@unit"] }, () => {
    expect(presentResult("hi", "window", labels)).toEqual({ kind: "markdown", text: "hi" });
    expect(presentResult({ a: 1 }, "toast", labels)).toEqual({ kind: "toast", text: '{"a":1}' });
});

test("escapers", { tag: ["@unit"] }, () => {
    expect(escapeMarkdown("<img src=x>")).toBe("\\<img src=x\\>");
    expect(escapeHtml(`<a href="x">'`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;");
    expect(previewResult({ a: "x".repeat(5000) }).length).toBeLessThanOrEqual(2000);
});
