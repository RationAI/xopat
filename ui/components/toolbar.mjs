import { BaseComponent } from "./baseComponent.mjs";
import { Div } from "./div.mjs";
import { FAIcon } from "./fa-icon.mjs";
import { Button } from "./buttons.mjs";
import van from "../vanjs.mjs";

const { div, span } = van.tags;

class Toolbar extends BaseComponent{
    constructor(options, ...args) {
        super(options, ...args);

        this.tabs = {};
        this.focused = undefined;
        this.design = options.design || "TITLEICON";

        // TODO why is there join-horizontal???
        this.header = new Div({ id: this.id + "-header", extraClasses: { tabs: "tabs", style: "tabs-boxed" }});
        this.body = new Div({ id: this.id + "-body", extraClasses: { height: "h-full", width: "w-full", style: "boxed" } });

        for (let i of args) {
            this.addTab(i);
        }

        this.classMap["base"] = "flex gap-1 bg-base-200 h-full";
        this.classMap["flex"] = "flex-col";

        if (options) {
            this._applyOptions(options, "orientation", "buttonSide", "design", "rounded");
        }
    }

    addToToolbar(item) {
        if (!(item.id && item.icon && item.title)) {
            throw new Error("Item for menu needs every property set.");
        }

        const tab = this.createTab(item);
        this.tabs[item.id] = tab;

        tab.headerButton.attachTo(this.header);
        if (tab.contentDiv) {
            tab.contentDiv.attachTo(this.body);
        }

        if (Object.keys(this.tabs).length === 1) {
            this.focus(item.id);
            this.header.setClass("display", "hidden");
        } else{
            this.header.setClass("display", "");
        }

    }

    createTab(item) {
        const content = item["body"];
        const inText = item["title"];
        let inIcon = (item["icon"] instanceof BaseComponent) ? item["icon"] : new FAIcon({ name: item["icon"] });        

        let action = (item["onClick"]) ? item["onClick"] : () => {};


        const b = new Button({
            id: this.id + "-b-" + item.id,
            base: "tab",
            type: Button.TYPE.NONE, 
            extraProperties: { title: inText },
            onClick: () => {
                action();
                this.focus(item.id);
            },
        }, inIcon, span(inText));

        let c = undefined;
        if (content){
            c = new Div({ id: this.id + "-c-" + item.id, extraClasses: {display: "display-none", height: "h-full"} }, ...content);
        };

        return {headerButton: b, contentDiv: c};

    }

    create() {
        return div({id: "toolbar-drag", class: "draggable boxed", style: "position: fixed; left: 0;"},
                    div({class: "handle"}, "----"),
                    this.header.create(),
                    this.body.create()
        );
    }

    focus(id) {
        if (id in this.tabs) {
            this.unfocusAll();
            this.tabs[id].headerButton.setClass("tab-active", "tab-active");
            if (this.tabs[id].contentDiv) {
                this.tabs[id].contentDiv.setClass("display", "");
            }
            this.focused = id;
            return true;
        }
        return false;
    }

    /**
     * @description unfocus all tabs
     */
    unfocusAll() {
        console.log("unfocusing all tabs");
        for (let tab of Object.values(this.tabs)) {
            tab.headerButton.setClass("tab-active", "");
            if (tab.contentDiv) {
                tab.contentDiv.setClass("display", "display-none");
            }
        }
        this.focused= undefined;
    }

}

export { Toolbar };