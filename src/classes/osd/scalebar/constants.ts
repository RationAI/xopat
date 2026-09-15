// @ts-nocheck -- mechanical port of the former `src/external/scalebar.js`.
// Split out of the single 3388-line IIFE and moved into the core TS build so
// esbuild inlines it into `dist/app.js` instead of shipping it as a separate
// startup <script>. Bodies are unchanged JS; typing them is deliberate
// follow-up work and must not be mixed into a behaviour-identical move.


/**
 * Standard objective-magnification ladder used both by the magnification
 * slider pips and by scroll-to-zoom snapping (loader.ts canvas-scroll).
 * Single source of truth so the two paths never diverge.
 * @type {number[]}
 */
const MAGNIFICATION_STEPS = [
    0.01, 0.02, 0.05,
    0.1, 0.2, 0.5,
    1, 2, 5,
    10, 20, 40,
    80, 160, 240, 480
];

/**
 * Lowest magnification offered as a quick-zoom button in the collapsed
 * panel. Below this the "fit the slide" (home) button is the useful
 * control, and the ladder would grow long enough to break the single row.
 * @type {number}
 */
const QUICK_ZOOM_MIN_MAGNIFICATION = 5;

/**
 * AppCache key backing the collapsed/expanded state of the magnification
 * panel. A user preference — never a security decision.
 * @type {string}
 */
const COLLAPSED_CACHE_KEY = "scalebarPanelCollapsed";

/**
 * Read the persisted collapse preference. Defaults to collapsed: the panel
 * is 210px of sliders over the slide, the collapsed row covers the common
 * case. Guarded — the playground / isolated viewer boots scalebars without
 * a full application context.
 * @return {boolean}
 */
function readCollapsedPreference() {
    const cached = window.APPLICATION_CONTEXT?.AppCache?.get?.(COLLAPSED_CACHE_KEY, true);
    return cached === undefined || cached === null ? true : cached === true || cached === "true";
}

export {
    MAGNIFICATION_STEPS,
    QUICK_ZOOM_MIN_MAGNIFICATION,
    COLLAPSED_CACHE_KEY,
    readCollapsedPreference,
};
