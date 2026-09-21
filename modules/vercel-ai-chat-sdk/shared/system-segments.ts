/**
 * Assembling the system prompt into cacheable segments.
 *
 * Provider prompt caches match on PREFIXES: a breakpoint makes everything rendered up
 * to and including it billable at cache-read rates, and one changed byte anywhere
 * before it invalidates the lot. The system prompt is therefore ordered
 * stable -> sticky -> volatile, and a breakpoint is placed at each boundary where the
 * content above it is expected to survive unchanged across the steps of one assistant
 * loop.
 *
 * This matters more than it looks: an assistant loop can make many upstream calls for a
 * single user message, each re-sending the whole schema. Without an explicit breakpoint
 * none of it is cached and every step pays full price for identical bytes.
 *
 * AI SDK note — `instructions` accepts an ARRAY of system messages, and consecutive
 * system messages group into ONE provider block, which the Anthropic provider maps to
 * the top-level `system` array with one text part per entry, each able to carry its own
 * `cache_control`. That is why segmenting here is enough; nothing has to move into
 * `messages`, and no mid-conversation-system beta is triggered.
 */

export type SystemSegment = {
    /** Blocks in render order; empty/blank entries are dropped. */
    blocks: unknown[];
    /** Whether this segment ends in a prompt-cache breakpoint. */
    cache: boolean;
};

export type SystemInstruction = {
    role: "system";
    content: string;
    providerOptions?: Record<string, unknown>;
};

/** Separator between blocks, preserved across segment boundaries. */
const BLOCK_SEPARATOR = "\n---\n";

/**
 * Anthropic accepts at most four cache breakpoints per request and silently drops the
 * excess (with a provider warning). Exported so callers can reason about the budget.
 */
export const MAX_CACHE_BREAKPOINTS = 4;

/**
 * Breakpoints left for the conversation itself. The tail of the message window carries
 * one so each step of a loop reads the previous step's tool traffic; reserving it here
 * means an over-segmented system prompt cannot starve it.
 */
export const RESERVED_CONVERSATION_BREAKPOINTS = 1;

export type BuildSystemInstructionsOptions = {
    /**
     * Whether the provider folds consecutive system messages into ONE provider-level system
     * block. Only then may the prompt travel as several system messages.
     *
     * `false` is not a degraded mode, it is the correct one for such providers: they gain
     * nothing (a breakpoint needs the fold) and can lose everything — an OpenAI-compatible
     * converter emits one `role: "system"` entry per message, and a vLLM chat template
     * accepts exactly one, at index 0, rejecting the whole turn otherwise.
     */
    segmented: boolean;
};

/**
 * Build the `instructions` value from ordered segments.
 *
 * Returns `undefined` when every segment is empty, matching a bare `|| undefined` on a
 * joined string, so a caller can pass the result straight through.
 */
export function buildSystemInstructions(
    segments: SystemSegment[],
    options: BuildSystemInstructionsOptions
): SystemInstruction[] | undefined {
    const rendered = segments
        .map((segment) => ({
            text: segment.blocks.map((x) => String(x ?? "").trim()).filter(Boolean).join(BLOCK_SEPARATOR),
            cache: segment.cache,
        }))
        // An empty segment must not become a blank part: it would read as noise and,
        // if marked, would spend one of the four breakpoints on nothing.
        .filter((segment) => !!segment.text);

    if (!rendered.length) return undefined;

    if (!options.segmented) {
        // One message, every block joined exactly as a single un-segmented string would
        // have been, and no `providerOptions` — an unmergeable provider ignores the
        // breakpoint anyway, so attaching it would be noise on the wire.
        return [{
            role: "system" as const,
            content: rendered.map((segment) => segment.text).join(BLOCK_SEPARATOR),
        }];
    }

    const available = MAX_CACHE_BREAKPOINTS - RESERVED_CONVERSATION_BREAKPOINTS;
    let breakpoints = 0;
    return rendered.map((segment, index) => {
        // A breakpoint on the LAST system segment is still worth having — the prefix
        // continues into `messages`, so it caches tools + system for the next call.
        // What disqualifies a segment is being volatile, which is the caller's `cache`
        // flag, not its position.
        const mark = segment.cache && breakpoints < available;
        if (mark) breakpoints++;
        return {
            role: "system" as const,
            // Re-add the separator that a single joined string placed between blocks now
            // straddling a segment boundary, so the prompt text is unchanged by segmenting.
            content: index === 0 ? segment.text : `---\n${segment.text}`,
            // Fresh object per call — never share a mutable options bag between requests.
            ...(mark ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } } : {}),
        };
    });
}
