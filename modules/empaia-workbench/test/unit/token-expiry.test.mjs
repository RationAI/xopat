/**
 * Reading a workbench token's lifetime, and deciding when to renew.
 *
 * This exists because the broker used to answer "is this context authenticated?" with
 * "is there a non-empty string?". An expired token is a non-empty string, so a long session
 * reported itself authenticated while every request 401'd, the job poller resumed straight
 * into the next failure, and the module's own escalation branch — guarded on the token being
 * *absent* — never ran.
 *
 * The contract that matters here is the `null` one: a token this module cannot read must
 * produce "no opinion", never a wrong answer, or an unrecognised token format locks the
 * session out of a workbench that is working perfectly.
 */
import { test, expect } from "@xopat/test-harness";

const { jwtExpiresInSec, isTokenLive, renewDelayMs, RENEW_LEAD_SEC, MIN_RENEW_DELAY_MS,
    EXPIRY_SKEW_SEC } = await import("../../token-expiry.ts");

/** A JWT with the given payload. The signature is never read, so it is filler. */
function jwt(payload) {
    const b64url = (obj) => Buffer.from(JSON.stringify(obj), "utf8").toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(payload)}.c2ln`;
}

const NOW = 1_788_000_000_000;   // fixed clock; `Date.now()` is never called with it passed

// ── reading exp ─────────────────────────────────────────────────────────────

test("a live token reports the seconds it has left", () => {
    const token = jwt({ exp: NOW / 1000 + 300, scope_id: "s-1" });
    expect(jwtExpiresInSec(token, NOW)).toBe(300);
});

test("an expired token reports a negative lifetime, not null", () => {
    // The distinction is the whole point: `null` means "cannot tell, trust it", so an
    // expired token answering `null` would be indistinguishable from an opaque one.
    const token = jwt({ exp: NOW / 1000 - 60 });
    expect(jwtExpiresInSec(token, NOW)).toBe(-60);
});

test("the real token from the incident reads as long expired", () => {
    // The `exp` observed in the reported session's frontend URL.
    const token = jwt({ app_id: "1077258b", token_id: 19, exp: 1788331649 });
    expect(jwtExpiresInSec(token, 1788331649_000 + 1000)).toBe(-1);
});

test("a payload with no exp is no opinion", () => {
    expect(jwtExpiresInSec(jwt({ scope_id: "s-1" }), NOW)).toBe(null);
});

test("a non-numeric exp is no opinion", () => {
    expect(jwtExpiresInSec(jwt({ exp: "soon" }), NOW)).toBe(null);
    expect(jwtExpiresInSec(jwt({ exp: null }), NOW)).toBe(null);
});

test("anything that is not a three-part JWT is no opinion", () => {
    for (const value of ["", "opaque-token", "a.b", "a.b.c.d", null, undefined, 42, {}]) {
        expect(jwtExpiresInSec(value, NOW), `${String(value)} must not be parsed`).toBe(null);
    }
});

test("a malformed payload is no opinion rather than a throw", () => {
    expect(jwtExpiresInSec("aGVhZGVy.bm90LWpzb24.c2ln", NOW)).toBe(null);
    expect(jwtExpiresInSec("aGVhZGVy.!!!!.c2ln", NOW)).toBe(null);
});

test("an unpadded base64url payload still decodes", () => {
    // JWTs always strip base64 padding, and `atob` rejects unpadded input — decoding
    // `parts[1]` raw fails on most real tokens.
    const token = jwt({ exp: NOW / 1000 + 1, aud: "abc" });
    expect(token.split(".")[1].includes("=")).toBe(false);
    expect(jwtExpiresInSec(token, NOW)).toBe(1);
});

test("a non-ASCII claim does not corrupt the parse", () => {
    const token = jwt({ exp: NOW / 1000 + 10, name: "Jiří Horák" });
    expect(jwtExpiresInSec(token, NOW)).toBe(10);
});

// ── the predicate the broker answers `isAuthenticated` with ─────────────────

test("an expired token is NOT live — the regression this whole change is about", () => {
    // `!!secret` said true here. That one answer produced the 401 storm: the context
    // reported itself authenticated, so the poller's wait-for-a-credential returned
    // instantly and it resumed into the next failure, forever.
    expect(isTokenLive(jwt({ exp: NOW / 1000 - 1 }), EXPIRY_SKEW_SEC, NOW)).toBe(false);
});

test("a token expiring inside the skew is not live either", () => {
    // It would die in flight and come back 401; sending it only buys a failure.
    expect(isTokenLive(jwt({ exp: NOW / 1000 + 1 }), EXPIRY_SKEW_SEC, NOW)).toBe(false);
    expect(isTokenLive(jwt({ exp: NOW / 1000 + EXPIRY_SKEW_SEC }), EXPIRY_SKEW_SEC, NOW)).toBe(false);
});

test("a comfortably live token is live", () => {
    expect(isTokenLive(jwt({ exp: NOW / 1000 + 600 }), EXPIRY_SKEW_SEC, NOW)).toBe(true);
});

test("a token whose lifetime cannot be read is live", () => {
    // The workbench is the authority on its own tokens. A format we do not recognise must
    // not lock a working session out — that failure mode is worse than the one being fixed.
    expect(isTokenLive("opaque-workbench-token", EXPIRY_SKEW_SEC, NOW)).toBe(true);
    expect(isTokenLive(jwt({ scope_id: "s-1" }), EXPIRY_SKEW_SEC, NOW)).toBe(true);
});

test("no token at all is not live", () => {
    for (const value of ["", null, undefined, 0, {}]) {
        expect(isTokenLive(value, EXPIRY_SKEW_SEC, NOW), `${String(value)}`).toBe(false);
    }
});

// ── when to renew ───────────────────────────────────────────────────────────

test("a comfortable lifetime renews one lead before expiry", () => {
    expect(renewDelayMs(3600)).toBe((3600 - RENEW_LEAD_SEC) * 1000);
});

test("a short lifetime renews at the midpoint instead of in the past", () => {
    // lead is clamped to half the lifetime: 30 s of life renews at 15 s, not at -30 s.
    expect(renewDelayMs(30)).toBe(15_000);
});

test("a lifetime too short to schedule inside arms nothing", () => {
    // Below the floor the token is already unusable; a 1 ms timer would be a tight loop
    // against the workbench. The reactive 401 path is the honest answer.
    expect(renewDelayMs(1)).toBe(null);
    expect(renewDelayMs(MIN_RENEW_DELAY_MS / 1000)).toBe(null);
});

test("a spent or unknowable lifetime arms nothing", () => {
    for (const value of [0, -60, null, undefined, NaN, Infinity, "3600"]) {
        expect(renewDelayMs(value), `${String(value)} must not arm a timer`).toBe(null);
    }
});

test("the two compose: a live token schedules, an expired one does not", () => {
    const live = jwtExpiresInSec(jwt({ exp: NOW / 1000 + 900 }), NOW);
    const dead = jwtExpiresInSec(jwt({ exp: NOW / 1000 - 900 }), NOW);
    expect(renewDelayMs(live)).toBe((900 - RENEW_LEAD_SEC) * 1000);
    expect(renewDelayMs(dead)).toBe(null);
});
