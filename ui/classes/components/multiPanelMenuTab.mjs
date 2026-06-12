import { BaseComponent } from "../baseComponent.mjs";
import van from "../../vanjs.mjs";

import { PhIcon, iconComponentFor } from "../elements/ph-icon.mjs";
import { Button } from "../elements/buttons.mjs";
import { Div } from "../elements/div.mjs";
import { MenuTab } from "./menuTab.mjs";

const { span, div } = van.tags

/**
 * @class MultiPanelMenuTab
 * @description A internal tab component for the multiPanelMenu component
 * @extends MenuTab
 * @example
 * this.menu = new UI.MultiPanelMenu({
 * id: "myMenu",
 * },
 * {id: "s2", icon: settingsIcon, title: "Content2", body: "Settings2"}, -> these will create MultiPanelMenuTab in multiPanelMenu
 * {id: "s3", icon: settingsIcon, title: "Content3", body: "Settings3"},)
 */
class MultiPanelMenuTab extends MenuTab {

    /**
     * @param {*} item dictionary with id, icon, title, body which will be created
     * @param {*} parent parent menu component
     **/
    constructor(item, parent) {
        if (!parent._pinnedTabs) {
            parent._pinnedTabs = {};
        }
        super(item, parent);
        this.openButton;
        this.openDiv;
        this.pin;
        this.closeButton;
        this.mainDiv;
        this.id = item.id;
        this.maxMobileWidth = APPLICATION_CONTEXT.getOption("maxMobileWidthPx");
    }

    _createTab(item) {
        const content = item["body"];
        const inText = item["title"];
        let inIcon = (item["icon"] instanceof BaseComponent) ? item["icon"] : iconComponentFor(item["icon"]);
        //todo dirty?
        this.iconName = inIcon.options.name;
        this.title = inText;

        // Store visual properties for the wrapper
        this._bgClass = item.background || "bg-base-200";
        this._radiusClass = "rounded-tl-md rounded-bl-md";

        const pinIcon = new PhIcon({id: this.parent.id + "-b-icon-pin-"+ item.id, name: "ph-push-pin" });
        this.pin = new Button({
            id: this.parent.id + "-b-pin-" + item.id,
            type: Button.TYPE.NONE,
            size: Button.SIZE.TINY,
            orientation: Button.ORIENTATION.HORIZONTAL,
            extraProperties: { title: $.t('main.bar.pinFullscreen') },
            onClick: (event) => {
                if (window.innerWidth < this.maxMobileWidth) {
                    return;
                }
                this.togglePinned();
                if (pinIcon.classMap["name"] === "ph-push-pin") {
                    pinIcon.changeIcon("ph-push-pin-slash");
                } else {
                    pinIcon.changeIcon("ph-push-pin");
                }

                if (USER_INTERFACE.AppBar.isFullScreen()) {
                    this.hide();
                }

                event.stopPropagation();
            }
        }, pinIcon);

        const crossIcon = new PhIcon({id: this.parent.id + "-b-icon-close-"+ item.id, name: "ph-x" });
        this.closeButton = new Button({
            id: this.parent.id + "-b-close" + item.id,
            type: Button.TYPE.NONE,
            size: Button.SIZE.TINY,
            orientation: Button.ORIENTATION.HORIZONTAL,
            extraProperties: { title: $.t('main.bar.close') },
            onClick: (event) => {
                if (window.innerWidth < this.maxMobileWidth) {
                    return;
                }
                this.visibilityManager.toggle();
                APPLICATION_CONTEXT.AppCache.set(`${this.id}-hidden`, this.hidden);
                event.stopPropagation();
            }
        }, crossIcon)

        if (this.parent.supportsTabReorder) {
            const reorderButton = (direction, icon, titleKey) => new Button({
                id: this.parent.id + "-b-move-" + direction + "-" + item.id,
                type: Button.TYPE.NONE,
                size: Button.SIZE.TINY,
                orientation: Button.ORIENTATION.HORIZONTAL,
                extraProperties: { title: $.t(titleKey) },
                onClick: (event) => {
                    event.stopPropagation();
                    if (window.innerWidth < this.maxMobileWidth) {
                        return;
                    }
                    this.parent.reorderTab(this.id, direction);
                }
            }, new PhIcon({ name: icon }));
            this.moveUpButton = reorderButton("up", "ph-caret-up", "main.bar.moveUp");
            this.moveDownButton = reorderButton("down", "ph-caret-down", "main.bar.moveDown");
        }

        // Clickable header (icon + title). The sideways writing-mode comes from
        // VERTICAL_RIGHT; it lives in the middle flex region so it can never be
        // overlapped by the control buttons regardless of panel height.
        this.openButton = new Button({
            id: this.parent.id + "-b-opened-" + item.id,
            size: Button.SIZE.TINY,
            orientation: Button.ORIENTATION.VERTICAL_RIGHT,
            extraClasses: { strip: "menu-strip-header" },
            extraProperties: {
                title: inText,
                style: "margin-left: auto; padding-top: 20px; padding-bottom: 20px; pointer-events: auto;",
            },
            onClick: () => {
                if (window.innerWidth < this.maxMobileWidth) {
                    return;
                }
                this.focus();
            },
        }, inIcon, span(inText));

        // Hover flyout: pin + reorder arrows form a second column beside the
        // always-visible close button. It is absolutely positioned, so
        // revealing it on hover never reflows the strip (no layout jump), and
        // it is a descendant of the hover host so moving the cursor from the
        // strip onto it keeps it open.
        const flyoutChildren = [this.pin];
        if (this.moveUpButton) {
            flyoutChildren.push(this.moveUpButton, this.moveDownButton);
        }
        const flyout = new Div(
            { extraClasses: { reveal: "menu-strip-hover-item", base: "menu-strip-flyout flex flex-col items-center" } },
            ...flyoutChildren
        );

        // The strip is a plain div (not a button) so the control buttons are
        // siblings of the header button rather than invalid nested <button>s,
        // and it is the hover host that reveals the flyout. The close button
        // stays visible at the top; the header fills the middle.
        this.strip = new Div(
            {
                id: this.parent.id + "-strip-" + item.id,
                extraClasses: { reveal: "menu-strip-hover-host", base: "menu-strip flex flex-col items-center" },
            },
            this.closeButton, this.openButton, flyout
        );

        // Define content div options without background/radius (now moved to mainDiv)
        const openDivOptions = {
            id: this.parent.id + "-opendiv-" + item.id,
            // Removed background and radius from here to apply to wrapper
            extraClasses: {display: "display-none", flex: "flex flex-row flex-1 min-w-0"},
            extraProperties: {style: "margin-top: 5px; margin-bottom: 5px;"},
        };

        // Content fills the panel width minus the vertical tab strip;
        // height is capped so overly long panels scroll internally.
        const contentStyle = "flex: 1 1 auto; min-width: 0; max-height: 80vh; overflow-y: auto; overflow-x: hidden;";
        if (typeof content !== 'string' && typeof content?.[Symbol.iterator] === 'function') {
            this.openDiv = new Div(openDivOptions, new Div({ extraProperties: {style: contentStyle} }, ...content));
        } else {
            this.openDiv = new Div(openDivOptions, new Div({ extraProperties: {style: contentStyle} }, content));
        }

        this.fullId = this.parent.id + "-c-" + item.id;
        this.mainDiv = new Div({
            id: this.fullId,
            extraClasses: {display: "", flex: "flex flex-row", position: "relative"},
            extraProperties: { style: "margin-top: 5px; margin-bottom: 5px;", "data-tab-id": item.id }
        }, this.openDiv, this.strip);

        if (APPLICATION_CONTEXT.AppCache.get(`${this.id}-pinned`, false)){
            this.parent._pinnedTabs[this.id] = true;
            pinIcon.changeIcon("ph-push-pin-slash");
        }
        return [undefined, this.mainDiv];
    }

