import { BackgroundConfig } from "../background-config";
import { ViewerSelectionState } from "./viewer-selection-state";
import { ViewerFaultySourceRegistry } from "./viewer-faulty-source-registry";
import { snapshotViewport, applyViewport } from "./canonical-scene";

/**
 * Where the "reopen a slide where you left it" memory lives — ONE AppCache
 * entry holding a bounded map, not a key per slide.
 *
 * The previous shape wrote `viewport:<session>:<background>` per slide, on every
 * throttled zoom/pan/rotate, and never removed anything: localStorage grew by
 * one permanent key for every slide the user ever opened. A single pruned map
 * is bounded by construction.
 */
const VIEWPORT_CACHE_KEY = "viewport-cache";
/** Most recently touched entries kept. Small: this is a convenience, not state. */
const VIEWPORT_CACHE_LIMIT = 25;
/** Entries older than this are dropped even when the map is not full. */
const VIEWPORT_CACHE_MAX_AGE_MS = 30 * 24 * 3600e3;
/** Marker for the one-shot cleanup of the pre-map key layout. */
const VIEWPORT_SWEEP_MARKER = "viewport-cache-swept";

export class ViewerStateBindingController {
    constructor(private readonly appContext: ApplicationContext) {}

    /**
     * Read the viewport map, dropping entries that aged out.
     * Anything unparseable degrades to an empty map — this is a convenience
     * cache and must never be able to break a viewer open.
     */
    private readViewportCache(): Record<string, { viewport: any; t: number }> {
        const raw = this.appContext.AppCache.get(VIEWPORT_CACHE_KEY, null);
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
        const now = Date.now();
        const out: Record<string, { viewport: any; t: number }> = {};
        for (const [k, v] of Object.entries(raw as Record<string, any>)) {
            if (!v || typeof v !== "object" || !v.viewport) continue;
            if (typeof v.t !== "number" || now - v.t > VIEWPORT_CACHE_MAX_AGE_MS) continue;
            out[k] = { viewport: v.viewport, t: v.t };
        }
        return out;
    }

    private writeViewportCache(key: string, viewport: any) {
        const map = this.readViewportCache();
        map[key] = { viewport, t: Date.now() };
        const keys = Object.keys(map);
        if (keys.length > VIEWPORT_CACHE_LIMIT) {
            // LRU by last write. Sorting a ≤26-entry map is free next to the
            // storage write it precedes.
            keys.sort((a, b) => map[b]!.t - map[a]!.t)
                .slice(VIEWPORT_CACHE_LIMIT)
                .forEach(k => { delete map[k]; });
        }
        this.appContext.AppCache.set(VIEWPORT_CACHE_KEY, map);
    }

    /**
     * One-shot removal of the pre-map layout: `viewport:<session>:<bg>` keys
     * (sanitized to `viewport_…` on the way into storage), plus any value that
     * is the literal `"[object Object]"` — what `KV.set` wrote for every object
     * before the value envelope existed, and therefore unrecoverable.
     *
     * Targeted, never a blanket `clear()`: this owner's cache also holds UI
     * preferences that are perfectly fine.
     */
    private sweepLegacyViewportCache() {
        const cache = this.appContext.AppCache;
        if (cache.get(VIEWPORT_SWEEP_MARKER, false) === true) return;
        try {
            for (const key of cache.keys()) {
                if (key === VIEWPORT_CACHE_KEY) continue;
                const isLegacyViewport = key.startsWith("viewport_") || key.startsWith("viewport:");
                if (isLegacyViewport || cache.getStore().getItem(key) === "[object Object]") {
                    cache.delete(key);
                }
            }
        } catch (e) {
            console.debug("Viewport cache sweep skipped.", e);
        }
        cache.set(VIEWPORT_SWEEP_MARKER, true);
    }

    handleSyntheticOpenEvent(viewer: OpenSeadragon.Viewer) {
        const world = viewer.world;
        if (world.getItemCount() < 1) {
            viewer.addTiledImage({
                tileSource: new OpenSeadragon.EmptyTileSource({ height: 20000, width: 20000, tileSize: 512 }),
                index: 0,
                replace: false,
                success: (event: any) => {
                    event.item.getConfig = (_type: string | undefined) => undefined;
                    // Late-fire guard: if a real slide load (or another reset)
                    // completed between addTiledImage scheduling and this
                    // callback resolving, the world either no longer contains
                    // this EmptyTileSource or contains real content alongside
                    // it. Toggling the demo overlay or raising a synthetic
                    // open here would shadow the real open that already ran.
                    const onlyItem = viewer.world.getItemAt(0);
                    if (viewer.world.getItemCount() !== 1 || onlyItem !== event.item) return;
                    this.finishSyntheticEventWithValidData(viewer, 0);
                }
            });
            return;
        }
        this.finishSyntheticEventWithValidData(viewer, 0);
    }

