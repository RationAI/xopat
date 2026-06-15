/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../src/types/loader.d.ts" />
/// <reference path="./recorder.d.ts" />

type RecorderManagedViewer = OpenSeadragon.Viewer & {
    tools?: RecorderViewerTools;
};

/**
 * Transient handle threaded through the playback chain so each viewer's
 * timeline animates independently (parallel multi-viewport playback). It
 * pairs the recording being played with that viewer's live playback state.
 */
interface RecorderPlaybackSession {
    viewerId: UniqueViewerId;
    viewer: RecorderManagedViewer;
    collection: RecorderViewerCollection;
    recording: RecorderRecording;
    playback: RecorderPlaybackState;
}

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

function makePlaybackState(): RecorderPlaybackState {
    return {
        idx: 0,
        playing: false,
        currentStep: null,
        currentPlayback: null,
        playbackAnnotationFilters: null,
        playbackVisualizationSnapshots: {},
        playingRecordingId: null,
    };
}

class Recorder extends XOpatModuleSingleton implements RecorderModule {
    private readonly _snapshotsState: RecorderState;
    /** CRUD façade for per-step sync; inert until an admin binds `crud:step`. */
    private stepResource?: any;
    /** CRUD façade for binary overlay assets (audio/image). */
    private assetResource?: any;
    /** Set during bundle hydration so per-step CRUD doesn't echo back upstream. */
    private _suppressDispatch = false;
    /** Serializes recorder-driven openViewerWith reopens (see _enqueueViewerOpen). */
    private _viewerOpenQueue: Promise<unknown> = Promise.resolve();

    constructor() {
        super();

        OpenSeadragon.Recorder.__exportViewer = async (viewerId: UniqueViewerId) => {
            try {
                // Legacy single-viewer download. Exports the viewer's whole
                // recording collection as a v3 bundle. The user-facing Export
                // actions go through `IO_PIPELINE.flushBundleExport` (all) or
                // `downloadActiveRecording` (one recording).
                const col = this._snapshotsState.viewers.get(viewerId);
                const payload = {
                    v: 3,
                    recordings: col ? col.recordings : [],
                    activeRecordingId: col?.activeRecordingId ?? null,
                    assets: col ? Array.from(col.assets.values()) : [],
                };
                UTILITIES.downloadAsFile(`recorder-${viewerId}.json`, JSON.stringify(payload));
            } catch (error) {
                console.error(error);
                Dialogs.show("Failed to export recorder state.", 2500, Dialogs.MSG_ERR);
            }
        };

        this._snapshotsState = {
            viewers: new Map<UniqueViewerId, RecorderViewerCollection>(),
            captureVisualization: false,
            captureViewport: true,
            captureScreen: false,
        };

        this._initIOPipeline().catch(e => console.error("[recorder] IO pipeline init failed:", e));
        this._wireViewerEvents();
    }

    private _wireViewerEvents(): void {
        try {
            VIEWER_MANAGER.addHandler?.("viewer-destroy", (e: any) => {
                const id = e?.uniqueId || e?.viewer?.uniqueId || e?.eventSource?.uniqueId;
                if (id) this._stopViewer(id);
            });
        } catch (e) {
            console.warn("[recorder] could not wire viewer-destroy handler:", e);
        }
    }

    /**
     * Generic IO pipeline integration. Each viewer's recording collection is
     * a per-viewer bundle (`bundleScope: "per-viewer"`); the pipeline keys it
     * by `ctx.viewerId` and restores it on boot per viewer. Per-element CRUD
     * is declared but inert until an admin binds the capability. See
     * src/IO_PIPELINE.md.
     */
    private async _initIOPipeline(): Promise<void> {
        await this.initIO({
            bundleScope: "per-viewer",
            exportBundle: async (ctx: any) => {
                if (!ctx?.viewerId) return undefined;
                const col = this._snapshotsState.viewers.get(ctx.viewerId);
                if (!col || !col.recordings.length) return undefined;
                return JSON.stringify({
                    v: 3,
                    recordings: col.recordings,
                    activeRecordingId: col.activeRecordingId,
                    assets: Array.from(col.assets.values()),
                });
            },
            importBundle: async (ctx: any, data: unknown) => {
                if (data === undefined || data === null) return;
                try {
                    await APPLICATION_CONTEXT.history.withoutRecording(() => {
                        if (ctx?.viewerId) {
                            this._importViewerBundle(ctx.viewerId, data as any);
                        } else {
                            // User-import path (IO_PIPELINE.importBundle(raw)) has no
                            // viewer scope: distribute a legacy/global bundle across
                            // the currently open viewers.
                            this._importLegacyGlobalBundle(data as any);
                        }
                    });
                } catch (e: any) {
                    const reason = e?.message ?? String(e);
                    console.warn("[recorder] importBundle failed:", e);
                    const wrapped = new Error(`Failed to load recorder timeline: ${reason}`);
                    (wrapped as any).userMessage = `Could not load recorder timeline. ${reason}`;
                    throw wrapped;
                }
            },
        });

        // Per-step CRUD rides an envelope `{ viewerId, recordingId, step }` so
        // identity never collides across recordings/viewers.
        this.stepResource = (this as any).defineResource({
            name: "step",
            identityOf: (e: any) => `${e?.viewerId ?? ""}:${e?.recordingId ?? ""}:${e?.step?.id ?? e?.id ?? ""}`,
            coalesce: true,
            merge: (prev: any, next: any) => ({
                ...(prev || {}),
                ...(next || {}),
                step: { ...(prev?.step || {}), ...(next?.step || {}) },
            }),
            persistOutbox: true,
            persistMaxEntries: 2000,
            persistMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
            validate: (e: any) => {
                const step = e?.step ?? e;
                if (!step || typeof step !== "object") return { ok: false, refused: true, reason: "step must be an object" };
                if (!step.id) return { ok: false, refused: true, reason: "missing step id" };
                return { ok: true };
            },
        });

        // Binary overlay assets ride on their own CRUD channel — keeps step
        // JSON small and lets sinks ship binaries to dedicated storage.
        this.assetResource = (this as any).defineResource({
            name: "asset",
            identityOf: (e: any) => `${e?.viewerId ?? ""}:${e?.asset?.id ?? e?.id ?? ""}`,
            coalesce: false,
            persistOutbox: true,
            persistMaxEntries: 500,
            persistMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
            validate: (e: any) => {
                const asset = e?.asset ?? e;
                if (!asset || typeof asset !== "object") return { ok: false, refused: true, reason: "asset must be an object" };
                if (!asset.id) return { ok: false, refused: true, reason: "asset id required" };
                if (!asset.data || typeof asset.data !== "string") return { ok: false, refused: true, reason: "asset data (base64) required" };
                return { ok: true };
            },
        });
    }

    // ---------------------------------------------------------------------
    // Collection / recording resolvers
    // ---------------------------------------------------------------------

