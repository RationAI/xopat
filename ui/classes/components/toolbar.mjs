import { BaseComponent } from "../baseComponent.mjs";
import { Div } from "../elements/div.mjs";
import { FAIcon } from "../elements/fa-icon.mjs";
import { Button } from "../elements/buttons.mjs";
import van from "../../vanjs.mjs";

const { div, span } = van.tags;

/**
 * @class Toolbar
 * @extends BaseComponent
 * @description A draggable component that allows to add tabs with content and can be pinned to left or down
 * @example
 * const toolbar = new Toolbar({ id: "myToolbar", design: "TITLEICON" });
 * toolbar.addToToolbar({
 *      id: "tab1",
 *      icon: "fa-icon-name",
 *      title: "Tab 1",
 *      body: [span("Content for Tab 1")]
 * });
 */
class Toolbar extends BaseComponent{
    /**
     * 
     * @param {*} options
     * @param {*} args
     */
    constructor(options = undefined, ...args) {
        options = super(options, ...args).options;
        args = this._children;

        this.classMap["base"] = "flex gap-1 bg-base-200 h-full";
        this.classMap["flex"] = "flex-col";
        this._design = options.design || "TITLEICON";

        this.tabs = {};
        this._focused = undefined;

        // TODO why is there join-horizontal???
        this.header = new Div({ id: this.id + "-header", extraClasses: { tabs: "tabs", style: "tabs-boxed" }});
        this.body = new Div({ id: this.id + "-body", extraClasses: { height: "h-full", width: "w-full", style: "boxed", margin: "m-0" } });

        if (args.length === 0){
            this.display = "none";
        }
        for (let i of args) {
            this.addToToolbar(i);
        }
        this._children = [];
    }

    /**
     * @description creates new toolbar item and adds it to the toolbar
     * @param {*} item dictionary with  id, icon, title, body
     */
    addToToolbar(item) {
        if (!(item.id && item.icon && item.title)) {
            throw new Error("Item for menu needs every property set.");
        }

        this.header.setClass("display", "");
        this.body.setClass("display", "");

        const tab = this._createTab(item);
        this.tabs[item.id] = tab;

        tab.headerButton.attachTo(this.header);
        if (tab.contentDiv) {
            tab.contentDiv.attachTo(this.body);
        }

        this.display = "";

        if (Object.keys(this.tabs).length === 1) {
            this.focus(item.id);
            this.header.setClass("display", "hidden");
        } else{
            this.header.setClass("display", "");
        }

    }

    /**
     * @param {*} item dictionary with  id, icon, title, body
     * @returns tuple of header Button and content Div components
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
        if (content) {
            c = new Div({ id: this.id + "-c-" + item.id, extraClasses: {display: "display-none", height: "h-full"} }, ...content);
        }

        return {headerButton: b, contentDiv: c};

    }

    create() {
        return div({id: `${this.id}`, class: "draggable boxed", 
                    style: `position: fixed; 
                            left: ${APPLICATION_CONTEXT.getOption(`${this.id}-PositionLeft`, 50)}px; 
                            top: ${APPLICATION_CONTEXT.getOption(`${this.id}-PositionTop`, 50)}px; 
                            display: ${this.display};
                            z-index: 1000;`},
                    div({class: "handle"}, "----"),
                    this.body.create()
        );
    }

    /**
     * 
     * @param {*} id id of tab we want to focus
     * @returns if the tab was focused
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
        this._focused= undefined;
    }

}

export { Toolbar };