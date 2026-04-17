import { BaseComponent } from "../baseComponent.mjs";
import van from "../../vanjs.mjs";
import { FAIcon } from "../elements/fa-icon.mjs";
import { Button } from "../elements/buttons.mjs";
import { Div } from "../elements/div.mjs";

import { VisibilityManager } from "../mixins/visibilityManager.mjs";

const { span } = van.tags

/**
 * todo extend base component?
 *
 * @class MenuTab
 * @description A internal tab component for the menu component
 * @example
 * const tab = new MenuTab({id: "s1", icon: settingsIcon, title: "Content1", body: "Settings1"}, menu);
 */
class MenuTab extends BaseComponent {
    /**
     * @param {UINamedItem} item dictionary with id, icon, title, body which will be created
     * @param {*} parent parent menu component
     */
    constructor(item, parent) {
        super(undefined);
        this.parent = parent;
        this.style = "ICONTITLE";
        this.styleOverride = item["styleOverride"] || false;
        this._focused = false;
        this.hidden = false;
        this.id = item.id;

        const [headerButton, contentDiv] = this._createTab(item);
        this.headerButton = headerButton;
        this.contentDiv = contentDiv;
        this.visibilityManager = new VisibilityManager(this).init(
            () => {
                if (this.hidden) {
                    if (this.headerButton) this.headerButton.setClass("display", "");
                    if (this.contentDiv) this.contentDiv.setClass("display", "");
                    this.hidden = false;
                }
            },
            () => {
                if (!this.hidden) {
                    if (this.headerButton) this.headerButton.setClass("display", "hidden");
                    if (this.contentDiv) this.contentDiv.setClass("display", "hidden");
                    this.hidden = true;
                }
            }
        );
    }

    /**
     * todo: private?
     * @param {UINamedItem} item dictionary with id, icon, title, body which will be created
     * @returns {*} Button and Div components from VanJS framework
     */
    _createTab(item) {
        const content = item["body"];
        const inText = item["title"];
        let inIcon = (item["icon"] instanceof BaseComponent) ? item["icon"] : new FAIcon({ name: item["icon"] });

        //todo dirty?
        this.iconName = inIcon.options.name;
        this.title = inText;

        let action = (item["onClick"]) ? item["onClick"] : () => {};

        const b = new Button({
            id: this.parent.id + "-b-" + item.id,
            size: Button.SIZE.SMALL,
            extraProperties: { title: inText },
            onClick: () => {
                action();
                this.focus();
            },
        }, inIcon, span(inText));

        let c = undefined;
        if (content) {
            const options = {
                id: this.parent.id + "-c-" + item.id,
                extraClasses: { display: "display-none", height: "h-full" }
            };

            if (typeof content !== "string" && typeof content?.[Symbol.iterator] === "function") {
                c = new Div(options, ...content);
            } else {
                c = new Div(options, content);
            }
        }
        return [b, c];
    }

    // todo do not force each component having ID
    setTitle(title) {
        if (this.headerButton) {
            let header = document.getElementById(this.headerButton.id);
            if (header) {
                header.children[1].title = title;
                header.children[1].innerHTML = title;
            }
        }
    }

    removeTab() {
        if (this.headerButton) {
            document.getElementById(this.headerButton.id).remove();
        }
        if (this.contentDiv){
            document.getElementById(this.contentDiv.id).remove();
        }
    }

    // todo implement focus as API of the FlagManagerLike
    focus() {
        for (let tab of Object.values(this.parent.tabs)) {
            if (tab.headerButton && tab.headerButton.id != this.headerButton?.id) {
                tab._removeFocus();
                APPLICATION_CONTEXT.AppCache.set(`${tab.id}-open`, false);
            }
        }

        if (this._focused) {
            APPLICATION_CONTEXT.AppCache.set(`${this.id}-open`, false);
            this._removeFocus();
        } else {
            APPLICATION_CONTEXT.AppCache.set(`${this.id}-open`, true);
            this._setFocus();
        }
    }

    unfocus(){
        APPLICATION_CONTEXT.AppCache.set(`${this.id}-open`, false);
        this._removeFocus();
    }

    _setFocus() {
        this._focused = true;
        this.headerButton?.setClass("type", "btn-secondary");
        if (this.contentDiv){
            this.contentDiv.setClass("display", "");
        };
    }