    private _newId(prefix = ""): string {
        return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    /** Resolve (or lazily create) a viewer's collection WITHOUT a default recording. */
    private _rawCollection(viewerId?: UniqueViewerId): RecorderViewerCollection | undefined {
        const viewer = this._resolveViewer(viewerId);
        const id = (viewer?.uniqueId ?? viewerId) as UniqueViewerId | undefined;
        if (!id) return undefined;
        let col = this._snapshotsState.viewers.get(id);
        if (!col) {
            col = {
                viewerId: id,
                recordings: [],
                activeRecordingId: null,
                assets: new Map<string, RecorderAsset>(),
                playback: makePlaybackState(),
            };
            this._snapshotsState.viewers.set(id, col);
        }
        return col;
    }

    /** Resolve a viewer's collection, guaranteeing at least one recording. */
    private _collection(viewerId?: UniqueViewerId): RecorderViewerCollection | undefined {
        const col = this._rawCollection(viewerId);
        if (col && !col.recordings.length) this._appendDefaultRecording(col);
        return col;
    }

    private _defaultRecordingName(col: RecorderViewerCollection): string {
        return `Recording ${col.recordings.length + 1}`;
    }

    /** Silent default-recording bootstrap (no event, no history). */
    private _appendDefaultRecording(col: RecorderViewerCollection): RecorderRecording {
        const viewer = this._resolveViewer(col.viewerId);
        const ctx = getViewerContextMeta(viewer);
        const recording: RecorderRecording = {
            id: this._newId("rec-"),
            name: this._defaultRecordingName(col),
            backgroundId: viewer ? (UTILITIES as any).currentBackgroundIdFor?.(viewer) : undefined,
            viewerContextKey: ctx.key,
            viewerTitle: ctx.title,
            createdAt: Date.now(),
            steps: [],
        };
        col.recordings.push(recording);
        col.activeRecordingId = recording.id;
        return recording;
    }

    private _activeRecording(viewerId?: UniqueViewerId): RecorderRecording | undefined {
        const col = this._collection(viewerId);
        if (!col) return undefined;
        if (!col.activeRecordingId || !col.recordings.some(r => r.id === col.activeRecordingId)) {
            col.activeRecordingId = col.recordings[0]?.id ?? null;
        }
        return col.recordings.find(r => r.id === col.activeRecordingId) || col.recordings[0];
    }

    /** Locate a step by id across every viewer/recording (ids are unique). */
    private _findStep(id: string): { viewerId: UniqueViewerId; recording: RecorderRecording; index: number; step: RecorderSnapshotStep } | undefined {
        for (const col of this._snapshotsState.viewers.values()) {
            for (const recording of col.recordings) {
                const index = recording.steps.findIndex(s => s.id === id);
                const step = index >= 0 ? recording.steps[index] : undefined;
                if (step) return { viewerId: col.viewerId, recording, index, step };
            }
        }
        return undefined;
    }

    private _findAssetCollection(id: string): RecorderViewerCollection | undefined {
        for (const col of this._snapshotsState.viewers.values()) {
            if (col.assets.has(id)) return col;
        }
        return undefined;
    }

    // ---------------------------------------------------------------------
    // Recording lifecycle API
    // ---------------------------------------------------------------------

    createRecording(viewerId?: UniqueViewerId, name?: string, backgroundId?: string): RecorderRecording {
        const col = this._rawCollection(viewerId);
        if (!col) throw new Error("Recorder.createRecording: no viewer available");
        const viewer = this._resolveViewer(col.viewerId);
        const ctx = getViewerContextMeta(viewer);
        const recording: RecorderRecording = {
            id: this._newId("rec-"),
            name: name || this._defaultRecordingName(col),
            backgroundId: backgroundId ?? (viewer ? (UTILITIES as any).currentBackgroundIdFor?.(viewer) : undefined),
            viewerContextKey: ctx.key,
            viewerTitle: ctx.title,
            createdAt: Date.now(),
            steps: [],
        };
        const prevActive = col.activeRecordingId;
        APPLICATION_CONTEXT.history.push(
            () => APPLICATION_CONTEXT.history.withoutRecording(() => {
                if (!col.recordings.some(r => r.id === recording.id)) col.recordings.push(recording);
                col.activeRecordingId = recording.id;
                this.raiseEvent("recording-create", { viewerId: col.viewerId, recordingId: recording.id, recording });
                this.raiseEvent("recording-active", { viewerId: col.viewerId, recordingId: recording.id });
            }),
            () => APPLICATION_CONTEXT.history.withoutRecording(() => {
                const i = col.recordings.findIndex(r => r.id === recording.id);
                if (i >= 0) col.recordings.splice(i, 1);
                col.activeRecordingId = prevActive ?? col.recordings[0]?.id ?? null;
                this.raiseEvent("recording-delete", { viewerId: col.viewerId, recordingId: recording.id });
                this.raiseEvent("recording-active", { viewerId: col.viewerId, recordingId: col.activeRecordingId });
            }),
            { name: "Recorder: add recording", type: "recorder.addRecording" } as any,
        );
        return recording;
    }

    renameRecording(recordingId: string, name: string, viewerId?: UniqueViewerId): void {
        const col = this._rawCollection(viewerId);
        const recording = col?.recordings.find(r => r.id === recordingId);
        if (!col || !recording) return;
        const before = recording.name;
        const apply = (value: string) => {
            recording.name = value;
            recording.updatedAt = Date.now();
            this.raiseEvent("recording-rename", { viewerId: col.viewerId, recordingId, name: value });
        };
        APPLICATION_CONTEXT.history.push(
            () => APPLICATION_CONTEXT.history.withoutRecording(() => apply(name)),
            () => APPLICATION_CONTEXT.history.withoutRecording(() => apply(before)),
            { name: "Recorder: rename recording", type: "recorder.renameRecording" } as any,
        );
    }

    deleteRecording(recordingId: string, viewerId?: UniqueViewerId): void {
        const col = this._rawCollection(viewerId);
        if (!col) return;
        const index = col.recordings.findIndex(r => r.id === recordingId);
        if (index < 0) return;
        const recording = col.recordings[index];
        if (!recording) return;
        const prevActive = col.activeRecordingId;

        APPLICATION_CONTEXT.history.push(
            () => APPLICATION_CONTEXT.history.withoutRecording(() => {
                const i = col.recordings.findIndex(r => r.id === recordingId);
                if (i < 0) return;
                col.recordings.splice(i, 1);
                if (col.activeRecordingId === recordingId) {
                    col.activeRecordingId = (col.recordings[i] || col.recordings[i - 1] || col.recordings[0])?.id ?? null;
                }
                if (!col.recordings.length) this._appendDefaultRecording(col);
                this.raiseEvent("recording-delete", { viewerId: col.viewerId, recordingId });
                this.raiseEvent("recording-active", { viewerId: col.viewerId, recordingId: col.activeRecordingId });
            }),
            () => APPLICATION_CONTEXT.history.withoutRecording(() => {
                if (!col.recordings.some(r => r.id === recording.id)) {
                    col.recordings.splice(Math.min(index, col.recordings.length), 0, recording);
                }
                col.activeRecordingId = prevActive;
                this.raiseEvent("recording-create", { viewerId: col.viewerId, recordingId: recording.id, recording });
                this.raiseEvent("recording-active", { viewerId: col.viewerId, recordingId: col.activeRecordingId });
            }),
            { name: "Recorder: delete recording", type: "recorder.deleteRecording" } as any,
        );
    }

    duplicateRecording(recordingId: string, viewerId?: UniqueViewerId): RecorderRecording | undefined {
        const col = this._rawCollection(viewerId);
        const source = col?.recordings.find(r => r.id === recordingId);
        if (!col || !source) return undefined;
        const copy: RecorderRecording = {
            ...cloneRecord(source as unknown as Record<string, unknown>) as unknown as RecorderRecording,
            id: this._newId("rec-"),
            name: `${source.name} (copy)`,
            createdAt: Date.now(),
            updatedAt: undefined,
            steps: source.steps.map(step => {
                const cloned = cloneRecord(step as unknown as Record<string, unknown>) as unknown as RecorderSnapshotStep;
                cloned.id = this._newId();
                return cloned;
            }),
        };
        const prevActive = col.activeRecordingId;
        APPLICATION_CONTEXT.history.push(
            () => APPLICATION_CONTEXT.history.withoutRecording(() => {
                if (!col.recordings.some(r => r.id === copy.id)) col.recordings.push(copy);
                col.activeRecordingId = copy.id;
                this.raiseEvent("recording-create", { viewerId: col.viewerId, recordingId: copy.id, recording: copy });
                this.raiseEvent("recording-active", { viewerId: col.viewerId, recordingId: copy.id });
            }),
            () => APPLICATION_CONTEXT.history.withoutRecording(() => {
                const i = col.recordings.findIndex(r => r.id === copy.id);
                if (i >= 0) col.recordings.splice(i, 1);
                col.activeRecordingId = prevActive ?? col.recordings[0]?.id ?? null;
                this.raiseEvent("recording-delete", { viewerId: col.viewerId, recordingId: copy.id });
                this.raiseEvent("recording-active", { viewerId: col.viewerId, recordingId: col.activeRecordingId });
            }),
            { name: "Recorder: duplicate recording", type: "recorder.duplicateRecording" } as any,
        );
        return copy;
    }

    listRecordings(viewerId?: UniqueViewerId): RecorderRecording[] {
        const col = this._collection(viewerId);
        return col ? [...col.recordings] : [];
    }

    setActiveRecording(recordingId: string, viewerId?: UniqueViewerId): void {
        const col = this._rawCollection(viewerId);
        if (!col || !col.recordings.some(r => r.id === recordingId)) return;
        if (col.activeRecordingId === recordingId) return;
        // Switching recordings is not a recordable user action — keep it off
        // the undo stack so undo operates within a recording's steps.
        if (col.playback.playing) this._stopCollection(col);
        col.activeRecordingId = recordingId;
        col.playback.idx = 0;
        this.raiseEvent("recording-active", { viewerId: col.viewerId, recordingId });
    }

    getActiveRecording(viewerId?: UniqueViewerId): RecorderRecording | undefined {
        return this._activeRecording(viewerId);
    }

    downloadActiveRecording(viewerId?: UniqueViewerId): void {
        const col = this._collection(viewerId);
        const recording = this._activeRecording(viewerId);
        if (!col || !recording) return void Dialogs.show("No recording is available to export.", 2500, Dialogs.MSG_WARN);
        const payload = {
            v: 3,
            recordings: [recording],
            activeRecordingId: recording.id,
            assets: Array.from(col.assets.values()),
        };
        const safeName = (recording.name || recording.id).replace(/[^\w.-]+/g, "_");
        UTILITIES.downloadAsFile(`recorder-${safeName}.json`, JSON.stringify(payload));
    }

    // ---------------------------------------------------------------------
    // Step capture
    // ---------------------------------------------------------------------

    create(
        viewerId: UniqueViewerId,
        delay = 0,
        duration = 0.5,
        transition = 1.6,
        atIndex?: number,
    ): RecorderSnapshotStep | false {
        const state = this._snapshotsState;
        const viewer = this._resolveViewer(viewerId);
        if (!viewer?.viewport) {
            console.warn("Recorder.create() skipped: no viewer is available for recording.", { viewerId });
            return false;
        }
        const col = this._collection(viewer.uniqueId || viewerId);
        const recording = this._activeRecording(viewer.uniqueId || viewerId);
        if (!col || !recording) return false;
        if (col.playback.playing) return false;
        const viewerContext = getViewerContextMeta(viewer);

        const step: RecorderSnapshotStep = {
            id: this._newId(),
            kind: "keyframe",
            rotation: state.captureViewport ? viewer.viewport.getRotation() : undefined,
            zoomLevel: state.captureViewport ? viewer.viewport.getZoom() : undefined,
            point: state.captureViewport ? viewer.viewport.getCenter() : undefined,
            bounds: state.captureViewport ? viewer.viewport.getBounds() : undefined,
            preferSameZoom: true,
            delay,
            duration,
            transition,
            visualization: this._captureChangedVisualization(viewer, recording.steps, atIndex),
            annotationFilters: this._captureChangedAnnotationFilters(recording.steps, atIndex),
            viewerId: viewer.uniqueId || viewerId,
            viewerContextKey: viewerContext.key,
            viewerTitle: viewerContext.title,
            screenShot: state.captureScreen ? viewer.tools?.screenshot(true, { x: 120, y: 120 }) : undefined,
        };
        this._stampRecordingBackground(recording, viewer);

        // Direct-neighbour dedup: if this keyframe is identical to the immediately
        // preceding keyframe (no viewport / visualization / annotation change),
        // store an empty spacer (hold) instead of a duplicate. Only collapses
        // DIRECT neighbours — a different step in between breaks the chain.
        const finalStep = this._isRedundantKeyframe(step, recording.steps, atIndex)
            ? this._buildEmptyStep(viewer, viewerId, delay, duration, transition)
            : step;

        this._addUserStep(col.viewerId, recording, finalStep, atIndex);
        return finalStep;
    }

    createEmpty(
        viewerId: UniqueViewerId,
        delay = 0,
        duration = 0.5,
        transition = 1.6,
        atIndex?: number,
    ): RecorderSnapshotStep | false {
        const viewer = this._resolveViewer(viewerId);
        const col = this._collection(viewer?.uniqueId || viewerId);
        const recording = this._activeRecording(viewer?.uniqueId || viewerId);
        if (!col || !recording) return false;
        if (col.playback.playing) return false;
        const step = this._buildEmptyStep(viewer, viewerId, delay, duration, transition);
        this._addUserStep(col.viewerId, recording, step, atIndex);
        return step;
    }

    private _buildEmptyStep(
        viewer: RecorderManagedViewer | undefined,
        viewerId: UniqueViewerId,
        delay: number,
        duration: number,
        transition: number,
    ): RecorderSnapshotStep {
        const viewerContext = getViewerContextMeta(viewer);
        return {
            id: this._newId(),
            kind: "empty",
            delay,
            duration,
            transition,
            viewerId: viewer?.uniqueId || viewerId,
            viewerContextKey: viewerContext.key,
            viewerTitle: viewerContext.title,
        };
    }

    /**
     * True when `candidate` (a freshly-captured keyframe) is identical to the
     * immediately preceding keyframe — same viewport and no visualization /
     * annotation delta — so it can collapse to an empty hold. Walks back over
     * intervening empty spacers (they don't change state); any non-empty,
     * non-matching step breaks the chain so it is NOT collapsed.
     */
    private _isRedundantKeyframe(candidate: RecorderSnapshotStep, steps: RecorderSnapshotStep[], atIndex?: number): boolean {
        if (candidate.visualization || candidate.annotationFilters) return false;
        if (!candidate.point || typeof candidate.zoomLevel !== "number") return false; // viewport not captured
        let i = (typeof atIndex === "number" ? atIndex : steps.length) - 1;
        while (i >= 0 && steps[i]?.kind === "empty") i -= 1;
        const prev = i >= 0 ? steps[i] : undefined;
        if (!prev || prev.kind !== "keyframe") return false;
        return this._sameViewport(prev, candidate);
    }

    private _sameViewport(a: RecorderSnapshotStep, b: RecorderSnapshotStep): boolean {
        if (!a.point || !b.point) return false;
        if (Math.abs(a.point.x - b.point.x) > 1e-4 || Math.abs(a.point.y - b.point.y) > 1e-4) return false;
        const az = a.zoomLevel, bz = b.zoomLevel;
        if (typeof az === "number" && typeof bz === "number") {
            if (Math.abs(az - bz) / Math.max(Math.abs(bz), 1e-6) > 0.01) return false;
        } else if ((typeof az === "number") !== (typeof bz === "number")) {
            return false;
        }
        const ar = a.rotation || 0, br = b.rotation || 0;
        if (Math.abs(ar - br) > 0.5) return false;
        return true;
    }

    private _samplesHaveMotion(samples: RecorderNavigationSample[]): boolean {
        const first = samples[0];
        if (!first) return false;
        for (const s of samples) {
            if (first.point && s.point && (Math.abs(s.point.x - first.point.x) > 1e-4 || Math.abs(s.point.y - first.point.y) > 1e-4)) return true;
            if (typeof s.zoomLevel === "number" && typeof first.zoomLevel === "number"
                && Math.abs(s.zoomLevel - first.zoomLevel) / Math.max(Math.abs(first.zoomLevel), 1e-6) > 0.01) return true;
            if (typeof s.rotation === "number" && typeof first.rotation === "number" && Math.abs(s.rotation - first.rotation) > 0.5) return true;
        }
        return false;
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
        const viewer = this._resolveViewer(viewerId);
        if (!viewer?.viewport || samples.length < 2) {
            console.warn("Recorder.createNavigation() skipped: not enough navigation samples.", { viewerId, sampleCount: samples.length });
            return false;
        }
        const col = this._collection(viewer.uniqueId || viewerId);
        const recording = this._activeRecording(viewer.uniqueId || viewerId);
        if (!col || !recording) return false;
        if (col.playback.playing) return false;
        const viewerContext = getViewerContextMeta(viewer);

        const normalizedSamples = this._normalizeNavigationSamples(samples);
        const normalizedVisualizationSamples = this._normalizeVisualizationSamples(visualizationSamples || []);
        const lastSample = normalizedSamples[normalizedSamples.length - 1];
        if (!lastSample) return false;
        const lastVisualizationSample = normalizedVisualizationSamples[normalizedVisualizationSamples.length - 1];
        const recordedDuration = Math.max(0.1, Math.max(lastSample.at || 0, lastVisualizationSample?.at || 0) / 1000);

        // Motionless path with no visualization changes (e.g. an armed viewer the
        // user never touched during a simultaneous take) → store an empty hold of
        // the same duration so the lane stays aligned without a dead nav step.
        if (!normalizedVisualizationSamples.length && !this._samplesHaveMotion(normalizedSamples)) {
            const empty = this._buildEmptyStep(viewer, viewerId, delay, recordedDuration, transition);
            this._addUserStep(col.viewerId, recording, empty, atIndex);
            return empty;
        }

        const step: RecorderSnapshotStep = {
            id: this._newId(),
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
            visualization: this._captureChangedVisualization(viewer, recording.steps, atIndex),
            annotationFilters: this._captureChangedAnnotationFilters(recording.steps, atIndex),
            viewerContextKey: viewerContext.key,
            viewerTitle: viewerContext.title,
        };
        this._stampRecordingBackground(recording, viewer);

        this._addUserStep(col.viewerId, recording, step, atIndex);
        return step;
    }

    private _stampRecordingBackground(recording: RecorderRecording, viewer: RecorderManagedViewer): void {
        if (recording.backgroundId) return;
        const bg = (UTILITIES as any).currentBackgroundIdFor?.(viewer);
        if (typeof bg === "string") recording.backgroundId = bg;
    }

    remove(index?: number, viewerId?: UniqueViewerId): void {
        const col = this._collection(viewerId);
        const recording = this._activeRecording(viewerId);
        if (!col || !recording) return;
        if (col.playback.playing) return;

        const resolvedIndex = index ?? col.playback.idx;
        const step = recording.steps[resolvedIndex];
        if (!step) return;

        // History-wrapped removal. The forward fn does the splice + emits
        // events + dispatches a CRUD delete (when bound). The backward fn
        // re-inserts at the original index and dispatches a CRUD create.
        APPLICATION_CONTEXT.history.push(
            () => APPLICATION_CONTEXT.history.withoutRecording(() => this._removeAt(col.viewerId, recording, resolvedIndex)),
            () => APPLICATION_CONTEXT.history.withoutRecording(() => this._add(col.viewerId, recording, step, resolvedIndex)),
            { name: "Recorder: remove step", type: "recorder.removeStep" } as any,
        );
    }

    /**
     * History-wrapped append used by user-facing `create`/`createNavigation`.
     * The forward fn inserts and dispatches CRUD; the backward fn removes
     * the step by id (location may have shifted since add).
     */
    private _addUserStep(viewerId: UniqueViewerId, recording: RecorderRecording, step: RecorderSnapshotStep, atIndex?: number): void {
        APPLICATION_CONTEXT.history.push(
            () => APPLICATION_CONTEXT.history.withoutRecording(() => this._add(viewerId, recording, step, atIndex)),
            () => APPLICATION_CONTEXT.history.withoutRecording(() => this._removeStepById(viewerId, recording, step.id)),
            { name: "Recorder: add step", type: "recorder.addStep" } as any,
        );
    }

    /** Splice + raise + dispatch CRUD delete. Suppression-aware. */
    private _removeAt(viewerId: UniqueViewerId, recording: RecorderRecording, index: number): void {
        const step = recording.steps[index];
        if (!step) return;
        recording.steps.splice(index, 1);
        const col = this._snapshotsState.viewers.get(viewerId);
        if (col) col.playback.idx = recording.steps.length ? col.playback.idx % recording.steps.length : 0;
        this.raiseEvent("remove", { viewerId, recordingId: recording.id, index, step });
        if (!this._suppressDispatch) this.stepResource?.delete(`${viewerId}:${recording.id}:${step.id}`);
    }

    private _removeStepById(viewerId: UniqueViewerId, recording: RecorderRecording, id: string): void {
        const idx = recording.steps.findIndex(s => s.id === id);
        if (idx >= 0) this._removeAt(viewerId, recording, idx);
    }

    private _add(viewerId: UniqueViewerId, recording: RecorderRecording, step: RecorderSnapshotStep, index?: number): void {
        if (!step) return;
        let resolvedIndex = typeof index === "number" ? index : recording.steps.length;

        if (resolvedIndex >= 0 && resolvedIndex < recording.steps.length) {
            recording.steps.splice(resolvedIndex, 0, step);
        } else {
            resolvedIndex = recording.steps.length;
            recording.steps.push(step);
        }

        this.raiseEvent("create", { viewerId, recordingId: recording.id, index: resolvedIndex, step });
        if (!this._suppressDispatch) this.stepResource?.create({ viewerId, recordingId: recording.id, step });
    }

    // ---------------------------------------------------------------------
    // Queries (default to the active viewer's active recording)
    // ---------------------------------------------------------------------

    getSteps(viewerId?: UniqueViewerId): RecorderSnapshotStep[] {
        return [...(this._activeRecording(viewerId)?.steps ?? [])];
    }

    getStep(index: number, viewerId?: UniqueViewerId): RecorderSnapshotStep | undefined {
        return this._activeRecording(viewerId)?.steps[index];
    }

    snapshotCount(viewerId?: UniqueViewerId): number {
        return this._activeRecording(viewerId)?.steps.length ?? 0;
    }

    currentStep(viewerId?: UniqueViewerId): RecorderSnapshotStep | undefined {
        const col = this._collection(viewerId);
        const recording = this._activeRecording(viewerId);
        if (!col || !recording) return undefined;
        return recording.steps[col.playback.idx];
    }

    currentStepIndex(viewerId?: UniqueViewerId): number {
        return this._collection(viewerId)?.playback.idx ?? 0;
    }

    isPlaying(viewerId?: UniqueViewerId): boolean {
        if (viewerId !== undefined) return !!this._snapshotsState.viewers.get(viewerId)?.playback.playing;
        for (const col of this._snapshotsState.viewers.values()) {
            if (col.playback.playing) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------------
    // Playback
    // ---------------------------------------------------------------------

    private _buildSession(viewerId?: UniqueViewerId): RecorderPlaybackSession | undefined {
        const col = this._collection(viewerId);
        if (!col) return undefined;
        const viewer = this._resolveViewer(col.viewerId);
        if (!viewer?.viewport) return undefined;
        const recording = this._activeRecording(col.viewerId);
        if (!recording) return undefined;
        return { viewerId: col.viewerId, viewer, collection: col, recording, playback: col.playback };
    }

    /** Session referencing the recording currently playing (or the active one). */
    private _runningSession(viewerId?: UniqueViewerId): RecorderPlaybackSession | undefined {
        const col = this._collection(viewerId);
        if (!col) return undefined;
        const viewer = this._resolveViewer(col.viewerId);
        if (!viewer?.viewport) return undefined;
        const recId = col.playback.playing ? col.playback.playingRecordingId : col.activeRecordingId;
        const recording = col.recordings.find(r => r.id === recId) || this._activeRecording(col.viewerId);
        if (!recording) return undefined;
        return { viewerId: col.viewerId, viewer, collection: col, recording, playback: col.playback };
    }

    play(viewerId?: UniqueViewerId): void {
        if (viewerId !== undefined) {
            const session = this._buildSession(viewerId);
            if (!session || !session.recording.steps.length || session.playback.playing) return;
            this._restoreRecordingSlide(session)
                .catch(() => undefined)
                .then(() => this._startSession(session));
            return;
        }

        // Fan out: start every viewer's active recording simultaneously.
        const sessions: RecorderPlaybackSession[] = [];
        for (const col of this._snapshotsState.viewers.values()) {
            if (col.playback.playing) continue;
            const session = this._buildSession(col.viewerId);
            if (session && session.recording.steps.length) sessions.push(session);
        }
        if (!sessions.length) {
            const fallback = this._buildSession();
            if (fallback && fallback.recording.steps.length && !fallback.playback.playing) sessions.push(fallback);
        }
        if (!sessions.length) return;

        // Restore each recording's slide first (sequentially — concurrent
        // openViewerWith calls race on shared config), then kick all timelines
        // together so multi-viewport playback stays aligned.
        void (async () => {
            for (const s of sessions) {
                await this._restoreRecordingSlide(s).catch(() => undefined);
            }
            sessions.forEach(s => this._startSession(s));
        })();
    }

    private _startSession(session: RecorderPlaybackSession): void {
        const pb = session.playback;
        if (pb.playing) return;
        if (pb.idx >= session.recording.steps.length) {
            pb.idx = Math.max(0, session.recording.steps.length - 1);
        }
        pb.playbackAnnotationFilters = this._getAnnotationFiltersSnapshot();
        pb.playbackVisualizationSnapshots = {};
        pb.playing = true;
        pb.playingRecordingId = session.recording.id;
        this.raiseEvent("play", { viewerId: session.viewerId, recordingId: session.recording.id });
        this.playStep(session, pb.idx);
    }

    private async _restoreRecordingSlide(session: RecorderPlaybackSession): Promise<void> {
        const bg = session.recording.backgroundId;
        if (!bg) return;
        try {
            const current = (UTILITIES as any).currentBackgroundIdFor?.(session.viewer);
            if (current === bg) return;
            const backgrounds = Array.isArray(APPLICATION_CONTEXT.config.background) ? APPLICATION_CONTEXT.config.background : [];
            const targetIndex = backgrounds.findIndex((b: any) => b?.id === bg);
            if (targetIndex < 0) return;
            const slot = VIEWER_MANAGER.getViewerSlotIndex?.(session.viewer);
            if (!Number.isInteger(slot) || (slot as number) < 0) return;
            const activeBg = APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, true, true);
            const bgSpec: Array<number | undefined> = Array.isArray(activeBg)
                ? activeBg.map((v: any) => (Number.isInteger(v) ? v : undefined))
                : (Number.isInteger(activeBg) ? [activeBg as number] : []);
            while (bgSpec.length <= (slot as number)) bgSpec.push(bgSpec[0]);
            bgSpec[slot as number] = targetIndex;
            // Share the serialized reopen queue with stop-time viz restores so
            // play-start and stop never fire concurrent openViewerWith calls.
            await this._enqueueViewerOpen(() => APPLICATION_CONTEXT.openViewerWith(
                undefined, undefined, undefined,
                bgSpec as number[],
                undefined,
                {
                    historyMode: "skip",
                    fromHistory: true,
                    preserveHistoryOnBackgroundChange: true,
                } as never,
            ));
        } catch (e) {
            console.warn("[recorder] slide restore failed:", e);
        }
    }

    previous(viewerId?: UniqueViewerId): void {
        const session = this._runningSession(viewerId);
        if (!session) return;
        const steps = session.recording.steps;
        const pb = session.playback;
        if (pb.playing) {
            if (!steps.length) return;
            this.playStep(session, (((pb.idx - 1) % steps.length) + steps.length) % steps.length, true, pb.idx);
            return;
        }
        void this.goToIndex(pb.idx - 1, session.viewerId);
    }

    next(viewerId?: UniqueViewerId): void {
        const session = this._runningSession(viewerId);
        if (!session) return;
        const steps = session.recording.steps;
        const pb = session.playback;
        if (pb.playing) {
            if (!steps.length) return;
            this.playStep(session, (pb.idx + 1) % steps.length, true, pb.idx);
            return;
        }
        void this.goToIndex(pb.idx + 1, session.viewerId);
    }

    playFromIndex(index: number, viewerId?: UniqueViewerId): void {
        const col = this._collection(viewerId);
        if (col) {
            if (col.playback.playing) return;
            col.playback.idx = index;
        }
        this.play(viewerId);
    }

    stop(viewerId?: UniqueViewerId): void {
        if (viewerId !== undefined) {
            this._stopViewer(viewerId);
            return;
        }
        for (const col of this._snapshotsState.viewers.values()) {
            if (col.playback.playing) this._stopCollection(col);
        }
    }

    private _stopViewer(viewerId: UniqueViewerId): void {
        const col = this._snapshotsState.viewers.get(viewerId);
        if (col?.playback.playing) this._stopCollection(col);
    }

    private _stopCollection(col: RecorderViewerCollection): void {
        const pb = col.playback;
        if (!pb.playing) return;

        pb.currentStep?.cancel();
        pb.currentStep = null;
        pb.currentPlayback?.cancel();
        pb.currentPlayback = null;
        pb.playing = false;
        if (pb.playbackAnnotationFilters) {
            this._setAnnotationFilters(pb.playbackAnnotationFilters);
        } else {
            this._clearAnnotationFilters();
        }
        pb.playbackAnnotationFilters = null;
        this._restorePlaybackVisualizations(col);
        pb.playbackVisualizationSnapshots = {};
        const recordingId = pb.playingRecordingId;
        pb.playingRecordingId = null;
        this.raiseEvent("stop", { viewerId: col.viewerId, recordingId });
    }

    goToIndex(atIndex: number, viewerId?: UniqueViewerId): RecorderSnapshotStep | undefined {
        const session = this._runningSession(viewerId);
        if (!session) return undefined;
        const steps = session.recording.steps;
        const pb = session.playback;
        if (pb.playing || !steps.length) return undefined;

        pb.idx = ((atIndex % steps.length) + steps.length) % steps.length;
        return this._jumpAt(session, pb.idx);
    }

    // ---------------------------------------------------------------------
    // Capture toggles (global author preferences)
    // ---------------------------------------------------------------------

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

    // ---------------------------------------------------------------------
    // Serialization
    // ---------------------------------------------------------------------

    exportJSON(serialize = true): string | RecorderSnapshotStep[] {
        const steps = [...(this._activeRecording()?.steps ?? [])];
        return serialize ? JSON.stringify(steps) : steps;
    }

    importJSON(json: string | RecorderSnapshotStep[]): RecorderSnapshotStep[] {
        this._importStepsIntoActive(json);
        return this.getSteps();
    }

    updateStep(id: string, mutate: (step: RecorderSnapshotStep) => void): RecorderSnapshotStep | undefined {
        const found = this._findStep(id);
        if (!found) return undefined;
        const { viewerId, recording, index, step } = found;
        const before = JSON.parse(JSON.stringify(step));

        const apply = (target: RecorderSnapshotStep) => {
            mutate(target);
            this.raiseEvent("update", { viewerId, recordingId: recording.id, index, step: target });
            if (!this._suppressDispatch) this.stepResource?.update({ viewerId, recordingId: recording.id, step: target });
        };

        APPLICATION_CONTEXT.history.push(
            () => APPLICATION_CONTEXT.history.withoutRecording(() => apply(step)),
            () => APPLICATION_CONTEXT.history.withoutRecording(() => {
                Object.keys(step).forEach(k => delete (step as any)[k]);
                Object.assign(step, before);
                this.raiseEvent("update", { viewerId, recordingId: recording.id, index, step });
                if (!this._suppressDispatch) this.stepResource?.update({ viewerId, recordingId: recording.id, step });
            }),
            { name: "Recorder: update step", type: "recorder.updateStep" } as any,
        );
        return step;
    }

    getAsset(id: string): RecorderAsset | undefined {
        return this._findAssetCollection(id)?.assets.get(id);
    }

    putAsset(asset: RecorderAsset): RecorderAsset {
        if (!asset?.id) throw new Error("RecorderAsset.id required");
        // Update in place if it already lives somewhere; else attach to the
        // active viewer's collection (the timeline being edited).
        const col = this._findAssetCollection(asset.id) || this._collection();
        if (!col) throw new Error("RecorderAsset: no viewer collection available");
        col.assets.set(asset.id, asset);
        if (!this._suppressDispatch) this.assetResource?.create({ viewerId: col.viewerId, asset });
        return asset;
    }

    deleteAsset(id: string): boolean {
        const col = this._findAssetCollection(id);
        if (!col) return false;
        const existed = col.assets.delete(id);
        if (!existed) return false;
        // Detach overlays still pointing at this asset so the timeline never
        // renders broken refs. Scans every recording of the owning viewer.
        for (const recording of col.recordings) {
            for (const step of recording.steps) {
                if (!step.overlays?.length) continue;
                const before = step.overlays.map(o => JSON.stringify(o)).join("|");
                step.overlays = step.overlays
                    .map(o => {
                        if (o.kind === "composite" && (o as RecorderCompositeOverlay).imageAssetId === id) {
                            // Detach the image but keep the overlay if it still has text.
                            const next: RecorderCompositeOverlay = { ...(o as RecorderCompositeOverlay), imageAssetId: undefined, imageAlt: undefined };
                            return next.markdown ? next : null;
                        }
                        return o;
                    })
                    .filter((o): o is RecorderOverlay => !!o)
                    .filter(o => o.kind === "text" || o.kind === "composite"
                        || (o as RecorderImageOverlay | RecorderAudioOverlay).assetId !== id);
                const after = step.overlays.map(o => JSON.stringify(o)).join("|");
                if (after !== before && !this._suppressDispatch) this.stepResource?.update({ viewerId: col.viewerId, recordingId: recording.id, step });
            }
        }
        if (!this._suppressDispatch) this.assetResource?.delete(`${col.viewerId}:${id}`);
        return true;
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

    sortWithIdList(ids: string[], removeMissing = false, viewerId?: UniqueViewerId): void {
        const recording = this._activeRecording(viewerId);
        if (!recording) return;
        if (removeMissing) {
            recording.steps = recording.steps.filter((step) => ids.includes(step.id));
        }

        recording.steps.sort((left, right) => {
            const leftIndex = ids.indexOf(left.id);
            const rightIndex = ids.indexOf(right.id);
            if (leftIndex < 0) return 1;
            if (rightIndex < 0) return -1;
            return leftIndex - rightIndex;
        });
    }

    // ---------------------------------------------------------------------
    // Bundle import (v3 + v2/legacy migration)
    // ---------------------------------------------------------------------

    /** Replace one viewer's collection from a v3 bundle (or migrate v2/bare). */
    private _importViewerBundle(viewerId: UniqueViewerId, data: unknown): void {
        const parsed = typeof data === "string" ? JSON.parse(data as string) : data;
        this._suppressDispatch = true;
        try {
            const col = this._rawCollection(viewerId);
            if (!col) return;
            this._stopCollection(col);

            if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).recordings)) {
                // v3
                col.recordings = (parsed as any).recordings
                    .map((r: any) => this._hydrateRecording(r))
                    .filter((r: RecorderRecording | undefined): r is RecorderRecording => !!r);
                col.activeRecordingId = (parsed as any).activeRecordingId ?? col.recordings[0]?.id ?? null;
                col.assets = this._hydrateAssets((parsed as any).assets);
            } else {
                // v2 / bare steps array → group this viewer's steps into one recording.
                const { steps, assets } = this._extractV2(parsed);
                const viewer = this._resolveViewer(viewerId);
                const ctx = getViewerContextMeta(viewer);
                const mine = steps.filter(s => this._stepBelongsToViewer(s, viewerId, ctx.key));
                col.recordings = [{
                    id: this._newId("rec-"),
                    name: "Recording 1",
                    backgroundId: viewer ? (UTILITIES as any).currentBackgroundIdFor?.(viewer) : undefined,
                    viewerContextKey: ctx.key,
                    viewerTitle: ctx.title,
                    createdAt: Date.now(),
                    steps: this._hydrateSteps(mine, viewerId),
                }];
                col.activeRecordingId = col.recordings[0].id;
                col.assets = this._hydrateAssets(assets);
            }
            if (!col.recordings.length) this._appendDefaultRecording(col);
            col.playback.idx = 0;
            this.raiseEvent("recording-active", { viewerId: col.viewerId, recordingId: col.activeRecordingId });
        } finally {
            this._suppressDispatch = false;
        }
    }

