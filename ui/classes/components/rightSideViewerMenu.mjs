import van from "../../vanjs.mjs";
import {BaseComponent} from "../baseComponent.mjs";
import {ShaderSideMenu} from "./shaderSideMenu.mjs";
import {MultiPanelMenu} from "./multiPanelMenu.mjs";
import {Menu} from "./menu.mjs";
import {NavigatorSideMenu} from "./navigatorSideMenu.mjs";


const {div} = van.tags

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
            {id: "navigator", icon: "ph-map-trifold", title: $.t('main.navigator.title'), body: this.navigatorMenu.create(), background: "glass"}
        );
        this.menu.addTab(
            {id: "shaders", icon: "ph-eye", title: $.t('main.shaders.title'), body: this.createShadersMenu(), background: "glass"}
        );

        this.menu.set(Menu.DESIGN.TITLEONLY);
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
        this.shadersMenu.init(viewer);
        this._observeNavigatorContainer(viewer);
    }

    /**
     * Refresh the OSD navigator when its container is actually visible.
     * OSD's navigator may have rendered into a 0/1×1 canvas while the tab was
     * collapsed; once the container reaches a real size we must both resize
     * the navigator and force a redraw, otherwise the overview stays a flat
     * single-color rectangle until the user pans the main viewport.
     */
    _refreshNavigatorViewport() {
        const viewer = this._resolveViewer?.(this.viewerPositionId);
        const navigator = viewer?.navigator;
        if (!navigator?.element) return;
        const { offsetWidth, offsetHeight } = navigator.element;
        if (offsetWidth < 2 || offsetHeight < 2) return;
        navigator.forceResize();
        navigator.world?.draw?.();
    }

    /**
     * Watch the navigator container for size transitions out of the
     * collapsed (≤1px) state and re-render once it becomes real.
     */
    _observeNavigatorContainer(viewer) {
        const element = viewer?.navigator?.element;
        if (!element || typeof ResizeObserver === "undefined") return;
        this._navResizeObserver?.disconnect?.();
        let lastUsable = element.offsetWidth > 1 && element.offsetHeight > 1;
        this._navResizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const width = entry.contentRect?.width || 0;
                const height = entry.contentRect?.height || 0;
                const usable = width > 1 && height > 1;
                if (usable && !lastUsable) {
                    this._refreshNavigatorViewport();
                }
                lastUsable = usable;
            }
        });
        this._navResizeObserver.observe(element);
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
        return div(
            {
                ...this.commonProperties, onclick: this.options.onClick, ...this.extraProperties,
                style: "position: absolute; width: 400px; overflow-y: auto; overflow-x: visible;"
            },
            this.menu.create()
        );
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
