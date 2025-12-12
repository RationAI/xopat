import van from "../../vanjs.mjs";
import {BaseComponent, BaseSelectableComponent} from "../baseComponent.mjs";
import {Button} from "./buttons.mjs";
import {FAIcon} from "./fa-icon.mjs";

const { div, ul, li, a, span, i } = van.tags;

class Dropdown extends BaseSelectableComponent {
    constructor(options = undefined, ..._children /* ignored */) {
        options = super(options).options;
        this.title = options["title"] || "";
        this.icon = options["icon"] || "";
        this.parentId = options["parentId"] || "";
        this.onClick = options["onClick"] || (() => {});
        this._fmToken = null;
        this.classMap["base"] = "dropdown join-item";

        // NEW: Selection Style ('highlight' | 'check')
        this.selectionStyle = options.selectionStyle || "highlight";

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
            : null;

        this.closeOnItemClick = options.closeOnItemClick ?? true;
        this.widthClass = options.widthClass || "w-52";
        this.placement = options.placement || "auto";
        this.splitHeader = options.splitHeader === true;

        this.onHeaderMainClick = options.onHeaderMainClick || null;
        this.onHeaderArrowClick = options.onHeaderArrowClick || null;

        this._headerIconComp = null;
        this._headerLabelSpan = null;

        this.headerButton = this.createButton(options);
        this._contentEl = null;
        this._sectionMap = new Map();

        // --- Nested Menu State ---
        this._activeSubmenu = null;
        this._submenuTimeout = null;
        this._isHoveringParent = false;
        this._isHoveringSubmenu = false;
    }

    createButton() {
        const inIcon = (this.icon instanceof BaseComponent)
            ? this.icon
            : new FAIcon({ name: this.icon });

        this._headerIconComp = inIcon;
        this._headerLabelSpan = span(this.title);

        this._dropdownIcon = this._useActiveSelection ? i(
            { "data-dropdown-arrow": "1", class: "ml-1" },
            new FAIcon({ name: "fa-caret-down" }).create()
        ) : undefined;

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
        this._closeSubmenu();
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

    /** Helper to schedule closing. */
    _scheduleSubmenuCheck() {
        if (this._submenuTimeout) clearTimeout(this._submenuTimeout);

        this._submenuTimeout = setTimeout(() => {
            if (!this._isHoveringParent && !this._isHoveringSubmenu) {
                this._closeSubmenu();
            }
        }, 200);
    }

    _closeSubmenu() {
        if (this._submenuTimeout) clearTimeout(this._submenuTimeout);

        // Reset flags
        this._isHoveringParent = false;
        this._isHoveringSubmenu = false;

        if (this._activeSubmenu) {
            // Remove highlight from the parent item
            if (this._activeSubmenu.anchorEl) {
                const link = this._activeSubmenu.anchorEl.querySelector('a');
                if (link) link.classList.remove('bg-base-300');
            }

            if (this._activeSubmenu.token) {
                UI.Services.FloatingManager.unregister(this._activeSubmenu.token);
            }
            if (this._activeSubmenu.el) {
                this._activeSubmenu.el.remove();
            }
            this._activeSubmenu = null;
        }
    }

    _open(trigger, place) {
        if (this._isOpen) {
            if (this._fmToken) UI.Services.FloatingManager.bringToFront(this._fmToken);
            return;
        }
        if (this._isOpen) { this.close(); return; }
        this._isOpen = true;

        if (this._contentEl && this._contentEl.parentNode !== document.body) {
            document.body.appendChild(this._contentEl);
        }

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
        if (this._headerLabelSpan && typeof item.label === "string") {
            this._headerLabelSpan.textContent = item.label;
        }
        const btnEl = document.getElementById(this.headerButton.id);
        if (btnEl && typeof item.label === "string") {
            btnEl.title = item.label;
        }
        if (this._headerIconComp instanceof FAIcon && typeof item.icon === "string") {
            this._headerIconComp.changeIcon(item.icon);
        }
    }
    _removeFocus() {}

    /* ---------------- public API ---------------- */

    addSection({ id, title = "", order = 0 }) {
        const i = this.sections.findIndex(s => s.id === id);
        if (i >= 0) { this.sections[i].title = title; this.sections[i].order = order; }
        else this.sections.push({ id, title, order });
        this.sections.sort((a,b)=>(a.order||0)-(b.order||0));
        this._rebuildContent();
    }

    _ensureSection(sectionId, title = "") {
        if (!this.sections.some(s => s.id === sectionId)) {
            const maxOrder = Math.max(0, ...this.sections.map(s => s.order ?? 0));
            this.sections.push({ id: sectionId, title, order: maxOrder + 1 });
        }
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
            this._contentEl.appendChild(div({ class: "mx-1 my-1 border-t border-base-300/70" }));
        }
        this._sectionMap.set(sectionId, listEl);
        return listEl;
    }

