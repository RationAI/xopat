import { BaseComponent } from "../baseComponent.mjs";
import van from "../../vanjs.mjs";
import { FAIcon } from "../elements/fa-icon.mjs";
import { Button } from "../elements/buttons.mjs";
import { Div } from "../elements/div.mjs";
import {Badge} from "../elements/badge.mjs";
import {MenuTab} from "./menuTab.mjs";

import {VisibilityManager} from "../mixins/visibilityManager.mjs";

const ui = { Button, Div, FAIcon };
const { span } = van.tags

/**
 * @class MenuTabBanner
 * @description A internal tab component for the menu component
 * @example
 * const tab = new MenuTab({id: "s1", icon: settingsIcon, title: "Content1", body: "Settings1"}, menu);
 */
class MenuTabBanner extends MenuTab {
    /**
     * @param {*} item dictionary with id, icon, title, body which will be created
     * @param {*} parent parent menu component
     */
    constructor(item, parent) {
        super(item, parent);
        this.parent = parent;
        this.style = "ICONTITLE";
        this.styleOverride = item["styleOverride"] || false;
        this.hidden = true;
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
        // todo component was by default hidden, keep hidden?
    }

    /**
     * todo: private?
     * @param {*} item dictionary with id, icon, title, body which will be created
     * @returns {*} Button and Div components from VanJS framework
     */
    _createTab(item) {
        const inText = item["title"];
        let inIcon = (item["icon"] instanceof BaseComponent) ? item["icon"] : new ui.FAIcon({ name: item["icon"] });

        this.iconName = inIcon.options.name;
        this.title = inText;

        const b = new Badge(item.badgeProps, inIcon, span(inText));
        b.setClass("tabBanner", "self-center mx-3");
        let c = undefined;
        return [b, c];
    }

    setTitle(title) {
        if (this.headerButton) {
            let header = document.getElementById(this.headerButton.id);
            if (header) {
                // todo dirty, touching internal badge structure
                header.children[2].title = title;
                header.children[2].innerHTML = title;
            }
        }
    }

    setVisuals(...props) {
        if (props.length && props[0] instanceof Badge) {
            const comp = props.shift();
            // todo beter approach   TODO DOES NOT WORK!!!
            // const compNode = comp.create();
            // compNode.classList.add("self-center", "mx-3");
            // document.getElementById(this.headerButton.id).replaceWith(comp.create());
            this.headerButton = comp;
        }
        this.headerButton.set(...props);
    }

    removeTab() {
        document.getElementById(this.headerButton.id).remove();
    }

    focus() {

    }

    unfocus(){

    }

    _setFocus() {

    }

    _removeFocus() {

    }

    close() {

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
    }

    titleIcon() {

    }

    iconOnly() {

    }

    iconRotate(){

    }
}
export { MenuTabBanner };
