import van from "../../vanjs.mjs";
import {BaseComponent} from "../baseComponent.mjs";
import {Loading} from "../elements/loading.mjs";

/**
 * @namespace UI.Explorer
 */

/**
 * Root options for {@link UI.Explorer}.
 * @typedef {Object} UI.Explorer.Options
 * @property {string} [id]            - Element id for the root container.
 * @property {string} [class]         - Extra CSS class(es) for the root container.
 * @property {Array<UI.Explorer.Level>} levels  - Hierarchy definition (from top to bottom).
 * @property {UI.Explorer.PathChangeHandler} [onPathChange]
 *   Invoked whenever the navigation path changes (after content renders).
 * @property {string} [stateCacheKey]
 *   `APPLICATION_CONTEXT.AppCache` key under which the navigation state (path,
 *   per-level page, search) is remembered across reloads. Omit to disable
 *   persistence entirely.
 * @property {string} [configId]
 *   Identity of whoever authored `levels`. Folded into the state fingerprint so
 *   two browsers that happen to share level ids do not restore each other.
 * @property {UI.Explorer.StateChangeHandler} [onStateChange]
 *   Mirror hook for consumers keeping the state in their own store.
 * @property {UI.Explorer.State} [initialState]
 *   State to restore on first render; wins over the persisted one.
 */

/**
 * Serializable navigation state. See {@link UI.Explorer#getState}.
 * @typedef {Object} UI.Explorer.State
 * @property {number} v      Schema version (currently 1).
 * @property {string} fp     Level-configuration fingerprint.
 * @property {Array<{levelId: string, key: string}>} path  Drilled-in items, by level key.
 * @property {number[]} pages  Remembered page per depth (`path.length + 1` entries).
 * @property {string} search   Search term of the displayed level.
 */

/**
 * One hierarchy level configuration.
 * @typedef {Object} UI.Explorer.Level
 * @property {string} id                        - Unique id for this level.
 * @property {string} [title]                   - Optional title shown in header/breadcrumbs.
 * @property {"page" | "virtual"} mode          - "page" => classic paging controls; "virtual" => infinite/windowed list.
 * @property {number} [pageSize=20]             - Page size (or fetch batch size for "virtual").
 * @property {UI.Explorer.GetChildren} getChildren - Provider that returns items lazily.
 * @property {UI.Explorer.Search} [search]
 *   Optional search override; if omitted, the implementation may call {@link UI.Explorer.Level.getChildren}
 *   with {@link UI.Explorer.FetchContext.search}.
 * @property {UI.Explorer.RenderItem} renderItem   - Lightweight renderer for a single row/card.
 * @property {UI.Explorer.RenderItem} [renderHeavy]
 *   Heavy renderer for when the item enters viewport; falls back to {@link UI.Explorer.Level.renderItem}.
 * @property {UI.Explorer.CanOpen} canOpen
 *   Required. Whether clicking an item drills down to the next level (default: true except on the last level).
 * @property {UI.Explorer.onClick} [onClick]         - Called when user selects/opens an item.
 * @property {UI.Explorer.KeyOf} [keyOf]
 *   Unique key extractor (default uses item.id || index).
 * @property {UI.Explorer.ResolveByKey} [resolveByKey]
 *   Inverse of {@link UI.Explorer.Level.keyOf}: turn a remembered key back into
 *   an item, without listing the level. Required for this level to take part in
 *   a state restore — a level that does not implement it terminates the restore
 *   at its own depth (the levels above it are still restored).
 */

/**
 * Fetch-time context passed to providers.
 * @typedef {Object} UI.Explorer.FetchContext
 * @property {number} page          - Zero-based page number (or batch index).
 * @property {number} pageSize      - Page/batch size.
 * @property {string} [search]      - Current search string (if any).
 * @property {number} levelIndex    - Zero-based index of the current level.
 * @property {number} offset        - Absolute item offset (page * pageSize).
 */

/**
 * Result of a fetch/search call.
 * @typedef {Object} UI.Explorer.FetchResult
 * @property {Array<*>} items       - Items to render.
 * @property {number} [total]       - Optional total item count (used by pager if provided).
 */

/**
 * Node on the current navigation path.
 * @typedef {Object} UI.Explorer.PathNode
 * @property {string} levelId
 * @property {*} item
 */

/**
 * Helper functions passed to renderers.
 * (Shape is up to your implementation; below is a common minimal set.)
 * @typedef {Object} UI.Explorer.RenderHelpers
 * @property {UI.Explorer.PathNode[]} path the current navigation state
 * @property {number} itemIndex of the current item
 * @property {number} levelIndex of the parent level
 * @property {() => void} open    - Drill down into the next level.
 */

/* ── Callbacks ──────────────────────────────────────────────────────── */

/**
 * Provider that returns children lazily for a level.
 * @callback UI.Explorer.GetChildrenc
 * @param {*} parent
 * @param {UI.Explorer.FetchContext} ctx
 * @returns {Promise<UI.Explorer.FetchResult> | UI.Explorer.FetchResult}
 */

/**
 * Optional search override for a level.
 * @callback UI.Explorer.Search
 * @param {*} parent
 * @param {UI.Explorer.FetchContext} ctx
 * @returns {Promise<UI.Explorer.FetchResult> | UI.Explorer.FetchResult}
 */

/**
 * Render a single item (lightweight).
 * @callback UI.Explorer.RenderItem
 * @param {*} item
 * @param {UI.Explorer.RenderHelpers} helpers
 * @returns {Node | import('./BaseComponent').default | HTMLElement}
 */

/**
 * Whether the item can open the next level.
 * @callback UI.Explorer.CanOpen
 * @param {*} item
 * @returns {boolean}
 */

/**
 * Called when user selects/opens an item.
 * @callback UI.Explorer.OnClick
 * @param {*} item
 * @param {number} index - item index
 * @returns {void}
 */

/**
 * Unique key for React/van list reuse; defaults to item.id || index.
 * @callback UI.Explorer.KeyOf
 * @param {*} item
 * @param {number} index
 * @param {*} parent
 * @returns {string}
 */

/**
 * Notifies about navigation changes.
 * @callback UI.Explorer.PathChangeHandler
 * @param {Array<UI.Explorer.PathNode>} path
 * @returns {void}
 */

/**
 * Resolve a single item from the key produced by {@link UI.Explorer.Level.keyOf}.
 * Should be a targeted lookup, not a listing scan — it runs on every restore.
 * Return `null` (or throw) when the key no longer exists.
 * @callback UI.Explorer.ResolveByKey
 * @param {*} parent the already-resolved parent item (null at the top level)
 * @param {string} key
 * @param {{levelIndex: number}} ctx
 * @returns {Promise<*|null>|*|null}
 */

/**
 * Notifies about navigation-state changes (path, page or search).
 * @callback UI.Explorer.StateChangeHandler
 * @param {UI.Explorer.State} state
 * @returns {void}
 */

