import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { Div } from "../elements/div.mjs";
import { TabsMenu } from "./tabsMenu.mjs";
import { RawHtml } from "../elements/rawHtml.mjs";

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
 * @property {string} [icon] - Icon class name, e.g., "fa-circle-info".
 * @property {string} [title] - Human-readable title.
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
        this.widthPx = options.initialWidth ?? 360;
        this.minWidth = options.minWidth ?? 220;
        this.maxWidth = options.maxWidth ?? 640;
        this.collapseBreakpointPx = options.collapseBreakpointPx ?? 900;
        this.collapsed = false;

        // fullscreen-on-narrow state
        this._isFullscreen = false;
        this._prevViewerDisplay = null;
        this._prevDockInlineStyles = null;

        this._tabsArr = [];
        if (Array.isArray(options.tabs)) this._tabsArr.push(...options.tabs);
        this._menu = options.menu || null;

        this._shellEl = this._viewerEl = this._dockEl = this._handleEl = null;
        this._onResize = () => this._applyResponsiveLayout();
        window.addEventListener("resize", this._onResize, { passive: true });
    }

    /** ---- dynamic tab API ---- */
    /**
     * Add a tab to the dock menu (creates the menu if missing).
     * @param {MainLayoutTab} mainLayoutTab - Tab definition to add.
     * @returns {void}
     */
    addTab(mainLayoutTab) {
        if (!this._menu) this._ensureMenu();
        this._tabsArr.push(mainLayoutTab);
        this._menu.addTab(mainLayoutTab);
        this._updateDockVisibility();
    }

    /**
     * Remove a tab from the dock by its id.
     * @param {string} id - The tab id to remove.
     * @returns {void}
     */
    removeTab(id) {
        if (!this._menu) return;
        const i = this._tabsArr.findIndex(t => t.id === id);
        if (i >= 0) this._tabsArr.splice(i, 1);
        this._menu.remove(id);
        this._updateDockVisibility();
    }

    /**
     * Remove all tabs from the dock menu.
     * @returns {void}
     */
    clearTabs() {
        this._tabsArr.length = 0;
        if (this._menu) this._menu.clear();
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
    collapse() { this.collapsed = true; this._applyVisibility(); }
    /** Expand the dock. */
    expand() { this.collapsed = false; this._applyVisibility(); }
    /** Toggle the dock collapsed/expanded state. */
    toggle() {
        const narrow = typeof window !== 'undefined' && window.innerWidth < this.collapseBreakpointPx;
        if (narrow) {
            this.toggleFullscreen();
        } else {
            this.collapsed ? this.expand() : this.collapse();
        }
    }

    /** Toggle fullscreen overlay when in narrow viewport. */
    toggleFullscreen() {
        this._isFullscreen ? this._closeFullscreen() : this._openFullscreen();
    }

    _openFullscreen() {
        if (!this._dockEl || !this._viewerEl || this._isFullscreen) return;
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
            position: this._dockEl.style.position || "",
            top: this._dockEl.style.top || "",
            left: this._dockEl.style.left || "",
            width: this._dockEl.style.width || "",
            height: this._dockEl.style.height || "",
            zIndex: this._dockEl.style.zIndex || "",
            overflow: this._dockEl.style.overflow || ""
        };

        // apply fullscreen styles to dock and hide viewer
        this._dockEl.style.position = "fixed";
        this._dockEl.style.top = "0";
        this._dockEl.style.left = "0";
        this._dockEl.style.width = "100%";
        this._dockEl.style.height = "100%";
        this._dockEl.style.zIndex = "9999";
        this._dockEl.style.overflow = "auto";
        // hide only the image/container, keep top-side visible
        if (this._osdElement) this._osdElement.style.display = "none";
        // add top padding so content is not hidden under pinned top-side
        if (this._topSideElement) {
            const rect = this._topSideElement.getBoundingClientRect();
            const topH = Math.ceil(rect.height || 0);
            // save previous paddingTop
            this._prevDockPaddingTop = this._dockEl.style.paddingTop || "";
            this._dockEl.style.paddingTop = topH + "px";
        }
        // pin top-side to fixed so it stays visible above the fullscreen dock
        if (this._topSideElement) {
            this._topSideElement.style.position = 'fixed';
            this._topSideElement.style.top = '0';
            this._topSideElement.style.left = '0';
            this._topSideElement.style.width = '100%';
            this._topSideElement.style.zIndex = '10001';
        }
        try { document.documentElement.style.overflow = "hidden"; } catch (e) {}
    }

    _closeFullscreen() {
        if (!this._dockEl || !this._viewerEl || !this._isFullscreen) return;
        this._isFullscreen = false;
        const s = this._prevDockInlineStyles || {};
        this._dockEl.style.position = s.position;
        this._dockEl.style.top = s.top;
        this._dockEl.style.left = s.left;
        this._dockEl.style.width = s.width;
        this._dockEl.style.height = s.height;
        this._dockEl.style.zIndex = s.zIndex;
        this._dockEl.style.overflow = s.overflow;
        // restore osd (image) display instead of whole viewer
        if (this._osdElement && this._prevOsdDisplay !== null) this._osdElement.style.display = this._prevOsdDisplay;
        else this._viewerEl.style.display = this._prevViewerDisplay;
        // restore dock paddingTop
        if (typeof this._prevDockPaddingTop !== 'undefined') {
            this._dockEl.style.paddingTop = this._prevDockPaddingTop;
            delete this._prevDockPaddingTop;
        }
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
    }

    /** ---- internals ---- */
    /** @private */
    _ensureMenu() {
        if (!this._menu) {
            const menu = new TabsMenu({ id: `${this.id}-menu` }, ...this._tabsArr);
            this._menu = menu;
            menu.attachTo(this._dockEl);
        }
    }

    /** @private */
    _updateDockVisibility() {
        const hasTabs = this._tabsArr.length > 0;
        if (!this._dockEl) return;
        if (!hasTabs) {
            this._dockEl.style.display = "none";
            this._handleEl.style.display = "none";
            this._viewerEl.style.flex = "1 1 100%";
        } else {
            this._dockEl.style.display = "";
            this._handleEl.style.display = this.collapsed ? "none" : "";
            this._viewerEl.style.flex = "1 1 auto";
        }
    }

    /** @private */
    _applyVisibility() {
        if (!this._dockEl) return;
        if (this.collapsed) {
            this._dockEl.style.width = "0px";
            this._handleEl.style.display = "none";
        } else {
            this._dockEl.style.width = `${this.widthPx}px`;
            this._handleEl.style.display = "";
        }
    }

    /** @private */
    _applyResponsiveLayout() {
        if (!this._shellEl) return;
        const narrow = window.innerWidth < this.collapseBreakpointPx;

        this._shellEl.classList.toggle("flex-col", narrow);
        this._shellEl.classList.toggle("flex-row", !narrow);
        this._viewerEl.style.order = this.position === "left" ? "1" : "0";
        this._dockEl.style.order = this.position === "left" ? "0" : "2";
        this._applyVisibility();

        if (narrow) {
            // default collapsed on narrow; fullscreen may be toggled separately
            this.collapse();
        } else {
            // leaving narrow viewport: ensure any fullscreen overlay is closed and viewer restored
            if (this._isFullscreen) this._closeFullscreen();
            this.expand();
        }
    }

    /** @private */
    _wireResize() {
        if (!this._handleEl) return;
        let drag = false, startX = 0, startW = 0;

        const onMove = e => {
            if (!drag) return;
            const dx = e.clientX - startX;
            const newW = this.position === "left" ? startW + dx : startW - dx;
            this.widthPx = Math.max(this.minWidth, Math.min(this.maxWidth, newW));
            this._dockEl.style.width = `${this.widthPx}px`;
            e.preventDefault();
        };
        const onUp = () => {
            drag = false;
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };

        this._handleEl.addEventListener("mousedown", e => {
            if (this.collapsed) return;
            drag = true;
            startX = e.clientX;
            startW = this._dockEl.getBoundingClientRect().width;
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
            e.preventDefault();
        });
    }

    /**
     * Create and return the root layout element. This builds the viewer area,
     * top/bottom menus containers, and the side dock with resizable handle.
     * @returns {HTMLElement} Root element to attach to the DOM.
     */
    create() {
        // --- viewer core (IDs unchanged) ---
        const osd = div({ id:"osd", style:"pointer-events:auto;", class:"absolute w-full h-full top-0 left-0" });
        const viewerWrap = div({ class:"relative flex-1" }, osd, new RawHtml(null, `
<div id="top-side" class="flex-row w-full glass" style="display: flex; position: relative; align-items: flex-start; height: 35px; pointer-events: none;">
    <div id="top-menus" class="flex flex-row w-full" style="justify-content: space-between;">
        <div id="top-side-left" class="flex flex-row" style="align-items: center; pointer-events: auto;"></div>
        <div class="flex flex-row">
            <div id="top-side-left-user" style="margin-left: 5px; margin-right: 5px; pointer-events: auto;"></div>
            <div id="top-side-left-fullscreen" style="margin-left: 5px; pointer-events: auto;"></div>
        </div>
    </div>
</div>

<div id="fullscreen-menu" class="bg-base-100"></div>

<div id="bottom-menu" style="display: flex; position: fixed; left: 0; bottom: 0; width: 100%;">
    <div id="toolbars-container" style="width: 100%;"></div>
    <div id="bottom-menu-left"></div>
    <div id="bottom-menu-center"></div>
    <div id="bottom-menu-right"></div>
</div>`).create());

        // --- dock ---
        const dock = new Div({
            id:`${this.id}-dock`,
            extraClasses:{ base:"bg-base-200 border-l border-base-300 shrink-0 overflow-hidden" },
            extraProperties:{ style:`width:${this.widthPx}px;` }
        });
        if (this._tabsArr.length) {
            const menu = new TabsMenu({ id:`${this.id}-menu` }, ...this._tabsArr);
            this._menu = menu;
            menu.attachTo(dock);
        }

        const handle = div({ id:`${this.id}-handle`, class:"w-1 hover:bg-base-300/50 cursor-col-resize" });

        this._dockEl = dock.create();
        const shell = div({ id:this.id, class:"absolute w-full h-full top-0 left-0 flex flex-row" },
            this.position === "left" ? [dock.create(), handle, viewerWrap] : [viewerWrap, handle, this._dockEl]
        );

        this._shellEl = shell;
        this._viewerEl = viewerWrap;
        this._handleEl = handle;

        this._wireResize();
        this._applyResponsiveLayout();
        this._updateDockVisibility();

        return shell;
    }

    onLayoutChange(details) {
        console.log("Layout change detected in MainLayout:", details);
        this._applyResponsiveLayout();

    }
}
