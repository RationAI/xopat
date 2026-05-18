import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div, ul, li, a, span, i } = van.tags;

/**
 * @class ContextMenu
 * @extends BaseComponent
 * @description A floating context menu that opens at an arbitrary screen
 * position. Items mirror the legacy `window.DropDown` shape but additionally
 * support cascading flyouts: an item with `children: [...]` renders as a
 * parent row with a `▶` indicator; hovering or clicking it reveals a
 * submenu to the side, edge-aware (flips horizontally when near the right
 * edge, clamps vertically when near the bottom).
 *
 * Items:
 *   { title, action, icon, iconCss, containerCss, selected, children, disabled }
 *
 * Items with no `action` and no `children` are rendered as section headers.
 *
 * Use `ContextMenu.open(mouseEventOrXY, items)` for one-shot transient
 * menus (the singleton mounted on `window.ContextMenu`). Outside-click and
 * Escape are wired through `UI.Services.FloatingManager`.
 */
export class ContextMenu extends BaseComponent {
    constructor(options = undefined) {
        options = super(options).options;
        this._rootEl = null;
        this._open = false;
        this._fmToken = null;
        this._activeFlyouts = []; // [{ el, parentLi, level, fmToken }]
    }

    /**
     * Open the menu at the given position with the given items.
     * @param {{pageX: number, pageY: number} | MouseEvent} eventOrPos
     * @param {Array} items
     */
    openAt(eventOrPos, items) {
        if (!Array.isArray(items) || items.length === 0) return;
        this.close();

        const x = (eventOrPos?.pageX ?? eventOrPos?.x ?? 0);
        const y = (eventOrPos?.pageY ?? eventOrPos?.y ?? 0);

        this._rootEl = this._renderMenuList(items, /*depth*/ 0);
        // Match the legacy `window.DropDown` body sizing so visual rhythm
        // stays the same across the app.
        this._rootEl.style.position = "fixed";
        this._rootEl.style.zIndex = "999999999";
        this._rootEl.style.width = "auto";
        this._rootEl.style.maxWidth = "300px";
        this._rootEl.style.visibility = "hidden";
        this._rootEl.setAttribute("oncontextmenu", "return false;");
        document.body.appendChild(this._rootEl);

        // Edge-aware placement, mirroring window.DropDown's heuristic.
        const margin = 6;
        const rect = this._rootEl.getBoundingClientRect();
        let left = x - 15;
        let top = y + 5;
        if (left + rect.width > window.innerWidth - margin) {
            left = Math.max(margin, x - rect.width + 15);
        }
        if (top + rect.height > window.innerHeight - margin) {
            top = Math.max(margin, y - rect.height - 5);
        }
        this._rootEl.style.left = `${Math.round(left)}px`;
        this._rootEl.style.top = `${Math.round(top)}px`;
        this._rootEl.style.visibility = "visible";

        this._open = true;

        // Outside-click / Escape via FloatingManager. Defer registration to
        // the next microtask so the click that opened us doesn't immediately
        // trigger the outside-click close. Active flyouts are appended to
        // document.body (siblings of `_rootEl`), so the outside-click guard
        // re-checks them explicitly before closing.
        queueMicrotask(() => {
            if (!this._open) return;
            const fm = (typeof UI !== "undefined") ? UI.Services?.FloatingManager : null;
            if (fm?.register) {
                this._fmToken = fm.register({
                    el: this._rootEl,
                    owner: this,
                    onEscape: () => this.close(),
                    onOutsideClick: (e) => {
                        if (this._activeFlyouts.some(f => f.el?.contains(e?.target))) return;
                        this.close();
                    },
                });
                fm.bringToFront?.(this._fmToken);
            }
        });
    }

    close() {
        if (!this._open && !this._rootEl) return;
        this._closeAllFlyouts();
        const fm = (typeof UI !== "undefined") ? UI.Services?.FloatingManager : null;
        if (this._fmToken && fm?.unregister) {
            try { fm.unregister(this._fmToken); } catch { /* noop */ }
        }
        this._fmToken = null;
        if (this._rootEl?.parentNode) this._rootEl.parentNode.removeChild(this._rootEl);
        this._rootEl = null;
        this._open = false;
    }

    create() {
        // The menu is created on demand via openAt(). This stub exists so the
        // component conforms to the BaseComponent contract.
        return div();
    }

