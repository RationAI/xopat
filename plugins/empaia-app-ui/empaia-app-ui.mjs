import { createEmpaiaPanel } from "./panel.mjs";
import { JobsWindow } from "./jobs-window.mjs";
import { RUNNING_STATUSES } from "./sections/job-status.mjs";
import { QUICK_ROI_MODE_ID, registerQuickRoiMode } from "./quick-roi-mode.mjs";

const { div } = globalThis.van.tags;

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
            selectedRoiIds: van.state([]),     // incrementIds
            jobs: van.state([]),
            // Bumped whenever the module reports a change in which analyses are
            // painted. The set itself is NOT mirrored here: the module owns it,
            // and a second copy is a second thing to keep in step.
            visibilityRevision: van.state(0),
            busy: van.state(false),
            error: van.state(""),
        };

        this._roiObjects = new Map();          // incrementId -> fabric object
        // Regions drawn in quick mode, waiting for a server id before the analysis
        // can name them as inputs.
        this._pendingQuickRun = new Set();      // incrementIds
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
        });
        wb.addHandler("job-visibility-changed", (e) => {
            if (e?.slideId !== this.state.activeSlideId.val) return;
            this.state.visibilityRevision.val = this.state.visibilityRevision.val + 1;
        });
        // The moment a region actually exists upstream. Until then it has no id a
        // job could name, which is why the row shows as pending and quick-mode
        // analyses wait here rather than firing on a local-only object.
        wb.addHandler("annotation-linked", (e) => {
            const incrementId = e?.incrementId !== undefined ? String(e.incrementId) : "";
            if (!incrementId || !this._roiObjects.has(incrementId)) return;
            this._updateRoi(incrementId, { empaiaId: e.empaiaId, pending: !e.empaiaId, error: undefined });
            if (e.empaiaId && this._pendingQuickRun.delete(incrementId)) {
                this.runAnalysis({ roiIds: [e.empaiaId] });
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

        // Preprocessing is read-only for the user, so an incompatible-EAD
        // warning there would be noise — only ROI-creating modes are checked.
        const ead = wb.getEad();
        if (ead && wb.getActiveMode() !== "preprocessing") {
            const report = wb.checkModeCompatibility?.(wb.getActiveMode());
            this.state.incompatibility.val = report && report.incompatible ? report : undefined;
        } else {
            this.state.incompatibility.val = undefined;
        }
    }

    _resetSlideScopedState() {
        this.state.rois.val = [];
        this.state.selectedRoiIds.val = [];
        // The new slide's list arrives from the module (which keeps one per
        // slide); until it does, showing the previous slide's analyses would be
        // a lie about what is on screen.
        this.state.jobs.val = this.workbench.getJobs(this.state.activeSlideId.val);
        this.state.visibilityRevision.val = this.state.visibilityRevision.val + 1;
        this._roiObjects.clear();
        this._pendingQuickRun.clear();
        this._updateRunningBadge();
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
            }
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

        this._roiObjects.set(incrementId, object);
        if (this.state.rois.val.some(r => r.incrementId === incrementId)) return incrementId;

        const empaiaId = object.empaiaId ?? this.workbench.empaiaIdOf(incrementId);
        this.state.rois.val = [...this.state.rois.val, {
            incrementId,
            empaiaId,
            label: this._roiLabel(object),
            pending: !empaiaId,
        }];
        // A freshly drawn (or freshly assigned) region is what the user wants to
        // analyse; a hydrated one is history and stays unselected.
        if (!empaiaId) this.state.selectedRoiIds.val = [...this.state.selectedRoiIds.val, incrementId];
        return incrementId;
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
        const alive = new Set();
        for (const object of objects) {
            if (object?.presetID !== roiPresetId) continue;
            const incrementId = this._adoptRoi(object);
            if (incrementId) alive.add(incrementId);
        }
        for (const incrementId of [...this._roiObjects.keys()]) {
            if (!alive.has(incrementId)) this._releaseRoi(incrementId);
        }
    }

    /** Drop an annotation from the region list (it was deleted, or is no longer a ROI). */
    _releaseRoi(incrementId) {
        if (!incrementId || !this._roiObjects.has(incrementId)) return false;
        this._roiObjects.delete(incrementId);
        this.state.rois.val = this.state.rois.val.filter(r => r.incrementId !== incrementId);
        this.state.selectedRoiIds.val = this.state.selectedRoiIds.val.filter(x => x !== incrementId);
        return true;
    }

    _updateRoi(incrementId, patch) {
        this.state.rois.val = this.state.rois.val.map(r =>
            r.incrementId === incrementId ? { ...r, ...patch } : r);
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

            const object = ctx.active ?? this._hitTest(ctx);
            if (this.workbench.isJobOwned(object)) {
                // The one place the user can act on this annotation is the
                // analyses window, so offer it instead of only naming it.
                return [
                    unavailable(this.t("roi.analyseThis"), "ph-play-circle", this.t("roi.jobOwned")),
                    showAnalyses,
                ];
            }

            const roi = this._roiEntryFor(object);
            if (roi) {
                if (!roi.empaiaId) {
                    return [unavailable(this.t("roi.analyseThis"), "ph-play-circle",
                        this.t(roi.pending ? "roi.stillSaving" : "roi.notSaved"))];
                }
                return [{
                    title: this.t("roi.analyseThis"),
                    icon: "ph-play-circle",
                    action: () => this.runAnalysis({ roiIds: [roi.empaiaId] }),
                }];
            }

            const hasSelection = this.state.rois.val
                .some(r => this.state.selectedRoiIds.val.includes(r.incrementId) && r.empaiaId);
            return [
                {
                    title: this.t("roi.draw"),
                    icon: "ph-selection-plus",
                    action: () => this.startDrawing(),
                },
                hasSelection
                    ? { title: this.t("roi.run"), icon: "ph-play", action: () => this.runAnalysis() }
                    : unavailable(this.t("roi.run"), "ph-play", this.t("jobs.selectRoiFirst")),
                showAnalyses,
            ];
        }, 15);
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

    /** The region-list row an annotation belongs to, if it is one of ours. */
    _roiEntryFor(object) {
        const incrementId = object?.incrementId !== undefined ? String(object.incrementId) : "";
        if (!incrementId) return undefined;
        return this.state.rois.val.find(r => r.incrementId === incrementId);
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

    startDrawing() {
        const types = this.workbench.getRoiTypes();
        this.workbench.activateRoiTool(types[0]);
    }

    toggleRoiSelection(incrementId) {
        const current = this.state.selectedRoiIds.val;
        this.state.selectedRoiIds.val = current.includes(incrementId)
            ? current.filter(x => x !== incrementId)
            : [...current, incrementId];
    }

    focusRoi(incrementId) {
        const object = this._roiObjects.get(incrementId);
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
     * Without arguments this analyses the panel's selection. `roiIds` overrides
     * it with explicit server ids — the context menu's "analyse this region" and
     * the quick-draw mode both mean *this* region, not whatever happens to be
     * ticked in a panel the user is not looking at.
     */
    async runAnalysis({ roiIds: explicitRoiIds } = {}) {
        if (!this.can("empaia-app-ui.job.run")) {
            Dialogs.show(this.t("jobs.notPermitted"), 5000, Dialogs.MSG_WARN);
            return;
        }
        const selected = this.state.selectedRoiIds.val;
        const roiIds = explicitRoiIds ?? this.state.rois.val
            .filter(r => selected.includes(r.incrementId) && r.empaiaId)
            .map(r => r.empaiaId);

        if (!roiIds.length) {
            Dialogs.show(this.t("jobs.selectRoiFirst"), 5000, Dialogs.MSG_WARN);
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

    /** Outputs of one analysis, for the window's detail pane. */
    loadJobOutputs(jobId) {
        return this.workbench.loadJobOutputs(jobId, this.state.activeSlideId.val);
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

    /** How many of an analysis' annotations are on the slide right now. */
    countJobOutput(jobId) {
        return this.workbench.countJobOutput(jobId, this.state.activeSlideId.val);
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
