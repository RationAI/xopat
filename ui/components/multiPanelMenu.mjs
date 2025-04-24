import van from "../vanjs.mjs";
import { MenuTab } from "./menuTab.mjs";
import { Join } from "./join.mjs";
import { Div } from "./div.mjs";
import { Button } from "./buttons.mjs";
import { Menu } from "./menu.mjs";
import { MultiPanelMenuTab } from "./multiPanelMenuTab.mjs";

const ui = { Join, Div, Button, MenuTab };
const { div } = van.tags

// TODO add side functionality to choose if the menu is on the left or right side
class MultiPanelMenu extends Menu {

    constructor(options, ...args) {
        super(options,);
        this.tabs = {};

        this.body = new ui.Div({ 
            id: this.id + "-body", 
            extraClasses: {height: "h-full", width: "w-full"}, 
            additionalProperties: {style: "background-color: gray;"}},);

        for (let i of args) {
            this.addTab(i);
        }

        this.classMap["base"] = "flex gap-1 bg-base-200 h-full";
        this.classMap["flex"] = "flex-col";

        if (options) {
            this._applyOptions(options);
        }
    }


    create() {
        this.body.attachTo(this);
        return div(
            { ...this.commonProperties, ...this.additionalProperties },
            ...this.children
        );
    }

    /**
     *
     * @param {*} id id of the item we want to delete
     */
    deleteTab(id) {
        if (!(id in this.tabs)) { throw new Error("Tab with id " + id + " does not exist"); }
        this.tabs[id].removeTab();
        delete this.tabs[id];
    }

    /**
     *
     * @param {*} item dictionary with id, icon, title, body which will be added to the menu
     */
    addTab(item) {
        if (!(item.id && item.icon && item.title)) {
            throw new Error("Item for menu needs every property set.");
        }
        const tab = new MultiPanelMenuTab(item,this);
        this.tabs[item.id] = tab;
        tab.contentDiv.attachTo(this.body);
    }

    /**
     * @param {*} id of the item we want to close
     */
    closeTab(id) {
        if (id in this.tabs) {
            this.tabs[id].close();
            return true;
        }
        return false;
    }

    static generateCode() {
        return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

ui = globalThis.UI;

const settingsIcon = new ui.FAIcon({name: "fa-gear"});

window["workspaceItem"] = new ui.MultiPanelMenu({
    id: "myMenu",
},
{id: "s1", icon: settingsIcon, title: "Content1", body: "Settings1"},
{id: "s2", icon: settingsIcon, title: "Content2", body: "Settings2"},
{id: "s3", icon: settingsIcon, title: "Content3", body: "Settings3"},)


window["workspaceItem"].attachTo(document.getElementById("workspace"));
`;

    }
}

export { MultiPanelMenu };
