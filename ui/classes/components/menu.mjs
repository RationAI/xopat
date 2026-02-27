import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { MenuTab } from "./menuTab.mjs";
import { Join } from "../elements/join.mjs";
import { Div } from "../elements/div.mjs";
import { Button } from "../elements/buttons.mjs";
import { Dropdown } from "../elements/dropdown.mjs";

const ui = { Join, Div, Button, MenuTab, Dropdown };
const { div, span, h3 } = van.tags()

/**
 * @class Menu
 * @extends BaseComponent
 * @description A menu component to group e.g. buttons, inputs..
 * @example
 * const menu = new Menu({
 *                        id: "myMenu",
 *                        orientation: Menu.ORIENTATION.TOP
 *                       },
 *                       {id: "s1", icon: settingsIcon, title: "Content1", body: "Settings1"},
 *                       {id: "s2", icon: settingsIcon, title: "Content2", body: "Settings2"});
 * menu.attachTo(document.body);
 */
class Menu extends BaseComponent {
    /**
     * @param {*} options
     * @param {keyof typeof Menu.ORIENTATION} [options.orientation] - The orientation of the menu
     * @param {keyof typeof Menu.BUTTONSIDE} [options.buttonSide] - The side of the buttons
     * @param  {...any} args - items to be added to the menu in format {id: string, icon: string or faIcon, title: string, body: string}
     */
    constructor(options = undefined, ...args) {
        options = super(options, ...args).options;

        this.tabs = {};
        this._focused = undefined;
        this._orientation = "TOP";
        this._design = "TITLEICON";

        this.header = new ui.Join({ id: this.id + "-header", style: ui.Join.STYLE.HORIZONTAL });
        this.body = new ui.Div({ id: this.id + "-body", extraClasses: {height: "h-full", width: "w-full"} });

        for (let i of this._children) {
            this.addTab(i);
        }

        this.classMap["base"] = "flex gap-1 h-full";
        this.classMap["flex"] = "flex-col";

        this.options["orientation"] = Menu.ORIENTATION.TOP;
        this.options["buttonSide"] = Menu.BUTTONSIDE.LEFT;
        this.options["design"] = Menu.DESIGN.TITLEICON;
        this.options["rounded"] = Menu.ROUNDED.DISABLE;

        this._applyOptions(options, "orientation", "buttonSide", "design", "rounded");
        this._children = [];
    }


    create() {
        this.header.attachTo(this);
        this.body.attachTo(this);
        return div(
            { ...this.commonProperties, ...this.extraProperties },
            ...this.children
        );
    }

