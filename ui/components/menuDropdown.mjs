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
    }

    createTab(item) {
        const content = item["body"];
        const inText = item["title"];
        let inIcon = (item["icon"] instanceof BaseComponent) ? item["icon"] : new FAIcon({ name: item["icon"] });        
        const dropdown = new Div({class: "dropdown dropdown-end"},
            div({ tabindex: "0", role:"button", class:"btn m-1"}, "click me"),
            div({tabindex: "0", class:"dropdown-content menu bg-base-100 rounded-box z-1 w-52 p-2 shadow-sm"}, "you really clicked")
        );
        return [dropdown, undefined];
    }
}
export { menuDropdown };