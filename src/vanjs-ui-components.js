const HtmlRenderer = (htmlString) => {
    const container = van.tags.div(); // Create a container div
    container.innerHTML = htmlString; // Set innerHTML to render safely
    return container;
};

/**
 * @class BaseComponent
 * @description The base class for all components
 */
class BaseComponent {

    /**
     *
     * @param {*} options - other options are defined in the constructor of the derived class
     * @param  {...any} args
     * @param {string} [options.id] - The id of the component
     */
    constructor(options, ...args) {
        const extraClasses = options["extraClass"];
        this.classMap = typeof extraClasses === "object" ? extraClasses : {};
        this.additionalProperties = options["additionalProperties"] || {};
        this._children = args;
        this._renderedChildren = null;
        this._initializing = true;
        this.classState = van.state("");

        if (options) {
            if (options.id) {
                this.id = options.id;
                delete options.id;
            }
            this.options = options;
        } else {
            this.options = {};
        }
    }

    /**
     *
     * @param {*} element - The element to attach the component to
     */
    attachTo(element) {
        this._initializing = false;
        this.refreshState();
        if (element instanceof BaseComponent) {
            element.addChildren(this);
        } else {
            van.add(element,
                this.create());
        }
    }

    /**
     * Refresh the state of the component, e.g. class names
     */
    refreshState() {
        this.classState.val = Object.values(this.classMap).join(" ");
    }

    /**
     *
     * @param  {...any} properties - functions to set the state of the component
     */
    set(...properties) {
        for (let property of properties) {
            property.call(this);
        }
    }
    /**
     *
     * @param  {...any} children - children to add to the component
     */
    addChildren(...children) {
        this._children.push(...children);
    }

    /**
     * getter for children which will automatically refresh them and create them if they are BaseComponent
     */
    get children() {
        if (this._renderedChildren) return this._renderedChildren;
        this._renderedChildren = (this._children || []).map(child => {
            if (child instanceof BaseComponent) {
                child.refreshState();
                return child.create();
            }
            if (child instanceof Element) {
                return child;
            }
            if (typeof child === "string") {
                return child.trimStart().startsWith("<") ? HtmlRenderer(child) : child;
            }
            console.warn(`Invalid child component provided - ${typeof child}:`, child);
            return undefined;
        }).filter(Boolean);
        return this._renderedChildren;
    }

    /**
     * getter for commonProperties which are shared against all components
     */
    get commonProperties() {
        if (this.id) {
            return {
                id: this.id,
                class: this.classState
            };
        };

        return {
            class: this.classState
        };
    }

    /**
     *
     * @param {string} key - The key of the class
     * @param {string} value - The value of the class
     * @description Set the class of the component
     * @example
     * button.setClass("size", "btn-lg");
     */
    setClass(key, value) {
        this.classMap[key] = value;
        if (!this._initializing) {
            this.classState.val = Object.values(this.classMap).join(" ");
        }
    }

    /**
     * @description Create the component
     * it needs to be overridden by the derived class
     */
    create() {
        throw new Error("Component must override create method");
    }

    /**
     * If you document a component properties like this:
     * Component.PROPERTY = {
     *     X: function () { ... do something ... },
     *     Y: function () { ... do something ... },
     * };
     * You can use this function that will iterate options object
     * and for each component, calls the initialization where necessary.
     *
     * Usage (in constructor): this._applyOptions(options, "X", "Y");
     *
     * @param options
     * @param {string} names keys to the options object, values of the keys
     * should be functions
     */
    _applyOptions(options, ...names) {
        const wasInitializing = this._initializing;
        this._initializing = true;
        for (let prop of names) {
            const option = options[prop];
            try {
                if (option) option.call(this);
            } catch (e) {
                console.warn("Probably incorrect component usage! Option values should be component-defined functional properties!", e);
            }
        }
        this._initializing = wasInitializing;
        if (wasInitializing) {
            this.refreshState();
        }

    }
}
const { button } = van.tags

