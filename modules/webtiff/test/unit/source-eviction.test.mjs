/**
 * Which open slide the source cache is allowed to close.
 *
 * The bug this pins was silent and looked like a viewer fault: a session naming
 * more than `maxOpenSlides` data entries (overlays count) trimmed the cache
 * while the first background's header was still in flight. "No viewer is showing
 * it" was read as "idle", the file was closed, and the awaited ready-deferred
 * never settled — so the viewport showed "Loading…" for ever with no error
 * anywhere. `multi-view-goals` (5 entries) and `all-shaders` (8) hit it,
 * `basic-overlay` (4) did not, which is exactly how it presented.
 *
 * The distinction the predicate has to keep is never-shown vs no-longer-shown.
 */
import { test, expect } from "@xopat/test-harness";

// The policy lives in its own module precisely so it can be imported without
// `index.mjs`, which installs a tile source into OpenSeadragon and stands up a
// decode pool at evaluation time.
import { isEvictableSource } from "../../source-cache.mjs";

const opening = () => ({});
const shown = () => ({ __xopatWasShown: true });
const failed = () => ({ __xopatOpenFailure: "boom" });

test("a source that has never been shown is never evicted @unit", () => {
    // The whole bug: in no world yet ≠ idle. It is in no world for the entire
    // header read, and again between the header landing and the tiled image
    // being mounted.
    expect(isEvictableSource(opening(), false)).toBe(false);
});

test("a source being rendered right now is never evicted @unit", () => {
    expect(isEvictableSource(shown(), true)).toBe(false);
    expect(isEvictableSource(opening(), true)).toBe(false);
});

test("a source that was shown and no longer is may be closed @unit", () => {
    // This is what the cache bound exists for — returning to a slide should not
    // re-read its header, but a slide nobody is looking at need not stay open.
    expect(isEvictableSource(shown(), false)).toBe(true);
});

test("a failed open is evictable however it is pinned @unit", () => {
    // Pinning a failure would leak it for the session; `sourceFor` replaces one
    // on the next request anyway.
    expect(isEvictableSource(failed(), false)).toBe(true);
    expect(isEvictableSource({ ...failed(), __xopatWasShown: false }, false)).toBe(true);
});

test("a session of five mounted sources evicts none, bound or no bound @unit", () => {
    // The deliberate consequence: the bound governs idle retention, not how many
    // slides a session may show at once. `multi-view-goals` needs five open
    // files and the default bound is four.
    const session = [shown(), shown(), shown(), shown(), shown()];
    const evictable = session.filter(s => isEvictableSource(s, true));
    expect(evictable).toEqual([]);
});

test("the first background of a five-entry session survives the fifth insert @unit", () => {
    // The exact sequence that hung: background 0 is still opening when overlay 3
    // is inserted and the trim runs.
    const background0 = opening();
    const laterInserts = [opening(), opening(), opening(), opening()];
    const trimmed = [background0, ...laterInserts].filter(s => isEvictableSource(s, false));
    expect(trimmed).toEqual([]);
});
