/**
 * Per-viewer joystick navigation. Installed as `viewer.__joystickController`
 * next to `__depthController` / `__shaderSourceController`.
 *
 * Joystick navigation is a *mode* (app-wide, off by default) toggled from the
 * keyboard shortcut `core.viewport.toggleJoystick` (or programmatically via the
 * static `setEnabled` / `toggle`). While the mode is on:
 *   - primary-button press on a viewer drops an ANCHOR marker at the press point;
 *   - moving the mouse away from the anchor drives a continuous pan whose speed
 *     grows with the cursor's distance from the anchor (a true joystick — the
 *     cursor is the stick, the anchor is the pivot). A small dead-zone around the
 *     anchor means no motion, so a click without movement does nothing;
 *   - releasing the button (or leaving the mode) stops the pan and clears the marker.
 *
 * The pan runs on a `requestAnimationFrame` loop so speed is time-based
 * (px/second), independent of pointermove event frequency. Direction is
 * anchor→cursor: pushing the stick right drives the view right (opposite of a
 * normal drag-pan, matching joystick intuition).
 *
 * While the mode is on, OSD's own drag-to-pan / flick are suspended per viewer so
 * the two do not fight; scroll-to-zoom and the context menu stay live. The mode
 * state is a single static shared across all viewers; each per-viewer controller
 * subscribes and applies it to its own gesture settings.
 */

function opt(key: string, def: number): number {
    const v = (window as any).APPLICATION_CONTEXT?.getOption?.(key, def);
    return typeof v === "number" && isFinite(v) ? v : def;
}

export class ViewerJoystickController {
    // ── App-wide mode state (shared across every viewer) ──────────────────────
    private static _enabled = false;
    private static listeners = new Set<(on: boolean) => void>();

    static get enabled(): boolean {
        return this._enabled;
    }

    /** Turn the joystick navigation mode on/off for all viewers. */
    static setEnabled(on: boolean): void {
        on = !!on;
        if (on === this._enabled) return;
        this._enabled = on;
        for (const fn of this.listeners) {
            try { fn(on); } catch (e) { console.warn("[joystick] mode listener threw", e); }
        }
    }

    static toggle(): boolean {
        this.setEnabled(!this._enabled);
        return this._enabled;
    }

