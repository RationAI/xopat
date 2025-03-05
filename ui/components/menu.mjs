import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";
import { MenuTab } from "./menuTab.mjs";
import { Join } from "./join.mjs";
import { Div } from "./div.mjs";

const ui = { Join, Div };
const { div } = van.tags

/**
 * @class Menu
 * @extends BaseComponent
 * @description A menu component to group e.g. buttons, inputs..
 * @example
 * const menu = new Menu({
 *                        id: "myMenu",
 *                        orientation: Menu.ORIENTATION.TOP
 *                       },
 *                       {id: "s1", icon: settingsIcon, title: "Content1", body: "Settings1"},
 *                       {id: "s2", icon: settingsIcon, title: "Content2", body: "Settings2"});
 * menu.attachTo(document.body);
 */
class Menu extends BaseComponent {
    /**
     * @param {*} options
     * @param {keyof typeof Menu.ORIENTATION} [options.orientation] - The orientation of the menu
     * @param {keyof typeof Menu.BUTTONSIDE} [options.buttonSide] - The side of the buttons
     * @param  {...any} args - items to be added to the menu in format {id: string, icon: string or faIcon, title: string, body: string}
     */
    constructor(options, ...args) {
        super(options,);
        if (!this.id) {
            this.id = "menu-" + Math.random().toString(36).substring(7);
        }

        this.tabs = {};

        this.header = new ui.Join({ id: this.id + "-header", style: ui.Join.STYLE.HORIZONTAL });
        this.body = new ui.Div({ id: this.id + "-body", height: "h-full" });

        for (let i of args) {
            if (!(i.id && i.icon && i.title && i.body)) {
                throw new Error("Item for menu needs every property set.");
            }

            const tab = new MenuTab(i, this);
            this.tabs[i.id] = tab;
            tab.headerButton.attachTo(this.header);
            tab.contentDiv.attachTo(this.body);
        }

        this.classMap["base"] = "flex gap-1 bg-base-200 h-full";
        this.classMap["orientation"] = Menu.ORIENTATION.TOP;
        this.classMap["buttonSide"] = Menu.BUTTONSIDE.LEFT;
        this.classMap["design"] = Menu.DESIGN.TITLEICON;
        this.classMap["rounded"] = Menu.ROUNDED.DISABLE;
        this.classMap["flex"] = "flex-col";

        if (options) {
            this._applyOptions(options, "orientation", "buttonSide", "design", "rounded");
        }
    }


    create() {
        this.header.attachTo(this);
        this.body.attachTo(this);

        return div(
            { ...this.commonProperties, ...this.additionalProperties },
            ...this.children
        );
    }

    /**
     *
     * @param {*} id id of the item we want to delete
     */
    deleteTab(id) {
        if (!(id in this.tabs)) { throw new Error("Tab with id " + id + " does not exist"); }
        this.tabs[id].removeTab();
        delete this.tabs[id];
    }

    /**
     *
     * @param {*} item dictionary with id, icon, title, body which will be added to the menu
     */
    addTab(item) {
        if (!(item.id && item.icon && item.title && item.body)) {
            throw new Error("Item for menu needs every property set.");
        }
        const tab = new MenuTab(item, this);

        this.tabs[item.id] = tab;

        tab.headerButton.setClass("join", "join-item");
        tab.headerButton.attachTo(document.getElementById(this.id + "-header"));
        tab.contentDiv.attachTo(document.getElementById(this.id + "-body"));
    }

    /**
     * @param {*} id of the item we want to focus
     */
    focus(id) {
        if (id in this.tabs) {
            this.tabs[id].focus();
            return true;
        }
        return false;
    }

    /**
     * @param {*} id of the item we want to close
     */
    closeTab(id) {
        if (id in this.tabs) {
            this.tabs[id].close();
            return true;
        }
        return false;
    }

    /**
     *
     * @returns {HTMLElement} The body of the menu
     */
    getBodyDomNode() {
        return document.getElementById(this.id + "-body");
    }

    /**
     *
     * @returns {HTMLElement} The header of the menu
     */
    getHeaderDomNode() {
        return document.getElementById(this.id + "-header");
    }

    static generateCode() {
        return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

import { default as ui } from "/ui/index.mjs";

const settingsIcon = new ui.FAIcon({name: "fa-gear"});

window["workspaceItem"] = new ui.Menu({
    id: "myMenu",
    orientation: ui.Menu.ORIENTATION.TOP,
    buttonSide: ui.Menu.BUTTONSIDE.LEFT,
    design: ui.Menu.DESIGN.TEXTICON
},
{id: "s1", icon: settingsIcon, title: "Content1", body: "Settings1"},
{id: "s2", icon: settingsIcon, title: "Content2", body: "Settings2"},
{id: "s3", icon: settingsIcon, title: "Content3", body: "Settings3"})


window["workspaceItem"].attachTo(document.getElementById("workspace"));

window["workspaceItem"].addTab({id: "s4", icon: "fa-home", title: "Content3", body: "Settings3"});

window["workspaceItem"].deleteTab("s3");
`;

    }
}

Menu.ORIENTATION = {
    TOP: function () {
        this.setClass("flex", "flex-col");
        this.header.set(ui.Join.STYLE.HORIZONTAL);
        for (let b in Object.values.tabs) { b.headerButton.setClass("item", "menu-item-horizontal"); }
    },
    BOTTOM: function () {
        this.setClass("flex", "flex-col-reverse");
        this.header.set(ui.Join.STYLE.HORIZONTAL);
        for (let b in Object.values.tabs) { b.headerButton.setClass("item", "menu-item-horizontal"); }
    },
    LEFT: function () {
        this.setClass("flex", "flex-row");
        this.header.set(ui.Join.STYLE.VERTICAL);
        for (let b in Object.values.tabs) { b.headerButton.setClass("item", "menu-item-vertical"); }
    },
    RIGHT: function () {
        this.setClass("flex", "flex-row-reverse");
        this.header.set(ui.Join.STYLE.VERTICAL);
        for (let b in Object.values.tabs) { b.headerButton.setClass("item", "menu-item-vertical"); }
    }
}

Menu.BUTTONSIDE = {
    LEFT: function () { this.header.setClass("flex", ""); },
    RIGHT: function () { this.header.setClass("flex", "flex-end"); },
}

Menu.DESIGN = {
    ICONONLY: function () {
        for (let t of Object.values(this.tabs)) { t.iconOnly(); }
    },
    TITLEONLY: function () {
        for (let t of Object.values(this.tabs)) { t.titleOnly(); }
    },
    TITLEICON: function () {
        for (let t of Object.values(this.tabs)) { t.titleIcon(); }
    }
}

Menu.ROUNDED = {
    ENABLE: function () { ui.Join.ROUNDED.ENABLE.call(this.header); },
    DISABLE: function () { ui.Join.ROUNDED.DISABLE.call(this.header); },
};

export { Menu };
