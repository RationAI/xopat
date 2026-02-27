const van = globalThis.van;
const { div, input, label, img, span, button } = van.tags;

/**
 * SlideSwitcherMenu (compact, instant selection; embedded FloatingWindow)
 * Refactored for multi-selection, folder persistence, and header preview.
 */
export class SlideSwitcherMenu extends UI.BaseComponent {
    constructor(options = {}) {
        super(options);

        // Map<ConfigID, { item: any, config: object }>
        this.selectedItems = new Map();

        // Cache for config generation to avoid re-computing/registering constantly
        this._configCache = new WeakMap();

        this._suspendUpdates = false;
        this._cachedPreviews = {}; // Cache for thumbnail DOM nodes
        this._cachedLabels = {};   // Cache for label DOM nodes
        this._levels = undefined;
        this._dock = undefined;

        // UI Hosts
        this._headerHost = null;
    }

    // ---------- Public API ----------

    open() {
        if (this._preventOpen) {
            return;
        }
        if (!this._dock) {
            this.windowId = this.options.id ?? "slide-switcher";
            this.title = this.options.title ?? "Slide Switcher";
            this.w = this.options.width ?? 520;
            this.h = this.options.height ?? 600;
            this.l = this.options.startLeft ?? 80;
            this.t = this.options.startTop ?? 80;

            const body = document.createElement("div");
            body.className = "h-full w-full flex flex-col overflow-hidden";

            this._headerHost = div({
                class: "flex-none bg-base-200 border-b border-base-300 empty:hidden"
            });
            const toolbar = this._renderToolbar();

            // 3. Explorer Content
            const contentHost = document.createElement("div");
            contentHost.className = "flex-1 min-h-0 relative w-full overflow-hidden";

            body.append(this._headerHost, toolbar, contentHost);

            this.explorer = new UI.Explorer({ id: "slide-switcher-explorer", levels: this._levels });
            contentHost.appendChild(this.explorer.create());

            this._dock = new UI.DockableWindow({
                id: this.windowId,
                title: this.title,
                icon: "fa-images",
                defaultMode: "tab",
                floating: {
                    width: this.w,
                    height: this.h,
                    startLeft: this.l,
                    startTop: this.t,
                    resizable: true,
                    onClose: () => this.options.onClose?.(),
                }
            }, body);

            const el = this._dock.create();
            document.body.appendChild(el);
        }

        // Sync state with currently opened viewer slides
        this._syncWithViewer();
        this._renderSelectionHeader();
        this._dock.open();
    }

    close() {
        this._dock && this._dock.close();
    }

    /**
     *
     * @param {object|null} newConfig object - custom hierarchy configuration, or null to disable custom hierarchy,
     *   or empty object to set 'preload' mode - standalone is set to true, but open is disabled until refresh is re-called
     */
    refresh(newConfig) {
        if (!newConfig) {
            this.orgConfig = null;
            this.customToBg = (item) => item.originalItem;
            this.bgToCustom = (bg) => ({ originalItem: bg });
            this.standalone = false;
        } else if (newConfig.levels) {
            this.orgConfig = newConfig;
            this.customToBg = newConfig.customItemToBackground;
            this.bgToCustom = newConfig.backgroundToCustomItem;
            this.standalone = true;
            if (!this.customToBg) throw new Error("customItemToBackground is required for retrieving custom bg configurations!");
            if (!this.bgToCustom) throw new Error("backgroundToCustomItem is required for retrieving custom bg configurations!");
        } else {
            this._preventOpen = true;
            return;
        }
        this._preventOpen = false;
        this._levels = this._buildLevels();
        this.selectedItems.clear();
        this._syncWithViewer(); // todo check if this is not called too often

        this._configCache = new WeakMap();
        this._renderSelectionHeader();

        if (this.explorer) {
            this.explorer.reconfigure({ levels: this._levels });
        }
    }

    // ---------- Logic: Selection & Sync ----------

    /**
     * Resolves the config for an item and registers it with the core ID system.
     */
    _getConfig(item) {
        if (!item) return null;
        if (this._configCache.has(item)) return this._configCache.get(item);

        let conf = this.customToBg(item);
        if (conf) {
            conf = APPLICATION_CONTEXT.registerConfig(conf);
            this._configCache.set(item, conf);
        }
        return conf;
    }

