import { ViewerSelectionState } from "./viewer-selection-state";

export class ViewerInspectorController {
    private static readonly INSPECTOR_RADIUS_MIN = 24;
    private static readonly INSPECTOR_RADIUS_MAX = 320;
    private static readonly INSPECTOR_ALLOWED_MODES = new Set(["reveal-inside", "reveal-outside", "lens-zoom"]);
    private static readonly VALUE_INSPECTOR_PANEL_ID_PREFIX = "xopat-value-inspector";
    private static readonly VALUE_INSPECTOR_PLUGIN_ID = "__xopat_value_inspector__";
    private static readonly VALUE_INSPECTOR_THROTTLE_MS = 60;

    constructor(
        private readonly appContext: ApplicationContext,
        private readonly getConfig: () => any
    ) {}

    registerViewerHooks(viewerManager: any) {
        viewerManager.addHandler("viewer-create", (event: any) => {
            if (event?.viewer) {
                this.ensureViewerVisualizationInspectorTracking(event.viewer);
                this.ensureViewerValueInspectorTracking(event.viewer);
            }
        });
        viewerManager.addHandler("after-open", () => {
            if (this.appContext.getOption("visualizationInspectorEnabled", false, true)) {
                this.refreshVisualizationInspector();
            }
            if (this.appContext.getOption("valueInspectorEnabled", false, true)) {
                this.refreshValueInspector();
            }
        });
    }

    registerUtilities() {
        window.UTILITIES.toggleVisualizationInspector = (enabled?: boolean) => {
            const next = enabled === undefined
                ? !this.appContext.getOption("visualizationInspectorEnabled", false, true)
                : !!enabled;

            this.appContext.setOption("visualizationInspectorEnabled", next);
            this.appContext.setDirty();
            this.refreshVisualizationInspector();
            UTILITIES.syncSessionToUrl(false);
            return next;
        };

        window.UTILITIES.setVisualizationInspectorRadius = (radiusPx: number) => {
            const next = Math.max(
                ViewerInspectorController.INSPECTOR_RADIUS_MIN,
                Math.min(ViewerInspectorController.INSPECTOR_RADIUS_MAX, Math.round(Number(radiusPx) || 96))
            );

            this.appContext.setOption("visualizationInspectorRadiusPx", next);
            this.appContext.setDirty();
            this.refreshVisualizationInspector();
            UTILITIES.syncSessionToUrl(false);
            return next;
        };

        window.UTILITIES.adjustVisualizationInspectorRadius = (deltaPx: number) => {
            return window.UTILITIES.setVisualizationInspectorRadius(this.getVisualizationInspectorRadius() + deltaPx);
        };

        window.UTILITIES.setVisualizationInspectorMode = (mode: string) => {
            const next = typeof mode === "string" && ViewerInspectorController.INSPECTOR_ALLOWED_MODES.has(mode)
                ? mode
                : "reveal-inside";

            this.appContext.setOption("visualizationInspectorMode", next);
            this.appContext.setDirty();
            this.refreshVisualizationInspector();
            UTILITIES.syncSessionToUrl(false);
            return next;
        };

        window.UTILITIES.toggleValueInspector = (enabled?: boolean) => {
            const next = enabled === undefined
                ? !this.appContext.getOption("valueInspectorEnabled", false, true)
                : !!enabled;

            this.appContext.setOption("valueInspectorEnabled", next);
            this.appContext.setDirty();
            this.refreshValueInspector();
            UTILITIES.syncSessionToUrl(false);
            return next;
        };
    }

    refreshVisualizationInspector() {
        for (const viewer of window.VIEWER_MANAGER?.viewers || []) {
            this.applyViewerVisualizationInspector(viewer);
        }
        USER_INTERFACE.AppBar?.Edit?.refresh?.();
    }

    refreshValueInspector() {
        for (const viewer of window.VIEWER_MANAGER?.viewers || []) {
            if (this.getValueInspectorEnabled()) {
                this.renderViewerValueInspector(viewer);
            } else {
                this.hideViewerValueInspector(viewer);
            }
        }
        USER_INTERFACE.AppBar?.Edit?.refresh?.();
    }

