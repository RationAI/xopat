import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import {Alert} from "../elements/alert.mjs";
import {ShaderLayer} from "./shaderLayer.mjs";
import {draggable} from "../mixins/utils.mjs";

const { div, span, select, option, br, ul, li, a } = van.tags;

/**
 * ShaderSideMenu (DaisyUI)
 * Props:
 *  - shaders: Array<{ value:string, label:string }>
 *  - selectedVisualization?: string
 *  - opacity?: number   // 0..1
 *  - onShaderChange?(value)
 *  - onOpacityChange?(value)
 *  - onCacheSnapshotByName?()
 *  - onCacheSnapshotByOrder?()
 *
 * Keeps legacy element IDs:
 *   panel-images,
 *   cache-snapshot, global-opacity
 */
export class ShaderSideMenu extends BaseComponent {
    constructor(opts = undefined) {
        opts = super(opts).options;
        this.visualizations = [];
        this.visualizationSelect = null;
        this.selectedVisualization = "";
        this.shaderNodeCells = {};
        this.shaderChildrenContainers = {};
        this.opacity = typeof opts.opacity === "number" ? opts.opacity : 1;
        this.classMap["base"] = "p-0 flex flex-col max-h-full"

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

    /**
     * Needs two-level init, constructor is called before viewer is opened, because this menu needs to build
     * navigator container before viewer creation, and register events after
     * @param {OpenSeadragon.Viewer} viewer
     */
    init(viewer) {
        viewer.drawer.renderer.addHandler('html-controls-created', e => {
            this._enableDragSort(viewer);

            let layers = viewer.drawer.renderer.getAllShaders();
            for (let key in layers) {
                if (!layers.hasOwnProperty(key)) continue;

                const shader = layers[key];

                for (let source of shader.getConfig().tiledImages) {
                    const tiledImage = viewer.world.getItemAt(source);

                    if (typeof tiledImage?.source.getMetadata !== 'function') {
                        console.info('OpenSeadragon TileSource for the visualization layers is missing getMetadata() function.',
                            'The visualization is unable to inspect problems with data sources.', tiledImage);
                        continue;
                    }

                    const message = tiledImage.source.getMetadata();
                    const node = this.shaderNodeCells[key];
                    if (message.error && node) {
                        const alert = new Alert({
                            mode: "warning",
                            title: $.t('main.shaders.faulty'),
                            description: `<code>${message.error}</code>`,
                            compact: true,
                            extraClasses: { margin: "mb-2" }, //todo some horizontal margin
                        });

                        alert.prependedTo(node);
                        break;
                    }
                }
            }

            /**
             * Fired when visualization goal is set up and run, but before first rendering occurs.
             * @property visualization visualization configuration used
             * @memberof OpenSeadragon.Viewer
             * @event visualization-used
             */
            viewer.raiseEvent('visualization-used', e);
        });

        this._refreshOrder = (node) => {
            const listItems = Array.prototype.map.call(node.children, child => child.dataset.id);
            const shouldReverse = node.dataset.reverseOrder !== "false";
            if (shouldReverse) {
                listItems.reverse();
            }

            const parentShaderId = node.dataset.parentId;
            if (parentShaderId) {
                const parentShader = viewer.drawer.renderer.getShaderLayer(parentShaderId);
                const parentConfig = parentShader?.getConfig?.();
                if (!parentConfig) {
                    console.error(`Invalid parent group id '${parentShaderId}' in _refreshOrder`);
                    return;
                }
                parentConfig.order = listItems;
                parentShader.shaderLayerOrder = [...listItems];
            } else {
                // todo no change on the navigator...
                viewer.drawer.renderer.setShaderLayerOrder(listItems);
            }
            viewer.drawer.rebuild();
        };
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
        const noVisualizationLabel =
            $.t("main.shaders.noVisualization")
            || $.t("common.None")
            || "No visualization";
        const shaderGoalList = [
            option({ value: "" }, noVisualizationLabel),
            ...this.visualizations.map((s) => option({ value: s.value }, s.label))
        ];
        // Shader select
        this.visualizationSelect = select(
            {
                id: this.id + "-shaders",
                name: "shaders",
                class: "select select-ghost select-sm w-full max-w-xs cursor-pointer",
                "aria-label": "Visualization",
                value: this.selectedVisualization,
                onchange: e => {
                    this.selectedVisualization = e.target.value;
                    this.cb.onShaderChange?.(this.selectedVisualization);
                },
                mousedown: e => {
                    if (this.childElementCount < 2) {
                        e.preventDefault();
                        // todo open the shader layer container
                        return false;
                    }
                },
                title: $.t("main.shaders.select") ?? "Select shader",
            },
            ...shaderGoalList
        );


        // todo implement using dropdown!
        this._cacheDropdownWrap = div(
            { class: "dropdown dropdown-end relative" },
            // trigger
            span(
                {
                    id: this.id + "-cache-snapshot",
                    tabindex: "0",
                    role: "button",
                    class: "fa-auto fa-bookmark btn btn-ghost btn-circle btn-sm align-middle ml-1 pt-2",
                    title: $.t("main.shaders.saveCookies"),
                    onclick: (e) => {
                        e.stopPropagation();
                        const open = !this._cacheDropdownWrap.classList.contains("dropdown-open");
                        this._setCacheOpen(open);
                    },
                }
            ),
            // menu
            ul(
                {
                    tabindex: "0",
                    class: "dropdown-content menu shadow bg-base-100 rounded-box z-[1]",
                    style: "min-width: 18rem;"
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
                        span({ class: "fa-auto fa-arrow-down-a-z mr-2" }),
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
                        span({ class: "fa-auto fa-list-ol mr-2" }),
                        $.t("main.shaders.cacheByOrder")
                    )
                )
            )
        );

        return div({ class: "flex flex-row" }, this.visualizationSelect, this._cacheDropdownWrap);
    }

