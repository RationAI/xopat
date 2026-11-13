import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { PhIcon } from "../elements/ph-icon.mjs";
import { AdjustmentControls } from "./adjustmentControls.mjs";

const { div, span, button, select, option, details, summary, input, label } = van.tags;

const SAMPLING_MODES = ["auto", "brightfield", "fluorescence", "pixelated"];

/**
 * @class DataAdjustmentsPanel
 * @extends BaseComponent
 * @description Per-viewer "Data" side panel: the data items the viewer draws
 * (background first, then visualization), each with its sampling mode and, per
 * shader layer, display adjustments with histogram, Auto, Reset and presets.
 * All state lives in `APPLICATION_CONTEXT.adjustments`; this is the view.
 *
 * Two-level init like the other side panels: `create()` builds the shell before
 * the viewer exists, `init(viewer)` binds it.
 */
export class DataAdjustmentsPanel extends BaseComponent {
    constructor(id) {
        super();
        this.id = id;
        this._viewer = null;
        this._controls = [];
        this._unsubscribe = null;
        this._viewerHandlers = [];
        this.classMap["base"] = "flex flex-col gap-2 p-2 text-xs";
    }

    create() {
        this._list = div({ class: "flex flex-col gap-2" });
        this._linkInput = input({
            type: "checkbox", class: "toggle toggle-xs",
            checked: APPLICATION_CONTEXT.adjustments.isLinked(),
            onchange: (e) => APPLICATION_CONTEXT.adjustments.setLinked(e.target.checked),
        });
        // Before/after needs the renderer's transient bypass; without it the button
        // would do nothing, so it is not offered (see Adjustments.isBypassSupported).
        this._bypassButton = button({
            type: "button",
            class: APPLICATION_CONTEXT.adjustments.isBypassSupported() ? "btn btn-xs btn-ghost" : "btn btn-xs btn-ghost display-none",
            title: $.t("adjustments.beforeAfterHint"),
            onclick: () => {
                if (this._viewer) APPLICATION_CONTEXT.adjustments.toggleBypass(this._viewer);
            },
        }, new PhIcon({ name: "ph-eye-slash" }).create(), $.t("adjustments.beforeAfter"));

        const toolbar = div({ class: "flex flex-row flex-wrap items-center gap-2 border-b border-base-300 pb-2" },
            label({ class: "flex items-center gap-1 cursor-pointer", title: $.t("adjustments.linkHint") },
                this._linkInput, span({}, $.t("adjustments.link"))),
            span({ class: "flex-1" }),
            button({
                type: "button", class: "btn btn-xs btn-ghost",
                title: $.t("adjustments.copyToViewersHint"),
                onclick: () => {
                    if (this._viewer) APPLICATION_CONTEXT.adjustments.copyToViewers(this._viewer);
                },
            }, new PhIcon({ name: "ph-copy-simple" }).create()),
            this._bypassButton,
            button({
                type: "button", class: "btn btn-xs btn-ghost",
                title: $.t("adjustments.resetAllHint"),
                onclick: () => {
                    if (this._viewer) APPLICATION_CONTEXT.adjustments.reset(this._viewer);
                },
            }, new PhIcon({ name: "ph-arrow-counter-clockwise" }).create()),
        );

        this._root = div({ ...this.commonProperties, ...this.extraProperties }, toolbar, this._list);
        return this._root;
    }

    /** @param {OpenSeadragon.Viewer} viewer */
    init(viewer) {
        if (this._viewer === viewer) return;
        this._detach();
        this._viewer = viewer;

        // Structure changes (slide/visualization switch) rebuild the list;
        // value changes (undo, session peer, linked viewer) only refresh it.
        const rebuild = () => this.render();
        const refresh = () => this.refresh();
        for (const [name, fn] of [["open", rebuild], ["visualization-ready", rebuild], ["shader-config-update", refresh]]) {
            viewer.addHandler(name, fn);
            this._viewerHandlers.push([name, fn]);
        }
        this._unsubscribe = APPLICATION_CONTEXT.adjustments.onChange((change) => {
            if (change.reason === "link") {
                this._linkInput.checked = APPLICATION_CONTEXT.adjustments.isLinked();
                return;
            }
            if (change.viewer !== this._viewer) return;
            if (change.reason === "bypass") this._reflectBypass();
            // Not "structure": the first insert happens mid-drag, and rebuilding
            // the list would replace the slider under the pointer.
            else if (change.reason === "sampling" || change.reason === "reset") this.refresh(true);
            else this.refresh();
        });
        this.render();
    }

    destroy() {
        this._detach();
        for (const controls of this._controls) controls.destroy();
        this._controls = [];
        this._viewer = null;
    }

