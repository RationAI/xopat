import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { FloatingWindow } from "./floatingWindow.mjs";
import { VisibilityManager } from "../mixins/visibilityManager.mjs";

const { div } = van.tags;

/**
 * @typedef {"floating"|"tab"} DockableWindowMode
 */

/**
 * @typedef {Object} DockableWindowOptions
 * @property {string} [id] - ID for the window (also used for cache keys).
 * @property {string} [title="Window"] - Window / tab title.
 * @property {string} [icon="ph-frame-corners"] - Icon for the MainLayout tab.
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
 *   icon: "ph-chat",
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

        this.title = options.title ?? $.t("common.window");
        this.icon = options.icon ?? "ph-frame-corners";

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
        this._tabConfig = null;

        // ---- wrapper visibility ----
        this.visibilityManager = options.visibilityManager || new VisibilityManager(this._tabId);
        this._syncingVisibility = false;
        this._suspendFloatingCloseHandler = false;

        this._isBootstrappingVisibility = false;
        this._deferredInitialVisibilitySync = false;
        // Set only while replaying the cached state at registration time, so
        // that replay cannot be mistaken for a request to focus this tab.
        this._applyingInitialVisibility = false;
        if (!options.visibilityManager && typeof this.visibilityManager.init === "function") {
            this._isBootstrappingVisibility = true;
            this.visibilityManager.init(
                () => this._applyCurrentVisibility(),
                () => this._applyCurrentVisibility()
            );
            this._isBootstrappingVisibility = false;

            // We intentionally skipped the constructor-time callback body above.
            // Flush once after the wrapper is actually registered in MainLayout.
            this._deferredInitialVisibilitySync = true;
        }

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
        const wasFloating = this._mode === "floating";
        this._mode = "tab";
        APPLICATION_CONTEXT.AppCache.set(this._modeKey, this._mode);

        if (wasFloating) {
            this._closeFloatingSilently();
        }

        this._ensureTab();
        if (this.visibilityManager.is()) {
            this._layout?.showGlobalMenu?.();
            this._layout?._applyDockVisibility?.();
        }

        this.options.onModeChange?.(this._mode);
    }

    /**
     * Switch to "floating" mode: remove MainLayout tab (if any) and open FloatingWindow.
     * The mode is persisted.
     */
    float() {
        const wasDocked = this._mode === "tab";
        this._mode = "floating";
        APPLICATION_CONTEXT.AppCache.set(this._modeKey, this._mode);

        const layout = this._layout || globalThis.LAYOUT;
        if (wasDocked && layout?.detachDockableTab) {
            layout.detachDockableTab(this._tabId);
        } else if (wasDocked && layout?.removeTab) {
            layout.removeTab(this._tabId);
        }
        this._tabRegistered = false;

        if (this.visibilityManager.is()) {
            this._openFloatingWindow();
        } else {
            this._closeFloatingSilently();
        }

        this.options.onModeChange?.(this._mode);
    }

    /**
     * Mark the wrapper as registered / detached from the MainLayout tab strip.
     * @param {boolean} nextState
     */
    markTabRegistered(nextState) {
        this._tabRegistered = !!nextState;
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
        this.visibilityManager?.set?.(true);

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
        this.visibilityManager?.set?.(false);
    }

    /**
     * Hide the dockable window regardless of current mode.
     * @returns {void}
     */
    hide() {
        this.visibilityManager?.set?.(false);
    }

    /**
     * Show the dockable window regardless of current mode.
     * @returns {void}
     */
    show() {
        this.visibilityManager?.set?.(true);
    }

    /**
     * Record a visibility decision that {@link UI.MainLayout} already made and
     * already persisted — "the layout decided, take note, do not act on it".
     *
     * The dock keeps tab visibility in `tab.hidden` + `AppCache v::<tabId>`,
     * written by `MainLayout._setTabVisibleState`. Without this call the
     * wrapper's {@link VisibilityManager} never learns about `showTab`/`hideTab`
     * and its `is()` answers from whatever the cache said at boot — a desync
     * that silently strands every consumer reading the wrapper.
     *
     * Deliberately uses `on()`/`off()` rather than `set()`: the cache write is
     * the layout's, on the very same key, so `set()` would double-write.
     *
     * @param {boolean} visible state the layout just applied
     * @returns {boolean} true when the wrapper state actually changed
     *
     * @note An `onChange` subscriber reached from here must NOT call
     *   `MainLayout.showTab`/`hideTab` or {@link DockableWindow#open}/`close` —
     *   those re-enter this path. Subscribe to observe, not to steer.
     */
    adoptTabVisibility(visible) {
        const vm = this.visibilityManager;
        if (!vm) return false;

        // The load-bearing re-entrancy guard: any layout<->wrapper cycle
        // terminates in one hop, and the boot-time `_syncMenuTabs` sweep (which
        // feeds back the state derived from this very manager) is a no-op — so
        // it cannot fire spurious change handlers nor pop the dock open against
        // `params.ui.globalMenu = false`.
        if (vm.is() === !!visible) return false;

        // `_applyCurrentVisibility` early-returns on this latch, so flipping the
        // flag here cannot bounce back into `showGlobalMenu()`/`showTab()`.
        this._syncingVisibility = true;
        try {
            visible ? vm.on?.() : vm.off?.();
        } finally {
            this._syncingVisibility = false;
        }
        return true;
    }

    /**
     * Whether the window is actually on screen right now, as opposed to merely
     * flagged visible. In tab mode that means: the wrapper is visible AND the
     * dock is open AND this is the focused tab — an unfocused tab's content div
     * carries `display-none`, so its "visible" tab is still invisible.
     *
     * @returns {boolean}
     *
     * @note This is a synchronous point query and it CAN go stale: tab focus
     *   changes emit no event ({@link UI.Menu#focus} is silent). A consumer that
     *   needs push semantics for "am I on screen" should put an
     *   `IntersectionObserver` on its own node instead of polling this.
     */
    isEffectivelyVisible() {
        const vm = this.visibilityManager;
        if (!vm?.is?.()) return false;

        if (this.isFloating()) {
            return !!this._floating?.isOpened?.();
        }

        const layout = this._layout || globalThis.LAYOUT;
        return !!layout?.isDockVisible?.() && layout.getFocusedTabId?.() === this._tabId;
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
            const fw = this._ensureFloating();
            el = fw.create();
        } else {
            this._ensureTab();
            el = div({
                ...this.commonProperties,
                style: "display:none;",
                ...this.extraProperties
            });
        }

        this._rootEl = el;
        return el;
    }

    /**
     * MainLayout-facing tab descriptor.
     * @returns {{id:string,title:string,icon:string,iconName:string,body:Array,visibilityManager:object,__dockableWindow:DockableWindow}}
     */
    toMainLayoutTab() {
        if (!this._tabConfig) {
            this._tabConfig = {
                id: this._tabId,
                title: this._tabTitle,
                icon: this._tabIcon,
                iconName: this._tabIcon,
                body: this._children.slice(),
                visibilityManager: this.visibilityManager,
                __dockableWindow: this,
            };
        }

        return this._tabConfig;
    }

    /**
     * View-menu registration payload for the wrapper.
     * @returns {{id:string,title:string,icon:string,visibilityManager:{is:Function,set:Function}}}
     */
    getViewRegistration() {
        return {
            id: this._tabId,
            title: this._tabTitle || this.title || this._tabId,
            icon: this._tabIcon || this.icon || "ph-frame-corners",
            visibilityManager: {
                is: () => this.visibilityManager.is(),
                set: next => {
                    this.visibilityManager.set?.(Boolean(next))
                        ?? (next ? this.visibilityManager.on?.() : this.visibilityManager.off?.());
                    return true;
                }
            }
        };
    }

    // ---------- internals ----------

    /** @private */
    _ensureTab() {
        if (this._tabRegistered) return;

        const layout = this._layout || globalThis.LAYOUT;
        if (!layout || typeof layout.addDockableWindow !== "function") {
            console.warn("[DockableWindow] No MainLayout instance available for tab mode.", this.id);
            return;
        }

        const registered = layout.addDockableWindow(this);
        this._tabRegistered = !!registered;
    }

    /** @private */
    /** @private */
    _applyCurrentVisibility() {
        if (this._isBootstrappingVisibility || this._syncingVisibility) return;
        this._syncingVisibility = true;

        try {
            const visible = this.visibilityManager.is();
            const layout = this._layout || globalThis.LAYOUT;

            if (this.isFloating()) {
                if (visible) {
                    this._openFloatingWindow();
                } else {
                    this._closeFloatingSilently();
                }
                return;
            }

            this._ensureTab();

            if (this._applyingInitialVisibility) {
                // Registration-time replay of the cached state, not a request to
                // reveal anything. Routing it through showTab would focus this
                // tab and so let whichever wrapper registered last override the
                // tab the user was actually last on.
                if (visible) layout?.showGlobalMenu?.(false);
                layout?._applyDockVisibility?.();
                return;
            }

            // Reveal THIS tab, not merely the dock: `showGlobalMenu()` alone
            // pops the dock open on whatever tab happened to be focused, so a
            // window hidden via `hideTab` stayed hidden while some unrelated
            // panel appeared. showTab/hideTab also focus, persist and refresh
            // the View dropdown. Termination: they route into
            // `_setTabVisibleState → adoptTabVisibility`, which no-ops because
            // the manager already holds this state — plus we are inside the
            // `_syncingVisibility` latch.
            if (visible) {
                layout?.showTab?.(this._tabId);
            } else {
                layout?.hideTab?.(this._tabId);
            }
            layout?._applyDockVisibility?.();
        } finally {
            this._syncingVisibility = false;
        }
    }

    /** @private */
    _flushDeferredVisibilitySync() {
        if (!this._deferredInitialVisibilitySync) return;
        this._deferredInitialVisibilitySync = false;
        this._applyingInitialVisibility = true;
        try {
            this._applyCurrentVisibility();
        } finally {
            this._applyingInitialVisibility = false;
        }
    }

    /** @private */
    _openFloatingWindow() {
        const fw = this._ensureFloating();
        if (typeof fw.isOpened === "function" && !fw.isOpened()) {
            fw.attachTo(document.body);
        } else {
            fw.open?.();
            fw.focus?.();
        }
    }

    /** @private */
    _closeFloatingSilently() {
        if (!this._floating) return;

        this._suspendFloatingCloseHandler = true;
        try {
            this._floating.close?.();
        } catch (_) {
            // no-op
        } finally {
            this._suspendFloatingCloseHandler = false;
        }
    }

    /** @private */
    _ensureFloating() {
        if (this._floating) return this._floating;

        const fwOpts = {
            id: this.id,
            title: this.title,
            ...this._floatingOpts,
            onClose: () => {
                this._floatingOpts?.onClose?.();
                if (!this._suspendFloatingCloseHandler) {
                    this.visibilityManager?.off?.();
                }
            }
        };

        this._floating = new FloatingWindow(fwOpts, ...this._children);
        return this._floating;
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
    icon: "ph-info",
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
