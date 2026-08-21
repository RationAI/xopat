/// <reference path="../../src/types/globals.d.ts" />

/**
 * EMPAIA Workbench v3 client — module entry point.
 *
 * Turns xOpat into the vendor AppUI of an EMPAIA examination: it accepts the
 * scope / token / backend URL the Workbench Client pushes over `postMessage`,
 * opens the examination's slides, routes annotations to the workbench data API,
 * and drives app jobs.
 *
 * Everything user-facing lives in `plugins/empaia-app-ui`; this module is the
 * plumbing it talks to via `singletonModule('empaia-workbench')`.
 *
 * Communication with the Workbench Client goes through the official
 * `@empaia/vendor-app-communication-interface` (VACI) package.
 *
 * Boot order (each step needs the previous one):
 *   1. VACI listeners registered (constructor, so the readiness handshake goes
 *      out as early as possible);
 *   2. auth broker registered and the `empaia` context claimed;
 *   3. scope + wbsUrl arrive → HTTP client, scope record, EAD;
 *   4. slide protocol, annotation convertor and IO sinks registered;
 *   5. slide list fetched, first slide opened;
 *   6. `empaia-ready` raised — the plugin renders from there.
 */

import {
    addScopeListener, addTokenListener, addWbsUrlListener,
    type Scope, type Token, type WbsUrl,
} from "@empaia/vendor-app-communication-interface";

import { registerWorkbenchAuthBroker, setWorkbenchIdentity } from "./auth-broker";
import {
    isExportable, registerEmpaiaConvertor, REQUIRED_EXPORT_PROPS,
    setAnnotationMappingContextProvider, type AnnotationMappingContext,
} from "./convertor";
import {
    annotationColorMap, checkCompatibility, factoryForRoiType, getAllAnnotationInputTypes,
    getAnnotationInputTypes, getAppName, getModes, getRoiMode, INCOMPATIBILITY_KEYS,
    isContainerized, isV3Ead, pixelmapColorMap,
    type EadAnnotationType, type EadDocument, type EadMode,
} from "./ead";
import { describeRemoteError, RemoteRefusal } from "./errors";
import { JobRunner, emptyJobResults, type JobResults } from "./job-runner";
import { regionStaysVisible } from "./visibility";
import { EMPAIA_PROTOCOL_ID, getPixelmapSource, registerEmpaiaProtocol, type EmpaiaProtocolContext } from "./protocol";
import { ANNOTATIONS_SINK_ID, makeAnnotationsSink, makeAppStorageSink } from "./sink";
import { isJobCreated, isJobTerminal } from "./types";
import type { ExtendedScope, Job, JobStatus, Pixelmap, Slide, SlideInfo } from "./types";
import { flattenClassNamespaces, Wbs3Client, type PermittedClass } from "./wbs3-client";

/** Preset id prefix for classes discovered on the EMPAIA side. */
const PRESET_PREFIX = "empaia:";
/** Preset id used for regions of interest the user draws for a job. */
const ROI_PRESET_ID = "empaia:roi";
/**
 * The one class value every scope may always use. The service attaches it itself
 * when an annotation is posted with `is_roi=true`, so we never post it — but we
 * do recognise it, to bind it to the ROI preset instead of minting a twin.
 */
const ROI_CLASS_VALUE = "org.empaia.global.v1.classes.roi";
/**
 * Sink refusals that no amount of retrying can turn into a success: the backend
 * locked the record (423 — and there is no unlock route), it belongs to another
 * scope (412), or the shape has no EMPAIA form at all. Anything else is treated
 * as transient and retried.
 */
const PERMANENT_REFUSAL_CODES = new Set([
    "W_EMPAIA_PERMANENT",
    "W_EMPAIA_UNREPRESENTABLE",
    "W_EMPAIA_BAD_BUNDLE",
]);
/**
 * Stable preset-meta key carrying the EMPAIA class value. Chosen by us rather
 * than generated, so the field is still addressable after an export/import
 * round-trip or a session restore.
 */
const CLASS_META_KEY = "empaiaClass";
/** Marker stamped on generated visualizations so a re-open reuses the entry. */
const OVERLAY_MARKER = "__empaiaPixelmapsFor";
/** `tileSourceId` prefix our tile sources stamp (`tile-source.ts`, `pixelmap-tile-source.ts`). */
const SOURCE_ID_PREFIX = "empaia:";

class EmpaiaWorkbench extends XOpatModuleSingleton {

    /** Handshake state, exactly as VACI delivers it. */
    private _scopeId?: string;
    private _wbsUrl?: string;
    private _sessionWaiters: Array<() => void> = [];
    private _tokenWaiters: Array<() => void> = [];
    private _haveToken = false;

    private _client?: Wbs3Client;
    private _scope?: ExtendedScope;
    private _ead?: EadDocument;
    private _slides: Slide[] = [];
    private _activeSlideId?: string;
    private _activeMode: EadMode = "standalone";

    private readonly _slideInfo = new Map<string, SlideInfo>();
    private readonly _pixelmaps = new Map<string, Pixelmap>();
    /** slide id → pixelmap ids discovered for it (drives the overlay build). */
    private readonly _pixelmapsBySlide = new Map<string, Set<string>>();
    /** pixelmap id → the analysis that produced it (`Pixelmap.creator_id`). */
    private readonly _pixelmapJob = new Map<string, string>();

    /**
     * Which analyses' output is currently on each slide.
     *
     * The single source of truth for output presence — annotations, pixel maps
     * and primitives all follow this one set, keyed by slide so returning to a
     * slide shows what it showed before. Never persisted: job output is a
     * projection of server records, so it is re-derived, not remembered.
     */
    private readonly _visibleJobs = new Map<string, Set<string>>();
    /**
     * Slides where the user has made a visibility choice.
     *
     * Without this, the default ("the newest finished analysis") would be
     * re-derived on every poll and would silently undo a comparison the user
     * had just set up.
     */
    private readonly _visibilityUserOwned = new Set<string>();
    /** job id → its outputs, so the panel can attribute a value to a run. */
    private readonly _jobOutputs = new Map<string, JobResults>();
    /**
     * Every analysis id this examination has shown us.
     *
     * The attribution authority handed to the convertor: an annotation whose
     * `creator_id` is in here was produced by that analysis, whatever casing
     * `creator_type` arrives in.
     */
    private readonly _knownJobIds = new Set<string>();
    /** job id → last polled status, for decisions that must not query. */
    private readonly _jobStatus = new Map<string, JobStatus>();
    /**
     * EMPAIA annotation id → the analysis that has locked it by consuming it.
     *
     * The backend refuses a locked record with 423 and exposes no unlock route,
     * so this is the client's copy of a permanent fact. Two writers, both
     * authoritative: a job's `inputs` map (what the backend itself checks) and
     * the non-produced half of a job's result query (which also covers
     * collection inputs, whose member ids never appear in `inputs`).
     *
     * NOT the annotation record's `is_locked` field — that stays false on a
     * locked ROI in a live deployment; the real lock lives in a job-reference
     * table no route exposes.
     *
     * A set per annotation, because a region can feed several runs — and it
     * only leaves the screen with the last of them (see the visibility gate).
     * The empty-string job id means "locked, holder unknown" (learned from a
     * backend refusal); such a region is never hidden, since no visibility
     * decision can honour it.
     */
    private readonly _lockedAnnotations = new Map<string, Set<string>>();
    /** Slides whose visible set is being reconciled — reconciles never overlap. */
    private readonly _reconciling = new Map<string, Promise<void>>();

    /**
     * Local annotation identity → server id.
     *
     * A per-session cache only: `incrementId` is re-assigned on every import, so
     * the authority is the `empaiaId` stamped on the annotation itself.
     * See {@link _resolveEmpaiaId}.
     */
    private readonly _empaiaIdByIncrement = new Map<string, string>();
    /**
     * Analyses whose annotations have been fetched into a canvas, per canvas.
     *
     * Needed because "did we fetch this job?" is NOT answerable from the canvas: a
     * job that produced no annotations looks identical to one never queried, and
     * would be re-queried on every reconcile. Cleared whenever the canvas it
     * describes goes away (slide change). Not a preference — nothing persists it.
     *
     * Keyed by canvas rather than global: two viewports can show the same slide,
     * and a single set would let the first one's import convince the reconcile
     * that the second one already has the shapes it has never seen.
     */
    private readonly _importedJobs = new Map<string, Set<string>>();
    /**
     * Analyses known to have produced no annotations at all.
     *
     * Needed alongside {@link _importedJobs} because residency on the canvas is
     * the authority on "is it imported?", and a job with no output is
     * indistinguishable from one never imported — without this it would be
     * re-queried on every reconcile, forever.
     */
    private readonly _emptyJobs = new Set<string>();
    /** Analyses already reported as unattributable, so the warning fires once. */
    private readonly _warnedUnattributable = new Set<string>();
    /** Disposers for the IO binding claims and the persisted-property registration. */
    private _bindingClaims: Array<() => void> = [];
    private _disposeProps?: () => void;
    private _disposeShapeGuard?: () => void;
    private _disposeVocabulary?: () => void;
    /** Shape types already reported as unrepresentable, when not refusing them. */
    private readonly _warnedShapes = new Set<string>();
    private readonly _warnedClasses = new Set<string>();

    /**
     * Class values this scope is permitted to post, from `GET /class-namespaces`.
     * Empty until the boot fetch resolves; `undefined` means the fetch failed and
     * we fall back to trusting the EAD-derived preset ids.
     */
    private _permittedClasses?: Set<string>;

    private _jobRunner!: JobRunner;
    private _ready = false;
    private _readyPromise!: Promise<void>;
    private _failure?: string;

    constructor() {
        super();

        this.loadLocale();

        this._listenToWorkbench();

        this._jobRunner = new JobRunner({
            getClient: () => this._client,
            getEad: () => this._ead,
            getSlideId: () => this._activeSlideId,
            getMode: () => this._activeMode,
            pollMs: () => Number(this.getStaticMeta("jobPollMs", 2000)) || 2000,
            onJobsChanged: (slideId: string, jobs: Job[]) => this._onJobsChanged(slideId, jobs),
        });

        setAnnotationMappingContextProvider(() => this._mappingContext());

        this._readyPromise = this._boot().catch((e: any) => {
            this._failure = e?.message ?? String(e);
            console.error("[empaia-workbench] boot failed:", e);
            this.raiseEvent("failed", { reason: this._failure });
            // Do not rethrow: an unhandled rejection here would take the app
            // down for a deployment that merely is not embedded right now.
        });
    }

    // ── workbench handshake (VACI) ──────────────────────────────────────────

