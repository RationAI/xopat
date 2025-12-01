import van from "../vanjs.mjs";
const { span, div } = van.tags;

const HtmlRenderer = v => {
    const s = v.trim();
    if (s.startsWith("<")) {
        const wrap = div();
        wrap.innerHTML = s;
        return wrap;
    }
    return span(s);
};

/**
 * @typedef {Object} BaseUIOptions
 * @property {string} [id] - The id of the component
 * @property {Object|string} [extraClasses] - Extra classes to be added to the component
 * @property {Object} [extraProperties] - Extra properties to be added to the component
 */

/**
 * @typedef {Node|BaseComponent|string} UIElement
 */

/**
 * @class BaseComponent
 * @description The base class for all components
 */
export class BaseComponent {

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
     * @param {BaseUIOptions|UIElement} [options=undefined] - other options are defined in the constructor of the derived class,
     *  or a child node (first of children).
     * @param  {Array<UIElement>} children - children.
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
            const clsType = typeof extraClasses;
            if (clsType === "string") {
                this.classMap = { ...extraClasses.split(" ") };
            } else {
                this.classMap = typeof extraClasses === "object" ? extraClasses : {};
            }
            this.classState.val = Object.values(this.classMap).join("")
            const extraProperties = options["extraProperties"];
            this.propertiesMap = typeof extraProperties === "object" ? extraProperties : {};
            if (extraProperties){
                for (let key in this.propertiesMap) {
                    const value = this.propertiesMap[key];
                    if (typeof value !== "string") {
                        console.warn("Extra properties are allowed string values only!");
                    } else {
                        this.propertiesStateMap[key] = van.state(this.propertiesMap[key]);
                    }
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
     * @param {*} element - The element to attach the component to
     * @return {BaseComponent} builder pattern
     */
    attachTo(element) {
        this.refreshClassState();
        this.refreshPropertiesState();

        // Accept true BaseComponent instances and component-like objects
        const isComponentLike = (el) => {
            return !!el && (el instanceof BaseComponent || (typeof el === "object" && typeof el.create === "function" && typeof el.id === "string"));
        };

        if (isComponentLike(element)) {
            const mount = document.getElementById(element.id);
            if (mount === null) {
                element._children.push(this);
            } else {
                mount.append(this.create());
            }
        } else {
            // Resolve mount target from id/string or direct reference
            let mount = typeof element === "string"
                ? document.getElementById(element)
                : element;

            // If we got a jQuery/Cash wrapper, unwrap to the first DOM node
            // (supports libraries exposing .jquery flag or .get/.[0])
            if (mount && (mount.jquery || typeof mount.get === "function" || Array.isArray(mount))) {
                const candidate = typeof mount.get === "function" ? mount.get(0) : (Array.isArray(mount) ? mount[0] : mount[0]);
                if (candidate) mount = candidate;
            }

            if (!mount) {
                console.error(`Element ${element} not found`);
                try {
                    van.add(element, this.create());
                } catch (_) { /* noop: element may be invalid for van.add */ }
            } else if (typeof mount.append === "function") {
                mount.append(this.create());
            } else if (mount.nodeType || mount instanceof Node) {
                // Fallback for very old environments where append may be missing
                const created = this.create();
                if (mount.appendChild) mount.appendChild(created);
                else {
                    try { mount.innerHTML += created.outerHTML || String(created); } catch (_) {}
                }
            } else {
                // Last resort: try jQuery-style append if available or log a clearer error
                try { mount.append(this.create()); }
                catch (e) {
                    console.error("Failed to attach component: unsupported mount target", mount);
                    console.error(e);
                }
            }
        }
        return this;
    }

    /**
     * @param {*} element - The element to prepend the component to
     * @return {BaseComponent} builder pattern
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
        return this;
    }

    /**
     * Remove this component from a container if it exists in the DOM.
     * @param {BaseComponent|string|Element} element - parent container (component, id, or node)
     * @returns {boolean} true if something was removed, false otherwise
     */
    removeFrom(element) {
        let mount = element;
        if (element instanceof BaseComponent) {
            mount = document.getElementById(element.id) || null;
        }
        if (typeof element === "string") {
            mount = document.getElementById(element);
        }
        if (!mount) return false;

        // Prefer the stored root. Fallback to lookup by id/data-attr inside mount.
        let root = document.getElementById(this.id);
        if (!root) return false;

        if (root && mount.contains(root)) {
            root.remove();

            // Not in DOM: if element is a component, also drop the child reference if queued
            if (element instanceof BaseComponent && Array.isArray(element._children)) {
                // todo: if not a BaseComponent, we would still want to check
                let i = element._children.findIndex(c => c.id === this.id);
                if (i !== -1) {
                    element._children.splice(i, 1);
                }
                i = element._children.indexOf(this);
                if (i !== -1) {
                    element._children.splice(i, 1);
                }
                return true;
            }

            return true;
        }
        return false;
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
        this._renderedChildren = (this._children || []).map(this.toNode).filter(Boolean);
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
        }

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

    /**
     * Toggle the class of the component
     * @param {string} key
     * @param {string} value
     * @param {boolean} on if true, set class
     */
    toggleClass(key, value, on=true) {
        this.classMap[key] = on ? value : "";
        this.classState.val = Object.values(this.classMap).join(" ");
    }

    /**
     * Set attribute property to the element
     * @param {string} key attribute name
     * @param {string} value
     */
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
     * it needs to be overridden by the derived class.
     */
    create() {
        throw new Error("Component must override create method");
    }

    /**
     * Prepare Element to be insertable into DOM
     * @param {UIElement} item
     * @param {boolean} reinit if true, BaseComponent's init methods are called before creation
     * @return Node
     */
    toNode(item, reinit = true) {
        if (item === undefined) return undefined;
        if (item instanceof BaseComponent) {
            if (reinit) {
                item.refreshClassState();
                item.refreshPropertiesState();
            }
            return item.create();
        }
        if (item instanceof Node) {
            return item;
        }
        if (typeof item === "string") {
            return item.trimStart().startsWith("<") ? HtmlRenderer(item) : span(item);
        }
        console.warn(`Invalid child component provided - ${typeof item}:`, item);
        return undefined;
    }

    /**
     * Prepare Element to be insertable into DOM - available also as a static method
     * @param {UIElement} item
     * @param {boolean} reinit if true, BaseComponent's init methods are called before creation
     * @return Node
     */
    static toNode(item, reinit = true) {
        if (item === undefined) return undefined;
        if (item instanceof BaseComponent) {
            if (reinit) {
                item.refreshClassState();
                item.refreshPropertiesState();
            }
            return item.create();
        }
        if (item instanceof Node) {
            return item;
        }
        if (typeof item === "string") {
            return item.trimStart().startsWith("<") ? HtmlRenderer(item) : span(item);
        }
        console.warn(`Invalid child component provided - ${typeof item}:`, item);
        return undefined;
    }

    /**
     * Safely Parse Any argument to Dom-attachable object - available also as a static method.
     * @param {*} item
     * @param {boolean} reinit if true, BaseComponent's init methods are called before creation
     * @return Node|Node[]|string|string[]
     */
    static parseDomLikeItem(item, reinit = true) {
        if (item == null) return [];
        if (typeof item === "string") return item;
        if (item.jquery) return item;
        if (Array.isArray(item)) return item.map(this.parseDomLikeItem);

        // BaseComponent instance (your components have create() or render())
        if (item instanceof UI.BaseComponent ||
            (item && typeof item === "object" && item.create)) {
            if (reinit) {
                item.refreshClassState();
                item.refreshPropertiesState();
            }
            return item.create();
        }

        // DOM Node / DocumentFragment
        if (item.nodeType || item instanceof Node) return item;

        // Fallback: stringify
        console.warn(`Component ${typeof item} probably not parseable: stringified.`, item);
        return String(item);
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
        // todo: instead of forced ID, keep internal reference from create(..)
        const self = document.getElementById(this.id);
        if (self) {
            self.remove();
        }
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

/**
 * @typedef {BaseUIOptions} SelectableUIOptions
 * @property {string} [itemID] - The selection ID
 */
export class BaseSelectableComponent extends BaseComponent {
    constructor(options, ...args) {
        options = super(options, ...args);
        this.itemID = options.itemID || this.id;
    }

    setSelected(itemID) {
        throw new Error("Component must override setSelected method");
    }
}
