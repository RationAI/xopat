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
        this.htmlContext = options.htmlContext || {};
        this.availableShaders = options.availableShaders || [];
        this.cb = options.callbacks || {};

        this.hasChildren = !!(this.htmlContext.hasChildren || (this.cfg?.type === "group" && this.cfg?.shaders));
        this.isGroup = this.cfg?.type === "group" || this.hasChildren;
        this.depth = Number.isInteger(this.htmlContext.depth) ? this.htmlContext.depth : 0;
        this.isGroupChild = !!this.htmlContext.isGroupChild;
        this.groupOpen = this.cfg._uiGroupOpen ?? true;
        this.fixed = !!this.cfg.fixed;
        this.visible = this.cfg.visible !== false;
        this.mode = (this.cfg.params?.use_mode) || "show";   // "show" | "blend" | "clip"
        this.blendMode = this.cfg.params?.use_blend
            || (OpenSeadragon.WebGLModule?.BLEND_MODE?.[0] ?? "mask");
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
        this.childrenContainerId = this.id + "-children";
        this.bodyContainerId = this.id + "-body";
        this.blendSelectId = this.id + "-blend-select";
        this.compactIndent = Math.min(this.depth, 4) * 8;

        // card styling
        this.classMap.base =
            "relative shader-part card bg-base-200/90 shadow-sm mb-2 pt-1 border border-base-300";
        this.classMap.resizable = "resizable";
        this.classMap.dim = this.visible ? "" : "brightness-50";
        this.classMap.clipNudge = this.visible && this.mode === "clip" ? "translate-x-[6px]" : "";
        this.classMap.clipActive = this.mode === "clip"
            ? "ring-2 ring-offset-1 ring-accent/60"
            : "";
        this.classMap.group = this.isGroup ? "shader-part-group bg-base-100/95" : "";
        this.classMap.groupChild = this.isGroupChild ? "ml-2" : "";
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
        if (this.fixed || this.isGroup) return null;  // group type is structural, not user-switchable

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

        const chevronBtn = button(
            {
                type: "button",
                class:
                    "btn btn-ghost btn-xs min-h-0 h-5 px-1 ml-1",
                title: $.t("main.shaders.blendConfigure"),
                onclick: () => this._toggleBlendPopup()
            },
            new FAIcon({name: "fa-cogs"}).create()
        );

        return div(
            { class: "flex items-center gap-1 non-draggable" },
            badge,
            blendBadge,
            chevronBtn
        );
    }

    _toggleGroupBody() {
        if (!this.hasChildren) return;
        this.groupOpen = !this.groupOpen;
        this.cfg._uiGroupOpen = this.groupOpen;

        const body = document.getElementById(this.bodyContainerId);
        if (body) {
            body.classList.toggle("hidden", !this.groupOpen);
        }

        const btn = document.getElementById(this.id + "-group-toggle");
        if (btn) {
            btn.classList.toggle("rotate-90", this.groupOpen);
        }
    }

    _buildGroupToggle() {
        if (!this.hasChildren) return null;

        return button(
            {
                id: this.id + "-group-toggle",
                type: "button",
                class:
                    "btn btn-ghost btn-xs min-h-0 h-5 px-1 transition-transform " +
                    (this.groupOpen ? "rotate-90" : ""),
                title: this.groupOpen
                    ? ($.t("common.Collapse") || "Collapse")
                    : ($.t("common.Expand") || "Expand"),
                onclick: () => this._toggleGroupBody()
            },
            new FAIcon({ name: "fa-chevron-right" }).create()
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
                this._buildGroupToggle(),
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

    _syncBlendSelect() {
        const selectEl = document.getElementById(this.blendSelectId);
        if (selectEl) {
            selectEl.value = this.blendMode;
        }
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
                        id: this.blendSelectId,
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
                    { class: "shader-controls-row shader-controls-row--grid px-2", "data-columns": "2" },
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

    _wrapShaderControlRow(html) {
        if (typeof html !== "string") {
            return "";
        }

        const content = html.trim();
        if (!content) {
            return "";
        }

        return `<div class="shader-controls-row shader-controls-row--renderer w-full px-2 pb-1">${content}</div>`;
    }

    _renderShaderControls(shader) {
        if (!shader) {
            return "";
        }

        const fragments = [];
        const controls = shader._controls || {};
        for (const controlName in controls) {
            const control = shader[controlName] || controls[controlName];
            if (!control || typeof control.toHtml !== "function") {
                continue;
            }

            const wrapped = this._wrapShaderControlRow(control.toHtml());
            if (wrapped) {
                fragments.push(wrapped);
            }
        }

        if (shader._renderer) {
            fragments.push(`<h4>Rendering as ${shader._renderer.constructor.name()}</h4>`);
            fragments.push(this._renderShaderControls(shader._renderer));
        }

        if (shader._delegateShader) {
            fragments.push(this._renderShaderControls(shader._delegateShader));
        }

        return fragments.filter(Boolean).join("");
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

    _buildMainControls() {
        const htmlControls = this._renderShaderControls(this.layer) || (
            this.layer?.htmlControls
                ? this.layer.htmlControls(html => this._wrapShaderControlRow(html))
                : ""
        );

        const hasHtmlControls = typeof htmlControls === "string"
            ? htmlControls.trim().length > 0
            : !!htmlControls;
        const hasFilters = Object.keys(this.filters || {}).length > 0;

        if (!hasHtmlControls && !hasFilters) {
            return null;
        }

        return div(
            { class: "flex flex-col flex-grow min-w-0" },
            hasHtmlControls
                ? new RawHtml(
                    { extraClasses: { flex: "flex-1 min-w-0" } },
                    htmlControls
                ).create()
                : null,
            hasFilters ? this._buildFilters() : null,
        );
    }

    _buildChildrenContainer() {
        if (!this.hasChildren) return null;

        return div(
            {
                id: this.childrenContainerId,
                "data-parent-id": this.layer.id,
                "data-reverse-order": "true",
                class:
                    "shader-group-children flex flex-col"
            }
        );
    }

    getChildrenContainerId() {
        return this.childrenContainerId;
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

        const mainControls = this._buildMainControls();
        const hasUtilityRail = !this.hasChildren;
        const bodyContent = [];

        if (mainControls || hasUtilityRail) {
            bodyContent.push(
                div(
                    {
                        class:
                            "non-draggable flex flex-row items-stretch border-t border-base-300/60 pt-1 mt-1 min-w-0"
                    },
                    hasUtilityRail
                        ? div(
                            {
                                class:
                                    "non-draggable flex justify-between flex-col items-center gap-1 pt-1 pb-1 px-1 mb-2"
                            },
                            moveUpBtn,
                            moveDownBtn,
                            this._buildCacheIcon(),
                            this._buildCachePopup()
                        )
                        : div(
                            {
                                class:
                                    "non-draggable flex flex-col items-center gap-1 pt-1 pb-1 px-1"
                            },
                            this._buildCacheIcon(),
                            this._buildCachePopup()
                        ),
                    mainControls
                )
            );
        }

        if (this.hasChildren) {
            bodyContent.push(this._buildChildrenContainer());
        }

        return div(
            {
                ...this.commonProperties,
                "data-id": this.layer.id,
                "data-depth": String(this.depth),
                class: `${this.classState.val}`,
                style: this.compactIndent > 0 ? `margin-left:${this.compactIndent}px;` : undefined
            },
            this._buildHeader(),
            this._buildBlendControls(),
            div(
                {
                    id: this.bodyContainerId,
                    class: this.groupOpen || !this.hasChildren ? "" : "hidden"
                },
                ...bodyContent
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
        this._syncBlendSelect();

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
