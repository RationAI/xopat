import { Menu } from './menu.mjs';
import van from "../../vanjs.mjs";
const { div, h3, span } = van.tags

/**
 * @class MainPanel
 * @extends Menu
 * @description A menu component to group e.g. buttons, inputs..
 * @example
 * const menu = new MainPanel({
 *                        id: "myMenu",
 *                        orientation: Menu.ORIENTATION.TOP
 *                       },
 *                       {id: "s1", icon: settingsIcon, title: "Content1", body: "Settings1"},
 *                       {id: "s2", icon: settingsIcon, title: "Content2", body: "Settings2"});
 * menu.attachTo(document.body);
 * 
 * //class to simulate original mainMenu and AdvancedMenu components from previous versions of xOpat
 * // WIP
 */
class MainPanel extends Menu {
    constructor(options, ...args) {
        super(options, ...args);
    }
    // MainMenu
    append(title, titleHtml, html, id, pluginId) {
        const htmlIn = div();
        htmlIn.innerHTML = html;

        const titleHtmlIn = div();
        titleHtmlIn.innerHTML = titleHtml;

        let content =
            div({ id: id, class: "inner-panel " + pluginId + "-plugin-root inner-panel-simple" },
                div(
                    h3({ class: "d-inline-block h3", style: "padding-left: 15px;" },
                        title,
                    ),
                    titleHtmlIn,
                ),
                htmlIn,
            )
        van.add(document.getElementById(this.tabs["base"].contentDiv.id), content);
    }

    replace(title, titleHtml, html, id, pluginId) {
        $(`.${pluginId}-plugin-root`).remove();
        this.append(title, titleHtml, html, id, pluginId);
    }

    replaceExtended(title, titleHtml, html, hiddenHtml, id, pluginId) {
        $(`.${pluginId}-plugin-root`).remove();
        this.appendExtended(title, titleHtml, html, hiddenHtml, id, pluginId);
    }
    appendRaw(html, id, pluginId) {
        const htmlIn = div();
        htmlIn.innerHTML = html;
        let content = div({ id: id, class: "inner-panel " + pluginId + "-plugin-root inner-panel-simple" }, htmlIn);
        van.add(document.getElementById(this.tabs["base"].contentDiv.id), content);
    }
    open() {
        if (this.opened) return;
        this.context.css("right", "0");
        this.opened = true;
        USER_INTERFACE.Margins.right = 400;
        this._sync();
    }
    close() {
        if (!this.opened) return;
        this.context.css("right", "-400px");
        this.opened = false;
        USER_INTERFACE.Margins.right = 0;
        this._sync();
    }
    _sync() {
        this.navigator.css("position", this.opened ? "relative" : this.navigator.attr("data-position"));
        let width = this.opened ? "calc(100% - 400px)" : "100%";
        USER_INTERFACE.TopPluginsMenu.selfContext.context.style['max-width'] = width;
        if (pluginsToolsBuilder) pluginsToolsBuilder.context.style.width = width;
        if (tissueMenuBuilder) tissueMenuBuilder.context.style.width = width;
    }

    // AdvancedMenu
    setMenu(ownerPluginId, toolsMenuId, title, html, icon, withSubmenu, container) {
    }
    openMenu(atPluginId, toggle) {
    }
    openSubmenu(atPluginId, atSubId, toggle) {
    }
    refreshPageWithSelectedPlugins() {
    }
    addSeparator() {
    }
    _build() {
    }
    _buildMenu(context, builderId, parentMenuId, parentMenuTitle, ownerPluginId, toolsMenuId, title, html, icon, withSubmenu, container) {
    }
}

export { MainPanel };