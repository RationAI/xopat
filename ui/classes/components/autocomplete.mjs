import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { componentIconNode, PhIcon } from "../elements/ph-icon.mjs";
import { placeFixedAnchored, trackAnchor } from "../elements/popupPlacement.mjs";

const { div, ul, li, a, span, input, button } = van.tags;

const SIZE_CLASS = { xs: "input-xs", sm: "input-sm", md: "", lg: "input-lg" };
const BTN_SIZE_CLASS = { xs: "btn-xs", sm: "btn-sm", md: "btn-sm", lg: "btn-md" };

/**
 * @typedef {object} AutocompleteOption
 * @property {string} value machine value; unique within the option list
 * @property {string} [label] human label (defaults to `value`)
 * @property {string} [icon] Phosphor icon class (`ph-*`) or an image URL
 * @property {string} [description] secondary line rendered under the label
 * @property {string} [keywords] extra text matched by the filter but not shown
 * @property {boolean} [disabled] rendered, never selectable
 * @property {boolean} [separator] group header row: not selectable, hidden while filtering
 */

/**
 * Searchable single-value combobox (type to filter, click / arrows + Enter to pick).
 *
 * Replaces the vendored BVSelect (`src/external/autocomplete.js`), which built its
 * DOM through `insertAdjacentHTML` string concatenation, addressed every node by a
 * random global id, and attached `document`-level `click`/`scroll` listeners that
 * were never detached — one leaked pair per instance, forever.
 *
 * Design notes:
 * - Multi-select is *not* this component: use {@link TagSelect}.
 * - The popup is portaled to `document.body` while open and placed in viewport
 *   coordinates ({@link placeFixedAnchored}), so it escapes scroll/overflow ports
 *   (side menus, the mobile toolbar host) instead of being clipped by them.
 * - Outside-click, Escape and z-index are delegated to `FloatingManager`; the only
 *   window-level listeners are the anchor tracker and they exist only while open.
 * - Styling is DaisyUI + compiled Tailwind utilities only. Two inline styles remain
 *   (list max-height, panel width) because they are per-instance measurements, not
 *   design tokens — see AGENTS.md §8 "Shipped Tailwind is purged".
 *
 * @example
 * const stains = new UI.Autocomplete({
 *     options: [{ value: "he", label: "H&E", icon: "ph-drop" }, { value: "ihc", label: "IHC" }],
 *     value: "he",
 *     placeholder: $.t("common.selectOption"),   // never a hardcoded literal, see AGENTS.md §3
 *     onChange: (value, option) => console.log(value, option)
 * }).attachTo(container);
 *
 * @example <caption>Remote suggestions</caption>
 * new UI.Autocomplete({
 *     allowCustom: true,
 *     fetchOptions: async (query, { signal }) => {
 *         const r = await client.request(`search?q=${encodeURIComponent(query)}`, { signal });
 *         return r.items.map(i => ({ value: i.id, label: i.name }));
 *     }
 * });
 */
export class Autocomplete extends BaseComponent {

    /**
     * @param {object} [options]
     * @param {Array<AutocompleteOption|string>} [options.options] static option list
     * @param {string|null} [options.value] initially selected value
     * @param {string} [options.placeholder] shown when nothing is selected
     * @param {string} [options.emptyText] shown when the filter matches nothing
     * @param {"xs"|"sm"|"md"|"lg"} [options.size="sm"]
     * @param {boolean} [options.disabled=false]
     * @param {boolean} [options.allowClear=true] render a clear button once a value is set
     * @param {boolean} [options.allowCustom=false] accept free text as the value (Enter / blur)
     * @param {number} [options.maxVisible=100] rendered-row cap; the rest is summarized
     * @param {(query: string, ctx: {signal: AbortSignal}) => Promise<Array<AutocompleteOption|string>>} [options.fetchOptions]
     *      async provider; replaces the static list for non-empty queries
     * @param {number} [options.fetchDebounceMs=200]
     * @param {string} [options.name] renders a hidden input of that name (plain form usage)
     * @param {(value: string|null, option: AutocompleteOption|null) => void} [options.onChange]
     * @param {(query: string) => void} [options.onInput]
     */
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;

