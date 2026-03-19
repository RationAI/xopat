import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { Div } from "../elements/div.mjs";
import { FAIcon } from "../elements/fa-icon.mjs";
import { Button } from "../elements/buttons.mjs";
import { Menu } from "./menu.mjs";

const { div, span } = van.tags

class TabsMenu extends Menu {

    constructor(options = undefined, ...args) {
        options = super(options, ...args).options;

        this.tabs = {};
        this._focused = undefined;
        this._design = options.design || Menu.DESIGN.TITLEICON;

        // TODO why is there join-horizontal???
        this.header = new Div({ id: this.id + "-header", extraClasses: { tabs: "tabs", style: "tabs-boxed" }});
        this.body = new Div({ id: this.id + "-body", extraClasses: { flex: "flex-1", minHeight: "min-h-0", width: "w-full", style: "boxed", margin: "m-0" } });

        for (let i of this._children) {
            this.addTab(i);
        }
        this._children = [];
        this.classMap["base"] = "flex gap-1 bg-base-200 h-full";
        this.classMap["flex"] = "flex-col";

        if (options) {
            this._applyOptions(options, "orientation", "buttonSide", "design", "rounded");
        }
    }

    create() {
        this.header.attachTo(this);
        this.body.attachTo(this);
        return div(
            { ...this.commonProperties, ...this.extraProperties },
            ...this.children
        );
    }

    addTab(item) {
        if (!(item.id && item.icon && item.title)) {
            throw new Error("Item for menu needs every property set.");
        }

        const tab = this._createTab(item);
        this.tabs[item.id] = tab;

        if (!this._focused) {
            this.focus(item.id);
        }

        tab.headerButton.attachTo(this.header);
        if (tab.contentDiv) {
            tab.contentDiv.attachTo(this.body);
        }
    }

    /**
     * @param {*} item dictionary with id, icon, title, body which will be created
     * @returns {*} Button and Div components from VanJS framework
     */
    _createTab(item) {
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

    /**
     * @param {*} id of the item we want to focus
     */
    focus(id) {
        if (id in this.tabs) {
            this.unfocusAll();
            this.tabs[id].headerButton.setClass("tab-active", "tab-active");
            if (this.tabs[id].contentDiv) {
                this.tabs[id].contentDiv.setClass("display", "");
            }
            this._focused = id;
            return true;
        }
        return false;
    }

    /**
     * @description unfocus all tabs
     */
    unfocusAll() {
        for (let tab of Object.values(this.tabs)) {
            tab.headerButton.setClass("tab-active", "");
            if (tab.contentDiv) {
                tab.contentDiv.setClass("display", "display-none");
            }
        }
        this._focused = undefined;
    }

}

export { TabsMenu }