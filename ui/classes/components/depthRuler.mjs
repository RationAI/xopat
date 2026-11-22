import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { Button } from "../elements/buttons.mjs";
import { PhIcon } from "../elements/ph-icon.mjs";

import { depthRulerTickStep } from "./depthRulerTicks.mjs";

const { div, span } = van.tags;

/**
 * Focal-plane (z-stack) ruler along the bottom edge of one viewport.
 *
 * Pure UI over the per-viewer `viewer.__depthController`: the tile swap and
 * cache handling live there. Shown only while the bound viewer displays a
 * slide with more than one plane. It reserves its own strip — the owner is
 * told the height through `onInsetChange` and moves the scalebar and the side
 * menu out of the way — so it is reachable with the navigator closed and on
 * mobile, where the control this replaces was not.
 *
 * @param {object} [options]
 * @param {(px: number) => void} [options.onInsetChange] called with the strip
 *   height while the ruler shows, and with 0 when it hides
 */
export class DepthRuler extends BaseComponent {
    static HEIGHT = 26;
    static HEIGHT_MOBILE = 34;

    constructor(options = undefined) {
        options = super(options).options;
        this._onInsetChange = options.onInsetChange;
        this._viewer = null;
        this._range = null;
        this._suppressed = false;
        this._inset = 0;
        this._height = DepthRuler.HEIGHT;
        this._wheelAcc = 0;
        this._handlers = null;
    }