    _syncWithViewer() {
        // Always sync with viewer state (even if standalone/custom hierarchy)
        const activeRaw = APPLICATION_CONTEXT.getOption("activeBackgroundIndex", null, true, true);
        const allBg = APPLICATION_CONTEXT.config.background;

        // Normalize: active index can be a number (stacked off) or an array (stacked on)
        const activeIndices =
            Array.isArray(activeRaw) ? activeRaw :
                (typeof activeRaw === "number" ? [activeRaw] : []);

        // Clear previous sync selections that came from viewer state
        // (otherwise stale selections can linger when active slide changes)
        this.selectedItems.clear();

        activeIndices
            .filter(idx => Number.isInteger(idx) && idx >= 0 && idx < allBg.length)
            .forEach(idx => {
                const bg = allBg[idx];
                if (!bg) return;

                // Ensure stable BackgroundConfig instance
                const regBg = APPLICATION_CONTEXT.registerConfig ? APPLICATION_CONTEXT.registerConfig(bg) : bg;
                if (!regBg?.id) return;

                const item = this.bgToCustom(regBg);
                this._configCache.set(item, regBg);

                this.selectedItems.set(regBg.id, { item: item, config: regBg });
            });
    }

    _toggleItem(item, forceState = null, exclusive = false) {
        const conf = this._getConfig(item);
        if (!conf || !conf.id) {
            console.warn("Cannot select item: Config missing ID", item);
            return;
        }
        const id = conf.id;

        const isSelected = this.selectedItems.has(id);
        const shouldSelect = forceState !== null ? forceState : !isSelected;

        this._suspendUpdates = true;

        if (exclusive) {
            this.selectedItems.clear();
        }

        if (shouldSelect) {
            this.selectedItems.set(id, { item, config: conf });
        } else {
            this.selectedItems.delete(id);
        }

        // Update UI
        this._renderSelectionHeader();

        // Update check visuals in the current view
        if (exclusive) {
            const checks = document.querySelectorAll(`#${this.windowId}-list input[type="checkbox"]`);
            checks.forEach(ch => {
                const cId = ch.getAttribute("data-id");
                if (cId !== id) {
                    ch.checked = false;
                    this._toggleCardRing(cId, false);
                }
            });
        }
        this._updateExplorerCardVisual(id, shouldSelect);

        this._suspendUpdates = false;

        if (this.selectedItems.size > 0) {
            this._openCurrentSelection();
        }
    }

    _clearAll = () => {
        if (this.selectedItems.size === 0) return;
        this.selectedItems.clear();
        this._renderSelectionHeader();

        const checks = document.querySelectorAll(`#${this.windowId}-list input[type="checkbox"]`);
        checks.forEach(ch => {
            ch.checked = false;
            this._toggleCardRing(ch.getAttribute("data-id"), false);
        });
    };

    async _openCurrentSelection() {
        const loadingTimer = setTimeout(() => USER_INTERFACE.Loading.show(), 500);
        try {
            const selection = Array.from(this.selectedItems.values());
            if (selection.length === 0) return;

            let data = [], background = [];
            let indexes = [];

            if (this.standalone) {
                // Construct new session data from selected configs
                selection.forEach((entry, idx) => {
                    const staticConfig = entry.config;

                    // Shallow copy is fine (tileSource is an object), but we MUST register as BackgroundConfig later
                    const configCopy = { ...staticConfig };

                    // In standalone mode, we move the "real" data reference into the new data[] array,
                    // and re-index background.dataReference to the new numeric index.
                    const ditem = configCopy.dataReference;

                    configCopy.dataReference = idx; // Re-index for new data array
                    data.push(ditem);
                    background.push(configCopy);
                    indexes.push(idx);
                });

                // IMPORTANT: core requires BackgroundConfig instances (otherwise it filters them out)
                // This also stabilizes IDs via the registry.
                background = background.map(bg => APPLICATION_CONTEXT.registerConfig(bg));
            } else {
                // Default mode: use global config
                background = APPLICATION_CONTEXT.config.background;
                data = APPLICATION_CONTEXT.config.data;
                // Recover original indexes from the items if available, or find by ID
                indexes = selection
                    .map(entry => {
                        if (entry.item.__bgIndex !== undefined) return entry.item.__bgIndex;
                        // Fallback: find index in global background by ID
                        return background.findIndex(b => b.id === entry.config.id);
                    })
                    .filter(i => i !== -1 && i !== undefined)
                    .sort((a, b) => a - b);
            }

            await APPLICATION_CONTEXT.openViewerWith(
                data,
                background,
                APPLICATION_CONTEXT.config.visualizations,
                indexes,
                undefined,
                { deriveOverlayFromBackgroundGoals: true },
            );

            // Persist selection
            APPLICATION_CONTEXT.setOption?.("activeBackgroundIndex", indexes);
        } finally {
            clearTimeout(loadingTimer);
            USER_INTERFACE.Loading.show(false);
        }
    }