    create() {
        // Optional images panel placeholder (kept per legacy markup)
        const panelImages = div({ id: this.options.id + "-panel-images", class: "mt-2" });

        const header = this._buildHeaderRow();
        this.layerContainer = div({ class: "clear-both mt-2", "data-reverse-order": "true" });
        const blendingEq = div({ id: this.options.id + "-blending-equation" });
        const content = div(
            { class: "select-none" },
            header,
            this.layerContainer,
            blendingEq
        );

        return div(
            { id: this.options.id + "-panel-shaders", class: "p-2" },
            content,
            panelImages
        );
    }

    // ----- external API -----
    _normalizeVisualizationEntry(item, index) {
        if (item && (item.value !== undefined || item.label !== undefined)) {
            return {
                value: String(item.value ?? index),
                label: String(item.label ?? item.name ?? item.value ?? $.t('main.shaders.defaultTitle'))
            };
        }

        if (item && typeof item === "object") {
            return {
                value: String(item.index ?? index),
                label: String(item.name ?? item.label ?? $.t('main.shaders.defaultTitle'))
            };
        }

        return {
            value: String(index),
            label: String(item ?? $.t('main.shaders.defaultTitle'))
        };
    }

    updateVisualizationList(shaders, selectedValue) {
        this.visualizations = (shaders || []).map((shader, index) => this._normalizeVisualizationEntry(shader, index));
        this.selectedVisualization = selectedValue !== undefined && selectedValue !== null
            ? String(selectedValue)
            : "";
        const sel = this.visualizationSelect;
        if (sel) {
            sel.innerHTML = "";
            const noVisualizationOption = document.createElement("option");
            noVisualizationOption.value = "";
            noVisualizationOption.textContent =
                $.t("main.shaders.noVisualization")
                || $.t("common.None")
                || "No visualization";
            sel.appendChild(noVisualizationOption);
            this.visualizations.forEach((s) => {
                const opt = document.createElement("option");
                opt.value = String(s.value);
                opt.textContent = s.label;
                sel.appendChild(opt);
            });
            sel.value = this.selectedVisualization;
        }
    }