const { div, ul, li, span, a, input } = van.tags;
/**
 * Generic hierarchy/browser component with per-level paging and lazy rendering.
 * Works with BaseComponent + vanjs + Tailwind + DaisyUI.
 * Exported class name: {@link UI.Explorer}.
 *
 * @example
 * const explorer = new UI.Explorer({
 *   id: "wsi-browser",
 *   class: "h-full",
 *   levels: [
 *     /** @type {UI.Explorer.Level} *\/ ({
 *       id: "patients",
 *       title: "Patients",
 *       mode: "page",
 *       pageSize: 20,
 *       async getChildren(parent, ctx) {
 *         const res = await api.fetchPatients({ page: ctx.page, pageSize: ctx.pageSize, q: ctx.search });
 *         return { items: res.items, total: res.total }; // total optional
 *       },
 *       renderItem(item, h) { return h.li(item.name); },
 *       onClick(item, index) { console.log("opened patient", item.id); },
 *       keyOf(item) { return item.id; },
 *     }),
 *     /** @type {UI.Explorer.Level} *\/ ({
 *       id: "studies",
 *       mode: "virtual",
 *       async getChildren(parent, ctx) { /* ... *\/ return { items: [] }; },
 *       renderItem(item, h) { return h.li(item.description); },
 *     }),
 *   ],
 *   onPathChange(path) { console.log("path:", path.map(p => p.levelId)); },
 * });
 * document.body.appendChild(explorer.create());
 */
export class Explorer extends BaseComponent {
    /** How many level-configurations keep a remembered navigation state. */
    static STATE_HISTORY_SIZE = 4;

    constructor(opts = undefined) {
        opts = super(opts).options;
        // Visual
        this.classMap.base = [
            "x-hlist",
            "flex",
            "flex-col",
            "gap-2",
            "h-full",
            "w-full",
            "overflow-hidden",
            "relative"
        ].join(" ");

        // Data/config
        if (Array.isArray(opts.levels)) {
            this.levels = opts.levels.slice();
        } else if (typeof opts.levels === "object" && opts.levels !== null) {
            this.levels = {
                isDynamic: true,
                level: opts.levels,
            };
        } else {
            this.levels = [];
        }

        this.onPathChange = typeof opts.onPathChange === "function" ? opts.onPathChange : null;
        this.onStateChange = typeof opts.onStateChange === "function" ? opts.onStateChange : null;

        // Persistence (opt-in): a generic component must not write to the app
        // cache unless its owner asked for it by naming a key.
        this._stateCacheKey = typeof opts.stateCacheKey === "string" ? opts.stateCacheKey : null;
        this._configId = opts.configId;
        this._initialState = opts.initialState || null;
        this._fingerprint = this._fingerprintOf(this.levels, this._configId);
        this._restoring = false;
        this._restoreAborted = false;
        this._booted = false;

        // ⬅️ Remember page per level *depth* (only used for mode:"page")
        this._viewState = new Map(); // _viewKey() -> { pageNo:number }

        // Internal state
        this._path = []; // [{ levelIndex, levelId, item }]
        this._search = "";
        this._objKeyMaps = [];        // Array<WeakMap<object,string>> per level
        this._objKeyCounters = [];
        this._lastIndexMaps = [];     // Array<WeakMap<object,number>> per level

        // Cache per level+parentKey+search => { pages: Map<number,{items,total,done}>, virtualOffset, mode, currentPage }
        this._store = new Map();

        this._io = null;
        this.loader = new Loading({
            id: `${this.id}-loader`,
            overlay: true,
            type: "spinner"
        });

        // bind
        this._navigate = this._navigate.bind(this);
        this._loadAndRender = this._loadAndRender.bind(this);
        this._renderLevelView = this._renderLevelView.bind(this);
        this._debouncedSearch = this._debouncedSearch.bind(this);
    }

    _getLevel(levelIndex) {
        if (!this.levels) return null;
        if (Array.isArray(this.levels)) return this.levels[levelIndex] || null;

        if (this.levels.isDynamic) return this.levels.level;

        return null;
    }

    /**
     * Number of configured levels. A dynamic level describes a hierarchy of
     * unbounded depth, so it reports `Infinity` — every `this.levels.length`
     * read used to yield `undefined` there and poison the arithmetic built on
     * top of it (NaN level indices, root data rendered under a folder).
     * @private
     */
    _levelCount() {
        if (Array.isArray(this.levels)) return this.levels.length;
        if (this.levels?.isDynamic) return Infinity;
        return 0;
    }

    /** Index of the level currently displayed to the user. @private */
    _currentLevelIndex() {
        const count = this._levelCount();
        if (!Number.isFinite(count)) return this._path.length;
        return Math.min(this._path.length, Math.max(0, count - 1));
    }

    /**
     * Key under which the remembered page of a level is stored. Depth is part
     * of the key: with a dynamic level every depth shares one level id, so
     * keying by id alone made all folders share a single page memory.
     * @private
     */
    _viewKey(levelIndex, lvl) {
        return `${levelIndex}::${lvl?.id ?? levelIndex}`;
    }

    getItem(index) {
        return this._path[this._path.length - 1]?.item?.items?.[index];
    }

    reset() {
        this._restoreAborted = true;
        this._path = [];
        this._search = "";
        this._store.clear();
        this._viewState.clear(); // ⬅️ also clear remembered pages
        this._loadAndRender(0, { replace: true }).then(() => this._emitStateChange());
    }

    setPath(itemsPerLevel /* array of items or null */) {
        this._path = [];
        itemsPerLevel.forEach((item, idx) => {
            if (idx < this._levelCount() && item) {
                this._path.push({ levelIndex: idx, levelId: this._getLevel(idx)?.id, item });
            }
        });
        this._loadAndRender(this._path.length, { replace: true }).then(() => this._emitStateChange());
    }

    _bucketKey(levelIndex, parentItem, search) {
        const lvl = this._getLevel(levelIndex);
        const parentKey = this._parentKey(levelIndex, parentItem);
        if (this.levels.isDynamic)
            return `DYNAMIC::${parentKey}::${search || ""}`;

        return `${lvl?.id || levelIndex}::${parentKey}::${search || ""}`;
    }

    _parentKey(levelIndex, parentItem) {
        if (levelIndex === 0) return "ROOT";
        const prevLvl = this._getLevel(levelIndex - 1);
        if (!parentItem) return "NULLPARENT";

        // 1) Prefer custom keyOf if available
        if (typeof prevLvl?.keyOf === "function") {
            const idxMap = this._lastIndexMaps[levelIndex - 1] || (this._lastIndexMaps[levelIndex - 1] = new WeakMap());
            const seenIdx = idxMap.get(parentItem);
            try {
                const k = prevLvl.keyOf(parentItem, Number.isFinite(seenIdx) ? seenIdx : 0, this._path[levelIndex - 2]?.item ?? null);
                if (k != null) return String(k);
            } catch {}
        }

        // 2) Then parentItem.id if present
        if (parentItem?.id != null) return String(parentItem.id);

        // 3a) If parent is a primitive (string/number/boolean/etc.), build a stable primitive key
        const t = typeof parentItem;
        if (t !== "object" || parentItem === null) {
            return `PRIM#${t}#${String(parentItem)}`;
        }

        // 3b) Stable object identity fallback via WeakMapper-level counter
        let wm = this._objKeyMaps[levelIndex - 1];
        if (!wm) wm = (this._objKeyMaps[levelIndex - 1] = new WeakMap());
        let key = wm.get(parentItem);
        if (!key) {
            const next = (this._objKeyCounters[levelIndex - 1] ?? 0) + 1;
            this._objKeyCounters[levelIndex - 1] = next;
            key = `OBJ#${next}`;
            wm.set(parentItem, key);
        }
        return key;
    }

