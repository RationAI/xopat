/**
 * `modules/vercel-ai-chat-sdk/shared/script-text.ts` + `shared/tool-envelope.ts` — regression suite.
 *
 * These two modules decide what text reaches the scripting runtime. Every bug they have had is
 * silent: a lazy regex ends a fence at the first inner triple-backtick, or ends a JSON `"code"`
 * value at the first escaped quote, and the runtime then compiles a HALF script and reports a
 * syntax error describing code the model never wrote. The model, seeing nothing wrong on its
 * side, re-emits the same bytes until the retry budget is gone.
 *
 * The census cases pin the other half: naming WHICH bracket class vanished is what lets the host
 * tell a transport fault from a model mistake without hardcoding anything per provider.
 *
 * TypeScript sources, transpiled with the esbuild the repo already depends on. No new dependency.
 *
 * Run: npm run test:chat-parsing
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fromRoot } from "@xopat/test-harness/paths";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = fromRoot();
const sharedDir = path.join(repoRoot, "modules", "vercel-ai-chat-sdk", "shared");

let failed = 0;
let n = 0;
function ok(name, cond, detail) {
    n++;
    if (cond) {
        console.log(`ok ${n} - ${name}`);
    } else {
        failed++;
        console.log(`not ok ${n} - ${name}${detail ? `\n  ${detail}` : ""}`);
    }
}

const tmp = mkdtempSync(path.join(tmpdir(), "xopat-script-text-"));
let scriptText;
let toolEnvelope;
try {
    const esbuild = require("esbuild");
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
    scriptText = await build("script-text");
    toolEnvelope = await build("tool-envelope");
} catch (e) {
    ok("the shared parsers transpile and import", false, String(e?.message || e));
    console.log(`\n# ${failed} of ${n} FAILED`);
    rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
}

const { bracketCensus, describeCensusDamage, findScriptFence, hasCompleteScriptFence, numberedExcerpt } = scriptText;
const { readToolPayloadCode, readCodeFromToolPayload, recoverToolEnvelopeToScriptFence } = toolEnvelope;

// ── census ─────────────────────────────────────────────────────────────────
{
    // The observed transport failure: every `]` gone.
    const damaged = "const shaders = getShaders();\nconst def = shaders[type;\nconst list = def['x' || [;\n";
    const census = bracketCensus(damaged);
    ok("census counts openers and closers per kind",
        census.square.open === 3 && census.square.close === 0,
        JSON.stringify(census.square));
    ok("census reports the vanished closer class",
        census.vanished.length === 1 && census.vanished[0] === "]",
        JSON.stringify(census.vanished));
    ok("census is not balanced when a class vanished", census.balanced === false);
    ok("census points at the first unclosed opener",
        census.firstImbalanceLine === 2, String(census.firstImbalanceLine));
    ok("the damage description names the missing character",
        /every `\]` is missing/.test(describeCensusDamage(census) || ""),
        describeCensusDamage(census));

    const clean = bracketCensus("const a = [1, 2].map((x) => ({ x }));");
    ok("a well-formed script is balanced with nothing vanished",
        clean.balanced === true && clean.vanished.length === 0 && clean.firstImbalanceLine === null);

    const stray = bracketCensus("const a = 1;\n}\n");
    ok("a stray closer is located, not silently clamped",
        stray.balanced === false && stray.firstImbalanceLine === 2, JSON.stringify(stray));
}

// ── fence extraction ───────────────────────────────────────────────────────
{
    const withInnerFence = [
        "Here you go:",
        "```xopat-script",
        "const md = `see ``` fenced code ``` above`;",
        "return { md };",
        "```",
        "Done.",
    ].join("\n");

    const fence = findScriptFence(withInnerFence);
    ok("a fence survives triple-backticks inside a template literal",
        !!fence && fence.terminated && fence.balanced && fence.body.includes("return { md };"),
        JSON.stringify(fence));
    ok("prose after the fence is not swallowed",
        !!fence && !fence.body.includes("Done."));

    const unterminated = "```xopat-script\nconst a = viewer.getViewport();\nreturn a;";
    const cut = findScriptFence(unterminated);
    ok("an unterminated fence is reported as such, body preserved",
        !!cut && cut.terminated === false && cut.body.includes("return a;"),
        JSON.stringify(cut));

    ok("the streaming early-exit does not fire on an unbalanced body",
        hasCompleteScriptFence("```xopat-script\nconst d = shaders[type;\n```") === false);
    ok("the streaming early-exit fires on a complete, consistent fence",
        hasCompleteScriptFence("```xopat-script\nreturn viewer.getViewport();\n```") === true);

    const generic = findScriptFence("```js\nreturn 1;\n```");
    ok("a generic code fence is the documented fallback",
        !!generic && generic.tag === "js" && generic.body === "return 1;");
}

// ── tool-call payload extraction ───────────────────────────────────────────
{
    const withBraces = '{"code": "const a = {b: 1}; return a;"}';
    ok("a payload whose code contains `}` is not truncated at the first brace",
        readCodeFromToolPayload(withBraces) === "const a = {b: 1}; return a;",
        readCodeFromToolPayload(withBraces));

    // Invalid JSON (a raw newline in the string) forces the fallback reader, which is where the
    // quote-unaware regex used to cut the value at the first escaped quote.
    const brokenJson = '{"code": "const s = \\"a\\", t = [1,2];\nreturn t;"}';
    const recovered = readToolPayloadCode(brokenJson);
    ok("the fallback reader honours escaped quotes inside the code",
        !!recovered && recovered.code.includes("t = [1,2];") && recovered.truncated === false,
        JSON.stringify(recovered));

    const truncated = '{"code": "const a = 1;\nreturn';
    const partial = readToolPayloadCode(truncated);
    ok("a payload cut mid-value yields a prefix flagged as truncated",
        !!partial && partial.truncated === true && partial.code.startsWith("const a = 1;"),
        JSON.stringify(partial));

    ok("valid JSON without a code field is not a script call",
        readToolPayloadCode('{"other": 1}') === undefined);

    const envelope =
        '<|tool_calls_section_begin|><|tool_call_begin|>functions.xopat-script:0' +
        '<|tool_call_argument_begin|>{"code": "const a = {b: 1};\\nreturn a;"}<|tool_call_end|>' +
        '<|tool_calls_section_end|>';
    const rec = recoverToolEnvelopeToScriptFence(envelope);
    ok("a native tool-call envelope is rewritten as a complete fence",
        rec.recovered === true && /```xopat-script/.test(rec.text) && rec.text.includes("return a;"),
        rec.text);
    const recFence = findScriptFence(rec.text);
    ok("the recovered fence extracts back to the whole script",
        !!recFence && recFence.balanced && recFence.body === "const a = {b: 1};\nreturn a;",
        JSON.stringify(recFence));
}

// ── excerpt ────────────────────────────────────────────────────────────────
{
    const excerpt = numberedExcerpt("a\nb\nc");
    ok("the excerpt is line-numbered and verbatim",
        excerpt === "1 | a\n2 | b\n3 | c", JSON.stringify(excerpt));

    const long = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");
    const windowed = numberedExcerpt(long, { aroundLine: 100, radius: 2, maxChars: 200 });
    ok("a long script is windowed around the reported break",
        windowed.includes("100 | line 100") && !windowed.includes("line 1\n"), windowed);
}

rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n# ${failed} of ${n} FAILED` : `\n# all ${n} checks passed`);
process.exit(failed ? 1 : 0);
