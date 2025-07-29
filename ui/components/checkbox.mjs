import van from "../vanjs.mjs";
import { BaseComponent } from "./baseComponent.mjs";

const { label, input, span } = van.tags

class Checkbox extends BaseComponent {

    constructor(options, ...args) {
        super(options, ...args);
        this.label = options["label"] || "";
        this.checked = options["checked"] || false;
        this.onchangeFunction = options["onchange"] || (() => {});
    }



    create(){
        return  label({id: this.id, class: "cursor-pointer boxed", style:"display: flex; align-items: center; gap: 8px;", onmousedown: function (e) {e.stopPropagation(); e.preventDefault();}},
                input({ type: "checkbox", class: "checkbox", checked: this.checked ? "checked" : "", onchange: this.onchangeFunction }),
                span({class: ""}, this.label),
            );
    }
}

export { Checkbox };