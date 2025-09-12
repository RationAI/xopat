import van from "../../vanjs.mjs";
const { div } = van.tags;
import { BaseComponent } from "../baseComponent.mjs";

export class RawHtml extends BaseComponent {
    constructor(options, ...args) {
        super(options, ...args);
        this._html = this._children.join("");
    }
    setHtml(html) {
        this._html = html;
        const el = document.getElementById(this.id);
        if (el) el.innerHTML = html;
    }
    create() {
        const el = div({ ...this.commonProperties, ...this.extraProperties });
        el.innerHTML = this._html;  // same pattern your framework uses
        return el;
    }
}