    /**
     * Subscribe to the three values the Workbench Client pushes over
     * `postMessage`. The official library owns the protocol end to end: it
     * emits `scopeReady` / `tokenReady` / `wbsUrlReady` on the first listener
     * added, and its emitter replays the last value to a late subscriber — so
     * there is no handshake race to guard against here.
     *
     * Note the library does not validate the sender's origin. See the README;
     * that is the library's posture and we adopt it. The one check kept below
     * is not a security policy but a precondition of `HttpClient`: a `wbsUrl`
     * that does not parse would surface as an unrelated failure deep in the
     * request path.
     */
    private _listenToWorkbench(): void {
        addScopeListener((scope: Scope) => {
            if (!scope?.id) return;
            this._scopeId = scope.id;
            this._resolveIfSessionReady();
        });

        addWbsUrlListener((wbsUrl: WbsUrl) => {
            const parsed = parseBackendUrl(wbsUrl?.url);
            if (!parsed) return;
            this._wbsUrl = parsed;
            this._resolveIfSessionReady();
        });

        // The token itself is consumed by the auth broker, which forwards it
        // into XOpatUser. Here we only need to know that one has arrived.
        addTokenListener((token: Token) => {
            if (!token?.value) return;
            this._haveToken = true;
            const waiters = this._tokenWaiters;
            this._tokenWaiters = [];
            for (const resolve of waiters) resolve();
        });
    }

    private _resolveIfSessionReady(): void {
        if (!this._scopeId || !this._wbsUrl) return;
        const waiters = this._sessionWaiters;
        this._sessionWaiters = [];
        for (const resolve of waiters) resolve();
    }

    /** Resolves once both the scope id and the backend URL have arrived. */
    private _whenSession(): Promise<void> {
        if (this._scopeId && this._wbsUrl) return Promise.resolve();
        return new Promise<void>(resolve => this._sessionWaiters.push(resolve));
    }

    /** Resolves once a token has arrived (immediately if one already has). */
    private _whenToken(): Promise<void> {
        if (this._haveToken) return Promise.resolve();
        return new Promise<void>(resolve => this._tokenWaiters.push(resolve));
    }

    // ── public API (consumed by plugins/empaia-app-ui) ──────────────────────

    /** Resolves once the workbench session is usable (or the failure is known). */
    whenReady(): Promise<void> { return this._readyPromise; }
    get isReady(): boolean { return this._ready; }
    /** Why the module is inert, if it is. */
    get failure(): string | undefined { return this._failure; }
    /** True when the page is not framed by a workbench client at all. */
    get notEmbedded(): boolean { return window.self === window.top; }

    getScope(): ExtendedScope | undefined { return this._scope; }
    getEad(): EadDocument | undefined { return this._ead; }

    /**
     * The sentence to show a user for a failed EMPAIA call — the backend's own
     * `detail` when it sent one (`"Job has wrong state: ERROR; …"`), the given
     * fallback otherwise. Plugins call this instead of rendering
     * `HTTP DELETE … failed: 400`, which explains nothing.
     */
    describeError(error: any, fallback: string): string {
        return describeRemoteError(error, fallback);
    }

    /** True when the backend refused permanently (412 foreign scope / 423 locked). */
    isPermanentRefusal(error: any): boolean {
        return error instanceof RemoteRefusal && error.permanent;
    }

    /**
     * Whether an annotation was produced by a job — read-only for this scope.
     *
     * Reads the native property the convertor stamps, but through the same
     * normalization the wire check uses, so the two can never drift.
     */
    isJobOwned(object: any): boolean {
        if (typeof object?.empaiaJobId === "string" && object.empaiaJobId) return true;
        return isJobCreated({ creator_type: object?.empaiaCreatorType });
    }

    /**
     * The analysis that has locked this annotation, if any.
     *
     * "Locked" means the annotation was consumed as a job input: the backend
     * pins it for good (423 on delete or update, no unlock route), so the only
     * honest UI is to refuse locally and render it read-only. Takes an
     * annotation object or a bare EMPAIA id.
     */
    lockingJobFor(objectOrId: any): string | undefined {
        const id = typeof objectOrId === "string" ? objectOrId : objectOrId?.empaiaId;
        if (typeof id !== "string" || !id) return undefined;
        const jobs = this._lockedAnnotations.get(id);
        if (!jobs?.size) return undefined;
        // Any of them explains the lock; prefer a named one over "holder unknown".
        return [...jobs].find(Boolean) ?? "";
    }

    /**
     * Record locks and make them visible.
     *
     * Marking is done through the annotations module's own
     * `setAnnotationReadOnly`, which is the whole enforcement: its IO guard
     * refuses every mutation, the object renders a lock badge and a
     * `not-allowed` cursor. Idempotent, and safe to call for ids that are not
     * on any canvas — a lock learned before hydration is applied by
     * {@link applyKnownLocks} once the annotation arrives.
     */
    noteLockedAnnotations(ids: Iterable<string>, jobId: string): void {
        let learned = false;
        for (const raw of ids) {
            const id = String(raw ?? "");
            if (!id) continue;
            let jobs = this._lockedAnnotations.get(id);
            if (!jobs) {
                jobs = new Set<string>();
                this._lockedAnnotations.set(id, jobs);
                learned = true;
            }
            if (!jobs.has(String(jobId ?? ""))) {
                jobs.add(String(jobId ?? ""));
                learned = true;
            }
        }
        if (learned) {
            this.applyKnownLocks();
            // A newly recognised region may have to leave the screen at once:
            // it belongs to an analysis nobody is showing.
            this.getAnnotations()?.reapplyVisibility?.();
        }
    }

    /**
     * A region an analysis consumed is shown only while one of the analyses
     * using it is shown.
     *
     * Without this, hiding every analysis still left the slide covered in the
     * regions they were run on — a forest the user has to look past to read the
     * slide, and one they cannot clear, because those regions are locked.
     * Untouched regions (drawn but never analysed) are never hidden: they are
     * live work, and making the user's own drawing vanish would be a bug, not a
     * feature. Nor is a region whose holder we only learned from a refusal
     * ("holder unknown"): no visibility decision can honour it, so it stays.
     *
     * Implemented as an annotations-module visibility *gate* rather than by
     * writing `object.visible`: visibility there is derived on every filter,
     * layer and edit pass, so a written flag would be overwritten within the
     * next interaction. It is deliberately NOT an annotation filter either —
     * those are the user's own selection, displayed and cleared as such.
     *
     * The rule itself lives in `visibility.ts`, as a pure function of who locked
     * the region and what those analyses are doing.
     */
    private _annotationVisibilityGate(object: any): boolean {
        const id = object?.empaiaId;
        if (typeof id !== "string" || !id) return true;
        return regionStaysVisible(this._lockedAnnotations.get(id), {
            isShown: (jobId) => {
                for (const shown of this._visibleJobs.values()) {
                    if (shown.has(jobId)) return true;
                }
                return false;
            },
            isRunning: (jobId) => {
                const status = this._jobStatus.get(jobId);
                return !!status && !isJobTerminal({ status });
            },
        });
    }

    /** Stamp `readOnly` on every resident annotation known to be locked. */
    applyKnownLocks(viewer?: any): void {
        if (!this._lockedAnnotations.size) return;
        const annotations = this.getAnnotations();
        if (!annotations) return;

        const fabrics = viewer ? [this._empaiaFabric(viewer)] : this._empaiaFabrics();
        for (const fabric of fabrics) {
            for (const object of (fabric?.canvas?.getObjects?.() ?? []) as any[]) {
                const id = object?.empaiaId;
                if (typeof id !== "string" || object.readOnly) continue;
                if (!this._lockedAnnotations.has(id)) continue;
                try {
                    fabric.setAnnotationReadOnly(object, true);
                } catch (e: any) {
                    console.warn("[empaia-workbench] could not mark annotation read-only:", e?.message ?? e);
                }
            }
        }
    }

    /** Every canvas that could hold this examination's annotations. */
    private _empaiaFabrics(): any[] {
        const found: any[] = [];
        for (const slideId of new Set([...this._visibleJobs.keys(), this._activeSlideId ?? ""])) {
            if (!slideId) continue;
            for (const viewer of this.getViewersForSlide(slideId)) {
                const fabric = this._empaiaFabric(viewer);
                if (fabric && !found.includes(fabric)) found.push(fabric);
            }
        }
        if (!found.length) {
            const fallback = this._empaiaFabric();
            if (fallback) found.push(fallback);
        }
        return found;
    }

    /** Job reached a state it will not leave. Single source of truth for the UI. */
    isJobTerminal(job: { status?: JobStatus } | undefined): boolean {
        return !!job?.status && isJobTerminal(job as { status: JobStatus });
    }

    /**
     * A job can only be removed while it is still being assembled — the backend
     * deletes with `WHERE status='ASSEMBLY'` and has no abort route, so a job
     * that has run is pinned to the examination for good.
     */
    canDeleteJob(job: { status?: JobStatus } | undefined): boolean {
        return job?.status === "ASSEMBLY";
    }

    /**
     * Stopping is a container operation: the backend refuses (400) for a
     * non-containerized app, and there is nothing to stop unless it is running.
     */
    canStopJob(job: { status?: JobStatus } | undefined): boolean {
        if (job?.status !== "RUNNING" && job?.status !== "SCHEDULED") return false;
        return !this._ead || isContainerized(this._ead, this._activeMode);
    }
    /** The app's display name, or undefined when the EAD declares none. */
    getAppName(): string | undefined { return getAppName(this._ead); }
    getClient(): Wbs3Client | undefined { return this._client; }
    getJobRunner(): JobRunner { return this._jobRunner; }
    getSlides(): Slide[] { return this._slides.slice(); }
    getActiveSlideId(): string | undefined { return this._activeSlideId; }
    getSlideInfo(slideId: string): SlideInfo | undefined { return this._slideInfo.get(slideId); }

    /**
     * Whether a viewer is showing a slide of this examination.
     *
     * Keyed on `tileSourceId` (`empaia:<slideId>`, stamped by our tile source),
     * not on the viewer index or a URL — xOpat runs multi-viewport grids and a
     * feature that assumes "the" viewer attaches itself to the wrong one
     * (AGENTS.md §6).
     */
    isEmpaiaViewer(viewer: any): boolean {
        return this.slideIdOfViewer(viewer) !== undefined;
    }

    /**
     * Which slide of this examination a viewer is showing, if any.
     *
     * The slide-aware form of {@link isEmpaiaViewer}: a caller reacting to a
     * per-viewer event in a grid usually needs to know *which* slide it was about,
     * not merely that it was one of ours.
     */
    slideIdOfViewer(viewer: any): string | undefined {
        const world = viewer?.world;
        if (!world?.getItemCount) return undefined;
        for (let i = 0; i < world.getItemCount(); i++) {
            const id = world.getItemAt(i)?.source?.tileSourceId;
            if (typeof id === "string" && id.startsWith(SOURCE_ID_PREFIX)) {
                return id.slice(SOURCE_ID_PREFIX.length) || undefined;
            }
        }
        return undefined;
    }

    /** Modes this app declares, restricted to the ones this UI can drive. */
    getAvailableModes(): EadMode[] {
        if (!this._ead) return [];
        return getModes(this._ead).filter(m => m === "standalone" || m === "preprocessing");
    }

    getActiveMode(): EadMode { return this._activeMode; }

