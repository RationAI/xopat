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

        this.header = new ui.Join({ id: this.hash + "header", style: ui.Join.STYLE.HORIZONTAL },);
        this.body = new ui.Div({ id: this.hash + "body" },);


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
            new ui.Button({
                onClick: () => {
                    var was_visible = document.getElementById(this.hash + "c-" + t).style.display === "block";
                    var body_divs = document.getElementById(this.hash + "body").childNodes;
                    for (var c_d of body_divs) {
                        c_d.style.display = "none";
                    }
                    if (!was_visible) {
                        document.getElementById(this.hash + "c-" + t).style.display = "block";
                    }
                },
                id: this.hash + "b-" + t,
            }, t).attachTo(this.header);

            new ui.Div({ id: this.hash + "c-" + t, display: "display-none" }, ...this.tabs[t]).attachTo(this.body);
        }

        this.header.attachTo(this);
        this.body.attachTo(this);

        return div(
            { ...this.commonProperties },
            ...this.children
        );
    }

    generateCode() {
        return super.generateCode("Menu");
    }
}

Menu.ORIENTATION = {
    TOP: function () { this.setClass("flex", "flex-col"); this.header.set(ui.Join.STYLE.HORIZONTAL); },
    BOTTOM: function () { this.setClass("flex", "flex-col-reverse"); this.header.set(ui.Join.STYLE.HORIZONTAL); },
    LEFT: function () { this.setClass("flex", "flex-row"); this.header.set(ui.Join.STYLE.VERTICAL); },
    RIGHT: function () { this.setClass("flex", "flex-row-reverse"); this.header.set(ui.Join.STYLE.VERTICAL); }
}

Menu.BUTTONSIDE = {
    LEFT: function () { this.header.setClass("flex", ""); },
    RIGHT: function () { this.header.setClass("flex", "flex-end"); },
}

export { Menu };