    _detach() {
        this._unsubscribe?.();
        this._unsubscribe = null;
        for (const [name, fn] of this._viewerHandlers) this._viewer?.removeHandler?.(name, fn);
        this._viewerHandlers = [];
    }

    _reflectBypass() {
        const on = !!this._viewer && APPLICATION_CONTEXT.adjustments.isBypassed(this._viewer);
        this._bypassButton?.classList.toggle("btn-active", on);
    }

    /** Re-read values; `structural` also refreshes sampling selects and badges. */
    refresh(structural = false) {
        if (structural) return this.render();
        for (const controls of this._controls) controls.refresh();
    }

    render() {
        if (!this._list) return;
        for (const controls of this._controls) controls.destroy();
        this._controls = [];
        const viewer = this._viewer;
        const items = viewer ? APPLICATION_CONTEXT.adjustments.list(viewer) : [];
        const nodes = items.length
            ? items.map(item => this._renderItem(item))
            : [div({ class: "opacity-70 italic" }, $.t("adjustments.noData"))];
        this._list.replaceChildren(...nodes);
        this._reflectBypass();
    }

    _renderItem(item) {
        const adjustments = APPLICATION_CONTEXT.adjustments;
        const header = div({ class: "flex flex-row items-center gap-2" },
            span({ class: "badge badge-xs badge-outline" }, $.t(`adjustments.role.${item.role}`)),
            span({ class: "font-semibold truncate flex-1", title: item.label }, item.label),
        );

        const parts = [header];
        if (item.dataReference >= 0) {
            parts.push(label({ class: "flex items-center gap-2", title: $.t("adjustments.samplingHint") },
                span({ class: "opacity-70" }, $.t("adjustments.sampling")),
                select({
                    class: "select select-xs select-bordered flex-1",
                    onchange: (e) => adjustments.setSampling(item.dataReference, e.target.value),
                }, ...SAMPLING_MODES.map(mode =>
                    option({ value: mode, selected: mode === item.sampling }, $.t(`adjustments.samplingMode.${mode}`))))
            ));
        }

        for (const layer of item.layers) parts.push(this._renderLayer(layer, item.layers.length > 1));
        return div({ class: "flex flex-col gap-1 border border-base-300 rounded p-2 bg-base-100" }, ...parts);
    }

    _renderLayer(layer, showTitle) {
        const adjustments = APPLICATION_CONTEXT.adjustments;
        const viewer = this._viewer;
        const controls = new AdjustmentControls({
            getValues: () => adjustments.get(viewer, layer.id),
            onInput: (patch) => adjustments.set(viewer, layer.id, patch),
            histogram: () => adjustments.histogram(viewer, layer.id),
            onAuto: () => adjustments.autoLevels(viewer, layer.id),
            onReset: () => adjustments.reset(viewer, layer.id),
            // probes only while visible: open details in an open tab
        });
        this._controls.push(controls);

        const body = div({ class: "flex flex-col gap-1 pt-1" },
            controls.create(),
            this._renderPresets(layer, controls));

        return details({ open: layer.adjusted || !showTitle },
            summary({ class: "cursor-pointer select-none" },
                new PhIcon({ name: "ph-sliders-horizontal" }).create(),
                span({}, showTitle ? layer.title : $.t("adjustments.title")),
                layer.adjusted ? span({ class: "badge badge-xs badge-primary ml-1" }, $.t("adjustments.adjusted")) : null),
            body);
    }

    _renderPresets(layer, controls) {
        const adjustments = APPLICATION_CONTEXT.adjustments;
        const viewer = this._viewer;
        const names = Object.keys(adjustments.listPresets());
        const nameInput = input({
            type: "text", class: "input input-xs input-bordered flex-1 min-w-0",
            placeholder: $.t("adjustments.presetName"), maxlength: 64,
        });
        return div({ class: "flex flex-row flex-wrap items-center gap-1" },
            select({
                class: "select select-xs select-bordered flex-1 min-w-0",
                "aria-label": $.t("adjustments.presets"),
                onchange: (e) => {
                    const name = e.target.value;
                    if (!name) return;
                    adjustments.applyPreset(viewer, layer.id, name);
                    controls.refresh();
                    e.target.value = "";
                },
            },
                option({ value: "" }, $.t("adjustments.applyPreset")),
                ...names.map(name => option({ value: name }, name))),
            nameInput,
            button({
                type: "button", class: "btn btn-xs btn-ghost", title: $.t("adjustments.savePreset"),
                onclick: () => {
                    const name = nameInput.value.trim();
                    if (!name) return;
                    adjustments.savePreset(name, adjustments.get(viewer, layer.id));
                    this.render();
                },
            }, new PhIcon({ name: "ph-floppy-disk" }).create()),
        );
    }
}
