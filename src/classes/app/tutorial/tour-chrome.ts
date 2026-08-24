/**
 * The tour's DOM: root layer, step label, Skip / Prev / Next controls, the
 * action-hint pill, and the SVG arrow that joins the label to the highlight.
 *
 * Structure and DaisyUI/Tailwind utilities live here; only what utilities
 * cannot express (the always-dark palette over the dim overlay, the pointer
 * keyframes, the fade) is in `src/assets/custom.css` under `.xo-tour-*`.
 *
 * The overlay is dark in every theme, so the controls do NOT use theme
 * foreground colours — `btn-outline` / `btn-ghost` would render light-on-light
 * under a light DaisyUI theme. DaisyUI supplies the shape and metrics; the
 * palette is pinned in custom.css.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag: string, attrs: Record<string, string>): SVGElement {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]!);
    return el;
}

/**
 * Step text is HTML-capable (see `src/TUTORIALS.md`). Core steps come from
 * `$.t`, but `plugins/extra-tutorials` renders embedder-supplied session data
 * — treat every step body as hostile and degrade closed when the sanitizer
 * module is not loaded, exactly as `ui/classes/baseComponent.mjs` does.
 */
function setStepHtml(target: HTMLElement, html: string): void {
    const sanitize = (globalThis as any).SanitizeHtml;
    if (typeof sanitize === "function") {
        target.innerHTML = sanitize(html);
        return;
    }
    target.textContent = html;
    try {
        (globalThis as any).UTILITIES?.loadModules?.(() => {}, "sanitize-html");
    } catch { /* best effort — the text rendering above is already safe */ }
}

/** Icon markup is ours, never user input — safe to assign directly. */
function icon(name: string): string {
    return `<i class="ph-light ${name}"></i>`;
}

export interface ChromeCallbacks {
    onNext: () => void;
    onPrev: () => void;
    onSkip: () => void;
}

export class TourChrome {
    readonly root: HTMLDivElement;
    readonly label: HTMLDivElement;
    readonly skipBtn: HTMLDivElement;
    readonly prevBtn: HTMLDivElement;
    readonly nextBtn: HTMLDivElement;
    readonly actionHint: HTMLDivElement;
    private readonly svgRoot: SVGElement;
    private readonly arrowWrap: HTMLDivElement;
    private arrowPath: SVGElement | null = null;
    private readonly marker: SVGElement;

    constructor(parent: HTMLElement, cb: ChromeCallbacks) {
        this.root = document.createElement("div");
        this.root.className = "xo-tour xo-tour-faded";
        parent.appendChild(this.root);

        this.arrowWrap = document.createElement("div");
        this.arrowWrap.className = "xo-tour-svg-wrap";
        this.root.appendChild(this.arrowWrap);

        this.svgRoot = svg("svg", { width: "100%", height: "100%" });
        this.arrowWrap.appendChild(this.svgRoot);

        const defs = svg("defs", {});
        const marker = svg("marker", {
            id: "xo-tour-arrow-marker",
            viewBox: "0 0 36 21",
            refX: "21", refY: "10",
            markerUnits: "strokeWidth",
            orient: "auto",
            markerWidth: "16", markerHeight: "12",
        });
        this.marker = svg("path", {
            style: "fill:none; stroke:rgb(255,255,255); stroke-width:2",
            d: "M0,0 c30,11 30,9 0,20",
        });
        marker.appendChild(this.marker);
        defs.appendChild(marker);
        this.svgRoot.appendChild(defs);

        this.label = document.createElement("div");
        this.label.className = "xo-tour-label";
        this.root.appendChild(this.label);

        this.skipBtn = this.makeButton("xo-tour-skip btn btn-circle", () => cb.onSkip());
        this.skipBtn.innerHTML = icon("ph-x");

        this.prevBtn = this.makeButton("xo-tour-prev btn rounded-full", () => cb.onPrev());
        this.nextBtn = this.makeButton("xo-tour-next btn rounded-full", () => cb.onNext());

        this.actionHint = document.createElement("div");
        this.actionHint.className = "xo-tour-hint xo-tour-hidden";
        this.root.appendChild(this.actionHint);
    }