    /**
     * Made with love by @fitri
     * This is a component of my ReactJS project https://codepen.io/fitri/full/oWovYj/
     *
     * Shader re-compilation and re-ordering logics
     * Modified by Jiří
     */
    _enableDragSort(viewer) {
        const bindContainer = (container) => draggable(container, item => {
            const id = item.dataset.id;
            window.DropDown.bind(item, () => {
                const currentMask = viewer.drawer.getOverriddenShaderConfig(id)?.params.use_mode;
                const clipSelected = currentMask === "clip";
                const maskEnabled = typeof currentMask === "string" && currentMask !== "show";

                return [{
                    title: $.t('main.shaders.defaultBlending'),
                }, {
                    title: maskEnabled ? $.t('main.shaders.maskDisable') : $.t('main.shaders.maskEnable'),
                    action: (selected) => UTILITIES.shaderPartSetBlendModeUIEnabled(id, !selected),
                    selected: maskEnabled
                }, {
                    title: clipSelected ? $.t('main.shaders.clipMaskOff') : $.t('main.shaders.clipMask'),
                    icon: "payments",
                    styles: "padding-right: 5px;",
                    action: (selected) => {
                        const node = document.getElementById(`${id}-mode-toggle`);
                        const newMode = selected ? "blend" : "clip";
                        node.dataset.mode = newMode;
                        if (!maskEnabled) {
                            UTILITIES.shaderPartSetBlendModeUIEnabled(id, true);
                        } else {
                            UTILITIES.changeModeOfLayer(id, newMode, false);
                        }
                    },
                    selected: clipSelected
                }];
            });
        }, undefined, e => {
            this._refreshOrder(e.target.parentNode);
        });

        bindContainer(this.layerContainer);
        this.layerContainer
            .querySelectorAll(".shader-group-children")
            .forEach(container => bindContainer(container));
    }

    /**
     * Refresh visualization shader order based on the UI DOM parent container child list
     * children are expected to have data-id attribute set to the shader id
     * @param node
     * @private
     */
    _refreshOrder(node) {
        console.error("called before init().");
    }
    
    clearLayers() {
        this.layerContainer.innerHTML = "";
        this.shaderNodeCells = {};
        this.shaderChildrenContainers = {};
    }

    _findShaderLayerById(shaderMap, shaderId) {
        if (!shaderMap || !shaderId) {
            return null;
        }

        for (const [id, shader] of Object.entries(shaderMap)) {
            if (!shader) {
                continue;
            }

            if (id === shaderId || shader.id === shaderId) {
                return shader;
            }

            const nested = this._findShaderLayerById(shader.shaderLayers, shaderId);
            if (nested) {
                return nested;
            }
        }

        return null;
    }

    _resolveShaderLayer(viewer, shaderLayer, htmlContext = {}) {
        const renderer = viewer?.drawer?.renderer;
        if (!renderer || !shaderLayer?.id) {
            return null;
        }

        const allShaders = renderer.getAllShaders?.() || {};

        if (!htmlContext.parentShaderId) {
            return renderer.getShaderLayer(shaderLayer.id)
                || this._findShaderLayerById(allShaders, shaderLayer.id);
        }

        const parentShader = this._findShaderLayerById(allShaders, htmlContext.parentShaderId);
        if (!parentShader?.shaderLayers) {
            return this._findShaderLayerById(allShaders, shaderLayer.id);
        }

        return parentShader.shaderLayers[shaderLayer.id]
            || this._findShaderLayerById(parentShader.shaderLayers, shaderLayer.id)
            || this._findShaderLayerById(allShaders, shaderLayer.id);
    }

    _resolveShaderConfig(shader, shaderLayer) {
        if (!shader?.getConfig) {
            return null;
        }

        let cfg = null;
        try {
            cfg = shader.getConfig(shaderLayer?.id);
        } catch (e) {
            cfg = null;
        }

        if (!cfg) {
            try {
                cfg = shader.getConfig();
            } catch (e) {
                cfg = null;
            }
        }

        return cfg;
    }
    
