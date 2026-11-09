// ui/components/shaderLayer.mjs
import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { Div } from "../elements/div.mjs";
import { Button } from "../elements/buttons.mjs";
import { Select } from "../elements/select.mjs";
import { PhIcon } from "../elements/ph-icon.mjs";
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
 *        cache?: object,
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
        // unified collapse state: legacy group configs may still carry _uiGroupOpen
        this.collapsed = this.cfg._uiCollapsed
            ?? (this.hasChildren ? !(this.cfg._uiGroupOpen ?? true) : false);
        this._collapsedBeforeHide = this.cfg._uiCollapsedBeforeHide;
        this.fixed = !!this.cfg.fixed;
        // cfg.visible can be boolean (UI toggle) or 0/1 (renderer spec / applySnapshotState).
        this.visible = this.cfg.visible !== false && this.cfg.visible !== 0;
        this.mode = (this.cfg.params?.use_mode) || "show";   // "show" | "blend" | "clip"
        this.availableBlendModes = OpenSeadragon.FlexRenderer.SUPPORTED_BLEND_MODES || [];
        this.blendMode = this.cfg.params?.use_blend
            || this.availableBlendModes[0]
            || "mask";
        // todo dirty attachment to the config, but it's the only way to persist the state for now
        //    (underscore props do not export at least)
        this.blendOpen = this.cfg._uiBlendOpen ?? false;  // advanced / blending section
        // cache dropdown is transient (closes on outside click), so it is not persisted
        this.cacheOpen = false;
        this._cacheOutsideHandler = (e) => {
            if (!this._cacheDropdownWrap?.contains(e.target)) this._setCacheOpen(false);
        };
        this.type = this.cfg.type;
        this.title = this.cfg.name;
        this.shortTitle = this._shortenMiddle(this.title, 32);
        this.filters = options.availableFilters || {};
        this.cacheApplied = ShaderLayer.resolveCacheStatus(this.cfg);
        this.childrenContainerId = this.id + "-children";
        this.bodyContainerId = this.id + "-body";
        this.collapseContainerId = this.id + "-collapse";
        this.blendSelectId = this.id + "-blend-select";
        this.compactIndent = Math.min(this.depth, 4) * 8;

        // card styling
        // Card density (margin / padding / control heights) lives in the
        // `.shader-part` rules in src/assets/style.css, not in utility classes:
        // the shipped tailwind.min.css is purged, so fractional-scale utilities
        // are not guaranteed to exist in it.
        this.classMap.base =
            "relative shader-part card bg-base-200/90 shadow-sm border border-base-300";
        this.classMap.resizable = "resizable";
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
        this._eyeIcon = new PhIcon({ name: this.visible ? "ph-eye" : "ph-eye-slash" });
        const eyeBtn = button(
            {
                type: "button",
                class: "btn btn-ghost btn-xs min-h-0 h-5 px-1",
                title: this.visible
                    ? $.t("main.shaders.hideLayer")
                    : $.t("main.shaders.showLayer"),
                onclick: (e) => {
                    e.stopPropagation();
                    this._setVisible(!this.visible);
                    e.currentTarget.title = this.visible
                        ? $.t("main.shaders.hideLayer")
                        : $.t("main.shaders.showLayer");
                    this.cb.onToggleVisible?.(this.visible);
                }
            },
            this._eyeIcon.create()
        );

        // Disclosure caret. The reorder rail beside it also draws carets, so the
        // affordance for "this expands" has to be its own glyph sitting directly
        // against the title — a caret that only ever points right/down.
        this._collapseIcon = new PhIcon({
            name: this._isCollapsed() ? "ph-caret-right" : "ph-caret-down"
        });
        const collapseCaret = span(
            { class: "shader-collapse-caret opacity-70 shrink-0" },
            this._collapseIcon.create()
        );

        this._titleSpan = span(
            {
                class: "text-sm font-semibold truncate align-bottom one-liner" + (this.visible ? "" : " opacity-60"),
                title: this.title + "\n" + $.t("main.shaders.collapseHint"),
            },
            this.shortTitle
        );

        return div(
            { class: "flex items-center gap-1 flex-1 min-w-0" },
            eyeBtn,
            this._buildReorderRail(),
            collapseCaret,
            this._titleSpan
        );
    }

    _setVisible(visible) {
        const wasVisible = this.visible;
        this.visible = !!visible;
        this._eyeIcon?.changeIcon(this.visible ? "ph-eye" : "ph-eye-slash");
        this._titleSpan?.classList.toggle("opacity-60", !this.visible);
        // Hiding a layer folds its controls away — they describe something that
        // is not on screen. It no longer *locks* them away: the header still
        // expands (see _isCollapsed). Only the visible→hidden *transition* does
        // this, so an update() on an already-hidden layer cannot keep undoing an
        // expand the user just performed. The pre-hide state is remembered and
        // restored on unhide, unless the user toggled collapse in between
        // (_setCollapsed clears the memory).
        if (wasVisible && !this.visible) {
            const before = this.collapsed;
            this._setCollapsed(true);
            this._collapsedBeforeHide = before;
            this.cfg._uiCollapsedBeforeHide = before;   // persist across re-render
        } else if (!wasVisible && this.visible && typeof this._collapsedBeforeHide === "boolean") {
            this._setCollapsed(this._collapsedBeforeHide);
        } else {
            this._applyCollapsed();
        }
    }

    /** Display name of the layer's own type, whether or not the menu offers it. */
    _shaderTypeName() {
        const offered = this.availableShaders.find(s => s.type === this.type);
        if (offered) return offered.name;
        try {
            const ShaderClass = OpenSeadragon.FlexRenderer.ShaderLayerRegistry.get(this.type);
            if (typeof ShaderClass?.name === "function") return ShaderClass.name();
        } catch (e) {
            // registry unavailable — the raw type is still more truthful than nothing
        }
        return this.type || "";
    }

    _buildRenderTypeSelector() {
        if (this.fixed || this.isGroup) return null;  // group type is structural, not user-switchable

        // A type the menu does not offer (structural wrappers, debug shaders) has no matching
        // option. A select built anyway shows an unrelated shader as if it were this layer's,
        // and a single change event then rewrites the layer to that shader — destroying params
        // no other type declares. Show what the layer is instead.
        if (!this.availableShaders.some(s => s.type === this.type)) {
            return div(
                { class: "flex items-center gap-1 text-xs text-base-content/70 mb-1" },
                span($.t("main.shaders.shader")),
                span({ class: "font-medium" }, this._shaderTypeName())
            );
        }

        this.renderTypeSelect = new Select({
            id: this.id + "-change-render-type",
            selected: this.type,
            extraClasses: {
                xs: "select-xs",
                base: "select select-bordered select-xs w-full max-w-[10rem]"
            },
            extraProperties: { value: this.type, title: $.t("main.shaders.typeSelectHint") },
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

    _pillTitle() {
        const modeInfo = this.mode === "clip"
            ? $.t("main.shaders.blendingInfoMaskClip")
            : $.t("main.shaders.blendingInfoMask");
        return modeInfo + "\n" + $.t("main.shaders.pillHint");
    }

    _buildHeaderBadges() {
        // single mode/blend pill — pure indicator, hidden while mode is "show"
        const pill = span(
            {
                id: this.id + "-mode-pill",
                class:
                    "badge badge-xs shader-mode-pill transition-colors " +
                    (this.mode === "clip" ? "badge-accent" : "badge-warning") +
                    (this._isModeShow() ? " hidden" : ""),
                title: this._pillTitle(),
            },
            this.blendMode.toString().replace(/_/g, " ")
        );

        const chevronBtn = button(
            {
                type: "button",
                class:
                    "btn btn-ghost btn-xs min-h-0 h-5 px-1 ml-1",
                title: $.t("main.shaders.blendConfigure"),
                onclick: (e) => {
                    e.stopPropagation();
                    this._toggleBlendPopup();
                }
            },
            new PhIcon({name: "ph-gear"}).create()
        );

        return div(
            { class: "flex items-center gap-1 non-draggable" },
            pill,
            this._buildCacheDropdown(),
            chevronBtn
        );
    }

    _refreshPill() {
        const pill = document.getElementById(this.id + "-mode-pill");
        if (!pill) return;
        pill.textContent = this.blendMode.toString().replace(/_/g, " ");
        pill.title = this._pillTitle();
        pill.classList.toggle("badge-accent", this.mode === "clip");
        pill.classList.toggle("badge-warning", this.mode !== "clip");
        pill.classList.toggle("hidden", this._isModeShow());
    }

    /**
     * Collapse state is the user's alone. It deliberately does NOT fold in
     * `!this.visible`: doing so made a hidden layer's entire body — blend panel,
     * shader-type selector, every control — permanently unreachable, because the
     * only way to expand it was a click handler that was itself gated on
     * visibility. Hiding still auto-collapses (see {@link _setVisible}); the
     * difference is that the user can open it again.
     */
    _isCollapsed() {
        return this.collapsed;
    }

    _setCollapsed(collapsed) {
        this.collapsed = !!collapsed;
        this.cfg._uiCollapsed = this.collapsed;   // persist
        this._collapsedBeforeHide = undefined;
        delete this.cfg._uiCollapsedBeforeHide;
        if (this.hasChildren) {
            this.cfg._uiGroupOpen = !this.collapsed;  // keep legacy flag in sync
        }
        this._applyCollapsed();
    }

    _toggleCollapsed() {
        this._setCollapsed(!this.collapsed);
    }

    _applyCollapsed() {
        const collapsed = this._isCollapsed();

        const wrapper = document.getElementById(this.collapseContainerId);
        if (wrapper) {
            wrapper.classList.toggle("hidden", collapsed);
        }
        this._collapseIcon?.changeIcon(collapsed ? "ph-caret-right" : "ph-caret-down");
        if (this._headerRow) {
            this._headerRow.setAttribute("aria-expanded", String(!collapsed));
        }
    }

    _buildReorderRail() {
        const arrow = (dir, icon, titleKey) => button(
            {
                type: "button",
                class: "btn-ghost shader-reorder-btn min-h-0 leading-[0]",
                title: $.t(titleKey),
                onclick: (e) => {
                    e.stopPropagation();
                    this.cb.onReorder?.(dir);
                }
            },
            new PhIcon({ name: icon }).create()
        );

        // Revealed on card hover / keyboard focus (see `.shader-reorder` in
        // src/assets/style.css). At rest the header is eye + caret + title +
        // gear, which is what keeps its height down and stops the two reorder
        // carets from reading as a disclosure control.
        return div(
            { class: "shader-reorder non-draggable flex flex-col items-center shrink-0" },
            arrow("up", "ph-caret-up", "main.shaders.moveUp"),
            arrow("down", "ph-caret-down", "main.shaders.moveDown")
        );
    }

    _buildHeader() {
        const clipHint = this.mode === "clip"
            ? span(
                {
                    class:
                        "text-xs text-accent/90 italic ml-7 -mt-1 mb-1"
                },
                $.t("main.shaders.clipHint")
            )
            : null;

        // Enter/Space are contextual keys inside this widget, so they stay local
        // and are deliberately NOT registered with APPLICATION_CONTEXT.shortcuts.
        this._headerRow = div(
            {
                class: "flex items-center gap-2 cursor-pointer",
                title: $.t("main.shaders.collapseHint"),
                role: "button",
                tabindex: "0",
                "aria-expanded": String(!this._isCollapsed()),
                onclick: () => this._toggleCollapsed(),
                onkeydown: (e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    this._toggleCollapsed();
                }
            },
            this._buildHeaderLeft(),
            this._buildHeaderBadges(),
        );

        return div(
            // No `truncate` (overflow: hidden) here — it would clip the cache
            // dropdown; the title span truncates itself.
            { class: "shader-part__header flex flex-col min-w-0 max-w-full select-none" },
            this._headerRow,
            clipHint
        );
    }

    _toggleBlendPopup() {
        this.blendOpen = !this.blendOpen;
        this.cfg._uiBlendOpen = this.blendOpen;   // persist

        // The blend panel lives *inside* the collapse wrapper, so opening it on a
        // collapsed card would toggle a node nobody can see. Expand first — and
        // the gear stops the click from reaching the header handler, so nothing
        // else would do it for us.
        if (this.blendOpen && this._isCollapsed()) {
            this._setCollapsed(false);
        }

        const el = document.getElementById(this.id + "-blend-controls");
        if (el) {
            el.classList.toggle("hidden", !this.blendOpen);
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

        this._refreshPill();

        this.cb.onChangeMode?.(mode, this.blendMode);
    }

    _setBlendMode(blend) {
        this.blendMode = blend;
        this._refreshPill();
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
                    title: $.t("main.shaders.blendingInfoShow"),
                    onclick: () => this._setMode("show")
                },
                $.t("main.shaders.modeShowShort")
            ),
            button(
                {
                    class: modeBtnClasses("blend"),
                    type: "button",
                    "data-mode": "blend",
                    title: $.t("main.shaders.blendingInfoMask"),
                    onclick: () => this._setMode("blend")
                },
                $.t("main.shaders.modeBlendShort")
            ),
            button(
                {
                    class: modeBtnClasses("clip"),
                    type: "button",
                    "data-mode": "clip",
                    title: $.t("main.shaders.blendingInfoMaskClip"),
                    onclick: () => this._setMode("clip")
                },
                $.t("main.shaders.modeClipShort")
            )
        );

        // mark the active option as selected — assigning `value` on the select
        // happens before options are attached, so it would reset to the first option
        const blendOptions = this.availableBlendModes.map(b =>
            option({ value: b, selected: b === this.blendMode }, b.replace(/_/g, " "))
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
                        "flex flex-row items-center justify-between text-xs text-base-content/70 mb-1"
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
                        title: $.t("main.shaders.blendSelectHint"),
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
            // constructor.name() is a library-provided static id, not user input.
            fragments.push(`<h4 class="text-xs font-semibold opacity-70 px-2 pt-2">${
                $.t("main.shaders.renderingAs", { renderer: shader._renderer.constructor.name() })
            }</h4>`);
            fragments.push(this._renderShaderControls(shader._renderer));
        }

        if (shader._delegateShader) {
            fragments.push(this._renderShaderControls(shader._delegateShader));
        }

        return fragments.filter(Boolean).join("");
    }

    // ---- cache icon + submenu

    _setCacheOpen(open) {
        this.cacheOpen = !!open;
        if (!this._cacheDropdownWrap) return;
        this._cacheDropdownWrap.classList.toggle("dropdown-open", this.cacheOpen);
        if (this.cacheOpen) {
            document.addEventListener("click", this._cacheOutsideHandler, { capture: true });
        } else {
            document.removeEventListener("click", this._cacheOutsideHandler, { capture: true });
            // DaisyUI also opens `.dropdown` on :focus-within — drop focus or it stays shown.
            if (this._cacheDropdownWrap.contains(document.activeElement)) {
                document.activeElement.blur();
            }
        }
    }

    /**
     * Cache status that decides whether the layer offers "clear cache".
     * `_cacheApplied` names where an override came from (local snapshot, live session),
     * but it is instance state and never serialized — a cache that arrives inside the
     * session itself (URL hash, exported file) carries no provenance. Any non-empty cache
     * must stay clearable: a stale value can silently override the authored params.
     * @param {object} cfg shader config
     * @return {string|undefined}
     */
    static resolveCacheStatus(cfg) {
        if (cfg?._cacheApplied) return cfg._cacheApplied;
        return ShaderLayer.hasCachedValues(cfg?.cache) ? "saved" : undefined;
    }

    /**
     * Whether a cache root holds any value. The renderer keeps one bucket per shader type
     * (`{[type]: {[name]: value}}`) and creates the current type's bucket on first access, so
     * an empty bucket is not a saved value; a flat 3.x cache (`{[name]: value}`) still counts.
     * @param {object} cache
     * @return {boolean}
     */
    static hasCachedValues(cache) {
        if (!cache || typeof cache !== "object") return false;
        return Object.values(cache).some(value =>
            value && typeof value === "object" && !Array.isArray(value)
                ? Object.keys(value).length > 0
                : value !== undefined);
    }

    /**
     * Header-row cache indicator: an icon that opens a dropdown directly below it
     * (same DaisyUI dropdown pattern as the shader menu's cache-snapshot bookmark).
     * Lives in the header so a cache override is visible without expanding the layer.
     */
    _buildCacheDropdown() {
        if (!this.cacheApplied) {
            this._cacheDropdownWrap = null;
            return null;
        }

        // hit/stale/miss are forward-looking statuses; the actual provenance values
        // written today are id/path/name/name+path/order/order+path/session.
        // Default to text-info (clearly visible) so users notice the override.
        const statusStyle = {
            hit: "text-success bg-success/10",
            stale: "text-warning bg-warning/10",
            miss: "text-error bg-error/10"
        }[this.cacheApplied] || "text-info bg-info/10";

        const statusLabelMap = {
            hit: $.t("main.shaders.cacheHit"),
            miss: $.t("main.shaders.cacheMiss"),
            stale: $.t("main.shaders.cacheStale"),
            saved: $.t("main.shaders.cacheSaved")
        };

        const trigger = button(
            {
                type: "button",
                class: `btn btn-xs btn-ghost ${statusStyle} min-h-0 h-5 px-0.5`,
                title: $.t("main.shaders.cacheInfo"),
                onclick: () => this._setCacheOpen(!this.cacheOpen)
            },
            new PhIcon({ name: "ph-broom" }).create()
        );

        const clearBtn = new Button({
            size: Button.SIZE.TINY,
            type: Button.TYPE.SECONDARY,
            onClick: () => {
                this._setCacheOpen(false);
                this.cb.onClearCache?.();
            }
        }, new PhIcon({ name: "ph-broom" }), span($.t("main.shaders.cacheClear")));

        // Padding/width inline: the shipped tailwind.min.css is the purged build.
        const content = div(
            {
                class: "dropdown-content shadow bg-base-100 rounded-box border border-base-300 z-20 text-xs",
                style: "min-width: 12rem; padding: 0.5rem;"
            },
            div(
                { class: "flex items-center justify-between mb-1" },
                span({ class: "font-semibold" }, $.t("main.shaders.cacheTitle")),
                span({ class: "text-[0.7rem] uppercase tracking-wide" }, this.cacheApplied)
            ),
            span(
                { class: "block mb-2 whitespace-normal" },
                statusLabelMap[this.cacheApplied] || $.t("main.shaders.cacheInfo")
            ),
            div({ class: "flex flex-row justify-end" }, clearBtn.create())
        );

        // Clicks/keys inside must not reach the header row, which toggles collapse.
        this._cacheDropdownWrap = div(
            {
                class: "dropdown dropdown-end non-draggable",
                onclick: (e) => e.stopPropagation(),
                onkeydown: (e) => e.stopPropagation()
            },
            trigger,
            content
        );
        return this._cacheDropdownWrap;
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
        this.setClass(
            "clipActive",
            this.mode === "clip" ? "ring-2 ring-offset-1 ring-accent/60" : ""
        );

        const mainControls = this._buildMainControls();
        const bodyContent = [];

        if (mainControls) {
            bodyContent.push(
                div(
                    {
                        class:
                            "non-draggable border-t border-base-300/60 pt-1 mt-1 min-w-0"
                    },
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
            div(
                {
                    id: this.collapseContainerId,
                    class: this._isCollapsed() ? "hidden" : ""
                },
                this._buildBlendControls(),
                div(
                    { id: this.bodyContainerId },
                    ...bodyContent
                ),
            ),
        );
    }

    update(shaderConfig) {
        this.cfg = shaderConfig;
        this.mode = shaderConfig?.params?.use_mode || "show";
        this.blendMode = shaderConfig?.params?.use_blend || this.blendMode;
        this.type = shaderConfig?.type || this.type;
        this.cacheApplied = ShaderLayer.resolveCacheStatus(shaderConfig);
        this.collapsed = shaderConfig?._uiCollapsed ?? this.collapsed;
        this._collapsedBeforeHide = shaderConfig?._uiCollapsedBeforeHide ?? this._collapsedBeforeHide;

        // Only when an option actually carries this type — otherwise the select would land on
        // an unrelated shader (see _buildRenderTypeSelector).
        if (this.renderTypeSelect && this.availableShaders.some(s => s.type === this.type)) {
            this.renderTypeSelect.setExtraProperty("value", this.type);
        }
        this._syncBlendSelect();
        this._refreshPill();
        this._setVisible(shaderConfig?.visible !== false && shaderConfig?.visible !== 0);

        this.setClass(
            "clipNudge",
            this.visible && this.mode === "clip" ? "translate-x-[6px]" : ""
        );
        this.setClass(
            "clipActive",
            this.mode === "clip" ? "ring-2 ring-offset-1 ring-accent/60" : ""
        );
    }
}
