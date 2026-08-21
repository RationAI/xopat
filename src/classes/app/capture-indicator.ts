/**
 * Capture indicator — makes off-screen pixel reads visible on the slide.
 *
 * Analysis features (pathology exploration, "analyze this region", vision-model
 * screenshots) render through the standalone drawer WITHOUT moving the user's
 * viewport, so nothing on screen ever told the user that a region was read, which
 * region it was, or which parts of the slide have already been looked at.
 *
 * `src/classes/scripting/visualization-api.ts` announces every such read as the
 * viewer-level `region-capture` event (see src/EVENTS.md). This controller is the
 * only consumer that renders it: an OpenSeadragon overlay rectangle per capture —
 * bright while the pass is in flight, fading to a faint outline afterwards so the
 * accumulated coverage stays readable.
 *
 * The markers are a view of a RUNNING analysis, not an annotation: once nothing has
 * been captured for `setup.captureIndicatorIdleMs`, the drawn trail fades out and the
 * viewer is clean again. Captures covering essentially the whole slide (the orientation
 * pass) only flash — a full-frame rectangle says nothing about which part was read.
 * `getLog()` keeps the record either way.
 *
 * Modes: `"off"` (render nothing), `"flash"` (in-flight only), `"trail"` (in-flight
 * plus bounded history). Reached as `APPLICATION_CONTEXT.captureIndicator`.
 *
 * Known limitation: OSD rectangle overlays are axis-aligned in viewport space and do
 * not follow viewport rotation — a rotated viewport draws the marker unrotated.
 */

type CaptureMode = "off" | "flash" | "trail";

type CaptureEntry = {
    captureId: string;
    kind: "region" | "viewport";
    region?: RegionCaptureRect;
    refIndex?: number;
    label?: string;
    ok?: boolean;
    error?: string;
    t: number;
    hits: number;
    /** Coalescing key — identical geometry + label reuses one marker. */
    key: string;
    element: HTMLElement | null;
};

/** A completed capture as remembered by `getLog` — no DOM, survives the visual clear. */
type LogEntry = Omit<CaptureEntry, "element">;

type ViewerState = {
    viewer: any;
    /** Captures currently queued/running, by captureId. */
    live: Map<string, CaptureEntry>;
    /** Completed captures still DRAWN, oldest first. Bounded by TRAIL_LIMIT. */
    trail: CaptureEntry[];
    /** Completed captures RECORDED, oldest first. Outlives the drawn trail. */
    log: LogEntry[];
    /** Armed once nothing is in flight; clears the drawn trail when it fires. */
    idleTimer: ReturnType<typeof setTimeout> | null;
    handlers: Array<[string, (e: any) => void]>;
};

/** How many completed markers stay drawn (and logged) per viewer. Oldest are dropped first. */
const TRAIL_LIMIT = 150;
/** How long a `flash`-mode marker lingers after the capture ends (ms). */
const FLASH_LINGER_MS = 900;
/** Must match the `.xo-capture-rect.is-fading` transition in style.css. */
const FADE_OUT_MS = 400;
/**
 * A region this close to covering the whole slide answers "which part was analyzed?"
 * with "all of it" — useless as a trail entry, and as a full-viewport rectangle it is
 * exactly the marker that overstays its welcome. Flashed, never trailed.
 */
const FULL_SLIDE_COVERAGE = 0.8;
/** Label text is user/script-supplied — cap what we render. */
const LABEL_MAX = 60;
const VALID_MODES: CaptureMode[] = ["off", "flash", "trail"];

export class CaptureIndicator implements CaptureIndicatorLike {
    private static _instance: CaptureIndicator | null = null;

    private _mode: CaptureMode | null = null;
    private _idleClearMs: number | null = null;
    /** Mode restored by the View toggle / hide-UI button when switching back on. */
    private _lastVisibleMode: CaptureMode = "trail";
    private _menuRegistered = false;
    private _viewerManager: any = null;
    private _states = new Map<any, ViewerState>();

