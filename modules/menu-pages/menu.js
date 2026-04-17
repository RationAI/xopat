window.AdvancedMenuPages = class extends XOpatModule {

    vegaInit = {};

    /**
     * Create AdvancedMenuPages instance
     * @param {string} moduleId unique id of this module instance.
     * @param {function|string} strategy builder strategy, renderUIFromJson or guessUIFromJson
     */
    constructor(moduleId, strategy='renderUIFromJson') {
        super()
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

    _isPlainObject(v) {
        return Object.prototype.toString.call(v) === "[object Object]";
    }

    _isPrimitive(v) {
        return v === null || (typeof v !== "object" && typeof v !== "function");
    }

    _arrayKind(arr) {
        if (!Array.isArray(arr)) return "none";
        if (!arr.length) return "empty";
        const allPrim = arr.every(v => this._isPrimitive(v));
        if (allPrim) return "primitives";
        const allObj = arr.every(v => this._isPlainObject(v));
        if (allObj) return "objects";
        return "mixed";
    }

    _isShortText(v, max=72) {
        return typeof v === "string" && !v.includes("\n") && v.length <= max;
    }

    _isLongText(v, max=160) {
        return typeof v === "string" && (v.includes("\n") || v.length > max);
    }

    _fmtValue(v, maxLen=220) {
        if (v === null) return "null";
        if (typeof v === "undefined") return "undefined";
        if (typeof v === "boolean") return v ? "Yes" : "No";
        if (typeof v === "string") {
            return v.length > maxLen ? `${v.slice(0, maxLen - 1)}…` : v;
        }
        if (Array.isArray(v)) {
            return `[${v.length} item${v.length === 1 ? "" : "s"}]`;
        }
        try {
            const str = JSON.stringify(v);
            return str.length > maxLen ? `${str.slice(0, maxLen - 1)}…` : str;
        } catch {
            return String(v);
        }
    }

    _compactValue(v) {
        if (typeof v === "boolean") return v ? "Yes" : "No";
        if (typeof v === "number") return String(v);
        if (typeof v === "string") return this._fmtValue(v, 64);
        if (v === null) return "null";
        if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`;
        if (this._isPlainObject(v)) return `${Object.keys(v).length} field${Object.keys(v).length === 1 ? "" : "s"}`;
        return this._fmtValue(v, 64);
    }

    _uiDiv(extraClasses="", children=[]) {
        return { type: "div", extraClasses, children };
    }

    _uiBadge(text, extraClasses="") {
        return this._uiDiv(`badge badge-outline badge-sm ${extraClasses}`.trim(), [String(text)]);
    }

    _uiMuted(text, extraClasses="") {
        return this._uiDiv(`text-xs opacity-70 ${extraClasses}`.trim(), [String(text)]);
    }

    _uiSectionTitle(text, extraClasses="") {
        return this._uiDiv(`text-sm font-semibold tracking-wide ${extraClasses}`.trim(), [String(text)]);
    }

    _buildValuePill(value, classes="") {
        return this._uiDiv(`inline-flex max-w-full items-center rounded-xl bg-base-200 px-2.5 py-1 text-sm break-all ${classes}`.trim(), [this._fmtValue(value)]);
    }

    _buildFieldRow(label, value, opts={}) {
        const valueClasses = opts.monospace
            ? "font-mono text-xs"
            : (opts.longText ? "whitespace-pre-wrap break-words leading-relaxed" : "break-words");

        return this._uiDiv("py-2 border-b border-base-300 last:border-b-0", [
            this._uiDiv("mb-1 text-[11px] font-medium uppercase tracking-wide opacity-60", [label || "Value"]),
            this._uiDiv(`text-sm ${valueClasses}`.trim(), [this._fmtValue(value, opts.longText ? 10000 : 220)])
        ]);
    }

    _buildFactTile(label, value) {
        return this._uiDiv("rounded-xl border border-base-300 bg-base-200 px-3 py-2", [
            this._uiDiv("mb-1 text-[11px] font-medium uppercase tracking-wide opacity-60", [label]),
            this._uiDiv("text-sm font-medium break-words", [this._compactValue(value)])
        ]);
    }

    _buildChip(text) {
        return this._uiBadge(text);
    }

    _buildChipList(items, max=12) {
        const shown = items.slice(0, max).map(item => this._buildChip(this._fmtValue(item, 48)));
        if (items.length > max) shown.push(this._buildChip(`+${items.length - max} more`));
        return this._uiDiv("flex flex-wrap gap-1.5", shown);
    }

    _buildCard({ title="", subtitle="", badge="", extraClasses="" }={}, children=[]) {
        const header = [];
        if (title || subtitle || badge) {
            const left = [];
            if (title) left.push(this._uiDiv("text-base font-semibold leading-tight break-words", [title]));
            if (subtitle) left.push(this._uiDiv("text-sm opacity-75 break-words whitespace-pre-wrap", [subtitle]));
            header.push(this._uiDiv("mb-3 flex items-start justify-between gap-3", [
                this._uiDiv("min-w-0 space-y-1", left),
                badge ? this._uiBadge(badge, "shrink-0") : ""
            ]));
        }
        return this._uiDiv(`rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm ${extraClasses}`.trim(), [
            ...header,
            ...children
        ]);
    }

    _buildKeyValueCard(title, entries) {
        if (!entries.length) return null;
        return this._buildCard({ title }, entries.map(([label, value]) => {
            const isLong = this._isLongText(value);
            const isCodeish = typeof value === "string" && (value.startsWith("{") || value.startsWith("["));
            return this._buildFieldRow(label, value, {
                longText: isLong,
                monospace: isCodeish
            });
        }));
    }

    _buildPrimitiveArrayCard(label, arr) {
        return this._buildCard(
            { title: label || "Items", badge: `${arr.length}` },
            [this._buildChipList(arr)]
        );
    }

    _buildRawValueCard(label, value, badge="") {
        return this._buildCard(
            { title: label || "Value", badge },
            [this._buildFieldRow(label || "Value", this._fmtValue(value, 10000), { longText: true, monospace: true })]
        );
    }

    _headlineKeys() {
        return [
            "title", "name", "label", "displayName", "display_name", "slideName", "slide_name",
            "filename", "fileName", "imageName", "image_name", "caseName", "case_name",
            "specimen", "sample", "id", "identifier", "accession"
        ];
    }

    _subtitleKeys() {
        return ["description", "summary", "subtitle", "notes", "comment", "details"];
    }

    _pickHeadline(obj, fallbackTitle="Slide information") {
        const headline = {
            title: fallbackTitle,
            titleKey: "",
            subtitle: "",
            subtitleKey: ""
        };

        for (const key of this._headlineKeys()) {
            const value = obj?.[key];
            if (typeof value === "string" && value.trim()) {
                headline.title = value.trim();
                headline.titleKey = key;
                break;
            }
            if ((typeof value === "number" || typeof value === "boolean") && value !== "") {
                headline.title = `${this.humanizeKey(key)}: ${this._compactValue(value)}`;
                headline.titleKey = key;
                break;
            }
        }

        for (const key of this._subtitleKeys()) {
            const value = obj?.[key];
            if (typeof value === "string" && value.trim()) {
                headline.subtitle = value.trim().length > 180 ? `${value.trim().slice(0, 179)}…` : value.trim();
                headline.subtitleKey = key;
                break;
            }
        }

        return headline;
    }

    _pickSummaryFacts(obj, excludeKeys=new Set(), limit=4) {
        const preferred = [
            "type", "format", "status", "vendor", "scanner", "stain", "diagnosis",
            "width", "height", "size", "dimensions", "magnification", "objectivePower",
            "channel", "modality", "created", "updated", "version"
        ];
        const entries = Object.entries(obj || {}).filter(([key, value]) => {
            if (excludeKeys.has(key)) return false;
            if (!this._isPrimitive(value)) return false;
            if (typeof value === "string" && !this._isShortText(value, 48)) return false;
            return true;
        });

        const ranked = entries.sort((a, b) => {
            const ai = preferred.indexOf(a[0]);
            const bi = preferred.indexOf(b[0]);
            const av = ai === -1 ? 999 : ai;
            const bv = bi === -1 ? 999 : bi;
            if (av !== bv) return av - bv;
            return a[0].localeCompare(b[0]);
        });

        return ranked.slice(0, limit);
    }

    _buildObjectHero(label, obj, opts={}) {
        const fallbackTitle = label || opts.title || "Slide information";
        const headline = this._pickHeadline(obj, fallbackTitle);
        const usedKeys = new Set([headline.titleKey, headline.subtitleKey].filter(Boolean));
        const facts = this._pickSummaryFacts(obj, usedKeys, 4);

        const children = [
            this._uiDiv("text-[11px] font-medium uppercase tracking-[0.14em] opacity-60", [label ? this.humanizeKey(label) : "Slide information"]),
            this._uiDiv("text-lg font-semibold leading-tight break-words", [headline.title])
        ];

        if (headline.subtitle) {
            children.push(this._uiDiv("text-sm opacity-80 whitespace-pre-wrap break-words", [headline.subtitle]));
        }

        if (facts.length) {
            children.push(
                this._uiDiv(
                    "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2",
                    facts.map(([factKey, factValue]) => this._buildFactTile(this.humanizeKey(factKey), factValue))
                )
            );
        }

        return {
            node: this._buildCard({}, children),
            excludeKeys: usedKeys,
            factKeys: new Set(facts.map(([factKey]) => factKey))
        };
    }

    _renderExplicitSpec(node, depth, opts) {
        if (!node || !node.type) return node;
        if (!Array.isArray(node.children)) return node;

        return {
            ...node,
            children: node.children.flatMap(child => {
                if (child && typeof child === "object" && child.type) {
                    return [this._renderExplicitSpec(child, depth + 1, opts)];
                }
                if (this._isPrimitive(child)) return [String(child ?? "")];
                return [this._buildRawValueCard("Value", child)];
            })
        };
    }

    _buildObjectSection(label, obj, depth, opts={}) {
        const title = label ? this.humanizeKey(label) : (opts.title || "Object");

        if (depth >= opts.maxDepth) {
            return [this._buildRawValueCard(title, obj, `${Object.keys(obj).length} fields`)];
        }

        const isRoot = depth === 1;
        const nodes = [];
        const excludedKeys = new Set();

        if (isRoot) {
            const hero = this._buildObjectHero(label, obj, opts);
            nodes.push(hero.node);
            hero.excludeKeys.forEach(key => excludedKeys.add(key));
            hero.factKeys.forEach(key => excludedKeys.add(key));
        }

        const scalarEntries = [];
        const longTextEntries = [];
        const primitiveArrays = [];
        const objectEntries = [];
        const complexArrays = [];
        const explicitSpecs = [];

        for (const [key, value] of Object.entries(obj)) {
            if (excludedKeys.has(key)) continue;

            if (value && typeof value === "object" && value.type) {
                const resolved = this.resolveUIClass(value.type) || this.ALIAS[this.norm(value.type)];
                if (resolved) {
                    explicitSpecs.push(this._renderExplicitSpec(value, depth + 1, opts));
                    continue;
                }
            }

            if (Array.isArray(value)) {
                const kind = this._arrayKind(value);
                if (kind === "primitives" || kind === "empty") {
                    primitiveArrays.push([key, value]);
                } else {
                    complexArrays.push([key, value]);
                }
                continue;
            }

            if (this._isPlainObject(value)) {
                objectEntries.push([key, value]);
                continue;
            }

            if (this._isLongText(value)) {
                longTextEntries.push([key, value]);
            } else {
                scalarEntries.push([key, value]);
            }
        }

        if (scalarEntries.length) {
            const card = this._buildKeyValueCard(isRoot ? "Properties" : `${title} properties`, scalarEntries.map(([key, value]) => [this.humanizeKey(key), value]));
            if (card) nodes.push(card);
        }

        for (const [key, value] of primitiveArrays) {
            const labelText = this.humanizeKey(key);
            if (!value.length) {
                nodes.push(this._buildKeyValueCard(labelText, [[labelText, "[]"]]));
            } else {
                nodes.push(this._buildPrimitiveArrayCard(labelText, value));
            }
        }

        for (const [key, value] of longTextEntries) {
            nodes.push(this._buildCard(
                { title: this.humanizeKey(key) },
                [this._uiDiv("text-sm whitespace-pre-wrap break-words leading-relaxed", [this._fmtValue(value, 10000)])]
            ));
        }

        for (const [key, value] of objectEntries) {
            nodes.push(...this._buildObjectSection(key, value, depth + 1, opts));
        }

        for (const [key, value] of complexArrays) {
            nodes.push(...this._buildArraySection(key, value, depth + 1, opts));
        }

        nodes.push(...explicitSpecs);

        return nodes;
    }

    _buildArrayItemCard(item, index, depth, opts) {
        const badge = `#${index + 1}`;

        if (this._isPlainObject(item)) {
            const headline = this._pickHeadline(item, `Item ${index + 1}`);
            const nested = this._buildObjectSection(`Item ${index + 1}`, item, depth + 1, opts);
            return this._buildCard(
                { title: headline.title, subtitle: headline.subtitle, badge },
                nested.length ? nested : [this._buildFieldRow(`Item ${index + 1}`, this._fmtValue(item, 10000), { longText: true, monospace: true })]
            );
        }

        if (Array.isArray(item)) {
            const nested = this._buildArraySection(`Item ${index + 1}`, item, depth + 1, opts);
            return this._buildCard({ title: `Item ${index + 1}`, badge }, nested);
        }

        return this._buildCard({ title: `Item ${index + 1}`, badge }, [
            this._buildValuePill(item)
        ]);
    }

    _buildArraySection(label, arr, depth, opts={}) {
        const title = label ? this.humanizeKey(label) : "Items";
        const kind = this._arrayKind(arr);

        if (depth >= opts.maxDepth) {
            return [this._buildRawValueCard(title, arr, `${arr.length} items`)];
        }

        if (kind === "empty") {
            return [this._buildKeyValueCard(title, [[title, "[]"]])];
        }

        if (kind === "primitives") {
            return [this._buildPrimitiveArrayCard(title, arr)];
        }

        const items = arr.slice(0, opts.maxArrayItems);
        const itemCards = items.map((item, index) => this._buildArrayItemCard(item, index, depth, opts));
        if (arr.length > opts.maxArrayItems) {
            itemCards.push(this._uiMuted(`Showing ${opts.maxArrayItems} of ${arr.length} items.`, "pt-1"));
        }

        const content = itemCards.length > 3
            ? [{ type: "collapse", label: `Show ${items.length}${arr.length > opts.maxArrayItems ? ` of ${arr.length}` : ""} items`, startOpen: false, children: itemCards }]
            : itemCards;

        return [this._buildCard({ title, badge: `${arr.length} items` }, content)];
    }

    _guessSpecForValue(key, value, depth, opts) {
        const label = this.humanizeKey(key);

        if (value && typeof value === "object" && value.type) {
            const resolved = this.resolveUIClass(value.type) || this.ALIAS[this.norm(value.type)];
            if (resolved) return [this._renderExplicitSpec(value, depth, opts)];
        }

        if (this._isPlainObject(value)) {
            return this._buildObjectSection(label, value, depth, opts);
        }

        if (Array.isArray(value)) {
            return this._buildArraySection(label, value, depth, opts);
        }

        if (this._isLongText(value)) {
            return [this._buildCard({ title: label || opts.title || "Value" }, [
                this._uiDiv("text-sm whitespace-pre-wrap break-words leading-relaxed", [this._fmtValue(value, 10000)])
            ])];
        }

        return [this._buildCard({ title: label || opts.title || "Value" }, [
            this._buildValuePill(value)
        ])];
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
        options.maxDepth = Math.max(1, options.maxDepth ?? 4);
        options.maxArrayItems = Math.max(1, options.maxArrayItems ?? 10);
        options.title = options.title || "Slide information";

        const spec = this._guessSpecForValue("", json, 1, options);
        const wrapped = this._uiDiv("space-y-4", spec);
        return this.renderUIFromJson(wrapped, sanitizer);
    }
};

addModule("menu-pages", AdvancedMenuPages);