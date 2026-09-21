/**
 * Abort/deadline composition for server-side model calls.
 *
 * The RPC layer's own timeout (`server-runtime.js`) is cooperative: it aborts a
 * signal handed to the method as `ctx.signal` and answers 504, but an in-flight
 * upstream request that never reads that signal keeps running. Every call into a
 * model SDK must therefore link its own deadline to `ctx.signal` and pass the
 * result down, or a dead upstream is only bounded by undici's default 300s
 * headersTimeout multiplied by the SDK's internal retries.
 */

/**
 * Every string an error carries, flattened for classification.
 *
 * The condition a caller wants to recognise (a context-window overflow, a rejected
 * image, a model that cannot take tools, a cap that is too large) is stated by the
 * UPSTREAM — but by the time it arrives the AI SDK has wrapped it: the provider's
 * own text sits in `responseBody` / `data`, under a `cause` chain, or inside an
 * aggregated `errors` array, while `message` is the SDK's generic summary.
 * Matching `message` alone therefore classified the SAME upstream failure
 * differently depending on which layer wrapped it — turning a graceful "retry with
 * less history" into a dead turn. Depth-bounded, like {@link isAbortError}, which
 * walks the same chain for the same reason.
 */
export function errorText(error: any, depth = 0): string {
    if (!error || depth > 5) return '';
    if (typeof error === 'string') return error;
    const parts = [
        error.message,
        error.responseBody,
        typeof error.data === 'string' ? error.data : undefined,
        error.cause ? errorText(error.cause, depth + 1) : undefined,
        ...(Array.isArray(error.errors) ? error.errors.map((e: any) => errorText(e, depth + 1)) : []),
    ];
    const text = parts.filter((value) => typeof value === 'string' && value).join(' | ');
    return text || String(error);
}

export function createTimeoutAbortController(timeoutMs: number): AbortController {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
    return controller;
}

/** Signal that aborts when `signal` aborts or `timeoutMs` elapses, whichever is first. */
export function createTimeoutLinkedSignal(signal: AbortSignal | null | undefined, timeoutMs: number): AbortSignal {
    const timeoutSignal = typeof AbortSignal?.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : createTimeoutAbortController(timeoutMs).signal;

    if (!signal) return timeoutSignal;
    if (signal.aborted) return signal;

    if (typeof AbortSignal?.any === 'function') {
        return AbortSignal.any([signal, timeoutSignal]);
    }

    const controller = new AbortController();
    const forwardAbort = (source: AbortSignal) => {
        if (!controller.signal.aborted) controller.abort(source.reason);
    };
    signal.addEventListener('abort', () => forwardAbort(signal), { once: true });
    timeoutSignal.addEventListener('abort', () => forwardAbort(timeoutSignal), { once: true });
    return controller.signal;
}

/**
 * True when `error` is (or wraps) an abort/timeout rather than a rejection the
 * upstream actually produced. The AI SDK buries the cause under RetryError /
 * APICallError, so walk the chain instead of testing the top-level name only.
 *
 * NOT sufficient on its own: `AbortController.abort(reason)` rejects with `reason`
 * verbatim, so an abort carrying a custom Error (as the RPC layer's timeout does)
 * is indistinguishable from an upstream failure by shape alone. Always pair this
 * with an explicit `signal.aborted` check when you own the signal.
 */
export function isAbortError(error: any, depth = 0): boolean {
    if (!error || depth > 5) return false;
    const name = error?.name;
    if (name === 'AbortError' || name === 'TimeoutError') return true;
    if (error?.code === 'ABORT_ERR') return true;
    if (Array.isArray(error?.errors) && error.errors.some((e: any) => isAbortError(e, depth + 1))) return true;
    return isAbortError(error?.cause, depth + 1);
}