/**
 * @class Button
 * @extends BaseComponent
 * @description A button component
 * @example
 * const button = new Button({
 *                            id: "myButton",
 *                            size: Button.SIZE.LARGE,
 *                            outline: Button.OUTLINE.ENABLE
 *                           },
 *                           "Click me");
 * button.attachTo(document.body);
 */
class Button extends BaseComponent {

    /**
     * @param {*} options
     * @param  {...any} args
     * @param {Function} [options.onClick] - The click event handler
     * @param {keyof typeof Button.SIZE} [options.size] - The size of the button
     * @param {keyof typeof Button.OUTLINE} [options.outline] - The outline style of the button
     * @param {keyof typeof Button.TYPE} [options.type] - The button type
     */
    constructor(options, ...args) {
        super(options, ...args);

        this.classMap["base"] = "btn";
        this.classMap["type"] = "btn-primary";
        this.classMap["size"] = "";
        this.classMap["outline"] = "";

        if (options) {
            if (options.onClick) this.onClick = options.onClick;
            this._applyOptions(options, "size", "outline", "type");
        }
    }

    create() {
        return button(
            { ...this.commonProperties, onclick: this.onClick, ...this.additionalProperties },
            ...this.children
        );
    }

    static generateCode() {
        return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

import { default as ui } from "/ui/index.mjs";

window["workspaceItem"] = new ui.Button({
    id: "myButton",
    size: ui.Button.SIZE.NORMAL,
    outline: ui.Button.OUTLINE.DISABLE,
    TYPE: ui.Button.TYPE.PRIMARY,
    onClick: function () {
        console.log("Button clicked");
    }
},"Click me");

window["workspaceItem"].attachTo(document.getElementById("workspace"));
`;

    }
}

Button.SIZE = {
    LARGE: function () { this.setClass("size", "btn-lg"); },
    NORMAL: function () { this.setClass("size", ""); },
    SMALL: function () { this.setClass("size", "btn-sm"); },
    TINY: function () { this.setClass("size", "btn-xs"); }
};

Button.OUTLINE = {
    ENABLE: function () { this.setClass("outline", "btn-outline"); },
    DISABLE: function () { this.setClass("outline", ""); }
};

Button.TYPE = {
    PRIMARY: function () { this.setClass("type", "btn-primary") },
    SECONDARY: function () { this.setClass("type", "btn-secondary") },
    TERNARY: function () { this.setClass("type", "btn-accent") }
}

const { div, input, details, summary } = van.tags

/**
 * @class Collapse
 * @extends BaseComponent
 * @description A collapse component
 * @example
 * const collapse = new Collapse({
 *    id: "myCollapse",
 *   summary: "Click me",
 * },
 * div("I am in the collapse"));
 * collapse.attachTo(document.body);
 */
class Collapse extends BaseComponent {

    /**
     * @param {*} options
     * @param  {...any} args
     * @param {string} [options.summary] - The text of the summary
     * @param {boolean} [options.startOpen] - Whether the collapse should start open
     * @param {string} [options.textSize] - The text size of the summary
     * @param {string} [options.font] - The font of the summary
     * @param {string} [options.customSummary] - The custom summary
     */
    constructor(options, ...args) {
        if (typeof options === "string") {
            options = { summary: options };
        };
        super(options, ...args);

        this.classMap["base"] = "collapse bg-base-200 collapse-arrow";
        this.classMap["collapseTitle"] = "";
        this.classMap["textSize"] = "text-xl";
        this.classMap["font"] = "font-medium";
        this.classMap["summaryClassList"] = [];
        this.classMap["detailsClassList"] = [];
        this.input = "checkbox";
        this.summary = "Expand"; // TODO -> translation
        this.startOpen = !!options.startOpen;

        if (options) {
            if (options.summary) this.summary = options.summary;
            this._applyOptions(options, "textSize", "font", "customSummary");
        }
    }

    create() {
        return details(
            { ...this.commonProperties, ...this.additionalProperties, open: this.startOpen },
            summary({ class: ["collapse-title select-none", this.classMap["textSize"], this.classMap["font"], ...this.classMap["summaryClassList"]].join(" ") }, this.summary),
            div({ class: "collapse-content" + " " + this.classMap["detailsClassList"].join(" ") },
                ...this.children
            )
        );
    }

    static generateCode() {
        return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

import { default as ui } from "/ui/index.mjs";

window["workspaceItem"] = new ui.Collapse({
    id: "myCollapse",
    summary: "Click me",
},"you clicked on collapse");

window["workspaceItem"].attachTo(document.getElementById("workspace"));
`
    }

}

