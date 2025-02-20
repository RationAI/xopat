import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";
import { default as ui } from "../index.mjs";

const { div } = van.tags

class Menu extends BaseComponent {
    constructor(options, ...args) {
        super(options, ...args);

        this.tabs = args[0]
        if (options) {
            this._applyOptions(options, "left", "top")
        }
    }


    create() { //todo
        //generate buttons and pages
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
            van.add(content, content_div);
        }
        //add them to divs
        return (
            div({ "class": "flex flex-row gap-1" }, buttons, content));
    }

    addToTab(tab, content) {
        if (!(tab in this.tabs)) {
            console.warn("This tab does not exists between tabs " + tab);
        }
        this.tabs["tab"].push(...content);
    }

    generateCode() {
        return super.generateCode("Menu");
    }
}

export { Menu };
