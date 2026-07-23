import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { Div } from "../elements/div.mjs";
import { iconComponentFor } from "../elements/ph-icon.mjs";
import { Button } from "../elements/buttons.mjs";
import { Menu } from "./menu.mjs";

const { div, span } = van.tags

class TabsMenu extends Menu {

    // Browser-tab "join" design: the ACTIVE tab shares the background of the
    // panel below it (base-200 — the menu container tone the body shows
    // through to), so it visually connects to the opened content. The strip
    // itself sits on a distinct base-300 tone, and unselected tabs render as
    // dimmed transparents on it (dimming covers icon, title and the injected
    // close button alike). No bottom border and no `tabs-boxed` — a border
    // would sever the join, and tabs-boxed forces a detached primary-colored
    // active pill.
    static TAB_INACTIVE_CLASSES = "bg-transparent opacity-60 hover:opacity-100";
    static TAB_ACTIVE_CLASSES = "bg-base-200 font-medium";

    constructor(options = undefined, ...args) {
        options = super(options, ...args).options;

        this.tabs = {};
        this._focused = undefined;
        this._design = options.design || Menu.DESIGN.TITLEICON;

        // TODO why is there join-horizontal???
        // pt/px but NO bottom padding: the active tab must reach the strip's
        // bottom edge to merge with the body surface below.
        this.header = new Div({ id: this.id + "-header", extraClasses: {
            tabs: "tabs", style: "bg-base-300 px-1 pt-1"
        }});
        this.body = new Div({ id: this.id + "-body", extraClasses: { flex: "flex-1", minHeight: "min-h-0", width: "w-full", margin: "m-0", "scroll": "overflow-y-auto" } });

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

        // Same-id replacement: MainLayout re-adds dock tabs (registration
        // re-entry, float→dock switches) after dropping the map entry. The
        // previous header button must leave the DOM — once it is no longer
        // in `this.tabs`, unfocusAll() can never reach it, so a leftover
        // button keeps its `tab-active` styling forever and renders as a
        // duplicate, permanently-"selected" tab.
        const wasFocused = this._focused === item.id;
        this.remove(item.id);

        const tab = this._createTab(item);
        this.tabs[item.id] = tab;

        tab.headerButton.attachTo(this.header);
        if (tab.contentDiv) {
            tab.contentDiv.attachTo(this.body);
        }

        if (!this._focused || wasFocused) {
            this.focus(item.id);
        }
    }

    /**
     * Remove a tab: detach its header button and content from the DOM and
     * forget it. MainLayout relies on this (`menu.remove?.(id)`) when
     * re-adding or detaching dockable tabs; previously the method did not
     * exist, so stale header buttons accumulated in the strip.
     * @param {string} id tab id
     * @returns {boolean} true when a tracked tab entry was removed
     */
    remove(id) {
        const tab = this.tabs[id];
        delete this.tabs[id];

        // Callers may have dropped the map entry before calling (or stale
        // duplicates may have piled up) — clean by DOM id, not just via the
        // tracked component.
        const headerId = `${this.id}-b-${id}`;
        const contentId = `${this.id}-c-${id}`;
        let el;
        while ((el = document.getElementById(headerId))) el.remove();
        while ((el = document.getElementById(contentId))) el.remove();

        // Also drop not-yet-mounted components queued on the header/body.
        const dropQueued = (host, componentId) => {
            if (Array.isArray(host?._children)) {
                host._children = host._children.filter(c => c?.id !== componentId);
            }
        };
        dropQueued(this.header, headerId);
        dropQueued(this.body, contentId);

        if (this._focused === id) this._focused = undefined;
        return !!tab;
    }

    /**
     * @param {*} item dictionary with id, icon, title, body which will be created
     * @returns {*} Button and Div components from VanJS framework
     */
    _createTab(item) {
        const content = item["body"];
        const inText = item["title"];
        let inIcon = (item["icon"] instanceof BaseComponent) ? item["icon"] : iconComponentFor(item["icon"]);

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
        b.setClass("state", TabsMenu.TAB_INACTIVE_CLASSES);

        let c = undefined;
        if (content){
            c = new Div({ id: this.id + "-c-" + item.id, extraClasses: {display: "display-none", height: "h-full"} }, ...content);
        };
        return {
            id: item.id,
            title: item.title,
            icon: item.icon,
            iconName: typeof item.icon === "string" ? item.icon : item.iconName,
            visibilityManager: item.visibilityManager,
            __dockableWindow: item.__dockableWindow,
            headerButton: b,
            contentDiv: c
        };
    }

    /**
     * @param {*} id of the item we want to focus
     */
    focus(id) {
        if (id in this.tabs) {
            this.unfocusAll();
            this.tabs[id].headerButton.setClass("tab-active", "tab-active");
            this.tabs[id].headerButton.setClass("state", TabsMenu.TAB_ACTIVE_CLASSES);
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
            tab.headerButton.setClass("state", TabsMenu.TAB_INACTIVE_CLASSES);
            if (tab.contentDiv) {
                tab.contentDiv.setClass("display", "display-none");
            }
        }
        this._focused = undefined;
    }

}

export { TabsMenu }