/**
 * @class Div
 * @extends BaseComponent
 * @description A div component
 * @example
 * const div = new Div({
 *                      id: "myDiv",
 *                      base: "flex gap-1 bg-base-200",
 *                      flex: "flex-col"
 *                      }, myButton, MyDiv
 *                     );
 * div.attachTo(document.body);
 */
class Div extends BaseComponent {

    /**
     * @param {*} options
     * @param  {...any} args
     */
    constructor(options, ...args) {
        super(options, ...args);
        this.classMap = this.options;
    }

    create() {
        return div(
            { ...this.commonProperties, ...this.additionalProperties },
            ...this.children
        );
    }
}

/**
 * @class FAIcon
 * @extends BaseComponent
 * @description A icon component
 * @example
 * const settingsIcon = new FAIcon({
 *    name: "fa-gear"
 * });
 *
 * //then we need to add it as an child to the another component:
 * const settings = new Button({
 *   onClick: () => {
 *      USER_INTERFACE.AdvancedMenu.openMenu(APPLICATION_CONTEXT.settingsMenuId);
 *  },
 * id: "settingsButton",
 * }, settingsIcon);
*/
class FAIcon extends BaseComponent {

    /**
     * @param {*} options
     * @param  {...any} args
     * @param {string} [options.name] - The name of the icon
    **/
    constructor(options, ...args) {

        if (typeof options === "string") {
            options = { name: options };
        }

        super(options, ...args);
        this.classMap["base"] = "fa-solid";
        this.classMap["name"] = options && options["name"] || "";
    }

    create() {
        return i({ ...this.commonProperties, ...this.additionalProperties });
    }