    _ensureBucket(levelIndex, parentItem, search) {
        const k = this._bucketKey(levelIndex, parentItem, search);
        const lvl = this._getLevel(levelIndex);
        let b = this._store.get(k);
        if (!b) {
            b = {
                pages: new Map(),
                total: undefined,
                virtualOffset: 0,
                mode: lvl?.mode || "page",
                currentPage: 0,
                // Monotonic key for virtual-mode segments. Must NOT be derived
                // from virtualOffset: once a batch comes back short, the derived
                // key collides with a live segment and its rendered placeholders
                // start resolving against the wrong items.
                nextSegment: 0,
                // Latch so a second IntersectionObserver firing cannot issue a
                // duplicate request for the same offset while one is in flight.
                loadingMore: false,
            };
            this._store.set(k, b);
        }
        return b;
    }

    _keyOf(lvl, item, index, parent) {
        if (lvl?.keyOf) return String(lvl.keyOf(item, index, parent));
        return item?.id != null ? String(item.id) : String(index);
    }

    _canOpen(levelIndex, lvl, item, idx) {
        if (typeof lvl?.canOpen === "function") return !!lvl.canOpen(item);
        return levelIndex < this._levelCount() - 1;
    }

    _makeDebounce(fn, delay = 250) {
        let t = null;
        return (...args) => {
            if (t) clearTimeout(t);
            t = setTimeout(() => fn(...args), delay);
        };
    }

    /** Navigate into next level; before leaving, remember the page of the current level (if paged). */
    async _navigate(levelIndex, item) {
        const lvl = this._getLevel(levelIndex);
        if (!lvl) return;

        // A user navigation always wins over an in-flight state restore.
        this._restoreAborted = true;

        if (lvl.mode === "page") {
            const parent = levelIndex > 0 ? this._path[levelIndex - 1]?.item : null;
            const bucket = this._ensureBucket(levelIndex, parent, this._search);
            this._viewState.set(this._viewKey(levelIndex, lvl), { pageNo: bucket.currentPage });
        }

        // Update path and go deeper
        this._path = this._path.filter(p => p.levelIndex < levelIndex);
        this._path.push({ levelIndex, levelId: lvl.id, item });

        // A search term belongs to the level it was typed in. Levels interpret
        // it differently (a study UID here, a slide name one level down), so
        // carrying it into the child filters the child by a string that cannot
        // match and the list opens empty. Clearing it also refreshes the search
        // box, which re-renders with `value: this._search`.
        this._search = "";

        await this._loadAndRender(levelIndex + 1, { replace: true });
        this.onPathChange?.(this._path.slice());
        this._emitStateChange();
    }

    /** Load and render the requested level, restoring remembered page when applicable. */
    async _loadAndRender(levelIndex, { replace = false } = {}) {
        const parent = levelIndex > 0 ? this._path[levelIndex - 1]?.item : null;
        const lvl = this._getLevel(levelIndex);
        const host = document.getElementById(this.id);
        if (!host || !lvl) return;

        const bucket = this._ensureBucket(levelIndex, parent, this._search);

        // ⬅️ On first init for this bucket, pick the starting page.
        if (!bucket._init) {
            bucket._init = true;
            // If this is a paged level and we have a remembered page, use it
            if (lvl.mode === "page") {
                const remembered = this._viewState.get(this._viewKey(levelIndex, lvl))?.pageNo ?? 0;
                bucket.currentPage = Math.max(0, remembered | 0);
                // Ensure that page is fetched
                await this._fetchPage(levelIndex, parent, bucket, bucket.currentPage);
            } else {
                // virtual mode: just fetch the first batch
                await this._fetchVirtualBatch(levelIndex, parent, bucket, /*append*/ true);
            }
        } else if (lvl.mode === "page") {
            // Bucket already exists; if user remembered a different page (e.g., coming back), make sure it’s fetched
            const remembered = this._viewState.get(this._viewKey(levelIndex, lvl))?.pageNo;
            if (Number.isInteger(remembered) && remembered >= 0) {
                bucket.currentPage = remembered;
                if (!bucket.pages.has(bucket.currentPage)) {
                    await this._fetchPage(levelIndex, parent, bucket, bucket.currentPage);
                }
            }
        }

        const view = this._renderLevelView(levelIndex, parent, bucket);
        if (replace) {
            host.innerHTML = "";
            host.appendChild(view);
        } else {
            host.appendChild(view);
        }
    }

    async _fetchPage(levelIndex, parent, bucket, pageNo) {
        const lvl = this._getLevel(levelIndex);
        const pageSize = Math.max(1, lvl?.pageSize | 0 || 20);
        const provider = this._pickProvider(lvl);

        // ⬇️ DELAYED LOADING WRAP (300ms)
        const { items, total } = await this._asyncWithScopedSpinner(
            () => provider(parent, { page: pageNo, pageSize, search: this._search, levelIndex }),
            300
        );

        bucket.pages.set(pageNo, { items: items || [], total: total ?? bucket.total, done: items?.length < pageSize });
        if (total != null) bucket.total = total;
        return bucket.pages.get(pageNo);
    }

    async _fetchVirtualBatch(levelIndex, parent, bucket, append = true) {
        const lvl = this._getLevel(levelIndex);
        const pageSize = Math.max(1, lvl?.pageSize | 0 || 64);
        const provider = this._pickProvider(lvl);
        if (!append) {
            // Fresh load: everything keyed off the old sequence is invalid.
            bucket.pages.clear();
            bucket.virtualOffset = 0;
            bucket.nextSegment = 0;
        }
        const offset = bucket.virtualOffset;
        // The provider still sees the logical page number derived from the
        // offset — that is what a paging backend expects.
        const pageNo = Math.floor(offset / pageSize);

        const { items, total } = await this._asyncWithScopedSpinner(
            () => provider(parent, { page: pageNo, pageSize, search: this._search, levelIndex, offset }),
            300
        );

        // ...but the bucket is keyed monotonically, so segments can never
        // overwrite each other. Rendered placeholders carry this key in
        // `data-page` and look the segment back up by it.
        const segKey = bucket.nextSegment;
        bucket.nextSegment = segKey + 1;

        const seg = { items: items || [], total: total ?? bucket.total, done: (items?.length || 0) < pageSize, segKey };
        bucket.pages.set(segKey, seg);
        bucket.virtualOffset += seg.items.length;
        if (total != null) bucket.total = total;
        return seg;
    }

    _pickProvider(lvl) {
        if (this._search && typeof lvl?.search === "function") return (parent, ctx) => lvl.search(parent, ctx);
        return (parent, ctx) => lvl.getChildren(parent, ctx);
    }

    // ---- Scoped loader (Explorer-level) ---------------------------------
    _pendingLoads = 0;
    _loaderTimer = null;

    _getLoaderEl() {
        const root = document.getElementById(this.id);
        if (!root) return null;

        let el = root.querySelector(`#${this.id}-scoped-loader`);
        if (!el) {
            el = document.createElement("div");
            el.id = `${this.id}-scoped-loader`;
            el.style.cssText = [
                "position:absolute",
                "inset:0",
                "z-index:9999",
                "background-color:rgba(0,0,0,0.53)",
                "display:none",
            ].join(";");
            el.innerHTML = `
      <span class="absolute loading loading-spinner"
            style="top:50%;left:50%;width:62px;transform:translate(-50%,-50%)"></span>
      <div class="absolute"
           style="top: calc(50% + 120px); left: 50%; transform: translate(-50%, -50%); width: 450px; max-width: 85%;">
        <div id="${this.id}-loader-title" class="h3 text-center" style="display:none"></div>
        <div id="${this.id}-loader-desc" class="h4 text-center" style="display:none"></div>
      </div>
    `;
            root.appendChild(el);
        }
        return el;
    }

