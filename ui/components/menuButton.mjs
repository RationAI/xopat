import { MenuTab } from "./menuTab.mjs";
import { BaseComponent } from "./baseComponent.mjs";
import { FAIcon } from "./fa-icon.mjs";
import { Button } from "./buttons.mjs";
import van from "../vanjs.mjs";

const {span} = van.tags;

/**
 * @class MenuButton
 * @description A internal tab component for the menu component which adds only Button and not content
 * @example
 * this.menu = new MainPanel({
 *     id: "left-side-buttons-menu",
 * }, 
 *     { id: "user", icon: "fa-circle-user", title: XOpatUser.instance().name || "Not logged in", body: undefined, styleOverride: true, class: UI.MenuButton}
 * );
*/
class MenuButton extends MenuTab{
    /**
     * @param {*} item dictionary with id, icon, title, body which will be created
     * @param {*} parent parent menu component
     */
    constructor(item, parent) {
        super(item, parent);
        this.list;
    }

    createTab(item) {
        const inText = item["title"];
        let inIcon = (item["icon"] instanceof BaseComponent) ? item["icon"] : new FAIcon({ name: item["icon"] });        

        let action = (item["onClick"]) ? item["onClick"] : () => {};

        const b = new Button({
            id: this.parent.id + "-b-" + item.id,
            size: Button.SIZE.SMALL,
            extraProperties: { title: inText},
            onClick: () => {
                action();
                this.focus();
            },
        }, inIcon, span({style: "margin-left: 3px"}, inText));

        return [b, undefined];
    }
}
export { MenuButton };