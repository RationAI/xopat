import { BackgroundConfig } from "../background-config";
import { ViewerSelectionState } from "./viewer-selection-state";
import { ViewerStateBindingController } from "./viewer-state-binding-controller";
import { ViewerVisualizationRuntime } from "./viewer-visualization-runtime";
import { ViewerShaderSourceController, makeXOpatSourceToken } from "./viewer-shader-source-controller";

export interface OpenViewerWithOptions {
    deriveOverlayFromBackgroundGoals?: boolean;
    dataMode?: "replace" | "merge";
    backgroundMode?: "replace" | "merge";
    historyMode?: "auto" | "skip" | "visualization-step" | "content-switch" | "reset-history";
    fromHistory?: boolean;
    preserveHistoryOnBackgroundChange?: boolean;
    warnOnHistoryBoundary?: boolean;
    historyLabel?: string;
    strictVisualization?: boolean;
    skipVisualizationCapabilityCheck?: boolean;
    suppressDialogsOnVisualizationFailure?: boolean;
}

export interface ViewerOpenPipelineDependencies {
    appContext: ApplicationContext;
    env: XOpatCoreConfig;
    viewerManager: any;
    getConfig: () => any;
    cloneRuntimeState: <T>(value: T) => T;
    safeStringify: (value: any) => string;
    runLoaderOnce: () => void;
    visualizationRuntime: ViewerVisualizationRuntime;
    stateBindings: ViewerStateBindingController;
}

export class ViewerOpenPipeline {
    constructor(private readonly deps: ViewerOpenPipelineDependencies) {}

    private async waitForViewerRenderReady(viewer: OpenSeadragon.Viewer, attempts = 8) {
        const drawer: any = viewer?.drawer;
        const hasSizedCanvas = () => {
            const canvas = drawer?.canvas;
            return !!(canvas && canvas.width > 0 && canvas.height > 0);
        };

        if (hasSizedCanvas()) {
            return;
        }

        for (let attempt = 0; attempt < attempts; attempt++) {
            try {
                viewer.forceResize?.();
            } catch (_) {
                // ignore and retry on next frame
            }

            await new Promise<void>((resolve) => {
                OpenSeadragon.requestAnimationFrame(() => resolve());
            });

            if (hasSizedCanvas()) {
                return;
            }
        }
    }

    /**
     * The navigator mirrors main.world.add-item by calling its own addTiledImage asynchronously
     * (one Promise hop per tile). For the last tile in a batch there's no further await in the
     * caller, so control returns to the render pipeline before the navigator's world has caught
     * up. If resumeRendering then fires the deferred rebuild with a stale navigator world count,
     * setDimensions allocates stencil/atlas textures smaller than the shader configs expect and
     * every subsequent draw errors with "Attachment layer is greater than texture layer count"
     * until the navigator eventually catches up and triggers a second rebuild.
     *
     * Poll until navigator.world matches main.world, so both drawers' rebuilds see the same
     * world state. Rendering is suspended during this wait, so no frames are drawn while we poll.
     */
    private async waitForNavigatorParity(viewer: OpenSeadragon.Viewer, attempts = 30) {
        const navigator: any = viewer?.navigator;
        if (!navigator?.world) return;
        const targetCount = viewer.world?.getItemCount?.() ?? 0;
        if (targetCount === 0) return;

        for (let attempt = 0; attempt < attempts; attempt++) {
            if ((navigator.world.getItemCount?.() ?? 0) >= targetCount) {
                return;
            }
            await new Promise<void>((resolve) => {
                OpenSeadragon.requestAnimationFrame(() => resolve());
            });
        }

        const finalCount = navigator.world.getItemCount?.() ?? 0;
        if (finalCount < targetCount) {
            console.warn(
                "Navigator world did not catch up with main viewer before render config.",
                { mainCount: targetCount, navCount: finalCount }
            );
        }
    }

    async updateViewerSelection(
        viewerIndex: number,
        selection: {
            backgroundIndex?: number | null;
            visualizationIndex?: number | null;
        },
        opts: OpenViewerWithOptions = {}
    ) {
        const activeBackground = ViewerSelectionState.normalizeSelectionValue(
            this.deps.appContext.getOption("activeBackgroundIndex", undefined, true, true)
        ) || [];
        const activeVisualization = ViewerSelectionState.normalizeSelectionValue(
            this.deps.appContext.getOption("activeVisualizationIndex", undefined, true, true)
        ) || [];

        while (activeBackground.length <= viewerIndex) {
            activeBackground.push(activeBackground[0]);
        }
        while (activeVisualization.length <= viewerIndex) {
            activeVisualization.push(activeVisualization[0]);
        }

        if (selection.backgroundIndex !== undefined) {
            activeBackground[viewerIndex] = Number.isInteger(selection.backgroundIndex)
                ? selection.backgroundIndex as number
                : undefined;
        }
        if (selection.visualizationIndex !== undefined) {
            activeVisualization[viewerIndex] = Number.isInteger(selection.visualizationIndex)
                ? selection.visualizationIndex as number
                : undefined;
        }

        return this.openViewerWith(
            undefined,
            undefined,
            undefined,
            activeBackground,
            activeVisualization,
            opts
        );
    }

