import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";
import { default as ui } from "../index.mjs";

const { div } = van.tags

class Menu extends BaseComponent {
    constructor(options, ...args) {
        super(options, ...args);

        this.tabs = args[0];
        this.buttonGroup;
        this.buttons = [];
        this.content = [];
        this.buttonDiv;
        this.contentDiv;
        this.mainDiv;

        this.classMap["base"] = "flex gap-1 bg-base-200";
        this.classMap["orientation"] = "flex-col";
        if (options) { //TODO Options
            this._applyOptions(options, "orientation")
        }
    }


    create() {
        this.contentDiv = new ui.Div({ id: "content" },);
        this.buttonGroup = new ui.Join({ id: "buttonGroup", style: ui.Join.STYLE.HORIZONTAL },);

        for (const [t, _] of Object.entries(this.tabs)) {
            var b = new ui.Button({
                base: "btn",
                type: ui.Button.TYPE.PRIMARY,
                size: "",
                outline: "",
                onClick: () => {
                    var was_visible = document.getElementById("c-" + t).style.display === "block";
                    var content_divs = document.getElementById("content").childNodes;
                    for (var c_d of content_divs) {
                        c_d.style.display = "none";
                    }
                    if (!was_visible) {
                        document.getElementById("c-" + t).style.display = "block";
                    }
                },
                id: "b-" + t,
            }, t)

            var content_div = new ui.Div({ id: "c-" + t, display: "display-none" }, ...this.tabs[t]);
            content_div.attachTo(this.contentDiv);
            b.attachTo(this.buttonGroup);
        }

        this.mainDiv = new ui.Div({ id: "main", base: "flex gap-1 bg-base-200", flex: "flex-col" }, this.buttonGroup, this.contentDiv);
        this.mainDiv.refreshState(); // TODO why is this needed??????
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
