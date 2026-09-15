import { createEmpaiaPanel } from "./panel.mjs";
import { JobsWindow } from "./jobs-window.mjs";
import { RUNNING_STATUSES } from "./sections/job-status.mjs";
import { QUICK_ROI_MODE_ID, registerQuickRoiMode } from "./quick-roi-mode.mjs";
import { describeRegion, drawRefusal, refusalGroups, runRefusal } from "./sections/region-eligibility.mjs";

const { div } = globalThis.van.tags;

/** Fields of a described region the panel renders — a change in any is a change. */
const SELECTION_FIELDS = [
    "incrementId", "empaiaId", "factoryID", "roiType",
    "analysable", "convertible", "reasonKey", "lockedBy", "label",
];

/**
 * Whether a freshly described selection differs from the one already on state.
 *
 * A selection is a handful of entries of flat scalars, so an exact comparison
 * costs nothing and — unlike comparing ids — cannot leave the batch section
 * showing a verdict the region no longer has.
 */
function _selectionChanged(previous, next) {
    if (previous.length !== next.length) return true;
    for (let i = 0; i < next.length; i++) {
        const a = previous[i], b = next[i];
        for (const key of SELECTION_FIELDS) if (a[key] !== b[key]) return true;
    }
    return false;
}

/**
 * EMPAIA Workbench app UI.
 *
 * The user-facing half of the workbench integration: pick a slide from the
 * examination, draw regions of interest with xOpat's own annotation tools,
 * submit them as an app job, watch it run, and read the results back.
 *
 * All backend work lives in `modules/empaia-workbench`; this plugin owns no
 * geometry, no persistence and no tile plumbing. Every ROI is an ordinary xOpat
 * annotation created through the annotation module's preset + mode API, which
 * is why undo/redo, the annotation board, presets, measurements and the
 * canvas context menu all work on them without a line of code here.
 */
