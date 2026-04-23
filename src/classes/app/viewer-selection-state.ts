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

    static getViewerSelectionIndex(
        viewer: OpenSeadragon.Viewer,
        optionKey: "activeBackgroundIndex" | "activeVisualizationIndex",
        appContext: ApplicationContext,
        viewerManager: any = window.VIEWER_MANAGER
    ): number | undefined {
        const selection = ViewerSelectionState.normalizeSelectionValue(
            appContext.getOption(optionKey, undefined, true, true)
        );

        if (!selection || selection.length < 1) {
            return undefined;
        }

        if (selection.length < 2 || !viewerManager?.getViewerIndex) {
            return Number.isInteger(selection[0]) ? selection[0] : undefined;
        }

        const viewerIndex = viewerManager.getViewerIndex(viewer.uniqueId, false);
        if (!Number.isInteger(viewerIndex) || viewerIndex < 0) {
            return Number.isInteger(selection[0]) ? selection[0] : undefined;
        }

        const selected = selection[viewerIndex];
        return Number.isInteger(selected) ? selected : undefined;
    }
}