    _showScopedLoader({ title = "", description = "" } = {}) {
        this.loader.show(title, description);
    }

    _hideScopedLoader() {
        this.loader.hide();
    }

    _asyncWithScopedSpinner(fn, delayMs = 300, info = {}) {
        this._pendingLoads++;
        if (this._pendingLoads === 1) {
            this._loaderTimer = setTimeout(() => {
                this._showScopedLoader(info);
                this._loaderTimer = null;
            }, delayMs);
        }

        const finalize = () => {
            this._pendingLoads = Math.max(0, this._pendingLoads - 1);
            if (this._pendingLoads === 0) {
                if (this._loaderTimer) {
                    clearTimeout(this._loaderTimer);
                    this._loaderTimer = null;
                }
                this._hideScopedLoader();
            }
        };

        return Promise.resolve().then(fn).finally(finalize);
    }

    /* ---------- RENDERING ---------- */
    _renderHeader(levelIndex) {
        // A flat, single-level hierarchy has nowhere to navigate — the
        // "Root" breadcrumb is pure noise there, so render only the search.
        const isFlat = this._levelCount() <= 1 && !this._path.length;

        const cList = ul(
            li(
                a({
                        class: "link",
                        onclick: () => {
                            this._restoreAborted = true;
                            this._path = [];
                            this._viewState.clear();
                            this._loadAndRender(0, { replace: true }).then(() => this._emitStateChange());
                        }
                    },
                    span({ class: "ph-light ph-house" }),
                    span(" Root"))
            )
        );

        this._path.forEach((p, i) => {
            i = i + 1; // root is implicit 0
            const lvl = this._getLevel(p.levelIndex);
            const label = this._labelFor(lvl, p.item) || `Level ${lvl?.title || lvl?.id || i}`;
            const isLast = (i === this._path.length);
            const onclick = isLast ? undefined : () => {
                // Truncate path and render that level; remembered page for that level will be used
                this._restoreAborted = true;
                this._path = this._path.slice(0, i);
                this._loadAndRender(i, { replace: true }).then(() => this._emitStateChange());
            };
            cList.appendChild(li(a({ class: "link", onclick }, label)));
        });

        const rootBtn = div({ class: "breadcrumbs text-sm px-2 pt-1" }, cList);

        // Per-level `searchHint` (e.g. "Name, acc:<number> or date") wins over
        // the generic localized placeholder.
        const activeLevelIndex = this._currentLevelIndex();
        const activeLevel = this._getLevel(activeLevelIndex);
        const searchBox = div({ class: isFlat ? "px-2 py-1" : "px-2 pb-1" },
            input({
                class: "input input-sm input-bordered w-full",
                placeholder: activeLevel?.searchHint || $.t('common.search'),
                value: this._search,
                oninput: this._debouncedSearch(() => {
                    const val = cSearch.value.trim();
                    this._restoreAborted = true;
                    this._search = val;
                    // Reset cache for current level + parent; also forget remembered page (search changes the dataset)
                    const levelIndex = this._currentLevelIndex();
                    const parent = levelIndex > 0 ? this._path[levelIndex - 1]?.item : null;
                    const key = this._bucketKey(levelIndex, parent, this._search);
                    this._store.delete(key);
                    const lvl = this._getLevel(levelIndex);
                    this._viewState.delete(this._viewKey(levelIndex, lvl)); // ⬅️ forget page on new search
                    this._loadAndRender(levelIndex, { replace: true }).then(() => this._emitStateChange());
                }, 250)
            })
        );
        const cSearch = searchBox.firstChild;

        return div({ class: "border-b border-base-300/70" }, isFlat ? null : rootBtn, searchBox);
    }

    _labelFor(lvl, item) {
        if (!lvl) return "";
        if (typeof lvl.labelOf === "function") return lvl.labelOf(item);
        return item?.name || item?.label || item?.PatientName || item?.StudyDescription || item?.SeriesDescription || String(item?.id ?? "");
    }

    _renderLevelView(levelIndex, parent, bucket) {
        const lvl = this._getLevel(levelIndex);
        if (!lvl) {
            return div({ class: "p-4 text-base-content/60" }, "No further levels.");
        }

        if (this._io) { try { this._io.disconnect(); } catch {} this._io = null; }
        if (this._ioMore) { try { this._ioMore.disconnect(); } catch {} this._ioMore = null; }

        const header = this._renderHeader(levelIndex);
        // `scrollbar-gutter: stable` reserves the scrollbar track so content
        // height changes cannot toggle the scrollbar, which would otherwise
        // resize the viewport and feed back into the windowing observers.
        const listWrap = div({ class: "flex-1 overflow-auto", style: "scrollbar-gutter: stable;" });

        if (lvl.mode === "virtual") {
            // The scroller, not the <ul> — see _renderVirtualList.
            listWrap.appendChild(this._renderVirtualList(levelIndex, parent, bucket, listWrap));
        } else {
            listWrap.appendChild(this._renderPagedList(levelIndex, parent, bucket));
        }

        return div({ class: this.classMap.base, id: this.id }, header, listWrap, this.loader.create());
    }

