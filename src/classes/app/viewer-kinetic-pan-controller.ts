/**
 * Per-viewer kinetic pan ("flick"). Installed as `viewer.__kineticPanController`
 * next to `__rotationController` / `__joystickController` / `__depthController`.
 *
 * Dragging stays strictly 1:1 — the slide sticks to the cursor, which is the
 * behaviour pathologists expect. What this adds is momentum: releasing a fast
 * drag keeps the slide travelling and eases it out, so crossing a slide costs a
 * flick instead of a series of full strokes.
 *
 * ## Why not OSD's own `flickEnabled`
 *
 * OSD's flick is a single spring-driven `panTo` (`onCanvasDragEnd`), so it does
 * nothing while `animationTime` is 0 — and xOpat sets `animationTime: 0` on
 * purpose, because the annotation multipolygon brush is suspended for as long as
 * the viewport animates. This controller instead integrates the glide itself on
 * `requestAnimationFrame` and applies it with `panBy(..., immediate)`, the same
 * shape `ViewerJoystickController` uses. No springs are involved, so the
 * annotation `isZooming` flag behaves exactly as during an ordinary drag.
 *
 * Velocity comes from OSD's own `canvas-drag-end` args (`speed` in px/s,
 * `direction` in radians CCW from +X) — the same inputs its native flick uses —
 * so the feel matches the platform rather than a second velocity estimator.
 *
 * ## Why the glide is cancelled on a raw `pointerdown`, not on `canvas-press`
 *
 * OSD 6 dispatches handlers through a promise chain (`openseadragon.js:3860`):
 * only the handler at index 0 runs synchronously, every later one resumes after
 * an `await`, and an earlier handler that sets `stopPropagation` drops the rest
 * of the chain entirely. A cancel that arrives late — or never — leaves the
 * slide coasting in the old direction while the user is already dragging the
 * other way. So the authoritative cancel is a capture-phase `pointerdown` on the
 * canvas element, which cannot be deferred or swallowed; the OSD handlers stay
 * as a secondary net (touch cancel, synthetic gestures).
 *
 * The same asynchrony is why `canvas-drag-end` is registered with a high
 * priority: `preventDefaultAction` is read synchronously right after the event
 * is raised (`openseadragon.js:12159`), so a non-first handler sets it too late
 * to suppress OSD's own flick.
 */

/** Glide velocity below which the animation stops, in px/s. */
const STOP_SPEED = 40;
/** Upper bound on the launch speed, in px/s. Guards against absurd samples. */
const MAX_SPEED = 6000;
/** Per-frame clamp; a long frame must not teleport the viewport. */
const MAX_FRAME_SECONDS = 0.05;

export class ViewerKineticPanController {
    private readonly viewer: any;

    private enabled = true;
    private friction = 0.92;      // per 1/60 s
    private minSpeed = 300;       // px/s required to launch a glide

    private vx = 0;               // px/s, screen space
    private vy = 0;
    private rafId: number | null = null;
    private lastFrame = 0;
    /**
     * Incremented by every `stop()` and every `launch()`. A scheduled frame
     * carries the token it was scheduled under and bails if it no longer
     * matches, so a cancel that lands while a frame is already queued — or from
     * inside a handler re-entered by `panBy` — can never be undone by it.
     */
    private generation = 0;
    /** Another handler claimed the current drag gesture (rotation, joystick, …). */
    private claimed = false;

    private readonly onPress = () => { this.claimed = false; this.stop(); };
    private readonly onDrag = (e: any) => { if (e?.preventDefaultAction) this.claimed = true; this.stop(); };
    private readonly onDragEnd = (e: any) => this.launch(e);
    /** Capture-phase DOM cancel — see the class docs on OSD's async dispatch. */
    private readonly onPointerDown = () => { this.claimed = false; this.stop(); };

    constructor(viewer: any) {
        this.viewer = viewer;
        this.refresh();
        if (viewer?.addHandler) {
            viewer.addHandler("canvas-press", this.onPress);
            viewer.addHandler("canvas-drag", this.onDrag);
            // Priority 100: must run before OSD reads `preventDefaultAction`.
            viewer.addHandler("canvas-drag-end", this.onDragEnd, null, 100);
        }
        viewer?.canvas?.addEventListener?.("pointerdown", this.onPointerDown, true);
    }

