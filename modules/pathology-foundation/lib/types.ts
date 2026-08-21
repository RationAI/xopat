/**
 * Shared value types for the pathology engine's pure layer.
 *
 * These are deliberately free of viewer, driver and DOM references so every helper
 * built on them stays unit-testable without a browser or a slide. The module's
 * public API re-exports them from `pathologyFoundation.ts`, which remains the single
 * import surface for anything outside this module.
 */

/** A point in whatever coordinate space the caller is working in (raster or image). */
export type Point = { x: number; y: number };

/** Image-space bounding box of a result, for navigation (`viewer.frameImageRegion`). */
export interface Bounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Binary mask in the background-render pixel space (1 = foreground). */
export interface MaskResult {
    binaryMask: Uint8Array;
    width: number;
    height: number;
    label?: string;
    score?: number;
}
