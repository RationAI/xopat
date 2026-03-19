const van = globalThis.van;
const { div, img, span, button } = van.tags;

/**
 * SlideSwitcherMenu
 *
 * Single public entrypoint for viewer changes:
 *   APPLICATION_CONTEXT.openViewerWith(...)
 */
export class SlideSwitcherMenu extends UI.BaseComponent {
    constructor(options = {}) {
        super(options);

        /** @type {Map<string, { item: any, config: any }>} */
        this.selectedItems = new Map();
        this._configCache = new WeakMap();
        this._cachedPreviews = {};
        this._cachedLabels = {};
        this._levels = undefined;

        this.windowId = this.options.id ?? "slide-switcher";
        this.title = this.options.title ?? "Slide Switcher";
        this.w = this.options.width ?? 520;
        this.h = this.options.height ?? 600;
        this.l = this.options.startLeft ?? 80;
        this.t = this.options.startTop ?? 80;
        this.layout = this.options.layout || globalThis.LAYOUT || null;
        this._preventOpen = false;

        this._headerHost = div({
            class: "flex-none bg-base-200 border-b border-base-300 empty:hidden"
        });

        this.explorer = new UI.Explorer({
            id: `${this.windowId}-explorer`,
            levels: this._levels
        });

        const contentHost = document.createElement("div");
        contentHost.className = "flex-1 min-h-0 relative w-full overflow-hidden";
        contentHost.appendChild(this.explorer.create());

        this._body = div(
            { class: "h-full w-full flex flex-col overflow-hidden" },
            this._headerHost,
            this._renderToolbar(),
            contentHost
        );

        this.window = new UI.DockableWindow({
                id: this.windowId,
                title: this.title,
                icon: "fa-images",
                defaultMode: "tab",
                layout: this.layout,
                floating: {
                    width: this.w,
                    height: this.h,
                    startLeft: this.l,
                    startTop: this.t,
                    resizable: true,
                    onClose: () => this.options.onClose?.(),
                }
            },
            this._body
        );

        this.visibilityManager = {
            is: () => !!this.window?.isVisible?.(),
            on: () => this.open(),
            off: () => this.close(),
            set: next => next ? this.open() : this.close(),
            toggle: () => this.visibilityManager.is() ? this.close() : this.open()
        };
    }

    // ---------- Public API ----------

    attachToMainLayout() {
        if (this._attached) return this._dockable;

        const layout = this.layout || globalThis.LAYOUT || null;
        if (!layout) {
            console.warn("[SlideSwitcherMenu] No MainLayout available for slide switcher.", this.windowId);
            return null;
        }

        this.layout = layout;

        this._dockable = layout.addTab({
            id: this.windowId,
            title: this.title,
            iconName: "fa-images",
            body: [this._body],
            visibilityManager: this.visibilityManager,
            floating: {
                width: this.w,
                height: this.h,
                startLeft: this.l,
                startTop: this.t,
                resizable: true,
                onClose: () => this.options.onClose?.(),
            }
        });

        this._attached = !!this._dockable;
        return this._dockable;
    }

    open() {
        if (this._preventOpen) return false;

        this.attachToMainLayout();

        this._syncWithViewer();
        this._renderSelectionHeader();
        // todo avoid this manual private method call
        this.explorer?._loadAndRender?.(this.explorer._path?.length || 0, { replace: true });

        const layout = this.layout || globalThis.LAYOUT || null;
        return layout?.showTab?.(this.windowId) ?? false;
    }

    close() {
        const layout = this.layout || globalThis.LAYOUT || null;
        return layout?.hideTab?.(this.windowId) ?? false;
    }

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
        this._configCache = new WeakMap();
        this._levels = this._buildLevels();
        this._syncWithViewer();
        this._renderSelectionHeader();

