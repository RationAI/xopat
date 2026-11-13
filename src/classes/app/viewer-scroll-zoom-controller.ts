/**
 * Per-viewer wheel authority. Installed as `viewer.__scrollZoomController`
 * next to `__rotationController` / `__joystickController` / `__depthController`.
 *
 * ## Why xOpat owns the wheel
 *
 * OpenSeadragon collapses the wheel delta to `±1` before raising `canvas-scroll`
 * (`MouseTracker.handleWheelEvent`, with an upstream TODO admitting accumulation
 * is missing). After that quantization a mouse notch (`deltaY ≈ ±120`) and a
 * trackpad micro-tick (`deltaY ≈ ±3`) are indistinguishable, so OSD tames
 * trackpads with a *drop* gate (`minScrollDeltaTime`) — which also caps how fast
 * a mouse wheel can zoom, because the extra events of a fast spin are discarded
 * rather than accumulated.
 *
 * This controller reads the magnitude off `e.originalEvent` (a real `WheelEvent`,
 * untouched by the quantization) and converts it to fractional *notches*:
 *
 *  - continuous zoom applies `zoomPerScroll ^ notches` — one mouse notch is one
 *    full step, a burst of five is five steps at once, a trackpad tick is a
 *    fractional power, i.e. smooth. Nothing is throttled because nothing is lost.
 *  - discrete targets (magnification snap, z-stack planes) accumulate fractional
 *    notches and fire once per whole notch, so a trackpad gesture advances one
 *    level while a fast spin advances as many levels as were turned.
 *
 * `minScrollDeltaTime` must be 0 (set in `ENV.openSeadragonConfiguration`),
 * otherwise OSD drops events before this controller ever sees them.
 *
 * Every handled path sets `e.preventDefaultAction = true`: the controller
 * computes the zoom itself and OSD's own `zoomBy` would double it.
 *
 * ## Modifiers mean the same thing in every mode
 *
 * The z-stack wheel modifier is a remappable modifier-only binding
 * (`core.viewport.zDepthWheel`, default Primary or Alt), the wheel twin of
 * Primary+drag rotation. Embedded viewers (`scrollRequiresClick`) therefore do
 * NOT gate on a modifier, as Ctrl+wheel would then mean "zoom" there and
 * "focal plane" elsewhere; they gate on a click into the viewer instead and
 * release on pointer leave, after which the wheel behaves exactly as standalone.
 *
 * Trackpad pinch arrives as a `wheel` event with a synthetic `ctrlKey`. The
 * physical Control state is tracked from key and pointer events, and a
 * `ctrlKey` the keyboard never pressed is treated as a pinch, which zooms.
 */

/** Wheel pixels that constitute one notch on a conventional mouse. */
const DEFAULT_PIXELS_PER_NOTCH = 120;
/** A gesture pause longer than this discards leftover fractional notches. */
const IDLE_RESET_MS = 250;
/** Anti-hammering ceiling: one wheel event never zooms further than this. */
const MAX_NOTCHES_PER_EVENT = 8;
/** How often the "click to use the wheel" hint may be shown, in ms. */
const HINT_INTERVAL_MS = 8000;

/** Shortcut id of the modifier-only binding that turns the wheel into focal-plane steps. */
export const Z_WHEEL_SHORTCUT_ID = "core.viewport.zDepthWheel";

/**
 * Physical Control key state, shared by all viewers. Key events report it
 * truthfully, and so do pointer events (pinch emits no pointermove), which
 * covers a Control pressed while keyboard focus sat elsewhere.
 */
let physicalCtrl = false;
let ctrlTrackerInstalled = false;
function installCtrlTracker(): void {
    if (ctrlTrackerInstalled || typeof window === "undefined") return;
    ctrlTrackerInstalled = true;
    const track = (e: KeyboardEvent | PointerEvent) => { physicalCtrl = !!e.ctrlKey; };
    const opts = { capture: true, passive: true };
    window.addEventListener("keydown", track, opts);
    window.addEventListener("keyup", track, opts);
    window.addEventListener("pointermove", track, opts);
    window.addEventListener("pointerdown", track, opts);
    window.addEventListener("blur", () => { physicalCtrl = false; });
}

export class ViewerScrollZoomController {
    private readonly viewer: any;
    private element: HTMLElement | null = null;

