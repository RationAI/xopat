// ui/components/shaderLayer.mjs
import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { Div } from "../elements/div.mjs";
import { Button } from "../elements/buttons.mjs";
import { Checkbox } from "../elements/checkbox.mjs";
import { Select } from "../elements/select.mjs";
import { FAIcon } from "../elements/fa-icon.mjs";
import { RawHtml } from "../elements/rawHtml.mjs";

const { div, span, select, option, button, input, label } = van.tags;

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
 *        params: { use_mode?: "show"|"clip"|"blend", use_blend?:string, ... },
 *        filters?: Record<string,{name:string,value:number}>
 *        _cacheApplied?: "hit"|"miss"|"stale"|string
 *    }
 *  - availableShaders: Array<{type:string,name:string}>
 *  - callbacks:
 *      onToggleVisible(checked)
 *      onChangeType(type)
 *      onChangeMode(mode, blend)
 *      onChangeBlend(mode, blend)
 *      onSetFilter(key, value:number)
 *      onClearCache()
 *      onReorder("up"|"down")
 */
export class ShaderLayer extends BaseComponent {
    constructor(options = undefined) {
        options = super(options).options;
        this.cfg = options.shaderConfig;
        this.layer = options.shaderLayer;
        this.availableShaders = options.availableShaders || [];
        this.cb = options.callbacks || {};

        this.fixed = !!this.cfg.fixed;
        this.visible = this.cfg.visible !== false;
        this.mode = (this.cfg.params?.use_mode) || "show";   // "show" | "blend" | "clip"
        this.blendMode = this.cfg.params?.use_blend
            || (OpenSeadragon.WebGLModule?.BLEND_MODE?.[0] ?? "normal");
        this.availableBlendModes = OpenSeadragon.FlexRenderer.BLEND_MODE;
        // todo dirty attachment to the config, but it's the only way to persist the state for now
        //    (underscore props do not export at least)
        this.blendOpen = this.cfg._uiBlendOpen ?? false;  // advanced / blending section
        this.cacheOpen = this.cfg._uiCacheOpen ?? false;  // cache submenu
        this.type = this.cfg.type;
        this.title = this.cfg.name;
        this.shortTitle = this._shortenMiddle(this.title, 32);
        this.filters = options.availableFilters || {};
        this.cacheApplied = this.cfg._cacheApplied;

        // card styling
        this.classMap.base =
            "relative shader-part card bg-base-200/90 shadow-sm mb-2 pt-1 pb-2 border border-base-300";
        this.classMap.resizable = "resizable";
        this.classMap.dim = this.visible ? "" : "brightness-50";
        this.classMap.clipNudge = this.visible && this.mode === "clip" ? "translate-x-[6px]" : "";
        this.classMap.clipActive = this.mode === "clip"
            ? "ring-2 ring-offset-1 ring-accent/60"
            : "";
    }

    // ---- small helpers
    _isModeShow() { return !this.mode || this.mode === "show"; }

    _shortenMiddle(text, max = 32) {
        if (!text || text.length <= max) return text;
        const keepStart = Math.ceil(max * 0.6);
        const keepEnd = max - keepStart - 3;
        return text.slice(0, keepStart) + "..." + text.slice(text.length - keepEnd);
    }

    // preferred non-"show" mode (used by other UI)
    _nextMode() {
        return this.mode && this.mode !== "show" ? this.mode : "blend";
    }

    // ---- header

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

        const titleSpan = span(
            {
                class: "text-sm truncate align-bottom one-liner",
                title: this.title,
            },
            this.shortTitle
        );

