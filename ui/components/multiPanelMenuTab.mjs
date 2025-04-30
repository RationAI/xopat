import { BaseComponent } from "./baseComponent.mjs";
import van from "../vanjs.mjs";

import { FAIcon } from "./fa-icon.mjs";
import { Button } from "./buttons.mjs";
import { Div } from "./div.mjs";
import { MenuTab } from "./menuTab.mjs";

const { span, div } = van.tags

class MultiPanelMenuTab extends MenuTab{

    constructor(item, parent) {
        super(item, parent);
        this.closedButton;
        this.openButton;
        this.openDiv;
    }

    createTab(item) {
        const content = item["body"];
        const inText = item["title"];
        let inIcon = (item["icon"] instanceof BaseComponent) ? item["icon"] : new FAIcon({ name: item["icon"] });        

        this.closedButton = new Button({
            id: this.parent.id + "-b-closed-" + item.id,
            size: Button.SIZE.TINY,
            extraProperties: { title: inText, style: "margin-top: 5px;" },
            onClick: () => {
                this.focus();
            },
            }, inIcon, span(inText));

        this.openButton = new Button({
            id: this.parent.id + "-b-opened-" + item.id,
            size: Button.SIZE.TINY,
            orientation: Button.ORIENTATION.VERTICAL_RIGHT,
            extraProperties: { title: inText, style: "margin-left: auto;" },
            onClick: () => {
                this.focus();
            },
            }, inIcon, span(inText));

        this.openDiv = new Div({ 
            id: this.parent.id + "-opendiv-" + item.id, 
            extraClasses: {display: "display-none", flex: "flex flex-row", background: "bg-base-200"},
            extraProperties: {style: "margin-top: 5px; margin-bottom: 5px;"},
            }, div(...content), this.openButton);

        let c = new Div({ 
            id: this.parent.id + "-c-" + item.id, 
            extraClasses: {display: "", flex: "flex flex-col", item: "ui-menu-item"} 
            }, this.closedButton, this.openDiv);

        // TODO solve to set initializing automatically
        this.openDiv._initializing = false;
        this.closedButton._initializing = false;
        this.openButton._initializing = false;

        return [undefined, c];
    }

    removeTab() {
        this.contentDiv.remove();
        this.closedButton.remove();
        this.openButton.remove();
        this.openDiv.remove();
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

        this.openDiv.setClass("display", "");
        this.closedButton.setClass("display", "hidden");
    }

    _removeFocus() {
        this.focused = false;

        this.openDiv.setClass("display", "hidden");
        this.closedButton.setClass("display", "");
    }

    close() {
        this._removeFocus();
    }

    setStyleOverride(styleOverride) {
        this.styleOverride = styleOverride;
    }

    // TODO make work even withouth inicialization
    titleOnly() {
        if (this.styleOverride) {
            return;
        }
        this.style = "TITLE";
        this.closedButton.titleOnly();
        this.openButton.titleOnly();
    }

    titleIcon() {
        if (this.styleOverride) {
            return;
        }
        this.style = "ICONTITLE";
        this.closedButton.titleIcon();
        this.openButton.titleIcon();
    }

    iconOnly() {
        if (this.styleOverride) {
            return;
        }
        this.style = "ICON";
        this.closedButton.iconOnly();
        this.openButton.iconOnly();
    }

    iconRotate(){
        this.closedButton.iconRotate();
        this.openButton.iconRotate();
    }
}

export { MultiPanelMenuTab };