    // Cached option values — this runs on the wheel hot path.
    private scrollRequiresClick = false;
    private reverseScroll = false;
    private snapZoomToMagnification = true;
    private scrollSpeed = 1;
    private pixelsPerNotch = DEFAULT_PIXELS_PER_NOTCH;

    /** Leftover fractional notches of the discrete (snap / z-stack) paths. */
    private accum = 0;
    private lastEventAt = 0;
    private lastHintAt = 0;
    /** Embedded mode: the wheel belongs to the viewer since the last press inside it. */
    private engaged = false;

    private readonly onCanvasScroll = (e: any) => this.handleScroll(e);
    private readonly onEngage = () => { this.engaged = true; };
    private readonly onDisengage = () => { this.engaged = false; };

    constructor(viewer: any) {
        this.viewer = viewer;
        this.refresh();
        // Priority 100: OSD dispatches handlers through a promise chain and only
        // the first one runs synchronously (`openseadragon.js:3860`), yet it reads
        // `preventDefaultAction` immediately after raising the event
        // (`openseadragon.js:12561`). A non-first handler would set the flag too
        // late and OSD would zoom on top of us.
        viewer?.addHandler?.("canvas-scroll", this.onCanvasScroll, null, 100);
        // Native events, not OSD's canvas-press: a tool that grabs the pointer
        // (annotation drawing) disables OSD mouse-nav, yet its press still
        // means the user is working in this viewer.
        this.element = (viewer?.element as HTMLElement) || null;
        this.element?.addEventListener("pointerdown", this.onEngage, { capture: true, passive: true });
        this.element?.addEventListener("pointerleave", this.onDisengage, { passive: true });
        installCtrlTracker();
    }

    /** Re-read the user options. Called from the Settings panel on change. */
    refresh(): void {
        const app = (window as any).APPLICATION_CONTEXT;
        if (!app?.getOption) return;
        // `scrollRequiresCtrl` is the former name of the same embedding switch.
        this.scrollRequiresClick = !!app.getOption("scrollRequiresClick") || !!app.getOption("scrollRequiresCtrl");
        this.reverseScroll = !!app.getOption("reverseScroll");
        this.snapZoomToMagnification = !!app.getOption("snapZoomToMagnification");

        const speed = Number(app.getOption("scrollSpeed"));
        this.scrollSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;

        const perNotch = Number(app.getOption("scrollPixelsPerNotch"));
        this.pixelsPerNotch = Number.isFinite(perNotch) && perNotch > 0 ? perNotch : DEFAULT_PIXELS_PER_NOTCH;
    }

    /**
     * Signed notch count of an OSD scroll event (`canvas-scroll` /
     * `navigator-scroll` args). Positive = zoom in. Exposed so other wheel
     * consumers share one normalization instead of re-deriving it.
     */
    wheelNotches(e: any): number {
        const oe = e?.originalEvent as WheelEvent | undefined;
        return oe ? this.notchesOf(oe) : 0;
    }

    /**
     * Signed notch count of a wheel event. Positive = zoom in, matching OSD's
     * `e.scroll` convention (which is why the raw pixel delta is negated).
     */
    private notchesOf(oe: WheelEvent): number {
        let px = Number(oe?.deltaY) || 0;
        if (oe.deltaMode === 1) {
            // DOM_DELTA_LINE — Firefox on most platforms.
            px *= (window as any).OpenSeadragon?.DEFAULT_SETTINGS?.pixelsPerWheelLine || 40;
        } else if (oe.deltaMode === 2) {
            // DOM_DELTA_PAGE — rare, but a page is the visible height.
            px *= this.viewer?.viewport?.getContainerSize?.()?.y || this.pixelsPerNotch;
        }
        let notches = -(px / this.pixelsPerNotch) * this.scrollSpeed;
        if (this.reverseScroll) notches = -notches;
        // A single OS-coalesced event can carry an absurd delta (kinetic
        // trackpad flings, some remote-desktop stacks). Clamp, don't drop.
        if (notches > MAX_NOTCHES_PER_EVENT) notches = MAX_NOTCHES_PER_EVENT;
        else if (notches < -MAX_NOTCHES_PER_EVENT) notches = -MAX_NOTCHES_PER_EVENT;
        return notches;
    }

