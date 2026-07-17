export {};

declare global {
    /**
     * `empty` is a spacer/hold step: it carries timing (delay/duration/transition)
     * but no viewport/visualization/navigation/annotation state. Used to (a) avoid
     * duplicating a keyframe identical to its direct predecessor, and (b) keep
     * per-viewer lanes index-aligned during simultaneous multi-viewer capture when
     * a viewer had nothing worth recording at that position.
     */
    type RecorderStepKind = "keyframe" | "navigation" | "empty";

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
        /**
         * @deprecated Per-bg viz binding now lives on `backgrounds[i].visualizationIndex`.
         * Captured here for back-compat with already-persisted recordings.
         */
        activeVisualizationIndex?: number | Array<number | undefined>;
        renderer?: RecorderVisualizationSnapshot;
        /**
         * Canonical, namespace-stripped live visualization surface captured via
         * `UTILITIES.exportLiveVisualization` (params/state/order, no world
         * indices). Used to detect "did the visualization actually change" on
         * replay so an unchanged baseline does NOT trigger a reopen. Additive;
         * absent on recordings made before this field existed.
         */
        liveCanonical?: {
            layerOrder?: string[];
            layers?: Record<string, { id?: string; type?: string; cache?: Record<string, unknown>; state?: Record<string, unknown> }>;
        };
        /**
         * Per-layer resolved data-source identities at capture time, keyed by
         * namespace-stripped shader path. Each entry follows the shader's
         * `tiledImages` world indices to the live source identity
         * (`source.tileSourceId || source.url || item.__xopatLoadKey`). This is
         * the "same data source?" axis — it catches a time-series active-frame
         * swap, which changes the underlying data without changing shader
         * id/params. Additive; absent on older recordings.
         */
        liveSources?: Record<string, string[]>;
    }

    /**
     * Snapshot of the annotations a step "owns" — used by the recorder
     * plugin (UI) to highlight / restore visible annotations when entering
     * the step. Stored on the step itself so it round-trips with the
     * timeline through the IO pipeline (no side-channel maps).
     */
    interface RecorderAnnotationRef {
        /** Fabric `toObject()` payload for one annotation. */
        object: any;
        /** Optional viewer hint when the ref originated on a specific viewer. */
        viewerId?: UniqueViewerId;
    }

    interface RecorderSnapshotStep {
        id: string;
        /**
         * Owning viewer of the step. Since a recording is now viewer-scoped
         * (see {@link RecorderRecording}), this is a back-compat / render hint
         * stamped from the owning recording's viewer; the recording is the
         * source of truth. Optional so migrated/legacy steps still validate.
         */
        viewerId?: UniqueViewerId;
        viewerContextKey?: string;
        viewerTitle?: string;
        kind?: RecorderStepKind;
        delay: number;
        duration: number;
        /**
         * Legacy spring stiffness, passed to `viewer.tools.focus` when a step is
         * applied outside playback (timeline scrubbing). Playback no longer uses
         * it: a keyframe is animated by the module's own eased tween, whose
         * length is {@link RecorderSnapshotStep.moveDuration}.
         */
        transition: number;
        /**
         * Seconds the eased move into this keyframe takes during playback. The
         * rest of `duration` is a still hold — that is what makes an overlay
         * readable. Defaults to min(`duration`, 1.8 s).
         */
        moveDuration?: number;
        preferSameZoom?: boolean;
        rotation?: number;
        zoomLevel?: number;
        point?: OpenSeadragon.Point;
        bounds?: OpenSeadragon.Rect;
        navigation?: RecorderNavigationTrack;
        visualization?: RecorderVisualizationStateSnapshot;
        annotationFilters?: RecorderAnnotationFilter[];
        screenShot?: unknown;
        /**
         * Annotations associated with this step. Migrated from the recorder
         * plugin's side-channel `annotationRefs: Record<stepId, AnnObj[]>`
         * map so the timeline export is self-contained.
         */
        annotationRefs?: RecorderAnnotationRef[];
        /**
         * Narrative overlays (markdown text, images, voiceover) that render
         * over the step's viewer while it is the active playback step.
         * Binaries (images, audio) are stored separately as {@link RecorderAsset}
         * and referenced here by `assetId`.
         */
        overlays?: RecorderOverlay[];
    }

    type RecorderOverlayKind = "composite" | "text" | "image" | "audio";

    /** Nine fixed anchors in the viewer-element coordinate system. */
    type RecorderOverlayAnchor =
        | "tl" | "tc" | "tr"
        | "ml" | "mc" | "mr"
        | "bl" | "bc" | "br";

    /**
     * Layout intent, resolved by the renderer into a region of the viewer.
     * Prefer this over a bare {@link RecorderOverlayAnchor}: the nine-cell grid
     * says *where a box is pinned*, a region says *what the overlay is for*, so
     * the renderer can size it accordingly.
     *
     * - `center` — covers the view; for overlays meant to be read instead of
     *   the slide (chapter intros, conclusions).
     * - `top` / `bottom` — a wide band across the viewer, leaving the opposite
     *   side of the view clear; the default for informative narration.
     * - `left` / `right` — a narrow side column. The viewer's left and right
     *   edges usually hold application UI (toolbars, side menus), so use these
     *   only when the narration would otherwise cover what it talks about.
     */
    type RecorderOverlayRegion = "center" | "top" | "bottom" | "left" | "right";

    interface RecorderOverlayPlacement {
        anchor: RecorderOverlayAnchor;
        /**
         * Layout intent. When set, the renderer sizes and pins the overlay for
         * that region and `anchor` is only a fallback for renderers/editors
         * that do not understand regions.
         */
        region?: RecorderOverlayRegion;
        /** CSS padding from the viewer edge in px. Defaults to 16. */
        padding?: number;
    }

    interface RecorderOverlayStyle {
        fontSize?: number;
        color?: string;
        background?: string;
        opacity?: number;
        borderRadius?: number;
        /** Max width in px applied to text/image to keep overlays compact. */
        maxWidth?: number;
    }

    interface RecorderOverlayBase {
        id: string;
        kind: RecorderOverlayKind;
        placement: RecorderOverlayPlacement;
        style?: RecorderOverlayStyle;
        /** Optional author-facing label (editor list only, not rendered). */
        label?: string;
    }

    interface RecorderTextOverlay extends RecorderOverlayBase {
        kind: "text";
        /** Markdown source; renderer parses via window.xnpm.marked. */
        markdown: string;
    }

    /**
     * Single editor card combining markdown text with one optional image,
     * pinned at one anchor. Either field may be empty — but a composite with
     * neither set is dropped on save. The image renders above the markdown.
     */
    interface RecorderCompositeOverlay extends RecorderOverlayBase {
        kind: "composite";
        markdown?: string;
        imageAssetId?: string;
        imageAlt?: string;
    }

    interface RecorderImageOverlay extends RecorderOverlayBase {
        kind: "image";
        assetId: string;
        alt?: string;
    }

    interface RecorderAudioOverlay extends RecorderOverlayBase {
        kind: "audio";
        assetId: string;
        /** Voiceover captured during a path; uploaded if added manually. */
        origin?: "voiceover" | "upload";
        /**
         * If true, render no UI (auto-plays on step entry). Defaults to true
         * for voiceover, false for uploaded clips so the user gets a play btn.
         */
        hidden?: boolean;
    }

    type RecorderOverlay =
        | RecorderCompositeOverlay
        | RecorderTextOverlay
        | RecorderImageOverlay
        | RecorderAudioOverlay;

    /** Binary asset (image or audio) referenced by overlays. */
    interface RecorderAsset {
        id: string;
        kind: "audio" | "image";
        mimeType: string;
        /** Base64 (no `data:` prefix); renderer reconstructs the data URL. */
        data: string;
        size: number;
        createdAt: number;
    }

    interface RecorderDelayHandle {
        promise: Promise<number>;
        cancel(): void;
    }

    /**
     * A single named recording. Scoped to one viewer (its steps all belong to
     * the owning {@link RecorderViewerCollection}'s viewer). Stores the slide
     * (`backgroundId`) it was recorded on so playback can restore it first.
     */
    interface RecorderRecording {
        id: string;
        name: string;
        /** Slide the recording was captured on (UTILITIES.currentBackgroundIdFor). */
        backgroundId?: string;
        viewerContextKey?: string;
        viewerTitle?: string;
        createdAt: number;
        updatedAt?: number;
        steps: RecorderSnapshotStep[];
        /**
         * Injected at runtime by a host feature (e.g. a questionnaire page or
         * guided tour) rather than authored by the user. Transient recordings
         * are excluded from the per-viewer bundle persistence so they never
         * leak into the user's saved recorder state.
         */
        transient?: boolean;
    }

    /** Live (non-serialized) playback state for one viewer's timeline. */
    interface RecorderPlaybackState {
        idx: number;
        playing: boolean;
        currentStep: RecorderDelayHandle | null;
        currentPlayback: RecorderDelayHandle | null;
        playbackAnnotationFilters: RecorderAnnotationFilter[] | null;
        playbackVisualizationSnapshots: Record<string, RecorderVisualizationStateSnapshot>;
        /** Recording currently being played back (snapshot at play start). */
        playingRecordingId: string | null;
    }

    /**
     * Per-viewer container: the collection of recordings owned by one viewer,
     * which one is active, that viewer's shared binary assets, and its live
     * playback state. Persisted through the IO pipeline with `bundleScope:
     * "per-viewer"`.
     */
    interface RecorderViewerCollection {
        viewerId: UniqueViewerId;
        recordings: RecorderRecording[];
        activeRecordingId: string | null;
        /** Shared across this viewer's recordings (overlays reference by id). */
        assets: Map<string, RecorderAsset>;
        playback: RecorderPlaybackState;
    }

    interface RecorderState {
        /** Per-viewer recording collections, keyed by viewer unique id. */
        viewers: Map<UniqueViewerId, RecorderViewerCollection>;
        captureVisualization: boolean;
        captureViewport: boolean;
        captureScreen: boolean;
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
        /** Insert an empty spacer/hold step (timing only, no captured state). */
        createEmpty(
            viewerId: UniqueViewerId,
            delay?: number,
            duration?: number,
            transition?: number,
            atIndex?: number
        ): RecorderSnapshotStep | false;
        remove(index?: number, viewerId?: UniqueViewerId): void;
        getSteps(viewerId?: UniqueViewerId): RecorderSnapshotStep[];
        getStep(index: number, viewerId?: UniqueViewerId): RecorderSnapshotStep | undefined;
        snapshotCount(viewerId?: UniqueViewerId): number;
        currentStep(viewerId?: UniqueViewerId): RecorderSnapshotStep | undefined;
        currentStepIndex(viewerId?: UniqueViewerId): number;
        /** No-arg: true if ANY viewer is playing. With id: that viewer only. */
        isPlaying(viewerId?: UniqueViewerId): boolean;
        /** No-arg: start every viewer's active recording in parallel. */
        play(viewerId?: UniqueViewerId): void;
        previous(viewerId?: UniqueViewerId): void;
        next(viewerId?: UniqueViewerId): void;
        playFromIndex(index: number, viewerId?: UniqueViewerId): void;
        /** No-arg: stop all playing viewers. With id: that viewer only. */
        stop(viewerId?: UniqueViewerId): void;
        goToIndex(index: number, viewerId?: UniqueViewerId): RecorderSnapshotStep | undefined;

        // --- Recording lifecycle (per viewer) ---
        /** Create a new (empty) recording for the viewer and make it active. */
        createRecording(viewerId?: UniqueViewerId, name?: string, backgroundId?: string): RecorderRecording;
        renameRecording(recordingId: string, name: string, viewerId?: UniqueViewerId): void;
        /** Delete a recording; re-selects a neighbour (never leaves zero). */
        deleteRecording(recordingId: string, viewerId?: UniqueViewerId): void;
        /** Deep-clone a recording (new ids) and make the copy active. */
        duplicateRecording(recordingId: string, viewerId?: UniqueViewerId): RecorderRecording | undefined;
        /**
         * A viewer's recordings; empty when it has none. Reads never create a
         * default recording — only the capture calls (`create`, `createEmpty`,
         * `createNavigation`) bootstrap one, since only they need somewhere to
         * put a step. Callers may rely on this: an empty result is the honest
         * answer, not a state to be avoided.
         */
        listRecordings(viewerId?: UniqueViewerId): RecorderRecording[];
        /**
         * Insert or replace (matched by `recording.id`) a recording in a
         * viewer's collection from plain JSON. Steps and assets are hydrated
         * exactly like bundle import (OSD points/rects reconstructed). Not a
         * recordable user action: no history entry, no CRUD echo. Use
         * `opts.transient` for host-injected recordings that must not persist
         * with the user's recorder bundles. Returns the hydrated recording, or
         * undefined when the viewer cannot be resolved.
         */
        upsertRecording(
            viewerId: UniqueViewerId,
            recording: Partial<RecorderRecording> & { id: string; steps: RecorderSnapshotStep[] },
            opts?: { assets?: RecorderAsset[]; activate?: boolean; transient?: boolean },
        ): RecorderRecording | undefined;
        /**
         * Merge recordings from a v3 bundle / v2 payload / bare steps array into
         * a viewer's collection. Additive by design — existing recordings are
         * never dropped and colliding ids are minted fresh (unlike the
         * `importBundle` IO hook, which replaces the collection on restore).
         * Imported recordings adopt the target viewer's identity. Throws with a
         * `userMessage` on unusable input, leaving the collection untouched.
         */
        importRecordings(
            viewerId: UniqueViewerId,
            data: unknown,
            opts?: { activate?: boolean },
        ): RecorderRecording[];
        setActiveRecording(recordingId: string, viewerId?: UniqueViewerId): void;
        getActiveRecording(viewerId?: UniqueViewerId): RecorderRecording | undefined;
        /** Serialize one recording (active by default) as a v3 download bundle. */
        downloadActiveRecording(viewerId?: UniqueViewerId): void;
        capturesVisualization: boolean;
        capturesViewport: boolean;
        capturesScreen: boolean;
        setCapturesVisualization(value: boolean): void;
        setCapturesViewport(value: boolean): void;
        setCapturesScreen(value: boolean): void;
        exportJSON(serialize?: true): string;
        exportJSON(serialize: false): RecorderSnapshotStep[];
        importJSON(json: string | RecorderSnapshotStep[]): RecorderSnapshotStep[];
        /**
         * True when capturing the viewer's current view would collapse into a
         * hold (nothing changed since the last keyframe). For callers that treat
         * a no-op capture as an error and want to say so before calling
         * `create`.
         */
        isCurrentViewRedundant(viewerId?: UniqueViewerId): boolean;
        stepCapturesVisualization(step: RecorderSnapshotStep): boolean;
        stepCapturesViewport(step: RecorderSnapshotStep): boolean;
        stepCapturesNavigation(step: RecorderSnapshotStep): boolean;
        sortWithIdList(ids: string[], removeMissing?: boolean, viewerId?: UniqueViewerId): void;

        /**
         * History-wrapped mutator. Looks up the step by id, runs the mutate
         * callback against it in place, raises `"update"` so renderers can
         * re-sync, and dispatches the change through the per-step CRUD.
         */
        updateStep(id: string, mutate: (step: RecorderSnapshotStep) => void): RecorderSnapshotStep | undefined;

        /** Resolve a binary asset (image/audio) by id. */
        getAsset(id: string): RecorderAsset | undefined;
        /** Store/replace an asset; dispatches `asset:create` through the IO pipeline. */
        putAsset(asset: RecorderAsset): RecorderAsset;
        /**
         * Remove an asset and detach any overlays still referencing it.
         * Dispatches `asset:delete`. Returns true if the asset existed.
         */
        deleteAsset(id: string): boolean;
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