    /* ---------------- internals ---------------- */

    _iconNode(icon, iconCss) {
        // Use inline-flex with centered alignment so the glyph itself —
        // which varies in natural width between fa-trash, fa-layer-group,
        // fa-arrows-up-down, fa-shapes, etc. — is always centered inside
        // a 20px box. Without this, taller / wider glyphs visibly shift the
        // adjacent label, making the padding between icon and text appear
        // inconsistent across rows.
        const base = "inline-flex items-center justify-center shrink-0";
        const style = "width: 20px; height: 20px; font-size: 16px; line-height: 1;";
        if (!icon) return span({ class: base, style });
        return span({
            class: `${base} fa-auto ${icon}`,
            style: `${style} ${iconCss || ""}`,
        });
    }

    _renderMenuList(items, depth) {
        // Match the legacy `window.DropDown` body styling exactly so cascading
        // flyouts visually agree with the rest of the app's menus. The only
        // difference is that a flyout doesn't carry the `oncontextmenu` guard.
        const listEl = ul({
            class: "menu menu-sm bg-base-100 rounded-box shadow",
        });
        for (const item of items) {
            listEl.appendChild(this._renderItem(item, depth));
        }
        return listEl;
    }

    _renderItem(item, depth) {
        const hasChildren = Array.isArray(item.children) && item.children.length > 0;
        const isAction = typeof item.action === "function";

        // Header / separator
        if (!isAction && !hasChildren) {
            return li(
                {
                    class: "px-2",
                    style: "font-size: 10px; border-bottom: 1px solid var(--color-border-primary, #d0d7de);",
                },
                item.title || ""
            );
        }

        // Parent with cascading flyout
        if (hasChildren) {
            const liEl = li({ class: "relative", role: "none" });
            const anchor = a(
                {
                    role: "menuitem",
                    tabindex: "0",
                    class: `pl-1 dropdown-item pointer flex items-center justify-between gap-2 ${item.containerCss || ""}`.trim(),
                    onclick: (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this._toggleFlyout(item, liEl, depth);
                    },
                },
                span({ class: "flex items-center gap-2 min-w-0" },
                    this._iconNode(item.icon, item.iconCss),
                    span({ class: "whitespace-nowrap" }, item.title || "")
                ),
                // Use a Font Awesome chevron rather than the U+25B6 triangle:
                // some systems render ▶ with emoji presentation (a coloured
                // raster glyph), which clashes with the rest of the menu.
                i({ class: "fa-auto fa-chevron-right opacity-60 ml-2 shrink-0", style: "font-size: 11px;" })
            );
            liEl.appendChild(anchor);

            // Hover/leave defer to the per-flyout shared timer (set up in
            // _openFlyout) so moving the cursor parent → flyout doesn't
            // race with an independent parent-side close timer.
            liEl.addEventListener("mouseenter", () => {
                const existing = this._activeFlyouts.find(f => f.parentLi === liEl);
                if (existing) {
                    existing.cancelHide();
                } else {
                    this._openFlyout(item, liEl, depth);
                }
            });
            liEl.addEventListener("mouseleave", () => {
                const entry = this._activeFlyouts.find(f => f.parentLi === liEl);
                if (entry) entry.scheduleHide();
            });
            return liEl;
        }

        // Leaf clickable row — uses the same `flex items-center gap-2`
        // layout as the parent rows so icon/text spacing is uniform between
        // submenu entries and leaf entries. Without this, leaves render
        // their icon+text inline (whatever the browser defaults are) while
        // parents render them flex-aligned, producing the inconsistent
        // "padding" the user reported.
        const selected = !!item.selected;
        const liEl = li(
            {
                role: "none",
                style: selected ? "background: var(--color-state-focus-border);" : "",
            },
            a(
                {
                    role: "menuitem",
                    tabindex: "0",
                    class: `pl-1 dropdown-item pointer flex items-center gap-2 ${item.containerCss || ""}`.trim(),
                    onclick: (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (item.disabled) return;
                        try { item.action(selected); } catch (err) { console.error(err); }
                        this.close();
                    },
                },
                this._iconNode(item.icon, item.iconCss),
                span({ class: "whitespace-nowrap" }, item.title || "")
            )
        );
        return liEl;
    }