    /**
     * User-import path for legacy global bundles (no viewer scope): distribute
     * v2 steps across the currently open viewers, one recording each.
     */
    private _importLegacyGlobalBundle(data: unknown): void {
        const parsed = typeof data === "string" ? JSON.parse(data as string) : data;
        if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).recordings)) {
            // A v3 bundle arriving without scope — best effort: route to the
            // active viewer.
            const viewer = this._resolveViewer();
            if (viewer?.uniqueId) this._importViewerBundle(viewer.uniqueId, parsed);
            return;
        }

        const { steps, assets } = this._extractV2(parsed);
        const viewers = ((VIEWER_MANAGER.viewers || []) as RecorderManagedViewer[]).filter(Boolean);
        if (!viewers.length) return;

        this._suppressDispatch = true;
        try {
            const fallbackId = viewers[0].uniqueId as UniqueViewerId;
            // Group steps by the viewer each one resolves to (else the first).
            const byViewer = new Map<UniqueViewerId, RecorderSnapshotStep[]>();
            for (const step of steps) {
                let targetId = fallbackId;
                for (const viewer of viewers) {
                    const ctx = getViewerContextMeta(viewer);
                    if (this._stepBelongsToViewer(step, viewer.uniqueId, ctx.key)) { targetId = viewer.uniqueId as UniqueViewerId; break; }
                }
                const list = byViewer.get(targetId) || [];
                list.push(step);
                byViewer.set(targetId, list);
            }

            const hydratedAssets = this._hydrateAssets(assets);
            for (const viewer of viewers) {
                const id = viewer.uniqueId as UniqueViewerId;
                const col = this._rawCollection(id);
                if (!col) continue;
                this._stopCollection(col);
                const ctx = getViewerContextMeta(viewer);
                col.recordings = [{
                    id: this._newId("rec-"),
                    name: "Recording 1",
                    backgroundId: (UTILITIES as any).currentBackgroundIdFor?.(viewer),
                    viewerContextKey: ctx.key,
                    viewerTitle: ctx.title,
                    createdAt: Date.now(),
                    steps: this._hydrateSteps(byViewer.get(id) || [], id),
                }];
                col.activeRecordingId = col.recordings[0].id;
                // v2 assets were global; share them across every collection
                // (overlays reference by id; in-memory dup is harmless).
                col.assets = new Map(hydratedAssets);
                col.playback.idx = 0;
                this.raiseEvent("recording-active", { viewerId: id, recordingId: col.activeRecordingId });
            }
        } finally {
            this._suppressDispatch = false;
        }
    }

    private _stepBelongsToViewer(step: RecorderSnapshotStep, viewerId?: UniqueViewerId, viewerContextKey?: string): boolean {
        return (!!viewerContextKey && step.viewerContextKey === viewerContextKey)
            || (!!viewerId && step.viewerId === viewerId);
    }

    private _extractV2(parsed: any): { steps: RecorderSnapshotStep[]; assets: RecorderAsset[] } {
        if (Array.isArray(parsed)) {
            return { steps: parsed, assets: [] };
        }
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.steps)) {
            return { steps: parsed.steps, assets: Array.isArray(parsed.assets) ? parsed.assets : [] };
        }
        throw new Error("recorder bundle: expected v3 object, v2 object, or steps array");
    }

    private _hydrateAssets(assets: unknown): Map<string, RecorderAsset> {
        const map = new Map<string, RecorderAsset>();
        if (Array.isArray(assets)) {
            for (const asset of assets) {
                if (asset?.id && typeof asset.data === "string") map.set(asset.id, { ...asset });
            }
        }
        return map;
    }

    private _hydrateRecording(raw: any): RecorderRecording | undefined {
        if (!raw || typeof raw !== "object") return undefined;
        return {
            id: typeof raw.id === "string" && raw.id ? raw.id : this._newId("rec-"),
            name: typeof raw.name === "string" && raw.name ? raw.name : "Recording",
            backgroundId: typeof raw.backgroundId === "string" ? raw.backgroundId : undefined,
            viewerContextKey: typeof raw.viewerContextKey === "string" ? raw.viewerContextKey : undefined,
            viewerTitle: typeof raw.viewerTitle === "string" ? raw.viewerTitle : undefined,
            createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
            updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : undefined,
            steps: this._hydrateSteps(Array.isArray(raw.steps) ? raw.steps : []),
        };
    }

    private _hydrateSteps(rawSteps: any[], stampViewerId?: UniqueViewerId): RecorderSnapshotStep[] {
        const out: RecorderSnapshotStep[] = [];
        for (const item of rawSteps) {
            const step = this._hydrateStep(item, stampViewerId);
            if (step) out.push(step);
        }
        return out;
    }

    private _hydrateStep(item: any, stampViewerId?: UniqueViewerId): RecorderSnapshotStep | undefined {
        if (!item) return undefined;
        return {
            ...item,
            id: typeof item.id === "string" && item.id ? item.id : this._newId(),
            viewerId: stampViewerId ?? item.viewerId,
            kind: item.kind || (item.navigation?.samples?.length ? "navigation" : "keyframe"),
            viewerContextKey: typeof item.viewerContextKey === "string" ? item.viewerContextKey : undefined,
            viewerTitle: typeof item.viewerTitle === "string" ? item.viewerTitle : undefined,
            rotation: typeof item.rotation === "number" ? item.rotation : undefined,
            point: item.point ? new OpenSeadragon.Point(item.point.x, item.point.y) : undefined,
            bounds: item.bounds
                ? new OpenSeadragon.Rect(item.bounds.x, item.bounds.y, item.bounds.width, item.bounds.height)
                : undefined,
            navigation: item.navigation?.samples?.length ? {
                samples: item.navigation.samples.map((sample: any) => ({
                    ...sample,
                    rotation: typeof sample.rotation === "number" ? sample.rotation : undefined,
                    point: sample.point ? new OpenSeadragon.Point(sample.point.x, sample.point.y) : undefined,
                    bounds: sample.bounds
                        ? new OpenSeadragon.Rect(sample.bounds.x, sample.bounds.y, sample.bounds.width, sample.bounds.height)
                        : undefined,
                })),
                visualizationSamples: Array.isArray(item.navigation.visualizationSamples)
                    ? item.navigation.visualizationSamples.map((sample: any) => ({
                        at: sample.at,
                        visualization: this._cloneVisualizationStateSnapshot(sample.visualization),
                    }))
                    : undefined,
            } : undefined,
            visualization: item.visualization
                ? this._cloneVisualizationStateSnapshot(item.visualization)
                : undefined,
            annotationFilters: Array.isArray(item.annotationFilters)
                ? item.annotationFilters.map((filter: any) => this._cloneAnnotationFilter(filter))
                : undefined,
            overlays: Array.isArray(item.overlays)
                ? item.overlays
                    .filter((o: any) => o && typeof o === "object" && o.id && o.kind)
                    .map((o: any) => this._cloneOverlay(o))
                : undefined,
        };
    }

    /** Replace the active recording's steps from a bare array (automation/tests). */
    private _importStepsIntoActive(json: string | RecorderSnapshotStep[], viewerId?: UniqueViewerId): void {
        this._suppressDispatch = true;
        try {
            const col = this._collection(viewerId);
            const recording = this._activeRecording(viewerId);
            if (!col || !recording) return;
            this._stopCollection(col);
            const parsed = typeof json === "string" ? JSON.parse(json) : json;
            recording.steps = Array.isArray(parsed) ? this._hydrateSteps(parsed, col.viewerId) : [];
            col.playback.idx = 0;
            this.raiseEvent("recording-active", { viewerId: col.viewerId, recordingId: col.activeRecordingId });
        } finally {
            this._suppressDispatch = false;
        }
    }

    private _cloneOverlay(o: RecorderOverlay): RecorderOverlay {
        const base = {
            id: String(o.id),
            placement: { anchor: o.placement?.anchor || "bc", padding: o.placement?.padding },
            style: o.style ? { ...o.style } : undefined,
            label: o.label,
        };
        if (o.kind === "composite") {
            const c = o as RecorderCompositeOverlay;
            return { ...base, kind: "composite", markdown: c.markdown, imageAssetId: c.imageAssetId, imageAlt: c.imageAlt };
        }
        if (o.kind === "text") return { ...base, kind: "text", markdown: String((o as RecorderTextOverlay).markdown ?? "") };
        if (o.kind === "image") return { ...base, kind: "image", assetId: String((o as RecorderImageOverlay).assetId), alt: (o as RecorderImageOverlay).alt };
        return { ...base, kind: "audio", assetId: String((o as RecorderAudioOverlay).assetId), origin: (o as RecorderAudioOverlay).origin, hidden: (o as RecorderAudioOverlay).hidden };
    }

    // ---------------------------------------------------------------------
    // Viewer resolution
    // ---------------------------------------------------------------------

    private _resolveViewer(viewerId?: UniqueViewerId): RecorderManagedViewer | undefined {
        return (
            VIEWER_MANAGER.getViewer(viewerId, false) ||
            VIEWER_MANAGER.get?.() ||
            VIEWER_MANAGER.viewers?.[0]
        ) as RecorderManagedViewer | undefined;
    }

    // ---------------------------------------------------------------------
    // Playback engine
    // ---------------------------------------------------------------------

    private playStep(session: RecorderPlaybackSession, index: number, jumps = false, fromIndex?: number): void {
        const steps = session.recording.steps;
        const pb = session.playback;
        pb.currentStep?.cancel();
        pb.currentPlayback?.cancel();
        pb.currentStep = null;
        pb.currentPlayback = null;

        while (steps.length > index && !steps[index]) {
            index += 1;
        }

        if (steps.length <= index) {
            pb.currentStep = null;
            this._stopCollection(session.collection);
            return;
        }

        const current = steps[index];
        if (!current) {
            this._stopCollection(session.collection);
            return;
        }

        const previousIndex = typeof fromIndex === "number" ? fromIndex : index - 1;

        const delayMs = jumps ? 0 : current.delay * 1000;
        pb.currentStep = this._setDelayed(delayMs, index);
        pb.currentStep.promise.then((atIndex) => {
            if (!pb.playing) return;

            this._jumpAt(session, atIndex, previousIndex >= 0 ? previousIndex : undefined);
            pb.idx = atIndex;

            const nextIndex = atIndex + 1;
            const durationMs = Math.max(0, current.duration * 1000);
            if (nextIndex >= steps.length) {
                pb.currentStep = this._setDelayed(durationMs, nextIndex);
                pb.currentStep.promise.then(() => this._stopCollection(session.collection)).catch(() => undefined);
                return;
            }

            pb.currentStep = this._setDelayed(durationMs, nextIndex);
            pb.currentStep.promise.then((resolvedNextIndex) => {
                if (!pb.playing) return;
                this.playStep(session, resolvedNextIndex, false, atIndex);
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
        // Per-slot viz is derived from each slot's bg entry's `visualizationIndex`.
        // Emitted as `activeVisualizationIndex` on the recorded snapshot for
        // back-compat with already-persisted recordings and existing replay code.
        const activeBgArr: number[] = Array.isArray(activeBackgroundIndex)
            ? activeBackgroundIndex
            : (Number.isInteger(activeBackgroundIndex) ? [activeBackgroundIndex] : []);
        const bgArr: any[] = Array.isArray(backgrounds) ? backgrounds : [];
        const activeVisualizationIndex = activeBgArr.map((bgIdx: any) => {
            const v = Number.isInteger(bgIdx) ? bgArr[bgIdx as number]?.visualizationIndex : undefined;
            return Number.isInteger(v) ? v as number : undefined;
        });
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
        steps: RecorderSnapshotStep[],
        atIndex?: number,
    ): RecorderVisualizationStateSnapshot | undefined {
        const current = this._getVisualizationSnapshot(viewer, this._snapshotsState.captureVisualization);
        if (!current) return undefined;
        const previous = this._getPreviousVisualizationSnapshot(steps, atIndex);
        return this._sameVisualizationSnapshot(current, previous) ? undefined : current;
    }

    private _getPreviousVisualizationSnapshot(
        steps: RecorderSnapshotStep[],
        atIndex?: number,
    ): RecorderVisualizationStateSnapshot | undefined {
        const resolvedIndex = typeof atIndex === "number"
            ? Math.max(0, Math.min(atIndex, steps.length))
            : steps.length;
        let lastSnapshot: RecorderVisualizationStateSnapshot | undefined;

        for (let index = 0; index < resolvedIndex; index += 1) {
            const step = steps[index];
            if (!step) continue;
            const effective = this._getEffectiveStepVisualization(step);
            if (effective) lastSnapshot = effective;
        }

        return lastSnapshot ? this._cloneVisualizationStateSnapshot(lastSnapshot) : undefined;
    }

    private _getEffectiveVisualizationAt(
        steps: RecorderSnapshotStep[],
        index: number,
    ): RecorderVisualizationStateSnapshot | undefined {
        const resolvedIndex = Math.max(0, Math.min(index, steps.length - 1));

        for (let at = resolvedIndex; at >= 0; at -= 1) {
            const step = steps[at];
            if (!step) continue;
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

    private _rememberPlaybackVisualization(session: RecorderPlaybackSession, step: RecorderSnapshotStep): void {
        const pb = session.playback;
        const key = step.viewerContextKey || step.viewerId || session.viewerId;
        if (!key || pb.playbackVisualizationSnapshots[key]) return;
        const snapshot = this._getVisualizationSnapshot(session.viewer, true);
        if (!snapshot) return;
        pb.playbackVisualizationSnapshots[key] = snapshot;
    }

    private _restorePlaybackVisualizations(col: RecorderViewerCollection): void {
        const snapshots = col.playback.playbackVisualizationSnapshots;
        const viewer = this._resolveViewer(col.viewerId);
        for (const key of Object.keys(snapshots)) {
            const snapshot = snapshots[key];
            if (viewer && snapshot) this._applyVisualizationSnapshot(viewer, snapshot, 0);
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

    private _captureChangedAnnotationFilters(steps: RecorderSnapshotStep[], atIndex?: number): RecorderAnnotationFilter[] | undefined {
        const current = this._getAnnotationFiltersSnapshot();
        const previous = this._getPreviousAnnotationFilters(steps, atIndex);
        return this._sameAnnotationFilters(current, previous) ? undefined : current;
    }

    private _getPreviousAnnotationFilters(steps: RecorderSnapshotStep[], atIndex?: number): RecorderAnnotationFilter[] {
        const resolvedIndex = typeof atIndex === "number"
            ? Math.max(0, Math.min(atIndex, steps.length))
            : steps.length;

        for (let index = resolvedIndex - 1; index >= 0; index -= 1) {
            const step = steps[index];
            if (!step || !step.annotationFilters) continue;
            return step.annotationFilters.map((filter) => this._cloneAnnotationFilter(filter));
        }
        return [];
    }

    private _getEffectiveAnnotationFiltersAt(steps: RecorderSnapshotStep[], index: number): RecorderAnnotationFilter[] {
        const resolvedIndex = Math.max(0, Math.min(index, steps.length - 1));
        for (let at = resolvedIndex; at >= 0; at -= 1) {
            const step = steps[at];
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

    private _jumpAt(session: RecorderPlaybackSession, index: number, fromIndex?: number): RecorderSnapshotStep | undefined {
        const steps = session.recording.steps;
        const pb = session.playback;
        const step = steps[index];
        if (!step || steps.length <= index) return undefined;

        const viewer = session.viewer;
        if (!viewer) return undefined;

        // Empty spacer = pure hold: change nothing, just advance the timeline
        // (playStep already applies this step's delay/duration around the jump).
        if (step.kind === "empty") {
            this.raiseEvent("enter", {
                viewerId: session.viewerId,
                recordingId: session.recording.id,
                index,
                prevIndex: typeof fromIndex === "number" && !Number.isNaN(fromIndex) ? fromIndex : undefined,
                prevStep: typeof fromIndex === "number" && !Number.isNaN(fromIndex) ? steps[fromIndex] : undefined,
                step,
            });
            return step;
        }

        const capturesNavigation = this.stepCapturesNavigation(step);
        const capturesViewport = this.stepCapturesViewport(step);
        const shouldApplyEffectiveState = !pb.playing || typeof fromIndex !== "number";
        const targetVisualization = shouldApplyEffectiveState
            ? this._getEffectiveVisualizationAt(steps, index)
            : (step.visualization ? this._cloneVisualizationStateSnapshot(step.visualization) : undefined);
        if (targetVisualization && pb.playing) {
            this._rememberPlaybackVisualization(session, step);
        }
        if (targetVisualization) {
            this._applyVisualizationSnapshot(viewer, targetVisualization, capturesViewport || capturesNavigation ? step.duration : 0);
        }

        if (capturesNavigation) {
            const immediate = !pb.playing;
            pb.currentPlayback = this._playNavigation(viewer, step, immediate);
        } else if (capturesViewport) {
            if (typeof step.rotation === "number" && !Number.isNaN(step.rotation)) {
                viewer.viewport.setRotation(step.rotation, true);
            }
            viewer.tools?.focus(step);
        } else {
            viewer.forceRedraw?.();
        }

        const effectiveAnnotationFilters = shouldApplyEffectiveState
            ? this._getEffectiveAnnotationFiltersAt(steps, index)
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
            viewerId: session.viewerId,
            recordingId: session.recording.id,
            index,
            prevIndex: typeof fromIndex === "number" && !Number.isNaN(fromIndex) ? fromIndex : undefined,
            prevStep: typeof fromIndex === "number" && !Number.isNaN(fromIndex) ? steps[fromIndex] : undefined,
            step,
        });
        return step;
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
        // Derive current per-slot viz from each slot bg's `visualizationIndex`.
        const _curBgArr: number[] = Array.isArray(currentBgSelection)
            ? currentBgSelection
            : (Number.isInteger(currentBgSelection) ? [currentBgSelection] : []);
        const currentVizSelection = _curBgArr.map((bgIdx: any) => {
            const v = Number.isInteger(bgIdx) ? currentBackgrounds[bgIdx as number]?.visualizationIndex : undefined;
            return Number.isInteger(v) ? v as number : undefined;
        });

        const safeBackgrounds = this._mergeRecordedBackgrounds(currentBackgrounds, target.backgrounds || []);
        const visualizations = cloneValue(target.visualizations?.length ? target.visualizations : currentVisualizations);
        const activeBgSelection = this._normalizeSelectionForReplay(target.activeBackgroundIndex, currentBgSelection);
        const activeSelection = this._normalizeSelectionForReplay(target.activeVisualizationIndex as any, currentVizSelection);
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

        // Serialize every recorder-driven reopen onto one queue. Concurrent
        // openViewerWith calls (e.g. multi-viewer stop restoring several viewers
        // at once) interleave the flex-drawer suspend/resume depth + shared
        // global-config mutations and crash runRebuild against a half-torn world.
        void this._enqueueViewerOpen(() => {
            // Re-check at dequeue time — a prior queued reopen may have already
            // brought this viewer to the target state.
            if (this._sameVisualizationSnapshot(this._getVisualizationSnapshot(viewer, true), targetState)) {
                viewer.forceRedraw?.();
                return Promise.resolve();
            }
            return APPLICATION_CONTEXT.openViewerWith(
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
            ).then(() => viewer.forceRedraw?.());
        });
    }

    /**
     * Serialize recorder-initiated viewer reopens. Running them one-at-a-time
     * keeps each fully bracketed by the open pipeline's suspend/resume
     * transaction (and avoids racing on shared global config), preventing the
     * flex-drawer `runRebuild` crash on a half-torn-down world.
     */
    private _enqueueViewerOpen(fn: () => Promise<unknown> | undefined): Promise<unknown> {
        const next = this._viewerOpenQueue
            .then(() => fn())
            .catch((e) => console.warn("[recorder] viewer reopen failed:", e));
        this._viewerOpenQueue = next;
        return next;
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
    ): VisualizationShaderGroupOrLayer[] | undefined {
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