    _renderPagedList(levelIndex, parent, bucket) {
        const lvl = this._getLevel(levelIndex);
        const pageSize = Math.max(1, lvl?.pageSize | 0 || 20);

        // Source of truth: bucket.currentPage
        let currentPage = Number.isFinite(bucket.currentPage) ? bucket.currentPage : 0;
        if (!bucket.pages.has(currentPage)) currentPage = 0; // safety

        const seg = bucket.pages.get(currentPage) || { items: [] };
        // A COPY, never the bucket's own array. `swapToPage` below splices the
        // new page's contents into this array to keep the reference stable for
        // the windowing closures — aliasing `seg.items` therefore overwrote the
        // CACHED page with the one being switched to, so paging 0→1→0 found
        // page 0 in the cache, skipped the refetch, and re-rendered page 1.
        // `itemAtAbsIndex` / slide prev-next read the same buckets and inherited it.
        const items = (seg.items || []).slice();

        // --- UI scaffold (keeps your look & feel) ---
        const host = div({ class: "flex flex-col h-full" });

        // Scrollable viewport. `scrollbar-gutter: stable` keeps the scrollbar
        // track reserved so a content-height change cannot make the scrollbar
        // appear/disappear and resize the viewport under the windowing maths.
        const viewport = div({ class: "flex-1 overflow-auto", style: "scrollbar-gutter: stable;" });

        // UL we’ll reuse; we’ll put spacers + visible items into it
        const listEl = ul({ class: "menu p-1 gap-1" });

        // footer controls (prev/next) – unchanged behavior
        const pageState = van.state((currentPage || 0) + 1);

        // Calculate total pages if known
        const total = bucket.total;
        const totalPages = total ? Math.max(1, Math.ceil(total / pageSize)) : undefined;
        const totalState = van.state(totalPages);

        // Declared after `totalPages` so a single-page listing starts with the
        // next button already disabled rather than enabled-then-corrected.
        const canNextState = van.state(totalPages == null || currentPage < totalPages - 1);

        // ------- Windowed rendering for paged lists -------
        // Config
        // ------- Windowed rendering (cached) -------
        const OVERSCAN = 8;
        let rowH = 0;
        let start = 0, end = -1;
        const topSpacer = div({ style: "height:0px" });
        const bottomSpacer = div({ style: "height:0px" });
        const renderedItems = new Map(); // index -> li Node

        const renderWindow = (force = false) => {
            const vpH = viewport.clientHeight || 0;
            const scrollTop = viewport.scrollTop || 0;
            if (!rowH) return;

            const maxIdx = items.length;
            const visStart = Math.max(0, Math.floor(scrollTop / rowH));
            const visEnd = Math.min(maxIdx, Math.ceil((scrollTop + vpH) / rowH));
            const nextStart = Math.max(0, visStart - OVERSCAN);
            const nextEnd = Math.min(maxIdx, visEnd + OVERSCAN);
            if (!force && nextStart === start && nextEnd === end) return;

            start = nextStart;
            end = nextEnd;

            // Update spacer heights
            topSpacer.style.height = `${start * rowH}px`;
            bottomSpacer.style.height = `${(maxIdx - end) * rowH}px`;

            // Keep order: topSpacer, [items in window], bottomSpacer
            // Remove old nodes not in range
            for (const [i, node] of renderedItems) {
                if (i < start - OVERSCAN * 2 || i > end + OVERSCAN * 2) {
                    renderedItems.delete(i);
                    node.remove();
                }
            }

            // Ensure in-range nodes exist in correct order
            const frag = document.createDocumentFragment();
            for (let i = start; i < end; i++) {
                let node = renderedItems.get(i);
                if (!node) {
                    node = this._renderItemLi(levelIndex, items[i], i);
                    renderedItems.set(i, node);
                }
                frag.appendChild(node);
            }

            // Rebuild listEl children (cheap because we re-append spacers + fragment)
            listEl.replaceChildren(topSpacer, frag, bottomSpacer);
        };

        // Swap the visible list to the current page's segment: the cached
        // per-index nodes must be dropped, otherwise renderWindow re-appends
        // the previous page's rows.
        const swapToPage = () => {
            const seg = bucket.pages.get(currentPage) || { items: [] };
            while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
            renderedItems.clear();
            items.splice(0, items.length, ...(seg.items || [])); // mutate array contents to keep references stable
            rowH = 0; start = 0; end = -1;
            // re-probe row height for the new page
            const probeRow = this._renderItemLi(levelIndex, items[0] ?? {}, 0);
            probeRow.style.visibility = "hidden";
            probeRow.style.position = "absolute";
            const probeWrap = div({ class: "absolute opacity-0 pointer-events-none" }, probeRow);
            viewport.appendChild(probeWrap);
            queueMicrotask(() => {
                rowH = Math.max(1, probeRow.getBoundingClientRect().height || 40);
                try { viewport.removeChild(probeWrap); } catch {}
                listEl.appendChild(topSpacer);
                listEl.appendChild(bottomSpacer);
                viewport.scrollTop = 0; // reset scroll for new page
                pageState.val = (currentPage + 1);
                renderWindow(true);
            });
        };

        // Initial draw: we need a measured row height
        // Render one probe row off-DOM to measure natural height
        const probeRow = this._renderItemLi(levelIndex, items[0] ?? {}, 0);
        probeRow.style.visibility = "hidden";
        probeRow.style.position = "absolute";
        // mount probe temporarily to measure
        const probeWrap = div({ class: "absolute opacity-0 pointer-events-none" }, probeRow);
        viewport.appendChild(probeWrap);

        // After browser paints, measure and kick first window render
        queueMicrotask(() => {
            rowH = Math.max(1, probeRow.getBoundingClientRect().height || 40);
            // clean probe
            try { viewport.removeChild(probeWrap); } catch {}

            // initialize spacers + first window
            listEl.appendChild(topSpacer);
            listEl.appendChild(bottomSpacer);

            // ensure viewport height is known
            renderWindow(true);
        });

        // Scroll handler to update the window
        const onScroll = () => renderWindow(false);
        viewport.addEventListener("scroll", onScroll);

        // Re-compute on resize as well.
        //
        // `renderWindow` is the ONLY writer of the spacer heights. This observer
        // used to size them itself from the *visible* range while renderWindow
        // sized them from the *overscanned* range — the two disagree by up to
        // 16 * rowH of content height, which toggles the scrollbar, which
        // resizes the viewport, which re-fires this observer: a per-frame
        // oscillation of a few pixels, worst at the bottom where the bottom
        // spacer reaches zero. renderWindow(false) never corrected it either,
        // because start/end were unchanged so it early-returned.
        let lastW = 0, lastH = 0;
        const ro = new ResizeObserver(() => {
            const w = viewport.clientWidth, h = viewport.clientHeight;
            // Ignore callbacks caused by our own spacer writes; react only to a
            // genuine change of the viewport box.
            if (w === lastW && h === lastH) return;
            lastW = w; lastH = h;
            requestAnimationFrame(() => {
                if (!rowH || !document.body.contains(viewport)) return;
                renderWindow(true);
            });
        });
        ro.observe(viewport);

        // Navigation controls
        const controls = div({ class: "flex items-center justify-between p-2 border-t border-base-300/70 gap-2" },
            div(
                { class: "join" },
                this._btn("ph-caret-left", async () => {
                    if (currentPage <= 0) return;
                    this._restoreAborted = true;
                    currentPage -= 1;
                    if (!bucket.pages.has(currentPage)) await this._fetchPage(levelIndex, parent, bucket, currentPage);
                    bucket.currentPage = currentPage;
                    this._viewState.set(this._viewKey(levelIndex, lvl), { pageNo: currentPage });
                    canNextState.val = true;
                    swapToPage();
                    this._emitStateChange();
                }),
                span({ class: "join-item btn btn-sm pointer-events-none" }, () => `Page ${pageState.val}${totalState.val != null ? ` / ${totalState.val}` : " / ?"}`),
                this._btn("ph-caret-right", async () => {
                    // `currentPage` is 0-based and `totalPages` is a COUNT, so the
                    // last valid page is `totalPages - 1`. Without the -1 the user
                    // could always step one page past the end: a wasted provider
                    // round trip whose empty result was then cached in the bucket,
                    // so the bogus page stuck around as a "known" one.
                    const lastPage = totalState.val != null ? totalState.val - 1 : undefined;
                    if (lastPage != null && currentPage >= lastPage) return;
                    this._restoreAborted = true;
                    currentPage += 1;
                    if (!bucket.pages.has(currentPage)) {
                        const segN = await this._fetchPage(levelIndex, parent, bucket, currentPage);
                        if (bucket.total != null && totalState.val == null) {
                            totalState.val = Math.max(1, Math.ceil(bucket.total / pageSize));
                        }
                        if (!segN.items.length) {
                            // Don't keep the empty page: it would answer
                            // `bucket.pages.has()` forever and suppress a refetch
                            // once the provider does have those items.
                            bucket.pages.delete(currentPage);
                            currentPage -= 1;
                            canNextState.val = false;
                            return;
                        }
                    }
                    bucket.currentPage = currentPage;
                    this._viewState.set(this._viewKey(levelIndex, lvl), { pageNo: currentPage });
                    canNextState.val = lastPage == null || currentPage < lastPage;
                    swapToPage();
                    this._emitStateChange();
                }, canNextState)
            ),
            div({ class: "text-xs opacity-70" }, () => total != null ? `${total} items` : "")
        );

        // Mount subtree
        viewport.appendChild(listEl);
        host.append(viewport, controls);

        // Cleanup when this view is discarded
        // (your framework likely recreates nodes on re-render; safeguard observers)
        const disconnect = () => {
            viewport.removeEventListener("scroll", onScroll);
            try { ro.disconnect(); } catch {}
        };
        // Attach a simple mutation-aware hook
        new MutationObserver((muts, obs) => {
            const attached = document.body.contains(viewport);
            if (!attached) { disconnect(); obs.disconnect(); }
        }).observe(host, { childList: true, subtree: true });

        return host;
    }


