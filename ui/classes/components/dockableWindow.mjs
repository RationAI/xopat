import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { FloatingWindow } from "./floatingWindow.mjs";

const { div } = van.tags;

/**
 * @typedef {"floating"|"tab"} DockableWindowMode
 */

/**
 * @typedef {Object} DockableWindowOptions
 * @property {string} [id] - ID for the window (also used for cache keys).
 * @property {string} [title="Window"] - Window / tab title.
 * @property {string} [icon="fa-window-maximize"] - Icon for the MainLayout tab.
 * @property {DockableWindowMode} [defaultMode="floating"]
 *   Initial mode when nothing is stored in cache.
 * @property {string} [modeCacheKey] - Custom key for persisting mode in AppCache.
 * @property {string} [tabId] - ID of the tab in the MainLayout (defaults to `id`).
 * @property {string} [tabTitle] - Title of the tab (defaults to `title`).
 * @property {string} [tabIcon] - Icon class for the tab (defaults to `icon`).
 * @property {UI.MainLayout} [layout] - Optional layout instance; defaults to global `window.LAYOUT`.
 * @property {object} [floating] - Options passed through to `UI.FloatingWindow`
 *   (width, height, resizable, startLeft, startTop, closable, onClose, external, externalProps, ...).
 * @property {Function} [onModeChange] - Callback `(mode: DockableWindowMode) => void` when mode changes.
 */

/**
 * @class DockableWindow
 * @extends BaseComponent
 *
 * @description
 * A window that can either:
 *
 *  - behave like a regular {@link UI.FloatingWindow} floating over the viewer, or
 *  - be **embedded as a tab** in the {@link UI.MainLayout} side dock.
 *
 * The chosen mode is automatically persisted in `APPLICATION_CONTEXT.AppCache`
 * so each user gets their preferred layout by default.
 *
 * Typical usage:
 *
 * ```js
 * const commentsWindow = new UI.DockableWindow({
 *   id: "annotation-comments",
 *   title: "Comments",
 *   icon: "fa-comment",
 *   defaultMode: "floating", // or "tab"
 *   floating: {
 *     width: 360,
 *     height: 320,
 *     closable: true
 *   },
 *   onModeChange: (mode) => console.log("Comments window mode:", mode)
 * }, new UI.RawHtml({}, "<div>...your markup here...</div>"));
 *
 * // Attach once, the component will put itself either into the layout
 * // or into the floating layer depending on stored preference.
 * USER_INTERFACE.addHtml(commentsWindow, "annotations-plugin");
 * ```
 */
class DockableWindow extends BaseComponent {
    /**
     * @param {DockableWindowOptions} [options]
     * @param {...(BaseComponent|HTMLElement|string)} bodyChildren
     */
    constructor(options = undefined, ...bodyChildren) {
        options = super(options, ...bodyChildren).options;

        this.title = options.title ?? "Window";
        this.icon = options.icon ?? "fa-window-maximize";

        // ---- mode & cache ----
        this._modeKey = options.modeCacheKey || `${this.id}:mode`;
        /** @type {DockableWindowMode} */
        const defMode = (options.defaultMode === "tab" || options.defaultMode === "embedded")
            ? "tab"
            : "floating";
        /** @type {DockableWindowMode} */
        this._mode = APPLICATION_CONTEXT.AppCache.get(this._modeKey, defMode);

        // ---- MainLayout integration ----
        /** @type {string} */
        this._tabId = options.tabId || this.id;
        this._tabTitle = options.tabTitle || this.title;
        this._tabIcon = options.tabIcon || this.icon;
        /** @type {UI.MainLayout|null} */
        this._layout = options.layout || (globalThis.LAYOUT || null);
        this._tabRegistered = false;

        // ---- Floating window integration ----
        this._floatingOpts = options.floating || {};
        /** @type {FloatingWindow|null} */
        this._floating = null;

        /** @private */
        this._rootEl = null;
    }

    // ---------- public API ----------

    /** @returns {DockableWindowMode} Current mode. */
    getMode() {
        return this._mode;
    }

    /** @returns {boolean} True if in floating-window mode. */
    isFloating() {
        return this._mode === "floating";
    }

    /** @returns {boolean} True if embedded as a tab. */
    isDocked() {
        return this._mode === "tab";
    }

