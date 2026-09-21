// When to renew a server-minted token, given the expiry the server reports.
//
// Its OWN file, with no imports, for the same reason `context-config.ts` is: that one
// reads `process.env` and must never be pulled into the browser bundle, and this one
// runs on the client. Pure means it is unit-testable without standing up the module.
//
// `modules/oidc-server-ts/auth-broker.js` carries an inline copy of this arithmetic.
// It cannot import — it is a plain IIFE loaded through `include.json` `includes`, not
// a bundled workspace module — so the two are kept deliberately identical by hand,
// like the rest of those two files. Change one, change the other.

/** Longest lead before expiry at which a renew fires, when the lifetime allows it. */
export const RENEW_LEAD_SEC = 60;

/**
 * Shortest delay worth arming a timer for. Clamping the lead keeps the delay positive
 * but not necessarily *useful*: a token with a couple of milliseconds left computes a
 * 1 ms timer, which is a tight loop against the deployment's own server wearing a
 * scheduler's clothes. Below this, the token is already unusable and the reactive
 * `secret-needs-update` path is the honest answer.
 */
export const MIN_RENEW_DELAY_MS = 1000;

/**
 * Delay in ms until a token with `expiresIn` seconds of life left should be renewed,
 * or `null` when nothing should be scheduled.
 *
 * Returns `null` — rather than `0` or a negative number — for every input that cannot
 * produce a useful timer: no hint at all (an older server, or a `getToken` that
 * answered `{token: null}`), a non-finite value, or a lifetime already spent. The
 * caller then arms nothing and the reactive `secret-needs-update` path stays exactly as
 * it was; a renew that is merely absent costs one 401, a renew that fires immediately
 * costs an infinite loop.
 *
 * The lead is clamped to half the lifetime, so a deployment running a very short
 * `token.ttlSec` renews at the midpoint instead of computing a delay in the past. This
 * is the same failure `oidc-auth._tuneRenewWindow` warns about on the client-side OIDC
 * broker, where the library snapshots its lead once and a lead >= lifetime turns every
 * token load into a renew a second later.
 */
export function renewDelayMs(expiresIn: unknown, leadSec: number = RENEW_LEAD_SEC): number | null {
    if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
    const lead = Math.min(leadSec, expiresIn / 2);
    const delay = Math.floor((expiresIn - lead) * 1000);
    return delay >= MIN_RENEW_DELAY_MS ? delay : null;
}