    async openViewerWith(
        data = undefined,
        background: BackgroundItem[] | undefined = undefined,
        visualizations: VisualizationItem[] | undefined = undefined,
        bgSpec: number | number[] | undefined | null = undefined,
        vizSpec: number | number[] | undefined | null = undefined,
        opts: OpenViewerWithOptions = {}
    ) {
        const { appContext, env, viewerManager, cloneRuntimeState, safeStringify, visualizationRuntime, stateBindings } = this.deps;

        if (appContext.getOption("webglDebugMode")) {
            console.log("[pipeline] openViewerWith ENTER", {
                hasData: data !== undefined,
                hasBackground: background !== undefined,
                hasVisualizations: visualizations !== undefined,
                bgSpec,
                vizSpec,
                opts,
                stack: new Error("openViewerWith called from").stack?.split("\n").slice(1, 6).join("\n    "),
            });
        }

        const normalizeHistorySelection = (value: any): Array<number | undefined> | undefined => {
            if (value == null) return undefined;
            if (Array.isArray(value)) {
                return value.map((entry: any) => Number.isInteger(entry) ? entry : undefined);
            }
            return Number.isInteger(value) ? [value] : undefined;
        };

        const cloneForHistory = <T>(value: T): T => {
            if (value === undefined || value === null) return value;
            try {
                return JSON.parse(safeStringify(value));
            } catch (e) {
                console.warn("Failed to snapshot state for history.", e);
                return value;
            }
        };

        const normalizeCollectionMode = (value: any): "replace" | "merge" => value === "merge" ? "merge" : "replace";
        const cloneForMerge = <T>(value: T): T => cloneRuntimeState(value);
        const sameMergedDataEntry = (a: any, b: any) => safeStringify(a) === safeStringify(b);
        const remapSelectionByIndexMap = (
            value: number | number[] | undefined | null,
            indexMap: Map<number, number>
        ): number | number[] | undefined | null => {
            if (value == null) return value;
            if (Array.isArray(value)) {
                return value.map((entry: any) => Number.isInteger(entry) ? indexMap.get(entry) : entry);
            }
            return Number.isInteger(value) ? indexMap.get(value) : value;
        };
        const remapBackgroundDataReferences = (
            backgroundItems: Array<BackgroundItem | BackgroundConfig> | undefined,
            dataIndexMap: Map<number, number>
        ) => {
            if (!Array.isArray(backgroundItems) || dataIndexMap.size < 1) return;

            const remapNestedLayer = (layer: any) => {
                if (!layer || typeof layer !== "object") return;

                if (Array.isArray(layer.dataReferences)) {
                    layer.dataReferences = layer.dataReferences.map((ref: any) =>
                        Number.isInteger(ref) ? (dataIndexMap.get(ref) ?? ref) : ref
                    );
                }

                if (layer.shaders && typeof layer.shaders === "object" && !Array.isArray(layer.shaders)) {
                    Object.values(layer.shaders).forEach(remapNestedLayer);
                }
            };

            backgroundItems.forEach((item: any) => {
                if (!item || typeof item !== "object") return;

                if (Number.isInteger(item.dataReference)) {
                    item.dataReference = dataIndexMap.get(item.dataReference) ?? item.dataReference;
                }

                if (Array.isArray(item.shaders)) {
                    item.shaders.forEach(remapNestedLayer);
                }
            });
        };
        const remapVisualizationDataReferences = (
            visualizationItems: VisualizationItem[] | undefined,
            dataIndexMap: Map<number, number>
        ) => {
            if (!Array.isArray(visualizationItems) || dataIndexMap.size < 1) return;

            visualizationItems.forEach((visualization: any) => {
                if (!visualization?.shaders || typeof visualization.shaders !== "object") return;

                forEachVisualizationShader(visualization.shaders as Record<string, any>, (shader) => {
                    if (!Array.isArray(shader?.dataReferences)) return;
                    shader.dataReferences = shader.dataReferences.map((ref: any) =>
                        Number.isInteger(ref) ? (dataIndexMap.get(ref) ?? ref) : ref
                    );
                });
            });
        };
        const mergeDataCollection = (
            baseData: DataID[],
            incomingData: DataID[]
        ): { data: DataID[]; indexMap: Map<number, number>; } => {
            const mergedData = cloneForMerge(Array.isArray(baseData) ? baseData : []);
            const indexMap = new Map<number, number>();

            (Array.isArray(incomingData) ? incomingData : []).forEach((entry: any, index: number) => {
                const existingIndex = mergedData.findIndex((candidate: any) => sameMergedDataEntry(candidate, entry));
                if (existingIndex >= 0) {
                    indexMap.set(index, existingIndex);
                    return;
                }

                mergedData.push(cloneForMerge(entry));
                indexMap.set(index, mergedData.length - 1);
            });

            return { data: mergedData, indexMap };
        };
        const mergeBackgroundCollection = (
            baseBackground: Array<BackgroundItem | BackgroundConfig>,
            incomingBackground: Array<BackgroundItem | BackgroundConfig>
        ): { background: Array<BackgroundItem | BackgroundConfig>; indexMap: Map<number, number>; } => {
            const mergedBackground = cloneForMerge(Array.isArray(baseBackground) ? baseBackground : []);
            const indexMap = new Map<number, number>();

            (Array.isArray(incomingBackground) ? incomingBackground : []).forEach((entry: any, index: number) => {
                const clonedEntry = cloneForMerge(entry);
                let mergedIndex = mergedBackground.findIndex((candidate: any) =>
                    candidate?.id && clonedEntry?.id && candidate.id === clonedEntry.id
                );

                if (mergedIndex < 0) {
                    mergedIndex = mergedBackground.findIndex((candidate: any) =>
                        appContext.sameBackground(candidate, clonedEntry)
                    );
                }

                if (mergedIndex >= 0) {
                    mergedBackground[mergedIndex] = clonedEntry;
                } else {
                    mergedBackground.push(clonedEntry);
                    mergedIndex = mergedBackground.length - 1;
                }

                indexMap.set(index, mergedIndex);
            });

            return { background: mergedBackground, indexMap };
        };

        const captureLoadSnapshotFromConfig = (source: any = appContext._dangerouslyAccessConfig()) => ({
            data: Array.isArray(source?.data) ? cloneForHistory(source.data) : [],
            background: Array.isArray(source?.background) ? cloneForHistory(source.background) : [],
            visualizations: Array.isArray(source?.visualizations) ? cloneForHistory(source.visualizations) : [],
            activeBackgroundIndex: normalizeHistorySelection(
                appContext.getOption("activeBackgroundIndex", undefined, true, true)
            ),
            activeVisualizationIndex: normalizeHistorySelection(
                appContext.getOption("activeVisualizationIndex", undefined, true, true)
            ),
        });

        const selectedBackgroundIdsFromSnapshot = (snapshot: any): string[] => {
            const selected = normalizeHistorySelection(snapshot?.activeBackgroundIndex) || [];
            const backgrounds = Array.isArray(snapshot?.background) ? snapshot.background : [];
            return selected
                .map((index: number | undefined) => Number.isInteger(index) ? backgrounds[index as number] : undefined)
                .filter(Boolean)
                .map((entry: BackgroundItem | BackgroundConfig) => appContext.registerConfig(entry).id);
        };

        const selectedVisualizationConfigsFromSnapshot = (snapshot: any) => {
            const selected = normalizeHistorySelection(snapshot?.activeVisualizationIndex) || [];
            const visualizationItems = Array.isArray(snapshot?.visualizations) ? snapshot.visualizations : [];
            return selected.map((index: number | undefined) =>
                Number.isInteger(index) ? visualizationItems[index as number] : undefined
            );
        };

        const buildVisibleLoadFingerprint = (snapshot: any) => safeStringify({
            selectedBackgroundIds: selectedBackgroundIdsFromSnapshot(snapshot),
            selectedVisualizations: selectedVisualizationConfigsFromSnapshot(snapshot),
            data: snapshot?.data || [],
        });

        const loadSnapshotsEqual = (a: any, b: any) => safeStringify(a) === safeStringify(b);
        const visibleLoadChanged = (a: any, b: any) => buildVisibleLoadFingerprint(a) !== buildVisibleLoadFingerprint(b);
        const selectionAt = (value: any, viewerIndex: number): number | undefined => {
            const selected = normalizeHistorySelection(value) || [];
            return selected[viewerIndex] ?? selected[0];
        };
        const dataSpecFromRef = (dataSet: any[], ref: any) => typeof ref === "number" ? dataSet?.[ref] : ref;
        const dataIdFromSpec = (spec: any) => {
            if (spec == null) return undefined;
            return spec && typeof spec === "object" && spec.dataID ? spec.dataID : spec;
        };
        const forEachVisualizationShader = (
            shaderMap: Record<string, any> | undefined,
            callback: (shader: any, shaderId: string, path: string[]) => void,
            path: string[] = []
        ) => {
            if (!shaderMap || typeof shaderMap !== "object") {
                return;
            }
            for (const [shaderId, shader] of Object.entries(shaderMap)) {
                if (!shader || typeof shader !== "object") {
                    continue;
                }
                const nextPath = path.concat([shaderId]);
                callback(shader, shaderId, nextPath);
                if (shader.shaders && typeof shader.shaders === "object" && !Array.isArray(shader.shaders)) {
                    forEachVisualizationShader(shader.shaders, callback, nextPath);
                }
            }
        };
        const forEachNestedShaderLayer = (
            layer: any,
            callback: (shader: any, path: string[]) => void,
            path: string[] = []
        ) => {
            if (!layer || typeof layer !== "object") {
                return;
            }
            callback(layer, path);
            if (layer.shaders && typeof layer.shaders === "object" && !Array.isArray(layer.shaders)) {
                for (const [childId, child] of Object.entries(layer.shaders)) {
                    forEachNestedShaderLayer(child, callback, path.concat([childId]));
                }
            }
        };
        const collectViewerReferencedData = (snapshot: any, viewerIndex: number) => {
            const backgrounds = Array.isArray(snapshot?.background) ? snapshot.background : [];
            const visualizationItems = Array.isArray(snapshot?.visualizations) ? snapshot.visualizations : [];
            const dataSet = Array.isArray(snapshot?.data) ? snapshot.data : [];
            const bgIndex = selectionAt(snapshot?.activeBackgroundIndex, viewerIndex);
            const vizIndex = selectionAt(snapshot?.activeVisualizationIndex, viewerIndex);
            const refs = new Set<any>();
            const bgEntry = Number.isInteger(bgIndex) ? backgrounds[bgIndex as number] : undefined;
            const vizEntry = Number.isInteger(vizIndex) ? visualizationItems[vizIndex as number] : undefined;

            if (bgEntry?.dataReference !== undefined) {
                refs.add(dataIdFromSpec(dataSpecFromRef(dataSet, bgEntry.dataReference)));
            }
            if (Array.isArray(bgEntry?.shaders)) {
                for (const shader of bgEntry.shaders) {
                    forEachNestedShaderLayer(shader, (entry) => {
                        for (const ref of entry?.dataReferences || []) {
                            refs.add(dataIdFromSpec(dataSpecFromRef(dataSet, ref)));
                        }
                    });
                }
            }
            if (vizEntry?.shaders) {
                forEachVisualizationShader(vizEntry.shaders as Record<string, any>, (shader) => {
                    for (const ref of shader?.dataReferences || []) {
                        refs.add(dataIdFromSpec(dataSpecFromRef(dataSet, ref)));
                    }
                });
            }
            return Array.from(refs);
        };
        const buildViewerNatureFingerprint = (snapshot: any, viewerIndex: number) => {
            const backgrounds = Array.isArray(snapshot?.background) ? snapshot.background : [];
            const visualizationItems = Array.isArray(snapshot?.visualizations) ? snapshot.visualizations : [];
            const dataSet = Array.isArray(snapshot?.data) ? snapshot.data : [];
            const bgIndex = selectionAt(snapshot?.activeBackgroundIndex, viewerIndex);
            const vizIndex = selectionAt(snapshot?.activeVisualizationIndex, viewerIndex);
            const bgEntry = Number.isInteger(bgIndex) ? backgrounds[bgIndex as number] : undefined;
            const vizEntry = Number.isInteger(vizIndex) ? visualizationItems[vizIndex as number] : undefined;

            return safeStringify({
                viewerIndex,
                background: bgEntry ? {
                    id: bgEntry.id,
                    protocol: bgEntry.protocol,
                    dataReference: dataIdFromSpec(dataSpecFromRef(dataSet, bgEntry.dataReference)),
                    shaders: Array.isArray(bgEntry.shaders) ? bgEntry.shaders.flatMap((shader: any, index: number) => {
                        const layers: Array<{ id: any; type: any; dataReferences: any[]; path: string[]; }> = [];
                        forEachNestedShaderLayer(shader, (entry, path) => {
                            layers.push({
                                id: entry?.id,
                                type: entry?.type,
                                dataReferences: Array.isArray(entry?.dataReferences)
                                    ? entry.dataReferences.map((ref: number) => dataIdFromSpec(dataSpecFromRef(dataSet, ref)))
                                    : [],
                                path: path.length ? path : [String(index)],
                            });
                        }, [String(index)]);
                        return layers;
                    }) : [],
                } : null,
                visualization: vizEntry ? {
                    protocol: vizEntry.protocol,
                    shaders: (() => {
                        const layers: Array<{ id: string; type: any; dataReferences: any[]; path: string[]; }> = [];
                        forEachVisualizationShader(vizEntry.shaders || {}, (shader, shaderId, path) => {
                            layers.push({
                                id: shader?.id || shaderId,
                                type: shader?.type,
                                dataReferences: Array.isArray(shader?.dataReferences)
                                    ? shader.dataReferences.map((ref: number) => dataIdFromSpec(dataSpecFromRef(dataSet, ref)))
                                    : [],
                                path,
                            });
                        });
                        return layers;
                    })(),
                } : null,
            });
        };
        const buildViewerRenderFingerprint = (snapshot: any, viewerIndex: number) => {
            const backgrounds = Array.isArray(snapshot?.background) ? snapshot.background : [];
            const visualizationItems = Array.isArray(snapshot?.visualizations) ? snapshot.visualizations : [];
            const dataSet = Array.isArray(snapshot?.data) ? snapshot.data : [];
            const bgIndex = selectionAt(snapshot?.activeBackgroundIndex, viewerIndex);
            const vizIndex = selectionAt(snapshot?.activeVisualizationIndex, viewerIndex);

            return safeStringify({
                viewerIndex,
                background: Number.isInteger(bgIndex) ? backgrounds[bgIndex as number] : null,
                visualization: Number.isInteger(vizIndex) ? visualizationItems[vizIndex as number] : null,
                data: collectViewerReferencedData(snapshot, viewerIndex),
            });
        };

        const restoreLoadSnapshot = async (snapshot: any) => {
            if (!snapshot) return false;
            return await this.openViewerWith(
                cloneForHistory(snapshot.data),
                cloneForHistory(snapshot.background),
                cloneForHistory(snapshot.visualizations),
                cloneForHistory(snapshot.activeBackgroundIndex),
                cloneForHistory(snapshot.activeVisualizationIndex),
                {
                    deriveOverlayFromBackgroundGoals: false,
                    historyMode: "skip",
                    fromHistory: true,
                    warnOnHistoryBoundary: false,
                }
            );
        };

        const parseLooseBoolean = (value: any, fallback = false) => {
            if (value === undefined || value === null) return fallback;
            if (value === false || value === "false") return false;
            if (value === true || value === "true") return true;
            return Boolean(value);
        };

        const config = this.deps.getConfig();
        const previousSnapshot = captureLoadSnapshotFromConfig(config);
        const history = appContext.history;
        const hadOpenViewerState = (viewerManager.viewers || []).some((viewer: OpenSeadragon.Viewer | undefined) => {
            if (!viewer) return false;
            if (typeof viewer.isOpen === "function" && viewer.isOpen()) return true;
            return (viewer.world?.getItemCount?.() || 0) > 0;
        });
        const existingBackground = Array.isArray(config.background) ? config.background : [];
        const existingVisualizations = Array.isArray(config.visualizations) ? config.visualizations : [];
        const existingData = Array.isArray(config.data) ? config.data : [];
        const dataMode = normalizeCollectionMode(opts.dataMode);
        const backgroundMode = normalizeCollectionMode(opts.backgroundMode);
        let normalizedBackground = background === null ? [] : cloneForMerge(background);
        let normalizedVisualizations = visualizations === null ? [] : cloneForMerge(visualizations);
        let normalizedData = data === null ? [] : cloneForMerge(data);
        let effectiveBgSpec = bgSpec;

        if (data !== null && dataMode === "merge" && Array.isArray(normalizedData)) {
            const mergedData = mergeDataCollection(existingData, normalizedData);
            remapBackgroundDataReferences(normalizedBackground as Array<BackgroundItem | BackgroundConfig>, mergedData.indexMap);
            remapVisualizationDataReferences(normalizedVisualizations as VisualizationItem[], mergedData.indexMap);
            normalizedData = mergedData.data;
        }

        if (background !== null && backgroundMode === "merge" && Array.isArray(normalizedBackground)) {
            const mergedBackground = mergeBackgroundCollection(existingBackground, normalizedBackground);
            normalizedBackground = mergedBackground.background as any;
            effectiveBgSpec = remapSelectionByIndexMap(bgSpec, mergedBackground.indexMap);
        }

        if (typeof normalizedData !== "undefined") config.data = normalizedData;
        else if (!Array.isArray(config.data)) config.data = existingData;
        if (typeof normalizedBackground !== "undefined") config.background = normalizedBackground;
        else if (!Array.isArray(config.background)) config.background = existingBackground;
        if (typeof normalizedVisualizations !== "undefined") config.visualizations = normalizedVisualizations;
        else if (!Array.isArray(config.visualizations)) config.visualizations = existingVisualizations;

        if (!Array.isArray(config.data)) config.data = [];
        if (!Array.isArray(config.background)) config.background = [];
        if (!Array.isArray(config.visualizations)) config.visualizations = [];

        const strictVisualization = !!opts.strictVisualization;
        const visualizationValidation = visualizationRuntime.validateVisualizationCollection(config.visualizations as any, config.data as any);
        if (visualizationValidation.issues.length > 0) {
            console.warn("Visualization validation issues detected.", visualizationValidation.issues);
            if (strictVisualization) {
                USER_INTERFACE.Loading.show(false);
                throw new Error("Visualization validation failed: " + visualizationValidation.issues.join(" | "));
            }
        }
        config.visualizations = visualizationValidation.visualizations as any;

        const renderingCapability = opts.skipVisualizationCapabilityCheck
            ? ((appContext as any).__renderingCapability || { ok: true })
            : visualizationRuntime.getRenderingCapability(false);
        if (strictVisualization && Array.isArray(config.visualizations) && config.visualizations.length > 0 && !renderingCapability.ok) {
            USER_INTERFACE.Loading.show(false);
            throw new Error(renderingCapability.error || "Visualization rendering is unavailable on this device.");
        }

        if (Array.isArray(config.background)) {
            config.background = config.background.map((bg: BackgroundItem | BackgroundConfig) => BackgroundConfig.from(bg, true, false));
        }

        const cfg = appContext.config;
        const bgs: BackgroundConfig[] = Array.isArray(cfg.background) ? cfg.background : [];
        const vis = Array.isArray(cfg.visualizations) ? cfg.visualizations : [];
        const isSecureMode = !!appContext.secure;

        UTILITIES.parseBackgroundAndGoal(effectiveBgSpec, vizSpec, {
            deriveOverlayFromBackgroundGoals: !!opts.deriveOverlayFromBackgroundGoals
        });

        let activeBg = appContext.getOption("activeBackgroundIndex", undefined, true, true);
        let activeViz = appContext.getOption("activeVisualizationIndex", undefined, true, true);

        const bgSpecWasUnset = activeBg === undefined;
        const vizSpecWasUnset = activeViz === undefined;
        if (bgSpecWasUnset && vizSpecWasUnset) {
            if (bgs.length > 0) {
                activeBg = 0;
            } else if (vis.length > 0) {
                activeViz = 0;
            }
        }

        if (typeof activeBg === "number") {
            activeBg = [activeBg];
            appContext.setOption("activeBackgroundIndex", activeBg);
        }
        if (typeof activeViz === "number") {
            activeViz = [activeViz];
            appContext.setOption("activeVisualizationIndex", activeViz);
        }

        const nextSnapshot = captureLoadSnapshotFromConfig(config);
        const selectedBackgroundsBefore = selectedBackgroundIdsFromSnapshot(previousSnapshot);
        const selectedBackgroundsAfter = selectedBackgroundIdsFromSnapshot(nextSnapshot);
        const backgroundChanged = hadOpenViewerState && JSON.stringify(selectedBackgroundsBefore) !== JSON.stringify(selectedBackgroundsAfter);
        const anythingVisibleChanged = hadOpenViewerState && visibleLoadChanged(previousSnapshot, nextSnapshot);
        const anythingChanged = hadOpenViewerState && !loadSnapshotsEqual(previousSnapshot, nextSnapshot);

        const preserveHistoryOnBackgroundChange = opts.preserveHistoryOnBackgroundChange ?? parseLooseBoolean(
            appContext.config.params?.preserveHistoryOnBackgroundChange,
            false
        );
        const warnOnHistoryBoundary = opts.warnOnHistoryBoundary ?? parseLooseBoolean(
            appContext.config.params?.warnOnBackgroundHistoryBoundary,
            true
        );

        let historyMode = opts.historyMode || "auto";
        if (historyMode === "auto") {
            if (!anythingVisibleChanged) {
                historyMode = "skip";
            } else if (backgroundChanged) {
                historyMode = preserveHistoryOnBackgroundChange ? "content-switch" : "reset-history";
            } else {
                historyMode = "visualization-step";
            }
        }

        let maybeLoadingTimeout: any = undefined;
        if (backgroundChanged) {
            USER_INTERFACE.Loading.show(true);
        } else {
            maybeLoadingTimeout = setTimeout(() => {
                USER_INTERFACE.Loading.show(true);
                maybeLoadingTimeout = undefined;
            }, 1000);
        }

        await Dialogs.awaitHidden();

        const hasCommittedHistory = !!history.hasAnyStackHistory();
        if (!opts.fromHistory && backgroundChanged && historyMode === "reset-history" && hasCommittedHistory) {
            const boundaryEvent = {
                previousSnapshot,
                nextSnapshot,
                historyMode,
                preserveHistoryOnBackgroundChange,
                cancel: false,
                preventDefault: false,
                message: "Changing the loaded background will clear undo history for the current content. Continue?",
            };

            await viewerManager.raiseEventAwaiting("before-history-boundary", boundaryEvent)
                .catch((e: any) => console.warn("Exception in 'before-history-boundary' event handler: ", e));

            if (boundaryEvent.cancel) {
                USER_INTERFACE.Loading.show(false);
                return false;
            }

            if (warnOnHistoryBoundary && !boundaryEvent.preventDefault && !window.confirm(boundaryEvent.message)) {
                USER_INTERFACE.Loading.show(false);
                return false;
            }
        }

        const bgPlan = (() => {
            if (Array.isArray(activeBg)) {
                return activeBg.map(idx => ({ type: "single", bgIndices: [idx] }));
            }
            if (Number.isInteger(activeBg)) {
                return [{ type: "single", bgIndices: [activeBg] }];
            }
            return [{ type: "single", bgIndices: [] }];
        })();

        const desiredCount = Math.max(1, bgPlan.length);
        const previousDesiredCount = Math.max(
            1,
            (normalizeHistorySelection(previousSnapshot?.activeBackgroundIndex) || []).length || 1
        );
        const changesViewerCount = desiredCount !== previousDesiredCount;
        const changesViewerNature = changesViewerCount || backgroundChanged;
        const refreshChangeKind = !anythingVisibleChanged ? "noop" : (changesViewerNature ? "content" : "visualization");

        await viewerManager.raiseEventAwaiting("before-refresh", {
            data: config.data,
            background: config.background,
            visualizations: config.visualizations,
            bgSpec: effectiveBgSpec,
            vizSpec,
            opts,
            historyMode,
            changeKind: refreshChangeKind,
            changesViewerNature,
            changesViewerCount,
            anythingVisibleChanged,
            anythingChanged,
            backgroundChanged,
        }).catch((e: any) => console.warn("Exception in 'before-refresh' event handler: ", e));

        for (let i = 0; i < desiredCount; i++) {
            if (!viewerManager.viewers[i]) viewerManager.add(i);
        }
        for (let i = viewerManager.viewers.length - 1; i >= desiredCount; i--) {
            if (i === 0) continue;
            viewerManager.delete(i);
        }

        const bgUrlFromEntry = (bgEntry: BackgroundConfig, dataSpec: DataSpecification | undefined = undefined) => {
            const spec: DataSpecification | undefined = dataSpec === undefined ? BackgroundConfig.dataSpecification(bgEntry) : dataSpec;
            const isObjectSpec = spec && typeof spec === "object";

            if (isObjectSpec && (spec as DataOverride).tileSource instanceof OpenSeadragon.TileSource) {
                return (spec as DataOverride).tileSource;
            }

            const customProto = isObjectSpec && (spec as DataOverride).protocol ? (spec as DataOverride).protocol : (bgEntry.protocol ? bgEntry.protocol : null);
            const proto = customProto && !isSecureMode ? customProto : env.client.image_group_protocol;
            const make = new Function("path,data", "return " + proto);
            return make(env.client.image_group_server, BackgroundConfig.dataFromSpec(spec));
        };

        const normalizeRendererShaderConfig = (shaderConfig: any, context: any = {}) => {
            const rendererClass: any = (window.OpenSeadragon as any)?.FlexRenderer;
            if (rendererClass && typeof rendererClass.normalizeShaderConfig === "function") {
                return rendererClass.normalizeShaderConfig(shaderConfig, context);
            }
            return shaderConfig;
        };

        const normalizeRendererShaderMap = (shaderMap: Record<string, any>, context: any = {}) => {
            const rendererClass: any = (window.OpenSeadragon as any)?.FlexRenderer;
            if (rendererClass && typeof rendererClass.normalizeShaderMap === "function") {
                return rendererClass.normalizeShaderMap(shaderMap, context);
            }
            return shaderMap;
        };

        const openPlaceholder = (viewer: OpenSeadragon.Viewer, errorMessage: any, index: number, originalSource: any, onOpen: (ok: boolean) => void) => {
            viewer.addTiledImage({
                tileSource: {
                    type: "_blank",
                    error:
                        errorMessage ||
                        $.t("error.slide.pending") + " " + $.t("error.slide.imageLoadFail") + " " +
                        (originalSource && originalSource.toString ? originalSource.toString() : "")
                },
                opacity: 0,
                index,
                success: (e: any) => {
                    e.item.__targetIndex = index;
                    e.item.getConfig = (_type: string | undefined) => undefined;
                    onOpen(false);
                },
                error: (e: any) => {
                    console.error(e);
                    onOpen(false);
                }
            });
        };

        const deriveLoadKey = (dataSpec: any, source: any, fallbackIndex: number) => {
            try {
                const dataId = BackgroundConfig.dataFromSpec(dataSpec);
                if (dataId !== undefined) {
                    return `data:${typeof dataId === "string" ? dataId : safeStringify(dataId)}`;
                }
            } catch (_) {}

            const normalizedSource = source && typeof source === "object" && source.url !== undefined
                ? source.url
                : source;

            if (typeof normalizedSource === "string") return `source:${normalizedSource}`;

            try {
                const serialized = safeStringify(normalizedSource);
                if (serialized) return `source:${serialized}`;
            } catch (_) {}

            return `index:${fallbackIndex}`;
        };

        const configureOpenedItem = (item: any, kind: string, index: number, ctx: any) => {
            item.__targetIndex = index;
            if (ctx && typeof ctx.loadKeyForItem === "function") {
                item.__xopatLoadKey = ctx.loadKeyForItem(index);
            }

            if (kind === "background") {
                const bgIdx = ctx.bgIndexForItem(index);
                item.getConfig = (type: string | undefined) =>
                    !type || type === "background" ? cfg.background[bgIdx] : undefined;
            } else if (kind === "visualization") {
                const vIdx = ctx.vizIndexForItem(index);
                item.getConfig = (type: string | undefined) =>
                    !type || type === "visualization" ? cfg.visualizations[vIdx] : undefined;
            } else {
                item.getConfig = () => undefined;
            }

            const dataSpec = ctx && typeof ctx.dataForItem === "function"
                ? ctx.dataForItem(index)
                : undefined;

            const cfgForItem = item.getConfig();
            let sourceOptions = cfgForItem && cfgForItem.options;

            if (dataSpec && typeof dataSpec === "object" && dataSpec.options) {
                sourceOptions = { ...(dataSpec.options || {}), ...(sourceOptions || {}) };
            }

            if (sourceOptions !== undefined && item?.source?.setSourceOptions) {
                item.source.setSourceOptions(sourceOptions);
            }
        };

        const getExistingItemLoadKey = (item: any, fallbackIndex: number) => {
            if (!item) return `missing:${fallbackIndex}`;
            if (item.__xopatLoadKey) return item.__xopatLoadKey;

            const configForItem = item.getConfig?.() || item.getConfig?.("background") || item.getConfig?.("visualization");
            const dataSpec = configForItem?.dataReference !== undefined
                ? cfg.data[configForItem.dataReference]
                : configForItem;
            return deriveLoadKey(dataSpec, item.source?.url || item.source, fallbackIndex);
        };

        const collectViewerDataIndexes = (backgroundIndex: number | undefined, visualizationIndex: number | undefined) => {
            const refs = new Set<number>();
            const bgEntry = Number.isInteger(backgroundIndex) ? cfg.background[backgroundIndex as number] : undefined;
            const vizEntry = Number.isInteger(visualizationIndex) ? cfg.visualizations[visualizationIndex as number] : undefined;

            if (bgEntry && typeof bgEntry.dataReference === "number") {
                refs.add(bgEntry.dataReference);
            }
            for (const shader of bgEntry?.shaders || []) {
                forEachNestedShaderLayer(shader, (entry) => {
                    for (const ref of entry?.dataReferences || []) {
                        if (Number.isInteger(ref)) refs.add(ref);
                    }
                });
            }
            if (vizEntry?.shaders) {
                forEachVisualizationShader(vizEntry.shaders as Record<string, any>, (shader) => {
                    for (const ref of shader?.dataReferences || []) {
                        if (Number.isInteger(ref)) refs.add(ref);
                    }
                });
            }
            return Array.from(refs.values());
        };

        const applyBeforeOpenMutations = async () => {
            for (let viewerIndex = 0; viewerIndex < bgPlan.length; viewerIndex += 1) {
                const entry = bgPlan[viewerIndex];
                const viewer = viewerManager.viewers[viewerIndex];
                let backgroundIndex = entry.bgIndices[0];
                let visualizationIndex = Array.isArray(activeViz)
                    ? activeViz[viewerIndex]
                    : (Number.isInteger(activeViz) ? (activeViz as number) : undefined);
                let dataIndexes = collectViewerDataIndexes(backgroundIndex, visualizationIndex);

                const event = {
                    viewer,
                    viewerIndex,
                    entry,
                    backgroundIndex,
                    visualizationIndex,
                    background: Number.isInteger(backgroundIndex) ? config.background[backgroundIndex as number] : undefined,
                    visualization: Number.isInteger(visualizationIndex) ? config.visualizations[visualizationIndex as number] : undefined,
                    data: dataIndexes.map((index: number) => config.data[index]),
                    dataIndexes: [...dataIndexes],
                    opts,
                    changeKind: changesViewerCount || backgroundChanged ? "content" : "visualization",
                    changesViewerNature: changesViewerCount || backgroundChanged,
                    changesViewerCount,
                    isNewViewer: !viewer || !viewer.isOpen?.() || (viewer.world?.getItemCount?.() || 0) < 1,
                };

                await viewerManager.raiseEventAwaiting("before-open", event)
                    .catch((e: any) => console.warn("Exception in 'before-open' event handler: ", e));

                if (Number.isInteger(event.backgroundIndex)) {
                    backgroundIndex = event.backgroundIndex as number;
                    entry.bgIndices = [backgroundIndex];
                }
                if (Array.isArray(activeBg)) {
                    activeBg[viewerIndex] = backgroundIndex;
                } else if (Number.isInteger(backgroundIndex)) {
                    activeBg = [backgroundIndex];
                }

                if (Number.isInteger(event.visualizationIndex)) {
                    visualizationIndex = event.visualizationIndex as number;
                }
                if (Array.isArray(activeViz)) {
                    activeViz[viewerIndex] = visualizationIndex;
                } else if (Number.isInteger(visualizationIndex)) {
                    activeViz = [visualizationIndex];
                }

                dataIndexes = Array.isArray(event.dataIndexes)
                    ? [...event.dataIndexes]
                    : collectViewerDataIndexes(backgroundIndex, visualizationIndex);

                if (Number.isInteger(backgroundIndex) && event.background && !Array.isArray(event.background)) {
                    config.background[backgroundIndex as number] = BackgroundConfig.from(event.background as BackgroundItem | BackgroundConfig, true, false);
                }
                if (Number.isInteger(visualizationIndex) && event.visualization) {
                    config.visualizations[visualizationIndex as number] = event.visualization;
                }
                if (Array.isArray(event.data)) {
                    dataIndexes.forEach((dataIndex: number, index: number) => {
                        if (index in event.data) {
                            config.data[dataIndex] = event.data[index];
                        }
                    });
                }
            }

            appContext.setOption("activeBackgroundIndex", activeBg);
            appContext.setOption("activeVisualizationIndex", activeViz);
        };

        const openTile = async (viewer: OpenSeadragon.Viewer, source: any, kind: string, index: number, ctx: any) => {
            const originalSource = source.source || source;
            const tileSource = await viewer.instantiateTileSourceClass({
                tileSource: originalSource
            }).then((ev: any) => ev.source).catch((ev: any) => ev.message || String(ev));

            if (typeof tileSource === "string" || (typeof tileSource === "object" && tileSource.error) || tileSource instanceof Error) {
                console.error(`Failed to instantiate tile source for ${kind} ${index}: ${tileSource}`);
                await viewer.raiseEventAwaiting(
                    "tile-source-failed", { viewer, originalSource, kind, index, tileSource: null, error: tileSource }
                ).catch((e: any) => console.warn("Exception in 'tile-source-failed' event handler: ", e));
                return new Promise<boolean>(resolve => openPlaceholder(viewer, tileSource, index, originalSource, resolve));
            }

            await viewer.raiseEventAwaiting(
                "tile-source-created",
                { viewer, originalSource, kind, index, tileSource, error: null }
            ).catch((e: any) => console.warn("Exception in 'tile-source-created' event handler: ", e));
            console.log("Opening tile", kind, index, ctx);

            return new Promise<boolean>((resolve) => {
                viewer.addTiledImage({
                    tileSource,
                    index,
                    success: (event: any) => {
                        configureOpenedItem(event.item, kind, index, ctx);
                        resolve(true);
                    },
                    error: (e: any) => {
                        console.warn(e);
                        openPlaceholder(viewer, e.message || e, index, originalSource, resolve);
                    }
                });
            });
        };

        const beginViewerRenderTransaction = (viewer: OpenSeadragon.Viewer) => {
            const drawer: any = viewer?.drawer;
            const navigatorDrawer: any = viewer?.navigator?.drawer;

            try {
                drawer?.suspendRendering?.("xopat-open");
            } catch (e) {
                console.warn("Flex drawer suspendRendering failed.", e);
            }
            try {
                navigatorDrawer?.suspendRendering?.("xopat-open");
            } catch (e) {
                console.warn("Navigator flex drawer suspendRendering failed.", e);
            }

            return {
                finish: () => {
                    try {
                        navigatorDrawer?.resumeRendering?.("xopat-open");
                    } catch (e) {
                        console.warn("Navigator flex drawer resumeRendering failed.", e);
                    }
                    try {
                        drawer?.resumeRendering?.("xopat-open");
                    } catch (e) {
                        console.warn("Flex drawer resumeRendering failed.", e);
                    }
                }
            };
        };

        await applyBeforeOpenMutations();

        const effectiveSnapshot = captureLoadSnapshotFromConfig(config);
        const viewerUpdatePlans = bgPlan.map((entry: any, viewerIndex: number) => {
            const viewer = viewerManager.viewers[viewerIndex];
            const previousNatureFingerprint = buildViewerNatureFingerprint(previousSnapshot, viewerIndex);
            const nextNatureFingerprint = buildViewerNatureFingerprint(effectiveSnapshot, viewerIndex);
            const previousRenderFingerprint = buildViewerRenderFingerprint(previousSnapshot, viewerIndex);
            const nextRenderFingerprint = buildViewerRenderFingerprint(effectiveSnapshot, viewerIndex);
            const isNewViewer = !viewer || !viewer.isOpen?.() || (viewer.world?.getItemCount?.() || 0) < 1;

            let changeKind: "noop" | "content" | "visualization";
            if (isNewViewer) {
                changeKind = "content";
            } else if (previousRenderFingerprint === nextRenderFingerprint) {
                changeKind = "noop";
            } else if (previousNatureFingerprint !== nextNatureFingerprint || changesViewerCount) {
                changeKind = "content";
            } else {
                changeKind = "visualization";
            }

            return {
                entry,
                viewerIndex,
                changeKind,
            };
        });

        const debugOn = !!appContext.getOption("webglDebugMode");
        const plog = (phase: string, data?: any) => {
            if (!debugOn) return;
            if (data !== undefined) console.log(`[pipeline] ${phase}`, data);
            else console.log(`[pipeline] ${phase}`);
        };

        const openIntoViewer = async (plan: any) => {
            const { entry, viewerIndex } = plan;
            const viewer = viewerManager.viewers[viewerIndex];
            plog(`openIntoViewer ENTER v=${viewerIndex}`, {
                changeKind: plan.changeKind,
                isOpen: viewer.isOpen?.(),
                worldCount: viewer.world?.getItemCount?.(),
            });
            if (plan.changeKind === "noop" && viewer.isOpen() && viewer.world.getItemCount() > 0) {
                plog(`openIntoViewer SKIP v=${viewerIndex} (noop)`);
                return { skipped: true, viewerIndex };
            }

            const canSurgicallyDiff = plan.changeKind !== "content" && viewer.isOpen() && viewer.world.getItemCount() > 0;
            const viewerSupportsFlexRendering = !!(
                viewer?.drawer &&
                typeof viewer.drawer.getType === "function" &&
                viewer.drawer.getType() === "flex-renderer" &&
                typeof viewer.drawer.overrideConfigureAll === "function"
            );

            const openedBase: BackgroundConfig[] = [];
            const bgi = entry.bgIndices[0];
            if (Number.isInteger(bgi) && bgs[bgi]) openedBase.push(bgs[bgi]);

            let visIndexForThis: number | undefined = Array.isArray(activeViz)
                ? activeViz[viewerIndex]
                : (Number.isInteger(activeViz) ? (activeViz as number) : undefined);

            const renderingWithWebGL = viewerSupportsFlexRendering && renderingCapability.ok && Array.isArray(vis) && vis.length > 0 && Number.isInteger(visIndexForThis);
            const activeV = renderingWithWebGL ? vis[visIndexForThis as number] : undefined;
            if (!renderingWithWebGL && Array.isArray(vis) && vis.length > 0 && Number.isInteger(visIndexForThis) && (!viewerSupportsFlexRendering || !renderingCapability.ok)) {
                visualizationRuntime.warnRenderingCapability(renderingCapability.error || "Visualization rendering is unavailable; opening image data without visualization shaders.");
            }

            const toOpen: any[] = [];
            const uniqueOsdWorldIndexes: Map<any, number> = new Map();
            const openedSpecOrder: any[] = [];
            const renderOutput: Record<string, any> = {};

            const vizUrlFromEntries = (dataIndex: number) => {
                const spec = cfg.data[dataIndex] as DataSpecification;
                const isObjectSpec = spec && typeof spec === "object";

                if (isObjectSpec && (spec as DataOverride).tileSource instanceof OpenSeadragon.TileSource) {
                    return (spec as DataOverride).tileSource;
                }

                const customProto = isObjectSpec && (spec as DataOverride).protocol ? (spec as DataOverride).protocol
                    : (activeV && activeV.protocol ? activeV.protocol : null);

                const proto = (!isSecureMode && customProto) || env.client.data_group_protocol;
                const make = new Function("path,data", "return " + proto);
                return make(env.client.image_group_server, [BackgroundConfig.dataFromSpec(spec)]);
            };

            const isSeriesLikeMeta = (meta: any = {}) =>
                meta?.param === "series" || meta?.shaderType === "time-series";

            const shouldForceManagedShaderSourceEntry = (meta: any = {}) =>
                meta?.forceManaged === true || isSeriesLikeMeta(meta);

            const computeActiveSeriesIndex = (shaderConfig: any): number => {
                const timeline = shaderConfig?.params?.timeline || {};
                const min = Number(timeline.min);
                const step = Number(timeline.step);
                const def = Number(timeline.default);
                if (!Number.isFinite(def)) return 0;
                const base = Number.isFinite(min) ? min : 0;
                const stride = Number.isFinite(step) && step > 0 ? step : 1;
                return Math.max(0, Math.round((def - base) / stride));
            };

            const shaderSourceController: ViewerShaderSourceController | undefined =
                (viewer as any).__shaderSourceController;

            const buildManagedShaderSourceEntry = (
                dataIndex: number,
                sourceFactory: (dataIndex: number) => any,
                meta: any = {}
            ) => {
                // Re-normalization passthrough: entry was already resolved to
                // an integer world index or an opaque token on a prior pass.
                if (!Number.isInteger(dataIndex)) {
                    return dataIndex;
                }

                if ((dataIndex as number) < 0 || (dataIndex as number) >= cfg.data.length) {
                    return dataIndex;
                }

                const existingWorldIndex = uniqueOsdWorldIndexes.get(dataIndex);

                // Non-series / non-forced: cheap integer rebind if already opened,
                // else just return the raw data index for the caller to handle.
                if (!shouldForceManagedShaderSourceEntry(meta)) {
                    if (Number.isInteger(existingWorldIndex)) return existingWorldIndex;
                    return dataIndex;
                }

                // Series entries need runtime-reroutable bindings. We pre-open
                // only the active frame and hand out opaque tokens for the rest
                // so runtime scrubs go through our resolver (no library append).
                if (isSeriesLikeMeta(meta) && shaderSourceController) {
                    const tileSource = sourceFactory(dataIndex as number);
                    const loadKey = deriveLoadKey(cfg.data[dataIndex as number], tileSource, dataIndex as number);
                    shaderSourceController.registerDataSource(loadKey, () => ({
                        tileSource: sourceFactory(dataIndex as number),
                        openOptions: { opacity: 0 },
                    }));

                    const activeIndex = computeActiveSeriesIndex(meta?.config);
                    const isActiveEntry = meta?.entryIndex === activeIndex;

                    if (isActiveEntry) {
                        let worldIndex = existingWorldIndex;
                        if (!Number.isInteger(worldIndex)) {
                            worldIndex = toOpen.length;
                            uniqueOsdWorldIndexes.set(dataIndex, worldIndex);
                            toOpen.push(tileSource);
                            openedSpecOrder.push(cfg.data[dataIndex as number]);
                        }
                        const shaderId = meta?.config?.id || "shader";
                        shaderSourceController.registerShaderBinding(worldIndex as number, shaderId, 0, loadKey);
                        return worldIndex as number;
                    }

                    return makeXOpatSourceToken(loadKey, {
                        dataIndex: dataIndex as number,
                        shaderType: meta?.shaderType,
                        param: meta?.param,
                        entryIndex: meta?.entryIndex,
                    });
                }

                // Legacy forceManaged path: preserve the library descriptor shape.
                return {
                    worldIndex: Number.isInteger(existingWorldIndex) ? existingWorldIndex : undefined,
                    tileSource: sourceFactory(dataIndex as number),
                    openOptions: {
                        opacity: 0,
                    },
                };
            };

            openedBase.forEach((bg: BackgroundConfig) => {
                const index = bg.dataReference;
                if (!uniqueOsdWorldIndexes.has(index)) {
                    uniqueOsdWorldIndexes.set(index, toOpen.length);
                    toOpen.push(bgUrlFromEntry(bg));
                    openedSpecOrder.push(BackgroundConfig.dataSpecification(bg));
                }
            });

            openedBase.forEach((bgRef: BackgroundConfig, bgIndex: number) => {
                let bgShaders: VisualizationShaderGroupOrLayer[] | undefined = cloneRuntimeState(bgRef.shaders);
                if (!bgShaders) {
                    bgShaders = [{ type: "identity" }];
                } else if (!Array.isArray(bgShaders)) {
                    console.warn("Invalid shaders for background: array required.", bgIndex, bgRef, bgShaders);
                    bgShaders = [bgShaders as VisualizationShaderGroupOrLayer];
                }

                let count = 0;
                const resolveBackgroundShaderLayer = (shaderCfg: any) => {
                    const hasExplicitRefs = Array.isArray(shaderCfg.dataReferences) && shaderCfg.dataReferences.length > 0;

                    if (!hasExplicitRefs) {
                        const dataIndex = bgRef.dataReference as number;
                        shaderCfg.tiledImages = [uniqueOsdWorldIndexes.get(dataIndex) ?? -1];
                        shaderCfg.name = shaderCfg.name || bgRef.name || BackgroundConfig.data(bgRef);
                    } else {
                        shaderCfg.tiledImages = [];
                        shaderCfg.name = shaderCfg.name || UTILITIES.nameFromBGOrIndex(shaderCfg.dataReferences![0]);

                        for (const dataIndex of shaderCfg.dataReferences!) {
                            if (!uniqueOsdWorldIndexes.has(dataIndex)) {
                                uniqueOsdWorldIndexes.set(dataIndex, toOpen.length);
                                toOpen.push(bgUrlFromEntry(bgRef, cfg.data[dataIndex]));
                                openedSpecOrder.push(cfg.data[dataIndex]);
                            }
                            shaderCfg.tiledImages.push(uniqueOsdWorldIndexes.get(dataIndex) ?? -1);
                        }
                    }

                    if (shaderCfg.shaders && typeof shaderCfg.shaders === "object" && !Array.isArray(shaderCfg.shaders)) {
                        for (const childShaderCfg of Object.values(shaderCfg.shaders)) {
                            resolveBackgroundShaderLayer(childShaderCfg);
                        }
                    }
                };

                for (const shaderCfg of bgShaders) {
                    shaderCfg.id = count < 1 ? bgRef.id : `${bgRef.id}-${count}`;
                    resolveBackgroundShaderLayer(shaderCfg);
                    normalizeRendererShaderConfig(shaderCfg, {
                        rootKind: "background",
                        rootConfig: bgRef,
                        expandDataSourceRef: (entry: any, meta: any = {}) => buildManagedShaderSourceEntry(
                            entry,
                            (dataIndex: number) => bgUrlFromEntry(bgRef, cfg.data[dataIndex]),
                            meta
                        ),
                    });
                    renderOutput[shaderCfg.id] = shaderCfg;
                    count++;
                }
            });

            const firstVizIndex = toOpen.length;
            let shaderConfigMap: Record<string, VisualizationShaderGroupOrLayer> = {};

            if (renderingWithWebGL && activeV) {
                appContext.prepareRendering();
                shaderConfigMap = cloneRuntimeState(activeV.shaders || {});

                forEachVisualizationShader(shaderConfigMap as Record<string, any>, (vizShaderCfg, shaderId) => {
                    vizShaderCfg.tiledImages = [];

                    const dataRefs = vizShaderCfg.dataReferences || [];
                    const firstSpec = dataRefs.length ? cfg.data[dataRefs[0] ?? 0] : undefined;
                    const firstId = BackgroundConfig.dataFromSpec(firstSpec);
                    vizShaderCfg.name = (vizShaderCfg.name || firstId || shaderId) as string;

                    for (const dataIndex of dataRefs) {
                        if (!uniqueOsdWorldIndexes.has(dataIndex)) {
                            uniqueOsdWorldIndexes.set(dataIndex, toOpen.length);
                            toOpen.push(vizUrlFromEntries(dataIndex));
                            openedSpecOrder.push(cfg.data[dataIndex]);
                        }

                        vizShaderCfg.tiledImages.push(uniqueOsdWorldIndexes.get(dataIndex) ?? -1);
                    }
                });

                normalizeRendererShaderMap(shaderConfigMap as Record<string, any>, {
                    rootKind: "visualization",
                    rootConfig: activeV,
                    expandDataSourceRef: (entry: any, meta: any = {}) => buildManagedShaderSourceEntry(
                        entry,
                        vizUrlFromEntries,
                        meta
                    ),
                });

                Object.assign(renderOutput, shaderConfigMap);
            }

            // Cross-shader binding refs: the resolver's "sole user vs shared"
            // decision relies on knowing every shader that references a world
            // index, not just the ones we pre-opened. Walk the assembled
            // renderOutput once so bg+viz overlap (which is common) doesn't
            // make the resolver wrongly swap in place.
            if (shaderSourceController) {
                shaderSourceController.resetBindings();
                const registerRefsFor = (config: any, idOverride?: string) => {
                    if (!config || typeof config !== "object") return;
                    const shaderId = idOverride || config.id || "shader";
                    const tiledImages = Array.isArray(config.tiledImages) ? config.tiledImages : [];
                    for (let i = 0; i < tiledImages.length; i++) {
                        const w = tiledImages[i];
                        if (Number.isInteger(w) && (w as number) >= 0) {
                            shaderSourceController.registerShaderBinding(w as number, shaderId, i);
                        }
                    }
                    if (Array.isArray(config.series)) {
                        // time-series active entry is an integer; non-active are tokens.
                        for (const entry of config.series) {
                            if (Number.isInteger(entry) && (entry as number) >= 0) {
                                shaderSourceController.registerShaderBinding(entry as number, shaderId, 0);
                            }
                        }
                    }
                    if (config.shaders && typeof config.shaders === "object" && !Array.isArray(config.shaders)) {
                        for (const [childId, child] of Object.entries(config.shaders)) {
                            registerRefsFor(child, `${shaderId}/${childId}`);
                        }
                    }
                };
                for (const [rootId, rootCfg] of Object.entries(renderOutput)) {
                    registerRefsFor(rootCfg, (rootCfg as any)?.id || rootId);
                }
            }

            const loadKeys = toOpen.map((source, index) => deriveLoadKey(openedSpecOrder[index], source, index));

            if (!canSurgicallyDiff) {
                viewerManager._resetViewer(viewerIndex);
            }

            const ctx = {
                bgIndexForItem: (i: number) => entry.bgIndices[0],
                vizIndexForItem: (i: number) => visIndexForThis,
                dataForItem: (i: number) => openedSpecOrder[i],
                loadKeyForItem: (i: number) => loadKeys[i],
            };

            plog(`openIntoViewer PLAN v=${viewerIndex}`, {
                toOpen: toOpen.length,
                firstVizIndex,
                renderOutputIds: Object.keys(renderOutput),
                canSurgicallyDiff,
                viewerSupportsFlexRendering,
            });

            const renderTransaction = beginViewerRenderTransaction(viewer);
            plog(`openIntoViewer TRANSACTION BEGAN v=${viewerIndex}`);

            let successOpened = 0;
            const retainedItems = new Set<any>();
            try {
                plog(`openIntoViewer TILE LOOP START v=${viewerIndex}`);
                for (let i = 0; i < toOpen.length; i++) {
                    const kind = i < firstVizIndex ? "background" : "visualization";
                    let reusable = canSurgicallyDiff ? viewer.world.getItemAt(i) : null;

                    if (reusable && getExistingItemLoadKey(reusable, i) === loadKeys[i] && !retainedItems.has(reusable)) {
                        configureOpenedItem(reusable, kind, i, ctx);
                        retainedItems.add(reusable);
                        successOpened++;
                        continue;
                    }

                    reusable = null;
                    if (canSurgicallyDiff) {
                        const currentCount = viewer.world.getItemCount();
                        for (let j = i + 1; j < currentCount; j++) {
                            const candidate = viewer.world.getItemAt(j);
                            if (!candidate || retainedItems.has(candidate)) continue;
                            if (getExistingItemLoadKey(candidate, j) !== loadKeys[i]) continue;
                            reusable = candidate;
                            break;
                        }
                    }

                    if (reusable) {
                        viewer.world.setItemIndex(reusable, i);
                        configureOpenedItem(reusable, kind, i, ctx);
                        retainedItems.add(reusable);
                        successOpened++;
                        continue;
                    }

                    if (await openTile(viewer, toOpen[i], kind, i, ctx)) {
                        const openedItem = viewer.world.getItemAt(i);
                        if (openedItem) retainedItems.add(openedItem);
                        successOpened++;
                    }
                }

                if (canSurgicallyDiff) {
                    for (let i = viewer.world.getItemCount() - 1; i >= 0; i--) {
                        const item = viewer.world.getItemAt(i);
                        if (!retainedItems.has(item)) {
                            viewer.world.removeItem(item);
                        }
                    }
                }

                plog(`openIntoViewer TILE LOOP DONE v=${viewerIndex}`, {
                    successOpened,
                    worldCount: viewer.world.getItemCount(),
                });

                const applyRendererConfiguration = async () => {
                    if (!viewerSupportsFlexRendering || !viewer.drawer?.overrideConfigureAll) {
                        return false;
                    }

                    if (!Object.keys(renderOutput).length) {
                        await viewer.drawer.overrideConfigureAll(undefined);
                        return false;
                    }

                    const attemptApply = async () => {
                        await viewer.drawer.overrideConfigureAll(renderOutput);
                        return true;
                    };

                    UTILITIES.applyStoredVisualizationSnapshot(renderOutput);
                    try {
                        return await attemptApply();
                    } catch (error) {
                        console.warn("Renderer configuration failed, retrying without cached shader state.", error);
                        if (!visualizationRuntime.clearVisualizationCaches(renderOutput)) {
                            throw error;
                        }
                        return await attemptApply();
                    }
                };

                if (viewerSupportsFlexRendering) {
                    try {
                        plog(`openIntoViewer waitForViewerRenderReady BEGIN v=${viewerIndex}`);
                        await this.waitForViewerRenderReady(viewer);
                        plog(`openIntoViewer waitForViewerRenderReady DONE v=${viewerIndex}`);
                        plog(`openIntoViewer waitForNavigatorParity BEGIN v=${viewerIndex}`, {
                            mainCount: viewer.world?.getItemCount?.(),
                            navCount: (viewer.navigator as any)?.world?.getItemCount?.(),
                        });
                        await this.waitForNavigatorParity(viewer);
                        plog(`openIntoViewer waitForNavigatorParity DONE v=${viewerIndex}`, {
                            mainCount: viewer.world?.getItemCount?.(),
                            navCount: (viewer.navigator as any)?.world?.getItemCount?.(),
                        });
                        plog(`openIntoViewer applyRendererConfiguration BEGIN v=${viewerIndex}`);
                        await applyRendererConfiguration();
                        plog(`openIntoViewer applyRendererConfiguration DONE v=${viewerIndex}`);
                    } catch (error) {
                        try {
                            await viewer.drawer.overrideConfigureAll(undefined);
                        } catch (resetError) {
                            console.warn("Failed to reset renderer after configuration failure.", resetError);
                        }

                        if (strictVisualization) {
                            throw error;
                        }

                        console.error("Visualization renderer configuration failed.", error);
                        if (!opts.suppressDialogsOnVisualizationFailure) {
                            Dialogs.show($.t("error.slide.failed"), 15000, Dialogs.MSG_WARN);
                        }
                    }
                }

                if (!canSurgicallyDiff || viewer.world.getItemCount() < 1) {
                    stateBindings.handleSyntheticOpenEvent(viewer, successOpened, toOpen.length);
                } else {
                    stateBindings.refreshViewerVisualizationBindings(viewer, 0);
                }
            } finally {
                plog(`openIntoViewer TRANSACTION FINISH v=${viewerIndex}`);
                renderTransaction.finish();
                plog(`openIntoViewer EXIT v=${viewerIndex}`);
            }
        };

        const loadTooLongTimeout = setTimeout(
            () => Dialogs.show($.t("error.slide.pending"), 15000, Dialogs.MSG_WARN),
            8000
        );

        let openSucceeded = true;
        await Promise.allSettled(viewerUpdatePlans.map(openIntoViewer)).then(e => {
            let hadRejectedOpen = false;
            for (const promise of e) {
                if (promise.status === "rejected") {
                    hadRejectedOpen = true;
                    console.error("Failed to open viewer item", promise.reason);
                    Dialogs.show($.t("error.slide.failed"), 15000, Dialogs.MSG_WARN);
                }
            }

            this.deps.runLoaderOnce();

            if (hadRejectedOpen && strictVisualization) {
                throw new Error("Failed to apply one or more visualization updates.");
            }

            if (maybeLoadingTimeout) {
                clearTimeout(maybeLoadingTimeout);
                maybeLoadingTimeout = undefined;
            }
            clearTimeout(loadTooLongTimeout);
            if (!viewerManager.get() && viewerManager.viewers.length > 0) {
                viewerManager.setActive(0, "open-complete");
            }

            if (backgroundChanged) {
                viewerManager.raiseEvent("after-open");
            } else if (anythingVisibleChanged) {
                viewerManager.raiseEvent("after-open");
            }

            USER_INTERFACE.Loading.show(false);
            appContext.setDirty();
            UTILITIES.updateTheme(null);
            UTILITIES.syncOpenedViewersToSession();
            UTILITIES.syncSessionToUrl(false);

            if (!opts.fromHistory && history && history.isRecordingEnabled !== false && anythingChanged) {
                if (historyMode === "reset-history") {
                    history.clear?.({
                        kind: "load-history-reset",
                        reason: "background-changed",
                        previousSnapshot,
                        nextSnapshot: captureLoadSnapshotFromConfig(config),
                    });
                } else if (historyMode === "content-switch" || historyMode === "visualization-step") {
                    const appliedSnapshot = captureLoadSnapshotFromConfig(config);
                    history.pushExecuted?.(
                        () => restoreLoadSnapshot(appliedSnapshot),
                        () => restoreLoadSnapshot(previousSnapshot),
                        {
                            kind: historyMode,
                            label: opts.historyLabel || (historyMode === "content-switch" ? "content switch" : "visualization change"),
                        }
                    );
                }
            }
        }).catch(e => {
            openSucceeded = false;
            if (maybeLoadingTimeout) {
                clearTimeout(maybeLoadingTimeout);
            }
            clearTimeout(loadTooLongTimeout);
            console.error("Failed to open viewer items", e);
            USER_INTERFACE.Loading.show(false);
            Dialogs.show($.t("error.slide.failed"), 15000, Dialogs.MSG_ERROR);
            if (strictVisualization) {
                throw e;
            }
        });
        return openSucceeded;
    }
}
