import van from "../../../../../Desktop/Vis2/src/xopat/ui/vanjs.mjs";
const { div } = van.tags;
import { BaseComponent } from "../baseComponent.mjs";

export class RawHtml extends BaseComponent {
    constructor(options, html = "") {
        super(options);
        this._html = html;
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