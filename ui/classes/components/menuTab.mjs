import { BaseComponent } from "../baseComponent.mjs";
import van from "../../vanjs.mjs";
import { FAIcon } from "../elements/fa-icon.mjs";
import { Button } from "../elements/buttons.mjs";
import { Div } from "../elements/div.mjs";

import { VisibilityManager } from "../mixins/visibilityManager.mjs";

const { span } = van.tags

/**
 * todo extend base component?
 *
 * @class MenuTab
 * @description A internal tab component for the menu component
 * @example
 * const tab = new MenuTab({id: "s1", icon: settingsIcon, title: "Content1", body: "Settings1"}, menu);
 */
class MenuTab extends BaseComponent {
    /**
     * @param {UINamedItem} item dictionary with id, icon, title, body which will be created
     * @param {*} parent parent menu component
     */
    constructor(item, parent) {
        super(undefined);
        this.parent = parent;
        this.style = "ICONTITLE";
        this.styleOverride = item["styleOverride"] || false;
        this._focused = false;
        this.hidden = false;
        this.id = item.id;

        const [headerButton, contentDiv] = this._createTab(item);
        this.headerButton = headerButton;
        this.contentDiv = contentDiv;
        this.visibilityManager = new VisibilityManager(this).init(
            () => {
                if (this.hidden) {
                    if (this.headerButton) this.headerButton.setClass("display", "");
                    if (this.contentDiv) this.contentDiv.setClass("display", "");
                    this.hidden = false;
                }
            },
            () => {
                if (!this.hidden) {
                    if (this.headerButton) this.headerButton.setClass("display", "hidden");
                    if (this.contentDiv) this.contentDiv.setClass("display", "hidden");
                    this.hidden = true;
                }
            }
        );
    }

    /**
     * todo: private?
     * @param {UINamedItem} item dictionary with id, icon, title, body which will be created
     * @returns {*} Button and Div components from VanJS framework
     */
    _createTab(item) {
        const content = item["body"];
        const inText = item["title"];
        let inIcon = (item["icon"] instanceof BaseComponent) ? item["icon"] : new FAIcon({ name: item["icon"] });

        //todo dirty?
        this.iconName = inIcon.options.name;
        this.title = inText;

        let action = (item["onClick"]) ? item["onClick"] : () => {};

        const b = new Button({
            id: this.parent.id + "-b-" + item.id,
            size: Button.SIZE.SMALL,
            extraProperties: { title: inText },
            onClick: () => {
                action();
                this.focus();
            },
        }, inIcon, span(inText));

        let c = undefined;
        if (content) {
            if (typeof content !== 'string' && typeof content?.[Symbol.iterator] === 'function') {
                c = new Div({ id: this.parent.id + "-c-" + item.id, extraClasses: {display: "display-none", height: "h-full"}}, ...content);
            }
            c = new Div({ id: this.parent.id + "-c-" + item.id, extraClasses: {display: "display-none", height: "h-full"} }, content);
        }
        return [b, c];
    }

    // todo do not force each component having ID
    setTitle(title) {
        if (this.headerButton) {
            let header = document.getElementById(this.headerButton.id);
            if (header) {
                header.children[1].title = title;
                header.children[1].innerHTML = title;
            }
        }
    }

    removeTab() {
        if (this.headerButton) {
            document.getElementById(this.headerButton.id).remove();
        }
        if (this.contentDiv){
            document.getElementById(this.contentDiv.id).remove();
        }
    }

    // todo implement focus as API of the FlagManagerLike
    focus() {
        for (let tab of Object.values(this.parent.tabs)) {
            if (tab.headerButton && tab.headerButton.id != this.headerButton?.id) {
                tab._removeFocus();
                APPLICATION_CONTEXT.AppCache.set(`${this.id}-open`, false);
            }
        }

        if (this._focused) {
            APPLICATION_CONTEXT.AppCache.set(`${this.id}-open`, false);
            this._removeFocus();
        } else {
            APPLICATION_CONTEXT.AppCache.set(`${this.id}-open`, true);
            this._setFocus();
        }
    }

    unfocus(){
        APPLICATION_CONTEXT.AppCache.set(`${this.id}-open`, false);
        this._removeFocus();
    }

    _setFocus() {
        this._focused = true;
        this.headerButton?.setClass("type", "btn-secondary");
        if (this.contentDiv){
            this.contentDiv.setClass("display", "");
        };
    }

    _removeFocus() {
        this._focused = false;
        this.headerButton?.setClass("type", "btn-neutral");
        if (this.contentDiv){
            this.contentDiv.setClass("display", "hidden");
        }
    }

    close() {
        this._removeFocus();
    }

    open() {
        this._setFocus();
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
        const nodes = this.headerButton?.children;
        nodes[0].classList.add("hidden");
        nodes[1].classList.remove("hidden");
    }

    titleIcon() {
        if (this.styleOverride) {
            return;
        }
        this.style = "ICONTITLE";
        const nodes = this.headerButton?.children;
        nodes[0].classList.remove("hidden");
        nodes[1].classList.remove("hidden");
    }

    iconOnly() {
        if (this.styleOverride) {
            return;
        }
        this.style = "ICON";
        const nodes = this.headerButton?.children;
        nodes[0].classList.remove("hidden");
        nodes[1].classList.add("hidden");
    }

    iconRotate(){
        const nodes = this.headerButton?.children;
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
}
export { MenuTab };
