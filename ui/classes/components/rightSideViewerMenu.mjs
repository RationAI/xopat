import van from "../../vanjs.mjs";
import {BaseComponent} from "../baseComponent.mjs";
import {ShaderSideMenu} from "./shaderSideMenu.mjs";
import {MultiPanelMenu} from "./multiPanelMenu.mjs";
import {Menu} from "./menu.mjs";
import {NavigatorSideMenu} from "./navigatorSideMenu.mjs";


const {div} = van.tags

/**
 * Resolve the compact side-menu preference. Like `globalMenuMode` this is NOT
 * read via `getUiOption` — that helper defaults every unset flag to `true`,
 * while compact mode must default to `false`. Precedence mirrors getUiOption:
 * explicit session param > cached user toggle (Settings checkbox, persisted by
 * `setUiOption`) > deployment default > false.
 * @returns {boolean}
 */
export function resolveSideMenuCompact() {
    const readUi = (source) => {
        const ui = source?.ui;
        if (ui && typeof ui === "object" && ui.sideMenuCompact !== undefined && ui.sideMenuCompact !== null) {
            return !!ui.sideMenuCompact;
        }
        return undefined;
    };
    const fromParams = readUi(APPLICATION_CONTEXT.config?.params);
    if (fromParams !== undefined) return fromParams;
    const cached = APPLICATION_CONTEXT.AppCache?.get("sideMenuCompact");
    if (cached !== undefined && cached !== null) return cached === true || cached === "true";
    const fromDefaults = readUi(APPLICATION_CONTEXT.config?.defaultParams);
    if (fromDefaults !== undefined) return fromDefaults;
    return false;
}

/**
 * @class RightSideViewerMenu
 * @extends BaseComponent
 * @description A div component
 * @example
 * const div = new RightSideViewerMenu({
 *                      todo...
 *                     );
 * div.attachTo(document.body);
 */
export class RightSideViewerMenu extends BaseComponent {

