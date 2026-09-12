import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div, ul, li, a, span, i } = van.tags;

/**
 * Geometry shared by the root menu and every flyout. Kept as constants because
 * the flyout's vertical offset must equal the list's own padding — a submenu
 * whose first row does not sit on its parent row's baseline reads as broken,
 * and the two used to be independent magic numbers that drifted apart.
 *
 * All of it is applied INLINE. `src/libs/tailwind.min.css` is the purged build
 * (a new utility or a `@layer components` rule would need a Tailwind rebuild),
 * and DaisyUI styles menu rows through `:where()` selectors that a class of
 * ours would have to out-specify. Inline wins outright, with no rebuild.
 */
const MENU_PADDING = 4;
const ROW_STYLE = "display:flex; align-items:center; gap:6px; padding:2px 8px; " +
    "font-size:12px; line-height:1.3; min-height:0;";
const ICON_BOX = 16;

/** True for the `{title: ""}` entries providers push between groups. */
function isSeparatorItem(item) {
    return !item?.title && typeof item?.action !== "function"
        && !(Array.isArray(item?.children) && item.children.length > 0);
}

/**
 * Drop leading/trailing separators and collapse runs.
 *
 * The producers cannot do this themselves: `CanvasContextMenu.collect` pushes a
 * separator before a provider's items without knowing whether any provider
 * after it will contribute, and the same holds inside a submenu
 * (`slideSwitcherMenu._buildOpenMenuItems`, the annotations Group submenu). So
 * a trailing rule with nothing under it was the normal case, not an edge one.
 * @param {Array} items
 * @returns {Array}
 */
