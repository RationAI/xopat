import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { Button } from "./buttons.mjs";
import { FAIcon } from "./fa-icon.mjs";

const { div, ul, li, a, span } = van.tags;

/**
 * Items API
 * {
 *   id: string,
 *   label: string|Node,
 *   sub?: string|Node,         // small secondary text (path) shown under label (optional)
 *   icon?: string|Node,        // material icon name or Node
 *   kbd?: string,              // small hint on the right
 *   section?: string,          // section id/title
 *   selected?: boolean,
 *   href?: string,
 *   onClick?: (ev, item) => void|boolean, // return true to keep menu open
 * }
 *
 * Sections API (optional upfront; will be auto-created on insert)
 * [{ id: "Open Projects", title: "Open Projects", order?: number }]
 *
 * todo share API with menu tab!
 */
class Dropdown extends BaseComponent {
    // todo:  _children? use instead of items...
    constructor(options = undefined, ..._children /* ignored */) {
        options = super(options).options;
        // existing options kept
        this.title = options["title"] || "";
        this.icon = options["icon"] || "";
        this.parentId = options["parentId"] || "";
        this.onClick = options["onClick"] || (() => {});

        this.items = {}
        if (Array.isArray(options.items)) {
            for (let item of options.items) {
                this.items[item.id] = item;
            }
        }
        this.sections = (options.sections || []).slice().sort((a,b)=>(a.order||0)-(b.order||0));
        if (!this.sections.length) this.sections = [{ id: "default", title: "" }];

        this.selectedId = null; // todo find selection! this.items.find(i => i.selected)?.id ||
        this.closeOnItemClick = options.closeOnItemClick ?? true;
        this.widthClass = options.widthClass || "w-52";
        this.headerButton = this.createButton(options);
        this._contentEl = null;            // dropdown-content container
        this._sectionMap = new Map();      // sectionId -> UL element
    }

    /** keep old helper API */
    createButton() {
        const inIcon = (this.icon instanceof BaseComponent) ? this.icon : new FAIcon({ name: this.icon });
        const b = new Button({
            id: this.parentId + "-b-" + this.id,
            size: Button.SIZE.SMALL,
            extraProperties: { title: this.title },
        }, inIcon, span(this.title));
        return b;
    }
    iconOnly()   { this.headerButton.iconOnly();   }
    titleIcon()  { this.headerButton.titleIcon();  }
    titleOnly()  { this.headerButton.titleOnly();  }
    iconRotate() { this.headerButton.iconRotate(); }
    close() {}
    _removeFocus() {}

    /* ---------------- public API (new) ---------------- */

    addSection({ id, title = "", order = 0 }) {
        const i = this.sections.findIndex(s => s.id === id);
        if (i >= 0) { this.sections[i].title = title; this.sections[i].order = order; }
        else this.sections.push({ id, title, order });
        this.sections.sort((a,b)=>(a.order||0)-(b.order||0));
        this._rebuildContent();
    }

    /** Ensure section exists (state + DOM); returns its UL node */
    _ensureSection(sectionId, title = "") {
        // state
        if (!this.sections.some(s => s.id === sectionId)) {
            const maxOrder = Math.max(0, ...this.sections.map(s => s.order ?? 0));
            this.sections.push({ id: sectionId, title, order: maxOrder + 1 });
        }
        // DOM
        if (!this._contentEl) return null;
        let listEl = this._contentEl.querySelector(`ul[data-section="${sectionId}"]`);
        if (!listEl) {
            if (title) {
                this._contentEl.appendChild(
                    div({ class: "px-3 pt-2 pb-1 text-xs uppercase tracking-wide text-base-content/60" }, title)
                );
            }
            listEl = ul({ class: "menu bg-transparent p-0", role: "none", "data-section": sectionId });
            this._contentEl.appendChild(listEl);
            // divider after each filled section (visual like screenshot)
            this._contentEl.appendChild(div({ class: "mx-1 my-1 border-t border-base-300/70" }));
        }
        this._sectionMap.set(sectionId, listEl);
        return listEl;
    }

    /** Add item later; section auto-created if missing */
    addItem(item, sectionTitleIfNew = "") {
        const secId = item.section || this.sections[0]?.id || "default";
        const target = this._ensureSection(secId, sectionTitleIfNew) || this._sectionMap.get(this.sections[0].id);
        const node = this._renderItem({ ...item, section: secId });
        if (target) target.appendChild(node);
        this.items[item.id] = { ...item, section: secId };
    }

    getItem(id) {
        return this.items[id];
    }

