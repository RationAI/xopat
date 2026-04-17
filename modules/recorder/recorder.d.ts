export {};

declare global {
    type RecorderStepKind = "keyframe" | "navigation";

    interface RecorderAnnotationFilterRect {
        x: number;
        y: number;
        width: number;
        height: number;
    }

    interface RecorderAnnotationFilter {
        id?: string;
        type: string;
        values?: string[];
        rect?: RecorderAnnotationFilterRect;
    }

    interface RecorderNavigationSample {
        at: number;
        rotation?: number;
        zoomLevel?: number;
        point?: OpenSeadragon.Point;
        bounds?: OpenSeadragon.Rect;
    }

    interface RecorderVisualizationTimedSample {
        at: number;
        visualization: RecorderVisualizationStateSnapshot;
    }

    interface RecorderNavigationTrack {
        samples: RecorderNavigationSample[];
        visualizationSamples?: RecorderVisualizationTimedSample[];
    }

    interface RecorderViewerTools {
        focus(step: RecorderSnapshotStep): void;
        screenshot(fullPage?: boolean, region?: Record<string, number>): unknown;
    }

    interface RecorderVisualizationSnapshot {
        order: string[];
        shaders?: Record<string, Record<string, unknown>>;
    }

    interface RecorderVisualizationStateSnapshot {
        backgrounds: BackgroundItem[];
        activeBackgroundIndex?: number | number[];
        visualizations: VisualizationItem[];
        activeVisualizationIndex?: number | number[];
        renderer?: RecorderVisualizationSnapshot;
    }

    interface RecorderSnapshotStep {
        id: string;
        viewerId: UniqueViewerId;
        viewerContextKey?: string;
        viewerTitle?: string;
        kind?: RecorderStepKind;
        delay: number;
        duration: number;
        transition: number;
        preferSameZoom?: boolean;
        rotation?: number;
        zoomLevel?: number;
        point?: OpenSeadragon.Point;
        bounds?: OpenSeadragon.Rect;
        navigation?: RecorderNavigationTrack;
        visualization?: RecorderVisualizationStateSnapshot;
        annotationFilters?: RecorderAnnotationFilter[];
        screenShot?: unknown;
    }

    interface RecorderDelayHandle {
        promise: Promise<number>;
        cancel(): void;
    }

    interface RecorderState {
        idx: number;
        steps: RecorderSnapshotStep[];
        currentStep: RecorderDelayHandle | null;
        currentPlayback: RecorderDelayHandle | null;
        playing: boolean;
        captureVisualization: boolean;
        captureViewport: boolean;
        captureScreen: boolean;
        playbackAnnotationFilters: RecorderAnnotationFilter[] | null;
        playbackVisualizationSnapshots: Record<string, RecorderVisualizationStateSnapshot>;
    }

    interface RecorderModule extends IXOpatModuleSingleton {
        create(
            viewerId: UniqueViewerId,
            delay?: number,
            duration?: number,
            transition?: number,
            atIndex?: number
        ): RecorderSnapshotStep | false;
        createNavigation(
            viewerId: UniqueViewerId,
            samples: RecorderNavigationSample[],
            visualizationSamples?: RecorderVisualizationTimedSample[],
            delay?: number,
            duration?: number,
            transition?: number,
            atIndex?: number
        ): RecorderSnapshotStep | false;
        remove(index?: number): void;
        getSteps(): RecorderSnapshotStep[];
        getStep(index: number): RecorderSnapshotStep | undefined;
        snapshotCount(): number;
        currentStep(): RecorderSnapshotStep | undefined;
        currentStepIndex(): number;
        isPlaying(): boolean;
        play(): void;
        previous(): void;
        next(): void;
        playFromIndex(index: number): void;
        stop(): void;
        goToIndex(index: number): RecorderSnapshotStep | undefined;
        capturesVisualization: boolean;
        capturesViewport: boolean;
        capturesScreen: boolean;
        setCapturesVisualization(value: boolean): void;
        setCapturesViewport(value: boolean): void;
        setCapturesScreen(value: boolean): void;
        exportJSON(serialize?: true): string;
        exportJSON(serialize: false): RecorderSnapshotStep[];
        importJSON(json: string | RecorderSnapshotStep[]): RecorderSnapshotStep[];
        stepCapturesVisualization(step: RecorderSnapshotStep): boolean;
        stepCapturesViewport(step: RecorderSnapshotStep): boolean;
        stepCapturesNavigation(step: RecorderSnapshotStep): boolean;
        sortWithIdList(ids: string[], removeMissing?: boolean): void;
    }

    namespace OpenSeadragon {
        interface Viewer {
            tools?: RecorderViewerTools;
        }

        const Recorder: {
            instance(): RecorderModule;
            __exportViewer?: (viewerId: UniqueViewerId) => Promise<void>;
        };
    }
}
