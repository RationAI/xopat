/** Narrowest gap between two drawn ticks before they blur into a solid band. */
export const MIN_TICK_GAP_PX = 4;

/**
 * How many planes one drawn tick of the `DepthRuler` stands for, so ticks stay
 * at least `minGapPx` apart on a track `trackPx` wide. Steps follow 1-2-5
 * decades (1, 2, 5, 10, 20, 50, …) so a tick always lands on a round plane
 * number. Kept free of DOM imports so it is testable on its own.
 *
 * @param {number} count number of planes
 * @param {number} trackPx usable track width in CSS pixels
 * @param {number} [minGapPx]
 * @returns {number} step ≥ 1
 */
export function depthRulerTickStep(count, trackPx, minGapPx = MIN_TICK_GAP_PX) {
    if (!(count > 1) || !(trackPx > 0)) return 1;
    const perPlane = trackPx / (count - 1);
    let decade = 1;
    for (;;) {
        for (const m of [1, 2, 5]) {
            const step = m * decade;
            if (step * perPlane >= minGapPx || step >= count - 1) return step;
        }
        decade *= 10;
    }
}
