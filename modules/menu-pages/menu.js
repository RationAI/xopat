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
     * todo some sanitization of raw fields, e.g. 'classes'
     * @type {{}}
     */
    buildElements(root) {
        let html = [];
        root.classes = root.classes || "m-2 px-1";
        try {
            switch (root.type) {
                case 'vega':
                    let uid = `vega-${Date.now()}`;
                    html.push(`<div class="${root.classes}" id="${uid}"></div>`);
                    this.vegaInit[uid] = root;
                    break;
                case 'columns':
                    html.push(`<div class="d-flex ${root.classes}">`);
                    for (let col of root.children) {
                        col.classes = (col.hasOwnProperty('classes') ? col.classes : "") + " flex-1";
                        html.push(...this.buildElements(col));
                    }
                    html.push('</div>');
                    break;
                default:
                    html.push(UIComponents.Elements[root.type](root));
                    break;
            }
        } catch (e) {
            console.warn("Failed to generate HTML.", root, e);
            return [`<div class="error-container">${$.t('elementsBuilderErr')}</div>`];
        }
        return html;
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

    buildMetaDataMenu(config) {
        let parent, parentUnique;

        for (let data of config) {
            let html = [];

            if (!data.title || !data.page) {
                console.warn("Config for advanced manu pages missing title or page props - skipping!");
                continue;
            }

            for (let element of (data.page || [])) {
                html.push(...this.buildElements(element));
            }

            if (!parent || data.main) {
                parentUnique = "-"+(++this._count)+"-module-menu-pages";
                parent = '__builder-' + this._count;
            }

            let unique = this.uid + "-" + (++this._count) + "-module-data-page";

            console.log(parentUnique, unique)

            USER_INTERFACE.AdvancedMenu._buildMenu(this, parent,
                'pages-menu' + parentUnique,
                data.title,
                unique,
                unique,
                data.subtitle || data.title,  html.join(""),
                data.icon || "",
                true,
                true);
        }
        this.loadVega();
    }
};
