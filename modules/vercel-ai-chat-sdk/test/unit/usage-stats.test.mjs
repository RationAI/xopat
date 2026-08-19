/**
 * Token accounting for the usage readout.
 *
 * The two properties that decide whether the panel tells the truth:
 *
 *  1. A user message is summed across ALL the upstream calls its assistant loop makes
 *     (up to 21), not just the last one. A per-call figure would understate a slide
 *     exploration by an order of magnitude.
 *  2. "Not measured" and "measured zero" never render the same. A provider that reports
 *     no cache detail must not look like a cache that is failing — that distinction is
 *     the entire diagnostic value of the panel.
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
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-usage-stats-"));
const outfile = path.join(tmp, "usage-stats.mjs");
await esbuild.build({
    entryPoints: [path.join(fromRoot(), "modules", "vercel-ai-chat-sdk", "shared", "usage-stats.ts")],
    outfile,
    bundle: true,
    platform: "neutral",
    format: "esm",
    logLevel: "silent",
});
const {
    createSessionUsage,
    recordUsage,
    beginGroup,
    cacheHitRatio,
    snapshot,
} = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const AT = "2026-08-19T10:00:00.000Z";
/** One upstream call as the Anthropic path reports it. */
const call = (over = {}) => ({
    inputTokens: 57_000,
    outputTokens: 400,
    totalTokens: 57_400,
    noCacheTokens: 5_400,
    cacheReadTokens: 51_600,
    cacheWriteTokens: 0,
    ...over,
});

test("a message sums every call of its loop", { tag: ["@unit"] }, () => {
    // THE point of the feature. One step's numbers are not what a user spent.
    const state = createSessionUsage();
    beginGroup(state);
    for (let i = 0; i < 5; i++) recordUsage(state, call(), AT);

    expect(state.lastMessage.calls).toBe(5);
    expect(state.lastMessage.inputTokens).toBe(285_000);
    expect(state.lastMessage.outputTokens).toBe(2_000);
    expect(state.session.inputTokens).toBe(285_000);
});

test("a new message resets the message bucket but not the session", { tag: ["@unit"] }, () => {
    const state = createSessionUsage();
    beginGroup(state);
    recordUsage(state, call(), AT);
    beginGroup(state);
    recordUsage(state, call(), AT);

    expect(state.lastMessage.calls, "only the second message's calls").toBe(1);
    expect(state.session.calls, "both messages' calls").toBe(2);
    expect(state.messages).toBe(2);
});

test("a message that produces no usage is still counted", { tag: ["@unit"] }, () => {
    // An immediate error still consumed a user's attempt; showing 0 messages after they
    // sent three would read as the counter being broken.
    const state = createSessionUsage();
    beginGroup(state);
    beginGroup(state);

    expect(state.messages).toBe(2);
    expect(state.session.calls).toBe(0);
});

test("cache hit rate is the share of prompt tokens served from cache", { tag: ["@unit"] }, () => {
    const state = createSessionUsage();
    beginGroup(state);
    // 51 600 of 57 000 prompt tokens cached.
    recordUsage(state, call(), AT);

    const ratio = cacheHitRatio(state.lastMessage);
    expect(Math.round(ratio * 100)).toBe(91);
});

/**
 * The exact object `@ai-sdk/openai-compatible` hands back when the backend was never asked
 * for usage (`createNullLanguageModelUsage`): a real response, every field undefined. This
 * shipped a panel reading "Input 0" beside 9 real requests.
 */
const nullUsage = () => ({
    inputTokens: undefined,
    outputTokens: undefined,
    totalTokens: undefined,
    noCacheTokens: undefined,
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
});

test("a silent provider counts the call but reports no tokens", { tag: ["@unit"] }, () => {
    // THE regression. The call is real and must be counted; the tokens are unknown and must
    // not be rendered as zero.
    const state = createSessionUsage();
    beginGroup(state);
    recordUsage(state, nullUsage(), AT);
    recordUsage(state, nullUsage(), AT);

    expect(state.session.calls, "the requests happened").toBe(2);
    expect(state.session.hasTokenDetail, "but nothing was reported").toBe(false);
    expect(state.session.hasCacheDetail).toBe(false);
});