    addItem(item, sectionTitleIfNew = "") {
        const secId = item.section || this.sections[0]?.id || "default";
        const target = this._ensureSection(secId, sectionTitleIfNew) || this._sectionMap.get(this.sections[0].id);
        const node = this._renderItem({ ...item, section: secId });
        if (target) target.appendChild(node);
        this.items[item.id] = { ...item, section: secId };
    }

    getItem(id) { return this.items[id]; }

    setSelected(id) {
        this.selectedId = id;

        // Helper to update any row with this ID
        const updateNode = (node) => {
            const isTarget = node.getAttribute("data-item-id") === id;

            // Check if this row was rendered with a check icon
            const checkEl = node.querySelector(".check-icon");
            const isCheckStyle = !!checkEl;

            // 1. Update Accessibility
            node.setAttribute("aria-current", isTarget ? "true" : "false");

            // 2. Toggle Background Highlight (ONLY if NOT check style)
            if (!isCheckStyle) {
                node.classList.toggle("bg-primary/20", isTarget);
                node.classList.toggle("text-primary-content", isTarget);
            }

            // 3. Toggle Checkmark Visibility (ONLY if check style)
            if (isCheckStyle) {
                if (isTarget) checkEl.classList.remove("invisible");
                else checkEl.classList.add("invisible");
            }
        };

        // Update items in the root menu
        if (this._contentEl) {
            this._contentEl.querySelectorAll(`[data-item-id]`).forEach(updateNode);
        }

        // Update items in the active submenu (if open)
        if (this._activeSubmenu && this._activeSubmenu.el) {
            this._activeSubmenu.el.querySelectorAll(`[data-item-id]`).forEach(updateNode);
        }

        // Update Header
        if (this._useActiveSelection && id && this.items[id]) {
            this.activeSelectionId = id;
            this._updateHeaderFromItem(this.items[id]);
        }
    }

    /* ---------------- rendering ---------------- */

    _renderIcon(icon) {
        return new FAIcon({name: icon}).create();
    }

