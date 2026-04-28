import { BackgroundConfig } from "../background-config";
import { ViewerSelectionState } from "./viewer-selection-state";

export class ViewerStateBindingController {
    constructor(private readonly appContext: ApplicationContext) {}

    handleSyntheticOpenEvent(viewer: OpenSeadragon.Viewer, successLoadedItemCount: number, totalItemCount: number) {
        const world = viewer.world;
        if (world.getItemCount() < 1) {
            viewer.addTiledImage({
                tileSource: new OpenSeadragon.EmptyTileSource({ height: 20000, width: 20000, tileSize: 512 }),
                index: 0,
                replace: false,
                success: (event: any) => {
                    event.item.getConfig = (_type: string | undefined) => undefined;
                    viewer.toggleDemoPage(true, totalItemCount > 0 ? $.t("error.invalidDataHtml") : undefined);
                    this.finishSyntheticEventWithValidData(viewer, 0);
                }
            });
            return;
        }

        if (successLoadedItemCount === 0) {
            viewer.toggleDemoPage(true, totalItemCount > 0 ? $.t("error.invalidDataHtml") : undefined);
        } else {
            viewer.toggleDemoPage(false);
        }

        this.finishSyntheticEventWithValidData(viewer, 0);
    }

    refreshViewerVisualizationBindings(viewer: OpenSeadragon.Viewer, referenceImage: number) {
        try {
            const tiledImage = viewer.world.getItemAt(referenceImage);
            const dataConfig = tiledImage?.getConfig();

            let name = "";
            if (Number.isInteger(Number.parseInt(dataConfig?.dataReference))) {
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
                    ViewerSelectionState.getViewerSelectionIndex(viewer, "activeVisualizationIndex", this.appContext)
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

            const normalizeViewport = (vp: ViewportSetup) => {
                if (!vp || typeof vp !== "object") return null;
                if (!vp.point || vp.zoomLevel == null) return null;
                return vp;
            };

            const applyViewport = (viewerRef: OpenSeadragon.Viewer, vp: ViewportSetup) => {
                const normalized = normalizeViewport(vp);
                if (!normalized) return false;

                viewerRef.viewport.panTo(new OpenSeadragon.Point(normalized.point!.x, normalized.point!.y), true);
                viewerRef.viewport.zoomTo(normalized.zoomLevel!, undefined, true);
                if (normalized.rotation != null && Number.isFinite(normalized.rotation)) {
                    viewerRef.viewport.setRotation(normalized.rotation, true);
                }
                return true;
            };

            const viewportCacheKey = (viewerRef: OpenSeadragon.Viewer) => {
                const bgCfg = viewerRef.scalebar?.getReferencedTiledImage?.()?.getConfig?.("background");
                const bgId = bgCfg?.id || bgCfg?.dataReference || "unknown-bg";
                return `viewport:${this.appContext.sessionName}:${bgId}`;
            };

            const installViewportCaching = (viewerRef: OpenSeadragon.Viewer) => {
                if (this.appContext.getOption("bypassCache", false)) return;

                const key = viewportCacheKey(viewerRef);
                const snapshot = () => ({
                    zoomLevel: viewerRef.viewport.getZoom(),
                    point: viewerRef.viewport.getCenter(),
                    rotation: viewerRef.viewport.getRotation(),
                });

                const save = UTILITIES.makeThrottled(() => {
                    try {
                        this.appContext.AppCache.set(key, snapshot());
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

                if (Array.isArray(focus)) {
                    for (let i = 0; i < viewers.length; i++) {
                        if (focus[i]) applyViewport(viewers[i], focus[i]);
                    }
                } else if (focus && typeof focus === "object") {
                    for (const viewerRef of viewers) applyViewport(viewerRef, focus);
                } else {
                    for (const viewerRef of viewers) {
                        const cached = this.appContext.AppCache.get(viewportCacheKey(viewerRef));
                        const parsed = typeof cached === "string" ? (() => { try { return JSON.parse(cached); } catch { return null; } })() : cached;
                        if (parsed) applyViewport(viewerRef, parsed);
                    }
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