    private countNestedShaderLayers(shaderConfig: any): number {
        if (!shaderConfig || typeof shaderConfig !== "object") {
            return 0;
        }

        let count = 1;
        if (shaderConfig.shaders && typeof shaderConfig.shaders === "object" && !Array.isArray(shaderConfig.shaders)) {
            for (const childShaderConfig of Object.values(shaderConfig.shaders)) {
                count += this.countNestedShaderLayers(childShaderConfig);
            }
        }
        return count;
    }

    private getViewerInspectorBackgroundIndices(viewer: OpenSeadragon.Viewer): number[] {
        const manager = window.VIEWER_MANAGER;
        const activeBackgroundSelection = ViewerSelectionState.normalizeSelectionValue(
            this.appContext.getOption("activeBackgroundIndex", undefined, true, true)
        ) || [];

        if (activeBackgroundSelection.length < 2 || !manager?.getViewerIndex) {
            return activeBackgroundSelection.filter(Number.isInteger) as number[];
        }

        const viewerIndex = manager.getViewerIndex(viewer.uniqueId, false);
        if (!Number.isInteger(viewerIndex) || viewerIndex < 0) {
            return activeBackgroundSelection.filter(Number.isInteger) as number[];
        }

        const selected = activeBackgroundSelection[viewerIndex];
        return Number.isInteger(selected) ? [selected] : [];
    }

    private getViewerInspectorShaderSplitIndex(viewer: OpenSeadragon.Viewer): number {
        let count = 0;
        const config = this.getConfig();

        for (const bgIndex of this.getViewerInspectorBackgroundIndices(viewer)) {
            const background = config.background?.[bgIndex];
            if (!background) continue;

            let shaders = background.shaders;
            if (!Array.isArray(shaders) || shaders.length < 1) {
                shaders = [{ type: "identity" }];
            }

            for (const shaderConfig of shaders) {
                count += this.countNestedShaderLayers(shaderConfig);
            }
        }

        return count;
    }

    private getVisualizationInspectorMode() {
        const mode = this.appContext.getOption("visualizationInspectorMode", "reveal-inside");
        return typeof mode === "string" && ViewerInspectorController.INSPECTOR_ALLOWED_MODES.has(mode) ? mode : "reveal-inside";
    }

    private getVisualizationInspectorRadius() {
        const radius = Number(this.appContext.getOption("visualizationInspectorRadiusPx", 96));
        return Math.max(
            ViewerInspectorController.INSPECTOR_RADIUS_MIN,
            Math.min(ViewerInspectorController.INSPECTOR_RADIUS_MAX, Number.isFinite(radius) ? radius : 96)
        );
    }

    private getVisualizationInspectorLensZoom() {
        const lensZoom = Number(this.appContext.getOption("visualizationInspectorLensZoom", 2));
        return Math.max(1, Number.isFinite(lensZoom) ? lensZoom : 2);
    }

    private viewerSupportsVisualizationInspector(viewer: OpenSeadragon.Viewer | undefined | null) {
        return !!(
            viewer?.drawer &&
            typeof viewer.drawer.getType === "function" &&
            viewer.drawer.getType() === "flex-renderer" &&
            typeof (viewer.drawer as any).setInspectorState === "function"
        );
    }

    private clearViewerVisualizationInspector(viewer: OpenSeadragon.Viewer | undefined | null) {
        if (!this.viewerSupportsVisualizationInspector(viewer)) {
            return false;
        }

        delete (viewer as any).__xopatInspectorLastClientPoint;
        if (typeof (viewer!.drawer as any).clearInspectorState === "function") {
            (viewer!.drawer as any).clearInspectorState();
        } else {
            (viewer!.drawer as any).setInspectorState(undefined);
        }
        return true;
    }

    private buildViewerVisualizationInspectorState(
        viewer: OpenSeadragon.Viewer,
        clientPoint: { x: number; y: number }
    ) {
        if (!this.appContext.getOption("visualizationInspectorEnabled", false, true)) {
            return undefined;
        }

        const canvas = viewer.drawer?.canvas;
        if (!canvas) {
            return undefined;
        }

        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return undefined;
        }

