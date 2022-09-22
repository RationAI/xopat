/**
 * GUI messaging system:
 *  show(...) and hide(...) to post announcement and notices
 *
 *  showCustom(...) to show a content window with custom HTML content, dependent on unique container ID
 *  showCustomModal(...) to show a content in separate browser window, where
 *      getModalContext(...) will get the context of the window (note: recommended not to store a reference)
 *      if context fails in condition, the window failed to open or is closed by the user
 *      use context.opener to get reference to the original (parent) window
 */

var UIComponents = {};

/**
 * Simplified input controls creation
 */
UIComponents.Elements = {
    /**
     * Render TEXT input
     * @param options
     * @param {string} options.classes classes to assign, space-separated
     * @param {string} options.placeholder hint
     * @param {string || undefined} options.onchange string to evaluate on input change
     * @param {string || *} options.default default value
     * @return {string} HTML for input TEXT field
     */
    textInput: function(options) {
        options = $.extend({classes: "",  placeholder: "", onchange: undefined, default: ""}, options);
        options.onchange = typeof  options.onchange === "string" ? `onchange="${options.onchange}"` : "disabled";
        return `<input type="text" class="${options.classes} form-control" 
placeholder="${options.placeholder}" value="${options.default}" ${options.onchange}>`;
    },
    /**
     * Render Checkbox button
     * @param options
     * @param {string} options.classes classes to assign, space-separated
     * @param {string} options.label
     * @param {string || undefined} options.onchange string to evaluate on input change
     * @param {string || *} options.default default value
     * @return {string} HTML for checkbox
     */
    checkBox: function(options) {
        options = $.extend({classes: "",  label: "", onchange: undefined, default: true}, options);
        options.onchange = typeof  options.onchange === "string" ? `onchange="${options.onchange}"` : "disabled";
        if (options.default === "false") options.default = false;
        return `<label style="font-weight: initial;"><input type="checkbox" 
class="${options.classes} form-control v-align-middle" ${options.default?"checked" : ""} ${options.onchange}>&nbsp; 
${options.label}</label>`;
    },
    /**
     * Render color input
     * @param options
     * @param {string} options.classes classes to assign, space-separated
     * @param {string} options.placeholder hint
     * @param {string || undefined} options.onchange string to evaluate on input change
     * @param {string || *} options.default default value
     * @return {string} HTML for color input
     */
    colorInput: function(options) {
        options = $.extend({classes: "",  placeholder: "", onchange: undefined, default: "#ffffff"}, options);
        options.onchange = typeof  options.onchange === "string" ? `onchange="${options.onchange}"` : "disabled";
        return `<input type="color" class="${options.classes} form-control" value="${options.default}" 
placeholder="${options.placeholder}" ${options.onchange}>`;
    },
    /**
     * Render number input
     * @param options
     * @param {string} options.classes classes to assign, space-separated
     * @param {string} options.placeholder hint
     * @param {string || undefined} options.onchange string to evaluate on input change
     * @param {string || *} options.default default value
     * @param {number} options.min minimum value, default 0
     * @param {number} options.max maximum value, default 1
     * @param {number} options.step allowed increase, default 0.1
     * @return {string} HTML for number input
     */
    numberInput: function(options) {
        options = $.extend({
            classes: "",  placeholder: "", onchange: undefined, default: 0, min: 0, max: 1, step: 0.1
        }, options);
        options.onchange = typeof  options.onchange === "string" ? `onchange="${options.onchange}"` : "disabled";
        return `<input type="number" class="${options.classes} form-control" placeholder="${options.placeholder}" 
min="${options.min}" max="${options.max}" value="${options.default}" step="${options.step}" ${options.onchange}>`;
    },
    /**
     * Render select input
     * @param options
     * @param {string} options.classes classes to assign, space-separated
     * @param {string} options.placeholder hint
     * @param {string || undefined} options.onchange string to evaluate on input change
     * @param {object} options.default default-selected opt_key
     * @param {object} options.options select options, opt_key: 'option text' map
     * @return {string} HTML for select input
     */
    select: function (options) {
        options = $.extend({classes: "",  onchange: undefined, options: {}, default: undefined}, options);
        options.onchange = typeof  options.onchange === "string" ? `onchange="${options.onchange}"` : "disabled";
        let innerContent = [];
        for (let key in options.options) {
            innerContent.push("<option value='", key, "'",
                key===options.default ? " selected" : "", ">", options.options[key], "</option>");
        }
        return `<select class="${options.classes} form-control" ${options.onchange}>${innerContent.join("")}</select>`;
    },
    /**
     * Render header
     * @param options
     * @param {string} options.classes classes to assign, space-separated
     * @param {string} options.title
     * @return {string} HTML for header
     */
    header: function (options) {
        options = $.extend({classes: "", title: "Title"}, options);
        return `<div class="${options.classes} header-sep">${options.title}</div>`;
    },
    /**
     * Render text
     * @param options
     * @param {string} options.classes classes to assign, space-separated
     * @param {string} options.content
     * @return {string} HTML for content text
     */
    text: function (options) {
        options = $.extend({classes: "", content: ""}, options);
        return `<p class="${options.classes}">${options.content}</p>`;
    },
    /**
     * Render newline
     * @param options no options supported as of now
     */
    newline: function (options) {
        return '<br style="clear: both">';
    }
};

