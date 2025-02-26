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
 *                       {
 *                        "Tab1": button1,
 *                        "Tab2": button2,
 *                        "Tab3": button3
 *                       });
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
        this.tabs = args[0];

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
        for (const [t, _] of Object.entries(this.tabs)) {
            var b = new ui.Button({
                id: this.hash + "b-" + t,
                size: ui.Button.SIZE.SMALL,
                additionalProperties: { title: t },
                additionalClassProperties: { item: "menu-item-horizontal" },
                onClick: () => {
                    for (var div of document.getElementById(this.hash + "body").childNodes) {
                        if (div.style.display !== "block" && div.id === this.hash + "c-" + t) {
                            div.style.display = "block";
                        } else {
                            div.style.display = "none";
                        }
                    }

                    for (var button of this.headerButtons) {
                        if (button.classMap["type"] !== "btn-secondary" && button.id === this.hash + "b-" + t) {
                            button.setClass("type", "btn-secondary");
                        } else {
                            button.setClass("type", "btn-primary");
                        }
                    }
                }
            }, t);
            this.headerButtons.push(b);
            b.attachTo(this.header);

            new ui.Div({ id: this.hash + "c-" + t, display: "display-none" }, ...this.tabs[t]).attachTo(this.body);
        }

        this.header.attachTo(this);
        this.body.attachTo(this);

        return div(
            { ...this.commonProperties },
            ...this.children
        );
    }

    static generateCode() {
        return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

import { default as ui } from "/ui/index.mjs";

window["workspaceItem"] = new ui.Menu({
    id: "myMenu",
    orientation: ui.Menu.ORIENTATION.TOP,
    buttonSide: ui.Menu.BUTTONSIDE.LEFT
},{
    "Tab1": "Hello",
    "Tab2": "World"
    });

window["workspaceItem"].attachTo(document.getElementById("workspace"));
`;

    }
}

Menu.ORIENTATION = {
    TOP: function () {
        this.setClass("flex", "flex-col");
        this.header.set(ui.Join.STYLE.HORIZONTAL);
        for (var b of this.headerButtons) { b.setClass("item", "menu-item-horizontal"); }
    },
    BOTTOM: function () {
        this.setClass("flex", "flex-col-reverse");
        this.header.set(ui.Join.STYLE.HORIZONTAL);
        for (var b of this.headerButtons) { b.setClass("item", "menu-item-horizontal"); }
    },
    LEFT: function () {
        this.setClass("flex", "flex-row");
        this.header.set(ui.Join.STYLE.VERTICAL);
        for (var b of this.headerButtons) { b.setClass("item", "menu-item-vertical"); }
    },
    RIGHT: function () {
        this.setClass("flex", "flex-row-reverse");
        this.header.set(ui.Join.STYLE.VERTICAL);
        for (var b of this.headerButtons) { b.setClass("item", "menu-item-vertical"); }
    }
}

Menu.BUTTONSIDE = {
    LEFT: function () { this.header.setClass("flex", ""); },
    RIGHT: function () { this.header.setClass("flex", "flex-end"); },
}

export { Menu };
