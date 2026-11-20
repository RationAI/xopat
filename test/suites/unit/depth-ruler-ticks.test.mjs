/**
 * Tick density of the focal-plane ruler.
 *
 * A z-stack is anywhere from two planes to a radiology series of hundreds, on
 * a track anywhere from a phone to a wide monitor. One tick per plane is right
 * while they fit; past that the ticks must thin out on round plane numbers
 * instead of smearing into a solid band.
 */
import { test, expect } from "@xopat/test-harness";
import { depthRulerTickStep, MIN_TICK_GAP_PX } from "../../../ui/classes/components/depthRulerTicks.mjs";

test("one tick per plane while they fit", { tag: ["@unit"] }, () => {
    expect(depthRulerTickStep(2, 300)).toBe(1);
    expect(depthRulerTickStep(12, 300)).toBe(1);
    expect(depthRulerTickStep(76, 300)).toBe(1); // exactly 4px apart
});

test("thins out on 1-2-5 steps when planes are denser than the minimum gap", { tag: ["@unit"] }, () => {
    expect(depthRulerTickStep(400, 800)).toBe(2);
    expect(depthRulerTickStep(400, 300)).toBe(10);
    expect(depthRulerTickStep(1000, 200)).toBe(20);
    for (const [count, width] of [[400, 800], [400, 300], [1000, 200], [37, 90]]) {
        const step = depthRulerTickStep(count, width);
        expect((width / (count - 1)) * step).toBeGreaterThanOrEqual(MIN_TICK_GAP_PX);
        // …and not coarser than needed: the next finer round step would be too dense.
        expect(/^[125]0*$/.test(String(step))).toBe(true);
    }
});

test("degenerate input never loops or returns less than one", { tag: ["@unit"] }, () => {
    expect(depthRulerTickStep(1, 300)).toBe(1);
    expect(depthRulerTickStep(0, 300)).toBe(1);
    expect(depthRulerTickStep(50, 0)).toBe(1);
    expect(depthRulerTickStep(500, 1)).toBeGreaterThanOrEqual(1);
});
