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
     */
    constructor(viewerPositionId, navigatorID) {
        super();
        this.id = viewerPositionId + "-right-menu";
        this.viewerPositionId = viewerPositionId;

        this.navigatorMenu = new NavigatorSideMenu(this.id, navigatorID);

        this.menu = new MultiPanelMenu({
                id: this.id + "-menu",
            }
        );

        const originalAddTab = this.menu.addTab;
        this.menu.addTab = (item) => {
            const tabItem = originalAddTab.call(this.menu, item);
            USER_INTERFACE.AppBar.View.registerRightMenuTab(tabItem);
        };

        this.menu.addTab(
            {id: "navigator", icon: "fa-map", title: $.t('main.navigator.title'), body: [this.navigatorMenu.create()], background: "glass"}
        );
        this.menu.addTab(
            {id: "shaders", icon: "fa-eye", title: $.t('main.shaders.title'), body: [this.createShadersMenu()], background: "glass"}
        );

        this.menu.set(Menu.DESIGN.TITLEONLY);
        // todo override background with this color (does not work)
        // this.menu.tabs["navigator"].openDiv.setClass({background: ""});
        // this.menu.tabs["navigator"].openDiv.setExtraProperty({style: "var(--fallback-b2, oklch(var(--b2) / 0.5));"})

        const nav = this.menu.tabs["navigator"];
        const oldFocus = nav._setFocus;
        nav._setFocus = () => {
            oldFocus.call(nav);
            // todo do not use private arg, just create getViereBy..something() to allow queringy by positionID
            setTimeout(() => VIEWER_MANAGER.getViewer(viewerPositionId, false)?.navigator?.forceResize());
        };

        // defaultly open menus
        for (let i of Object.keys(this.menu.tabs)) {
            if (APPLICATION_CONTEXT.AppCache.get(`${i}-open`, true)) {
                this.menu.tabs[i]._setFocus();
            } else {
                this.menu.tabs[i]._removeFocus();
            }

            if (APPLICATION_CONTEXT.AppCache.get(`${i}-hidden`, false)) {
                this.menu.tabs[i].toggleHiden();
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
        this.shadersMenu = new ShaderSideMenu({
            pinned: false,
            opacity: 1,
            onShaderChange: (value) => {
                // Todo think of a better way of orchestrating this, e.g. open(...) method for a target viewer.
                let activeViz = APPLICATION_CONTEXT.getOption("activeVisualizationIndex", undefined, false);
                if (APPLICATION_CONTEXT.getOption("stackedBackground", false, false)) {
                    activeViz = value;
                } else {
                    if (Array.isArray(activeViz)) {
                        const index = VIEWER_MANAGER.getViewerIndex(this.viewerPositionId, false);
                        activeViz[index] = value;
                    } else if (Number.isInteger(activeViz)) {
                        activeViz = value;
                    }
                }
                APPLICATION_CONTEXT.openViewerWith(undefined, undefined, undefined, undefined, activeViz);
            },
            onOpacityChange: (value) => {
                Dialogs.show("Global layer opacity is not supported for now. Please raise an issue if you need this feature.", 5000, Dialogs.MSG_WARN);
            },
            onCacheSnapshotByName: () => UTILITIES.storeVisualizationSnapshot(true),
            onCacheSnapshotByOrder: () => UTILITIES.storeVisualizationSnapshot(false),
        });
        return this.shadersMenu.create();
    }

    destroy() {
        delete this.title;
        delete this.visibility;
        delete this.copy;

        this.menu.destroy();
        this.menu = undefined;
    }

    create() {
        return div(
            {
                ...this.commonProperties, onclick: this.options.onClick, ...this.extraProperties,
                style: "position: absolute; width: 400px; margin-top: 40px; overflow-y: auto;"
            },
            this.menu.create()
        );
    }
}
