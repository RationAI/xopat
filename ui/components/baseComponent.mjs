import van from "../vanjs.mjs";

class BaseComponent {

    constructor(options, ...args) {

        this.classMap = {};
        this._children = args;
        this.options = options;
        this.classState = van.state("");

        if (options) {
            if (options.id) this.id = options.id;
        }
    }

    attachTo(element) {
        van.add(element,
            this.create());
    }

    refreshState() {
        this.classState.val = Object.values(this.classMap).join(" ");
    }

    set(...properties) {
        console.log(properties);
        for (let property of properties) {
            property.call(this);
        }
    }

    get children() {
        return (this._children || []).map(child => {
            if (child instanceof BaseComponent) {
                child.refreshState();
                return child.create();
            }
            return child;
        });
    }

    setClass(key, value) {
        this.classMap[key] = value;
        this.classState.val = Object.values(this.classMap).join(" ");
    }

    create() {
        throw new Error("Component must override create method");
    }
}

export { BaseComponent };