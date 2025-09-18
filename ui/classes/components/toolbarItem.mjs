import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div, button, span } = van.tags;

/**
 * ToolbarItem
 *
 * options:
 *  - mode: "select" | "menu" (default: "menu")
 *  - icon: Node|string                 // collapsed button content (used when no selection or mode "menu")
 *  - label: string                     // aria-label/title for the collapsed trigger
 *  - size: number                      // square size in px (default 32)
 *  - trigger: "hover" | "click" | "both" (default "both")
 *  - items:                            // used when mode === "select"
 *      Array<{
 *        id: string,
 *        label?: string,
 *        icon?: Node|string,
 *        content?: Node|string,        // optional richer preview in submenu (falls back to icon/label button)
 *        selected?: boolean,
 *        onSelect?: (id) => void
 *      }>
 *  - menu: Node[] | string[]           // used when mode === "menu": arbitrary submenu content (buttons, divs, etc.)
 *  - extraClasses?: {
 *        base?, trigger?, dropdown?, dropdownContent?, menuItem?
 *    }
 *  - on?: {
 *        select?: ({id, item}) => void,
 *        open?: () => void,
 *        close?: () => void
 *    }
 *
 * Behavior:
 *  - Emits/handles "toolbar:measure" to flip dropdown direction:
 *      horizontal -> open bottom; vertical -> open right
 *  - Square trigger via explicit w/h equal to size (default 32px)
 *  - Select mode updates collapsed trigger (icon/label) after selection
 */
export class ToolbarItem extends BaseComponent {
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;

        // config
        this.mode = options.mode === "select" ? "select" : "menu";
        this.icon = options.icon ?? "⋯";
        this.label = options.label ?? "More";
        this.size = Number.isFinite(options.size) ? options.size : 32;
        this.triggerMode = options.trigger ?? "both";
        this.items = Array.isArray(options.items) ? options.items.slice() : [];
        this.menu = Array.isArray(options.menu) ? options.menu.slice() : (typeof options.menu === "string" ? [options.menu] : []);

        this._dir = "horizontal"; // set via toolbar:measure
        this._open = false;

        this._selectedId = null;
        if (this.mode === "select") {
            const preset = this.items.find(it => it && it.selected);
            if (preset) this._selectedId = preset.id;
        }

        // classes
        this.classMap.base = options.extraClasses?.base || "";
        this.classMap.trigger = options.extraClasses?.trigger || "btn btn-ghost btn-xs rounded-md";
        this.classMap.dropdown = options.extraClasses?.dropdown || "";
        this.classMap.dropdownContent = options.extraClasses?.dropdownContent || "menu bg-base-200 rounded-box shadow p-1";
        this.classMap.menuItem = options.extraClasses?.menuItem || "btn btn-ghost btn-xs rounded-md";