    refreshViewerVisualizationBindings(viewer: OpenSeadragon.Viewer, referenceImage: number) {
        try {
            const tiledImage = viewer.world.getItemAt(referenceImage);
            const dataConfig = tiledImage?.getConfig?.();

            // Persisted faulty verdict wins over the live world-item shape: a
            // source that failed instantiation OR accumulated too many tile
            // failures stays "faulty" even after a visualization switch
            // re-attaches a (superficially healthy) item at this slot.
            const faultyKey = ViewerFaultySourceRegistry.keyForItem(tiledImage);
            const isFaulty = !!(viewer as any).__faultySources?.isFaulty?.(faultyKey);

            let name = "";
            if (isFaulty) {
                const active = this.appContext.getOption("activeBackgroundIndex", undefined, true, true)?.[0];
                name = UTILITIES.fileNameFromPath(String(this.appContext.config.data[active ?? 0] ?? "unknown"));
                viewer.getMenu().getNavigatorTab().setTitle($.t("main.navigator.faultyTissue", { slide: name }), true);
            } else if (Number.isInteger(Number.parseInt(dataConfig?.dataReference))) {
                name = dataConfig.name || UTILITIES.fileNameFromPath(
                    String(this.appContext.config.data[dataConfig.dataReference as number] ?? "")
                );
                viewer.getMenu().getNavigatorTab().setTitle(name, false);
            } else if (!dataConfig && this.appContext.config.background.length > 0) {
                const active = this.appContext.getOption("activeBackgroundIndex", undefined, true, true)?.[0];
                name = UTILITIES.fileNameFromPath(String(this.appContext.config.data[active ?? 0] ?? "unknown"));
                viewer.getMenu().getNavigatorTab().setTitle($.t("main.navigator.faultyTissue", { slide: name }), true);
            } else if (!dataConfig) {
                viewer.getMenu().getNavigatorTab().setTitle($.t("main.navigator.faultyViz"), true);
            } else {
                name = dataConfig.name || $.t("common.Image");
                viewer.getMenu().getNavigatorTab().setTitle(name, false);
            }

            let microns: number | undefined;
            let micronsX: number | undefined;
            let micronsY: number | undefined;
            // Distinct from `undefined`: `null` is the source saying "this modality
            // has no optical magnification", which is not the same as "I don't know".
            let magnification: number | null | undefined;

            if (dataConfig) {
                const data = BackgroundConfig.data(dataConfig);
                microns = (data as any).microns || dataConfig.microns;
                micronsX = (data as any).micronsX || dataConfig.micronsX;
                micronsY = (data as any).micronsY || dataConfig.micronsY;
                magnification = (data as any).magnification ?? dataConfig.magnification;

                const hasMicrons = !!microns;
                const hasDimMicrons = !!(micronsX && micronsY);
                if (!hasMicrons || !hasDimMicrons || magnification === undefined) {
                    const sourceMeta = typeof tiledImage?.source?.getMetadata === "function" && tiledImage.source.getMetadata();
                    if (sourceMeta) {
                        if (!hasMicrons) microns = sourceMeta.microns;
                        if (!hasDimMicrons) {
                            micronsX = sourceMeta.micronsX;
                            micronsY = sourceMeta.micronsY;
                        }
                        if (magnification === undefined) magnification = sourceMeta.magnification;
                    }
                }
            }

            UTILITIES.setImageMeasurements(viewer, microns, micronsX, micronsY, name ?? "Unknown", magnification);
            viewer.scalebar.linkReferenceTileSourceIndex(referenceImage);

            if (this.appContext.config.visualizations.length > 0) {
                viewer.getMenu().getShadersTab().updateVisualizationList(
                    this.appContext.config.visualizations,
                    ViewerSelectionState.getViewerVisualizationIndex(viewer, this.appContext)
                );
            }
        } catch (e) {
            console.error(e);
        }

        if (this.appContext.config.visualizations.length > 0) {
            viewer.raiseEvent("visualization-ready", { viewer });
        }
    }