    _openFlyout(parentItem, anchorLi, depth) {
        // Already open for this parent? leave it.
        const existing = this._activeFlyouts.find(f => f.parentLi === anchorLi);
        if (existing) return;

        // Close any sibling flyout at the same depth before opening a new one.
        this._closeFlyoutsFrom(depth + 1);

        const flyoutEl = this._renderMenuList(parentItem.children, depth + 1);
        flyoutEl.style.position = "fixed";
        flyoutEl.style.zIndex = "999999999";
        flyoutEl.style.width = "auto";
        flyoutEl.style.maxWidth = "300px";
        flyoutEl.style.visibility = "hidden";
        flyoutEl.setAttribute("oncontextmenu", "return false;");
        document.body.appendChild(flyoutEl);

        // Edge-aware positioning: prefer to the right of the parent, flip
        // left when there's no room, clamp vertically.
        const margin = 6;
        const anchorRect = anchorLi.getBoundingClientRect();
        const rect = flyoutEl.getBoundingClientRect();
        let left = anchorRect.right - 2;
        let top = anchorRect.top - 4;

        if (left + rect.width > window.innerWidth - margin) {
            left = Math.max(margin, anchorRect.left - rect.width + 2);
        }
        if (top + rect.height > window.innerHeight - margin) {
            top = Math.max(margin, window.innerHeight - rect.height - margin);
        }
        flyoutEl.style.left = `${Math.round(left)}px`;
        flyoutEl.style.top = `${Math.round(top)}px`;
        flyoutEl.style.visibility = "visible";

        // Single shared hide timer for this flyout level. Both the parent
        // row's mouseleave (in _renderItem) and the flyout's own mouseleave
        // schedule on this handle; both their mouseenters cancel it. Without
        // sharing, the parent.mouseleave → flyout.mouseenter sequence would
        // leave a pending close from the parent that fires 180ms later.
        const entry = {
            el: flyoutEl,
            parentLi: anchorLi,
            level: depth + 1,
            hideTimer: null,
            cancelHide: null,
            scheduleHide: null,
        };
        entry.cancelHide = () => {
            if (entry.hideTimer) { clearTimeout(entry.hideTimer); entry.hideTimer = null; }
        };
        entry.scheduleHide = () => {
            entry.cancelHide();
            entry.hideTimer = setTimeout(() => {
                entry.hideTimer = null;
                this._closeFlyoutsFrom(depth + 1);
            }, 180);
        };
        flyoutEl.addEventListener("mouseenter", entry.cancelHide);
        flyoutEl.addEventListener("mouseleave", entry.scheduleHide);

        this._activeFlyouts.push(entry);
    }

    _toggleFlyout(parentItem, anchorLi, depth) {
        const existing = this._activeFlyouts.find(f => f.parentLi === anchorLi);
        if (existing) {
            this._closeFlyoutsFrom(depth + 1);
        } else {
            this._openFlyout(parentItem, anchorLi, depth);
        }
    }

    _closeFlyoutsFrom(level) {
        for (let i = this._activeFlyouts.length - 1; i >= 0; i--) {
            const f = this._activeFlyouts[i];
            if (f.level < level) continue;
            f.cancelHide?.();
            if (f.el?.parentNode) f.el.parentNode.removeChild(f.el);
            this._activeFlyouts.splice(i, 1);
        }
    }

    _closeAllFlyouts() {
        for (const f of this._activeFlyouts) {
            f.cancelHide?.();
            if (f.el?.parentNode) f.el.parentNode.removeChild(f.el);
        }
        this._activeFlyouts = [];
    }
}

/**
 * Module-level singleton + window-anchored handle. Mirrors how
 * `window.DropDown` works so callers (loader.ts, plugins) can use it
 * without instantiating their own.
 */
let _singleton = null;
function _getSingleton() {
    if (!_singleton) _singleton = new ContextMenu({ id: "global-context-menu" });
    return _singleton;
}

/**
 * Open the global context menu at the given event position with the
 * given items. Returns the singleton so callers can `close()` if needed.
 */
ContextMenu.open = function (eventOrPos, items) {
    const inst = _getSingleton();
    inst.openAt(eventOrPos, items);
    return inst;
};

ContextMenu.close = function () {
    if (_singleton) _singleton.close();
};

if (typeof globalThis !== "undefined") {
    globalThis.ContextMenu = ContextMenu;
}
