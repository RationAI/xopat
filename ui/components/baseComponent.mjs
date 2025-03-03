import van from "../vanjs.mjs";

const HtmlRenderer = (htmlString) => {
    const container = van.tags.div(); // Create a container div
    container.innerHTML = htmlString; // Set innerHTML to render safely
    return container;
};

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
        const extraClasses = options["extraClass"];
        this.classMap = typeof extraClasses === "object" ? extraClasses : {};
        this.additionalProperties = options["additionalProperties"] || {};
        this._children = args;
        this._renderedChildren = null;
        this._initializing = true;
        this.classState = van.state("");

        if (options) {
            if (options.id) {
                this.id = options.id;
                delete options.id;
            }
            this.options = options;
        } else {
            this.options = {};
        }
    }

    /**
     *
     * @param {*} element - The element to attach the component to
     */
    attachTo(element) {
        this._initializing = false;
        this.refreshState();
        if (element instanceof BaseComponent) {
            element.addChildren(this);
        } else {
            van.add(element,
                this.create());
        }
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
     *
     * @param  {...any} children - children to add to the component
     */
    addChildren(...children) {
        this._children.push(...children);
    }

    /**
     * getter for children which will automatically refresh them and create them if they are BaseComponent
     */
    get children() {
        if (this._renderedChildren) return this._renderedChildren;
        this._renderedChildren = (this._children || []).map(child => {
            if (child instanceof BaseComponent) {
                child.refreshState();
                return child.create();
            }
            if (child instanceof Element) {
                return child;
            }
            if (typeof child === "string") {
                return child.trimStart().startsWith("<") ? HtmlRenderer(child) : child;
            }
            console.warn(`Invalid child component provided - ${typeof child}:`, child);
            return undefined;
        }).filter(Boolean);
        return this._renderedChildren;
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
        if (!this._initializing) {
            this.classState.val = Object.values(this.classMap).join(" ");
        }
    }

    /**
     * @description Create the component
     * it needs to be overridden by the derived class
     */
    create() {
        throw new Error("Component must override create method");
    }

    /**
     * If you document a component properties like this:
     * Component.PROPERTY = {
     *     X: function () { ... do something ... },
     *     Y: function () { ... do something ... },
     * };
     * You can use this function that will iterate options object
     * and for each component, calls the initialization where necessary.
     *
     * Usage (in constructor): this._applyOptions(options, "X", "Y");
     *
     * @param options
     * @param {string} names keys to the options object, values of the keys
     * should be functions
     */
    _applyOptions(options, ...names) {
        const wasInitializing = this._initializing;
        this._initializing = true;
        for (let prop of names) {
            const option = options[prop];
            try {
                if (option) option.call(this);
            } catch (e) {
                console.warn("Probably incorrect component usage! Option values should be component-defined functional properties!", e);
            }
        }
        this._initializing = wasInitializing;
        if (wasInitializing) {
            this.refreshState();
        }

    }
}

export { BaseComponent };
