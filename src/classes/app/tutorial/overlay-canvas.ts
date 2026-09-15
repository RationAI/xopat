/**
 * The dimming overlay with a rounded-rectangle cut-out around the highlighted
 * element, plus the four click-blocker panes that make the tour modal.
 *
 * Replaces the `Kinetic.Stage` / `Layer` / `Rect` / `Shape` graph the former
 * `src/external/enjoyhint.js` used. The cut-out was already raw canvas 2D
 * (`globalCompositeOperation = "destination-out"`); only the scene-graph
 * wrapper is gone.
 */
import { tween } from "./tween";

/** Live highlight geometry, in CSS pixels relative to the viewport. */
export interface HoleShape {
    centerX: number;
    centerY: number;
    width: number;
    height: number;
    radius: number;
    [k: string]: number;
}

/** Where the highlight sits, for the blocker panes and the label layout. */
export interface HoleBounds {
    x: number;
    y: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
}

/** Parked far off-screen so the first frame shows a fully dimmed viewport. */
const PARKED = -130;

/**
 * `ctx.roundRect` is only ~2022-era; the former engine shipped its own by
 * patching `CanvasRenderingContext2D.prototype` — which silently *overwrote*
 * the native implementation for every other canvas in the app. Keep it local.
 */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    if (r < 0) r = 0;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

export class TourOverlayCanvas {
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D | null;
    private readonly blockers: HTMLDivElement[] = [];
    private readonly fill: string;
    private cancelTween: () => void = () => {};

    readonly shape: HoleShape = {
        centerX: PARKED, centerY: PARKED, width: 0, height: 0, radius: 0,
    };

    constructor(root: HTMLElement, fill: string) {
        this.fill = fill;

        this.canvas = document.createElement("canvas");
        this.canvas.className = "xo-tour-canvas";
        root.appendChild(this.canvas);
        this.ctx = this.canvas.getContext("2d");

        // Four panes that swallow every pointer event outside the highlight.
        // This is what makes the tour modal without an inert/backdrop polyfill.
        for (let i = 0; i < 4; i++) {
            const pane = document.createElement("div");
            pane.className = "xo-tour-block";
            pane.addEventListener("click", (e) => e.stopImmediatePropagation());
            root.appendChild(pane);
            this.blockers.push(pane);
        }

        this.resize();
    }

    /** Match the backing store to the viewport and the device pixel ratio. */
    resize(): void {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(window.innerWidth * dpr);
        this.canvas.height = Math.round(window.innerHeight * dpr);
        this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.draw();
    }

    draw(): void {
        const ctx = this.ctx;
        if (!ctx) return;
        const w = window.innerWidth;
        const h = window.innerHeight;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = this.fill;
        ctx.fillRect(0, 0, w, h);

        const s = this.shape;
        if (s.width <= 0 || s.height <= 0) return;
        const prev = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = "destination-out";
        roundRectPath(
            ctx,
            s.centerX - Math.round(s.width / 2),
            s.centerY - Math.round(s.height / 2),
            s.width, s.height, s.radius,
        );
        ctx.fill();
        ctx.globalCompositeOperation = prev;
    }

    /** Animate the cut-out to a rectangle. Returns its resting bounds. */
    renderRect(x: number, y: number, w: number, h: number, r = 0, durationMs = 100): HoleBounds {
        this.animate({ centerX: x, centerY: y, width: w, height: h, radius: r }, durationMs);
        const halfW = Math.round(w / 2);
        const halfH = Math.round(h / 2);
        return { x, y, left: x - halfW, right: x + halfW, top: y - halfH, bottom: y + halfH };
    }

    /** Animate the cut-out to a circle of radius `r`. Returns its bounds. */
    renderCircle(x: number, y: number, r: number, durationMs = 200): HoleBounds {
        this.animate({ centerX: x, centerY: y, width: r * 2, height: r * 2, radius: r }, durationMs);
        return { x, y, left: x - r, right: x + r, top: y - r, bottom: y + r };
    }

    /** Collapse the cut-out and park it off-screen (used when hiding). */
    park(): void {
        this.animate({ centerX: PARKED, centerY: PARKED, width: 0, height: 0, radius: 0 }, 0);
    }

    private animate(to: Record<string, number>, durationMs: number): void {
        this.cancelTween();
        this.cancelTween = tween(this.shape, to, durationMs, () => this.draw());
    }

    /**
     * Position the blocker panes so only the highlighted rectangle stays
     * interactive. Sizes come from CSS; only the free edges are set here.
     */
    blockAround(bounds: HoleBounds): void {
        const [top, bottom, left, right] = this.blockers as [
            HTMLDivElement, HTMLDivElement, HTMLDivElement, HTMLDivElement,
        ];
        top.style.top = "0";
        top.style.left = "0";
        top.style.height = `${Math.max(0, bounds.top)}px`;

        bottom.style.top = `${bounds.bottom}px`;
        bottom.style.left = "0";

        left.style.top = "0";
        left.style.left = "0";
        left.style.width = `${Math.max(0, bounds.left)}px`;

        right.style.top = "0";
        right.style.left = `${bounds.right}px`;
    }

    destroy(): void {
        this.cancelTween();
    }
}
