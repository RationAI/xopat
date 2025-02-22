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
        super(options, ...args);

        this.tabs = args[0];
        this.buttonGroup = new ui.Join({ id: this.hash + "buttonGroup", style: ui.Join.STYLE.HORIZONTAL },);
        this.contentDiv = new ui.Div({ id: this.hash + "content" },);;
        this.mainDiv = new ui.Div({ id: this.hash + "main", base: "flex gap-1 bg-base-200", flex: "flex-col" }, this.buttonGroup, this.contentDiv);

        this.classMap["base"] = "flex gap-1 bg-base-200";
        this.classMap["orientation"] = Menu.ORIENTATION.TOP;
        this.classMap["buttonSide"] = Menu.BUTTONSIDE.LEFT;
        if (options) {
            this._applyOptions(options, "orientation", "buttonSide");
        }
    }


    create() {
        for (const [t, _] of Object.entries(this.tabs)) {
            new ui.Button({
                join: "join-item",
                onClick: () => {
                    var was_visible = document.getElementById(this.hash + "c-" + t).style.display === "block";
                    var content_divs = document.getElementById(this.hash + "content").childNodes;
                    for (var c_d of content_divs) {
                        c_d.style.display = "none";
                    }
                    if (!was_visible) {
                        document.getElementById(this.hash + "c-" + t).style.display = "block";
                    }
                },
                id: this.hash + "b-" + t,
            }, t).attachTo(this.buttonGroup);

            new ui.Div({ id: this.hash + "c-" + t, display: "display-none" }, ...this.tabs[t]).attachTo(this.contentDiv);
        }

        this.mainDiv.refreshState(); // TODO why is this needed?????? -> its not children of this component, that is why its not called in the base class
        return this.mainDiv.create();
    }

    generateCode() {
        return super.generateCode("Menu");
    }
}

Menu.ORIENTATION = {
    TOP: function () { this.mainDiv.setClass("flex", "flex-col"); this.buttonGroup.set(ui.Join.STYLE.HORIZONTAL); },
    BOTTOM: function () { this.mainDiv.setClass("flex", "flex-col-reverse"); this.buttonGroup.set(ui.Join.STYLE.HORIZONTAL); },
    LEFT: function () { this.mainDiv.setClass("flex", "flex-row"); this.buttonGroup.set(ui.Join.STYLE.VERTICAL); },
    RIGHT: function () { this.mainDiv.setClass("flex", "flex-row-reverse"); this.buttonGroup.set(ui.Join.STYLE.VERTICAL); }
}

Menu.BUTTONSIDE = {
    LEFT: function () { this.buttonGroup.setClass("flex", ""); },
    RIGHT: function () { this.buttonGroup.setClass("flex", "flex-end"); },
}

export { Menu };
