/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../src/types/loader.d.ts" />
/// <reference path="./recorder.d.ts" />

type RecorderManagedViewer = OpenSeadragon.Viewer & {
    tools?: RecorderViewerTools;
};

function cloneRecord<T extends Record<string, unknown>>(value: T): T {
    return $.extend(true, {}, value) as T;
}

function cloneValue<T>(value: T): T {
    if (Array.isArray(value)) {
        return $.extend(true, [], value) as T;
    }
    if (value && typeof value === "object") {
        return $.extend(true, {}, value) as T;
    }
    return value;
}

function getViewerContextMeta(viewer: RecorderManagedViewer | undefined): { key?: string; title?: string } {
    if (!viewer) return {};
    const context = (UTILITIES as typeof UTILITIES & {
        getViewerIOContext?: (viewerOrUniqueId: OpenSeadragon.Viewer | UniqueViewerId, stripSuffix?: boolean) => {
            uniqueId?: string;
            title?: string;
            fileName?: string;
        } | undefined;
    }).getViewerIOContext?.(viewer, true);
    return {
        key: context?.title || context?.fileName || context?.uniqueId,
        title: context?.title || context?.fileName,
    };
}

class Recorder extends XOpatModuleSingleton implements RecorderModule {
    private readonly _snapshotsState: RecorderState;

    constructor() {
        super();
        void this.initPostIO();

        OpenSeadragon.Recorder.__exportViewer = async (viewerId: UniqueViewerId) => {
            try {
                const viewer = VIEWER_MANAGER.getViewer(viewerId);
                const data = await this.exportViewerData(viewer, "", viewerId);
                UTILITIES.downloadAsFile(`recorder-${viewerId}.json`, data);
            } catch (error) {
                console.error(error);
                Dialogs.show("Failed to export recorder state.", 2500, Dialogs.MSG_ERR);
            }
        };

        this._snapshotsState = {
            idx: 0,
            steps: [],
            currentStep: null,
            currentPlayback: null,
            playing: false,
            captureVisualization: false,
            captureViewport: true,
            captureScreen: false,
            playbackAnnotationFilters: null,
            playbackVisualizationSnapshots: {},
        };
    }

    async exportData(_key: string): Promise<string> {
        return JSON.stringify(this._snapshotsState.steps);
    }

    async importData(_key: string, data: string): Promise<void> {
        this._importJSON(data);
    }

    create(
        viewerId: UniqueViewerId,
        delay = 0,
        duration = 0.5,
        transition = 1.6,
        atIndex?: number,
    ): RecorderSnapshotStep | false {
        const state = this._snapshotsState;
        if (state.playing) return false;

        const viewer = this._resolveViewer(viewerId);
        if (!viewer?.viewport) {
            console.warn("Recorder.create() skipped: no viewer is available for recording.", { viewerId });
            return false;
        }
        const viewerContext = getViewerContextMeta(viewer);

        const step: RecorderSnapshotStep = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            kind: "keyframe",
            rotation: state.captureViewport ? viewer.viewport.getRotation() : undefined,
            zoomLevel: state.captureViewport ? viewer.viewport.getZoom() : undefined,
            point: state.captureViewport ? viewer.viewport.getCenter() : undefined,
            bounds: state.captureViewport ? viewer.viewport.getBounds() : undefined,
            preferSameZoom: true,
            delay,
            duration,
            transition,
            visualization: this._captureChangedVisualization(viewer, atIndex),
            annotationFilters: this._captureChangedAnnotationFilters(atIndex),
            viewerId: viewer.uniqueId || viewerId,
            viewerContextKey: viewerContext.key,
            viewerTitle: viewerContext.title,
            screenShot: state.captureScreen ? viewer.tools?.screenshot(true, { x: 120, y: 120 }) : undefined,
        };

