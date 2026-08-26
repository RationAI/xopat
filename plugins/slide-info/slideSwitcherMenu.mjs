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
        // Translations live in the owning plugin's locale namespace.
        this._ns = this.options.ownerPluginId || "slide-info";
        this.title = this.options.title ?? this._t("switcher.title");
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
            levels: this._levels,
            // Remember where the user was browsing (folder, page, search).
            stateCacheKey: `${this.windowId}-explorer-state`
        });

        const contentHost = document.createElement("div");
        contentHost.className = "flex-1 min-h-0 relative w-full overflow-hidden";
        contentHost.appendChild(this.explorer.create());

        this._body = div(
            { class: "h-full w-full flex flex-col overflow-hidden" },
            this._headerHost,
            contentHost
        );

        // Drag-to-viewer state: the item being dragged and the dwell-based
        // drop intent for the currently hovered grid cell / host.
        this._dragItem = null;
        this._dropIntent = null;
        this._dropListenersHost = null;

        this.window = new UI.DockableWindow({
                id: this.windowId,
                title: this.title,
                icon: "ph-images",
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
            iconName: "ph-images",
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

        this.syncOpenState();

        // Cards skipped while the panel was hidden need no retry here: their
        // imagery is registered against an IntersectionObserver, which fires on
        // its own as soon as they are actually on screen — no matter which path
        // revealed them (this method, the AppBar "View" toggle, the dock's own
        // tab strip, or the user simply scrolling).
        this._dockable?.open?.();
        return true;
    }

    close() {
        this._dockable?.hide?.();
        return true;
    }

    /**
     * Release the observer and global handlers. The menu normally lives for the
     * whole session, but the observer keeps strong references to card nodes and
     * the VIEWER_MANAGER handler outlives the instance otherwise.
     */
    destroy() {
        this._thumbIO?.disconnect();
        this._thumbIO = null;
        this._observedThumbs?.clear();
        this._thumbJobs = null;
        if (this._onActiveViewerChanged && typeof VIEWER_MANAGER !== "undefined") {
            VIEWER_MANAGER.removeHandler?.("active-viewer-changed", this._onActiveViewerChanged);
            this._onActiveViewerChanged = null;
        }
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
        this._catalogFp = this._catalogFingerprint();
        this._syncWithViewer();
        this._renderSelectionHeader();

        if (this.explorer) {
            // keepState: this runs on every slide open/close too, and the
            // browser configuration is usually unchanged there — the user must
            // not be thrown back to the root of the listing.
            this.explorer.reconfigure({
                levels: this._levels,
                configId: this.orgConfig?.id,
                keepState: true
            });
        }
    }

    /**
     * Light open-state refresh: re-sync which slides are open and re-render the
     * header + the current explorer level WITHOUT re-fetching provider data.
     * Use this on open/close events — the external listing did not change, so
     * a full `refresh()` (store clear + network re-fetch + Loading overlay) is
     * wasted work. The flat (non-standalone) catalog is rebuilt only when its
     * composition actually changed (an open registered a new background, a
     * virtual-region split flipped visibility).
     */
    syncOpenState() {
        this._syncWithViewer();
        this._renderSelectionHeader();
        if (!this.explorer) return;

        if (!this.standalone) {
            const fp = this._catalogFingerprint();
            if (fp !== this._catalogFp) {
                // _buildLevels closes over the catalog snapshot at build time —
                // a changed catalog needs new levels. The flat provider is
                // in-memory, so reconfigure's store-clear refetch is free.
                this._catalogFp = fp;
                this._levels = this._buildLevels();
                this.explorer.reconfigure({
                    levels: this._levels,
                    configId: this.orgConfig?.id,
                    keepState: true
                });
                return;
            }
        }

        // Cached re-render of the current level: open badges/rings are computed
        // at render time from `selectedItems`, no data re-fetch needed.
        this.explorer.reload();
    }

    // ---------- State helpers ----------

    _t(key, options = {}) {
        return $.t(key, { ...options, ns: this._ns });
    }

    /**
     * Fingerprint of the flat slide catalog (non-standalone browser): changes
     * when backgrounds are added/reordered or virtual-region visibility flips.
     */
    _catalogFingerprint() {
        if (this.standalone) return "";
        try {
            return this._flatCatalogItems()
                .map(it => `${it.id}:${it.originalItem?.id ?? ""}`)
                .join("|");
        } catch (e) {
            return "";
        }
    }

    /** Re-sync open-viewer state and re-render both the header and the explorer list. */
    _refreshAll() {
        this.syncOpenState();
    }

    /**
     * A user action tried to open a slide that is already shown by some viewer.
     * Opening the same slide twice through the UI is almost always a mistake
     * (the scripting/API path `openViewerWith` stays unrestricted), so focus
     * the existing viewer instead and optionally tell the user why.
     */
    _focusExisting(viewer, notify = false) {
        VIEWER_MANAGER.setActive(viewer);
        if (notify) Dialogs.show(this._t("switcher.alreadyOpen"), 3000, Dialogs.MSG_INFO);
        this._refreshAll();
    }

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

    /**
     * Whether the given background has been visited (opened at least once). The
     * visited store is owned by the slide-info plugin; the menu only reads it.
     */
    _isVisited(bg) {
        try {
            return !!plugin(this._ns)?.isVisited?.(bg);
        } catch (e) {
            return false;
        }
    }

    _getActiveViewerIndex() {
        const current = VIEWER_MANAGER.get?.();
        const idx = VIEWER_MANAGER.viewers.indexOf(current);
        return idx >= 0 ? idx : 0;
    }

    _getViewerBackground(viewer) {
        if (!viewer) return { config: null, faulty: false };

        let bg = null;
        // Authoritative per-slot identity: config.background[activeBackgroundIndex[slot]].
        // Two viewports backed by the same data but mounted on distinct background
        // entries (e.g. "original" and "channels" both on data[0]) must resolve to
        // DISTINCT backgrounds. The world-item / scalebar getConfig("background")
        // path collapses same-data slots to the first matching entry, so it is only
        // a boot/transient fallback. Mirrors loader.ts `explicitSlotBackgroundId`.
        try {
            const slot = (VIEWER_MANAGER.viewers || []).indexOf(viewer);
            if (slot >= 0) {
                const sel = APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, true, true);
                const arr = Array.isArray(sel) ? sel : (Number.isInteger(sel) ? [sel] : null);
                const idx = arr ? arr[slot] : undefined;
                const backgrounds = APPLICATION_CONTEXT.config.background;
                if (Number.isInteger(idx) && Array.isArray(backgrounds)) {
                    bg = backgrounds[idx] || null;
                }
            }
        } catch (e) {
            bg = null;
        }

        // Fallback (before the per-slot selection commits, or standalone).
        if (!bg) {
            bg = viewer?.scalebar?.getReferencedTiledImage?.()?.getConfig?.("background") || null;
            if (!bg && viewer?.world?.getItemAt) {
                try {
                    bg = viewer.world.getItemAt(0)?.getConfig?.("background") || null;
                } catch (e) {
                    bg = null;
                }
            }
        }

        // Faulty verdict. An instantiation-failed slot holds a placeholder stamped
        // with the background it was meant to load; also consult the persisted
        // faulty registry (keyed by the placeholder's load key) for tile-level faults.
        let faulty = false;
        try {
            const item0 = viewer?.world?.getItemAt?.(0);
            if (item0) {
                if (!bg && item0.__xopatFaultyBackground) bg = item0.__xopatFaultyBackground;
                const key = item0.source?.tileSourceId || item0.source?.url || item0.__xopatLoadKey;
                faulty = !!item0.__xopatFaultyBackground || !!viewer.__faultySources?.isFaulty?.(key);
            }
        } catch (e) {
            faulty = false;
        }

        return { config: bg ? APPLICATION_CONTEXT.registerConfig(bg) : null, faulty };
    }

    /**
     * Find the viewer whose SLOT is mounted on the given background id, using the
     * authoritative per-slot `viewer.uniqueId` (= config.background[activeBackgroundIndex[slot]].id).
     * Unlike `VIEWER_MANAGER.getViewerForConfig` (data identity), this distinguishes
     * viewports that share a `dataReference` but sit on distinct background entries.
     */
    _findViewerForBackgroundId(id) {
        if (!id) return null;
        try {
            return (VIEWER_MANAGER.viewers || []).find(v => v?.uniqueId === id) || null;
        } catch (e) {
            return null;
        }
    }

    _collectOpenEntries() {
        const out = [];
        for (const viewer of (VIEWER_MANAGER.viewers || [])) {
            const { config: regBg, faulty } = this._getViewerBackground(viewer);
            if (!regBg?.id) continue;

            let item = null;
            try {
                item = this.bgToCustom?.(regBg);
            } catch (e) {
                console.warn("SlideSwitcher: failed to map background to custom item", e);
            }
            if (!item) item = { originalItem: regBg };
            this._configCache.set(item, regBg);
            // Carry the viewer instance: entries order SKIPS bg-less viewers,
            // so the entries index must never be used as a viewers slot index.
            out.push({ item, config: regBg, faulty, viewer });
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
        // Dedupe by object identity, not by `conf.id`. Two viewers showing the
        // same slide are legitimate distinct slots whose `conf.id` collides
        // (id is data-derived). Collapsing them by id would erase the second
        // slot on every open. Identity dedupe just guards against an entry
        // reference appearing twice — which shouldn't happen, but is cheap to
        // protect against.
        const out = [];
        const seen = new WeakSet();
        for (const entry of (entries || [])) {
            if (!entry || seen.has(entry)) continue;
            const conf = entry.config || this._getConfig(entry.item);
            if (!conf) continue;
            seen.add(entry);
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
        const data = [];
        const background = [];
        const bgSpec = [];

        normalized.forEach((entry) => {
            const conf = entry.config || this._getConfig(entry.item);
            if (!conf) return;

            const raw = typeof conf.toJSON === "function" ? conf.toJSON() : this._cloneValue(conf);
            const dataEntry = this._resolveDataEntry(conf);
            const dataIndex = this._ensureDataEntry(data, dataEntry);
            background.push({ ...raw, dataReference: dataIndex });
            bgSpec.push(background.length - 1);
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

        // The OPEN SET is driven purely by `bgSpec` (activeBackgroundIndex):
        // the pipeline opens one viewport per bgSpec entry and remaps payload
        // indexes to post-merge positions. `config.background` is the CATALOG
        // of available slides and must survive closes — hence additive
        // "merge" for both collections: closed slides stay listed in the
        // switcher, they just lose their viewport. Closing everything passes
        // `bgSpec = null` (explicit clear-selection signal; the pipeline
        // keeps the catalog and shows the single "no data" placeholder).
        await APPLICATION_CONTEXT.openViewerWith(
            payload.background.length ? payload.data : undefined,
            payload.background.length ? payload.background : undefined,
            undefined,
            payload.bgSpec,
            undefined,
            {
                // Additive data-merge also keeps data entries referenced only
                // by visualizations' shader `dataReferences` — "merge-exact"
                // would drop them and invalidate those visualizations.
                dataMode: "merge",
                backgroundMode: "merge",
            },
        );

        this._refreshAll();

        const clamped = Math.max(0, Math.min(activeViewerIndex, VIEWER_MANAGER.viewers.length - 1));
        const viewer = VIEWER_MANAGER.viewers[clamped];
        if (viewer) VIEWER_MANAGER.setActive(viewer);
    }

    async _openInViewer(item, spawnNew = false) {
        const conf = this._getConfig(item);
        if (!conf?.id) return;

        const existingViewer = this._findViewerForBackgroundId(conf.id);
        if (existingViewer) {
            return this._focusExisting(existingViewer, true);
        }

        const entries = this._collectOpenEntries();
        // Translate the active VIEWER to its entries index — entries skip
        // bg-less viewers, so the viewers slot index is the wrong currency.
        // An active empty placeholder maps to -1 → append branch.
        let targetIndex = entries.findIndex(e => e.viewer === VIEWER_MANAGER.get?.());

        if (spawnNew || targetIndex < 0 || targetIndex >= entries.length) {
            entries.push({ item, config: conf });
            targetIndex = entries.length - 1;
        } else {
            entries[targetIndex] = { item, config: conf };
        }

        await this._openEntries(entries, targetIndex);
    }

    async _removeSlide(item, viewerIndex) {
        const entries = this._collectOpenEntries();

        // Identify the slot to drop. The caller (close button on a viewer tab)
        // supplies the slot index — that's authoritative even when two viewers
        // show the same slide (so their `config.id` collides).
        let targetSlot = viewerIndex;
        if (!Number.isInteger(targetSlot) || targetSlot < 0 || targetSlot >= entries.length) {
            const conf = this._getConfig(item);
            if (!conf?.id) return;
            targetSlot = entries.findIndex(entry => entry.config?.id === conf.id);
            if (targetSlot < 0) return;
        }

        const removed = entries[targetSlot];
        entries.splice(targetSlot, 1);

        // Eager cell removal: tear down the grid cell + viewer instance before
        // re-running the open pipeline. Guarantees the grid shrinks regardless
        // of the pipeline's viewer-count reconciliation. The entries index is
        // NOT a viewers slot index (entries skip bg-less viewers) — resolve
        // the slot from the removed entry's viewer instance. Skip when
        // removing the LAST viewer (entries empty); the pipeline's
        // empty-payload path keeps a single "no data" placeholder, which is
        // the documented behavior for "everything closed".
        if (entries.length > 0) {
            const slot = removed?.viewer ? (VIEWER_MANAGER.viewers || []).indexOf(removed.viewer) : -1;
            if (slot >= 0) {
                try {
                    VIEWER_MANAGER.delete(slot);
                } catch (e) {
                    console.warn("SlideSwitcher: VIEWER_MANAGER.delete failed", e);
                }
            }
        }

        const currentActive = this._getActiveViewerIndex();
        const nextActive = Math.min(currentActive, Math.max(0, entries.length - 1));
        await this._openEntries(entries, nextActive);
    }

    _clearAll = async () => {
        this.selectedItems.clear();
        await this._openEntries([], 0);
    };

    _focusItem(item) {
        const viewer = this._findViewerForBackgroundId(this._getConfig(item)?.id);
        if (viewer) VIEWER_MANAGER.setActive(viewer);
        this._refreshAll();
    }

    // ---------- UI Rendering ----------

    _renderSelectionHeader() {
        if (!this._headerHost) return;
        this._headerHost.innerHTML = "";

        requestAnimationFrame(() => {
            this._headerHost.innerHTML = "";

            // One tab per open viewer slot. Count from the ordered entries, not
            // `selectedItems.size` — the Map is keyed by config.id and would
            // collapse two viewports that happen to share a background id.
            const orderedEntries = this._collectOpenEntries();
            if (orderedEntries.length === 0) {
                this._headerHost.classList.add("hidden");
                return;
            }

            this._headerHost.classList.remove("hidden");
            const count = orderedEntries.length;

            const header = div({ class: "flex items-center justify-between gap-2 px-2 pt-1" },
                span({ class: "text-[10px] font-bold text-base-content/50 uppercase tracking-wider" },
                    this._t("switcher.openViewers", { num: count })
                ),
                button({
                    class: "btn btn-ghost btn-xs",
                    title: this._t("switcher.closeAllTitle"),
                    onclick: this._clearAll
                }, this._t("switcher.closeAll"))
            );

            const tabs = div({ class: "flex flex-wrap gap-1 px-2 pb-2 pt-1 max-h-[96px] overflow-y-auto" });

            orderedEntries.forEach((entry, idx) => {
                tabs.appendChild(this._renderViewerTab(entry, idx));
            });

            this._headerHost.append(header, tabs);
        });
    }

    _renderViewerTab(entry, viewerIndex) {
        const { item, config, faulty = false } = entry;
        const bg = config || this._getConfig(item);
        const id = bg?.id;
        const name = UTILITIES.nameFromBGOrIndex(bg);
        const viewer = entry.viewer || null;
        const isActive = !!viewer && VIEWER_MANAGER.get?.() === viewer;

        const dot = faulty
            ? span({
                class: "text-warning shrink-0 leading-none",
                title: this._t("switcher.faultyViewer")
            }, new UI.PhIcon({ name: "ph-warning" }).create())
            : span({
                class: `inline-block w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-success' : 'bg-base-300'}`,
                title: isActive ? this._t("switcher.activeViewer") : this._t("switcher.inactiveViewer")
            });

        const label = span({
            class: 'truncate max-w-[16ch] text-xs font-medium',
            title: name
        }, `V${viewerIndex + 1} · ${name}`);

        const closeBtn = button({
            class: 'btn btn-ghost btn-xs btn-square shrink-0 text-error',
            title: this._t("switcher.closeViewer"),
            onclick: (e) => { e.stopPropagation(); this._removeSlide(item, viewerIndex); }
        }, new UI.PhIcon({ name: 'ph-x' }).create());

        const base = 'flex items-center gap-1 rounded px-2 py-1 min-h-[30px] cursor-pointer transition';
        const stateCls = isActive
            ? ' bg-primary text-primary-content border border-primary'
            : faulty
                ? ' bg-base-100 border border-warning hover:bg-base-200'
                : ' bg-base-100 border border-base-300 hover:bg-base-200';

        return div({
                id: `${this.windowId}-open-${id}`,
                class: base + stateCls,
                title: isActive ? this._t("switcher.activeViewer") : this._t("switcher.focusViewer"),
                onclick: () => this._focusItem(item)
            },
            dot,
            label,
            closeBtn
        );
    }

    // ---------- Explorer Configuration ----------

    /**
     * The flat slide catalog as explorer items (default, non-standalone browser):
     * `config.background[]` filtered for virtual-region split visibility. Each
     * item carries `originalItem` (the bg) so the default `customToBg` resolves it.
     * Shared by `_buildLevels` (rendering) and `navigateSibling` (prev/next).
     */
    _flatCatalogItems() {
        const bg = APPLICATION_CONTEXT.config.background || [];
        // Virtual-region split: a parent background expands into child regions.
        // Show either the PARENT (mode none/overlaid) or its CHILDREN (mode
        // sidebyside) — never both — so we don't render parent+children thumbnails
        // at once. Plain backgrounds always show. (See VIRTUAL_VIEWPORTS_SPLIT.md.)
        const parentById = {};
        for (const b of bg) { if (b && typeof b.id === "string") parentById[b.id] = b; }
        const isSplittableParent = (b) =>
            b && b.virtualization && Array.isArray(b.virtualization.regions) && b.virtualization.regions.length >= 1;
        return bg
            .map((b, i) => ({ b, i }))
            .filter(({ b }) => {
                if (!b) return false;
                if (typeof b.virtualOf === "string") {
                    // Child region: only listed when its parent is in side-by-side.
                    const parent = parentById[b.virtualOf];
                    return !!parent && parent.virtualizationMode === "sidebyside";
                }
                if (isSplittableParent(b)) {
                    // Parent: hidden in side-by-side (its children are listed instead).
                    return b.virtualizationMode !== "sidebyside";
                }
                return true;
            })
            .map(({ b, i }) => ({
                id: `bg-${i}`,
                label: UTILITIES.nameFromBGOrIndex(b) ?? `Slide ${i + 1}`,
                originalItem: b,
                __bgIndex: i,
            }));
    }

    /**
     * Open a slide (explorer item) into the SLOT of a specific viewer, replacing
     * whatever it shows. Falls back to the active-viewer open path when the viewer
     * is not (yet) in the manager's list.
     * @private
     */
    async _openInSlot(item, viewer) {
        const entryIndex = this._entryIndexForViewer(viewer);
        if (entryIndex < 0) return this._openInViewer(item, false);
        return this._openInTargetIndex(item, entryIndex);
    }

    /**
     * Move the given viewer to the previous/next slide **within the level the
     * browser is currently showing** — i.e. the same directory in a hierarchical
     * browser (WSI cases, DICOM series), or the whole flat catalog by default.
     * Bounds surface a first/last toast. Focus-derived `viewer` keeps this
     * multi-viewport correct.
     * @param {boolean} forward
     * @param {object} viewer OSD viewer instance (from the shortcut context)
     */
    async navigateSibling(forward, viewer) {
        if (!viewer) return;
        const { config: bg } = this._getViewerBackground(viewer);
        if (!bg?.id) return;
        const dir = forward ? 1 : -1;
        const firstMsg = () => Dialogs.show(this._t("switcher.firstSlide"), 3000, Dialogs.MSG_INFO);
        const lastMsg = () => Dialogs.show(this._t("switcher.lastSlide"), 3000, Dialogs.MSG_INFO);

        if (!this.standalone) {
            // Flat catalog: full sibling set, cheap to enumerate.
            const items = this._flatCatalogItems();
            const idx = items.findIndex(it => this._getConfig(it)?.id === bg.id);
            if (idx < 0) return void console.debug("slide-info: current slide not found in catalog");
            const next = idx + dir;
            if (next < 0) return firstMsg();
            if (next >= items.length) return lastMsg();
            return this._openInSlot(items[next], viewer);
        }

        // Custom hierarchy: navigate within the leaf level the user is browsing.
        const ctx = this.explorer.getCurrentLevelContext();
        const loaded = this.explorer.getLoadedItemsWithAbsIndex();
        // Refuse when the displayed level is a folder level (its items drill down
        // rather than open) — siblings there are directories, not slides.
        const sample = loaded[0]?.item;
        if (ctx.level && typeof ctx.level.canOpen === "function" && sample && ctx.level.canOpen(sample)) {
            return void console.debug("slide-info: current browser level is not a slide level");
        }
        const match = loaded.find(({ item }) => this._getConfig(item)?.id === bg.id);
        if (!match) return void console.debug("slide-info: current slide not in the browsed directory");
        const nextAbs = match.absIndex + dir;
        if (nextAbs < 0) return firstMsg();
        if (ctx.total != null && nextAbs >= ctx.total) return lastMsg();
        const nextItem = await this.explorer.itemAtAbsIndex(nextAbs);
        if (!nextItem) return lastMsg();
        return this._openInSlot(nextItem, viewer);
    }

    _buildLevels() {
        const levelsFromConfig = this.orgConfig?.levels;
        if (this.standalone) {
            return this._wrapLevelsWithDefaults(levelsFromConfig);
        }

        const items = this._flatCatalogItems();

        if (items.length === 0) {
            return this._wrapLevelsWithDefaults([{
                id: "no-slides",
                label: this._t("switcher.noSlides"),
                canOpen: () => false,
                getChildren: async () => ({ items: [{ label: this._t("switcher.noSlidesToDisplay") }], total: 0 }),
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
                    // Only the FIRST load of a level gets the global overlay.
                    // Incremental scroll paging is covered by the Explorer's own
                    // scoped, refcounted spinner; putting a full-screen overlay
                    // on every page turned continuous scrolling into a strobe.
                    const isInitialLoad = !(ctx?.page > 0) && !(ctx?.offset > 0);
                    if (!isInitialLoad) return await originalGetChildren(parent, ctx);

                    const timer = setTimeout(() => {
                        this.__loadingDepth = (this.__loadingDepth || 0) + 1;
                        USER_INTERFACE.Loading.show(true);
                    }, 500);
                    try {
                        return await originalGetChildren(parent, ctx);
                    } finally {
                        clearTimeout(timer);
                        // Refcounted: an unconditional hide let one finishing
                        // fetch dismiss the overlay while another was still
                        // running, so the spinner flickered off and on.
                        if (this.__loadingDepth > 0 && --this.__loadingDepth === 0) {
                            USER_INTERFACE.Loading.show(false);
                        }
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
        if (!bg) return div({ class: "text-error text-xs", style: "pointer-events: none;" }, this._t("switcher.noConfig"));

        const id = bg.id;
        const name = UTILITIES.nameFromBGOrIndex(bg);
        // Background identity, NOT data identity: a viewport shows THIS slide only
        // when its per-slot `uniqueId` equals this background id. `getViewerForConfig`
        // matches by dataReference, so it would light up every background sharing the
        // same data (e.g. both "original" and "channels" on data[0]).
        const openEntry = this.selectedItems.get(id) || null;
        const viewer = this._findViewerForBackgroundId(id);
        const isOpen = !!openEntry;
        const faulty = isOpen && !!openEntry.faulty;

        // Fixed thumb size via inline style — the shipped tailwind build is
        // purged and does not include the w-*/h-* scale used here.
        const thumbClass = "block object-contain h-full w-full select-none pointer-events-none";
        const previewImage = img({
            id: `${this.windowId}-thumb-${id}`,
            class: thumbClass,
            alt: name,
            draggable: "false",
            src: APPLICATION_CONTEXT.url + "src/assets/dummy-slide.png"
        });

        const thumb = div({
            class: "shrink-0 flex items-center justify-center overflow-hidden rounded border border-base-300 bg-base-100"
                + (faulty ? " ring-2 ring-warning" : isOpen ? " ring-2 ring-primary" : ""),
            style: "width: 96px; height: 60px;"
        }, withImagery ? previewImage : null);

        const labelImgId = `${this.windowId}-label-${id}`;
        const labelWrapId = `${this.windowId}-lbl-${id}`;
        const labelToggleId = `${this.windowId}-lbl-tog-${id}`;
        const TRANSPARENT_PX = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

        // Label image lives in the actions area. `transform: scale` on hover
        // gives a larger peek without shifting layout — siblings don't move,
        // so the cursor cannot "lose" the label and flicker.
        const labelImageClass = "block object-contain h-6 max-w-[40px] select-none origin-right relative z-10 transition-transform hover:scale-[2.5] hover:z-30";
        const labelImage = img({
            id: labelImgId,
            class: labelImageClass,
            alt: name,
            draggable: "false",
            src: TRANSPARENT_PX,
        });
        const labelWrap = span({
            id: labelWrapId,
            class: "inline-flex items-center bg-base-100 border border-base-300 rounded overflow-visible",
            style: "display: none;",
            title: name,
        }, labelImage);
        const labelToggle = button({
            id: labelToggleId,
            class: "btn btn-ghost btn-xs btn-square",
            style: "display: none;",
            title: this._t("switcher.hideLabel"),
            onclick: (e) => {
                e.stopPropagation();
                const wrap = document.getElementById(labelWrapId);
                const tog = document.getElementById(labelToggleId);
                if (!wrap || !tog) return;
                const collapsed = wrap.style.display === "none";
                wrap.style.display = collapsed ? "" : "none";
                tog.title = collapsed ? this._t("switcher.hideLabel") : this._t("switcher.showLabel");
                tog.innerHTML = "";
                tog.appendChild(new UI.PhIcon({
                    name: collapsed ? "ph-eye" : "ph-eye-slash"
                }).create());
            },
        }, new UI.PhIcon({ name: "ph-eye" }).create());

        // Imagery (thumbnail + physical label) is fetched per card and both are
        // expensive: the preview stands up an offscreen WebGL drawer and
        // re-uploads the slide's tiles, the label instantiates a tile source.
        // Both are therefore gated on the card actually being on screen — see
        // `_whenOnScreen`. Faulty slides are skipped entirely: instantiating a
        // source for a slide that already failed to open just repeats the
        // failing request (404 noise) with nothing to show.
        if (withImagery && bg?.id && !faulty) {
            const usedViewer = viewer || VIEWER_MANAGER.viewers?.[0];
            if (!isOpen && typeof this.orgConfig?.getItemPreview === "function") {
                // Custom-browser thumbnail for slides not open anywhere —
                // `createImagePreview` needs a mounted tile source, so closed
                // slides used to always show the placeholder image.
                this._loadSlideComplementaryImage(this._cachedPreviews, () => this._customItemPreviewNode(item), bg, thumb, previewImage, thumbClass, thumb);
            } else if (usedViewer?.tools) {
                this._loadSlideComplementaryImage(this._cachedPreviews, c => usedViewer.tools.createImagePreview(c), bg, thumb, previewImage, thumbClass, thumb);
            }
            if (usedViewer?.tools) {
                this._loadAndRevealLabel(bg, usedViewer, [labelWrap, labelToggle], labelImgId, labelImageClass, thumb);
            }
        }

        const badge = faulty ? span({
            class: "badge badge-xs shrink-0 badge-warning gap-1",
            title: this._t("switcher.faultyViewer")
        }, new UI.PhIcon({ name: "ph-warning" }).create(), this._t("switcher.faultyBadge"))
            : isOpen ? span({
                class: "badge badge-xs shrink-0 badge-ghost"
            }, this._t("switcher.openBadge")) : null;

        // Visited marker: only for closed slides — an open slide is self-evidently
        // being viewed, so the open/linked badge already covers it.
        const visitedBadge = (!isOpen && this._isVisited(bg)) ? span({
            class: "badge badge-xs shrink-0 badge-ghost gap-1 opacity-70",
            title: this._t("switcher.visitedTitle")
        }, new UI.PhIcon({ name: "ph-check" }).create(), this._t("switcher.visitedBadge")) : null;

        const info = div({ class: "flex-1 min-w-0 flex items-center gap-2" },
            span({ class: "truncate text-sm font-medium", title: name }, name),
            badge,
            visitedBadge
        );

        // Actions: an already-open slide only offers close (click focuses it) —
        // re-opening the same slide from the UI is treated as a mistake. A
        // closed slide offers open + target-picker. Viewport sync/link lives in
        // the viewer chrome (scalebar SYNC) and the app-bar Tools menu.
        let actionButtons;
        if (isOpen) {
            actionButtons = [
                button({
                    class: "btn btn-ghost btn-xs btn-square text-error",
                    title: this._t("switcher.closeViewer"),
                    onclick: (e) => { e.stopPropagation(); this._removeSlide(item); }
                }, new UI.PhIcon({ name: 'ph-x' }).create())
            ];
        } else {
            actionButtons = [
                div({ class: "join" },
                    button({
                        class: "btn btn-primary btn-xs join-item",
                        title: this._t("switcher.openTitle"),
                        onclick: (e) => { e.stopPropagation(); this._openInViewer(item, false); }
                    }, this._t("switcher.open")),
                    button({
                        class: "btn btn-primary btn-xs join-item btn-square",
                        title: this._t("switcher.moreOptions"),
                        onclick: (e) => {
                            e.stopPropagation();
                            const items = this._buildOpenMenuItems(item);
                            if (items.length && globalThis.ContextMenu?.open) {
                                globalThis.ContextMenu.open(e, items);
                            }
                        }
                    }, new UI.PhIcon({ name: 'ph-caret-down' }).create())
                )
            ];
        }

        const actions = div({ class: "flex items-center gap-1 shrink-0" },
            labelWrap, labelToggle, ...actionButtons
        );

        return div({
                id: `${this.windowId}-card-${id}`,
                class: "flex items-center gap-2 w-full min-w-0 cursor-grab",
                title: isOpen ? this._t("switcher.focusCardHint") : this._t("switcher.openCardHint"),
                draggable: "true",
                ondragstart: (e) => this._onSlideDragStart(item, e),
                ondragend: () => this._onSlideDragEnd(),
                onclick: () => isOpen ? this._focusItem(item) : this._openInViewer(item, false)
            },
            thumb,
            info,
            actions
        );
    }

    _buildOpenMenuItems(item) {
        const entries = this._collectOpenEntries();
        const active = VIEWER_MANAGER.get?.();
        const out = entries.map((entry, i) => {
            const v = entry.viewer || null;
            const isActive = v && v === active;
            const slideName = UTILITIES.nameFromBGOrIndex(entry.config);
            return {
                title: this._t(isActive ? "switcher.openInViewerItemActive" : "switcher.openInViewerItem",
                    { index: i + 1, name: slideName }),
                icon: 'ph-circle',
                iconCss: isActive ? 'color: var(--color-success, #36d399);' : 'color: var(--color-base-300, #d1d5db);',
                action: () => this._openInTargetIndex(item, i),
            };
        });
        if (entries.length) {
            out.push({ title: '' }); // separator (header with no action / no children)
        }
        out.push({
            title: this._t("switcher.openInNew"),
            icon: 'ph-plus',
            action: () => this._openInViewer(item, true),
        });
        return out;
    }

    async _openInTargetIndex(item, targetIndex) {
        const conf = this._getConfig(item);
        if (!conf?.id) return;

        const existingViewer = this._findViewerForBackgroundId(conf.id);
        if (existingViewer) {
            return this._focusExisting(existingViewer, true);
        }

        const entries = this._collectOpenEntries();
        if (targetIndex < 0 || targetIndex >= entries.length) {
            return this._openInViewer(item, true);
        }
        entries[targetIndex] = { item, config: conf };
        await this._openEntries(entries, targetIndex);
    }

    // ---------- Utilities ----------

    /**
     * Run `fn` once the given node is actually on screen, and never otherwise.
     *
     * This measures the real question directly instead of asking any component
     * whether it *thinks* it is visible. An `IntersectionObserver` rooted at the
     * viewport accounts for clipping by every ancestor, and a `display:none`
     * ancestor yields a zero box — so one mechanism covers the closed dock, an
     * unfocused dock tab, a closed floating window, a row scrolled out of the
     * explorer's virtual window, and the off-DOM probe row the explorer mounts
     * to measure row height.
     *
     * @param {HTMLElement} node node whose visibility gates the work
     * @param {Function} fn work to run at most once, when `node` is seen
     */
    _whenOnScreen(node, fn) {
        if (!node || typeof fn !== "function") return;

        // Already-open panel: skip the observer round-trip so the card does not
        // flash a placeholder for a frame before its thumbnail lands.
        if (node.isConnected && this._dockable?.isEffectivelyVisible?.()) {
            fn();
            return;
        }

        if (!this._thumbIO) {
            this._thumbJobs = new WeakMap();
            this._observedThumbs = new Set();
            this._thumbIO = new IntersectionObserver(entries => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    const target = entry.target;
                    this._unobserveThumb(target);
                    // The explorer measures row height by mounting a probe card
                    // and removing it in a microtask. It "intersects" while
                    // mounted, so without this it would generate a full preview
                    // for the first item on every page swap.
                    if (!target.isConnected) continue;
                    const jobs = this._thumbJobs.get(target);
                    this._thumbJobs.delete(target);
                    for (const job of jobs || []) {
                        try {
                            job();
                        } catch (err) {
                            console.debug("Deferred card imagery failed:", err);
                        }
                    }
                }
            }, { root: null, rootMargin: "128px 0px", threshold: 0.01 });
        }

        const jobs = this._thumbJobs.get(node);
        if (jobs) {
            // Same card, second consumer (preview + label share one node).
            jobs.push(fn);
            return;
        }
        this._thumbJobs.set(node, [fn]);

        // The observer holds a strong reference to every target, while the
        // explorer discards row nodes as they scroll out of its window. Sweep
        // the detached ones instead of growing the set for the session.
        if (this._observedThumbs.size > 200) {
            for (const observed of this._observedThumbs) {
                if (!observed.isConnected) this._unobserveThumb(observed);
            }
        }

        this._observedThumbs.add(node);
        this._thumbIO.observe(node);
    }

    /** @private */
    _unobserveThumb(node) {
        this._thumbIO?.unobserve(node);
        this._observedThumbs?.delete(node);
    }

    _loadAndRevealLabel(bg, viewer, revealEls, targetImgId, classes, observeNode = null) {
        const cache = this._cachedLabels;
        const key = bg.id;
        const toReveal = Array.isArray(revealEls) ? revealEls : [revealEls];

        const apply = (node) => {
            const current = document.getElementById(targetImgId);
            if (!current || !(node instanceof HTMLElement)) return false;
            const clone = node.cloneNode(true);
            clone.id = targetImgId;
            clone.className = classes;
            current.replaceWith(clone);
            return true;
        };

        const reveal = (node) => {
            // Swap-then-reveal: only mark the elements visible after the real
            // label has replaced the transparent placeholder. Avoids a brief
            // frame where an empty box flickers in the row.
            if (apply(node)) {
                for (const el of toReveal) {
                    if (el) el.style.display = "";
                }
            }
        };

        // The whole body is deferred, cache hits included: `apply` resolves the
        // target by id through the document, so it only works once the card is
        // in the DOM — which is exactly when the observer fires.
        const load = () => {
            if (cache[key] instanceof HTMLElement) {
                reveal(cache[key]);
                return;
            }

            if (cache[key] instanceof Promise) {
                cache[key].then((node) => { if (node) reveal(node); }).catch(() => {});
                return;
            }

            cache[key] = viewer.tools.retrieveLabel(bg).then((node) => {
                if (node) {
                    cache[key] = node;
                    reveal(node);
                }
                return node;
            }).catch((err) => {
                // Missing / failing labels are expected — many tile sources
                // return undefined or throw. Keep the noise low and leave the
                // overlay hidden.
                console.debug("Label loading failed:", err);
                delete cache[key];
            });
        };

        if (observeNode) this._whenOnScreen(observeNode, load);
        else load();
    }

    /**
     * Resolve a custom-browser leaf item's thumbnail via the configured
     * `getItemPreview` hook into an <img> node. The blob is inlined as a
     * data URL so the node survives `_applyToDOM`'s cloning without object-URL
     * lifecycle management.
     */
    async _customItemPreviewNode(item) {
        const blob = await this.orgConfig.getItemPreview(item);
        if (!blob) return null;
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
        const node = document.createElement("img");
        node.src = dataUrl;
        node.draggable = false;
        return node;
    }

    _loadSlideComplementaryImage(cacheMap, method, bg, parentNode, replacedImageNode, imageClasses, observeNode = null) {
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

        // Nothing cached: generating a preview means standing up an offscreen
        // WebGL drawer and re-uploading the slide's tiles into it. Far too
        // expensive to pay for a card nobody is looking at, so the actual work
        // waits until the card is on screen — the placeholder stands in
        // meanwhile.
        const generate = () => {
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
        };

        if (observeNode) this._whenOnScreen(observeNode, generate);
        else generate();
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

    // ---------- Drag & drop to viewer ----------
    //
    // Drop intent is dwell-based: a quick drop anywhere opens the slide in a
    // NEW viewport (non-destructive default); holding over an occupied
    // viewport for `_DROP_REPLACE_DWELL_MS` switches the intent to REPLACE
    // that viewport. A floating label on the hovered cell announces what the
    // drop will do, and the outline style mirrors it (dashed = new viewer,
    // solid warning = replace).

    static _DROP_REPLACE_DWELL_MS = 700;

    _onSlideDragStart(item, e) {
        const conf = this._getConfig(item);
        if (!conf?.id) {
            e.preventDefault();
            return;
        }
        this._dragItem = item;
        e.dataTransfer.effectAllowed = "copy";
        try {
            e.dataTransfer.setData("application/x-xopat-slide", String(conf.id));
        } catch (err) { /* dataTransfer is best-effort, the item is kept on the instance */ }
        this._installViewerDropTargets();
    }

    _onSlideDragEnd() {
        this._clearDrag();
    }

    _installViewerDropTargets() {
        if (this._dropListenersHost) return;
        // The viewer grid host — every stretch-grid cell (osd-N) lives inside.
        const host = document.getElementById("osd");
        if (!host) return;
        this._dropListenersHost = host;

        this._onViewerDragOver = (e) => {
            if (!this._dragItem) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            const cell = e.target?.closest?.(".stretch-grid__item");
            this._setDropIntent(cell || host);
        };
        this._onViewerDragLeave = (e) => {
            // Only clear when the pointer leaves the viewer area entirely.
            if (!e.relatedTarget || !host.contains(e.relatedTarget)) this._setDropIntent(null);
        };
        this._onViewerDrop = (e) => {
            e.preventDefault();
            this._completeDrop();
        };

        host.addEventListener("dragover", this._onViewerDragOver);
        host.addEventListener("dragleave", this._onViewerDragLeave);
        host.addEventListener("drop", this._onViewerDrop);
    }

    _removeViewerDropTargets() {
        const host = this._dropListenersHost;
        if (!host) return;
        host.removeEventListener("dragover", this._onViewerDragOver);
        host.removeEventListener("dragleave", this._onViewerDragLeave);
        host.removeEventListener("drop", this._onViewerDrop);
        this._dropListenersHost = null;
    }

    /**
     * Update the drop-intent state machine for the element currently hovered.
     * Re-entrant per dragover tick: same target keeps the running dwell timer.
     * @param {HTMLElement|null} el hovered grid cell, the grid host, or null
     */
    _setDropIntent(el) {
        if (this._dropIntent?.el === el) return;
        this._clearDropIntent();
        if (!el) return;

        const host = this._dropListenersHost;
        const isCell = el !== host;
        const viewer = isCell && el.id ? VIEWER_MANAGER.getViewer(el.id, false) : undefined;
        // Check .config — _getViewerBackground always returns an object, so a
        // bare truthiness test would mark empty placeholder viewports occupied
        // (faulty placeholders keep .config via __xopatFaultyBackground and
        // correctly stay "occupied" → replace-dwell).
        const occupied = !!viewer && !!this._getViewerBackground(viewer).config;

        const intent = {
            el,
            viewer,
            // 'new' → open a new viewport; 'here' → fill this empty
            // placeholder viewport; 'replace' → swap this viewport's slide.
            mode: (isCell && viewer && !occupied) ? "here" : "new",
            timer: null,
        };
        if (occupied) {
            intent.timer = setTimeout(() => {
                intent.timer = null;
                intent.mode = "replace";
                this._renderDropIntent(intent);
            }, SlideSwitcherMenu._DROP_REPLACE_DWELL_MS);
        }
        this._dropIntent = intent;
        this._renderDropIntent(intent);
    }

    _renderDropIntent(intent) {
        const { el, mode } = intent;
        const replace = mode === "replace";
        el.style.outline = replace
            ? "3px solid var(--color-warning, #f59e0b)"
            : "3px dashed var(--color-primary, #7c3aed)";
        el.style.outlineOffset = "-3px";

        // Floating hint label — only meaningful on viewer cells (which are
        // position:relative); the bare host keeps outline-only feedback.
        if (el === this._dropListenersHost) return;
        if (!intent.label) {
            intent.label = document.createElement("div");
            intent.label.className = "badge shadow";
            intent.label.style.cssText =
                "position:absolute; top:12px; left:50%; transform:translateX(-50%);" +
                "z-index:50; pointer-events:none; white-space:nowrap;";
            el.appendChild(intent.label);
        }
        intent.label.classList.toggle("badge-warning", replace);
        intent.label.classList.toggle("badge-primary", !replace);
        intent.label.textContent =
            mode === "replace" ? this._t("switcher.dropReplaceHint")
            : mode === "here" ? this._t("switcher.dropHereHint")
            : this._t("switcher.dropNewHint");
    }

    _clearDropIntent() {
        const intent = this._dropIntent;
        if (!intent) return;
        this._dropIntent = null;
        if (intent.timer) clearTimeout(intent.timer);
        intent.label?.remove();
        intent.el.style.outline = "";
        intent.el.style.outlineOffset = "";
    }

    _clearDrag() {
        this._dragItem = null;
        this._clearDropIntent();
        this._removeViewerDropTargets();
    }

    async _completeDrop() {
        const item = this._dragItem;
        const intent = this._dropIntent;
        this._clearDrag();
        if (!item) return;

        const conf = this._getConfig(item);
        if (!conf?.id) return;

        const existingViewer = this._findViewerForBackgroundId(conf.id);
        if (existingViewer) {
            return this._focusExisting(existingViewer, true);
        }

        const viewer = intent?.viewer;
        if (viewer && intent.mode === "here") {
            // Empty placeholder viewport: activate it and let the standard
            // open path fill it.
            VIEWER_MANAGER.setActive(viewer);
            return this._openInViewer(item, false);
        }
        if (viewer && intent.mode === "replace") {
            const entryIndex = this._entryIndexForViewer(viewer);
            if (entryIndex >= 0) return this._openInTargetIndex(item, entryIndex);
        }
        // Quick drop (no dwell) or empty grid space — open a new viewport.
        return this._openInViewer(item, true);
    }

    /**
     * Map a viewer instance to its index in `_collectOpenEntries()` order —
     * that order skips viewers without a background (empty placeholders), so
     * it can differ from the plain `VIEWER_MANAGER.viewers` slot index.
     * @returns {number} entry index, or -1 when the viewer holds no background
     */
    _entryIndexForViewer(viewer) {
        if (!viewer) return -1;
        return this._collectOpenEntries().findIndex(e => e.viewer === viewer);
    }

    create() {
        this.attachToMainLayout();
        return this._body;
    }
}
