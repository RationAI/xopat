/**
 * Minimal numeric tween on `requestAnimationFrame`.
 *
 * Replaces `Kinetic.Tween`, the only reason the 5.1.0 KineticJS bundle was a
 * startup script. The tour needs exactly one thing from it: interpolate a flat
 * bag of numbers (the highlight rectangle) and repaint on every frame.
 */

export type Easing = (t: number) => number;

/** Kinetic's default. Kept explicit so a caller can opt into something else. */
export const linear: Easing = (t) => t;

export type NumericBag = Record<string, number>;

/**
 * Interpolate `state` towards `to` over `durationMs`, calling `onFrame` after
 * every mutation (including the final one). `state` is mutated in place — the
 * overlay keeps a single live shape object and draws from it.
 *
 * @returns a cancel function; calling it stops the animation where it is.
 *          Starting a new tween on the same state should always cancel the
 *          previous one, otherwise two rAF loops fight over the same fields.
 */
export function tween(
    state: NumericBag,
    to: NumericBag,
    durationMs: number,
    onFrame: () => void,
    ease: Easing = linear,
): () => void {
    const keys = Object.keys(to);
    const from: NumericBag = {};
    for (const k of keys) from[k] = state[k] ?? 0;

    if (durationMs <= 0) {
        for (const k of keys) state[k] = to[k]!;
        onFrame();
        return () => {};
    }

    let raf = 0;
    let cancelled = false;
    const start = performance.now();

    const step = (now: number) => {
        if (cancelled) return;
        const t = Math.min(1, (now - start) / durationMs);
        const e = ease(t);
        for (const k of keys) state[k] = from[k]! + (to[k]! - from[k]!) * e;
        onFrame();
        if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
        cancelled = true;
        if (raf) cancelAnimationFrame(raf);
    };
}
