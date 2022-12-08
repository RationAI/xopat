window.AdvancedMenuPages = class {

    vegaInit = {};

    /**
     * @param pluginId
     */
    constructor(pluginId) {
        this.id = "menu-pages";
        this.uid = pluginId;
        this._count = 0;
    }

    /**
     * Allowed types of page[] are either 'vega', 'columns' or 'newline' or types of UIComponents.Elements
     * Columns
     * @param {array} output array to put the output strings to
     * @param {object} root configuration node with 'type' property
     * @param {function|false} sanitizer to sanitize strings, or false to not to sanitize
     * @type {{}}
     */
    buildElements(output, root, sanitizer) {
        root.classes = root.classes || "m-2 px-1";
        let classes;
        try {
            switch (root.type) {
                case 'vega':
                    classes = root.classes ? (sanitizer ? sanitizer(root.classes) : root.classes) : "";
                    let uid = `vega-${Date.now()}`;
                    output.push(`<div class="${classes}" id="${uid}"></div>`);
                    this.vegaInit[uid] = root;
                    break;
                case 'columns':
                    classes = root.classes ? (sanitizer ? sanitizer(root.classes) : root.classes) : "";
                    output.push(`<div class="d-flex ${classes}">`);
                    for (let col of root.children) {
                        col.classes = (col.hasOwnProperty('classes') ? col.classes : "") + " flex-1";
                        this.buildElements(output, col, sanitizer);
                    }
                    output.push('</div>');
                    break;
                default:
                    function sanitizeDeep(node) {
                        const t = typeof node;
                        if (t === "string") return sanitizer(node);
                        if (Array.isArray(node)) return node.map(sanitizeDeep);
                        if (t === "object") {
                            const result = {};
                            for (let p in node) result[p] = sanitizeDeep(node[p]);
                            return result;
                        }
                        throw "Sanitization failed: possibly malicious or invalid object " + typeof node;
                    }
                    const result = UIComponents.Elements[root.type]?.(sanitizeDeep(root));
                    result && output.push(result);
                    break;
            }
        } catch (e) {
            console.warn("AdvancedMenuPages: Failed to generate HTML.", root, e);
            output.push(`<div class="error-container">${$.t('elementsBuilderErr')}</div>`);
        }
    }

    loadVega(initialized=false) {
        for (let id in this.vegaInit) {
            let object = this.vegaInit[id];
            if (object.view) continue;
            if (!window.vega || !window.vega.View) {
                if (initialized) throw "Could not load vega: ignoring vega components.";

                const _this = this;
                UTILITIES.loadModules(function() {
                    _this.loadVega(true);
                }, 'vega');
                return;
            }

            delete this.vegaInit[id];
            object.view = new vega.View(vega.parse(object.specs), {renderer: 'canvas', container: `#${id}`, hover: true});
            object.view.runAsync();
        }
    }

    _build(config, sanitizer) {
        let parent, parentUnique;

        for (let data of config) {
            let html = [];

            if (!data.title || !data.page) {
                console.warn("Config for advanced manu pages missing title or page props - skipping!");
                continue;
            }

            for (let element of (data.page || [])) {
                this.buildElements(html, element, sanitizer);
            }

            if (!parent || data.main) {
                parentUnique = "-"+(++this._count)+"-module-menu-pages";
                parent = '__builder-' + this._count;
            }

            let unique = this.uid + "-" + (++this._count) + "-module-data-page";
            USER_INTERFACE.AdvancedMenu._buildMenu(this, parent,
                'pages-menu' + parentUnique,
                data.title,
                unique,
                unique,
                data.subtitle || data.title,
                html.join(""),
                data.icon || "",
                true,
                true);
        }
        this.loadVega();
    }

    /**
     * Allowed types of page[] are either 'vega', 'columns' or 'newline' or types of UIComponents.Elements
     * Columns
     * @param {object} config array of objects - page specs
     * @param {boolean|object} sanitizeConfig configuration (see https://github.com/apostrophecms/sanitize-html)
     *   or simple on/off flag for default behaviour
     * @type {{}}
     */
    buildMetaDataMenu(config, sanitizeConfig=false) {
        if (typeof sanitizeConfig === "object") {
            const _this = this;
            UTILITIES.loadModules(() => {
                _this._build(config, str => SanitizeHtml(str, sanitizeConfig));
            }, 'sanitize-html');
        } else if (sanitizeConfig) {
            const _this = this;
            UTILITIES.loadModules(() => {
                _this._build(config, str => SanitizeHtml(str));
            }, 'sanitize-html');
        } else {
            this._build(config, false);
        }
    }
};
