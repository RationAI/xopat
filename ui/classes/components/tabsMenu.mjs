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

    /**
     * @param {Object} [options]
     * @param {boolean} [options.scrollableTabs=false] When true the tab strip is
     *   rendered as a uniform, non-wrapping, horizontally scrollable row: tabs get
     *   a fixed max width, labels truncate with an ellipsis, and the strip scrolls
     *   instead of wrapping onto multiple lines. Off by default so the classic
     *   wrap behavior is preserved for other consumers.
     * @param {string} [options.focusCacheKey] `APPLICATION_CONTEXT.AppCache` key
     *   remembering the tab the user last selected, so it is focused again on the
     *   next boot. Omit to keep the menu stateless across reloads.
     * @param {function} [options.focusFilter] `(tab) => boolean` gate for the
     *   restore — a remembered tab it rejects (e.g. one the user has hidden) is
     *   not focused. The "focus something" fallback and user clicks are unaffected.
     */
    constructor(options = undefined, ...args) {
        options = super(options, ...args).options;

        this.tabs = {};
        this._focused = undefined;
        this._design = options.design || Menu.DESIGN.TITLEICON;

        // NOTE: plain values, deliberately not routed through _applyOptions
        // (see the note at the end of this constructor).
        this._focusCacheKey = typeof options?.focusCacheKey === "string" ? options.focusCacheKey : null;
        this._focusFilter = typeof options?.focusFilter === "function" ? options.focusFilter : null;
        this._preferredFocusId = this._focusCacheKey
            ? (APPLICATION_CONTEXT.AppCache.get(this._focusCacheKey, "") || null) : null;
        // Tabs register asynchronously as plugins load, so the stored tab may
        // not exist yet. Stay hungry for it until it shows up — or until the
        // user picks something themselves.
        this._focusRestorePending = !!this._preferredFocusId;

        // Opt-in uniform/scrollable strip (see constructor docs). Styling lives in
        // `.xo-tab-strip` (src/assets/custom.css); the class is only attached here.
        this._scrollableTabs = options?.scrollableTabs === true;

        // TODO why is there join-horizontal???
        // pt/px but NO bottom padding: the active tab must reach the strip's
        // bottom edge to merge with the body surface below.
        const headerClasses = { tabs: "tabs", style: "bg-base-300 px-1 pt-1" };
        if (this._scrollableTabs) {
            headerClasses.tabs = "tabs xo-tab-strip";
            headerClasses.min = "min-w-0";
        }
        this.header = new Div({ id: this.id + "-header", extraClasses: headerClasses });
        this.body = new Div({ id: this.id + "-body", extraClasses: { flex: "flex-1", minHeight: "min-h-0", width: "w-full", margin: "m-0", "scroll": "overflow-y-auto" } });

        for (let i of this._children) {
            this.addTab(i);
        }
        this._children = [];
        this.classMap["base"] = "flex gap-1 bg-base-200 h-full";
        this.classMap["flex"] = "flex-col";

        if (options) {
            // NOTE: `scrollableTabs` is a plain boolean handled above (this._scrollableTabs),
            // not a functional option — passing it to _applyOptions would call true.call().
            this._applyOptions(options, "orientation", "buttonSide", "design", "rounded");
        }
    }

    create() {
        // With the config menu enabled the header (tab strip) shares its row with
        // a trailing "…" button: the strip takes most of the width (flex-1, still
        // scrollable) and yields to the small config control pinned on the right.
        if (this.configMenuEnabled) {
            this.header.setClass("flex1", "flex-1");
            this.header.setClass("min", "min-w-0");
            const row = div(
                { class: "flex items-stretch w-full bg-base-300" },
                this.header.create(),
                div({ class: "flex items-center px-1" }, this.getConfigMenu().create())
            );
            const node = div(
                { ...this.commonProperties, ...this.extraProperties },
                row,
                this.body.create()
            );
            requestAnimationFrame(() => this._bindStripWheel());
            return node;
        }

        this.header.attachTo(this);
        this.body.attachTo(this);
        const node = div(
            { ...this.commonProperties, ...this.extraProperties },
            ...this.children
        );
        requestAnimationFrame(() => this._bindStripWheel());
        return node;
    }

    /**
     * @private
     * The strip scrolls on the X axis only, and a mouse wheel emits deltaY — so
     * without this the strip is unreachable by wheel and the user is forced to
     * drag the scrollbar. Map the dominant wheel axis onto scrollLeft and only
     * swallow the event while the strip can actually move, so a wheel over a
     * fully-visible strip still scrolls whatever is underneath.
     */
    _bindStripWheel() {
        if (!this._scrollableTabs) return;
        const strip = this.getHeaderDomNode();
        // re-bind when create() produced a fresh node, never twice on the same one
        if (!strip || this._wheelBoundEl === strip) return;
        this._wheelBoundEl = strip;
        strip.addEventListener("wheel", (e) => {
            if (e.ctrlKey) return;   // browser zoom
            const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (!delta) return;
            const max = strip.scrollWidth - strip.clientWidth;
            if (max <= 0) return;
            const next = Math.max(0, Math.min(max, strip.scrollLeft + delta));
            if (next === strip.scrollLeft) return;
            strip.scrollLeft = next;
            e.preventDefault();
        }, { passive: false });
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

        // The filter gates the restore only: the fallback below must keep
        // focusing *something*, exactly as before, or a menu whose tabs all
        // report hidden would open with an empty body.
        const restorable = !this._focusFilter || this._focusFilter(tab);
        if (this._focusRestorePending && item.id === this._preferredFocusId && restorable) {
            // The remembered tab finally arrived: claim it, but do not rewrite
            // the cache — the user has not chosen anything this session.
            this.focus(item.id, false);
        } else if (!this._focused || wasFocused) {
            // While a restore is still pending this is only a placeholder, so
            // it must not overwrite the remembered choice.
            this.focus(item.id, !this._focusRestorePending);
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
        }, inIcon, span({ class: "xo-tab-label" }, inText));
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
     * @param {boolean} [persist=true] whether this focus is a user-level choice
     *   that should be remembered across reloads (requires `focusCacheKey`).
     *   Derived focus — boot replay, fallback after hiding a tab — must pass
     *   `false` so it cannot overwrite what the user picked.
     */
    focus(id, persist = true) {
        if (id in this.tabs) {
            this.unfocusAll();
            this.tabs[id].headerButton.setClass("tab-active", "tab-active");
            this.tabs[id].headerButton.setClass("state", TabsMenu.TAB_ACTIVE_CLASSES);
            if (this.tabs[id].contentDiv) {
                this.tabs[id].contentDiv.setClass("display", "");
            }
            this._focused = id;
            // With the strip scrollbar reduced to an unobtrusive overlay, an
            // off-screen tab would otherwise activate invisibly.
            if (this._scrollableTabs) {
                requestAnimationFrame(() => {
                    document.getElementById(`${this.id}-b-${id}`)
                        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
                });
            }
            if (persist && this._focusCacheKey) {
                APPLICATION_CONTEXT.AppCache.set(this._focusCacheKey, id);
                // An actual choice was made: a late-registering tab must not
                // steal the focus anymore.
                this._focusRestorePending = false;
                this._preferredFocusId = id;
            }
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