    private constructor() {}

    /** Lazy singleton accessor. */
    static instance(): CaptureIndicator {
        if (!CaptureIndicator._instance) {
            CaptureIndicator._instance = new CaptureIndicator();
        }
        return CaptureIndicator._instance;
    }

    /**
     * Current mode. Read from the deployment/user setup on first access — the config
     * is not available yet when the application context is constructed.
     */
    get mode(): CaptureMode {
        if (this._mode === null) {
            // No caller default: `setup.captureIndicator` in src/config.json is the
            // single declaration of the default (AGENTS.md §3).
            const raw = (window as any).APPLICATION_CONTEXT?.getOption?.("captureIndicator");
            const resolved: CaptureMode = VALID_MODES.includes(raw) ? raw : "trail";
            this._mode = resolved;
            if (resolved !== "off") this._lastVisibleMode = resolved;
        }
        return this._mode;
    }

    /**
     * How long after the LAST capture ends the drawn trail is removed. The markers track a
     * running analysis; once it is over they are just clutter over the slide (a whole-slide
     * survey rectangle especially). The recorded log is unaffected.
     */
    private get idleClearMs(): number {
        if (this._idleClearMs === null) {
            const raw = Number((window as any).APPLICATION_CONTEXT?.getOption?.("captureIndicatorIdleMs"));
            this._idleClearMs = Number.isFinite(raw) && raw >= 0 ? raw : 6000;
        }
        return this._idleClearMs;
    }

    /**
     * @param mode target mode
     * @param opts `persist: false` changes the mode for this session only — used by the
     *   hide-UI button, which must not overwrite the user's own preference (the
     *   VisibilityManager `on()`/`off()` contract, see ui/services/README.md).
     */
    setMode(mode: CaptureMode, opts: { persist?: boolean } = {}): void {
        if (!VALID_MODES.includes(mode)) return;
        if (mode !== "off") this._lastVisibleMode = mode;
        this._mode = mode;
        if (opts.persist !== false) {
            try {
                (window as any).APPLICATION_CONTEXT?.setOption?.("captureIndicator", mode, true);
            } catch (e) { /* preference persistence is best-effort */ }
        }
        if (mode === "off") this.clear();
        else if (mode === "flash") {
            for (const state of this._states.values()) this._dropTrail(state);
        }
        this._notifyMenu();
    }

    /**
     * Expose the on/off switch in the app bar's View menu (which also enrols it in
     * `AppBar.Actions`, so it can be pinned as a quick action). The mode granularity
     * (flash vs trail) stays a config knob — the menu only answers "show me / don't".
     */
    registerViewToggle(): void {
        const View: any = (window as any).USER_INTERFACE?.AppBar?.View;
        if (!View?.append || this._menuRegistered) return;
        this._menuRegistered = true;
        const indicator = this;
        View.append(
            "core.captureIndicator",
            "ph-selection-plus",
            $.t("main.bar.captureIndicator"),
            {
                is: () => indicator.mode !== "off",
                on: () => indicator.setMode(indicator._lastVisibleMode, { persist: false }),
                off: () => indicator.setMode("off", { persist: false }),
                set: (value: boolean) => indicator.setMode(value ? indicator._lastVisibleMode : "off"),
                toggle: () => indicator.setMode(indicator.mode === "off" ? indicator._lastVisibleMode : "off")
            }
        );
    }

    private _notifyMenu(): void {
        // Keep the View dropdown's checkmark in sync when the mode changes from elsewhere
        // (a script, the config, another registrant).
        try { (window as any).USER_INTERFACE?.AppBar?.View?._notify?.(); } catch (e) { /* menu not built yet */ }
    }

