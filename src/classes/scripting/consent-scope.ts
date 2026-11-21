/**
 * Remember scopes for script action consent — the decision logic behind the "Remember" select
 * of the consent dialog (`XOpatScriptingApi.renderConsentDialogWithUi`), kept pure so it can be
 * tested without a DOM.
 *
 * A grant is stored under one of two keys:
 *  - `cacheKey`                  — the action class, any slide;
 *  - `cacheKey@slide:<slideKey>` — the action class on one slide.
 * Either may live in the per-context session set (runtime only) or the persistent
 * `{key: expiresAt}` store on the scripting manager (user-local, deployment-scoped, never in
 * secureMode). `slideKey` is an opaque hash ({@link slideConsentKeyOf}) — background ids can be
 * data paths, and a path must not reach browser storage.
 */
import { hmacSha256Hex } from "../io/slide-hash";

export type ConsentRememberId =
    | "once"
    | "session"
    | "slide-session"
    | "slide-7d"
    | "all-1d"
    | "all-7d"
    | "all-30d"
    | "always";

export type ConsentRememberChoice = {
    id: ConsentRememberId;
    /** i18n key of the option label. */
    labelKey: string;
    /** Whether the grant covers one slide or every slide. */
    slide: boolean;
    /** Persistent lifetime; 0 = this session only (or nothing, for `once`). */
    ttlMs: number;
};

const DAY = 24 * 60 * 60 * 1000;
/** "Always" — the persistent store keeps `{key: expiresAt}`, so forever is a very long TTL. */
const ALWAYS_MS = 100 * 365 * DAY;

const ALL_CHOICES: ConsentRememberChoice[] = [
    { id: "once", labelKey: "scripting.consent.rememberOnce", slide: false, ttlMs: 0 },
    { id: "session", labelKey: "scripting.consent.rememberSession", slide: false, ttlMs: 0 },
    { id: "slide-session", labelKey: "scripting.consent.rememberSlideSession", slide: true, ttlMs: 0 },
    { id: "slide-7d", labelKey: "scripting.consent.rememberSlide7Days", slide: true, ttlMs: 7 * DAY },
    { id: "all-1d", labelKey: "scripting.consent.rememberAll1Day", slide: false, ttlMs: DAY },
    { id: "all-7d", labelKey: "scripting.consent.rememberAll7Days", slide: false, ttlMs: 7 * DAY },
    { id: "all-30d", labelKey: "scripting.consent.rememberAll30Days", slide: false, ttlMs: 30 * DAY },
    { id: "always", labelKey: "scripting.consent.rememberAlways", slide: false, ttlMs: ALWAYS_MS },
];

/** Choice used when the dialog offers no select (e.g. the `window.confirm` fallback). */
export const DEFAULT_CONSENT_REMEMBER: ConsentRememberId = "session";

/**
 * Which remember choices the dialog may offer.
 *
 * @param hasCacheKey without a cache key the action always re-prompts: only "once" exists
 * @param hasSlide a slide key is known, so per-slide choices make sense
 * @param persistAllowed persistence is permitted (opted in, not secureMode, store available)
 */
export function consentRememberChoices(
    { hasCacheKey, hasSlide, persistAllowed }: { hasCacheKey: boolean; hasSlide: boolean; persistAllowed: boolean }
): ConsentRememberChoice[] {
    if (!hasCacheKey) return ALL_CHOICES.filter(c => c.id === "once");
    return ALL_CHOICES.filter(c => (hasSlide || !c.slide) && (persistAllowed || c.ttlMs === 0));
}

export function findConsentRememberChoice(id: string | null | undefined): ConsentRememberChoice | undefined {
    return ALL_CHOICES.find(c => c.id === id);
}

/** Storage key of a grant for one slide. */
export function slideScopedConsentKey(cacheKey: string, slideKey: string): string {
    return `${cacheKey}@slide:${slideKey}`;
}

/** Every key whose grant satisfies a request for `cacheKey` on `slideKey`. */
export function consentGrantKeys(cacheKey: string, slideKey?: string | null): string[] {
    return slideKey ? [cacheKey, slideScopedConsentKey(cacheKey, slideKey)] : [cacheKey];
}

/**
 * What a granted dialog writes. `null` = nothing (the "once" choice, or no cache key).
 * A slide choice without a slide key degrades to the session-wide grant rather than
 * silently widening into a persistent all-slides one.
 */
export function consentGrantWrite(
    cacheKey: string | undefined,
    slideKey: string | null | undefined,
    choice: ConsentRememberChoice
): { key: string; ttlMs: number } | null {
    if (!cacheKey || choice.id === "once") return null;
    if (choice.slide) {
        return slideKey
            ? { key: slideScopedConsentKey(cacheKey, slideKey), ttlMs: choice.ttlMs }
            : { key: cacheKey, ttlMs: 0 };
    }
    return { key: cacheKey, ttlMs: choice.ttlMs };
}

/**
 * Opaque, stable per-slide key for consent grants. Keyed hash (fixed, public key — the point
 * is only that the raw identity never reaches storage), truncated: it names a slide, it does
 * not need collision resistance against an attacker.
 */
export function slideConsentKeyOf(identity: string | null | undefined): string | undefined {
    if (!identity) return undefined;
    return hmacSha256Hex("xopat:consent-slide", String(identity)).slice(0, 24);
}
