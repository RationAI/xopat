/**
 * The overview result has to stay READABLE by a model that does not receive all of it.
 *
 * A script's return value is inlined into the model's next turn up to a fixed character
 * budget; anything past that is replaced by a handle it must spend a round-trip to read.
 * Overflow drops whole FIELDS (see `vercel-ai-chat-sdk/shared/structured-result.ts`), so
 * **key order still decides what survives** — a field only gets dropped once the budget
 * is already spent on the fields before it. What has to survive is region coordinates,
 * because those are the only thing that lets the assistant emit a clickable region link.
 *
 * This is a regression suite for two real failures:
 *  1. The node tree was serialized first, so `evidence` / `ranked` never reached the
 *     model. It could see only the coarse island boxes it is told never to link, so it
 *     described regions in prose with no way for the user to find them.
 *  2. Truncation was a character-offset cut, so the oversized `root` tree in the middle
 *     also took `summary`, `warnings` and `budget` down with it — the caveats the user
 *     is supposed to be told about were silently unreachable.
 *
 * The assertions run against the REAL serializer rather than a local imitation of it,
 * so this suite fails if that contract changes underneath the module.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadLib, cleanupLib } from "../load-lib.mjs";

const { forPresentation, MAX_FINDINGS_CHARS } = await loadLib("presentation");

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-overview-inline-"));
const serializerOut = path.join(tmp, "structured-result.mjs");
await esbuild.build({
    entryPoints: [path.join(fromRoot(), "modules", "vercel-ai-chat-sdk", "shared", "structured-result.ts")],
    outfile: serializerOut,
    bundle: true,
    platform: "neutral",
    format: "esm",
    logLevel: "silent",
});
const { serializeStructuredResult } = await import(pathToFileURL(serializerOut).href);

test.afterAll(() => {
    cleanupLib();
    rmSync(tmp, { recursive: true, force: true });
});

/**
 * The chat SDK's inline budget, in characters of compact JSON.
 * Kept in step with `SCRIPT_RESULT_MAX_CHARS` in `modules/vercel-ai-chat-sdk/chat.ts`.
 */
const SCRIPT_RESULT_MAX_CHARS = 24_000;

const FEATURES = ["invasion", "atypia", "necrosis", "mitoses", "architecture"];

/**
 * Prose long enough to exercise the cap — a vision model asked to describe a field is
 * routinely more verbose than the budget a per-region summary can afford.
 */
const FINDINGS = "Irregular glandular structures infiltrate a desmoplastic stroma, with "
    + "loss of the normal lobular architecture and scattered single cells at the advancing "
    + "edge. Nuclei are enlarged and pleomorphic with coarse chromatin and occasional "
    + "prominent nucleoli. No definite necrosis is identified in this field, and the "
    + "surrounding tissue shows a mild chronic inflammatory infiltrate. Occasional mitotic "
    + "figures are seen, though none are clearly atypical at this magnification. The "
    + "adjacent parenchyma appears uninvolved, with preserved ductal structures and no "
    + "evidence of intraductal extension in the plane examined here.";

let seq = 0;
function node(depth = 0, children = []) {
    const i = ++seq;
    return {
        index: i, label: `region ${i}`, depth,
        // Unrounded floats, as the engine produces them.
        bounds: { x: 12345.678901234567, y: 23456.789012345678, width: 3456.7890123456789, height: 2345.678901234567 },
        center: { x: 14074.123456789012, y: 24629.628456789012 },
        magnification: 20.000000000000004,
        areaFraction: 0.12345678901234568, slideAreaFraction: 0.023456789012345678,
        bboxFillFraction: 0.6789012345678901, cellularity: 0.4567890123456789,
        fieldOfViewUm: { width: 864.1972530864197, height: 586.4197253086419 },
        renderedMpp: 0.5000000000000001, requestedMpp: 0.5, deliveredMpp: 0.5000000000000001,
        findings: FINDINGS,
        answers: Object.fromEntries(FEATURES.map(id => [id, {
            id, answer: "Present focally at the advancing edge of the lesion.",
            present: "uncertain", confidence: "medium",
        }])),
        interest: 0.6789012345678901,
        verdict: { interest: 0.6789012345678901, drill: true, confidence: "medium", resolvable: true, source: "contract" },
        rankScore: 0.34567890123456789,
        decision: "drill", isComplete: true,
        rootId: `r${i}`, path: [i], ancestorInterests: [0.5432109876543211],
        children,
    };
}

