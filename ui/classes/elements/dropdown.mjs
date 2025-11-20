import van from "../../vanjs.mjs";
import {BaseComponent, BaseSelectableComponent} from "../baseComponent.mjs";
import {Button} from "./buttons.mjs";
import {FAIcon} from "./fa-icon.mjs";

const { div, ul, li, a, span, i } = van.tags;

/**
 * Items API
 * {
 *   id: string,
 *   label: string|Node,
 *   sub?: string|Node,         // small secondary text (path) shown under label (optional)
 *   icon?: string|Node,        // font awesome icon name, or generic Node
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
class Dropdown extends BaseSelectableComponent {
    constructor(options = undefined, ..._children /* ignored */) {
        options = super(options).options;
        // existing options kept
        this.title = options["title"] || "";
        this.icon = options["icon"] || "";
        this.parentId = options["parentId"] || "";
        this.onClick = options["onClick"] || (() => {});
        this._fmToken = null;
        this.classMap["base"] = "dropdown join-item";

        this.items = {};
        if (Array.isArray(options.items)) {
            for (let item of options.items) {
                this.items[item.id] = item;
            }
        }
        this.sections = (options.sections || []).slice().sort((a,b)=>(a.order||0)-(b.order||0));
        if (!this.sections.length) this.sections = [{ id: "default", title: "" }];

        this._useActiveSelection = Object.prototype.hasOwnProperty.call(options, "activeSelection");
        this.activeSelectionId = options.activeSelection ?? null;

        this.selectedId = this._useActiveSelection
            ? (this.activeSelectionId || null)
            : null; // todo find selection! this.items.find(i => i.selected)?.id ||

        this.closeOnItemClick = options.closeOnItemClick ?? true;
        this.widthClass = options.widthClass || "w-52";

        // header helpers
        this._headerIconComp = null;
        this._headerLabelSpan = null;

        this.headerButton = this.createButton(options);
        this._contentEl = null;            // dropdown-content container
        this._sectionMap = new Map();      // sectionId -> UL element
    }

    /** keep old helper API */
    createButton() {
        const inIcon = (this.icon instanceof BaseComponent)
            ? this.icon
            : new FAIcon({ name: this.icon });

        this._headerIconComp = inIcon;
        this._headerLabelSpan = span(
            this.title
        );

        this._dropdownIcon = this._useActiveSelection ? i( { "data-dropdown-label": "1" },
            new FAIcon('fa-caret-down').create()) : undefined;

        return new Button({
            id: this.parentId + "-b-" + this.id,
            size: Button.SIZE.SMALL,
            extraProperties: {title: this.title, style: ""},
            extraClasses: {flex: "flex flex-col items-center"},
        }, inIcon, this._headerLabelSpan, this._dropdownIcon);
    }
    iconOnly() {
        this.headerButton.iconOnly();
        if (this._useActiveSelection) {
            this.headerButton.setExtraProperty("style", "min-width:58px;")
        }
        this._iconOnly = true;
    }
    titleIcon()  { this.headerButton.titleIcon();  }
    titleOnly()  { this.headerButton.titleOnly();  }
    iconRotate() { this.headerButton.iconRotate(); }
    close() {
        if (!this._isOpen) return;
        this._isOpen = false;
        if (this._contentEl) {
            this._contentEl.style.visibility = "hidden";
            this._contentEl.style.display = "none";
        }
        if (this._fmToken) {
            UI.Services.FloatingManager.unregister(this._fmToken);
            this._fmToken = null;
        }
    }
    _open(trigger, place) {
        if (this._isOpen) {
            // already open; just bring to front
            if (this._fmToken) UI.Services.FloatingManager.bringToFront(this._fmToken);
            return;
        }
        if (this._isOpen) { this.close(); return; }
        this._isOpen = true;

        // ensure in body so it positions against viewport
        if (this._contentEl && this._contentEl.parentNode !== document.body) {
            document.body.appendChild(this._contentEl);
        }

        // make measurable, place, then show
        this._contentEl.style.display = "block";
        place();


        queueMicrotask(() => {
            if (!this._isOpen) return;
            this._fmToken = UI.Services.FloatingManager.register({
                el: this._contentEl,
                owner: this,
                onEscape: "close",
                onOutsideClick: "close"
            });
            UI.Services.FloatingManager.bringToFront(this._fmToken);
        });
    }
    _updateHeaderFromItem(item) {
        if (!item) return;

        // text label
        if (this._headerLabelSpan && typeof item.label === "string") {
            this._headerLabelSpan.textContent = item.label;
        }

        // tooltip / title
        const btnEl = document.getElementById(this.headerButton.id);
        if (btnEl && typeof item.label === "string") {
            btnEl.title = item.label;
        }

        // icon
        if (this._headerIconComp instanceof FAIcon && typeof item.icon === "string") {
            this._headerIconComp.changeIcon(item.icon);
        }
    }
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

        // update list highlight
        if (this._contentEl) {
            this._contentEl
                .querySelectorAll("[data-item-id]")
                .forEach(li => {
                    const isSelected = li.getAttribute("data-item-id") === id;
                    li.setAttribute("aria-current", isSelected ? "true" : "false");
                    li.classList.toggle("bg-primary/20", isSelected);
                    li.classList.toggle("text-primary-content", isSelected);
                });
        }

        // if activeSelection mode is on, keep header in sync too
        if (this._useActiveSelection && id && this.items[id]) {
            this.activeSelectionId = id;
            this._updateHeaderFromItem(this.items[id]);
        }
    }

    // setSelected(id) {
    //     this.selectedId = id;
    //     if (!this._contentEl) return;
    //     this._contentEl.querySelectorAll("[data-item-id]").forEach(el => {
    //         const on = el.dataset.itemId === id;
    //         el.classList.toggle("bg-primary/20", on);
    //         el.classList.toggle("text-primary-content", on);
    //         el.setAttribute("aria-current", on ? "true" : "false");
    //     });
    // }
    //
    // setActiveSelection(id) {
    //     this.activeSelectionId = id;
    //     this.selectedId = id;
    //     this.setSelected(id);
    //
    //     const item = this.items[id];
    //     if (item) {
    //         this._updateHeaderFromItem(item);
    //     }
    // }

    /* ---------------- rendering ---------------- */

    _renderIcon(icon) {
        return new FAIcon({name: icon}).create();
    }

    _renderItem(item) {
        const selected = (this.selectedId && this.selectedId === item.id) || item.selected;

        const self = this; // capture component instance

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
                item.pluginRootClass || "",
            ].join(" "),
            onclick: (e) => {
                if (!item.href) e.preventDefault();

                const keepOpen = item.onClick?.(e, item) === true;

                if (self._useActiveSelection) {
                    self.setSelected(item.id);
                }

                if (self.closeOnItemClick && !keepOpen) self.close();
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
        const trigger = div({ tabindex: "0", class: "" }, this.headerButton.create());

        this._contentEl = div({
            tabindex: "0",
            id: this.parentId + "-ul-" + this.id,
            class: [
                "dropdown-content",
                "bg-base-200 text-base-content rounded-box shadow-xl border border-base-300",
                this.widthClass,
                "max-w-full"
            ].join(" "),
            style: "position: absolute; visibility: hidden;"
        });

        // Rebuild list
        this._rebuildContent();

        if (this._useActiveSelection && this.activeSelectionId && this.items[this.activeSelectionId]) {
            this.setSelected(this.activeSelectionId);
        }

        // ---- NEW: smart positioner ----
        const place = () => {
            const host = trigger.firstChild /* header button root */ || trigger;
            const menu = this._contentEl;

            if (!menu) return;

            // find anchor container – toolbar root if possible
            let container = host.closest("[data-toolbar-root]");
            if (!container) container = host.offsetParent || host.parentElement || document.body;

            // ensure positioned container so absolute children anchor to it
            const cs = getComputedStyle(container);
            if (cs.position === "static") {
                container.style.position = "relative";
            }

            // attach menu to that container
            if (menu.parentNode !== container) {
                container.appendChild(menu);
            }

            // reset for measurement
            menu.style.visibility = "hidden";
            menu.style.top = "0px";
            menu.style.left = "0px";

            const hostRect = host.getBoundingClientRect();
            const contRect = container.getBoundingClientRect();
            const mw = menu.offsetWidth;
            const mh = menu.offsetHeight;
            const margin = 6;

            const toolbarRoot = host.closest("[data-toolbar-root]");
            const verticalToolbar = !!toolbarRoot && toolbarRoot.classList.contains("flex-col");

// decide which side we *want* based on placement option
            const placement = this.placement; // "auto" | "below" | "right"

            let openRight;
            if (placement === "right") {
                openRight = true;
            } else if (placement === "below") {
                openRight = false;
            } else {
                // auto: keep your old behaviour – right in vertical toolbars, below otherwise
                openRight = verticalToolbar;
            }

            let left, top;
            if (openRight) {
                // open to the right of the trigger
                left = (hostRect.right - contRect.left) + margin;
                top  = (hostRect.top   - contRect.top);
            } else {
                // open below the trigger
                left = (hostRect.left   - contRect.left);
                top  = (hostRect.bottom - contRect.top) + margin;
            }

            // clamp to viewport so it doesn't overshoot the screen
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            let vpLeft = contRect.left + left;
            let vpTop  = contRect.top + top;

            if (vpLeft + mw > vw - margin) {
                const delta = (vpLeft + mw) - (vw - margin);
                left -= delta;
                vpLeft -= delta;
            }
            if (vpLeft < margin) {
                const delta = margin - vpLeft;
                left += delta;
                vpLeft += delta;
            }

            if (vpTop + mh > vh - margin) {
                const delta = (vpTop + mh) - (vh - margin);
                top -= delta;
                vpTop -= delta;
            }
            if (vpTop < margin) {
                const delta = margin - vpTop;
                top += delta;
                vpTop += delta;
            }

            menu.style.left = `${Math.round(left)}px`;
            menu.style.top  = `${Math.round(top)}px`;
            menu.style.visibility = "visible";
        };

        trigger.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (typeof this.onClick === "function") {
                try {
                    this.onClick(e);
                } catch (err) {
                    console.error("Dropdown onClick handler failed:", err);
                }
            }
            this._open(trigger, place);
        });

        return div({ ...this.commonProperties, onclick: this.onClick, ...this.extraProperties}, trigger, this._contentEl);
    }

}

export { Dropdown };
