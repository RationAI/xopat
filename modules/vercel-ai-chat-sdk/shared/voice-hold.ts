/**
 * When hands-free speech stops being an answer and starts being thinking out loud.
 *
 * The hands-free chat loop keeps one persistent microphone session open while the
 * assistant computes, queues completed turns, and submits them the instant the
 * reply lands. For a two-second reply that is exactly right. For a twenty-five
 * second tool-using reply it is not: the user has been muttering, correcting
 * themselves, or talking to a colleague, and all of it went out concatenated as
 * the next question — unseen, unreviewed, unasked-for.
 *
 * The fix is a HOLD: past a grace window, captured speech becomes a visible draft
 * in the composer instead of a submission, and only an explicit act (a keypress, a
 * click, or a spoken command) releases it. This module is the decision logic of
 * that hold, kept pure so it can be tested without a microphone, a DOM, or a model:
 *
 *  - `shouldHoldNow` — has the assistant been busy long enough that what is being
 *    said now is probably not addressed to it;
 *  - `matchHoldCommand` — is this whole utterance the user saying "send it".
 *
 * Pure module: no `window`, no Node globals, no i18next.
 */

/** Inputs of the grace rule. `busySince` is 0 when the assistant is idle. */
export interface HoldDecisionInput {
    /** Hands-free mode is on (hold is meaningless otherwise). */
    auto: boolean;
    /**
     * Transcript-only / dictation mode, which submits per segment into a transcript
     * rather than asking anything. There is no "assistant computing" to wait out, so
     * holding would only stall the dictation.
     */
    perSegment: boolean;
    /** When the assistant became busy (epoch ms), or 0 while idle. */
    busySince: number;
    /** Now (epoch ms). */
    now: number;
    /** Grace window; 0 disables holding entirely (legacy auto-submit). */
    busyHoldMs: number;
}

/**
 * True once speech should be held rather than queued for auto-submission.
 *
 * The clock starts when the ASSISTANT becomes busy, not when the user starts
 * talking: the question is "how long has this person been waiting", because that is
 * what predicts whether they have drifted off the topic they asked about.
 */
export function shouldHoldNow(input: HoldDecisionInput): boolean {
    const {auto, perSegment, busySince, now, busyHoldMs} = input || ({} as HoldDecisionInput);
    if (!auto || perSegment) return false;
    if (!(busyHoldMs > 0)) return false;
    if (!(busySince > 0)) return false;
    return (now - busySince) >= busyHoldMs;
}

/**
 * Fold an utterance to its comparable form: lowercase, no punctuation, single
 * spaces. Transcribers punctuate freely ("Send it." / "send it!" / "Send, it"), so
 * a spoken command has to be recognised through that, not around it.
 */
export function normalizeSpokenPhrase(text: string): string {
    return String(text || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .replace(/\s+/g, " ");
}

/**
 * Split a `|`-separated phrase list into normalized phrases.
 *
 * `raw` normally comes from a locale bundle, which is why the key is passed in:
 * before i18next initializes, `$.t` is a stub returning the key's last segment
 * (see AGENTS §3), and a missing key resolves to the key name itself. Treating
 * "autoModeConfirmPhrases" as something a person might say would arm a command
 * nobody can trigger and hide the missing translation, so an echoed key yields an
 * empty list instead.
 */
export function parsePhraseList(raw: string | string[] | undefined | null, key?: string): string[] {
    if (!raw) return [];
    const parts = Array.isArray(raw) ? raw : String(raw).split("|");
    const echo = key ? String(key).split(".").pop() : undefined;
    const out: string[] = [];
    for (const part of parts) {
        const phrase = normalizeSpokenPhrase(part);
        if (!phrase) continue;
        // The whole list being the bare key = an unresolved translation, not speech.
        if (key && (part === key || part === echo) && parts.length === 1) return [];
        out.push(phrase);
    }
    return out;
}

/** Spoken release commands, already normalized (see `parsePhraseList`). */
export interface HoldPhrases {
    confirm: string[];
    discard: string[];
}

/**
 * Classify an utterance as a hold-release command, or not a command at all.
 *
 * Matched on the WHOLE utterance only. A substring match would turn "send that to
 * the lab and tell me what you think" into a submission of the draft mid-sentence —
 * the false positive costs the user their words, while a missed command costs one
 * keypress. `confirm` is tested first so an ambiguous overlap sends rather than
 * destroys.
 */
export function matchHoldCommand(text: string, phrases: HoldPhrases): "confirm" | "discard" | null {
    const spoken = normalizeSpokenPhrase(text);
    if (!spoken) return null;
    if (phrases?.confirm?.includes(spoken)) return "confirm";
    if (phrases?.discard?.includes(spoken)) return "discard";
    return null;
}
