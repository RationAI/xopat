import { BaseComponent } from "./baseComponent.mjs";
import van from "../vanjs.mjs";
import { FAIcon } from "./fa-icon.mjs";
import { Button } from "./buttons.mjs";
import { Div } from "./div.mjs";
import { MenuTab } from "./menuTab.mjs";

const ui = { Button, Div, FAIcon };
const { span, div } = van.tags

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
        this.closedButton;
        this.openButton;
        this.openDiv;
    }

    createTab(item) {
        const content = item["body"];
        const inText = item["title"];
        let inIcon = (item["icon"] instanceof BaseComponent) ? item["icon"] : new ui.FAIcon({ name: item["icon"] });        

        let action = (item["onClick"]) ? item["onClick"] : () => {};

        let c = undefined;

        this.closedButton = new ui.Button({
            id: this.parent.id + "-closedb-" + item.id,
            size: ui.Button.SIZE.SMALL,
            additionalProperties: { title: inText },
            onClick: () => {
                action();
                this.focus();
            },
        }, inIcon, span(inText));

        this.openButton = new ui.Button({
            id: this.parent.id + "-openb-" + item.id,
            size: ui.Button.SIZE.SMALL,
            orientation: ui.Button.ORIENTATION.VERTICAL_LEFT,
            additionalProperties: { title: inText, style: "margin-left: auto;" },
            onClick: () => {
                action();
                this.focus();
            },
        }, inIcon, span(inText));

        this.openDiv = new ui.Div({ 
            id: this.parent.id + "-opendiv-" + item.id, 
            extraClasses: {display: "display-none", flex: "flex flex-row"},
            extraProperties: {style: "flexGreow: 1;"},
        },  div(...content), this.openButton);

        c = new ui.Div({ id: this.parent.id + "-c-" + item.id, extraClasses: {display: "", flex: "flex flex-col"} }, this.closedButton, this.openDiv);

        // TODO solve to set initializing automatically
        this.openDiv._initializing = false;
        this.closedButton._initializing = false;
        this.openButton._initializing = false;

        return [undefined, c];
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
        if (this.contentDiv){
            this.openDiv.setClass("display", "");
            this.closedButton.setClass("display", "hidden");
        };
    }

    _removeFocus() {
        this.focused = false;
        if (this.contentDiv){
            this.openDiv.setClass("display", "hidden");
            this.closedButton.setClass("display", "");
        }
    }
}
export { MultiPanelMenuTab };
