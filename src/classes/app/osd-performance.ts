/**
 * Device-aware OpenSeadragon performance profile.
 *
 * xOpat runs on everything from low-end phones to 4K / ultrawide / multi-monitor
 * pathology walls, and every viewport builds its OWN OSD tile cache + image loader
 * (per-viewer, not shared). None of OSD's cache / draw-loop / render-order knobs
 * scale with the display out of the box, so a fixed default is simultaneously too
 * small on a wide screen and wasteful on a phone.
 *
 * This module is the single generic source of those defaults. The two viewer
 * factories (`ViewerManager.add` in `src/loader.ts` and `setupIsolatedViewer` in
 * `setup-isolated-viewer.ts`) merge the returned object as the LOWEST-precedence
 * layer, so `ENV.openSeadragonConfiguration` / `ENV.client.osdOptions` / an explicit
 * `maxImageCacheCount` still override it — deployments keep an escape hatch, but we
 * never hardcode per-device values in `config.json`.
 *
 * All returned options (`maxImageCacheCount`, `maxTilesPerFrame`, `imageLoaderLimit`,
 * `immediateRender`, `minPixelRatio`) are read at Viewer construction and are
 * drawer-agnostic (core `TiledImage` / `ImageLoader` / `World`), so they work with
 * the custom `flex-renderer` WebGL2 drawer.
 */

export type DeviceClass = "mobile" | "desktop";

// --- Adaptive tile-cache constants -----------------------------------------

/** Proven baseline cache size, calibrated at the baseline resolution below. */
const CACHE_BASELINE_COUNT = 1500;
/** Reference display area (1080p) at which the baseline count applies verbatim. */
const CACHE_BASELINE_AREA = 1920 * 1080;
/** devicePixelRatio is capped so a 3x phone panel doesn't explode the budget. */
const DPR_CAP = 2;
/** Per-viewer clamps: [min, max] cache records. */
const CACHE_CLAMP: Record<DeviceClass, [number, number]> = {
    desktop: [1000, 4000],
    mobile: [600, 1500],
};

// --- Draw-loop / render-order profile per device class ---------------------

interface RenderProfile {
    /** New tiles uploaded+drawn per render frame. OSD default 1 fills wide screens slowly. */
    maxTilesPerFrame: number;
    /** Cap on concurrent tile requests. OSD default 0 = unbounded (connection thrash on wide displays). */
    imageLoaderLimit: number;
    /** true = jump straight to the target level (skip loading every coarse level first). */
    immediateRender: boolean;
    /** How eagerly higher-detail tiles load; higher = fewer over-detailed fetches. */
    minPixelRatio: number;
}

const RENDER_PROFILE: Record<DeviceClass, RenderProfile> = {
    // "Balanced" desktop bias: noticeably faster wide-screen fill, gentle GPU/network bursts.
    desktop: { maxTilesPerFrame: 4, imageLoaderLimit: 6, immediateRender: false, minPixelRatio: 0.5 },
    // Mobile: cheaper draw loop + skip the blurry->sharp cascade (the render-order lever
    // OSD's own docstring recommends flipping on for phones), fetch fewer over-detailed tiles.
    mobile: { maxTilesPerFrame: 2, imageLoaderLimit: 4, immediateRender: true, minPixelRatio: 0.8 },
};

/**
 * Classify the current device. Deliberately conservative: only phones/small touch
 * devices are "mobile" (tablets stay "desktop" — they can drive the full pipeline).
 * Mirrors the touch/iOS heuristics already used elsewhere without importing OSD internals.
 */
export function getDeviceClass(): DeviceClass {
    if (typeof navigator === "undefined" || typeof window === "undefined") return "desktop";
    const ua = navigator.userAgent || "";
    const isIOS = /iPhone|iPod/.test(ua) ||
        // iPadOS reports as Mac; disambiguate via touch points.
        (/Mac/.test(ua) && (navigator.maxTouchPoints || 0) > 1 && /Mobile/.test(ua));
    const isAndroidPhone = /Android/.test(ua) && /Mobile/.test(ua);
    const coarsePointer = typeof window.matchMedia === "function" &&
        window.matchMedia("(pointer: coarse)").matches;
    const smallScreen = Math.min(window.innerWidth, window.innerHeight) <= 820;
    if (isIOS || isAndroidPhone) return "mobile";
    // Fallback: a coarse-pointer, small-screen, touch-capable device with no mouse.
    if (coarsePointer && smallScreen && (navigator.maxTouchPoints || 0) > 0) return "mobile";
    return "desktop";
}

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

export interface OsdPerformanceInput {
    /** Logical (CSS px) viewport width, e.g. `window.innerWidth`. */
    width: number;
    /** Logical (CSS px) viewport height, e.g. `window.innerHeight`. */
    height: number;
    /** `window.devicePixelRatio`. */
    dpr: number;
    /** Device classification; defaults to `getDeviceClass()` when omitted. */
    deviceClass?: DeviceClass;
    /** Number of viewports the cache budget is split across (soft split). Default 1. */
    viewportCount?: number;
}

export interface OsdPerformanceOptions {
    maxImageCacheCount: number;
    maxTilesPerFrame: number;
    imageLoaderLimit: number;
    immediateRender: boolean;
    minPixelRatio: number;
}

/**
 * Compute the adaptive per-viewer OSD performance options for the current display.
 * The cache scales the proven baseline by relative device-pixel area (unchanged at
 * 1080p, larger on 4K/hi-DPI, smaller on phones) and is softly divided across
 * open viewports so total RAM stays bounded.
 */
export function computeOsdPerformanceOptions(input: OsdPerformanceInput): OsdPerformanceOptions {
    const deviceClass = input.deviceClass ?? getDeviceClass();
    const dpr = clamp(input.dpr || 1, 1, DPR_CAP);
    const viewportCount = Math.max(1, input.viewportCount || 1);

    const area = Math.max(1, input.width * input.height) * dpr * dpr;
    let budget = Math.round(CACHE_BASELINE_COUNT * (area / CACHE_BASELINE_AREA));
    if (viewportCount > 1) budget = Math.round(budget / Math.sqrt(viewportCount));
    const [min, max] = CACHE_CLAMP[deviceClass];
    const maxImageCacheCount = clamp(budget, min, max);

    return { ...RENDER_PROFILE[deviceClass], maxImageCacheCount };
}