function normalizeSeparators(items) {
    const out = [];
    for (const item of items) {
        if (!isSeparatorItem(item)) { out.push(item); continue; }
        // Never open with a rule, never repeat one.
        if (out.length && !isSeparatorItem(out[out.length - 1])) out.push(item);
    }
    while (out.length && isSeparatorItem(out[out.length - 1])) out.pop();
    return out;
}

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
            if (!fm?.register) return;
            // If a prior openAt's microtask already registered a token for the
            // current _rootEl, drop it before re-registering. Prevents
            // FloatingManager from accumulating stale entries on rapid reopens.
            if (this._fmToken && fm.unregister) {
                try { fm.unregister(this._fmToken); } catch { /* noop */ }
                this._fmToken = null;
            }
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
        // which varies in natural width between ph-trash, ph-stack,
        // ph-arrows-vertical, ph-shapes, etc. — is always centered inside
        // a fixed box. Without this, taller / wider glyphs visibly shift the
        // adjacent label, making the padding between icon and text appear
        // inconsistent across rows.
        const base = "inline-flex items-center justify-center shrink-0";
        const style = `width: ${ICON_BOX}px; height: ${ICON_BOX}px; font-size: 14px; line-height: 1;`;
        if (!icon) return span({ class: base, style });
        return span({
            class: `${base} ph-light ${icon}`,
            style: `${style} ${iconCss || ""}`,
        });
    }

    _renderMenuList(items, depth) {
        // `menu menu-sm` is kept for what DaisyUI does well here — row hover,
        // focus-visible and the button radius — while the geometry is overridden
        // inline (see MENU_PADDING). DaisyUI's own `.menu { padding: .5rem }` is
        // a sidebar measure and every cascade level would pay it again.
        const listEl = ul({
            class: "menu menu-sm bg-base-100 rounded-box shadow",
            style: `padding: ${MENU_PADDING}px; min-width: 160px;`,
        });
        for (const item of normalizeSeparators(items)) {
            listEl.appendChild(this._renderItem(item, depth));
        }
        return listEl;
    }

    _renderItem(item, depth) {
        const hasChildren = Array.isArray(item.children) && item.children.length > 0;
        const isAction = typeof item.action === "function";

        // Group boundary: a hairline rule, NOT a row. Rendering it as a text
        // `li` gave it an empty line box (~12px of nothing) on top of its
        // border, which is what made a three-provider menu look gapped.
        // `currentColor` so it reads in both DaisyUI themes without a hex.
        if (isSeparatorItem(item)) {
            return li({
                role: "separator",
                class: "pointer-events-none",
                style: "height: 1px; padding: 0; margin: 3px 6px; " +
                    "background: currentColor; opacity: 0.15;",
            });
        }

        // Titled section header (the legacy flat path in the annotations
        // plugin). `menu-title` is DaisyUI's opt-out from both the row padding
        // rules and the hover highlight — a header was never meant to look
        // hoverable, and it did.
        if (!isAction && !hasChildren) {
            return li(
                {
                    class: "menu-title",
                    style: "padding: 2px 8px; font-size: 10px; line-height: 1.4; " +
                        "text-transform: uppercase; letter-spacing: 0.02em; opacity: 0.6;",
                },
                item.title
            );
        }

        // Parent with cascading flyout
        if (hasChildren) {
            const liEl = li({ class: "relative", role: "none" });
            const anchor = a(
                {
                    role: "menuitem",
                    tabindex: "0",
                    class: `${item.containerCss || ""}`.trim(),
                    style: ROW_STYLE,
                    onclick: (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this._toggleFlyout(item, liEl, depth);
                    },
                },
                this._iconNode(item.icon, item.iconCss),
                span({ class: "whitespace-nowrap" }, item.title || ""),
                // Use an icon-font caret rather than the U+25B6 triangle:
                // some systems render ▶ with emoji presentation (a coloured
                // raster glyph), which clashes with the rest of the menu.
                // `margin-left: auto` alone pushes it right — the old
                // `justify-between` + `ml-2` pair spaced it twice.
                i({
                    class: "ph-light ph-caret-right opacity-60 shrink-0",
                    style: "font-size: 10px; margin-left: auto;",
                })
            );
            liEl.appendChild(anchor);

            // Hover/leave defer to the per-flyout shared timer (set up in
            // _openFlyout) so moving the cursor parent → flyout doesn't
            // race with an independent parent-side close timer.
            liEl.addEventListener("mouseenter", () => {
                const existing = this._activeFlyouts.find(f => f.parentLi === liEl);
                if (existing) {
                    // Mirror cancelHideChain in _openFlyout: cancel this
                    // flyout's hide AND any ancestor flyouts' pending hides.
                    for (const f of this._activeFlyouts) {
                        if (f.level <= existing.level) f.cancelHide?.();
                    }
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

        // Leaf clickable row — shares ROW_STYLE with the parent rows so
        // icon/text spacing is uniform between submenu entries and leaf
        // entries. The selected background sits on the anchor rather than the
        // `li`, so it picks up the row's own radius instead of painting
        // full-bleed into the list padding.
        const selected = !!item.selected;
        const liEl = li(
            { role: "none" },
            a(
                {
                    role: "menuitem",
                    tabindex: "0",
                    class: `${item.containerCss || ""}`.trim(),
                    style: selected
                        ? `${ROW_STYLE} background: var(--color-state-focus-border);`
                        : ROW_STYLE,
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
        // The flyout's first row is inset by the list's own padding, so offset
        // by exactly that to put it on the parent row's baseline. These were
        // two independent constants and had drifted apart.
        let top = anchorRect.top - MENU_PADDING;

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
        // Cancel this flyout's pending hide AND every ancestor flyout's pending
        // hide. Flyouts are appended to document.body as siblings, so moving the
        // cursor parent → child fires the parent flyout's mouseleave before the
        // child's mouseenter; without ancestor cancellation the parent's 180ms
        // timer would tear down the whole subtree.
        const cancelHideChain = () => {
            for (const f of this._activeFlyouts) {
                if (f.level <= entry.level) f.cancelHide?.();
            }
        };
        entry.scheduleHide = () => {
            entry.cancelHide();
            entry.hideTimer = setTimeout(() => {
                entry.hideTimer = null;
                this._closeFlyoutsFrom(entry.level);
            }, 180);
        };
        flyoutEl.addEventListener("mouseenter", cancelHideChain);
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

    _destroyFlyout(entry) {
        entry.cancelHide?.();
        if (entry.el?.parentNode) entry.el.parentNode.removeChild(entry.el);
    }

    _closeFlyoutsFrom(level) {
        for (let i = this._activeFlyouts.length - 1; i >= 0; i--) {
            const f = this._activeFlyouts[i];
            if (f.level < level) continue;
            this._destroyFlyout(f);
            this._activeFlyouts.splice(i, 1);
        }
    }

    _closeAllFlyouts() {
        for (const f of this._activeFlyouts) this._destroyFlyout(f);
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