    /**
     * @param viewerPositionId
     * @param navigatorID
     * @param {object} [options]
     * @param {boolean} [options.skipAppBarRegistration=false] - When true, tabs created by this menu are NOT
     *   registered with USER_INTERFACE.AppBar.View. Use this when the menu lives outside the global app shell
     *   (e.g., a sandboxed playground modal) and should not appear in the global "Show menus" dropdown.
     * @param {(positionId: string) => any} [options.viewerResolver] - Custom resolver used in place of
     *   VIEWER_MANAGER.getViewer(positionId). Allows hosting the menu against a viewer that is not registered
     *   with VIEWER_MANAGER.
     * @param {(value: any, ctx: { viewerPositionId: string }) => void} [options.onShaderChange] -
     *   Replaces the default shader-index change handler (which mutates APPLICATION_CONTEXT.activeVisualizationIndex
     *   and triggers a global re-open). Required for sandboxed hosts that must not affect global state.
     * @param {(value: any) => void} [options.onOpacityChange]
     * @param {() => void} [options.onCacheSnapshotByName]
     * @param {() => void} [options.onCacheSnapshotByOrder]
     */
    constructor(viewerPositionId, navigatorID, options = {}) {
        super();
        this.id = viewerPositionId + "-right-menu";
        this.viewerPositionId = viewerPositionId;
        this._menuOptions = options || {};
        this.maxMobileWidth = APPLICATION_CONTEXT.getOption("maxMobileWidthPx");

        this.navigatorMenu = new NavigatorSideMenu(this.id, navigatorID);

        this.menu = new MultiPanelMenu({
                id: this.id + "-menu",
                // vertical strip → vertical "…" glyph for the config handle;
                // the strip sits at the right edge, so right-align the menu to the
                // "…" host (placement "right") → it opens leftward into the panel.
                configMenu: true,
                configMenuIcon: "ph-dots-three-vertical",
                configMenuPlacement: "right",
                // global key: tab ids are stable across viewer cells, so all grid
                // cells share one consistent, persisted panel order
                orderCacheKey: "sideViewerMenu-tab-order",
                onOrderChange: () => {
                    for (const viewerMenu of Object.values(window.VIEWER_MANAGER?.viewerMenus || {})) {
                        if (viewerMenu !== this) {
                            viewerMenu?.menu?.applyTabOrder?.();
                        }
                    }
                },
            }
        );

        const originalAddTab = this.menu.addTab;
        const skipAppBar = !!this._menuOptions.skipAppBarRegistration;
        this._registeredAppBarTabs = [];
        this.menu.addTab = (item) => {
            const tabItem = originalAddTab.call(this.menu, item);
            if (!skipAppBar) {
                USER_INTERFACE.AppBar.View.registerViewComponent("sideViewerMenu", tabItem);
                this._registeredAppBarTabs.push(tabItem);
            }
            return tabItem;
        };

        this.menu.addTab(
            // hugContent: the navigator scales with the viewer cell, so the panel
            // must follow its content width instead of stretching the column.
            {id: "navigator", icon: "ph-map-trifold", title: $.t('main.navigator.title'), body: this.navigatorMenu.create(), background: "glass", hugContent: true}
        );
        this.menu.addTab(
            {id: "shaders", icon: "ph-stack", title: $.t('main.shaders.title'), body: this.createShadersMenu(), background: "glass"}
        );

        this._compact = resolveSideMenuCompact();
        this.setCompact(this._compact);

        // "…" config handle sections: strip behavior lives here (not a separate
        // top-bar dropdown) so it is reachable right at the menu.
        this.menu.addConfigSection({
            id: "side-behavior",
            title: $.t('main.menu.headerBehavior'),
            order: 10,
            build: () => [
                {
                    id: "side-compact",
                    icon: "ph-arrows-in-line-vertical",
                    label: $.t('main.menu.compactStrip'),
                    selected: this._compact,
                    onClick: () => {
                        this._compact = !this._compact;
                        APPLICATION_CONTEXT.AppCache.set("sideMenuCompact", this._compact);
                        this.setCompact(this._compact);
                    },
                },
                {
                    id: "side-reset-order",
                    icon: "ph-arrow-counter-clockwise",
                    label: $.t('main.menu.resetTabOrder'),
                    onClick: () => this.menu.resetTabOrder(),
                },
            ],
        });
        // todo override background with this color (does not work)
        // this.menu.tabs["navigator"].openDiv.setClass({background: ""});
        // this.menu.tabs["navigator"].openDiv.setExtraProperty({style: "var(--fallback-b2, oklch(var(--b2) / 0.5));"})

        const nav = this.menu.tabs["navigator"];
        const oldFocus = nav._setFocus;
        const resolveViewer = this._menuOptions.viewerResolver
            ? (positionId) => this._menuOptions.viewerResolver(positionId)
            : (positionId) => VIEWER_MANAGER.getViewer(positionId, false);
        this._resolveViewer = resolveViewer;
        nav._setFocus = () => {
            oldFocus.call(nav);
            // Wait one frame so the panel-open layout actually applies before resizing.
            requestAnimationFrame(() => this._refreshNavigatorViewport());
        };

        // defaultly open menus
        for (let i of Object.keys(this.menu.tabs)) {
            // todo focus manager similar to visibility manager
            // `params.ui.navigator = false` defaults the navigator tab
            // to closed (the OSD navigator element hangs off this tab's
            // body, so closing the tab is what actually hides it). Other
            // tabs continue to follow the user's cached open/closed
            // preference.
            let shouldOpen;
            if (i === "navigator" && APPLICATION_CONTEXT.getUiOption?.("navigator") === false) {
                shouldOpen = false;
            } else {
                shouldOpen = APPLICATION_CONTEXT.AppCache.get(`${i}-open`, true);
            }
            if (shouldOpen) {
                this.menu.tabs[i]._setFocus();
            } else {
                this.menu.tabs[i]._removeFocus();
            }
        }

        this.classMap["base"] = "right-side-menu flex-column ui-menu";
    }

    /**
     * Needs two-level init, constructor is called before viewer is opened, because this menu needs to build
     * navigator container before viewer creation, and register events after
     * @param {OpenSeadragon.Viewer} viewer
     */
    init(viewer) {
        this._viewer = viewer;
        this.shadersMenu.init(viewer);
        this.navigatorMenu.init(viewer);
        this._observeViewerCell(viewer);
        this._observeNavigatorContainer(viewer);
    }

