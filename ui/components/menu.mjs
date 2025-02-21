import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";
import { default as ui } from "../index.mjs";

const { div } = van.tags

class Menu extends BaseComponent {
    constructor(options, ...args) {
        super(options, ...args);

        this.tabs = args[0];
        this.buttons = [];
        this.content = [];
        if (options) { //TODO Options
            this._applyOptions(options, "left", "top")
        }
    }


    create() {
        var buttons = div({ "class": "flex flex-col gap-1", "id": "tabs" },)
        var content = div({ "class": "flex flex-col", "id": "content" },)

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

            this.buttons[t] = b;
            b.attachTo(buttons)

            var content_div = div({ "id": "c-" + t, "style": "display: none" });
            for (const c of this.tabs[t]) {
                if (c instanceof BaseComponent) {
                    c.attachTo(content_div);
                }
                else {
                    van.add(content_div, c);
                }
            }

            this.content[t] = content_div;
            van.add(content, content_div);
        }
        return (
            div({ "class": "flex flex-row gap-1 bg-base-200" }, buttons, content));
    }

    generateCode() {
        return super.generateCode("Menu");
    }
}

export { Menu };
