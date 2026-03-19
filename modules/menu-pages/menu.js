window.AdvancedMenuPages = class extends XOpatModule {

    vegaInit = {};

    /**
     * Create AdvancedMenuPages instance
     * @param {string} moduleId unique id of this module instance.
     * @param {function|string} strategy builder strategy, renderUIFromJson or guessUIFromJson
     */
    constructor(moduleId, strategy='renderUIFromJson') {
        super("menu-pages")
        this.__uids = moduleId; // todo consider doing this in some standard way... we need to inherit the identity to e.g. crash together with the owner
        this._count = 0;
        this.strategy = typeof strategy === "string" ? this[strategy] : strategy;
    }

    loadVega(initialized=false) {
        for (let id in this.vegaInit) {
            const object = this.vegaInit[id];
            if (object.view) continue;

            if (!window.vega || !window.vega.View) {
                if (initialized) {
                    console.warn("Could not load vega: ignoring vega components.");
                    delete this.vegaInit[id];
                    continue;
                }
                const _this = this;
                UTILITIES.loadModules(function() {
                    // If the loader fails (e.g., integrity error), we just retry once; otherwise warn out
                    // TODO (optional): draw an error placeholder image/canvas here
                    _this.loadVega(true);
                }, APPLICATION_CONTEXT.secure ? "vega-secure" : "vega");
                return;
            }

            delete this.vegaInit[id];
            try {
                object.view = new vega.View(
                    vega.parse(object.vega),
                    { renderer: "canvas", container: `#${id}`, hover: true }
                );
                object.view.runAsync();
            } catch (err) {
                console.warn("Vega failed to initialize for", id, err);
            }
        }
    }

    builderInstance(id, counter=undefined) {
        if (id) return `__builder-${id}`;
        if (!Number.isNaN(counter))  return `__builder-${counter}`;
        throw "Cannot create builder ID: either valid ID or counter value must be supplied!";
    }

    getMenuId(id, counter=undefined) {
        if (id) return `pages-menu-root-${this.uid}-${id}`;
        if (!Number.isNaN(counter)) return `pages-menu-root-${this.uid}-${counter}`;
        throw "Cannot create menu ID: either valid ID or counter value must be supplied!";
    }

    getSubMenuId(id, counter=undefined) {
        if (id) return `pages-menu-item-${this.uid}-${id}`;
        if (!Number.isNaN(counter)) return `pages-menu-item-${this.uid}-${counter}`;
        throw "Cannot create submenu ID: either valid ID or counter value must be supplied!";
    }

    openMenu(id) {
        USER_INTERFACE.AppBar.Plugins.openMenu(this.getMenuId(id));
    }

    openSubMenu(id) {
        USER_INTERFACE.AppBar.Plugins.openSubmenu(this.getMenuId(id), this.getSubMenuId(id));
    }

    /**
     * @typedef JSONHtmlConfig
     * @type object
     * @property {string} id - id to reference the menu with
     * @property {string} title
     * @property {[object]} page
     * @property {boolean} main
     * todo docs
     */

    /**
     * Allowed types of config[i].page[] are either 'vega', 'columns', 'newline', 'html'
     *   or types that map to the compiled UI system.
     *
     * @param {JSONHtmlConfig|[JSONHtmlConfig]} config
     * @param {boolean|object} sanitizeConfig configuration for sanitize-html,
     *   or simple on/off flag for default behaviour
     */
    buildMetaDataMenu(config, sanitizeConfig=false) {
        if (!config) return;

        const build = (config, sanitizer) => {
            let parent, parentUnique;

            for (let data of config) {
                const html = [];

                if (!data.title || !data.page) {
                    console.warn("Config for advanced menu pages missing title or page props - skipping!", data);
                    continue;
                }

                for (let element of (data.page || [])) {
                    html.push(this.strategy(element, sanitizer));
                }

                // count is generated ID, if not supplied use generic ID that is not traceable
                if (!parent || data.main) {
                    parentUnique = this.getMenuId(data.id, this._count++);
                    parent = this.builderInstance(data.id, this._count);
                }

                const unique = this.getSubMenuId(data.id, this._count++);
                USER_INTERFACE.AppBar.Plugins._buildMenu(
                    this,
                    parent,
                    parentUnique,
                    data.title,
                    unique,
                    unique,
                    data.subtitle || data.title,
                    html.join(""),
                    data.icon || "",
                    true,
                    true
                );
            }
            this._count += config.length;
            this.loadVega();
        };


        if (!Array.isArray(config)) {
            config = [config];
        }

        if (typeof sanitizeConfig === "object") {
            UTILITIES.loadModules(() => {
                build(config, str => SanitizeHtml(str, sanitizeConfig));
            }, "sanitize-html");
        } else if (sanitizeConfig) {
            UTILITIES.loadModules(() => {
                build(config, str => SanitizeHtml(str));
            }, "sanitize-html");
        } else {
            build(config, false);
        }
    }

    /**
     * Allowed types of config[i].page[] are either 'vega', 'columns', 'newline', 'html'
     *   or types that map to the compiled UI system. Instead of menu, buids a custom content at desired place
     * @param {JSONHtmlConfig|[JSONHtmlConfig]} config
     * @param selector
     * @param sanitizeConfig
     */
    buildCustom(config, selector, sanitizeConfig=false) {
        if (!config) return;
        const build = (config, sanitizer, selector=undefined) => {
            const html = [];
            if (Array.isArray(config)) {
                for (let data of config) {
                    // todo handle data title and other base props
                    if (data.page) {
                        for (let element of (data.page || [])) {
                            html.push(this.strategy(element, sanitizer));
                        }
                    } else {
                        html.push(this.strategy(data, sanitizer));
                    }
                }
            } else {
                html.push(this.strategy(config, sanitizer));
            }

            USER_INTERFACE.addHtml(
                html.join(""),
                this.uid,
                selector
            );
            this.loadVega();
        };
        if (typeof sanitizeConfig === "object") {
            UTILITIES.loadModules(() => {
                build(config, str => SanitizeHtml(str, sanitizeConfig), selector);
            }, "sanitize-html");
        } else if (sanitizeConfig) {
            UTILITIES.loadModules(() => {
                build(config, str => SanitizeHtml(str), selector);
            })
        } else {
            build(config, false, selector);
        }
    }

    /**
     * @typedef {function} ViewerHtmlConfigGetter
     * @param {OpenSeadragon.Viewer} viewer - viewer that is the config meant for
     * @return JSONHtmlConfig
     */

    /**
     * @param {ViewerHtmlConfigGetter} getter
     * @param sanitizeConfig
     */
    buildViewerMenu(getter, sanitizeConfig=false) {
        const build = (viewer, sanitizer) => {
            let config = null;
            try {
                config = getter(viewer);
            } catch (e) {
                console.error(`Error in module menu builder for ${getter}:`, e);
            }

            if (!config) return;

            const html = [];
            for (let element of (config.page || [])) {
                html.push(this.strategy(element, sanitizer));
            }

            // todo vega might be problematic -> we don't know WHEN it gets updated, we need callback to execute when inserted
            setTimeout(() => this.loadVega());

            // todo icon
            return {
                id: this.getMenuId(config.id, this._count++),
                title: config.title,
                icon: "fa-cog",
                body: html.join("")
            }
        };

        if (typeof sanitizeConfig === "object") {
            UTILITIES.loadModules(() => {
                this.registerViewerMenu(viewer => build(viewer, str => SanitizeHtml(str, sanitizeConfig)));
            }, "sanitize-html");
        } else if (sanitizeConfig) {
            UTILITIES.loadModules(() => {
                this.registerViewerMenu(viewer => build(viewer, str => SanitizeHtml(str)));
            }, "sanitize-html");
        } else {
            this.registerViewerMenu(viewer => build(viewer, false));
        }
    }

    // -----------------------------
    // UI System translation utilities
    // -----------------------------

    norm = t => String(t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    pascalize = t => {
        return String(t || "")
            .split(/[^a-z0-9]+/i)
            .filter(Boolean)
            .map(s => s[0].toUpperCase() + s.slice(1).toLowerCase())
            .join("");
    };

    ALIAS = {
        // Compiled UI element aliases
        "div": "Div",
        "button": "Button",
        "faicon": "FAIcon", "icon": "FAIcon", "fa-auto": "FAIcon",
        "join": "Join",
        "dropdown": "Dropdown",
        "menu": "Menu",
        "menutab": "MenuTab",
        "multipanelmenu": "MultiPanelMenu",
        "fullscreenmenu": "FullscreenMenu",
        "tabsmenu": "TabsMenu",
        "checkbox": "Checkbox",
        "title": "Title",
        "header": "Title",
        "heading": "Title",
        "collapse": "Collapse",
        // handled explicitly here:
        "vega": true,
        "html": true,
        "columns": true,
        "newline": true
    };

    // Try several name shapes against UI
    resolveUIClass(type){
        if (!type || !globalThis.UI) return null;
        const UI = globalThis.UI;

        // exact hit first
        if (UI[type]) return UI[type];

        // PascalCase
        const pas = this.pascalize(type);
        if (UI[pas]) return UI[pas];

        // alias
        const ali = this.ALIAS[this.norm(type)];
        if (ali && ali !== true && UI[ali]) return UI[ali];

        // legacy namespaces if any exist on your build
        if (UI.Components?.[pas]) return UI.Components[pas];
        if (UI.Elements?.[pas])   return UI.Elements[pas];

        return null;
    }

    // Deep-sanitize helper (strings via sanitizer; objects/arrays recursively)
    sanitizeDeep(node, sanitizer){
        const t = typeof node;
        if (!sanitizer) return node; // no-op if sanitizer not provided
        if (t === "string") return sanitizer(node);
        if (Array.isArray(node)) return node.map(n => this.sanitizeDeep(n, sanitizer));
        if (t === "object" && node) {
            const result = {};
            for (let p in node) {
                // these props are not allowed in UI options
                if (p === "type" || p === "children") {
                    continue;
                }
                result[p] = this.sanitizeDeep(node[p], sanitizer);
            }
            return result;
        }
        return node;
    }

    // Render a UI component (and nested children) to HTML string
    renderUIFromJson(jsonNode, sanitizer){
        if (!jsonNode || typeof jsonNode !== "object") return "";

        // Special types handled here (keep parity with legacy builder)
        const t = this.norm(jsonNode.type);

        //todo consider supporting nodes to avoid returning innerHtml
        try {
            switch (t) {
                case "vega": {
                    // container + enqueue vega init
                    const classes = jsonNode.classes ? (sanitizer ? sanitizer(jsonNode.classes) : jsonNode.classes) : "";
                    const uid = `vega-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                    // store the ORIGINAL (unsanitized object is fine; spec is not injected into DOM)
                    this.vegaInit[uid] = jsonNode;
                    return `<div class="${classes}" id="${uid}"></div>`;
                }

                case "html": {
                    if (sanitizer) return sanitizer(jsonNode.html || "");
                    if (!APPLICATION_CONTEXT.secure) return String(jsonNode.html || "");
                    return ""; // secure mode blocks raw-html unless sanitizer is provided
                }

                case "columns": {
                    // Render columns as a flex row; each child becomes a flex-1 column.
                    const classes = jsonNode.classes ? (sanitizer ? sanitizer(jsonNode.classes) : jsonNode.classes) : "";
                    const children = Array.isArray(jsonNode.children) ? jsonNode.children : [];
                    const cols = children.map(ch => {
                        const cj = (typeof ch === "object" && ch) ? { ...ch } : { type: "div", children: [ch] };
                        // Append flex-1 to each column's classes without clobbering user classes
                        const colClasses = (cj.classes ? (sanitizer ? sanitizer(cj.classes) : cj.classes) : "");
                        cj.classes = (colClasses + " flex-1").trim();
                        return this.renderUIFromJson(cj, sanitizer);
                    }).join("");
                    return `<div class="flex ${classes}">${cols}</div>`;
                }

                case "newline": {
                    // Simple visual separator / line break
                    // Choose one: semantic <hr> (styled by DaisyUI) or a small spacer div
                    return `<div class="divider my-2"></div>`;
                }

                default: {
                    // Regular UI element -> compiled UI system
                    const Cls = this.resolveUIClass(jsonNode.type);
                    if (!Cls) return "";

                    // Sanitize the options object (strings-only) if a sanitizer is provided
                    const safeOptions = this.sanitizeDeep({ ...jsonNode }, sanitizer);

                    // Render children: allow strings/HTML or nested {type:...}
                    const kids = [];
                    if (Array.isArray(jsonNode.children)) {
                        for (const ch of jsonNode.children) {
                            if (ch && typeof ch === "object" && ch.type) {
                                // Nested UI element → render to HTML string and pass as Node
                                const childHTML = this.renderUIFromJson(ch, sanitizer);
                                const tmp = document.createElement("div");
                                tmp.innerHTML = childHTML;
                                // append all produced nodes (could be 1+)
                                kids.push(...tmp.childNodes);
                            } else {
                                // Raw string/number/boolean → coerce to string (sanitized if configured)
                                const str = (typeof ch === "string" ? (sanitizer ? sanitizer(ch) : ch) : String(ch ?? ""));
                                kids.push(str);
                            }
                        }
                    }

                    // Create instance
                    const inst = new Cls(safeOptions, ...kids);

                    // Force a concrete node, then stringify to keep the old `html.join("")` pipeline
                    const node = UI.BaseComponent.toNode(inst, /*reinit*/ true);
                    const wrap = document.createElement("div");
                    wrap.appendChild(node);
                    return wrap.innerHTML;
                }
            }
        } catch (e) {
            console.warn("AdvancedMenuPages: Failed to generate HTML.", jsonNode, e);
            return `<div class="error-container">${$.t('elementsBuilderErr')}</div>`;
        }
    }

    //////////////
    // Guessing //
    //////////////

    humanizeKey(k) {
        if (!k && k !== 0) return "";
        const s = String(k)
            .replace(/[_\-]+/g, " ")
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .replace(/\s+/g, " ")
            .trim();
        return s.charAt(0).toUpperCase() + s.slice(1);
    }
    _isPlainObject(v) { return Object.prototype.toString.call(v) === "[object Object]"; }
    _isPrimitive(v) { return v === null || (typeof v !== "object" && typeof v !== "function"); }
    _arrayKind(arr) {
        if (!Array.isArray(arr)) return "none";
        if (!arr.length) return "empty";
        const allPrim = arr.every(this._isPrimitive);
        if (allPrim) return "primitives";
        const allObj = arr.every(this._isPlainObject);
        if (allObj) return "objects";
        return "mixed";
    }
    _fmtValue(v) {
        if (v === null) return "null";
        if (typeof v === "undefined") return "undefined";
        if (typeof v === "string") return v;
        try { return JSON.stringify(v); } catch { return String(v); }
    }

    /**
     * Build a small UI spec node for a labeled value line.
     * Uses generic Div + classes to avoid depending on unknown Input components.
     */
    _buildLabeledValue(label, valueStr) {
        return {
            type: "div",
            extraClasses: "flex items-start gap-2 py-1",
            children: [
                { type: "div", extraClasses: "w-40 shrink-0 text-xs opacity-80", children: [label] },
                { type: "div", extraClasses: "text-xs font-mono bg-base-200 px-2 py-0.5 rounded", children: [valueStr] }
            ]
        };
    }

    /** Tag/badge chip */
    _buildChip(text) {
        return {
            type: "div",
            extraClasses: "badge badge-outline badge-sm",
            children: [String(text)]
        };
    }

    /** Join row of chips */
    _buildChipRow(label, arr, max=10) {
        const shown = arr.slice(0, max).map(v => this._buildChip(this._fmtValue(v)));
        if (arr.length > max) shown.push(this._buildChip(`+${arr.length - max} more`));
        return {
            type: "div",
            extraClasses: "flex items-start gap-2 py-1",
            children: [
                { type: "div", extraClasses: "w-40 shrink-0 text-xs opacity-80", children: [label] },
                { type: "join", extraClasses: "flex flex-wrap gap-1", children: shown }
            ]
        };
    }

    /**
     * Guess UI spec for any JSON value.
     *
     * @param {string} key - current property key (for labels)
     * @param {*} value - the JSON value
     * @param {number} depth - current recursion depth
     * @param {object} opts - { maxDepth, maxArrayItems }
     * @returns {Array} array of UI spec nodes
     */
    _guessSpecForValue(key, value, depth, opts) {
        const label = this.humanizeKey(key);
        const nodes = [];

        // Primitive types
        if (typeof value === "boolean") {
            nodes.push({ type: "checkbox", label, checked: !!value });
            return nodes;
        }
        if (typeof value === "number") {
            nodes.push(this._buildLabeledValue(label, String(value)));
            return nodes;
        }
        if (typeof value === "string") {
            const isLong = value.length > 120 || value.includes("\n");
            nodes.push({
                type: "div",
                extraClasses: "flex items-start gap-2 py-1",
                children: [
                    { type: "div", extraClasses: "w-40 shrink-0 text-xs opacity-80", children: [label] },
                    { type: "div", extraClasses: (isLong ? "text-xs whitespace-pre-wrap" : "text-xs"),
                        children: [value] }
                ]
            });
            return nodes;
        }
        if (value === null) {
            nodes.push(this._buildLabeledValue(label, "null"));
            return nodes;
        }

        // Arrays
        if (Array.isArray(value)) {
            const kind = this._arrayKind(value);
            if (kind === "empty") {
                nodes.push(this._buildLabeledValue(label, "[]"));
                return nodes;
            }
            if (kind === "primitives") {
                nodes.push(this._buildChipRow(label, value, opts.maxArrayItems));
                return nodes;
            }
            nodes.push({ type: "title", text: label, level: Math.min(4, depth + 2), separator: false });

            const children = [];
            const items = value.slice(0, opts.maxArrayItems);
            items.forEach((item, i) => {
                if (depth >= opts.maxDepth) {
                    children.push(this._buildLabeledValue("", this._fmtValue(item)));
                } else {
                    children.push(...this._guessSpecForValue(i, item, depth + 1, opts));
                }
            });
            if (value.length > opts.maxArrayItems) {
                children.push(this._buildLabeledValue("Note", `+${value.length - opts.maxArrayItems} more items truncated`));
            }

            if (children.length > 3) {
                nodes.push({
                    type: "collapse",
                    label: `Items (${value.length})`,
                    children,
                    startOpen: false
                });
            } else {
                nodes.push(...children);
            }
            return nodes;
        }

        if (this._isPlainObject(value)) {
            if (value.type && this.resolveUIClass(value.type)) {
                if (Array.isArray(value.children)) {
                    value.children = value.children.map(ch => this._guessSpecForValue("", ch, depth + 1, opts));
                }
                nodes.push(value);
                return nodes;
            }

            if (label) {
                nodes.push({ type: "title", text: label || "Object", level: Math.min(4, depth + 2), separator: false });
            }
            if (depth >= opts.maxDepth) {
                nodes.push(this._buildLabeledValue("Value", this._fmtValue(value)));
                return nodes;
            }
            for (let chKey in value) {
                nodes.push(...this._guessSpecForValue(chKey, value[chKey], depth + 1, opts));
            }
            return nodes;
        }

        // Fallback
        nodes.push(this._buildLabeledValue(label || "Value", this._fmtValue(value)));
        return nodes;
    }

    /**
     * Public: guess UI from generic JSON and render to HTML string. It supports interleaving with
     *  standardized UI JSON spec - you can interleave UI JSON Spec with random JSON values.
     *  The system tries to estimate the best UI for the given JSON.
     * @param {*} json - any JSON-serializable value (root)
     * @param {object|false} sanitizer - optional sanitizer function (same convention as renderUIFromJson)
     * @param {object} options - { title, maxDepth, maxArrayItems }
     * @returns {string} HTML string
     */
    guessUIFromJson(json, sanitizer=false, options={}) {
        options.maxDepth = Math.max(1, options.maxDepth ?? 3);
        options.maxArrayItems = Math.max(1, options.maxArrayItems ?? 25);

        const spec = this._guessSpecForValue("", json, 1, options);
        const htmlParts = spec.map(node => this.renderUIFromJson(node, sanitizer));
        return htmlParts.join("");
    }
};
