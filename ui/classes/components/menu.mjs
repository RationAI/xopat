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
     * @param {keyof typeof Menu.SCROLL} [options.bodyScroll] - The body scroll behavior
     * @param {keyof typeof Menu.DESIGN} [options.design] - The design of the menu
     * @param {keyof typeof Menu.ROUNDED} [options.rounded] - The rounded corners of the menu
     * @param {boolean} [options.namespacedTabs] - Whether to namespace tabs
     * @param {string} [options.defaultNamespace] - The default namespace for tabs
     * @param {Array<object>} [options.namespaces] - An array of namespaces to be registered
     * @param {Array<object>} [options.namespaces[].id] - The id of the namespace
     * @param {string} [options.namespaces[].title] - The title of the namespace
     * @param {number} [options.namespaces[].order] - The order of the namespace
     * @param  {...any} args - items to be added to the menu in format {id: string, icon: string or faIcon, title: string, body: string}
     */
    constructor(options = undefined, ...args) {
        options = super(options, ...args).options;

        this.tabs = {};
        this._focused = undefined;
        this._orientation = "TOP";
        this._buttonSide = "LEFT";
        this._design = "TITLEICON";

        // actual width breakpoint for side -> top compact fallback
        this._sideHeaderCollapseWidth = Number(options?.sideHeaderCollapseWidth) || 700;

        this._namespacedTabs = options?.namespacedTabs === true || Array.isArray(options?.namespaces);
        this.defaultNamespace = options?.defaultNamespace || Menu.NAMESPACE.SYSTEM;
        this.namespaceDefinitions = {};
        this.namespaceOrder = [];

        for (const namespace of (Array.isArray(options?.namespaces) && options.namespaces.length ? options.namespaces : Menu.DEFAULT_NAMESPACES)) {
            this.registerNamespace(namespace);
        }

        this.header = new ui.Join({ id: this.id + "-header", style: ui.Join.STYLE.HORIZONTAL});
        this.body = new ui.Div({ id: this.id + "-body", extraClasses: {height: "h-full", width: "w-full"} });

        for (let i of this._children) {
            this.addTab(i);
        }

        this.classMap["base"] = "flex gap-1 h-full";
        this.classMap["flex"] = "flex-col";
        this.options["orientation"] = this.options["orientation"] || Menu.ORIENTATION.TOP;
        this.options["buttonSide"] = this.options["buttonSide"] || Menu.BUTTONSIDE.LEFT;
        this.options["design"] = this.options["design"] || Menu.DESIGN.TITLEICON;
        this.options["rounded"] = this.options["rounded"] || Menu.ROUNDED.DISABLE;
        this.options["bodyScroll"] = this.options["bodyScroll"] || Menu.SCROLL.DISABLE;

        this._applyOptions(options, "orientation", "buttonSide", "design", "rounded", "bodyScroll");
        this._children = [];

        this._resizeHandler = () => this._syncLayout();
        window.addEventListener("resize", this._resizeHandler);
    }


    create() {
        this.header.attachTo(this);
        this.body.attachTo(this);
        const node = div(
            { ...this.commonProperties, ...this.extraProperties },
            ...this.children
        );
        requestAnimationFrame(() => this._syncLayout());
        return node;
    }

    get orientation() {
        return this._orientation;
    }

    get buttonSide() {
        return this._buttonSide;
    }

    get design() {
        return this._design;
    }

    /**
     * Retrieve tab item
     * @param id
     * @return {*}
     */
    getTab(id) {
        return this.tabs[id];
    }

    usesNamespacedTabs() {
        return this._namespacedTabs;
    }

    registerNamespace(namespace) {
        const normalized = this._normalizeNamespaceDefinition(namespace);
        const existing = this.namespaceDefinitions[normalized.id] || {};

        this.namespaceDefinitions[normalized.id] = {
            ...existing,
            ...normalized,
            order: normalized.order ?? existing.order ?? ((this.namespaceOrder.length + 1) * 10),
        };

        if (!this.namespaceOrder.includes(normalized.id)) {
            this.namespaceOrder.push(normalized.id);
        }

        this.namespaceOrder.sort((left, right) => {
            const leftOrder = this.namespaceDefinitions[left]?.order ?? 0;
            const rightOrder = this.namespaceDefinitions[right]?.order ?? 0;
            if (leftOrder === rightOrder) {
                return left.localeCompare(right);
            }
            return leftOrder - rightOrder;
        });

        return this.namespaceDefinitions[normalized.id];
    }

    getNamespaceDefinition(namespace) {
        const namespaceId = this._normalizeNamespaceId(namespace);
        return this.namespaceDefinitions[namespaceId];
    }

    getNamespaceOrder() {
        return [...this.namespaceOrder];
    }

    getTabsByNamespace(namespace) {
        const namespaceId = this._normalizeNamespaceId(namespace);
        return Object.values(this.tabs).filter(tab => tab?.namespace === namespaceId);
    }

    getNamespacesWithTabs() {
        return this.getNamespaceOrder()
            .map(namespaceId => ({
                ...(this.getNamespaceDefinition(namespaceId) || { id: namespaceId, title: this._namespaceTitle(namespaceId) }),
                tabs: this.getTabsByNamespace(namespaceId),
            }))
            .filter(namespace => namespace.tabs.length > 0);
    }

    _normalizeNamespaceId(namespace) {
        if (namespace && typeof namespace === "object") {
            namespace = namespace.id;
        }

        return `${namespace || this.defaultNamespace || Menu.NAMESPACE.SYSTEM}`;
    }

    _namespaceTitle(namespaceId) {
        return `${namespaceId}`
            .split(/[._-]/g)
            .filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
    }

    _normalizeNamespaceDefinition(namespace) {
        const id = this._normalizeNamespaceId(namespace);
        if (typeof namespace === "string" || namespace == null) {
            return { id, title: this._namespaceTitle(id) };
        }

        return {
            ...namespace,
            id,
            title: namespace.title || namespace.label || this._namespaceTitle(id),
        };
    }

    _applyNamespaceToTab(tab, item) {
        if (!tab) return tab;

        const shouldNamespace = this._namespacedTabs || item?.namespace;
        const namespaceId = this._normalizeNamespaceId(item?.namespace);

        if (shouldNamespace) {
            this.registerNamespace(item?.namespace || namespaceId);
        }

        tab.namespace = namespaceId;
        return tab;
    }

    /**
     *
     * @param {*} id id of the item we want to delete
     */
    deleteTab(id) {
        if (!(id in this.tabs)) { throw new Error("Tab with id " + id + " does not exist"); }
        this.tabs[id].removeTab();
        delete this.tabs[id];
        return this;
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

        this._applyNamespaceToTab(tab, item);
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
        requestAnimationFrame(() => this._syncLayout());
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
        this._applyNamespaceToTab(tab, item);

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
        requestAnimationFrame(() => this._syncLayout());
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

    _isSideOrientation() {
        return this._orientation === "LEFT" || this._orientation === "RIGHT";
    }

    _sideButtonsAreRotated() {
        return this._isSideOrientation() && this._design === "ICONONLY";
    }

    _getAvailableMenuWidth() {
        const root = document.getElementById(this.id);
        if (root) {
            const rect = root.getBoundingClientRect();
            if (rect?.width) return rect.width;
        }
        return window.innerWidth;
    }

    _shouldCollapseSideHeader() {
        if (!this._isSideOrientation() || this._sideButtonsAreRotated()) {
            return false;
        }

        const availableWidth = this._getAvailableMenuWidth();
        const headerDom = this.getHeaderDomNode();
        const buttons = Array.from(headerDom?.children || []);
        const widestButton = buttons.reduce((max, button) => {
            return Math.max(max, button.scrollWidth || button.getBoundingClientRect().width || 0);
        }, 0);

        // collapse when the actual menu width is narrow,
        // or when the header would consume too much space
        return (
            availableWidth <= this._sideHeaderCollapseWidth ||
            (widestButton > 0 && (widestButton * Math.min(buttons.length, 3)) > (availableWidth - 48))
        );
    }

    _applyHeaderContainerLayout({ collapsedToTop = false } = {}) {
        const headerDom = this.getHeaderDomNode();
        if (!headerDom) return;

        headerDom.style.alignItems = "";
        headerDom.style.justifyContent = "";
        headerDom.style.overflowX = "";
        headerDom.style.overflowY = "";
        headerDom.style.maxWidth = "";
        headerDom.style.width = "";
        headerDom.style.flexWrap = "";
        headerDom.style.gap = "";
        headerDom.style.padding = "";
        headerDom.style.minHeight = "";
        headerDom.style.scrollBehavior = "";

        if (collapsedToTop) {
            // compact row like the reference screenshot
            headerDom.style.width = "100%";
            headerDom.style.maxWidth = "100%";
            headerDom.style.overflowX = "auto";
            headerDom.style.overflowY = "hidden";
            headerDom.style.justifyContent = "flex-start";
            headerDom.style.alignItems = "center";
            headerDom.style.flexWrap = "nowrap";
            headerDom.style.gap = "0.375rem";
            headerDom.style.padding = "0.25rem 0";
            headerDom.style.minHeight = "2.75rem";
            headerDom.style.scrollBehavior = "smooth";
            return;
        }

        if (!this._isSideOrientation()) {
            headerDom.style.justifyContent = this._buttonSide === "RIGHT" ? "flex-end" : "flex-start";
            return;
        }

        if (this._sideButtonsAreRotated()) {
            headerDom.style.alignItems = "center";
            headerDom.style.justifyContent = "center";
            return;
        }

        const alignEnd = this._orientation === "RIGHT";
        headerDom.style.alignItems = alignEnd ? "flex-end" : "flex-start";
        headerDom.style.justifyContent = "flex-start";
    }

    _syncTabButtonLayout({ collapsedToTop = false } = {}) {
        const onSide = this._isSideOrientation() && !collapsedToTop;
        const rotated = onSide && this._sideButtonsAreRotated();
        const side = this._orientation;

        for (const tab of Object.values(this.tabs)) {
            if (!tab?.headerButton?.set) continue;

            if (collapsedToTop || !this._isSideOrientation()) {
                tab.headerButton.set(ui.Button.ORIENTATION.HORIZONTAL);
            } else if (rotated) {
                const orientation = side === "RIGHT"
                    ? ui.Button.ORIENTATION.VERTICAL_RIGHT
                    : ui.Button.ORIENTATION.VERTICAL_LEFT;
                tab.headerButton.set(orientation);
            } else {
                tab.headerButton.set(ui.Button.ORIENTATION.HORIZONTAL);
            }

            tab.headerButton.iconRotate();

            tab.headerButton.syncHeaderLayout?.({
                onSide,
                side,
                rotated,
                compact: onSide && !rotated,
                collapsedToTop,
            });
        }
    }

    _syncLayout() {
        const root = document.getElementById(this.id);
        if (!root) return;

        const collapsedToTop = this._shouldCollapseSideHeader();

        if (collapsedToTop) {
            this.setClass("flex", "flex-col");
            this.header.set(ui.Join.STYLE.HORIZONTAL);
        } else if (this._orientation === "TOP") {
            this.setClass("flex", "flex-col");
            this.header.set(ui.Join.STYLE.HORIZONTAL);
        } else if (this._orientation === "BOTTOM") {
            this.setClass("flex", "flex-col-reverse");
            this.header.set(ui.Join.STYLE.HORIZONTAL);
        } else if (this._orientation === "LEFT") {
            this.setClass("flex", "flex-row");
            this.header.set(ui.Join.STYLE.VERTICAL);
        } else if (this._orientation === "RIGHT") {
            this.setClass("flex", "flex-row-reverse");
            this.header.set(ui.Join.STYLE.VERTICAL);
        }

        const bodyDom = this.getBodyDomNode();
        if (bodyDom) {
            bodyDom.style.minWidth = "0";
            bodyDom.style.width = collapsedToTop ? "100%" : "";
            bodyDom.style.flex = collapsedToTop ? "1 1 auto" : "";
        }

        this._applyHeaderContainerLayout({ collapsedToTop });
        this._syncTabButtonLayout({ collapsedToTop });
    }

    onLayoutChange() {
        this._syncLayout();
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

Menu.NAMESPACE = {
    SYSTEM: "system",
    PLUGINS: "plugins",
};

Menu.DEFAULT_NAMESPACES = [
    { id: Menu.NAMESPACE.SYSTEM, title: "System", order: 10 },
    { id: Menu.NAMESPACE.PLUGINS, title: "Plugins", order: 20 },
];

Menu.ORIENTATION = {
    TOP: function () {
        this._orientation = "TOP";
        this._syncLayout();
    },
    BOTTOM: function () {
        this._orientation = "BOTTOM";
        this._syncLayout();
    },
    LEFT: function () {
        this._orientation = "LEFT";
        this._syncLayout();
    },
    RIGHT: function () {
        this._orientation = "RIGHT";
        this._syncLayout();
    }
}

Menu.BUTTONSIDE = {
    LEFT: function () {
        this._buttonSide = "LEFT";
        this.header.setClass("flex", "");
    },
    RIGHT: function () {
        this._buttonSide = "RIGHT";
        this.header.setClass("flex", "flex-end");
    },
};

Menu.DESIGN = {
    ICONONLY: function () {
        this._design = "ICONONLY";
        for (let t of Object.values(this.tabs)) { t.iconOnly(); }
        this._syncLayout();
    },
    TITLEONLY: function () {
        this._design = "TITLEONLY";
        for (let t of Object.values(this.tabs)) { t.titleOnly(); }
        this._syncLayout();
    },
    TITLEICON: function () {
        this._design = "TITLEICON";
        for (let t of Object.values(this.tabs)) { t.titleIcon(); }
        this._syncLayout();
    }
};

Menu.ROUNDED = {
    ENABLE: function () { ui.Join.ROUNDED.ENABLE.call(this.header); },
    DISABLE: function () { ui.Join.ROUNDED.DISABLE.call(this.header); },
};

Menu.SCROLL = {
    ENABLE: function () {
        this.body.setClass("overflow-x-auto", "");
        this.body.setClass("overflow-y-auto", "overflow-y-auto");
    },
    DISABLE: function () {
        this.body.setClass("overflow-x-auto", "");
        this.body.setClass("overflow-y-auto", "");
    },
};

export { Menu };