    // ---------- UI Rendering ----------

    _renderSelectionHeader() {
        if (!this._headerHost) return;
        this._headerHost.innerHTML = "";

        requestAnimationFrame(() => {
            this._headerHost.innerHTML = "";

            if (this.selectedItems.size === 0) {
                this._headerHost.classList.add("hidden");
                return;
            }

            this._headerHost.classList.remove("hidden");
            const count = this.selectedItems.size;

            const title = div({class: "text-xs font-bold text-base-content/50 uppercase tracking-wider px-2 py-1"},
                `Selected (${count})`
            );
            const listContainer = div({class: "flex flex-wrap gap-2 p-2 max-h-[160px] overflow-y-auto"});

            this.selectedItems.forEach((entry) => {
                listContainer.appendChild(this._renderSlideCard(entry.item, false));
            });

            this._headerHost.append(title, listContainer);
        });
    }

    _renderCompactCard(item, config) {
        const bg = config;
        const name = globalThis.UTILITIES.nameFromBGOrIndex(bg);

        const WRAP_CLASS = "relative group flex items-center bg-base-100 border border-base-300 rounded overflow-hidden w-[140px] h-[48px] shadow-sm select-none";
        const IMG_CLASS = "h-full w-[48px] object-cover bg-black";

        const imgEl = img({
            class: IMG_CLASS,
            src: APPLICATION_CONTEXT.url + "src/assets/dummy-slide.png",
            draggable: "false"
        });

        // Load thumbnail
        const viewer = VIEWER_MANAGER.getViewerForConfig(bg);
        let usedViewer = viewer || VIEWER_MANAGER.viewers[0];
        if (usedViewer && bg?.id) {
            this._loadSlideComplementaryImage(this._cachedPreviews, c => usedViewer.tools.createImagePreview(c), bg, null, imgEl, IMG_CLASS);
        }

        const closeBtn = button({
            class: "btn btn-ghost btn-xs btn-square absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-base-100/80 hover:bg-base-100 text-error",
            onclick: (e) => {
                e.stopPropagation();
                this._toggleItem(item, false);
            }
        }, new UI.FAIcon({ name: "fa-times" }).create());

        return div({
            class: WRAP_CLASS + " cursor-pointer hover:border-primary",
            title: name,
            onclick: () => this._toggleItem(item, true, true) // Click on header = exclusive select
        },
            imgEl,
            div({ class: "flex-1 min-w-0 px-2 text-xs truncate" }, name),
            closeBtn
        );
    }

    _renderToolbar() {
        const toggleId = `${this.windowId}-stacked`;
        return div({ class: "flex items-center justify-between gap-2 px-2 py-1 border-b border-base-300 bg-base-100" },
            div({ class: "flex items-center gap-2 text-sm" },
                new UI.FAIcon({ name: "fa-images" }).create(),
                span({ class: "font-semibold" }, this.title),
            ),
            div({ class: "flex items-center gap-2" },
                div({ class: "form-control" },
                    label({ for: toggleId, class: "label cursor-pointer gap-2 py-0" },
                        span({ class: "label-text text-xs" }, "Stacked"),
                        input({
                            id: toggleId, type: "checkbox",
                            class: "toggle toggle-xs",
                            checked: this.stacked,
                            onchange: (e) => {
                                this.stacked = !!e.target.checked;
                                APPLICATION_CONTEXT.setOption?.("stackedBackground", this.stacked);
                                this._openCurrentSelection();
                            }
                        })
                    )
                ),
                button({
                    class: "btn btn-ghost btn-xs",
                    title: "Clear all selections",
                    onclick: this._clearAll
                }, "Clear")
            )
        );
    }

    // ---------- Explorer Configuration ----------

    _buildLevels() {
        const levelsFromConfig = this.orgConfig?.levels;
        if (this.standalone) {
            return this._wrapLevelsWithDefaults(levelsFromConfig);
        }

        // Default Logic
        const bg = APPLICATION_CONTEXT.config.background;
        const items = bg.map((b, i) => ({
            id: `bg-${i}`, // Explorer ID
            label: globalThis.UTILITIES.nameFromBGOrIndex(b) ?? `Slide ${i + 1}`,
            originalItem: b, // Source for config
            __bgIndex: i,
        }));

        if (items.length === 0) {
            return this._wrapLevelsWithDefaults([
                {
                    id: "no-slides",
                    label: "No Slides Available",
                    canOpen: () => false,
                    getChildren: async () => ({ items: [{ label: "No slides available to display" }], total: 0 }),
                },
            ]);
        }

        return this._wrapLevelsWithDefaults([
            {
                id: "slides", label: "Slides",
                canOpen: () => false,
                getChildren: async (parent, ctx) => {
                    return {
                        items: items.slice(ctx.pageSize * ctx.page, Math.min(items.length, ctx.pageSize * (ctx.page + 1))),
                        total: items.length
                    };
                },
            }
        ]);
    }

