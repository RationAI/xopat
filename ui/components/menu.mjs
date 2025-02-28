import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";
import { default as ui } from "../index.mjs";

const { div } = van.tags

/**
 * @class Menu
 * @extends BaseComponent
 * @description A menu component to group e.g. buttons, inputs..
 * @example
 * const menu = new Menu({
 *                         id: "myMenu",
 *                        orientation: Menu.ORIENTATION.TOP
 *                       },
 *                      ["Hello", "World"],
 *                     ["button1", "button2"]);
 * menu.attachTo(document.body);
 */
class Menu extends BaseComponent {
    /**
     *
     * @param {*} options
     * @param  {...any} args
     */
    constructor(options, ...args) {
        super(options,);
        this.items = args;

        this.idCounter = this.items.length;

        this.header = new ui.Join({ id: this.hash + "header", style: ui.Join.STYLE.HORIZONTAL },); // TODO create header component with Icon/text/ICON+text options
        this.body = new ui.Div({ id: this.hash + "body" },);

        this.headerButtons = [];

        this.classMap["base"] = "flex gap-1 bg-base-200";
        this.classMap["orientation"] = Menu.ORIENTATION.TOP;
        this.classMap["buttonSide"] = Menu.BUTTONSIDE.LEFT;
        this.classMap["flex"] = "flex-col";
        if (options) {
            this._applyOptions(options, "orientation", "buttonSide");
        }
    }


    create() {
        for (let i = 0; i < this.items.length; i++) {
            const [b, c] = this._addTabInternal(this.items[i], i);
            b.attachTo(this.header);
            c.attachTo(this.body);
        }

        this.header.attachTo(this);
        this.body.attachTo(this);

        return div(
            { ...this.commonProperties },
            ...this.children
        );
    }

    deleteTab(index) {
        if (index < 0 || index >= this.items.length) {
            throw new Error("Index out of bounds");
        }

        this.items.splice(index, 1);
        this.headerButtons.splice(index, 1);

        document.getElementById(this.hash + "c-" + index).remove();
        document.getElementById(this.hash + "b-" + index).remove();
    }

    addTab(item) {
        const [b, c] = this._addTabInternal(item, this.idCounter++);

        this.items.push(item);

        b.setClass("join", "join-item");
        b.attachTo(document.getElementById(this.hash + "header"));
        c.attachTo(document.getElementById(this.hash + "body"));
    }

    _addTabInternal(item, i) {
        const content = item["body"];
        const inText = item["title"];
        let inIcon = item["icon"];

        if (!inText && !inIcon) {
            throw new Error("At least one of text or icons must be provided");
        }

        if (!(inIcon instanceof BaseComponent)) {
            inIcon = new ui.FAIcon({ name: inIcon });
        }

        let text = inText || "";
        let icon = inIcon || "";
        if (inText && inIcon) {
            text = " " + text;
        }

        const b = new ui.Button({
            id: this.hash + "b-" + i,
            size: ui.Button.SIZE.SMALL,
            additionalProperties: { title: text },
            additionalClassProperties: { item: "menu-item-horizontal" },
            onClick: () => {
                for (let div of document.getElementById(this.hash + "body").childNodes) {
                    if (div.style.display !== "block" && div.id === this.hash + "c-" + i) {
                        div.style.display = "block";
                    } else {
                        div.style.display = "none";
                    }
                }

                for (let button of this.headerButtons) {
                    if (button.classMap["type"] !== "btn-secondary" && button.id === this.hash + "b-" + i) {
                        button.setClass("type", "btn-secondary");
                    } else {
                        button.setClass("type", "btn-primary");
                    }
                }
            }
        }, icon, text);
        this.headerButtons.push(b);

        const c = new ui.Div({ id: this.hash + "c-" + i, display: "display-none" }, ...content);

        return [b, c];
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
    buttonSide: ui.Menu.BUTTONSIDE.LEFT
},
{icon: settingsIcon, title: "Content1", body: "Settings1"},
{icon: settingsIcon, title: "Content2", body: "Settings2"},
{icon: settingsIcon, title: "Content3", body: "Settings3"})


window["workspaceItem"].attachTo(document.getElementById("workspace"));

window["workspaceItem"].addTab({icon: "fa-home", title: "Content3", body: "Settings3"});

window["workspaceItem"].deleteTab(1);
`;

    }
}

Menu.ORIENTATION = {
    TOP: function () {
        this.setClass("flex", "flex-col");
        this.header.set(ui.Join.STYLE.HORIZONTAL);
        for (let b of this.headerButtons) { b.setClass("item", "menu-item-horizontal"); }
    },
    BOTTOM: function () {
        this.setClass("flex", "flex-col-reverse");
        this.header.set(ui.Join.STYLE.HORIZONTAL);
        for (let b of this.headerButtons) { b.setClass("item", "menu-item-horizontal"); }
    },
    LEFT: function () {
        this.setClass("flex", "flex-row");
        this.header.set(ui.Join.STYLE.VERTICAL);
        for (let b of this.headerButtons) { b.setClass("item", "menu-item-vertical"); }
    },
    RIGHT: function () {
        this.setClass("flex", "flex-row-reverse");
        this.header.set(ui.Join.STYLE.VERTICAL);
        for (let b of this.headerButtons) { b.setClass("item", "menu-item-vertical"); }
    }
}

Menu.BUTTONSIDE = {
    LEFT: function () { this.header.setClass("flex", ""); },
    RIGHT: function () { this.header.setClass("flex", "flex-end"); },
}

Menu.HEADER = {
    ICON: function () {}
}

export { Menu };
