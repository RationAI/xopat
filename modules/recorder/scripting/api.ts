/// <reference path="../../../src/types/globals.d.ts" />

/**
 * Recorder scripting namespace (`recorder`).
 *
 * A thin adapter over the `recorder` module for the host scripting layer and
 * the LLM chat integrations. It exposes the recorder as a guided-tour authoring
 * and playback surface: recordings (per viewer, slide-bound), steps (keyframes
 * captured from the current viewport, holds, narration overlays) and playback.
 *
 * Two rules shape this adapter:
 *  - **Never hand raw module records to a script.** Steps carry screenshots,
 *    navigation sample tracks and visualization snapshots; a recording carries
 *    every step. Everything returned here is a compact summary and binaries are
 *    always stripped.
 *  - **The active viewer is the target.** The module's API is viewer-keyed, but
 *    a raw `viewerId` param would leak viewer identity past the anonymization
 *    layer, so the viewer comes from the script context
 *    (`application.setActiveViewer`). The multi-viewer fan-out is offered as the
 *    explicit `playAll` / `stopAll` pair.
 *
 * Consent is requested for destructive actions only (deleting a recording, a
 * step or an asset, and exporting to a file); authoring and playback run free.
 */

const RECORDER_DTS = `
/** A recording of one viewer, summarized for scripts (steps are not included). */
export type RecordingInfo = {
    id: string;
    name: string;
    stepCount: number;
    /** True when this is the viewer's active recording (the one being edited/played). */
    active: boolean;
    /**
     * Host-injected (e.g. a questionnaire page). Read-only: writes are refused
     * because they would never persist.
     */
    transient: boolean;
    createdAtIso: string;
    updatedAtIso?: string;
};

export type OverlayInfo = {
    id: string;
    kind: "composite" | "text" | "image" | "audio";
    /** Where the overlay sits in the viewer. See NarrationPlacement. */
    placement: NarrationPlacement;
    /** Narration text of a text/composite overlay. */
    markdown?: string;
    /** Set when the overlay renders an image asset. */
    imageAssetId?: string;
    /** Set when the overlay plays an audio asset (voiceover). */
    audioAssetId?: string;
};

/** One timeline step, summarized. Screenshots and sample tracks are stripped. */
export type StepInfo = {
    id: string;
    index: number;
    /** "keyframe" = captured viewport, "empty" = timing-only hold, "navigation" = recorded path. */
    kind: "keyframe" | "empty" | "navigation";
    /** Seconds to wait before the step runs. */
    delay: number;
    /** Seconds the step stays on screen, moving included. */
    duration: number;
    /** Seconds of eased movement into the step; the rest of \`duration\` is a still hold. */
    move: number;
    capturesViewport: boolean;
    capturesVisualization: boolean;
    capturesNavigation: boolean;
    hasScreenshot: boolean;
    /** Viewport center in image coordinates (keyframe/navigation steps only). */
    center?: { x: number; y: number };
    zoomLevel?: number;
    overlays: OverlayInfo[];
};

export type StepTiming = {
    /** Seconds to wait before the step runs. */
    delay?: number;
    /**
     * Seconds the step stays on screen before playback moves on, movement
     * included. It must cover the time the viewer needs to read the step's
     * narration and look at the region — setStepNarration raises it for you, so
     * pass this only to slow a step down further.
     */
    duration?: number;
    /**
     * Seconds of eased (accelerate, then settle) movement from the previous
     * step's view into this one; the remainder of \`duration\` is a still hold.
     * Defaults to min(duration, 1.8 s). Raise it for a long sweep across the
     * slide, lower it for a cut. Recorded-path steps ignore it — they replay
     * the captured path at its own pace, because there the path IS the point.
     */
    move?: number;
};

/**
 * Where a narration card sits. Pick by intent, not by taste:
 *  - "bottom" (default) / "top" — a band across the viewer. Informative
 *    narration about tissue the viewer can still see: put the band on the side
 *    OPPOSITE the region you are talking about (region in the lower half of the
 *    view -> "top").
 *  - "center" — covers the middle of the view. Only when the text REPLACES the
 *    slide for a moment: a chapter intro, a summary, a closing note.
 *  - "left" / "right" — a narrow side column. These edges usually hold the
 *    application's own UI (toolbars, side menus), so use them only when a band
 *    would cover the very structure you are describing.
 */
export type NarrationPlacement = "bottom" | "top" | "center" | "left" | "right";

export type AssetInfo = {
    id: string;
    kind: "image" | "audio";
    mimeType: string;
    /** Size of the binary in bytes. */
    size: number;
    createdAtIso: string;
};

export type PlaybackState = {
    playing: boolean;
    /** Index of the step the timeline sits at (0-based). */
    index: number;
    stepCount: number;
    /** Recording being played, or the active one when stopped. */
    recordingId: string | null;
};

export type CaptureSettings = {
    /** Capture the shader/visualization state into new steps. */
    visualization: boolean;
    /** Capture the viewport (zoom/center/rotation) into new steps. Usually true. */
    viewport: boolean;
    /** Capture a screenshot thumbnail into new steps. */
    screen: boolean;
};

/**
 * Every method returns a promise — await it. Awaiting a write also guarantees
 * the change has been applied, so the id it returns is immediately usable by
 * the next call in the same script.
 */
export interface RecorderScriptApi {
    // ---- recordings ----

    /**
     * List the active viewer's recordings. Does not create anything — an empty
     * array means the viewer has no recording yet, so create one first.
     */
    listRecordings(): RecordingInfo[];

    /** The active viewer's active recording (the one captures and playback apply to), or null. */
    getActiveRecording(): RecordingInfo | null;

    /**
     * Create an empty recording on the active viewer and make it active. It is
     * bound to the slide currently open there; playback restores that slide.
     *
     * The recording covers that viewer only. Calling application.setActiveViewer
     * afterwards switches to the other viewer's recordings, and captures made
     * there belong to ITS recording — so a tour across several slides is one
     * createRecording per viewer, not one recording visiting each slide.
     * @param name optional name shown in the recorder UI.
     */
    createRecording(name?: string): RecordingInfo;

    /** Make an existing recording the active one (stops playback first). */
    setActiveRecording(recordingId: string): RecordingInfo;

    renameRecording(recordingId: string, name: string): RecordingInfo;

    /** Deep-copy a recording (new ids) and make the copy active. */
    duplicateRecording(recordingId: string): RecordingInfo;

    /** Delete a recording. Asks the user for permission. */
    deleteRecording(recordingId: string): Promise<void>;

    /**
     * Download a recording as a JSON file. Asks the user for permission (the
     * data leaves the app). Defaults to the active recording.
     */
    exportRecording(recordingId?: string): Promise<void>;

    /**
     * Add recordings from previously exported data (a JSON string, or the same
     * payload already parsed) to the active viewer — what exportRecording
     * downloads. Asks the user for permission. Existing recordings are kept —
     * an imported recording whose id is already taken is given a fresh one, so
     * nothing is ever overwritten — and the last imported recording becomes
     * active unless \`activate: false\`. The
     * recording plays on whatever slide the active viewer has open. Returns the
     * imported recordings. Throws if the data is not a usable recorder payload.
     */
    importRecording(data: string | object, opts?: { activate?: boolean }): Promise<RecordingInfo[]>;

    // ---- steps ----

    /**
     * Capture the active viewer's CURRENT view as a new keyframe step appended
     * to the active recording. Navigate first (e.g.
     * \`viewer.frameImageRegion(bounds)\`) and wait for the move to settle, then
     * capture.
     *
     * Capturing without having moved is an ERROR and captures nothing: a step
     * only earns its place by showing something new. Use captureHold() to dwell
     * on the view you are already on. Also fails while the recording is playing.
     */
    captureFrame(timing?: StepTiming): StepInfo;

    /**
     * Append a timing-only hold (no captured state) — the view stays where the
     * previous step left it. Use it to pause on a view, e.g. to let a longer
     * narration be read.
     */
    captureHold(timing?: StepTiming): StepInfo;

    /** The active recording's steps, summarized (no screenshots, no sample tracks). */
    listSteps(): StepInfo[];

    /** One step of the active recording, by id or 0-based index. */
    getStep(idOrIndex: string | number): StepInfo | null;

    /** Delete a step from the active recording. Asks the user for permission. */
    removeStep(idOrIndex: string | number): Promise<void>;

    /**
     * Reorder the active recording's steps to match \`stepIds\` (ids not listed
     * keep their relative order at the end).
     */
    reorderSteps(stepIds: string[]): StepInfo[];

    /** Change a step's timing. Only the given fields change. */
    setStepTiming(stepId: string, timing: StepTiming): StepInfo;

    /**
     * Set (or clear) the step's narration card — markdown rendered over the
     * viewer while the step plays. Pass an empty string to remove it.
     *
     * Write it like a pathologist pointing at a screen, not like a narrator:
     * state what is visible here and why it matters, and stop. One or two short
     * sentences (~40 words, 400 characters max — longer is rejected). No chapter
     * titles, no scene-setting, no rhetorical questions, no build-up: the viewer
     * is looking at the tissue while reading, and every extra word is time spent
     * reading instead of looking.
     *
     * The step's \`duration\` is automatically raised to the time a viewer needs
     * to READ the text (playback moves on when the duration elapses, so a
     * default 0.5 s step would flip away mid-sentence). Check the returned
     * \`duration\`; only call setStepTiming afterwards if you deliberately want a
     * different pace — it overrides this and is not re-checked against the text.
     *
     * @param placement where the card sits; defaults to "bottom". Choose it
     *   against the step's content — see NarrationPlacement.
     */
    setStepNarration(stepId: string, markdown: string, placement?: NarrationPlacement): StepInfo;

    /** What new steps capture. */
    getCaptureSettings(): CaptureSettings;

    /** Change what new steps capture. Only the given fields change. */
    setCaptureSettings(settings: Partial<CaptureSettings>): CaptureSettings;

    // ---- assets ----

    /** Binary assets (images, voiceover) of the active viewer. Never returns the binary itself. */
    listAssets(): AssetInfo[];

    getAssetInfo(assetId: string): AssetInfo | null;

    /**
     * Attach an image to a step's narration card. \`dataUrl\` must be an image
     * data URL (\`data:image/png;base64,...\`) of at most 4 MB. The step's
     * duration is raised to at least 4 s so the image is actually seen.
     */
    attachImageToStep(stepId: string, dataUrl: string, alt?: string): AssetInfo;

    /** Delete an asset and detach the overlays using it. Asks the user for permission. */
    deleteAsset(assetId: string): Promise<void>;

    // ---- playback ----

    /** Play the active viewer's active recording (restores its slide first). */
    play(): PlaybackState;

    /** Play from a specific step index. */
    playFromIndex(index: number): PlaybackState;

    /** Play every viewer's active recording together (multi-viewer tour). */
    playAll(): PlaybackState[];

    /** Stop playback on the active viewer. */
    stop(): PlaybackState;

    /** Stop playback on every viewer. */
    stopAll(): void;

    /** Advance one step (while playing) or move the timeline cursor (while stopped). */
    next(): PlaybackState;

    /** Go back one step (while playing) or move the timeline cursor (while stopped). */
    previous(): PlaybackState;

    /** Jump the viewer to a step. Only works while stopped; the view moves there. */
    goToIndex(index: number): PlaybackState;

    getPlaybackState(): PlaybackState;
}
`;