    /** Re-read the user options. Called from the Settings panel on change. */
    refresh(): void {
        const app = (window as any).APPLICATION_CONTEXT;
        if (!app?.getOption) return;
        this.enabled = app.getOption("kineticPan") !== false;
        if (!this.enabled) this.stop();

        const friction = Number(app.getOption("kineticPanFriction"));
        this.friction = Number.isFinite(friction) && friction > 0 && friction < 1 ? friction : 0.92;

        const minSpeed = Number(app.getOption("kineticPanMinSpeed"));
        this.minSpeed = Number.isFinite(minSpeed) && minSpeed >= 0 ? minSpeed : 300;
    }

    /** True while the slide is coasting. */
    isGliding(): boolean {
        return this.rafId !== null;
    }

    private launch(e: any): void {
        this.stop();
        if (!this.enabled) return;

        const viewer = e?.eventSource || this.viewer;
        if (!viewer?.viewport) return;
        // Another controller owned this gesture: a modifier-drag rotation claims
        // every canvas-drag it consumes via preventDefaultAction (recorded by the
        // drag handler), and joystick mode turns drag-to-pan off outright.
        if (this.claimed || e?.preventDefaultAction) return;
        const gs = viewer.gestureSettingsByDeviceType?.(e?.pointerType) || viewer.gestureSettingsMouse;
        if (gs?.dragToPan === false) return;

        const speed = Math.min(Number(e?.speed) || 0, MAX_SPEED);
        if (speed < this.minSpeed) return;

        // We own the coast from here — OSD's own (spring-based, and therefore
        // inert under animationTime: 0) flick must not also fire for touch.
        e.preventDefaultAction = true;

        const direction = Number(e?.direction) || 0;
        // Sign matches OSD's own flick: the viewport center travels opposite to
        // the pointer, i.e. the image continues in the drag direction.
        this.vx = viewer.panHorizontal === false ? 0 : speed * Math.cos(direction);
        this.vy = viewer.panVertical === false ? 0 : speed * Math.sin(direction);
        if (!this.vx && !this.vy) {
            viewer.viewport.applyConstraints();
            return;
        }

        this.lastFrame = 0;
        const token = ++this.generation;
        this.rafId = requestAnimationFrame((t) => this.tick(t, token));
    }

    private tick(now: number, token: number): void {
        if (token !== this.generation) return;
        this.rafId = null;
        const viewer = this.viewer;
        const vp = viewer?.viewport;
        if (!vp || !this.enabled) return;

        const dt = this.lastFrame ? Math.min(MAX_FRAME_SECONDS, (now - this.lastFrame) / 1000) : 1 / 60;
        this.lastFrame = now;

        const OSD = (window as any).OpenSeadragon;
        const deltaVp = vp.deltaPointsFromPixels(new OSD.Point(-this.vx * dt, -this.vy * dt), true);
        vp.panBy(deltaVp, true);
        vp.applyConstraints();

        const decay = Math.pow(this.friction, dt * 60);
        this.vx *= decay;
        this.vy *= decay;

        // `panBy` / `applyConstraints` raise viewport events synchronously; a
        // handler may have cancelled us in the meantime.
        if (token !== this.generation) return;
        if (Math.hypot(this.vx, this.vy) < STOP_SPEED) return;
        this.rafId = requestAnimationFrame((t) => this.tick(t, token));
    }

    /** Cancel any running glide (new pointer contact, teardown, option off). */
    stop(): void {
        this.generation++;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.vx = this.vy = 0;
        this.lastFrame = 0;
    }

    /** Tear down listeners; called on viewer destroy. */
    destroy(): void {
        this.stop();
        if (this.viewer?.removeHandler) {
            this.viewer.removeHandler("canvas-press", this.onPress);
            this.viewer.removeHandler("canvas-drag", this.onDrag);
            this.viewer.removeHandler("canvas-drag-end", this.onDragEnd);
        }
        this.viewer?.canvas?.removeEventListener?.("pointerdown", this.onPointerDown, true);
    }
}
