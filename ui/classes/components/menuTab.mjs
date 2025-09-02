import { BaseComponent } from "../baseComponent.mjs";
import van from "../../vanjs.mjs";
import { FAIcon } from "../elements/fa-icon.mjs";
import { Button } from "../elements/buttons.mjs";
import { Div } from "../elements/div.mjs";

const ui = { Button, Div, FAIcon };
const { span } = van.tags

/**
 * @class MenuTab
 * @description A internal tab component for the menu component
 * @example
 * const tab = new MenuTab({id: "s1", icon: settingsIcon, title: "Content1", body: "Settings1"}, menu);
 */
class MenuTab {
    /**
     * @param {*} item dictionary with id, icon, title, body which will be created
     * @param {*} parent parent menu component
     */
    constructor(item, parent) {
        this.parent = parent;
        this.style = "ICONTITLE";
        this.styleOverride = item["styleOverride"] || false;
        this.focused = false;
        this.hidden = false;
        this.id = item.id;

        const [headerButton, contentDiv] = this.createTab(item);

        this.headerButton = headerButton;
        this.contentDiv = contentDiv;
    }

    /**
     * @param {*} item dictionary with id, icon, title, body which will be created
     * @returns {*} Button and Div components from VanJS framework
     */
    createTab(item) {
        const content = item["body"];
        const inText = item["title"];
        let inIcon = (item["icon"] instanceof BaseComponent) ? item["icon"] : new ui.FAIcon({ name: item["icon"] });        

        let action = (item["onClick"]) ? item["onClick"] : () => {};


        const b = new ui.Button({
            id: this.parent.id + "-b-" + item.id,
            size: ui.Button.SIZE.SMALL,
            extraProperties: { title: inText },
            onClick: () => {
                action();
                this.focus();
            },
        }, inIcon, span(inText));

        let c = undefined;
        if (content){
            c = new ui.Div({ id: this.parent.id + "-c-" + item.id, extraClasses: {display: "display-none", height: "h-full"} }, ...content);
        };
        return [b, c];
    }

    removeTab() {
        document.getElementById(this.headerButton.id).remove();
        if (this.contentDiv){
            document.getElementById(this.contentDiv.id).remove();
        };
    }

    focus() {
        for (let tab of Object.values(this.parent.tabs)) {
            if (tab.headerButton.id != this.headerButton.id) {
                tab._removeFocus();
                APPLICATION_CONTEXT.setOption(tab.id, false);
            }
        };

        if (this.focused) {
            APPLICATION_CONTEXT.setOption(this.id, false);
            this._removeFocus();
        } else {
            APPLICATION_CONTEXT.setOption(this.id, true);
            this._setFocus();
        };
    }

    unfocus(){
        APPLICATION_CONTEXT.setOption(this.id, false);
        this._removeFocus();
    }

    _setFocus() {
        this.focused = true;
        this.headerButton.setClass("type", "btn-secondary");
        if (this.contentDiv){
            this.contentDiv.setClass("display", "");
        };
    }

    _removeFocus() {
        this.focused = false;
        this.headerButton.setClass("type", "btn-primary");
        if (this.contentDiv){
            this.contentDiv.setClass("display", "hidden");
        }
    }

    close() {
        this.headerButton.setClass("type", "btn-primary");
        if (this.contentDiv){
            this._removeFocus();
        };
    }

    /**
     * @description make possible to keep its visual settings -> it keeps only Icon even if the whole menu is set to show Icon and Title
     * @param {boolean} styleOverride - if true, it will keep its visual settings
     */
    setStyleOverride(styleOverride) {
        this.styleOverride = styleOverride;
    }

    // TODO make work even withouth inicialization
    titleOnly() {
        if (this.styleOverride) {
            return;
        }
        this.style = "TITLE";
        const nodes = this.headerButton.children;
        nodes[0].classList.add("hidden");
        nodes[1].classList.remove("hidden");
    }

    titleIcon() {
        if (this.styleOverride) {
            return;
        }
        this.style = "ICONTITLE";
        const nodes = this.headerButton.children;
        nodes[0].classList.remove("hidden");
        nodes[1].classList.remove("hidden");
    }

    iconOnly() {
        if (this.styleOverride) {
            return;
        }
        this.style = "ICON";
        const nodes = this.headerButton.children;
        nodes[0].classList.remove("hidden");
        nodes[1].classList.add("hidden");
    }

    iconRotate(){
        const nodes = this.headerButton.children;
        nodes[0].classList.remove("rotate-90");
        nodes[0].classList.remove("-rotate-90");
        if(!(this.style==="ICON")){
            return;
        }
        if(this.parent.orientation==="RIGHT"){
            nodes[0].classList.add("rotate-90");
        
        } else if(this.parent.orientation==="LEFT"){
            nodes[0].classList.add("-rotate-90");
        }
    }

    toggleHiden() {
        if (this.hidden) {
            if(this.headerButton){
                this.headerButton.setClass("display", "");
            }
            this.contentDiv.setClass("display", "");
            this.hidden = false;
        } else {
            if(this.headerButton){
                this.headerButton.setClass("display", "hidden");
            }
            this.contentDiv.setClass("display", "hidden");
            this.hidden = true;
        }
    }
}
export { MenuTab };
