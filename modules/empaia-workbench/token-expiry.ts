// When the workbench token dies, and when to ask for the next one.
//
// Its OWN file, with no imports, so it is unit-testable without standing up the module —
// same reason `modules/saml-auth/renew-window.ts` is a separate file.
//
// `renewDelayMs` is the same arithmetic as `modules/saml-auth/renew-window.ts`, which
// `modules/oidc-server-ts/auth-broker.js` also carries as an inline copy. None of the three
// can import from the others (no cross-module ES imports — AGENTS.md §1), so they are kept
// deliberately identical by hand. Change one, change the others.
//
// Why this file exists at all: VACI's wire model is `{ value, type }` — there is no
// `expires_in` and no `exp` on the message
// (`@empaia/vendor-app-communication-interface/src/lib/models/token.d.ts`). Decoding the JWT
// is the only available source of a lifetime, and without a lifetime the broker can only ever
// react to a 401, which is one guaranteed failed request per token lifetime (src/AUTH.md).

/** Longest lead before expiry at which a renew fires, when the lifetime allows it. */
export const RENEW_LEAD_SEC = 60;

/**
 * Shortest delay worth arming a timer for. Clamping the lead keeps the delay positive but not
 * necessarily *useful*: a token with a couple of milliseconds left computes a 1 ms timer, which
 * is a tight loop against the workbench wearing a scheduler's clothes. Below this, the token is
 * already unusable and the reactive `secret-needs-update` path is the honest answer.
 */
export const MIN_RENEW_DELAY_MS = 1000;

/**
 * Seconds of life left in a JWT, or `null` when that cannot be determined.
 *
 * **Decode only — this never verifies anything.** The workbench mints the token and the
 * Workbench Service is the only authority on whether it is acceptable; this is a local
 * liveness hint used to schedule a renew and to stop reporting a dead credential as live.
 * Treating it as a security decision would be wrong in both directions (a forged `exp` cannot
 * grant access, and a valid token we fail to parse must not be discarded).
 *
 * `null` — not `0`, not a negative number — for every input that cannot produce an answer: an
 * opaque token, a rotated format, a malformed payload, or a JWT with no `exp`. Callers treat
 * `null` as "no opinion" and fall back to the behaviour they had before this file existed,
 * so an unrecognised token shape degrades instead of locking the session out.
 */
export function jwtExpiresInSec(token: unknown, nowMs: number = Date.now()): number | null {
    if (typeof token !== "string" || token.length === 0) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    let payload: any;
    try {
        payload = JSON.parse(base64UrlDecode(parts[1]));
    } catch (e) {
        return null;
    }
    const exp = payload?.exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
    return exp - nowMs / 1000;
}

/**
 * Treat a token with less than this much life left as already dead.
 *
 * A token that expires while the request it authorizes is in flight comes back 401 anyway, so
 * reporting it as live only buys a guaranteed failure. Small, because the workbench's clock and
 * ours are not synchronised and over-eager expiry costs an unnecessary token request.
 */
export const EXPIRY_SKEW_SEC = 5;

/**
 * Is this credential worth sending?
 *
 * The predicate the broker's `isAuthenticated` is built on, and the reason this module exists.
 * Answering it as `!!secret` — which is what shipped — reports an EXPIRED token as live, because
 * an expired token is still a non-empty string and nothing ever removes it. That made
 * `whenContextSettled` resolve "authenticated" instantly, so the job poller's "stop and wait for
 * a credential" resumed straight into the next 401, and the module's own escalation branch
 * (guarded on the token being *absent*) never ran.
 *
 * A token whose lifetime cannot be read is LIVE. The workbench is the authority on its own
 * tokens; a format this module does not recognise must not lock a working session out.
 */
export function isTokenLive(token: unknown, skewSec: number = EXPIRY_SKEW_SEC,
                            nowMs: number = Date.now()): boolean {
    if (typeof token !== "string" || token.length === 0) return false;
    const left = jwtExpiresInSec(token, nowMs);
    return left === null || left > skewSec;
}

/**
 * Delay in ms until a token with `expiresInSec` seconds of life left should be renewed, or
 * `null` when nothing should be scheduled.
 *
 * The lead is clamped to half the lifetime, so a workbench issuing very short-lived tokens
 * renews at the midpoint instead of computing a delay in the past. A renew that is merely
 * absent costs one 401; a renew that fires immediately costs an infinite loop.
 */
export function renewDelayMs(expiresInSec: unknown, leadSec: number = RENEW_LEAD_SEC): number | null {
    if (typeof expiresInSec !== "number" || !Number.isFinite(expiresInSec) || expiresInSec <= 0) return null;
    const lead = Math.min(leadSec, expiresInSec / 2);
    const delay = Math.floor((expiresInSec - lead) * 1000);
    return delay >= MIN_RENEW_DELAY_MS ? delay : null;
}

/**
 * Base64url → string, without assuming a `Buffer` or a padded input.
 *
 * `atob` rejects unpadded base64url in every browser, and the JWT spec strips the padding, so
 * decoding straight from `parts[1]` fails on roughly three quarters of all real tokens. Both
 * substitutions and the padding are therefore mandatory, not defensive.
 *
 * The `decodeURIComponent` step turns the resulting byte string into UTF-8 text. A workbench
 * payload is ASCII in practice, but a non-ASCII claim would otherwise be mojibake and could
 * break `JSON.parse` — and this function's contract is that a payload it cannot read produces
 * `null`, never a wrong answer.
 */
function base64UrlDecode(segment: string): string {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    let percentEncoded = "";
    for (let i = 0; i < binary.length; i++) {
        percentEncoded += "%" + binary.charCodeAt(i).toString(16).padStart(2, "0");
    }
    return decodeURIComponent(percentEncoded);
}
