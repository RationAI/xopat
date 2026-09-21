/**
 * Which analyses are painted on the slide after a poll.
 *
 * The rule that sent this back for rework: choosing an older analysis from the
 * history marks the slide "user owned", which switched the default off *for
 * good*. A run started afterwards then completed with nothing appearing on the
 * canvas — the user pressed Run and the viewer showed no response at all.
 *
 * So an arrival — an analysis that finished during this session — is shown
 * whether the user has chosen or not, and is *added* rather than replacing, so
 * the comparison they assembled survives the new result joining it.
 */
import { test, expect } from "@xopat/test-harness";

const { resolveVisibleJobs } = await import("../../visibility.ts");

const ids = (set) => [...set].sort();

/** Defaults that keep each case to the one fact it is about. */
const resolve = (over) => resolveVisibleJobs({
    current: [], live: ["a", "b", "c"], userOwned: false, limit: 8, ...over,
});

// ── the default, while the user has not chosen ──────────────────────────────

test("the newest finished analysis is shown, replacing what was there", () => {
    expect(ids(resolve({ current: ["a"], latestCompletedId: "b" }))).toEqual(["b"]);
});

test("nothing finished yet leaves the slide alone", () => {
    // Not the same as showing nothing: blanking a result the user is reading
    // because a new run started is the bug this guards.
    expect(ids(resolve({ current: ["a"], latestCompletedId: undefined }))).toEqual(["a"]);
});

test("an analysis the poll no longer reports stops being shown", () => {
    expect(ids(resolve({ current: ["a", "gone"], live: ["a"] }))).toEqual(["a"]);
});

// ── the user's choice, and arrivals on top of it ────────────────────────────

test("a user choice is not overwritten by the default", () => {
    expect(ids(resolve({ current: ["a"], userOwned: true, latestCompletedId: "b" })))
        .toEqual(["a"]);
});

test("an arrival is shown even though the user chose something else", () => {
    // THE regression. Before this, `userOwned` suppressed everything and the new
    // result never reached the canvas.
    expect(ids(resolve({
        current: ["a"], userOwned: true, latestCompletedId: "b", arrivedIds: ["c"],
    }))).toEqual(["a", "c"]);
});

test("an arrival joins the chosen set rather than replacing it", () => {
    expect(ids(resolve({
        current: ["a", "b"], userOwned: true, arrivedIds: ["c"],
    }))).toEqual(["a", "b", "c"]);
});

test("an arrival already shown changes nothing", () => {
    expect(ids(resolve({ current: ["a"], userOwned: true, arrivedIds: ["a"] })))
        .toEqual(["a"]);
});

test("an arrival the poll does not report is not shown", () => {
    // A job deleted upstream between the transition and this resolve.
    expect(ids(resolve({ current: ["a"], userOwned: true, arrivedIds: ["gone"] })))
        .toEqual(["a"]);
});

// ── the limit ──────────────────────────────────────────────────────────────

test("over the limit the oldest is dropped", () => {
    const order = { a: 1, b: 2, c: 3 };
    expect(ids(resolve({
        current: ["a", "b", "c"], userOwned: true, limit: 2,
        orderOf: (id) => order[id],
    }))).toEqual(["b", "c"]);
});

test("an arrival is never the one dropped", () => {
    // `a` is the newest by time, but `c` is what the user is waiting to see.
    const order = { a: 3, b: 2, c: 1 };
    expect(ids(resolve({
        current: ["a", "b"], userOwned: true, arrivedIds: ["c"], limit: 2,
        orderOf: (id) => order[id],
    }))).toEqual(["a", "c"]);
});

test("arrivals alone may exceed the limit rather than be dropped", () => {
    // Nothing droppable is left; refusing to show a finished run is worse than
    // briefly exceeding a display cap.
    expect(ids(resolve({
        current: [], userOwned: true, arrivedIds: ["a", "b", "c"], limit: 1,
    }))).toEqual(["a", "b", "c"]);
});