    /**
     * Feed fractional notches into a whole-step target. Returns the number of
     * whole steps taken so far, firing `step(±1)` for each; leftovers are kept
     * for the next event of the same gesture and dropped after an idle pause.
     */
    private consumeWholeNotches(notches: number, step: (dir: number) => void): void {
        const now = Date.now();
        this.accum = (now - this.lastEventAt > IDLE_RESET_MS) ? notches : this.accum + notches;
        this.lastEventAt = now;
        let guard = MAX_NOTCHES_PER_EVENT * 2;
        while (Math.abs(this.accum) >= 1 && guard-- > 0) {
            const dir = this.accum > 0 ? 1 : -1;
            this.accum -= dir;
            step(dir);
        }
    }

    /** Zoom reference point in viewport coordinates, mirrored when flipped. */
    private refPoint(e: any, vp: any, gs: any): any {
        if (!gs?.zoomToRefPoint) return null;
        const OSD = (window as any).OpenSeadragon;
        const position = vp.flipped
            ? new OSD.Point(vp.getContainerSize().x - e.position.x, e.position.y)
            : e.position;
        return vp.pointFromPixel(position, true);
    }

    private handleScroll(e: any): void {
        const orig = e?.originalEvent as WheelEvent | undefined;
        const source = e?.eventSource || this.viewer;
        const vp = source?.viewport;
        if (!orig || !vp) return;

        // Host-page passthrough until the user clicks into the viewer. The
        // browser keeps the wheel (page scroll, Ctrl+wheel page zoom).
        if (this.scrollRequiresClick && !this.engaged) {
            e.preventDefaultAction = true;
            e.preventDefault = false;
            const now = Date.now();
            if (now - this.lastHintAt > HINT_INTERVAL_MS) {
                this.lastHintAt = now;
                const dialogs = (window as any).Dialogs;
                dialogs?.show?.($.t('messages.scrollRequiresClick'), 3000, dialogs.MSG_INFO);
            }
            return;
        }

        const gs = source.gestureSettingsByDeviceType?.('mouse');
        if (!gs?.scrollToZoom) return;

        const notches = this.notchesOf(orig);
        if (!notches) return;

        // Modifier+wheel steps focal planes on a z-stack slide. Plain slides
        // fall through to zooming, so the modifier never swallows the gesture.
        const depth = (source as any).__depthController;
        if (depth?.hasZStack?.() && this.matchesZWheel(orig)) {
            e.preventDefaultAction = true;
            this.consumeWholeNotches(notches, (dir) => depth.step(dir));
            return;
        }

        // Magnification snap: only for slides with a resolved native
        // magnification. Uncalibrated slides keep continuous zoom.
        const scalebar = source.scalebar;
        if (this.snapZoomToMagnification && !orig.altKey && scalebar?.magnification) {
            e.preventDefaultAction = true;
            const ref = this.refPoint(e, vp, gs);
            this.consumeWholeNotches(notches, (dir) => {
                // Step from where the viewport is HEADING (target zoom), not from what is
                // rendered right now: zoomTo below animates, so a second notch arriving
                // mid-animation would otherwise snap off the lagging rendered position and
                // land back on the stop we just left. `getMagnification()` is deliberately
                // the rendered one — it answers "what does the user see" — so go through
                // the converter with the target zoom instead.
                const fromMag = scalebar.magnificationForViewportZoom(vp.getZoom());
                const nextMag = scalebar.nextMagnificationStop(fromMag, dir);
                const target = scalebar.viewportZoomForMagnification(nextMag);
                if (target === undefined) return;
                vp.zoomTo(target, ref);
                vp.applyConstraints();
            });
            return;
        }

        e.preventDefaultAction = true;
        vp.zoomBy(Math.pow(source.zoomPerScroll, notches), this.refPoint(e, vp, gs));
        vp.applyConstraints();
    }

    /** Whether the wheel event carries the z-stack modifier; a pinch never does. */
    private matchesZWheel(oe: WheelEvent): boolean {
        const shortcuts = (window as any).APPLICATION_CONTEXT?.shortcuts;
        return !!shortcuts?.pointerModifiersMatch?.(Z_WHEEL_SHORTCUT_ID, {
            ctrlKey: oe.ctrlKey && physicalCtrl,
            altKey: oe.altKey,
            shiftKey: oe.shiftKey,
            metaKey: oe.metaKey,
        });
    }

    /** Tear down listeners; called on viewer destroy. */
    destroy(): void {
        this.viewer?.removeHandler?.("canvas-scroll", this.onCanvasScroll);
        this.element?.removeEventListener("pointerdown", this.onEngage, { capture: true });
        this.element?.removeEventListener("pointerleave", this.onDisengage);
        this.element = null;
    }
}
