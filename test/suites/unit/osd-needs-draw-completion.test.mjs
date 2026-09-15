/**
 * Drawing a tile is not the same as being finished.
 *
 * `TiledImage#setDrawn` decides whether an image stays in the viewer's update
 * loop, and `World#draw` folds it into the world's flag that `updateOnce`
 * consults. Clearing it on "I drew something" abandons an image that still has
 * unloaded tiles in the viewport: `TiledImage#update` has the right gate
 * (`!this._fullyLoaded`), but nothing calls `update()` any more, so the pass
 * that would request the rest never runs.
 *
 * Motion hides it — `viewportChanged` forces passes while the user pans. It only
 * shows at rest, as a slide that stops refining with nothing in flight and no
 * error. Measured on a DICOMweb slide: 255 tiles at the finest level, 7 loaded,
 * 0 loading, `full=false`, `needsDraw=false`; one forced `update(true)`
 * dispatched the rest and sharpened the viewport.
 *
 * So the invariant is: **an image that is visible and not fully loaded keeps
 * asking to be drawn** — while a hidden one still must not spin the loop.
 */
import { test, expect, loadOpenSeadragon } from "@xopat/test-harness";

const { OpenSeadragon, error: loadError } = loadOpenSeadragon();

const setDrawn = OpenSeadragon?.TiledImage?.prototype?.setDrawn;

/**
 * The re-vendor marker for the UPSTREAM.md entry. `setDrawn` cannot honour
 * loading state without naming `_fullyLoaded`, so its absence from the source is
 * exactly "the fix has not landed" — the same capability-probe approach the
 * other entries use, since the bundle's banner version does not move on a fork
 * rebuild.
 */
const fixLanded = typeof setDrawn === "function" && /_fullyLoaded/.test(setDrawn.toString());

/**
 * The slice of a TiledImage that `setDrawn` reads. A plain object is enough:
 * the method touches nothing else.
 */
function image(over = {}) {
    return {
        _isBlending: false,
        _wasBlending: false,
        _fullyLoaded: true,
        opacity: 1,
        _lastDrawn: [],
        ...over,
    };
}

test("@upstream a visible image with tiles left to load keeps asking to be drawn", () => {
    test.skip(Boolean(loadError), loadError ?? "");
    test.skip(!fixLanded, "awaiting the OpenSeadragon re-vendor — see UPSTREAM.md");

    // Drew one tile, but the level is not complete: this is the case that froze.
    const ti = image({ _fullyLoaded: false, _lastDrawn: [{ tile: {} }] });

    expect(setDrawn.call(ti)).toBe(true);
    expect(ti._needsDraw).toBe(true);
});

test("@upstream a finished image settles once it has drawn", () => {
    test.skip(Boolean(loadError), loadError ?? "");

    const ti = image({ _fullyLoaded: true, _lastDrawn: [{ tile: {} }] });

    expect(setDrawn.call(ti)).toBe(false);
    expect(ti._needsDraw).toBe(false);
});

test("@upstream a hidden image does not spin the loop while it loads", () => {
    test.skip(Boolean(loadError), loadError ?? "");
    test.skip(!fixLanded, "awaiting the OpenSeadragon re-vendor — see UPSTREAM.md");

    // Incomplete, but invisible — there is nothing to draw and no reason to keep
    // waking the world for it.
    const ti = image({ _fullyLoaded: false, opacity: 0, _lastDrawn: [{ tile: {} }] });

    expect(setDrawn.call(ti)).toBe(false);
});

test("@upstream an image that drew nothing still asks, as it always did", () => {
    test.skip(Boolean(loadError), loadError ?? "");

    const ti = image({ _fullyLoaded: true, _lastDrawn: [] });

    expect(setDrawn.call(ti)).toBe(true);
});

test("@upstream blending keeps the image in the loop regardless", () => {
    test.skip(Boolean(loadError), loadError ?? "");

    for (const over of [{ _isBlending: true }, { _wasBlending: true }]) {
        const ti = image({ _fullyLoaded: true, _lastDrawn: [{ tile: {} }], ...over });
        expect(setDrawn.call(ti)).toBe(true);
    }
});
