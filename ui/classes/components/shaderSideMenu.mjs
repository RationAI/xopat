import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import {Alert} from "../elements/alert.mjs";
import {ShaderLayer} from "./shaderLayer.mjs";

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
        const shaderGoalList = this.visualizations.map((s) => option({ value: s.value }, s.label));
        if (shaderGoalList.length === 0) {
            shaderGoalList.push(option({ value: "", }, $.t('main.shaders.notAvailable')));
        }
        // Shader select
        this.visualizationSelect = select(
            {
                id: this.options.id + "-shaders",
                name: "shaders",
                class: "select select-bordered select-sm align-middle w-4/5 max-w-xs cursor-pointer text-xl text-lg",
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
            { class: "dropdown dropdown-end float-right relative" },
            // trigger
            span(
                {
                    id: this.options.id + "-cache-snapshot",
                    tabindex: "0",
                    role: "button",
                    class: "fa-auto fa-bookmark btn btn-ghost btn-circle btn-sm align-middle",
                    style: "vertical-align:sub;",
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

        return div({}, this.visualizationSelect, this._cacheDropdownWrap, br());
    }

    create() {
        // Optional images panel placeholder (kept per legacy markup)
        const panelImages = div({ id: this.options.id + "-panel-images", class: "mt-2" });

        const header = this._buildHeaderRow();
        this.layerContainer = div({ class: "clear-both mt-2" });
        const blendingEq = div({ id: this.options.id + "-blending-equation" });
        const content = div(
            { class: "select-none" },
            header,
            this.layerContainer,
            blendingEq
        );

        // Panel root
        return div(
            { id: this.options.id + "-panel-shaders", class: "p-2" },
            content,
            panelImages
        );
    }

    // ----- external API -----
    updateVisualizationList(shaders, selectedValue) {
        this.visualizations = shaders || [];
        this.selectedVisualization = selectedValue ?? (this.visualizations[0]?.value ?? "");
        const sel = this.visualizations;
        if (sel) {
            sel.innerHTML = "";
            sel.forEach((s) => {
                const opt = document.createElement("option");
                opt.value = s.value;
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
        UIComponents.Actions.draggable(this.layerContainer, item => {
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
            const listItems = Array.prototype.map.call(e.target.parentNode.children, child => child.dataset.id);
            listItems.reverse();
            // todo no change on the navigator...
            viewer.drawer.renderer.setShaderLayerOrder(listItems);
            viewer.drawer.rebuild();
        });
    }
    
    clearLayers() {
        this.layerContainer.innerHTML = "";
        this.shaderNodeCells = {};
    }
    
    createLayer(viewer, shaderLayer, shaderConfig) {
        // map the mediator list to [{type, name}]
        const availableShaders = OpenSeadragon
            .FlexRenderer
            .ShaderMediator
            .availableShaders()
            .map(s => ({type: s.type(), name: s.name()}));

        // map filters if you want editable rows (optional)
        const filters = {};
        for (let key in OpenSeadragon.FlexRenderer.ShaderLayer.filters) {
            if (shaderConfig.params.hasOwnProperty(key)) {
                filters[key] = {
                    name: OpenSeadragon.FlexRenderer.ShaderLayer.filterNames[key],
                    value: shaderConfig._renderContext.getFilterValue(key, shaderConfig.params[key])
                };
            }
        }

        const uiLayer = new ShaderLayer({
            id: `${shaderLayer.id}-shader`,
            shaderLayer,
            shaderConfig: shaderConfig,
            availableFilters: filters,
            availableShaders,
            callbacks: {
                onToggleVisible: (checked) => {
                    let shader = uiLayer.cfg;
                    if (shader) {
                        if (checked) {
                            shader.visible = true;
                            // todo change visual using this.something()
                            //self.parentNode.parentNode.classList.remove("shader-part-error");
                        } else {
                            shader.visible = false;
                            //self.parentNode.parentNode.classList.add("shader-part-error");
                        }
                        viewer.drawer.rebuild(0);
                    } else {
                        console.error(`UTILITIES::changeVisualizationLayer Invalid layer id '${uiLayer.id}': bad initialization?`);
                    }
                },
                // todo cleanup the code, enable the functionality through this UI class
                onChangeType: (type) => UTILITIES.changeVisualizationLayer(shaderLayer.id, type),
                onChangeMode: (nextMode) => UTILITIES.changeModeOfLayer(shaderLayer.id, nextMode),
                onSetFilter: (key, val) => UTILITIES.setFilterOfLayer(shaderLayer.id, key, val),
                onClearCache: () => UTILITIES.clearShaderCache(shaderLayer.id)
            }
        });

        const node = uiLayer.create();
        this.layerContainer.prepend(node);
        //uiLayer.prependedTo(this.layerContainer);
        this.shaderNodeCells[shaderLayer.id] = node;

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
                            compact: true
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
    }

    disconnected() {
        document.removeEventListener("click", this._outsideHandler, { capture: true });
    }
}