        return div(
            { class: "flex items-start gap-2 flex-1 min-w-0" },
            this.checkbox.create(),
            titleSpan
        );
    }

    _buildRenderTypeSelector() {
        if (this.fixed) return null;  // no shader selection when fixed

        this.renderTypeSelect = new Select({
            id: this.id + "-change-render-type",
            selected: this.type,
            extraClasses: {
                xs: "select-xs",
                base: "select select-bordered select-xs w-full max-w-[10rem]"
            },
            extraProperties: { value: this.type },
            onchange: (e) => {
                const val = e.target.value;
                this.type = val;
                this.cb.onChangeType?.(val);
            }
        }, ...this.availableShaders.map(s => ({ value: s.type, text: s.name })));

        return div(
            {
                class: "flex items-center gap-1 text-xs text-base-content/70 mb-1"
            },
            span($.t("main.shaders.shader")),
            this.renderTypeSelect.create()
        );
    }

    _buildHeaderBadges() {
        // compact “mode” pill, always visible
        const modeLabelMap = {
            show: $.t("main.shaders.modeShow"),
            blend: $.t("main.shaders.modeBlend"),
            clip: $.t("main.shaders.modeBlendClip"),
        };
        const modeColorMap = {
            show: "badge-ghost",
            blend: "badge-warning",
            clip: "badge-accent",
        };

        const baseBadgeClass =
            "badge badge-xs cursor-pointer transition-colors";

        const badge = span(
            {
                id: this.id + "-blend-toggle",
                class:
                    `${baseBadgeClass} ${modeColorMap[this.mode] || "badge-outline"}` +
                    (this.blendOpen ? " ring-1 ring-base-300/80" : ""),
                style: "height: 18px;",
                title: $.t("main.shaders.blendConfigure"),
                onclick: () => this._toggleBlendPopup(),
            },
            modeLabelMap[this.mode] ?? this.mode
        );

        const blendName = this.blendMode.toString().replace(/_/g, " ");
        const blendBadge = this._isModeShow()
            ? null
            : span(
                {
                    class:
                        "badge badge-outline badge-xs ml-1",
                    title: $.t("main.shaders.blendMode"),
                    style: "height: 18px;",
                    onclick: () => !this.fixed && this._toggleBlendPopup(),
                },
                blendName
            );

        // small chevron to indicate open/closed advanced section
        const chevronIcon = new FAIcon({
            name: this.blendOpen ? "fa-chevron-up" : "fa-chevron-down"
        });

        const chevronBtn = button(
            {
                type: "button",
                class:
                    "btn btn-ghost btn-xs min-h-0 h-5 px-1 ml-1",
                title: $.t("main.shaders.blendConfigure"),
                onclick: () => this._toggleBlendPopup()
            },
            chevronIcon.create()
        );

        return div(
            { class: "flex items-center gap-1 non-draggable" },
            badge,
            blendBadge,
            chevronBtn
        );
    }

    _buildHeader() {
        const clipHint = this.mode === "clip"
            ? span(
                {
                    class:
                        "text-[0.65rem] text-accent/90 italic ml-7 -mt-1 mb-1"
                },
                $.t("main.shaders.clipHint") ||
                "Layer is used as a clip mask over layers below."
            )
            : null;

        return div(
            { class: "px-2 pb-1 flex flex-col gap-0.5 truncate max-w-full select-none" },
            div(
                { class: "flex items-center gap-2" },
                this._buildHeaderLeft(),
                this._buildHeaderBadges(),
            ),
            clipHint
        );
    }

    _toggleBlendPopup() {
        this.blendOpen = !this.blendOpen;
        this.cfg._uiBlendOpen = this.blendOpen;   // persist

        const el = document.getElementById(this.id + "-blend-controls");
        if (el) {
            el.classList.toggle("hidden", !this.blendOpen);
        }

        const hdr = document.getElementById(this.id + "-blend-toggle");
        if (hdr) {
            hdr.classList.toggle("ring-1", this.blendOpen);
            hdr.classList.toggle("ring-base-300/80", this.blendOpen);
        }
    }

    _setMode(mode) {
        if (this.mode === mode) return;
        this.mode = mode;

        // update UI badges / nudge / clip highlight
        this.setClass(
            "clipNudge",
            this.visible && this.mode === "clip" ? "translate-x-[6px]" : ""
        );
        this.setClass(
            "clipActive",
            this.mode === "clip" ? "ring-2 ring-offset-1 ring-accent/60" : ""
        );

        // update header pill text & color
        const hdr = document.getElementById(this.id + "-blend-toggle");
        if (hdr) {
            const modeLabelMap = {
                show: $.t("main.shaders.modeShow"),
                blend: $.t("main.shaders.modeBlend"),
                clip: $.t("main.shaders.modeBlendClip"),
            };
            const modeColorMap = {
                show: "badge-ghost",
                blend: "badge-warning",
                clip: "badge-accent",
            };
            hdr.textContent = modeLabelMap[this.mode] ?? this.mode;
            hdr.classList.remove("badge-ghost", "badge-warning", "badge-accent", "badge-outline");
            hdr.classList.add(modeColorMap[this.mode] || "badge-outline");
        }

        this.cb.onChangeMode?.(mode, this.blendMode);
    }

    _setBlendMode(blend) {
        this.blendMode = blend;
        this.cb.onChangeBlend?.(this.mode, blend);
    }

    // ---- advanced / blending section

    _buildBlendControls() {
        const modeBtnClasses = (mode) =>
            "btn btn-xs flex-1 " +
            (this.mode === mode ? "btn-primary" : "btn-ghost");

        const modeButtons = div(
            { class: "btn-group w-full mt-1" },
            button(
                {
                    class: modeBtnClasses("show"),
                    type: "button",
                    "data-mode": "show",
                    onclick: () => this._setMode("show")
                },
                $.t("main.shaders.modeShowShort")
            ),
            button(
                {
                    class: modeBtnClasses("blend"),
                    type: "button",
                    "data-mode": "blend",
                    onclick: () => this._setMode("blend")
                },
                $.t("main.shaders.modeBlendShort")
            ),
            button(
                {
                    class: modeBtnClasses("clip"),
                    type: "button",
                    "data-mode": "clip",
                    onclick: () => this._setMode("clip")
                },
                $.t("main.shaders.modeClipShort")
            )
        );

        const blendOptions = this.availableBlendModes.map(b =>
            option({ value: b }, b.replace(/_/g, " "))
        );

        const blendDisabled = this._isModeShow() || this.fixed;

        console.log("fixed", this.fixed, "blendDisabled", blendDisabled);
        return div(
            {
                id: this.id + "-blend-controls",
                class:
                    "non-draggable px-2 pb-2 pt-1 text-xs border-t border-base-300 bg-base-100/70 " +
                    (this.blendOpen ? "" : "hidden") +
                    (this.fixed ? "opacity-50 pointer-events-none" : "")
            },
            this._buildRenderTypeSelector(),
            div(
                {
                    class:
                        "flex flex-row items-center justify-between text-[0.7rem] text-base-content/70 mb-1"
                },
                span($.t("main.shaders.blendingTitle")),
                span(
                    { class: "italic" },
                    this._isModeShow()
                        ? $.t("main.shaders.blendingInfoShow")
                        : $.t("main.shaders.blendingInfoMask")
                )
            ),
            div(
                {
                    class:
                        "flex items-center gap-2 mt-1"
                },
                modeButtons,
                select(
                    {
                        class: "select select-bordered select-xs w-full max-w-xs",
                        value: this.blendMode,
                        disabled: blendDisabled ? "disabled" : undefined,
                        onchange: (e) => this._setBlendMode(e.target.value)
                    },
                    ...blendOptions
                )
            )
        );
    }

    // ---- filters (legacy per-layer controls)

    _buildFilters() {
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
                div(
                    { class: "shader-controls-row flex items-center px-2" },
                    label({ class: "text-xs mr-2" }, f.name + ":"),
                    input({
                        type: "number",
                        value: f.value,
                        class: "input input-xs input-bordered w-24",
                        style: "margin-right: 8px;",
                        onchange: onChange
                    })
                ),
            );
        }
        return div({}, ...rows);
    }

    // ---- cache icon + submenu

    _toggleCachePopup() {
        this.cacheOpen = !this.cacheOpen;
        this.cfg._uiCacheOpen = this.cacheOpen;  // persist

        const el = document.getElementById(this.id + "-cache-popup");
        if (el) {
            el.classList.toggle("hidden", !this.cacheOpen);
        }
    }

    _buildCacheIcon() {
        if (!this.cacheApplied) {
            // keep layout consistent even without cache state
            return div({ class: "mt-2" });
        }

        const statusColor = {
            hit: "text-success",
            stale: "text-warning",
            miss: "text-error"
        }[this.cacheApplied] || "text-base-content/70";

        const icon = new FAIcon({ name: "fa-broom" });
        return button(
            {
                type: "button",
                class:
                    `btn-ghost ${statusColor} btn-[10px] min-h-0 px-1 leading-[0] mt-1`,
                title: $.t("main.shaders.cacheInfo"),
                onclick: () => this._toggleCachePopup()
            },
            icon.create()
        );
    }

    _buildCachePopup() {
        if (!this.cacheApplied) return undefined;

        const statusLabelMap = {
            hit: $.t("main.shaders.cacheHit"),
            miss: $.t("main.shaders.cacheMiss"),
            stale: $.t("main.shaders.cacheStale")
        };

        const clearBtn = new Button({
            size: Button.SIZE.TINY,
            type: Button.TYPE.SECONDARY,
            onClick: () => {
                this.cb.onClearCache?.();
                if (this.cacheOpen) {
                    this._toggleCachePopup();
                }
            }
        }, new FAIcon({ name: "fa-broom" }), span($.t("main.shaders.cacheClear")));

        const closeButton = new Button({
            size: Button.SIZE.TINY,
            type: Button.TYPE.GHOST,
            onClick: () => {
                this._toggleCachePopup();
            }
        }, new FAIcon({ name: "fa-close" }), span($.t("common.Close")));

        return div(
            {
                id: this.id + "-cache-popup",
                class:
                    "absolute left-2 right-2 bottom-2 z-20 p-2 rounded bg-base-200 shadow-lg border border-base-300 text-xs " +
                    (this.cacheOpen ? "" : "hidden")
            },
            div(
                { class: "flex items-center justify-between mb-1" },
                span({ class: "font-semibold" }, $.t("main.shaders.cacheTitle")),
                span(
                    { class: "text-[0.7rem] uppercase tracking-wide" },
                    this.cacheApplied
                )
            ),
            span(
                { class: "block mb-2" },
                statusLabelMap[this.cacheApplied] ||
                $.t("main.shaders.cacheInfo")
            ),
            div({ class: "flex flex-row justify-between" }, closeButton.create(), clearBtn.create())
        );
    }

    // ---- main render

    create() {
        this.setClass(
            "clipNudge",
            this.visible && this.mode === "clip" ? "translate-x-[6px]" : ""
        );
        this.setClass("dim", this.visible ? "" : "brightness-50");
        this.setClass(
            "clipActive",
            this.mode === "clip" ? "ring-2 ring-offset-1 ring-accent/60" : ""
        );

        const moveUpBtn = button(
            {
                type: "button",
                class:
                    "btn-ghost btn-[10px] min-h-0 leading-[0]",
                title: $.t("main.shaders.moveUp"),
                onclick: () => this.cb.onReorder?.("up")
            },
            new FAIcon({ name: "fa-chevron-up" }).create()
        );

        const moveDownBtn = button(
            {
                type: "button",
                class:
                    "btn-ghost btn-[10px] min-h-0 leading-[0]",
                title: $.t("main.shaders.moveDown"),
                onclick: () => this.cb.onReorder?.("down")
            },
            new FAIcon({ name: "fa-chevron-down" }).create()
        );

        const mainControls = div(
            { class: "flex flex-col flex-grow" },
            new RawHtml(
                { extraClasses: { flex: "flex-1" } },
                this.layer.htmlControls(html =>
                    `<div class="shader-controls-row w-full px-2 pb-1">${html}</div>`
                )
            ).create(),
            this._buildFilters(),
        );

        return div(
            {
                ...this.commonProperties,
                "data-id": this.layer.id,
                class: `${this.classState.val}`
            },
            this._buildHeader(),
            this._buildBlendControls(),
            div(
                {
                    class:
                        "non-draggable flex flex-row items-stretch border-t border-base-300/60 pt-1 mt-1"
                },
                div(
                    {
                        class:
                            "non-draggable flex justify-between flex-col items-center gap-1 pt-1 pb-1 px-1 mb-2"
                    },
                    moveUpBtn,
                    moveDownBtn,
                    this._buildCacheIcon(),
                    this._buildCachePopup()
                ),
                mainControls
            ),
        );
    }

    update(shaderConfig) {
        this.cfg = shaderConfig;
        this.visible = shaderConfig?.visible !== false;
        this.mode = shaderConfig?.params?.use_mode || "show";
        this.blendMode = shaderConfig?.params?.use_blend || this.blendMode;
        this.type = shaderConfig?.type || this.type;
        this.cacheApplied = shaderConfig?._cacheApplied;

        if (this.renderTypeSelect) {
            this.renderTypeSelect.setExtraProperty("value", this.type);
        }

        this.setClass(
            "clipNudge",
            this.visible && this.mode === "clip" ? "translate-x-[6px]" : ""
        );
        this.setClass("dim", this.visible ? "" : "brightness-50");
        this.setClass(
            "clipActive",
            this.mode === "clip" ? "ring-2 ring-offset-1 ring-accent/60" : ""
        );
    }
}