const MODULE_ID = "recorder";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Seconds added on top of the raw reading time to find the text and start reading. */
const READING_LEAD_IN_SECONDS = 0.8;
/** Mirrors Recorder.DEFAULT_MOVE_SECONDS — the eased move preceding the hold. */
const DEFAULT_MOVE_SECONDS = 1.8;
/**
 * Spring stiffness stored on captured steps. Playback eases moves itself, so
 * this only shapes out-of-playback jumps (timeline scrubbing); use what the
 * recorder plugin captures with rather than the module's near-linear default.
 */
const LEGACY_SPRING_STIFFNESS = 6.5;
/** Minimum seconds a step carrying an image overlay stays on screen. */
const IMAGE_VIEWING_SECONDS = 4;
/**
 * Hard cap on one step's narration. A caption is read while looking at tissue,
 * so anything longer is a step that should have been two — the cap is what
 * keeps a model from narrating a chapter over a single view.
 */
const MAX_NARRATION_CHARS = 400;
/** Nine-cell anchor each region degrades to for renderers without region support. */
const REGION_ANCHOR_FALLBACK: Record<string, string> = {
    bottom: "bc",
    top: "tc",
    center: "mc",
    left: "ml",
    right: "mr",
};

type AnyRecord = Record<string, any>;

/**
 * Build and register the `recorder` scripting namespace. Called once from
 * index.ts at bundle-eval time; the module itself is resolved lazily per call.
 */
