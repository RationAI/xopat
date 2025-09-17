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

        this.navigatorMenu = new NavigatorSideMenu(this.id, navigatorID);

        this.menu = new MultiPanelMenu({
                id: this.id + "-menu",
            }
        );

        const originalAddTab = this.menu.addTab;
        this.menu.addTab = (item) => {
            const tabItem = originalAddTab.call(this.menu, item);
            USER_INTERFACE.TopVisualMenu.registerRightMenuTab(tabItem);
        };

        this.menu.addTab(
            {id: "navigator", icon: "fa-map", title: $.t('main.navigator.title'), body: [this.navigatorMenu.create()]}
        );
        this.menu.addTab(
            {id: "shaders", icon: "fa-eye", title: $.t('main.shaders.title'), body: [this.createShadersMenu()]}
        );

        this.menu.set(Menu.DESIGN.TITLEONLY);
        // todo override background with this color (does not work)
        // this.menu.tabs["navigator"].openDiv.setClass({background: ""});
        // this.menu.tabs["navigator"].openDiv.setExtraProperty({style: "var(--fallback-b2, oklch(var(--b2) / 0.5));"})
        this.menu.tabs["navigator"]._setFocus(); // if not visible, navigator wont show

        // defaultly open menus
        for (let i of Object.keys(this.menu.tabs)) {
            if (APPLICATION_CONTEXT.getOption(`${i}-open`, true)) {
                this.menu.tabs[i]._setFocus();
            } else {
                this.menu.tabs[i]._removeFocus();
            }

            if (APPLICATION_CONTEXT.getOption(`${i}-hidden`, false)) {
                this.menu.tabs[i].toggleHiden();
            }
        }

        this.classMap["base"] = "right-side-menu flex-column ui-menu";
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
            onShaderChange: (value) => UTILITIES.setBackgroundAndGoal(undefined, value),
            onOpacityChange: (v) => UTILITIES.setGlobalLayerOpacity?.(v),
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
