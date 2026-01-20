import { BaseComponent } from "../baseComponent.mjs";
import { Div } from "../elements/div.mjs";
import { Button } from "../elements/buttons.mjs";
import { FAIcon } from "../elements/fa-icon.mjs";
import van from "../../vanjs.mjs";

const { div } = van.tags;

/**
 * @class FullscreenMenu
 * @extends BaseComponent
 * @description A menu component to group e.g. buttons, inputs.., darkens the background and shows the content in bar in middle of the screen
 * @example
 * const fullscreenMenu = new FullscreenMenu({
 *                        id: "myMenu",
 *                       },
 *                       new UI.Div({id: "1"}), new UI.Div({id: "2"})); // needs to use UI.Div
 * menu.attachTo(document.body);
 * 
 * // it wont create buttons on its own, you need to make them. Here is example of buttons which controls fullscreenMenu from another menu
 * 
 * const controlMenu = new UI.MainPanel({
 *     id: "left-side-buttons-menu",
 *     orientation: UI.Menu.ORIENTATION.TOP,
 *     buttonSide: UI.Menu.BUTTONSIDE.LEFT,
 *     rounded: UI.Menu.ROUNDED.ENABLE,
 *     extraClasses: { bg: "bg-transparent" }
 * }, { id: "one", icon: "fa-gear", title: "one", body: undefined, onClick: function () {fullscreenMenu.menu.focus("1")} },
 *    { id: "two", icon: "fa-gear", title: "two", body: undefined, onClick: function () {fullscreenMenu.menu.focus("2")} },
 * );
 * 
 * // you can also use just any buttons which have this type of onClick function
 * 
 **/
export class FullscreenMenu extends BaseComponent{

    /**
     * @param {*} options
     * @param  {...any} args - items to be added to the menu, needs to be UI.Div
    **/
    constructor(options = undefined, ...args) {
        options = super(options, ...args).options;
        this.tabs = {};

        this.content = new Div({ id: this.id + "-content", extraClasses: {height: "h-full", width: "w-full"} });
        this.closeBtn = new Button({
            size: Button.SIZE.TINY,
            type: Button.TYPE.NONE,
            onClick: () => this.unfocusAll(),
            extraClasses: {position: "absolute right-2"}
        }, new FAIcon({name: 'fa-close'}));
        for (let i of this._children) {
            this.addTab(i);
        }
        // todo - better usage design? prevent using this directly...
        this._children = [];
        this.mobile = false;
        if (window.innerWidth < 600) {
            this.mobile = true;
        }
    }

    /**
     * @param {*} item - item to be added to the menu, needs to be UI.Div
     * @throws Will throw an error if item is not a Div or does not have an id
     */
    addTab(item){
        if (!(item instanceof Div)) {
            throw new Error("Item is not a Div");
        }
        if (!item.id) {
            throw new Error("Item does not have an id");
        }

        this.tabs[item.id] = item;
        item.setClass("display", "hidden right-0");

        item.attachTo(this.content);
    }

    create(){
        return div({ id: "overlay", class: "hidden " + (this.mobile ? "mobile" : "") },
            div({ id: "overlay-darken", onclick: () => {this.unfocusAll()} }),
            div({ id: "overlay-content", class: "relative" }, this.closeBtn.create(), this.content.create()),
        );
    }

    /**
     * @description Focus on the tab with the given id
     * @param {string} id - The id of the tab to focus on
     * @throws Will throw an error if the tab with the given id does not exist
    **/
    focus(id){
        const overlay = document.getElementById("overlay");

        if (overlay.classList.contains("hidden")) {
            document.getElementById("overlay").classList.toggle("hidden");
        }

        if (!(id in this.tabs)) { throw new Error("Tab with id " + id + " does not exist"); }

        for (let tab of Object.values(this.tabs)) {
            if(tab.id == id && tab.classMap.display != "") {
                tab.setClass("display", "");
                continue;
            }
            else if(tab.id == id && tab.classMap.display == "") {
                document.getElementById("overlay").classList.toggle("hidden");
            }

            tab.setClass("display", "hidden");
        }
    }

    unfocusAll() {
        for (let tab of Object.values(this.tabs)) {
            tab.setClass("display", "hidden");
        }
        document.getElementById("overlay").classList.add("hidden");
    }


    /**
     * @returns {HTMLElement} - The content DOM node of the menu content
     */
    getContentDomNode() {
        return document.getElementById(this.id + "-content");
    }

    onLayoutChange(details) {
        if (details.width < 600) {
            document.getElementById("overlay").classList.add("mobile");
        } else {
            document.getElementById("overlay").classList.remove("mobile");
        }
    }
}