    _renderItem(item, styleOverride = null) {
        // Determine effective style (Parent override > Global default)
        const activeStyle = styleOverride || this.selectionStyle;
        const isCheckStyle = activeStyle === "check";

        const selected = (this.selectedId && this.selectedId === item.id) || item.selected;
        const hasChildren = Array.isArray(item.children) && item.children.length > 0;
        const self = this;

        const attrs = {
            role: "menuitem",
            "data-item-id": item.id,
            "aria-current": selected ? "true" : "false",
            tabindex: "-1",
            href: item.href || undefined,
            class: [
                "flex items-center gap-3 rounded-md px-3 py-2",
                "hover:bg-base-300 focus:bg-base-300",
                // Highlight background ONLY if NOT in check mode
                (selected && !isCheckStyle) ? "bg-primary/20 text-primary-content" : "",
                item.pluginRootClass || "",
            ].join(" "),
            onclick: (e) => {
                if (!item.href) e.preventDefault();
                if (hasChildren) return;

                const keepOpen = item.onClick?.(e, item) === true;
                if (self._useActiveSelection) {
                    self.setSelected(item.id);
                }
                if (self.closeOnItemClick && !keepOpen) self.close();
            }
        };

        // --- Left Icon Slot ---
        let leftIconSlot;
        if (isCheckStyle) {
            // Always create check icon, toggle visibility via class
            const checkIcon = new FAIcon({name: "fa-check"}).create();
            checkIcon.classList.add("check-icon"); // Marker class for setSelected
            if (!selected) checkIcon.classList.add("invisible");

            leftIconSlot = div({class: "w-5 text-center text-primary"}, checkIcon);
        } else {
            leftIconSlot = this._renderIcon(item.icon);
        }

        const labelBlock = div({ class: "flex-1 min-w-0" },
            typeof item.label === "string" ? span({ class: "truncate" }, item.label) : this.toNode(item.label),
            item.sub ? div({ class: "text-xs opacity-60 truncate" }, this.toNode(item.sub)) : null
        );

        // --- Right Side Slot ---
        let rightSide = null;
        if (hasChildren) {
            const chevron = new FAIcon({ name: "fa-chevron-right" }).create();
            if (isCheckStyle && item.icon) {
                // Check mode: Icon + Chevron
                rightSide = span({ class: "text-xs opacity-60 flex items-center gap-2" },
                    this._renderIcon(item.icon), chevron
                );
            } else {
                rightSide = span({ class: "text-xs opacity-60" }, chevron);
            }
        } else if (item.kbd) {
            rightSide = span({ class: "text-xs opacity-60" }, item.kbd);
        } else if (isCheckStyle && item.icon) {
            // Check mode: Move icon to right
            rightSide = span({ class: "text-xs opacity-60" }, this._renderIcon(item.icon));
        }

        const liEl = li(
            { role: "none", class: "relative" },
            a(attrs, leftIconSlot, labelBlock, rightSide)
        );

        // --- Hover Events (Standard) ---
        if (hasChildren) {
            liEl.addEventListener("mouseenter", () => {
                self._isHoveringParent = true;
                if (self._activeSubmenu?.parentId === item.id) {
                    self._scheduleSubmenuCheck();
                    return;
                }
                self._openSubmenu(item, liEl);
            });
            liEl.addEventListener("mouseleave", () => {
                self._isHoveringParent = false;
                self._scheduleSubmenuCheck();
            });
        } else {
            liEl.addEventListener("mouseenter", () => {
                self._isHoveringParent = false;
                self._scheduleSubmenuCheck();
            });
        }

        return liEl;
    }

