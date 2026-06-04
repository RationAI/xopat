import { BackgroundConfig } from "../background-config";
import { ViewerSelectionState } from "./viewer-selection-state";
import { ViewerStateBindingController } from "./viewer-state-binding-controller";
import { ViewerVisualizationRuntime } from "./viewer-visualization-runtime";
import { ViewerShaderSourceController, makeXOpatSourceToken } from "./viewer-shader-source-controller";
import { assembleBackgroundShaders, assembleVisualizationShaders } from "./assemble-render-output";

export interface OpenViewerWithOptions {
    dataMode?: "replace" | "merge" | "merge-exact";
    backgroundMode?: "replace" | "merge" | "merge-exact";
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
    runLoaderOnce: () => Promise<void> | void;
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
        const appContext = this.deps.appContext;
        const activeBackground = ViewerSelectionState.normalizeSelectionValue(
            appContext.getOption("activeBackgroundIndex", undefined, true, true)
        ) || [];

        while (activeBackground.length <= viewerIndex) {
            activeBackground.push(activeBackground[0]);
        }

        if (selection.backgroundIndex !== undefined) {
            activeBackground[viewerIndex] = Number.isInteger(selection.backgroundIndex)
                ? selection.backgroundIndex as number
                : undefined;
        }

        // Slot-aligned vizSpec: only the targeted slot carries a value;
        // openViewerWith's fold leaves `undefined` slots untouched (so other
        // viewers' viz selections are preserved) and writes the new value
        // onto the slot's background entry AFTER previousSnapshot capture —
        // mutating live config here would clobber the diff and short-circuit
        // the rebuild as historyMode="skip".
        let vizSpec: Array<number | undefined | null> | undefined = undefined;
        if (selection.visualizationIndex !== undefined) {
            vizSpec = new Array(activeBackground.length).fill(undefined);
            vizSpec[viewerIndex] = Number.isInteger(selection.visualizationIndex)
                ? selection.visualizationIndex as number
                : null;
        }

