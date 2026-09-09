/**
 * When an open slide may be closed.
 *
 * The source cache keeps parsed slides around because rebuilding one means
 * re-reading the header and re-fetching every block — returning to a slide would
 * otherwise cost what opening it did. Keeping them is not free (a wasm block
 * cache per worker that touched the file), so the map is bounded and the oldest
 * *idle* source is closed.
 *
 * The policy lives here rather than beside the cache because it is the part that
 * was wrong and the part worth testing: "idle" is not "no viewer is showing it".
 * A source is in no viewer's world for the whole time its header is in flight,
 * and again between the header landing and the tiled image being mounted. Read
 * as idle, it was closed mid-open — and the awaited ready-deferred then never
 * settled, so the viewport showed "Loading…" for ever with no error anywhere.
 *
 * Ordinary sessions reach that: the map counts overlays as well as backgrounds,
 * so anything naming more entries than `maxOpenSlides` trimmed while still
 * opening. `multi-view-goals` (5 entries) and `all-shaders` (8) hung;
 * `basic-overlay` (4) did not.
 *
 * @module webtiff/source-cache
 */

/**
 * Is this source safe to close?
 *
 * Never-shown and no-longer-shown are different states, and only the second one
 * is idle. A failed open is evictable whatever its history — pinning a failure
 * would leak it for the session, and `sourceFor` replaces one on the next
 * request anyway.
 *
 * Deliberate consequence: when every source is in use the map exceeds its bound.
 * The bound governs *idle retention*, not how many slides a session may show at
 * once — a session needing five open files needs five open files.
 *
 * @param {{__xopatWasShown?: boolean, __xopatOpenFailure?: string}} source
 * @param {boolean} inWorld whether a viewer is rendering it right now
 * @return {boolean}
 */
export function isEvictableSource(source, inWorld) {
    if (source?.__xopatOpenFailure) return true;
    if (inWorld) return false;
    return !!source?.__xopatWasShown;
}
