// ui/classes/components/Explorer.mjs
// Generic hierarchy/browser component with per-level paging and lazy rendering
// Works with the library style shown in the compiled bundle (BaseComponent + vanjs + Tailwind + DaisyUI)
// Export class name: Explorer
//
// High-level API
// new UI.Explorer({
//   id?: string,
//   class?: string,
//   levels: [
//     {
//       id: "patients",                           // unique id for the level
//       title?: "Patients",                       // optional title shown in header/breadcrumb
//       mode: "page" | "virtual",                 // "page" => classic paging controls; "virtual" => infinite windowed list
//       pageSize?: 20,                            // page size for "page" (or fetch batch size for virtual)
//       getChildren: async (parent, ctx: Explorer.FetchContext) => ({    // provider that returns items lazily
//         items: Array<Item>,
//         total?: number                           // optional (used by pager)
//       }),
//       // Optional: search function override; if omitted, getChildren(ctx.search) is used
//       search?: async (parent, ctx: Explorer.FetchContext) => ({ items, total }),
//       // Render a single item (lightweight!)
//       renderItem: (item, helpers) => Node|BaseComponent,
//       // Heavy renderer (only called when item enters viewport); falls back to renderItem
//       renderHeavy?: (item, helpers) => Node|BaseComponent,
//       // Whether clicking an item drills down to the next level (default: true except on last level)
//       onOpen?: (item) => boolean,  called when user selects a button, if returns true the hierarchy nests one level
//       // Optional unique key extractor (default uses item.id || index)
//       keyOf?: (item, index, parent) => string,
//     },
//     ...
//   ],
//   // Invoked when an item becomes selected at any level (before navigation)
//   onSelect?: (levelIndex, item, path) => void,
//   // Invoked whenever navigation path changes (after content renders)
//   onPathChange?: (path /* array of {levelId, item} */) => void,
// })
//
// @typedef {{
//  page: number,
//  pageSize: number,
//  search?: string,
//  levelIndex: number,
//  offset: number
// }} Explorer.FetchContext

import van from "../../vanjs.mjs";
import {BaseComponent} from "../baseComponent.mjs";

const { div, ul, li, span, a, input } = van.tags;

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

        this.onSelect = typeof opts.onSelect === "function" ? opts.onSelect : null;
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
        if (typeof lvl?.onOpen === "function") return !!lvl.onOpen(item, idx);
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
        this.onSelect?.(levelIndex, item, this._path.slice());
        // trim path at this level and push
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

        // Prepare bucket
        const bucket = this._ensureBucket(levelIndex, parent, this._search);

        // First time load for first page/segment (page 1 or offset 0)
        if (!bucket._init) {
            bucket._init = true;
            if (lvl?.mode === "virtual") {
                await this._fetchVirtualBatch(levelIndex, parent, bucket, /*append*/ true);
            } else {
                await this._fetchPage(levelIndex, parent, bucket, 0);
            }
        }

        // Render
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
        const crumbs = [];
        // Breadcrumb root
        const rootBtn = div({ class: "breadcrumbs text-sm px-2 pt-1" },
            ul(
                li(
                    a({ class: "link", onclick: () => { this._path = []; this._store.clear(); this._loadAndRender(0, { replace: true }); } },
                        span({ class: "fa-auto fa-house" }),
                        span(" Root")
                    )
                )
            )
        );

        // Build crumbs from path
        const cList = ul();
        this._path.forEach((p, i) => {
            const lvl = this.levels[p.levelIndex];
            const label = this._labelFor(lvl, p.item) || `Level ${lvl?.title || lvl?.id || i}`;
            cList.appendChild(li(a({ class: "link", onclick: () => { this._path = this._path.slice(0, i); this._loadAndRender(i, { replace: true }); } }, label)));
        });

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

        return div({ class: "border-b border-base-300/70" }, rootBtn, cList, searchBox);
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

        // Controls
        const controls = div({ class: "flex items-center justify-between p-2 border-t border-base-300/70 gap-2" },
            div(
                { class: "join" },
                this._btn("fa-angle-left", async () => {
                    if (currentPage <= 0) return;
                    currentPage -= 1;
                    if (!bucket.pages.has(currentPage)) await this._fetchPage(levelIndex, parent, bucket, currentPage);
                    renderPage(currentPage);
                    updateMeta();
                }),
                span({ class: "join-item btn btn-sm pointer-events-none" }, () => `Page ${currentPage + 1}${totalPages ? ` / ${totalPages}` : ""}`),
                this._btn("fa-angle-right", async () => {
                    // if total is unknown, try load next until empty
                    if (totalPages && currentPage >= totalPages) return;
                    currentPage += 1;
                    if (!bucket.pages.has(currentPage)) {
                        const seg = await this._fetchPage(levelIndex, parent, bucket, currentPage);
                        if (!seg.items.length) { currentPage -= 1; return; }
                    }
                    renderPage(currentPage);
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
            open: () => this._navigate(levelIndex, item),
            levelIndex,
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
            if (navigate) this._navigate(levelIndex, item);
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