    _removeFocus() {
        this._focused = false;
        this.headerButton?.setClass("type", "");
        if (this.contentDiv){
            this.contentDiv.setClass("display", "hidden");
        }
    }

    close() {
        this._removeFocus();
    }

    open() {
        this._setFocus();
    }

    /**
     * @description make possible to keep its visual settings -> it keeps only Icon even if the whole menu is set to show Icon and Title
     * @param {boolean} styleOverride - if true, it will keep its visual settings
     */
    setStyleOverride(styleOverride) {
        this.styleOverride = styleOverride;
    }

    // TODO make work even withouth inicialization
    titleOnly() {
        if (this.styleOverride) {
            return;
        }
        this.style = "TITLE";
        const nodes = this.headerButton?.children;
        if (!nodes?.length) return;
        nodes[0]?.classList.add("hidden");
        nodes[1]?.classList.remove("hidden");
    }

    titleIcon() {
        if (this.styleOverride) {
            return;
        }
        this.style = "ICONTITLE";
        const nodes = this.headerButton?.children;
        if (!nodes?.length) return;
        nodes[0]?.classList.remove("hidden");
        nodes[1]?.classList.remove("hidden");
    }

    iconOnly() {
        if (this.styleOverride) {
            return;
        }
        this.style = "ICON";
        const nodes = this.headerButton?.children;
        if (!nodes?.length) return;
        nodes[0]?.classList.remove("hidden");
        nodes[1]?.classList.add("hidden");
    }

    syncHeaderLayout({ onSide = false, side = "LEFT", rotated = false, compact = false, collapsedToTop = false } = {}) {
        const header = document.getElementById(this.headerButton?.id);
        if (!header) return;

        const [iconNode, titleNode] = header.children;
        const collapsed = collapsedToTop === true;
        const alignRight = side === "RIGHT" && onSide && !rotated && !collapsed;
        const justify = collapsed
            ? "flex-start"
            : (rotated ? "center" : (alignRight ? "flex-end" : "flex-start"));
        const textAlign = alignRight ? "right" : "left";

        header.style.display = "inline-flex";
        header.style.alignItems = "center";
        header.style.justifyContent = justify;
        header.style.textAlign = textAlign;
        header.style.whiteSpace = (onSide || collapsed) ? "nowrap" : "";

        // important: compact top-strip buttons must NOT keep side full-width behavior
        header.style.width = collapsed ? "auto" : (onSide && !rotated ? "100%" : "");
        header.style.maxWidth = collapsed ? "max-content" : "";
        header.style.minWidth = collapsed ? "fit-content" : "";
        header.style.flex = collapsed ? "0 0 auto" : "";
        header.style.alignSelf = collapsed
            ? "auto"
            : (onSide && !rotated ? (alignRight ? "flex-end" : "flex-start") : "");

        // smaller padding for side-not-rotated and for collapsed compact top strip
        header.style.paddingInline = (compact || collapsed) ? "0.625rem" : "";
        header.style.paddingBlock = (compact || collapsed) ? "0.375rem" : "";

        if (titleNode) {
            titleNode.style.textAlign = textAlign;
            titleNode.style.whiteSpace = "nowrap";
            titleNode.style.flex = collapsed
                ? "0 0 auto"
                : (onSide && !rotated ? "1 1 auto" : "");
            titleNode.style.maxWidth = collapsed
                ? "none"
                : (onSide && !rotated ? "100%" : "");
            titleNode.style.overflow = collapsed ? "visible" : "";
            titleNode.style.textOverflow = collapsed ? "clip" : "";
        }

        if (iconNode) {
            iconNode.style.flexShrink = "0";
        }
    }

    iconRotate() {
        const nodes = this.headerButton?.children;
        if (!nodes?.length) return;

        nodes[0]?.classList.remove("rotate-90");
        nodes[0]?.classList.remove("-rotate-90");

        if (!(this.style === "ICON")) {
            return;
        }

        if (this.parent.orientation === "RIGHT") {
            nodes[0]?.classList.add("rotate-90");
        } else if (this.parent.orientation === "LEFT") {
            nodes[0]?.classList.add("-rotate-90");
        }
    }
}
export { MenuTab };