    /** Insert at specific index inside a section */
    insertItem(sectionId, item, index = undefined, sectionTitleIfNew = "") {
        const target = this._ensureSection(sectionId, sectionTitleIfNew) || this._sectionMap.get(this.sections[0].id);
        const node = this._renderItem({ ...item, section: sectionId });
        if (target) {
            if (Number.isInteger(index) && index >= 0 && index < target.children.length) {
                target.insertBefore(node, target.children[index]);
            } else {
                target.appendChild(node);
            }
        }
        this.items[item.id] = { ...item, section: sectionId };
    }

    setSelected(id) {
        this.selectedId = id;
        if (!this._contentEl) return;
        this._contentEl.querySelectorAll("[data-item-id]").forEach(el => {
            const on = el.dataset.itemId === id;
            el.classList.toggle("bg-primary/20", on);
            el.classList.toggle("text-primary-content", on);
            el.setAttribute("aria-current", on ? "true" : "false");
        });
    }

    /* ---------------- rendering ---------------- */

    _renderIcon(icon) {
        return new FAIcon({name: icon}).create();
    }

    _renderItem(item) {
        const selected = (this.selectedId && this.selectedId === item.id) || item.selected;

        const attrs = {
            role: "menuitem",
            "data-item-id": item.id,
            "aria-current": selected ? "true" : "false",
            tabindex: "-1",
            href: item.href || undefined,
            class: [
                "flex items-center gap-3 rounded-md px-3 py-2",
                "hover:bg-base-300 focus:bg-base-300",
                selected ? "bg-primary/20 text-primary-content" : "",
            ].join(" "),
            onclick: (e) => {
                if (!item.href) e.preventDefault();
                const keepOpen = item.onClick?.(e, item) === true;
                if (this.closeOnItemClick && !keepOpen) {
                    const el = e.currentTarget;
                    setTimeout(() => el.blur(), 0);
                }
            }
        };

        // Row body (label + optional sub)
        const labelBlock = div({ class: "flex-1 min-w-0" },
            typeof item.label === "string" ? span({ class: "truncate" }, item.label) : this.toNode(item.label),
            item.sub ? div({ class: "text-xs opacity-60 truncate" }, this.toNode(item.sub)) : null
        );

        return li(
            { role: "none" },
            a(attrs,
                this._renderIcon(item.icon),
                labelBlock,
                item.kbd ? span({ class: "text-xs opacity-60" }, item.kbd) : null
            )
        );
    }

    _buildSectionBlock(section, itemsInSection) {
        const nodes = [];
        if (section.title) {
            nodes.push(
                div({ class: "px-3 pt-2 pb-1 text-xs uppercase tracking-wide text-base-content/60" }, section.title)
            );
        }
        const listEl = ul(
            { class: "menu bg-transparent p-0", role: "none", "data-section": section.id },
            ...itemsInSection.map(it => this._renderItem(it))
        );
        nodes.push(listEl);
        return { nodes, listEl };
    }

    _rebuildContent() {
        this.clear();

        // group items by section id (create bucket for any declared section)
        const bySection = new Map(this.sections.map(s => [s.id, []]));
        for (const i in this.items) {
            const it = this.items[i];
            const sec = it.section && bySection.has(it.section) ? it.section : this.sections[0].id;
            bySection.get(sec).push(it);
        }

        // render in declared order with thin dividers
        let firstBlock = true;
        for (const s of this.sections) {
            const group = bySection.get(s.id) || [];
            if (!group.length && !s.title) continue;
            if (!firstBlock) this._contentEl.appendChild(div({ class: "mx-1 my-1 border-t border-base-300/70" }));
            const { nodes, listEl } = this._buildSectionBlock(s, group);
            nodes.forEach(n => this._contentEl.appendChild(n));
            this._sectionMap.set(s.id, listEl);
            firstBlock = false;
        }
    }

    clear() {
        if (!this._contentEl) return;
        this._contentEl.innerHTML = "";
        this._sectionMap.clear();
    }

    create() {
        // trigger: keep original headerButton component
        const trigger = div({ tabindex: "0", class: "" }, this.headerButton.create());

        // dropdown content redesigned to match screenshot
        this._contentEl = div(
            {
                tabindex: "0",
                id: this.parentId + "-ul-" + this.id,
                class: [
                    "dropdown-content",
                    "bg-base-200 text-base-content rounded-box shadow-xl border border-base-300",
                    this.widthClass,
                    "max-w-full hover:bg-secondary-focus",
                ].join(" "),
                style: "position: fixed",
                onclick: (event) => { event.stopPropagation(); },
            }
        );

        // initial fill
        this._rebuildContent();

        // surface (keeps your original wrapper + onClick)
        return div(
            { class: "dropdown join-item", onclick: this.onClick },
            trigger,
            this._contentEl
        );
    }
}

export { Dropdown };
