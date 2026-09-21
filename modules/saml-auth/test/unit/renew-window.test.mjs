/**
 * The server-side brokers renew correctly — `saml-flow.currentToken` re-mints from the
 * stored assertion before handing a token out — and they already report how long it
 * lives. The client used to discard that, so nothing asked for a new token until a
 * request 401'd: one guaranteed failed request per token lifetime, per context, for as
 * long as the viewer stays open.
 *
 * Arming a timer off the reported expiry is the fix, and the arithmetic is the part
 * that can be got wrong quietly. A delay of zero is far worse than no delay at all: it
 * renews in a tight loop against the deployment's own server. So every input that
 * cannot produce a useful timer must return `null`, not a number.
 *
 * `modules/oidc-server-ts/auth-broker.js` carries an inline copy of this (it is an IIFE
 * and cannot import); these vectors are the contract both sides are held to.
 */
import { test, expect } from "@xopat/test-harness";

const load = () => import(`../../renew-window.ts?t=${Math.random()}`);

test("a normal lifetime renews one lead-time before expiry", async () => {
    const { renewDelayMs, RENEW_LEAD_SEC } = await load();
    expect(RENEW_LEAD_SEC).toBe(60);
    // SAML's default token.ttlSec is 3600 (saml-flow `mintToken`).
    expect(renewDelayMs(3600)).toBe(3540 * 1000);
    expect(renewDelayMs(300)).toBe(240 * 1000);
});

test("a short lifetime renews at the midpoint instead of in the past", async () => {
    const { renewDelayMs } = await load();
    // Lifetime at or below the lead would compute a non-positive delay. Clamping the
    // lead to half the lifetime is what keeps a low `token.ttlSec` deployment from
    // renewing continuously — the failure `_tuneRenewWindow` warns about on the
    // client-side OIDC broker.
    expect(renewDelayMs(60)).toBe(30 * 1000);
    expect(renewDelayMs(30)).toBe(15 * 1000);
});

test("nothing schedulable returns null rather than a zero delay", async () => {
    const { renewDelayMs } = await load();
    // No hint at all: an older server, or a `getToken` that answered `{token: null}`
    // because the SAML session itself is over. Arm nothing; the reactive
    // `secret-needs-update` path is unchanged and remains the backstop.
    expect(renewDelayMs(undefined)).toBe(null);
    expect(renewDelayMs(null)).toBe(null);
    expect(renewDelayMs("3600")).toBe(null);      // a string is not an expiry
    expect(renewDelayMs(NaN)).toBe(null);
    expect(renewDelayMs(Infinity)).toBe(null);
    expect(renewDelayMs(0)).toBe(null);
    expect(renewDelayMs(-5)).toBe(null);
});

test("a sub-second remainder does not become a hot renew loop", async () => {
    const { renewDelayMs, MIN_RENEW_DELAY_MS } = await load();
    expect(MIN_RENEW_DELAY_MS).toBe(1000);
    // Clamping the lead keeps the delay positive but not necessarily useful: 2ms of
    // life computes a 1ms timer, which is a tight loop against our own server. A token
    // this close to death is unusable anyway — let the 401 path have it.
    expect(renewDelayMs(2)).toBe(1000);      // exactly at the floor, still armed
    expect(renewDelayMs(1)).toBe(null);      // 500ms — below the floor
    expect(renewDelayMs(0.002)).toBe(null);
});

test("the lead is caller-overridable but never exceeds half the lifetime", async () => {
    const { renewDelayMs } = await load();
    expect(renewDelayMs(3600, 120)).toBe(3480 * 1000);
    expect(renewDelayMs(100, 900)).toBe(50 * 1000);   // clamped, not negative
});
