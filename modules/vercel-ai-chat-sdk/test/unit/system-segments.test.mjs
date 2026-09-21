/**
 * The system prompt has to stay CACHEABLE across the steps of one assistant loop.
 *
 * A single user message can drive many upstream calls, each re-sending the whole schema.
 * Provider prompt caches match on prefixes, so the prompt is ordered stable -> sticky ->
 * volatile and a breakpoint is placed where the content above it is expected to survive
 * unchanged. Without an explicit breakpoint nothing is cached at all and every step pays
 * full price for identical bytes — which is exactly the bug this suite guards.
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
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-system-segments-"));
const outfile = path.join(tmp, "system-segments.mjs");
await esbuild.build({
    entryPoints: [path.join(fromRoot(), "modules", "vercel-ai-chat-sdk", "shared", "system-segments.ts")],
    outfile,
    bundle: true,
    platform: "neutral",
    format: "esm",
    logLevel: "silent",
});
const {
    buildSystemInstructions,
    MAX_CACHE_BREAKPOINTS,
    RESERVED_CONVERSATION_BREAKPOINTS,
} = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const isMarked = (entry) => entry.providerOptions?.anthropic?.cacheControl?.type === "ephemeral";

/** Segmented is the interesting default; the unsegmented cases opt out explicitly. */
const build = (segs, segmented = true) => buildSystemInstructions(segs, { segmented });

/** The shape runTurn builds: stable prefix, sticky expansions, volatile live snapshot. */
const segments = ({ expanded = "", live = "viewer state v1" } = {}) => [
    { blocks: ["preamble", "api schema", "personality"], cache: true },
    { blocks: [expanded], cache: true },
    { blocks: [live], cache: false },
];

test("the stable and sticky segments are marked, the volatile one is not", { tag: ["@unit"] }, () => {
    const out = build(segments({ expanded: "expanded namespaces" }));

    expect(out).toHaveLength(3);
    expect(isMarked(out[0]), "stable prefix is cached").toBe(true);
    expect(isMarked(out[1]), "sticky expansions are cached").toBe(true);
    expect(isMarked(out[2]), "the live snapshot must never be cached").toBe(false);
});

test("a viewport change leaves the cached segments byte-identical", { tag: ["@unit"] }, () => {
    // THE property the whole change rests on. If a zoom could alter anything above the
    // last breakpoint, every step of the loop would re-write the cache instead of
    // reading it, and the schema would be billed in full every time.
    const before = build(segments({ expanded: "pathology", live: "magnification 20x" }));
    const after = build(segments({ expanded: "pathology", live: "magnification 40x" }));

    expect(after[0].content).toBe(before[0].content);
    expect(after[1].content).toBe(before[1].content);
    expect(after[2].content, "only the tail moves").not.toBe(before[2].content);
});

test("segmenting does not change the prompt text", { tag: ["@unit"] }, () => {
    // The separator has to survive a segment boundary, or this refactor would silently
    // reword the prompt and make any before/after comparison meaningless.
    const out = build(segments({ expanded: "expanded namespaces" }));
    const joined = out.map((entry) => entry.content).join("\n");

    expect(joined).toBe(
        "preamble\n---\napi schema\n---\npersonality\n"
        + "---\nexpanded namespaces\n"
        + "---\nviewer state v1"
    );
});

test("an empty segment is dropped rather than emitted blank", { tag: ["@unit"] }, () => {
    // A blank part would read as noise AND spend one of the four breakpoints on nothing.
    const out = build(segments({ expanded: "" }));

    expect(out).toHaveLength(2);
    expect(out[0].content).toContain("preamble");
    expect(out[1].content).toContain("viewer state v1");
    expect(isMarked(out[1]), "the volatile segment stays unmarked after the drop").toBe(false);
});

test("blank blocks inside a segment are dropped", { tag: ["@unit"] }, () => {
    const out = build([
        { blocks: ["a", "", null, undefined, "  ", "b"], cache: true },
    ]);

    expect(out[0].content).toBe("a\n---\nb");
});

test("a last-position segment is still worth a breakpoint", { tag: ["@unit"] }, () => {
    // The prefix continues into `messages`, so a breakpoint at the end of the system
    // prompt caches tools + system for the next call. Position must not disqualify it.
    const out = build([{ blocks: ["schema"], cache: true }]);

    expect(isMarked(out[0])).toBe(true);
});

test("breakpoints are capped, leaving room for the conversation tail", { tag: ["@unit"] }, () => {
    // Anthropic honours four and silently drops the rest; the message window spends one.
    const many = Array.from({ length: 8 }, (_, i) => ({ blocks: [`block ${i}`], cache: true }));

    const marked = build(many).filter(isMarked);

    expect(marked.length).toBe(MAX_CACHE_BREAKPOINTS - RESERVED_CONVERSATION_BREAKPOINTS);
});

test("nothing to say yields undefined, not an empty array", { tag: ["@unit"] }, () => {
    // The caller passes this straight to the SDK, which distinguishes the two.
    expect(build([{ blocks: ["", null], cache: true }])).toBeUndefined();
    expect(build([])).toBeUndefined();
});

test("each entry carries its own options object", { tag: ["@unit"] }, () => {
    // A shared bag would let one request's mutation leak into another's.
    const a = build(segments({ expanded: "x" }));
    const b = build(segments({ expanded: "x" }));

    expect(a[0].providerOptions).not.toBe(b[0].providerOptions);
    expect(a[0].providerOptions).not.toBe(a[1].providerOptions);
});

test("an unmergeable provider gets exactly ONE system message", { tag: ["@unit"] }, () => {
    // THE regression. An openai-compatible converter emits one `role: "system"` entry per
    // message, and a vLLM chat template accepts exactly one, at index 0 — three segments
    // failed the whole turn with "System message must be at the beginning."
    const out = build(segments({ expanded: "expanded namespaces" }), false);

    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("system");
});

test("the unsegmented prompt is byte-identical to the segmented one", { tag: ["@unit"] }, () => {
    // Splitting was only ever a transport detail. If the text differed, this fix would be
    // silently rewording every prompt sent to every non-Anthropic provider.
    const segs = segments({ expanded: "expanded namespaces" });
    const joined = build(segs, false)[0].content;
    const split = build(segs, true).map((entry) => entry.content).join("\n");

    expect(joined).toBe(split);
    expect(joined).toBe(
        "preamble\n---\napi schema\n---\npersonality\n"
        + "---\nexpanded namespaces\n"
        + "---\nviewer state v1"
    );
});

test("an unmergeable provider carries no cache breakpoint", { tag: ["@unit"] }, () => {
    // It could not honour one — a breakpoint needs the fold into a single system block — so
    // sending `providerOptions` would be noise on the wire.
    const out = build(segments({ expanded: "x" }), false);

    expect(out.some(isMarked)).toBe(false);
    expect(out[0].providerOptions).toBeUndefined();
});

test("emptiness still yields undefined when unsegmented", { tag: ["@unit"] }, () => {
    expect(build([{ blocks: ["", null], cache: true }], false)).toBeUndefined();
    expect(build([], false)).toBeUndefined();
});

test("entries are system-role, as the SDK requires of instructions", { tag: ["@unit"] }, () => {
    // `instructions` rejects anything else, and a non-system role would be pushed into
    // `messages` by the provider instead — a different request shape entirely.
    for (const entry of build(segments({ expanded: "x" }))) {
        expect(entry.role).toBe("system");
        expect(typeof entry.content).toBe("string");
    }
});