    private makeButton(className: string, onClick: () => void): HTMLDivElement {
        const el = document.createElement("div");
        el.className = className;
        el.addEventListener("click", onClick);
        this.root.appendChild(el);
        return el;
    }

    /** Fade the whole layer in/out. Matches the former `svg_transparent`. */
    setFaded(faded: boolean): void {
        this.root.classList.toggle("xo-tour-faded", faded);
    }

    setHidden(hidden: boolean): void {
        this.root.classList.toggle("xo-tour-hidden", hidden);
    }

    static setVisible(el: HTMLElement, visible: boolean): void {
        el.classList.toggle("xo-tour-hidden", !visible);
    }

    static isVisible(el: HTMLElement): boolean {
        return !el.classList.contains("xo-tour-hidden") && el.offsetParent !== null;
    }

    /** Measured width, or `fallback` when the element is not rendered. */
    static widthOf(el: HTMLElement, fallback: number): number {
        if (!TourChrome.isVisible(el)) return 0;
        return el.getBoundingClientRect().width || fallback;
    }

    static place(el: HTMLElement, left: number, top: number): void {
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
    }

    setLabel(html: string, x: number, y: number): void {
        setStepHtml(this.label, html);
        TourChrome.place(this.label, x, y);
    }

    setNextContent(text: string, finish: boolean, iconOnly: boolean): void {
        const glyph = finish ? "ph-check" : "ph-caret-right";
        this.nextBtn.innerHTML = iconOnly ? icon(glyph) : `<span></span>${icon(glyph)}`;
        const span = this.nextBtn.querySelector("span");
        if (span) span.textContent = text;
        this.nextBtn.classList.toggle("xo-tour-finish", finish);
    }

    setPrevContent(text: string, iconOnly: boolean): void {
        this.prevBtn.innerHTML = iconOnly ? icon("ph-caret-left") : `${icon("ph-caret-left")}<span></span>`;
        const span = this.prevBtn.querySelector("span");
        if (span) span.textContent = text;
    }

    setActionHint(hint: { icon: string; text: string } | null, iconOnly: boolean): void {
        if (!hint) {
            TourChrome.setVisible(this.actionHint, false);
            return;
        }
        this.actionHint.innerHTML = iconOnly ? icon(hint.icon) : `${icon(hint.icon)}<span></span>`;
        const span = this.actionHint.querySelector("span");
        if (span) span.textContent = hint.text;
        TourChrome.setVisible(this.actionHint, true);
    }

    /** Quadratic curve from the label edge to the highlight, with an arrowhead. */
    drawArrow(a: { xFrom: number; yFrom: number; xTo: number; yTo: number; axis: "hor" | "ver" }, color?: string): void {
        this.clearArrow();
        const cx = a.axis === "hor" ? a.xTo : a.xFrom;
        const cy = a.axis === "hor" ? a.yFrom : a.yTo;
        const stroke = TourChrome.validColor(color) ? color! : "rgb(255,255,255)";
        this.arrowPath = svg("path", {
            style: `fill:none; stroke:${stroke}; stroke-width:3`,
            "marker-end": "url(#xo-tour-arrow-marker)",
            d: `M${a.xFrom},${a.yFrom} Q${cx},${cy} ${a.xTo},${a.yTo}`,
        });
        this.marker.style.stroke = stroke;
        this.svgRoot.appendChild(this.arrowPath);
    }

    clearArrow(): void {
        this.arrowPath?.remove();
        this.arrowPath = null;
    }

    private static validColor(value: string | undefined): boolean {
        if (!value) return false;
        const probe = new Option().style;
        probe.color = value;
        return probe.color !== "";
    }

    destroy(): void {
        this.root.remove();
    }
}
