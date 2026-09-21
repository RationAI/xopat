/**
 * Shared primitives for the pathology engine's pure layer — the value types every other
 * helper is written against, plus the handful of operations that belong to no one feature.
 *
 * These are deliberately free of viewer, driver and DOM references so every helper
 * built on them stays unit-testable without a browser or a slide. The module's
 * public API re-exports them from `pathologyFoundation.ts`, which remains the single
 * import surface for anything outside this module.
 */

/** A point in whatever coordinate space the caller is working in (raster or image). */
export type Point = { x: number; y: number };

/** Image-space bounding box of a result, for navigation (`viewer.frameImageRegion`). */
export interface Bounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Binary mask in the background-render pixel space (1 = foreground). */
export interface MaskResult {
    binaryMask: Uint8Array;
    width: number;
    height: number;
    label?: string;
    score?: number;
}

/**
 * A caller-supplied number forced into a usable range.
 *
 * Every knob the module exposes reaches it through a script, so `NaN`, a negative and a
 * gigapixel budget are all things to expect rather than to guard against case by case.
 *
 * Lives here rather than beside any one caller: it guards budgets, thresholds, paddings and
 * merge ratios alike, so filing it under whichever feature happened to need it first makes
 * every later caller import that feature's module for a clamp.
 */
export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
    const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, n));
}