        this.classMap.base = "w-full";
        this._size = SIZE_CLASS[options.size] !== undefined ? options.size : "sm";
        this._placeholder = options.placeholder || $.t("common.selectOption");
        this._emptyText = options.emptyText || $.t("common.noMatches");
        this._allowClear = options.allowClear !== false;
        this._allowCustom = options.allowCustom === true;
        this._maxVisible = Number.isFinite(options.maxVisible) && options.maxVisible > 0
            ? Math.floor(options.maxVisible) : 100;
        this._fetchOptions = typeof options.fetchOptions === "function" ? options.fetchOptions : null;
        this._fetchDebounceMs = Number.isFinite(options.fetchDebounceMs) ? options.fetchDebounceMs : 200;
        this._name = typeof options.name === "string" ? options.name : "";
        this._onChange = typeof options.onChange === "function" ? options.onChange : (() => {});
        this._onInput = typeof options.onInput === "function" ? options.onInput : (() => {});

        this._static = Autocomplete.normalizeOptions(options.options);
        this._all = this._static;

        this.value = van.state(options.value !== undefined && options.value !== null ? String(options.value) : null);
        this.isOpen = van.state(false);
        this.isDisabled = van.state(options.disabled === true);
        this._query = van.state("");
        this._loading = van.state(false);
        this._version = van.state(0);

        /** @private rendered selectable rows, in visual order (keyboard target) */
        this._rows = [];
        this._activeIndex = -1;