    setActiveMode(mode: EadMode): void {
        if (this._activeMode === mode) return;
        this._activeMode = mode;
        // The declared ROI shape is per-mode, so the preset's factory has to
        // follow — otherwise the user keeps drawing the previous mode's shape
        // until something happens to call `activateRoiTool`.
        this._ensureRoiPreset();
        // The polled buckets describe the mode we just left.
        this._jobRunner.resetJobs();
        this.raiseEvent("mode-changed", { mode });
        this._jobRunner.startPolling();
    }

    /** ROI shapes the active mode accepts. */
    getRoiTypes(): EadAnnotationType[] {
        return this._ead ? getAnnotationInputTypes(this._ead, this._activeMode) : [];
    }

    /** `"single"` = one ROI per job, `"multiple"` = ROIs go into a collection. */
    getRoiMode(): "single" | "multiple" {
        return this._ead ? getRoiMode(this._ead, this._activeMode) : "single";
    }

    /**
     * Whether this UI can drive ROI submission for a mode, and if not, why.
     * `reasons` are translated strings ready for a banner.
     */
    checkModeCompatibility(mode: EadMode = this._activeMode):
        { incompatible: boolean; reasons: string[] } {
        if (!this._ead || mode === "preprocessing") return { incompatible: false, reasons: [] };
        const report = checkCompatibility(this._ead, mode);
        const reasons = (Object.keys(report) as Array<keyof typeof report>)
            .filter(key => report[key])
            .map(key => $.t(INCOMPATIBILITY_KEYS[key], { ns: "empaia-workbench" }));
        return { incompatible: reasons.length > 0, reasons };
    }

    // ── slides ──────────────────────────────────────────────────────────────

    /**
     * Open a slide from this scope in the viewer.
     *
     * Uses the standard session shape — a `data` entry plus a `background` entry
     * that names our protocol — so the open goes through the ordinary pipeline
     * (scalebar, IO restore, visualization assembly) with nothing special-cased.
     */
    async openSlide(slideId: string): Promise<boolean> {
        const client = this._client;
        if (!client) throw new Error("EMPAIA workbench session is not ready.");
        if (!this._slides.some(s => s.id === slideId)) {
            throw new Error(`Slide ${slideId} does not belong to this examination.`);
        }

        // The pixelmap tile source needs the parent pyramid synchronously at
        // construction, so make sure the geometry is cached before the open.
        await this._ensureSlideInfo(slideId);

        const slide = this._slides.find(s => s.id === slideId)!;
        const previous = this._activeSlideId;
        this._activeSlideId = slideId;

        try {
            const ok = await (window as any).APPLICATION_CONTEXT.openViewerWith(
                [{ slideId }],
                [{
                    dataReference: 0,
                    protocol: EMPAIA_PROTOCOL_ID,
                    name: slideDisplayName(slide),
                    id: `empaia:${slideId}`,
                }],
                undefined,
                0,
                undefined,
                { historyMode: "content-switch" }
            );
            if (!ok) this._activeSlideId = previous;
            else {
                // The canvas those analyses were fetched into is gone; anything the
                // new slide should show gets re-fetched by the next reconcile.
                this._resetJobAnnotationState();
                this.raiseEvent("slide-changed", { slideId });
                this._jobRunner.startPolling();
                // Restore what this slide was showing. The poll may not change
                // anything (the list is already known), so the reconcile cannot be
                // left to `_onJobsChanged`.
                this._reconcileVisibility(slideId).catch((e: any) =>
                    console.warn("[empaia-workbench] analysis output restore failed:", e?.message ?? e));
            }
            return ok;
        } catch (e) {
            this._activeSlideId = previous;
            throw e;
        }
    }

    // ── annotations ─────────────────────────────────────────────────────────

    /** The annotations module, or undefined when it is not loaded. */
    getAnnotations(): any {
        return (window as any).xmodule?.annotations ?? (window as any).OSDAnnotations?.instance?.();
    }

    /**
     * Make the drawing tool produce ROIs of the type the app wants.
     *
     * Everything here is existing annotation-module API — the preset carries the
     * factory and the colour, `setMode` switches to the ordinary manual-create
     * tool. No bespoke drawing code exists in this integration.
     */
    activateRoiTool(roiType?: EadAnnotationType): void {
        const annotations = this.getAnnotations();
        if (!annotations) {
            console.warn("[empaia-workbench] annotations module unavailable — cannot start ROI drawing.");
            return;
        }
        if (!this.selectRoiPreset(roiType)) return;
        annotations.setMode(annotations.Modes.CUSTOM);
    }

    /**
     * Arm the ROI preset without touching the annotation mode.
     *
     * Split out of {@link activateRoiTool} for callers that are *already* in a
     * drawing mode — a custom mode that switched to `CUSTOM` here would switch
     * itself off.
     *
     * @return true when a ROI preset exists and is now selected.
     */
    selectRoiPreset(roiType?: EadAnnotationType): boolean {
        const annotations = this.getAnnotations();
        const preset = this._ensureRoiPreset(roiType);
        if (!preset) {
            console.warn("[empaia-workbench] the app declares no ROI input — nothing to draw.");
            return false;
        }
        annotations.presets.selectPreset(preset.presetID, true);
        return true;
    }

    /** Preset id ROIs are drawn with — the plugin filters `annotation-create` on it. */
    get roiPresetId(): string { return ROI_PRESET_ID; }

    /** Server id of a local annotation, once it has been stored. */
    empaiaIdOf(incrementId: string | number | undefined): string | undefined {
        return incrementId === undefined ? undefined : this._resolveEmpaiaId(String(incrementId));
    }

    /**
     * Local id → server id, map first, live object second.
     *
     * The map is only ever a per-session cache: `incrementId` is a session-local
     * counter that is re-assigned on every import, so it cannot be the source of
     * truth across a reload. The authority is the `empaiaId` carried on the
     * annotation itself — which is why that property is registered as persisted
     * (`_configureAnnotationsModule`), and why looking it up on the canvas is a
     * repair, not a fallback: it is how a hydrated annotation is addressable at all.
     */
    private _resolveEmpaiaId(localId: string): string | undefined {
        const known = this._empaiaIdByIncrement.get(localId);
        if (known) return known;
        const fromCanvas = this._findAnnotation(localId)?.empaiaId;
        if (typeof fromCanvas === "string" && fromCanvas) {
            this._empaiaIdByIncrement.set(localId, fromCanvas);
            return fromCanvas;
        }
        return undefined;
    }

    /** The live annotation with this incrementId, in any viewer showing our slide. */
    private _findAnnotation(localId: string): any {
        const wrappers = (globalThis as any).OSDAnnotations?.FabricWrapper?.instances?.() ?? [];
        for (const fabric of wrappers) {
            const found = fabric?.findObjectOnCanvasByIncrementId?.(localId);
            if (found) return found;
        }
        return undefined;
    }

    /**
     * Index every annotation on the canvas that already knows its server id.
     *
     * Runs after an import rather than during it: `incrementId` is assigned at the
     * very end of the load, so anything read before that would index ids that are
     * about to change. Idempotent.
     */
    private _indexHydratedAnnotations(fabric: any): void {
        const objects = fabric?.canvas?.getObjects?.() ?? [];
        for (const o of objects) {
            if (typeof o?.empaiaId === "string" && o.empaiaId && o.incrementId !== undefined) {
                this._linkAnnotation(String(o.incrementId), o.empaiaId);
            }
        }
    }


    // Hydration is NOT implemented here. The `empaia-annotations` sink claims
    // `bundle-import` (see `_registerSinks`), so the annotations the workbench
    // holds for a slide are restored by the IO pipeline through the annotations
    // module's own `importBundle` — on boot and again on every slide-enter, keyed
    // by (viewer, background). A second read path here is what made the two
    // disagree: it ran on the focused viewer, ignored the pipeline's
    // double-hydration guard, and reported failures nowhere.

    /**
     * Make the canvas hold exactly the annotations produced by `jobIds`.
     *
     * Job output is a projection of server records, not local work: evicting it
     * costs nothing and re-fetching it is one query. So presence is *derived* from
     * what the panel currently wants shown rather than remembered as a preference —
     * no hidden-set to persist, nothing to keep in sync, and no way for the canvas
     * to disagree with the panel.
     *
     * Annotations that are not job output — the user's own work, ROIs, records
     * another scope owns — are never touched.
     *
     * @param jobIds analyses whose output should be on the slide
     * @param viewer the viewer showing this examination's slide
     * @param onSlide the slide those analyses belong to (defaults to the active one)
     */
    async syncJobAnnotations(jobIds: string[], viewer?: any, onSlide?: string): Promise<void> {
        const fabric = this._empaiaFabric(viewer);
        if (!fabric) return;

        const wanted = new Set((jobIds ?? []).filter(Boolean).map(String));
        const resident = (fabric.canvas?.getObjects?.() ?? []) as any[];

        // Evict first: the canvas must never briefly show both sets, and dropping
        // before fetching keeps the resident-id check below honest.
        //
        // The test is "job output that is not wanted", and an *unattributable*
        // annotation counts as not wanted: no visibility decision can honour it,
        // so it does not belong on the slide. That is what makes a canvas
        // polluted by an earlier build heal itself on the next reconcile instead
        // of keeping ghosts nothing can ever remove.
        const stale = resident.filter(o =>
            this.isJobOwned(o) && !wanted.has(String(o?.empaiaJobId ?? "")));
        if (stale.length) fabric.dropAnnotations(stale);

        // What the *canvas* actually holds outranks our bookkeeping. A job marked
        // imported whose output is not resident (evicted above, a canvas replaced
        // under us, a build that could not tag it) must be re-fetched — otherwise
        // the mark alone suppresses the import for good and showing the analysis
        // silently does nothing.
        const present = new Set(resident
            .map(o => (typeof o?.empaiaJobId === "string" ? o.empaiaJobId : undefined))
            .filter(Boolean) as string[]);
        const imported = this._importedJobsOf(fabric);
        for (const id of [...imported]) {
            if (!wanted.has(id) || (!present.has(id) && !this._emptyJobs.has(id))) imported.delete(id);
        }

        // Nothing left to fetch. The caller polls, so this is the common case and
        // must not touch the wire.
        const missing = [...wanted].filter(id => !imported.has(id));
        if (!missing.length) return;
        const slideId = onSlide ?? this._activeSlideId;
        if (!slideId) return;

        // One query per analysis rather than one for all of them: the results are
        // cached per job (`getJobOutputs`), and a merged response cannot be split
        // back apart — `creator_id` is the only attribution and a primitive may
        // legitimately omit it.
        for (const id of missing) {
            const results = await this.loadJobOutputs(id, slideId);
            // Only what the analysis PRODUCED. The rest of the response is the
            // regions it consumed — the user's own annotations, already on the
            // canvas and owned by hydration. Importing them here made the eye a
            // no-op (eviction skips them) and made the panel count them as output.
            const items = results.annotations ?? [];
            // Mark before importing, not after: a job that legitimately produced
            // no annotations must not be re-queried on every reconcile — and it is
            // recorded as empty, because the residency check above cannot tell
            // "produced nothing" from "was never imported".
            imported.add(id);
            if (!items.length) this._emptyJobs.add(id);
            else this._emptyJobs.delete(id);
            this._assertAttributable(id, items);
            await this._importAnnotations(fabric, items);
        }
        // A region this pass learned to be locked may already be on the canvas.
        this.applyKnownLocks(viewer);
    }