/**
 * Single UI Components for re-use, styled and prepared
 * note they are not very flexible, but usefull if you need generic, simple UI
 *
 * They all follow these rules:
 *  - options.id must be defined and is assigned to the very container of the output html
 *  - the same container also has class `[class-name]-container` if SingleComponents.ClassName used
 *  - the content has class `[class-name]`
 */
UIComponents.Components = {

    ImageRow: class {
        /**
         * Build rows UI, pluggable into a container
         * @param contextId
         * @param options
         */
        constructor(contextId, options) {
            this.contextId = contextId;
            this.options = options;
        }

        build(options) {
            if (!options.id) throw "Row must be uniquely identifiable - missing options.id!";
            let icon = options.icon || "assets/image.png";
            let details = options.details || "";
            let contentAction = options.contentAction ? `<div>${options.contentAction}</div>` : "";
            let customContent = options.customContent || "";

            return `<div id="${options.id}" class="image-row-container">
<div>
<div class="width-full d-flex image-row">
<img src="${icon}" class="d-block m-2 rounded-2" style="height: 40px;">
<div class="d-flex flex-column" style="flex-grow: 1;"><div class="f3-light">${options.title}</div><div class="text-small">${details}</div></div>
${contentAction}
</div>${customContent}</div></div>`;
        };

        attachHeader() {
            return "";
        }
    },

    SelectableImageRow: class {
        /**
         * Build rows UI, pluggable into a container
         * @param contextId
         * @param options
         * @param options.id unique id for this builder
         * @param options.multiselect true if multiple rows can be selected
         */
        constructor(contextId, options) {
            this.contextId = contextId;
            this.options = options;
        }

        build(options) {
            if (!options.id) throw "Row must be uniquely identifiable - missing options.id!";
            let input = this.options.multiselect ? "checkbox" : "radio";
            let icon = options.icon || "assets/image.png";
            let details = options.details || "";
            let contentAction = options.contentAction ? `<div>${options.contentAction}</div>` : "";
            let customContent = options.customContent || "";
            let selected = options.selected ? "checked" : "";

            return `<div id="${options.id}" class="selectable-image-row-container">
<input type="${input}" name="${this.options.id}" ${selected} class="d-none selectable-image-row-context" value="${options.value}">
<div class="width-full d-flex selectable-image-row rounded-2 pointer" onclick="$(this.previousElementSibling).click();">
<img src="${icon}" class="d-block m-2 rounded-2" style="height: 40px;">
<div class="d-flex flex-column" style="flex-grow: 1;"><div class="f3-light">${options.title}</div><div class="text-small">${details}</div></div>
${contentAction}
</div>${customContent}</div>`;
        }

        getSelected() {
            let values = [];
            $(document.getElementById(this.contextId)).find(`input.selectable-image-row-context`).each((i, ch) => {
                if (ch.checked) values.push(ch.value);
            });
            return values;
        }

        selectAll() {
            $(document.getElementById(this.contextId)).find(`input.selectable-image-row-context`).each((i, ch) => ch.checked = true);
        }

        deselectAll() {
            $(document.getElementById(this.contextId)).find(`input.selectable-image-row-context`).each((i, ch) => ch.checked = false);
        }

        attachHeader() {
            //todo...?
            let container = document.createElement("div");
            container.classList.add("d-flex", "flex-row-reverse");
            let btn = document.createElement("button");
            btn.onclick = this.selectAll.bind(this);
            btn.innerHTML = "Select All";
            btn.classList.add("btn", "btn-sm", "mb-2", "mx-1");
            container.append(btn);
            btn = document.createElement("button");
            btn.onclick = this.deselectAll.bind(this);
            btn.innerHTML = "Deselect All";
            btn.classList.add("btn", "btn-sm", "mb-2", "mx-1");
            container.append(btn);
            document.getElementById(this.contextId).prepend(container);
        }
    },
};

