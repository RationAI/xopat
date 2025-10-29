const van = globalThis.van;
const { div, input, label, img, span, button } = van.tags;

/**
 * SlideSwitcherMenu (compact, instant selection; embedded FloatingWindow)
 */
export class SlideSwitcherMenu extends UI.BaseComponent {
    constructor(options = {}) {
        super(options);
        this.selected = new Set();
        this._indexMap = new Map();
        this._suspendUpdates = false;
        this._cachedPreviews = {};
        this._cachedLabels = {};
        this._levels = undefined;
    }

    // ---------- public ----------
    open() {
        if (!this._fw) {
            this.windowId = this.options.id ?? "slide-switcher";
            this.title = this.options.title ?? "Slide Switcher";
            this.w = this.options.width ?? 520;
            this.h = this.options.height ?? 460;
            this.l = this.options.startLeft ?? 80;
            this.t = this.options.startTop ?? 80;

            const body = document.createElement("div");
            body.className = "flex-1 min-h-0 overflow-hidden flex flex-col";
            const toolbar = this._renderToolbar();
            const contentHost = document.createElement("div");
            contentHost.className = "flex-1 min-h-0 overflow-auto";
            body.append(toolbar, contentHost);

            this._fw = new UI.FloatingWindow({
                id: this.windowId,
                title: this.title,
                width: this.w,
                height: this.h,
                startLeft: this.l,
                startTop: this.t,
                resizable: true,
                onClose: () => this.options.onClose?.(),
            }, body);

            this.explorer = new UI.Explorer({ id: "slide-switcher-explorer", levels: this._levels });
            contentHost.appendChild(this.explorer.create());
        }

        // Ensure we don't keep re-initializing the explorer
        if (!this._fw.opened()) this._fw.attachTo(document.body);
        else this._fw.focus();
    }