    /**
     * The navigator is sized against the viewer cell, not the window: in a
     * multi-viewport grid each cell is a fraction of the screen, and a
     * window-relative navigator would still bury a small cell. `viewer.container`
     * spans the cell, so observing it gives a grid-aware size.
     * @param {OpenSeadragon.Viewer} viewer
     */
    _observeViewerCell(viewer) {
        const cell = viewer?.container;
        if (!cell) return;
        const apply = (width, height) => {
            if (this.navigatorMenu.setSize(width, height)) {
                // Host element changed size — OSD only re-reads it on forceResize.
                this._refreshNavigatorViewport();
            }
        };
        // First sizing happens during boot, before the OSD navigator (and the
        // globals a refresh would touch) exist: size only, the navigator's own
        // ResizeObserver picks the change up once it is live.
        this.navigatorMenu.setSize(cell.offsetWidth, cell.offsetHeight);
        if (typeof ResizeObserver === "undefined") return;
        this._cellResizeObserver?.disconnect?.();
        this._cellResizeObserver = new ResizeObserver(entries => {
            const entry = entries[entries.length - 1];
            const width = entry?.contentRect?.width || 0;
            const height = entry?.contentRect?.height || 0;
            if (width < 2 || height < 2) return;
            // Coalesce: a drag-resize fires this dozens of times per second and
            // each apply may force an OSD navigator resize + redraw.
            if (this._cellResizeFrame) return;
            this._cellResizeFrame = requestAnimationFrame(() => {
                this._cellResizeFrame = 0;
                apply(width, height);
            });
        });
        this._cellResizeObserver.observe(cell);
    }

    /**
     * Refresh the OSD navigator when its container is actually visible.
     * OSD's navigator may have rendered into a 0/1×1 canvas while the tab was
     * collapsed; once the container reaches a real size we must both resize
     * the navigator and force a redraw, otherwise the overview stays a flat
     * single-color rectangle until the user pans the main viewport.
     */
    _refreshNavigatorViewport() {
        // Prefer the viewer this menu was initialised with: the global resolver
        // path runs during boot too, when VIEWER_MANAGER may not exist yet.
        let viewer = this._viewer;
        if (!viewer) {
            try {
                viewer = this._resolveViewer?.(this.viewerPositionId);
            } catch (e) {
                return; // globals not up yet — a later resize will retry
            }
        }
        const navigator = viewer?.navigator;
        if (!navigator?.element) return;
        const { offsetWidth, offsetHeight } = navigator.element;
        if (offsetWidth < 2 || offsetHeight < 2) return;
        navigator.forceResize();
        navigator.world?.draw?.();
    }

    /**
     * Watch the navigator container and re-render on any real size change:
     * both the collapsed (≤1px) → usable transition and a genuine resize
     * driven by {@link _observeViewerCell}. OSD never resizes an id-hosted
     * navigator on its own, so without this the canvas keeps the stale size.
     */
    _observeNavigatorContainer(viewer) {
        const element = viewer?.navigator?.element;
        if (!element || typeof ResizeObserver === "undefined") return;
        this._navResizeObserver?.disconnect?.();
        let lastWidth = element.offsetWidth, lastHeight = element.offsetHeight;
        this._navResizeObserver = new ResizeObserver(entries => {
            const entry = entries[entries.length - 1];
            const width = entry?.contentRect?.width || 0;
            const height = entry?.contentRect?.height || 0;
            if (width <= 1 || height <= 1) {
                lastWidth = width; lastHeight = height;
                return;
            }
            if (Math.abs(width - lastWidth) < 1 && Math.abs(height - lastHeight) < 1) return;
            lastWidth = width; lastHeight = height;
            if (this._navResizeFrame) return;
            this._navResizeFrame = requestAnimationFrame(() => {
                this._navResizeFrame = 0;
                this._refreshNavigatorViewport();
            });
        });
        this._navResizeObserver.observe(element);
    }

    /**
     * Toggle compact side-menu mode: icon-only tab strips with the sideways
     * title revealed on hover. Compact needs the TITLEICON design so both the
     * icon and the (hover-revealed) title node exist; full mode keeps the
     * classic title-only strips.
     * @param {boolean} enabled
     */
    setCompact(enabled) {
        this.menu.set(enabled ? Menu.DESIGN.TITLEICON : Menu.DESIGN.TITLEONLY);
        this.menu.setCompact(enabled);
    }

    getShadersTab() {
        return this.shadersMenu;
    }

    getNavigatorTab() {
        return this.navigatorMenu;
    }

    append(title, titleHtml, html, id, pluginId) {
        this.menu.append(title, titleHtml, html, id, pluginId);
    }

    appendExtended(title, titleHtml, html, hiddenHtml, id, pluginId) {
        this.menu.appendExtended(title, titleHtml, html, hiddenHtml, id, pluginId);
    }

