import van from "../../vanjs.mjs";
import {BaseComponent} from "../baseComponent.mjs";

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
            "overflow-hidden"
        ].join(" ");

        // Data/config
        this.levels = Array.isArray(opts.levels) ? opts.levels.slice() : [];
        if (!this.levels.length) {
            console.warn("Explorer created with no levels.");
        }

        this.onPathChange = typeof opts.onPathChange === "function" ? opts.onPathChange : null;

        // Internal state
        this._path = []; // [{ levelIndex, levelId, item }]
        this._search = ""; // current search string (applies to current level)

        // Cache per level+parentKey+search => { pages: Map<number,{items,total,done}>, virtualOffset }
        this._store = new Map();

        // IO for heavy/lazy item rendering
        this._io = null;

        // bind
        this._navigate = this._navigate.bind(this);
        this._loadAndRender = this._loadAndRender.bind(this);
        this._renderLevelView = this._renderLevelView.bind(this);
        this._debouncedSearch = this._debouncedSearch.bind(this);
    }

    /**
     * Get item by index from the current position
     * @param index
     * @return {*}
     */
    getItem(index) {
        return this._path[this._path.length - 1]?.item?.items?.[index];
    }

    /** Public: reset the browser to root */
    reset() {
        this._path = [];
        this._search = "";
        this._store.clear();
        this._loadAndRender(0, { replace: true });
    }

    /** Public: jump to a concrete path of items (pre-fetched) */
    setPath(itemsPerLevel /* array of items or null */) {
        this._path = [];
        itemsPerLevel.forEach((item, idx) => {
            if (idx < this.levels.length && item) {
                this._path.push({ levelIndex: idx, levelId: this.levels[idx].id, item });
            }
        });
        this._loadAndRender(this._path.length, { replace: true });
    }

    /** Key used for cache bucket */
    _bucketKey(levelIndex, parentItem, search) {
        const lvl = this.levels[levelIndex];
        const parentKey = levelIndex === 0 ? "ROOT" : this._keyOf(this.levels[levelIndex - 1], parentItem, 0, null);
        return `${lvl?.id || levelIndex}::${parentKey}::${search || ""}`;
    }

    _ensureBucket(levelIndex, parentItem, search) {
        const k = this._bucketKey(levelIndex, parentItem, search);
        let b = this._store.get(k);
        if (!b) {
            b = { pages: new Map(), total: undefined, virtualOffset: 0, mode: this.levels[levelIndex]?.mode || "page" };
            this._store.set(k, b);
        }
        return b;
    }

    _keyOf(lvl, item, index, parent) {
        if (lvl?.keyOf) return String(lvl.keyOf(item, index, parent));
        return item?.id != null ? String(item.id) : String(index);
    }

    _canOpen(lvl, item, idx) {
        if (typeof lvl?.canOpen === "function") return !!lvl.canOpen(item);
        // default: can open if not last level
        return this.levels.indexOf(lvl) < this.levels.length - 1;
    }

    /** Debounce helper without external libs */
    _makeDebounce(fn, delay = 250) {
        let t = null;
        return (...args) => {
            if (t) clearTimeout(t);
            t = setTimeout(() => fn(...args), delay);
        };
    }

    /** Navigate: open item at levelIndex and move to next level */
    async _navigate(levelIndex, item) {
        const lvl = this.levels[levelIndex];
        if (!lvl) return;
        this._path = this._path.filter(p => p.levelIndex < levelIndex);
        this._path.push({ levelIndex, levelId: lvl.id, item });
        await this._loadAndRender(levelIndex + 1, { replace: true });
        this.onPathChange?.(this._path.slice());
    }

    /** Load data for level and render the component */
    async _loadAndRender(levelIndex, { replace = false } = {}) {
        // levelIndex points to the level to show. parent is previous item
        const parent = levelIndex > 0 ? this._path[levelIndex - 1]?.item : null;
        const lvl = this.levels[levelIndex];
        const host = document.getElementById(this.id);
        if (!host) return;

        const bucket = this._ensureBucket(levelIndex, parent, this._search);
        if (!bucket._init) {
            bucket._init = true;
            if (lvl?.mode === "virtual") {
                await this._fetchVirtualBatch(levelIndex, parent, bucket, /*append*/ true);
            } else {
                await this._fetchPage(levelIndex, parent, bucket, 0);
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
        const lvl = this.levels[levelIndex];
        const pageSize = Math.max(1, lvl?.pageSize | 0 || 20);
        const provider = this._pickProvider(lvl);
        const { items, total } = await provider(parent, { page: pageNo, pageSize, search: this._search, levelIndex });
        bucket.pages.set(pageNo, { items: items || [], total: total ?? bucket.total, done: items?.length < pageSize });
        if (total != null) bucket.total = total;
        return bucket.pages.get(pageNo);
    }

    async _fetchVirtualBatch(levelIndex, parent, bucket, append = true) {
        const lvl = this.levels[levelIndex];
        const pageSize = Math.max(1, lvl?.pageSize | 0 || 64);
        const provider = this._pickProvider(lvl);
        const offset = append ? bucket.virtualOffset : 0;
        const pageNo = Math.floor(offset / pageSize);
        const { items, total } = await provider(parent, { page: pageNo, pageSize, search: this._search, levelIndex, offset });
        const seg = { items: items || [], total: total ?? bucket.total, done: (items?.length || 0) < pageSize };
        // store under pageNo for uniformity
        bucket.pages.set(pageNo, seg);
        if (append) bucket.virtualOffset += seg.items.length;
        if (total != null) bucket.total = total;
        return seg;
    }

    _pickProvider(lvl) {
        if (this._search && typeof lvl?.search === "function") return (parent, ctx) => lvl.search(parent, ctx);
        return (parent, ctx) => lvl.getChildren(parent, ctx);
    }

    /* ---------- RENDERING ---------- */
    _renderHeader(levelIndex) {
        // Build crumbs from path
        const cList = ul(
            li(
                a({ class: "link", onclick: () => { this._path = []; this._store.clear(); this._loadAndRender(0, { replace: true }); } },
                    span({ class: "fa-auto fa-house" }),
                    span(" Root")
                )
            )
        );
        this._path.forEach((p, i) => {
            i = i+1; // root is implicit 0
            const lvl = this.levels[p.levelIndex];
            const label = this._labelFor(lvl, p.item) || `Level ${lvl?.title || lvl?.id || i}`;
            const isLast = this._path.length >= i;
            const onclick = isLast ? undefined : () => { this._path = this._path.slice(0, i); this._loadAndRender(i, { replace: true }); };
            cList.appendChild(li(a({ class: "link", onclick }, label)));
        });

        const rootBtn = div({ class: "breadcrumbs text-sm px-2 pt-1" }, cList);

        const searchBox = div({ class: "px-2 pb-1" },
            input({
                class: "input input-sm input-bordered w-full",
                placeholder: "Search…",
                value: this._search,
                oninput: this._debouncedSearch(() => {
                    const val = cSearch.value.trim();
                    this._search = val;
                    // Reset store for current level and reload
                    const levelIndex = Math.min(this._path.length, this.levels.length - 1);
                    const parent = levelIndex > 0 ? this._path[levelIndex - 1]?.item : null;
                    const key = this._bucketKey(levelIndex, parent, this._search);
                    const old = this._store.get(key);
                    if (old) this._store.delete(key);
                    this._loadAndRender(levelIndex, { replace: true });
                }, 250)
            })
        );
        // connect to element for value read (closure above)
        const cSearch = searchBox.firstChild;

        return div({ class: "border-b border-base-300/70" }, rootBtn, searchBox);
    }

    _labelFor(lvl, item) {
        if (!lvl) return "";
        if (typeof lvl.labelOf === "function") return lvl.labelOf(item);
        return item?.name || item?.label || item?.PatientName || item?.StudyDescription || item?.SeriesDescription || String(item?.id ?? "");
    }

    _renderLevelView(levelIndex, parent, bucket) {
        const lvl = this.levels[levelIndex];
        if (!lvl) {
            // no more levels: optionally show a message
            return div({ class: "p-4 text-base-content/60" }, "No further levels.");
        }

        // teardown previous IO
        if (this._io) { try { this._io.disconnect(); } catch {} this._io = null; }

        const header = this._renderHeader(levelIndex);

        // Container
        const listWrap = div({ class: "flex-1 overflow-auto" });

        // Create list content by mode
        if (lvl.mode === "virtual") {
            listWrap.appendChild(this._renderVirtualList(levelIndex, parent, bucket));
        } else {
            listWrap.appendChild(this._renderPagedList(levelIndex, parent, bucket));
        }

        return div({ class: this.classMap.base, id: this.id }, header, listWrap);
    }

    _renderPagedList(levelIndex, parent, bucket) {
        const lvl = this.levels[levelIndex];
        const pageSize = Math.max(1, lvl?.pageSize | 0 || 20);
        let currentPage = Math.min(...Array.from(bucket.pages.keys()));
        if (!Number.isFinite(currentPage)) currentPage = 0;

        const host = div({ class: "flex flex-col h-full" });
        const listEl = ul({ class: "menu p-1 gap-1" });

        const pageState = van.state(currentPage + 1);
        const totalState = van.state(bucket.total ?? null);
        const canNextState = van.state(true);

        const renderPage = (pNo) => {
            const seg = bucket.pages.get(pNo);
            listEl.innerHTML = "";
            seg?.items.forEach((item, idx) => {
                listEl.appendChild(this._renderItemLi(levelIndex, item, idx));
            });
        };

        renderPage(currentPage);

        const total = bucket.total;
        const totalPages = total ? Math.max(1, Math.ceil(total / pageSize)) : undefined;
        if (totalPages && totalState.val == null) totalState.val = totalPages;

        // Controls
        const controls = div({ class: "flex items-center justify-between p-2 border-t border-base-300/70 gap-2" },
            div(
                { class: "join" },
                this._btn("fa-angle-left", async () => {
                    if (currentPage <= 0) return;
                    currentPage -= 1;
                    if (!bucket.pages.has(currentPage)) await this._fetchPage(levelIndex, parent, bucket, currentPage);
                    renderPage(currentPage);
                    pageState.val = (currentPage + 1);
                    // if we moved left, next is allowed again
                    canNextState.val = true;
                    updateMeta();
                }),
                span({ class: "join-item btn btn-sm pointer-events-none" }, () => `Page ${pageState.val}${totalState.val != null ? ` / ${totalState.val}` : " / ?"}`),
                this._btn("fa-angle-right", async () => {
                    // if total is unknown, try load next until empty
                    if (totalPages && currentPage >= totalPages) return;
                    currentPage += 1;
                    if (!bucket.pages.has(currentPage)) {
                        const seg = await this._fetchPage(levelIndex, parent, bucket, currentPage);
                        if (bucket.total != null && totalState.val == null) {
                            totalState.val = Math.max(1, Math.ceil(bucket.total / pageSize));
                        }
                        if (!seg.items.length) {
                            // we reached the end when total was unknown; freeze next
                            currentPage -= 1;
                            canNextState.val = false;
                            return;
                        }
                    }
                    renderPage(currentPage);
                    pageState.val = (currentPage + 1);
                    updateMeta();
                })
            ),
            div({ class: "text-xs opacity-70" }, () => total != null ? `${total} items` : "")
        );

        const updateMeta = () => {
            // nothing extra for now; placeholder hook
        };

        host.append(listEl, controls);
        return host;
    }

    _renderVirtualList(levelIndex, parent, bucket) {
        const lvl = this.levels[levelIndex];
        const listEl = ul({ class: "menu p-1 gap-1" });

        // Create IO that upgrades placeholders to heavy renderers when visible
        this._io = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const target = entry.target;
                    const key = target.getAttribute("data-key");
                    const itemIdx = +target.getAttribute("data-idx");
                    const pageNo = +target.getAttribute("data-page");
                    const seg = bucket.pages.get(pageNo);
                    const item = seg?.items[itemIdx];
                    if (!item) return;

                    // swap placeholder with heavy content
                    const node = this._renderItemLi(levelIndex, item, itemIdx, { heavy: true, pageNo });
                    target.replaceWith(node);
                    this._io.unobserve(target);
                }
            });
        }, { root: listEl, rootMargin: "256px 0px", threshold: 0.01 });

        // Render currently loaded segments as placeholders first
        const renderSegments = () => {
            listEl.innerHTML = "";
            const pages = Array.from(bucket.pages.keys()).sort((a,b)=>a-b);
            pages.forEach(pNo => {
                const seg = bucket.pages.get(pNo);
                seg.items.forEach((item, idx) => {
                    const ph = this._renderItemPlaceholder(levelIndex, item, idx, pNo);
                    listEl.appendChild(ph);
                    this._io.observe(ph);
                });
            });
            // add an infinite-scroll sentinel
            const sentinel = div({ class: "w-full text-center text-xs opacity-60 p-2" }, segDone() ? "— end —" : "Loading…");
            sentinel.setAttribute("data-sentinel", "1");
            listEl.appendChild(sentinel);
            const ioMore = new IntersectionObserver(async entries => {
                for (const e of entries) {
                    if (!e.isIntersecting) continue;
                    if (segDone()) return;
                    const before = bucket.virtualOffset;
                    const seg = await this._fetchVirtualBatch(levelIndex, parent, bucket, true);
                    if ((seg?.items?.length || 0) === 0) return; // no more
                    // append new placeholders for new page
                    const pNo = Math.floor(before / (lvl.pageSize || 64));
                    seg.items.forEach((item, i) => {
                        const idx = i;
                        const ph = this._renderItemPlaceholder(levelIndex, item, idx, pNo);
                        sentinel.before(ph);
                        this._io.observe(ph);
                    });
                    sentinel.textContent = segDone() ? "— end —" : "Loading…";
                }
            }, { root: listEl, rootMargin: "512px 0px", threshold: 0.01 });
            ioMore.observe(sentinel);
        };

        const segDone = () => {
            // done if any last loaded segment has less than pageSize or stated done
            const pages = Array.from(bucket.pages.keys());
            if (!pages.length) return false;
            const last = bucket.pages.get(Math.max(...pages));
            return !!last?.done;
        };

        renderSegments();
        return listEl;
    }

    reconfigure({ levels, search = "" } = {}) {
        if (levels && Array.isArray(levels)) {
            this.levels = levels.slice();
        }
        this._search = (typeof search === "string" ? search : "");
        this._path = [];
        this._store.clear();
        this._loadAndRender(0, { replace: true });
    }

    /** Soft refresh current level (same config), keeping path */
    refresh() {
        const levelIndex = Math.min(this._path.length, this.levels.length - 1);
        const parent = levelIndex > 0 ? this._path[levelIndex - 1]?.item : null;
        // purge bucket for current search + parent so a fresh fetch happens
        const key = this._bucketKey(levelIndex, parent, this._search);
        this._store.delete(key);
        this._loadAndRender(levelIndex, { replace: true });
    }

    _renderItemPlaceholder(levelIndex, item, idx, pageNo) {
        const lvl = this.levels[levelIndex];
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
        const lvl = this.levels[levelIndex];
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
            const navigate = this._canOpen(lvl, item, idx);
            if (typeof lvl?.onClick === "function") lvl.onClick(item, idx);
            if (navigate) this._navigate(levelIndex, item, idx);
        }
        // mark for IO (helpful when swapping placeholder)
        row.setAttribute("data-key", key);
        row.setAttribute("data-idx", String(idx));
        row.setAttribute("data-page", String(pageNo));
        return row;
    }

    _btn(iconName, onClick) {
        const b = div({ class: "join-item btn btn-sm", onclick: onClick }, span({ class: `fa-auto ${iconName}` }));
        return b;
    }

    /* ---------- BaseComponent ---------- */
    create() {
        if (!this._debouncedSearchWrapped) this._debouncedSearchWrapped = this._makeDebounce((fn) => fn(), 250);
        if (!document.getElementById(this.id)) {
            // initial mount => render the first level
            setTimeout(() => this._loadAndRender(0, { replace: true }), 0);
        }
        return div({ id: this.id, class: this.classMap.base, ...this.extraProperties });
    }

    _debouncedSearch(fn, delay=250) {
        let t=null; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), delay); };
    }
}

// Attach to UI namespace when included by a plugin
if (globalThis && globalThis.UI) {
    globalThis.UI.Explorer = Explorer;
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
        span({ class: "fa-auto fa-user" }),
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
        span({ class: "fa-auto fa-flask" }),
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
        span({ class: "fa-auto fa-image" }),
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