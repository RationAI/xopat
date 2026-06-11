import van from "../../vanjs.mjs";
import { MenuTab } from "./menuTab.mjs";
import { Join } from "../elements/join.mjs";
import { Div } from "../elements/div.mjs";
import { Button } from "../elements/buttons.mjs";
import { Menu } from "./menu.mjs";
import { MultiPanelMenuTab } from "./multiPanelMenuTab.mjs";
import {BaseComponent} from "../baseComponent.mjs";

const ui = { Join, Div, Button, MenuTab };
const { div } = van.tags

/**
 * @class MultiPanelMenu
 * @extends Menu
 * @description A menu component which allows to have multiple tabs open with different content
 * @example
 * const menu = new MultiPanelMenu({
 *                       id: "myMenu",
 *                      orientation: Menu.ORIENTATION.TOP
 *                      },
 *                      {id: "s1", icon: settingsIcon, title: "Content1", body: "Settings1"},
 *                      {id: "s2", icon: settingsIcon, title: "Content2", body: "Settings2"});
 * menu.attachTo(document.body);
**/

// TODO add side functionality to choose if the menu is on the left or right side
class MultiPanelMenu extends Menu {
    /**
     * @param {*} options
     * @param {string} [options.orderCacheKey] - AppCache key for persisting the user-chosen tab order;
     *   enables arrow-based tab reordering when set
     * @param {(ids: string[]) => void} [options.onOrderChange] - called after the order is persisted
     * @param  {...any} args - items to be added to the menu in format {id: string, icon: string or faIcon, title: string, body: string}
     */
    constructor(options = undefined, ...args) {
        super(options, ...args);
        this.classMap["base"] = "flex gap-1 h-full";
        this.classMap["flex"] = "flex-col";
        this._orderCacheKey = options?.orderCacheKey;
        this._onOrderChange = options?.onOrderChange;
    }

    create() {
        this.body.attachTo(this);
        const node = div(
            { ...this.commonProperties, ...this.extraProperties },
            ...this.children
        );
        if (this.supportsTabReorder) {
            requestAnimationFrame(() => this.applyTabOrder());
        }
        return node;
    }

    get supportsTabReorder() {
        return !!this._orderCacheKey;
    }

    _cachedTabOrder() {
        if (!this._orderCacheKey) return [];
        const order = APPLICATION_CONTEXT.AppCache.get(this._orderCacheKey, []);
        return Array.isArray(order) ? order : [];
    }

    _persistOrder() {
        if (!this._orderCacheKey) return;
        const body = this.getBodyDomNode();
        if (!body) return;
        const ids = Array.prototype.map.call(body.children, child => child.dataset.tabId).filter(Boolean);
        APPLICATION_CONTEXT.AppCache.set(this._orderCacheKey, ids);
        this._onOrderChange?.(ids);
    }

    /**
     * Reorder the tab panels in the DOM to match the cached order. Tabs without
     * a cached position keep their relative insertion order at the end, so
     * late-loading plugin tabs slot in without disturbing the rest.
     */
    applyTabOrder() {
        if (!this._orderCacheKey) return;
        const body = this.getBodyDomNode();
        if (!body) return;
        const order = this._cachedTabOrder();
        const rank = (node) => {
            const index = order.indexOf(node.dataset.tabId);
            return index < 0 ? Number.MAX_SAFE_INTEGER : index;
        };
        const children = Array.from(body.children);
        const sorted = [...children].sort((a, b) => rank(a) - rank(b));
        if (sorted.some((node, i) => node !== children[i])) {
            sorted.forEach(node => body.appendChild(node));
        }
    }

    /**
     * Move a tab panel one position up or down and persist the new order.
     * @param {string} id tab id
     * @param {"up"|"down"} direction
     */
    reorderTab(id, direction) {
        const body = this.getBodyDomNode();
        if (!body) return;
        const node = Array.prototype.find.call(body.children, child => child.dataset.tabId === id);
        if (!node) return;
        if (direction === "up") {
            if (node.previousElementSibling) body.insertBefore(node, node.previousElementSibling);
        } else {
            if (node.nextElementSibling) body.insertBefore(node.nextElementSibling, node);
        }
        this._persistOrder();
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
     * @param {UINamedItem} item dictionary with id, icon, title, body which will be added to the menu
     * @param {XOpatElementID} [componentId]
     * @return {MenuTab|Dropdown}
     */
    addTab(item, componentId=undefined) {
        if (!(item.id && item.icon && item.title)) {
            throw new Error("Item for menu needs every property set.");
        }
        let tab = new MultiPanelMenuTab(item, this);
        this.tabs[item.id] = tab;

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

        tab.contentDiv.attachTo(this.body);

        if (this.supportsTabReorder) {
            // slot late-added (plugin) tabs into their cached position
            requestAnimationFrame(() => this.applyTabOrder());
        }
        return tab;
    }

    /**
     * @param {*} id of the item we want to close
     */
    closeTab(id) {
        if (id in this.tabs && !(this.parentElement.classMap["mobile"] === "mobile")) {
            this.tabs[id].close();
            return true;
        }
        return false;
    }

    openTab(id) {
        if (id in this.tabs) {
            this.tabs[id].open();
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

const settingsIcon = new ui.PhIcon({name: "ph-gear"});

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
