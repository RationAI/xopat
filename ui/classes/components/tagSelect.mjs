import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div, input, button, span, label: vanLabel } = van.tags;

/**
 * A lightweight searchable multi-select rendered with DaisyUI classes.
 * Selected values are displayed as removable badges.
 */
export class TagSelect extends BaseComponent {
    /**
     * @param {object} [options]
     * @param {string} [options.placeholder]
     * @param {string} [options.searchPlaceholder]
     * @param {string} [options.emptyText]
     * @param {Array<{value:string,label:string,keywords?:string}>} [options.options]
     * @param {string[]} [options.selected]
     * @param {number} [options.maxVisible] Cap on rendered options (default 100). Selected
     *   items are always rendered in addition to the cap; remaining matches are summarized
     *   as "+N more" so the dropdown stays usable for large option sets.
     * @param {(values:string[]) => void} [options.onChange]
     */
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;
        this.classMap.base = "relative";
        this._options = Array.isArray(options.options) ? options.options : [];
        this._selected = new Set(Array.isArray(options.selected) ? options.selected : []);
        this._placeholder = options.placeholder || "Select values";
        this._searchPlaceholder = options.searchPlaceholder || "Search...";
        this._emptyText = options.emptyText || "No values";
        this._maxVisible = Number.isFinite(options.maxVisible) && options.maxVisible > 0
            ? Math.floor(options.maxVisible) : 100;
        this._onChange = typeof options.onChange === "function" ? options.onChange : (() => {});
        this._open = false;
        this._query = "";
        this.root = null;
        this.refs = {};
        this._boundDocumentClick = this._handleDocumentClick.bind(this);
    }

    create() {
        if (this.root) return this.root;

        this.refs.badges = div({ class: "flex flex-wrap gap-1 flex-1 min-w-0" });
        this.refs.toggle = button({
            type: "button",
            class: "btn btn-ghost btn-xs btn-square shrink-0",
            onclick: (e) => {
                e.stopPropagation();
                this.toggleOpen();
            }
        }, span({ class: "ph-light ph-caret-down text-xs" }));

        this.refs.control = button({
            type: "button",
            class: "input input-bordered input-sm w-full min-h-10 h-auto flex items-center justify-between gap-2 text-left",
            onclick: () => this.toggleOpen()
        }, this.refs.badges, this.refs.toggle);

        this.refs.search = input({
            type: "text",
            class: "input input-bordered input-sm w-full",
            placeholder: this._searchPlaceholder,
            oninput: (e) => {
                this._query = e.currentTarget.value || "";
                this._renderList();
            }
        });

        this.refs.list = div({ class: "menu menu-sm max-h-56 overflow-auto w-full" });

        this.refs.panel = div({
            class: "absolute z-20 mt-2 w-full rounded-box border border-base-300 bg-base-100 shadow-xl p-2 hidden"
        },
            this.refs.search,
            div({ class: "mt-2" }, this.refs.list)
        );

        this.root = div({ ...this.commonProperties }, this.refs.control, this.refs.panel);
        this._renderBadges();
        this._renderList();
        document.addEventListener("click", this._boundDocumentClick, true);
        return this.root;
    }

    remove() {
        document.removeEventListener("click", this._boundDocumentClick, true);
        super.remove();
    }

    /**
     * @returns {string[]}
     */
    getValue() {
        return [...this._selected];
    }

    /**
     * @param {string[]} values
     */
    setValue(values = []) {
        this._selected = new Set((values || []).map(String));
        this._renderBadges();
        this._renderList();
    }

    /**
     * @param {Array<{value:string,label:string,keywords?:string}>} options
     */
    setOptions(options = []) {
        this._options = Array.isArray(options) ? options : [];
        const allowed = new Set(this._options.map(option => String(option.value)));
        this._selected = new Set([...this._selected].filter(value => allowed.has(value)));
        this._renderBadges();
        this._renderList();
    }

    open() {
        this._open = true;
        this.refs.panel?.classList.remove("hidden");
        this.refs.toggle?.querySelector?.("span")?.classList.add("rotate-180");
        this.refs.search?.focus();
    }

    close() {
        this._open = false;
        this.refs.panel?.classList.add("hidden");
        this.refs.toggle?.querySelector?.("span")?.classList.remove("rotate-180");
    }

    toggleOpen() {
        if (this._open) this.close();
        else this.open();
    }

    _handleDocumentClick(event) {
        if (!this.root || !event.target) return;
        if (!this.root.contains(event.target)) {
            this.close();
        }
    }

    _emitChange() {
        this._onChange(this.getValue());
    }

    _toggleValue(value) {
        const normalized = String(value);
        if (this._selected.has(normalized)) this._selected.delete(normalized);
        else this._selected.add(normalized);
        this._renderBadges();
        this._renderList();
        this._emitChange();
    }

    _renderBadges() {
        if (!this.refs.badges) return;
        const selectedValues = this.getValue();
        if (!selectedValues.length) {
            const placeholder = document.createElement("span");
            placeholder.className = "text-sm opacity-50";
            placeholder.textContent = this._placeholder;
            this.refs.badges.replaceChildren(placeholder);
            return;
        }

        const badges = selectedValues.map(value => {
            const option = this._options.find(item => String(item.value) === value);
            const badge = document.createElement("span");
            badge.className = "badge badge-outline badge-sm gap-1";
            badge.textContent = option?.label || value;

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "btn btn-ghost btn-xs btn-square min-h-0 h-4 w-4";
            remove.appendChild(document.createTextNode("×"));
            remove.onclick = (e) => {
                e.stopPropagation();
                this._toggleValue(value);
            };
            badge.appendChild(remove);
            return badge;
        });
        this.refs.badges.replaceChildren(...badges);
    }

    _renderList() {
        if (!this.refs.list) return;
        const query = this._query.trim().toLowerCase();
        const filtered = this._options.filter(option => {
            if (!query) return true;
            const haystack = `${option.label || ""} ${option.keywords || ""} ${option.value || ""}`.toLowerCase();
            return haystack.includes(query);
        });

        if (!filtered.length) {
            this.refs.list.replaceChildren(
                div({ class: "px-2 py-3 text-sm opacity-50" }, this._emptyText)
            );
            return;
        }

        // Always render selected matches; fill remaining capacity with the
        // top-of-list unselected matches. Anything beyond the cap is summarized
        // so large option sets (e.g. one entry per annotation) stay usable.
        const cap = this._maxVisible;
        const visible = [];
        let overflowCount = 0;
        for (const option of filtered) {
            if (this._selected.has(String(option.value))) visible.push(option);
            else if (visible.length < cap) visible.push(option);
            else overflowCount++;
        }

        const items = visible.map(option => vanLabel(
            { class: "label cursor-pointer justify-start gap-2 py-1 px-2 rounded hover:bg-base-200" },
            input({
                type: "checkbox",
                class: "checkbox checkbox-xs",
                checked: this._selected.has(String(option.value)),
                onchange: () => this._toggleValue(option.value)
            }),
            span({ class: "label-text text-sm" }, option.label || String(option.value))
        ));

        if (overflowCount) {
            items.push(div(
                { class: "px-2 py-2 text-xs opacity-60 italic" },
                `+${overflowCount} more — refine your search`
            ));
        }

        this.refs.list.replaceChildren(...items);
    }
}
