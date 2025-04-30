import { BaseComponent } from "./baseComponent.mjs";
import { Div } from "./div.mjs";
import van from "../vanjs.mjs";

const { div } = van.tags;

class FullscreenMenu extends BaseComponent{
    constructor(options, ...args) {
        super(options, );
        this.tabs = {};

        this.content = new Div({ id: this.id + "-content", extraClasses: {height: "h-full", width: "w-full"} });
        for (let i of args) {
            this.addTab(i);
        }
    }
    addTab(item){
        if (!(item instanceof Div)) {
            throw new Error("Item is not a Div");
        }
        if (!item.id) {
            throw new Error("Item does not have an id");
        }

        this.tabs[item.id] = item;
        item.setClass("display", "hidden");
        item.attachTo(this.content);
    }

    create(){
        this.content.attachTo(this);

        return div({ id: "overlay", class: "hidden" },
                    div({ id: "overlay-darken", onclick: () => {document.getElementById("overlay").classList.toggle("hidden");}}),
                    div({ id: "overlay-content" }, ...this.children),
                );
    }
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

    getContentDomNode() {
        return document.getElementById(this.id + "-content");
    }
}
export { FullscreenMenu };