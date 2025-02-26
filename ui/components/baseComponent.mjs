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

        this.classMap = {};
        this._children = args;
        this._renderedChildren = null;
        this._initializing = false;
        this.options = options;
        this.classState = van.state("");
        this.hash = Math.random().toString(36).substring(7) + "-";

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
            if (typeof child === "string") {
                return child.trimStart().startsWith("<") ? HtmlRenderer(child) : child;
            }
            console.warn("Invalid child component provided: ", child);
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
        this._initializing = true;
        for (let prop of names) {
            const option = options[prop];
            try {
                if (option) option.call(this);
            } catch (e) {
                console.warn("Probably incorrect component usage! Option values should be component-defined functional properties!", e);
            }
        }
        this._initializing = false;
    }

    /**
     * @param {string} component - The name of the component
     * @description Generate the code for the component
     */
    generateCode(component) {
        return (
            `import { default as ui } from "/ui/index.mjs";\n
var b = new ui.${component}({\n${_generateCodeOptions(this)}},\n ${_generateCodeChildren(this)})\n
b.attachTo(document.getElementById("workspace"));`);
    }
}

/**
 * 
 * @returns {string} - The generated code
 */
function _generateCodeOptions(component) {
    var result = "";
    var entries = Object.assign({}, component.classMap, component.options);
    for (const [key, value] of Object.entries(entries)) {
        if (value instanceof Function) {
            result += `${key}: ${value},\n`;
        } else {
            result += `${key}: "${value}",\n`;
        }
    }
    return result;
}

/**
 * 
 * @returns {string} - The generated code
 */
function _generateCodeChildren(component) {
    var result = "";
    for (var ch of component._children) {
        if (ch === component._children[component._children.length - 1]) {
            result += `"${ch.id}"`;
        } else {
            result += `"${ch.id}",\n`;
        }
    }

    return result
}

export { BaseComponent };
