/*
 * GUI messaging system:
 *  show(...) and hide(...) to post announcement and notices
 *
 *  showCustom(...) to show a content window with custom HTML content, dependent on unique container ID
 *  showCustomModal(...) to show a content in separate browser window, where
 *      getModalContext(...) will get the context of the window (note: recommended not to store a reference)
 *      if context fails in condition, the window failed to open or is closed by the user
 *      use context.opener to get reference to the original (parent) window
 */

/**
 * Queue
 * @class xoQueue
 */
window.xoQueue = class {
    constructor(size) {
        this.SIZE = size;
        this._items = {};
    }

    /**
     * Add to queue
     * @param {*} item
     */
    add(item) {
        this._items[this._incr()] = item;
    }

    /**
     * Remove item that is present for the longest in queue
     * @return {*}
     */
    pop() {
        let item = this._items[this._i];
        delete this._items[this._i];
        this._decr();
        return item;
    }
    _incr(){
        return (this._i = this._i + 1) % this.SIZE;
    }
    _decr() {
        return (this._i = this._i > 0 ? this._i - 1 : this.SIZE)
    }
}

/**
 * UI Components: Available Components and UI Element Builder API
 * @namespace UIComponents
 */
var UIComponents = /** @lends UIComponents */ {
    /**
     * Simplified JSON to HTML node builders for unified UI
     * @namespace UIComponents.Elements
     *
     * TODO: build unique changed method that would allways receive a string / parsed value
     *   regardless of the type
     */
    Elements: /** @lends UIComponents.Elements */ {
        /**
         * Render TEXT input
         * @param options
         * @param {string?} options.classes classes to assign, space-separated
         * @param {string?} options.placeholder hint
         * @param {(string|undefined)} options.onchange Deprecated: string to evaluate on input change
         * @param {string?} options.changed JS code (string) to evaluate on change, the parsed value is available
         *   as a local 'value' variable.
         * @param {*?} options.default default value
         * @return {string} HTML for input TEXT field
         */
    textInput: function(options) {
            //todo remove onchange in the future
        options = $.extend({classes: "",  placeholder: "", onchange: undefined, default: ""}, options);
            if (options.changed) {
                options.onchange = `onchange="let value=this.value;${options.changed}"`;
            } else {
                options.onchange = typeof options.onchange === "string" ? `onchange="${options.onchange}"` : "disabled";
            }
            return `<input type="text" class="${options.classes} form-control" 
placeholder="${options.placeholder}" value="${options.default}" ${options.onchange}>`;
        },
        /**
         * Render Checkbox button
         * @param options
         * @param {string?} options.classes classes to assign, space-separated
         * @param {string?} options.label
         * @param {(string|undefined)} options.onchange Deprecated: string to evaluate on input change
         * @param {string?} options.changed JS code (string) to evaluate on change, the parsed value is available
         *   as a local 'value' variable.
         * @param {*?} options.default default value
         * @return {string} HTML for checkbox
         */
    checkBox: function(options) {
        options = $.extend({classes: "",  label: "", onchange: undefined, default: true}, options);
            if (options.changed) {
                options.onchange = `onchange="let value=!!this.checked;${options.changed}"`;
            } else {
                options.onchange = typeof options.onchange === "string" ? `onchange="${options.onchange}"` : "disabled";
            }
            if (options.default === "false") options.default = false;
            return `<label style="font-weight: initial;" class="btn-pointer"><input type="checkbox" 
class="${options.classes} form-control v-align-middle" ${options.default ? "checked" : ""} ${options.onchange}>&nbsp; 
${options.label}</label>`;
        },
        /**
         * Render color input
         * @param options
         * @param {string?} options.classes classes to assign, space-separated
         * @param {string?} options.placeholder hint
         * @param {(string|undefined)} options.onchange Deprecated: string to evaluate on input change
         * @param {string?} options.changed JS code (string) to evaluate on change, the parsed value is available
         *   as a local 'value' variable (string, not an array).
         * @param {*?} options.default default value
         * @return {string} HTML for color input
         */
    colorInput: function(options) {
        options = $.extend({classes: "",  placeholder: "", onchange: undefined, default: "#ffffff"}, options);
            if (options.changed) {
                options.onchange = `onchange="let value=this.value;${options.changed}"`;
            } else {
                options.onchange = typeof options.onchange === "string" ? `onchange="${options.onchange}"` : "disabled";
            }
            return `<input type="color" class="${options.classes} form-control" value="${options.default}" 
placeholder="${options.placeholder}" ${options.onchange}>`;
        },
        /**
         * Render number input
         * @param options
         * @param {string?} options.classes classes to assign, space-separated
         * @param {string?} options.placeholder hint
         * @param {(string|undefined)} options.onchange Deprecated: string to evaluate on input change
         * @param {string?} options.changed JS code (string) to evaluate on change, the parsed value is available
         *   as a local 'value' variable.
         * @param {*?} options.default default value
         * @param {number?} options.min minimum value, default 0
         * @param {number?} options.max maximum value, default 1
         * @param {number?} options.step allowed increase, default 0.1
         * @return {string} HTML for number input
         */
    numberInput: function(options) {
            options = $.extend({
            classes: "",  placeholder: "", onchange: undefined, default: 0, min: 0, max: 1, step: 0.1
            }, options);
            if (options.changed) {
                let parser = Number.isInteger(options.step) ? "parseInt" : "parseFloat";
                options.onchange = `onchange="let value=Number.${parser}(this.value);${options.changed}"`;
            } else {
                options.onchange = typeof options.onchange === "string" ? `onchange="${options.onchange}"` : "disabled";
            }
            return `<input type="number" class="${options.classes} form-control" placeholder="${options.placeholder}" 
min="${options.min}" max="${options.max}" value="${options.default}" step="${options.step}" ${options.onchange}>`;
        },
        /**
         * Render select input
         * @param options
         * @param {string?} options.classes classes to assign, space-separated
         * @param {string?} options.placeholder hint
         * @param {(string|undefined)} options.onchange Deprecated: string to evaluate on input change
         * @param {string?} options.changed JS code (string) to evaluate on change, the parsed value is available
         *   as a local 'value' variable.
         * @param {object?} options.default default-selected opt_key
         * @param {object?} options.options select options, opt_key: 'option text' map
         * @return {string} HTML for select input
         */
    select: function(options) {
        options = $.extend({classes: "",  onchange: undefined, options: {}, default: undefined}, options);
            if (options.changed) {
                options.onchange = `onchange="let value=this.value;${options.changed}"`;
            } else {
                options.onchange = typeof options.onchange === "string" ? `onchange="${options.onchange}"` : "disabled";
            }
            let innerContent = [], optsArray = Array.isArray(options.options);
            for (let key in options.options) {
                const name = options.options[key], val = optsArray ? name : key;
            innerContent.push("<option value='", val, "'", val===options.default ? " selected" : "", ">", name, "</option>");
            }

            return `<select class="${options.classes} form-control" ${options.onchange}>${innerContent.join("")}</select>`;
        },
        /**
         * Render number array
         * note: the parsed content can be retrieved as this.values
         * @param options
         * @param {string?} options.classes classes to assign, space-separated
         * @param {(string|undefined)} options.onchange Deprecated: string to evaluate on input change
         * @param {string?} options.changed JS code (string) to evaluate on change, the parsed value is available
         *   as a local 'value' variable.
         * @param {(number|array)} options.default a list of default values or the desired array length
         * @return {string} HTML for select input
         */
    numberArray: function(options) {
        options = $.extend({classes: "",  onchange: undefined, options: {}, default: undefined}, options);
            if (options.changed) {
                options.onchange = `onchange="
try {
    let value = JSON.parse(this.value);
    if (!Array.isArray(value)) throw 'Cannot parse number array!';
    else value = values.map(Number.parseFloat);
    ${options.changed}
} catch(e) { console.warn(e); this.style.background = 'var(--color-bg-danger-inverse)'; }"`;
            } else {
            options.onchange = typeof  options.onchange === "string" ? `onchange="
try {
    let values = JSON.parse(this.value);
    if (!Array.isArray(values)) throw 'Cannot parse number array!';
    else this.values = values.map(Number.parseFloat);
    ${options.onchange}
} catch(e) { console.warn(e); this.style.background = 'var(--color-bg-danger-inverse)'; }"` : "disabled";
            }

        return `<textarea placeholder="[1,2,3]" rows="1" class="${options.classes} form-control" ${options.onchange}>${
            JSON.stringify(Array.isArray(options.default) ? options.default : new Array(options.default))}</textarea>`;
        },
        /**
         * Render header
         * @param options
         * @param {string?} options.classes classes to assign, space-separated
         * @param {string?} options.title
         * @return {string} HTML for header
         */
    header: function(options) {
        options = $.extend({classes: "", title: "Title"}, options);
            return `<div class="${options.classes} header-sep">${options.title}</div>`;
        },
        /**
         * Render text
         * @param options
         * @param {string?} options.classes classes to assign, space-separated
         * @param {string?} options.content
         * @return {string} HTML for content text
         */
    text: function(options) {
        options = $.extend({classes: "", content: ""}, options);
            return `<p class="${options.classes}">${options.content}</p>`;
        },
        /**
         * Render button
         * @param options
         * @param {string?} options.classes classes to assign, space-separated
         * @param {string?} options.title
         * @param {string?} options.action
         * @return {string} HTML for button
         */
    button: function(options) {
        options = $.extend({classes: "", content: ""}, options);
            return `<button class="btn ${options.classes}" onclick="${options.action}">${options.title}</button>`;
        },
        /**
         * Render newline
         * @param options no options supported as of now
         */
    newline: function(options) {
            return '<br style="clear: both">';
        }
    },

    /**
     * UI Actions
     * functions that enable more complex UI interaction
     * @namespace UIComponents.Actions
     */
    Actions: {
        /**
         * Makes children in a parent draggable. These children might contain other elements you want to
         * prevent the dragging on: such children need 'non-draggable' class
         * (at least one between the dragged item and the child in hierarchy)
         * @param {string|Node} parentContainerId parent ID that keeps elements for which dragging will be enabled
         * @param onEnabled called for each child upon initialization, the element node is passed as argument
         * @param onStartDrag called before the dragging starts, the param is the event of the drag,
         *    returns true if the dragging should really start, false if not
         * @param onEndDrag called when the element is dropped at some position, the param is the event of the drag
         *    the dom node that triggered the change: event.target
         * @return function to call for any other elements manually, note! these should be also direct children of
         *    parentContainerId (i.e. adding more dynamically later).
         *  note: use 'non-draggable' on inner content to prevent it from triggering the dragging
         *  note: dragged item is always assigned 'drag-sort-active' class
         *  note: events are attached to DOM tree, not the structure
         *        - content changes in DOM involving your nodes destroys events;
         *  hint: use node.dataset.<> API to store and retrieve values within items
         */
    draggable: (parentContainerId, onEnabled=undefined, onStartDrag=undefined, onEndDrag=undefined) => {
            const children = typeof parentContainerId === "string" ?
                document.getElementById(parentContainerId)?.children : parentContainerId.children;
            if (!children) throw "Actions::draggable needs valid parent ID to access an element in DOM!";
        Array.prototype.forEach.call(children, (item) => {enableDragItem(item)});

            function enableDragItem(item) {
                const isPrevented = (element, cls) => {
                    let currentElem = element;
                    let isParent = false;

                    while (currentElem) {
                    const hasClass = Array.from(currentElem.classList).some(elem => {return cls === elem;});
                        if (hasClass) {
                            isParent = true;
                            currentElem = undefined;
                        } else {
                            currentElem = currentElem.parentElement;
                        }
                    }
                    return isParent;
                };
                item.setAttribute('draggable', true);
                item.ondragstart = typeof onStartDrag === "function" ? e => {
                    if (!onStartDrag(e) || isPrevented(document.elementFromPoint(e.x, e.y), 'non-draggable')) {
                        e.preventDefault();
                    }
                } : e => {
                    if (isPrevented(document.elementFromPoint(e.x, e.y), 'non-draggable')) e.preventDefault();
                };
                item.ondrag = (item) => {
                    const selectedItem = item.target,
                        list = selectedItem.parentNode,
                        x = event.clientX,
                        y = event.clientY;

                    selectedItem.classList.add('drag-sort-active');
                    let swapItem = document.elementFromPoint(x, y) === null ? selectedItem : document.elementFromPoint(x, y);

                    if (list === swapItem.parentNode) {
                        swapItem = swapItem !== selectedItem.nextSibling ? swapItem : swapItem.nextSibling;
                        list.insertBefore(selectedItem, swapItem);
                    }
                };
                item.ondragend = typeof onEndDrag === "function" ? item => {
                    item.target.classList.remove('drag-sort-active');
                    onEndDrag(item);
                } : item => {
                    item.target.classList.remove('drag-sort-active');
                };
                typeof onEnabled === "function" && onEnabled(item);
            }
            return enableDragItem;
        }
    },

    /**
     * Single UI Components for re-use, styled and prepared
     * note they are not very flexible, but usefull if you need generic, simple UI
     *
     * TODO: create interfaces
     *
     * They all follow these rules:
     *  - options.id must be defined and is assigned to the very container of the output html
     *  - the same container also has class `[class-name]-container` if SingleComponents.ClassName used
     *  - the content has class `[class-name]`
     * @namespace UIComponents.Components
     */
    Components: /** @lends UIComponents.Components */ {
        /**
         * Create a Row
         */
        ImageRow: class {
            /**
             * Build rows UI, pluggable into a container
             * @param {undefined} options unused
             */
        constructor(options=undefined) {
                this.options = options;
            }

            /**
             * Generates the HTML
             * @param options.id
             * @param options.title
             * @param options.icon
             * @param options.details
             * @param options.contentAction
             * @param options.customContent
             * @param options.containerStyle
             * @return {string}
             * @memberOf UIComponents.Components.ImageRow
             */
            build(options) {
                if (!options.id) throw "Row must be uniquely identifiable - missing options.id!";
                let icon = options.icon || (options.icon !== "" ? APPLICATION_CONTEXT.url + "src/assets/image.png" : "");
                if (icon && !icon.includes('<')) {
                    icon = `<img src="${icon}" class="block m-2 rounded-md" style="height: 40px;">`;
                }
                //else HTML code - leave as is

                let details = options.details || "";
                let contentAction = options.contentAction ? `<div>${options.contentAction}</div>` : "";
                let customContent = options.customContent || "";
                let style = options.containerStyle ? `style="${options.containerStyle}"` : "";

                return `<div id="${options.id}" class="image-row-container" ${style}>
<div>
<div class="w-full flex image-row">
${icon}
<div class="flex flex-col" style="flex-grow: 1;"><div class="text-lg font-semibold">${options.title}</div><div class="text-sm opacity-70">${details}</div></div>
${contentAction}
</div>${customContent}</div></div>`;
            };

            /**
             * Does not have any
             * @return empty string
             * @memberOf UIComponents.Components.ImageRow
             */
            attachHeader() {
                return "";
            }
        },

        /**
         * todo: consider making selectable parent instead...
         */
        SelectableImageRow: class {
            /**
             * Build rows UI, pluggable into a container
             * @param options
             * @param options.id unique id for this builder
             * @param options.multiselect true if multiple rows can be selected
             * @param options.containerId
             */
            constructor(options) {
                this.contextId = options.containerId;
                if (!this.contextId) throw "Selectable row requires options.contextId property!";
                this.options = options;
            }

            /**
             * Generates the HTML
             * @param options.id
             * @param options.title
             * @param options.icon
             * @param options.details
             * @param options.contentAction
             * @param options.customContent
             * @param options.containerStyle
             * @return {string}
             * @memberOf UIComponents.Components.SelectableImageRow
             */
            build(options) {
                if (!options.id) throw "Row must be uniquely identifiable - missing options.id!";
                let input = this.options.multiselect ? "checkbox" : "radio";
                let icon = options.icon || (options.icon !== "" ? APPLICATION_CONTEXT.url + "src/assets/image.png" : "");
                if (icon && !icon.includes('<')) {
                    icon = `<img src="${icon}" class="block m-2 rounded-md" style="height: 40px;">`;
                }
                //else HTML code - leave as is

                let details = options.details || "";
                let contentAction = options.contentAction ? `<div>${options.contentAction}</div>` : "";
                let customContent = options.customContent || "";
                let selected = options.selected ? "checked" : "";
                let style = options.containerStyle ? `style="${options.containerStyle}"` : "";

                return `<div id="${options.id}" class="selectable-image-row-container" ${style}>
<input type="${input}" name="${this.options.id}" ${selected} class="hidden selectable-image-row-context" value="${options.value}">
<div class="w-full flex selectable-image-row rounded-md cursor-pointer" onclick="$(this.previousElementSibling).click();">
${icon}
<div class="flex flex-col" style="flex-grow: 1;"><div class="text-lg font-semibold">${options.title}</div><div class="text-sm opacity-70">${details}</div></div>
${contentAction}
</div>${customContent}</div>`;
            }

            getSelected() {
                let values = [];
                $(document.getElementById(this.contextId)).find('input.selectable-image-row-context').each((i, ch) => {
                    if (ch.checked) values.push(ch.value);
                });
                return values;
            }

            selectAll() {
                $(document.getElementById(this.contextId)).find('input.selectable-image-row-context').each((i, ch) => ch.checked = true);
            }

            deselectAll() {
                $(document.getElementById(this.contextId)).find('input.selectable-image-row-context').each((i, ch) => ch.checked = false);
            }

            attachHeader() {
                //todo not working, although JS seems fine
                // let container = document.createElement("div");
                // container.classList.add("d-flex", "flex-row-reverse");
                // let btn = document.createElement("button");
                // btn.onclick = this.selectAll.bind(this);
                // btn.innerHTML = $.t('common.selectAll');
                // btn.classList.add("btn", "btn-sm", "mb-2", "mx-1");
                // container.append(btn);
                // btn = document.createElement("button");
                // btn.onclick = this.deselectAll.bind(this);
                // btn.innerHTML = $.t('common.deselectAll');
                // btn.classList.add("btn", "btn-sm", "mb-2", "mx-1");
                // container.append(btn);
                // document.getElementById(this.contextId).prepend(container);
            }
        },
    },

    /**
     * Container Builders that auto-layout provided content
     * @namespace UIComponents.Containers
     */
    Containers: /** @lends UIComponents.Containers */ {
        /**
         *
         */
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

            /**
             * Show tab notification
             * @param {string} focus id of the focus
             * @param {(string|undefined)} sign custom symbol to show, shows counter of calls if undefined
             * @memberOf UIComponents.Containers.PanelMenu
             */
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

            /**
             * Set another tab to the panel
             * @param entityId id of the entity owning this element, in the case of error,
             *  all classes with 'entityId' are removed for consistency by the CORE (i.e. use plugin ID)
             * @param id of the panel, does not have to be unique in DOM (but recommended to avoid problems);
             *  entityId and id pair uniquely determines the tab
             * @param title the tab button title
             * @param html the tab content
             * @param icon the icon name for button, default ""
             * @param bodyId unique container ID in the DOM context (can be the same as id if unique) ->
             *   this id can be accessed to further modify this container contents
             * @memberOf UIComponents.Containers.PanelMenu
             */
        set(entityId, id, title, html, icon="", bodyId=id) {
                let existing = this.elements.find(x => x === id);
                if (existing !== undefined) {
                    $(`#${existing}-menu-header`).replaceWith(this._getHeader(entityId, id, title, icon, false, bodyId));
                    $(`#${bodyId}`).replaceWith(this._getBody(entityId, id, html, false, bodyId));
                    return;
                }

                if (this.elements.length < 1) {
                    this._createLayout(entityId, id, title, icon, html, bodyId);
                } else {
                    $(this.head).append(this._getHeader(entityId, id, title, icon, false, bodyId));
                    $(this.body).append(this._getBody(entityId, id, html, false, bodyId));
                    this.head.style.display = "flex";
                }
                this.elements.push(id);
            }

            removePart(entityId, id) {
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

            _createLayout(entityId, id, firstTitle, icon, html, bodyId) {
                let head = `<div id="${this.uid}-head" class="flex-items-start ${this.horizontal ? "windth-full px-3 flex-row" : "height-full py-3 flex-column"}"
    style="${this.menuShow ? 'display:flex;' : 'display:none;'} ${this.horizontal ? "height: 32px;" : "width: 120px; min-width: 120px; text-align: right;"} background: var(--color-bg-tertiary); z-index: 2">
    ${this._getHeader(entityId, id, firstTitle, icon, true, bodyId)}</div>`;
                let flexD;
                if (this.horizontal) flexD = this.menuReversed ? "flex-column-reverse panel-horizontal" : "flex-column panel-horizontal";
                else flexD = "flex-row panel-vertical";
                let sizeD;
                if (this.fullbody) sizeD = "width-full height-full";
                else sizeD = this.horizontal ? "width-full" : "height-full";
                let overflow = this.horizontal ? "overflow-x:auto;overflow-y:hidden;" : "overflow-y:auto;overflow-x:hidden;";

                let body = `<div id="${this.uid}-body" class="panel-menu-content ${sizeD} position-relative" style="${overflow}">
    ${this._getBody(entityId, id, html, true, bodyId)}</div>`;
                this.context.innerHTML = `<div class="panel-menu d-flex ${sizeD} ${flexD}">${head + body}</div>`;
                this.head = this.context.children[0].children[0];
                this.body = this.context.children[0].children[1];
            }

            _getHeader(entityId, id, title, icon, isFirst, bodyId) {
                entityId = entityId ? entityId + "-plugin-root" : "";
                icon = icon ? `<span class="fa-auto ${icon}" style="font-size: 14px; padding-bottom: 3px;"></span>` : "";
                return `<span id="${id}-menu-header" class="width-full" style="flex-basis: min-content">
    <input type="radio" name="${this.uid}-header" ${isFirst ? "checked" : ""} id="${id}-input-header"
    class="panel-menu-input ${entityId}" onclick="
    for (let ch of document.getElementById('${this.uid}-body').children) {ch.style.display = 'none'}
    document.getElementById('${bodyId}').style.display='block'; let head=this.nextSibling;head.classList.remove('notification');
    head.dataset.notification='0';"><label for="${id}-input-header" class="pointer ${entityId} ${this.borderClass}
    panel-menu-label" data-animation="popIn">${icon}${title}</label></span>`;
            }

            _getBody(entityId, id, html, isFirst, bodyId) {
                entityId = entityId ? entityId + "-plugin-root" : "";
                let size = this.horizontal ? "width-full" : "height-full";
                return `<section id="${bodyId}" class="${entityId} position-relative ${size}" style="${isFirst ? '' : 'display: none;'}">${html}</section>`;
            }
        },

        /**
         * TODO unify: let creator own builder and just accept plain html
         */
        RowPanel: class {
        constructor(containerId, builder=UIComponents.Components.ImageRow, builderOptions={}) {
                const context = document.getElementById(containerId);
                if (!context) throw "RowPanel(): invalid initialization: container does not exist!";
                this.containerId = containerId + "-content";
                builderOptions.containerId = this.containerId;
                this.builder = new builder(builderOptions);
                this.uid = containerId;
                context.innerHTML = `<div id="${this.containerId}"></div>`;
                this.rows = [];
                this.count = 0;
                this.contentClass = "row-panel";
            }

            _getContext() {
                return $(document.getElementById(this.containerId));
            }

            addRow(options) {
                options.id = `${this.uid}-row-${this.count++}`;
                options.customClass = this.contentClass;
                this._getContext().append(this.builder.build(options))
                //this.rows.push(this.context.append(this.rowBuilder(options)));
            }

            clear() {
                this._getContext().html("");
            }
        },
    }

};
