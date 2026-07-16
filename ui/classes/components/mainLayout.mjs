import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { Div } from "../elements/div.mjs";
import { TabsMenu } from "./tabsMenu.mjs";
import { RawHtml } from "../elements/rawHtml.mjs";
import { Dropdown } from "../elements/dropdown.mjs";
import { VisibilityManager } from "../mixins/visibilityManager.mjs";
import { DockableWindow } from "./dockableWindow.mjs";

const { div } = van.tags;

/**
 * MainLayout
 * Wraps the viewer container and a configurable side dock. The dock can be placed on
 * the left or right, be collapsed/expanded, resized via a drag handle, and will
 * responsively move below the viewer on narrow screens.
 *
 * Usage:
 *   new MainLayout(options)
 *
 * Notes:
 * - If you provide an array of tabs via options.tabs, a TabsMenu is created automatically.
 * - Alternatively, you can pass an existing TabsMenu instance via options.menu.
 * - On narrow screens (window.innerWidth < collapseBreakpointPx), the dock is placed below.
 */

/**
 * @typedef {Object} MainLayoutTab
 * @property {string} id - Unique tab identifier.
 * @property {string} [icon] - Icon class name, e.g., "ph-info" (or legacy "fa-circle-info").
 * @property {string} [title] - Human-readable title.
 * @property {VisibilityManager} [visibilityManager] - The visibility manager for this tab. Required.
 * @property {Array<string|import('../elements/rawHtml.mjs').RawHtml|HTMLElement>} [body] - Tab content definition.
 */

/**
 * @typedef {Object} MainLayoutOptions
 * @property {string} [id] - Root element id for the layout container.
 * @property {('left'|'right')} [position="right"] - Side where the dock appears on wide screens.
 * @property {number} [initialWidth=360] - Initial dock width in pixels.
 * @property {number} [minWidth=220] - Minimum dock width in pixels.
 * @property {number} [maxWidth=640] - Maximum dock width in pixels.
 * @property {number} [collapseBreakpointPx=900] - Viewport width (px) below which dock moves below viewer.
 * @property {MainLayoutTab[]} [tabs] - Initial array of tab definitions.
 * @property {TabsMenu} [menu] - Optional pre-built TabsMenu to attach instead of creating from tabs.
 */
export class MainLayout extends BaseComponent {
    /**
     * Create a MainLayout component.
     * @param {MainLayoutOptions} [options] - Layout configuration and initial tabs/menu.
     * @param {Array<BaseComponent|HTMLElement|string>} children - Additional child nodes/components.
     */
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;

        this.position = (options.position || "right").toLowerCase();
        this.minWidth = options.minWidth ?? 220;
        this.maxWidth = options.maxWidth ?? 640;
        this.collapseBreakpointPx = options.collapseBreakpointPx ?? 900;
        this._widthCacheKey = `${this.id}-dock-width`;
        this.widthPx = this._clampDockWidth(
            APPLICATION_CONTEXT.AppCache.get(this._widthCacheKey, options.initialWidth ?? 360)
        );
        this._collapsedCacheKey = `${this.id}-dock-collapsed`;
        // user-intent collapse (drag-to-close / collapse()) persisted separately
        // from the transient responsive collapse on narrow viewports
        this._userCollapsed = APPLICATION_CONTEXT.AppCache.get(this._collapsedCacheKey, false) === true;
        this.collapsed = this._userCollapsed;

        // Dock interaction mode: "docked" (flex sibling that pushes the viewer,
        // stays open when open — the classic behavior) vs "overlay" (dock hides
        // to a thin edge rail and floats over the viewer on hover/focus, no
        // viewer reflow). Resolution precedence — deliberately the inverse of
        // getUiOption's "explicit-param-wins": the runtime AppCache pin choice
        // is a user preference (like `-dock-width` / `-dock-collapsed` above),
        // so it wins over the session/deployment config default. getUiOption is
        // boolean-only and can't carry this string, so we read config directly.
        this._modeCacheKey = `${this.id}-dock-mode`;
        const _normMode = m => (m === "overlay" || m === "docked") ? m : null;
        const cfgMode = _normMode(APPLICATION_CONTEXT?.config?.params?.ui?.globalMenuMode)
            ?? _normMode(APPLICATION_CONTEXT?.config?.defaultParams?.ui?.globalMenuMode);
        const cachedMode = _normMode(APPLICATION_CONTEXT.AppCache.get(this._modeCacheKey, null));
        this._dockMode = cachedMode ?? cfgMode ?? "overlay";
        // transient: overlay panel currently revealed by hover/focus/explicit open
        this._overlayExpanded = false;
        // grace-period handle so moving the pointer rail→panel doesn't close it
        this._overlayCloseTimer = null;

        // fullscreen-on-narrow state
        this._isFullscreen = false;
        this._prevViewerDisplay = null;
        this._prevDockInlineStyles = null;

        this._tabsArr = [];
        this._menu = options.menu || null;

        this._shellEl = this._viewerEl = this._dockEl = this._handleEl = this._knobEl = null;
        this._dockViewItemId = `${this.id}-global-menu`;
        this._dockViewTabCategory = "globalMenuTabs";
        this._registeredTabViewIds = new Set();

        this._wrapperRegistry = new Map();
        this._dockedWrappers = new Map();
        this._pendingDockableRegistrations = new Set();

        this._toolbarEmbedWideEnabled = !!options.toolbarEmbeddingWide;
        this._toolbarEmbeddingPosition = options.toolbarEmbeddingPosition === "above" ? "above" : "below";
        this._toolbarEmbeddedCollapsed = APPLICATION_CONTEXT.AppCache.get(`${this.id}-toolbar-embedded-collapsed`, false) === true;
        this._toolbars = new Map();
        this._activeToolbarId = APPLICATION_CONTEXT.AppCache.get(`${this.id}-active-toolbar`, null) || null;
        this._toolbarAboveEl = null;
        this._toolbarBelowEl = null;
        this._toolbarFloatingEl = null;
        this._toolbarHiddenEl = null;
        this._toolbarHostBarEl = null;
        this._toolbarContentEl = null;
        this._toolbarPeekEl = null;
        this._toolbarDropdown = null;
        this._toolbarSwitcherWrap = null;
        this._toolbarCollapseBtn = null;
        this._toolbarFloatBtn = null;

        // App-bar embedding needs a wide enough window — the bar shares the row
        // with the menus, badges and user controls, so below this the toolbar
        // stays floating even when pinned (re-docks automatically when widened).
        this._minAppBarEmbedWidthPx = 1400;
        // Hysteresis on the slot width so a badge toggle near the edge can't
        // make the embedded toolbar flip-flop between docked and floating.
        this._minEmbedWidthPx = 240;
        this._minEmbedLeaveWidthPx = 200;
        this._appBarHadRoom = false;
        this._toolbarSlotRoomUnsub = null;

        this._syncingDockRequestedState = false;
        // `params.ui.globalMenu` (or `setup.ui.globalMenu` deployment default)
        // decides the dock's first-boot state — handy for notebook embeddings
        // that should not steal screen real estate until the user opts in.
        // When the flag is unset we leave `visibleNow` undefined so the
        // VisibilityManager falls back to its own AppCache key (= preserve
        // user's last manual toggle; written by `_setDockRequestedOpen`
        // when the change carries explicit user intent).
        // `params.ui.globalMenu = false` is a persistent "default hidden"
        // hint — the dock starts hidden, but every user-initiated open
        // (View-menu tab click, AppBar globe, mobile open) flows normally.
        const initialDockVisible = APPLICATION_CONTEXT?.getUiOption?.("globalMenu");
        // Sticky suppression for the deferred-sync race: cached docked tabs
        // call `showTab → showGlobalMenu → _setDockRequestedOpen(true)`
        // during boot, which would otherwise reopen a dock the session
        // explicitly hid (or the user last left closed — see the re-assign
        // after the VM init below). The latch is cleared by any explicit
        // user action — see `showTab`, `toggleGlobalMenu`,
        // `openGlobalMenuMobile`, and the VM on-callback below.
        // `_isFlushingDeferredSync` is true only while `addTab` is draining
        // a wrapper's deferred-sync, so `showTab` can distinguish boot-race
        // calls from user clicks.
        this._sessionInitialHidden = initialDockVisible === false;
        this._isFlushingDeferredSync = false;
        this.visibilityManager = new VisibilityManager(this._dockViewItemId).init(
            () => {
                if (!this._syncingDockRequestedState) {
                    // VM.on() is reached by explicit user toggles (View
                    // menu → vm.set(true), Chrome.show() restoring the
                    // pre-hide snapshot). Clear the session-initial hide
                    // latch so subsequent programmatic opens flow.
                    this._sessionInitialHidden = false;
                    this._dockRequestedOpen = true;
                }
                this._applyDockVisibility();
            },
            () => {
                if (!this._syncingDockRequestedState) {
                    this._dockRequestedOpen = false;
                }
                if (this._isFullscreen) {
                    this._closeFullscreen();
                }
                this._applyDockVisibility();
            },
            initialDockVisible === false ? false : undefined
        );

        // `is()` reads from the v::id cache. When config explicitly hides the
        // dock, win over a stale cache (e.g. the user toggled it open in a
        // previous notebook session).
        this._dockRequestedOpen = initialDockVisible === false
            ? false
            : !!this.visibilityManager?.is?.();

        // Re-assert the latch now that the VM restored the persisted state
        // (its init-time on-callback above resets it): a dock the user last
        // left closed must behave like `params.ui.globalMenu = false` —
        // boot-time deferred syncs of cached-visible tabs must not pop it
        // open. Explicit user opens clear the latch and persist as usual.
        this._sessionInitialHidden = initialDockVisible === false || !this._dockRequestedOpen;

        // Tie the dock into the AppBar "hide chrome" registry so that
        // `params.ui.appBar = false` (which calls Chrome.hide()) collapses it
        // alongside the rest of the chrome.
        USER_INTERFACE?.AppBar?.Chrome?.register?.(this._dockViewItemId, this.visibilityManager);

