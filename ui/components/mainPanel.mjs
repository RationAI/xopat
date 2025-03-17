import { Menu } from './menu.mjs';
import van from "../vanjs.mjs";
const { div, h3, span } = van.tags


class MainPanel extends Menu {
    constructor() {
        super({ id: "myMenu", orientation: Menu.ORIENTATION.TOP },
            { id: "base", icon: "fa-gear", title: "base", body: "body" });
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

    appendExtended(title, titleHtml, html, hiddenHtml, id, pluginId) {
        const titleHtmlIn = div();
        titleHtmlIn.innerHTML = titleHtml;

        const htmlIn = div();
        htmlIn.innerHTML = html;

        const hiddenHtmlIn = div();
        hiddenHtmlIn.innerHTML = hiddenHtml;

        let content =
            div({ id: `${id}`, class: `inner-panel ${pluginId}-plugin-root` },
                div(
                    span({ class: `material-icons inline-arrow plugins-pin btn-pointer`, id: `${id}-pin`, onclick: `USER_INTERFACE.MainMenu.clickHeader($(this), $(this).parent().parent().children().eq(2));`, style: `padding: 0;` },
                        `navigate_next`,
                    ),
                    h3({ class: `d-inline-block h3 btn-pointer`, onclick: `USER_INTERFACE.MainMenu.clickHeader($(this.previousElementSibling), $(this).parent().parent().children().eq(2));` },
                        `${title} `,
                    ),
                    `${titleHtmlIn}`,
                ),
                div({ class: `inner-panel-visible` },
                    `${htmlIn}`,
                ),
                div({ class: `inner-panel-hidden` },
                    `${hiddenHtmlIn}`,
                ),
            )

        van.add(document.getElementById(this.tabs["base"].contentDiv.id), content);
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
    clickHeader(jQSelf, jQTargetParent) {
        if (jQTargetParent.hasClass('force-visible')) {
            jQTargetParent.removeClass('force-visible');
            jQSelf.removeClass('opened');
        } else {
            jQSelf.addClass('opened');
            jQTargetParent.addClass('force-visible');
        }
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
        USER_INTERFACE.AdvancedMenu.selfContext.context.style['max-width'] = width;
        if (pluginsToolsBuilder) pluginsToolsBuilder.context.style.width = width;
        if (tissueMenuBuilder) tissueMenuBuilder.context.style.width = width;

        let status = USER_INTERFACE.Status.context;
        if (status) status.style.right = this.opened ? "408px" : "8px";
    }

    // AdvancedMenu
    setMenu(ownerPluginId, toolsMenuId, title, html, icon, withSubmenu, container) {
    }
    openMenu(atPluginId, toggle) {
    }
    openSubmenu(atPluginId, atSubId, toggle) {
    }
    close() {
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