    _buildLevels() {
        const levelsFromConfig = this.orgConfig?.levels;
        if (this.standalone) {
            return this._wrapLevelsWithDefaults(levelsFromConfig);
        }
        // Fallback: synthesize a single level from background items of the original app
        const bg = APPLICATION_CONTEXT.config.background;
        const items = bg.map((b, i) => ({
            id: `bg-${i}`,
            label: globalThis.UTILITIES.nameFromBGOrIndex(b) ?? `Slide ${i + 1}`,
            originalItem: b,
            __bgIndex: i,
        }));

        if (items.length === 0) {
            return this._wrapLevelsWithDefaults([
                {
                    id: "no-slides",
                    label: "No Slides Available",
                    canOpen: () => false,
                    getChildren: async () => ({items: [{ label: "No slides available to display" }], total: 0}),
                },
            ]);
        }

        return this._wrapLevelsWithDefaults([
            { id: "slides", label: "Slides",
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
        return levels.map(level => {
            const L = { ...level };

            // wrap getChildren if async
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
                    if (!L.canOpen(item)) return this._renderSlideCard(itemIndex, item);
                    return div({ class: "flex items-center gap-2 px-2 py-2" },
                        span(item.label || item.name || item.id || "Item")
                    );
                };
            }

            const originalOpen = L.onClick;
            L.onClick = (item, index) => {
                if (!L.canOpen(item)) this._onCardClick(item, index);
                return originalOpen?.(item);
            };

            return L;
        });
    }


    close() { this._fw && this._fw.close(); }
    opened() { return this._fw && this._fw.opened(); }

    async _openCurrentSelection() {
        const loadingTimer = setTimeout(() => USER_INTERFACE.Loading.show(), 500);

        try {
            const chosen = Array.from(this.selected).sort((a,b)=>a-b);
            let data, background;
            let indexes;
            if (this.standalone) {
                indexes = [];
                data = [];
                background = chosen.map(i => {
                    const item = this._indexMap.get(i);
                    const staticConfig = this.configGetter(item);
                    const ditem = staticConfig.dataReference;
                    staticConfig.dataReference = data.length;
                    data.push(ditem);
                    indexes.push(indexes.length);
                    return staticConfig;
                });
            } else {
                background = APPLICATION_CONTEXT.config.background;
                data = APPLICATION_CONTEXT.config.data;
                indexes = chosen;
            }

            await APPLICATION_CONTEXT.openViewerWith(
                data,
                background,
                APPLICATION_CONTEXT.config.visualizations,
                indexes,
                undefined,
                { deriveOverlayFromBackgroundGoals: true },
            );

            APPLICATION_CONTEXT.setOption?.("activeBackgroundIndex", indexes);
            // setTimeout(() => this._refreshAllLinkIcons(), 0);
        } finally {
            clearTimeout(loadingTimer);
            USER_INTERFACE.Loading.show(false);
        }
    }

    /**
     *
     * @param {UI.Explorer.Options|undefined|false} newConfig if falsey value, customization is disabled
     * @param {function} newConfig.bgItemGetter a function that from explorer leaf item returns BG configuration,
     *  the configuration must be of a type
     */
    refresh(newConfig) {
        if (!newConfig) {
            this.orgConfig = null;
            this.configGetter = (item) => item.originalItem;
            this.standalone = false;
        } else if (newConfig.levels) {
            this.orgConfig = newConfig;
            this.configGetter = newConfig.bgItemGetter;
            this.standalone = true;
            if (!this.configGetter) throw new Error("bgItemGetter is required for retrieving custom bg configurations!");
        }

        this._levels = this._buildLevels();
        if (!this.opened()) return;
        this.explorer.reconfigure({ levels: this._levels });

        // preserve original post-render sync
        //this._refreshAllLinkIcons();
    }

    // ---------- internals ----------}

    _onCardClick(item, idx) {
        // Single-open: replace selection with just this idx, update once
        this._suspendUpdates = true;
        // Uncheck all checkboxes visually
        this.selected.clear();
        this._indexMap.clear();
        const checks = document.querySelectorAll(`#${this.windowId}-list input[type="checkbox"]`);
        checks.forEach(ch => { ch.checked = false; });
        // select the clicked one
        this.selected.add(idx);
        this._indexMap.set(idx, item);
        const box = document.getElementById(`${this.windowId}-chk-${idx}`);
        if (box) box.checked = true;
        this._toggleCardRing(idx, true);
        // remove rings from others
        checks.forEach(ch => {
            const i = Number(ch.getAttribute("data-idx"));
            if (i !== idx) this._toggleCardRing(i, false);
        });
        this._suspendUpdates = false;
        this._openCurrentSelection();
    }

    _onCheck(item, idx, checked) {
        if (checked) {
            this.selected.add(idx);
            this._indexMap.set(idx, item);
        } else {
            this._indexMap.delete(idx)
            this.selected.delete(idx);
        }
        this._toggleCardRing(idx, checked);
        if (!this._suspendUpdates) this._openCurrentSelection();
    }

    _toggleCardRing(idx, on) {
        const card = document.getElementById(`${this.windowId}-card-${idx}`);
        if (!card) return;
        card.classList.toggle("ring", !!on);
        card.classList.toggle("ring-primary", !!on);
        card.classList.toggle("ring-offset-1", !!on);
    }

    _selectExclusiveAndOpen(item, idx) {
        // if already selected, do nothing
        if (this.selected.has(idx)) return;

        this._suspendUpdates = true;

        // clear previous selection
        this.selected.clear();
        this._indexMap.clear();

        // uncheck all
        const checks = document.querySelectorAll(`#${this.windowId}-list input[type="checkbox"]`);
        checks.forEach(ch => { ch.checked = false; });

        // select the clicked one
        this.selected.add(idx);
        this._indexMap.set(idx, item);

        // check its box + ring
        const box = document.getElementById(`${this.windowId}-chk-${idx}`);
        if (box) box.checked = true;
        this._toggleCardRing(idx, true);

        // remove rings from others
        checks.forEach(ch => {
            const i = Number(ch.getAttribute("data-idx"));
            if (i !== idx) this._toggleCardRing(i, false);
        });

        this._suspendUpdates = false;

        // open the current single selection
        this._openCurrentSelection();
    }

    _onCardRootClick(e, item, idx) {
        const t = e.target;
        if (!t) return;

        // ignore any clicks on controls (including DaisyUI .btn)
        if (t.closest('button, input, .btn, .toggle, [data-no-open="1"]')) return;

        // clicking a card acts like checking just that card (single-select)
        this._selectExclusiveAndOpen(item, idx);
    }

    _clearAll = () => {
        if (!this.selected.size) return;
        this._suspendUpdates = true;
        this.selected.clear();
        this._indexMap.clear();
        const checks = document.querySelectorAll(`#${this.windowId}-list input[type="checkbox"]`);
        checks.forEach(ch => { ch.checked = false; });
        // remove all rings
        const cards = document.querySelectorAll(`#${this.windowId}-list .slide-card`);
        cards.forEach(c => c.classList.remove("ring","ring-primary","ring-offset-1"));
        this._suspendUpdates = false;
        // Single update
        this._openCurrentSelection();
    };

    _renderToolbar() {
        const toggleId = `${this.windowId}-stacked`;
        return div({ class: "flex items-center justify-between gap-2 px-2 py-1 border border-base-300 bg-base-100" },
            // left: tiny title
            div({ class: "flex items-center gap-2 text-sm" },
                new UI.FAIcon({ name: "fa-images" }).create(),
                span({ class: "font-semibold" }, this.title),
            ),
            // right: stacked toggle + clear
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
                                // Re-open with current selection immediately so mode applies
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

    _renderSlideCard(idx, item) {
        console.warn("Rendering slide card", idx, item);
        const bg = this.configGetter(item);
        const name = globalThis.UTILITIES.nameFromBGOrIndex(bg);
        const checkboxId = `${this.windowId}-chk-${idx}`;
        let checked = this.selected.has(idx);
        const viewer = bg.getViewer();
        if (!checked && viewer) {
            this.selected.add(idx);
            checked = true;
        }

        const WRAP_CLASS  = "relative overflow-hidden aspect-[4/3] w-[250px]";
        const HOST_CLASS  = "flex items-center justify-center";
        const THUMBNAIL_CLASS = "block w-[86%] h-[86%] object-contain select-none pointer-events-none";
        const LABEL_CLASS = "block max-w-[120px] absolute bottom-0 right-0";

        const previewImage = img({
            id: `${this.windowId}-thumb-${idx}`,
            class: THUMBNAIL_CLASS,
            alt: name,
            draggable: "false",
            src: APPLICATION_CONTEXT.url + "src/assets/dummy-slide.png"
        });

        const labelImage = img({
            id: `${this.windowId}-label-${idx}`,
            class: LABEL_CLASS,
            alt: name,
            draggable: "false",
            src: APPLICATION_CONTEXT.url + "src/assets/image.png"
        });

        const thumbWrap = div(
            { class: WRAP_CLASS },
            div({ class: HOST_CLASS, style: "max-height: 150px;" }, previewImage),
            div({ class: "absolute left-1 top-1 z-10 px-2 py-1 text-xs font-medium truncate bg-base-200 text-white rounded" }, name),
            labelImage
        );

        if (bg?.id) {
            // need a valid viewer ref no matter what
            let usedViewer = viewer || VIEWER_MANAGER.viewers[0];
            this._loadSlideComplementaryImage(this._cachedPreviews, c => usedViewer.tools.createImagePreview(c), bg, thumbWrap, previewImage, THUMBNAIL_CLASS);
            this._loadSlideComplementaryImage(this._cachedLabels, c => usedViewer.tools.retrieveLabel(c), bg, thumbWrap, labelImage, LABEL_CLASS);
        }

        const linked = this._isLinked(viewer);

        const controls = div(
            { class: "flex items-center gap-2 p-2" },
            input({
                id: checkboxId,
                "data-idx": idx,
                type: "checkbox",
                class: "checkbox checkbox-xs",
                checked,
                onclick: (e) => e.stopPropagation(),
                onchange: (e) => this._onCheck(item, idx, e.target.checked),
                title: "Add/remove from view"
            }),
            button({
                id: `${this.windowId}-lnk-${idx}`,
                class: "btn btn-ghost btn-xs",
                disabled: !viewer,
                title: viewer ? (linked ? "Synced — click to unsync" : "Not synced — click to sync") : "Not open",
                onclick: (e) => { e.stopPropagation(); this._onToggleLink(idx, item, e); }
            }, new UI.FAIcon({ name: linked ? "fa-link" : "fa-link-slash" }).create())
        );

        // Consider actions, but this needs to find the viewer ref first
        // const actionBar = div(
        //     {
        //         class: "absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/60 to-transparent flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition"
        //     },
        //     button({ class: "btn btn-ghost btn-xs", onclick: (e) => { e.stopPropagation(); --to do-- } }, "Center"),
        //     button({ class: "btn btn-ghost btn-xs", onclick: (e) => { e.stopPropagation(); --to do-- } }, "Fit"),
        //     button({ class: "btn btn-ghost btn-xs", onclick: (e) => { e.stopPropagation(); --to do-- } }, "Remove"),
        // );

        return div(
            {
                id: `${this.windowId}-card-${idx}`,
                class:
                    "slide-card group bg-base-200 border border-base-300 transition " +
                    (checked ? "ring ring-primary ring-offset-1 " : "") +
                    "flex flex-row relative",
                onclick: (e) => this._onCardRootClick(e, item, idx)
            },
            controls,
            thumbWrap,
            // actionBar
        );
    }

    _loadSlideComplementaryImage(cacheMap, method, bg, parentNode, replacedImageNode, imageClasses) {
        setTimeout(() => {
            const cached = cacheMap[bg.id];
            const availablePreview = !!cached && !(cached instanceof Promise);
            const applyPreview = (node) => {
                if (!node) return;

                // still the same placeholder?
                const current = parentNode.querySelector(`#${replacedImageNode.id}`);
                if (!current) {
                    console.warn("Failed to find placeholder node", replacedImageNode);
                    return;
                }

                node.id = replacedImageNode.id;
                node.className = imageClasses;
                node.alt = replacedImageNode.alt || name;
                node.draggable = "false";

                // IMPORTANT: remove intrinsic size attrs that can fight the container
                node.removeAttribute?.("width");
                node.removeAttribute?.("height");

                cacheMap[bg.id] = node;
                replacedImageNode.replaceWith(node);
                return node;
            };

            if (availablePreview) {
                // use the resolved node right away
                applyPreview(cached);
            } else if (cached && typeof cached.then === "function") {
                // promise in flight
                cached.then(applyPreview)
                    .catch(err => console.error("Failed to reuse image preview", err));
            } else {
                // start loading and cache the promise
                cacheMap[bg.id] = method(bg)
                    .then(applyPreview)
                    .catch(err => {
                        console.error("Failed to create image preview", err);
                        // keep placeholder; clear bad cache
                        delete cacheMap[bg.id];
                    });
            }
        })
    }

    _isLinked(viewer) {
        if (!viewer) return false;
        return !!viewer.tools.isLinked();
    }
    _link(viewer)  {
        if (!viewer) return;
        return viewer.tools.link();
    }
    _unlink(viewer){
        if (!viewer) return;
        return viewer.tools.unlink();
    }

    _updateLinkIcon(idx, viewer) {
        const btn = document.getElementById(`${this.windowId}-lnk-${idx}`);
        if (!btn) return;
        const linked = this._isLinked(viewer);
        btn.title = viewer
            ? (linked ? "Synced — click to unsync" : "Not synced — click to sync")
            : "Not open";
        btn.disabled = !viewer;
        btn.innerHTML = "";  // replace icon
        btn.appendChild(new UI.FAIcon({name: linked ? "fa-link" : "fa-link-slash"}).create());
    }

    // _refreshAllLinkIcons() {
    //     // Call this after list render, after selection changes, and after viewer open
    //     const n = APPLICATION_CONTEXT.config.background?.length ?? 0;
    //     for (let i = 0; i < n; i++) this._updateLinkIcon(i);
    // }

    _onToggleLink(idx, item, ev) {
        ev?.stopPropagation?.();
        const viewer = this.configGetter(item)?.getViewer();
        if (!viewer) return;
        if (this._isLinked(viewer)) this._unlink(viewer); else this._link(viewer);
        // // Update all cards that might share the same viewer (esp. stacked)
        // this._refreshAllLinkIcons();
        this._updateLinkIcon(idx, viewer);
    }

    // BaseComponent contract
    create() { return this._fw.create(); }
}