    _wrapLevelsWithDefaults(levels) {
        const wrapOne = (level) => {
            const L = { ...level };

            if (typeof L.getChildren === "function") {
                const originalGetChildren = L.getChildren;
                L.getChildren = async (parent, ctx) => {
                    const timer = setTimeout(() => USER_INTERFACE.Loading.show(), 500);
                    try {
                        return await originalGetChildren(parent, ctx);
                    } finally {
                        clearTimeout(timer);
                        USER_INTERFACE.Loading.show(false);
                    }
                };
            }

            if (!L.renderItem) {
                L.renderItem = (item, { itemIndex }) => {
                    if (!L.canOpen(item)) return this._renderSlideCard(item);
                    return div({ class: "flex items-center gap-2 px-2 py-2" },
                        span(item.label || item.name || item.id || "Item")
                    );
                };
            }

            const originalClick = L.onClick;
            L.onClick = (item, index) => {
                if (!L.canOpen(item)) this._onCardRootClick(null, item);
                return originalClick?.(item);
            };

            return L;
        };

        if (!Array.isArray(levels)) return wrapOne(levels);
        return levels.map(wrapOne);
    }

    // ---------- Card Rendering ----------

    _renderSlideCard(item, withImagery = true) {
        const bg = this._getConfig(item);
        if (!bg) return div({ class: "text-error", style: "pointer-events: none;" }, "Error: No Config");

        const id = bg.id; // Stable ID from registry
        const name = globalThis.UTILITIES.nameFromBGOrIndex(bg);
        const checkboxId = `${this.windowId}-chk-${id}`;

        const checked = this.selectedItems.has(id);
        const viewer = VIEWER_MANAGER.getViewerForConfig(bg);

        const WRAP_CLASS = "relative overflow-hidden aspect-[4/3] w-full";
        const HOST_CLASS = "flex items-center justify-center";
        const THUMBNAIL_CLASS = "block w-[86%] h-[86%] object-contain select-none pointer-events-none";
        const LABEL_CLASS = "block max-w-[120px] absolute bottom-0 right-0";

        const previewImage = img({
            id: `${this.windowId}-thumb-${id}`,
            class: THUMBNAIL_CLASS,
            alt: name,
            draggable: "false",
            src: APPLICATION_CONTEXT.url + "src/assets/dummy-slide.png"
        });

        let thumbWrap, syncButton;
        if (withImagery) {
            const labelImage = img({
                id: `${this.windowId}-label-${id}`,
                class: LABEL_CLASS,
                alt: name,
                draggable: "false",
                src: APPLICATION_CONTEXT.url + "src/assets/image.png"
            });

            thumbWrap = div(
                { class: WRAP_CLASS },
                div({ class: HOST_CLASS, style: "max-height: 150px;" }, previewImage),
                div({ class: "absolute left-1 top-1 z-10 px-2 py-1 text-xs font-medium truncate bg-base-200 text-primary rounded" }, name),
                labelImage
            );

            if (bg?.id) {
                let usedViewer = viewer || VIEWER_MANAGER.viewers[0];
                this._loadSlideComplementaryImage(this._cachedPreviews, c => usedViewer.tools.createImagePreview(c), bg, thumbWrap, previewImage, THUMBNAIL_CLASS);
                this._loadSlideComplementaryImage(this._cachedLabels, c => usedViewer.tools.retrieveLabel(c), bg, thumbWrap, labelImage, LABEL_CLASS);
            }
        } else {
            const linked = this._isLinked(viewer);
            thumbWrap = div(
                { class: WRAP_CLASS },
                div({ class: "absolute left-1 top-1 z-10 px-2 py-1 text-xs font-medium truncate bg-base-200 text-primary rounded" }, name),
            );

            syncButton = button({
                id: `${this.windowId}-lnk-${id}`,
                class: "btn btn-ghost btn-xs",
                disabled: !viewer,
                title: viewer ? (linked ? "Synced — click to unsync" : "Not synced — click to sync") : "Not open",
                onclick: (e) => { e.stopPropagation(); this._onToggleLink(id, item, e); }
            }, new UI.FAIcon({ name: linked ? "fa-link" : "fa-link-slash" }).create());
        }

        const controls = div(
            { class: "flex items-center gap-2 p-2" },
            input({
                id: checkboxId,
                "data-id": id,
                type: "checkbox",
                class: "checkbox checkbox-xs",
                checked,
                onclick: (e) => e.stopPropagation(),
                onchange: (e) => this._toggleItem(item, e.target.checked),
                title: "Add/remove from view"
            }), syncButton
        );

        return div(
            {
                id: `${this.windowId}-card-${id}`,
                style: (withImagery ? "max-height:120px;overflow:hidden;" : "max-height: 30px;"),
                class:
                    "slide-card group bg-base-200 border border-base-300 transition " +
                    (checked ? "ring ring-primary ring-offset-1 " : "") +
                    "flex flex-row relative w-full",
                onclick: (e) => this._onCardRootClick(e, item)
            },
            controls,
            thumbWrap
        );
    }

