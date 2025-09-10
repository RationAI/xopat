// ui/services/globalTooltip.mjs
import van from "../vanjs.mjs";

const { div } = van.tags;

// Helpers
const isHtml = v => typeof v === "string" && v.trim().startsWith("<");
const setContent = (host, v) => {
    host.innerHTML = "";
    if (v == null) return;
    if (isHtml(v)) host.innerHTML = v;
    else host.append(v instanceof Node ? v : document.createTextNode(String(v)));
};

// Placement + math
function computePosition(anchorRect, tipRect, placement, gap = 8) {
    let top = 0, left = 0, side = placement;
    const place = s => {
        side = s;
        if (s === "bottom") {
            top = anchorRect.bottom + gap;
            left = anchorRect.left + (anchorRect.width - tipRect.width) / 2;
        } else if (s === "top") {
            top = anchorRect.top - tipRect.height - gap;
            left = anchorRect.left + (anchorRect.width - tipRect.width) / 2;
        } else if (s === "left") {
            top = anchorRect.top + (anchorRect.height - tipRect.height) / 2;
            left = anchorRect.left - tipRect.width - gap;
        } else { // right
            top = anchorRect.top + (anchorRect.height - tipRect.height) / 2;
            left = anchorRect.right + gap;
        }
    };
    place(placement);

    // simple flip if offscreen, then clamp
    const vw = innerWidth, vh = innerHeight, pad = 6;
    const offL = left < pad, offR = left + tipRect.width > vw - pad;
    const offT = top < pad,  offB = top + tipRect.height > vh - pad;
    if (side === "bottom" && offB) place("top");
    if (side === "top"    && offT) place("bottom");
    if (side === "left"   && offL) place("right");
    if (side === "right"  && offR) place("left");

    // clamp
    left = Math.min(Math.max(left, pad), vw - tipRect.width - pad);
    top  = Math.min(Math.max(top,  pad), vh - tipRect.height - pad);
    return { top, left, side };
}

class GlobalTooltip {
    constructor() {
        this.surface = null;
        this.arrow = null;
        this.host = null;
        this.current = null;            // { el, options }
        this.bound = new WeakMap();     // el -> handlers
        this._open = false;

        // bound handlers
        this._outside = e => {
            if (!this._open) return;
            const el = this.surface;
            const a = this.current?.el;
            if (el?.contains(e.target) || a?.contains(e.target)) return;
            this.hide();
        };
        this._onEsc = e => { if (e.key === "Escape") this.hide(); };
        this._reflow = () => this._open && this.reposition();
    }

    _ensureSurface() {
        if (this.surface) return;
        // DaisyUI-like floating card
        this.surface = div({
                id: "global-tooltip",
                class: "fixed z-[9999] max-w-xs rounded-box bg-base-200 text-base-content shadow p-2 text-sm " +
                    "opacity-0 scale-95 transition transform origin-center pointer-events-auto",
                style: "top:0;left:0;display:none;",
            },
            // arrow
            this.arrow = div({ class: "absolute w-2 h-2 bg-base-200 rotate-45" }),
            // content host
            this.host = div({ id: "global-tooltip-content" }),
        );
        document.body.appendChild(this.surface);

        // global listeners
        document.addEventListener("click", this._outside, { capture: true });
        document.addEventListener("keydown", this._onEsc, { capture: true });
        addEventListener("scroll", this._reflow, true);
        addEventListener("resize", this._reflow);
    }

    _bind(el, opts) {
        if (this.bound.has(el)) return;
        const trigger = opts.trigger || "both"; // "hover" | "click" | "both"
        const onEnter = () => { if (trigger !== "click") this.show(el, opts); };
        const onLeave = () => { if (trigger === "hover" && !opts.interactive) this.hide(); };
        const onClick = e => {
            if (trigger === "click" || trigger === "both") {
                // ignore clicks on exempt children (e.g., close buttons)
                if (e.target.closest?.("[data-tooltip-exempt]")) return;
                (this.current?.el === el && this._open) ? this.hide() : this.show(el, opts);
                e.stopPropagation();
            }
        };
        el.addEventListener("mouseenter", onEnter);
        el.addEventListener("mouseleave", onLeave);
        el.addEventListener("click", onClick);
        this.bound.set(el, { onEnter, onLeave, onClick });
    }

    _unbind(el) {
        const h = this.bound.get(el);
        if (!h) return;
        el.removeEventListener("mouseenter", h.onEnter);
        el.removeEventListener("mouseleave", h.onLeave);
        el.removeEventListener("click", h.onClick);
        this.bound.delete(el);
    }

    show(el, options = {}) {
        this._ensureSurface();
        const { content, placement = "bottom", offset = 8, interactive = true } = options;
        this.current = { el, options: { placement, offset, interactive } };

        setContent(this.host, content);
        this.surface.style.display = "block";
        this.surface.classList.remove("opacity-0", "scale-95");
        this.surface.classList.add("opacity-100", "scale-100");

        this.reposition();
        this._open = true;

        // allow interacting with tooltip without closing on hover-out
        if (interactive) {
            this.surface.addEventListener("mouseenter", () => { this._inside = true; });
            this.surface.addEventListener("mouseleave", () => { this._inside = false; if (!this._hoverAnchor) this.hide(); });
        }
    }

    hide() {
        if (!this._open) return;
        this.surface.classList.add("opacity-0", "scale-95");
        this.surface.classList.remove("opacity-100", "scale-100");
        setTimeout(() => { if (this.surface) this.surface.style.display = "none"; }, 120);
        this._open = false;
        this._inside = false;
    }

    toggle(el, options) {
        if (this._open && this.current?.el === el) this.hide();
        else this.show(el, options);
    }

    reposition() {
        if (!this.current?.el || !this.surface) return;
        const rect = this.current.el.getBoundingClientRect();
        const tipRect = this.surface.getBoundingClientRect();
        const { placement, offset } = this.current.options;
        const { top, left, side } = computePosition(rect, tipRect, placement, offset);

        Object.assign(this.surface.style, { top: `${Math.round(top)}px`, left: `${Math.round(left)}px` });

        // arrow placement & subtle border
        this.arrow.style.boxShadow = "0 0 0 1px var(--fallback-bc,oklch(var(--bc)/.2))";
        this.arrow.removeAttribute("style");
        this.arrow.style.position = "absolute";
        this.arrow.style.width = "0.5rem";
        this.arrow.style.height = "0.5rem";
        this.arrow.style.transform = "rotate(45deg)";
        this.arrow.style.background = "var(--b2, var(--fallback-b2, #fff))"; // base-200 bg

        const tr = this.surface.getBoundingClientRect();
        if (side === "bottom") {
            this.arrow.style.top = "-4px";
            this.arrow.style.left = `${Math.round((tr.width / 2))}px`;
        } else if (side === "top") {
            this.arrow.style.bottom = "-4px";
            this.arrow.style.left = `${Math.round((tr.width / 2))}px`;
        } else if (side === "left") {
            this.arrow.style.right = "-4px";
            this.arrow.style.top = `${Math.round(tr.height / 2)}px`;
        } else { // right
            this.arrow.style.left = "-4px";
            this.arrow.style.top = `${Math.round(tr.height / 2)}px`;
        }
    }

    bind(el, opts) { this._bind(el, opts); }
    unbind(el) { this._unbind(el); if (this.current?.el === el) this.hide(); }
    update(el, { content } = {}) {
        if (this.current?.el === el && content !== undefined) {
            setContent(this.host, content);
            this.reposition();
        }
    }
}

export default GlobalTooltip;