    /** Subscribe to mode changes (e.g. a toolbar toggle). Returns an unsubscribe. */
    static onChange(fn: (on: boolean) => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    // ── Per-viewer instance ───────────────────────────────────────────────────
    private readonly viewer: any;
    private readonly unsubscribe: () => void;
    private container: HTMLElement | null = null;

    private active = false;
    private pointerId: number | null = null;
    private anchor: { x: number; y: number } | null = null;   // container-relative px
    private pointer: { x: number; y: number } | null = null;   // container-relative px
    private rafId = 0;
    private lastFrame = 0;

    private marker: HTMLElement | null = null;
    private knob: HTMLElement | null = null;

    // Saved OSD gesture flags, restored when the mode turns off.
    private savedDragToPan: boolean | undefined;
    private savedFlick: boolean | undefined;

    private readonly onPointerDown = (e: PointerEvent) => this.handleDown(e);
    private readonly onPointerMove = (e: PointerEvent) => this.handleMove(e);
    private readonly onPointerUp = (e: PointerEvent) => this.handleUp(e);

    constructor(viewer: any) {
        this.viewer = viewer;
        this.container = (viewer?.container as HTMLElement) || (viewer?.element as HTMLElement) || null;
        if (this.container) {
            this.container.addEventListener("pointerdown", this.onPointerDown);
        }
        this.unsubscribe = ViewerJoystickController.onChange((on) => this.applyMode(on));
        // Adopt the current global state (e.g. controller created while mode is on).
        if (ViewerJoystickController.enabled) this.applyMode(true);
    }

    /** Suspend/restore OSD drag-pan for this viewer as the mode flips. */
    private applyMode(on: boolean): void {
        const gs = this.viewer?.gestureSettingsMouse;
        if (on) {
            if (gs) {
                if (this.savedDragToPan === undefined) this.savedDragToPan = gs.dragToPan;
                if (this.savedFlick === undefined) this.savedFlick = gs.flickEnabled;
                gs.dragToPan = false;
                gs.flickEnabled = false;
            }
            if (this.container) this.container.style.cursor = "crosshair";
        } else {
            this.endDrag();
            if (gs) {
                if (this.savedDragToPan !== undefined) gs.dragToPan = this.savedDragToPan;
                if (this.savedFlick !== undefined) gs.flickEnabled = this.savedFlick;
            }
            this.savedDragToPan = this.savedFlick = undefined;
            if (this.container) this.container.style.cursor = "";
        }
    }

    private relPos(e: PointerEvent): { x: number; y: number } {
        const rect = this.container!.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    private handleDown(e: PointerEvent): void {
        if (!ViewerJoystickController.enabled) return;
        if (e.button !== 0) return;                 // primary button only
        if (this.active) return;
        if (!this.container || !this.viewer?.viewport) return;
        // Only the drawing surface — not the navigator overview or OSD controls.
        const canvasEl: HTMLElement | undefined = this.viewer.canvas;
        if (canvasEl && e.target instanceof Node && !canvasEl.contains(e.target)) return;

        this.active = true;
        this.pointerId = e.pointerId;
        this.anchor = this.relPos(e);
        this.pointer = { ...this.anchor };
        e.preventDefault();                          // suppress text selection / native drag

        try { this.container.setPointerCapture(e.pointerId); } catch (_) { /* older browsers */ }
        this.container.addEventListener("pointermove", this.onPointerMove);
        this.container.addEventListener("pointerup", this.onPointerUp);
        this.container.addEventListener("pointercancel", this.onPointerUp);
        this.container.style.cursor = "grabbing";

        this.showMarker();
        this.lastFrame = 0;
        this.rafId = requestAnimationFrame((t) => this.tick(t));
    }

    private handleMove(e: PointerEvent): void {
        if (!this.active || e.pointerId !== this.pointerId) return;
        this.pointer = this.relPos(e);
        this.updateMarker();
    }

    private handleUp(e: PointerEvent): void {
        if (!this.active || e.pointerId !== this.pointerId) return;
        this.endDrag();
    }

    private endDrag(): void {
        if (!this.active) return;
        this.active = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = 0;
        if (this.container) {
            this.container.removeEventListener("pointermove", this.onPointerMove);
            this.container.removeEventListener("pointerup", this.onPointerUp);
            this.container.removeEventListener("pointercancel", this.onPointerUp);
            if (this.pointerId !== null) {
                try { this.container.releasePointerCapture(this.pointerId); } catch (_) { /* ignore */ }
            }
            this.container.style.cursor = ViewerJoystickController.enabled ? "crosshair" : "";
        }
        this.pointerId = null;
        this.anchor = this.pointer = null;
        this.hideMarker();
    }

    /** rAF pan loop: pan the viewport by a time-scaled, distance-weighted step. */
    private tick(now: number): void {
        if (!this.active || !this.anchor || !this.pointer) return;
        const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0;
        this.lastFrame = now;

        const dx = this.pointer.x - this.anchor.x;
        const dy = this.pointer.y - this.anchor.y;
        const dist = Math.hypot(dx, dy);

        const deadZone = opt("joystickDeadZonePx", 14);
        const saturate = Math.max(deadZone + 1, opt("joystickSaturatePx", 160));
        const maxSpeed = opt("joystickMaxSpeedPxPerSec", 1800);   // screen px/sec at full deflection

        if (dt > 0 && dist > deadZone) {
            // Normalized deflection 0..1, eased (square) for fine control near center.
            const norm = Math.min(1, (dist - deadZone) / (saturate - deadZone));
            const speed = norm * norm * maxSpeed;                 // px/sec
            const stepPx = speed * dt;                            // px this frame
            const ux = dx / dist, uy = dy / dist;                 // push direction

            const OSD = (window as any).OpenSeadragon;
            const vp = this.viewer.viewport;
            // Convert the screen-pixel step into a viewport-space delta (zoom-aware),
            // then move the view in the push direction (joystick semantics).
            const deltaVp = vp.deltaPointsFromPixels(new OSD.Point(ux * stepPx, uy * stepPx), true);
            vp.panBy(deltaVp, false);
            vp.applyConstraints();
        }

        this.rafId = requestAnimationFrame((t) => this.tick(t));
    }

    // ── Marker (transient interaction chrome, not app-state UI) ────────────────
    private showMarker(): void {
        if (!this.container || !this.anchor) return;
        if (!this.marker) {
            const ring = document.createElement("div");
            ring.style.cssText =
                "position:absolute;width:96px;height:96px;border-radius:9999px;" +
                "border:2px solid rgba(255,255,255,0.85);box-shadow:0 0 0 2px rgba(0,0,0,0.35);" +
                "pointer-events:none;z-index:60;transform:translate(-50%,-50%);";
            const dot = document.createElement("div");
            dot.style.cssText =
                "position:absolute;left:50%;top:50%;width:8px;height:8px;border-radius:9999px;" +
                "background:rgba(255,255,255,0.9);transform:translate(-50%,-50%);";
            ring.appendChild(dot);

            const knob = document.createElement("div");
            knob.style.cssText =
                "position:absolute;width:22px;height:22px;border-radius:9999px;" +
                "background:rgba(56,189,248,0.85);border:2px solid rgba(255,255,255,0.95);" +
                "box-shadow:0 0 6px rgba(0,0,0,0.4);pointer-events:none;z-index:61;" +
                "transform:translate(-50%,-50%);";
            this.marker = ring;
            this.knob = knob;
            this.container.appendChild(ring);
            this.container.appendChild(knob);
        }
        this.marker.style.display = this.knob!.style.display = "block";
        this.updateMarker();
    }

    private updateMarker(): void {
        if (!this.marker || !this.knob || !this.anchor || !this.pointer) return;
        this.marker.style.left = `${this.anchor.x}px`;
        this.marker.style.top = `${this.anchor.y}px`;
        this.knob.style.left = `${this.pointer.x}px`;
        this.knob.style.top = `${this.pointer.y}px`;
    }

    private hideMarker(): void {
        if (this.marker) this.marker.style.display = "none";
        if (this.knob) this.knob.style.display = "none";
    }

    /** Tear down listeners/marker; called on viewer destroy. */
    destroy(): void {
        this.endDrag();
        this.unsubscribe?.();
        if (this.container) {
            this.container.removeEventListener("pointerdown", this.onPointerDown);
        }
        this.marker?.remove();
        this.knob?.remove();
        this.marker = this.knob = this.container = null;
    }
}
