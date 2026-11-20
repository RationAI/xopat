import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { PhIcon } from "../elements/ph-icon.mjs";

const { div, input, span, button, canvas } = van.tags;

/**
 * @class AdjustmentControls
 * @extends BaseComponent
 * @description Live sliders for display adjustments, rendered generically from
 * `APPLICATION_CONTEXT.adjustments.getDescriptors()` — a new kind of adjustment
 * needs a descriptor, not a UI change. Sliders write on `input` (live drag);
 * the shared `Slider` element commits only on release, which is wrong here.
 *
 * Pure view: reading and writing go through the callbacks, so the same
 * component serves one layer (data panel) and "all background layers"
 * (navigator quick panel).
 *
 * @param {object} options
 * @param {() => Record<string, number>} options.getValues current values
 * @param {(patch: Record<string, number>) => void} options.onInput write
 * @param {string[]} [options.keys] subset of descriptor keys to show (default all)
 * @param {() => Promise<{bins:number[], empty:boolean}|null>} [options.histogram] draws a histogram behind the levels
 * @param {() => Promise<any>} [options.onAuto] "Auto" button
 * @param {() => void} [options.onReset] "Reset" button
 * @param {boolean} [options.autoHistogram=true] probe the histogram whenever it comes into view (a
 *   closed `<details>`, hidden tab or collapsed row never probes — each probe is an off-screen
 *   render); when false the owner calls {@link refreshHistogram}. Call {@link destroy} when dropping it.
 */
export class AdjustmentControls extends BaseComponent {
    constructor(options = undefined, ...args) {
        options = super(options, ...args).options;
        this.getValues = options.getValues || (() => ({}));
        this.onInput = options.onInput || (() => {});
        this.keys = Array.isArray(options.keys) ? options.keys : null;
        this.histogramProvider = typeof options.histogram === "function" ? options.histogram : null;
        this.onAuto = typeof options.onAuto === "function" ? options.onAuto : null;
        this.onReset = typeof options.onReset === "function" ? options.onReset : null;
        this.autoHistogram = options.autoHistogram !== false;
        this._rows = new Map();
        this.classMap["base"] = "flex flex-col gap-1 w-full text-xs";
    }

    _descriptors() {
        const all = APPLICATION_CONTEXT.adjustments.getDescriptors();
        return this.keys ? this.keys.map(k => all.find(d => d.key === k)).filter(Boolean) : all;
    }

    _format(d, value) {
        if (d.toggle) return "";
        return d.step >= 1 ? String(Math.round(value)) : value.toFixed(2);
    }

