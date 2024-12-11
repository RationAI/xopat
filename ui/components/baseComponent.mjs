import van from "../vanjs.mjs";

/**
 * @class BaseComponent
 * @description The base class for all components
 */
class BaseComponent {

    /**
     * 
     * @param {*} options - other options are defined in the constructor of the derived class
     * @param  {...any} args 
     * @param {string} [options.id] - The id of the component
     */
    constructor(options, ...args) {

        this.classMap = {};
        this._children = args;
        this.options = options;
        this.classState = van.state("");

        if (options) {
            if (options.id) this.id = options.id;
        }
    }

    /**
     * 
     * @param {*} element - The element to attach the component to
     */
    attachTo(element) {
        this.refreshState();
        van.add(element,
            this.create());
    }

    /**
     * Refresh the state of the component, e.g. class names
     */
    refreshState() {
        this.classState.val = Object.values(this.classMap).join(" ");
    }

    /**
     * 
     * @param  {...any} properties - functions to set the state of the component
     */
    set(...properties) {
        for (let property of properties) {
            property.call(this);
        }
    }

    /**
     * getter for children which will automatically refresh them and create them if they are BaseComponent
     */
    get children() {
        return (this._children || []).map(child => {
            if (child instanceof BaseComponent) {
                child.refreshState();
                return child.create();
            }
            return child;
        });
    }

    /**
     * getter for commonProperties which are shared against all components
     */
    get commonProperties() {
        return {
            id: this.id,
            class: this.classState
        };
    }

    /**
     * 
     * @param {string} key - The key of the class
     * @param {string} value - The value of the class
     * @description Set the class of the component
     * @example
     * button.setClass("size", "btn-lg");
     */
    setClass(key, value) {
        this.classMap[key] = value;
        this.classState.val = Object.values(this.classMap).join(" ");
    }

    /**
     * @description Create the component
     * it needs to be overridden by the derived class
     */
    create() {
        throw new Error("Component must override create method");
    }
}

export { BaseComponent };