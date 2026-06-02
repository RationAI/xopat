import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div } = van.tags;

/**
 * @class StretchGrid
 * @description A grid component that stretches the last row to fill width
 */
export class StretchGrid extends BaseComponent {
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;

        const autoCols = options.cols === "auto" || options.auto === true;
        this._autoCols = autoCols;
        this.cols = autoCols ? 1 : (options.cols || 3);
        this.gap = options.gap || "12px";
        this.aspect = options.aspect || "4/3";
        this._targetCellAspect = options.targetCellAspect || 1;
        this.items = [];

        this._soloItemId = null;
        this._savedColsBeforeSolo = null;
        this._savedAutoBeforeSolo = null;

        this._resizeObserver = null;
        this._lastHostSize = { w: 0, h: 0 };

        // API exposure
        this.setItems = this.setItems.bind(this);
        this.push = this.push.bind(this);
        this.removeAt = this.removeAt.bind(this);
        this.setCols = this.setCols.bind(this);
        this.setAspect = this.setAspect.bind(this);
        this.showOnly = this.showOnly.bind(this);
        this.showAll = this.showAll.bind(this);
        this._recomputeAutoCols = this._recomputeAutoCols.bind(this);
        this._attachResizeObserver = this._attachResizeObserver.bind(this);
    }

    setItems(itemsOrCount) {
        // remove old DOM first
        const host = this._host();
        if (host) while (host.firstChild) host.removeChild(host.firstChild);

        this.items = [];
        const n = Array.isArray(itemsOrCount) ? itemsOrCount.length : (+itemsOrCount | 0);
        for (let i = 0; i < n; i++) {
            const node = Array.isArray(itemsOrCount) ? itemsOrCount[i] : this._defaultItem(i);
            node.classList.add("stretch-grid__item");
            this.items.push(node);
            if (host) host.appendChild(node);
        }
        this._layout();
        this._children = this.items;
        this._renderedChildren = null;
    }

    push(node) {
        const el = node || this._defaultItem(this.items.length);
        el.classList.add("stretch-grid__item");
        this.items.push(el);
        this._layout();
        this._children = this.items;
        this._renderedChildren = null;
    }

    removeAt(idx) {
        const el = this.items[idx];
        if (!el) return;

        // update model
        this.items.splice(idx, 1);

        // update DOM — primary path: cell is a direct child of host.
        const host = this._host();
        if (host && el.parentNode === host) {
            host.removeChild(el);
        } else {
            // Defensive fallback: the cell may have been reparented during
            // viewer destruction (OSD or a viewer-wrapper can move sub-nodes),
            // so the parentNode strict-equals check fails and the cell would
            // stay in the DOM forever. Locate by id and detach wherever it
            // lives now. The id space (`osd-<n>`) is owned by VIEWER_MANAGER
            // and not reused elsewhere, so this is safe.
            const live = el.id ? document.getElementById(el.id) : null;
            const target = live || el;
            target.parentNode?.removeChild(target);
        }

        this._children = this.items;
        this._renderedChildren = null;
        this._layout();
    }

    setCols(n) {
        this._autoCols = false;
        this.cols = n;
        this._layout();
    }

    setAspect(r) {
        this.aspect = r;
        this._layout();
    }

    _defaultItem(i) {
        return div({textContent: i + 1});
    }

    insertAt(idx, node) {
        const el = node || this._defaultItem(idx);
        el.classList.add("stretch-grid__item", "relative");

        // update model
        this.items.splice(idx, 0, el);
        const host = this._host();
        if (host) host.insertBefore(el, host.children[idx] || null);

        this._children = this.items;
        this._renderedChildren = null;
        this._layout();
    }

    _host() { return document.getElementById(this.id); }

    attachCell(id, index = this.items.length) {
        // Double-nested cells are intentional: this grid is used to
        // host OSD viewers, and viewer menu lives in the parent cell.
        const el = div({ id, class: "relative stretch-grid__item" });
        this.insertAt(index, el);
        return el;
    }

    findCellById(id) {
        return this.items.find(el => el.id === id);
    }

    showOnly(id) {
        if (!id) return this.showAll();

        const target = this.findCellById(id);
        if (!target) return this.showAll();

        if (this._savedColsBeforeSolo == null) {
            this._savedColsBeforeSolo = this.cols;
            this._savedAutoBeforeSolo = this._autoCols;
        }

        this._soloItemId = id;
        this._autoCols = false;
        this.cols = 1;
        this._layout();

        for (const el of this.items) {
            const isActive = el.id === id;

            el.style.display = isActive ? "" : "none";
            el.style.visibility = isActive ? "visible" : "hidden";
            el.style.pointerEvents = isActive ? "" : "none";
            el.style.width = isActive ? "100%" : "0";
            el.style.height = isActive ? "100%" : "0";
            el.style.minWidth = isActive ? "0" : "0";
            el.style.minHeight = isActive ? "0" : "0";
            el.style.flex = isActive ? "1 1 auto" : "0 0 0";
            el.style.gridColumn = isActive ? "1 / -1" : "";
        }
    }

    showAll() {
        if (this._savedColsBeforeSolo != null) {
            this.cols = this._savedColsBeforeSolo;
        }
        if (this._savedAutoBeforeSolo != null) {
            this._autoCols = this._savedAutoBeforeSolo;
        }

        this._soloItemId = null;
        this._savedColsBeforeSolo = null;
        this._savedAutoBeforeSolo = null;
        this._layout();

        for (const el of this.items) {
            el.style.display = "";
            el.style.visibility = "";
            el.style.pointerEvents = "";
            el.style.width = "";
            el.style.height = "";
            el.style.minWidth = "";
            el.style.minHeight = "";
            el.style.flex = "";
            el.style.gridColumn = "";
        }
    }

    _recomputeAutoCols() {
        const host = this._host();
        if (!host) return;
        const n = this.items.length;
        if (n <= 1) { this.cols = 1; return; }
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (w <= 0 || h <= 0) return;
        const target = this._targetCellAspect || 1;

        let bestCols = 1;
        let bestScore = Infinity;
        for (let c = 1; c <= n; c++) {
            const r = Math.ceil(n / c);
            const cellAspect = (w / c) / (h / r);
            const score = Math.abs(Math.log(cellAspect / target));
            if (score < bestScore) {
                bestScore = score;
                bestCols = c;
            }
        }
        this.cols = bestCols;
    }

    _attachResizeObserver() {
        if (this._resizeObserver) return;
        const host = this._host();
        if (!host) return;
        if (typeof ResizeObserver === "undefined") return;

        this._resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            const { width, height } = entry.contentRect;
            if (width === this._lastHostSize.w && height === this._lastHostSize.h) return;
            this._lastHostSize = { w: width, h: height };
            if (this._autoCols && this._soloItemId == null && this.items.length > 0) {
                this._layout();
            }
        });
        this._resizeObserver.observe(host);
    }

    destroy() {
        if (this._resizeObserver) {
            try { this._resizeObserver.disconnect(); } catch (_) { /* ignore */ }
            this._resizeObserver = null;
        }
        this.items = [];
    }

    _layout() {
        if (this._autoCols && this._soloItemId == null && this.items.length > 0) {
            this._recomputeAutoCols();
        }
        // Observer attach is idempotent — retry here in case create() ran before host was mounted.
        if (this._autoCols && !this._resizeObserver) this._attachResizeObserver();

        const cols = Math.max(1, this.cols | 0);
        const n = this.items.length;
        const rem = n % cols;

        let m = 1;
        if (rem) {
            for (let k = 1; k <= 6; k++) {
                if ((cols * k) % rem === 0) {
                    m = k;
                    break;
                }
            }
        }
        const renderedCols = cols * m;
        this._gridStyle =
            `inset:0; display:grid;` +                // ⬅ full viewport
            `grid-template-columns: repeat(${renderedCols}, 1fr);` +
            `gap:${this.gap}; --aspect:${this.aspect};`;

        // Re-apply to the live host so cols changes after mount take effect.
        const host = this._host();
        if (host) host.setAttribute("style", this._gridStyle);

        // reset gridColumn for all
        this.items.forEach((el) => (el.style.gridColumn = ""));

        if (rem) {
            const span = Math.floor(renderedCols / rem);
            const lastRow = this.items.slice(-rem);
            lastRow.forEach((el, i) => {
                const start = i * span + 1;
                el.style.gridColumn = `${start} / span ${span}`;
            });
        }
    }

    create() {
        this._layout();
        const node = div(
            {
                id: this.id,
                class: "stretch-grid width-full height-full" + (this.classState.val || ""),
                style: this._gridStyle,
                ...this.extraProperties,
            },
            this.children
        );
        queueMicrotask(() => this._attachResizeObserver());
        return node;
    }
}

