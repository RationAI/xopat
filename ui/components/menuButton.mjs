import { MenuTab } from "./menuTab.mjs";
import { BaseComponent } from "./baseComponent.mjs";
import { FAIcon } from "./fa-icon.mjs";
import { Button } from "./buttons.mjs";
import van from "../vanjs.mjs";

const {span} = van.tags;

class MenuButton extends MenuTab{
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
            additionalProperties: { title: inText},
            onClick: () => {
                action();
                this.focus();
            },
        }, inIcon, span({style: "margin-left: 3px"}, inText));

        return [b, undefined];
    }
}
export { MenuButton };