    setTitle(title) {
        if (this.headerButton) {
            if (this.openButton) {
                this.openButton.children[1].title = title;
                this.openButton.children[1].innerHTML = title;
            }
        }
    }

    removeTab() {
        // mainDiv is the true root (wraps content + strip); removing it detaches
        // the whole subtree, so the individual child removals are unnecessary.
        this.mainDiv.remove();
    }

    focus() {
        if (this._focused) {
            APPLICATION_CONTEXT.AppCache.set(`${this.id}-open`, false);
            this._removeFocus();
        } else {
            APPLICATION_CONTEXT.AppCache.set(`${this.id}-open`, true);
            this._setFocus();
        }
    }

    _setFocus() {
        this._focused = true;
        this.openDiv.setClass("display", "");
        this.mainDiv.setClass("pointer-events", "pointer-events-auto");

        // Apply background and radius to the wrapper to encompass both button and content
        this.mainDiv.setClass("background", this._bgClass);
        this.mainDiv.setClass("radius", this._radiusClass);
    }

    _removeFocus() {
        this._focused = false;

        this.openDiv.setClass("display", "hidden");
        this.mainDiv.setClass("pointer-events", "pointer-events-none");

        // Remove background and radius from wrapper
        this.mainDiv.setClass("background", "");
        this.mainDiv.setClass("radius", "");
    }

    close() {
        this._removeFocus();
    }

    setStyleOverride(styleOverride) {
        this.styleOverride = styleOverride;
    }

    // TODO make work even withouth inicialization
    titleOnly() {
        if (this.styleOverride) {
            return;
        }
        this.style = "TITLE";
        this.openButton.titleOnly();
    }

    titleIcon() {
        if (this.styleOverride) {
            return;
        }
        this.style = "ICONTITLE";
        this.openButton.titleIcon();
    }

    iconOnly() {
        if (this.styleOverride) {
            return;
        }
        this.style = "ICON";
        this.openButton.iconOnly();
    }

    iconRotate(){
        this.openButton.iconRotate();
    }

    togglePinned(){
        if (this.parent._pinnedTabs[this.id]){
            APPLICATION_CONTEXT.AppCache.set(`${this.id}-pinned`, false);
            this.parent._pinnedTabs[this.id] = false;
        } else{
            APPLICATION_CONTEXT.AppCache.set(`${this.id}-pinned`, true);
            this.parent._pinnedTabs[this.id] = true;
        }
    }

    hide(){
        this.mainDiv.setClass("display", "hidden");
    }
}

export { MultiPanelMenuTab };