/** A result the size a real run produces: 12 survey roots, each with a drilled child. */
function overviewResult() {
    seq = 0;
    const roots = Array.from({ length: 12 }, () => node(0, [node(1)]));
    const flat = roots.flatMap(r => [r, ...r.children]);
    return {
        status: "ok", driver: "medgemma", query: "is there carcinoma, and is it invasive?",
        context: { stain: "H&E", stainClass: "histochemical", organ: "breast", source: "explicit" },
        slide: { width: 60000, height: 40000, micronsPerPixel: 0.25, magnification: 40 },
        slideCoverage: 0.4321098765432109, coverageScope: "whole-slide", isComplete: true,
        checklist: {
            features: FEATURES.map(id => ({
                id, label: id, question: `Is ${id} present in this field of view?`,
                requiredMpp: 0.5, weight: 1,
            })),
            source: "derived", query: "is there carcinoma, and is it invasive?", hash: "deadbeef",
        },
        evidence: FEATURES.map(id => ({
            id, label: id, question: `Is ${id} present in this field of view?`, requiredMpp: 0.5,
            verdict: "yes", counts: { yes: 3, no: 1, uncertain: 2, notAssessable: 0 },
            citedBy: flat.slice(0, 5).map(n => ({
                label: n.label, bounds: n.bounds,
                answer: "Present focally at the advancing edge of the lesion.",
                confidence: "medium", deliveredMpp: n.deliveredMpp,
            })),
            underResolved: false,
        })),
        // Childless, as `_rankOverviewNodes` now returns them.
        ranked: flat.slice(0, 12).map(n => ({ ...n, children: [] })),
        summary: FEATURES.map(id => `${id}: found (region 1, region 2)`).join("\n"),
        cancelled: false,
        warnings: ["Not every tissue region was surveyed before the budget ran out."],
        builtAtIso: "2026-08-19T00:00:00.000Z",
        budget: { analyzeCalls: 28, repairCalls: 1, nodesVisited: 24, truncated: false, surveyCalls: 10, focusCalls: 18 },
        root: roots,
    };
}

const pretty = (v) => JSON.stringify(v, null, 2);
/** What the model actually receives when the value overflows the inline budget. */
const inlined = (v) => serializeStructuredResult(v, {
    maxChars: SCRIPT_RESULT_MAX_CHARS,
    getHandle: () => "res-test",
});
const inlineHead = (v) => inlined(v).text;
/** The JSON body, with the trailing human-readable note stripped off. */
const inlineBody = (v) => {
    const text = inlineHead(v);
    const note = text.indexOf("\n\n[");
    return JSON.parse(note === -1 ? text : text.slice(0, note));
};