    /** Follow the viewer grid: sweep the open viewers and track later ones. */
    attachViewerManager(viewerManager: any): void {
        if (!viewerManager || this._viewerManager) return;
        this._viewerManager = viewerManager;
        for (const viewer of viewerManager.viewers || []) this._attach(viewer);
        viewerManager.addHandler?.("viewer-create", (e: any) => this._attach(e?.viewer || e?.eventSource));
        viewerManager.addHandler?.("viewer-destroy", (e: any) => this._detach(e?.viewer || e?.eventSource));
    }

    /**
     * Bounded, newest-last capture history for one viewer. Independent of what is
     * currently DRAWN — the markers clear themselves once the analysis goes idle, the
     * record of which regions were read does not.
     */
    getLog(viewer: any): Array<RegionCaptureEvent & { t: number; hits: number }> {
        const state = this._states.get(viewer);
        if (!state) return [];
        const strip = (e: LogEntry) => ({
            captureId: e.captureId,
            phase: "end" as const,
            kind: e.kind,
            region: e.region,
            refIndex: e.refIndex,
            label: e.label,
            ok: e.ok,
            error: e.error,
            t: e.t,
            hits: e.hits
        });
        return [...state.log.map(strip), ...[...state.live.values()].map(strip)];
    }

    clear(viewer?: any): void {
        if (viewer) {
            const state = this._states.get(viewer);
            if (state) this._clearState(state);
            return;
        }
        for (const state of this._states.values()) this._clearState(state);
    }

    // ── wiring ───────────────────────────────────────────────────────────────

    private _attach(viewer: any): void {
        if (!viewer || this._states.has(viewer)) return;
        const state: ViewerState = { viewer, live: new Map(), trail: [], log: [], idleTimer: null, handlers: [] };
        this._states.set(viewer, state);

        const onCapture = (e: any) => this._onCapture(state, e);
        // A slide swap invalidates every recorded region: the coordinates belong to the
        // old source. Drop the whole trail rather than float stale rectangles over new pixels.
        const onClose = () => this._clearState(state);
        state.handlers.push(["region-capture", onCapture], ["close", onClose]);
        viewer.addHandler?.("region-capture", onCapture);
        viewer.addHandler?.("close", onClose);
    }

    private _detach(viewer: any): void {
        const state = this._states.get(viewer);
        if (!state) return;
        this._clearState(state);
        for (const [name, handler] of state.handlers) {
            try { viewer.removeHandler?.(name, handler); } catch (e) { /* viewer already gone */ }
        }
        this._states.delete(viewer);
    }

    // ── event handling ───────────────────────────────────────────────────────

    private _onCapture(state: ViewerState, e: RegionCaptureEvent): void {
        if (this.mode === "off" || !e?.captureId) return;
        try {
            if (e.phase === "end") this._onEnd(state, e);
            else this._onLive(state, e);
        } catch (err) {
            // The indicator is diagnostics — never let it break the capture path.
            console.warn("[capture-indicator] failed to render a capture marker:", err);
        }
    }

    private _onLive(state: ViewerState, e: RegionCaptureEvent): void {
        let entry = state.live.get(e.captureId);
        if (!entry) {
            const key = this._keyOf(e);
            // Re-reading the same region (a re-ask, a repeated depth pass) reuses the
            // marker already drawn for it instead of stacking identical rectangles.
            const reused = state.trail.find(t => t.key === key);
            if (reused) {
                this._removeFromTrail(state, reused, { keepElement: true });
                reused.captureId = e.captureId;
                reused.hits++;
                reused.t = Date.now();
                entry = reused;
            } else {
                entry = {
                    captureId: e.captureId,
                    kind: e.kind,
                    region: e.region,
                    refIndex: e.refIndex,
                    label: e.label,
                    t: Date.now(),
                    hits: 1,
                    key,
                    element: null
                };
            }
            state.live.set(e.captureId, entry);
        }
        // Activity resumed — the run is not over after all, so hold the trail.
        this._disarmIdleClear(state);
        if (!entry.element) entry.element = this._mount(state, entry);
        this._setState(entry.element, e.phase === "start" ? "is-active" : "is-queued");
    }