        if (Array.isArray(options.tabs)) {
            for (const tab of options.tabs) {
                const normalized = this._normalizeDockableTab(tab, { wrapInDockableWindow: true });
                if (!normalized) continue;
                this._tabsArr.push(normalized.tab);
                this._wrapperRegistry.set(normalized.id, normalized.wrapper);
                this._dockedWrappers.set(normalized.id, normalized.wrapper);
            }
        }

        this._viewerMobileSyncBound = () => this.syncActiveViewerMobile();
    }

    /** ---- dynamic tab API ---- */
    /**
     * Add a tab to the dock menu (creates the menu if missing).
     * Plain tab payloads are normalized into DockableWindow wrappers so they can
     * later be undocked without changing the external API.
     *
     * @param {MainLayoutTab|DockableWindow} mainLayoutTab - Tab definition or an already wrapped dockable.
     * @param {{wrapInDockableWindow?: boolean}} [options]
     * @returns {DockableWindow|null}
     */
    addTab(mainLayoutTab, options = undefined) {
        const candidateId = mainLayoutTab instanceof DockableWindow
            ? (mainLayoutTab._tabId || mainLayoutTab.id)
            : mainLayoutTab?.id;

        // Same-id reentry can happen while _normalizeDockableTab() is still
        // constructing a DockableWindow and its VisibilityManager.init() fires.
        if (candidateId && this._pendingDockableRegistrations.has(candidateId)) {
            return mainLayoutTab instanceof DockableWindow
                ? mainLayoutTab
                : this._wrapperRegistry.get(candidateId) || null;
        }

        if (candidateId) {
            this._pendingDockableRegistrations.add(candidateId);
        }

        try {
            if (!this._menu) this._ensureMenu();

            const normalized = this._normalizeDockableTab(mainLayoutTab, options);
            if (!normalized) return null;

            const { id, tab, wrapper } = normalized;

            const existingIndex = this._tabsArr.findIndex(existingTab => existingTab.id === id);
            if (existingIndex >= 0) {
                this._tabsArr.splice(existingIndex, 1, tab);
            } else {
                this._tabsArr.push(tab);
            }

            this._wrapperRegistry.set(id, wrapper);
            this._dockedWrappers.set(id, wrapper);
            wrapper.markTabRegistered?.(true);

            if (this._menu?.tabs?.[id]) {
                this._menu.remove?.(id);
                delete this._menu.tabs?.[id];
            }

            this._menu?.addTab(tab);
            this._syncMenuTabs();

            // Wrap the deferred-sync flush so `showTab(...)` calls
            // originating from a cached-visible tab's auto-show chain can
            // be distinguished from explicit user/programmatic showTabs.
            // The dock-suppression latch (`_sessionInitialHidden`) only
            // clears in the explicit case — see showTab().
            this._isFlushingDeferredSync = true;
            try {
                // Now that the wrapper is actually registered, it is safe to
                // apply its initial cached visibility state once.
                wrapper._flushDeferredVisibilitySync?.();
            } finally {
                this._isFlushingDeferredSync = false;
            }

            this._updateDockVisibility();
            return wrapper;
        } finally {
            if (candidateId) {
                this._pendingDockableRegistrations.delete(candidateId);
            }
        }
    }

    /**
     * Register an already created DockableWindow with the dock.
     * @param {DockableWindow} dockableWindow
     * @returns {DockableWindow|null}
     */
    addDockableWindow(dockableWindow) {
        return this.addTab(dockableWindow, { wrapInDockableWindow: false });
    }

    /**
     * Detach a docked tab from the dock while keeping its DockableWindow wrapper registered.
     * Used when a wrapper is switching from docked to floating mode.
     *
     * @param {string} id - The tab id to detach.
     * @returns {void}
     */
    detachDockableTab(id) {
        if (!this._menu) return;

        const i = this._tabsArr.findIndex(t => t.id === id);
        if (i >= 0) this._tabsArr.splice(i, 1);

        this._menu.remove?.(id);
        delete this._menu.tabs?.[id];

        const wrapper = this._dockedWrappers.get(id);
        wrapper?.markTabRegistered?.(false);
        this._dockedWrappers.delete(id);
        this._updateDockVisibility();
    }

    /**
     * Remove a tab from the dock and unregister its wrapper.
     * @param {string} id - The tab id to remove.
     * @returns {void}
     */
    removeTab(id) {
        this.detachDockableTab(id);
        this._wrapperRegistry.delete(id);
        this._registeredTabViewIds.delete(id);
    }

    /**
     * Remove all tabs from the dock menu.
     * @returns {void}
     */
    clearTabs() {
        this._tabsArr.length = 0;
        if (this._menu?.clear) {
            this._menu.clear();
        } else if (this._menu?.tabs) {
            for (const id of Object.keys(this._menu.tabs)) {
                this._menu.remove?.(id);
            }
        }

        for (const wrapper of this._dockedWrappers.values()) {
            wrapper?.markTabRegistered?.(false);
        }

        this._dockedWrappers.clear();
        this._wrapperRegistry.clear();
        this._registeredTabViewIds.clear();
        this._updateDockVisibility();
    }

    /**
     * Current number of tabs in the dock.
     * @type {number}
     */
    get tabCount() { return this._tabsArr.length; }

    /** ---- helpers ---- */
    /**
     * Returns the DOM element where the OpenSeadragon viewer should mount.
     * @returns {HTMLElement|null}
     */
    getViewerMount() { return document.getElementById("osd"); }
    /**
     * Returns the dock body container element (menu body) for injecting external content.
     * If no menu exists yet, returns the dock element itself.
     * @returns {HTMLElement|null}
     */
    getDockBodyNode() {
        return this._menu ? document.getElementById(`${this._menu.id}-body`) : this._dockEl;
    }

    /** Collapse the dock. */
    collapse() { this._setUserCollapsed(true); }
    /** Expand the dock. */
    expand() { this._setUserCollapsed(false); }
    /** Toggle the dock collapsed/expanded state. */
    toggle() {
        const narrow = typeof window !== "undefined" && window.innerWidth < this.collapseBreakpointPx;
        if (narrow) {
            this.toggleFullscreen();
        } else {
            this.collapsed ? this.expand() : this.collapse();
        }
    }

    /**
     * @param {boolean} [persist=false] true when the call carries explicit
     *   user intent — the open state is then written to AppCache so reloads
     *   restore it; derived/boot-time calls leave the cache untouched.
     */
    showGlobalMenu(persist = false) {
        if (!this._hasVisibleTabs()) {
            USER_INTERFACE.Dialogs.show($.t("main.globalMenu.noMenuToView"));
            this._setDockRequestedOpen(false);
            return false;
        }

        // explicit show intent must also undo a drag-collapsed dock,
        // otherwise the dock stays at 0px and the call looks like a no-op;
        // boot-time deferred-sync calls keep the persisted collapse intact
        const narrow = typeof window !== "undefined" && window.innerWidth < this.collapseBreakpointPx;
        if (!narrow && this.collapsed && !this._isFlushingDeferredSync) {
            this._setUserCollapsed(false);
        }
        this._setDockRequestedOpen(true, persist);
        // In overlay mode an explicit open (View-menu tab click, plugin
        // showTab/focus) should actually reveal the floating panel — not just
        // arm the rail. Auto-close on pointer/focus leave still applies.
        if (this._dockMode === "overlay") this._openOverlay();
        return this._isDockEffectivelyVisible();
    }

    /**
     * @param {boolean} [persist=false] see {@link showGlobalMenu}
     */
    hideGlobalMenu(persist = false) {
        this._setDockRequestedOpen(false, persist);
        return !this._isDockEffectivelyVisible();
    }

    toggleGlobalMenu() {
        // Explicit user intent clears the session-initial hide latch so the
        // open is honored. Subsequent programmatic opens are then allowed.
        this._sessionInitialHidden = false;
        return this.isOpened()
            ? this.hideGlobalMenu(true)
            : this.showGlobalMenu(true);
    }

    showTab(id) {
        // Called either by user action (View-menu tab toggle, plugin
        // `LAYOUT.showTab(...)`) or by the boot-time deferred-sync chain
        // that runs inside `addTab → _flushDeferredVisibilitySync`. Only
        // the former is "explicit user/programmatic intent" — clear the
        // dock-suppression latch in that case so the chain can open the
        // dock. Boot-time calls keep the latch set, preserving
        // `params.ui.globalMenu = false`.
        if (!this._isFlushingDeferredSync) {
            this._sessionInitialHidden = false;
        }
        const tab = this._menu?.tabs?.[id];
        if (!tab) return false;

        this._setTabVisibleState(tab, true);

        if (this._menu && typeof this._menu.focus === "function") {
            this._menu.focus(id);
        }
        USER_INTERFACE?.AppBar?.View && (USER_INTERFACE.AppBar.View._visualMenuNeedsRefresh = true);
        return this.showGlobalMenu(!this._isFlushingDeferredSync);
    }

    hideTab(id) {
        const tab = this._menu?.tabs?.[id];
        if (!tab) return false;

        this._setTabVisibleState(tab, false);

        if (!this._hasVisibleTabs()) {
            USER_INTERFACE?.AppBar?.View && (USER_INTERFACE.AppBar.View._visualMenuNeedsRefresh = true);
            return this.hideGlobalMenu(!this._isFlushingDeferredSync);
        }

        const nextVisible = this._getMenuTabs().find(menuTab => menuTab.id !== id && this._isTabVisible(menuTab));
        if (nextVisible?.id && typeof this._menu?.focus === "function") {
            this._menu.focus(nextVisible.id);
        }

        this._applyDockVisibility();
        USER_INTERFACE?.AppBar?.View && (USER_INTERFACE.AppBar.View._visualMenuNeedsRefresh = true);
        return true;
    }

    isOpened() {
        const narrow = typeof window !== 'undefined' && window.innerWidth < this.collapseBreakpointPx;
        if (narrow) {
            return !!this._isFullscreen;
        }
        return this._isDockEffectivelyVisible() && !this.collapsed;
    }

    /** Toggle fullscreen overlay when in narrow viewport. */
    toggleFullscreen() {
        if (!this._isDockEffectivelyVisible()) return;
        this._isFullscreen ? this._closeFullscreen() : this._openFullscreen();
    }

    closeFullscreen() {
        this._closeFullscreen();
    }

    openGlobalMenuMobile() {
        // Explicit user intent — same latch-clearing as toggleGlobalMenu().
        this._sessionInitialHidden = false;
        // Deliberately non-persisting: the mobile bottom bar switches panels
        // (viewer / viewer menu / global menu) as transient navigation — it
        // must not overwrite the desktop dock preference in AppCache.
        const narrow = typeof window !== "undefined" && window.innerWidth < this.collapseBreakpointPx;

        if (!narrow) {
            return this.showGlobalMenu();
        }

        const shown = this.showGlobalMenu();
        if (!shown) return false;

        if (!this._isFullscreen) {
            this._openFullscreen();
        }
        return true;
    }

    closeGlobalMenuMobile() {
        const narrow = typeof window !== "undefined" && window.innerWidth < this.collapseBreakpointPx;

        if (narrow && this._isFullscreen) {
            this._closeFullscreen();
        }

        // Non-persisting for the same reason as openGlobalMenuMobile().
        this.hideGlobalMenu();
        return true;
    }

    _openFullscreen() {
        if (!this._dockEl || !this._viewerEl || this._isFullscreen || !this._isDockEffectivelyVisible()) return;
        this._isFullscreen = true;
        // save inline state to restore later
        this._prevViewerDisplay = this._viewerEl.style.display || "";
        // also save the OSd (image) element display and top-side styles so we can keep top panel visible
        const osdEl = document.getElementById('osd');
        this._prevOsdDisplay = osdEl ? (osdEl.style.display || '') : null;
        this._osdElement = osdEl;
        const topSide = document.getElementById('top-side');
        this._topSideElement = topSide;
        if (topSide && !topSide.getAttribute('data-prev-style')) {
            const prev = {
                position: topSide.style.position || '',
                top: topSide.style.top || '',
                left: topSide.style.left || '',
                width: topSide.style.width || '',
                zIndex: topSide.style.zIndex || ''
            };
            topSide.setAttribute('data-prev-style', JSON.stringify(prev));
        }

        this._prevDockInlineStyles = {
            width: this._dockEl.style.width || "",
            height: this._dockEl.style.height || "",
        };

        // apply fullscreen styles to dock and hide viewer
        this._dockEl.style.width = "100%";
        this._dockEl.style.height = "100%";
        // hide only the image/container, keep top-side visible
        if (this._osdElement) this._osdElement.style.display = "none";
        // pin top-side to fixed so it stays visible above the fullscreen dock
        if (this._topSideElement) {
            this._topSideElement.style.position = 'fixed';
            this._topSideElement.style.top = '0';
            this._topSideElement.style.left = '0';
            this._topSideElement.style.width = '100%';
            this._topSideElement.style.zIndex = '10001';
        }
        try { document.documentElement.style.overflow = "hidden"; } catch (e) {}
        this._syncToolbars();
    }

    _closeFullscreen() {
        if (!this._dockEl || !this._viewerEl || !this._isFullscreen) return;
        this._isFullscreen = false;
        this._clearOverlayCloseTimer?.();
        const s = this._prevDockInlineStyles || {};
        this._dockEl.style.width = s.width;
        this._dockEl.style.height = s.height;
        // restore osd (image) display instead of whole viewer
        if (this._osdElement && this._prevOsdDisplay !== null) this._osdElement.style.display = this._prevOsdDisplay;
        else this._viewerEl.style.display = this._prevViewerDisplay;
        try { document.documentElement.style.overflow = ""; } catch (e) {}
        // restore top-side previous inline styles
        if (this._topSideElement) {
            const prevAttr = this._topSideElement.getAttribute('data-prev-style');
            if (prevAttr) {
                try {
                    const prev = JSON.parse(prevAttr);
                    this._topSideElement.style.position = prev.position || '';
                    this._topSideElement.style.top = prev.top || '';
                    this._topSideElement.style.left = prev.left || '';
                    this._topSideElement.style.width = prev.width || '';
                    this._topSideElement.style.zIndex = prev.zIndex || '';
                } catch (e) {}
                this._topSideElement.removeAttribute('data-prev-style');
            }
        }
        // ensure layout classes and visibility are correct after restoring
        this._applyResponsiveLayout();
        this._updateDockVisibility();
        this._syncToolbars();
    }

    _setDockRequestedOpen(next, persist = false) {
        const desired = !!next;

        // While `params.ui.globalMenu === false` is still in effect (the
        // user hasn't yet explicitly opened the dock), late programmatic
        // opens — e.g. a docked wrapper's deferred visibility sync, a
        // plugin calling `showTab` during init — must not pop the dock
        // back open. Cleared by the user via toggleGlobalMenu /
        // openGlobalMenuMobile / View-menu toggle (vm.on callback).
        if (desired && this._sessionInitialHidden) {
            return false;
        }

        if (this._dockRequestedOpen === desired) {
            // Explicit intent still lands in the cache even when the live
            // state already matches (e.g. deferred sync opened the dock
            // before the user's own click could).
            if (persist) {
                this._syncingDockRequestedState = true;
                try {
                    this.visibilityManager?.set?.(desired);
                } finally {
                    this._syncingDockRequestedState = false;
                }
            }
            this._applyDockVisibility();
            return true;
        }

        this._dockRequestedOpen = desired;
        this._syncingDockRequestedState = true;

        try {
            // Explicit user intent persists via set() (writes the v::id
            // AppCache key so reloads restore the choice); derived/boot
            // transitions use the non-persisting on()/off().
            if (persist) {
                this.visibilityManager?.set?.(desired);
            } else if (desired) {
                this.visibilityManager?.on?.();
            } else {
                this.visibilityManager?.off?.();
            }
        } finally {
            this._syncingDockRequestedState = false;
        }

        this._applyDockVisibility();
        return true;
    }

    /** @private */
    _normalizeDockableTab(mainLayoutTab, options = undefined) {
        const wrapInDockableWindow = options?.wrapInDockableWindow !== false;

        if (!mainLayoutTab) return null;

        if (mainLayoutTab instanceof DockableWindow) {
            const wrapper = mainLayoutTab;
            wrapper._layout = this;
            const tab = wrapper.toMainLayoutTab();
            return { id: tab.id, tab, wrapper };
        }

        if (mainLayoutTab.__dockableWindow instanceof DockableWindow) {
            const wrapper = mainLayoutTab.__dockableWindow;
            wrapper._layout = this;
            const tab = wrapper.toMainLayoutTab();
            return { id: tab.id, tab, wrapper };
        }

        if (!wrapInDockableWindow) {
            const wrapper = new DockableWindow({
                id: mainLayoutTab.id,
                title: mainLayoutTab.title || mainLayoutTab.id,
                icon: mainLayoutTab.iconName || mainLayoutTab.icon || "ph-frame-corners",
                tabId: mainLayoutTab.id,
                tabTitle: mainLayoutTab.title || mainLayoutTab.id,
                tabIcon: mainLayoutTab.iconName || mainLayoutTab.icon || "ph-frame-corners",
                defaultMode: "tab",
                layout: this,
                visibilityManager: mainLayoutTab.visibilityManager,
                floating: mainLayoutTab.floating,
            }, ...(mainLayoutTab.body || []));
            const tab = wrapper.toMainLayoutTab();
            return { id: tab.id, tab, wrapper };
        }

        const wrapper = new DockableWindow({
            id: mainLayoutTab.id,
            title: mainLayoutTab.title || mainLayoutTab.id,
            icon: mainLayoutTab.iconName || mainLayoutTab.icon || "ph-frame-corners",
            tabId: mainLayoutTab.id,
            tabTitle: mainLayoutTab.title || mainLayoutTab.id,
            tabIcon: mainLayoutTab.iconName || mainLayoutTab.icon || "ph-frame-corners",
            defaultMode: "tab",
            layout: this,
            visibilityManager: mainLayoutTab.visibilityManager,
            floating: mainLayoutTab.floating,
            onModeChange: mode => {
                if (mode === "floating") {
                    this.detachDockableTab(mainLayoutTab.id);
                } else {
                    this.addDockableWindow(wrapper);
                }
                this._updateDockVisibility();
            }
        }, ...(mainLayoutTab.body || []));

        const tab = wrapper.toMainLayoutTab();
        return { id: tab.id, tab, wrapper };
    }

    /** @private */
    _resolveDockable(tabOrId) {
        const id = typeof tabOrId === "string" ? tabOrId : tabOrId?.id;
        if (!id) return null;
        return this._dockedWrappers.get(id)
            || this._wrapperRegistry.get(id)
            || tabOrId?.__dockableWindow
            || null;
    }

    /** ---- internals ---- */
    /** @private */
    _ensureMenu() {
        if (!this._menu) {
            const menu = new TabsMenu({ id: `${this.id}-menu` }, ...this._tabsArr);
            this._menu = menu;
            if (this._dockEl) {
                menu.attachTo(this._dockEl);
                this._syncMenuTabs();
            }
        }
    }

    _getMenuTabs() {
        return Object.values(this._menu?.tabs || {});
    }

    _isTabVisible(tab) {
        if (!tab) return false;
        if (typeof tab.hidden === "boolean") {
            return !tab.hidden;
        }
        if (typeof tab.visibilityManager?.is === "function") {
            return !!tab.visibilityManager.is();
        }
        return true;
    }

    _setTabVisibleState(tab, visible) {
        if (!tab?.id) return false;

        tab.hidden = !visible;
        APPLICATION_CONTEXT.AppCache.set(`v::${tab.id}`, !!visible);

        if (tab.headerButton?.setClass) {
            tab.headerButton.setClass("display", visible ? "" : "hidden");
        } else {
            const headerNode = tab.headerButton?.id ? document.getElementById(tab.headerButton.id) : null;
            if (headerNode) {
                headerNode.classList.toggle("hidden", !visible);
            }
        }

        if (tab.contentDiv?.setClass) {
            const shouldShowContent = visible && this._menu?._focused === tab.id;
            tab.contentDiv.setClass("display", shouldShowContent ? "" : "display-none");
        } else {
            const contentNode = tab.contentDiv?.id ? document.getElementById(tab.contentDiv.id) : null;
            if (contentNode) {
                const shouldShowContent = visible && this._menu?._focused === tab.id;
                contentNode.classList.toggle("display-none", !shouldShowContent);
            }
        }

        return true;
    }

    _hasVisibleTabs() {
        const tabs = this._getMenuTabs();
        const sourceTabs = tabs.length ? tabs : this._tabsArr;
        return sourceTabs.some(tab => this._isTabVisible(tab));
    }

    _isDockEffectivelyVisible() {
        return !!this._dockRequestedOpen && this._hasVisibleTabs();
    }

    _applyDockVisibility() {
        if (!this._dockEl || !this._handleEl || !this._viewerEl) return;

        const hasVisibleTabs = this._hasVisibleTabs();

        if (!hasVisibleTabs && this._dockRequestedOpen) {
            this._setDockRequestedOpen(false);
            return;
        }

        const narrow = typeof window !== "undefined" && window.innerWidth < this.collapseBreakpointPx;
        // "menu available" = the user/plugins want the menu present. In docked
        // mode this means the dock is shown; in overlay mode it means the rail
        // is shown and the panel opens on hover/focus.
        const menuAvailable = this._dockRequestedOpen && hasVisibleTabs;
        const overlay = this._dockMode === "overlay" && !narrow;

        if (!menuAvailable && this._isFullscreen) {
            this._closeFullscreen();
        }

        if (!menuAvailable) {
            this._overlayExpanded = false;
            this._clearOverlayCloseTimer();
            this._dockEl.style.display = "none";
            this._dockEl.style.position = "relative";
            this._handleEl.style.display = "none";
            this._setKnobVisible(false);
            this._viewerEl.style.flex = "1 1 100%";
            return;
        }

        if (overlay) {
            // Floating dock: never reflow the viewer. The rail is the resting
            // affordance; the panel is layered on top only while expanded (so a
            // hover-open panel is NOT hidden by the not-requested-open path).
            this._viewerEl.style.flex = "1 1 100%";
            this._handleEl.style.display = "none";
            this._setKnobVisible(true);

            if (this._overlayExpanded) {
                this.widthPx = this._clampDockWidth(this.widthPx);
                this._positionOverlayDock();
                this._dockEl.style.display = "";
                this._dockEl.style.width = `${this.widthPx}px`;
                this._dockEl.style.height = "100%";
            } else {
                this._dockEl.style.display = "none";
            }
            return;
        }

        // Docked mode: dock is a flex sibling that pushes the viewer.
        this._overlayExpanded = false;
        this._clearOverlayCloseTimer();
        this._dockEl.style.position = "relative";
        this._dockEl.style.zIndex = "";
        this._dockEl.style.display = "";
        this._viewerEl.style.flex = "1 1 auto";
        this._applyVisibility();
    }

    /** @private absolute-position the floating overlay dock on the outer edge */
    _positionOverlayDock() {
        const d = this._dockEl;
        d.style.position = "absolute";
        d.style.top = "0";
        d.style.height = "100%";
        d.style.zIndex = "40";
        if (this.position === "left") {
            d.style.left = "0";
            d.style.right = "";
        } else {
            d.style.right = "0";
            d.style.left = "";
        }
    }

    /** @private */
    _updateDockVisibility() {
        this._applyDockVisibility();
    }

    _getDockWidthLimit() {
        if (typeof window === "undefined") {
            return this.maxWidth;
        }

        const viewportWidth = Math.max(window.innerWidth || 0, this.minWidth);
        const safeViewportLimit = Math.max(this.minWidth, viewportWidth - 24);
        return Math.max(this.minWidth, Math.min(this.maxWidth, safeViewportLimit));
    }

    _clampDockWidth(width) {
        const parsed = Number(width);
        const fallback = Number.isFinite(parsed) ? parsed : this.minWidth;
        return Math.max(this.minWidth, Math.min(this._getDockWidthLimit(), fallback));
    }

    _persistDockWidth() {
        this.widthPx = this._clampDockWidth(this.widthPx);
        APPLICATION_CONTEXT.AppCache.set(this._widthCacheKey, this.widthPx);
    }

    /** @private threshold below which a resize drag snaps to fully collapsed */
    _collapseThresholdPx() {
        return this.minWidth * 0.5;
    }

    /** @private user-intent collapse: persisted, unlike the responsive narrow-viewport collapse */
    _setUserCollapsed(value, persist = true) {
        value = !!value;
        this.collapsed = value;
        this._userCollapsed = value;
        if (persist) {
            APPLICATION_CONTEXT.AppCache.set(this._collapsedCacheKey, value);
        }
        this._applyVisibility();
    }

    /** @private */
    _clearOverlayCloseTimer() {
        if (this._overlayCloseTimer) {
            clearTimeout(this._overlayCloseTimer);
            this._overlayCloseTimer = null;
        }
    }

    /**
     * Reveal the floating overlay panel (overlay mode only). Independent of
     * `_dockRequestedOpen` so the rail stays the resting affordance while the
     * panel shows on top. Guarded by `_isDockEffectivelyVisible()` so a hover
     * cannot resurrect a dock the AppBar.Chrome hide sweep turned off.
     * @private
     */
    _openOverlay() {
        const narrow = typeof window !== "undefined" && window.innerWidth < this.collapseBreakpointPx;
        if (this._dockMode !== "overlay" || narrow || !this._isDockEffectivelyVisible()) return;
        this._clearOverlayCloseTimer();
        if (this._overlayExpanded) return;
        this._overlayExpanded = true;
        this._applyDockVisibility();
    }

    /** @private schedule an overlay close after a grace period (pointer rail→panel) */
    _scheduleOverlayClose(delay = 280) {
        if (this._dockMode !== "overlay" || !this._overlayExpanded) return;
        this._clearOverlayCloseTimer();
        this._overlayCloseTimer = setTimeout(() => this._closeOverlay(), delay);
    }

    /** @private */
    _closeOverlay() {
        this._clearOverlayCloseTimer();
        if (!this._overlayExpanded) return;
        this._overlayExpanded = false;
        this._applyDockVisibility();
    }

    /**
     * Switch the dock between "docked" (pushes the viewer, stays open) and
     * "overlay" (hides to the edge rail, floats over the viewer on hover/focus).
     * The runtime choice persists to AppCache and overrides the session config
     * default on the next boot.
     * @param {"docked"|"overlay"} mode
     * @param {boolean} [persist=true]
     */
    setDockMode(mode, persist = true) {
        if (mode !== "docked" && mode !== "overlay") return false;
        if (this._dockMode === mode) return true;
        this._dockMode = mode;
        if (persist) {
            APPLICATION_CONTEXT.AppCache.set(this._modeCacheKey, mode);
        }
        this._clearOverlayCloseTimer();
        this._overlayExpanded = false;

        if (mode === "docked") {
            // Re-enter the flow layout and reveal the pushing dock.
            this._dockEl.style.position = "relative";
            this._dockEl.style.zIndex = "";
            if (this._hasVisibleTabs()) {
                if (this.collapsed) this._setUserCollapsed(false);
                this._setDockRequestedOpen(true);
            }
        }
        // → overlay: keep _dockRequestedOpen so the rail shows; resting state is
        //   rail-only (panel closed) until hover/focus.

        this._updatePinButton();
        this._applyDockVisibility();
        return true;
    }

    /** @private reflect current mode on the pin toggle button */
    _updatePinButton() {
        const btn = this._pinBtnEl;
        if (!btn) return;
        const docked = this._dockMode === "docked";
        const icon = btn.querySelector("i");
        if (icon) icon.className = docked ? "ph-light ph-push-pin" : "ph-light ph-push-pin-slash";
        const label = docked ? $.t("main.globalMenu.unpinDock") : $.t("main.globalMenu.pinDock");
        btn.setAttribute("title", label);
        btn.setAttribute("aria-label", label);

        const rail = this._knobEl;
        if (rail) {
            const rTitle = docked
                ? $.t("main.globalMenu.dragToOpen")
                : $.t("main.globalMenu.hoverToOpen");
            rail.setAttribute("title", rTitle);
            rail.setAttribute("aria-label", rTitle);
        }
    }

    /** @private */
    _applyVisibility() {
        if (!this._dockEl || !this._dockRequestedOpen || !this._hasVisibleTabs()) return;

        const narrow = typeof window !== "undefined" && window.innerWidth < this.collapseBreakpointPx;
        if (this._dockMode === "overlay" && !narrow) {
            // overlay geometry is owned by _applyDockVisibility / _openOverlay
            this._applyDockVisibility();
            return;
        }

        if (this.collapsed) {
            this._dockEl.style.width = "0px";
            this._dockEl.style.height = "0px";
            this._handleEl.style.display = "none";
            // reopen rail only makes sense on wide layouts — narrow viewports
            // use the fullscreen overlay / mobile bottom bar instead
            this._setKnobVisible(!narrow);
        } else {
            this.widthPx = this._clampDockWidth(this.widthPx);
            this._dockEl.style.width = `${this.widthPx}px`;
            this._dockEl.style.height = "";
            this._handleEl.style.display = "";
            this._setKnobVisible(false);
        }
    }

    /** @private */
    _setKnobVisible(visible) {
        if (!this._knobEl) return;
        this._knobEl.style.display = visible ? "" : "none";
    }

    /** @private */
    _applyResponsiveLayout() {
        if (!this._shellEl) return;
        const narrow = window.innerWidth < this.collapseBreakpointPx;

        this.widthPx = this._clampDockWidth(this.widthPx);

        this._shellEl.classList.toggle("flex-col", narrow);
        this._shellEl.classList.toggle("flex-row", !narrow);
        this._viewerEl.style.order = this.position === "left" ? "1" : "0";
        this._dockEl.style.order = this.position === "left" ? "0" : "2";

        if (narrow) {
            // default collapsed on narrow; fullscreen may be toggled separately
            this.collapsed = true;
        } else {
            // leaving narrow viewport: ensure any fullscreen overlay is closed and viewer restored
            if (this._isFullscreen) this._closeFullscreen();
            // restore the user's persisted collapse instead of force-expanding
            this.collapsed = this._userCollapsed;
        }

        this._applyDockVisibility();
    }

    registerToolbar(toolbar) {
        if (!toolbar?.id) return null;

        this._toolbars.set(toolbar.id, toolbar);

        // The toolbar self-initializes its embed preference from its persisted
        // value (if any) or its `defaultEmbedded` opt-in. Apply the deployment-
        // wide default on top when configured and the toolbar has no opt-in.
        if (this._toolbarEmbedWideEnabled && !toolbar.getEmbedPreference?.()) {
            toolbar.setEmbedPreference?.(true);
        }

        if (!toolbar.__mainLayoutVisibilityHooked && typeof toolbar.visibility?.set === "function") {
            const originalSet = toolbar.visibility.set.bind(toolbar.visibility);
            toolbar.visibility.set = (...args) => {
                const result = originalSet(...args);
                queueMicrotask(() => this._syncToolbars());
                return result;
            };
            toolbar.__mainLayoutVisibilityHooked = true;
        }

        if (!this._activeToolbarId) {
            this._activeToolbarId = toolbar.id;
        }

        this._syncToolbars();
        return toolbar;
    }

    unregisterToolbar(toolbarId) {
        if (!toolbarId) return false;
        this._toolbars.delete(toolbarId);
        if (this._activeToolbarId === toolbarId) {
            this._activeToolbarId = null;
        }
        this._syncToolbars();
        return true;
    }

    setToolbarEmbedding(enabled, position = undefined) {
        this._toolbarEmbedWideEnabled = !!enabled;
        if (position === "above" || position === "below") {
            this._toolbarEmbeddingPosition = position;
        }
        this._syncToolbars();
        return this._isToolbarEmbedActive();
    }

    setToolbarEmbeddingPosition(position) {
        if (position !== "above" && position !== "below") return false;
        this._toolbarEmbeddingPosition = position;
        this._syncToolbars();
        return true;
    }

    /** Intent: does this toolbar want to live in the app bar? (held on the toolbar) */
    getToolbarEmbedPreference(toolbarId) {
        return this._toolbars.get(toolbarId)?.getEmbedPreference?.() ?? false;
    }

    /** Effective state: is this toolbar currently shown in the embed host? */
    isToolbarEmbedded(toolbarId) {
        const tb = this._toolbars.get(toolbarId);
        return !!tb && tb.id === this._activeToolbarId
            && this.getToolbarEmbedPreference(toolbarId)
            && !this._toolbarEmbeddedCollapsed;
    }

    /**
     * Set a toolbar's embed preference. Embedding makes it the active embedded
     * toolbar, un-collapses the host, and ensures it is requested-visible.
     * The persisted preference survives narrow/mobile fallback.
     */
    setToolbarEmbedded(toolbarId, embedded) {
        if (!toolbarId) return false;
        const tb = this._toolbars.get(toolbarId);
        // Preference lives on the toolbar (works even when AppCache is bypassed).
        tb?.setEmbedPreference?.(embedded);
        if (embedded) {
            this._activeToolbarId = toolbarId;
            APPLICATION_CONTEXT.AppCache.set(`${this.id}-active-toolbar`, toolbarId);
            this._toolbarEmbeddedCollapsed = false;
            APPLICATION_CONTEXT.AppCache.set(`${this.id}-toolbar-embedded-collapsed`, "false");
            if (tb && !(tb.isRequestedVisible?.() ?? true)) tb.visibility?.on?.();

            // The preference is kept, but on a too-narrow desktop window the
            // toolbar can't actually dock right now — tell the user why and that
            // it will dock automatically once there's room.
            const mobile = window.innerWidth < this.collapseBreakpointPx;
            if (!mobile && !this._appBarHasRoom()) {
                window.Dialogs?.show?.(
                    $.t("toolbar.embedNoRoom"),
                    6000,
                    window.Dialogs.MSG_WARN
                );
            }
        }
        this._syncToolbars();
        return true;
    }

    /** Toolbars whose persisted preference is "embedded" (switcher candidates). */
    _getEmbeddedToolbars() {
        return this._getRegisteredToolbars().filter(tb => this.getToolbarEmbedPreference(tb.id));
    }

    /** Is there enough horizontal room in the app-bar slot to host a toolbar? */
    _appBarHasRoom() {
        // Hard window-width gate first: below this the bar is too cramped to
        // share with a toolbar regardless of the momentary slot measurement.
        if (window.innerWidth < this._minAppBarEmbedWidthPx) {
            this._appBarHadRoom = false;
            return false;
        }
        const slot = globalThis.USER_INTERFACE?.AppBar?.ToolbarSlot;
        if (!slot?.getNode?.()) return false;
        const w = slot.getAvailableWidth?.() ?? 0;
        this._appBarHadRoom = this._appBarHadRoom
            ? w >= this._minEmbedLeaveWidthPx
            : w >= this._minEmbedWidthPx;
        return this._appBarHadRoom;
    }

    /**
     * Resolve a toolbar's effective slot. `appbar`/`bottombar` mean it occupies
     * the shared host; `floating` covers both non-embedded toolbars and the
     * narrow-pop-out fallback (preference is preserved either way); `hidden`
     * covers embedded-but-not-active and not-requested-visible toolbars.
     */
    _resolveToolbarSlot(toolbar, ctx) {
        const requestedVisible = toolbar.isRequestedVisible?.() ?? true;
        // Phones: floating toolbars don't work, so every VISIBLE toolbar embeds
        // into the bottom bar (active shown, others reachable via the switcher),
        // regardless of the desktop app-bar pin preference.
        if (ctx.mobile) {
            if (!requestedVisible) return "hidden";
            return toolbar.id === ctx.activeId ? "bottombar" : "hidden";
        }
        // Desktop: only pinned toolbars dock into the app bar; others float.
        const pref = this.getToolbarEmbedPreference(toolbar.id);
        if (!pref) return "floating";
        if (!requestedVisible) return "hidden";
        if (toolbar.id !== ctx.activeId) return "hidden";
        if (ctx.appBarRoom) return "appbar";
        return "floating"; // narrow pop-out; preference kept, re-docks on room
    }

    _parkToolbar(toolbar, target) {
        const root = toolbar.getRootNode?.();
        if (root && target && root.parentNode !== target) target.appendChild(root);
    }

    _mountToolbarHostInAppBar() {
        const slot = globalThis.USER_INTERFACE?.AppBar?.ToolbarSlot;
        if (!slot?.getNode?.() || !this._toolbarHostBarEl) return false;
        slot.mount(this._toolbarHostBarEl);
        // Blend into the 35px bar: no chrome (the bar is already glass), natural
        // height (~32px buttons) so it fits and centers via the bar. Overflow
        // stays visible so panel-button dropdowns can open *below* the bar like
        // the other app-bar menus (an overflow:hidden ancestor would trap them);
        // room is guaranteed by the window-width + slot-width gates.
        this._toolbarHostBarEl.className = "items-center gap-1 px-1 w-full min-w-0";
        this._toolbarContentEl.style.overflowX = "visible";
        // Collapse-to-peek is a phone affordance only; on the app bar the user
        // un-docks instead, so hide the collapse arrow here.
        if (this._toolbarCollapseBtn) this._toolbarCollapseBtn.style.display = "none";
        return true;
    }

    _mountToolbarHostInBottomBar() {
        const mb = globalThis.USER_INTERFACE?.MobileBottomBar;
        if (!mb?.mountToolbarHost || !this._toolbarHostBarEl) return false;
        mb.mountToolbarHost(this._toolbarHostBarEl);
        // Own full-width row in the bottom bar; the content scrolls horizontally
        // when the toolbar is wider than the phone (there's vertical room here).
        this._toolbarHostBarEl.className = "items-center gap-1 w-full px-1 py-1 min-w-0";
        this._toolbarContentEl.style.overflowX = "auto";
        if (this._toolbarCollapseBtn) this._toolbarCollapseBtn.style.display = "";
        return true;
    }

    _detachToolbarHost() {
        const el = this._toolbarHostBarEl;
        if (el?.parentNode) el.parentNode.removeChild(el);
        globalThis.USER_INTERFACE?.MobileBottomBar?.unmountToolbarHost?.(el);
    }

    toggleEmbeddedToolbarCollapsed(force = undefined) {
        this._toolbarEmbeddedCollapsed = typeof force === "boolean"
            ? force
            : !this._toolbarEmbeddedCollapsed;

        if (!this._toolbarEmbeddedCollapsed) {
            this._ensureActiveToolbarVisible();
        }

        APPLICATION_CONTEXT.AppCache.set(
            `${this.id}-toolbar-embedded-collapsed`,
            this._toolbarEmbeddedCollapsed ? "true" : "false"
        );
        this._syncToolbars();
        return this._toolbarEmbeddedCollapsed;
    }

    openEmbeddedToolbar() {
        if (!this._toolbars.size) return false;
        this._ensureActiveToolbarVisible();
        this._toolbarEmbeddedCollapsed = false;
        APPLICATION_CONTEXT.AppCache.set(`${this.id}-toolbar-embedded-collapsed`, "false");
        this._syncToolbars();
        return true;
    }

    closeEmbeddedToolbar() {
        if (!this._toolbars.size) return false;
        this._toolbarEmbeddedCollapsed = true;
        APPLICATION_CONTEXT.AppCache.set(`${this.id}-toolbar-embedded-collapsed`, "true");
        this._syncToolbars();
        return true;
    }

    _isToolbarEmbedActive(width = window.innerWidth) {
        return width < this.collapseBreakpointPx || this._toolbarEmbedWideEnabled;
    }

    _getRegisteredToolbars() {
        return Array.from(this._toolbars.values());
    }

    _getRequestedVisibleToolbars() {
        return this._getRegisteredToolbars().filter(toolbar => toolbar?.isRequestedVisible?.() ?? true);
    }

    _ensureActiveToolbarId(toolbars = undefined) {
        const list = Array.isArray(toolbars) ? toolbars : this._getRegisteredToolbars();
        const active = list.find(toolbar => toolbar.id === this._activeToolbarId);
        if (active) return active.id;

        this._activeToolbarId = list[0]?.id || null;
        if (this._activeToolbarId) {
            APPLICATION_CONTEXT.AppCache.set(`${this.id}-active-toolbar`, this._activeToolbarId);
        }
        return this._activeToolbarId;
    }

    _ensureActiveToolbarVisible() {
        const activeId = this._ensureActiveToolbarId(this._getRegisteredToolbars());
        if (!activeId) return false;

        const toolbar = this._toolbars.get(activeId);
        if (!toolbar) return false;

        if (!(toolbar.isRequestedVisible?.() ?? true)) {
            toolbar.visibility?.on?.();
        }
        return true;
    }

    _setActiveToolbar(id, ensureVisible = false) {
        if (!id || !this._toolbars.has(id)) return false;

        this._activeToolbarId = id;
        APPLICATION_CONTEXT.AppCache.set(`${this.id}-active-toolbar`, id);

        if (ensureVisible) {
            this._toolbars.get(id)?.visibility?.on?.();
        }

        this._syncToolbars();
        return true;
    }

    _rebuildToolbarSwitcher(toolbars) {
        if (!this._toolbarDropdown || !this._toolbarSwitcherWrap) return;

        // The switcher only makes sense when there are 2+ embedded toolbars to
        // swap between; hide it otherwise so a lone toolbar shows no stray icon.
        this._toolbarSwitcherWrap.style.display = toolbars.length > 1 ? "" : "none";

        this._toolbarDropdown.clear();
        toolbars.forEach(toolbar => {
            const meta = toolbar.getEmbeddedMeta?.() || {
                id: toolbar.id,
                title: toolbar.id,
                icon: "ph-wrench"
            };

            this._toolbarDropdown.addItem({
                id: meta.id,
                icon: meta.icon,
                label: meta.title,
                onClick: () => {
                    this._setActiveToolbar(meta.id, true);
                }
            });
        });

        this._toolbarDropdown.setSelected?.(this._ensureActiveToolbarId(toolbars));
    }

    _mountToolbarHost(showHost = true) {
        if (!this._toolbarHostBarEl || !this._toolbarAboveEl || !this._toolbarBelowEl) return;

        const target = this._toolbarEmbeddingPosition === "above" ? this._toolbarAboveEl : this._toolbarBelowEl;
        if (this._toolbarHostBarEl.parentNode !== target) {
            target.appendChild(this._toolbarHostBarEl);
        }

        this._toolbarAboveEl.style.display = showHost && this._toolbarEmbeddingPosition === "above" ? "" : "none";
        this._toolbarBelowEl.style.display = showHost && this._toolbarEmbeddingPosition === "below" ? "" : "none";
    }

    _positionPeekButton(mobile = window.innerWidth < this.collapseBreakpointPx) {
        if (!this._toolbarPeekEl) return;
        this._toolbarPeekEl.style.top = "";
        this._toolbarPeekEl.style.bottom = "";

        // Anchor the peek tab just under the app bar (desktop) or just above the
        // mobile bottom bar — wherever the embedded host lives when collapsed.
        if (mobile) {
            const bottomBarHeight = document.getElementById("bottom-container")?.offsetHeight || 0;
            this._toolbarPeekEl.style.bottom = `${bottomBarHeight + 8}px`;
        } else {
            const topOffset = (document.getElementById("top-container")?.offsetHeight || 35) + 8;
            this._toolbarPeekEl.style.top = `${topOffset}px`;
        }
    }

    _syncToolbars() {
        if (!this._toolbarFloatingEl || !this._toolbarHiddenEl || !this._toolbarContentEl) return;

        this._ensureToolbarSlotRoomSub();

        const allToolbars = this._getRegisteredToolbars();
        const mobile = window.innerWidth < this.collapseBreakpointPx;

        // Legacy above/below viewer hosts are unused by the new flow (the embed
        // target is the app bar, or the bottom bar on mobile; narrow desktop
        // pops out to floating).
        this._toolbarAboveEl.style.display = "none";
        this._toolbarBelowEl.style.display = "none";

        // Mobile global-window overlay: park everything hidden (existing behavior).
        if (this._shouldHideToolbarsForMobileGlobalWindow()) {
            this._toolbarFloatingEl.style.display = "none";
            this._toolbarHostBarEl.style.display = "none";
            this._toolbarPeekEl.style.display = "none";
            this._detachToolbarHost();
            for (const toolbar of allToolbars) {
                toolbar.setManagedVisible?.(false);
                this._parkToolbar(toolbar, this._toolbarHiddenEl);
            }
            return;
        }

        // Switcher candidate set: on a phone every visible toolbar (floating is
        // unavailable there); on desktop only the pinned ones.
        const embeddedToolbars = mobile
            ? allToolbars.filter(tb => tb.isRequestedVisible?.() ?? true)
            : this._getEmbeddedToolbars();
        const embeddedVisible = embeddedToolbars.filter(tb => tb.isRequestedVisible?.() ?? true);
        let activeId = this._ensureActiveToolbarId(embeddedToolbars);
        if (embeddedVisible.length && !embeddedVisible.some(tb => tb.id === activeId)) {
            activeId = embeddedVisible[0].id;
            this._activeToolbarId = activeId;
            APPLICATION_CONTEXT.AppCache.set(`${this.id}-active-toolbar`, activeId);
        }

        const appBarRoom = mobile ? true : this._appBarHasRoom();
        const ctx = { mobile, appBarRoom, activeId };

        // Route every toolbar to its effective slot. On mobile the floating
        // container is hidden (floating toolbars don't show on phones; the
        // embedded one relocates into the bottom bar).
        this._toolbarFloatingEl.style.display = mobile ? "none" : "";
        let activeSlot = null;
        for (const toolbar of allToolbars) {
            const slot = this._resolveToolbarSlot(toolbar, ctx);
            if (toolbar.id === activeId) activeSlot = slot;
            this._applyToolbarSlot(toolbar, slot);
        }

        // Host bar (switcher + active toolbar content) placement. Collapse-to-
        // peek only applies in the mobile bottom bar; the app bar never collapses.
        const embeddable = activeSlot === "appbar" || activeSlot === "bottombar";
        const collapsed = activeSlot === "bottombar" && this._toolbarEmbeddedCollapsed;
        const showHost = embeddable && !collapsed;
        const showPeek = embeddable && collapsed;

        if (showHost) {
            const mounted = mobile ? this._mountToolbarHostInBottomBar() : this._mountToolbarHostInAppBar();
            this._rebuildToolbarSwitcher(embeddedToolbars);
            this._toolbarHostBarEl.style.display = mounted ? "flex" : "none";
        } else {
            this._toolbarHostBarEl.style.display = "none";
            this._detachToolbarHost();
        }

        this._positionPeekButton(mobile);
        this._toolbarPeekEl.style.display = showPeek ? "" : "none";
    }

    /** Apply embedded/floating styles and re-parent a toolbar for its slot. */
    _applyToolbarSlot(toolbar, slot) {
        switch (slot) {
            case "appbar":
                // App bar never collapses — always show in the host.
                toolbar.setEmbeddedMode?.(true);
                toolbar.setManagedVisible?.(true);
                this._parkToolbar(toolbar, this._toolbarContentEl);
                toolbar.onLayoutChange?.({ width: window.innerWidth });
                break;
            case "bottombar":
                toolbar.setEmbeddedMode?.(true);
                if (this._toolbarEmbeddedCollapsed) {
                    toolbar.setManagedVisible?.(false);
                    this._parkToolbar(toolbar, this._toolbarHiddenEl);
                } else {
                    toolbar.setManagedVisible?.(true);
                    this._parkToolbar(toolbar, this._toolbarContentEl);
                }
                toolbar.onLayoutChange?.({ width: window.innerWidth });
                break;
            case "floating":
                toolbar.setEmbeddedMode?.(false);
                toolbar.setManagedVisible?.(toolbar.isRequestedVisible?.() ?? true);
                toolbar.onLayoutChange?.({ width: window.innerWidth });
                this._parkToolbar(toolbar, this._toolbarFloatingEl);
                break;
            case "hidden":
            default:
                toolbar.setManagedVisible?.(false);
                this._parkToolbar(toolbar, this._toolbarHiddenEl);
                break;
        }
    }

    /** Subscribe once to app-bar slot width changes so embed↔float fallback
     * reacts to bar pressure that isn't a window resize (tab open, badge, etc.). */
    _ensureToolbarSlotRoomSub() {
        if (this._toolbarSlotRoomUnsub) return;
        const slot = globalThis.USER_INTERFACE?.AppBar?.ToolbarSlot;
        if (!slot?.getNode?.() || typeof slot.onRoom !== "function") return;
        this._toolbarSlotRoomUnsub = slot.onRoom(() => this._syncToolbars());
    }

    _buildToolbarHost() {
        if (this._toolbarAboveEl) return;

        this._toolbarAboveEl = document.createElement("div");
        this._toolbarAboveEl.id = `${this.id}-toolbar-host-above`;
        this._toolbarAboveEl.className = "shrink-0 px-1 pt-1";

        this._toolbarBelowEl = document.createElement("div");
        this._toolbarBelowEl.id = `${this.id}-toolbar-host-below`;
        this._toolbarBelowEl.className = "shrink-0 px-1 pb-1";

        this._toolbarFloatingEl = document.createElement("div");
        this._toolbarFloatingEl.id = "toolbars-container";
        this._toolbarFloatingEl.className = "absolute inset-0 pointer-events-none";
        this._toolbarFloatingEl.style.zIndex = "980";

        this._toolbarHiddenEl = document.createElement("div");
        this._toolbarHiddenEl.id = `${this.id}-toolbar-hidden`;
        //this._toolbarHiddenEl.className = "hidden";

        this._toolbarDropdown = new Dropdown({
            id: `${this.id}-toolbar-switcher`,
            parentId: this.id,
            title: $.t("toolbar.switch"),
            icon: "ph-arrows-left-right",
            items: []
        });
        this._toolbarDropdown.iconOnly();

        this._toolbarHostBarEl = document.createElement("div");
        this._toolbarHostBarEl.id = `${this.id}-toolbar-host-bar`;
        this._toolbarHostBarEl.className = "items-center gap-1 glass border border-base-300 rounded-md shadow-sm px-1 py-1 max-w-full w-full justify-between";

        this._toolbarSwitcherWrap = document.createElement("div");
        this._toolbarSwitcherWrap.appendChild(this._toolbarDropdown.create());

        this._toolbarContentEl = document.createElement("div");
        this._toolbarContentEl.id = `${this.id}-toolbar-content`;
        // The toolbar lives here; the switcher and un-dock button (host siblings)
        // stay fixed/visible. Overflow handling is set per host: clipped in the
        // tight app bar (a scrollbar would eat vertical space and break the
        // 35px bar), scrollable in the roomier mobile bottom bar.
        this._toolbarContentEl.className = "min-w-0";
        this._toolbarContentEl.style.display = "flex";
        this._toolbarContentEl.style.alignItems = "center";

        // Detach (un-dock) the active embedded toolbar back to floating. This is
        // the embedded-mode counterpart of each toolbar's floating "dock" button.
        this._toolbarFloatBtn = document.createElement("button");
        this._toolbarFloatBtn.type = "button";
        this._toolbarFloatBtn.className = "btn btn-ghost btn-xs";
        this._toolbarFloatBtn.title = $.t("toolbar.float");
        this._toolbarFloatBtn.innerHTML = '<i class="fa-solid fa-up-right-from-square"></i>';
        this._toolbarFloatBtn.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            if (this._activeToolbarId) this.setToolbarEmbedded(this._activeToolbarId, false);
        });

        this._toolbarCollapseBtn = document.createElement("button");
        this._toolbarCollapseBtn.type = "button";
        this._toolbarCollapseBtn.className = "btn btn-ghost btn-xs";
        this._toolbarCollapseBtn.title = $.t("toolbar.collapse");
        this._toolbarCollapseBtn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
        this._toolbarCollapseBtn.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            this.toggleEmbeddedToolbarCollapsed(true);
        });

        this._toolbarHostBarEl.append(this._toolbarSwitcherWrap, this._toolbarContentEl, this._toolbarFloatBtn, this._toolbarCollapseBtn);

        this._toolbarPeekEl = document.createElement("button");
        this._toolbarPeekEl.type = "button";
        this._toolbarPeekEl.id = `${this.id}-toolbar-peek`;
        this._toolbarPeekEl.className = "btn btn-sm";
        this._toolbarPeekEl.title = $.t("toolbar.open");
        this._toolbarPeekEl.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
        this._toolbarPeekEl.style.position = "fixed";
        this._toolbarPeekEl.style.right = "-6px";
        this._toolbarPeekEl.style.zIndex = "995";
        this._toolbarPeekEl.style.borderTopRightRadius = "0";
        this._toolbarPeekEl.style.borderBottomRightRadius = "0";
        this._toolbarPeekEl.style.paddingLeft = "0.6rem";
        this._toolbarPeekEl.style.paddingRight = "0.7rem";
        this._toolbarPeekEl.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            this.openEmbeddedToolbar();
        });

        queueMicrotask(() => {
            const btn = document.getElementById(this._toolbarDropdown.headerButton.id);
            if (btn) {
                btn.classList.add("btn", "btn-sm");
                btn.style.minHeight = "2rem";
                btn.style.height = "2rem";
                btn.style.width = "2rem";
                btn.style.padding = "0.35rem";
            }
        });
    }

    _ensureViewCategory() {
        const view = globalThis.USER_INTERFACE.AppBar.View;
        if (!view?.structure) return null;

        if (!view.structure[this._dockViewTabCategory]) {
            view.structure[this._dockViewTabCategory] = {
                id: "global-menu-tabs",
                label: $.t("main.bar.globalMenus"),
                icon: "ph-tabs",
                section: "global-windows",
            };
            view._visualMenuNeedsRefresh = true;
        }

        return view;
    }

    _shouldHideToolbarsForMobileGlobalWindow() {
        return this._isFullscreen && window.innerWidth < this.collapseBreakpointPx;
    }

    _registerTabInView(tab) {
        if (!tab?.id || this._registeredTabViewIds.has(tab.id)) return;
        const view = this._ensureViewCategory();
        if (!view) return;

        const wrapper = this._resolveDockable(tab);
        const viewRegistration = wrapper?.getViewRegistration?.();

        view.registerViewComponent(this._dockViewTabCategory, {
            id: viewRegistration?.id || tab.id,
            title: viewRegistration?.title || tab.title || tab.id,
            icon: viewRegistration?.icon || tab.iconName || tab.icon || "ph-frame-corners",
            visibilityManager: {
                // Reflects what the user actually sees: a tab is "on" only
                // when the dock is currently open AND the tab itself is
                // unhidden. Without this, a `globalMenu:false` session
                // would render every tab row as checked even though the
                // dock (and the tab inside it) is invisible.
                is: () => this._isDockEffectivelyVisible() && this._isTabVisible(tab),
                set: next => next
                    ? this.showTab(tab.id)
                    : this.hideTab(tab.id)
            }
        });

        this._registeredTabViewIds.add(tab.id);
    }

    _syncMenuTabs() {
        if (!this._menu) return;
        this._ensureViewCategory();
        for (const tab of this._getMenuTabs()) {
            this._setTabVisibleState(tab, this._isTabVisible(tab));
            this._attachCloseButton(tab);
            this._registerTabInView(tab);
        }
        this._ensureFocusedVisibleTab();
        USER_INTERFACE?.AppBar?.View && (USER_INTERFACE.AppBar.View._visualMenuNeedsRefresh = true);
    }

    _ensureFocusedVisibleTab() {
        if (!this._menu || typeof this._menu.focus !== "function") return;

        const focusedId = this._menu._focused;
        const focusedTab = focusedId ? this._menu.tabs?.[focusedId] : null;
        if (focusedTab && this._isTabVisible(focusedTab)) {
            return;
        }

        const nextVisible = this._getMenuTabs().find(tab => this._isTabVisible(tab));
        if (nextVisible?.id) {
            this._menu.focus(nextVisible.id);
            this._setTabVisibleState(nextVisible, true);
            return;
        }

        this._menu.unfocusAll?.();
    }

    _attachCloseButton(tab) {
        const headerId = tab?.headerButton?.id;
        if (!headerId) return;

        const headerEl = document.getElementById(headerId);
        if (!headerEl || headerEl.querySelector(`[data-main-layout-close="${tab.id}"]`)) return;

        headerEl.style.position = headerEl.style.position || "relative";

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.setAttribute("data-main-layout-close", tab.id);
        closeButton.setAttribute("title", $.t("common.Close"));
        closeButton.className = "btn btn-ghost btn-xs";
        closeButton.style.position = "absolute";
        closeButton.style.top = "2px";
        closeButton.style.right = "2px";
        closeButton.style.minHeight = "1rem";
        closeButton.style.height = "1rem";
        closeButton.style.width = "1rem";
        closeButton.style.padding = "0";
        closeButton.style.lineHeight = "1";
        closeButton.innerHTML = "&times;";
        closeButton.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            this.hideTab(tab.id);
        });

        headerEl.append(closeButton);
    }

    /** @private */
    _wireResize() {
        if (!this._handleEl) return;
        let drag = false, startX = 0, startW = 0, previewCollapsed = false;

        const onMove = e => {
            if (!drag) return;
            const dx = e.clientX - startX;
            const newW = this.position === "left" ? startW + dx : startW - dx;
            if (newW < this._collapseThresholdPx()) {
                // dragged well past the minimum: snap-preview the fully
                // collapsed state; widthPx keeps the last real width so
                // reopening restores it
                previewCollapsed = true;
                this._dockEl.style.width = "0px";
            } else {
                previewCollapsed = false;
                this.widthPx = this._clampDockWidth(newW);
                this._dockEl.style.width = `${this.widthPx}px`;
            }
            e.preventDefault();
        };
        const onUp = () => {
            drag = false;
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            if (previewCollapsed) {
                previewCollapsed = false;
                this._setUserCollapsed(true);
            } else {
                this._persistDockWidth();
            }
        };

        this._handleEl.addEventListener("mousedown", e => {
            if (this.collapsed || !this._isDockEffectivelyVisible()) return;
            drag = true;
            startX = e.clientX;
            startW = this._dockEl.getBoundingClientRect().width;
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
            e.preventDefault();
        });
    }

    /**
     * Wire the collapsed-state edge knob: click reopens at the persisted
     * width, dragging it inward live-resizes and snaps open past the
     * collapse threshold (mirror of the handle's snap-close).
     * @private
     */
    _wireKnob() {
        if (!this._knobEl) return;
        let drag = false, startX = 0, moved = false;

        const overlayMode = () => this._dockMode === "overlay"
            && !(typeof window !== "undefined" && window.innerWidth < this.collapseBreakpointPx);

        const onMove = e => {
            if (!drag) return;
            if (Math.abs(e.clientX - startX) > 3) moved = true;
            const shellRect = this._shellEl.getBoundingClientRect();
            const candidate = this.position === "left"
                ? e.clientX - shellRect.left
                : shellRect.right - e.clientX;

            if (overlayMode()) {
                // Drag resizes the floating overlay panel; keep it open meanwhile.
                this._clearOverlayCloseTimer();
                if (candidate >= this._collapseThresholdPx()) {
                    this.widthPx = this._clampDockWidth(candidate);
                    if (this._overlayExpanded) {
                        this._dockEl.style.width = `${this.widthPx}px`;
                    } else {
                        this._openOverlay();
                    }
                }
                e.preventDefault();
                return;
            }

            if (candidate >= this._collapseThresholdPx()) {
                if (this.collapsed) {
                    // live-expand; persisted on mouseup
                    this.collapsed = false;
                    this._applyVisibility();
                }
                this.widthPx = this._clampDockWidth(candidate);
                this._dockEl.style.width = `${this.widthPx}px`;
            } else if (!this.collapsed) {
                // dragged back into the collapse zone
                this.collapsed = true;
                this._applyVisibility();
            }
            e.preventDefault();
        };
        const onUp = () => {
            drag = false;
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);

            if (overlayMode()) {
                if (!moved) this._openOverlay();
                else this._persistDockWidth();
                return;
            }

            if (!moved) {
                this._setUserCollapsed(false);
            } else {
                this._setUserCollapsed(this.collapsed);
                if (!this.collapsed) this._persistDockWidth();
            }
        };

        this._knobEl.addEventListener("mousedown", e => {
            if (!this._isDockEffectivelyVisible()) return;
            drag = true;
            moved = false;
            startX = e.clientX;
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
            e.preventDefault();
        });

        // Overlay-mode reveal: hover/focus the rail (or the revealed panel) opens
        // it; leaving either schedules a graced close so a rail→panel pointer
        // move keeps it open.
        const enter = () => { if (overlayMode()) this._openOverlay(); };
        const leave = () => { if (overlayMode()) this._scheduleOverlayClose(); };
        this._knobEl.addEventListener("mouseenter", enter);
        this._knobEl.addEventListener("mouseleave", leave);
        this._knobEl.addEventListener("focusin", enter);
        this._knobEl.addEventListener("focusout", leave);
        this._dockEl.addEventListener("mouseenter", enter);
        this._dockEl.addEventListener("mouseleave", leave);
        this._dockEl.addEventListener("focusin", enter);
        this._dockEl.addEventListener("focusout", leave);
    }

    /**
     * Create and return the root layout element. This builds the viewer area,
     * top/bottom menus containers, and the side dock with resizable handle.
     * @returns {HTMLElement} Root element to attach to the DOM.
     */
    create() {
        this._buildToolbarHost();

        // --- viewer core (IDs unchanged) ---
        const osd = div({ id:"osd", style:"position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events:auto;", class:"grow relative w-full overflow-hidden" });
        const viewerSurface = div(
            { class:"relative flex-1 min-h-0" },
            osd,
            new RawHtml(null, `<div id="fullscreen-menu" class="bg-base-100"></div>`).create(),
            this._toolbarFloatingEl
        );
        const viewerWrap = div(
            { class:"relative flex-1 min-w-0 min-h-0 flex flex-col" },
            this._toolbarAboveEl,
            viewerSurface,
            this._toolbarBelowEl,
            this._toolbarHiddenEl
        );

        const topSide = new Div({ id: "top-side-wrapper" }, new RawHtml(null, `
            <div id="top-side" class="flex-row w-full glass" style="display: flex; position: relative; align-items: center; height: 35px; pointer-events: none;">
                <div id="top-menus" class="flex flex-row items-center w-full">
                    <div id="top-side-left" class="flex flex-row" style="align-items: center; pointer-events: auto;"></div>
                    <div id="top-side-toolbar-slot" class="flex flex-row items-center min-w-0 flex-1 px-1" style="pointer-events: auto;"></div>
                    <div class="flex flex-row" style="align-items: center;">

                        <div id="top-side-badges" class="flex flex-row gap-1" style="align-items: center; margin-right: 6px; pointer-events: auto;"></div>
                        <div id="top-side-left-user" style="margin-left: 5px; margin-right: 5px; pointer-events: auto;"></div>
                        <div id="top-side-left-fullscreen" style="margin-left: 5px; pointer-events: auto;"></div>
                    </div>
                </div>
            </div>`).create());
        topSide.attachTo(document.getElementById('top-container'));

        // --- dock ---
        const dock = new Div({
            id:`${this.id}-dock`,
            extraClasses: {
                base: "bg-base-200 border-l border-base-300 shrink-0 overflow-hidden flex flex-col"
            },
            // position:relative anchors the absolute pin button (docked mode);
            // overlay mode overrides to position:absolute (also a context)
            extraProperties: { style: `width:${this.widthPx}px; position:relative;` }
        });

        this._dockEl = dock.create();

        if (this._tabsArr.length) {
            const menu = new TabsMenu({ id:`${this.id}-menu` }, ...this._tabsArr);
            this._menu = menu;
            menu.attachTo(this._dockEl);
        }

        // Dock-header-corner pin toggle: switch docked <-> overlay. Placed on the
        // inner corner (opposite the outer edge rail and the per-tab close
        // buttons at top-right) so controls don't collide.
        const pinBtn = document.createElement("button");
        pinBtn.type = "button";
        pinBtn.id = `${this.id}-pin`;
        pinBtn.className = "btn btn-ghost btn-xs";
        pinBtn.style.position = "absolute";
        pinBtn.style.top = "2px";
        pinBtn.style[this.position === "left" ? "right" : "left"] = "2px";
        pinBtn.style.zIndex = "2";
        pinBtn.style.minHeight = "1.25rem";
        pinBtn.style.height = "1.25rem";
        pinBtn.style.width = "1.25rem";
        pinBtn.style.padding = "0";
        pinBtn.style.lineHeight = "1";
        pinBtn.innerHTML = `<i class="ph-light ph-push-pin-fill"></i>`;
        pinBtn.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            this.setDockMode(this._dockMode === "docked" ? "overlay" : "docked");
        });
        this._dockEl.appendChild(pinBtn);
        this._pinBtnEl = pinBtn;
        this._updatePinButton();

        const handle = div({
            id: `${this.id}-handle`,
            class: `
w-1 shrink-0 cursor-col-resize
transition-transform duration-150
hover:bg-base-300/50
hover:scale-x-300
origin-center
`
        });
        const dockNode = this._dockEl;
        const shell = div({ id:this.id, class:"absolute w-full h-full top-0 left-0 flex flex-row" },
            this.position === "left" ? [dockNode, handle, viewerWrap] : [viewerWrap, handle, dockNode]
        );

        // Thin full-height edge rail shown while the dock is collapsed (docked)
        // or resting (overlay). Docked: click or drag it inward to reopen.
        // Overlay: hover/focus reveals the floating panel. Kept flush and thin
        // (7px, no caret/border) so it never overlaps the per-viewer
        // RightSideViewerMenu. Inline positioning — the purged tailwind build
        // lacks translate/fractional utilities.
        const knobOnLeft = this.position === "left";
        const railTitle = this._dockMode === "overlay"
            ? $.t("main.globalMenu.hoverToOpen")
            : $.t("main.globalMenu.dragToOpen");
        // Static "< chevron" grip pattern so it reads as interactive (and hints
        // the open direction) without a distracting animation — see
        // `.xo-menu-rail` in src/assets/custom.css. Muted neutral colour, not
        // the primary accent. The `is-left` modifier flips the chevrons (>) for
        // a left-positioned dock. On hover it darkens and widens inward
        // (reusing the resize handle's compiled hover:scale-x-300, anchored to
        // the outer edge so it grows into the viewport). z-index:0 keeps it
        // below every other UI (toolbars, side menus, dialogs).
        const knob = div({
            id: `${this.id}-knob`,
            class: `xo-menu-rail${knobOnLeft ? " is-left" : ""}`
                + " bg-base-200 hover:bg-base-300"
                + " select-none transition-transform duration-150 hover:scale-x-300",
            // cursor set inline (col-resize) so it wins over Tailwind preflight's
            // `[role]{cursor:pointer}`; this is a resize handle, so ARIA it as a
            // focusable vertical separator, not a button.
            style: `display:none; position:absolute; top:0; ${knobOnLeft ? "left" : "right"}:0;`
                + ` width:8px; height:100%; z-index:0; touch-action:none; cursor:col-resize;`
                + ` transform-origin:${knobOnLeft ? "left" : "right"} center;`,
            title: railTitle,
            tabindex: "0",
            role: "separator",
            "aria-orientation": "vertical",
            "aria-label": railTitle,
        });

        this._shellEl = shell;
        this._viewerEl = viewerWrap;
        this._handleEl = handle;
        this._knobEl = knob;
        shell.appendChild(this._toolbarPeekEl);
        shell.appendChild(knob);

        this._syncMenuTabs();
        this._wireResize();
        this._wireKnob();
        this._applyResponsiveLayout();
        this._updateDockVisibility();
        this._syncToolbars();

        this.syncActiveViewerMobile();

        if (window.VIEWER_MANAGER?.addHandler) {
            VIEWER_MANAGER.addHandler("viewer-create", this._viewerMobileSyncBound);
            VIEWER_MANAGER.addHandler("viewer-remove", this._viewerMobileSyncBound);
        }

        return shell;
    }

    onLayoutChange(details) {
        this._applyResponsiveLayout();
        this._syncToolbars();
        this.syncActiveViewerMobile();
    }

    _getViewerLayoutCells() {
        const VM = window.VIEWER_MANAGER;
        const layout = VM?.layout;
        const viewers = Array.isArray(VM?.viewers) ? VM.viewers.filter(Boolean) : [];

        if (!layout || typeof layout.findCellById !== "function") {
            return [];
        }

        return viewers
            .map(viewer => ({
                viewer,
                cell: layout.findCellById(viewer?.id)
            }))
            .filter(entry => entry.viewer && entry.cell);
    }

    syncActiveViewerMobile() {
        const VM = window.VIEWER_MANAGER;
        const layout = VM?.layout;
        if (!layout) return;

        const isMobile = window.innerWidth < this.collapseBreakpointPx;
        const activeViewer = VM?.get?.() || null;
        const activeId = activeViewer?.id || null;

        if (isMobile && activeId && typeof layout.showOnly === "function") {
            layout.showOnly(activeId);
        } else if (typeof layout.showAll === "function") {
            layout.showAll();
        }

        requestAnimationFrame(() => {
            const currentActive = VM?.get?.() || activeViewer;
            if (currentActive) {
                try {
                    const container = currentActive.container;
                    //currentActive.viewport.resize(new OpenSeadragon.Point(container.clientWidth || 1, container.clientHeight || 1));
                    currentActive.forceRedraw();
                } catch (e) {
                    // no-op
                }
            }
        });
    }
}
