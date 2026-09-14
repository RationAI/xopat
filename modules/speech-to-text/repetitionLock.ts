/**
 * Breaking a recognizer's self-reinforcing repetition.
 *
 * Continuous dictation biases each segment with the tail of what has already been
 * transcribed (`_composePrompt`), because a segment decoded blind mis-hears domain
 * vocabulary. That tail is a feedback path: whatever the model emits becomes the bias
 * for the next segment, so a prompt-obedient model that re-emits its own tail
 * reinforces itself, and each round the bias is more concentrated than the last. One
 * 450 s dictation came back as "I'm not the" for ten consecutive segments while the
 * whole-audio pass over the SAME audio read as ordinary speech.
 *
 * Length cannot tell an echo from a real repeat — `_stripPromptEcho` deliberately
 * ignores anything under 25 chars so a pathologist saying one glossary term keeps it,
 * and "I'm not the" is eleven. What CAN tell them apart is the pairing: a segment that
 * both repeats the previous one verbatim *and* is contained in the tail it was
 * prompted with is an echo; either signal alone is not enough.
 *
 * The response is deliberately asymmetric, because the two mistakes cost differently:
 *
 *   - **Muting the context** on any repeat costs one segment's worth of accuracy and
 *     no words at all, so it happens on the first repeat, echo or not. With no tail to
 *     copy, a locked decoder has nothing to sustain the lock with.
 *   - **Dropping the segment** loses speech if the guess is wrong, so it happens only
 *     for the echo pairing, and never to the first instance — a speaker who genuinely
 *     said something twice keeps the first one, and the transcript never needed the
 *     duplicate.
 *
 * Pure and self-contained so it can be reasoned about (and tested) without a
 * microphone, a driver, or the module singleton.
 */

/** What the drain loop should do with a segment. */
export interface RepetitionVerdict {
    /** Skip this segment: it is the recognizer echoing the bias it was given. */
    drop: boolean;
    /** True on the transition into a lock — the moment worth reporting once. */
    locked: boolean;
    /** Whether the NEXT segment should be composed without the rolling context tail. */
    muteContext: boolean;
}

/**
 * Comparison key: case, punctuation and spacing say nothing about whether text repeats.
 * Any script — a Latin-only key made every Japanese segment the empty string, and an
 * empty key never repeats, so the lock could not engage.
 */
export function repetitionKey(text: string): string {
    return String(text || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

/** Is `text` wholly contained in the context tail it was decoded with? */
export function isContextEcho(text: string, context?: string): boolean {
    const needle = repetitionKey(text);
    const hay = repetitionKey(context || "");
    return !!needle && !!hay && hay.includes(needle);
}

export interface RepetitionLock {
    /**
     * Judge one drained segment.
     * @param text the segment's transcript, already filtered and non-empty
     * @param context the rolling tail this segment was prompted with ("" when muted)
     */
    note(text: string, context?: string): RepetitionVerdict;
    /** Whether the context tail is currently withheld. */
    readonly muted: boolean;
}

export function createRepetitionLock(): RepetitionLock {
    let lastKey = "";
    let run = 0;
    let muted = false;

    return {
        get muted() { return muted; },
        note(text: string, context?: string): RepetitionVerdict {
            const key = repetitionKey(text);
            run = key && key === lastKey ? run + 1 : 0;
            lastKey = key;

            if (run === 0) {
                // Output moved on. Restoring the tail restores the accuracy it buys;
                // the words that broke the run are the newest, so they dominate it.
                muted = false;
                return {drop: false, locked: false, muteContext: false};
            }
            const locked = !muted;
            muted = true;
            // The echo test runs against the tail this segment ACTUALLY had. Once muted
            // there is no tail, so nothing can be called an echo and the text is kept —
            // which is the safe direction: an unbiased decoder repeating itself is
            // reporting what it heard.
            return {drop: isContextEcho(text, context), locked, muteContext: true};
        },
    };
}
