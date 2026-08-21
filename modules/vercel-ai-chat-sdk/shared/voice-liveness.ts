/**
 * When a quiet microphone means the session is dead, and when it means nobody was
 * listening.
 *
 * Hands-free capture runs a heartbeat watchdog: if no sign of life arrives within a
 * window, the session is declared lost and the dictation ends. The original rule
 * compared two wall-clock stamps and nothing else, which made it unable to tell
 * apart the two things it most needs to distinguish:
 *
 *  - the capture really stopped (device unplugged, audio graph dead, session
 *    wedged) — the user is talking into a microphone that records nothing, and the
 *    sooner they are told the better;
 *  - the WATCHDOG stopped (a multi-second task on the main thread, a frozen tab, a
 *    suspended laptop). The microphone was fine the whole time; the timer simply
 *    did not run, and the queued heartbeats had not been delivered yet when it
 *    finally did. Ending a healthy dictation here is pure damage — it happened
 *    routinely during report dictation, where an extraction pass runs roughly once
 *    a second and grows with the transcript.
 *
 * A late tick is evidence about the observer, not the observed, so it never counts.
 * And a genuine stall asks for the microphone to be re-opened before anyone is told
 * the session is over: a restart keeps the queued turns, the held draft and the
 * retained recording, which a "lost" verdict does not.
 *
 * Pure module: no `window`, no Node globals, no i18next.
 */

/** Inputs of the liveness rule. All durations in ms. */
export interface LivenessInput {
    /** Since the last capture heartbeat (recorder data, level tick, turn, …). */
    idleMs: number;
    /** Staleness budget; `0` disables the watchdog entirely. */
    staleMs: number;
    /**
     * A heartbeat has been seen at least once, so silence is now meaningful. A
     * session that never produced one is a START failure, not a stall — reporting
     * it here would mask it behind the wrong message.
     */
    armed: boolean;
    /** `document.visibilityState === "visible"`. Hidden tabs throttle legitimately. */
    visible: boolean;
    /** How late THIS watchdog tick was, versus its own period. */
    tickLagMs: number;
    /** In-place restarts already attempted for the current stall. */
    attempts: number;
    /** Restarts allowed before the session is declared lost; `0` = fail at once. */
    maxAttempts: number;
}

/**
 * - `ok` — nothing to do.
 * - `wait` — the watchdog's own outage; re-stamp the clock and grant a clean window.
 * - `restart` — re-open the microphone in place, keeping all session state.
 * - `lost` — recovery is exhausted; tell the user and end the session.
 */
export type LivenessAction = "ok" | "wait" | "restart" | "lost";

/**
 * Decide what a watchdog tick should do about the capture's silence.
 *
 * Order matters: the observer is exonerated before the microphone is accused, and
 * recovery is attempted before loss is declared.
 */
export function decideLiveness(input: LivenessInput): LivenessAction {
    const {idleMs, staleMs, armed, visible, tickLagMs, attempts, maxAttempts} =
        input || ({} as LivenessInput);

    if (!armed) return "ok";
    if (!(staleMs > 0)) return "ok";
    if (!visible) return "ok";
    if (!(idleMs > staleMs)) return "ok";

    // The tick itself was delayed longer than the whole budget: the gap measures
    // how long WE were away, not how long the microphone was quiet. Anything else
    // would let a blocked main thread or a closed laptop lid end a dictation.
    if (tickLagMs > staleMs) return "wait";

    if ((attempts || 0) < (maxAttempts || 0)) return "restart";
    return "lost";
}
