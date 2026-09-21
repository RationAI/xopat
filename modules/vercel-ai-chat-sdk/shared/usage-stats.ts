/**
 * Token accounting for a chat session, summed on the client.
 *
 * One user message drives MANY upstream model calls — the assistant loop runs up to
 * `MAX_SCRIPT_STEPS` plus its extensions plus a final answer — and each call reports its
 * own usage. A single call's numbers therefore say very little; what a reader wants is
 * "what did my last message cost" and "what has this session cost so far".
 *
 * The client is the only side that knows where one user message ends: server-side a turn
 * IS one upstream call, with no notion of the group it belongs to. So the grouping lives
 * here, driven by `beginGroup()` at the same point the panel emits `turn-start`.
 *
 * Pure and dependency-free: no DOM, no viewer, no network. Everything is derived at read
 * time rather than stored formatted, so a snapshot can be rendered however the caller likes.
 */

/** One upstream model call's usage, as it arrives from the server. All fields optional. */
export type TurnUsage = {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    /** Prompt tokens NOT served from cache. Absent on providers with no cache reporting. */
    noCacheTokens?: number;
    /** Prompt tokens served from cache (billed at a large discount). */
    cacheReadTokens?: number;
    /** Prompt tokens written INTO the cache (billed at a premium). */
    cacheWriteTokens?: number;
};

export type UsageTotals = {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    noCacheTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    /** Upstream model calls folded in — the loop's step count, not the message count. */
    calls: number;
    /**
     * Whether ANY folded call reported token counts at all.
     *
     * A provider can answer a request and report nothing: an OpenAI-compatible backend that
     * was not asked for `stream_options.include_usage` streams no usage block, and the SDK
     * hands back an object whose every field is undefined. Summing that yields zeros which
     * are indistinguishable from a real "this cost nothing" — so the reader is told a
     * falsehood at exactly the moment the feature looks most authoritative. Track it and
     * render a dash instead.
     */
    hasTokenDetail: boolean;
    /**
     * Whether ANY folded call reported cache detail. Distinguishes "this provider does not
     * report caching" from "nothing was cached" — the two must never render the same, or a
     * provider that simply cannot report would look like a broken cache.
     */
    hasCacheDetail: boolean;
    /** ISO timestamp of the most recent fold, or null when nothing has been recorded. */
    at: string | null;
};

export type SessionUsage = {
    /** Reset at the start of each user message. */
    lastMessage: UsageTotals;
    /** Cumulative since the session was opened in this tab. */
    session: UsageTotals;
    /** User messages started in this session. */
    messages: number;
};

export function createTotals(): UsageTotals {
    return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        noCacheTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        calls: 0,
        hasTokenDetail: false,
        hasCacheDetail: false,
        at: null,
    };
}

export function createSessionUsage(): SessionUsage {
    return { lastMessage: createTotals(), session: createTotals(), messages: 0 };
}

/** Coerce anything the wire might carry into a non-negative finite number. */
function num(value: unknown): number {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function hasNumber(value: unknown): boolean {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n);
}

function foldInto(totals: UsageTotals, usage: TurnUsage, at: string): void {
    const input = num(usage.inputTokens);
    const output = num(usage.outputTokens);
    const reported = hasNumber(usage.inputTokens)
        || hasNumber(usage.outputTokens)
        || hasNumber(usage.totalTokens);

    totals.inputTokens += input;
    totals.outputTokens += output;
    // Providers do not all report a total; derive it rather than showing a zero next to
    // non-zero parts, which reads as a bug. Only when SOMETHING was reported — deriving
    // 0 + 0 from a silent provider would manufacture a number nobody measured.
    if (reported) totals.totalTokens += num(usage.totalTokens) || (input + output);
    totals.noCacheTokens += num(usage.noCacheTokens);
    totals.cacheReadTokens += num(usage.cacheReadTokens);
    totals.cacheWriteTokens += num(usage.cacheWriteTokens);
    totals.calls += 1;
    // A literal 0 counts as reported: "measured, and it was zero" is a real finding, and
    // must stay distinguishable from "never told". Hence hasNumber, not truthiness.
    if (reported) totals.hasTokenDetail = true;
    if (hasNumber(usage.cacheReadTokens) || hasNumber(usage.cacheWriteTokens) || hasNumber(usage.noCacheTokens)) {
        totals.hasCacheDetail = true;
    }
    totals.at = at;
}

/**
 * Fold one upstream call into both the current message and the session.
 *
 * Called for every call, including ones that ended in an abort — those tokens were paid
 * for, and omitting them would make the readout under-report exactly when a user is most
 * likely to be looking at it.
 */
export function recordUsage(state: SessionUsage, usage: TurnUsage | null | undefined, at: string): void {
    if (!usage) return;
    foldInto(state.lastMessage, usage, at);
    foldInto(state.session, usage, at);
}

/**
 * Start a new user message: clear the per-message totals, keep the session's.
 *
 * Counts the message even if it goes on to produce no usage at all (an immediate error,
 * a refused turn) — "messages" is what the user sent, not what succeeded.
 */
export function beginGroup(state: SessionUsage): void {
    state.lastMessage = createTotals();
    state.messages += 1;
}

/**
 * Share of prompt tokens served from cache, or null when unknowable.
 *
 * Null in two distinct cases the caller must render as "—" rather than 0%: the provider
 * reported no cache detail at all, and nothing has been recorded yet. A literal 0% is
 * reserved for "we measured, and nothing hit" — which is a real and actionable finding.
 */
export function cacheHitRatio(totals: UsageTotals): number | null {
    if (!totals.hasCacheDetail) return null;
    const prompt = totals.noCacheTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
    if (prompt <= 0) return null;
    return totals.cacheReadTokens / prompt;
}

/** Deep copy, so a caller cannot mutate live accounting by holding onto a snapshot. */
export function snapshot(state: SessionUsage): SessionUsage {
    return {
        lastMessage: { ...state.lastMessage },
        session: { ...state.session },
        messages: state.messages,
    };
}