        const x = clientPoint.x - rect.left;
        const y = rect.height - (clientPoint.y - rect.top);
        if (x < 0 || x > rect.width || y < 0 || y > rect.height) {
            return undefined;
        }

        const radiusPx = this.getVisualizationInspectorRadius();
        return {
            enabled: true,
            mode: this.getVisualizationInspectorMode(),
            centerPx: { x, y },
            radiusPx,
            featherPx: Math.max(8, Math.round(radiusPx * 0.18)),
            lensZoom: this.getVisualizationInspectorLensZoom(),
            shaderSplitIndex: this.getViewerInspectorShaderSplitIndex(viewer),
        };
    }

    private applyViewerVisualizationInspector(
        viewer: OpenSeadragon.Viewer | undefined | null,
        clientPoint?: { x: number; y: number } | null
    ) {
        if (!this.viewerSupportsVisualizationInspector(viewer)) {
            return false;
        }

        if (!this.appContext.getOption("visualizationInspectorEnabled", false, true)) {
            return this.clearViewerVisualizationInspector(viewer);
        }

        if (clientPoint) {
            (viewer as any).__xopatInspectorLastClientPoint = clientPoint;
        }

        const effectivePoint = clientPoint || (viewer as any).__xopatInspectorLastClientPoint;
        if (!effectivePoint) {
            return this.clearViewerVisualizationInspector(viewer);
        }

        const state = this.buildViewerVisualizationInspectorState(viewer!, effectivePoint);
        if (!state) {
            return this.clearViewerVisualizationInspector(viewer);
        }

        (viewer!.drawer as any).setInspectorState(state);
        return true;
    }

    private ensureViewerVisualizationInspectorTracking(viewer: OpenSeadragon.Viewer | undefined | null) {
        if (!viewer || !this.viewerSupportsVisualizationInspector(viewer) || (viewer as any).__xopatInspectorTracker) {
            return;
        }

        (viewer as any).__xopatInspectorTracker = new OpenSeadragon.MouseTracker({
            element: viewer.container,
            moveHandler: (event: any) => {
                const original = event?.originalEvent as MouseEvent | undefined;
                if (!original) return;

                this.applyViewerVisualizationInspector(viewer, {
                    x: original.clientX ?? original.x,
                    y: original.clientY ?? original.y,
                });
            },
            leaveHandler: () => {
                this.clearViewerVisualizationInspector(viewer);
            }
        });

        viewer.addOnceHandler?.("destroy", () => {
            try {
                (viewer as any).__xopatInspectorTracker?.destroy?.();
            } catch (error) {
                console.warn("Visualization inspector tracker destroy failed.", error);
            }
            delete (viewer as any).__xopatInspectorTracker;
            delete (viewer as any).__xopatInspectorLastClientPoint;
        });
    }

    private getValueInspectorEnabled() {
        return !!this.appContext.getOption("valueInspectorEnabled", false, true);
    }

    private getViewerValueInspectorPanelId(viewer: OpenSeadragon.Viewer) {
        return `${ViewerInspectorController.VALUE_INSPECTOR_PANEL_ID_PREFIX}-${UTILITIES.sanitizeID(String(viewer.uniqueId || viewer.id || "viewer"))}`;
    }

    private getViewerSelectionIndex(
        viewer: OpenSeadragon.Viewer,
        optionKey: "activeBackgroundIndex" | "activeVisualizationIndex"
    ): number | undefined {
        return ViewerSelectionState.getViewerSelectionIndex(viewer, optionKey, this.appContext);
    }

    private getViewerValueInspectorSelectionIndex(viewer: OpenSeadragon.Viewer): number | undefined {
        return this.getViewerSelectionIndex(viewer, "activeVisualizationIndex");
    }

    private getViewerValueInspectorVisualization(viewer: OpenSeadragon.Viewer): VisualizationItem | undefined {
        const index = this.getViewerValueInspectorSelectionIndex(viewer);
        const config = this.getConfig();
        return Number.isInteger(index) ? config.visualizations?.[index] : undefined;
    }

    private formatPixelValue(pixel?: ArrayLike<number> | null) {
        if (!pixel || pixel.length < 4) {
            return "n/a";
        }
        return `R${pixel[0]} G${pixel[1]} B${pixel[2]} A${pixel[3]}`;
    }

    private escapeHtml(value: any) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    private sampleCanvasPixel(
        canvas: HTMLCanvasElement | undefined | null,
        clientPoint: { x: number; y: number },
        viewer: OpenSeadragon.Viewer,
        cacheKey: string
    ): Uint8ClampedArray | undefined {
        if (!canvas) {
            return undefined;
        }

        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return undefined;
        }

        const relativeX = clientPoint.x - rect.left;
        const relativeY = clientPoint.y - rect.top;
        if (relativeX < 0 || relativeX > rect.width || relativeY < 0 || relativeY > rect.height) {
            return undefined;
        }

        const sampleX = Math.max(0, Math.min(canvas.width - 1, Math.floor(relativeX * (canvas.width / rect.width))));
        const sampleY = Math.max(0, Math.min(canvas.height - 1, Math.floor(relativeY * (canvas.height / rect.height))));

        let sampler = (viewer as any)[cacheKey];
        if (!sampler) {
            const sampleCanvas = document.createElement("canvas");
            sampleCanvas.width = 1;
            sampleCanvas.height = 1;
            sampler = {
                canvas: sampleCanvas,
                context: sampleCanvas.getContext("2d", { willReadFrequently: true })
            };
            (viewer as any)[cacheKey] = sampler;
        }

        if (!sampler?.context) {
            return undefined;
        }

        try {
            sampler.context.clearRect(0, 0, 1, 1);
            sampler.context.drawImage(canvas, sampleX, sampleY, 1, 1, 0, 0, 1, 1);
            return sampler.context.getImageData(0, 0, 1, 1).data;
        } catch (error) {
            if (!(viewer as any).__xopatValueInspectorCanvasWarned) {
                (viewer as any).__xopatValueInspectorCanvasWarned = true;
                console.warn("Value inspector pixel sampling is unavailable for this viewer.", error);
            }
            return undefined;
        }
    }

    private sampleViewerBackgroundPixel(
        viewer: OpenSeadragon.Viewer,
        clientPoint: { x: number; y: number }
    ): Uint8ClampedArray | undefined {
        const image = viewer.scalebar?.getReferencedTiledImage?.() || viewer.world?.getItemAt?.(0);
        if (!image) {
            return undefined;
        }

        const screen = new OpenSeadragon.Point(clientPoint.x, clientPoint.y);
        const viewportPosition = viewer.viewport.windowToViewportCoordinates(screen);
        const tiles = image.lastDrawn || [];

        let tile;
        for (const candidate of tiles) {
            if (candidate?.bounds?.containsPoint?.(viewportPosition)) {
                tile = candidate;
                break;
            }
        }

        if (!tile) {
            return undefined;
        }

        try {
            const context = tile.getCanvasContext?.();
            const tileCanvas = context?.canvas;
            if (!context || !tileCanvas) {
                return undefined;
            }

            const x = screen.x - tile.position.x;
            const y = screen.y - tile.position.y;
            const relativeX = Math.max(0, Math.min(tileCanvas.width - 1, Math.round((x / tile.size.x) * tileCanvas.width)));
            const relativeY = Math.max(0, Math.min(tileCanvas.height - 1, Math.round((y / tile.size.y) * tileCanvas.height)));
            return context.getImageData(relativeX, relativeY, 1, 1).data;
        } catch (error) {
            if (!(viewer as any).__xopatValueInspectorBackgroundWarned) {
                (viewer as any).__xopatValueInspectorBackgroundWarned = true;
                console.warn("Value inspector background sampling is unavailable for this viewer.", error);
            }
            return undefined;
        }
    }

    private getViewerValueInspectorShaderSummary(viewer: OpenSeadragon.Viewer): string[] {
        const renderer = (viewer as any)?.drawer?.renderer;
        if (!renderer) {
            return [];
        }

        const entries: string[] = [];
        if (typeof renderer.forEachShaderLayerWithContext === "function") {
            renderer.forEachShaderLayerWithContext(
                renderer.getAllShaders?.(),
                renderer.getShaderLayerOrder?.(),
                (_shaderLayer: any, shaderId: string, shaderConfig: any) => {
                    const label = shaderConfig?.name || shaderId;
                    const type = shaderConfig?.type ? ` (${shaderConfig.type})` : "";
                    entries.push(`${label}${type}`);
                }
            );
            return entries;
        }

        const allShaders = renderer.getAllShaders?.() || {};
        const shaderOrder = renderer.getShaderLayerOrder?.() || Object.keys(allShaders);
        for (const shaderId of shaderOrder) {
            const shader = allShaders[shaderId];
            const shaderConfig = shader?.getConfig?.(shaderId) || shader?.getConfig?.() || {};
            const label = shaderConfig?.name || shaderId;
            const type = shaderConfig?.type ? ` (${shaderConfig.type})` : "";
            entries.push(`${label}${type}`);
        }

        return entries;
    }

    private hideViewerValueInspector(viewer: OpenSeadragon.Viewer | undefined | null) {
        if (!viewer) {
            return false;
        }

        const panel = document.getElementById(this.getViewerValueInspectorPanelId(viewer));
        if (panel) {
            panel.style.display = "none";
        }
        delete (viewer as any).__xopatValueInspectorLastClientPoint;
        return !!panel;
    }

    private ensureViewerValueInspectorOverlay(viewer: OpenSeadragon.Viewer | undefined | null) {
        if (!viewer) {
            return undefined;
        }

        const panelId = this.getViewerValueInspectorPanelId(viewer);
        let panel = document.getElementById(panelId);
        if (panel) {
            return panel;
        }

        USER_INTERFACE.addViewerHtml(
            `<div id="${panelId}" style="display:none;position:absolute;left:0;top:0;max-width:320px;pointer-events:none;z-index:30;border:1px solid rgba(0,0,0,.16);border-radius:10px;background:rgba(255,255,255,.95);backdrop-filter:blur(6px);box-shadow:0 12px 30px rgba(0,0,0,.18);color:var(--color-text-primary);padding:10px 12px;font-size:12px;line-height:1.45;"></div>`,
            ViewerInspectorController.VALUE_INSPECTOR_PLUGIN_ID,
            viewer
        );
        return document.getElementById(panelId) || undefined;
    }

    private renderViewerValueInspector(
        viewer: OpenSeadragon.Viewer,
        clientPoint?: { x: number; y: number } | null
    ) {
        const panel = this.ensureViewerValueInspectorOverlay(viewer);
        if (!panel) {
            return false;
        }

        if (!this.getValueInspectorEnabled()) {
            panel.style.display = "none";
            return false;
        }

        if (clientPoint) {
            (viewer as any).__xopatValueInspectorLastClientPoint = clientPoint;
        }

        const effectivePoint = clientPoint || (viewer as any).__xopatValueInspectorLastClientPoint;
        if (!effectivePoint) {
            panel.style.display = "none";
            return false;
        }

        const viewerRect = viewer.container.getBoundingClientRect();
        if (!viewerRect.width || !viewerRect.height) {
            panel.style.display = "none";
            return false;
        }

        const localX = effectivePoint.x - viewerRect.left;
        const localY = effectivePoint.y - viewerRect.top;
        if (localX < 0 || localX > viewerRect.width || localY < 0 || localY > viewerRect.height) {
            panel.style.display = "none";
            return false;
        }

        const image = viewer.scalebar?.getReferencedTiledImage?.() || viewer.world?.getItemAt?.(0);
        const windowPoint = new OpenSeadragon.Point(effectivePoint.x, effectivePoint.y);
        const imagePoint = image?.windowToImageCoordinates?.(windowPoint);
        const viewportPoint = viewer.viewport.windowToViewportCoordinates(windowPoint);
        const visualization = this.getViewerValueInspectorVisualization(viewer);
        const backgroundPixel = this.sampleViewerBackgroundPixel(viewer, effectivePoint);
        const renderedPixel = this.sampleCanvasPixel(
            viewer.drawer?.canvas,
            effectivePoint,
            viewer,
            "__xopatValueInspectorRenderedSampler"
        );
        const shaders = this.getViewerValueInspectorShaderSummary(viewer);
        const activeViewerIndex = this.appContext.activeViewerIndex?.() ?? -1;
        const isActiveViewer = activeViewerIndex === window.VIEWER_MANAGER?.getViewerIndex?.(viewer.uniqueId, false);

        const lines = [
            `<div style="font-weight:600;margin-bottom:4px;">Value inspector</div>`,
            `<div><strong>Image</strong>: ${imagePoint ? `${Math.round(imagePoint.x)}, ${Math.round(imagePoint.y)} px` : "n/a"}</div>`,
            `<div><strong>Viewport</strong>: ${viewportPoint ? `${viewportPoint.x.toFixed(4)}, ${viewportPoint.y.toFixed(4)}` : "n/a"}</div>`,
            `<div><strong>Zoom</strong>: ${viewer.viewport.getZoom(true).toFixed(3)}</div>`,
            `<div><strong>Background</strong>: ${this.formatPixelValue(backgroundPixel)}</div>`,
            `<div><strong>Rendered</strong>: ${this.formatPixelValue(renderedPixel)}</div>`
        ];

        if (visualization?.name) {
            lines.push(`<div><strong>Visualization</strong>: ${this.escapeHtml(visualization.name)}</div>`);
        }

        if (shaders.length > 0) {
            const visibleShaders = shaders.slice(0, 5);
            const more = shaders.length > visibleShaders.length ? ` +${shaders.length - visibleShaders.length} more` : "";
            lines.push(`<div><strong>Shaders</strong>: ${visibleShaders.map(v => this.escapeHtml(v)).join(", ")}${more}</div>`);
        }

        lines.push(`<div><strong>Viewer</strong>: ${isActiveViewer ? "active" : "secondary"}</div>`);

        panel.innerHTML = lines.join("");
        panel.style.display = "block";
        panel.style.left = `${Math.min(Math.max(localX + 16, 8), Math.max(viewerRect.width - 328, 8))}px`;
        panel.style.top = `${Math.min(Math.max(localY + 16, 8), Math.max(viewerRect.height - 170, 8))}px`;
        return true;
    }

    private ensureViewerValueInspectorTracking(viewer: OpenSeadragon.Viewer | undefined | null) {
        if (!viewer || (viewer as any).__xopatValueInspectorTracker) {
            return;
        }

        this.ensureViewerValueInspectorOverlay(viewer);

        (viewer as any).__xopatValueInspectorTracker = new OpenSeadragon.MouseTracker({
            element: viewer.container,
            moveHandler: (event: any) => {
                const original = event?.originalEvent as MouseEvent | undefined;
                if (!original) return;

                const point = {
                    x: original.clientX ?? original.x,
                    y: original.clientY ?? original.y,
                };
                const now = Date.now();
                const last = (viewer as any).__xopatValueInspectorLastRun || 0;
                if (now - last < ViewerInspectorController.VALUE_INSPECTOR_THROTTLE_MS) {
                    (viewer as any).__xopatValueInspectorLastClientPoint = point;
                    return;
                }

                (viewer as any).__xopatValueInspectorLastRun = now;
                this.renderViewerValueInspector(viewer, point);
            },
            leaveHandler: () => {
                this.hideViewerValueInspector(viewer);
            }
        });

        viewer.addOnceHandler?.("destroy", () => {
            try {
                (viewer as any).__xopatValueInspectorTracker?.destroy?.();
            } catch (error) {
                console.warn("Value inspector tracker destroy failed.", error);
            }
            delete (viewer as any).__xopatValueInspectorTracker;
            delete (viewer as any).__xopatValueInspectorLastClientPoint;
            delete (viewer as any).__xopatValueInspectorLastRun;
            delete (viewer as any).__xopatValueInspectorRenderedSampler;
        });
    }
}