    /**
     * The invariant every visibility decision rests on: a job's output can be
     * traced back to the job.
     *
     * It broke silently once already — the wire's `creator_type` casing did not
     * match the exact comparison in the convertor, so nothing carried
     * `empaiaJobId`, and showing or hiding an analysis became a no-op with no
     * error anywhere. Assert it rather than assume it, once per job.
     *
     * `items` is already the produced half of the response (the consumed
     * regions are separated upstream), so anything here that matches by neither
     * route — `creator_id` naming the job, or a job-ish `creator_type` — is a
     * genuine attribution failure and not merely an input.
     */
    private _assertAttributable(jobId: string, items: any[]): void {
        if (!items.length || this._warnedUnattributable.has(jobId)) return;
        if (items.some(item => item?.creator_id === jobId || isJobCreated(item))) return;
        this._warnedUnattributable.add(jobId);
        console.warn(
            `[empaia-workbench] analysis ${jobId} returned ${items.length} annotation(s) that name ` +
            `neither it as creator_id nor creator_type "job" (saw ` +
            `${JSON.stringify(items[0]?.creator_type)}/${JSON.stringify(items[0]?.creator_id)}). ` +
            `Its output cannot be attributed, so it cannot be shown or hidden.`);
    }

    /** How many of an analysis' annotations are on the slide right now. */
    countJobOutput(jobId: string, slideId = this._activeSlideId): number {
        return this._residentJobOutput(jobId, slideId).length;
    }

    /**
     * Bring an analysis' output into view.
     *
     * One annotation is focused and highlighted; several are framed by their
     * union bounding box, which is the only reading of "take me to the result"
     * that does not arbitrarily pick one of them. Costs a single pass over the
     * canvas, and only on demand — nothing is indexed ahead of time.
     *
     * @return how many annotations were framed (0 = the output is not on the slide)
     */
    focusJobOutput(jobId: string, slideId = this._activeSlideId): number {
        return this._frame(this._residentJobOutput(jobId, slideId), slideId);
    }

    /**
     * Bring named annotations into view — the regions an analysis consumed, as
     * offered by the panel next to its results.
     *
     * Same framing rule as {@link focusJobOutput}; only the selection differs.
     *
     * @return how many were framed (0 = none of them is on the slide)
     */
    focusAnnotations(empaiaIds: Iterable<string>, slideId = this._activeSlideId): number {
        const wanted = new Set([...empaiaIds].map(String).filter(Boolean));
        if (!wanted.size) return 0;
        const fabric = this._fabricForSlide(slideId);
        const objects = ((fabric?.canvas?.getObjects?.() ?? []) as any[])
            // Resident but hidden is not "on the slide": framing it would move
            // the view to a blank spot.
            .filter(o => typeof o?.empaiaId === "string" && wanted.has(o.empaiaId) && o.visible !== false);
        return this._frame(objects, slideId);
    }

    /** Focus one annotation, or frame the union of several. */
    private _frame(objects: any[], slideId = this._activeSlideId): number {
        if (!objects.length) return 0;

        const fabric = this._fabricForSlide(slideId);
        if (!fabric) return 0;

        if (objects.length === 1) {
            const only = objects[0];
            // Passing the incrementId is what makes the module highlight it, not
            // merely pan to it.
            fabric.focusObjectOrArea(only, only.incrementId);
            return 1;
        }

        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const object of objects) {
            const box = fabric.getFocusBBox?.(object) ?? object.getBoundingRect?.(true, true);
            if (!box || !Number.isFinite(box.left) || !Number.isFinite(box.top)) continue;
            left = Math.min(left, box.left);
            top = Math.min(top, box.top);
            right = Math.max(right, box.left + (box.width ?? 0));
            bottom = Math.max(bottom, box.top + (box.height ?? 0));
        }
        if (!Number.isFinite(left) || !Number.isFinite(top)) return 0;

