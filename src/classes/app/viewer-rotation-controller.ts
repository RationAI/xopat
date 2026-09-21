/**
 * Per-viewer modifier-drag rotation. Installed as `viewer.__rotationController`
 * next to `__joystickController` / `__depthController`.
 *
 * Holding the arming modifier (default the platform primary — Ctrl on
 * Windows/Linux, ⌘ on macOS) and dragging the canvas rotates the viewport
 * around its center: the cursor orbits the view center and the accumulated
 * angular sweep is applied via `viewport.setRotation`. Releasing ends it.
 *
 * Like the joystick, this rides OSD's *own* gesture stream — the
 * `canvas-press` / `canvas-drag` / `canvas-release` events drag-to-pan also
 * consumes — rather than a parallel native-pointer path. OSD only emits these
 * while mouse-nav is enabled, so this engages precisely where a plain drag-pan
 * would and yields precisely where one would: any tool that grabs the pointer
 * via `setMouseNavEnabled(false)` (annotation drawing, magic-wand, …) starves
 * it with no capture tug-of-war. Hence "works only when OSD navigation is on".
 *
 * The arming modifier is NOT hardcoded: it is a modifier-only binding in the
 * central ShortcutManager (`core.viewport.rotateDrag`), remappable from the
 * Keymap panel. This controller only queries `pointerModifiersMatch` at press
 * time — the manager owns what the combo is.
 */

/** Shortcut id of the modifier-only binding that arms drag-rotation. */
export const ROTATE_DRAG_SHORTCUT_ID = "core.viewport.rotateDrag";

export class ViewerRotationController {
    private readonly viewer: any;
    private container: HTMLElement | null;

    private active = false;
    private pivot: { x: number; y: number } | null = null;   // container-relative px
    private lastAngle = 0;                                    // deg
    private accum = 0;                                        // deg swept since press
    private startRotation = 0;                                // deg
    private savedCursor = "";

    private readonly onCanvasPress = (e: any) => this.handlePress(e);
    private readonly onCanvasDrag = (e: any) => this.handleDrag(e);
    private readonly onCanvasRelease = (e: any) => this.endDrag();

    constructor(viewer: any) {
        this.viewer = viewer;
        this.container = (viewer?.container as HTMLElement) || (viewer?.element as HTMLElement) || null;
        if (viewer?.addHandler) {
            viewer.addHandler("canvas-press", this.onCanvasPress);
            viewer.addHandler("canvas-drag", this.onCanvasDrag);
            viewer.addHandler("canvas-release", this.onCanvasRelease);
            viewer.addHandler("canvas-drag-end", this.onCanvasRelease);
        }
    }

    /** Container-relative px from an OSD gesture event's original DOM event. */
    private relPos(e: any): { x: number; y: number } | null {
        const oe = e?.originalEvent;
        const rect = this.container?.getBoundingClientRect();
        if (!rect) return null;
        let cx = oe?.clientX;
        let cy = oe?.clientY;
        if (typeof cx !== "number") {                 // touch fallback
            const t = oe?.changedTouches?.[0] || oe?.touches?.[0];
            cx = t?.clientX; cy = t?.clientY;
        }
        if (typeof cx !== "number" || typeof cy !== "number") return null;
        return { x: cx - rect.left, y: cy - rect.top };
    }

    /** Angle in degrees of a container-relative point around the pivot. */
    private angleAt(pos: { x: number; y: number }): number {
        return Math.atan2(pos.y - this.pivot!.y, pos.x - this.pivot!.x) * 180 / Math.PI;
    }

    private handlePress(e: any): void {
        if (this.active || !this.container || !this.viewer?.viewport) return;
        const shortcuts = (window as any).APPLICATION_CONTEXT?.shortcuts;
        // Arm only when the remappable modifier matches; else leave the gesture
        // to OSD (plain drag-pan). canvas-press only reaches us while mouse-nav
        // is enabled, so no button/tool gating is needed.
        if (!shortcuts?.pointerModifiersMatch?.(ROTATE_DRAG_SHORTCUT_ID, e?.originalEvent)) return;
        const pos = this.relPos(e);
        if (!pos) return;

        const rect = this.container.getBoundingClientRect();
        this.pivot = { x: rect.width / 2, y: rect.height / 2 };
        this.active = true;
        this.accum = 0;
        this.lastAngle = this.angleAt(pos);
        this.startRotation = this.viewer.viewport.getRotation();
        this.savedCursor = this.container.style.cursor;
        this.container.style.cursor = "grabbing";
    }

    private handleDrag(e: any): void {
        if (!this.active || !this.pivot) return;
        // The rotation owns this gesture — suppress OSD's drag-to-pan.
        e.preventDefaultAction = true;
        const pos = this.relPos(e);
        if (!pos) return;

        const now = this.angleAt(pos);
        let d = now - this.lastAngle;
        if (d > 180) d -= 360;
        else if (d < -180) d += 360;
        this.lastAngle = now;
        // A flipped (mirrored) viewport reverses the visual sense of the sweep.
        this.accum += this.viewer.viewport.flipped ? -d : d;
        this.viewer.viewport.setRotation(this.startRotation + this.accum, true);
    }

    private endDrag(): void {
        if (!this.active) return;
        this.active = false;
        this.pivot = null;
        if (this.container) this.container.style.cursor = this.savedCursor;
    }

    /** Tear down listeners; called on viewer destroy. */
    destroy(): void {
        this.endDrag();
        if (this.viewer?.removeHandler) {
            this.viewer.removeHandler("canvas-press", this.onCanvasPress);
            this.viewer.removeHandler("canvas-drag", this.onCanvasDrag);
            this.viewer.removeHandler("canvas-release", this.onCanvasRelease);
            this.viewer.removeHandler("canvas-drag-end", this.onCanvasRelease);
        }
        this.container = null;
    }
}