    /**
     * @param {HTMLElement} [scrollRoot] the element that actually scrolls.
     *   Both observers below MUST be rooted on it. Rooting them on `listEl`
     *   (the `<ul>`) is not a near-miss: a `<ul>` does not scroll, it grows, so
     *   every child is permanently intersecting its own parent's box. The
     *   sentinel then fires the moment it is observed and keeps firing, which
     *   pulls every page back-to-back on open regardless of scroll position —
     *   each with a spinner, so the list appears to blink.
     */
    _renderVirtualList(levelIndex, parent, bucket, scrollRoot = null) {
        const lvl = this._getLevel(levelIndex);
        const listEl = ul({ class: "menu p-1 gap-1" });
        const root = scrollRoot || null;   // null => browser viewport, still bounded

        // Virtual mode: no remembering required
        this._io = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const target = entry.target;
                    const itemIdx = +target.getAttribute("data-idx");
                    const pageNo = +target.getAttribute("data-page");
                    const seg = bucket.pages.get(pageNo);
                    const item = seg?.items[itemIdx];
                    if (!item) return;

                    const node = this._renderItemLi(levelIndex, item, itemIdx, { heavy: true, pageNo });
                    target.replaceWith(node);
                    this._io.unobserve(target);
                }
            });
        }, { root, rootMargin: "256px 0px", threshold: 0.01 });

        const segDone = () => {
            const pages = Array.from(bucket.pages.keys());
            if (!pages.length) return false;
            const last = bucket.pages.get(Math.max(...pages));
            return !!last?.done;
        };

        const renderSegments = () => {
            // A previous sentinel observer would otherwise keep firing against
            // detached DOM, one leaked instance per re-render.
            if (this._ioMore) { try { this._ioMore.disconnect(); } catch {} this._ioMore = null; }

            listEl.innerHTML = "";
            const pages = Array.from(bucket.pages.keys()).sort((a, b) => a - b);
            pages.forEach(pNo => {
                const seg = bucket.pages.get(pNo);
                seg.items.forEach((item, idx) => {
                    const ph = this._renderItemPlaceholder(levelIndex, item, idx, pNo);
                    listEl.appendChild(ph);
                    this._io.observe(ph);
                });
            });

            const sentinel = div({ class: "w-full text-center text-xs opacity-60 p-2" }, segDone() ? "— end —" : "Loading…");
            sentinel.setAttribute("data-sentinel", "1");
            listEl.appendChild(sentinel);

            const syncSentinel = () => { sentinel.textContent = segDone() ? "— end —" : "Loading…"; };

            this._ioMore = new IntersectionObserver(async entries => {
                if (!entries.some(e => e.isIntersecting)) return;
                if (segDone()) { syncSentinel(); return; }
                // The callback is async, so without a latch a second firing
                // reads the same virtualOffset and issues a duplicate request.
                if (bucket.loadingMore) return;
                bucket.loadingMore = true;
                try {
                    const seg = await this._fetchVirtualBatch(levelIndex, parent, bucket, true);
                    (seg?.items || []).forEach((item, idx) => {
                        // `seg.segKey` — never recompute the key from the offset;
                        // the placeholder must look up the same segment later.
                        const ph = this._renderItemPlaceholder(levelIndex, item, idx, seg.segKey);
                        sentinel.before(ph);
                        this._io.observe(ph);
                    });
                } catch (e) {
                    // Providers can throw; leaving the latch set would freeze paging.
                    console.error("Explorer: failed to load next batch", e);
                } finally {
                    bucket.loadingMore = false;
                    // Also runs on the empty-batch path, which used to return
                    // early and strand the sentinel on "Loading…" forever
                    // whenever the total was an exact multiple of pageSize.
                    syncSentinel();
                }
            }, { root, rootMargin: "512px 0px", threshold: 0.01 });
            this._ioMore.observe(sentinel);
        };

        renderSegments();
        return listEl;
    }

    /**
     * Replace the level configuration.
     *
     * With `keepState` (default) an identically-shaped configuration keeps the
     * navigation state: consumers re-run this on unrelated events (a slide
     * opening, a viewer closing) and wiping the path there threw the user back
     * to the root of the browser several times per session.
     *
     * @param {Object} opts
     * @param {Array<UI.Explorer.Level>|UI.Explorer.Level} opts.levels
     * @param {string} [opts.search]
     * @param {string} [opts.configId] identity of the config author, folded into the fingerprint
     * @param {boolean} [opts.keepState=true]
     */
    async reconfigure({ levels, search = "", configId = undefined, keepState = true } = {}) {
        if (Array.isArray(levels)) {
            this.levels = levels.slice();
        } else if (typeof levels === "object" && levels !== null) {
            this.levels = {
                isDynamic: true,
                level: levels,
            };
        } else {
            this.levels = [];
        }
        if (configId !== undefined) this._configId = configId;

        const newFingerprint = this._fingerprintOf(this.levels, this._configId);
        const sameShape = newFingerprint === this._fingerprint;
        this._fingerprint = newFingerprint;

        if (keepState && sameShape && this._booted) {
            // Same hierarchy: the path items remain valid, only the fetched
            // data may be stale.
            this._store.clear();
            return this.reload();
        }

        this._search = (typeof search === "string" ? search : "");
        this._path = [];
        this._store.clear();
        this._viewState.clear();
        return this._bootRestore();
    }

    /**
     * Re-render the level currently displayed.
     * @param {Object} [opts]
     * @param {boolean} [opts.refetch=false] drop the cached data of that level first
     */
    async reload({ refetch = false } = {}) {
        const levelIndex = this._currentLevelIndex();
        if (refetch) {
            const parent = levelIndex > 0 ? this._path[levelIndex - 1]?.item : null;
            this._store.delete(this._bucketKey(levelIndex, parent, this._search));
        }
        // keep _viewState as-is so the remembered page still applies
        return this._loadAndRender(levelIndex, { replace: true });
    }

    /** Soft refresh current level (same config), keeping path */
    refresh() {
        return this.reload({ refetch: true });
    }

    /* ---------- NAVIGATION STATE (serialize / restore / persist) ---------- */

    /**
     * Identity of a level configuration. Two configurations with the same
     * fingerprint describe the same hierarchy, so a state captured under one
     * can be restored under the other.
     * @private
     */
    _fingerprintOf(levels, configId) {
        const shape = Array.isArray(levels)
            ? levels.map(l => l?.id ?? "?").join(">")
            : (levels?.isDynamic ? `DYN:${levels.level?.id ?? "?"}` : "");
        return `${configId ?? ""}|${shape}`;
    }

    /**
     * Snapshot the navigation state in a reload-safe form: items are reduced to
     * their level key, since the item objects themselves are provider-specific
     * and generally not serializable.
     * @returns {UI.Explorer.State|null}
     */
    getState() {
        const path = [];
        for (const node of this._path) {
            const lvl = this._getLevel(node.levelIndex);
            const idx = this._lastIndexMaps[node.levelIndex]?.get(node.item);
            const parent = node.levelIndex > 0 ? this._path[node.levelIndex - 1]?.item : null;
            const key = this._keyOf(lvl, node.item, Number.isFinite(idx) ? idx : 0, parent);
            if (key == null) break;
            path.push({ levelId: lvl?.id ?? String(node.levelIndex), key: String(key) });
        }

        const pages = [];
        for (let i = 0; i <= path.length; i++) {
            const lvl = this._getLevel(i);
            if (!lvl) break;
            pages.push(Math.max(0, this._viewState.get(this._viewKey(i, lvl))?.pageNo | 0));
        }
        // The displayed level does not write _viewState until the user leaves
        // it, so read its live page off the bucket.
        const shown = this._currentLevelIndex();
        if (shown < pages.length) {
            const parent = shown > 0 ? this._path[shown - 1]?.item : null;
            const bucket = this._store.get(this._bucketKey(shown, parent, this._search));
            if (bucket && Number.isFinite(bucket.currentPage)) pages[shown] = Math.max(0, bucket.currentPage | 0);
        }

        return { v: 1, fp: this._fingerprint, path, pages, search: this._search || "" };
    }

    /**
     * Restore a state produced by {@link getState}.
     *
     * Ancestors are resolved through the per-level {@link UI.Explorer.Level.resolveByKey}
     * hook — a level without that hook terminates the restore at its depth
     * (page and search of the reached level still apply). Any failure degrades
     * to the deepest prefix that could be resolved; nothing is reported to the
     * user.
     *
     * @param {UI.Explorer.State|null} state
     * @returns {Promise<number>} the depth actually reached
     */
    async restoreState(state) {
        const wanted = Array.isArray(state?.path) ? state.path : null;
        if (!state || state.v !== 1 || state.fp !== this._fingerprint || !wanted) {
            await this._loadAndRender(0, { replace: true });
            return 0;
        }

        this._restoring = true;
        this._restoreAborted = false;
        this._path = [];
        this._search = "";
        try {
            for (let i = 0; i < wanted.length; i++) {
                if (this._restoreAborted) return this._path.length;
                const lvl = this._getLevel(i);
                if (typeof lvl?.resolveByKey !== "function") {
                    console.debug("[Explorer] level has no resolveByKey, stopping restore at depth", i, lvl?.id);
                    break;
                }
                const parent = i > 0 ? this._path[i - 1]?.item : null;
                let item = null;
                try {
                    item = await lvl.resolveByKey(parent, wanted[i].key, { levelIndex: i });
                } catch (e) {
                    console.debug("[Explorer] resolveByKey failed, stopping restore at depth", i, e);
                    break;
                }
                if (!item) {
                    console.debug("[Explorer] key not resolvable, stopping restore at depth", i, wanted[i].key);
                    break;
                }
                this._path.push({ levelIndex: i, levelId: lvl.id, item });
            }

            if (this._restoreAborted) return this._path.length;

            const pages = Array.isArray(state.pages) ? state.pages : [];
            for (let i = 0; i <= this._path.length; i++) {
                const lvl = this._getLevel(i);
                if (!lvl) break;
                const pageNo = Math.max(0, pages[i] | 0);
                if (pageNo > 0) this._viewState.set(this._viewKey(i, lvl), { pageNo });
            }
            // The search term belongs to the level it was typed in, so it only
            // applies when the full path was restored.
            if (this._path.length === wanted.length) this._search = state.search || "";

            await this._loadAndRender(this._currentLevelIndex(), { replace: true });
        } finally {
            this._restoring = false;
        }

        // A path that no longer resolves must not cost those lookups on every
        // boot — persist what was actually reached.
        this._emitStateChange();
        return this._path.length;
    }

    /**
     * Restore the persisted (or externally supplied) state, falling back to the
     * root listing.
     * @private
     */
    async _bootRestore() {
        this._booted = true;
        const state = this._initialState || this._loadPersistedState();
        this._initialState = null;
        if (!state) return this._loadAndRender(0, { replace: true });
        try {
            return await this.restoreState(state);
        } catch (e) {
            console.debug("[Explorer] state restore failed", e);
            return this._loadAndRender(0, { replace: true });
        }
    }

    /** @private */
    _emitStateChange() {
        if (this._restoring) return;
        const state = this.getState();
        if (!state) return;
        this._persistState(state);
        this.onStateChange?.(state);
    }

    /**
     * Persist under the current fingerprint. Several fingerprints are kept so
     * switching between browser configurations (and back) restores each one.
     * @private
     */
    _persistState(state) {
        if (!this._stateCacheKey) return;
        try {
            const record = this._readRecord();
            const entries = record.entries.filter(e => e?.fp !== state.fp);
            entries.unshift(state);
            APPLICATION_CONTEXT.AppCache.set(this._stateCacheKey,
                JSON.stringify({ v: 1, entries: entries.slice(0, Explorer.STATE_HISTORY_SIZE) }));
        } catch (e) {
            console.debug("[Explorer] state persist failed", e);
        }
    }

    /** @private */
    _loadPersistedState() {
        if (!this._stateCacheKey) return null;
        return this._readRecord().entries.find(e => e?.fp === this._fingerprint) || null;
    }

    /** @private */
    _readRecord() {
        try {
            // AppCache is a string store: values are written JSON-encoded.
            const raw = APPLICATION_CONTEXT.AppCache.get(this._stateCacheKey, "");
            const parsed = raw ? JSON.parse(raw) : null;
            if (parsed?.v === 1 && Array.isArray(parsed.entries)) return parsed;
        } catch (e) {
            console.debug("[Explorer] discarding unreadable persisted state", e);
        }
        return { v: 1, entries: [] };
    }

    /**
     * Describe the level currently shown to the user (the deepest node of the
     * navigation path, clamped to the last configured level). Used by consumers
     * that navigate *within* the displayed directory (e.g. slide prev/next).
     * @returns {{levelIndex:number, level:(UI.Explorer.Level|null), parent:*, bucket:object|null, pageSize:number, total:(number|undefined), mode:string}}
     */
    getCurrentLevelContext() {
        const levelIndex = this._currentLevelIndex();
        const level = this._getLevel(levelIndex);
        const parent = levelIndex > 0 ? this._path[levelIndex - 1]?.item : null;
        const key = this._bucketKey(levelIndex, parent, this._search);
        const bucket = this._store.get(key) || null;
        const mode = level?.mode || "page";
        const pageSize = Math.max(1, level?.pageSize | 0 || (mode === "virtual" ? 64 : 20));
        return { levelIndex, level, parent, bucket, pageSize, total: bucket?.total, mode };
    }

    /**
     * All items currently loaded for the displayed level, each tagged with its
     * absolute index. Paged levels may hold sparse pages, so the absolute index
     * is `pageNo*pageSize + local`; virtual levels are contiguous, so encounter
     * order is used. Consumers locate a known item here, then step to a neighbor
     * via {@link itemAtAbsIndex}.
     * @returns {Array<{item:*, absIndex:number}>}
     */
    getLoadedItemsWithAbsIndex() {
        const { bucket, pageSize, mode } = this.getCurrentLevelContext();
        const out = [];
        if (!bucket) return out;
        const pageNos = Array.from(bucket.pages.keys()).sort((a, b) => a - b);
        let running = 0;
        for (const p of pageNos) {
            const seg = bucket.pages.get(p);
            (seg?.items || []).forEach((item, local) => {
                out.push({ item, absIndex: mode === "virtual" ? running : (p * pageSize + local) });
                running++;
            });
        }
        return out;
    }

    _bucketVirtualDone(bucket) {
        const pages = Array.from(bucket.pages.keys());
        if (!pages.length) return false;
        return !!bucket.pages.get(Math.max(...pages))?.done;
    }

    /**
     * Resolve the item at an absolute index in the displayed level, fetching the
     * page/batch that contains it if it is not loaded yet. Returns null when the
     * index is out of range (or unreachable).
     * @param {number} absIndex
     * @returns {Promise<*|null>}
     */
    async itemAtAbsIndex(absIndex) {
        if (!Number.isInteger(absIndex) || absIndex < 0) return null;
        const { levelIndex, parent, bucket, pageSize, mode } = this.getCurrentLevelContext();
        if (!bucket) return null;

        if (mode === "virtual") {
            let loaded = this.getLoadedItemsWithAbsIndex();
            let guard = 0;
            while (absIndex >= loaded.length && !this._bucketVirtualDone(bucket) && guard++ < 1000) {
                await this._fetchVirtualBatch(levelIndex, parent, bucket, true);
                loaded = this.getLoadedItemsWithAbsIndex();
            }
            return loaded[absIndex]?.item ?? null;
        }

        const pageNo = Math.floor(absIndex / pageSize);
        const local = absIndex % pageSize;
        if (!bucket.pages.has(pageNo)) {
            await this._fetchPage(levelIndex, parent, bucket, pageNo);
        }
        return bucket.pages.get(pageNo)?.items?.[local] ?? null;
    }

    _renderItemPlaceholder(levelIndex, item, idx, pageNo) {
        const lvl = this._getLevel(levelIndex);
        const key = this._keyOf(lvl, item, idx, levelIndex>0?this._path[levelIndex-1]?.item:null);
        const ph = li({
            class: "skeleton h-10 rounded-md",
            "data-key": key,
            "data-idx": String(idx),
            "data-page": String(pageNo),
        });
        return ph;
    }

    _renderItemLi(levelIndex, item, idx, { heavy = false, pageNo = 0 } = {}) {
        const lvl = this._getLevel(levelIndex);
        const idxMap = this._lastIndexMaps[levelIndex] || (this._lastIndexMaps[levelIndex] = new WeakMap());
        try { idxMap.set(item, idx); } catch {}
        const key = this._keyOf(lvl, item, idx, levelIndex>0?this._path[levelIndex-1]?.item:null);
        const helpers = {
            open: () => this._navigate(levelIndex, item, idx),
            levelIndex,
            itemIndex: idx,
            path: this._path.slice(),
        };
        const contentComp = (heavy && typeof lvl.renderHeavy === "function") ? lvl.renderHeavy(item, helpers) : (lvl.renderItem?.(item, helpers) ?? span(String(this._labelFor(lvl, item))));
        const node = UI.BaseComponent.parseDomLikeItem(contentComp);

        const row = li({
            class: [
                "flex items-center gap-2 rounded-md px-2 py-2",
                "hover:bg-base-300 focus:bg-base-300",
            ].join(" ")
        }, node);

        row.onclick = () => {
            const navigate = this._canOpen(levelIndex, lvl, item, idx);
            if (typeof lvl?.onClick === "function") lvl.onClick(item, idx);
            if (navigate) this._navigate(levelIndex, item, idx);
        }
        row.setAttribute("data-key", key);
        row.setAttribute("data-idx", String(idx));
        row.setAttribute("data-page", String(pageNo));
        return row;
    }

    /**
     * @param {string} iconName
     * @param {Function} onClick
     * @param {import("vanjs-core").State<boolean>} [enabled] reactive disabled
     *        state; omit for an always-enabled button.
     */
    _btn(iconName, onClick, enabled) {
        const isPh = String(iconName ?? '').trim().startsWith('ph-');
        const cls = enabled
            ? () => `join-item btn btn-sm${enabled.val ? "" : " btn-disabled"}`
            : "join-item btn btn-sm";
        const b = div({
            class: cls,
            onclick: (e) => { if (enabled && !enabled.val) return; return onClick(e); },
        }, span({ class: `${isPh ? 'ph-light' : 'fa-auto'} ${iconName}` }));
        return b;
    }

    create() {
        if (!this._debouncedSearchWrapped) this._debouncedSearchWrapped = this._makeDebounce((fn) => fn(), 250);
        if (!document.getElementById(this.id)) {
            // A `reconfigure` may land before this fires (the levels usually
            // arrive from a plugin); it boots the state itself, and restoring
            // twice would repeat every resolveByKey lookup.
            setTimeout(() => { if (!this._booted) this._bootRestore(); }, 0);
        }
        return div({ id: this.id, class: this.classMap.base, ...this.extraProperties });
    }

    _debouncedSearch(fn, delay=250) {
        let t=null; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), delay); };
    }
}