addPlugin("empaia-app-ui", class extends XOpatPlugin {

    constructor(id) {
        super(id);

        this._localeReady = this.loadLocale().catch(() =>
            this.loadLocale("en").catch(e => console.warn("empaia-app-ui: failed to load locale", e)));

        this.workbench = singletonModule("empaia-workbench");

        const van = globalThis.van;
        /**
         * Reactive view state. Kept flat and plugin-owned so every section
         * renders from one source and no section holds a private copy.
         */
        this.state = {
            status: van.state("loading"),      // loading | ready | failed | not-embedded
            statusMessage: van.state(""),
            slides: van.state([]),
            activeSlideId: van.state(undefined),
            mode: van.state("standalone"),
            modes: van.state([]),
            incompatibility: van.state(undefined),
            rois: van.state([]),               // {incrementId, empaiaId, label, pending}
            // What is selected on the CANVAS, described. There is no second
            // selection model here on purpose: a panel-only tick set is invisible
            // to the user working on the slide, which is how "select two regions,
            // right-click, analyse" ended up reporting that nothing was selected.
            selection: van.state([]),          // SelectedRegion[]
            jobs: van.state([]),
            // Bumped whenever the module reports a change in which analyses are
            // painted. The set itself is NOT mirrored here: the module owns it,
            // and a second copy is a second thing to keep in step.
            visibilityRevision: van.state(0),
            // Same idiom for the staged batch: the module owns the draft, this
            // only makes the reads of it re-run.
            batchRevision: van.state(0),
            busy: van.state(false),
            error: van.state(""),
        };

        this._roiObjects = new Map();          // incrementId -> fabric object
        // Regions drawn in quick mode, waiting for a server id before the analysis
        // can name them as inputs.
        this._pendingQuickRun = new Set();      // incrementIds
        // Regions drawn while a multi-ROI app is active, waiting for a server id
        // before they can be staged into the batch's collection.
        this._pendingBatchAdd = new Set();      // incrementIds
        this._jobsWindow = undefined;
    }

    async pluginReady() {
        await this._localeReady;

        const container = div({ id: "empaia-app-ui-container" });
        USER_INTERFACE.AppBar.Plugins.setMenu(
            this.id,
            "empaia-app-ui",
            this.t("panel.title"),
            container,
            "ph-flask",
            { chrome: "plain" }
        );
        globalThis.van.add(container, createEmpaiaPanel(this));

        // Analyses are watched while looking at the slide, so they get a tool
        // entry and a window of their own rather than a section of a fullscreen
        // menu the user has to leave the slide to reach.
        USER_INTERFACE.AppBar.Tools.register("empaia.analyses", {
            section: "empaia",
            sectionTitle: this.t("panel.title"),
            icon: "ph-flask",
            label: this.t("jobs.windowTitle"),
            onClick: () => this.showJobsWindow(),
        });

        this._wireWorkbench();
        this._wireAnnotations();
        this._registerRoiDeleteGuard();
        this._registerContextMenu();
        registerQuickRoiMode(this);

        try {
            await this.workbench.whenReady();
        } catch (e) {
            // whenReady never rejects; kept for safety if that ever changes.
            console.error("empaia-app-ui: workbench boot failed", e);
        }
        this._syncFromWorkbench();
    }

    // ── workbench wiring ────────────────────────────────────────────────────

    _wireWorkbench() {
        const wb = this.workbench;
        wb.addHandler("ready", () => this._syncFromWorkbench());
        wb.addHandler("failed", (e) => {
            this.state.status.val = wb.notEmbedded ? "not-embedded" : "failed";
            this.state.statusMessage.val = e?.reason ?? "";
        });
        wb.addHandler("slides-changed", (e) => { this.state.slides.val = e.slides ?? []; });
        wb.addHandler("slide-changed", (e) => {
            this.state.activeSlideId.val = e.slideId;
            this._resetSlideScopedState();
        });
        wb.addHandler("mode-changed", () => this._syncModeState());
        // Job lists are per slide now, so an event for a slide this panel is not
        // showing is not this panel's business.
        wb.addHandler("jobs-changed", (e) => {
            if (e?.slideId !== this.state.activeSlideId.val) return;
            this.state.jobs.val = e?.jobs ?? [];
            this._updateRunningBadge();
            // Whether this step can be started is partly a fact about the polled
            // list — a postprocessing mode is blocked until a preprocessing job
            // has finished. Reading it once at `ready` is how the panel stayed
            // refusing long after the results it was waiting for had arrived.
            this._syncRunnability();
        });
        wb.addHandler("job-visibility-changed", (e) => {
            if (e?.slideId !== this.state.activeSlideId.val) return;
            this.state.visibilityRevision.val = this.state.visibilityRevision.val + 1;
        });
        wb.addHandler("batch-changed", (e) => {
            if (e?.slideId !== this.state.activeSlideId.val) return;
            this.state.batchRevision.val = this.state.batchRevision.val + 1;
        });
        // An analysis whose output finally arrived. The detail pane renders the
        // results object it was handed when the row opened, so a background
        // re-read that succeeded is invisible without this — the user would sit
        // in front of "not available yet" long after it became available.
        wb.addHandler("job-outputs-changed", (e) => {
            if (e?.slideId !== this.state.activeSlideId.val) return;
            this.state.visibilityRevision.val = this.state.visibilityRevision.val + 1;
            this._jobsWindow?.refreshExpandedOutputs?.(String(e?.jobId ?? ""));
        });
        // The moment a region actually exists upstream. Until then it has no id a
        // job could name, which is why the row shows as pending and quick-mode
        // analyses wait here rather than firing on a local-only object.
        wb.addHandler("annotation-linked", (e) => {
            const incrementId = e?.incrementId !== undefined ? String(e.incrementId) : "";
            if (!incrementId || !this._roiObjects.has(incrementId)) return;
            this._updateRoi(incrementId, { empaiaId: e.empaiaId, pending: !e.empaiaId, error: undefined });
            this._syncSelection();
            if (e.empaiaId && this._pendingQuickRun.delete(incrementId)) {
                this.runAnalysis({ roiIds: [e.empaiaId] });
            }
            if (e.empaiaId && this._pendingBatchAdd.delete(incrementId)) {
                this._stageRegions([e.empaiaId]);
            }
        });
    }

    _syncFromWorkbench() {
        const wb = this.workbench;
        if (wb.notEmbedded) {
            this.state.status.val = "not-embedded";
            this.state.statusMessage.val = this.t("status.notEmbedded");
            return;
        }
        if (wb.failure) {
            this.state.status.val = "failed";
            this.state.statusMessage.val = wb.failure;
            return;
        }
        if (!wb.isReady) return;

        this.state.status.val = "ready";
        this.state.slides.val = wb.getSlides();
        this.state.activeSlideId.val = wb.getActiveSlideId();
        // Whatever the runner has already polled. Without this the list is empty
        // until the next poll emits — and the runner only emits on a change, so
        // "the next poll" can be a while when everything has already finished.
        this.state.jobs.val = wb.getJobs(this.state.activeSlideId.val);
        this._updateRunningBadge();
        this._syncModeState();
    }

    _syncModeState() {
        const wb = this.workbench;
        this.state.modes.val = wb.getAvailableModes();
        this.state.mode.val = wb.getActiveMode();
        this._syncRunnability();
    }

    /**
     * Whether the active step can be started, re-read from the current session.
     *
     * Split out of `_syncModeState` because the answer is not static: every mode
     * is checked, preprocessing included — its blocker is not a fault ("the
     * platform starts these; their results are shown here") — but a
     * postprocessing mode's blocker clears the moment a preprocessing job
     * completes, which happens on a poll and not on any mode change.
     *
     * Only written when the sentences actually change: this drives the panel
     * banner, the ROI section and the run buttons, and a poll tick that changed
     * nothing must not re-render all three.
     */
    _syncRunnability() {
        const wb = this.workbench;
        const ead = wb.getEad();
        const report = ead ? wb.checkModeCompatibility?.(wb.getActiveMode()) : undefined;
        const next = report && report.incompatible ? report : undefined;
        const key = (r) => (r ? r.reasons.join("|") : "");
        if (key(next) === key(this.state.incompatibility.val)) return;
        this.state.incompatibility.val = next;
    }

    _resetSlideScopedState() {
        this.state.rois.val = [];
        this.state.selection.val = [];
        // The new slide's list arrives from the module (which keeps one per
        // slide); until it does, showing the previous slide's analyses would be
        // a lie about what is on screen.
        this.state.jobs.val = this.workbench.getJobs(this.state.activeSlideId.val);
        this.state.visibilityRevision.val = this.state.visibilityRevision.val + 1;
        this.state.batchRevision.val = this.state.batchRevision.val + 1;
        this._roiObjects.clear();
        this._pendingQuickRun.clear();
        this._pendingBatchAdd.clear();
        this._updateRunningBadge();
        // The source-job condition is per slide: the same step can be startable on
        // one slide of the examination and waiting on preprocessing on the next.
        this._syncRunnability();
    }

    // Annotations are NOT hydrated from here. The workbench module's sink claims
    // `bundle-import`, so the IO pipeline restores the slide's annotations as part
    // of opening it — before this panel is told the slide changed. Calling a
    // second read from here is what produced two hydration passes per slide and a
    // canvas whose contents depended on which one finished last.

    // ── annotations wiring ──────────────────────────────────────────────────

    /**
     * We observe annotations; we never write them.
     *
     * Persistence belongs to the IO pipeline: the annotations module dispatches
     * every create/update/delete through its `crud:annotation` resource, and the
     * workbench module binds that to its own sink. Writing from these handlers as
     * well — which this plugin used to do — meant two independent queues posting
     * the same annotation, no retry, no outbox, and a delete that vanished locally
     * whether or not the backend accepted it.
     *
     * What is left here is bookkeeping the pipeline cannot do for us: which
     * annotations are regions of interest, and therefore which ones can be fed to
     * a job. ROI-ness follows the *current* preset, not how the object was drawn,
     * so it is (re)evaluated on create and on every preset change.
     *
     * Events fire for every viewer through the broadcast handler, so the viewer is
     * taken from the event, never `window.VIEWER`.
     */
    _wireAnnotations() {
        const annotations = this.workbench.getAnnotations();
        if (!annotations) {
            console.warn("empaia-app-ui: annotations module unavailable — ROI capture disabled.");
            return;
        }

        annotations.addFabricHandler("annotation-create", (e) => {
            const object = e?.object;
            if (!object || object.presetID !== this.workbench.roiPresetId) return;
            if (!this.can("empaia-app-ui.roi.create")) {
                Dialogs.show(this.t("roi.notPermitted"), 5000, Dialogs.MSG_WARN);
                return;
            }
            const incrementId = this._adoptRoi(object);
            if (!incrementId) return;
            // Capture the mode *now*: the region reaches the workbench
            // asynchronously and the user may well have left the quick mode by the
            // time its server id arrives. `annotation-linked` fires the analysis.
            if (annotations.mode?.getId?.() === QUICK_ROI_MODE_ID) {
                this._pendingQuickRun.add(incrementId);
            } else if (this.workbench.getRoiMode() === "multiple"
                && this.can("empaia-app-ui.job.run")) {
                // Drawing a region with the ROI preset while a collecting app is
                // active is not ambiguous — it is the gesture that app exists for.
                // Making the user then find and tick it in a panel is the friction
                // this whole surface is meant to remove.
                this._pendingBatchAdd.add(incrementId);
            }
        });

        // Canvas selection is the region set. Broadcast, so the viewer comes from
        // the event and a grid's other viewport cannot redefine what this panel
        // is describing.
        annotations.addFabricHandler("annotation-selection-changed", (e) => {
            const viewer = e?.viewer;
            if (!viewer) return;
            if (this.workbench.slideIdOfViewer(viewer) !== this.state.activeSlideId.val) return;
            this._syncSelection(viewer);
        });

        // ROI membership follows the preset: an annotation given the ROI preset
        // later belongs in the list, and one that loses it does not.
        // Hydration is a bulk load: it raises `import`, not one `annotation-create`
        // per object. Without this, every region restored with the slide was absent
        // from the list — invisible to the user and unavailable as a job input,
        // even though it was on the canvas.
        annotations.addHandler("import", (e) => {
            const fabric = e?.owner;
            // Only the viewport this panel is describing: in a grid, another
            // viewport's import says nothing about these regions.
            if (!fabric?.viewer) return;
            if (this.workbench.slideIdOfViewer(fabric.viewer) !== this.state.activeSlideId.val) return;
            this._rescanRois(fabric);
        });

        annotations.addFabricHandler("annotation-preset-change", (e) => {
            const object = e?.object;
            if (!object) return;
            if (object.presetID === this.workbench.roiPresetId) this._adoptRoi(object);
            else this._releaseRoi(String(object.incrementId ?? ""));
        });

        annotations.addFabricHandler("annotation-delete", (e) => {
            const object = e?.object;
            if (!object) return;
            this._releaseRoi(String(object.incrementId ?? ""));
        });

        // A write the destination refused has already been rolled back and toasted
        // by the pipeline; the row just has to stop claiming it is on its way.
        // Module-level event (the pipeline is per-module, not per-canvas).
        annotations.addHandler("annotation-sync-failed", (e) => {
            const incrementId = e?.itemId !== undefined ? String(e.itemId) : "";
            if (!incrementId) return;
            this._pendingQuickRun.delete(incrementId);
            if (this._roiObjects.has(incrementId)) {
                this._updateRoi(incrementId, {
                    pending: false,
                    error: e?.result?.userMessage ?? e?.result?.reason ?? this.t("roi.saveFailed"),
                });
            }
        });
    }

    /**
     * The job that has locked this region, if any.
     *
     * A job locks its inputs the moment it *runs*, and the backend has no unlock
     * route — the lock outlives the job's completion, forever. So the test is
     * "has this job left ASSEMBLY", not "is this job still running": treating a
     * completed job as harmless is exactly what let a delete through and then
     * collected a 423 with the annotation already gone from the canvas.
     */
    _lockingJobFor(incrementId) {
        if (!incrementId) return undefined;
        const roi = this.state.rois.val.find(r => r.incrementId === incrementId);
        if (!roi?.empaiaId) return undefined;
        return this.state.jobs.val.find(job =>
            job?.status !== "ASSEMBLY" && job?.status !== "NONE" &&
            Object.values(job.inputs ?? {}).includes(roi.empaiaId));
    }

    /**
     * Put an annotation in the region list.
     *
     * Separate from the create handler because membership is not only decided at
     * draw time: an annotation that is *given* the ROI preset later, or one that
     * arrives from the workbench during hydration, belongs in the list just as
     * much. Idempotent, and it carries over a server id the annotation already
     * has so a hydrated region is not shown as unsaved.
     *
     * @return {string|undefined} the incrementId, or undefined when the object has none
     */
    _adoptRoi(object) {
        const incrementId = object?.incrementId !== undefined ? String(object.incrementId) : "";
        if (!incrementId) return undefined;

        // `_roiObjects` and `state.rois` are populated and cleared together
        // (`_resetSlideScopedState`), so the map answers membership in O(1).
        // Scanning `state.rois` instead made an adopt O(N) — and `_rescanRois`
        // adopts per object, so the rescan was O(N^2).
        const known = this._roiObjects.has(incrementId);
        this._roiObjects.set(incrementId, object);
        if (known) return incrementId;

        this.state.rois.val = [...this.state.rois.val, this._roiRecord(object, incrementId)];
        return incrementId;
    }

    /** The list row for an object that is a region, as `state.rois` holds it. */
    _roiRecord(object, incrementId) {
        const empaiaId = object.empaiaId ?? this.workbench.empaiaIdOf(incrementId);
        return {
            incrementId,
            empaiaId,
            label: this._roiLabel(object),
            pending: !empaiaId,
        };
    }

    /**
     * Re-derive the region list from what is actually on the canvas.
     *
     * The canvas is the authority, not an accumulated set: an import may have
     * replaced the whole slide's annotations (slide switch) or merged into them
     * (hydration), and either way a region the canvas no longer holds is not a
     * region. Idempotent, so running it after every import is safe.
     */
    _rescanRois(fabric) {
        const objects = fabric?.canvas?.getObjects?.() ?? [];
        const roiPresetId = this.workbench.roiPresetId;

        // One pass to learn what is alive, then ONE assignment to each state.
        // Adopting and releasing per object instead meant an array copy and a
        // van flush per object — quadratic, and on an examination carrying tens
        // of thousands of objects on the region preset it was the single most
        // expensive thing the panel did.
        const alive = new Map();                 // incrementId -> object, canvas order
        for (const object of objects) {
            if (object?.presetID !== roiPresetId) continue;
            const incrementId = object?.incrementId !== undefined ? String(object.incrementId) : "";
            if (!incrementId || alive.has(incrementId)) continue;
            alive.set(incrementId, object);
        }

        const previous = this.state.rois.val;
        // Existing rows keep their order and their record (a record carries
        // `pending`/`error` that `_updateRoi` wrote and a rescan must not undo);
        // genuinely new regions append in canvas order.
        const kept = previous.filter(r => alive.has(r.incrementId));
        const known = new Set(kept.map(r => r.incrementId));
        const added = [];
        for (const [incrementId, object] of alive) {
            if (known.has(incrementId)) continue;
            added.push(this._roiRecord(object, incrementId));
        }

        for (const incrementId of [...this._roiObjects.keys()]) {
            if (alive.has(incrementId)) continue;
            this._roiObjects.delete(incrementId);
            this._pendingBatchAdd.delete(incrementId);
        }
        for (const [incrementId, object] of alive) this._roiObjects.set(incrementId, object);

        if (added.length || kept.length !== previous.length) {
            this.state.rois.val = added.length ? kept.concat(added) : kept;
        }

        const selection = this.state.selection.val;
        const survivors = selection.filter(r => alive.has(r.incrementId));
        if (survivors.length !== selection.length) this.state.selection.val = survivors;
    }

    /** Drop an annotation from the region list (it was deleted, or is no longer a ROI). */
    _releaseRoi(incrementId) {
        if (!incrementId || !this._roiObjects.has(incrementId)) return false;
        this._roiObjects.delete(incrementId);
        this.state.rois.val = this.state.rois.val.filter(r => r.incrementId !== incrementId);
        // Only touch the selection when this region was actually in it — a write
        // re-renders every selection row, and most releases are of a region
        // nobody had selected.
        const selection = this.state.selection.val;
        if (selection.some(r => r.incrementId === incrementId)) {
            this.state.selection.val = selection.filter(r => r.incrementId !== incrementId);
        }
        this._pendingBatchAdd.delete(incrementId);
        return true;
    }

    _updateRoi(incrementId, patch) {
        // Rebuilding the array is what makes van re-render, so only do it when
        // there is something to change. `annotation-linked` fires per annotation
        // during a save-back, and an unconditional `.map()` per event turns that
        // into a quadratic walk over a list that never moved.
        const rois = this.state.rois.val;
        const at = rois.findIndex(r => r.incrementId === incrementId);
        if (at < 0) return;
        const current = rois[at];
        let changed = false;
        for (const key of Object.keys(patch)) if (current[key] !== patch[key]) { changed = true; break; }
        if (!changed) return;

        const next = rois.slice();
        next[at] = { ...current, ...patch };
        this.state.rois.val = next;
    }

    _roiLabel(object) {
        const factory = object?.factoryID ?? "roi";
        const id = object?.incrementId ?? "?";
        return this.t("roi.itemLabel", { type: factory, id });
    }

    /**
     * Refuse, before anything is committed locally, a change to a region an
     * analysis has consumed — locked at run time, and never unlocked, because the
     * backend has no unlock route.
     *
     * Both directions matter: an update is delete + re-post upstream, so an edit
     * hits exactly the same wall as a delete. The annotations module probes
     * `pre-update` when an edit starts, which is where this catches it.
     *
     * The pipeline toasts the refusal itself, so nothing here calls `Dialogs`.
     */
    _registerRoiDeleteGuard() {
        if (!globalThis.IO_PIPELINE?.registerGuard) return;
        this._disposeGuard = globalThis.IO_PIPELINE.registerGuard({
            ownerId: this.id,
            resource: "annotation",
            direction: "*",
            priority: 50,
            handler: (ctx) => {
                if (ctx?.direction !== "pre-delete" && ctx?.direction !== "pre-update") return { ok: true };

                // The module's lock map first: it is keyed by server id and fed
                // from the job list itself, so it also covers regions this panel
                // never adopted (hydrated with another preset, list not rescanned
                // yet) and collection members, whose ids never appear in
                // `job.inputs`. Missing those is what let a delete reach the
                // backend and come back as a raw 423.
                const object = ctx?.meta?.object ?? ctx?.meta?.previous;
                const lockedBy = this.workbench.lockingJobFor(object);
                const incrementId = ctx?.meta?.localId ?? ctx?.itemId;
                const blocking = lockedBy
                    ? { id: lockedBy }
                    : this._lockingJobFor(incrementId !== undefined ? String(incrementId) : undefined);
                if (!blocking) return { ok: true };

                return {
                    ok: false, refused: true,
                    reason: `ROI is an input of analysis ${blocking.id || "(unknown)"}`,
                    userMessage: blocking.id
                        ? this.t("roi.lockedByJob", { job: String(blocking.id).slice(0, 8) })
                        : this.t(ctx.direction === "pre-delete" ? "roi.deleteBlocked" : "roi.editBlocked"),
                    code: "W_EMPAIA_ROI_IN_USE",
                };
            },
        });

        /**
         * Explain a job's *output*, rather than let the generic message stand.
         *
         * The annotations module already refuses these — they carry `readOnly`, and
         * its guard sits at priority 1000. But its message has to serve every
         * read-only source (foreign scope, rights resolvers), so it can only say
         * "cannot be changed or removed", which leaves the user with no next move.
         * Sitting *above* it lets the one party that knows where the control lives
         * say so. The refusal is identical; only the sentence differs.
         */
        this._disposeJobOwnedGuard = globalThis.IO_PIPELINE.registerGuard({
            ownerId: this.id,
            resource: "annotation",
            direction: "*",
            priority: 1100,
            handler: (ctx) => {
                if (ctx?.direction !== "pre-delete" && ctx?.direction !== "pre-update") return { ok: true };
                const object = ctx?.meta?.object ?? ctx?.meta?.previous;
                if (!this.workbench.isJobOwned(object)) return { ok: true };
                return {
                    ok: false, refused: true,
                    reason: "annotation was produced by an analysis job",
                    userMessage: this.t("roi.jobOwned"),
                    code: "W_EMPAIA_JOB_OWNED",
                };
            },
        });
    }

    /**
     * Put the analysis actions on the canvas right-click, where the user's
     * attention already is — the panel lives behind a fullscreen menu.
     *
     * Registered below the annotations plugin (20) so annotation actions stay
     * first, above the playground (10). The registry has no `disabled` flag, so
     * an unavailable entry is dimmed — but it keeps a real action that states
     * the reason. A greyed row that swallows the click tells the user nothing
     * and reads as a broken menu.
     */
    _registerContextMenu() {
        const registry = globalThis.CanvasContextMenu;
        if (!registry?.register) return;

        /** Dimmed entry that explains itself when clicked. */
        const unavailable = (title, icon, reason) => ({
            title, icon,
            containerCss: "opacity-50",
            action: () => Dialogs.show(reason, 6000, Dialogs.MSG_WARN),
        });

        registry.register(this.id, (ctx) => {
            // Say nothing in a viewer that is not showing this examination's
            // slide, and nothing at all before the session resolves.
            if (this.state.status.val !== "ready") return null;
            if (!this.workbench.isEmpaiaViewer(ctx.viewer)) return null;

            const showAnalyses = {
                title: this.t("jobs.openManager"),
                icon: "ph-flask",
                action: () => this.showJobsWindow(),
            };
            // Always live. A region can be drawn and stored whatever the app
            // declares — nothing app-specific is written into one — so gating
            // this on whether the app can RUN was wrong, and it put a sentence
            // about slides on a region menu. The only thing that can stop it is
            // the session, which the guard above already covers.
            const drawEntry = {
                title: this.t("roi.createJobRoi"),
                icon: "ph-selection-plus",
                action: () => this.startDrawing(),
            };

            const targets = this._contextTargets(ctx).map(o => this._describeRegion(o));
            const usable = targets.filter(r => r.analysable && r.empaiaId);
            const convertible = targets.filter(r => r.convertible);
            const skipped = targets.filter(r => !r.analysable && !r.convertible);
            const multi = this.workbench.getRoiMode() === "multiple";
            const items = [];

            if (convertible.length) {
                items.push({
                    title: this.t("roi.useAsRoi", { count: convertible.length }),
                    icon: "ph-selection-foreground",
                    action: () => this.markSelectionAsRoi(convertible),
                });
            }

            if (multi) {
                if (usable.length) {
                    // Honest about the total. Saying "Add 2" to a selection of
                    // three is the silent drop this menu keeps being fixed for.
                    const partial = usable.length !== targets.length;
                    items.push({
                        title: partial
                            ? this.t("roi.addToBatchPartial",
                                { count: usable.length, total: targets.length })
                            : this.t("roi.addToBatch", { count: usable.length }),
                        icon: "ph-stack-plus",
                        action: () => this.addSelectionToBatch(),
                    });
                }
                const staged = this.batchCount();
                if (staged) {
                    items.push({
                        title: this.t("roi.runBatch", { count: staged }),
                        icon: "ph-play",
                        action: () => this.runBatch(),
                    }, {
                        title: this.t("roi.discardBatch"),
                        icon: "ph-trash",
                        action: () => this.discardBatch(),
                    });
                }
            } else if (usable.length === 1) {
                items.push({
                    title: this.t("roi.analyseThis"),
                    icon: "ph-play-circle",
                    action: () => this.runAnalysis({ roiIds: [usable[0].empaiaId] }),
                });
            } else if (usable.length > 1) {
                // Silently analysing one of several was the old behaviour, and a
                // one-region answer to a two-region question reads as a result.
                items.push(unavailable(this.t("roi.analyseThis"), "ph-play-circle",
                    this.t("roi.singleOnlyOne")));
            }

            // Outside the mode branch on purpose. This used to be the `else` of
            // `if (multi)`, so a collecting app — the one that most often has a
            // mixed selection — explained nothing at all, and a right-click on
            // regions it could not use produced a menu that talked only about a
            // staged run the user had not just clicked on.
            if (skipped.length) {
                items.push(unavailable(
                    this.t("roi.skipped", { count: skipped.length }),
                    "ph-prohibit-inset",
                    this.describeRefusals(skipped)));
            }

            items.push(drawEntry, showAnalyses);
            return items;
        }, 15);
    }

    /**
     * The annotations a right-click is about.
     *
     * `ctx.selection` is resolved by the core registry *before* any provider
     * runs, which matters: providers are asked in priority order and the
     * annotations plugin re-points the active object while the menu is being
     * built, so reading the live selection here answers differently depending on
     * who ran first. The fallbacks cover an older core bundle whose registry
     * singleton predates the field.
     */
    _contextTargets(ctx) {
        const fabric = this._activeFabric(ctx?.viewer);
        // Helper and highlight objects share the canvas and are not regions; a
        // `findTarget` hit can be one of them.
        const keep = (list) => list.filter(o => o && fabric?.isAnnotation?.(o));

        if (Array.isArray(ctx?.selection)) return keep(ctx.selection);

        const deduped = [];
        for (const object of fabric?.getSelectedAnnotations?.() ?? []) {
            if (object && !deduped.includes(object)) deduped.push(object);
        }
        if (deduped.length) return keep(deduped);

        const one = ctx?.active ?? this._hitTest(ctx);
        return one ? keep([one]) : [];
    }

    /** Release what we registered outside our own DOM. */
    destroy() {
        try { this._disposeGuard?.(); } catch (e) { /* already gone */ }
        this._disposeGuard = undefined;
        try { this._disposeJobOwnedGuard?.(); } catch (e) { /* already gone */ }
        this._disposeJobOwnedGuard = undefined;
        globalThis.CanvasContextMenu?.unregister?.(this.id);
        USER_INTERFACE.AppBar.Tools?.unregister?.("empaia.analyses");
        if (USER_INTERFACE.AppBar.hasBadge?.("empaia.analyses")) {
            USER_INTERFACE.AppBar.removeBadge("empaia.analyses");
        }
        this._jobsWindow?.destroy();
        this._jobsWindow = undefined;
        super.destroy?.();
    }

    /** The annotation under a right-click, or undefined. */
    _hitTest(ctx) {
        try {
            return this.workbench.getAnnotations()?.getFabric(ctx.viewer)?.canvas?.findTarget(ctx.event);
        } catch (e) {
            return undefined;
        }
    }

    /**
     * Terminal-state test, delegated to the module so the status list exists
     * once. A second copy here drifted the moment either side learned a new
     * status.
     */
    isTerminal(job) {
        return this.workbench.isJobTerminal(job);
    }

    // ── actions invoked from the panel ──────────────────────────────────────

    async openSlide(slideId) {
        this.state.busy.val = true;
        this.state.error.val = "";
        try {
            await this.workbench.openSlide(slideId);
        } catch (e) {
            this.state.error.val = e?.message ?? String(e);
        } finally {
            this.state.busy.val = false;
        }
    }

    setMode(mode) {
        this.workbench.setActiveMode(mode);
    }

    /**
     * Why drawing a region is not on offer right now, or undefined.
     *
     * One place, so the panel, the canvas right-click and the quick-ROI mode
     * cannot answer differently — they used to.
     */
    drawRefusal() {
        return drawRefusal({
            ready: this.state.status.val === "ready",
            t: (key) => this.t(key),
        });
    }

    /**
     * Why this app cannot be run on a region, or undefined.
     *
     * Separate from {@link drawRefusal} on purpose: a region can be drawn and
     * stored for an app that can never consume it, and refusing the drawing was
     * how a sentence about slides ended up on three region-shaped surfaces.
     */
    runRefusal({ singleOnly = false } = {}) {
        return runRefusal({
            ready: this.state.status.val === "ready",
            blockers: this.workbench.runBlockers?.() ?? [],
            roiTypes: this.workbench.getRoiTypes(),
            roiMode: this.workbench.getRoiMode(),
            singleOnly,
            t: (key) => this.t(key),
        });
    }

    /**
     * Arm the region tool, or say why not.
     *
     * The refusal used to be a `console.warn` inside `selectRoiPreset`, so the
     * canvas right-click's "Draw region" appeared to work and did nothing at all.
     * @returns {boolean} whether drawing was armed
     */
    startDrawing() {
        const reason = this.drawRefusal();
        if (reason) {
            Dialogs.show(reason, 6000, Dialogs.MSG_WARN);
            return false;
        }
        const types = this.workbench.getRoiTypes();
        this.workbench.activateRoiTool(types[0]);
        return true;
    }

    // ── canvas selection ────────────────────────────────────────────────────

    /**
     * @typedef {object} SelectedRegion
     * @property {string}  incrementId
     * @property {string=} empaiaId
     * @property {string}  factoryID
     * @property {string=} roiType     the EMPAIA type it would be submitted as
     * @property {boolean} eligible    can be named as a job input right now
     * @property {string=} reasonKey   i18n key explaining why it cannot
     * @property {string}  label
     */

    /**
     * Re-derive `state.selection` from what is selected on one viewer's canvas.
     *
     * Only annotations are described — the wrapper's own helper and highlight
     * objects share the canvas and are not regions.
     */
    _syncSelection(viewer) {
        const fabric = this._activeFabric(viewer);
        if (!fabric) {
            if (this.state.selection.val.length) this.state.selection.val = [];
            return;
        }
        const selected = fabric.getSelectedAnnotations?.() ?? [];
        const seen = new Set();
        const described = [];
        for (const object of selected) {
            if (!object || !fabric.isAnnotation?.(object)) continue;
            const incrementId = object.incrementId !== undefined ? String(object.incrementId) : "";
            if (!incrementId || seen.has(incrementId)) continue;
            seen.add(incrementId);
            described.push(this._describeRegion(object));
        }
        // Every write here is a fresh array, so van's identity check always
        // fires — including for the many events that report an unchanged
        // selection (an edit-mode toggle, a re-select of what is already
        // selected). Every row in the region list re-renders on that.
        //
        // The comparison is on the whole verdict, not just the ids: a region can
        // keep its id and still change (`annotation-linked` assigns `empaiaId`,
        // `markSelectionAsRoi` flips `convertible` to `analysable`), and the
        // batch section renders those fields.
        if (!_selectionChanged(this.state.selection.val, described)) return;
        this.state.selection.val = described;
    }

    /**
     * What this annotation is, from the analysis' point of view.
     *
     * The judgement itself is pure and lives in `region-eligibility.mjs`; this
     * only supplies the lookups it needs. Note the deliberate absence of a
     * "locked" refusal: a region a previous analysis consumed can no longer be
     * *edited*, and can still be handed to another run.
     */
    _describeRegion(object) {
        const wb = this.workbench;
        return describeRegion(object, {
            roiTypeOf: (o) => wb.roiTypeOf(o),
            // Tells "wrong shape" apart from "this app takes no regions at all".
            hasRoiInput: () => wb.getRoiTypes().length > 0,
            isJobOwned: (o) => wb.isJobOwned(o),
            lockingJobFor: (o) => wb.lockingJobFor(o),
            roiPresetId: wb.roiPresetId,
            // The row is the authority on "stored yet": it carries the pending
            // flag the linked event maintains, which the object alone does not.
            rowFor: (incrementId) => this.state.rois.val.find(r => r.incrementId === incrementId)
                ?? (wb.empaiaIdOf(incrementId) ? { empaiaId: wb.empaiaIdOf(incrementId) } : undefined),
            labelOf: (o) => this._roiLabel(o),
        });
    }

    /** Server ids of the selected regions that can be named as a job input now. */
    selectedRegionIds() {
        return this.state.selection.val.filter(r => r.analysable && r.empaiaId).map(r => r.empaiaId);
    }

    /** Selected regions that can be given the ROI preset. */
    convertibleSelection() {
        return this.state.selection.val.filter(r => r.convertible);
    }

    /**
     * Selected regions no offered action would touch.
     *
     * The list every surface has to account for: leaving it unmentioned is what
     * made a selection of locked regions produce a menu that talked about
     * something else entirely.
     */
    skippedSelection() {
        return this.state.selection.val.filter(r => !r.analysable && !r.convertible);
    }

    /**
     * One sentence for a set of regions an action will not touch.
     *
     * Grouped by reason and shared by the menu, the panel and the toasts, so the
     * three cannot describe the same refusal differently.
     */
    describeRefusals(regions) {
        return refusalGroups(regions)
            .map(group => this.t(group.reasonKey, {
                count: group.count,
                // Supplied for any reason that names the holding analysis; the
                // short form is what the analyses window shows, so they match by
                // eye. i18next ignores it for the keys that do not interpolate.
                job: group.lockedBy ? String(group.lockedBy).slice(0, 8) : "",
            }))
            .join(" ");
    }

    /**
     * Select a region from a panel row.
     *
     * Drives the canvas rather than a private set, so the highlight, the board
     * and this panel cannot disagree about what is selected.
     */
    selectRegion(incrementId, { additive = false } = {}) {
        const object = this._roiObjects.get(incrementId);
        const fabric = this._activeFabric();
        if (object && fabric) fabric.selectAnnotation(object, false, !additive);
    }

    /** The fabric wrapper of the viewport this panel describes. */
    _activeFabric(viewer) {
        const annotations = this.workbench.getAnnotations();
        if (!annotations) return undefined;
        if (viewer) return annotations.getFabric?.(viewer);
        for (const fabric of globalThis.OSDAnnotations.FabricWrapper.instances()) {
            if (fabric?.viewer
                && this.workbench.slideIdOfViewer(fabric.viewer) === this.state.activeSlideId.val) {
                return fabric;
            }
        }
        return undefined;
    }

    /** Give the selected annotations the ROI preset so they can be analysed. */
    async markSelectionAsRoi(regions = this.convertibleSelection()) {
        const objects = regions
            .map(r => this._roiObjects.get(r.incrementId) ?? this._findObject(r.incrementId))
            .filter(Boolean);
        if (!objects.length) return;

        this.state.error.val = "";
        try {
            const { changed, refused } = await this.workbench.markAsRoi(objects);
            // Reported even on partial success, and for every reason rather than
            // the first: converting four of five and saying nothing about the
            // fifth is the same silent drop as counting it out of a menu label.
            if (refused.length) {
                Dialogs.show(this.describeRefusals(refused.map(reasonKey => ({ reasonKey }))),
                    6000, Dialogs.MSG_WARN);
            }
        } catch (e) {
            this.state.error.val = this.workbench.describeError(e, this.t("roi.convertFailed"));
        }
        this._syncSelection();
    }

    /** An annotation by local id, across the viewports showing this slide. */
    _findObject(incrementId) {
        const id = Number(incrementId);
        if (!Number.isFinite(id)) return undefined;
        return this._activeFabric()?.findObjectOnCanvasByIncrementId?.(id);
    }

    focusRegion(incrementId) { this.focusRoi(incrementId); }

    focusRoi(incrementId) {
        // Not only ROIs: the selection list also offers regions the user has not
        // converted yet, and those are never in `_roiObjects`.
        const object = this._roiObjects.get(incrementId) ?? this._findObject(incrementId);
        if (!object) return;
        // An analysed region is on the slide only while one of the analyses
        // using it is shown. Panning to it while it is hidden looks broken, so
        // say where the switch is instead.
        if (object.visible === false) {
            Dialogs.show(this.t("roi.hiddenWithAnalysis"), 5000, Dialogs.MSG_INFO);
            return;
        }
        const annotations = this.workbench.getAnnotations();
        for (const fabric of globalThis.OSDAnnotations.FabricWrapper.instances()) {
            if (fabric.canvas?._objects?.includes(object)) {
                fabric.focusObjectOrArea(object, object.incrementId);
                return;
            }
        }
        void annotations;
    }

    /**
     * Submit regions as a job.
     *
     * Without arguments this analyses what is selected on the canvas. `roiIds`
     * overrides it with explicit server ids — the context menu's "analyse this
     * region" and the quick-draw mode both mean *this* region, and that
     * precedence is what makes them predictable regardless of the selection.
     */
    async runAnalysis({ roiIds: explicitRoiIds } = {}) {
        if (!this.can("empaia-app-ui.job.run")) {
            Dialogs.show(this.t("jobs.notPermitted"), 5000, Dialogs.MSG_WARN);
            return;
        }
        if (!this._assertRunnable()) return;
        const roiIds = explicitRoiIds ?? this.selectedRegionIds();

        if (!roiIds.length) {
            this._explainNothingToRun();
            return;
        }

        const roiType = this.workbench.getRoiTypes()[0];
        if (!roiType) {
            Dialogs.show(this.t("jobs.noRoiInput"), 6000, Dialogs.MSG_ERR);
            return;
        }

        this.state.busy.val = true;
        this.state.error.val = "";
        try {
            const runner = this.workbench.getJobRunner();
            // The user asked for an analysis, so run it. `autoRun` is read only
            // by the multi-ROI branch (the single-ROI one always runs); gating it
            // on `getRoiMode() === "single"`, as this used to, meant a multi-ROI
            // app got a job that was created and then never started.
            await runner.runStandalone(
                { roiIds, roiType, mode: this.state.mode.val }, { autoRun: true });
        } catch (e) {
            this.state.error.val = this.workbench.describeError(e, this.t("jobs.runFailed"));
            Dialogs.show(this.t("jobs.runFailed"), 6000, Dialogs.MSG_ERR);
        } finally {
            this.state.busy.val = false;
        }
    }

    /**
     * The earlier analysis this step will be built on, if it needs one.
     *
     * Read from the module on every call and re-run by `visibilityRevision`,
     * because the answer *is* the visibility choice: showing a different
     * preprocessing result changes which one the next run consumes.
     */
    sourceJob() {
        void this.state.visibilityRevision.val;
        void this.state.jobs.val;
        return this.workbench.sourceJobFor?.(this.state.mode.val, this.state.activeSlideId.val);
    }

    /** How many earlier analyses could serve — >1 means the choice is real. */
    sourceJobCount() {
        void this.state.jobs.val;
        return this.workbench.sourceJobCandidates?.(
            this.state.mode.val, this.state.activeSlideId.val)?.length ?? 0;
    }

    /**
     * The step this one is built on, and the state of its most recent run.
     *
     * Rendered when there is no usable source job yet — the case the panel used
     * to pass over in silence, leaving "No analyses for this slide yet" as the
     * only clue to why the run button refused. `job` is undefined when nothing of
     * that step has been started at all, which for a platform-run preprocessing
     * step is the difference between "wait" and "this will never happen by itself".
     */
    sourceModeWaiting() {
        void this.state.jobs.val;
        const mode = this.state.mode.val;
        const source = this.workbench.sourceModeFor?.(mode);
        if (!source) return undefined;
        return {
            mode: source,
            job: this.workbench.latestJobOfMode?.(source, this.state.activeSlideId.val),
        };
    }

    // ── the staged batch ────────────────────────────────────────────────────

    /**
     * The draft being assembled for this slide, read from the module on every
     * call. `state.batchRevision` is what makes those reads re-run — the module
     * owns the draft, and a mirror here is one more thing that can disagree with
     * the server.
     */
    batch() {
        void this.state.batchRevision.val;
        return this.workbench.getBatch(this.state.activeSlideId.val);
    }

    batchCount() {
        void this.state.batchRevision.val;
        return this.workbench.getBatchSize(this.state.activeSlideId.val);
    }

    isCurrentBatch(jobId) {
        return !!jobId && this.batch()?.jobId === jobId;
    }

    orphanBatches() {
        void this.state.batchRevision.val;
        void this.state.jobs.val;
        return this.workbench.orphanBatches(this.state.activeSlideId.val);
    }

    /** Stage the canvas selection. */
    async addSelectionToBatch() {
        const ids = this.selectedRegionIds();
        if (!ids.length) {
            this._explainNothingToRun();
            return;
        }
        await this._stageRegions(ids);
    }

    /**
     * Refuse before creating anything when the app cannot be driven here at all.
     *
     * The banner used to be the only place this was said, and no run path
     * consulted it — so the panel could report "this app analyses several slides
     * at once, which this viewer cannot do" while every button cheerfully created
     * a job the backend could only reject at input validation. One gate, read by
     * every entry point, and it shows the module's own sentences.
     *
     * @return true when the mode is runnable
     */
    _assertRunnable(mode = this.state.mode.val) {
        const blockers = this.workbench.runBlockers(mode);
        if (!blockers.length) return true;
        this.state.error.val = blockers.join(" ");
        Dialogs.show(blockers[0], 8000, Dialogs.MSG_WARN);
        return false;
    }

    /**
     * Why nothing can be run.
     *
     * "Select at least one stored region of interest first" is only true when the
     * user selected nothing. Saying it to someone looking at three highlighted
     * regions is what sent this whole surface back for rework — with a selection
     * in hand the answer is what is wrong with it.
     */
    _explainNothingToRun() {
        const selection = this.state.selection.val;
        if (!selection.length) {
            Dialogs.show(this.t("jobs.selectRoiFirst"), 5000, Dialogs.MSG_WARN);
            return;
        }
        const skipped = this.skippedSelection();
        const detail = skipped.length ? this.describeRefusals(skipped) : "";
        Dialogs.show(`${this.t("roi.noneUsable")} ${detail}`.trim(), 6000, Dialogs.MSG_WARN);
    }

    /**
     * Put regions into the draft, creating the staged job on first use.
     *
     * Guarded by the same capability as running: staging posts to the workbench
     * and creates a job record, so it is not a read.
     */
    async _stageRegions(empaiaIds) {
        if (!empaiaIds?.length) return;
        if (!this.can("empaia-app-ui.job.run")) {
            Dialogs.show(this.t("jobs.notPermitted"), 5000, Dialogs.MSG_WARN);
            return;
        }
        if (!this._assertRunnable()) return;
        const roiType = this.workbench.getRoiTypes()[0];
        if (!roiType) {
            Dialogs.show(this.t("jobs.noRoiInput"), 6000, Dialogs.MSG_ERR);
            return;
        }

        this.state.busy.val = true;
        this.state.error.val = "";
        try {
            await this.workbench.addRegionsToBatch(empaiaIds, roiType);
        } catch (e) {
            this.state.error.val = this.workbench.describeError(e, this.t("batch.addFailed"));
        } finally {
            this.state.busy.val = false;
        }
    }

    async runBatch() {
        if (!this.can("empaia-app-ui.job.run")) {
            Dialogs.show(this.t("jobs.notPermitted"), 5000, Dialogs.MSG_WARN);
            return;
        }
        if (!this._assertRunnable()) return;
        if (!this.batchCount()) {
            Dialogs.show(this.t("batch.empty"), 5000, Dialogs.MSG_WARN);
            return;
        }
        this.state.busy.val = true;
        try {
            await this._jobAction("batch.runFailed", () =>
                this.workbench.runBatch(this.state.activeSlideId.val));
        } finally {
            this.state.busy.val = false;
        }
    }

    async discardBatch() {
        await this._jobAction("batch.discardFailed", () =>
            this.workbench.discardBatch(this.state.activeSlideId.val));
    }

    /**
     * One shape for the three job actions: clear the previous error first (a
     * stale banner reads as a fresh failure), and show the backend's own
     * explanation — `"Job has wrong state: ERROR; …"` tells the user something,
     * `HTTP DELETE … failed: 400` does not.
     */
    async _jobAction(fallbackKey, run) {
        this.state.error.val = "";
        try {
            await run(this.workbench.getJobRunner());
        } catch (e) {
            this.state.error.val = this.workbench.describeError(e, this.t(fallbackKey));
        }
    }

    async runJob(jobId) {
        // The staged draft is an ordinary ASSEMBLY row in the analyses list, so
        // its Run button lands here. Route it through the batch or the module
        // keeps a draft pointing at a job that has already run.
        if (this.isCurrentBatch(jobId)) return this.runBatch();
        if (!this._assertRunnable()) return;
        await this._jobAction("jobs.runFailed", runner => runner.run(jobId));
    }

    async stopJob(jobId) {
        const job = this.state.jobs.val.find(j => j.id === jobId);
        if (!this.workbench.canStopJob(job)) {
            Dialogs.show(this.t("jobs.stopNotPossible"), 5000, Dialogs.MSG_WARN);
            return;
        }
        await this._jobAction("jobs.stopFailed", runner => runner.stop(jobId));
    }

    async deleteJob(jobId) {
        if (this.isCurrentBatch(jobId)) return this.discardBatch();
        const job = this.state.jobs.val.find(j => j.id === jobId);
        // The backend deletes only in ASSEMBLY and has no abort route, so a job
        // that has run is pinned to the examination. Say that instead of firing
        // a request that can only come back 400.
        if (!this.workbench.canDeleteJob(job)) {
            Dialogs.show(this.t("jobs.deleteOnlyBeforeRun"), 6000, Dialogs.MSG_WARN);
            return;
        }
        await this._jobAction("jobs.deleteFailed", runner => runner.remove(jobId));
    }

    // ── analyses window & output visibility ─────────────────────────────────

    /**
     * The analyses workspace, built on first use.
     *
     * Lazy because most sessions never open it — and because building it at
     * `pluginReady` would put a floating window on screen before the workbench
     * session has resolved what to put in it.
     */
    showJobsWindow() {
        if (!this._jobsWindow) this._jobsWindow = new JobsWindow(this);
        this._jobsWindow.open();
    }

    /**
     * Which analyses are painted on the slide.
     *
     * Read straight from the module on every call rather than mirrored into a
     * van state: the module is the owner (it also drives the pixel-map layers and
     * the canvas), and a mirror is one more thing that can disagree with the
     * slide. `state.visibilityRevision` is what makes the reads re-run.
     */
    visibleJobIds() {
        void this.state.visibilityRevision.val;
        return this.workbench.getVisibleJobIds(this.state.activeSlideId.val);
    }

    toggleJobOutput(jobId) {
        const visible = !this.visibleJobIds().includes(jobId);
        this._visibilityAction(() =>
            this.workbench.setJobVisible(jobId, visible, this.state.activeSlideId.val));
    }

    showOnlyJobOutput(jobId) {
        this._visibilityAction(() =>
            this.workbench.showOnlyJob(jobId, this.state.activeSlideId.val));
    }

    hideAllOutputs() {
        this._visibilityAction(() =>
            this.workbench.hideAllJobs(this.state.activeSlideId.val));
    }

    /**
     * Paint every analysis the list is currently showing.
     *
     * Bounded on purpose: each one imports its output onto the canvas, and an
     * app that emits thousands of points per run turns "show all" into a frozen
     * tab. Past the cap it shows the newest ones and says how many it left, which
     * is a readable answer — silently painting 40 runs is not.
     */
    showAllOutputs(jobs) {
        const completed = (jobs ?? []).filter(job => job?.status === "COMPLETED");
        if (!completed.length) {
            Dialogs.show(this.t("jobs.noCompleted"), 5000, Dialogs.MSG_WARN);
            return;
        }
        const cap = this.workbench.visibleJobLimit?.() ?? 8;
        const shown = completed.slice(0, cap);
        if (completed.length > shown.length) {
            Dialogs.show(this.t("jobs.showAllCapped",
                { shown: shown.length, total: completed.length }), 6000, Dialogs.MSG_INFO);
        }
        this._visibilityAction(() =>
            this.workbench.showJobs(shown.map(job => String(job.id)), this.state.activeSlideId.val));
    }

    /** Back to the default: the newest finished analysis, and nothing else. */
    showLatestOnly() {
        const latest = this.workbench.latestCompletedJob(this.state.jobs.val);
        if (!latest) {
            Dialogs.show(this.t("jobs.noCompleted"), 5000, Dialogs.MSG_WARN);
            return;
        }
        this.showOnlyJobOutput(latest.id);
    }

    /**
     * A visibility change fetches and imports, so it can fail. Surface it in the
     * panel's error banner rather than leaving the list claiming a state the
     * slide does not have.
     */
    _visibilityAction(run) {
        this.state.error.val = "";
        Promise.resolve()
            .then(run)
            .catch(e => {
                this.state.error.val = this.workbench.describeError(e, this.t("jobs.visibilityFailed"));
                console.warn("empaia-app-ui: analysis visibility change failed", e);
            });
    }

    /**
     * Outputs of one analysis, for the window's detail pane.
     *
     * `job` is the record the window is already rendering. Passing it is what
     * lets the module resolve the app's *declared* outputs: without it the module
     * re-finds the job in the active mode's bucket, and a miss there silently
     * degrades to the flat queries, which resolve no declarations at all.
     */
    loadJobOutputs(jobId, job = undefined) {
        return this.workbench.loadJobOutputs(jobId, this.state.activeSlideId.val, { job });
    }

    /**
     * Fetch an output the size budget withheld.
     *
     * Only ever reached from the user clicking the count, which is the point:
     * a multi-megabyte annotation set is a choice, not a default.
     */
    loadJobOutputsForced(jobId) {
        return this.workbench.loadJobOutputsForced(jobId, this.state.activeSlideId.val);
    }

    /**
     * Move the viewport to what an analysis produced.
     *
     * Only meaningful while that output is on the slide, which is why the window
     * offers it on the annotation count of a *shown* analysis. A run whose output
     * was evicted between render and click says so rather than panning nowhere.
     */
    focusJobOutput(jobId) {
        const framed = this.workbench.focusJobOutput(jobId, this.state.activeSlideId.val);
        if (!framed) Dialogs.show(this.t("results.outputs.focusEmpty"), 4000, Dialogs.MSG_WARN);
    }

    /**
     * Per-region result rows, labelled the way the rest of the UI labels regions.
     *
     * The zip itself is the module's (it needs the EAD); this only names the rows
     * so a region reads the same here as in the region list. A member whose
     * annotation is not on this canvas keeps its positional label rather than
     * showing a raw id.
     */
    regionResults(results) {
        const { columns, rows } = this.workbench.regionResults(results);
        const byEmpaiaId = new Map(
            this.state.rois.val.filter(r => r.empaiaId).map(r => [r.empaiaId, r]));
        return {
            columns,
            rows: rows.map(row => ({ ...row, label: byEmpaiaId.get(row.regionId)?.label })),
        };
    }

    /** How many of an analysis' annotations are on the slide right now. */
    countJobOutput(jobId) {
        return this.workbench.countJobOutput(jobId, this.state.activeSlideId.val);
    }

    /** This analysis finished, but its output has not come back yet. */
    isAwaitingOutputs(jobId) {
        return this.workbench.isAwaitingOutputs(jobId);
    }

    /** Read an output that has not arrived yet, now — and import what comes back. */
    retryJobOutputs(jobId, job = undefined) {
        return this.workbench.retryJobOutputs(jobId, this.state.activeSlideId.val, { job });
    }

    /**
     * Per-annotation values, aggregated, with a hard cap on what gets listed.
     *
     * The cap is a *deployment* limit on DOM this window will build, not a user
     * preference, so it comes from `getStaticMeta` (AGENTS.md §3/§7). Its job is
     * a real detector: one value per nucleus is tens of thousands of rows, and
     * the summary says everything a scan of them would.
     */
    summarizeAnnotationValues(primitives) {
        const declared = Number(this.getStaticMeta("annotationValueRows", 200));
        const limit = Number.isFinite(declared) && declared >= 0 ? declared : 200;
        return this.workbench.summarizeAnnotationValues(primitives, limit);
    }

    /**
     * Move the viewport to the regions an analysis was run on.
     *
     * These are the user's own annotations, so they are on the slide whenever
     * the slide is — unless they were drawn in a session whose annotations are
     * not hydrated here, which is what the empty case reports.
     */
    focusAnnotations(empaiaIds) {
        const framed = this.workbench.focusAnnotations(empaiaIds ?? [], this.state.activeSlideId.val);
        if (!framed) Dialogs.show(this.t("results.inputs.focusEmpty"), 4000, Dialogs.MSG_WARN);
    }

    /**
     * A dot in the app bar while anything is running, so a run started from the
     * canvas context menu is visible without opening anything.
     */
    _updateRunningBadge() {
        const bar = USER_INTERFACE.AppBar;
        const running = this.state.jobs.val.filter(job => RUNNING_STATUSES.has(job.status)).length;
        if (!running) {
            if (bar.hasBadge?.("empaia.analyses")) bar.removeBadge("empaia.analyses");
            return;
        }
        const options = {
            label: String(running),
            color: "info",
            dot: true,
            pulse: true,
            title: this.t("jobs.runningBadge", { count: running }),
            onClick: () => this.showJobsWindow(),
        };
        if (bar.hasBadge?.("empaia.analyses")) bar.updateBadge("empaia.analyses", options);
        else bar.addBadge("empaia.analyses", options);
    }

    // ── pixelmap controls ───────────────────────────────────────────────────

    setPixelmapColorMap(pixelmapId, name) {
        this.workbench.getPixelmapSource(pixelmapId)?.setColorMap(name);
        this._repaint();
    }

    setPixelmapChannel(pixelmapId, channel) {
        this.workbench.getPixelmapSource(pixelmapId)?.setChannel(Number(channel) || 0);
        this._repaint();
    }

    setPixelmapInverted(pixelmapId, inverted) {
        this.workbench.getPixelmapSource(pixelmapId)?.setInverted(!!inverted);
        this._repaint();
    }

    /**
     * Zoom to a magnification at which this pixel map actually has data.
     *
     * An analysis may write only some of the slide's levels — TA13 writes just
     * the full-resolution one — and at any coarser zoom the overlay is blank by
     * construction. Rather than explain that in prose, take the user there.
     *
     * The viewer comes from the slide, never `window.VIEWER`: the examination can
     * be open in more than one viewport and the focused one need not be this
     * map's (`AGENTS.md` §6).
     */
    zoomToPixelmapDetail(pixelmapId) {
        const source = this.workbench.getPixelmapSource(pixelmapId);
        if (!source?.getTileHealth) return;
        const viewer = this.workbench.getViewersForSlide?.(this.state.activeSlideId.val)?.[0];
        const viewport = viewer?.viewport;
        if (!viewport) return;

        // `levels` are server levels, 0 = finest. Having any at all means there is
        // a magnification worth going to; the finest declared one is it.
        const levels = source.getTileHealth().levels ?? [];
        if (!levels.length) return;
        viewport.zoomTo(viewport.getMaxZoom());
        viewport.applyConstraints();
    }

    /**
     * A colour/channel change bumps the source's render token, so its tile
     * hash keys change and already-drawn tiles must be dropped. Reset only the
     * tiled images backed by a pixelmap source — resetting the whole world
     * would throw away the slide's tiles too.
     */
    _repaint() {
        for (const viewer of (VIEWER_MANAGER.viewers ?? [])) {
            const world = viewer?.world;
            if (!world) continue;
            let touched = false;
            for (let i = 0; i < world.getItemCount(); i++) {
                const item = world.getItemAt(i);
                const id = item?.source?.tileSourceId;
                if (typeof id === "string" && id.startsWith("empaia-pixelmap:")) {
                    item.reset?.();
                    touched = true;
                }
            }
            if (touched) viewer.forceRedraw?.();
        }
    }
});