    static generateCode() {
        return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

import { default as ui } from "/ui/index.mjs";

window["workspaceItem"] = new ui.FAIcon({ name: "fa-gear" });

window["workspaceItem"].attachTo(document.getElementById("workspace"));
`
    }
}

/**
 * @class Join
 * @extends BaseComponent
 * @description A join component to group e.g. buttons, inputs..
 * @example
 * const join = new Join({
 *                          id: "myJoin",
 *                          style: Join.STYLE.VERTICAL
 *                       }, button1, button2, button3);
 * join.attachTo(document.body);
 */
class Join extends BaseComponent {

    /**
     * @param {*} options
     * @param {keyof typeof Join.STYLE} [options.style=undefined]
     * @param  {...any} args
     */
    constructor(options, ...args) {
        super(options, ...args);

        //Todo add support for tracking the selected button if the join is a list of buttons (possibly define component buttongroup that inherits from a join)
        this.classMap["base"] = "join bg-join";
        this.classMap["flex"];
        if (!options) options = {};
        options.style = options.style || Join.STYLE.VERTICAL;
        this._applyOptions(options, "style", "rounded");
    }

    create() {
        // Todo we might support also string children, detect type and convert to DOM objects if found to attach to classList manually...
        for (let child of this._children) {
            if (child instanceof BaseComponent) {
                child.setClass("join", "join-item");
            }
        }
        return div({ ...this.commonProperties, ...this.additionalProperties }, ...this.children);
    }
}

Join.STYLE = {
    VERTICAL: function () { this.setClass("direction", "join-vertical"); },
    HORIZONTAL: function () { this.setClass("direction", "join-horizontal"); },
};

Join.ROUNDED = {
    ENABLE: function () { this.setClass("rounded", ""); },
    DISABLE: function () { this.setClass("rounded", "join-unrounded"); },
};

const ui = { Button, Div, FAIcon, Join };
const { span } = van.tags

/**
 * @class MenuTab
 * @description A internal tab component for the menu component
 * @example
 * const tab = new MenuTab({id: "s1", icon: settingsIcon, title: "Content1", body: "Settings1"}, menu);
 */
class MenuTab {
    /**
     * @param {*} item dictionary with id, icon, title, body which will be created
     * @param {*} parent parent menu component
     */
    constructor(item, parent) {
        this.parent = parent;

        const [headerButton, contentDiv] = this.createTab(item);

        this.headerButton = headerButton;
        this.contentDiv = contentDiv;
    }

    /**
     * @param {*} item dictionary with id, icon, title, body which will be created
     * @returns {*} Button and Div components from VanJS framework
     */
    createTab(item) {
        const content = item["body"];
        const inText = item["title"];
        let inIcon = item["icon"];

        if (!(inIcon instanceof BaseComponent)) {
            inIcon = new ui.FAIcon({ name: inIcon });
        }

        this.icon = inIcon;
        this.icon.setClass("padding", "pl-3");
        this.title = span({ class: "pl-2" }, inText);

        const b = new ui.Button({
            id: this.parent.id + "-b-" + item.id,
            size: ui.Button.SIZE.SMALL,
            additionalProperties: { title: inText },
            extraClass: { item: "menu-item-horizontal", "padding-left": "pl-0" },
            onClick: () => {
                this.focus();
            }
        }, this.icon, this.title);

        const c = new ui.Div({ id: this.parent.id + "-c-" + item.id, display: "display-none", height: "h-full" }, ...content);
        return [b, c];
    }

    removeTab() {
        document.getElementById(this.headerButton.id).remove();
        document.getElementById(this.contentDiv.id).remove();
    }

    focus() {
        for (let div of document.getElementById(this.parent.id + "-body").childNodes) {
            div.style.display = "none";
            if (div.id === this.contentDiv.id) {
                div.style.display = "block";
            }
        }

        for (let i of Object.values(this.parent.tabs)) {
            const button = i.headerButton;
            button.setClass("type", "btn-primary");
            if (button.id === this.headerButton.id) {
                button.setClass("type", "btn-secondary");
            }
        }
    }

    close() {
        this.headerButton.setClass("type", "btn-primary");
        document.getElementById(this.contentDiv.id).style.display = "none";
    }

    titleOnly() {
        const nodes = document.getElementById(this.headerButton.id).childNodes;
        nodes[0].classList.add("hidden");
        nodes[1].classList.remove("hidden");

    }

    titleIcon() {
        const nodes = document.getElementById(this.headerButton.id).childNodes;
        nodes[0].classList.remove("hidden");
        nodes[1].classList.remove("hidden");
    }

    iconOnly() {
        const nodes = document.getElementById(this.headerButton.id).childNodes;
        nodes[0].classList.remove("hidden");
        nodes[1].classList.add("hidden");
    }
}

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
    constructor(options, ...args) {
        super(options,);
        if (!this.id) {
            this.id = "menu-" + Math.random().toString(36).substring(7);
        }

        this.tabs = {};

        this.header = new ui.Join({ id: this.id + "-header", style: ui.Join.STYLE.HORIZONTAL });
        this.body = new ui.Div({ id: this.id + "-body", height: "h-full" });

        for (let i of args) {
            if (!(i.id && i.icon && i.title && i.body)) {
                throw new Error("Item for menu needs every property set.");
            }

            const tab = new MenuTab(i, this);
            this.tabs[i.id] = tab;
            tab.headerButton.attachTo(this.header);
            tab.contentDiv.attachTo(this.body);
        }

        this.classMap["base"] = "flex gap-1 bg-base-200 h-full";
        this.classMap["orientation"] = Menu.ORIENTATION.TOP;
        this.classMap["buttonSide"] = Menu.BUTTONSIDE.LEFT;
        this.classMap["design"] = Menu.DESIGN.TITLEICON;
        this.classMap["rounded"] = Menu.ROUNDED.DISABLE;
        this.classMap["flex"] = "flex-col";

        if (options) {
            this._applyOptions(options, "orientation", "buttonSide", "design", "rounded");
        }
    }


    create() {
        this.header.attachTo(this);
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
        if (!(item.id && item.icon && item.title && item.body)) {
            throw new Error("Item for menu needs every property set.");
        }
        const tab = new MenuTab(item, this);

        this.tabs[item.id] = tab;

        tab.headerButton.setClass("join", "join-item");
        tab.headerButton.attachTo(document.getElementById(this.id + "-header"));
        tab.contentDiv.attachTo(document.getElementById(this.id + "-body"));
    }

    /**
     * @param {*} id of the item we want to focus
     */
    focus(id) {
        if (id in this.tabs) {
            this.tabs[id].focus();
            return true;
        }
        return false;
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

    static generateCode() {
        return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

import { default as ui } from "/ui/index.mjs";

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
        this.header.set(ui.Join.STYLE.HORIZONTAL);
        for (let b in Object.values.tabs) { b.headerButton.setClass("item", "menu-item-horizontal"); }
    },
    BOTTOM: function () {
        this.setClass("flex", "flex-col-reverse");
        this.header.set(ui.Join.STYLE.HORIZONTAL);
        for (let b in Object.values.tabs) { b.headerButton.setClass("item", "menu-item-horizontal"); }
    },
    LEFT: function () {
        this.setClass("flex", "flex-row");
        this.header.set(ui.Join.STYLE.VERTICAL);
        for (let b in Object.values.tabs) { b.headerButton.setClass("item", "menu-item-vertical"); }
    },
    RIGHT: function () {
        this.setClass("flex", "flex-row-reverse");
        this.header.set(ui.Join.STYLE.VERTICAL);
        for (let b in Object.values.tabs) { b.headerButton.setClass("item", "menu-item-vertical"); }
    }
}

Menu.BUTTONSIDE = {
    LEFT: function () { this.header.setClass("flex", ""); },
    RIGHT: function () { this.header.setClass("flex", "flex-end"); },
}

Menu.DESIGN = {
    ICONONLY: function () {
        for (let t of Object.values(this.tabs)) { t.iconOnly(); }
    },
    TITLEONLY: function () {
        for (let t of Object.values(this.tabs)) { t.titleOnly(); }
    },
    TITLEICON: function () {
        for (let t of Object.values(this.tabs)) { t.titleIcon(); }
    }
}

Menu.ROUNDED = {
    ENABLE: function () { ui.Join.ROUNDED.ENABLE.call(this.header); },
    DISABLE: function () { ui.Join.ROUNDED.DISABLE.call(this.header); },
};

const { h3 } = van.tags


class MainPanel extends Menu {
    constructor() {
        super({ id: "myMenu", orientation: Menu.ORIENTATION.TOP },
            { id: "base", icon: settingsIcon, title: "base", body: "" });
    }
    // MainMenu
    append(title, titleHtml, html, id, pluginId) {
        const htmlIn = div();
        htmlIn.innerHTML = html;

        const titleHtmlIn = div();
        titleHtmlIn.innerHTML = titleHtml;

        let content =
            div({ id: id, class: "inner-panel " + pluginId + "-plugin-root inner-panel-simple" },
                div(
                    h3({ class: "d-inline-block h3", style: "padding-left: 15px;" },
                        title,
                    ),
                    titleHtmlIn,
                ),
                htmlIn,
            )
        van.add(document.getElementById(this.tabs["base"].contentDiv.id), content);
    }

    replace(title, titleHtml, html, id, pluginId) {
        $(`.${pluginId}-plugin-root`).remove();
        this.append(title, titleHtml, html, id, pluginId);
    }

    appendExtended(title, titleHtml, html, hiddenHtml, id, pluginId) {
        const titleHtmlIn = div();
        titleHtmlIn.innerHTML = titleHtml;

        const htmlIn = div();
        htmlIn.innerHTML = html;

        const hiddenHtmlIn = div();
        hiddenHtmlIn.innerHTML = hiddenHtml;

        let content =
            div({ id: `${id}`, class: `inner-panel ${pluginId}-plugin-root` },
                div(
                    span({ class: `material-icons inline-arrow plugins-pin btn-pointer`, id: `${id}-pin`, onclick: `USER_INTERFACE.MainMenu.clickHeader($(this), $(this).parent().parent().children().eq(2));`, style: `padding: 0;` },
                        `navigate_next`,
                    ),
                    h3({ class: `d-inline-block h3 btn-pointer`, onclick: `USER_INTERFACE.MainMenu.clickHeader($(this.previousElementSibling), $(this).parent().parent().children().eq(2));` },
                        `${title} `,
                    ),
                    `${titleHtmlIn}`,
                ),
                div({ class: `inner-panel-visible` },
                    `${htmlIn}`,
                ),
                div({ class: `inner-panel-hidden` },
                    `${hiddenHtmlIn}`,
                ),
            )

        van.add(document.getElementById(this.tabs["base"].contentDiv.id), content);
    }

    replaceExtended(title, titleHtml, html, hiddenHtml, id, pluginId) {
        $(`.${pluginId}-plugin-root`).remove();
        this.appendExtended(title, titleHtml, html, hiddenHtml, id, pluginId);
    }
    appendRaw(html, id, pluginId) {
        const htmlIn = div();
        htmlIn.innerHTML = html;
        let content = div({ id: id, class: "inner-panel " + pluginId + "-plugin-root inner-panel-simple" }, htmlIn);
        van.add(document.getElementById(this.tabs["base"].contentDiv.id), content);
    }
    clickHeader(jQSelf, jQTargetParent) {
        if (jQTargetParent.hasClass('force-visible')) {
            jQTargetParent.removeClass('force-visible');
            jQSelf.removeClass('opened');
        } else {
            jQSelf.addClass('opened');
            jQTargetParent.addClass('force-visible');
        }
    }
    open() {
        if (this.opened) return;
        this.context.css("right", "0");
        this.opened = true;
        USER_INTERFACE.Margins.right = 400;
        this._sync();
    }
    close() {
        if (!this.opened) return;
        this.context.css("right", "-400px");
        this.opened = false;
        USER_INTERFACE.Margins.right = 0;
        this._sync();
    }
    _sync() {
        this.navigator.css("position", this.opened ? "relative" : this.navigator.attr("data-position"));
        let width = this.opened ? "calc(100% - 400px)" : "100%";
        USER_INTERFACE.AdvancedMenu.selfContext.context.style['max-width'] = width;
        if (pluginsToolsBuilder) pluginsToolsBuilder.context.style.width = width;
        if (tissueMenuBuilder) tissueMenuBuilder.context.style.width = width;

        let status = USER_INTERFACE.Status.context;
        if (status) status.style.right = this.opened ? "408px" : "8px";
    }

    // AdvancedMenu
    setMenu(ownerPluginId, toolsMenuId, title, html, icon, withSubmenu, container) {
    }
    openMenu(atPluginId, toggle) {
    }
    openSubmenu(atPluginId, atSubId, toggle) {
    }
    close() {
    }
    refreshPageWithSelectedPlugins() {
    }
    addSeparator() {
    }
    _build() {
    }
    _buildMenu(context, builderId, parentMenuId, parentMenuTitle, ownerPluginId, toolsMenuId, title, html, icon, withSubmenu, container) {
    }

}

const UI = { Button, Collapse, FAIcon, Join, Menu, Div, MainPanel };
