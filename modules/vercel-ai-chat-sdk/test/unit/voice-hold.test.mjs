/**
 * When hands-free speech stops counting as an answer.
 *
 * The chat's voice loop keeps the microphone open while the assistant computes and
 * used to submit everything it heard the moment the reply landed. On a long reply
 * that meant the user's muttering, corrections and side conversation went out
 * concatenated as the next question. `shared/voice-hold.ts` is the decision layer
 * that stops it, and the two things it decides are exactly the two things that are
 * expensive to get wrong:
 *
 *  - hold too eagerly and every quick reply costs an extra keypress;
 *  - match a spoken command too loosely and dictating "send that to the lab" fires
 *    off a half-finished draft.
 *
 * The source is TypeScript; it is transpiled with the esbuild the repo already
 * depends on (same approach as test/unit/payload-slimming.test.mjs).
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharedDir = path.join(fromRoot(), "modules", "vercel-ai-chat-sdk", "shared");

const tmp = mkdtempSync(path.join(tmpdir(), "xopat-voice-hold-"));
const esbuild = require("esbuild");

async function loadShared(name) {
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
}

const { shouldHoldNow, matchHoldCommand, parsePhraseList, normalizeSpokenPhrase } =
    await loadShared("voice-hold");

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const busy = (overrides = {}) => ({
    auto: true,
    perSegment: false,
    busySince: 1_000_000,
    now: 1_000_000,
    busyHoldMs: 4000,
    ...overrides,
});

test("speech within the grace window is still part of the question", { tag: ["@unit"] }, () => {
    // "…and also the stroma", said two seconds after asking, belongs to the ask.
    expect(shouldHoldNow(busy({ now: 1_002_000 })), "2 s into a reply").toBe(false);
    expect(shouldHoldNow(busy({ now: 1_003_999 })), "just under the window").toBe(false);
});

test("speech past the grace window is held", { tag: ["@unit"] }, () => {
    expect(shouldHoldNow(busy({ now: 1_004_000 })), "exactly at the window").toBe(true);
    expect(shouldHoldNow(busy({ now: 1_030_000 })), "half a minute of waiting").toBe(true);
});

test("an idle assistant never holds", { tag: ["@unit"] }, () => {
    // busySince 0 is the idle marker; without it a fresh utterance would be held
    // against a clock that never started.
    expect(shouldHoldNow(busy({ busySince: 0, now: 9_999_999 }))).toBe(false);
});

test("holding is off for transcript-only dictation and when disabled", { tag: ["@unit"] }, () => {
    // Dictation submits per segment into a transcript — there is no assistant turn
    // to wait out, so a hold would only stall it.
    expect(shouldHoldNow(busy({ now: 1_030_000, perSegment: true })), "transcript-only").toBe(false);
    expect(shouldHoldNow(busy({ now: 1_030_000, busyHoldMs: 0 })), "0 = legacy auto-submit").toBe(false);
    expect(shouldHoldNow(busy({ now: 1_030_000, auto: false })), "not hands-free").toBe(false);
});

test("a spoken command is recognised through transcriber punctuation", { tag: ["@unit"] }, () => {
    const phrases = { confirm: parsePhraseList("send|send it"), discard: parsePhraseList("scratch that") };
    expect(matchHoldCommand("Send it.", phrases)).toBe("confirm");
    expect(matchHoldCommand("  send   IT  ", phrases)).toBe("confirm");
    expect(matchHoldCommand("Scratch that!", phrases)).toBe("discard");
});

test("only a WHOLE utterance is a command", { tag: ["@unit"] }, () => {
    // The false positive costs the user their words; a missed command costs one
    // keypress. So dictation that merely contains the phrase stays dictation.
    const phrases = { confirm: parsePhraseList("send|send it"), discard: parsePhraseList("scratch that") };
    expect(matchHoldCommand("send that to the lab and tell me what you think", phrases)).toBe(null);
    expect(matchHoldCommand("I'll scratch that idea later", phrases)).toBe(null);
    expect(matchHoldCommand("", phrases)).toBe(null);
});

test("an unresolved translation key is not a phrase anybody can say", { tag: ["@unit"] }, () => {
    // Before i18next initializes, $.t returns the key's last segment, and a missing
    // key resolves to the key itself. Arming "autoModeConfirmPhrases" as a command
    // would hide the missing translation behind a command nobody can trigger.
    expect(parsePhraseList("autoModeConfirmPhrases", "autoModeConfirmPhrases")).toEqual([]);
    expect(parsePhraseList("chat.voice.confirmPhrases", "chat.voice.confirmPhrases")).toEqual([]);
    expect(parsePhraseList("confirmPhrases", "chat.voice.confirmPhrases"), "the stub's last segment").toEqual([]);
    expect(parsePhraseList("send|send it", "autoModeConfirmPhrases")).toEqual(["send", "send it"]);
});

test("normalization folds case, punctuation and spacing", { tag: ["@unit"] }, () => {
    expect(normalizeSpokenPhrase("  Send,  it!  ")).toBe("send it");
    expect(normalizeSpokenPhrase("…")).toBe("");
    expect(normalizeSpokenPhrase(undefined)).toBe("");
});