    create() {
        const controller = () => this._viewer?.__depthController;
        const stepButton = (delta, icon, titleKey) => new Button({
            size: Button.SIZE.TINY,
            type: Button.TYPE.NONE,
            onClick: () => controller()?.step?.(delta),
            extraClasses: { shape: "btn-ghost btn-square" },
            extraProperties: { title: $.t(titleKey), "aria-label": $.t(titleKey) },
        }, new PhIcon({ name: icon })).create();

        this._thumb = div({
            class: "bg-primary",
            style: "position:absolute; top:2px; bottom:2px; width:4px; margin-left:-2px;"
                + " border-radius:2px; pointer-events:none;",
        });
        // The rail is inset from the track edges so the thumb is fully visible
        // on the first and last plane; all pointer math is against the rail.
        this._rail = div({
            style: "position:absolute; top:0; bottom:0; left:6px; right:6px; pointer-events:none;",
        }, this._thumb);
        this._track = div({
            class: "flex-1 min-w-0",
            style: "position:relative; align-self:stretch; cursor:pointer; touch-action:none;",
            role: "slider",
            tabindex: "0",
            "aria-orientation": "horizontal",
            "aria-label": $.t("main.depthRuler.title"),
        }, this._rail);
        this._readout = span({
            class: "text-xs whitespace-nowrap",
            style: "font-variant-numeric:tabular-nums; padding:0 6px;",
        });

        this._wireTrack();

        this._root = div(
            {
                ...this.commonProperties,
                class: "display-none flex flex-row items-center gap-1 bg-base-200 border-t border-base-300 text-base-content",
                // z-index 2: above the scalebar dock (1), below the side menu (3).
                style: `position:absolute; left:0; right:0; bottom:0; height:${this._height}px;`
                    + " z-index:2; pointer-events:auto; padding:0 4px; user-select:none;",
                title: $.t("main.depthRuler.hint"),
            },
            new PhIcon({ name: "ph-stack" }).create(),
            stepButton(-1, "ph-caret-left", "main.depthRuler.previous"),
            this._track,
            stepButton(1, "ph-caret-right", "main.depthRuler.next"),
            this._readout,
        );
        this._root.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });

        if (typeof ResizeObserver !== "undefined") {
            this._resizeObserver = new ResizeObserver(() => this._drawTicks());
            this._resizeObserver.observe(this._track);
        }
        return this._root;
    }

    /** @private pointer scrubbing + contextual keys on the track */
    _wireTrack() {
        const track = this._track;
        const planeAt = (clientX) => {
            const range = this._range;
            if (!range) return null;
            const rect = this._rail.getBoundingClientRect();
            if (!(rect.width > 0)) return null;
            const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
            return Math.round(t * (range.count - 1));
        };
        const commit = (index) => {
            if (index === null) return;
            this._viewer?.__depthController?.setDepth?.(index);
        };

        let dragging = false;
        track.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            dragging = true;
            track.setPointerCapture?.(e.pointerId);
            commit(planeAt(e.clientX));
            e.preventDefault();
        });
        // Live while dragging; the controller de-dupes an unchanged plane.
        track.addEventListener("pointermove", (e) => { if (dragging) commit(planeAt(e.clientX)); });
        const stop = () => { dragging = false; };
        track.addEventListener("pointerup", stop);
        track.addEventListener("pointercancel", stop);

        // Contextual widget keys — deliberately not registered shortcuts.
        track.addEventListener("keydown", (e) => {
            const range = this._range;
            if (!range) return;
            let target = null;
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") target = range.index - 1;
            else if (e.key === "ArrowRight" || e.key === "ArrowUp") target = range.index + 1;
            else if (e.key === "Home") target = 0;
            else if (e.key === "End") target = range.count - 1;
            if (target === null) return;
            e.preventDefault();
            e.stopPropagation();
            commit(Math.min(range.count - 1, Math.max(0, target)));
        });
    }

    /** @private plain wheel over the ruler steps planes (no Alt needed here) */
    _onWheel(e) {
        if (!this._range) return;
        e.preventDefault();
        // Normalise line/page deltas to pixels, then one plane per notch-ish.
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
        this._wheelAcc += (e.deltaY || e.deltaX) * unit;
        const NOTCH = 50;
        const steps = Math.trunc(this._wheelAcc / NOTCH);
        if (!steps) return;
        this._wheelAcc -= steps * NOTCH;
        this._viewer?.__depthController?.step?.(steps);
    }

    /**
     * Bind to a viewer. The DOM must already be attached (`attachTo`).
     * @param {OpenSeadragon.Viewer} viewer
     */
    init(viewer) {
        if (this._viewer) return;
        this._viewer = viewer;
        const refresh = () => this.refresh();
        const changed = (e) => this._reflect(e.index, e.count);
        this._handlers = { refresh, changed };
        // A slide (re)open or a layer coming/going can add, remove or replace
        // the z-stack the controller reads its range from.
        viewer.addHandler("open", refresh);
        viewer.world?.addHandler("add-item", refresh);
        viewer.world?.addHandler("remove-item", refresh);
        // Keyboard / Alt-scroll / scripting / session changes flow back here.
        viewer.addHandler("z-depth-changed", changed);
        this.refresh();
    }

    /** Recompute range and visibility from the bound viewer's depth controller. */
    refresh() {
        if (!this._root || !this._viewer) return;
        this._range = this._viewer.__depthController?.getRange?.() || null;
        const visible = !!this._range && !this._suppressed;
        this._root.classList.toggle("display-none", !visible);
        this._setInset(visible ? this._height : 0);
        if (!this._range) return;
        this._track.setAttribute("aria-valuemin", "1");
        this._track.setAttribute("aria-valuemax", String(this._range.count));
        this._drawTicks();
        this._reflect(this._range.index, this._range.count);
    }

    /** Whether the ruler currently occupies its strip. */
    isVisible() {
        return this._inset > 0;
    }

    /**
     * Hide-UI channel (`AppBar.Chrome`): suppress the ruler without forgetting
     * that the slide has planes, so un-hiding brings it back.
     * @param {boolean} hidden
     */
    setHidden(hidden) {
        this._suppressed = !!hidden;
        this.refresh();
    }

    onLayoutChange(details) {
        const mobile = details?.width < APPLICATION_CONTEXT.getOption("maxMobileWidthPx");
        const height = mobile ? DepthRuler.HEIGHT_MOBILE : DepthRuler.HEIGHT;
        if (height === this._height) return;
        this._height = height;
        if (!this._root) return;
        this._root.style.height = `${height}px`;
        if (this._inset > 0) this._setInset(height);
    }

    /** @private */
    _setInset(px) {
        if (px === this._inset) return;
        this._inset = px;
        try {
            this._onInsetChange?.(px);
        } catch (e) {
            console.warn("DepthRuler: onInsetChange failed", e);
        }
    }

    /** @private */
    _reflect(index, count) {
        const range = this._range;
        if (!range) return;
        range.index = index;
        if (count > 1 && count !== range.count) {
            // Plane count changed under us (source replaced): re-read everything.
            this.refresh();
            return;
        }
        this._thumb.style.left = `${(index / (range.count - 1)) * 100}%`;

        const position = $.t("main.depthRuler.position", { index: index + 1, count: range.count });
        const label = range.labels?.[index];
        let detail = "";
        if (label !== undefined && label !== null && label !== "") {
            detail = String(label);
        } else if (Number.isFinite(range.spacingUm) && range.spacingUm > 0) {
            const value = Number((index * range.spacingUm).toFixed(2));
            detail = $.t("main.depthRuler.offsetUm", { value });
        }
        const text = detail ? `${position} · ${detail}` : position;
        this._readout.textContent = text;
        this._track.setAttribute("aria-valuenow", String(index + 1));
        this._track.setAttribute("aria-valuetext", text);
    }

    /** @private */
    _drawTicks() {
        const range = this._range;
        if (!range || !this._rail) return;
        const width = this._rail.getBoundingClientRect().width;
        if (!(width > 0)) return;
        const step = depthRulerTickStep(range.count, width);
        const period = (width / (range.count - 1)) * step;
        // currentColor at reduced alpha keeps the ticks on the theme's text
        // colour without a theme-specific rule.
        this._rail.style.backgroundImage =
            `repeating-linear-gradient(to right, color-mix(in srgb, currentColor 45%, transparent) 0 1px,`
            + ` transparent 1px ${period}px)`;
        this._rail.style.backgroundRepeat = "no-repeat";
        this._rail.style.backgroundSize = "calc(100% + 1px) 50%";
        this._rail.style.backgroundPosition = "0 100%";
    }

    /** Detach from the viewer and release the reserved strip. */
    destroy() {
        const viewer = this._viewer;
        const h = this._handlers;
        if (viewer && h) {
            viewer.removeHandler?.("open", h.refresh);
            viewer.world?.removeHandler?.("add-item", h.refresh);
            viewer.world?.removeHandler?.("remove-item", h.refresh);
            viewer.removeHandler?.("z-depth-changed", h.changed);
        }
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
        this._handlers = null;
        this._viewer = null;
        this._range = null;
        this._setInset(0);
        this._root?.remove();
        this._root = null;
    }
}
