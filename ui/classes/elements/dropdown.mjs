import van from "../../vanjs.mjs";
import {BaseComponent, BaseSelectableComponent} from "../baseComponent.mjs";
import {Button} from "./buttons.mjs";
import {FAIcon} from "./fa-icon.mjs";
import {PhIcon, iconComponentFor} from "./ph-icon.mjs";

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
        this._activeSubmenus = [];
        this._submenuTimeout = null;
        this._isHoveringParent = false;
        this._isHoveringSubmenu = false;
    }

    createButton() {
        const inIcon = (this.icon instanceof BaseComponent)
            ? this.icon
            : iconComponentFor(this.icon);

        this._headerIconComp = inIcon;
        this._headerLabelSpan = span(this.title);

        let dropdownIcon = undefined,
            buttonClasses = {flex: "flex flex-col items-center", padding: ""};
        if (this._useActiveSelection) {
            dropdownIcon = i(
                { "data-dropdown-arrow": "1", class: "ml-0 pr-3" },
                new PhIcon({ name: "ph-caret-down" }).create()
            );
            buttonClasses['padding'] = 'pr-0';
            inIcon.setClass('dropdownPadding', 'pl-2')
        }
        return new Button({
            id: this.parentId + "-b-" + this.id,
            size: Button.SIZE.SMALL,
            extraProperties: {title: this.title, style: "gap: 3px !important;"},
            extraClasses: buttonClasses,
        }, inIcon, this._headerLabelSpan, dropdownIcon);
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
        if (this._rootEl) this._rootEl.classList.remove("dropdown-open");
        if (this._contentEl) {
            this._contentEl.style.visibility = "hidden";
            this._contentEl.style.display = "none";
            // Detach from DOM entirely. `place()` reparents the content out of
            // the original `.dropdown` root into the host's offset-parent — a
            // container that lives at the same z-index layer as the AppBar.
            // Leaving the (display:none) content there meant the original
            // `.dropdown` ancestor selector chain (and CSS like
            // `.dropdown:focus-within .dropdown-content`) could still flip
            // it back to visible on stray focus/hover events, and a stale
            // event listener path could re-open the menu when the user
            // pointerdown'd near the AppBar trigger trying to grab a
            // toolbar handle directly underneath it. Removing the node
            // makes the menu fully inert until the next explicit `_open`.
            if (this._contentEl.parentNode) {
                this._contentEl.parentNode.removeChild(this._contentEl);
            }
        }
        if (this._fmToken) {
            UI.Services.FloatingManager.unregister(this._fmToken);
            this._fmToken = null;
        }
    }

    /** Helper to schedule closing. */
    _scheduleSubmenuCheck() {
        return;
    }

    _getSubmenuLevel(anchorEl) {
        const parentSubmenu = anchorEl?.closest?.("[data-submenu-level]");
        const parentLevel = Number(parentSubmenu?.dataset?.submenuLevel || 0);
        return parentLevel + 1;
    }

    _getActiveSubmenu(level) {
        return this._activeSubmenus.find(submenu => submenu.level === level) || null;
    }

    _closeSubmenusFrom(level = 0) {
        if (this._submenuTimeout) clearTimeout(this._submenuTimeout);

        for (let index = this._activeSubmenus.length - 1; index >= 0; index -= 1) {
            const submenu = this._activeSubmenus[index];
            if (submenu.level < level) {
                continue;
            }

            if (submenu.anchorEl) {
                const link = submenu.anchorEl.querySelector("a");
                if (link) {
                    link.classList.remove("!bg-base-300");
                }
            }

            if (submenu.token) {
                UI.Services.FloatingManager.unregister(submenu.token);
            }
            if (submenu.el) {
                submenu.el.remove();
            }

            this._activeSubmenus.splice(index, 1);
        }
    }

    _closeSubmenu() {
        this._isHoveringParent = false;
        this._isHoveringSubmenu = false;
        this._closeSubmenusFrom(0);
    }

    _applyDisabledState(item, node = undefined) {
        const root = node || item?._node;
        const anchor = root?.matches?.('a') ? root : root?.querySelector?.('a');
        if (!anchor) return;

        const disabled = !!item.disabled;

        anchor.classList.toggle('opacity-50', disabled);
        anchor.classList.toggle('select-none', disabled);
        anchor.classList.toggle('cursor-default', disabled);
        anchor.classList.toggle('pointer-events-none', disabled);
        anchor.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        anchor.tabIndex = disabled ? -1 : 0;
    }

    _open(trigger, place) {
        // Re-clicking the trigger while open closes the menu (standard
        // dropdown toggle). The previous "bring-to-front and return"
        // branch left users with no way to dismiss an open dropdown via
        // its own trigger, which compounded the spatial conflict between
        // the AppBar dropdowns and the floating toolbar handles directly
        // underneath them.
        if (this._isOpen) {
            this.close();
            return;
        }
        this._isOpen = true;

        // Mark the dropdown root as open so DaisyUI's
        // `.dropdown.dropdown-open .dropdown-content` selector flips
        // opacity to 1 and transform to scale(1). Without this the menu
        // looked "visually closed" after an item click (focus left the
        // dropdown when the click side-effect toggled some other UI, so
        // `.dropdown:focus-within` no longer matched and CSS hid the
        // content while it was still in the DOM intercepting events).
        if (this._rootEl) this._rootEl.classList.add("dropdown-open");

        if (this._contentEl && this._contentEl.parentNode !== document.body) {
            document.body.appendChild(this._contentEl);
        }

        this._contentEl.style.display = "block";
        this._contentEl.style.visibility = "visible";
        this._contentEl.style.opacity = "1";
        this._contentEl.style.transform = "none";
        place();

        queueMicrotask(() => {
            if (!this._isOpen) return;
            this._fmToken = UI.Services.FloatingManager.register({
                el: this._contentEl,
                owner: this,
                onEscape: "close",
                // Custom outside-click handler: a mousedown on this
                // dropdown's own trigger must not auto-close, otherwise
                // the trigger's click listener (which fires later, in
                // the bubble phase) re-opens the menu and the toggle
                // never happens. Skipping closes for trigger-targeted
                // mousedowns lets the trigger's click handler perform
                // a clean toggle.
                onOutsideClick: (e) => {
                    if (trigger && typeof trigger.contains === "function" && trigger.contains(e.target)) return;
                    this.close();
                }
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
        const headerTitle = (typeof item.title === "string" ? item.title
            : (typeof item.label === "string" ? item.label : undefined));
        if (btnEl && typeof headerTitle === "string") {
            btnEl.title = headerTitle;
        }
        if (typeof item.icon === "string") {
            const wantsPh = item.icon.trim().startsWith('ph-');
            const isPh = this._headerIconComp instanceof PhIcon;
            const isFa = this._headerIconComp instanceof FAIcon;
            // Same family: in-place glyph swap. Different family or unknown:
            // rebuild the header icon component so the wrapper class flips
            // between fa-auto and ph-light (otherwise the codepoint renders
            // through the wrong font and produces tofu / unrelated glyphs).
            if ((wantsPh && isPh) || (!wantsPh && isFa)) {
                this._headerIconComp.changeIcon(item.icon);
            } else {
                const oldEl = document.getElementById(this._headerIconComp.id);
                const newComp = iconComponentFor(item.icon);
                const newEl = newComp.create();
                if (oldEl && oldEl.parentNode) oldEl.parentNode.replaceChild(newEl, oldEl);
                this._headerIconComp = newComp;
            }
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

        const storedItem = { ...item, section: secId };
        const node = this._renderItem(storedItem);
        storedItem._node = node;

        if (target) target.appendChild(node);
        this.items[item.id] = storedItem;
    }

    getItem(id) { return this.items[id]; }

    setItemDisabled(id, disabled) {
        const item = this.items[id];
        if (!item) return false;

        item.disabled = !!disabled;
        this._applyDisabledState(item);
        return true;
    }

    setItemLabel(id, label) {
        const item = this.items[id];
        if (!item) return false;

        item.label = label;
        const node = item._node;
        if (node) {
            const span = node.querySelector('.flex-1 span.truncate');
            if (span) span.textContent = label;
        }
        return true;
    }

    _findItemRecursive(id, items = Object.values(this.items)) {
        for (const item of items) {
            if (item.id === id) {
                return item;
            }
            if (Array.isArray(item.children)) {
                const nested = this._findItemRecursive(id, item.children);
                if (nested) {
                    return nested;
                }
            }
        }
        return null;
    }

    setItemSelected(id, selected) {
        const item = this._findItemRecursive(id);
        if (!item) return false;

        item.selected = !!selected;

        if (!this._contentEl) {
            return true;
        }

        const nodes = this._contentEl.querySelectorAll(`[data-item-id="${id}"]`);
        nodes.forEach(node => {
            const isTarget = !!selected;
            const checkEl = node.querySelector(".check-icon");
            const isCheckStyle = !!checkEl;

            node.setAttribute("aria-current", isTarget ? "true" : "false");

            if (!isCheckStyle) {
                node.classList.toggle("bg-primary/100", isTarget);
                node.classList.toggle("text-primary-content", isTarget);
                node.classList.toggle("hover:bg-primary/200", isTarget);
                node.classList.toggle("focus:bg-primary/200", isTarget);
                node.classList.toggle("!bg-primary/100", isTarget);
                node.classList.toggle("!hover:bg-primary/200", isTarget);
                node.classList.toggle("!focus:bg-primary/200", isTarget);
            }

            if (isCheckStyle) {
                if (isTarget) checkEl.classList.remove("invisible");
                else checkEl.classList.add("invisible");
            }
        });

        return true;
    }

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
            // _renderItem bakes the initial selection in with `!`-prefixed
            // Tailwind variants (e.g. `!bg-primary/100`). Toggling only the
            // non-prefixed variant here would leave the original selection
            // stuck purple. Mirror the variant set used by setItemSelected.
            if (!isCheckStyle) {
                node.classList.toggle("bg-primary/100", isTarget);
                node.classList.toggle("!bg-primary/100", isTarget);
                node.classList.toggle("text-primary-content", isTarget);
                node.classList.toggle("hover:bg-primary/200", isTarget);
                node.classList.toggle("!hover:bg-primary/200", isTarget);
                node.classList.toggle("focus:bg-primary/200", isTarget);
                node.classList.toggle("!focus:bg-primary/200", isTarget);
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

        // Update Header
        if (this._useActiveSelection && id && this.items[id]) {
            this.activeSelectionId = id;
            this._updateHeaderFromItem(this.items[id]);
        }
    }

    /* ---------------- rendering ---------------- */

    _renderIcon(icon) {
        return iconComponentFor(icon).create();
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
            title: item.title || (typeof item.label === "string" ? item.label : undefined),
            class: [
                "flex items-center gap-3 rounded-md px-3 py-2",
                // Highlight background ONLY if NOT in check mode
                (selected && !isCheckStyle) ? "!bg-primary/100 text-primary-content !hover:bg-primary/200 !focus:bg-primary/200" : "!hover:bg-base-300 !focus:bg-base-300",
                item.disabled ? "opacity-50 select-none cursor-default pointer-events-none" : "",
                item.pluginRootClass || "",
            ].join(" "),
            onclick: (e) => {
                if (!item.href) e.preventDefault();

                if (item.disabled) {
                    e.stopPropagation();
                    return true;
                }

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
            const checkIcon = new PhIcon({name: "ph-check"}).create();
            checkIcon.classList.add("check-icon"); // Marker class for setSelected
            if (!selected) checkIcon.classList.add("invisible");

            leftIconSlot = div({class: "w-5 text-center text-primary"}, checkIcon);
        } else if (item.icon) {
            leftIconSlot = this._renderIcon(item.icon);
        } else {
            leftIconSlot = null;
        }

        const labelBlock = div({ class: "flex-1 min-w-0" },
            typeof item.label === "string" ? span({ class: "truncate" }, item.label) : this.toNode(item.label),
            item.sub ? div({ class: "text-xs opacity-60 truncate" }, this.toNode(item.sub)) : null
        );

        // --- Right Side Slot ---
        let rightSide = null;
        if (hasChildren) {
            const chevron = new PhIcon({ name: "ph-caret-right" }).create();
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
            // Hover behaviour for desktop
            liEl.addEventListener("mouseenter", () => {
                self._isHoveringParent = true;
                const submenuLevel = self._getSubmenuLevel(liEl);
                if (self._getActiveSubmenu(submenuLevel)?.parentId === item.id) {
                    self._scheduleSubmenuCheck();
                    return;
                }
                self._openSubmenu(item, liEl);
            });
            liEl.addEventListener("mouseleave", () => {
                self._isHoveringParent = false;
                self._scheduleSubmenuCheck();
            });

            // Click/tap behaviour for touch devices only: open/toggle submenu on click
            const isTouchDevice = (typeof window !== "undefined") && (
                ("ontouchstart" in window) ||
                (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
                (window.matchMedia && window.matchMedia("(hover: none)").matches)
            );
            if (isTouchDevice) {
                const linkEl = liEl.querySelector("a");
                linkEl?.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const submenuLevel = self._getSubmenuLevel(liEl);
                    if (self._getActiveSubmenu(submenuLevel)?.parentId === item.id) {
                        self._closeSubmenusFrom(submenuLevel);
                        return;
                    }
                    self._isHoveringParent = true;
                    self._openSubmenu(item, liEl);
                });
            }
        } else {
            liEl.addEventListener("mouseenter", () => {
                self._isHoveringParent = false;
                self._scheduleSubmenuCheck();
            });
        }
        this._applyDisabledState(item, liEl);
        // Always keep _node pointing at the latest rendered element. Any code
        // path that re-renders (e.g. addSection → _rebuildContent) leaves the
        // previous _node detached otherwise, and setItemDisabled /
        // setItemLabel mutate the wrong (invisible) element.
        item._node = liEl;
        return liEl;
    }

    _openSubmenu(parentItem, anchorEl) {
        const level = this._getSubmenuLevel(anchorEl);
        const activeAtLevel = this._getActiveSubmenu(level);
        if (activeAtLevel?.parentId === parentItem.id && activeAtLevel.anchorEl === anchorEl) {
            return;
        }
        this._closeSubmenusFrom(level);

        // Highlight parent anchor
        const link = anchorEl.querySelector("a");
        if (link) link.classList.add("!bg-base-300");

        const submenuEl = div({
            class: "dropdown-content dropdown-submenu !bg-base-200 text-base-content rounded-box shadow-xl w-52 p-0 max-w-full min-w-max z-[9999]",
            style: "display: block; position: absolute;",
            "data-submenu-level": String(level),
        });

        // Determine style for this specific submenu
        const submenuStyle = parentItem.childSelectionStyle || this.selectionStyle;

        const listEl = ul(
            { class: "menu bg-transparent p-0 m-0", role: "none" },
            ...parentItem.children.map(child => this._renderItem(child, submenuStyle))
        );
        submenuEl.appendChild(listEl);

        anchorEl.appendChild(submenuEl);
        submenuEl.style.visibility = "hidden";

        // Hover events
        submenuEl.addEventListener("mouseenter", () => {
            this._isHoveringSubmenu = true;
            this._scheduleSubmenuCheck();
        });
        submenuEl.addEventListener("mouseleave", () => {
            this._isHoveringSubmenu = false;
            this._scheduleSubmenuCheck();
        });

        const anchorRect = anchorEl.getBoundingClientRect();
        const margin = 6;
        const vw = document.documentElement.clientWidth || window.innerWidth;
        const vh = document.documentElement.clientHeight || window.innerHeight;

        const submenuWidth = submenuEl.offsetWidth || 0;
        const submenuHeight = submenuEl.offsetHeight || 0;

        let left = anchorRect.width - margin;
        let top = -margin;

        const initialVpLeft = anchorRect.left + left;
        if (initialVpLeft + submenuWidth > vw - margin) {
            left = -submenuWidth + margin;
        }

        let vpLeft = anchorRect.left + left;
        if (vpLeft < margin) {
            left += margin - vpLeft;
            vpLeft = margin;
        }

        let vpTop = anchorRect.top + top;
        if (vpTop + submenuHeight > vh - margin) {
            top -= (vpTop + submenuHeight) - (vh - margin);
            vpTop = anchorRect.top + top;
        }
        if (vpTop < margin) {
            top += margin - vpTop;
        }

        // Apply coordinates and show
        submenuEl.style.left = `${Math.round(left)}px`;
        submenuEl.style.top = `${Math.round(top)}px`;
        submenuEl.style.visibility = "visible";

        const token = UI.Services.FloatingManager.register({
            el: submenuEl,
            owner: this,
            onEscape: () => this._closeSubmenusFrom(level)
        });

        this._activeSubmenus.push({
            el: submenuEl,
            token,
            level,
            parentId: parentItem.id,
            anchorEl
        });
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
            if (!firstBlock) this._contentEl.appendChild(div({ class: "mx-1 my-1" }));
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
                "!bg-base-200 text-base-content rounded-box shadow-xl border border-base-300",
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

            // Make visible for measurements but keep hidden from user until placed
            menu.style.visibility = "hidden";
            menu.style.display = "block";
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

            // prefer opening below and to the right (or depending on toolbar)
            let preferRight;
            if (placement === "right") preferRight = true;
            else if (placement === "below") preferRight = false;
            else preferRight = verticalToolbar;

            // initial coordinates relative to container
            let left, top;
            // default: open below, align to host left
            left = hostRect.left - contRect.left;
            top  = hostRect.bottom - contRect.top + margin;

            // if toolbar wants right alignment, align menu's left with host's right
            if (preferRight) {
                left = hostRect.right - contRect.left - mw + margin;
            }

            // viewport dims (exclude scrollbars)
            const vw = document.documentElement.clientWidth || window.innerWidth;
            const vh = document.documentElement.clientHeight || window.innerHeight;

            // convert to viewport coords for overflow checks
            let vpLeft = contRect.left + left;
            let vpTop  = contRect.top + top;

            // Try horizontal flipping if overflow on right or left
            if (vpLeft + mw > vw - margin) {
                // try opening to the other side of the host
                const altLeft = hostRect.left - contRect.left - mw - margin; // place left of host
                if (altLeft >= -margin) {
                    left = altLeft;
                    vpLeft = contRect.left + left;
                } else {
                    // clamp to right edge
                    const delta = (vpLeft + mw) - (vw - margin);
                    left -= delta;
                    vpLeft -= delta;
                }
            }
            if (vpLeft < margin) {
                const delta = margin - vpLeft;
                left += delta;
                vpLeft += delta;
            }

            // Try vertical flip (open above) if it would overflow bottom
            if (vpTop + mh > vh - margin) {
                const canOpenAbove = (hostRect.top - mh - margin) >= 0;
                if (canOpenAbove) {
                    top = hostRect.top - contRect.top - mh - margin;
                    vpTop = contRect.top + top;
                } else {
                    // clamp to bottom edge
                    const delta = (vpTop + mh) - (vh - margin);
                    top -= delta;
                    vpTop -= delta;
                }
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

        this._rootEl = div({ ...this.commonProperties, onclick: this.onClick, ...this.extraProperties }, trigger, this._contentEl);
        return this._rootEl;
    }
}

export { Dropdown };