    /**
     * Switch to "tab" mode: remove floating window (if any) and register a MainLayout tab.
     * The mode is persisted.
     */
    dock() {
        if (this._mode === "tab") return;
        this._mode = "tab";
        APPLICATION_CONTEXT.AppCache.set(this._modeKey, this._mode);

        // Close floating window if it exists
        if (this._floating) {
            try { this._floating.close(); } catch (_) {}
            this._floating = null;
        }

        this._ensureTab();
        this.options.onModeChange?.(this._mode);
    }

    /**
     * Switch to "floating" mode: remove MainLayout tab (if any) and open FloatingWindow.
     * The mode is persisted.
     */
    float() {
        if (this._mode === "floating") return;
        this._mode = "floating";
        APPLICATION_CONTEXT.AppCache.set(this._modeKey, this._mode);

        // Remove tab if present
        const layout = this._layout || globalThis.LAYOUT;
        if (layout && this._tabRegistered && typeof layout.removeTab === "function") {
            layout.removeTab(this._tabId);
        }
        this._tabRegistered = false;

        const fw = this._ensureFloating();
        // Attach if not already present
        if (!fw.isOpened()) fw.attachTo(document.body); else fw.focus();

        this.options.onModeChange?.(this._mode);
    }

    /** Toggle between "floating" and "tab" modes. */
    toggleMode() {
        this.isFloating() ? this.dock() : this.float();
    }

    /**
     * Open the window:
     *  - in floating mode, brings the window to front,
     *  - in tab mode, focuses the MainLayout tab (if possible).
     */
    open() {
        if (this.isFloating()) {
            const fw = this._ensureFloating();
            fw.open();
            return;
        }
        // Focus dock tab
        const layout = this._layout || globalThis.LAYOUT;
        const menu = layout?._menu;
        if (menu && typeof menu.focus === "function") {
            menu.focus(this._tabId);
        } else {
            // ensure the tab exists at least
            this._ensureTab();
        }
    }

    /**
     * Close the window (only meaningful in floating mode).
     * In tab mode this is a no-op by default (you probably want the tab to stay).
     */
    close() {
        if (this.isFloating() && this._floating) {
            this._floating.close();
        }
    }

    // ---------- BaseComponent override ----------

    /**
     * @description
     * Create the underlying DOM node. In "floating" mode this is the underlying
     * {@link UI.FloatingWindow} root element. In "tab" mode, the DockableWindow
     * registers a tab in the {@link UI.MainLayout} and returns a hidden placeholder.
     *
     * @returns {HTMLElement}
     */
    create() {
        let el;

        if (this.isFloating() || !this._layout) {
            // Fallback to floating mode if there is no layout
            const fw = this._ensureFloating();
            el = fw.create();
        } else {
            this._ensureTab();
            // Just a hidden stub element so BaseComponent contract is kept.
            el = div({
                ...this.commonProperties,
                style: "display:none;",
                ...this.extraProperties
            });
        }

        this._rootEl = el;
        return el;
    }

    // ---------- internals ----------

    /** @private */
    _ensureFloating() {
        if (this._floating) return this._floating;

        const fwOpts = {
            id: this.id,
            title: this.title,
            ...this._floatingOpts,
            // keep user's onClose but still let DockableWindow know
            onClose: () => {
                this._floatingOpts?.onClose?.();
                // do not change mode here; just close the window
            }
        };

        this._floating = new FloatingWindow(fwOpts, ...this._children);
        return this._floating;
    }

    /** @private */
    _ensureTab() {
        if (this._tabRegistered) return;

        const layout = this._layout || globalThis.LAYOUT;
        if (!layout || typeof layout.addTab !== "function") {
            console.warn("[DockableWindow] No MainLayout instance available for tab mode.", this.id);
            return;
        }

        layout.addTab({
            id: this._tabId,
            title: this._tabTitle,
            icon: this._tabIcon,
            body: this._children.slice()    // BaseComponents / nodes are fine here
        });

        this._tabRegistered = true;
    }

    /**
     * Example code snippet for documentation generators.
     * @returns {string}
     */
    static generateCode() {
        return `
ui = globalThis.UI;

// Dockable window that defaults to tab mode, but user can switch to floating
const win = new ui.DockableWindow({
    id: "example-dockable",
    title: "Example panel",
    icon: "fa-circle-info",
    defaultMode: "tab",
    floating: { width: 420, height: 260 }
}, new ui.RawHtml({}, "<div class='p-2'>Hello from dockable window</div>"));

// Attach to DOM or plugin host
USER_INTERFACE.addHtml(win, "example-plugin");

// Somewhere in your UI you can wire a toggle button:
document.getElementById("toggle-example-mode").onclick = () => win.toggleMode();
`;
    }
}

export { DockableWindow };
