<?php
/**
 * Generic UI components used throughout the application
 */
?>
<script type="text/javascript">

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
UIComponents.Inputs = {
    text: function(cls, placeholder, funToCall, def) {
        return `<input type="text" class="${cls} form-control" placeholder="${placeholder}" value="${def}" onchange="${funToCall}">`;
    },
    checkBox: function(cls, placeholder, funToCall, def) {
        return `<label style="font-weight: initial;"><input type="checkbox" class="${cls} form-control v-align-middle" ${def?"checked" : ""} onchange="${funToCall}">&nbsp; ${placeholder}</label>`;
    },
    color: function(cls, placeholder, funToCall, def) {
        return `<input type="color" class="${cls} form-control" value="${def}" placeholder="${placeholder}" onchange="${funToCall}">`;
    },
    real: function(cls, placeholder, funToCall, def, min, max) {
        return `<input type="number" class="${cls} form-control" placeholder="${placeholder}" min="${min}" max="${max}" value="${def}" step="0.01" onchange="${funToCall}">`;
    },
    integer: function(cls, placeholder, funToCall, def, min, max) {
        return `<input type="number" class="${cls} form-control" placeholder="${placeholder}" min="${min}" max="${max}" value="${def}" onchange="${funToCall}">`;
    },
    select: function (cls, funToCall, def, values) {
        let options = [];
        for (let key in values) {
            options.push("<option value='", key, "'", key===def ? " selected" : "", ">", values[key], "</option>");
        }
        return `<select class="${cls} form-control" onchange="${funToCall}">${options.join("")}</select>`;
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
UIComponents.Elements = {

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
            let overflow = this.horizontal ? "overflow-x:auto;" : "overflow-y:auto;";

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
        constructor(containerId, builder=UIComponents.Elements.ImageRow, builderOptions={}) {
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
</script>