/* --------------------------
   Example usage (DICOM)
   --------------------------

// Assume you have backend API helpers that return promises
async function fetchPatients({ page, pageSize, search }) {
  const res = await DICOM.queryPatients({ page, pageSize, search }); // { items, total }
  return res;
}
async function fetchStudies(patient, { page, pageSize, search }) {
  const res = await DICOM.queryStudies({ patientId: patient.id, page, pageSize, search });
  return res;
}
async function fetchImages(study, { page, pageSize }) {
  // returns lots of images but streamed in pages/batches
  const res = await DICOM.queryImages({ studyId: study.id, page, pageSize });
  return res; // { items, total? }
}

const list = new UI.Explorer({
  id: "dicom-browser",
  levels: [
    {
      id: "patients",
      title: "Patients",
      mode: "page",
      pageSize: 100,
      getChildren: (parent, ctx) => fetchPatients(ctx),
      renderItem: (p, { open }) => div({ class: "flex items-center gap-2" },
        span({ class: "ph-light ph-user" }),
        span(p.PatientName || p.name || p.id)
      ),
      canOpen: () => true,
    },
    {
      id: "studies",
      title: "Studies",
      mode: "page",
      pageSize: 50,
      getChildren: (patient, ctx) => fetchStudies(patient, ctx),
      renderItem: (s) => div({ class: "flex items-center gap-2" },
        span({ class: "ph-light ph-flask" }),
        span(s.StudyDescription || s.id)
      ),
      canOpen: () => true,
    },
    {
      id: "images",
      title: "Images",
      mode: "virtual",         // infinite windowed list with lazy heavy rendering
      pageSize: 64,             // fetch in batches of 64
      getChildren: (study, ctx) => fetchImages(study, ctx),
      renderItem: (img) => div({ class: "flex items-center gap-2" },
        span({ class: "ph-light ph-image" }),
        span(img.SOPInstanceUID?.slice?.(-8) || img.id)
      ),
      // heavy rendering (thumbnails/metadata) will be created only when visible
      renderHeavy: (img) => {
        const wrap = div({ class: "flex items-center gap-2" });
        const thumb = div({ class: "w-12 h-8 rounded bg-base-300" });
        // kick off async thumbnail render (pseudo):
        setTimeout(async () => {
          const url = await DICOM.thumbnail(img);
          const imgEl = document.createElement("img");
          imgEl.className = "w-12 h-8 object-cover rounded";
          imgEl.src = url; thumb.replaceWith(imgEl);
        }, 0);
        wrap.appendChild(thumb);
        wrap.appendChild(span(img.SOPInstanceUID?.slice?.(-8) || img.id));
        return wrap;
      },
      canOpen: () => false,
    }
  ]
});

// list.attachTo(document.getElementById("somewhere"));
*/