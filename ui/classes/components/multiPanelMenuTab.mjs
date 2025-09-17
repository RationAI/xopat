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
        if (!parent._pinnedTabs) {
            parent._pinnedTabs = {};
        }
        super(item, parent);
        this.openButton;
        this.openDiv;
        this.pin;
        this.closeButton;
        this.mainDiv;
        this.id = item.id;
    }

    _createTab(item) {
        const content = item["body"];
        const inText = item["title"];
        let inIcon = (item["icon"] instanceof BaseComponent) ? item["icon"] : new FAIcon({ name: item["icon"] });
        //todo dirty?
        this.iconName = inIcon.options.name;
        this.title = inText;

        const pinIcon = new FAIcon({id: this.parent.id + "-b-icon-pin-"+ item.id, name: "fa-thumbtack" });
        this.pin = new Button({
            id: this.parent.id + "-b-pin-" + item.id,
            type: Button.TYPE.NONE,
            size: Button.SIZE.TINY,
            orientation: Button.ORIENTATION.HORIZONTAL,
            extraClasses: { display: "display-none" },
            extraProperties: { title: $.t('menu.bar.pinFullscreen'), style: "position: absolute; top: 30px;"},
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

        const crossIcon = new FAIcon({id: this.parent.id + "-b-icon-close-"+ item.id, name: "fa-close" });
        this.closeButton = new Button({
            id: this.parent.id + "-b-close" + item.id,
            type: Button.TYPE.NONE,
            size: Button.SIZE.TINY,
            orientation: Button.ORIENTATION.HORIZONTAL,
            extraProperties: { title: $.t('menu.bar.close'), style: "position: absolute; top: 0px;"},
            onClick: (event) => {
                this.toggleHiden();
                APPLICATION_CONTEXT.AppCache.set(`${this.id}-hidden`, this.hidden);
                event.stopPropagation();
            }
        }, crossIcon)

        this.openButton = new Button({
            id: this.parent.id + "-b-opened-" + item.id,
            size: Button.SIZE.TINY,
            orientation: Button.ORIENTATION.VERTICAL_RIGHT,
            extraProperties: { title: inText, style: "margin-left: auto; padding-top: 70px; padding-bottom: 20px; pointer-events: auto;" },
            onClick: () => {
                this.focus();
            },
            }, inIcon, span(inText), this.pin, this.closeButton);

        this.openDiv = new Div({ 
            id: this.parent.id + "-opendiv-" + item.id, 
            extraClasses: {display: "display-none", flex: "flex flex-row", background: "bg-base-200", radius: "rouded-tl-md rounded-bl-md"},
            extraProperties: {style: "margin-top: 5px; margin-bottom: 5px;"},
            }, div({ style: "width: 360px;" }, ...content)
        );

        this.fullId = this.parent.id + "-c-" + item.id;
        this.mainDiv = new Div({ 
            id: this.fullId,
            extraClasses: {display: "", flex: "flex flex-row", pointer: "pointer-events-auto", background: "bg-base-200", position: "relative"},
            extraProperties: { style: "margin-top: 5px; margin-bottom: 5px;" }
            }, this.openDiv, this.openButton);

        if (APPLICATION_CONTEXT.AppCache.get(`${this.id}-pinned`, false)){
            this.parent._pinnedTabs[this.id] = true;
            pinIcon.changeIcon("fa-thumbtack-slash");
        }
        return [undefined, this.mainDiv];
    }

    removeTab() {
        this.contentDiv.remove();
        this.openButton.remove();
        this.openDiv.remove();
    }

    focus() {
        if (this._focused) {
            APPLICATION_CONTEXT.AppCache.set(`${this.id}-open`, false);
            this._removeFocus();
        } else {
            APPLICATION_CONTEXT.AppCache.set(`${this.id}-open`, true);
            this._setFocus();
        }
    }

    _setFocus() {
        this._focused = true;

        this.openDiv.setClass("display", "");
        this.mainDiv.setClass("background", "bg-base-200");
        this.mainDiv.setClass("pointer-events", "pointer-events-auto");
        this.pin.setClass("display", "");
    }

    _removeFocus() {
        this._focused = false;

        this.openDiv.setClass("display", "hidden");
        this.mainDiv.setClass("background", "");
        this.mainDiv.setClass("pointer-events", "pointer-events-none");
        this.pin.setClass("display","display-none");
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
        if (this.parent._pinnedTabs[this.id]){
            APPLICATION_CONTEXT.AppCache.set(`${this.id}-pinned`, false);
            this.parent._pinnedTabs[this.id] = false;
        } else{
            APPLICATION_CONTEXT.AppCache.set(`${this.id}-pinned`, true);
            this.parent._pinnedTabs[this.id] = true;
        }
    }

    hide(){
        this.mainDiv.setClass("display", "hidden");
    }
}

export { MultiPanelMenuTab };
