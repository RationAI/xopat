import { BaseComponent } from "./baseComponent.mjs";
import { default as ui } from "../index.mjs";
import van from "../vanjs.mjs";

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

        this.icon;
        this.title = item["title"];
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
        this.icon.setClass("padding", "pl-2");

        const b = new ui.Button({
            id: "b-" + item.id,
            size: ui.Button.SIZE.SMALL,
            additionalProperties: { title: inText },
            extraClass: { item: "menu-item-horizontal", "padding-left": "pl-0" },
            onClick: () => {
                for (let div of document.getElementById(this.parent.hash + "body").childNodes) {
                    if (div.style.display !== "block" && div.id === "c-" + item.id) {
                        div.style.display = "block";
                    } else {
                        div.style.display = "none";
                    }
                }

                for (let i of Object.values(this.parent.tabs)) {
                    const button = i.headerButton;
                    if (button.classMap["type"] !== "btn-secondary" && button.id === "b-" + item.id) {
                        button.setClass("type", "btn-secondary");
                    } else {
                        button.setClass("type", "btn-primary");
                    }
                }
            }
        }, inIcon, span({ class: "pl-2"}, inText));  // todo span does not work for some reason

        const c = new ui.Div({ id: "c-" + item.id, display: "display-none", height: "h-full" }, ...content);
        return [b, c];
    }

    removeTab() {
        document.getElementById(this.headerButton.id).remove();
        document.getElementById(this.contentDiv.id).remove();
    }

    focus() {
        document.getElementById(this.headerButton.id).click();
    }

    titleOnly() {
        document.getElementById(this.headerButton.id).innerHTML = this.title;
    }

    titleIcon() {
        document.getElementById(this.headerButton.id).innerHTML = "";
        this.icon.attachTo(document.getElementById(this.headerButton.id));
        document.getElementById(this.headerButton.id).innerHTML += this.title;
    }

    iconOnly() {
        document.getElementById(this.headerButton.id).innerHTML = "";
        this.icon.attachTo(document.getElementById(this.headerButton.id));
    }
}
export { MenuTab };