    _openSubmenu(parentItem, anchorEl) {
        this._closeSubmenu();

        // Highlight parent anchor
        const link = anchorEl.querySelector('a');
        if (link) link.classList.add('bg-base-300');

        const submenuEl = div({
            class: "dropdown-content bg-base-200 text-base-content rounded-box shadow-xl border border-base-300 absolute w-52 max-w-full min-w-max z-[9999]",
            style: "display: block;"
        });

        // Determine style for this specific submenu
        const submenuStyle = parentItem.childSelectionStyle || this.selectionStyle;

        const listEl = ul({ class: "menu bg-transparent p-0", role: "none" },
            ...parentItem.children.map(child => this._renderItem(child, submenuStyle))
        );
        submenuEl.appendChild(listEl);

        // ... rest of the positioning and event logic (unchanged) ...

        // Append to container
        if (this._contentEl) this._contentEl.appendChild(submenuEl);
        else document.body.appendChild(submenuEl);

        // Events
        submenuEl.addEventListener("mouseenter", () => {
            this._isHoveringSubmenu = true;
            this._scheduleSubmenuCheck();
        });
        submenuEl.addEventListener("mouseleave", () => {
            this._isHoveringSubmenu = false;
            this._scheduleSubmenuCheck();
        });

        // Positioning logic (simplified for brevity, keep your existing logic)
        const anchorRect = anchorEl.getBoundingClientRect();
        const containerRect = this._contentEl ? this._contentEl.getBoundingClientRect() : document.body.getBoundingClientRect();

        // ... (Keep your existing positioning calculations here) ...
        // For brevity, assuming standard positioning logic:
        let left = (anchorRect.right - containerRect.left) - 5;
        let top = (anchorRect.top - containerRect.top) - 5;
        // Check bounds...
        const submenuWidth = 208;
        if (anchorRect.right + submenuWidth > window.innerWidth) {
            left = (anchorRect.left - containerRect.left) - submenuWidth + 5;
        }
        submenuEl.style.left = `${left}px`;
        submenuEl.style.top = `${top}px`;

        const token = UI.Services.FloatingManager.register({
            el: submenuEl,
            owner: this,
            onEscape: () => this._closeSubmenu()
        });

        this._activeSubmenu = {
            el: submenuEl,
            token: token,
            parentId: parentItem.id,
            anchorEl: anchorEl
        };
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
        const bySection = new Map(this.sections.map(s => [s.id, []]));
        for (const i in this.items) {
            const it = this.items[i];
            const sec = it.section && bySection.has(it.section) ? it.section : this.sections[0].id;
            bySection.get(sec).push(it);
        }
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
                "max-w-full min-w-max"
            ].join(" "),
            style: "position: absolute; visibility: hidden;"
        });

        this._rebuildContent();

        if (this._useActiveSelection && this.activeSelectionId && this.items[this.activeSelectionId]) {
            this.setSelected(this.activeSelectionId);
        }

        const place = () => {
            const host = trigger.firstChild || trigger;
            const menu = this._contentEl;
            if (!menu) return;

            let container = host.closest("[data-toolbar-root]");
            if (!container) container = host.offsetParent || host.parentElement || document.body;

            const cs = getComputedStyle(container);
            if (cs.position === "static") {
                container.style.position = "relative";
            }

            if (menu.parentNode !== container) {
                container.appendChild(menu);
            }

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
            const placement = this.placement;

            let openRight;
            if (placement === "right") {
                openRight = true;
            } else if (placement === "below") {
                openRight = false;
            } else {
                openRight = verticalToolbar;
            }

            let left, top;
            if (openRight) {
                left = (hostRect.right - contRect.left) + margin;
                top  = (hostRect.top   - contRect.top);
            } else {
                left = (hostRect.left   - contRect.left);
                top  = (hostRect.bottom - contRect.top) + margin;
            }

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

            const target = (e.target);
            const isArrow = !!target.closest?.("[data-dropdown-arrow='1']");

            if (this.splitHeader) {
                if (isArrow) {
                    if (typeof this.onHeaderArrowClick === "function") {
                        try {
                            this.onHeaderArrowClick(e);
                        } catch (err) {
                            console.error("Dropdown onHeaderArrowClick handler failed:", err);
                        }
                    }
                    this._open(trigger, place);
                } else {
                    if (typeof this.onHeaderMainClick === "function") {
                        try {
                            this.onHeaderMainClick(e);
                        } catch (err) {
                            console.error("Dropdown onHeaderMainClick handler failed:", err);
                        }
                    } else if (typeof this.onClick === "function") {
                        try {
                            this.onClick(e);
                        } catch (err) {
                            console.error("Dropdown onClick handler failed:", err);
                        }
                    }
                }
            } else {
                if (typeof this.onClick === "function") {
                    try {
                        this.onClick(e);
                    } catch (err) {
                        console.error("Dropdown onClick handler failed:", err);
                    }
                }
                this._open(trigger, place);
            }
        });

        return div({ ...this.commonProperties, onclick: this.onClick, ...this.extraProperties }, trigger, this._contentEl);
    }
}

export { Dropdown };
