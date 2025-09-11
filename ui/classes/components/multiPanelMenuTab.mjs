import { BaseComponent } from "../baseComponent.mjs";
import van from "../../vanjs.mjs";

import { FAIcon } from "../elements/fa-icon.mjs";
import { Button } from "../elements/buttons.mjs";
import { Div } from "../elements/div.mjs";
import { MenuTab } from "./menuTab.mjs";

const { span, div } = van.tags

/**
 * @class MultiPanelMenuTab
 * @description A internal tab component for the multiPanelMenu component
 * @extends MenuTab
 * @example
 * this.menu = new UI.MultiPanelMenu({
 *     id: "myMenu",
 * },
 * {id: "s2", icon: settingsIcon, title: "Content2", body: "Settings2"}, -> these will create MultiPanelMenuTab in multiPanelMenu
 * {id: "s3", icon: settingsIcon, title: "Content3", body: "Settings3"},)
 */
class MultiPanelMenuTab extends MenuTab {

    /**
     * @param {*} item dictionary with id, icon, title, body which will be created
     * @param {*} parent parent menu component
    **/
    constructor(item, parent) {
        super(item, parent);
        this.openButton;
        this.openDiv;
        this.pin;
        this.id = item.id;
    }

    _createTab(item) {
        const content = item["body"];
        const inText = item["title"];
        let inIcon = (item["icon"] instanceof BaseComponent) ? item["icon"] : new FAIcon({ name: item["icon"] });
        //todo dirty?
        this.iconName = inIcon.options.name;
        this.title = inText;

        const pinIcon = new FAIcon({id: this.parent.id + "-b-icon"+ item.id, name: "fa-thumbtack" });
        this.pin = new Button({
            id: this.parent.id + "-b-opened" + item.id,
            type: Button.TYPE.SECONDARY,
            size: Button.SIZE.TINY,
            orientation: Button.ORIENTATION.HORIZONTAL,
            extraProperties: { title: $.t('menu.bar.pinFullscreen'), style: "position: absolute; top: 0px;"},
            onClick: (event) => {
                this.togglePinned();
                if (pinIcon.classMap["name"] === "fa-thumbtack") {
                    pinIcon.changeIcon("fa-thumbtack-slash");
                } else {
                    pinIcon.changeIcon("fa-thumbtack");
                }

                if(USER_INTERFACE.TopFullscreenButton.fullscreen){
                    this.hide();
                }

                event.stopPropagation();
            }
        }, pinIcon)

        this.openButton = new Button({
            id: this.parent.id + "-b-opened-" + item.id,
            size: Button.SIZE.TINY,
            orientation: Button.ORIENTATION.VERTICAL_RIGHT,
            extraProperties: { title: inText, style: "margin-left: auto; padding-top: 35px; padding-bottom: 35px;" },
            onClick: () => {
                this.focus();
            },
            }, inIcon, span(inText), this.pin);

        this.openDiv = new Div({ 
            id: this.parent.id + "-opendiv-" + item.id, 
            extraClasses: {display: "display-none", flex: "flex flex-row", background: "bg-base-200", radius: "rouded-tl-md rounded-bl-md"},
            extraProperties: {style: "margin-top: 5px; margin-bottom: 5px;"},
            }, div({ style: "width: 360px;" }, ...content));

        let c = new Div({ 
            id: this.parent.id + "-c-" + item.id, 
            extraClasses: {display: "", flex: "flex flex-row", item: "ui-menu-item"}
            }, this.openDiv, this.openButton);

        this.fullId = this.parent.id + "-c-" + item.id;
        if (APPLICATION_CONTEXT.getOption(`${this.id}-pinned`, false)){
            this.parent.pinnedTabs[this.id] = true;
            pinIcon.changeIcon("fa-thumbtack-slash");
        }
        return [undefined, c];
    }

    removeTab() {
        this.contentDiv.remove();
        this.openButton.remove();
        this.openDiv.remove();
    }

    focus() {
        if (this.focused) {
            APPLICATION_CONTEXT.setOption(`${this.id}-open`, false);
            this._removeFocus();
        } else {
        APPLICATION_CONTEXT.setOption(`${this.id}-open`, true);
            this._setFocus();
        };
    }

    _setFocus() {
        this.focused = true;

        this.openDiv.setClass("display", "");
    }

    _removeFocus() {
        this.focused = false;

        this.openDiv.setClass("display", "hidden");
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
        this.openButton.titleOnly();
    }

    titleIcon() {
        if (this.styleOverride) {
            return;
        }
        this.style = "ICONTITLE";
        this.openButton.titleIcon();
    }

    iconOnly() {
        if (this.styleOverride) {
            return;
        }
        this.style = "ICON";
        this.openButton.iconOnly();
    }

    iconRotate(){
        this.openButton.iconRotate();
    }

    togglePinned(){
        if (this.parent.pinnedTabs[this.id]){
            APPLICATION_CONTEXT.setOption(`${this.id}-pinned`, false);
            this.parent.pinnedTabs[this.id] = false;
        } else{
            APPLICATION_CONTEXT.setOption(`${this.id}-pinned`, true);
            this.parent.pinnedTabs[this.id] = true;
        }
    }

    hide(){
        document.getElementById(this.fullId).classList.toggle("hidden");
    }
}

export { MultiPanelMenuTab };
