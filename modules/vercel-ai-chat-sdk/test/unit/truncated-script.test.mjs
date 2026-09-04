/**
 * Telling a CUT-OFF script apart from a CORRUPTED one.
 *
 * Both arrive with unbalanced brackets, so the census alone cannot separate them — and they need
 * opposite corrections. "Re-emit the SAME logic" is right for corruption and catastrophic for
 * truncation: the model re-emits the identical oversized script and it is cut at the same place,
 * every step, until the budget is gone. That is a real incident, not a hypothetical.
 *
 * The evidence that identifies truncation, pinned here:
 *   - only CLOSERS are missing (a mid-stream deletion loses openers too), and
 *   - the first imbalance is the OUTERMOST opener, i.e. the whole tail never arrived, and
 *   - a tool-call payload cut mid-string reports `truncated`, which must survive the rewrite into
 *     an ```xopat-script fence — a recovered prefix is otherwise indistinguishable from a whole
 *     script.
 *
 * The source is TypeScript; transpiled with the esbuild the repo already depends on (same
 * approach as structured-result.test.mjs).
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
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-truncated-script-"));

const build = async (name) => {
    const outfile = path.join(tmp, `${name}.mjs`);
    await esbuild.build({
        entryPoints: [path.join(sharedDir, `${name}.ts`)],
        outfile,
        bundle: true,
        platform: "neutral",
        format: "esm",
        logLevel: "silent",
    });
    return import(pathToFileURL(outfile).href);
};

const { bracketCensus, findScriptFence } = await build("script-text");
const { recoverToolEnvelopeToScriptFence, extractToolEnvelopeScripts } = await build("tool-envelope");

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** The incident shape: a nested questionnaire schema whose closing cascade never arrived. */
const WHOLE_SCRIPT = [
    "// Make sure we are working on the correct viewer",
    "await application.setActiveViewer('viewer-1');",
    "",
    "// Create the questionnaire",
    "await questionnaire.setSchema({",
    "  version: 1,",
    '  title: "Teaching Case (H&E)",',
    "  pages: [",
    "    {",
    '      title: "Background",',
    "      elements: [",
    "        {",
    '          kind: "content",',
    '          text: "PSA was elevated (7.8 ng/mL) at 1x overview."',
    "        }",
    "      ]",
    "    }",
    "  ]",
    "});",
].join("\n");

/**
 * Same script, cut part-way through the closing cascade — where an output budget runs out.
 *
 * Deliberately NOT cut before the first closer of each class: that would make whole classes
 * `vanished`, which is the separate, genuinely-corrupted verdict. The incident had closers of
 * every class present and merely fewer of them than openers.
 */
const TRUNCATED_SCRIPT = `${WHOLE_SCRIPT.split("\n").slice(0, 16).join("\n")}\n    `;

test("a whole script balances", () => {
    const census = bracketCensus(WHOLE_SCRIPT);
    expect(census.balanced).toBe(true);
    expect(census.firstImbalanceLine).toBe(null);
});

test("a tail-truncated script is missing only closers, blamed on the outermost opener", () => {
    const census = bracketCensus(TRUNCATED_SCRIPT);

    expect(census.balanced).toBe(false);
    // The signature that says "cut off", not "corrupted": every class has at least as many
    // openers as closers. A dropped chunk mid-body would strand closers too.
    expect(census.paren.open).toBeGreaterThan(census.paren.close);
    expect(census.square.open).toBeGreaterThan(census.square.close);
    expect(census.curly.open).toBeGreaterThan(census.curly.close);
    // Line 5 is `await questionnaire.setSchema({` — the outermost opener, and the line the
    // incident report blamed. Nothing on lines 1-4 is at fault.
    expect(census.firstImbalanceLine).toBe(5);
    // No closer class vanished entirely, so this is NOT classified as transport corruption.
    expect(census.vanished).toEqual([]);
});

test("a tool-call payload cut mid-string keeps its truncated flag through fence recovery", () => {
    const envelope =
        "<|tool_calls_section_begin|><|tool_call_begin|>functions.xopat-script:0" +
        '<|tool_call_argument_begin|>{"code": "await questionnaire.setSchema({\\n  pages: [';

    const [hit] = extractToolEnvelopeScripts(envelope);
    expect(hit?.truncated).toBe(true);
    expect(hit?.code).toContain("setSchema({");

    const recovered = recoverToolEnvelopeToScriptFence(envelope);
    expect(recovered.recovered).toBe(true);
    // The flag is the ONLY thing distinguishing this from a script the model finished: the
    // rewrite produces a well-formed fence either way.
    expect(recovered.truncated).toBe(true);
    expect(findScriptFence(recovered.text)?.body).toContain("setSchema({");
});

test("a complete tool-call payload is not flagged", () => {
    const envelope =
        "<|tool_calls_section_begin|><|tool_call_begin|>functions.xopat-script:0" +
        '<|tool_call_argument_begin|>{"code": "return 1;"}<|tool_call_end|><|tool_calls_section_end|>';

    expect(recoverToolEnvelopeToScriptFence(envelope).truncated).toBe(false);
    expect(extractToolEnvelopeScripts(envelope)[0]?.truncated).toBe(false);
});