    private _onEnd(state: ViewerState, e: RegionCaptureEvent): void {
        const entry = state.live.get(e.captureId);
        if (!entry) return;
        state.live.delete(e.captureId);
        entry.ok = e.ok !== false;
        entry.error = e.error;
        entry.t = Date.now();
        this._setState(entry.element, entry.ok ? "is-done" : "is-error");
        this._record(state, entry);

        // Two reads that cover everything: a whole-viewport grab, and a region that is
        // essentially the whole slide (the orientation/survey pass). Neither says WHICH
        // part was analyzed, and as a full-frame rectangle both sit in the user's way.
        // Flash and drop — they stay in the log either way.
        if (this.mode === "flash" || entry.kind === "viewport" || this._isNearFullSlide(state.viewer, entry)) {
            const element = entry.element;
            entry.element = null;
            setTimeout(() => this._unmount(state, element), FLASH_LINGER_MS);
            this._armIdleClear(state);
            return;
        }
        state.trail.push(entry);
        while (state.trail.length > TRAIL_LIMIT) {
            const dropped = state.trail.shift();
            if (dropped) this._unmount(state, dropped.element);
        }
        this._armIdleClear(state);
    }

    /** Append to the bounded audit log, merging a repeat read of the same region. */
    private _record(state: ViewerState, entry: CaptureEntry): void {
        const { element, ...record } = entry;
        const at = state.log.findIndex(l => l.key === record.key);
        if (at >= 0) {
            state.log[at] = { ...record, hits: state.log[at]!.hits + 1 };
            return;
        }
        state.log.push({ ...record });
        while (state.log.length > TRAIL_LIMIT) state.log.shift();
    }

    // ── idle clearing ────────────────────────────────────────────────────────

    /**
     * Nothing is in flight: the analysis looks finished, so remove the drawn markers
     * shortly after. Re-armed on every completion, cancelled by any new capture.
     */
    private _armIdleClear(state: ViewerState): void {
        this._disarmIdleClear(state);
        if (state.live.size || !state.trail.length) return;
        state.idleTimer = setTimeout(() => {
            state.idleTimer = null;
            this._fadeOutTrail(state);
        }, this.idleClearMs);
    }

    private _disarmIdleClear(state: ViewerState): void {
        if (state.idleTimer === null) return;
        clearTimeout(state.idleTimer);
        state.idleTimer = null;
    }

    private _fadeOutTrail(state: ViewerState): void {
        const fading = state.trail.splice(0, state.trail.length);
        for (const entry of fading) {
            if (entry.element) entry.element.classList.add("is-fading");
        }
        setTimeout(() => {
            for (const entry of fading) this._unmount(state, entry.element);
        }, FADE_OUT_MS);
    }

    /**
     * True when the captured region covers essentially the whole slide. Degrades to
     * false whenever the slide dimensions are unknown — a marker too many is better
     * than silently dropping a genuine region.
     */
    private _isNearFullSlide(viewer: any, entry: CaptureEntry): boolean {
        const r = entry.region;
        if (!r || !(r.width > 0) || !(r.height > 0)) return false;
        const index = Number.isInteger(entry.refIndex) ? Number(entry.refIndex) : 0;
        const ref = viewer?.world?.getItemAt?.(index) || viewer?.world?.getItemAt?.(0);
        const size = ref?.getContentSize?.() || ref?.source?.dimensions;
        const width = Number(size?.x), height = Number(size?.y);
        if (!(width > 0) || !(height > 0)) return false;
        return (r.width * r.height) / (width * height) >= FULL_SLIDE_COVERAGE;
    }

    // ── rendering ────────────────────────────────────────────────────────────