        fabric.focusArea({ left, top, width: right - left, height: bottom - top });
        return objects.length;
    }

    /** This analysis' annotations, on the canvas showing `slideId`. */
    private _residentJobOutput(jobId: string, slideId = this._activeSlideId): any[] {
        const fabric = this._fabricForSlide(slideId);
        const wanted = String(jobId);
        return ((fabric?.canvas?.getObjects?.() ?? []) as any[])
            .filter(o => String(o?.empaiaJobId ?? "") === wanted);
    }

    /** The canvas of the (first) viewport showing this slide. */
    private _fabricForSlide(slideId = this._activeSlideId): any {
        const viewer = slideId ? this.getViewersForSlide(slideId)[0] : undefined;
        return this._empaiaFabric(viewer);
    }

    /**
     * The imported-analyses set belonging to one canvas.
     *
     * Identified by the fabric wrapper's viewer, falling back to the wrapper
     * itself — the module-default fabric of a single-viewport deployment has no
     * viewer to key on.
     */
    private _importedJobsOf(fabric: any): Set<string> {
        const key = String(fabric?.viewer?.id ?? fabric?.id ?? "default");
        let known = this._importedJobs.get(key);
        if (!known) {
            known = new Set<string>();
            this._importedJobs.set(key, known);
        }
        return known;
    }

    /** How many job-produced annotations are on the canvas right now. */
    countJobAnnotations(viewer?: any): number {
        const fabric = this._empaiaFabric(viewer);
        return (fabric?.canvas?.getObjects?.() ?? []).filter((o: any) => o?.empaiaJobId).length;
    }

    /**
     * What one analysis produced, from the cache filled while its output was
     * fetched. Empty until the analysis has been shown at least once — the panel
     * renders the detail pane for an expanded row, so it asks for exactly the one
     * the user opened rather than pre-fetching every run's results.
     */
    getJobOutputs(jobId: string): JobResults {
        return this._jobOutputs.get(String(jobId)) ?? emptyJobResults();
    }

    /** Fetch and cache one analysis' outputs without putting them on the canvas. */
    async loadJobOutputs(jobId: string, slideId = this._activeSlideId): Promise<JobResults> {
        const id = String(jobId);
        const known = this._jobOutputs.get(id);
        if (known || !slideId) return known ?? emptyJobResults();
        const results = await this._jobRunner.loadResults([id], slideId);
        this._jobOutputs.set(id, results);
        // The half of the response the job did not produce: regions it consumed,
        // and therefore locked. This is the only route that sees the members of
        // a *collection* input — `job.inputs` names the collection, not them.
        if (results.lockedInputs.length) {
            this.noteLockedAnnotations(results.lockedInputs.map(i => i.id), id);
        }
        return results;
    }

    /** Forget which analyses were fetched — the canvas they described is gone. */
    private _resetJobAnnotationState(): void {
        this._importedJobs.clear();
        // `_emptyJobs` is a fact about the analysis, not about a canvas, so it
        // survives — re-querying a job that produced nothing would learn nothing.
    }

    // ── which analyses are shown ────────────────────────────────────────────

    /** Last polled analyses for a slide, in the active mode. */
    getJobs(slideId = this._activeSlideId): Job[] {
        return this._jobRunner.jobsFor(slideId);
    }

    /**
     * One poll landed for one slide.
     *
     * The runner only emits when the list actually changed, so this is where the
     * default visibility is re-derived — not on a timer.
     */
    private _onJobsChanged(slideId: string, jobs: Job[]): void {
        this._learnFromJobs(jobs);
        this.raiseEvent("jobs-changed", { slideId, jobs });
        this._applyDefaultVisibility(slideId, jobs).catch((e: any) =>
            console.warn("[empaia-workbench] default analysis visibility failed:", e?.message ?? e));
    }

    /**
     * What a polled job list tells us regardless of visibility: which ids are
     * analyses (attribution, see {@link _knownJobIds}) and which annotations
     * they have locked.
     *
     * A job locks its inputs the moment it *runs*, and never releases them — so
     * the test is "has it left ASSEMBLY", not "is it still running". Slide ids
     * are skipped: the WSI is an input too, and it is not an annotation.
     * Collection ids are not filtered out — they simply never match a resident
     * annotation, and filtering them would need a request per collection.
     */
    private _learnFromJobs(jobs: Job[]): void {
        const slideIds = new Set(this._slides.map(s => String(s.id)));
        for (const job of jobs ?? []) {
            const id = String(job?.id ?? "");
            if (id) this._knownJobIds.add(id);
            if (id && job?.status) this._jobStatus.set(id, job.status);
            if (!id || job?.status === "ASSEMBLY" || job?.status === "NONE") continue;
            const inputs = Object.values(job?.inputs ?? {})
                .filter((v): v is string => typeof v === "string" && !!v && !slideIds.has(v));
            if (inputs.length) this.noteLockedAnnotations(inputs, id);
        }
    }

    /** Analyses whose output is currently on `slideId`. */
    getVisibleJobIds(slideId = this._activeSlideId): string[] {
        return slideId ? [...(this._visibleJobs.get(slideId) ?? [])] : [];
    }

    isJobVisible(jobId: string, slideId = this._activeSlideId): boolean {
        return !!slideId && !!this._visibleJobs.get(slideId)?.has(String(jobId));
    }

    /** Show or hide one analysis' output. A user choice — it disables the default. */
    async setJobVisible(jobId: string, visible: boolean, slideId = this._activeSlideId): Promise<void> {
        if (!slideId) return;
        const next = new Set(this._visibleJobs.get(slideId) ?? []);
        if (visible) next.add(String(jobId));
        else next.delete(String(jobId));
        this._visibilityUserOwned.add(slideId);
        await this._setVisibleJobs(slideId, next);
    }

    /** Show this analysis and nothing else. */
    async showOnlyJob(jobId: string, slideId = this._activeSlideId): Promise<void> {
        if (!slideId) return;
        this._visibilityUserOwned.add(slideId);
        await this._setVisibleJobs(slideId, new Set([String(jobId)]));
    }

    /** Take every analysis' output off the slide. The user's own work stays. */
    async hideAllJobs(slideId = this._activeSlideId): Promise<void> {
        if (!slideId) return;
        this._visibilityUserOwned.add(slideId);
        await this._setVisibleJobs(slideId, new Set());
    }

    /**
     * The analysis shown by default: the most recently *completed* one.
     *
     * Deliberately not "most recently created": a run that failed, or one still
     * going, has no output to show, and blanking the slide because someone started
     * a new analysis would take away the result they are reading. The last good
     * result stays until there is a newer good result to replace it.
     */
    latestCompletedJob(jobs: Job[]): Job | undefined {
        const at = (j: Job | undefined) => j?.ended_at ?? j?.started_at ?? j?.created_at ?? 0;
        return (jobs ?? [])
            .filter(j => j?.status === "COMPLETED")
            .reduce<Job | undefined>((best, j) => (!best || at(j) >= at(best) ? j : best), undefined);
    }

    /**
     * Bring the visible set in line with a freshly polled job list.
     *
     * Two things happen here and nothing else: analyses that no longer exist stop
     * being shown, and — only while the user has not made a choice on this slide —
     * the newest finished analysis becomes the visible one.
     */
    private async _applyDefaultVisibility(slideId: string, jobs: Job[]): Promise<void> {
        const live = new Set(jobs.map(j => String(j.id)));
        const current = this._visibleJobs.get(slideId) ?? new Set<string>();
        const next = new Set([...current].filter(id => live.has(id)));

        if (!this._visibilityUserOwned.has(slideId)) {
            const latest = this.latestCompletedJob(jobs);
            // Nothing finished yet — leave the slide as it is rather than blanking
            // whatever a previous poll legitimately showed.
            if (latest) {
                next.clear();
                next.add(String(latest.id));
            }
        }
        await this._setVisibleJobs(slideId, next);
    }

    /**
     * The one place the visible set changes, and therefore the one place output
     * presence is reconciled. Serialised per slide: a reconcile fetches, and two
     * overlapping ones would race the canvas into showing a set nobody asked for.
     */
    private async _setVisibleJobs(slideId: string, next: Set<string>): Promise<void> {
        const current = this._visibleJobs.get(slideId) ?? new Set<string>();
        if (current.size === next.size && [...next].every(id => current.has(id))) return;
        this._visibleJobs.set(slideId, next);

        const previous = this._reconciling.get(slideId) ?? Promise.resolve();
        const run = previous
            .catch(() => { /* a failed reconcile must not strand the next one */ })
            .then(() => this._reconcileVisibility(slideId));
        this._reconciling.set(slideId, run);
        try {
            await run;
        } finally {
            if (this._reconciling.get(slideId) === run) this._reconciling.delete(slideId);
        }
    }

    /** Make every output kind agree with `_visibleJobs` for one slide. */
    private async _reconcileVisibility(slideId: string): Promise<void> {
        const jobIds = [...(this._visibleJobs.get(slideId) ?? [])];

        // Pixel maps first: registering one rebuilds the slide's overlay
        // visualization, and doing that *after* the annotations are on the canvas
        // would re-open the viewer under them.
        const maps: Pixelmap[] = [];
        for (const id of jobIds) {
            try {
                maps.push(...(await this.loadJobOutputs(id, slideId)).pixelmaps);
            } catch (e: any) {
                console.warn("[empaia-workbench] analysis outputs failed to load:", e?.message ?? e);
            }
        }
        if (maps.length) {
            try {
                // A map we had not seen re-opens the slide to attach its layer.
                // That is a new canvas, so what we believe is imported is no
                // longer on it — forget it, or the annotations below are skipped
                // and the analysis shows its pixel map with no shapes.
                if (await this.registerPixelmaps(slideId, maps)) this._resetJobAnnotationState();
            } catch (e: any) {
                console.warn("[empaia-workbench] pixel-map registration failed:", e?.message ?? e);
            }
        }

        // Annotations: one canvas per viewport showing this slide. `window.VIEWER`
        // is whichever is focused, which in a grid is regularly the wrong one.
        const viewers = this.getViewersForSlide(slideId);
        for (const viewer of viewers) {
            try {
                await this.syncJobAnnotations(jobIds, viewer, slideId);
            } catch (e: any) {
                console.warn("[empaia-workbench] analysis annotations failed to sync:", e?.message ?? e);
            }
        }
        // No viewport is showing the slide yet (the reconcile can run before the
        // open completes). The module-default fabric is the historic behaviour and
        // is still right for the single-viewport case.
        if (!viewers.length) {
            try {
                await this.syncJobAnnotations(jobIds, undefined, slideId);
            } catch (e: any) {
                console.warn("[empaia-workbench] analysis annotations failed to sync:", e?.message ?? e);
            }
        }

        this._applyPixelmapVisibility(slideId, jobIds);
        // The regions those analyses were run on follow them on and off the
        // slide — see `_annotationVisibilityGate`.
        this.getAnnotations()?.reapplyVisibility?.();
        this.raiseEvent("job-visibility-changed", { slideId, jobIds });
    }

    /**
     * Every viewer whose world holds this slide's tiles.
     *
     * Keyed on `tileSourceId` (`empaia:<slideId>`, stamped by our tile source) so
     * it stays correct in a multi-viewport grid — see `isEmpaiaViewer`.
     */
    getViewersForSlide(slideId: string): any[] {
        const wanted = SOURCE_ID_PREFIX + slideId;
        const found: any[] = [];
        for (const viewer of ((window as any).VIEWER_MANAGER?.viewers ?? [])) {
            const world = viewer?.world;
            if (!world?.getItemCount) continue;
            for (let i = 0; i < world.getItemCount(); i++) {
                if (world.getItemAt(i)?.source?.tileSourceId === wanted) { found.push(viewer); break; }
            }
        }
        return found;
    }

    /**
     * The fabric canvas of the viewer showing this examination's slide.
     *
     * `annotations.fabric` resolves through the *focused* viewer, which in a grid is
     * whichever the user last clicked — so importing or evicting through it can act
     * on somebody else's slide (AGENTS.md §6). Prefer an explicit viewer, then the
     * one actually displaying an EMPAIA source, and only fall back to the module
     * default when neither is available.
     */
    private _empaiaFabric(viewer?: any): any {
        const annotations = this.getAnnotations();
        if (!annotations) return undefined;
        if (viewer) return annotations.getFabric(viewer);
        try {
            for (const fabric of (window as any).OSDAnnotations.FabricWrapper.instances()) {
                if (fabric?.viewer && this.isEmpaiaViewer(fabric.viewer)) return fabric;
            }
        } catch (e: any) {
            console.debug("[empaia-workbench] viewer lookup failed:", e?.message ?? e);
        }
        return annotations.fabric;
    }

    /**
     * Import wire annotations, skipping any whose record is already on the canvas.
     *
     * The canvas is the only authority on what is resident: an id we fetched once is
     * not necessarily still shown (eviction), so a "seen ids" set would suppress a
     * legitimate re-import and the user would tick an analysis and get nothing.
     */
    private async _importAnnotations(fabric: any, items: any[]): Promise<number> {
        if (!items?.length) return 0;
        const resident = new Set(
            (fabric.canvas?.getObjects?.() ?? [])
                .map((o: any) => o?.empaiaId)
                .filter((id: any): id is string => typeof id === "string" && !!id),
        );
        const fresh = items.filter(a => !(typeof a?.id === "string" && resident.has(a.id)));
        if (!fresh.length) return 0;

        await fabric.import(JSON.stringify({ items: fresh }), {
            format: "empaia", history: false, presetMode: "merge",
        }, false);
        this._indexHydratedAnnotations(fabric);
        return fresh.length;
    }

    // ── pixelmap overlays ───────────────────────────────────────────────────

    /**
     * Register pixelmaps a job produced and paint them over the slide.
     *
     * The overlay is assembled the same way the DICOM plugin assembles its
     * SEG / parametric-map overlays: one `config.data` entry per pixelmap plus a
     * visualization of `identity` shader layers (our tiles arrive already
     * colour-mapped), attached through the `before-open` event so a re-open
     * reuses it instead of appending a duplicate.
     */
    async registerPixelmaps(slideId: string, pixelmaps: Pixelmap[]): Promise<boolean> {
        if (!pixelmaps.length) return false;
        await this._ensureSlideInfo(slideId);

        const known = this._pixelmapsBySlide.get(slideId) ?? new Set<string>();
        let added = false;
        for (const pixelmap of pixelmaps) {
            const id = pixelmap?.id ? String(pixelmap.id) : undefined;
            if (!id || known.has(id)) continue;
            this._pixelmaps.set(id, pixelmap);
            // `creator_id` is the analysis that produced the map — the same id
            // annotations carry as `empaiaJobId` — so one visibility decision can
            // govern every kind of output a run produced.
            if (isJobCreated(pixelmap) && pixelmap.creator_id) {
                this._pixelmapJob.set(id, String(pixelmap.creator_id));
            }
            known.add(id);
            added = true;
        }
        this._pixelmapsBySlide.set(slideId, known);
        if (!added) return false;

        // Drop the cached visualization so `before-open` rebuilds it with the
        // new layers, then re-open the current content to apply it.
        this._invalidateOverlayVisualization(slideId);
        await this._reopenActiveViewer();
        this.raiseEvent("pixelmaps-changed", { slideId, pixelmaps: [...known] });
        return true;
    }

    /** Live pixelmap tile source, for the colour/channel controls in the panel. */
    getPixelmapSource(pixelmapId: string, channel = 0): any | undefined {
        return getPixelmapSource(pixelmapId, channel);
    }

    getPixelmaps(slideId: string): Pixelmap[] {
        const ids = this._pixelmapsBySlide.get(slideId);
        if (!ids) return [];
        return [...ids].map(id => this._pixelmaps.get(id)).filter(Boolean) as Pixelmap[];
    }

    /** The analysis a registered pixel map came from, if it came from one. */
    jobOfPixelmap(pixelmapId: string): string | undefined {
        return this._pixelmapJob.get(String(pixelmapId));
    }

    /**
     * Paint exactly the pixel maps the visible analyses produced.
     *
     * Flips the shader layer's `visible` flag and rebuilds the drawer — the same
     * live path the shader side menu uses — instead of re-opening the slide. A
     * re-open would refetch every tile of the slide to change the visibility of
     * an overlay, which is what made hiding an analysis feel like a slide switch.
     */
    private _applyPixelmapVisibility(slideId: string, jobIds: string[]): void {
        const ids = this._pixelmapsBySlide.get(slideId);
        if (!ids?.size) return;
        const visibleJobs = new Set(jobIds.map(String));

        const wanted = new Map<string, boolean>();
        for (const pixelmapId of ids) {
            const job = this._pixelmapJob.get(pixelmapId);
            // A map with no known producer is not something the analyses panel
            // controls; leave whatever the layer panel says about it alone.
            if (!job) continue;
            wanted.set(`empaia-pixelmap-${pixelmapId}`, visibleJobs.has(job));
        }
        if (!wanted.size) return;

        for (const viewer of this.getViewersForSlide(slideId)) {
            const renderer = viewer?.drawer?.renderer;
            if (!renderer?.getShaderLayer) continue;

            let changed = false;
            for (const [shaderId, next] of wanted) {
                // The renderer holds its own clone of the visualization, so the
                // live flag is the one on `getConfig()` — writing to
                // `APPLICATION_CONTEXT.config` here would change nothing on screen.
                const config = renderer.getShaderLayer(shaderId)?.getConfig?.();
                if (!config) continue;
                const now = config.visible !== 0 && config.visible !== false;
                if (now === next) continue;
                config.visible = next ? 1 : 0;
                changed = true;
            }
            if (changed) viewer.drawer?.rebuild?.(0);
        }

        // Keep the authored visualization in step so a re-open (a slide switch, a
        // newly registered map) restores the same picture instead of the build-time
        // default.
        this._persistOverlayVisibility(slideId, wanted);
    }

    /** Mirror the live flags onto the stored visualization for this slide. */
    private _persistOverlayVisibility(slideId: string, wanted: Map<string, boolean>): void {
        const config = (window as any).APPLICATION_CONTEXT?.config;
        const visualizations = Array.isArray(config?.visualizations) ? config.visualizations : [];
        for (const visualization of visualizations) {
            if (visualization?.[OVERLAY_MARKER] !== slideId) continue;
            for (const [shaderId, next] of wanted) {
                const shader = visualization.shaders?.[shaderId];
                if (shader) shader.visible = next ? 1 : 0;
            }
        }
    }

    // ── boot ────────────────────────────────────────────────────────────────

    private async _boot(): Promise<void> {
        const contextId = this.getStaticMeta("authContext", "empaia") || "empaia";

        await registerWorkbenchAuthBroker({
            contextId,
            getScopeId: () => this._scopeId,
            serviceName: "EMPAIA Workbench",
        });

        if (this.notEmbedded) {
            throw new Error($.t("error.notEmbedded", { ns: "empaia-workbench" }));
        }

        // Bounded: an embedder that never answers must surface as a clear
        // "workbench did not respond", not a spinner that never resolves.
        const handshakeMs = Number(this.getStaticMeta("handshakeTimeoutMs", 30000)) || 30000;
        await withTimeout(
            this._whenSession(), handshakeMs,
            $.t("error.handshakeTimeout", { ns: "empaia-workbench" }));
        // A token may arrive after the scope; every request needs one.
        await withTimeout(
            this._whenToken(), handshakeMs,
            $.t("error.handshakeTimeout", { ns: "empaia-workbench" }));

        this._client = new Wbs3Client({
            wbsUrl: this._wbsUrl!,
            scopeId: this._scopeId!,
            proxy: this.getStaticMeta("proxy", null),
            contextId,
        });

        this._scope = await this._client.getScope();
        setWorkbenchIdentity(contextId, this._scope.user_id);

        const ead = this._scope.ead;
        if (!isV3Ead(ead)) {
            throw new Error($.t("error.notV3App", { ns: "empaia-workbench" }));
        }
        this._ead = ead as EadDocument;
        this._activeMode = this.getAvailableModes()[0] ?? "standalone";

        this._registerProtocol();
        registerEmpaiaConvertor();
        this._registerSinks();
        this._configureAnnotationsModule();
        this._registerOverlayAttachment();
        await this._seedPresets();
        this._ensureRoiPreset();

        this._slides = await this._client.listSlides();
        this.raiseEvent("slides-changed", { slides: this._slides });

        this._ready = true;
        this.raiseEvent("ready", { scope: this._scope, slides: this._slides });

        if (this.getStaticMeta("autoOpenFirstSlide", true) !== false) {
            const first = this._slides.find(s => !s.deleted);
            if (first) {
                await this.openSlide(first.id).catch(e =>
                    console.error("[empaia-workbench] failed to open the first slide:", e));
            }
        }
    }

    private _registerProtocol(): void {
        const client = this._client!;
        const ctx: EmpaiaProtocolContext = {
            scopeRoot: client.scopeRoot,
            client: client.httpClient,
            slideInfo: this._slideInfo,
            pixelmaps: this._pixelmaps,
            pixelmapClassColors: this._ead ? pixelmapColorMap(this._ead) : new Map(),
            tileFormat: this.getStaticMeta("tileFormat", "jpeg"),
            tileQuality: this.getStaticMeta("tileQuality", 90),
        };
        registerEmpaiaProtocol(ctx);
    }

    /**
     * Register the sinks AND claim the annotation capabilities for them.
     *
     * The claim is what makes this the only annotation write path. Without it the
     * sink is registered but nothing routes to it unless an operator hand-writes a
     * binding, which is how this integration ended up with a second, private
     * persistence path running in parallel — no retry, no outbox, no rollback, and
     * a double-post the day someone did add the binding. The workbench *is* the
     * backend for an embedded examination, so it says so; an explicit
     * `ENV.client.io.bindings` entry still overrides this, and
     * `disabledCapabilities` still silences it.
     *
     * `bundle-import` is claimed too, so hydration is the pipeline's job as well:
     * the sink resolves the slide from the dispatch context
     * (`getMappingContextFor`), which is what previously made it unsafe in a
     * multi-viewport grid and forced this module to carry a private
     * `hydrateAnnotations` read. With the claim, restore-on-slide-enter,
     * flush-on-slide-leave, the `hydratedKeys` double-hydration guard and the
     * refusal/toast path all come from core instead of being re-implemented here.
     *
     * Not claimed: `crud:preset` — EMPAIA has no preset model at all; presets are
     * derived from `/class-namespaces` and exist only client-side.
     */
    private _registerSinks(): void {
        const pipeline = (globalThis as any).IO_PIPELINE;
        if (!pipeline?.registerSink) {
            console.warn("[empaia-workbench] IO_PIPELINE unavailable — annotations will not sync.");
            return;
        }
        const deps = {
            getClient: () => this._client,
            getMappingContext: () => this._mappingContext(),
            getMappingContextFor: (ctx: unknown) => this._mappingContextFor(ctx),
            linkAnnotation: (incrementId: string | undefined, empaiaId: string | undefined, renameFrom?: string) =>
                this._linkAnnotation(incrementId, empaiaId, renameFrom),
            resolveEmpaiaId: (localId: string) => this._resolveEmpaiaId(localId),
            // A permanent refusal is the backend stating a fact we can act on:
            // record it so the annotation renders locked and the next attempt is
            // refused here rather than upstream.
            noteLocked: (empaiaId: string, detail?: string) => {
                if (detail) console.debug("[empaia-workbench] annotation locked upstream:", empaiaId, detail);
                this.noteLockedAnnotations([empaiaId], "");
            },
            storageKind: () => (this.getStaticMeta("appStorageKind", "scope") === "user" ? "user" : "scope") as "scope" | "user",
        };
        const annotationsSink = makeAnnotationsSink(deps);
        pipeline.registerSink(
            pipeline.withRetry
                // A transient failure (network blip, 5xx) must not lose the
                // annotation; a permanent refusal (412 foreign scope, 423 locked
                // by a job) must not be hammered — there is no unlock route, so a
                // retry can only ever produce the same answer.
                ? pipeline.withRetry(annotationsSink, {
                    retryOn: (r: any) => !PERMANENT_REFUSAL_CODES.has(String(r?.code ?? "")),
                })
                : annotationsSink,
        );
        pipeline.registerSink(makeAppStorageSink(deps));

        if (typeof pipeline.claimBinding !== "function") {
            console.warn(
                "[empaia-workbench] IO_PIPELINE.claimBinding unavailable — annotation CRUD will stay " +
                "inert unless an admin binds it in ENV.client.io.bindings.",
            );
            return;
        }
        this._bindingClaims = [
            pipeline.claimBinding("annotations", "crud:annotation", [ANNOTATIONS_SINK_ID], this.uid),
            pipeline.claimBinding("annotations", "bundle-export", [ANNOTATIONS_SINK_ID], this.uid),
            pipeline.claimBinding("annotations", "bundle-import", [ANNOTATIONS_SINK_ID], this.uid),
        ];
        this._registerShapeGuard(pipeline);
    }

    /**
     * Refuse a shape EMPAIA cannot represent BEFORE it is committed.
     *
     * `nativeToEmpaia` has no mapping for text, angle, group or multipolygon
     * shapes, nor for degenerate geometry. The honest moment to say so is at the
     * checkpoint, while the user is still drawing and nothing has been added: the
     * alternative is an annotation that appears, looks stored, and is simply
     * missing on the next reload — which is precisely the "sometimes it saves,
     * sometimes it doesn't" the integration was reported for.
     *
     * Operators who would rather keep such annotations as local-only scratch work
     * set `refuseUnrepresentableShapes: false` and get a warning instead. This is a
     * presentation policy, not an authorization decision, so it reads from static
     * (deployment) meta rather than session config.
     */
    private _registerShapeGuard(pipeline: any): void {
        if (typeof pipeline.registerGuard !== "function") return;
        const refuse = this.getStaticMeta("refuseUnrepresentableShapes", true) !== false;

        this._disposeShapeGuard = pipeline.registerGuard({
            ownerId: this.uid,
            resource: "annotation",
            direction: "pre-create",
            priority: 100,
            handler: (ctx: any, item: any) => {
                const object = ctx?.meta?.object ?? item;
                if (!object || isExportable(object)) return { ok: true };
                const type = String(object.factoryID ?? object.type ?? "?");
                if (!refuse) {
                    this._warnUnrepresentable(type);
                    return { ok: true };
                }
                return {
                    ok: false, refused: true,
                    reason: `shape "${type}" has no EMPAIA representation`,
                    userMessage: $.t("io.unrepresentable", { ns: "empaia-workbench", type }),
                    code: "W_EMPAIA_UNREPRESENTABLE",
                };
            },
        });
    }

    /** One warning per shape type — a per-annotation toast during drawing is noise. */
    private _warnUnrepresentable(type: string): void {
        if (this._warnedShapes.has(type)) return;
        this._warnedShapes.add(type);
        (globalThis as any).Dialogs?.show(
            $.t("io.unrepresentableLocal", { ns: "empaia-workbench", type }),
            8000, (globalThis as any).Dialogs?.MSG_WARN,
        );
    }

    /**
     * Point the annotations module at our format, keep the properties carrying the
     * EMPAIA linkage alive across serialization, and learn the server id back.
     *
     * The registration is not cosmetic: an unregistered property is dropped by the
     * module's import normalization, which is how a hydrated annotation used to
     * arrive without its `empaiaId` — unaddressable for update and delete — and
     * without `empaiaCreatorType`, so a job's own output looked like the user's
     * own work and no lock applied to it.
     */
    private _configureAnnotationsModule(): void {
        const annotations = this.getAnnotations();
        if (!annotations) return;
        annotations.setIOOption("format", "empaia");
        this._disposeProps = annotations.registerPersistedProperties
            ? annotations.registerPersistedProperties(...REQUIRED_EXPORT_PROPS)
            : (REQUIRED_EXPORT_PROPS.forEach(p => { annotations.forceExportsProp = p; }), undefined);

        // The sink assigns the server id; the module reports it here once the
        // write actually settled. This is the only moment at which a freshly drawn
        // annotation becomes addressable upstream, so it is also where the ROI
        // panel learns a region is stored (via `annotation-linked`).
        annotations.addFabricHandler("annotation-persisted", (e: any) => {
            const incrementId = e?.object?.incrementId;
            if (incrementId === undefined || typeof e?.id !== "string") return;
            const renameFrom = e.previousIncrementId !== undefined ? String(e.previousIncrementId) : undefined;
            this._linkAnnotation(String(incrementId), e.id, renameFrom);
        });

        // Restored annotations never pass through `annotation-persisted` — nothing
        // wrote them this session — so the local-id map would stay empty for them
        // and `empaiaIdOf()` would report every hydrated ROI as unsaved. The module
        // `import` event is raised after `assignAnnotationIds`, so ids are final by
        // the time we read them (see modules/annotations/EVENTS.md).
        //
        // The sink no longer depends on this map (it reads the id off the object
        // the dispatch carries), but the module's public API and the ROI panel do.
        annotations.addHandler("import", (e: any) => {
            const fabric = e?.owner;
            // One viewport's import says nothing about another's annotations.
            if (!fabric?.viewer || !this.slideIdOfViewer(fabric.viewer)) return;
            this._indexHydratedAnnotations(fabric);
            // A region an analysis has consumed is locked for good, and the
            // annotation that just arrived carries no trace of it — the wire's
            // `is_locked` stays false. Mark it here, or the user meets the lock
            // as a 423 from the backend after the delete already looked accepted.
            this.applyKnownLocks(fabric.viewer);
        });

        // Analysed regions follow the analyses that consumed them.
        annotations.registerVisibilityGate?.(this.uid, (object: any) =>
            this._annotationVisibilityGate(object));
    }

    /**
     * Create one preset per class the user is allowed to draw.
     *
     * The server is the authority here, not the EAD: `GET /class-namespaces`
     * returns the global namespace merged with the app's own, and it is the very
     * dict `validate_class_namespace` checks posted classes against — so a class
     * missing from it can never be stored (400 "Invalid class name for EAD").
     * Seeding from `ead.rendering.annotations` instead, as this used to, yields
     * nothing at all for an app that ships no rendering block.
     *
     * Colours still come from the rendering hints when the app provides them;
     * the palette fills in the rest.
     */
    private async _seedPresets(): Promise<void> {
        const annotations = this.getAnnotations();
        if (!annotations) return;

        let permitted: PermittedClass[] | undefined;
        try {
            permitted = flattenClassNamespaces(await this._client!.getClassNamespaces());
        } catch (e: any) {
            console.warn("[empaia-workbench] class namespaces unavailable, "
                + "falling back to EAD rendering hints:", e?.message ?? e);
        }

        if (!permitted) {
            // Degrade CLOSED, not open. `_classValueForPreset` only filters when
            // `_permittedClasses` is set, so leaving it undefined here is what let
            // an unvalidated value reach `POST /classes` in exactly the situation
            // where we know least about what the service accepts. An empty set
            // means "post no class at all": the geometry still stores, and the
            // rendering-hint presets below stay usable as local colour groups.
            this._permittedClasses = new Set();
            this._declareClassVocabulary([]);
            this._seedPresetsFromEad();
            return;
        }

        this._permittedClasses = new Set(permitted.map(c => c.value));
        const colors = this._ead ? annotationColorMap(this._ead) : new Map<string, string>();
        this._declareClassVocabulary(permitted.map(cls => ({
            value: cls.value,
            label: cls.name || cls.value,
            description: cls.description,
            color: colors.get(cls.value),
            // The service attaches the global ROI class itself on `is_roi=true`;
            // a user-authored preset carrying it would produce "ROIs" no job sees.
            creatable: cls.value !== ROI_CLASS_VALUE,
        })));

        for (const cls of permitted) {
            // The ROI class belongs to the ROI preset — a second preset carrying
            // the same class would let the user draw "ROIs" the app never sees.
            if (cls.value === ROI_CLASS_VALUE) continue;
            this._presetForClassValue(cls.value, colors.get(cls.value), cls.name);
        }
    }

    /**
     * Close the annotation class vocabulary to what this examination accepts.
     *
     * Without it the preset editor offers a free-text class field, and anything
     * the user types is dropped on the way out (`_classValueForPreset`) because
     * `POST /classes` answers 400 for a value outside the app's namespace. The
     * annotation is stored, its classification is not, and nothing in the UI says
     * so — the session is lossy. The constraint is enforced by the annotations
     * module at the `crud:preset` checkpoint, so it covers the editor, scripting
     * and any future entry point at once.
     *
     * Unclassified stays allowed: an annotation with no class is a perfectly good
     * EMPAIA annotation, and it is the zero-friction default for drawing.
     */
    private _declareClassVocabulary(values: Array<{
        value: string; label?: string; description?: string; color?: string; creatable?: boolean;
    }>): void {
        const presets = this.getAnnotations()?.presets;
        if (typeof presets?.setVocabulary !== "function") {
            console.warn("[empaia-workbench] annotations module has no class vocabulary API — "
                + "users can still author classes this examination cannot store.");
            return;
        }
        this._disposeVocabulary?.();
        this._disposeVocabulary = presets.setVocabulary({
            ownerUid: this.uid,
            metaKey: CLASS_META_KEY,
            values,
            allowFreeform: false,
            allowUnclassified: true,
        });
    }

    /** Presets for every class the EAD gives a rendering hint for. */
    private _seedPresetsFromEad(): void {
        const annotations = this.getAnnotations();
        if (!annotations || !this._ead) return;
        for (const [classValue, color] of annotationColorMap(this._ead)) {
            this._presetForClassValue(classValue, color);
        }
    }

    // ── overlays ────────────────────────────────────────────────────────────

    private _registerOverlayAttachment(): void {
        (window as any).VIEWER_MANAGER.addHandler("before-open", async (event: any) => {
            try {
                const slideId = this._slideIdOfBackground(event?.background);
                if (!slideId) return;

                const config = (window as any).APPLICATION_CONTEXT.config;
                const visualizations = Array.isArray(config.visualizations) ? config.visualizations : [];
                const existing = visualizations.findIndex((v: any) => v && v[OVERLAY_MARKER] === slideId);
                if (existing >= 0) {
                    event.visualizationIndex = existing;
                    return;
                }

                const built = this._buildOverlayVisualization(slideId);
                if (!built) return;

                event.visualizationIndex = visualizations.length;
                event.visualization = built;
            } catch (e: any) {
                // An overlay is a feature; a slide that fails to open is a broken
                // viewer. Never let this throw take the slide with it.
                console.warn("[empaia-workbench] pixelmap overlay attachment failed:", e?.message ?? e);
            }
        });
    }

    private _buildOverlayVisualization(slideId: string): any | undefined {
        const ids = this._pixelmapsBySlide.get(slideId);
        if (!ids || ids.size === 0) return undefined;

        const config = (window as any).APPLICATION_CONTEXT.config;
        if (!Array.isArray(config.data)) config.data = [];

        const shaders: Record<string, any> = {};
        const visibleJobs = new Set(this.getVisibleJobIds(slideId));
        let order = 0;
        for (const pixelmapId of ids) {
            const pixelmap = this._pixelmaps.get(pixelmapId);
            if (!pixelmap) continue;

            const dataIndex = config.data.push({
                dataID: { slideId, role: "pixelmap", pixelmapId, channel: 0 },
                protocol: EMPAIA_PROTOCOL_ID,
            }) - 1;

            shaders[`empaia-pixelmap-${pixelmapId}`] = {
                // Tiles arrive already colour-mapped to RGBA, so a passthrough
                // shader is correct — a colour-mapping shader would map twice.
                type: "identity",
                name: pixelmap.name || $.t("overlay.pixelmap", { ns: "empaia-workbench" }),
                dataReferences: [dataIndex],
                // Follows the analyses panel: a map is painted when the analysis
                // that produced it is shown. A map with no known producer keeps
                // the old "first one only" rule — several maps commonly describe
                // the same thing, and painting them all just double-covers the
                // tissue.
                visible: this._pixelmapVisibleByDefault(pixelmapId, visibleJobs, order) ? 1 : 0,
                params: {},
            };
            order++;
        }
        if (!order) return undefined;

        return {
            name: $.t("overlay.visualizationName", { ns: "empaia-workbench" }),
            [OVERLAY_MARKER]: slideId,
            shaders,
        };
    }

    /**
     * Whether a freshly built overlay layer starts visible. Producer known → the
     * analyses panel decides; producer unknown → the historic first-one-only rule.
     */
    private _pixelmapVisibleByDefault(pixelmapId: string, visibleJobs: Set<string>, order: number): boolean {
        const job = this._pixelmapJob.get(pixelmapId);
        return job ? visibleJobs.has(job) : order === 0;
    }

    private _invalidateOverlayVisualization(slideId: string): void {
        const config = (window as any).APPLICATION_CONTEXT.config;
        const visualizations = Array.isArray(config.visualizations) ? config.visualizations : [];
        const index = visualizations.findIndex((v: any) => v && v[OVERLAY_MARKER] === slideId);
        if (index >= 0) delete visualizations[index][OVERLAY_MARKER];
    }

    private async _reopenActiveViewer(): Promise<void> {
        const APP = (window as any).APPLICATION_CONTEXT;
        const activeBg = APP.getOption("activeBackgroundIndex", undefined, true, true);
        await APP.openViewerWith(undefined, undefined, undefined, activeBg, undefined, {
            historyMode: "content-switch", force: true,
        });
    }

    /** The EMPAIA slide id behind a background entry, if it is one of ours. */
    private _slideIdOfBackground(background: any): string | undefined {
        if (!background) return undefined;
        if (background.protocol && background.protocol !== EMPAIA_PROTOCOL_ID) return undefined;

        const BackgroundConfig = (window as any).BackgroundConfig;
        let dataID: any;
        try {
            dataID = BackgroundConfig?.data ? BackgroundConfig.data(background) : undefined;
        } catch { dataID = undefined; }
        if (!dataID) {
            const ref = background.dataReference;
            dataID = typeof ref === "object" ? (ref?.dataID ?? ref) : undefined;
        }
        if (typeof dataID === "string") return dataID;
        if (dataID && typeof dataID === "object" && typeof dataID.slideId === "string") {
            // An overlay layer is not the slide itself.
            return dataID.role === "pixelmap" ? undefined : dataID.slideId;
        }
        return undefined;
    }

    // ── annotation mapping glue ─────────────────────────────────────────────

    /**
     * Resolve the EMPAIA slide an IO dispatch is about.
     *
     * The annotations owner is `bundleScope: "per-viewer-background"`, so a bundle
     * context names the viewer and the background it is keyed by. Reading the
     * active slide instead was the reason this module could not claim
     * `bundle-import`: with two viewports, the second one's restore would have been
     * answered with the first one's annotations. Per-element CRUD carries no viewer
     * (see `IOResourceImpl.buildCtx`), so it keeps the active-slide answer.
     */
    private _slideIdForIoContext(ctx: any): string | undefined {
        const viewerId = ctx?.viewerId ?? ctx?.meta?.viewerId;
        if (viewerId !== undefined && viewerId !== null) {
            const viewer = (window as any).VIEWER_MANAGER?.getViewer?.(viewerId);
            const item = viewer?.scalebar?.getReferencedTiledImage?.() || viewer?.world?.getItemAt?.(0);
            const slideId = this._slideIdOfBackground(item?.getConfig?.("background"));
            if (slideId) return slideId;
        }
        const backgroundId = ctx?.backgroundId;
        if (typeof backgroundId === "string" && backgroundId) {
            const backgrounds = (window as any).APPLICATION_CONTEXT?.config?.background;
            const entry = Array.isArray(backgrounds)
                ? backgrounds.find((b: any) => b && (b.virtualOf ?? b.id) === backgroundId)
                : undefined;
            const slideId = this._slideIdOfBackground(entry);
            if (slideId) return slideId;
        }
        return this._activeSlideId;
    }

    /** Mapping context for a specific IO dispatch. Undefined when it is not ours. */
    private _mappingContextFor(ctx: any): AnnotationMappingContext | undefined {
        return this._mappingContext(this._slideIdForIoContext(ctx));
    }

    private _mappingContext(forSlideId?: string): AnnotationMappingContext | undefined {
        const slideId = forSlideId ?? this._activeSlideId;
        if (!this._client || !slideId) return undefined;
        const info = this._slideInfo.get(slideId);
        return {
            slideId,
            scopeId: this._client.scopeId,
            // nm/px at level 0. `1000000` is the WSI-Service "unknown" sentinel.
            defaultNpp: info && info.pixel_size_nm.x !== 1000000 ? info.pixel_size_nm.x : 1,
            roiPresetId: ROI_PRESET_ID,
            classValueForPreset: (presetId) => this._classValueForPreset(presetId),
            presetForClassValue: (value) => this._presetForClassValue(value)?.presetID,
            coordinateOffset: this._coordinateOffset(),
            isJobId: (id) => this._knownJobIds.has(String(id)),
        };
    }

    private _coordinateOffset(): { x: number; y: number } | undefined {
        const annotations = this.getAnnotations();
        const offset = annotations?.getExportOptions?.()?.imageCoordinatesOffset;
        if (Array.isArray(offset) && offset.length === 2) return { x: Number(offset[0]) || 0, y: Number(offset[1]) || 0 };
        return undefined;
    }

    /**
     * The class value to store for an annotation drawn with `presetId`, or
     * undefined when it maps to none.
     *
     * Undefined is a normal outcome, not a failure: the geometry is stored
     * either way. What must not happen is *sending* a value the service forbids
     * — the class POST would 400 and, worse, look like a transient error. So a
     * value outside the permitted set is dropped here, before the request.
     */
    private _classValueForPreset(presetId: unknown): string | undefined {
        if (presetId === undefined || presetId === null) return undefined;
        const annotations = this.getAnnotations();
        const preset = annotations?.presets?.get?.(presetId);
        if (!preset) return undefined;

        let value: string | undefined;
        const meta = preset.getMetaValue?.(CLASS_META_KEY);
        if (typeof meta === "string" && meta) value = meta;
        else {
            // Presets we created carry the class in their id.
            const id = String(preset.presetID ?? "");
            if (id.startsWith(PRESET_PREFIX) && id !== ROI_PRESET_ID) value = id.slice(PRESET_PREFIX.length);
        }

        if (!value) return undefined;
        if (this._permittedClasses && !this._permittedClasses.has(value)) {
            // With the class vocabulary in place this should be unreachable — the
            // `crud:preset` guard refuses such a preset before it can be drawn
            // with. Reaching it means the vocabulary is absent or was overridden,
            // so say it once, loudly enough to be found, and store the geometry.
            this._warnUnstorableClass(value);
            return undefined;
        }
        return value;
    }

    /** One warning per class value — this is evaluated on every annotation write. */
    private _warnUnstorableClass(value: string): void {
        if (this._warnedClasses.has(value)) return;
        this._warnedClasses.add(value);
        console.warn(`[empaia-workbench] class "${value}" is not in this app's namespace; `
            + "annotations drawn with it are stored without a classification.");
    }

    /**
     * Find or create the preset representing an EMPAIA class value.
     *
     * Also the import path: a class arriving on the wire that the vocabulary has
     * never seen (an analysis emits its own output classes, which this scope may
     * not author) is admitted as non-creatable first. Otherwise the vocabulary
     * guard would refuse the preset and the imported annotation would land
     * unclassified — losing information that was already stored server-side.
     */
    private _presetForClassValue(classValue: string | undefined, color?: string, label?: string): any | undefined {
        if (!classValue) return undefined;
        const annotations = this.getAnnotations();
        if (!annotations?.presets) return undefined;

        // The global ROI class *is* the ROI preset. Minting `empaia:org.empaia…`
        // for it would give hydrated ROIs a preset the app-ui does not recognise
        // as ROI-producing, so they would never reach the region list.
        if (classValue === ROI_CLASS_VALUE) return this._ensureRoiPreset();

        const id = `${PRESET_PREFIX}${classValue}`;
        let preset = annotations.presets.get(id);
        if (!preset) {
            const hinted = color ?? (this._ead ? annotationColorMap(this._ead).get(classValue) : undefined);
            annotations.presets.extendVocabulary?.([{
                value: classValue, label: label ?? classValue, color: hinted, creatable: false,
            }]);
            if (typeof annotations.presets.addVocabularyPreset === "function"
                && annotations.presets.vocabulary) {
                // One dispatch carrying the class, instead of create-then-update:
                // the guard sees the finished preset and the outbox sees one entry.
                preset = annotations.presets.addVocabularyPreset(classValue, id, annotations.polygonFactory);
            } else {
                preset = annotations.presets.addPreset(id, label ?? classValue, hinted, annotations.polygonFactory);
                annotations.presets.addCustomMeta(
                    id, $.t("presets.classMetaName", { ns: "empaia-workbench" }), classValue, CLASS_META_KEY);
            }
        } else if (color && preset.color !== color) {
            annotations.presets.updatePreset(id, { color });
        }
        return preset;
    }

    /**
     * The preset ROIs are drawn with, bound to the factory the app expects.
     *
     * Created at boot rather than on first use: the preset *is* the affordance —
     * without it the annotation toolbar offers every class the app declares
     * except the one that produces job inputs, and the user has no way to start
     * drawing a ROI from the annotation UI at all.
     *
     * Skipped entirely for an app that declares no annotation input anywhere
     * (a preprocessing-only app takes no user regions); a preset that cannot
     * produce anything usable would be worse than none.
     */
    private _ensureRoiPreset(roiType?: EadAnnotationType): any {
        const annotations = this.getAnnotations();
        if (!annotations?.presets) return undefined;

        // Active mode first, then anything the app accepts in another mode — a
        // mode switch must not leave the user without a ROI tool.
        const type = roiType ?? this.getRoiTypes()[0] ?? getAllAnnotationInputTypes(this._ead)[0];
        if (!type) return undefined;

        const factory = annotations.getAnnotationObjectFactory(factoryForRoiType(type));
        const app = this.getAppName();
        const name = app
            ? $.t("roi.presetNameApp", { ns: "empaia-workbench", app })
            : $.t("roi.presetName", { ns: "empaia-workbench" });

        let preset = annotations.presets.get(ROI_PRESET_ID);
        if (!preset) {
            preset = annotations.presets.addPreset(ROI_PRESET_ID, name, "#ffcc00", factory);
        } else {
            const patch: Record<string, any> = {};
            // The app's ROI type can change with the mode.
            if (factory && preset.objectFactory !== factory) patch.objectFactory = factory;
            // The EAD (and with it the name) arrives after a restored preset.
            if (preset.meta?.category?.value !== name) patch.category = name;
            if (Object.keys(patch).length) annotations.presets.updatePreset(ROI_PRESET_ID, patch);
        }
        return preset;
    }

    /**
     * @param incrementId local id the link now belongs to
     * @param empaiaId server id, or undefined to drop the link
     * @param renameFrom local id the link used to be under. An update is a
     *   delete + re-post upstream and the module dispatches it keyed by the
     *   *previous* object, but the annotation left on the canvas afterwards is the
     *   replacement, with its own incrementId — without moving the entry, the next
     *   edit or delete of that annotation would find nothing to address.
     */
    private _linkAnnotation(incrementId: string | undefined, empaiaId: string | undefined, renameFrom?: string): void {
        if (renameFrom !== undefined && renameFrom !== incrementId) {
            this._empaiaIdByIncrement.delete(renameFrom);
        }
        if (incrementId !== undefined) {
            if (empaiaId) this._empaiaIdByIncrement.set(incrementId, empaiaId);
            else this._empaiaIdByIncrement.delete(incrementId);
        }
        if (empaiaId) {
            // Stamp the live object so a subsequent export carries the link.
            this._stampLiveAnnotation(incrementId, empaiaId);
        }
        this.raiseEvent("annotation-linked", { incrementId, empaiaId });
    }

    private _stampLiveAnnotation(incrementId: string | undefined, empaiaId: string): void {
        if (incrementId === undefined) return;
        const annotations = this.getAnnotations();
        if (!annotations) return;
        try {
            for (const fabric of (window as any).OSDAnnotations.FabricWrapper.instances()) {
                const object = fabric.findObjectOnCanvasByIncrementId?.(Number(incrementId));
                if (object) { object.empaiaId = empaiaId; return; }
            }
        } catch (e: any) {
            console.debug("[empaia-workbench] could not stamp annotation link:", e?.message ?? e);
        }
    }

    // ── slide info cache ────────────────────────────────────────────────────

    private async _ensureSlideInfo(slideId: string): Promise<SlideInfo | undefined> {
        const cached = this._slideInfo.get(slideId);
        if (cached) return cached;
        const client = this._client;
        if (!client) return undefined;
        try {
            const info = await client.getSlideInfo(slideId);
            this._slideInfo.set(slideId, info);
            return info;
        } catch (e: any) {
            console.warn(`[empaia-workbench] slide info for ${slideId} unavailable:`, e?.message ?? e);
            return undefined;
        }
    }
}

