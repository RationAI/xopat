import van from "../vanjs.mjs";
const { span } = van.tags;

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
     * Generic Component constructor. If options are not provided (undefined or a child node is issued), children are
     * handled by the base component. Inheriting component should use:
     *  constructor(options, ...children) {
     *      super(options, ...children);
     *      options = this.options; //parsed, ensured to exist
     *      children = this._children; // includes first arg if options not provided
     *  }
     *
     * OK is also:
     *   constructor(someArg1, someARg2) {
     *       super();  // must not sent arguments
     *       // custom arg system for a specific component, does not follow the generic arg system
     *   }
     * @param {string|BaseComponent|Node|*} [options=undefined] - other options are defined in the constructor of the derived class,
     *  or a child node (first of children).
     * @param  {Array<string|BaseComponent|Node>} children - children.
     * @param {string} [options.id] - The id of the component
     */
    constructor(options, ...children) {

        if (typeof options === "string" || options instanceof Node || options instanceof BaseComponent) {
            children.unshift(options);
            options = undefined;
        }

        this.propertiesStateMap = {};
        this._children = children;
        this._renderedChildren = null;
        this.classState = van.state("");

        if (options) {
            const extraClasses = options["extraClasses"];
            this.classMap = typeof extraClasses === "object" ? extraClasses : {};
            const extraProperties = options["extraProperties"];
            this.propertiesMap = typeof extraProperties === "object" ? extraProperties : {};
            if (extraProperties){
                for (let key in this.propertiesMap) {
                    this.propertiesStateMap[key] = van.state(this.propertiesMap[key]);
                }
            }
            if (options.id) {
                this.id = options.id;
                delete options.id;
            }
            else {
                this.id = Math.random().toString(36).substring(2, 15);
            }
            this.options = options;
        } else {
            this.propertiesMap = {};
            this.classMap = {};
            this.options = {};
        }
    }

    /**
     *
     * @param {*} element - The element to attach the component to
     */
    attachTo(element) {
        this.refreshClassState();
        this.refreshPropertiesState();

        if (element instanceof BaseComponent) {
            const mount = document.getElementById(element.id);
            if (document.getElementById(element.id) === null) {
                element._children.push(this);
            } else {
                mount.append(this.create());
            }
        } else {
            const mount = typeof element === "string"
                ? document.getElementById(element)
                : element;

            if (!mount) {
                console.error(`Element ${element} not found`);
                van.add(element, this.create());
            } else {
                mount.append(this.create());
            }
        }
    }

    /**
     *
     * @param {*} element - The element to prepend the component to
     */
    prependedTo(element) {
        this.refreshClassState();
        this.refreshPropertiesState();

        if (element instanceof BaseComponent) {
            const mount = document.getElementById(element.id);
            if (document.getElementById(element.id) === null) {
                element._children.unshift(this);
            } else {
                mount.prepend(this.create());
            }
        } else {
            const mount = typeof element === "string"
                ? document.getElementById(element)
                : element;

            if (!mount) {
                console.error(`Element ${element} not found`);
                van.add(element, this.create());
            } else {
                mount.prepend(this.create());
            }
        }

    }

    /**
     * @description Refresh the state of the component, e.g. class names
     */
    refreshClassState() {
        this.classState.val = Object.values(this.classMap).join(" ");
    }

    refreshPropertiesState() {
        for (let key in this.propertiesStateMap) {
            this.propertiesStateMap[key].val = this.propertiesMap[key] instanceof Object ? this.propertiesMap[key].join(" ") : this.propertiesMap[key];
        }
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
     * @description getter for children which will automatically refresh them and create them if they are BaseComponent
     */
    get children() {
        if (this._renderedChildren) return this._renderedChildren;
        this._renderedChildren = (this._children || []).map(child => {
            if (child instanceof BaseComponent) {
                child.refreshClassState();
                child.refreshPropertiesState();
                return child.create();
            }
            if (child instanceof Element) {
                return child;
            }
            if (typeof child === "string") {
                return child.trimStart().startsWith("<") ? HtmlRenderer(child) : span(child);
            }
            console.warn(`Invalid child component provided - ${typeof child}:`, child);
            return undefined;
        }).filter(Boolean);
        return this._renderedChildren;
    }

    /**
     * @description getter for commonProperties which are shared against all components
     */
    get commonProperties() {
        this.refreshClassState();
        if (this.id) {
            return {
                id: this.id,
                class: this.classState
            };
        };

        return {
            class: this.classState
        };
    }

    get extraProperties() {
        this.refreshPropertiesState();
        return this.propertiesStateMap;
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

    setExtraProperty(key, value) {
        this.propertiesMap[key] = value;
        let stateMap = this.propertiesStateMap[key];
        if (!stateMap) {
            throw new Error("Extra property setter set without extra definition in the component constructor!");
        }
        stateMap.val = value instanceof Object ? value.join(" ") : value;
    }

    /**
     * @description Create the component
     * it needs to be overridden by the derived class
     */
    create() {
        throw new Error("Component must override create method");
    }

    /**
     * @description Remove the component from the DOM
     */
    remove() {
        this._children.forEach(child => {
            if (child instanceof BaseComponent) {
                child.remove();
            }
        });
        document.getElementById(this.id).remove();
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
        for (let prop of names) {
            const option = options[prop];
            try {
                if (option) option.call(this);
            } catch (e) {
                console.warn("Probably incorrect component usage! Option values should be component-defined functional properties!", e);
            }
        }

        this.refreshClassState();
        this.refreshPropertiesState();
    }
}

export { BaseComponent };