    private _mount(state: ViewerState, entry: CaptureEntry): HTMLElement | null {
        const location = this._locationOf(state.viewer, entry);
        if (!location) return null;
        const element = this._makeElement(entry);
        try {
            // OSD deduplicates overlays by ELEMENT IDENTITY, not by id (see loader.ts
            // toggleDemoPage) — every marker therefore gets its own fresh element.
            state.viewer.addOverlay({ element, location });
        } catch (e) {
            console.warn("[capture-indicator] addOverlay failed:", e);
            return null;
        }
        return element;
    }

    private _unmount(state: ViewerState, element: HTMLElement | null): void {
        if (!element) return;
        try { state.viewer.removeOverlay?.(element); } catch (e) { /* viewer closed */ }
    }

    private _makeElement(entry: CaptureEntry): HTMLElement {
        const element = document.createElement("div");
        element.className = "xo-capture-rect";
        if (entry.kind === "viewport") element.classList.add("is-viewport");
        const label = typeof entry.label === "string" ? entry.label.trim() : "";
        if (label) {
            const badge = document.createElement("span");
            badge.className = "xo-capture-rect__label";
            // textContent, never innerHTML: the label can originate from a session-supplied
            // script and is therefore untrusted (AGENTS.md §7).
            badge.textContent = label.length > LABEL_MAX ? label.slice(0, LABEL_MAX - 1) + "…" : label;
            element.appendChild(badge);
        }
        return element;
    }

    private _setState(element: HTMLElement | null, stateClass: string): void {
        if (!element) return;
        element.classList.remove("is-queued", "is-active", "is-done", "is-error");
        element.classList.add(stateClass);
    }

    /**
     * Overlay location: a viewport-space rectangle, so the marker tracks pan/zoom with
     * no per-frame work. Region coordinates are level-0 image pixels of `refIndex`.
     */
    private _locationOf(viewer: any, entry: CaptureEntry): any {
        const osd: any = (globalThis as any).OpenSeadragon;
        if (!osd) return null;
        if (entry.kind === "viewport" || !entry.region) {
            // Whole visible frame, in viewport coordinates.
            const bounds = viewer.viewport?.getBounds?.(true);
            return bounds ? new osd.Rect(bounds.x, bounds.y, bounds.width, bounds.height) : null;
        }
        const world = viewer.world;
        const index = Number.isInteger(entry.refIndex) ? Number(entry.refIndex) : 0;
        const ref = world?.getItemAt?.(index) || viewer.scalebar?.getReferencedTiledImage?.() || world?.getItemAt?.(0);
        if (!ref?.imageToViewportRectangle) return null;
        const r = entry.region;
        return ref.imageToViewportRectangle(new osd.Rect(r.x, r.y, r.width, r.height));
    }

    // ── bookkeeping ──────────────────────────────────────────────────────────

    private _keyOf(e: RegionCaptureEvent): string {
        const r = e.region;
        const geometry = r
            ? `${Math.round(r.x)}:${Math.round(r.y)}:${Math.round(r.width)}:${Math.round(r.height)}`
            : "viewport";
        return `${e.kind}|${geometry}|${e.label || ""}`;
    }

    private _removeFromTrail(state: ViewerState, entry: CaptureEntry, opts: { keepElement?: boolean } = {}): void {
        const at = state.trail.indexOf(entry);
        if (at >= 0) state.trail.splice(at, 1);
        if (!opts.keepElement) this._unmount(state, entry.element);
    }

    private _dropTrail(state: ViewerState): void {
        for (const entry of state.trail) this._unmount(state, entry.element);
        state.trail.length = 0;
    }

    /** Full reset: markers AND the record. Used on slide swap, teardown and `clear()`. */
    private _clearState(state: ViewerState): void {
        this._disarmIdleClear(state);
        this._dropTrail(state);
        for (const entry of state.live.values()) this._unmount(state, entry.element);
        state.live.clear();
        state.log.length = 0;
    }
}
