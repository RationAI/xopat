/**
 * Telling "you are not allowed to do this" apart from "this went wrong".
 *
 * The distinction decides behaviour in two places that must agree, which is why it lives here
 * rather than in either of them:
 *
 *   - the panel picks between an auth prompt and a generic failure state, and
 *   - the managed provider registration decides whether to RETRY.
 *
 * That second one is the reason this was extracted. A refusal is a *verdict*: retrying it four
 * times with exponential backoff spends six seconds to be told the same thing, and then reports
 * "the provider is unavailable" about a deployment where the user has simply not signed in yet.
 * A 500 is the opposite — the upstream may well answer next time — and must keep its retries.
 * Narrowing that judgement to one predicate is what stops the two call sites drifting.
 */

/**
 * Whether a failure was the request being REFUSED rather than the upstream answering badly.
 *
 * Shape-based, deliberately: the same call can fail as an `HTTPError` (which carries
 * `status`/`statusCode` — `src/classes/http-client.ts`) or as an RPC error carrying the
 * server's own `code` (`server/node/auth.js` answers 401 with `RPC_AUTH_FAILED`), and a caller
 * cannot tell in advance which layer will reject it. `RPC_AUTH*` is matched by PREFIX so a new
 * server-side auth code is covered the day it is added rather than the day someone notices.
 *
 * 403 counts: an authenticated caller who is not permitted is still refused, and retrying is
 * just as pointless. What does NOT count is anything else — a 500, a timeout, a network drop —
 * because those are exactly the transients the retry loop exists for.
 */
export function isAuthError(error: unknown): boolean {
    const e = error as any;
    const status = e?.status ?? e?.statusCode;
    if (status === 401 || status === 403) return true;
    const code = String(e?.code || "");
    return code.startsWith("RPC_AUTH") || code === "RPC_NO_SESSION" || code === "RPC_BAD_CSRF";
}