function slideDisplayName(slide: Slide): string {
    return slide.local_id || slide.id;
}

/**
 * Normalize the backend URL the workbench hands us.
 *
 * Not a security check — VACI does not validate the sender and neither do we
 * (see the README). This is a precondition of the code that consumes the value:
 * it becomes an `HttpClient` `baseURL`, so a value that does not parse, or that
 * is not http(s), has to be rejected here or it resurfaces as a confusing
 * failure deep inside the request path. Returns undefined when unusable.
 */
function parseBackendUrl(raw: unknown): string | undefined {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) {
        console.warn("[empaia-workbench] ignoring empty wbsUrl from the workbench.");
        return undefined;
    }
    let parsed: URL;
    try {
        parsed = new URL(value, window.location.href);
    } catch {
        console.warn("[empaia-workbench] ignoring unparseable wbsUrl from the workbench.");
        return undefined;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        console.warn(`[empaia-workbench] ignoring wbsUrl with unsupported scheme ${parsed.protocol}`);
        return undefined;
    }
    // Trailing slashes are stripped: every route is composed as `${base}/v3/...`
    // and the workbench service redirects doubled slashes.
    return parsed.href.replace(/\/+$/, "");
}

/** Reject after `ms` unless `promise` settles first. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms);
        promise.then(
            v => { clearTimeout(timer); resolve(v); },
            e => { clearTimeout(timer); reject(e); }
        );
    });
}

// Eager: the plugin resolves the module in its constructor, and `instance()`
// before `addModule` throws "no id given" (AGENTS.md §8).
addModule("empaia-workbench", EmpaiaWorkbench as any, true);

export { EmpaiaWorkbench };