        this._on = options.on || {};
    }

    /** public api */
    getSelected() { return this._selectedId; }
    setSelected(id) {
        if (this.mode !== "select") return;
        const it = this.items.find(x => x?.id === id);
        if (!it) return;
        this._selectedId = id;
        this._renderCollapsedVisual();
        it.onSelect?.(id);
        this._on?.select?.({ id, item: it });
    }

    open(v = true)  { this._toggle(v); }
    close(v = true) { this._toggle(!v); }
    toggle()        { this._toggle(); }

    _toggle(open) {
        const root = document.getElementById(this.id);
        const dd = root?.querySelector(".dropdown");
        if (!dd) return;
        this._open = (typeof open === "boolean") ? open : !this._open;
        dd.classList.toggle("dropdown-open", this._open);
        this._open ? this._on?.open?.() : this._on?.close?.();
    }

    afterAttach() {
        const root = document.getElementById(this.id);
        if (!root) return;

        const triggerEl = root.querySelector("[data-trigger]");
        if (this.triggerMode === "hover" || this.triggerMode === "both") {
            root.addEventListener("mouseenter", () => this.open(true));
            root.addEventListener("mouseleave", () => this.close(true));
        }
        if (this.triggerMode === "click" || this.triggerMode === "both") {
            triggerEl?.addEventListener("click", () => this.toggle());
        }

        // Orientation hint from Toolbar wrapper
        root.addEventListener("toolbar:measure", (e) => {
            const { dir, size } = e.detail || {};
            if (dir) this._dir = dir;
            if (Number.isFinite(size)) this.size = size;
            this._applyDirClasses();
            this._applySquareSize();
        });

        // Initial sizing/dir
        this._applyDirClasses();
        this._applySquareSize();
        this._renderCollapsedVisual(); // reflect selection if any
    }

    _applySquareSize() {
        const root = document.getElementById(this.id);
        if (!root) return;
        const s = `${this.size}px`;
        const trg = root.querySelector("[data-trigger]");
        const dro = root.querySelector("[data-dropdown-content]");
        // trigger square button
        if (trg) {
            trg.style.width = s;
            trg.style.height = s;
            trg.style.padding = "0px";
            trg.classList.add("inline-grid", "place-items-center", "aspect-square");
        }
        // menu item squares (only for "select" where we layout icons as squares)
        if (this.mode === "select" && dro) {
            dro.querySelectorAll("[data-menu-item]").forEach(el => {
                el.style.width = s;
                el.style.height = s;
                el.classList.add("inline-grid", "place-items-center", "aspect-square");
            });
        }
    }

    _applyDirClasses() {
        const root = document.getElementById(this.id);
        if (!root) return;
        const dd = root.querySelector(".dropdown");
        const dc = root.querySelector("[data-dropdown-content]");
        if (!dd || !dc) return;

        dd.classList.remove("dropdown-bottom", "dropdown-right");
        if (this._dir === "horizontal") {
            dd.classList.add("dropdown-bottom");
            dc.classList.remove("ml-1"); dc.classList.add("mt-1");
            dc.classList.remove("flex-col"); dc.classList.add("flex-row");
        } else {
            dd.classList.add("dropdown-right");
            dc.classList.remove("mt-1"); dc.classList.add("ml-1");
            dc.classList.remove("flex-row"); dc.classList.add("flex-col");
        }
    }

    _renderCollapsedVisual() {
        const root = document.getElementById(this.id);
        if (!root) return;
        const trg = root.querySelector("[data-trigger-content]");
        if (!trg) return;

        if (this.mode === "select" && this._selectedId) {
            const it = this.items.find(x => x?.id === this._selectedId);
            if (it?.icon) {
                trg.innerHTML = ""; // clear
                if (typeof it.icon === "string") trg.innerHTML = it.icon;
                else try { trg.appendChild(it.icon); } catch { trg.textContent = ""; trg.append(it.icon); }
                if (it.label) root.querySelector("[data-trigger]")?.setAttribute("title", it.label);
                return;
            }
            if (it?.label) {
                trg.textContent = it.label;
                root.querySelector("[data-trigger]")?.setAttribute("title", it.label);
                return;
            }
        }

        // default icon/label
        trg.innerHTML = "";
        if (typeof this.icon === "string") trg.innerHTML = this.icon;
        else try { trg.appendChild(this.icon); } catch { trg.textContent = ""; trg.append(this.icon); }
        if (this.label) root.querySelector("[data-trigger]")?.setAttribute("title", this.label);
    }

    _renderSelectMenuItems() {
        const s = `${this.size}px`;
        return this.items.map(it => {
            const isSel = (this._selectedId === it.id);
            const content = it.content
                ? it.content
                : (it.icon || it.label || "•");

            // wrap content into a square button
            const btn = button({
                type: "button",
                "data-menu-item": "",
                class: `${this.classMap.menuItem} ${isSel ? "btn-active" : ""}`,
                title: it.label || "",
                onclick: () => {
                    this.setSelected(it.id);
                    // keep open on hover-only; close on click if trigger mode includes click
                    if (this.triggerMode !== "hover") this.close(true);
                }
            });
            // inject content
            if (typeof content === "string") btn.innerHTML = content; else try { btn.appendChild(content); } catch { btn.append(content); }
            // square
            btn.style.width = s; btn.style.height = s;
            btn.classList.add("inline-grid", "place-items-center", "aspect-square");

            return btn;
        });
    }

    _renderGenericMenu() {
        // leave content as provided; user can supply buttons/list/etc.
        // we do minimal wrapping to keep Daisy dropdown styling
        return this.menu.map(n => {
            if (typeof n === "string") return div({ class: "px-2 py-1 text-sm" }, n);
            return n;
        });
    }

    create() {
        // collapsed trigger
        const triggerBtn = button({
            type: "button",
            "data-trigger": "",
            "aria-label": this.label || "More",
            class: `${this.classMap.trigger} inline-grid place-items-center aspect-square`,
            title: this.label || ""
        }, div({ "data-trigger-content": "" }));

        // dropdown content
        const contentNodes = (this.mode === "select")
            ? this._renderSelectMenuItems()
            : this._renderGenericMenu();

        const dropdownContent = div({
            "data-dropdown-content": "",
            class: `dropdown-content ${this.classMap.dropdownContent} ${this._dir === "horizontal" ? "mt-1" : "ml-1"} flex ${this._dir === "horizontal" ? "flex-row" : "flex-col"} gap-1`,
            tabIndex: 0
        }, ...contentNodes);

        // dropdown wrapper
        const dropdown = div({
            class: `dropdown ${this.classMap.dropdown} ${this._dir === "horizontal" ? "dropdown-bottom" : "dropdown-right"}`
        }, triggerBtn, dropdownContent);

        // base container (square sizing applied in afterAttach)
        return div({ ...this.commonProperties, class: this.classMap.base }, dropdown);
    }
}