export function registerRecorderScriptingApi(): void {
    const ScriptingManager = (globalThis as any).ScriptingManager;
    if (!ScriptingManager?.registerExternalApi || !ScriptingManager?.XOpatScriptingApi) {
        console.warn("[recorder] ScriptingManager unavailable; scripting namespace not registered.");
        return;
    }

    const ScriptApiBase = ScriptingManager.XOpatScriptingApi as {
        new (namespace: string, name: string, description: string): any;
    };

    class XOpatRecorderScriptApi extends ScriptApiBase {
        static ScriptApiMetadata = {
            dtypesSource: { kind: "text", value: RECORDER_DTS },
        };

        constructor(namespace: string) {
            super(
                namespace,
                "Recorder",
                "Author and play guided tours of a slide with the recorder. A recording belongs to ONE viewer " +
                "and to the slide open there; select the viewer with application.setActiveViewer before calling. " +
                "Every call acts on the ACTIVE viewer's own recordings, so application.setActiveViewer switches " +
                "which recording you are editing: to cover several slides, call createRecording(name) again on " +
                "each viewer and build that viewer's steps before moving on — one recording per viewer, never one " +
                "recording spanning slides. " +
                "To build a tour: createRecording(name), then for each stop navigate the view (e.g. " +
                "viewer.frameImageRegion(bounds), pathology.exploreSlide gives you regions to visit), call " +
                "captureFrame() to record that view as a step, and setStepNarration(stepId, markdown) to caption " +
                "it; finish with play(). Captions are clinical notes, NOT storytelling: one or two short sentences " +
                "(400 characters max) saying what is visible here and why it matters — no chapter titles, no " +
                "scene-setting, no rhetorical questions. Playback is on a timer — each step disappears once its " +
                "duration elapses — so ALWAYS caption with setStepNarration (it stretches the step to the time " +
                "needed to read the text) instead of leaving the short default duration. Place the caption with " +
                "its third argument: \"bottom\"/\"top\" band opposite the region you discuss, \"center\" only when " +
                "the text replaces the slide, \"left\"/\"right\" rarely (the app's own UI lives there). " +
                "captureHold() inserts a pause. listRecordings/listSteps return compact " +
                "summaries (screenshots and sample tracks are never included). Playback: play, stop, next, " +
                "previous, goToIndex, playFromIndex, and playAll/stopAll for all viewers at once. Deleting a " +
                "recording, a step or an asset asks the user for permission.",
            );
        }

        // ---- internals (underscore-prefixed members are not exposed to scripts) ----

        /**
         * The recording this script last targeted on purpose — via createRecording or
         * setActiveRecording — and the viewer it lives on.
         *
         * Every write resolves its recording from the AMBIENT active viewer, so an
         * application.setActiveViewer between two recorder calls silently redirects the
         * rest of the tour into whatever recording that other viewer happens to have
         * (usually an auto-created default). The steps land somewhere real, so nothing
         * throws until a later call addresses a step that only exists in the recording
         * the author meant — reported as a baffling "no step 'N' in 'Recording 1'",
         * naming a recording the script never created. Remembering the intended target
         * lets the write itself say what actually happened.
         *
         * It lives on the scripting context, not on `this`: bindInvocationContext hands
         * every CALL its own shallow copy of this api object, so an instance field would
         * be written to a throwaway and never read back. The context is per script run,
         * which is also the right lifetime — a later script starts with no target and is
         * free to write wherever its own active viewer points.
         */
        _targetRecording(): { id: string; name: string; viewerId: string } | null {
            return (this.scriptingContext as AnyRecord).__recorderTargetRecording ?? null;
        }

        _rememberTargetRecording(recording: AnyRecord, viewerId: string): void {
            (this.scriptingContext as AnyRecord).__recorderTargetRecording = {
                id: recording.id, name: recording.name, viewerId,
            };
        }

        _recorder(): any {
            const instance = (globalThis as any).singletonModule?.(MODULE_ID)
                ?? (globalThis as any).OpenSeadragon?.Recorder?.instance?.();
            if (!instance) {
                throw new Error("The recorder module is not available. Enable it first.");
            }
            return instance;
        }

        /** Unique id of the viewer bound to this script context. Throws when none is selected. */
        _vid(): string {
            const id = this.activeViewer?.uniqueId;
            if (!id) {
                throw new Error("The active viewer has no identity; it cannot hold recordings.");
            }
            return id;
        }

        /**
         * Wait for the recorder's pending history entries to commit.
         *
         * The module mutates through `APPLICATION_CONTEXT.history.push`, which
         * queues the forward function onto a promise chain instead of running it
         * inline — so `create()` returns a step that is not in `recording.steps`
         * yet. Every read-back in this adapter is therefore racing its own
         * write; awaiting the history queue is what makes a script's
         * write-then-read see its own effect within one script block.
         */
        async _settle(): Promise<void> {
            const history = (globalThis as any).APPLICATION_CONTEXT?.history;
            // Degrade to the previous (racy) behaviour rather than throwing on a
            // host that predates whenIdle().
            if (typeof history?.whenIdle === "function") await history.whenIdle();
        }

        async _consent(title: string, details: string[], cacheKey?: string): Promise<void> {
            await this.requireActionConsent({
                title,
                description: "A script wants to change the recorder's saved data.",
                details,
                mode: "warning",
                confirmLabel: "Apply",
                rejectedMessage: "The recorder change was canceled by the user.",
                cacheKey,
            });
        }

        _isoOf(value: unknown): string | undefined {
            return typeof value === "number" && Number.isFinite(value)
                ? new Date(value).toISOString() : undefined;
        }

        _recordingInfo(recording: AnyRecord, activeId: string | null): AnyRecord {
            return {
                id: recording.id,
                name: recording.name,
                stepCount: recording.steps?.length ?? 0,
                active: recording.id === activeId,
                transient: !!recording.transient,
                createdAtIso: this._isoOf(recording.createdAt),
                updatedAtIso: this._isoOf(recording.updatedAt),
            };
        }

        _overlayInfo(overlay: AnyRecord): AnyRecord {
            const anchor = overlay.placement?.anchor;
            return {
                id: overlay.id,
                kind: overlay.kind,
                placement: overlay.placement?.region
                    ?? Object.keys(REGION_ANCHOR_FALLBACK).find(key => REGION_ANCHOR_FALLBACK[key] === anchor)
                    ?? "bottom",
                markdown: overlay.markdown,
                imageAssetId: overlay.kind === "composite" ? overlay.imageAssetId
                    : (overlay.kind === "image" ? overlay.assetId : undefined),
                audioAssetId: overlay.kind === "audio" ? overlay.assetId : undefined,
            };
        }

        /** Compact, binary-free view of a step. The raw step must never reach a script. */
        _stepInfo(step: AnyRecord, index: number): AnyRecord {
            const recorder = this._recorder();
            return {
                id: step.id,
                index,
                kind: step.kind ?? "keyframe",
                delay: step.delay,
                duration: step.duration,
                move: this._moveSeconds(step),
                capturesViewport: recorder.stepCapturesViewport(step),
                capturesVisualization: recorder.stepCapturesVisualization(step),
                capturesNavigation: recorder.stepCapturesNavigation(step),
                hasScreenshot: !!step.screenShot,
                center: step.point ? { x: step.point.x, y: step.point.y } : undefined,
                zoomLevel: typeof step.zoomLevel === "number" ? step.zoomLevel : undefined,
                overlays: (step.overlays ?? []).map((o: AnyRecord) => this._overlayInfo(o)),
            };
        }

        _assetInfo(asset: AnyRecord): AnyRecord {
            return {
                id: asset.id,
                kind: asset.kind,
                mimeType: asset.mimeType,
                size: asset.size,
                createdAtIso: this._isoOf(asset.createdAt),
            };
        }

        /** The active recording, or a thrown explanation of how to get one. */
        _requireActiveRecording(): AnyRecord {
            const recording = this._recorder().getActiveRecording(this._vid());
            if (!recording) {
                throw new Error("This viewer has no recording yet. Call recorder.createRecording(name) first.");
            }
            return recording;
        }

        /** Locate a recording of the active viewer, refusing host-injected ones on write paths. */
        _requireRecording(recordingId: string, forWrite = false): AnyRecord {
            const recording = this._recorder().listRecordings(this._vid())
                .find((r: AnyRecord) => r.id === recordingId);
            if (!recording) {
                throw new Error(`No recording '${recordingId}' on this viewer. Call recorder.listRecordings() to see them.`);
            }
            if (forWrite && recording.transient) {
                throw new Error(`Recording '${recording.name}' is provided by the application and cannot be edited.`);
            }
            return recording;
        }

        _requireEditableActiveRecording(): AnyRecord {
            this._assertTargetRecordingStillActive();
            const recording = this._requireActiveRecording();
            if (recording.transient) {
                throw new Error(`The active recording '${recording.name}' is provided by the application and cannot be edited. Create your own with recorder.createRecording(name).`);
            }
            return recording;
        }

        /**
         * Refuse a write that would land somewhere other than the recording this script
         * set out to build — on either axis it can drift:
         *  - the ACTIVE VIEWER moved (a recording belongs to one viewer, so a multi-slide
         *    tour needs one recording per viewer — a fine thing to want, and the error
         *    says how to get it);
         *  - the viewer's ACTIVE RECORDING changed under the script (a UI click, another
         *    script, or a delete re-selecting a neighbour).
         * Both are refusals, never auto-corrections: the API does not repoint the user's
         * UI behind their back.
         */
        _assertTargetRecordingStillActive(): void {
            const target = this._targetRecording();
            if (!target) return;
            const viewerId = this._vid();
            if (target.viewerId !== viewerId) {
                throw new Error(
                    `Recording '${target.name}' belongs to viewer '${target.viewerId}', but the active viewer is now `
                    + `'${viewerId}' — writing here would go to a different recording. A recording covers ONE viewer and `
                    + `its slide: call recorder.createRecording(name) on this viewer to start its own recording (a tour `
                    + `across slides is one recording per viewer), or switch back with `
                    + `application.setActiveViewer('${target.viewerId}') to keep building '${target.name}'.`
                );
            }
            const active = this._recorder().getActiveRecording(viewerId);
            if (active && active.id !== target.id) {
                throw new Error(
                    `Recording '${target.name}' is no longer the active recording of viewer '${viewerId}' `
                    + `('${active.name}' is) — writing here would go to the wrong recording. Call `
                    + `recorder.setActiveRecording('${target.id}') to keep building '${target.name}', or `
                    + `recorder.createRecording(name) to start a new one.`
                );
            }
        }

        /** Resolve a step of the active recording by id or index. */
        _resolveStep(idOrIndex: string | number): { step: AnyRecord; index: number; recording: AnyRecord } {
            const recording = this._requireActiveRecording();
            const steps: AnyRecord[] = recording.steps ?? [];
            const index = typeof idOrIndex === "number"
                ? idOrIndex : steps.findIndex((s: AnyRecord) => s.id === idOrIndex);
            const step = steps[index];
            if (!step) {
                // Name the viewer and the step count: the usual cause is that this
                // recording is not the one the caller thinks it is.
                throw new Error(
                    `No step '${idOrIndex}' in recording '${recording.name}' (viewer '${this._vid()}', `
                    + `${steps.length} step(s)). Call recorder.listSteps() to see them.`
                );
            }
            return { step, index, recording };
        }

        async _capturedInfo(step: AnyRecord | false, action: string, expectKeyframe = false): Promise<AnyRecord> {
            if (!step) {
                const recorder = this._recorder();
                if (recorder.isPlaying(this._vid())) {
                    throw new Error(`Cannot ${action} while the recording is playing. Call recorder.stop() first.`);
                }
                throw new Error(`Failed to ${action}: the viewer has no recording to capture into.`);
            }
            await this._settle();
            const steps: AnyRecord[] = this._requireActiveRecording().steps ?? [];
            const index = steps.findIndex((s: AnyRecord) => s.id === step.id);
            if (index < 0) {
                // The module returned a step but the history queue never applied
                // it — history.push silently skips the forward function while
                // recording is suppressed. Reporting index -1 would hand the
                // caller an id that no later call can resolve.
                throw new Error(`Failed to ${action}: the step was not added to the recording (the viewer's history is currently suppressed).`);
            }
            if (expectKeyframe && step.kind === "empty") {
                // The pre-check should have caught this; if the module collapsed
                // anyway (viewport capture off, a change landing mid-call), say
                // so rather than passing a hold off as a captured view.
                throw new Error(
                    `Failed to ${action}: the recorder stored a hold instead of a view — the viewer's current view `
                    + "carries nothing new to capture. Check recorder.getCaptureSettings().viewport is true, and "
                    + "navigate before capturing."
                );
            }
            return this._stepInfo(step, index);
        }

        _playback(): AnyRecord {
            const recorder = this._recorder();
            const viewerId = this._vid();
            const active = recorder.getActiveRecording(viewerId);
            return {
                playing: recorder.isPlaying(viewerId),
                index: recorder.currentStepIndex(viewerId),
                stepCount: active?.steps?.length ?? 0,
                recordingId: active?.id ?? null,
            };
        }

        _seconds(value: unknown, fallback: number, name: string): number {
            if (value === undefined || value === null) return fallback;
            if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
                throw new Error(`Step ${name} must be a non-negative number of seconds.`);
            }
            return value;
        }

        /**
         * Args for the module's capture calls. The third one is the legacy
         * spring stiffness (only used when a step is applied outside playback);
         * pass what the recorder plugin captures with so scrubbing feels the
         * same. The eased move length is `moveDuration`, applied separately.
         */
        _timingArgs(timing?: AnyRecord): [number, number, number] {
            const move = this._seconds(timing?.move, 0, "move");
            return [
                this._seconds(timing?.delay, 0, "delay"),
                // A step must outlast its own movement, so an explicit long
                // move implies at least that much duration.
                this._seconds(timing?.duration, Math.max(0.5, move), "duration"),
                LEGACY_SPRING_STIFFNESS,
            ];
        }

        _newOverlayId(): string {
            return `ov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        }

        /**
         * Semantic placement -> overlay placement. The nine-cell anchor is kept
         * alongside the region as a fallback for renderers that predate regions.
         */
        _region(placement?: string): AnyRecord {
            const region = placement ?? "bottom";
            const anchor = REGION_ANCHOR_FALLBACK[region];
            if (!anchor) {
                throw new Error(`Unknown narration placement '${placement}'. Use one of: ${Object.keys(REGION_ANCHOR_FALLBACK).join(", ")}.`);
            }
            return { region, anchor };
        }

        /** Seconds the eased move into a step takes (module default when unset). */
        _moveSeconds(step: AnyRecord): number {
            return typeof step.moveDuration === "number"
                ? step.moveDuration
                : Math.min(step.duration ?? 0, DEFAULT_MOVE_SECONDS);
        }

        /**
         * Seconds a viewer needs to read `markdown` while also looking at the
         * slide: 160 wpm (below plain-prose speed — attention is split between
         * the text and the image) plus a beat to find the text. Clamped so a
         * short caption still holds and a wall of text does not freeze the tour.
         */
        _readingSeconds(markdown: string): number {
            const words = markdown
                .replace(/```[\s\S]*?```/g, " ")
                .replace(/[#*_>`~\[\]()|-]+/g, " ")
                .split(/\s+/)
                .filter(Boolean).length;
            if (!words) return 0;
            return Math.min(40, Math.max(3, words / (160 / 60) + READING_LEAD_IN_SECONDS));
        }

        // ---- recordings ----

        listRecordings(): AnyRecord[] {
            const viewerId = this._vid();
            const activeId = this._recorder().getActiveRecording(viewerId)?.id ?? null;
            return this._recorder().listRecordings(viewerId)
                .map((r: AnyRecord) => this._recordingInfo(r, activeId));
        }

        getActiveRecording(): AnyRecord | null {
            const recording = this._recorder().getActiveRecording(this._vid());
            return recording ? this._recordingInfo(recording, recording.id) : null;
        }

        async createRecording(name?: string): Promise<AnyRecord> {
            const viewerId = this._vid();
            const recording = this._recorder().createRecording(viewerId, name);
            await this._settle();
            this._rememberTargetRecording(recording, viewerId);
            return this._recordingInfo(recording, recording.id);
        }

        setActiveRecording(recordingId: string): AnyRecord {
            const viewerId = this._vid();
            this._requireRecording(recordingId);
            this._recorder().setActiveRecording(recordingId, viewerId);
            const recording = this._requireRecording(recordingId);
            this._rememberTargetRecording(recording, viewerId);
            return this._recordingInfo(recording, recordingId);
        }

        async renameRecording(recordingId: string, name: string): Promise<AnyRecord> {
            if (typeof name !== "string" || !name.trim()) {
                throw new Error("A recording name must be a non-empty string.");
            }
            this._requireRecording(recordingId, true);
            this._recorder().renameRecording(recordingId, name.trim(), this._vid());
            await this._settle();
            const activeId = this._recorder().getActiveRecording(this._vid())?.id ?? null;
            return this._recordingInfo(this._requireRecording(recordingId), activeId);
        }

        async duplicateRecording(recordingId: string): Promise<AnyRecord> {
            this._requireRecording(recordingId);
            const copy = this._recorder().duplicateRecording(recordingId, this._vid());
            if (!copy) throw new Error(`Failed to duplicate recording '${recordingId}'.`);
            await this._settle();
            return this._recordingInfo(copy, copy.id);
        }

        async deleteRecording(recordingId: string): Promise<void> {
            const recording = this._requireRecording(recordingId, true);
            await this._consent("Delete recording", [
                `Recording: ${recording.name}`,
                `Steps that will be lost: ${recording.steps?.length ?? 0}`,
            ]);
            this._recorder().deleteRecording(recordingId, this._vid());
            await this._settle();
        }

        async exportRecording(recordingId?: string): Promise<void> {
            const viewerId = this._vid();
            const recording = recordingId
                ? this._requireRecording(recordingId) : this._requireActiveRecording();
            await this._consent("Export recording to a file", [
                `Recording: ${recording.name}`,
                "The recording (including any captured screenshots) is downloaded as a JSON file.",
            ]);
            this._recorder().setActiveRecording(recording.id, viewerId);
            this._recorder().downloadActiveRecording(viewerId);
        }

        async importRecording(data: string | AnyRecord, opts?: { activate?: boolean }): Promise<AnyRecord[]> {
            const viewerId = this._vid();
            await this._consent("Import recordings", [
                "Recordings found in the supplied data are added to the current viewer.",
                "Existing recordings are kept.",
            ]);
            // The data is untrusted (a script may have built or fetched it):
            // the module's version gate and step hydration are the validation
            // boundary, and they leave the collection untouched on refusal.
            const imported = this._recorder().importRecordings(viewerId, data, opts);
            await this._settle();
            const activeId = this._recorder().getActiveRecording(viewerId)?.id ?? null;
            return imported.map((r: AnyRecord) => this._recordingInfo(r, activeId));
        }

        // ---- steps ----

        async captureFrame(timing?: AnyRecord): Promise<AnyRecord> {
            this._requireEditableActiveRecording();
            // The module would silently collapse an unchanged view into a hold.
            // For a script that asked to capture a specific view that is an
            // authoring mistake, not a feature: refuse before anything is added,
            // so there is no stray step and no undo entry to clean up.
            if (this._recorder().isCurrentViewRedundant(this._vid())) {
                throw new Error(
                    "The view has not changed since the previous step; nothing was captured. Navigate first "
                    + "(e.g. viewer.frameImageRegion(bounds)) and let the move settle, then capture — or call "
                    + "captureHold() if you meant to hold the current view for a while."
                );
            }
            const step = this._recorder().create(this._vid(), ...this._timingArgs(timing));
            const info = await this._capturedInfo(step, "capture the current view", true);
            return timing?.move === undefined ? info : await this.setStepTiming(info.id, { move: timing.move });
        }

        async captureHold(timing?: AnyRecord): Promise<AnyRecord> {
            this._requireEditableActiveRecording();
            const step = this._recorder().createEmpty(this._vid(), ...this._timingArgs(timing));
            return this._capturedInfo(step, "add a hold step");
        }

        listSteps(): AnyRecord[] {
            const recording = this._requireActiveRecording();
            return (recording.steps ?? []).map((s: AnyRecord, i: number) => this._stepInfo(s, i));
        }

        getStep(idOrIndex: string | number): AnyRecord | null {
            const { step, index } = this._resolveStep(idOrIndex);
            return this._stepInfo(step, index);
        }

        async removeStep(idOrIndex: string | number): Promise<void> {
            this._requireEditableActiveRecording();
            const { step, index } = this._resolveStep(idOrIndex);
            await this._consent("Delete a recording step", [
                `Step ${index + 1} (${step.kind ?? "keyframe"}) of the active recording.`,
            ], "recorder:removeStep");
            this._recorder().remove(index, this._vid());
            await this._settle();
        }

        async reorderSteps(stepIds: string[]): Promise<AnyRecord[]> {
            if (!Array.isArray(stepIds) || stepIds.some(id => typeof id !== "string")) {
                throw new Error("reorderSteps expects an array of step ids.");
            }
            this._requireEditableActiveRecording();
            this._recorder().sortWithIdList(stepIds, false, this._vid());
            await this._settle();
            return this.listSteps();
        }

        async setStepTiming(stepId: string, timing: AnyRecord): Promise<AnyRecord> {
            this._requireEditableActiveRecording();
            const { step } = this._resolveStep(stepId);
            const delay = this._seconds(timing?.delay, step.delay, "delay");
            const duration = this._seconds(timing?.duration, step.duration, "duration");
            const move = this._seconds(timing?.move, this._moveSeconds(step), "move");
            if (move > duration) {
                throw new Error(`The move (${move}s) cannot be longer than the step's duration (${duration}s) — the step would be cut off mid-movement.`);
            }
            this._recorder().updateStep(step.id, (target: AnyRecord) => {
                target.delay = delay;
                target.duration = duration;
                target.moveDuration = move;
            });
            await this._settle();
            const resolved = this._resolveStep(step.id);
            return this._stepInfo(resolved.step, resolved.index);
        }

        async setStepNarration(stepId: string, markdown: string, placement?: string): Promise<AnyRecord> {
            this._requireEditableActiveRecording();
            const { step } = this._resolveStep(stepId);
            if (typeof markdown !== "string") {
                throw new Error("setStepNarration expects markdown text (pass an empty string to remove it).");
            }
            const text = markdown.trim();
            if (text.length > MAX_NARRATION_CHARS) {
                throw new Error(
                    `The narration is ${text.length} characters; the limit is ${MAX_NARRATION_CHARS}. ` +
                    "Say what is visible here and why it matters in one or two sentences, or split it across steps.",
                );
            }
            const region = this._region(placement);
            const overlayId = this._newOverlayId();
            // A step whose duration is shorter than its narration flips away
            // mid-sentence. Hold it long enough to read once the view has
            // stopped moving, unless the author already asked for longer.
            const readingSeconds = this._readingSeconds(text);

            this._recorder().updateStep(step.id, (target: AnyRecord) => {
                const overlays: AnyRecord[] = target.overlays ?? [];
                const existing = overlays.find(o => o.kind === "composite" || o.kind === "text");
                // Pin the move too: leaving it implicit would let the longer
                // duration widen the default move and eat the reading time.
                const move = this._moveSeconds(target);
                const required = move + readingSeconds;
                if (required > (target.duration ?? 0)) {
                    target.duration = required;
                    target.moveDuration = move;
                }

                if (!text) {
                    // Drop the card, unless it still carries an image.
                    target.overlays = overlays.flatMap(o => {
                        if (o !== existing) return [o];
                        if (o.kind === "composite" && o.imageAssetId) return [{ ...o, markdown: undefined }];
                        return [];
                    });
                    return;
                }
                if (existing) {
                    existing.kind = "composite";
                    existing.markdown = text;
                    existing.placement = { ...(existing.placement ?? {}), ...region };
                    return;
                }
                target.overlays = [...overlays, {
                    id: overlayId,
                    kind: "composite",
                    markdown: text,
                    placement: { ...region },
                }];
            });
            await this._settle();
            const resolved = this._resolveStep(step.id);
            return this._stepInfo(resolved.step, resolved.index);
        }

        getCaptureSettings(): AnyRecord {
            const recorder = this._recorder();
            return {
                visualization: recorder.capturesVisualization,
                viewport: recorder.capturesViewport,
                screen: recorder.capturesScreen,
            };
        }

        setCaptureSettings(settings: AnyRecord): AnyRecord {
            const recorder = this._recorder();
            if (settings?.visualization !== undefined) recorder.setCapturesVisualization(!!settings.visualization);
            if (settings?.viewport !== undefined) recorder.setCapturesViewport(!!settings.viewport);
            if (settings?.screen !== undefined) recorder.setCapturesScreen(!!settings.screen);
            return this.getCaptureSettings();
        }

        // ---- assets ----

        listAssets(): AnyRecord[] {
            const recorder = this._recorder();
            const viewerId = this._vid();
            const ids = new Set<string>();
            for (const recording of recorder.listRecordings(viewerId)) {
                for (const step of recording.steps ?? []) {
                    for (const overlay of step.overlays ?? []) {
                        const id = overlay.kind === "composite" ? overlay.imageAssetId : overlay.assetId;
                        if (id) ids.add(id);
                    }
                }
            }
            return Array.from(ids)
                .map(id => recorder.getAsset(id))
                .filter((asset: AnyRecord | undefined) => !!asset)
                .map((asset: AnyRecord) => this._assetInfo(asset));
        }

        getAssetInfo(assetId: string): AnyRecord | null {
            const asset = this._recorder().getAsset(assetId);
            return asset ? this._assetInfo(asset) : null;
        }

        attachImageToStep(stepId: string, dataUrl: string, alt?: string): AnyRecord {
            this._requireEditableActiveRecording();
            const { step } = this._resolveStep(stepId);

            const match = typeof dataUrl === "string" && /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
            if (!match) {
                throw new Error("attachImageToStep expects a base64 image data URL, e.g. 'data:image/png;base64,...'.");
            }
            const [, mimeType, base64] = match;
            const size = Math.floor(base64.replace(/=+$/, "").length * 3 / 4);
            if (size > MAX_IMAGE_BYTES) {
                throw new Error(`The image is too large (${Math.round(size / 1024)} kB); the limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
            }

            const asset = this._recorder().putAsset({
                id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                kind: "image",
                mimeType,
                data: base64,
                size,
                createdAt: Date.now(),
            });

            const overlayId = this._newOverlayId();
            this._recorder().updateStep(step.id, (target: AnyRecord) => {
                const overlays: AnyRecord[] = target.overlays ?? [];
                const existing = overlays.find(o => o.kind === "composite");
                // An image nobody has time to look at is worse than no image.
                const move = this._moveSeconds(target);
                const required = move + IMAGE_VIEWING_SECONDS;
                if ((target.duration ?? 0) < required) {
                    target.duration = required;
                    target.moveDuration = move;
                }
                if (existing) {
                    existing.imageAssetId = asset.id;
                    existing.imageAlt = alt;
                    return;
                }
                target.overlays = [...overlays, {
                    id: overlayId,
                    kind: "composite",
                    imageAssetId: asset.id,
                    imageAlt: alt,
                    placement: { anchor: "bc" },
                }];
            });
            return this._assetInfo(asset);
        }

        async deleteAsset(assetId: string): Promise<void> {
            const asset = this._recorder().getAsset(assetId);
            if (!asset) throw new Error(`No asset '${assetId}'.`);
            await this._consent("Delete a recorder asset", [
                `Asset: ${asset.kind} (${asset.mimeType}).`,
                "Overlays using it will be detached.",
            ]);
            this._recorder().deleteAsset(assetId);
        }

        // ---- playback ----

        play(): AnyRecord {
            this._requireActiveRecording();
            this._recorder().play(this._vid());
            return this._playback();
        }

        playFromIndex(index: number): AnyRecord {
            this._resolveStep(index);
            this._recorder().playFromIndex(index, this._vid());
            return this._playback();
        }

        playAll(): AnyRecord[] {
            this._recorder().play();
            const recorder = this._recorder();
            return (VIEWER_MANAGER?.viewers ?? []).map((viewer: AnyRecord) => {
                const viewerId = viewer.uniqueId;
                const active = recorder.listRecordings(viewerId).length
                    ? recorder.getActiveRecording(viewerId) : undefined;
                return {
                    playing: recorder.isPlaying(viewerId),
                    index: recorder.currentStepIndex(viewerId),
                    stepCount: active?.steps?.length ?? 0,
                    recordingId: active?.id ?? null,
                };
            });
        }

        stop(): AnyRecord {
            this._recorder().stop(this._vid());
            return this._playback();
        }

        stopAll(): void {
            this._recorder().stop();
        }

        next(): AnyRecord {
            this._requireActiveRecording();
            this._recorder().next(this._vid());
            return this._playback();
        }

        previous(): AnyRecord {
            this._requireActiveRecording();
            this._recorder().previous(this._vid());
            return this._playback();
        }

        goToIndex(index: number): AnyRecord {
            this._resolveStep(index);
            if (this._recorder().isPlaying(this._vid())) {
                throw new Error("Cannot jump to a step while playing. Call recorder.stop() first.");
            }
            this._recorder().goToIndex(index, this._vid());
            return this._playback();
        }

        getPlaybackState(): AnyRecord {
            return this._playback();
        }
    }

    ScriptingManager.registerExternalApi(
        async (manager: any) => manager.ingestApi(new XOpatRecorderScriptApi("recorder")),
        { label: "recorder" },
    );
}