    /**
     * Retrieve tab item
     * @param id
     * @return {*}
     */
    getTab(id) {
        return this.tabs[id];
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
     * @param {Dropdown|object} item. If object, DropDown contructor params are accepted, which among other include support for:
     *   sections: [
     *     { id: "actions" },
     *     { id: "recent", title: "Open Projects", order: 10 },
     *   ],
     *   items: [
     *     { id: "new",   section: "actions", label: "New Project…", icon: "add" },
     *     { id: "open",  section: "actions", label: "Open…", icon: "folder_open", kbd: "⌘O", href: "#" },
     *     { id: "clone", section: "actions", label: "Clone Repository…", icon: "content_copy" },
     *     { id: "xopat", section: "recent",  label: "xopat", icon: "widgets", selected: true },
     *   ],
     * @param {XOpatElementID} [componentId]
     * @description adds a dropdown type item to the menu
     * @return {Dropdown}
     */
    addDropdown(item, componentId=undefined){
        if (item.class !== Dropdown || !item.id){
            throw new Error("Item for addDropdown needs to be of type Dropdown and have id property!");
        }
        const id = item.id;
        item.parentId = this.id;
        item.onClick = item.onClick || (() => {});
        let tab = new Dropdown(item);

        this.tabs[id] = tab;

        tab.headerButton.setClass("join", "join-item");
        if (componentId) {
            tab = BaseComponent.ensureTaggedAsExternalComponent(tab, componentId);
        }
        switch (this._design) {
            case "ICONONLY":
                tab.iconOnly();
                break;
            case "TITLEONLY":
                tab.titleOnly();
                break;
            case "TITLEICON":
                tab.titleIcon();
                break;
            default:
                throw new Error("Unknown design type");
        }

        tab.attachTo(this.header);
        return tab;
    }

    /**
     * @param {UINamedItem} item dictionary with id, icon, title, body which will be added to the menu
     * @param {XOpatElementID} [componentId]
     * @return {MenuTab|Dropdown}
     */
    addTab(item, componentId=undefined) {
        if (item.class === Dropdown) {
            return this.addDropdown(item, componentId);
        }

        if (!(item.id && item.icon && item.title)) {
            throw new Error("Item for menu needs every property set.");
        }
        let tab = item.class ? new item.class(item, this) : new MenuTab(item, this);

        const prevTab = this.tabs[item.id];
        if (prevTab) {
            tab.headerButton?.removeFrom(this.header);
            tab.contentDiv?.removeFrom(this.body);
        }

        this.tabs[item.id] = tab;

        tab.headerButton.setClass("join", "join-item");
        if (componentId) {
            tab = BaseComponent.ensureTaggedAsExternalComponent(tab, componentId);
        }

        switch (this._design) {
            case "ICONONLY":
                tab.iconOnly();
                break;
            case "TITLEONLY":
                tab.titleOnly();
                break;
            case "TITLEICON":
                tab.titleIcon();
                break;
            default:
                throw new Error("Unknown design type");
        }

        tab.headerButton.attachTo(this.header);
        if (tab.contentDiv) {
            tab.contentDiv.attachTo(this.body);
        }
        return tab;
    }

    /**
     * @param {*} id of the item we want to focus
     */
    focus(id) {
        if (id in this.tabs) {
            this.tabs[id].focus();
            this._focused = id;
            return true;
        }
        return false;
    }

    focusAll(){
        for (let tab of Object.values(this.tabs)) {
            tab.focus();
        }
        this._focused = "all";
    }

    /**
     * @description unfocus all tabs
     */
    unfocusAll() {
        for (let tab of Object.values(this.tabs)) {
            tab.unfocus();
        }
        this._focused= undefined;
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

    /**
     *
     * @returns {HTMLElement} The body of the menu
     */
    getBodyDomNode() {
        return document.getElementById(this.id + "-body");
    }

    /**
     *
     * @returns {HTMLElement} The header of the menu
     */
    getHeaderDomNode() {
        return document.getElementById(this.id + "-header");
    }

    headerSwitchVisible(){
        this.header_visible = !this.header_visible;
        if (this.header_visible) {
            this.header.setClass("hidden", "hidden");
        } else {
            this.header.setClass("hidden", "");
        }
    }

    append(title, titleItem, item, id, pluginId, bg=undefined) {
        let content =
            div({ id: `${id}`, class: `inner-panel ${pluginId}-plugin-root overflow-x-hidden` },
                div(
                    h3({class: "d-inline-block h3 btn-pointer ml-2"}, title),
                    this.toNode(titleItem),
                ),
                div({ class: "inner-panel-visible" },
                    this.toNode(item),
                )
            );

        this.addTab({id: id, icon: "fa-gear", title: title, body: [content], background: bg});

        // todo implement focus manager, similar to visibility manager
        if (APPLICATION_CONTEXT.AppCache.get(`${id}-open`, true)){
            this.tabs[id]._setFocus();
        } else {
            this.tabs[id]._removeFocus();
        }
    }

    appendExtended(title, titleItem, item, hiddenItem, id, pluginId, bg=undefined) {
        let content =
            div({ id: `${id}`, class: `inner-panel ${pluginId}-plugin-root` },
                div({onclick: this.clickHeader},
                    span({
                        class: "fa-auto fa-chevron-right inline-arrow plugins-pin btn-pointer",
                        id: `${id}-pin`,
                        style: "padding: 0;" },
                    ),
                    h3({class: "d-inline-block h3 btn-pointer"}, title),
                    this.toNode(titleItem),
                ),
                div({ class: "inner-panel-visible" },
                    this.toNode(item),
                ),
                div({ class: "inner-panel-hidden" },
                    this.toNode(hiddenItem),
                ),
            );

        this.addTab({id: id, icon: "fa-gear", title: title, body: [content], background: bg});

        // todo move to focus manager like visibility manager
        if (APPLICATION_CONTEXT.AppCache.get(`${id}-open`, true)){
            this.tabs[id]._setFocus();
        } else{
            this.tabs[id]._removeFocus();
        }

    }

    clickHeader() {
        const toVisible = this.offsetParent.lastChild;
        if (toVisible.classList.contains('force-visible')){
            toVisible.classList.remove('force-visible');
            this.childNodes[0].classList.remove('opened')
        } else{
            toVisible.classList.add('force-visible');
            this.childNodes[0].classList.add('opened')

        }
    }

    static generateCode() {
        return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

ui = globalThis.UI;

const settingsIcon = new ui.FAIcon({name: "fa-gear"});

window["workspaceItem"] = new ui.Menu({
    id: "myMenu",
    orientation: ui.Menu.ORIENTATION.TOP,
    buttonSide: ui.Menu.BUTTONSIDE.LEFT,
    design: ui.Menu.DESIGN.TEXTICON
},
{id: "s1", icon: settingsIcon, title: "Content1", body: "Settings1"},
{id: "s2", icon: settingsIcon, title: "Content2", body: "Settings2"},
{id: "s3", icon: settingsIcon, title: "Content3", body: "Settings3"})


window["workspaceItem"].attachTo(document.getElementById("workspace"));

window["workspaceItem"].addTab({id: "s4", icon: "fa-home", title: "Content3", body: "Settings3"});

window["workspaceItem"].deleteTab("s3");
`;

    }
}

Menu.ORIENTATION = {
    TOP: function () {
        this.setClass("flex", "flex-col");
        this._orientation = "TOP";
        this.header.set(ui.Join.STYLE.HORIZONTAL);
        for (let t of Object.values(this.tabs)) { t.headerButton?.set(ui.Button.ORIENTATION.HORIZONTAL); t.iconRotate(); }
    },
    BOTTOM: function () {
        this.setClass("flex", "flex-col-reverse");
        this._orientation = "BOTTOM";
        this.header.set(ui.Join.STYLE.HORIZONTAL);
        for (let t of Object.values(this.tabs)) { t.headerButton?.set(ui.Button.ORIENTATION.HORIZONTAL); t.iconRotate(); }
    },
    LEFT: function () {
        this.setClass("flex", "flex-row");
        this._orientation = "LEFT";
        this.header.set(ui.Join.STYLE.VERTICAL);
        for (let t of Object.values(this.tabs)) { t.headerButton?.set(ui.Button.ORIENTATION.VERTICAL_LEFT); t.iconRotate(); }
    },
    RIGHT: function () {
        this.setClass("flex", "flex-row-reverse");
        this._orientation = "RIGHT";
        this.header.set(ui.Join.STYLE.VERTICAL);
        for (let t of Object.values(this.tabs)) { t.headerButton?.set(ui.Button.ORIENTATION.VERTICAL_RIGHT); t.iconRotate(); }
    }
}

Menu.BUTTONSIDE = {
    LEFT: function () { this.header.setClass("flex", ""); },
    RIGHT: function () { this.header.setClass("flex", "flex-end"); },
}

Menu.DESIGN = {
    ICONONLY: function () {
        this._design = "ICONONLY";
        for (let t of Object.values(this.tabs)) { t.iconOnly(); t.iconRotate(); }
    },
    TITLEONLY: function () {
        this._design = "TITLEONLY";
        for (let t of Object.values(this.tabs)) { t.titleOnly(); t.iconRotate(); }
    },
    TITLEICON: function () {
        this._design = "TITLEICON";
        for (let t of Object.values(this.tabs)) { t.titleIcon(); t.iconRotate(); }
    }
}

Menu.ROUNDED = {
    ENABLE: function () { ui.Join.ROUNDED.ENABLE.call(this.header); },
    DISABLE: function () { ui.Join.ROUNDED.DISABLE.call(this.header); },
};

export { Menu };