    _onCardRootClick(e, item) {
        if (e && e.target) {
            const t = e.target;
            if (t.closest('button, input, .btn, .toggle, [data-no-open="1"]')) return;
        }
        this._toggleItem(item, true, true);
    }

    _updateExplorerCardVisual(id, isSelected) {
        const checkbox = document.getElementById(`${this.windowId}-chk-${id}`);
        if (checkbox) checkbox.checked = isSelected;
        this._toggleCardRing(id, isSelected);
    }

    _toggleCardRing(id, on) {
        const card = document.getElementById(`${this.windowId}-card-${id}`);
        if (!card) return;
        card.classList.toggle("ring", !!on);
        card.classList.toggle("ring-primary", !!on);
        card.classList.toggle("ring-offset-1", !!on);
    }

    // ---------- Utilities ----------

    _loadSlideComplementaryImage(cacheMap, method, bg, parentNode, replacedImageNode, imageClasses) {
        const cacheKey = bg.id;

        // 1. If we have a finished HTML element in cache, apply it immediately
        if (cacheMap[cacheKey] instanceof HTMLElement) {
            this._applyToDOM(cacheMap[cacheKey], replacedImageNode, parentNode, imageClasses);
            return;
        }

        if (cacheMap[cacheKey] instanceof Promise) {
            cacheMap[cacheKey].then(node => {
                this._applyToDOM(node, replacedImageNode, parentNode, imageClasses);
            });
            return;
        }

        cacheMap[cacheKey] = method(bg).then(node => {
            if (node) {
                cacheMap[cacheKey] = node; // Store the actual DOM node for future re-renders
                this._applyToDOM(node, replacedImageNode, parentNode, imageClasses);
            }
            return node;
        }).catch(err => {
            console.error("Thumbnail loading failed:", err);
            delete cacheMap[cacheKey];
        });
    }

    _applyToDOM(sourceNode, targetNode, parent, classes) {
        if (!sourceNode) {
            console.warn("SlideSwitcher: No source node provided for cloning", targetNode.id);
            return;
        }

        const current = document.getElementById(targetNode.id) || parent?.querySelector(`#${targetNode.id}`);
        if (!current) return; // It's okay if it's missing now; the cache handles the next render

        const clone = sourceNode.cloneNode(true);
        clone.id = targetNode.id;
        clone.className = classes;
        current.replaceWith(clone);
    }

    _isLinked(viewer) {
        if (!viewer) return false;
        return !!viewer.tools.isLinked();
    }
    _link(viewer) {
        if (!viewer) return;
        return viewer.tools.link();
    }
    _unlink(viewer) {
        if (!viewer) return;
        return viewer.tools.unlink();
    }
    _updateLinkIcon(id, viewer) {
        const btn = document.getElementById(`${this.windowId}-lnk-${id}`);
        if (!btn) return;
        const linked = this._isLinked(viewer);
        btn.title = viewer
            ? (linked ? "Synced — click to unsync" : "Not synced — click to sync")
            : "Not open";
        btn.disabled = !viewer;
        btn.innerHTML = "";
        btn.appendChild(new UI.FAIcon({ name: linked ? "fa-link" : "fa-link-slash" }).create());
    }
    _onToggleLink(id, item, ev) {
        ev?.stopPropagation?.();
        const viewer = VIEWER_MANAGER.getViewerForConfig(this._getConfig(item));
        if (!viewer) return;
        if (this._isLinked(viewer)) this._unlink(viewer); else this._link(viewer);
        this._updateLinkIcon(id, viewer);
    }

    create() {
        return this._dock ? this._dock.create() : super.create();
    }
}