    create() {
        const supported = APPLICATION_CONTEXT.adjustments.isSupported();
        const values = this.getValues();
        const children = [];

        if (!supported) {
            children.push(div({ class: "text-xs opacity-70 italic" }, $.t("adjustments.unsupported")));
        }

        if (this.histogramProvider && this._descriptors().some(d => d.key === "black" || d.key === "white")) {
            this._histCanvas = canvas({ class: "w-full", height: 32, style: "height:32px; display:block;" });
            // Click to re-probe: the histogram describes the current viewport.
            children.push(div({
                class: "w-full border border-base-300 rounded bg-base-200/60 cursor-pointer",
                title: $.t("adjustments.histogram"),
                onclick: () => this.refreshHistogram(),
            }, this._histCanvas));
        }

        for (const d of this._descriptors()) {
            const value = Number.isFinite(values[d.key]) ? values[d.key] : d.identity;
            const readout = span({ class: "opacity-70 tabular-nums" }, this._format(d, value));
            let control;
            if (d.toggle) {
                control = input({
                    type: "checkbox", class: "toggle toggle-xs",
                    checked: value > (d.min + d.max) / 2,
                    disabled: !supported,
                    "aria-label": $.t(d.labelKey),
                    onchange: (e) => this.onInput({ [d.key]: e.target.checked ? d.max : d.min }),
                });
            } else {
                control = input({
                    type: "range", class: "range range-xs range-primary w-full",
                    min: d.min, max: d.max, step: d.step, value,
                    disabled: !supported,
                    "aria-label": $.t(d.labelKey),
                    oninput: (e) => {
                        const v = Number(e.target.value);
                        readout.textContent = this._format(d, v);
                        this.onInput({ [d.key]: v });
                    },
                    // Double-click puts one slider back to "no effect".
                    ondblclick: () => {
                        control.value = String(d.identity);
                        readout.textContent = this._format(d, d.identity);
                        this.onInput({ [d.key]: d.identity });
                    },
                });
            }
            this._rows.set(d.key, { d, control, readout });
            children.push(d.toggle
                ? div({ class: "flex items-center justify-between gap-2" }, span({}, $.t(d.labelKey)), control)
                : div({ class: "flex flex-col" },
                    div({ class: "flex items-center justify-between gap-2" }, span({}, $.t(d.labelKey)), readout),
                    control));
        }

        const actions = [];
        if (this.onAuto) {
            actions.push(button({
                type: "button", class: "btn btn-xs btn-ghost", disabled: !supported,
                title: $.t("adjustments.autoHint"),
                onclick: async () => {
                    await this.onAuto();
                    this.refresh();
                },
            }, new PhIcon({ name: "ph-magic-wand" }).create(), $.t("adjustments.auto")));
        }
        if (this.onReset) {
            actions.push(button({
                type: "button", class: "btn btn-xs btn-ghost", disabled: !supported,
                title: $.t("adjustments.resetHint"),
                onclick: () => {
                    this.onReset();
                    this.refresh();
                },
            }, new PhIcon({ name: "ph-arrow-counter-clockwise" }).create(), $.t("adjustments.reset")));
        }
        if (actions.length) children.push(div({ class: "flex flex-row flex-wrap gap-1 justify-end" }, ...actions));

        const root = div({ ...this.commonProperties, ...this.extraProperties }, ...children);
        if (this._histCanvas && this.autoHistogram) this._observeHistogram();
        return root;
    }

    /** Probe on each transition into view. @private */
    _observeHistogram() {
        this._histObserver?.disconnect();
        if (typeof IntersectionObserver !== "function") {
            queueMicrotask(() => this.refreshHistogram());
            return;
        }
        let visible = false;
        this._histObserver = new IntersectionObserver((entries) => {
            const now = entries.some(e => e.isIntersecting);
            if (now && !visible) this.refreshHistogram();
            visible = now;
        });
        this._histObserver.observe(this._histCanvas);
    }

    destroy() {
        this._histObserver?.disconnect();
        this._histObserver = null;
    }

    /** Re-read values (after undo, a linked write, Auto …). Skips the slider being dragged. */
    refresh() {
        const values = this.getValues();
        for (const { d, control, readout } of this._rows.values()) {
            if (control === document.activeElement && !d.toggle) continue;
            const value = Number.isFinite(values[d.key]) ? values[d.key] : d.identity;
            if (d.toggle) control.checked = value > (d.min + d.max) / 2;
            else control.value = String(value);
            readout.textContent = this._format(d, value);
        }
    }

    async refreshHistogram() {
        const host = this._histCanvas;
        if (!host || !this.histogramProvider) return;
        let histogram = null;
        try {
            histogram = await this.histogramProvider();
        } catch (e) {
            APPLICATION_CONTEXT.log?.("core.adjustments")?.warn?.("histogram failed", e);
        }
        const ctx = host.getContext("2d");
        if (!ctx) return;
        const width = host.width = Math.max(64, host.clientWidth || 256);
        const height = host.height;
        ctx.clearRect(0, 0, width, height);
        const bins = histogram && !histogram.empty ? histogram.bins : null;
        if (!bins) return;
        // Log scale: a slide is mostly background, which would flatten everything else.
        const peak = Math.log1p(Math.max(...bins));
        if (!peak) return;
        ctx.fillStyle = getComputedStyle(host).color;
        ctx.globalAlpha = 0.6;
        const w = width / bins.length;
        bins.forEach((count, i) => {
            const h = Math.round((Math.log1p(count) / peak) * height);
            ctx.fillRect(i * w, height - h, Math.ceil(w), h);
        });
    }
}
