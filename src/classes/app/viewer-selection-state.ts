export class ViewerSelectionState {
    static normalizeSelectionValue(value: any): Array<number | undefined> | undefined {
        if (value == null) {
            return undefined;
        }
        if (Array.isArray(value)) {
            return value.map((entry: any) => Number.isInteger(entry) ? entry : undefined);
        }
        return Number.isInteger(value) ? [value] : undefined;
    }

    /**
     * Resolve the *background* slot index for a given viewer. Backed by
     * `activeBackgroundIndex` (per-slot array) and the viewer's instance
     * position in `VIEWER_MANAGER.viewers`. This option remains array-keyed
     * by slot — it controls *which* background is mounted per viewer.
     */
    static getViewerSelectionIndex(
        viewer: OpenSeadragon.Viewer,
        optionKey: "activeBackgroundIndex",
        appContext: ApplicationContext,
        viewerManager: any = window.VIEWER_MANAGER
    ): number | undefined {
        const selection = ViewerSelectionState.normalizeSelectionValue(
            appContext.getOption(optionKey, undefined, true, true)
        );

        if (!selection || selection.length < 1) {
            return undefined;
        }

        if (selection.length < 2 || !viewerManager?.getViewerSlotIndex) {
            return Number.isInteger(selection[0]) ? selection[0] : undefined;
        }

        const viewerIndex = viewerManager.getViewerSlotIndex(viewer);
        if (!Number.isInteger(viewerIndex) || viewerIndex < 0) {
            return Number.isInteger(selection[0]) ? selection[0] : undefined;
        }

        const selected = selection[viewerIndex];
        return Number.isInteger(selected) ? selected : undefined;
    }

    /**
     * Resolve the *visualization* index for a given viewer by reading
     * `background[activeBackgroundIndex[slot]].visualizationIndex`. The
     * binding lives on the background entry — slot reordering / insertion /
     * deletion preserves it, and there is no separate per-slot array to
     * keep in sync.
     *
     * Returns `undefined` for "no visualization" (slot without a bg entry,
     * bg without a visualizationIndex, or visualizationIndex explicitly null).
     */
    static getViewerVisualizationIndex(
        viewer: OpenSeadragon.Viewer,
        appContext: ApplicationContext,
        viewerManager: any = window.VIEWER_MANAGER
    ): number | undefined {
        const bgIdx = ViewerSelectionState.getViewerSelectionIndex(
            viewer, "activeBackgroundIndex", appContext, viewerManager
        );
        if (!Number.isInteger(bgIdx)) return undefined;
        const backgrounds = Array.isArray(appContext.config.background) ? appContext.config.background : [];
        const bg: any = backgrounds[bgIdx as number];
        const v = bg?.visualizationIndex;
        return Number.isInteger(v) ? v as number : undefined;
    }

    /**
     * Whether a visualization is offered for a background. A visualization
     * without `backgrounds` belongs to every background; otherwise one entry
     * must equal the background's `id` or the data id the background shows.
     */
    static visualizationAppliesTo(visualization: any, background: any, data: any[] = []): boolean {
        const targets = visualization?.backgrounds;
        if (!Array.isArray(targets) || !targets.length) return true;
        if (!background) return false;
        const ref = background.dataReference;
        const entry = typeof ref === "number" ? data[ref] : ref;
        const dataId = typeof entry === "string" ? entry : entry?.dataID;
        return targets.some((t: any) => t === background.id || (dataId !== undefined && t === dataId));
    }

    /**
     * The visualizations a viewer's selector offers: those applying to its
     * background, plus the selected one regardless. Entries keep their index
     * in `config.visualizations`, which is what a selection stores.
     */
    static getViewerVisualizationChoices(
        viewer: OpenSeadragon.Viewer,
        appContext: ApplicationContext,
        viewerManager: any = window.VIEWER_MANAGER
    ): Array<{ index: number, name?: string }> {
        const config: any = appContext.config;
        const visualizations: any[] = Array.isArray(config.visualizations) ? config.visualizations : [];
        const bgIdx = ViewerSelectionState.getViewerSelectionIndex(
            viewer, "activeBackgroundIndex", appContext, viewerManager
        );
        const bg = Number.isInteger(bgIdx) ? config.background?.[bgIdx as number] : undefined;
        const selected = ViewerSelectionState.getViewerVisualizationIndex(viewer, appContext, viewerManager);
        const data = Array.isArray(config.data) ? config.data : [];
        return visualizations
            .map((visualization, index) => ({ visualization, index }))
            .filter(({ visualization, index }) => index === selected
                || ViewerSelectionState.visualizationAppliesTo(visualization, bg, data))
            .map(({ visualization, index }) => ({ index, name: visualization?.name }));
    }

    /**
     * Snapshot variant — derive the visualization index from a captured
     * snapshot (history/session payload). Mirrors `getViewerVisualizationIndex`
     * but operates on a frozen `{background, activeBackgroundIndex}` shape.
     */
    static getViewerVisualizationIndexFromSnapshot(
        snapshot: any,
        viewerIndex: number
    ): number | undefined {
        const backgrounds = Array.isArray(snapshot?.background) ? snapshot.background : [];
        const activeBg = ViewerSelectionState.normalizeSelectionValue(snapshot?.activeBackgroundIndex) || [];
        const bgIdx = viewerIndex < activeBg.length ? activeBg[viewerIndex] : activeBg[0];
        if (!Number.isInteger(bgIdx)) return undefined;
        const bg: any = backgrounds[bgIdx as number];
        const v = bg?.visualizationIndex;
        return Number.isInteger(v) ? v as number : undefined;
    }
}
