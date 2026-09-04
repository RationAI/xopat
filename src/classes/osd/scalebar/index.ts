/**
 * Scalebar — installs `OpenSeadragon.Scalebar`, `Viewer.prototype.makeScalebar`,
 * the `ScalebarType` / `ScalebarLocation` / `ScalebarSizeAndTextRenderer`
 * namespaces and the multi-viewer sync chrome onto the OpenSeadragon namespace.
 *
 * Was `src/external/scalebar.js`, one 3388-line IIFE loaded as its own startup
 * <script>. Importing this module from `src/app.ts` folds the whole thing into
 * `dist/app.js`.
 *
 * Module layout:
 *   constants.ts          magnification ladder, quick-zoom floor, AppCache key
 *   units.ts              unit/number formatting + `ScalebarSizeAndTextRenderer`
 *   chrome.ts             magnification panel, quick-zoom row, sync menu
 *   viewport-sync-api.ts  `ViewportSyncAPI` — multi-viewer alignment
 *   scalebar.ts           `Scalebar` itself + `makeScalebar` (imports the above)
 */
import "./scalebar";

export {};