        this.root = null;
        this.refs = {};
        this._fmToken = null;
        this._untrackAnchor = null;
        this._resizeObserver = null;
        this._fetchTimer = null;
        this._fetchAbort = null;
        /** @private set by {@link Autocomplete.fromSelect}: native select to restore on remove */
        this._nativeSelect = null;
    }

    /* ------------------------------------------------------------------ API */

    /** @returns {string|null} the selected value */
    getValue() {
        return this.value.val;
    }

    /** @returns {AutocompleteOption|null} the selected option record, if it is a known one */
    getSelected() {
        return this._optionOf(this.value.val);
    }

    /**
     * @param {string|null} value
     * @param {object} [opts]
     * @param {boolean} [opts.notify=false] also invoke `onChange`
     */
    setValue(value, opts = {}) {
        const next = value === undefined || value === null || value === "" ? null : String(value);
        if (next === this.value.val) return;
        this.value.val = next;
        this._syncInputText();
        if (opts.notify) this._emitChange();
    }

    /**
     * Replace the static option list. A selection that is no longer offered is kept
     * only in `allowCustom` mode - otherwise it is cleared (degrade closed: the
     * control must never report a value the user cannot see).
     * @param {Array<AutocompleteOption|string>} options
     */
    setOptions(options = []) {
        this._static = Autocomplete.normalizeOptions(options);
        this._all = this._static;
        if (!this._allowCustom && this.value.val !== null && !this._optionOf(this.value.val)) {
            this.value.val = null;
        }
        this._version.val++;
        this._syncInputText();
    }

    /** @param {boolean} disabled */
    setDisabled(disabled) {
        this.isDisabled.val = !!disabled;
        if (disabled) this.close();
    }

    focus() {
        this.refs.input?.focus();
    }

    /**
     * @param {{resetQuery?: boolean}} [opts]
     *   `resetQuery: false` opens WITHOUT clearing the typed query — the panel is
     *   being opened *because* the user typed, so the reset below would eat the
     *   keystroke that triggered it.
     */
    open({ resetQuery = true } = {}) {
        if (this.isOpen.val || this.isDisabled.val) return;
        this.isOpen.val = true;

        const panel = this.refs.panel;
        if (panel.parentNode !== document.body) document.body.appendChild(panel);
        this._place();
        this._untrackAnchor = trackAnchor(() => this._place());
        // The list is re-rendered on van's own update tick (and again when an async
        // provider answers), so the panel height at open() is not the final one.
        // Observing it re-places on the real size instead of guessing a delay.
        this._resizeObserver = new ResizeObserver(() => this._place());
        this._resizeObserver.observe(panel);

        this._fmToken = UI.Services.FloatingManager.register({
            el: panel,
            owner: this,
            onEscape: "close",
            // The control lives outside the portaled panel: a click on it must reach
            // its own handler (toggle) instead of being eaten as an outside click.
            onOutsideClick: (e) => {
                if (this.root && this.root.contains(e.target)) return;
                this.close();
            }
        });
        UI.Services.FloatingManager.bringToFront(this._fmToken);

        // Full list on open, with the current label pre-selected so typing replaces it.
        // Skipped when the open was CAUSED by typing: `_syncInputText()` rewrites
        // `input.value` from the current selection, so an unconditional reset here
        // discarded the first character typed into a closed control (tab-focused,
        // or reopened after Escape) and left the list unfiltered — while
        // `_scheduleFetch` still queried the provider for text the component had
        // just thrown away.
        if (!resetQuery) return;
        this._query.val = "";
        this._syncInputText();
        this.refs.input?.select();
    }

    close() {
        if (!this.isOpen.val) return;
        this.isOpen.val = false;

        this._untrackAnchor?.();
        this._untrackAnchor = null;
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
        if (this._fmToken) {
            UI.Services.FloatingManager.unregister(this._fmToken);
            this._fmToken = null;
        }
        this.refs.panel?.remove();

        this._cancelFetch();
        this._query.val = "";
        if (this._all !== this._static) {
            this._all = this._static;
            this._version.val++;
        }
        this._setActive(-1);
        this._syncInputText();
    }

    toggle() {
        if (this.isOpen.val) this.close();
        else {
            this.refs.input?.focus();
            this.open();
        }
    }

    /** Closing on a layout change is cheaper (and less wrong) than re-anchoring blind. */
    onLayoutChange() {
        this.close();
    }

    remove() {
        this.close();
        this.refs.panel?.remove();
        if (this._nativeSelect) {
            this._nativeSelect.style.display = "";
            this._nativeSelect = null;
        }
        super.remove();
    }

    /* ------------------------------------------------------------ rendering */

    create() {
        if (this.root) return this.root;

        this.refs.input = input({
            type: "text",
            role: "combobox",
            autocomplete: "off",
            spellcheck: "false",
            "aria-autocomplete": "list",
            "aria-controls": `${this.id}-list`,
            "aria-expanded": () => String(this.isOpen.val),
            class: `input input-bordered ${SIZE_CLASS[this._size]} join-item flex-1 min-w-0`,
            placeholder: this._placeholder,
            disabled: () => this.isDisabled.val,
            oninput: (e) => this._onQueryInput(e.currentTarget.value || ""),
            onkeydown: (e) => this._onKeyDown(e),
            // Deliberately not `onfocus`: tabbing through a form must not pop menus.
            // Click, typing and ArrowDown open it.
            onclick: () => this.open()
        });

        this.refs.clear = button({
            type: "button",
            tabindex: "-1",
            title: $.t("common.clearSelection"),
            "aria-label": $.t("common.clearSelection"),
            class: () => `btn btn-ghost ${BTN_SIZE_CLASS[this._size]} join-item `
                + (this._allowClear && this.value.val !== null && !this.isDisabled.val ? "" : "hidden"),
            // Keep the caret inside the text field: a focus bounce would close-open the popup.
            onmousedown: (e) => e.preventDefault(),
            onclick: () => this._clear()
        }, new PhIcon({ name: "ph-x" }).create());

        this.refs.caretIcon = new PhIcon({ name: "ph-caret-down" }).create();
        this.refs.toggle = button({
            type: "button",
            tabindex: "-1",
            title: $.t("common.toggleOptions"),
            "aria-label": $.t("common.toggleOptions"),
            class: () => `btn btn-ghost ${BTN_SIZE_CLASS[this._size]} join-item `
                + (this.isOpen.val ? "rotate-180" : ""),
            disabled: () => this.isDisabled.val,
            onmousedown: (e) => e.preventDefault(),
            onclick: () => this.toggle()
        }, this.refs.caretIcon);

        this.refs.control = div({ class: "join w-full flex items-center" },
            this.refs.input, this.refs.clear, this.refs.toggle);

        this.refs.list = div({
            id: `${this.id}-list`,
            role: "listbox",
            style: "max-height: 16rem; overflow-y: auto;"
        }, () => this._renderList());

        // Visibility is DOM presence, not a class: `close()` detaches the panel from
        // <body>. A reactive `hidden` class would also be applied on van's next
        // update tick, i.e. *after* open() measures the panel to place it - a
        // zero-height measurement that breaks the flip-up decision.
        this.refs.panel = div({
            class: "rounded-box border border-base-300 bg-base-100 text-base-content shadow-xl p-1"
        }, this.refs.list);

        this.root = div({ ...this.commonProperties, ...this.extraProperties },
            this.refs.control,
            this._name ? input({ type: "hidden", name: this._name, value: () => this.value.val ?? "" }) : null
        );

        this._syncInputText();
        return this.root;
    }

    /** @private the reactive list body: re-runs on query / options / value / loading */
    _renderList() {
        const query = this._query.val.trim().toLowerCase();
        this._version.val;              // dependency: setOptions / fetch results
        const selected = this.value.val;

        if (this._loading.val) {
            this._rows = [];
            return div({ class: "flex items-center gap-2 px-2 py-2 text-sm opacity-60" },
                span({ class: "loading loading-spinner loading-xs" }), $.t("common.searching"));
        }

        const matches = this._filter(query);
        if (!matches.length) {
            this._rows = [];
            return div({ class: "px-2 py-2 text-sm opacity-50" }, this._emptyText);
        }

        const rows = [];
        const nodes = [];
        let overflow = 0;
        let pendingSeparator = null;

        for (const option of matches) {
            if (option.separator) {
                pendingSeparator = option;             // only emitted if something follows
                continue;
            }
            if (rows.length >= this._maxVisible) { overflow++; continue; }
            if (pendingSeparator) {
                nodes.push(li({ role: "presentation", class: "px-2 pt-2 pb-1 text-xs uppercase opacity-60" },
                    pendingSeparator.label));
                pendingSeparator = null;
            }
            const index = rows.length;
            const node = this._renderRow(option, index, option.value === selected);
            rows.push({ option, node });
            nodes.push(node);
        }

        if (!rows.length) {                            // e.g. a list of nothing but headers
            this._rows = [];
            return div({ class: "px-2 py-2 text-sm opacity-50" }, this._emptyText);
        }

        if (overflow) {
            nodes.push(li({ role: "presentation", class: "px-2 py-2 text-xs opacity-60 italic" },
                $.t("common.moreRefineSearch", { count: overflow })));
        }

        this._rows = rows;
        // Every re-render invalidates the old index. Pre-arm the selected row when it
        // survived the filter, otherwise the first match, so a bare Enter takes the
        // obvious candidate instead of doing nothing.
        this._activeIndex = -1;
        const selectedRow = rows.findIndex(row => row.option.value === selected);
        this._setActive(rows.length ? Math.max(selectedRow, 0) : -1);

        return ul({ class: "menu menu-sm w-full p-0", role: "none" }, ...nodes);
    }

    /** @private */
    _renderRow(option, index, isSelected) {
        const icon = componentIconNode(option.icon);
        const check = new PhIcon({ name: "ph-check" }).create();
        check.classList.add("shrink-0", "text-primary");
        if (!isSelected) check.classList.add("invisible");

        return li({ role: "none" },
            a({
                id: `${this.id}-opt-${index}`,
                role: "option",
                "aria-selected": isSelected ? "true" : "false",
                "aria-disabled": option.disabled ? "true" : "false",
                tabindex: "-1",
                class: "flex items-center gap-2 rounded-md px-2 py-1 "
                    + (option.disabled ? "opacity-50 select-none cursor-default pointer-events-none" : "cursor-pointer"),
                title: option.description || option.label,
                // mousedown, not click: the input keeps focus and the popup does not
                // flicker through a blur/refocus cycle before the value lands.
                onmousedown: (e) => {
                    e.preventDefault();
                    if (option.disabled) return;
                    this._select(option);
                }
            },
                check,
                icon ? icon.create() : null,
                div({ class: "flex-1 min-w-0" },
                    div({ class: "truncate" }, option.label),
                    option.description ? div({ class: "text-xs opacity-60 truncate" }, option.description) : null
                )
            )
        );
    }

    /* ------------------------------------------------------------- behavior */

    /** @private prefix matches first, then substring; separators kept in place */
    _filter(query) {
        if (!query) return this._all;
        const scored = [];
        for (const option of this._all) {
            if (option.separator) continue;            // headers are meaningless in a filtered list
            const label = option.label.toLowerCase();
            const haystack = `${label} ${option.keywords} ${option.value}`.toLowerCase();
            const at = haystack.indexOf(query);
            if (at < 0) continue;
            scored.push({ option, rank: label.startsWith(query) ? 0 : 1 });
        }
        scored.sort((a, b) => a.rank - b.rank);        // Array#sort is stable: ties keep author order
        return scored.map(entry => entry.option);
    }

    /** @private */
    _onQueryInput(text) {
        this._query.val = text;
        this._onInput(text);
        if (!this.isOpen.val) this.open({ resetQuery: false });
        if (this._fetchOptions) this._scheduleFetch(text.trim());
    }

    /** @private */
    _onKeyDown(e) {
        switch (e.key) {
            case "ArrowDown":
            case "ArrowUp": {
                e.preventDefault();
                if (!this.isOpen.val) { this.open(); return; }
                const step = e.key === "ArrowDown" ? 1 : -1;
                const count = this._rows.length;
                if (!count) return;
                const from = this._activeIndex < 0 ? (step > 0 ? -1 : 0) : this._activeIndex;
                this._setActive((from + step + count) % count);
                return;
            }
            case "Home":
            case "End":
                if (!this.isOpen.val || !this._rows.length) return;
                e.preventDefault();
                this._setActive(e.key === "Home" ? 0 : this._rows.length - 1);
                return;
            case "Enter": {
                if (!this.isOpen.val) return;
                e.preventDefault();
                const row = this._rows[this._activeIndex];
                if (row && !row.option.disabled) this._select(row.option);
                else if (this._allowCustom) this._commitCustom(this._query.val.trim());
                return;
            }
            case "Escape":
                if (!this.isOpen.val) return;
                // Swallow it: an open popup owns Escape, the app-level handler does not.
                e.preventDefault();
                e.stopPropagation();
                this.close();
                return;
            case "Tab":
                if (this._allowCustom && this._query.val.trim()) this._commitCustom(this._query.val.trim());
                this.close();
                return;
            default:
        }
    }

    /** @private */
    _setActive(index) {
        const previous = this._rows[this._activeIndex];
        if (previous) this._markActive(previous.node, false);

        this._activeIndex = index >= 0 && index < this._rows.length ? index : -1;
        const current = this._rows[this._activeIndex];
        if (!current) {
            this.refs.input?.removeAttribute("aria-activedescendant");
            return;
        }
        this._markActive(current.node, true);
        this.refs.input?.setAttribute("aria-activedescendant", `${this.id}-opt-${this._activeIndex}`);
        current.node.firstChild?.scrollIntoView?.({ block: "nearest" });
    }

    /** @private */
    _markActive(node, on) {
        node.firstChild?.classList.toggle("bg-base-300", on);
    }

    /** @private */
    _select(option) {
        const changed = option.value !== this.value.val;
        this.value.val = option.value;
        this.close();
        if (changed) this._emitChange();
    }

    /** @private free text committed as its own value (allowCustom) */
    _commitCustom(text) {
        if (!text) return;
        const known = this._all.find(o => !o.separator && o.label.toLowerCase() === text.toLowerCase());
        if (known) { this._select(known); return; }
        const changed = text !== this.value.val;
        this.value.val = text;
        this.close();
        if (changed) this._emitChange();
    }

    /** @private */
    _clear() {
        if (this.value.val === null) return;
        this.value.val = null;
        this._syncInputText();
        this._emitChange();
    }

    /** @private */
    _emitChange() {
        this._onChange(this.value.val, this.getSelected());
    }

    /** @private */
    _optionOf(value) {
        if (value === null || value === undefined) return null;
        return this._all.find(o => !o.separator && o.value === value)
            || this._static.find(o => !o.separator && o.value === value)
            || null;
    }

    /** @private the text field mirrors the selection whenever the user is not typing */
    _syncInputText() {
        const element = this.refs.input;
        if (!element) return;
        const value = this.value.val;
        element.value = value === null ? "" : (this._optionOf(value)?.label ?? value);
    }

    /** @private */
    _place() {
        if (!this.root || !this.refs.panel) return;
        // Match the control width; the popup may still grow taller and flip upwards.
        this.refs.panel.style.width = `${this.root.offsetWidth}px`;
        placeFixedAnchored(this.root, this.refs.panel, { placement: "bottom", margin: 4 });
    }

    /* ---------------------------------------------------------- async source */

    /** @private */
    _scheduleFetch(query) {
        this._cancelFetch();
        if (!query) {                                   // empty query falls back to the static list
            this._all = this._static;
            this._version.val++;
            return;
        }
        this._fetchTimer = setTimeout(() => {
            this._fetchTimer = null;
            this._runFetch(query);
        }, this._fetchDebounceMs);
    }

    /** @private */
    async _runFetch(query) {
        const controller = new AbortController();
        this._fetchAbort = controller;
        this._loading.val = true;
        try {
            const result = await this._fetchOptions(query, { signal: controller.signal });
            if (controller.signal.aborted) return;
            this._all = Autocomplete.normalizeOptions(result);
            this._version.val++;
        } catch (e) {
            if (controller.signal.aborted) return;
            console.warn("Autocomplete: option provider failed", e);
            this._all = [];
            this._version.val++;
        } finally {
            if (this._fetchAbort === controller) {
                this._fetchAbort = null;
                this._loading.val = false;
            }
        }
    }

    /** @private */
    _cancelFetch() {
        if (this._fetchTimer) {
            clearTimeout(this._fetchTimer);
            this._fetchTimer = null;
        }
        if (this._fetchAbort) {
            this._fetchAbort.abort();
            this._fetchAbort = null;
            this._loading.val = false;
        }
    }

    /* ---------------------------------------------------------------- static */

    static generateCode() {
        return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

ui = globalThis.UI;

window["workspaceItem"] = new ui.Autocomplete({
    options: [
        { separator: true, label: "Stains" },
        { value: "he", label: "H&E", icon: "ph-drop", description: "Hematoxylin and eosin" },
        { value: "ihc", label: "IHC", icon: "ph-flask" },
        { value: "pas", label: "PAS", disabled: true },
    ],
    value: "he",
    onChange: (value, option) => console.log("selected", value, option)
});

window["workspaceItem"].attachTo(document.getElementById("workspace"));
`;
    }

    /**
     * Normalize loose option input (strings, `{text}`, `{label}`, ...) into records.
     * Unknown fields are dropped rather than passed through - the list can come from
     * a plugin/session payload (AGENTS.md §7 "validate on the deserialization side").
     * @param {Array<AutocompleteOption|string>} list
     * @returns {AutocompleteOption[]}
     */
    static normalizeOptions(list) {
        if (!Array.isArray(list)) return [];
        const result = [];
        for (const item of list) {
            if (item === null || item === undefined) continue;
            if (typeof item === "string" || typeof item === "number") {
                result.push({ value: String(item), label: String(item), icon: "", description: "", keywords: "", disabled: false });
                continue;
            }
            if (typeof item !== "object") continue;
            if (item.separator) {
                result.push({ separator: true, label: String(item.label ?? item.text ?? "") });
                continue;
            }
            const value = item.value ?? item.label ?? item.text;
            if (value === undefined || value === null) continue;
            result.push({
                value: String(value),
                label: String(item.label ?? item.text ?? value),
                icon: typeof item.icon === "string" ? item.icon : "",
                description: item.description !== undefined ? String(item.description) : "",
                keywords: item.keywords !== undefined ? String(item.keywords) : "",
                disabled: item.disabled === true
            });
        }
        return result;
    }

    /**
     * Progressive-enhancement path for a plain `<select>` (what BVSelect did): reads
     * its options, hides it, and mounts the combobox right after it. The native
     * element stays the form value holder and receives a `change` event on selection.
     * `remove()` restores it.
     *
     * @param {HTMLSelectElement|string} selectElement element or its id
     * @param {object} [options] the usual constructor options; `options`/`value` are derived
     * @returns {Autocomplete|null} null when the element cannot be resolved
     */
    static fromSelect(selectElement, options = {}) {
        const element = typeof selectElement === "string"
            ? document.getElementById(selectElement) : selectElement;
        if (!element || element.tagName !== "SELECT") {
            console.error("Autocomplete.fromSelect: not a <select>", selectElement);
            return null;
        }

        const list = Array.from(element.options).map(o => (o.dataset.separator === "true"
            ? { separator: true, label: o.text }
            : {
                value: o.value,
                label: o.text,
                icon: o.dataset.icon || o.dataset.img || "",
                disabled: o.disabled
            }));

        const userOnChange = typeof options.onChange === "function" ? options.onChange : null;
        const component = new Autocomplete({
            ...options,
            options: list,
            value: element.value || null,
            onChange: (value, option) => {
                element.value = value ?? "";
                element.dispatchEvent(new Event("change", { bubbles: true }));
                userOnChange?.(value, option);
            }
        });
        component._nativeSelect = element;

        element.style.display = "none";
        element.insertAdjacentElement("afterend", component.create());
        return component;
    }
}
