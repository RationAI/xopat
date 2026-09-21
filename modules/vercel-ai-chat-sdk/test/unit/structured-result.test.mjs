/**
 * What a model actually receives when a script result does not fit the inline budget.
 *
 * The rule that matters: overflow drops whole FIELDS, never a character offset. Results
 * are ordered small-decisions-first, so an offset cut let one oversized field in the
 * middle take every field after it down with it — the short, decision-bearing tail
 * (`summary`, `warnings`, `budget`) never reached the model at all, while the big field
 * that displaced them was itself cut mid-token and useless to everyone.
 *
 * The source is TypeScript; it is transpiled with the esbuild the repo already depends
 * on (same approach as payload-slimming.test.mjs).
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
const sharedDir = path.join(fromRoot(), "modules", "vercel-ai-chat-sdk", "shared");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-structured-result-"));

const outfile = path.join(tmp, "structured-result.mjs");
await esbuild.build({
    entryPoints: [path.join(sharedDir, "structured-result.ts")],
    outfile,
    bundle: true,
    platform: "neutral",
    format: "esm",
    logLevel: "silent",
});
const { serializeStructuredResult, safeJsonString } = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const MAX = 2_000;
const opts = (getHandle) => ({ maxChars: MAX, getHandle });

/** A result shaped like a real one: small head, huge middle, small decision-bearing tail. */
function bigResult() {
    return {
        status: "ok",
        query: "is there carcinoma?",
        evidence: [{ id: "invasion", verdict: "yes" }],
        root: Array.from({ length: 200 }, (_, i) => ({
            index: i,
            label: `region ${i}`,
            findings: "Irregular glandular structures infiltrate a desmoplastic stroma. ".repeat(4),
        })),
        summary: "invasion: found (region 1, region 2)",
        warnings: ["Not every tissue region was surveyed before the budget ran out."],
        budget: { analyzeCalls: 28, truncated: false },
    };
}

test("a result that fits is returned whole and unannotated", { tag: ["@unit"] }, () => {
    const value = { status: "ok", regions: [1, 2, 3] };

    const out = serializeStructuredResult(value, opts(() => "res-1"));

    expect(out.complete).toBe(true);
    expect(out.omitted).toEqual([]);
    expect(JSON.parse(out.text)).toEqual(value);
});

test("the decision-bearing tail survives an oversized field in the middle", { tag: ["@unit"] }, () => {
    // THE regression. Under the old offset cut every one of these was lost, because
    // `root` overflowed the budget before the serializer ever reached them.
    const out = serializeStructuredResult(bigResult(), opts(() => "res-1"));

    expect(out.omitted).toContain("root");
    const body = JSON.parse(out.text.slice(0, out.text.indexOf("\n\n[")));
    expect(body.summary, "summary reaches the model").toBe("invasion: found (region 1, region 2)");
    expect(body.warnings, "warnings reach the model").toHaveLength(1);
    expect(body.budget, "budget reaches the model").toEqual({ analyzeCalls: 28, truncated: false });
    expect(body.status).toBe("ok");
    expect(body.evidence).toEqual([{ id: "invasion", verdict: "yes" }]);
});

test("kept fields are complete, not truncated", { tag: ["@unit"] }, () => {
    // The whole point of dropping fields instead of cutting text: whatever is present
    // can be trusted. A half-parsed field would be worse than an absent one.
    const out = serializeStructuredResult(bigResult(), opts(() => "res-1"));
    const body = JSON.parse(out.text.slice(0, out.text.indexOf("\n\n[")));

    expect(body.warnings[0]).toBe("Not every tissue region was surveyed before the budget ran out.");
});

test("an omitted field becomes a readable pointer", { tag: ["@unit"] }, () => {
    const out = serializeStructuredResult(bigResult(), opts(() => "res-42"));
    const body = JSON.parse(out.text.slice(0, out.text.indexOf("\n\n[")));

    expect(body.root.__omitted__.path).toBe("root");
    expect(body.root.__omitted__.chars).toBeGreaterThan(MAX);
    expect(body.root.__omitted__.read).toContain("res-42");
    expect(out.text, "and the note names the handle").toContain('handle "res-42"');
});

test("output stays within the budget", { tag: ["@unit"] }, () => {
    // The reserve exists so the pointers and the note cannot push the body back over.
    const out = serializeStructuredResult(bigResult(), opts(() => "res-1"));

    expect(out.text.length).toBeLessThanOrEqual(MAX);
});

test("no result store still degrades usefully", { tag: ["@unit"] }, () => {
    const out = serializeStructuredResult(bigResult(), opts(() => null));
    const body = JSON.parse(out.text.slice(0, out.text.indexOf("\n\n[")));

    expect(body.root.__omitted__.read, "no handle, so no read instruction").toBeUndefined();
    expect(body.summary, "the tail still survives without a store").toBeTruthy();
});

test("the handle is only minted when something overflows", { tag: ["@unit"] }, () => {
    // Parking a large value costs memory; a result that fits must never pay it.
    let calls = 0;
    serializeStructuredResult({ ok: true }, opts(() => { calls++; return "res-1"; }));
    expect(calls).toBe(0);

    serializeStructuredResult(bigResult(), opts(() => { calls++; return "res-1"; }));
    expect(calls).toBe(1);
});

test("arrays are handed back for text truncation rather than field-dropped", { tag: ["@unit"] }, () => {
    // An array's elements are peers with no decision-bearing tail, so a prefix of them
    // is a reasonable answer — and inventing field names for indices would not be.
    const out = serializeStructuredResult(Array.from({ length: 5_000 }, (_, i) => i), opts(() => "res-1"));

    expect(out.complete).toBe(false);
    expect(out.omitted).toEqual([]);
});

test("compact printing is what buys the budget back", { tag: ["@unit"] }, () => {
    // This budget used to be spent on pretty-printed JSON. The saving scales with
    // NESTING DEPTH and field count, not payload size — indentation is charged per
    // line, so a tree of many small fields (what an overview node actually is) pays
    // most and a flat blob of long strings pays least. Measured on the real pathology
    // fixture: 103 631 chars pretty vs 68 247 compact.
    const nested = {
        root: Array.from({ length: 12 }, (_, i) => ({
            index: i, depth: 0,
            bounds: { x: 12345, y: 23456, width: 3456, height: 2345 },
            center: { x: 14074, y: 24629 },
            magnification: 20, areaFraction: 0.123, cellularity: 0.457,
            verdict: { interest: 0.679, drill: true, confidence: "medium", resolvable: true },
            children: [{
                index: 100 + i, depth: 1,
                bounds: { x: 12345, y: 23456, width: 3456, height: 2345 },
                center: { x: 14074, y: 24629 },
                verdict: { interest: 0.679, drill: false, confidence: "low", resolvable: true },
            }],
        })),
    };

    expect(safeJsonString(nested).length).toBeLessThan(JSON.stringify(nested, null, 2).length * 0.8);
    // And it is never a loss, whatever the shape.
    expect(safeJsonString(bigResult()).length)
        .toBeLessThan(JSON.stringify(bigResult(), null, 2).length);
});

test("an unserializable value does not take the turn down", { tag: ["@unit"] }, () => {
    const circular = { name: "loop" };
    circular.self = circular;

    expect(() => serializeStructuredResult(circular, opts(() => "res-1"))).not.toThrow();
});
