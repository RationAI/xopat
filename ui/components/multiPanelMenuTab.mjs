import { BaseComponent } from "./baseComponent.mjs";
import van from "../vanjs.mjs";
import { FAIcon } from "./fa-icon.mjs";
import { Button } from "./buttons.mjs";
import { Div } from "./div.mjs";
import { MenuTab } from "./menuTab.mjs";

const ui = { Button, Div, FAIcon };
const { span } = van.tags

/**
 * @class checkboxMenuTab
 * @description A internal tab component for the menu component
 * @example
 * const tab = new checkboxMenuTab({id: "s1", icon: settingsIcon, title: "Content1", body: "Settings1"}, menu);
 */
class MultiPanelMenuTab extends MenuTab{
    /**
     * @param {*} item dictionary with id, icon, title, body which will be created
     * @param {*} parent parent menu component
     */
    constructor(item, parent) {
        super(item, parent);
    }

    createTab(item) {
        const content = item["body"];
        const inText = item["title"];
        let inIcon = (item["icon"] instanceof BaseComponent) ? item["icon"] : new ui.FAIcon({ name: item["icon"] });        

        let action = (item["onClick"]) ? item["onClick"] : () => {};


        const b = new ui.Button({
            id: this.parent.id + "-b-" + item.id,
            size: ui.Button.SIZE.SMALL,
            additionalProperties: { title: inText },
            onClick: () => {
                action();
                this.focus();
            },
        }, inIcon, span(inText));

        let c = undefined;

        const b1 = new ui.Button({
            id: this.parent.id + "-b-" + item.id,
            size: ui.Button.SIZE.SMALL,
            additionalProperties: { title: inText },
            onClick: () => {
                action();
                this.focus();
            },
        }, inIcon, span(inText));
        
        if (content){
            c = new ui.Div({ id: this.parent.id + "-c-" + item.id, extraClasses: {display: "display-none", flex: "flex flex-col"} }, b1, ...content);
        };
        return [b, c];
    }

    focus() {
        if (this.focused) {
            this._removeFocus();
        } else {
            this._setFocus();
        };
    }

    _setFocus() {
        this.focused = true;
        this.headerButton.setClass("display", "hidden");
        if (this.contentDiv){
            this.contentDiv.setClass("display", "");
        };
    }

    _removeFocus() {
        this.focused = false;
        this.headerButton.setClass("display", "");
        if (this.contentDiv){
            this.contentDiv.setClass("display", "hidden");
        }
    }
}
export { MultiPanelMenuTab };
