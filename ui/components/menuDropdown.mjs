import { MenuTab } from "./menuTab.mjs";
import { BaseComponent } from "./baseComponent.mjs";
import { FAIcon } from "./fa-icon.mjs";
import van from "../vanjs.mjs";
import { Button } from "./buttons.mjs";
import { Div } from "./div.mjs";

const {div, ul, li, a, span, button} = van.tags;

class menuDropdown extends MenuTab{
    constructor(item, parent) {
        super(item, parent);
        this.list;
    }

    createTab(item) {
        const inText = item["title"];
        let inIcon = (item["icon"] instanceof BaseComponent) ? item["icon"] : new FAIcon({ name: item["icon"] });        

        let action = (item["onClick"]) ? item["onClick"] : () => {};

        const b1 = new Button({
            size: Button.SIZE.SMALL,
            onClick: () => {
                console.log("Submenu 1 clicked");
            },
        }, "Submenu 1");

        this.list = new Div({
            id: this.parent.id + "-c-" + item.id, 
            extraClasses: {display: "display-none"},
            additionalProperties: {style: "position: absolute; right: 15%;"},
            }, b1);

        const b = new Button({
            id: this.parent.id + "-b-" + item.id,
            size: Button.SIZE.SMALL,
            additionalProperties: { title: inText},
            onClick: () => {
                action();
                this.focus();
                console.log("tlačítko zmáčknuto")
            },
        }, inIcon, span(inText));
        this.contentDiv = this.list;
        return [b, this.list];
    }
}
export { menuDropdown };