    createLayer(viewer, shaderLayer, shaderConfig, htmlContext = {}) {
        // map the mediator list to [{type, name}]
        const availableShaders = OpenSeadragon
            .FlexRenderer
            .ShaderMediator
            .availableShaders()
            .map(s => ({type: s.type(), name: s.name()}));

        // map filters if you want editable rows (optional)
        const filters = {};
        shaderConfig.params = shaderConfig.params || {};
        for (let key in OpenSeadragon.FlexRenderer.ShaderLayer.filters) {
            if (shaderConfig.params.hasOwnProperty(key)) {
                filters[key] = {
                    name: OpenSeadragon.FlexRenderer.ShaderLayer.filterNames[key],
                    value: shaderLayer.getFilterValue(key, shaderConfig.params[key])
                };
            }
        }

        const uiLayer = new ShaderLayer({
            id: `${shaderLayer.id}-shader`,
            shaderLayer,
            shaderConfig: shaderConfig,
            htmlContext,
            availableFilters: filters,
            availableShaders,
            callbacks: {
                onToggleVisible: (checked) => {
                    let shader = uiLayer.cfg;
                    if (shader) {
                        shader.visible = !!checked;
                        viewer.drawer.rebuild(0);
                    }
                },
                onChangeType: (type) =>
                    UTILITIES.changeVisualizationLayer(shaderLayer.id, type),

                // NEW: explicit mode change (no toggle, and we also keep blend mode)
                onChangeMode: (mode, blend) => {
                    const shader = this._resolveShaderLayer(viewer, shaderLayer, htmlContext);
                    if (!shader) {
                        console.error(`Invalid layer id '${shaderLayer.id}' in onChangeMode`);
                        return;
                    }
                    const cfg = this._resolveShaderConfig(shader, shaderLayer);
                    if (!cfg) {
                        console.error(`Invalid config for layer id '${shaderLayer.id}' in onChangeMode`);
                        return;
                    }

                    cfg.params = cfg.params || {};
                    cfg.params.use_mode = mode;
                    if (blend) {
                        cfg.params.use_blend = blend;
                    }

                    shader.resetMode(cfg.params);
                    viewer.drawer.rebuild(0);
                },

                // NEW: explicit blend change; keep current mode
                onChangeBlend: (mode, blend) => {
                    const shader = this._resolveShaderLayer(viewer, shaderLayer, htmlContext);
                    if (!shader) {
                        console.error(`Invalid layer id '${shaderLayer.id}' in onChangeBlend`);
                        return;
                    }
                    const cfg = this._resolveShaderConfig(shader, shaderLayer);
                    if (!cfg) {
                        console.error(`Invalid config for layer id '${shaderLayer.id}' in onChangeBlend`);
                        return;
                    }

                    cfg.params = cfg.params || {};
                    if (mode) {
                        cfg.params.use_mode = mode;   // keep in sync
                    }
                    cfg.params.use_blend = blend;

                    shader.resetMode(cfg.params);
                    viewer.drawer.rebuild(0);
                },

                onSetFilter: (key, val) =>
                    UTILITIES.setFilterOfLayer(shaderLayer.id, key, val),
                onClearCache: () =>
                    UTILITIES.clearShaderCache(shaderLayer.id),
                onReorder: (dir) => {
                    const node = this.shaderNodeCells[shaderLayer.id];
                    const parent = node?.parentElement;
                    if (!parent || !node) return;

                    if (dir === "up") {
                        const prev = node.previousElementSibling;
                        if (prev) parent.insertBefore(node, prev);
                    } else if (dir === "down") {
                        const next = node.nextElementSibling;
                        if (next) parent.insertBefore(next, node);
                    }

                    this._refreshOrder(parent);
                },
            }
        });

        const node = uiLayer.create();
        const parentContainer = htmlContext.parentShaderId
            ? this.shaderChildrenContainers[htmlContext.parentShaderId]
            : this.layerContainer;

        if (parentContainer) {
            if (htmlContext.parentShaderId) {
                parentContainer.prepend(node);
            } else {
                this.layerContainer.prepend(node);
            }
        } else {
            this.layerContainer.prepend(node);
        }

        if (htmlContext.hasChildren) {
            this.shaderChildrenContainers[shaderLayer.id] = document.getElementById(uiLayer.getChildrenContainerId());
        }

        this.shaderNodeCells[shaderLayer.id] = node;
    }

    disconnected() {
        document.removeEventListener("click", this._outsideHandler, { capture: true });
    }
}
