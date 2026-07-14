import { BackgroundConfig } from "../background-config";
import { ViewerSelectionState } from "./viewer-selection-state";
import { ViewerFaultySourceRegistry } from "./viewer-faulty-source-registry";
import { snapshotViewport, applyViewport } from "./canonical-scene";

export class ViewerStateBindingController {
    constructor(private readonly appContext: ApplicationContext) {}

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
            const dataConfig = tiledImage?.getConfig();

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

            if (dataConfig) {
                const data = BackgroundConfig.data(dataConfig);
                microns = (data as any).microns || dataConfig.microns;
                micronsX = (data as any).micronsX || dataConfig.micronsX;
                micronsY = (data as any).micronsY || dataConfig.micronsY;

                const hasMicrons = !!microns;
                const hasDimMicrons = !!(micronsX && micronsY);
                if (!hasMicrons || !hasDimMicrons) {
                    const sourceMeta = typeof tiledImage?.source?.getMetadata === "function" && tiledImage.source.getMetadata();
                    if (sourceMeta) {
                        if (!hasMicrons) microns = sourceMeta.microns;
                        if (!hasDimMicrons) {
                            micronsX = sourceMeta.micronsX;
                            micronsY = sourceMeta.micronsY;
                        }
                    }
                }
            }

            UTILITIES.setImageMeasurements(viewer, microns, micronsX, micronsY, name ?? "Unknown");
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
                return `viewport:${this.appContext.sessionName}:${bgId}`;
            };

            const installViewportCaching = (viewerRef: OpenSeadragon.Viewer) => {
                if (this.appContext.getOption("bypassCache", false)) return;

                const key = viewportCacheKey(viewerRef);
                const save = UTILITIES.makeThrottled(() => {
                    try {
                        this.appContext.AppCache.set(key, snapshotViewport(viewerRef));
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
                const focus = this.appContext.getOption("viewport", null, true, true);
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
                    for (const viewerRef of viewers) {
                        const cached = this.appContext.AppCache.get(viewportCacheKey(viewerRef));
                        const parsed = typeof cached === "string" ? (() => { try { return JSON.parse(cached); } catch { return null; } })() : cached;
                        if (parsed && applyViewport(viewerRef, parsed)) applied.add(viewerRef);
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
