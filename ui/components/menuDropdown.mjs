import { MenuTab } from "./menuTab.mjs";
import { BaseComponent } from "./baseComponent.mjs";
import { FAIcon } from "./fa-icon.mjs";
import van from "../vanjs.mjs";
import { Button } from "./buttons.mjs";
import { Div } from "./div.mjs";

const { span } = van.tags;

/**
 * @class menuDropdown
 * @description A internal tab component for the menu component which shows its body in dropdown
 * @extends MenuTab
 * @example
 * this.menu = new MainPanel({
 *    id: "left-side-buttons-menu",
 * },
 *   { id: "share", icon: "fa-share-nodes", title: "Share", body: [Button, Button], class: UI.menuDropdown},
 * );
 */
class menuDropdown extends MenuTab{
    constructor(item, parent) {
        super(item, parent);
        this.list;
    }

    createTab(item) {
        const content = item["body"];
        const inText = item["title"];
        let inIcon = (item["icon"] instanceof BaseComponent) ? item["icon"] : new FAIcon({ name: item["icon"] });        

        let action = (item["onClick"]) ? item["onClick"] : () => {};

        this.list = new Div({
            id: this.parent.id + "-c-" + item.id, 
            extraClasses: {display: "display-none", component:  "dropdown-content menu bg-base-100 rounded-box z-1 p-2 shadow-sm"},
            extraProperties: {style: "position: absolute; right: 12%; row-gap: 5px;"}, // TODO make for all orientations
            }, ...content);

        const b = new Button({
            id: this.parent.id + "-b-" + item.id,
            size: Button.SIZE.SMALL,
            extraProperties: { title: inText},
            onClick: () => {
                action();
                this.focus();
            },
        }, inIcon, span(inText));
        this.contentDiv = this.list;
        return [b, this.list];
    }
}
export { menuDropdown };