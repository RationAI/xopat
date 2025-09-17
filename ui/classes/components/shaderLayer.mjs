// ui/components/shaderLayer.mjs
import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { Div } from "../elements/div.mjs";
import { Button } from "../elements/buttons.mjs";
import { Checkbox } from "../elements/checkbox.mjs";
import { Select } from "../elements/select.mjs";
import { FAIcon } from "../elements/fa-icon.mjs";
import { RawHtml } from "../elements/rawHtml.mjs";

const { div, span, input, label, br } = van.tags;

/**
 * ShaderLayer
 * Replaces the legacy htmlHandler for FlexRenderer layers.
 *
 * Options:
 *  - id             : string (component id)
 *  - shaderLayer    : { id, error, htmlControls():string }
 *  - shaderConfig   : {
 *        fixed?: boolean,
 *        visible?: boolean,
 *        title?: string,
 *        type: string,
 *        params: { use_mode?: "show"|"clip"|"blend", ... },
 *        filters?: Record<string,{name:string,value:number}>
 *        _cacheApplied?: "hit"|"miss"|"stale"|string
 *    }
 *  - availableShaders: Array<{type:string,name:string}>
 *  - callbacks:
 *      onToggleVisible(checked)
 *      onChangeType(type)
 *      onChangeMode(nextMode)
 *      onSetFilter(key, value:number)
 *      onClearCache()
 */
export class ShaderLayer extends BaseComponent {
    constructor(options = undefined) {
        options = super(options).options;
        this.cfg = options.shaderConfig;
        this.layer = options.shaderLayer;
        this.availableShaders = options.availableShaders || [];
        this.cb = options.callbacks || {};

        this.body = new RawHtml({extraClasses: {nd: "non-draggable"}}, this.layer.htmlControls(html => `<div class="shader-controls-row">${html}</div>`));

        this.fixed = !!this.cfg.fixed;
        this.visible = this.cfg.visible !== false;
        this.mode = (this.cfg.params?.use_mode) || "show";   // "show" | "clip" | "blend"
        this.type = this.cfg.type;
        this.title = this.cfg.name;
        this.filters = options.availableFilters || {};   // { key: {name, value} }
        this.cacheApplied = this.cfg._cacheApplied;

        this.classMap.base = "shader-part bg-gradient-to-r from-primary to-transparent rounded-3 mx-1 mb-2 pl-2 pt-1 pb-2";
        this.classMap.resizable = "resizable";
        this.classMap.dim = this.visible ? "" : "brightness-50";
        this.classMap.clipNudge = this.visible && this.mode === "clip" ? "translate-x-[10px]" : "";
    }

    // ---- small helpers
    _isModeShow() { return !this.mode || this.mode === "show"; }
    _nextMode() { return this._isModeShow() ? "blend" : this.mode; } // legacy kept blend as the alt

    _buildHeaderLeft() {
        this.checkbox = new Checkbox({
            label: "",
            checked: this.visible,
            onchange: (e) => {
                const checked = e.target.checked;
                this.visible = checked;
                this.setClass("dim", checked ? "" : "brightness-50");
                this.cb.onToggleVisible?.(checked);
            }
        });
        // mark as non-draggable
        const left = div({ class: "flex items-center gap-2 non-draggable" },
            this.checkbox.create(),
            span({ class: "one-liner", title: this.title, style: "width:210px;vertical-align:bottom;" }, this.title),
        );
        return left;
    }

    _buildRenderTypeSelector() {
        // gear icon + hidden <select>
        const gear = new FAIcon({ name: "fa-sliders" });
        this.renderTypeSelect = new Select({
            id: this.id + "-change-render-type",
            title: "",
            selected: this.type,
            extraClasses: { xs: "select-xs" },
            extraProperties: {"disabled": "", "value": this.type},
            onchange: (e) => {
                const val = e.target.value;
                this.type = val;
                this.cb.onChangeType?.(val);
            }
        }, ...this.availableShaders.map(s => ({ value: s.type, text: s.name })));

        // disabled when fixed
        if (this.fixed) {
            this.renderTypeSelect.setExtraProperty("disabled", "disabled");
        }

        this.renderTypeSelect.setClass("display", "hidden");
        const wrap = new Div(
            { extraClasses: { inline: "inline-block non-draggable" }, extraProperties: {
                    "style": "float:right"
                } }, // non-draggable
            this.renderTypeSelect
        );
        return wrap.create();
    }