test("the inline head carries region coordinates a link can be built from", { tag: ["@unit"] }, () => {
    // THE regression. Without coordinates in the head the assistant cannot emit a region
    // link at all, and the user is told about a region with no way to go and see it.
    const head = inlineHead(forPresentation(overviewResult()));

    const bounds = head.match(/"bounds":\s*\{\s*"x":\s*(-?\d+)[\s\S]*?"height":\s*(-?\d+)/);
    expect(bounds, "at least one complete bounds survives the cut").not.toBeNull();
    expect(Number.isFinite(Number(bounds[1]))).toBe(true);
});

test("evidence and ranked both survive the cut", { tag: ["@unit"] }, () => {
    const head = inlineHead(forPresentation(overviewResult()));

    expect(head, "the primary output must be visible without a round-trip").toContain('"evidence"');
    expect(head).toContain('"ranked"');
    expect(head).toContain('"checklist"');
});

test("the caveats survive too, and whole", { tag: ["@unit"] }, () => {
    // Regression 2: these sit AFTER the node tree, so an offset cut lost every one of
    // them. `warnings` in particular is what the user is told when part of the tissue
    // was never looked at — losing it silently turns a gap into an implied negative.
    const body = inlineBody(forPresentation(overviewResult()));

    expect(body.warnings, "warnings reach the model").toEqual([
        "Not every tissue region was surveyed before the budget ran out.",
    ]);
    expect(body.summary, "summary reaches the model").toContain("invasion");
    expect(body.budget.analyzeCalls, "budget reaches the model").toBe(28);
    expect(body.builtAtIso).toBe("2026-08-19T00:00:00.000Z");
});

test("the node tree is what gets dropped, and says how to read it", { tag: ["@unit"] }, () => {
    const out = inlined(forPresentation(overviewResult()));
    const body = inlineBody(forPresentation(overviewResult()));

    expect(out.omitted, "root is the only field big enough to lose").toContain("root");
    expect(body.root.__omitted__.path).toBe("root");
    expect(body.root.__omitted__.read).toContain("readScriptResult");
});

test("the inlined result respects the budget", { tag: ["@unit"] }, () => {
    expect(inlineHead(forPresentation(overviewResult())).length)
        .toBeLessThanOrEqual(SCRIPT_RESULT_MAX_CHARS);
});

test("the node tree is serialized last", { tag: ["@unit"] }, () => {
    // Key order is what makes the assertions above hold for a result of ANY size.
    const keys = Object.keys(overviewResult());

    expect(keys.at(-1)).toBe("root");
    for (const before of ["checklist", "evidence", "ranked", "warnings", "budget"]) {
        expect(keys.indexOf(before), `${before} precedes root`).toBeLessThan(keys.indexOf("root"));
    }
});

test("ranked entries carry no children", { tag: ["@unit"] }, () => {
    // `ranked` holds the same nodes `root` does. Leaving `children` on them makes
    // JSON.stringify re-serialize whole subtrees — several times the whole budget.
    const result = forPresentation(overviewResult());

    for (const r of result.ranked) expect(r.children, r.label).toEqual([]);
});

test("dropping the duplicated subtrees is a large, measurable saving", { tag: ["@unit"] }, () => {
    const result = overviewResult();
    const withChildren = { ...result, ranked: result.ranked.map((r, i) => ({ ...r, children: result.root[i].children })) };

    expect(pretty(result).length).toBeLessThan(pretty(withChildren).length * 0.8);
});

test("bounds are whole pixels, as a region link requires", { tag: ["@unit"] }, () => {
    const result = forPresentation(overviewResult());

    for (const key of ["x", "y", "width", "height"]) {
        expect(Number.isInteger(result.ranked[0].bounds[key]), `bounds.${key}`).toBe(true);
        expect(Number.isInteger(result.evidence[0].citedBy[0].bounds[key]), `citedBy bounds.${key}`).toBe(true);
    }
    expect(Number.isInteger(result.ranked[0].center.x)).toBe(true);
});

test("scales and ratios are shortened but not destroyed", { tag: ["@unit"] }, () => {
    const result = forPresentation(overviewResult());

    // µm/px on a 40x scan is ~0.25 — rounding it to whole numbers would zero it, and the
    // prompt quotes this figure to the vision model.
    expect(result.ranked[0].deliveredMpp).toBe(0.5);
    expect(result.slide.micronsPerPixel).toBe(0.25);
    expect(result.ranked[0].interest).toBe(0.679);
    expect(result.slideCoverage).toBe(0.432);
});

test("prose is capped", { tag: ["@unit"] }, () => {
    const result = forPresentation(overviewResult());

    expect(result.root[0].findings.length).toBeLessThanOrEqual(MAX_FINDINGS_CHARS + 1);
    expect(result.root[0].findings, "a cut is marked, not silent").toMatch(/…$/);
});

test("the projection never mutates the cached result", { tag: ["@unit"] }, () => {
    // The input IS the cached overview; mutating it would degrade every later read of the
    // same slide, and silently, because the cache is what `getOverview()` hands back.
    const result = overviewResult();
    const before = pretty(result);

    forPresentation(result);

    expect(pretty(result)).toBe(before);
});

test("a short result is passed through unharmed", { tag: ["@unit"] }, () => {
    const small = { status: "ok", regions: [{ label: "region 1", bounds: { x: 1.4, y: 2.6, width: 3, height: 4 } }] };

    expect(forPresentation(small)).toEqual({
        status: "ok", regions: [{ label: "region 1", bounds: { x: 1, y: 3, width: 3, height: 4 } }],
    });
});

test("non-plain values are passed through rather than rebuilt", { tag: ["@unit"] }, () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const out = forPresentation({ values: bytes, when: "2026-01-01" });

    expect(out.values, "a typed array must not be turned into an object").toBe(bytes);
});