    createShadersMenu() {
        const opts = this._menuOptions || {};
        const customShaderChange = typeof opts.onShaderChange === "function" ? opts.onShaderChange : null;
        const customOpacityChange = typeof opts.onOpacityChange === "function" ? opts.onOpacityChange : null;
        const customSnapshotByName = typeof opts.onCacheSnapshotByName === "function" ? opts.onCacheSnapshotByName : null;
        const customSnapshotByOrder = typeof opts.onCacheSnapshotByOrder === "function" ? opts.onCacheSnapshotByOrder : null;

        this.shadersMenu = new ShaderSideMenu({
            pinned: false,
            opacity: 1,
            onShaderChange: customShaderChange ? (value) => {
                customShaderChange(value, { viewerPositionId: this.viewerPositionId });
            } : (value) => {
                const parsedValue = Number.parseInt(value, 10);
                const nextValue = Number.isInteger(parsedValue) ? parsedValue : null;
                const index = VIEWER_MANAGER.getViewerIndex(this.viewerPositionId, false);
                const targetViewerIndex = Number.isInteger(index) && index >= 0 ? index : 0;

                APPLICATION_CONTEXT.updateViewerSelection(targetViewerIndex, {
                    visualizationIndex: nextValue
                });
            },
            onOpacityChange: customOpacityChange ? (value) => customOpacityChange(value) : (value) => {
                Dialogs.show("Global layer opacity is not supported for now. Please raise an issue if you need this feature.", 5000, Dialogs.MSG_WARN);
            },
            onCacheSnapshotByName: customSnapshotByName || (() => UTILITIES.storeVisualizationSnapshot(true)),
            onCacheSnapshotByOrder: customSnapshotByOrder || (() => UTILITIES.storeVisualizationSnapshot(false)),
        });
        return this.shadersMenu.create();
    }

    destroy() {
        delete this.title;
        delete this.visibility;
        delete this.copy;

        this._navResizeObserver?.disconnect?.();
        this._navResizeObserver = undefined;
        this._cellResizeObserver?.disconnect?.();
        this._cellResizeObserver = undefined;
        if (this._cellResizeFrame) cancelAnimationFrame(this._cellResizeFrame);
        if (this._navResizeFrame) cancelAnimationFrame(this._navResizeFrame);
        this._cellResizeFrame = this._navResizeFrame = 0;

        // Drop our AppBar.View entries so a closed viewer's tabs don't leave
        // stale VisibilityManager references that the dropdown would try to
        // toggle.
        if (this._registeredAppBarTabs?.length) {
            for (const tabItem of this._registeredAppBarTabs) {
                USER_INTERFACE?.AppBar?.View?.unregisterViewComponent?.("sideViewerMenu", tabItem);
            }
            this._registeredAppBarTabs = [];
        }

        this.menu?.destroy?.();
        this.menu = undefined;
    }

    clearMenuItem(id) {
        this.menu.delete(id);
    }

    create() {
        // Full-height overlay (the host cell is `relative`): the column must span
        // the cell so the menu's trailing "…" config handle can sit at its bottom
        // and the panel stack scrolls *inside* the column instead of growing past
        // the viewport. The root itself never scrolls — `.ui-menu` makes it
        // pointer-transparent, so a scrollport here would be unusable; the menu
        // body owns the scrolling (see MultiPanelMenu.create).
        const root = div(
            {
                ...this.commonProperties, onclick: this.options.onClick, ...this.extraProperties,
                style: "position: absolute; top: 0; bottom: 0; width: 400px; overflow: visible;"
            },
            this.menu.create()
        );
        // MobileBottomBar's _handleCanvasTap / _showViewerMenu / _hideViewerMenu
        // dereference menu.context to detect taps inside the menu and to toggle
        // display styles. BaseComponent doesn't auto-populate context, so set it
        // here — otherwise every tap inside the side menu collapses it on mobile.
        this.context = root;
        return root;
    }

    onLayoutChange(details) {
        if (!this.menu) return; // destroyed, but still existing, can happen on playground

        if (details.width < this.maxMobileWidth) {
            this.setClass("mobile", "mobile");
            this.setClass("display", "hidden");
        } else {
            this.setClass("mobile", "");
            this.setClass("display", "");
            for (let i of Object.keys(this.menu.tabs)) {
                if (!APPLICATION_CONTEXT.AppCache.get(`${i}-open`, true)) {
                    this.menu.getTab(i).close();
                }
            }
        }
    }
}
