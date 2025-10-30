// ui/components/ShaderMenu.mjs
import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { FAIcon } from "../elements/fa-icon.mjs";

const { div, span, select, option, label, input, br, ul, li, a } = van.tags;

/**
 * ShaderMenu (DaisyUI)
 * Props:
 *  - shaders: Array<{ value:string, label:string }>
 *  - selectedShader?: string
 *  - opacity?: number   // 0..1
 *  - onShaderChange?(value)
 *  - onOpacityChange?(value)
 *  - onCacheSnapshotByName?()
 *  - onCacheSnapshotByOrder?()
 *
 * Keeps legacy element IDs:
 *   panel-images, panel-shaders, shaders,
 *   cache-snapshot, global-opacity, data-layer-options, blending-equation
 */
export class ShaderMenu extends BaseComponent {
    constructor(opts = {}) {
        super(opts);
        this.shaders = [];
        this.selectedShader = "";
        this.opacity = typeof opts.opacity === "number" ? opts.opacity : 1;

        this.cb = {
            onShaderChange: opts.onShaderChange,
            onOpacityChange: opts.onOpacityChange,
            onPinChange: opts.onPinChange,
            onCacheSnapshotByName: opts.onCacheSnapshotByName,
            onCacheSnapshotByOrder: opts.onCacheSnapshotByOrder,
        };

        // dropdown state handler (DaisyUI "dropdown-open" class toggle)
        this._outsideHandler = (e) => {
            if (!this._cacheDropdownWrap) return;
            if (!this._cacheDropdownWrap.contains(e.target)) this._setCacheOpen(false);
        };
    }

    // Public: where ShaderLayer items are rendered/managed
    getLayerContainerEl() {
        return document.getElementById("data-layer-options");
    }

    _setCacheOpen(open) {
        if (!this._cacheDropdownWrap) return;
        this._cacheDropdownWrap.classList.toggle("dropdown-open", !!open);
        if (open) {
            document.addEventListener("click", this._outsideHandler, { capture: true });
        } else {
            document.removeEventListener("click", this._outsideHandler, { capture: true });
        }
    }

    _buildHeaderRow() {
        const shaderGoalList = this.shaders.map((s) => option({ value: s.value }, s.label));
        if (shaderGoalList.length === 0) {
            shaderGoalList.push(option({ value: "", }, $.t('main.shaders.notAvailable')));
        }
        // Shader select
        const shaderSelect = select(
            {
                id: "shaders",
                name: "shaders",
                class: "select select-bordered select-sm align-middle w-4/5 max-w-xs cursor-pointer text-xl text-lg",
                "aria-label": "Visualization",
                value: this.selectedShader,
                onchange: (e) => {
                    this.selectedShader = e.target.value;
                    this.cb.onShaderChange?.(this.selectedShader);
                },
                title: $.t("main.shaders.select") ?? "Select shader",
            },
            ...shaderGoalList
        );

        // todo implement using dropdown!
        this._cacheDropdownWrap = div(
            { class: "dropdown dropdown-end float-right relative" },
            // trigger
            span(
                {
                    id: "cache-snapshot",
                    tabindex: "0",
                    role: "button",
                    class: "material-icons btn btn-ghost btn-circle btn-sm align-middle",
                    style: "vertical-align:sub;",
                    title: $.t("main.shaders.saveCookies"),
                    onclick: (e) => {
                        e.stopPropagation();
                        const open = !this._cacheDropdownWrap.classList.contains("dropdown-open");
                        this._setCacheOpen(open);
                    },
                },
                "bookmark"
            ),
            // menu
            ul(
                {
                    tabindex: "0",
                    class: "dropdown-content menu shadow bg-base-100 rounded-box w-48 z-[1]",
                },
                li(
                    a(
                        {
                            title: $.t("main.shaders.cacheByName"),
                            onclick: () => {
                                this.cb.onCacheSnapshotByName?.();
                                this._setCacheOpen(false);
                            },
                        },
                        // icon: sort_by_alpha
                        span({ class: "material-icons mr-2" }, "sort_by_alpha"),
                        $.t("main.shaders.cacheByName")
                    )
                ),
                li(
                    a(
                        {
                            title: $.t("main.shaders.cacheByOrder"),
                            onclick: () => {
                                this.cb.onCacheSnapshotByOrder?.();
                                this._setCacheOpen(false);
                            },
                        },
                        // icon: format_list_numbered
                        span({ class: "material-icons mr-2" }, "format_list_numbered"),
                        $.t("main.shaders.cacheByOrder")
                    )
                )
            )
        );

        return div({}, shaderSelect, this._cacheDropdownWrap, br());
    }

    create() {
        // Optional images panel placeholder (kept per legacy markup)
        const panelImages = div({ id: "panel-images", class: "mt-2" });

        // Header + content
        const header = this._buildHeaderRow();

        // Where ShaderLayer components will be injected
        const optionsContainer = div(
            { id: "data-layer-options", class: "clear-both mt-2" }
        );

        // Blending equation host
        const blendingEq = div({ id: "blending-equation" });

        // Wrap content (select-none equivalent via DaisyUI defaults; keep explicit utility)
        const content = div(
            { class: "select-none" },
            header,
            optionsContainer,
            blendingEq
        );

        // Panel root
        return div(
            { id: "panel-shaders", class: "p-2" },
            content,
            panelImages
        );
    }

    // ----- external API -----
    updateShaders(shaders, selectedValue) {
        this.shaders = shaders || [];
        this.selectedShader = selectedValue ?? (this.shaders[0]?.value ?? "");
        const sel = document.getElementById("shaders");
        if (sel) {
            sel.innerHTML = "";
            this.shaders.forEach((s) => {
                const opt = document.createElement("option");
                opt.value = s.value;
                opt.textContent = s.label;
                sel.appendChild(opt);
            });
            sel.value = this.selectedShader;
        }
    }

    disconnected() {
        document.removeEventListener("click", this._outsideHandler, { capture: true });
    }
}