        if (this.explorer) {
            this.explorer.reconfigure({ levels: this._levels });
            this.explorer._loadAndRender?.(this.explorer._path?.length || 0, { replace: true });
        }
    }

    // ---------- State helpers ----------

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

    _getActiveViewerIndex() {
        const current = VIEWER_MANAGER.get?.();
        const idx = VIEWER_MANAGER.viewers.indexOf(current);
        return idx >= 0 ? idx : 0;
    }

    _getViewerBackground(viewer) {
        if (!viewer) return null;

        let bg = viewer?.scalebar?.getReferencedTiledImage?.()?.getConfig?.("background") || null;
        if (!bg && viewer?.world?.getItemAt) {
            try {
                bg = viewer.world.getItemAt(0)?.getConfig?.("background") || null;
            } catch (e) {
                bg = null;
            }
        }
        return bg ? APPLICATION_CONTEXT.registerConfig(bg) : null;
    }

    _collectOpenEntries() {
        const out = [];
        for (const viewer of (VIEWER_MANAGER.viewers || [])) {
            const regBg = this._getViewerBackground(viewer);
            if (!regBg?.id) continue;

            let item = null;
            try {
                item = this.bgToCustom?.(regBg);
            } catch (e) {
                console.warn("SlideSwitcher: failed to map background to custom item", e);
            }
            if (!item) item = { originalItem: regBg };
            this._configCache.set(item, regBg);
            out.push({ item, config: regBg });
        }
        return out;
    }

    _syncWithViewer() {
        this.selectedItems.clear();
        for (const entry of this._collectOpenEntries()) {
            this.selectedItems.set(entry.config.id, entry);
        }
    }

    _dedupeEntries(entries) {
        const out = [];
        const seen = new Set();

        for (const entry of (entries || [])) {
            const conf = entry?.config || this._getConfig(entry?.item);
            if (!conf?.id || seen.has(conf.id)) continue;
            seen.add(conf.id);
            out.push({ item: entry.item, config: conf });
        }
        return out;
    }

    _resolveDataEntry(conf) {
        if (!conf) return undefined;

        // Prefer the raw/original data specification when available. This keeps
        // the slide reopenable even after the session data array was cleared.
        if (conf._rawValue !== undefined && conf._rawValue !== null) {
            return conf._rawValue;
        }

        const raw = typeof conf.toJSON === "function" ? conf.toJSON() : conf;
        const ref = raw?.dataReference ?? conf.dataReference;
        if (typeof ref === "number") {
            const fromConfig = APPLICATION_CONTEXT.config.data?.[ref];
            if (fromConfig !== undefined) return fromConfig;

            const bgSpec = globalThis.BackgroundConfig?.dataSpecification?.(conf);
            if (bgSpec !== undefined) return bgSpec;
            return undefined;
        }
        return ref;
    }

    _buildViewerPayload(entries) {
        const normalized = this._dedupeEntries(entries);
        const data = [];
        const background = [];

        normalized.forEach((entry, idx) => {
            const conf = entry.config || this._getConfig(entry.item);
            if (!conf) return;

            const raw = typeof conf.toJSON === "function" ? conf.toJSON() : { ...conf };
            const dataEntry = this._resolveDataEntry(conf);
            const bgCopy = { ...raw, dataReference: idx };

            data.push(dataEntry);
            background.push(bgCopy);
        });

        return {
            entries: normalized,
            data,
            background,
            bgSpec: background.length ? background.map((_, i) => i) : null,
        };
    }

    async _openEntries(entries, activeViewerIndex = 0) {
        const payload = this._buildViewerPayload(entries);

        await APPLICATION_CONTEXT.openViewerWith(
            payload.background.length ? payload.data : null,
            payload.background.length ? payload.background : null,
            undefined,
            payload.bgSpec,
            payload.background.length ? undefined : null,
            { deriveOverlayFromBackgroundGoals: true },
        );

        this._syncWithViewer();
        this._renderSelectionHeader();
        this.explorer?._loadAndRender?.(this.explorer._path?.length || 0, { replace: true });

        const clamped = Math.max(0, Math.min(activeViewerIndex, VIEWER_MANAGER.viewers.length - 1));
        const viewer = VIEWER_MANAGER.viewers[clamped];
        if (viewer) VIEWER_MANAGER.setActive(viewer);
    }

    async _openInViewer(item, spawnNew = false) {
        const conf = this._getConfig(item);
        if (!conf?.id) return;

        const existingViewer = VIEWER_MANAGER.getViewerForConfig(conf);
        if (existingViewer) {
            VIEWER_MANAGER.setActive(existingViewer);
            this._syncWithViewer();
            this._renderSelectionHeader();
            this.explorer?._loadAndRender?.(this.explorer._path?.length || 0, { replace: true });
            return;
        }

        const entries = this._collectOpenEntries();
        let targetIndex = this._getActiveViewerIndex();

        if (spawnNew || entries.length === 0) {
            entries.push({ item, config: conf });
            targetIndex = entries.length - 1;
        } else if (targetIndex >= entries.length) {
            entries.push({ item, config: conf });
            targetIndex = entries.length - 1;
        } else {
            entries[targetIndex] = { item, config: conf };
        }

        await this._openEntries(entries, targetIndex);
    }

    async _removeSlide(item) {
        const conf = this._getConfig(item);
        if (!conf?.id) return;

        const currentActive = this._getActiveViewerIndex();
        const entries = this._collectOpenEntries().filter(entry => entry.config?.id !== conf.id);
        const nextActive = Math.min(currentActive, Math.max(0, entries.length - 1));

        await this._openEntries(entries, nextActive);
    }

    _clearAll = async () => {
        this.selectedItems.clear();
        await this._openEntries([], 0);
    };

    _focusItem(item) {
        const viewer = VIEWER_MANAGER.getViewerForConfig(this._getConfig(item));
        if (viewer) VIEWER_MANAGER.setActive(viewer);
        this._syncWithViewer();
        this._renderSelectionHeader();
        this.explorer?._loadAndRender?.(this.explorer._path?.length || 0, { replace: true });
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

            const title = div({ class: "text-[10px] font-bold text-base-content/50 uppercase tracking-wider px-2 py-1" },
                `Open (${count})`
            );
            const list = div({ class: "flex flex-col gap-1 p-2 max-h-[132px] overflow-y-auto" });

            this.selectedItems.forEach((entry) => {
                list.appendChild(this._renderOpenSlideChip(entry.item, entry.config));
            });

            this._headerHost.append(title, list);
        });
    }

    _renderOpenSlideChip(item, config) {
        const bg = config || this._getConfig(item);
        const id = bg?.id;
        const name = UTILITIES.nameFromBGOrIndex(bg);
        const viewer = VIEWER_MANAGER.getViewerForConfig(bg);
        const linked = this._isLinked(viewer);
        const isActive = viewer && VIEWER_MANAGER.get?.() === viewer;

        const linkBtn = button({
            id: `${this.windowId}-lnk-${id}`,
            class: `btn btn-ghost btn-xs btn-square shrink-0 ${linked ? 'text-primary' : 'text-base-content/50'}`,
            title: linked ? 'Linked' : 'Not linked',
            onclick: (e) => { e.stopPropagation(); this._onToggleLink(id, item, e); }
        }, new UI.FAIcon({ name: linked ? 'fa-link' : 'fa-link-slash' }).create());

        const closeBtn = button({
            class: 'btn btn-ghost btn-xs btn-square shrink-0 text-error',
            title: 'Close',
            onclick: (e) => { e.stopPropagation(); this._removeSlide(item); }
        }, new UI.FAIcon({ name: 'fa-xmark' }).create());

        return div({
                id: `${this.windowId}-open-${id}`,
                class: 'flex items-center gap-1 rounded border border-base-300 bg-base-100 px-2 py-1 min-h-[30px]'
                    + (isActive ? ' ring ring-primary ring-offset-1' : ''),
                title: 'Focus this viewer',
                onclick: () => this._focusItem(item)
            },
            linkBtn,
            div({ class: 'min-w-0 flex-1 truncate text-xs font-medium' }, name),
            closeBtn
        );
    }

    _renderToolbar() {
        return div({ class: "flex items-center justify-between gap-2 px-2 py-1 border-b border-base-300 bg-base-100" },
            div({ class: "flex items-center gap-2 text-sm" },
                new UI.FAIcon({ name: "fa-images" }).create(),
                span({ class: "font-semibold" }, this.title),
            ),
            div({ class: "flex items-center gap-2" },
                span({ class: "text-[11px] text-base-content/60 hidden sm:inline" }, "tap preview = Here, New = new viewer"),
                button({
                    class: "btn btn-ghost btn-xs",
                    title: "Close all opened slides",
                    onclick: this._clearAll
                }, "Close all")
            )
        );
    }

    // ---------- Explorer Configuration ----------

    _buildLevels() {
        const levelsFromConfig = this.orgConfig?.levels;
        if (this.standalone) {
            return this._wrapLevelsWithDefaults(levelsFromConfig);
        }

        const bg = APPLICATION_CONTEXT.config.background || [];
        const items = bg.map((b, i) => ({
            id: `bg-${i}`,
            label: UTILITIES.nameFromBGOrIndex(b) ?? `Slide ${i + 1}`,
            originalItem: b,
            __bgIndex: i,
        }));

        if (items.length === 0) {
            return this._wrapLevelsWithDefaults([{
                id: "no-slides",
                label: "No Slides Available",
                canOpen: () => false,
                getChildren: async () => ({ items: [{ label: "No slides available to display" }], total: 0 }),
            }]);
        }

        return this._wrapLevelsWithDefaults([{
            id: "slides",
            label: "Slides",
            canOpen: () => false,
            getChildren: async (_parent, ctx) => ({
                items: items.slice(ctx.pageSize * ctx.page, Math.min(items.length, ctx.pageSize * (ctx.page + 1))),
                total: items.length,
            }),
        }]);
    }

    _wrapLevelsWithDefaults(levels) {
        const wrapOne = (level) => {
            const L = { ...level };

            if (typeof L.getChildren === "function") {
                const originalGetChildren = L.getChildren;
                L.getChildren = async (parent, ctx) => {
                    const timer = setTimeout(() => USER_INTERFACE.Loading.show(true), 500);
                    try {
                        return await originalGetChildren(parent, ctx);
                    } finally {
                        clearTimeout(timer);
                        USER_INTERFACE.Loading.show(false);
                    }
                };
            }

            if (!L.renderItem) {
                L.renderItem = (item) => {
                    if (!L.canOpen(item)) return this._renderSlideCard(item);
                    return div({ class: "flex items-center gap-2 px-2 py-2" },
                        span(item.label || item.name || item.id || "Item")
                    );
                };
            }

            return L;
        };

        if (!Array.isArray(levels)) return wrapOne(levels);
        return levels.map(wrapOne);
    }

    // ---------- Card Rendering ----------

    _renderSlideCard(item, withImagery = true) {
        const bg = this._getConfig(item);
        if (!bg) return div({ class: "text-error", style: "pointer-events: none;" }, "Error: No Config");

        const id = bg.id;
        const name = UTILITIES.nameFromBGOrIndex(bg);
        const viewer = VIEWER_MANAGER.getViewerForConfig(bg);
        const isOpen = !!viewer;
        const linked = this._isLinked(viewer);

        const wrapClass = "relative overflow-hidden aspect-[4/3] w-full rounded border border-base-300 bg-base-100";
        const hostClass = "flex items-center justify-center h-[120px]";
        const thumbClass = "block w-[88%] h-[88%] object-contain select-none pointer-events-none";
        const labelClass = "hidden";

        const previewImage = img({
            id: `${this.windowId}-thumb-${id}`,
            class: thumbClass,
            alt: name,
            draggable: "false",
            src: APPLICATION_CONTEXT.url + "src/assets/dummy-slide.png"
        });

        let thumbWrap;
        if (withImagery) {
            const labelImage = img({
                id: `${this.windowId}-label-${id}`,
                class: labelClass,
                alt: name,
                draggable: "false",
                src: APPLICATION_CONTEXT.url + "src/assets/image.png"
            });

            thumbWrap = div(
                {
                    class: wrapClass,
                    title: "Open in active viewer",
                    onclick: (e) => { e.stopPropagation(); this._openInViewer(item, false); }
                },
                div({ class: hostClass }, previewImage),
                div({ class: "absolute left-1 top-1 z-10 max-w-[80%] px-2 py-1 text-xs font-medium truncate bg-base-200/90 text-primary rounded" }, name),
                labelImage,
                isOpen ? div({ class: "absolute right-1 top-1 z-10" },
                    span({ class: `badge badge-xs ${linked ? 'badge-primary' : 'badge-ghost'}` }, linked ? 'linked' : 'open')
                ) : null
            );

            if (bg?.id) {
                const usedViewer = viewer || VIEWER_MANAGER.viewers?.[0];
                if (usedViewer?.tools) {
                    this._loadSlideComplementaryImage(this._cachedPreviews, c => usedViewer.tools.createImagePreview(c), bg, thumbWrap, previewImage, thumbClass);
                    this._loadSlideComplementaryImage(this._cachedLabels, c => usedViewer.tools.retrieveLabel(c), bg, thumbWrap, labelImage, labelClass);
                }
            }
        } else {
            thumbWrap = div({ class: wrapClass },
                div({ class: "absolute left-1 top-1 z-10 max-w-[80%] px-2 py-1 text-xs font-medium truncate bg-base-200/90 text-primary rounded" }, name)
            );
        }

        const controls = div({ class: "flex items-center gap-1 p-2 shrink-0" },
            button({
                class: "btn btn-ghost btn-xs",
                title: "Open in active viewer",
                onclick: (e) => { e.stopPropagation(); this._openInViewer(item, false); }
            }, 'Here'),
            button({
                class: "btn btn-ghost btn-xs",
                title: isOpen ? "Already open" : "Open in new viewer",
                disabled: isOpen,
                onclick: (e) => { e.stopPropagation(); this._openInViewer(item, true); }
            }, 'New'),
            isOpen ? button({
                class: "btn btn-ghost btn-xs text-error",
                title: "Close",
                onclick: (e) => { e.stopPropagation(); this._removeSlide(item); }
            }, 'Close') : null
        );

        return div({
                id: `${this.windowId}-card-${id}`,
                class: "slide-card group bg-base-200 border border-base-300 transition flex flex-col w-full overflow-hidden rounded"
                    + (isOpen ? " ring ring-primary ring-offset-1" : ""),
            },
            thumbWrap,
            div({ class: "flex items-center justify-between gap-2" },
                controls,
                isOpen ? button({
                    id: `${this.windowId}-lnk-card-${id}`,
                    class: `btn btn-ghost btn-xs btn-square mr-2 ${linked ? 'text-primary' : 'text-base-content/50'}`,
                    title: linked ? 'Linked' : 'Not linked',
                    onclick: (e) => { e.stopPropagation(); this._onToggleLink(id, item, e); }
                }, new UI.FAIcon({ name: linked ? 'fa-link' : 'fa-link-slash' }).create()) : span({ class: 'mr-2 text-xs text-base-content/50' }, '')
            )
        );
    }

    // ---------- Utilities ----------

    _loadSlideComplementaryImage(cacheMap, method, bg, parentNode, replacedImageNode, imageClasses) {
        const cacheKey = bg.id;

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
                cacheMap[cacheKey] = node;
                this._applyToDOM(node, replacedImageNode, parentNode, imageClasses);
            }
            return node;
        }).catch(err => {
            console.error("Thumbnail loading failed:", err);
            delete cacheMap[cacheKey];
        });
    }

    _applyToDOM(sourceNode, targetNode, parent, classes) {
        if (!sourceNode || !targetNode) return;

        const current = document.getElementById(targetNode.id) || parent?.querySelector?.(`#${targetNode.id}`);
        if (!current) return;

        const clone = sourceNode.cloneNode(true);
        clone.id = targetNode.id;
        clone.className = classes;
        current.replaceWith(clone);
    }

    _isLinked(viewer) {
        if (!viewer) return false;
        return !!viewer.tools?.isLinked?.();
    }

    _link(viewer) {
        return viewer?.tools?.link?.();
    }

    _unlink(viewer) {
        return viewer?.tools?.unlink?.();
    }

    _refreshLinkIcons(id, item) {
        const conf = this._getConfig(item);
        const viewer = VIEWER_MANAGER.getViewerForConfig(conf);
        const linked = this._isLinked(viewer);

        const btnIds = [`${this.windowId}-lnk-${id}`, `${this.windowId}-lnk-card-${id}`];
        for (const btnId of btnIds) {
            const btn = document.getElementById(btnId);
            if (!btn) continue;
            btn.title = viewer ? (linked ? 'Linked' : 'Not linked') : 'Not open';
            btn.innerHTML = "";
            btn.appendChild(new UI.FAIcon({ name: linked ? 'fa-link' : 'fa-link-slash' }).create());
            btn.classList.toggle('text-primary', !!linked);
            btn.classList.toggle('text-base-content/50', !linked);
        }
    }

    _onToggleLink(id, item, ev) {
        ev?.stopPropagation?.();
        const viewer = VIEWER_MANAGER.getViewerForConfig(this._getConfig(item));
        if (!viewer) return;
        if (this._isLinked(viewer)) this._unlink(viewer); else this._link(viewer);
        this._refreshLinkIcons(id, item);
        this._renderSelectionHeader();
        this.explorer?._loadAndRender?.(this.explorer._path?.length || 0, { replace: true });
    }

    create() {
        this.attachToMainLayout();
        return this._body;
    }
}
