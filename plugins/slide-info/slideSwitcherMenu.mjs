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
            is: () => !!(this._dockable?.visibilityManager?.is?.() ?? this.window?.visibilityManager?.is?.()),
            on: () => this.open(),
            off: () => this.close(),
            set: next => next ? this.open() : this.close(),
            toggle: () => this.visibilityManager.is() ? this.close() : this.open()
        };

        // Keep the open-viewers tab bar in sync when the user focuses a
        // different viewport directly (without going through this panel).
        this._onActiveViewerChanged = () => {
            this._syncWithViewer();
            this._renderSelectionHeader();
        };
        if (typeof VIEWER_MANAGER !== "undefined" && typeof VIEWER_MANAGER.addHandler === "function") {
            VIEWER_MANAGER.addHandler("active-viewer-changed", this._onActiveViewerChanged);
        }
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

        this._dockable?.open?.();
        return true;
    }

    close() {
        this._dockable?.hide?.();
        return true;
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

    _cloneValue(value) {
        if (value === undefined || value === null) {
            return value;
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            return value;
        }
    }

    _sameDataEntry(a, b) {
        if (a === b) return true;
        if (a == null || b == null) return a === b;
        if (typeof a !== "object" && typeof b !== "object") {
            return String(a) === String(b);
        }
        try {
            return JSON.stringify(a) === JSON.stringify(b);
        } catch (e) {
            return false;
        }
    }

    _ensureDataEntry(data, entry) {
        if (entry === undefined) return undefined;

        const existingIndex = data.findIndex(existing => this._sameDataEntry(existing, entry));
        if (existingIndex >= 0) {
            return existingIndex;
        }

        data.push(this._cloneValue(entry));
        return data.length - 1;
    }

    _buildViewerPayload(entries) {
        const normalized = this._dedupeEntries(entries);
        const data = Array.isArray(APPLICATION_CONTEXT.config.data)
            ? APPLICATION_CONTEXT.config.data.map(entry => this._cloneValue(entry))
            : [];
        const background = Array.isArray(APPLICATION_CONTEXT.config.background)
            ? APPLICATION_CONTEXT.config.background.map(entry =>
                typeof entry?.toJSON === "function" ? entry.toJSON() : this._cloneValue(entry)
            )
            : [];
        const bgSpec = [];

        normalized.forEach((entry) => {
            const conf = entry.config || this._getConfig(entry.item);
            if (!conf) return;

            const raw = typeof conf.toJSON === "function" ? conf.toJSON() : this._cloneValue(conf);
            const dataEntry = this._resolveDataEntry(conf);
            const dataIndex = this._ensureDataEntry(data, dataEntry);
            const bgCopy = { ...raw, dataReference: dataIndex };

            let backgroundIndex = background.findIndex(existing => existing?.id && bgCopy?.id && existing.id === bgCopy.id);
            if (backgroundIndex < 0) {
                backgroundIndex = background.findIndex(existing => APPLICATION_CONTEXT.sameBackground(existing, bgCopy));
            }

            if (backgroundIndex >= 0) {
                background[backgroundIndex] = bgCopy;
            } else {
                background.push(bgCopy);
                backgroundIndex = background.length - 1;
            }

            bgSpec.push(backgroundIndex);
        });

        return {
            entries: normalized,
            data,
            background,
            bgSpec: bgSpec.length ? bgSpec : null,
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
            {
                deriveOverlayFromBackgroundGoals: true,
                dataMode: "merge",
                backgroundMode: "merge",
            },
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

            const header = div({ class: "flex items-center justify-between gap-2 px-2 pt-1" },
                span({ class: "text-[10px] font-bold text-base-content/50 uppercase tracking-wider" },
                    `Open viewers (${count})`
                ),
                button({
                    class: "btn btn-ghost btn-xs",
                    title: "Close all opened slides",
                    onclick: this._clearAll
                }, "Close all")
            );

            const tabs = div({ class: "flex flex-wrap gap-1 p-2 max-h-[96px] overflow-y-auto" });

            const orderedEntries = this._collectOpenEntries();
            orderedEntries.forEach((entry, idx) => {
                tabs.appendChild(this._renderViewerTab(entry.item, entry.config, idx));
            });

            this._headerHost.append(header, tabs);
        });
    }

    _renderViewerTab(item, config, viewerIndex) {
        const bg = config || this._getConfig(item);
        const id = bg?.id;
        const name = UTILITIES.nameFromBGOrIndex(bg);
        const viewer = VIEWER_MANAGER.viewers?.[viewerIndex] || null;
        const linked = this._isLinked(viewer);
        const isActive = !!viewer && VIEWER_MANAGER.get?.() === viewer;

        const dot = span({
            class: `inline-block w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-success' : 'bg-base-300'}`,
            title: isActive ? 'Active viewer' : 'Inactive viewer'
        });

        const linkBtn = button({
            id: `${this.windowId}-lnk-${id}`,
            class: `btn btn-ghost btn-xs btn-square shrink-0 ${linked ? 'text-primary' : 'text-base-content/40'}`,
            title: linked ? 'Linked' : 'Not linked',
            onclick: (e) => { e.stopPropagation(); this._onToggleLink(id, item, e); }
        }, new UI.FAIcon({ name: linked ? 'fa-link' : 'fa-link-slash' }).create());

        const label = span({
            class: 'truncate max-w-[16ch] text-xs font-medium',
            title: name
        }, `V${viewerIndex + 1} · ${name}`);

        const closeBtn = button({
            class: 'btn btn-ghost btn-xs btn-square shrink-0 text-error',
            title: 'Close this viewer',
            onclick: (e) => { e.stopPropagation(); this._removeSlide(item); }
        }, new UI.FAIcon({ name: 'fa-xmark' }).create());

        const base = 'flex items-center gap-1 rounded px-2 py-1 min-h-[30px] cursor-pointer transition';
        const stateCls = isActive
            ? ' bg-primary text-primary-content border border-primary'
            : ' bg-base-100 border border-base-300 hover:bg-base-200';

        return div({
                id: `${this.windowId}-open-${id}`,
                class: base + stateCls,
                title: isActive ? 'Active viewer' : 'Focus this viewer',
                onclick: () => this._focusItem(item)
            },
            dot,
            linkBtn,
            label,
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
                span({ class: "text-[11px] text-base-content/60 hidden sm:inline" }, "tap preview to open · use ▾ for more options")
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
        const openViewerCount = (VIEWER_MANAGER.viewers || []).length;

        const wrapClass = "relative overflow-hidden w-full rounded border border-base-300 bg-base-100";
        const hostClass = "flex items-center justify-center h-[120px]";
        const thumbClass = "block object-contain select-none pointer-events-none";
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
                    title: openViewerCount === 0 ? "Open this slide" : "Open in active viewer",
                    onclick: (e) => { e.stopPropagation(); this._openInViewer(item, false); }
                },
                div({ class: hostClass }, previewImage),
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
            thumbWrap = div({ class: wrapClass + " " + hostClass });
        }

        const caption = div({
            class: "px-2 pt-2 text-xs font-medium truncate text-base-content",
            title: name
        }, name);

        const primaryLabel = openViewerCount === 0 ? 'Open' : 'Open in active';
        const primaryBtn = button({
            class: "btn btn-primary btn-xs join-item",
            title: openViewerCount === 0 ? "Open this slide in a new viewer" : "Open in the currently active viewer",
            onclick: (e) => { e.stopPropagation(); this._openInViewer(item, false); }
        }, primaryLabel);

        const caretBtn = button({
            class: "btn btn-primary btn-xs join-item btn-square",
            title: "More open options",
            onclick: (e) => {
                e.stopPropagation();
                const items = this._buildOpenMenuItems(item);
                if (items.length && globalThis.ContextMenu?.open) {
                    globalThis.ContextMenu.open(e, items);
                }
            }
        }, new UI.FAIcon({ name: 'fa-caret-down' }).create());

        const splitButton = div({ class: "join" }, primaryBtn, caretBtn);

        const linkToggle = isOpen ? button({
            id: `${this.windowId}-lnk-card-${id}`,
            class: `btn btn-ghost btn-xs btn-square ${linked ? 'text-primary' : 'text-base-content/50'}`,
            title: linked ? 'Linked' : 'Not linked',
            onclick: (e) => { e.stopPropagation(); this._onToggleLink(id, item, e); }
        }, new UI.FAIcon({ name: linked ? 'fa-link' : 'fa-link-slash' }).create()) : null;

        const closeBtn = isOpen ? button({
            class: "btn btn-ghost btn-xs btn-square text-error",
            title: "Close",
            onclick: (e) => { e.stopPropagation(); this._removeSlide(item); }
        }, new UI.FAIcon({ name: 'fa-xmark' }).create()) : null;

        const actionsRow = div({ class: "flex items-center justify-between gap-1 px-2 py-2" },
            splitButton,
            div({ class: "flex items-center gap-1" }, linkToggle, closeBtn)
        );

        return div({
                id: `${this.windowId}-card-${id}`,
                class: "slide-card group bg-base-200 border border-base-300 transition flex flex-col w-full overflow-hidden rounded"
                    + (isOpen ? " ring ring-primary ring-offset-1" : ""),
            },
            thumbWrap,
            caption,
            actionsRow
        );
    }

    _buildOpenMenuItems(item) {
        const entries = this._collectOpenEntries();
        const active = VIEWER_MANAGER.get?.();
        const out = entries.map((entry, i) => {
            const v = VIEWER_MANAGER.viewers?.[i] || null;
            const isActive = v && v === active;
            const slideName = UTILITIES.nameFromBGOrIndex(entry.config);
            return {
                title: `Open in V${i + 1}${isActive ? ' (Active)' : ''} · ${slideName}`,
                icon: 'fa-circle',
                iconCss: isActive ? 'color: var(--color-success, #36d399);' : 'color: var(--color-base-300, #d1d5db);',
                action: () => this._openInTargetIndex(item, i),
            };
        });
        if (entries.length) {
            out.push({ title: '' }); // separator (header with no action / no children)
        }
        out.push({
            title: 'Open in new viewer',
            icon: 'fa-plus',
            action: () => this._openInViewer(item, true),
        });
        return out;
    }

    async _openInTargetIndex(item, targetIndex) {
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
        if (targetIndex < 0 || targetIndex >= entries.length) {
            return this._openInViewer(item, true);
        }
        entries[targetIndex] = { item, config: conf };
        await this._openEntries(entries, targetIndex);
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
            // Missing label/thumbnail is expected for many DICOM stores
            // (no OVERVIEW/LABEL instance, 406 from /rendered, etc.). The card
            // already falls back to a placeholder; keep the noise low.
            console.debug("Thumbnail loading failed:", err);
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
