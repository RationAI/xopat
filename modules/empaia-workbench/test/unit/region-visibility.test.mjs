/**
 * When a region an analysis consumed leaves the screen.
 *
 * Hiding every analysis used to clear the results and leave the slide covered
 * in the ROIs they were run on — a forest the user must read past and cannot
 * delete, because the backend locks a job's inputs for good. So the regions
 * follow the analyses that used them.
 *
 * The failure modes are symmetric and both are user-visible, which is why each
 * exception below has its own case: hide too little and the forest is back,
 * hide too much and the user's own drawing vanishes under them.
 */
import { test, expect } from "@xopat/test-harness";

const { regionStaysVisible } = await import("../../visibility.ts");

/** No analysis is shown and none is running — the strict case. */
const idle = { isShown: () => false, isRunning: () => false };

test("a region no analysis consumed is always shown", () => {
    expect(regionStaysVisible(undefined, idle)).toBe(true);
    expect(regionStaysVisible(new Set(), idle)).toBe(true);
});

test("a consumed region is hidden while every analysis using it is hidden", () => {
    expect(regionStaysVisible(new Set(["job-1"]), idle)).toBe(false);
});

test("showing any one of the analyses using it brings it back", () => {
    const ctx = { isShown: (id) => id === "job-2", isRunning: () => false };
    expect(regionStaysVisible(new Set(["job-1", "job-2"]), ctx)).toBe(true);
    // ...and it is only gone once the last of them is hidden.
    expect(regionStaysVisible(new Set(["job-1", "job-3"]), ctx)).toBe(false);
});

test("a region stays while the analysis using it is still running", () => {
    // The submitted region must not disappear the moment the run starts: it has
    // no result to show yet, so it is not in the shown set.
    const ctx = { isShown: () => false, isRunning: (id) => id === "job-1" };
    expect(regionStaysVisible(new Set(["job-1"]), ctx)).toBe(true);
});

test("a lock whose holder is unknown never hides anything", () => {
    // Learned from a 423 refusal rather than from the job list: there is no
    // analysis to toggle, so hiding the region would strand it.
    expect(regionStaysVisible(new Set([""]), idle)).toBe(true);
    expect(regionStaysVisible(new Set(["", "job-1"]), idle)).toBe(true);
});