        return this.openViewerWith(
            undefined,
            undefined,
            undefined,
            activeBackground,
            vizSpec as any,
            opts
        );
    }

    async openViewerWith(
        data = undefined,
        background: BackgroundItem[] | undefined = undefined,
        visualizations: VisualizationItem[] | undefined = undefined,
        bgSpec: number | Array<number | undefined> | undefined | null = undefined,
        vizSpec: number | Array<number | undefined> | undefined | null = undefined,
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

        const normalizeCollectionMode = (value: any): "replace" | "merge" | "merge-exact" =>
            value === "merge" ? "merge"
                : value === "merge-exact" ? "merge-exact"
                    : "replace";
        const cloneForMerge = <T>(value: T): T => cloneRuntimeState(value);
        const sameMergedDataEntry = (a: any, b: any) => safeStringify(a) === safeStringify(b);
        const remapSelectionByIndexMap = (
            value: number | Array<number | undefined> | undefined | null,
            indexMap: Map<number, number>
        ): number | Array<number | undefined> | undefined | null => {
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
            incomingData: DataID[],
            exact = false
        ): { data: DataID[]; indexMap: Map<number, number>; baseToNew?: Map<number, number>; } => {
            // "exact" mode treats incomingData as the complete intended set:
            // existing entries that have no identity match in incoming are
            // dropped. Identity-matching incoming entries reuse the existing
            // slot's data so cross-references stay stable. Returns an
            // additional `baseToNew` map so callers can remap any preserved
            // references (existing visualizations / backgrounds keyed by base
            // data index) through the new data layout.
            if (exact) {
                const base = Array.isArray(baseData) ? baseData : [];
                const incoming = Array.isArray(incomingData) ? incomingData : [];
                const data: DataID[] = [];
                const indexMap = new Map<number, number>();
                const baseToNew = new Map<number, number>();
                incoming.forEach((entry: any, index: number) => {
                    const existingIndex = base.findIndex((candidate: any) => sameMergedDataEntry(candidate, entry));
                    if (existingIndex >= 0) {
                        data.push(cloneForMerge(base[existingIndex]));
                        baseToNew.set(existingIndex, data.length - 1);
                    } else {
                        data.push(cloneForMerge(entry));
                    }
                    indexMap.set(index, data.length - 1);
                });
                return { data, indexMap, baseToNew };
            }

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
            incomingBackground: Array<BackgroundItem | BackgroundConfig>,
            exact = false
        ): { background: Array<BackgroundItem | BackgroundConfig>; indexMap: Map<number, number>; } => {
            const findExistingIndex = (
                pool: Array<BackgroundItem | BackgroundConfig>,
                clonedEntry: any
            ): number => {
                let idx = pool.findIndex((candidate: any) =>
                    candidate?.id && clonedEntry?.id && candidate.id === clonedEntry.id
                );
                if (idx < 0) {
                    idx = pool.findIndex((candidate: any) =>
                        appContext.sameBackground(candidate, clonedEntry)
                    );
                }
                return idx;
            };

            // "exact" mode rebuilds the list to exactly mirror incoming: any
            // base entries without a counterpart in incoming are dropped,
            // matched entries reuse the freshly-cloned incoming payload.
            if (exact) {
                const base = Array.isArray(baseBackground) ? baseBackground : [];
                const incoming = Array.isArray(incomingBackground) ? incomingBackground : [];
                const background: Array<BackgroundItem | BackgroundConfig> = [];
                const indexMap = new Map<number, number>();
                incoming.forEach((entry: any, index: number) => {
                    const clonedEntry = cloneForMerge(entry);
                    background.push(clonedEntry);
                    indexMap.set(index, background.length - 1);
                });
                return { background, indexMap };
            }

            const mergedBackground = cloneForMerge(Array.isArray(baseBackground) ? baseBackground : []);
            const indexMap = new Map<number, number>();

            (Array.isArray(incomingBackground) ? incomingBackground : []).forEach((entry: any, index: number) => {
                const clonedEntry = cloneForMerge(entry);
                let mergedIndex = findExistingIndex(mergedBackground, clonedEntry);

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
        });

        // Viz index for slot `viewerIndex` is derived from the slot's bg entry
        // in the snapshot: snapshot.background[activeBg[k]].visualizationIndex.
        // Falls back to slot 0's bg if the slot is out of range (legacy
        // broadcast behavior).
        const vizIndexFromSnapshot = (snapshot: any, viewerIndex: number): number | undefined => {
            const backgrounds = Array.isArray(snapshot?.background) ? snapshot.background : [];
            const activeBg = normalizeHistorySelection(snapshot?.activeBackgroundIndex) || [];
            const bgIdx = viewerIndex < activeBg.length ? activeBg[viewerIndex] : activeBg[0];
            if (!Number.isInteger(bgIdx)) return undefined;
            const bg: any = backgrounds[bgIdx as number];
            const v = bg?.visualizationIndex;
            return Number.isInteger(v) ? v as number : undefined;
        };

        const selectedBackgroundIdsFromSnapshot = (snapshot: any): string[] => {
            const selected = normalizeHistorySelection(snapshot?.activeBackgroundIndex) || [];
            const backgrounds = Array.isArray(snapshot?.background) ? snapshot.background : [];
            return selected
                .map((index: number | undefined) => Number.isInteger(index) ? backgrounds[index as number] : undefined)
                .filter(Boolean)
                .map((entry: BackgroundItem | BackgroundConfig) => appContext.registerConfig(entry).id);
        };

        const selectedVisualizationConfigsFromSnapshot = (snapshot: any) => {
            const activeBg = normalizeHistorySelection(snapshot?.activeBackgroundIndex) || [];
            const visualizationItems = Array.isArray(snapshot?.visualizations) ? snapshot.visualizations : [];
            return activeBg.map((_: any, slot: number) => {
                const v = vizIndexFromSnapshot(snapshot, slot);
                return Number.isInteger(v) ? visualizationItems[v as number] : undefined;
            });
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
            if (viewerIndex < selected.length) {
                return selected[viewerIndex];
            }
            return selected[0];
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
            const vizIndex = vizIndexFromSnapshot(snapshot, viewerIndex);
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
            const vizIndex = vizIndexFromSnapshot(snapshot, viewerIndex);
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
            const vizIndex = vizIndexFromSnapshot(snapshot, viewerIndex);

            return safeStringify({
                viewerIndex,
                background: Number.isInteger(bgIndex) ? backgrounds[bgIndex as number] : null,
                visualization: Number.isInteger(vizIndex) ? visualizationItems[vizIndex as number] : null,
                data: collectViewerReferencedData(snapshot, viewerIndex),
            });
        };

        const restoreLoadSnapshot = async (snapshot: any) => {
            if (!snapshot) return false;
            // Per-viewer viz lives on the cloned `background` array (each entry
            // carries its `visualizationIndex`); no separate vizSpec needed.
            return await this.openViewerWith(
                cloneForHistory(snapshot.data),
                cloneForHistory(snapshot.background),
                cloneForHistory(snapshot.visualizations),
                cloneForHistory(snapshot.activeBackgroundIndex),
                undefined,
                {
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

        if (data !== null && (dataMode === "merge" || dataMode === "merge-exact") && Array.isArray(normalizedData)) {
            const mergedData = mergeDataCollection(existingData, normalizedData, dataMode === "merge-exact");
            remapBackgroundDataReferences(normalizedBackground as Array<BackgroundItem | BackgroundConfig>, mergedData.indexMap);
            remapVisualizationDataReferences(normalizedVisualizations as VisualizationItem[], mergedData.indexMap);
            // merge-exact may have shifted indices of preserved entries: any
            // existing visualizations / backgrounds we keep beyond this point
            // still reference data by BASE index, so remap them through the
            // base→new map. Entries pointing to dropped data become a numeric
            // index outside `mergedData.data.length` — validators downstream
            // (validateVisualizationCollection) will surface those as errors.
            if (mergedData.baseToNew) {
                remapBackgroundDataReferences(existingBackground as Array<BackgroundItem | BackgroundConfig>, mergedData.baseToNew);
                remapVisualizationDataReferences(existingVisualizations as VisualizationItem[], mergedData.baseToNew);
            }
            normalizedData = mergedData.data;
        }

        if (background !== null && (backgroundMode === "merge" || backgroundMode === "merge-exact") && Array.isArray(normalizedBackground)) {
            const mergedBackground = mergeBackgroundCollection(existingBackground, normalizedBackground, backgroundMode === "merge-exact");
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

        // Fold any legacy shape carried in the freshly merged config:
        //   - `background[i].goalIndex` → `background[i].visualizationIndex`
        //   - top-level `activeVisualizationIndex` → distributed onto bg entries
        // BackgroundConfig.from already folded per-bg goalIndex on each entry
        // it wrapped; this call additionally handles the top-level param.
        BackgroundConfig.migrateLegacyConfig(appContext._dangerouslyAccessConfig());

        const cfg = appContext.config;
        const bgs: BackgroundConfig[] = Array.isArray(cfg.background) ? cfg.background : [];
        const vis = Array.isArray(cfg.visualizations) ? cfg.visualizations : [];
        const isSecureMode = !!appContext.secure;

        const selectionStateChanged = !!UTILITIES.parseBackgroundSelection(effectiveBgSpec);

        let activeBg = appContext.getOption("activeBackgroundIndex", undefined, true, true);

        // getOption falls back to `defaultParams.activeBackgroundIndex = 0` when
        // a prior `setOption(..., undefined)` deleted the cache+params entry.
        // When the background array is genuinely empty we must NOT let that
        // default resurrect an index — the selection was just cleared on purpose.
        if (!Array.isArray(activeBg) && Number.isInteger(activeBg) && bgs.length === 0) {
            activeBg = undefined;
        }

        if (activeBg === undefined && bgs.length > 0) {
            activeBg = 0;
        }

        if (typeof activeBg === "number") {
            activeBg = [activeBg];
            appContext.setOption("activeBackgroundIndex", activeBg);
        }

        // Fold the `vizSpec` parameter (back-compat) into bg entries. Modern
        // callers should mutate `background[i].visualizationIndex` directly;
        // `vizSpec` remains accepted so existing scripting/session-restore
        // callers keep working.
        if (vizSpec !== undefined && Array.isArray(activeBg)) {
            const vizArr = vizSpec === null
                ? activeBg.map(() => null)
                : (Array.isArray(vizSpec) ? vizSpec : [vizSpec]);
            const broadcast = vizArr.length > 0 && Number.isInteger(vizArr[0])
                ? vizArr[0] as number
                : undefined;
            for (let slot = 0; slot < activeBg.length; slot++) {
                const bgIdx = activeBg[slot];
                if (!Number.isInteger(bgIdx) || !bgs[bgIdx as number]) continue;
                const value = slot < vizArr.length ? vizArr[slot] : broadcast;
                if (Number.isInteger(value)) {
                    (bgs[bgIdx as number] as any).visualizationIndex = value as number;
                } else if (value === null) {
                    (bgs[bgIdx as number] as any).visualizationIndex = null;
                }
            }
        }

        const nextSnapshot = captureLoadSnapshotFromConfig(config);
        const selectedBackgroundsBefore = selectedBackgroundIdsFromSnapshot(previousSnapshot);
        const selectedBackgroundsAfter = selectedBackgroundIdsFromSnapshot(nextSnapshot);
        const backgroundChanged = hadOpenViewerState && JSON.stringify(selectedBackgroundsBefore) !== JSON.stringify(selectedBackgroundsAfter);
        const explicitSelectionUpdate =
            bgSpec !== undefined ||
            vizSpec !== undefined;
        const selectionChangedDuringParse = hadOpenViewerState && explicitSelectionUpdate && selectionStateChanged;
        const anythingVisibleChanged = hadOpenViewerState && (
            visibleLoadChanged(previousSnapshot, nextSnapshot) ||
            selectionChangedDuringParse
        );
        const anythingChanged = hadOpenViewerState && (
            !loadSnapshotsEqual(previousSnapshot, nextSnapshot) ||
            selectionChangedDuringParse
        );

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
        const closingToEmpty = selectedBackgroundsAfter.length === 0;
        if (!opts.fromHistory && backgroundChanged && historyMode === "reset-history" && hasCommittedHistory && !closingToEmpty) {
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
            const resolved = (window as any).SLIDE_PROTOCOLS.resolveBackground({
                spec,
                bgEntry,
                isSecureMode,
            });
            return resolved.kind === "tileSource" ? resolved.tileSource : resolved.url;
        };

        // Renderer-side shader-config normalization wrappers were inlined here
        // and consumed by the bg/viz assembly walk. The walk now lives in
        // assemble-render-output.ts which holds its own thin delegates around
        // FlexRenderer.normalizeShaderConfig / normalizeShaderMap, so the
        // wrappers are no longer needed in this file.

        const openPlaceholder = (viewer: OpenSeadragon.Viewer, errorMessage: any, index: number, originalSource: any, onOpen: (ok: boolean) => void) => {
            // A real EmptyTileSource (rather than `{ type: "_blank" }`) so downstream
            // code that reads `item.source.dimensions` — annotations wrapper,
            // scalebar, navigator, etc. — sees a valid TiledImage instead of
            // crashing on an undefined `.source`. The dimensions mirror the
            // sentinel used by viewer-state-binding-controller.ts.
            const errorText =
                errorMessage ||
                $.t("error.slide.pending") + " " + $.t("error.slide.imageLoadFail") + " " +
                (originalSource && originalSource.toString ? originalSource.toString() : "");
            viewer.addTiledImage({
                tileSource: new (OpenSeadragon as any).EmptyTileSource({
                    width: 20000,
                    height: 20000,
                    tileSize: 512,
                    error: errorText,
                }),
                opacity: 0,
                index,
                success: (e: any) => {
                    e.item.__targetIndex = index;
                    e.item.getConfig = (_type: string | undefined) => undefined;
                    console.info(`[openPlaceholder] EmptyTileSource registered at index=${index}, worldCount=${viewer.world.getItemCount()}`);
                    onOpen(false);
                },
                error: (e: any) => {
                    console.error("[openPlaceholder] EmptyTileSource failed to attach:", e);
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
                const bgEntry: any = Number.isInteger(backgroundIndex) ? config.background[backgroundIndex as number] : undefined;
                let visualizationIndex = Number.isInteger(bgEntry?.visualizationIndex)
                    ? bgEntry.visualizationIndex as number
                    : undefined;
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
                } else if (Number.isInteger(backgroundIndex) && config.background[backgroundIndex as number]) {
                    activeBg = [backgroundIndex];
                }

                if (Number.isInteger(event.visualizationIndex)) {
                    visualizationIndex = event.visualizationIndex as number;
                }
                // Per-viewer viz state lives on the bg entry — write back any
                // override produced by the `before-open` handler chain.
                if (Number.isInteger(backgroundIndex) && config.background[backgroundIndex as number]) {
                    (config.background[backgroundIndex as number] as any).visualizationIndex =
                        Number.isInteger(visualizationIndex) ? visualizationIndex : null;
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
        };

        const openTile = async (viewer: OpenSeadragon.Viewer, source: any, kind: string, index: number, ctx: any) => {
            const originalSource = source.source || source;
            // Determine the per-protocol HttpClient (if any). For a URL the
            // registry matches by baseURL prefix; for a pre-built TileSource
            // the registry already stamped `__xopatHttpClient` at resolve
            // time. The active client is set during instantiation so OSD's
            // metadata fetch (via the patched makeAjaxRequest) routes
            // through it; afterwards we stamp the resulting source so the
            // patched downloadTileStart picks it up for every tile.
            const SP = (window as any).SLIDE_PROTOCOLS;
            const client = typeof originalSource === "string"
                ? SP?.getActiveClientForUrl?.(originalSource)
                : originalSource?.__xopatHttpClient;
            const tileSource = await SP.withActiveClient(client, () =>
                viewer.instantiateTileSourceClass({ tileSource: originalSource })
                    .then((ev: any) => ev.source)
                    .catch((ev: any) => ev.message || String(ev))
            );
            if (client && tileSource && typeof tileSource === "object" && !tileSource.error && !(tileSource as any).__xopatHttpClient) {
                (tileSource as any).__xopatHttpClient = client;
            }

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
        // captureLoadSnapshotFromConfig reads activeBackgroundIndex via
        // getOption, which falls back to defaultParams (= 0) after a
        // deliberate clear. Override with the locally-normalized selection so
        // downstream consumers (per-viewer changeKind, state-binding
        // controller, session sync) see the actual cleared state instead of a
        // phantom [0] against an empty bg array. Viz selection lives on bg
        // entries already cloned into the snapshot.
        (effectiveSnapshot as any).activeBackgroundIndex = normalizeHistorySelection(activeBg);
        const viewerUpdatePlans = bgPlan.map((entry: any, viewerIndex: number) => {
            const viewer = viewerManager.viewers[viewerIndex];
            const previousNatureFingerprint = buildViewerNatureFingerprint(previousSnapshot, viewerIndex);
            const nextNatureFingerprint = buildViewerNatureFingerprint(effectiveSnapshot, viewerIndex);
            const previousRenderFingerprint = buildViewerRenderFingerprint(previousSnapshot, viewerIndex);
            const nextRenderFingerprint = buildViewerRenderFingerprint(effectiveSnapshot, viewerIndex);
            const previousBgSelection = selectionAt(previousSnapshot?.activeBackgroundIndex, viewerIndex);
            const nextBgSelection = selectionAt(effectiveSnapshot?.activeBackgroundIndex, viewerIndex);
            const previousVizSelection = vizIndexFromSnapshot(previousSnapshot, viewerIndex);
            const nextVizSelection = vizIndexFromSnapshot(effectiveSnapshot, viewerIndex);
            const selectionChangedForViewer =
                previousBgSelection !== nextBgSelection ||
                previousVizSelection !== nextVizSelection;
            const visualizationSelectionChangedForViewer =
                previousVizSelection !== nextVizSelection;
            const isNewViewer = !viewer || !viewer.isOpen?.() || (viewer.world?.getItemCount?.() || 0) < 1;

            let changeKind: "noop" | "content" | "visualization";
            if (isNewViewer) {
                changeKind = "content";
            } else if (selectionChangedForViewer) {
                changeKind = previousBgSelection !== nextBgSelection || changesViewerCount
                    ? "content"
                    : "visualization";
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
                visualizationSelectionChangedForViewer,
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

            // Viz for this viewer is the slot's bg entry's `visualizationIndex`.
            let visIndexForThis: number | undefined;
            const bgForViewer: any = Number.isInteger(bgi) ? bgs[bgi] : undefined;
            if (bgForViewer && Number.isInteger(bgForViewer.visualizationIndex)) {
                visIndexForThis = bgForViewer.visualizationIndex as number;
            }

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
                const resolved = (window as any).SLIDE_PROTOCOLS.resolveVisualization({
                    spec,
                    vizEntry: activeV,
                    isSecureMode,
                });
                return resolved.kind === "tileSource" ? resolved.tileSource : resolved.url;
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
                    // opacity > 0 is required so the flex-renderer's first-pass
                    // actually paints this tile into its atlas layer
                    // (flex-renderer.js:_drawTwoPassFirst gates on getOpacity() > 0).
                    // OSD's classic compositor is bypassed by the two-pass model,
                    // so this opacity does NOT affect on-screen layering — it only
                    // controls whether the source is sampleable by the second pass.
                    shaderSourceController.registerDataSource(loadKey, () => ({
                        tileSource: sourceFactory(dataIndex as number),
                        // todo: test 0
                        openOptions: { opacity: 1 },
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

            const allocateWorldIndex = (
                dataIndex: number,
                kind: "background" | "visualization",
                bgRef?: BackgroundConfig,
            ): number => {
                if (uniqueOsdWorldIndexes.has(dataIndex)) {
                    return uniqueOsdWorldIndexes.get(dataIndex) as number;
                }
                const allocated = toOpen.length;
                uniqueOsdWorldIndexes.set(dataIndex, allocated);
                if (kind === "background" && bgRef) {
                    toOpen.push(bgUrlFromEntry(bgRef, cfg.data[dataIndex] as DataSpecification));
                } else {
                    toOpen.push(vizUrlFromEntries(dataIndex));
                }
                openedSpecOrder.push(cfg.data[dataIndex]);
                return allocated;
            };

            const assembleEnv = {
                backgrounds: openedBase,
                activeVisualization: renderingWithWebGL ? activeV : undefined,
                data: cfg.data,
                cloneRuntimeState,
                resolveWorldIndex: allocateWorldIndex,
                expandDataSourceRef: (entry: any, kind: "background" | "visualization", bgRef: BackgroundConfig | undefined, meta: any) => buildManagedShaderSourceEntry(
                    entry,
                    kind === "background" && bgRef
                        ? (dataIndex: number) => bgUrlFromEntry(bgRef, cfg.data[dataIndex] as DataSpecification)
                        : vizUrlFromEntries,
                    meta,
                ),
            };

            assembleBackgroundShaders(assembleEnv, renderOutput);

            // `firstVizIndex` separates background-derived tiles from
            // visualization-derived ones in the open-tile loop's `kind`
            // labelling below. Capture it AFTER bg-shader allocation (which
            // may add extra tiles for shaders with explicit dataReferences)
            // and BEFORE viz-shader allocation.
            const firstVizIndex = toOpen.length;

            if (renderingWithWebGL && activeV) {
                appContext.prepareRendering();
            }

            assembleVisualizationShaders(assembleEnv, renderOutput);

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

            // Slide-aware IO lifecycle (per-viewer-background bundle scope):
            // flush the just-vacated (viewer, background) before the world is
            // cleared so owners (annotations, …) can snapshot their state
            // keyed by the OLD slide. Only fires for content-kind changes
            // (visualization-only / noop don't change the background id),
            // and only when a previous bg id exists (skips fresh viewers).
            // Per-viewer-only and global bundleScopes ignore this dispatch
            // — opting OUT keeps state loaded across slide swaps.
            const viewerUniqueIdBeforeReset = viewer?.uniqueId;
            const previousBackgroundId = (window as any).UTILITIES?.currentBackgroundIdFor?.(viewer);
            if (
                plan.changeKind === "content" &&
                viewerUniqueIdBeforeReset &&
                previousBackgroundId
            ) {
                try {
                    await (window as any).IO_PIPELINE?.flushBundleExport?.({
                        viewerId: viewerUniqueIdBeforeReset,
                        backgroundId: previousBackgroundId,
                    });
                } catch (e) {
                    console.warn("IO flush for vacated slide failed:", e);
                }
            }

            // Suspend rendering BEFORE _resetViewer so any flex rebuilds
            // scheduled by remove-item events fire under _isRenderingSuspended()
            // and defer cleanly instead of running against a half-torn-down world.
            const renderTransaction = beginViewerRenderTransaction(viewer);
            plog(`openIntoViewer TRANSACTION BEGAN v=${viewerIndex}`);

            let successOpened = 0;
            const retainedItems = new Set<any>();
            try {
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

                // Stash the dataIndex → worldIndex map on the viewer so
                // sandboxed clones (the Visualization Playground) can build
                // their renderer config against the same world layout this
                // pipeline just established. Plain object so it survives a
                // structured clone path if anyone serialises it later.
                (viewer as any).__dataToWorldIndex = Array.from(uniqueOsdWorldIndexes.entries());

                plog(`openIntoViewer TILE LOOP DONE v=${viewerIndex}`, {
                    successOpened,
                    worldCount: viewer.world.getItemCount(),
                });

                const applyRendererConfiguration = async () => {
                    if (!viewerSupportsFlexRendering || !viewer.drawer?.overrideConfigureAll) {
                        return false;
                    }

                    // If there are no shaders to apply, transition the drawer
                    // back to internally-managed mode. This is the only path
                    // that genuinely needs `overrideConfigureAll(undefined)`.
                    if (!Object.keys(renderOutput).length) {
                        await viewer.drawer.overrideConfigureAll(undefined);
                        return false;
                    }

                    // `overrideConfigureAll(renderOutput)` does its own
                    // `deleteShaders()` + recreate (flex-renderer.js ~10128),
                    // so a preceding `overrideConfigureAll(undefined)` to
                    // "reset on visualization change" just builds per-item
                    // internal configs that are immediately discarded — and
                    // trips a library bug in the external→internal transition
                    // (the navigator drawer's `tiledImageCreated` dereferences
                    // a parent tiledImage's already-deleted `__shaderConfig`).
                    // Drop the redundant pre-reset; the apply call handles
                    // the swap.
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
                    stateBindings.handleSyntheticOpenEvent(viewer);
                } else {
                    stateBindings.refreshViewerVisualizationBindings(viewer, 0);
                }

                if (successOpened === 0) {
                    viewer.toggleDemoPage(true, toOpen.length > 0 ? $.t("error.invalidDataHtml") : undefined);
                } else {
                    viewer.toggleDemoPage(false);
                }

                // Slide-aware IO lifecycle (per-viewer-background bundle scope):
                // restore the (viewer, new background) snapshot now that the
                // world holds the new content. Mirrors the pre-reset flush
                // above; same opt-in semantics (no-op for owners that didn't
                // declare per-viewer-background / all). Re-resolves the bg
                // id from the live world so it reflects the post-open state.
                if (plan.changeKind === "content") {
                    const nextBackgroundId = (window as any).UTILITIES?.currentBackgroundIdFor?.(viewer);
                    const nextViewerUniqueId = viewer?.uniqueId;
                    if (nextViewerUniqueId && nextBackgroundId) {
                        try {
                            await (window as any).IO_PIPELINE?.tryRestoreImport?.({
                                viewerId: nextViewerUniqueId,
                                backgroundId: nextBackgroundId,
                            });
                        } catch (e) {
                            console.warn("IO restore for new slide failed:", e);
                        }
                    }
                }
            } finally {
                plog(`openIntoViewer TRANSACTION FINISH v=${viewerIndex}`);
                renderTransaction.finish();
                // After resume, drive an explicit paint so the canvas reflects
                // the post-open state — particularly the close-to-empty case
                // where flex's pending rebuild would otherwise leave the
                // previous slide's tiles in the GPU texture cache until some
                // other event (mouse move, zoom) nudges OSD to repaint.
                try { viewer.forceRedraw?.(); } catch (_) {}
                plog(`openIntoViewer EXIT v=${viewerIndex}`);
            }
        };

        const loadTooLongTimeout = setTimeout(
            () => Dialogs.show($.t("error.slide.pending"), 15000, Dialogs.MSG_WARN),
            8000
        );

        let openSucceeded = true;
        await Promise.allSettled(viewerUpdatePlans.map(openIntoViewer)).then(async e => {
            let hadRejectedOpen = false;
            for (const promise of e) {
                if (promise.status === "rejected") {
                    hadRejectedOpen = true;
                    console.error("Failed to open viewer item", promise.reason);
                    Dialogs.show($.t("error.slide.failed"), 15000, Dialogs.MSG_WARN);
                }
            }

            if (hadRejectedOpen && strictVisualization) {
                throw new Error("Failed to apply one or more visualization updates.");
            }

            if (maybeLoadingTimeout) {
                clearTimeout(maybeLoadingTimeout);
                maybeLoadingTimeout = undefined;
            }
            clearTimeout(loadTooLongTimeout);

            // Bind active viewer BEFORE plugins boot, so window.VIEWER and
            // module.viewer getters resolve to a real viewer in pluginReady().
            if (!viewerManager.get() && viewerManager.viewers.length > 0) {
                viewerManager.setActive(0, "open-complete");
            }

            if (backgroundChanged || anythingVisibleChanged) {
                viewerManager.raiseEvent("after-open");
            }

            // Plugins' pluginReady() runs only after the world is populated
            // and the active viewer is bound — see plan/lifecycle ordering fix.
            await this.deps.runLoaderOnce();

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