test("a reporting provider sets hasTokenDetail", { tag: ["@unit"] }, () => {
    const state = createSessionUsage();
    beginGroup(state);
    recordUsage(state, call(), AT);

    expect(state.session.hasTokenDetail).toBe(true);
});

test("a reported zero counts as reported", { tag: ["@unit"] }, () => {
    // "The model was called and used 0 tokens" is a measurement; "we were never told" is
    // not. Truthiness would collapse them, so the check is on the number being present.
    const state = createSessionUsage();
    beginGroup(state);
    recordUsage(state, { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, AT);

    expect(state.session.hasTokenDetail).toBe(true);
});

test("a silent provider does not accumulate a derived total", { tag: ["@unit"] }, () => {
    // Deriving input+output from a silent provider would manufacture a 0 that looks
    // measured — the same lie in a different column.
    const state = createSessionUsage();
    beginGroup(state);
    recordUsage(state, nullUsage(), AT);

    expect(state.session.totalTokens).toBe(0);
    expect(state.session.hasTokenDetail).toBe(false);
});

test("a provider that reports no cache detail yields null, not zero", { tag: ["@unit"] }, () => {
    // The distinction the whole panel rests on: an openai-compatible backend reporting
    // nothing must not look like a broken cache.
    const state = createSessionUsage();
    beginGroup(state);
    recordUsage(state, { inputTokens: 100, outputTokens: 10, totalTokens: 110 }, AT);

    expect(state.lastMessage.hasCacheDetail).toBe(false);
    expect(cacheHitRatio(state.lastMessage)).toBeNull();
});

test("a measured zero is reported as zero, not as unknown", { tag: ["@unit"] }, () => {
    // The complement of the test above — and the actually-actionable finding: caching is
    // configured, nothing is hitting, something invalidates the prefix.
    const state = createSessionUsage();
    beginGroup(state);
    recordUsage(state, call({ cacheReadTokens: 0, noCacheTokens: 57_000, cacheWriteTokens: 0 }), AT);

    expect(state.lastMessage.hasCacheDetail).toBe(true);
    expect(cacheHitRatio(state.lastMessage)).toBe(0);
});

test("nothing recorded yields null rather than a division by zero", { tag: ["@unit"] }, () => {
    expect(cacheHitRatio(createSessionUsage().session)).toBeNull();
});

test("missing and malformed fields never produce NaN", { tag: ["@unit"] }, () => {
    // These numbers go straight to a user-facing panel; one NaN there is worse than a
    // missing row, and the wire is not ours to trust.
    const state = createSessionUsage();
    beginGroup(state);
    recordUsage(state, {}, AT);
    recordUsage(state, { inputTokens: undefined, outputTokens: null, totalTokens: "nonsense" }, AT);
    recordUsage(state, { inputTokens: -5, outputTokens: Number.NaN }, AT);

    for (const [key, value] of Object.entries(state.session)) {
        if (typeof value === "number") expect(Number.isFinite(value), key).toBe(true);
    }
    expect(state.session.inputTokens).toBe(0);
});

test("a total is derived when the provider omits one", { tag: ["@unit"] }, () => {
    // Otherwise the panel shows a zero total beside non-zero input and output.
    const state = createSessionUsage();
    beginGroup(state);
    recordUsage(state, { inputTokens: 100, outputTokens: 25 }, AT);

    expect(state.lastMessage.totalTokens).toBe(125);
});

test("a null usage is ignored rather than counted as a call", { tag: ["@unit"] }, () => {
    const state = createSessionUsage();
    beginGroup(state);
    recordUsage(state, null, AT);
    recordUsage(state, undefined, AT);

    expect(state.session.calls).toBe(0);
});

test("a snapshot cannot be used to mutate live accounting", { tag: ["@unit"] }, () => {
    const state = createSessionUsage();
    beginGroup(state);
    recordUsage(state, call(), AT);

    const snap = snapshot(state);
    snap.session.inputTokens = 0;
    snap.lastMessage.calls = 99;

    expect(state.session.inputTokens).toBe(57_000);
    expect(state.lastMessage.calls).toBe(1);
});
