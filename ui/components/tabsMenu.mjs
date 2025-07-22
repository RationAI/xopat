import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";
import { Div } from "./div.mjs";
import { FAIcon } from "./fa-icon.mjs";
import { Button } from "./buttons.mjs";

const { div, span } = van.tags

class TabsMenu extends BaseComponent {

    constructor(options, ...args) {
        super(options,);

        this.tabs = {};
        this.focused = undefined;
        this.design = options.design || "TITLEICON";

        // TODO why is there join-horizontal???
        this.header = new Div({ id: this.id + "-header", extraClasses: { tabs: "tabs", style: "tabs-boxed" }});
        this.body = new Div({ id: this.id + "-body", extraClasses: { height: "h-full", width: "w-full" } });

        for (let i of args) {
            this.addTab(i);
        }

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

        const tab = this.createTab(item);
        this.tabs[item.id] = tab;

        if (this._initializing) {
            tab.headerButton.attachTo(this.header);
            if (tab.contentDiv) {
                tab.contentDiv.attachTo(this.body);
            }
        } else {
            tab.headerButton.attachTo(document.getElementById(this.id + "-header"));
            if (tab.contentDiv) {
                tab.contentDiv.attachTo(document.getElementById(this.id + "-body"));
            }
        }
    }

    /**
     * @param {*} item dictionary with id, icon, title, body which will be created
     * @returns {*} Button and Div components from VanJS framework
     */
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
            this.focused = id;
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
        this.focused= undefined;
    }

}

export { TabsMenu }