UIComponents.Containers = {

    PanelMenu: class {
        constructor(containerId) {
            this.context = document.getElementById(containerId);
            this.uid = containerId;
            this.menuReversed = false;
            this.menuShow = false;
            this.horizontal = true;
            this.fullbody = false;
            this.elements = [];
            if (!this.context) throw "PanelMenu(): invalid initialization: container does not exist!";
            this._updateBorder();
        }

        get height() {
            return this.context.offsetHeight;
        }

        get width() {
            return this.context.offsetWidth;
        }

        set isHorizontal(value) {
            this.horizontal = value;
            this._updateBorder();
        }

        set isMenuBelow(value) {
            this.menuReversed = value;
            this._updateBorder();
        }

        _updateBorder() {
            this.borderClass = this.menuReversed ?
                (this.horizontal ? "panelmenu-top" : "panelmenu-left") :
                (this.horizontal ? "panelmenu-bottom" : "panelmenu-right");
        }

        set menuWith1Element(value) {
            this.menuShow = value;
        }

        set isFullSize(value) {
            this.fullbody = value;
        }

        get isVisible() {
            return this.context.style.display !== 'none';
        }

        isOpened(focus) {
            if (focus) return this.isVisible && document.getElementById(focus)?.style.display === 'block';
            return this.isVisible;
        }

        hide() {
            this.context.style.display = 'none';
        }

        show(focus) {
            if (focus) {
                let focused = document.getElementById(`${focus}-input-header`);
                if (focused) focused.click();
            }
            this.context.style.display = 'block';
        }

        setNotify(focus, sign=undefined) {
            if (focus) {
                let focused = document.getElementById(`${focus}-input-header`);
                if (focused && !focused.checked) {
                    focused = $(`#${focus}-input-header+label`).get(0);
                    if (!focused) return;
                    let data = Number.parseInt(focused.dataset.notification);
                    if (!data) {
                        focused.classList.remove('animate'); //toggle animation
                        focused.classList.add('animate', 'notification');
                        data = 0;
                    }
                    focused.dataset.notification = sign || data+1;
                }
            }
        }

        //todo get rid of plugin ID? assign just to the parent container outside!
        set(pluginId, id, title, html, icon="") {
            let existing = this.elements.find(x => x === id);
            if (existing !== undefined) {
                $(`#${existing}-header`).replaceWith(this._getHeader(pluginId, id, title, icon));
                $(`#${existing}`).replaceWith(this._getBody(pluginId, id, title, icon));
                return;
            }

            if (this.elements.length < 1) {
                this._createLayout(pluginId, id, title, icon, html);
            } else {
                this.head.innerHTML += this._getHeader(pluginId, id, title, icon);
                this.body.innerHTML += this._getBody(pluginId, id, html);
                this.head.style.display = "flex";
            }
            this.elements.push(id);
        }

        removePart(pluginId, id) {
            let existing = this.elements.find(x => x === id);
            if (existing !== undefined) {
                this.elements.splice(existing, 1);
                let header = $(`#${id}-header`),
                    headerLabel = header.next();
                header.remove();
                headerLabel.remove();
                $(`#${id}`).remove();
            }
        }

        remove() {
            delete this.head;
            delete this.body;
            $(this.context).remove();
            delete this.context;
            delete this.elements;
        }

        _createLayout(pluginId, id, firstTitle, icon, html) {
            let head = `<div id="${this.uid}-head" class="flex-items-start ${this.horizontal ? "windth-full px-3 flex-row" : "height-full py-3 flex-column"}"
style="${this.menuShow ? 'display:flex;' : 'display:none;'} ${this.horizontal ? "height: 32px;" : "width: 120px; min-width: 120px; text-align: right;"} background: var(--color-bg-tertiary); z-index: 2">
${this._getHeader(pluginId, id, firstTitle, icon, true)}</div>`;
            let flexD;
            if (this.horizontal) flexD = this.menuReversed ? "flex-column-reverse panel-horizontal" : "flex-column panel-horizontal";
            else flexD = "flex-row panel-vertical";
            let sizeD;
            if (this.fullbody) sizeD = "width-full height-full";
            else sizeD = this.horizontal ? "width-full" : "height-full";
            let overflow = this.horizontal ? "overflow-x:auto;overflow-y:hidden;" : "overflow-y:auto;overflow-x:hidden;";

            let body = `<div id="${this.uid}-body" class="panel-menu-content ${sizeD} position-relative" style="${overflow}">${this._getBody(pluginId, id, html, true)}</div>`;
            this.context.innerHTML = `<div class="panel-menu d-flex ${sizeD} ${flexD}">${head + body}</div>`;
            this.head = this.context.children[0].children[0];
            this.body = this.context.children[0].children[1];
        }

        _getHeader(pluginId, id, title, icon, isFirst=false) {
            pluginId = pluginId ? pluginId + "-plugin-root" : "";
            icon = icon ? `<span class="material-icons" style="font-size: 14px; padding-bottom: 3px;">${icon}</span>` : "";
            return `<input type="radio" name="${this.uid}-header" ${isFirst ? "checked" : ""} id="${id}-input-header"
class="panel-menu-input ${pluginId}" onclick="
for (let ch of document.getElementById('${this.uid}-body').childNodes) {ch.style.display = 'none'}
document.getElementById('${id}').style.display='block'; let head=this.nextSibling;head.classList.remove('notification');
head.dataset.notification='0';"><label for="${id}-input-header" class="pointer ${pluginId} ${this.borderClass}
panel-menu-label" data-animation="popIn">${icon}${title}</label>`;
        }

        _getBody(pluginId, id, html, isFirst=false) {
            pluginId = pluginId ? pluginId + "-plugin-root" : "";
            let size = this.horizontal ? "width-full" : "height-full";
            return `<section id="${id}" class="${pluginId} position-relative ${size}" style="${isFirst ? '' : 'display: none;'}">${html}</section>`;
        }
    },

    //Enhancement: let creator own builder and just accept plain html
    RowPanel: class {
        constructor(containerId, builder=UIComponents.Components.ImageRow, builderOptions={}) {
            this.context = document.getElementById(containerId);
            this.builder = new builder(containerId, builderOptions);
            this.uid = containerId;
            if (!this.context) throw "RowPanel(): invalid initialization: container does not exist!";
            this.context.innerHTML = `<div></div>`;
            this.rows = [];
            this.count = 0;
            this.contentClass = "row-panel";
            this.context = $(this.context.childNodes[0]);
        }

        addRow(options) {
            options.id = `${this.uid}-row-${this.count++}`;
            options.customClass = this.contentClass;
            this.context.append(this.builder.build(options))
            //this.rows.push(this.context.append(this.rowBuilder(options)));
        }

        clear() {
            this.context.html("");
        }
    },
};
