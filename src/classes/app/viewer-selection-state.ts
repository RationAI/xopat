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