    _buildModeToggle() {
        const icon = new FAIcon({ name: "fa-layer-group" });
        this.modeBtn = new Button({
            id: this.layer.id + "-mode-toggle",     // keep legacy id
            size: Button.SIZE.SMALL,
            type: Button.TYPE.NONE,
            extraProperties: { title: "Toggle blending / info", style: `float:right; ${this.cfg.fixed ? "display:none;" : ""}` },
            onClick: () => this.cb.onChangeMode?.(toMode)
        }, icon);
        // mark the button as non-draggable so only the handle drags
        this.modeBtn.setClass("non-draggable", "non-draggable");

        if (this._isModeShow()) {
            this.modeBtn.setClass("tint", "text-base-300"); // legacy “tertiary”
        }

        return this.modeBtn.create();
    }

    _buildDragHandle() {
        const drag = new FAIcon({ name: "fa-up-down" });
        const btn = new Button({
            size: Button.SIZE.SMALL,
            type: Button.TYPE.NONE,
            extraProperties: {"style": "float:right"},
            // IMPORTANT: no 'non-draggable' here → this is the handle
            onClick: () => {}
        }, drag);
        return btn.create();
    }

    _buildHeader() {
        return div(
            { class: "h5 py-1 relative flex items-center gap-2 truncate max-w-full" },
            this._buildHeaderLeft(),
            this._buildRenderTypeSelector(),
            this._buildModeToggle(),
            this._buildDragHandle()
        );
    }

    _buildFilters() {
        // numeric inputs for filters present in config
        const rows = [];
        const entries = Object.entries(this.filters); // [key, {name,value}]
        for (const [key, f] of entries) {
            const onChange = (e) => {
                const v = Number.parseFloat(e.target.value);
                if (!Number.isNaN(v)) {
                    this.filters[key].value = v;
                    this.cb.onSetFilter?.(key, v);
                }
            };
            rows.push(
                label({ class: "text-xs mr-2" }, f.name + ":"),
                input({
                    type: "number",
                    value: f.value,
                    class: "input input-xs input-bordered w-24",
                    style: "margin-right: 8px;",
                    onchange: onChange
                }),
                br()
            );
        }
        return div({}, ...rows);
    }

    _buildCacheBanner() {
        if (!this.cacheApplied) return undefined;
        const clearBtn = new Button({
            size: Button.SIZE.TINY,
            type: Button.TYPE.SECONDARY,
            onClick: () => this.cb.onClearCache?.()
        }, new FAIcon({ name: "fa-broom" }), span("Clear cache"));

        return div(
            { class: "p-2 rounded-2 bg-base-200 mt-2 flex", style: "width:97%;" },
            span({ class: "text-xs flex-1" }, `Cache: ${this.cacheApplied} `),
            clearBtn.create()
        );
    }

    create() {
        // transform/dim styling
        this.setClass("clipNudge", this.visible && this.mode === "clip" ? "translate-x-[10px]" : "");
        this.setClass("dim", this.visible ? "" : "brightness-50");

        return div(
            {
                ...this.commonProperties,
                "data-id": this.layer.id,
                class: `${this.classState.val}`
            },
            this._buildHeader(),
            this.body.create(),
            this._buildFilters(),
            this._buildCacheBanner()
        );
    }

    // Optional: update from external changes (e.g., when renderer modifies config)
    update(shaderConfig) {
        this.cfg = shaderConfig;
        this.visible = shaderConfig?.visible !== false;
        this.mode = shaderConfig?.params?.use_mode || "show";
        this.type = shaderConfig?.type || this.type;
        this.cacheApplied = shaderConfig?._cacheApplied;

        // small visual updates
        this.setClass("clipNudge", this.visible && this.mode === "clip" ? "translate-x-[10px]" : "");
        this.setClass("dim", this.visible ? "" : "brightness-50");
        if (this.renderTypeSelect) {
            this.renderTypeSelect.setExtraProperty("value", this.type);
        }
    }
}