        this._add(step, atIndex);
        return step;
    }

    createNavigation(
        viewerId: UniqueViewerId,
        samples: RecorderNavigationSample[],
        visualizationSamples?: RecorderVisualizationTimedSample[],
        delay = 0,
        duration = 0.5,
        transition = 1.6,
        atIndex?: number,
    ): RecorderSnapshotStep | false {
        const state = this._snapshotsState;
        if (state.playing) return false;

        const viewer = this._resolveViewer(viewerId);
        if (!viewer?.viewport || samples.length < 2) {
            console.warn("Recorder.createNavigation() skipped: not enough navigation samples.", { viewerId, sampleCount: samples.length });
            return false;
        }
        const viewerContext = getViewerContextMeta(viewer);

        const normalizedSamples = this._normalizeNavigationSamples(samples);
        const normalizedVisualizationSamples = this._normalizeVisualizationSamples(visualizationSamples || []);
        const lastSample = normalizedSamples[normalizedSamples.length - 1];
        if (!lastSample) return false;
        const lastVisualizationSample = normalizedVisualizationSamples[normalizedVisualizationSamples.length - 1];
        const recordedDuration = Math.max(0.1, Math.max(lastSample.at || 0, lastVisualizationSample?.at || 0) / 1000);

        const step: RecorderSnapshotStep = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            kind: "navigation",
            delay,
            duration: recordedDuration,
            transition,
            preferSameZoom: true,
            viewerId: viewer.uniqueId || viewerId,
            rotation: lastSample.rotation,
            zoomLevel: lastSample.zoomLevel,
            point: lastSample.point,
            bounds: lastSample.bounds,
            navigation: {
                samples: normalizedSamples,
                visualizationSamples: normalizedVisualizationSamples.length ? normalizedVisualizationSamples : undefined,
            },
            visualization: this._captureChangedVisualization(viewer, atIndex),
            annotationFilters: this._captureChangedAnnotationFilters(atIndex),
            viewerContextKey: viewerContext.key,
            viewerTitle: viewerContext.title,
        };

        this._add(step, atIndex);
        return step;
    }

    remove(index?: number): void {
        const state = this._snapshotsState;
        if (state.playing) return;

        const resolvedIndex = index ?? state.idx;
        const step = state.steps[resolvedIndex];
        if (!step) return;

        state.steps.splice(resolvedIndex, 1);
        state.idx = state.steps.length ? state.idx % state.steps.length : 0;
        this.raiseEvent("remove", { viewerId: step.viewerId, index: resolvedIndex, step });
    }

    getSteps(): RecorderSnapshotStep[] {
        return [...this._snapshotsState.steps];
    }

    getStep(index: number): RecorderSnapshotStep | undefined {
        return this._snapshotsState.steps[index];
    }

    snapshotCount(): number {
        return this._snapshotsState.steps.length;
    }

    currentStep(): RecorderSnapshotStep | undefined {
        return this._snapshotsState.steps[this._snapshotsState.idx];
    }

    currentStepIndex(): number {
        return this._snapshotsState.idx;
    }

    isPlaying(): boolean {
        return this._snapshotsState.playing;
    }

    play(): void {
        const state = this._snapshotsState;
        if (state.playing) return;
        if (state.idx >= state.steps.length) {
            state.idx = Math.max(0, state.steps.length - 1);
        }

        state.playbackAnnotationFilters = this._getAnnotationFiltersSnapshot();
        state.playbackVisualizationSnapshots = {};
        state.playing = true;
        this.raiseEvent("play", {});
        this.playStep(state.idx);
    }

    previous(): void {
        const state = this._snapshotsState;
        if (state.playing) {
            if (!state.steps.length) return;
            this.playStep(((state.idx - 1) % state.steps.length + state.steps.length) % state.steps.length, true, state.idx);
            return;
        }
        void this.goToIndex(state.idx - 1);
    }

    next(): void {
        const state = this._snapshotsState;
        if (state.playing) {
            if (!state.steps.length) return;
            this.playStep((state.idx + 1) % state.steps.length, true, state.idx);
            return;
        }
        void this.goToIndex(state.idx + 1);
    }

    playFromIndex(index: number): void {
        const state = this._snapshotsState;
        if (state.playing) return;
        state.idx = index;
        this.play();
    }

    stop(): void {
        const state = this._snapshotsState;
        if (!state.playing) return;

        state.currentStep?.cancel();
        state.currentStep = null;
        state.currentPlayback?.cancel();
        state.currentPlayback = null;
        state.playing = false;
        if (state.playbackAnnotationFilters) {
            this._setAnnotationFilters(state.playbackAnnotationFilters);
        } else {
            this._clearAnnotationFilters();
        }
        state.playbackAnnotationFilters = null;
        this._restorePlaybackVisualizations();
        state.playbackVisualizationSnapshots = {};
        this.raiseEvent("stop", {});
    }

    goToIndex(atIndex: number): RecorderSnapshotStep | undefined {
        const state = this._snapshotsState;
        if (state.playing || !state.steps.length) return undefined;

        state.idx = ((atIndex % state.steps.length) + state.steps.length) % state.steps.length;
        return this._jumpAt(state.idx);
    }

    set capturesVisualization(value: boolean) {
        this._snapshotsState.captureVisualization = !!value;
    }

    get capturesVisualization(): boolean {
        return !!this._snapshotsState.captureVisualization;
    }

    set capturesViewport(value: boolean) {
        this._snapshotsState.captureViewport = !!value;
    }

    get capturesViewport(): boolean {
        return !!this._snapshotsState.captureViewport;
    }

    set capturesScreen(value: boolean) {
        this._snapshotsState.captureScreen = !!value;
    }

    get capturesScreen(): boolean {
        return !!this._snapshotsState.captureScreen;
    }

    setCapturesVisualization(value: boolean): void {
        this.capturesVisualization = value;
    }

    setCapturesViewport(value: boolean): void {
        this.capturesViewport = value;
    }

    setCapturesScreen(value: boolean): void {
        this.capturesScreen = value;
    }

    exportJSON(serialize = true): string | RecorderSnapshotStep[] {
        const steps = [...this._snapshotsState.steps];
        return serialize ? JSON.stringify(steps) : steps;
    }

    importJSON(json: string | RecorderSnapshotStep[]): RecorderSnapshotStep[] {
        this._importJSON(json);
        return this.getSteps();
    }

    stepCapturesVisualization(step: RecorderSnapshotStep): boolean {
        return !!step.visualization || !!step.navigation?.visualizationSamples?.length;
    }

    stepCapturesViewport(step: RecorderSnapshotStep): boolean {
        return !!step.point && typeof step.zoomLevel === "number" && !Number.isNaN(step.zoomLevel);
    }

    stepCapturesNavigation(step: RecorderSnapshotStep): boolean {
        return !!step.navigation?.samples?.length;
    }

    sortWithIdList(ids: string[], removeMissing = false): void {
        const state = this._snapshotsState;
        if (removeMissing) {
            state.steps = state.steps.filter((step) => ids.includes(step.id));
        }

        state.steps.sort((left, right) => {
            const leftIndex = ids.indexOf(left.id);
            const rightIndex = ids.indexOf(right.id);
            if (leftIndex < 0) return 1;
            if (rightIndex < 0) return -1;
            return leftIndex - rightIndex;
        });
    }

    private _importJSON(json: string | RecorderSnapshotStep[]): void {
        const state = this._snapshotsState;
        const parsed = typeof json === "string" ? JSON.parse(json) : json;

        state.idx = 0;
        state.steps = [];
        state.currentStep = null;
        state.currentPlayback = null;
        state.playbackAnnotationFilters = null;
        state.playbackVisualizationSnapshots = {};

        if (Array.isArray(parsed)) {
            for (const item of parsed) {
                if (!item) continue;

                const step: RecorderSnapshotStep = {
                    ...item,
                    kind: item.kind || (item.navigation?.samples?.length ? "navigation" : "keyframe"),
                    viewerContextKey: typeof item.viewerContextKey === "string" ? item.viewerContextKey : undefined,
                    viewerTitle: typeof item.viewerTitle === "string" ? item.viewerTitle : undefined,
                    rotation: typeof item.rotation === "number" ? item.rotation : undefined,
                    point: item.point ? new OpenSeadragon.Point(item.point.x, item.point.y) : undefined,
                    bounds: item.bounds
                        ? new OpenSeadragon.Rect(item.bounds.x, item.bounds.y, item.bounds.width, item.bounds.height)
                        : undefined,
                    navigation: item.navigation?.samples?.length ? {
                        samples: item.navigation.samples.map((sample) => ({
                            ...sample,
                            rotation: typeof sample.rotation === "number" ? sample.rotation : undefined,
                            point: sample.point ? new OpenSeadragon.Point(sample.point.x, sample.point.y) : undefined,
                            bounds: sample.bounds
                                ? new OpenSeadragon.Rect(sample.bounds.x, sample.bounds.y, sample.bounds.width, sample.bounds.height)
                                : undefined,
                        })),
                        visualizationSamples: Array.isArray(item.navigation.visualizationSamples)
                            ? item.navigation.visualizationSamples.map((sample) => ({
                                at: sample.at,
                                visualization: this._cloneVisualizationStateSnapshot(sample.visualization),
                            }))
                            : undefined,
                    } : undefined,
                    visualization: item.visualization
                        ? this._cloneVisualizationStateSnapshot(item.visualization)
                        : undefined,
                    annotationFilters: Array.isArray(item.annotationFilters)
                        ? item.annotationFilters.map((filter) => this._cloneAnnotationFilter(filter))
                        : undefined,
                };
                this._add(step);
            }
        }

        state.idx = 0;
    }

    private _resolveViewer(viewerId?: UniqueViewerId): RecorderManagedViewer | undefined {
        return (
            VIEWER_MANAGER.getViewer(viewerId, false) ||
            VIEWER_MANAGER.get?.() ||
            VIEWER_MANAGER.viewers?.[0]
        ) as RecorderManagedViewer | undefined;
    }

    private _resolveStepViewer(step: RecorderSnapshotStep | undefined): RecorderManagedViewer | undefined {
        if (!step) return undefined;
        const direct = VIEWER_MANAGER.getViewer(step.viewerId, false) as RecorderManagedViewer | undefined;
        if (direct) return direct;
        if (!step.viewerContextKey) return undefined;

        for (const viewer of (VIEWER_MANAGER.viewers || []) as RecorderManagedViewer[]) {
            const context = getViewerContextMeta(viewer);
            if (context.key === step.viewerContextKey) {
                step.viewerId = viewer.uniqueId;
                if (!step.viewerTitle && context.title) step.viewerTitle = context.title;
                return viewer;
            }
        }
        return undefined;
    }

    private _isValidStep(indexOrStep: number | RecorderSnapshotStep | undefined): boolean {
        const step = typeof indexOrStep === "number"
            ? this._snapshotsState.steps[indexOrStep]
            : indexOrStep;
        return !!this._resolveStepViewer(step);
    }

    private playStep(index: number, jumps = false, fromIndex?: number): void {
        const state = this._snapshotsState;
        state.currentStep?.cancel();
        state.currentPlayback?.cancel();
        state.currentStep = null;
        state.currentPlayback = null;

        while (state.steps.length > index && !state.steps[index]) {
            index += 1;
        }

        if (state.steps.length <= index) {
            state.currentStep = null;
            this.stop();
            return;
        }

        const current = state.steps[index];
        if (!current) {
            this.stop();
            return;
        }

        let previousIndex = typeof fromIndex === "number" ? fromIndex : index - 1;
        while (previousIndex > 0 && !this._isValidStep(previousIndex)) {
            previousIndex -= 1;
        }

        const delayMs = jumps ? 0 : current.delay * 1000;
        state.currentStep = this._setDelayed(delayMs, index);
        state.currentStep.promise.then((atIndex) => {
            if (!state.playing) return;

            this._jumpAt(atIndex, previousIndex >= 0 ? previousIndex : undefined);
            state.idx = atIndex;

            const nextIndex = atIndex + 1;
            const durationMs = Math.max(0, current.duration * 1000);
            if (nextIndex >= state.steps.length) {
                state.currentStep = this._setDelayed(durationMs, nextIndex);
                state.currentStep.promise.then(() => this.stop()).catch(() => undefined);
                return;
            }

            state.currentStep = this._setDelayed(durationMs, nextIndex);
            state.currentStep.promise.then((resolvedNextIndex) => {
                if (!state.playing) return;
                this.playStep(resolvedNextIndex, false, atIndex);
            }).catch(() => undefined);
        }).catch(() => undefined);
    }

    private _getVisualizationSnapshot(
        viewer: RecorderManagedViewer,
        captureVisualization: boolean,
    ): RecorderVisualizationStateSnapshot | undefined {
        if (!captureVisualization) return undefined;

        const renderer = (viewer as RecorderManagedViewer & {
            drawer?: {
                renderer?: {
                    exportVisualization?: () => RecorderVisualizationSnapshot;
                    getVisualizationSnapshot?: () => RecorderVisualizationSnapshot;
                };
            };
        }).drawer?.renderer;
        const exported = renderer?.exportVisualization?.() || renderer?.getVisualizationSnapshot?.();
        const visualizations = cloneValue(Array.isArray(APPLICATION_CONTEXT.config.visualizations)
            ? APPLICATION_CONTEXT.config.visualizations
            : []);
        const backgrounds = cloneValue(Array.isArray(APPLICATION_CONTEXT.config.background)
            ? APPLICATION_CONTEXT.config.background
            : []);
        const activeBackgroundIndex = cloneValue(
            APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, true, true)
        );
        const activeVisualizationIndex = cloneValue(
            APPLICATION_CONTEXT.getOption("activeVisualizationIndex", undefined, true, true)
        );
        return {
            backgrounds,
            activeBackgroundIndex,
            visualizations,
            activeVisualizationIndex,
            renderer: exported ? cloneRecord(exported) : undefined,
        };
    }

    private _captureChangedVisualization(
        viewer: RecorderManagedViewer,
        atIndex?: number,
    ): RecorderVisualizationStateSnapshot | undefined {
        const current = this._getVisualizationSnapshot(viewer, this._snapshotsState.captureVisualization);
        if (!current) return undefined;
        const previous = this._getPreviousVisualizationSnapshot(viewer, atIndex);
        return this._sameVisualizationSnapshot(current, previous) ? undefined : current;
    }

    private _getPreviousVisualizationSnapshot(
        viewer: RecorderManagedViewer,
        atIndex?: number,
    ): RecorderVisualizationStateSnapshot | undefined {
        const state = this._snapshotsState;
        const viewerContext = getViewerContextMeta(viewer);
        const resolvedIndex = typeof atIndex === "number"
            ? Math.max(0, Math.min(atIndex, state.steps.length))
            : state.steps.length;
        let lastSnapshot: RecorderVisualizationStateSnapshot | undefined;

        for (let index = 0; index < resolvedIndex; index += 1) {
            const step = state.steps[index];
            if (!step || !this._stepTargetsViewer(step, viewer.uniqueId, viewerContext.key)) continue;
            const effective = this._getEffectiveStepVisualization(step);
            if (effective) lastSnapshot = effective;
        }

        return lastSnapshot ? this._cloneVisualizationStateSnapshot(lastSnapshot) : undefined;
    }

    private _getEffectiveVisualizationAt(
        index: number,
        viewer: RecorderManagedViewer,
    ): RecorderVisualizationStateSnapshot | undefined {
        const state = this._snapshotsState;
        const viewerContext = getViewerContextMeta(viewer);
        const resolvedIndex = Math.max(0, Math.min(index, state.steps.length - 1));

        for (let at = resolvedIndex; at >= 0; at -= 1) {
            const step = state.steps[at];
            if (!step || !this._stepTargetsViewer(step, viewer.uniqueId, viewerContext.key)) continue;
            const effective = this._getEffectiveStepVisualization(step);
            if (effective) return effective;
        }
        return undefined;
    }

    private _getEffectiveStepVisualization(step: RecorderSnapshotStep): RecorderVisualizationStateSnapshot | undefined {
        const timed = step.navigation?.visualizationSamples;
        const lastTimed = timed?.[timed.length - 1]?.visualization;
        if (lastTimed) return this._cloneVisualizationStateSnapshot(lastTimed);
        if (step.visualization) return this._cloneVisualizationStateSnapshot(step.visualization);
        return undefined;
    }

    private _stepTargetsViewer(
        step: RecorderSnapshotStep,
        viewerId?: UniqueViewerId,
        viewerContextKey?: string,
    ): boolean {
        return (!!viewerContextKey && step.viewerContextKey === viewerContextKey)
            || (!!viewerId && step.viewerId === viewerId);
    }

    private _rememberPlaybackVisualization(viewer: RecorderManagedViewer, step: RecorderSnapshotStep): void {
        const state = this._snapshotsState;
        const key = step.viewerContextKey || step.viewerId;
        if (!key || state.playbackVisualizationSnapshots[key]) return;
        const snapshot = this._getVisualizationSnapshot(viewer, true);
        if (!snapshot) return;
        state.playbackVisualizationSnapshots[key] = snapshot;
    }

    private _restorePlaybackVisualizations(): void {
        const snapshots = this._snapshotsState.playbackVisualizationSnapshots;
        for (const step of this._snapshotsState.steps) {
            const key = step.viewerContextKey || step.viewerId;
            if (!key || !snapshots[key]) continue;
            const viewer = this._resolveStepViewer(step);
            if (!viewer) continue;
            this._applyVisualizationSnapshot(viewer, snapshots[key], 0);
            delete snapshots[key];
        }
    }

    private _getAnnotationsModule(): {
        getAnnotationFilters?: () => RecorderAnnotationFilter[];
        setAnnotationFilters?: (filters: RecorderAnnotationFilter[]) => void;
        clearAnnotationFilters?: () => void;
    } | null {
        try {
            return (window as Window & {
                OSDAnnotations?: {
                    instance(): {
                        getAnnotationFilters?: () => RecorderAnnotationFilter[];
                        setAnnotationFilters?: (filters: RecorderAnnotationFilter[]) => void;
                        clearAnnotationFilters?: () => void;
                    };
                };
            }).OSDAnnotations?.instance?.() || null;
        } catch (_error) {
            return null;
        }
    }

    private _getAnnotationFiltersSnapshot(): RecorderAnnotationFilter[] {
        const annotations = this._getAnnotationsModule();
        const filters = annotations?.getAnnotationFilters?.();
        if (!Array.isArray(filters)) return [];
        return filters.map((filter) => this._cloneAnnotationFilter(filter));
    }

    private _captureChangedAnnotationFilters(atIndex?: number): RecorderAnnotationFilter[] | undefined {
        const current = this._getAnnotationFiltersSnapshot();
        const previous = this._getPreviousAnnotationFilters(atIndex);
        return this._sameAnnotationFilters(current, previous) ? undefined : current;
    }

    private _getPreviousAnnotationFilters(atIndex?: number): RecorderAnnotationFilter[] {
        const state = this._snapshotsState;
        const resolvedIndex = typeof atIndex === "number"
            ? Math.max(0, Math.min(atIndex, state.steps.length))
            : state.steps.length;

        for (let index = resolvedIndex - 1; index >= 0; index -= 1) {
            const step = state.steps[index];
            if (!step || !step.annotationFilters) continue;
            return step.annotationFilters.map((filter) => this._cloneAnnotationFilter(filter));
        }
        return [];
    }

    private _getEffectiveAnnotationFiltersAt(index: number): RecorderAnnotationFilter[] {
        const state = this._snapshotsState;
        const resolvedIndex = Math.max(0, Math.min(index, state.steps.length - 1));
        for (let at = resolvedIndex; at >= 0; at -= 1) {
            const step = state.steps[at];
            if (!step || !step.annotationFilters) continue;
            return step.annotationFilters.map((filter) => this._cloneAnnotationFilter(filter));
        }
        return [];
    }

    private _setAnnotationFilters(filters: RecorderAnnotationFilter[]): void {
        const annotations = this._getAnnotationsModule();
        if (!annotations?.setAnnotationFilters) return;
        annotations.setAnnotationFilters(filters.map((filter) => this._cloneAnnotationFilter(filter)));
    }

    private _clearAnnotationFilters(): void {
        const annotations = this._getAnnotationsModule();
        if (annotations?.clearAnnotationFilters) {
            annotations.clearAnnotationFilters();
            return;
        }
        annotations?.setAnnotationFilters?.([]);
    }

    private _cloneAnnotationFilter(filter: RecorderAnnotationFilter): RecorderAnnotationFilter {
        return {
            id: filter.id,
            type: filter.type,
            values: Array.isArray(filter.values) ? [...filter.values] : undefined,
            rect: filter.rect
                ? {
                    x: filter.rect.x,
                    y: filter.rect.y,
                    width: filter.rect.width,
                    height: filter.rect.height,
                }
                : undefined,
        };
    }

    private _sameAnnotationFilters(
        left: RecorderAnnotationFilter[] | undefined,
        right: RecorderAnnotationFilter[] | undefined,
    ): boolean {
        return this._stableSerialize(left || []) === this._stableSerialize(right || []);
    }

    private _setDelayed(milliseconds: number, index: number): RecorderDelayHandle {
        if (milliseconds <= 0) {
            return { promise: Promise.resolve(index), cancel() {} };
        }

        let timeoutId: number | undefined;
        const promise = new Promise<number>((resolve) => {
            timeoutId = window.setTimeout(() => resolve(index), milliseconds);
        });

        return {
            promise,
            cancel() {
                if (timeoutId !== undefined) {
                    window.clearTimeout(timeoutId);
                }
            },
        };
    }

    private _add(step: RecorderSnapshotStep, index?: number): void {
        if (!step?.viewerId && !step?.viewerContextKey) return;

        const state = this._snapshotsState;
        let resolvedIndex = typeof index === "number" ? index : state.steps.length;

        if (resolvedIndex >= 0 && resolvedIndex < state.steps.length) {
            state.steps.splice(resolvedIndex, 0, step);
        } else {
            resolvedIndex = state.steps.length;
            state.steps.push(step);
        }

        this.raiseEvent("create", { viewerId: step.viewerId, index: resolvedIndex, step });
    }

    private _jumpAt(index: number, fromIndex?: number): RecorderSnapshotStep | undefined {
        const state = this._snapshotsState;
        const step = state.steps[index];
        if (!step || state.steps.length <= index) return undefined;

        const viewer = this._resolveStepViewer(step);
        if (!viewer) return undefined;

        const capturesNavigation = this.stepCapturesNavigation(step);
        const capturesViewport = this.stepCapturesViewport(step);
        const shouldApplyEffectiveState = !state.playing || typeof fromIndex !== "number";
        const targetVisualization = shouldApplyEffectiveState
            ? this._getEffectiveVisualizationAt(index, viewer)
            : (step.visualization ? this._cloneVisualizationStateSnapshot(step.visualization) : undefined);
        if (targetVisualization && state.playing) {
            this._rememberPlaybackVisualization(viewer, step);
        }
        if (targetVisualization) {
            this._applyVisualizationSnapshot(viewer, targetVisualization, capturesViewport || capturesNavigation ? step.duration : 0);
        }

        if (capturesNavigation) {
            const immediate = !state.playing;
            state.currentPlayback = this._playNavigation(viewer, step, immediate);
        } else if (capturesViewport) {
            if (typeof step.rotation === "number" && !Number.isNaN(step.rotation)) {
                viewer.viewport.setRotation(step.rotation, true);
            }
            viewer.tools?.focus(step);
        } else {
            viewer.forceRedraw?.();
        }

        const effectiveAnnotationFilters = shouldApplyEffectiveState
            ? this._getEffectiveAnnotationFiltersAt(index)
            : (step.annotationFilters ? step.annotationFilters.map((filter) => this._cloneAnnotationFilter(filter)) : null);
        if (effectiveAnnotationFilters !== null) {
            const currentAnnotationFilters = this._getAnnotationFiltersSnapshot();
            if (!this._sameAnnotationFilters(currentAnnotationFilters, effectiveAnnotationFilters)) {
                if (effectiveAnnotationFilters.length) {
                    this._setAnnotationFilters(effectiveAnnotationFilters);
                } else {
                    this._clearAnnotationFilters();
                }
            }
        }

        this.raiseEvent("enter", {
            index,
            prevIndex: typeof fromIndex === "number" && !Number.isNaN(fromIndex) ? fromIndex : undefined,
            prevStep: typeof fromIndex === "number" && !Number.isNaN(fromIndex) ? state.steps[fromIndex] : undefined,
            step,
        });
        return step;
    }

    private _setVisualization(viewer: RecorderManagedViewer, step: RecorderSnapshotStep, duration: number): void {
        const target = step.visualization;
        if (!target) return;
        this._applyVisualizationSnapshot(viewer, target, duration);
    }

    private _applyVisualizationSnapshot(
        viewer: RecorderManagedViewer,
        target: RecorderVisualizationStateSnapshot,
        _duration: number,
    ): void {
        const currentBackgrounds = cloneValue(Array.isArray(APPLICATION_CONTEXT.config.background)
            ? APPLICATION_CONTEXT.config.background
            : []);
        const currentVisualizations = cloneValue(Array.isArray(APPLICATION_CONTEXT.config.visualizations)
            ? APPLICATION_CONTEXT.config.visualizations
            : []);
        const currentBgSelection = cloneValue(
            APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, true, true)
        );
        const currentVizSelection = cloneValue(
            APPLICATION_CONTEXT.getOption("activeVisualizationIndex", undefined, true, true)
        );

        const safeBackgrounds = this._mergeRecordedBackgrounds(currentBackgrounds, target.backgrounds || []);
        const visualizations = cloneValue(target.visualizations?.length ? target.visualizations : currentVisualizations);
        const activeBgSelection = this._normalizeSelectionForReplay(target.activeBackgroundIndex, currentBgSelection);
        const activeSelection = this._normalizeSelectionForReplay(target.activeVisualizationIndex, currentVizSelection);
        const bgShaderIds = this._collectBackgroundShaderIds(safeBackgrounds);

        if (target.renderer?.shaders) {
            this._mergeRendererIntoBackgrounds(safeBackgrounds, target.renderer);
        }

        if (target.renderer?.shaders) {
            const activeIndex = Array.isArray(activeSelection) ? activeSelection[0] : activeSelection;
            if (Number.isInteger(activeIndex) && visualizations[activeIndex as number]) {
                const current = cloneValue(visualizations[activeIndex as number]);
                const orderedShaders: Record<string, Record<string, unknown>> = {};
                for (const shaderId of target.renderer.order || Object.keys(target.renderer.shaders)) {
                    const shader = target.renderer.shaders[shaderId];
                    if (this._isBackgroundRendererShader(bgShaderIds, shaderId, shader)) continue;
                    if (shader) orderedShaders[shaderId] = cloneValue(shader);
                }
                for (const [shaderId, shader] of Object.entries(target.renderer.shaders)) {
                    if (this._isBackgroundRendererShader(bgShaderIds, shaderId, shader) || orderedShaders[shaderId]) continue;
                    orderedShaders[shaderId] = cloneValue(shader);
                }
                current.shaders = orderedShaders as unknown as VisualizationItem["shaders"];
                visualizations[activeIndex as number] = current;
            }
        }

        const targetState: RecorderVisualizationStateSnapshot = {
            backgrounds: cloneValue(safeBackgrounds),
            activeBackgroundIndex: cloneValue(activeBgSelection as number | number[] | undefined),
            visualizations: cloneValue(visualizations),
            activeVisualizationIndex: cloneValue(activeSelection as number | number[] | undefined),
            renderer: target.renderer
                ? {
                    order: [...(target.renderer.order || [])],
                    shaders: target.renderer.shaders ? cloneValue(target.renderer.shaders) : undefined,
                }
                : undefined,
        };
        const currentState = this._getVisualizationSnapshot(viewer, true);
        if (this._sameVisualizationSnapshot(currentState, targetState)) {
            viewer.forceRedraw?.();
            return;
        }

        void APPLICATION_CONTEXT.openViewerWith(
            cloneValue(Array.isArray(APPLICATION_CONTEXT.config.data) ? APPLICATION_CONTEXT.config.data : []),
            safeBackgrounds,
            visualizations,
            activeBgSelection as number | number[] | undefined,
            activeSelection as number | number[] | undefined,
            {
                historyMode: "skip",
                fromHistory: true,
                preserveHistoryOnBackgroundChange: true,
                strictVisualization: true,
                suppressDialogsOnVisualizationFailure: true,
            } as never
        )
            .then(() => viewer.forceRedraw?.())
            .catch(() => undefined);
    }

    private _sameVisualizationSnapshot(
        left: RecorderVisualizationStateSnapshot | undefined,
        right: RecorderVisualizationStateSnapshot | undefined,
    ): boolean {
        if (!left && !right) return true;
        if (!left || !right) return false;
        return this._stableSerialize(this._normalizeVisualizationForComparison(left))
            === this._stableSerialize(this._normalizeVisualizationForComparison(right));
    }

    private _normalizeVisualizationForComparison(
        snapshot: RecorderVisualizationStateSnapshot,
    ): RecorderVisualizationStateSnapshot {
        const cloned = this._cloneVisualizationStateSnapshot(snapshot);
        cloned.backgrounds = (cloned.backgrounds || []).map((background) => {
            const normalized = cloneValue(background);
            delete normalized.shaders;
            return normalized;
        });
        return cloned;
    }

    private _stableSerialize(value: unknown): string {
        if (Array.isArray(value)) {
            return `[${value.map((item) => this._stableSerialize(item)).join(",")}]`;
        }
        if (value && typeof value === "object") {
            const record = value as Record<string, unknown>;
            return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${this._stableSerialize(record[key])}`).join(",")}}`;
        }
        return JSON.stringify(value);
    }

    private _cloneVisualizationStateSnapshot(snapshot: RecorderVisualizationStateSnapshot): RecorderVisualizationStateSnapshot {
        return {
            backgrounds: cloneValue(snapshot.backgrounds || []),
            activeBackgroundIndex: Array.isArray(snapshot.activeBackgroundIndex)
                ? [...snapshot.activeBackgroundIndex]
                : snapshot.activeBackgroundIndex,
            visualizations: cloneValue(snapshot.visualizations || []),
            activeVisualizationIndex: Array.isArray(snapshot.activeVisualizationIndex)
                ? [...snapshot.activeVisualizationIndex]
                : snapshot.activeVisualizationIndex,
            renderer: snapshot.renderer
                ? {
                    order: [...(snapshot.renderer.order || [])],
                    shaders: snapshot.renderer.shaders ? cloneValue(snapshot.renderer.shaders) : undefined,
                }
                : undefined,
        };
    }

    private _normalizeSelectionForReplay(
        desired: number | number[] | undefined,
        fallback: number | number[] | undefined,
    ): number | number[] | undefined {
        if (Array.isArray(desired) && Array.isArray(fallback) && desired.length === fallback.length) {
            return [...desired];
        }
        if (!Array.isArray(desired) && !Array.isArray(fallback)) {
            return desired ?? fallback;
        }
        return fallback;
    }

    private _mergeRecordedBackgrounds(
        currentBackgrounds: BackgroundItem[],
        recordedBackgrounds: BackgroundItem[],
    ): BackgroundItem[] {
        if (!Array.isArray(currentBackgrounds) || !Array.isArray(recordedBackgrounds)) {
            return cloneValue(currentBackgrounds || []);
        }
        if (currentBackgrounds.length !== recordedBackgrounds.length) {
            return cloneValue(currentBackgrounds);
        }

        return currentBackgrounds.map((currentBackground, index) => {
            const recordedBackground = recordedBackgrounds[index];
            if (!recordedBackground || !APPLICATION_CONTEXT.sameBackground(currentBackground, recordedBackground)) {
                return cloneValue(currentBackground);
            }

            const merged = cloneValue(currentBackground);
            for (const [key, value] of Object.entries(recordedBackground)) {
                if (["dataReference", "id", "protocol", "options"].includes(key)) continue;
                if (key === "shaders") continue;
                (merged as Record<string, unknown>)[key] = cloneValue(value);
            }
            merged.shaders = this._mergeRecordedBackgroundShaders(currentBackground, recordedBackground);
            return merged;
        });
    }

    private _mergeRecordedBackgroundShaders(
        currentBackground: BackgroundItem,
        recordedBackground: BackgroundItem,
    ): VisualizationShaderLayer[] | undefined {
        const currentShaders = Array.isArray(currentBackground.shaders) ? currentBackground.shaders : [];
        const recordedShaders = Array.isArray(recordedBackground.shaders) ? recordedBackground.shaders : [];
        if (!recordedShaders.length) return currentShaders.length ? cloneValue(currentShaders) : undefined;

        return recordedShaders.map((recordedShader, index) => {
            const currentShader = currentShaders.find((shader) => shader?.id && shader.id === recordedShader?.id) || currentShaders[index] || {};
            const merged = cloneValue(recordedShader || {});
            merged.id = currentShader.id || recordedShader.id;
            const currentRefs = this._normalizeShaderRefs(currentShader.dataReferences);
            if (currentRefs.length > 0) merged.dataReferences = currentRefs;
            else delete merged.dataReferences;
            delete merged.tiledImages;
            return merged;
        });
    }

    private _normalizeShaderRefs(refs: unknown): number[] {
        return Array.isArray(refs)
            ? refs.filter((value): value is number => Number.isInteger(value) && value >= 0)
            : [];
    }

    private _collectBackgroundShaderIds(backgrounds: BackgroundItem[]): Set<string> {
        const ids = new Set<string>();
        for (const background of backgrounds || []) {
            const baseId = String(background?.id || "");
            if (baseId) ids.add(baseId);
            const shaders = Array.isArray(background?.shaders) ? background.shaders : [];
            shaders.forEach((shader, index) => {
                const id = String(shader?.id || (index < 1 ? baseId : `${baseId}-${index}`));
                if (id) ids.add(id);
            });
        }
        return ids;
    }

    private _findRecordedRendererShader(
        renderer: RecorderVisualizationSnapshot,
        shaderId: string,
        fallbackId?: string,
    ): Record<string, unknown> | undefined {
        if (!renderer?.shaders) return undefined;
        if (shaderId && renderer.shaders[shaderId]) {
            return renderer.shaders[shaderId];
        }
        if (fallbackId && renderer.shaders[fallbackId]) {
            return renderer.shaders[fallbackId];
        }
        for (const [mapKey, shader] of Object.entries(renderer.shaders)) {
            if (!shader || typeof shader !== "object") continue;
            const recordedId = String((shader as Record<string, unknown>).id || "");
            if ((shaderId && recordedId === shaderId) || (fallbackId && recordedId === fallbackId) || mapKey === fallbackId) {
                return shader;
            }
        }
        return undefined;
    }

    private _isBackgroundRendererShader(
        bgShaderIds: Set<string>,
        shaderKey: string,
        shader: Record<string, unknown> | undefined,
    ): boolean {
        if (bgShaderIds.has(shaderKey)) return true;
        const shaderId = String(shader?.id || "");
        return !!shaderId && bgShaderIds.has(shaderId);
    }

    private _mergeRendererIntoBackgrounds(
        backgrounds: BackgroundItem[],
        renderer: RecorderVisualizationSnapshot,
    ): void {
        for (const background of backgrounds || []) {
            const shaders = Array.isArray(background?.shaders) && background.shaders.length
                ? background.shaders
                : [{ id: String(background?.id || ""), type: "identity" } as VisualizationShaderLayer];
            const baseId = String(background?.id || "");
            background.shaders = shaders.map((shader, index) => {
                const id = String(shader?.id || (index < 1 ? baseId : `${baseId}-${index}`));
                const recorded = this._findRecordedRendererShader(renderer, id, index < 1 ? baseId : undefined);
                if (!recorded) return shader;
                const merged = cloneValue(shader || {});
                for (const [key, value] of Object.entries(recorded)) {
                    if (["id", "tiledImages", "dataReferences"].includes(key)) continue;
                    (merged as Record<string, unknown>)[key] = cloneValue(value);
                }
                merged.id = shader?.id || id;
                return merged;
            });
        }
    }

    private _normalizeNavigationSamples(samples: RecorderNavigationSample[]): RecorderNavigationSample[] {
        if (!samples.length) return [];

        const firstAt = samples[0].at || 0;
        const shifted = samples.map((sample) => ({
            ...sample,
            at: Math.max(0, sample.at - firstAt),
            rotation: typeof sample.rotation === "number" ? sample.rotation : undefined,
            point: sample.point ? new OpenSeadragon.Point(sample.point.x, sample.point.y) : undefined,
            bounds: sample.bounds
                ? new OpenSeadragon.Rect(sample.bounds.x, sample.bounds.y, sample.bounds.width, sample.bounds.height)
                : undefined,
        }));

        const duration = shifted[shifted.length - 1]?.at || 0;
        if (duration <= 0) {
            return shifted.map((sample, index) => ({ ...sample, at: index }));
        }

        return shifted;
    }

    private _normalizeVisualizationSamples(samples: RecorderVisualizationTimedSample[]): RecorderVisualizationTimedSample[] {
        if (!samples.length) return [];
        return samples.map((sample, index) => ({
            at: Math.max(0, sample.at || 0) || index,
            visualization: this._cloneVisualizationStateSnapshot(sample.visualization),
        }));
    }

    private _playNavigation(viewer: RecorderManagedViewer, step: RecorderSnapshotStep, immediate: boolean): RecorderDelayHandle | null {
        const samples = step.navigation?.samples;
        if (!samples?.length) return null;
        const visualizationSamples = step.navigation?.visualizationSamples || [];
        const recordedDurationMs = Math.max(samples[samples.length - 1]?.at || 0, visualizationSamples[visualizationSamples.length - 1]?.at || 0);
        let visualizationIndex = 0;

        if (immediate || step.duration <= 0 || recordedDurationMs <= 0) {
            if (visualizationSamples.length) {
                this._applyVisualizationSnapshot(viewer, visualizationSamples[visualizationSamples.length - 1].visualization, 0);
            }
            this._applyNavigationSample(viewer, samples[samples.length - 1]);
            return { promise: Promise.resolve(-1), cancel() {} };
        }

        const startedAt = performance.now();
        const targetDurationMs = Math.max(1, step.duration * 1000);
        let frameId = 0;
        let cancelled = false;

        const promise = new Promise<number>((resolve) => {
            const tick = () => {
                if (cancelled) {
                    resolve(-1);
                    return;
                }

                const elapsedMs = performance.now() - startedAt;
                const playbackTimeMs = Math.min(recordedDurationMs, (elapsedMs / targetDurationMs) * recordedDurationMs);
                while (visualizationIndex < visualizationSamples.length && visualizationSamples[visualizationIndex].at <= playbackTimeMs) {
                    this._applyVisualizationSnapshot(viewer, visualizationSamples[visualizationIndex].visualization, 0);
                    visualizationIndex += 1;
                }
                this._applyNavigationSample(viewer, this._interpolateNavigationSample(samples, playbackTimeMs));

                if (elapsedMs >= targetDurationMs) {
                    if (visualizationSamples.length && visualizationIndex < visualizationSamples.length) {
                        this._applyVisualizationSnapshot(viewer, visualizationSamples[visualizationSamples.length - 1].visualization, 0);
                    }
                    this._applyNavigationSample(viewer, samples[samples.length - 1]);
                    resolve(-1);
                    return;
                }
                frameId = window.requestAnimationFrame(tick);
            };

            frameId = window.requestAnimationFrame(tick);
        });

        return {
            promise,
            cancel() {
                cancelled = true;
                if (frameId) window.cancelAnimationFrame(frameId);
            },
        };
    }

    private _interpolateNavigationSample(samples: RecorderNavigationSample[], playbackTimeMs: number): RecorderNavigationSample {
        if (samples.length === 1) return samples[0];
        if (playbackTimeMs <= 0) return samples[0];
        if (playbackTimeMs >= (samples[samples.length - 1]?.at || 0)) return samples[samples.length - 1];

        let previous = samples[0];
        let next = samples[samples.length - 1];
        for (let index = 1; index < samples.length; index += 1) {
            if (samples[index].at >= playbackTimeMs) {
                next = samples[index];
                previous = samples[index - 1];
                break;
            }
        }

        const span = Math.max(0.0001, next.at - previous.at);
        const localProgress = Math.min(1, Math.max(0, (playbackTimeMs - previous.at) / span));

        return {
            at: playbackTimeMs,
            rotation: this._interpolateNumber(previous.rotation, next.rotation, localProgress),
            zoomLevel: this._interpolateNumber(previous.zoomLevel, next.zoomLevel, localProgress),
            point: this._interpolatePoint(previous.point, next.point, localProgress),
            bounds: this._interpolateRect(previous.bounds, next.bounds, localProgress),
        };
    }

    private _applyNavigationSample(viewer: RecorderManagedViewer, sample: RecorderNavigationSample): void {
        if (typeof sample.rotation === "number" && !Number.isNaN(sample.rotation)) {
            viewer.viewport.setRotation(sample.rotation, true);
        }
        if (sample.bounds) {
            viewer.viewport.fitBounds(sample.bounds, true);
            return;
        }

        if (sample.point) {
            viewer.viewport.panTo(sample.point, true);
        }
        if (typeof sample.zoomLevel === "number" && !Number.isNaN(sample.zoomLevel)) {
            viewer.viewport.zoomTo(sample.zoomLevel, undefined, true);
        }
    }

    private _interpolateNumber(left: number | undefined, right: number | undefined, progress: number): number | undefined {
        if (typeof left !== "number") return right;
        if (typeof right !== "number") return left;
        return left + (right - left) * progress;
    }

    private _interpolatePoint(
        left: OpenSeadragon.Point | undefined,
        right: OpenSeadragon.Point | undefined,
        progress: number,
    ): OpenSeadragon.Point | undefined {
        if (!left) return right;
        if (!right) return left;
        return new OpenSeadragon.Point(
            left.x + (right.x - left.x) * progress,
            left.y + (right.y - left.y) * progress,
        );
    }

    private _interpolateRect(
        left: OpenSeadragon.Rect | undefined,
        right: OpenSeadragon.Rect | undefined,
        progress: number,
    ): OpenSeadragon.Rect | undefined {
        if (!left) return right;
        if (!right) return left;
        return new OpenSeadragon.Rect(
            left.x + (right.x - left.x) * progress,
            left.y + (right.y - left.y) * progress,
            left.width + (right.width - left.width) * progress,
            left.height + (right.height - left.height) * progress,
        );
    }

}

window.OpenSeadragon.Recorder = Recorder as typeof OpenSeadragon.Recorder;
addModule("recorder", Recorder);
