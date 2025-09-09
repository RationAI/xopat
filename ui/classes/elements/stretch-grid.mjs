import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div } = van.tags;

/**
 * @class StretchGrid
 * @description A grid component that stretches the last row to fill width
 */
class StretchGrid extends BaseComponent {
    constructor(options = {}, ...children) {
        super(options, ...children);

        this.cols = options.cols || 3;
        this.gap = options.gap || "12px";
        this.aspect = options.aspect || "4/3";
        this.items = [];

        // API exposure
        this.setItems = this.setItems.bind(this);
        this.push = this.push.bind(this);
        this.removeAt = this.removeAt.bind(this);
        this.setCols = this.setCols.bind(this);
        this.setAspect = this.setAspect.bind(this);
    }

    setItems(itemsOrCount) {
        this.items = [];
        const n = Array.isArray(itemsOrCount)
            ? itemsOrCount.length
            : (+itemsOrCount | 0);
        for (let i = 0; i < n; i++) {
            const node = Array.isArray(itemsOrCount)
                ? itemsOrCount[i]
                : this._defaultItem(i);
            node.classList.add("stretch-grid__item");
            this.items.push(node);
        }
        this._layout();
        this._children = this.items; // for BaseComponent render
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
        if (!this.items[idx]) return;
        this.items.splice(idx, 1);
        this._layout();
        this._children = this.items;
        this._renderedChildren = null;
    }

    setCols(n) {
        this.cols = n;
        this._layout();
    }

    setAspect(r) {
        this.aspect = r;
        this._layout();
    }

    _defaultItem(i) {
        const d = document.createElement("div");
        d.textContent = i + 1;
        return d;
    }

    _makeCell(id) {
        const d = document.createElement("div");
        d.classList.add("stretch-grid__item");
        d.id = id;
        return d;
    }

    createCell(id) {
        const el = this._makeCell(id);
        this.push(el);
        return el;
    }

    attachCell(id) {
        const self = document.getElementById(this.id);
        if (!self) return;
        self.appendChild(this.createCell(id));
    }

    _layout() {
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
        // this._gridStyle = `grid-template-columns: repeat(${renderedCols}, 1fr); gap:${this.gap}; --aspect:${this.aspect};`;
        this._gridStyle =
            `position:fixed; inset:0; display:grid;` +                // ⬅ full viewport
            `grid-template-columns: repeat(${renderedCols}, 1fr);` +
            `gap:${this.gap}; --aspect:${this.aspect};`;

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
        return div(
            {
                id: this.id,
                class: "stretch-grid " + (this.classState.val || ""),
                style: this._gridStyle,
                ...this.extraProperties,
            },
            this.children
        );
    }
}

export { StretchGrid };
