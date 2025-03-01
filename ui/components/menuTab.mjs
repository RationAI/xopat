import { BaseComponent } from "./baseComponent.mjs";
import { default as ui } from "../index.mjs";

class MenuTab {
    constructor(item, parent) {
        this.parent = parent;

        const [headerButton, contentDiv] = this.createTab(item);

        this.headerButton = headerButton;
        this.contentDiv = contentDiv;
    }

    createTab(item) {
        const content = item["body"];
        const inText = item["title"];
        let inIcon = item["icon"];

        if (!(inIcon instanceof BaseComponent)) {
            inIcon = new ui.FAIcon({ name: inIcon });
        }

        const b = new ui.Button({
            id: "b-" + item.id,
            size: ui.Button.SIZE.SMALL,
            additionalProperties: { title: inText },
            extraClass: { item: "menu-item-horizontal" },
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
        }, inIcon, inText);

        const c = new ui.Div({ id: "c-" + item.id, display: "display-none" }, ...content);
        return [b, c];
    }

    removeTab() {
        document.getElementById(this.headerButton.id).remove();
        document.getElementById(this.contentDiv.id).remove();
    }
}
export { MenuTab };