    private finishSyntheticEventWithValidData(viewer: OpenSeadragon.Viewer, referenceImage: number) {
        // Set active viewer as soon as possible
        if (!window.VIEWER) {
            VIEWER_MANAGER.setActive(0, "open-complete");
        }

        const eventOpts: Record<string, any> = {};

        this.refreshViewerVisualizationBindings(viewer, referenceImage);

        if (!(viewer as any).__initialized) {
            (viewer as any).__initialized = true;
            eventOpts.firstLoad = true;

            const viewportCacheKey = (viewerRef: OpenSeadragon.Viewer) => {
                const bgCfg = viewerRef.scalebar?.getReferencedTiledImage?.()?.getConfig?.("background");
                const bgId = bgCfg?.id || bgCfg?.dataReference || "unknown-bg";
                // `appContext.sessionName` resolves against the *focused* viewer (global
                // VIEWER), so in a grid it pairs one viewer's session with another's
                // background id. This viewer's own declaration wins when it has one; the
                // single-viewer key is unchanged, since that is the value the getter
                // returns anyway.
                const session = bgCfg?.sessionName || this.appContext.sessionName;
                return `${session}::${bgId}`;
            };

            if (!this.appContext.getOption("bypassCache")) this.sweepLegacyViewportCache();

            const installViewportCaching = (viewerRef: OpenSeadragon.Viewer) => {
                if (this.appContext.getOption("bypassCache")) return;

                // Key resolved per save, not captured at install: this viewer
                // outlives the slide it was opened with, and a key captured here
                // would file every later slide's viewport under the first one.
                const save = UTILITIES.makeThrottled(() => {
                    try {
                        this.writeViewportCache(viewportCacheKey(viewerRef), snapshotViewport(viewerRef));
                    } catch (e) {
                        console.warn("Failed to cache viewport", e);
                    }
                }, 150);

                const onZoom = () => save();
                const onPan = () => save();
                const onRotate = () => save();

                viewerRef.addHandler("zoom", onZoom);
                viewerRef.addHandler("pan", onPan);
                viewerRef.addHandler("rotate", onRotate);

                viewerRef.addHandler("destroy", () => {
                    try { save.finish?.(); } catch (_) {}
                    viewerRef.removeHandler("zoom", onZoom);
                    viewerRef.removeHandler("pan", onPan);
                    viewerRef.removeHandler("rotate", onRotate);
                });
            };

            (() => {
                const viewers = (window.VIEWER_MANAGER?.viewers || []).filter(Boolean);
                const focus = this.appContext.getOption("viewport", undefined, true, true);
                const applied = new Set<OpenSeadragon.Viewer>();

                if (Array.isArray(focus)) {
                    for (let i = 0; i < viewers.length; i++) {
                        if (focus[i] && applyViewport(viewers[i], focus[i])) applied.add(viewers[i]);
                    }
                } else if (focus && typeof focus === "object") {
                    for (const viewerRef of viewers) {
                        if (applyViewport(viewerRef, focus)) applied.add(viewerRef);
                    }
                } else {
                    const cache = this.readViewportCache();
                    for (const viewerRef of viewers) {
                        const cached = cache[viewportCacheKey(viewerRef)]?.viewport;
                        if (cached && applyViewport(viewerRef, cached)) applied.add(viewerRef);
                    }
                }

                // Multi-viewport startup quirk: the first viewer is created while
                // the stretch grid still has one cell, so its OSD containerSize
                // gets cached at full width. Adding the second viewer reflows
                // the grid, but OSD's built-in goHome (fired from addTiledImage
                // success) preserves the visual scale rather than refitting,
                // leaving viewer 0 zoomed against its pre-reflow size. Refit
                // viewers that no session/cache focus has claimed — applied
                // viewers keep the explicit pan/zoom set by applyViewport.
                for (const viewerRef of viewers) {
                    if (applied.has(viewerRef)) continue;
                    try { viewerRef.forceResize?.(); } catch (_) {}
                    try { viewerRef.viewport?.goHome?.(true); } catch (_) {}
                }

                for (const viewerRef of viewers) installViewportCaching(viewerRef);
            })();

            try {
                if (window.opener && (window.opener as any).VIEWER) {
                    ((viewer as any).tools as any).link("external_window");
                    (((window.opener as any).VIEWER as any).tools as any).link("external_window");
                }
            } catch (e) {
                // opener access can throw
            }
        } else {
            eventOpts.firstLoad = false;
        }

        eventOpts.source = viewer.world.getItemAt(0)?.source;
        eventOpts.firstLoad = true;
        viewer.raiseEvent("open", eventOpts);
    }
}
