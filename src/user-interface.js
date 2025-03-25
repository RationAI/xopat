function initXopatUI() {

    /**
     * Window Dialogs: System Dialogs and Window Manager
     * @namespace Dialogs
     */
    window.Dialogs = /**@lends Dialogs*/ {
        MSG_INFO: { class: "", icon: '<path fill-rule="evenodd"d="M6.3 5.69a.942.942 0 0 1-.28-.7c0-.28.09-.52.28-.7.19-.18.42-.28.7-.28.28 0 .52.09.7.28.18.19.28.42.28.7 0 .28-.09.52-.28.7a1 1 0 0 1-.7.3c-.28 0-.52-.11-.7-.3zM8 7.99c-.02-.25-.11-.48-.31-.69-.2-.19-.42-.3-.69-.31H6c-.27.02-.48.13-.69.31-.2.2-.3.44-.31.69h1v3c.02.27.11.5.31.69.2.2.42.31.69.31h1c.27 0 .48-.11.69-.31.2-.19.3-.42.31-.69H8V7.98v.01zM7 2.3c-3.14 0-5.7 2.54-5.7 5.68 0 3.14 2.56 5.7 5.7 5.7s5.7-2.55 5.7-5.7c0-3.15-2.56-5.69-5.7-5.69v.01zM7 .98c3.86 0 7 3.14 7 7s-3.14 7-7 7-7-3.12-7-7 3.14-7 7-7z"/>' },
        MSG_OK: { class: "Toast--success", icon: '<path fill-rule="evenodd"d="M6.3 5.69a.942.942 0 0 1-.28-.7c0-.28.09-.52.28-.7.19-.18.42-.28.7-.28.28 0 .52.09.7.28.18.19.28.42.28.7 0 .28-.09.52-.28.7a1 1 0 0 1-.7.3c-.28 0-.52-.11-.7-.3zM8 7.99c-.02-.25-.11-.48-.31-.69-.2-.19-.42-.3-.69-.31H6c-.27.02-.48.13-.69.31-.2.2-.3.44-.31.69h1v3c.02.27.11.5.31.69.2.2.42.31.69.31h1c.27 0 .48-.11.69-.31.2-.19.3-.42.31-.69H8V7.98v.01zM7 2.3c-3.14 0-5.7 2.54-5.7 5.68 0 3.14 2.56 5.7 5.7 5.7s5.7-2.55 5.7-5.7c0-3.15-2.56-5.69-5.7-5.69v.01zM7 .98c3.86 0 7 3.14 7 7s-3.14 7-7 7-7-3.12-7-7 3.14-7 7-7z"/>' },
        MSG_WARN: { class: "Toast--warning", icon: '<path fill-rule="evenodd" d="M8.893 1.5c-.183-.31-.52-.5-.887-.5s-.703.19-.886.5L.138 13.499a.98.98 0 0 0 0 1.001c.193.31.53.501.886.501h13.964c.367 0 .704-.19.877-.5a1.03 1.03 0 0 0 .01-1.002L8.893 1.5zm.133 11.497H6.987v-2.003h2.039v2.003zm0-3.004H6.987V5.987h2.039v4.006z" />' },
        MSG_ERR: { class: "Toast--error", icon: '<path fill-rule="evenodd" d="M10 1H4L0 5v6l4 4h6l4-4V5l-4-4zm3 9.5L9.5 14h-5L1 10.5v-5L4.5 2h5L13 5.5v5zM6 4h2v5H6V4zm0 6h2v2H6v-2z" />' },
        _timer: null,
        _modals: {},

        /**
         * @private
         */
        init: function () {
            $("body").append(`<div id="dialogs-container" class="popUpHide position-fixed" style='z-index: 5050; transform: translate(calc(50vw - 50%));'>
<div class="Toast" style="margin: 16px 0 0 0;">
<span class="Toast-icon"><svg width="12" height="16" id="notification-bar-icon" viewBox="0 0 12 16" class="octicon octicon-check" aria-hidden="true"></svg></span>
<span id="system-notification" class="Toast-content v-align-middle height-full position-relative" style="max-width: 350px;"></span>
<button class="Toast-dismissButton" onclick="Dialogs._hideImpl(false);">
<svg width="12" height="16" viewBox="0 0 12 16" class="octicon octicon-x" aria-hidden="true"><path fill-rule="evenodd" d="M7.48 8l3.75 3.75-1.48 1.48L6 9.48l-3.75 3.75-1.48-1.48L4.52 8 .77 4.25l1.48-1.48L6 6.52l3.75-3.75 1.48 1.48L7.48 8z"/></svg>
</button>
</div></div>`);

            this._body = $("#dialogs-container");
            this._toast = this._body.children().first();
            this._board = $("#system-notification");
            this._icon = $("#notification-bar-icon");
            this._notifQueue = new xoQueue(5);
            const _this = this;

            //close all child modals if parent dies
            window.onunload = function () {
                for (let key in _this._modals) {
                    if (_this._modals.hasOwnProperty(key)) {
                        let context = _this._modals[key].context;
                        if (context && context.window) context.window.close();
                        _this._destroyModalWindow(key, context);
                    }
                }
            }
        },

        /**
         * Show notification
         * @param text notification, html-formatted support
         * @param delayMS miliseconds to wait before auto close
         *          use values < 1000 to not to close at all
         * @param importance Dialogs.MSG_[INFO/WARN/ERR] object
         * @param {object} props other optional parameters
         * @param {object} [props.queued]
         * @param {object} [props.onShow]
         * @param {object} [props.onHide]
         */
        show: function (text, delayMS = 5000, importance = Dialogs.MSG_INFO, props = {}) {
            props = $.extend({}, props, { queued: true })

            if (props.queued && this._timer) {
                this._notifQueue.add({ text, delayMS, importance, props });
            } else this._showImpl(text, delayMS, importance, props);
        },

        /**
         * Hide notification
         */
        hide: function (withCallback = true) {
            this._hideImpl(false, withCallback);
        },

        _hideImpl: function (timeoutCleaned, callOnHide = true) {
            this._body.removeClass("popUpEnter");
            this._body.addClass("popUpHide");

            if (!timeoutCleaned && this._timer) {
                clearTimeout(this._timer);
                callOnHide && this._opts.onHide && this._opts.onHide();
            }
            this._timer = null;
            this._opts = null;
            const elem = this._notifQueue.pop();
            if (elem) {
                this._showImpl(elem.text, elem.delayMS, elem.importance, elem.onFinish);
            }
        },

        _showImpl: function (text, delayMS, importance, opts) {
            this._board.html(text);
            this._icon.html(importance.icon);
            this._toast.removeClass(); //all
            this._toast.css("animation-duration", `${delayMS}ms`);
            this._toast.addClass(`Toast ${importance.class} progress-bottom-bar`);
            this._body.removeClass("popUpHide");
            this._body.addClass("popUpEnter");

            if (delayMS >= 1000) {
                if (this._timer) clearTimeout(this._timer);
                this._timer = setTimeout(this._hideImpl.bind(this, true), delayMS);
                this._opts = opts;
                this._opts.onShow && this._opts.onShow();
            }
        },

        /**
         * Show custom/dialog window
         * @param parentId unique ID of the dialog container, you can hide the window by removing this ID from DOM
         *  might not complete or remove existing ID if not unique
         * @param header HTML content to put in the header
         * @param content HTML content
         * @param footer HTML content to put to the footer
         * @param params
         * @param params.defaultHeight custom height, can be a CSS value (string) or a number (pixels)
         * @param params.allowClose whether to show 'close' button, default true
         * @param params.allowResize whether to allow user to change the window size, default false
         */
        showCustom: function (parentId, header, content, footer, params = { allowClose: true }) {
            let result = this._buildComplexWindow(false, parentId, header, content, footer,
                `class="position-fixed" style="z-index:999; left: 50%;top: 50%;transform: translate(-50%,-50%);"`, params);
            if (result) $("body").append(result);
        },

        /**
         * Show custom/dialog in a separate browser window
         *  note: the window context does not have to be immediately available
         *  to get the window context, call getModalContext(..)
         *  to perform event-like calls, use the context and register appropriate events on the new window
         * Header is put into #window-header container
         * Content is put into #window-content container
         *
         * @param parentId unique ID to the modals context (does not have to be unique in this DOM if detached)
         * @param title non-formatted title string (for messages, window title tag...)
         * @param header HTML content to put in the header
         * @param content HTML content
         */
        showCustomModal: function (parentId, title, header, content) {
            if (this.getModalContext(parentId)) {
                console.error("Modal window " + title + " with id '" + parentId + "' already exists.");
                return;
            }

            this._showCustomModalImpl(parentId, title, this._buildComplexWindow(true, parentId, header, content, '',
                `style="width: 100%; height: 100%"`, { defaultHeight: "100%" }));
        },

        /**
         * Open Monaco Editor
         */
        openEditor: function (parentId, title, inputText, language, onSave) {
            if (this.getModalContext(parentId)) {
                console.log("Modal window with id '" + parentId + "' already exists. Using the window.");
                this._modals[parentId].callback = onSave;
                return;
            }

            const monaco = APPLICATION_CONTEXT.url + APPLICATION_CONTEXT.env.monaco;

            this._showCustomModalImpl(parentId, title, `
<script type="text/javascript" src="${monaco}loader.js"><\/script>
<script type="text/javascript">
require.config({
  paths: { vs: "${monaco}" }
});
const DEFAULT_EDITOR_OPTIONS = {
  value: \`${inputText}\`,
  lineNumbers: "on",
  roundedSelection: false,
  ariaLabel: "${title}",
  //accessibilityHelpUrl: "Nothing yet...",
  readOnly: false,
  theme: "hc-black",
  language: "${language}",
  scrollBeyondLastLine: false,
  automaticLayout: true
};
function editorResize(editor){
  editor.layout();
}

var editor;
const onCreated = (_editor) => {
  editor = _editor; //set global ref
  editor.layout();
};

const save = () => {
    let Diag = window.opener.Dialogs;
    try {
         Diag._modals['${parentId}'].callback(editor.getValue());
    } catch(e) {
         Diag.warn($.t('monaco.saveError'), 3500, Diag.MSG_ERR);
    }
};

//Creating the editor & adding Event listeners.
require(["vs/editor/editor.main"], () => {
  monaco.editor.onDidCreateEditor(onCreated);
  monaco.editor.create(
    document.getElementById("container"),
    DEFAULT_EDITOR_OPTIONS
  );
});

document.addEventListener('keydown', function(e) {
    if (e.code === "KeyS" && e.ctrlKey) {
       save();
    }
});
window.addEventListener("beforeunload", (e) => {
    save();
}, false);
<\/script>
            <div id="container" style="width:100%; height:100%;"></div>`,
                'width=600,height=450', onSave);
        },

        /**
         * Gets the context of a modal window,
         * destroys and cleans the context if necessary (e.g. window was closed by the user)
         *
         * TODO sometimes ctx.window valid but does not have getElementByID etc...
         *
         * @param id id used to create the window
         * @returns {(Window|undefined|null)} window context or undefined
         */
        getModalContext: function (id) {
            let ctx = this._modals[id];
            if (!ctx || !ctx.context) return undefined;
            ctx = ctx.context;

            //for some reason does not work without checking 'opener' while inspector closed
            if (!ctx.window || !ctx.opener || !ctx.self) {
                this._destroyModalWindow(id, ctx);
                return null;
            }
            return ctx;
        },

        /**
         * Closes any dialog (modal or not)
         * @param id id used to create the window
         * @returns {boolean|undefined} true if managed to close, false if
         *   nothing was opened, undefined if error
         */
        closeWindow: function (id) {
            if (!id) {
                console.error("Invalid form: unique container id not defined.");
                return undefined;
            }

            let node = document.getElementById(id);
            if (node && node.dataset.dialog !== "true") {
                console.error("Invalid form: identifier not unique.");
                return undefined;
            }
            let returns = false;
            if (node) {
                $(node).remove();
                returns = true;
            }

            if (this._modals[id]) {
                let ctx = this._modals[id].context;
                if (ctx && ctx.window) ctx.window.close();
                this._destroyModalWindow(id, ctx);
                return true;
            }
            return returns;
        },

        _showCustomModalImpl: function (id, title, html, size = 'width=450,height=250', customCall = function () { }) {
            //todo support modal redirection, opening in current browser instead (ID container OR this window modal)

            //can be called recursively from message popup, that's why we cache it
            if (html) this._cachedHtml = html;
            else html = this._cachedHtml;
            if (!html) return;

            this._cachedCall = customCall;
            let result = this._openModalWindow(id, title, html, size);
            if (!result.context) {
                this.show($.t('messages.modalWindowBlocked', {
                    title,
                    action: `Dialogs._showCustomModalImpl('${id}', '${title}', null, '${size}'); Dialogs.hide();`
                }), 15000, this.MSG_WARN);
            } else {
                result.callback = this._cachedCall;
                this._modals[id] = result;
                delete this._cachedHtml;
                delete this._cachedCall;
            }
        },

        _openModalWindow: function (id, title, content, size) {
            let objUrl = URL.createObjectURL(
                new Blob([`
<!DOCTYPE html>
<html lang="en">
    <head>
        <title>${title}</title>
        <!--TODO dirty hardcoded path-->
        <link rel="stylesheet" href="${APPLICATION_CONTEXT.url}src/assets/style.css">
        <link rel="stylesheet" href="${APPLICATION_CONTEXT.url}src/libs/primer_css.css">
        <link rel="stylesheet" href="${APPLICATION_CONTEXT.url}src/libs/tailwind.min.css">
        <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
        <script src="https://code.jquery.com/jquery-3.5.1.min.js"
            integrity="sha256-9/aliU8dGd2tb6OSsuzixeV4y/faTqgFtohetphbbj0="
            crossorigin="anonymous"></script>
        <script type="text/javascript">
            //route to the parent context
            window.confirm = function(message) {
                window.opener.focus();
                window.opener.confirm(message);
            };
            $.t = window.opener.$.t;
            $.i18n = window.opener.$.i18n;
            $.prototype.localize = () => {console.error("localize() not supported in child window!")};
        <\/script>
    </head>
    <body style="overflow: hidden; height: 100vh;">
    ${content}
    </body>
</html>
`], { type: "text/html" }));
            return {
                context: window.open(objUrl, id, size),
                objUrl,
                id
            };
        },

        _destroyModalWindow: function (id, context) {
            //important to clean up
            let body = context?.document?.getElementById("body");
            if (body) body.innerHTML = "";
            URL.revokeObjectURL(this._modals[id].objUrl);
            delete this._modals[id];
        },

        _buildComplexWindow: function (isModal, parentId, title, content, footer, positionStrategy, params) {
            //preventive close, applies to non-modals only
            if (!isModal && this.closeWindow(parentId) === undefined) return;
            params = params || {};
            let height = params.defaultHeight === undefined ? "" :
                (typeof params.defaultHeight === "string" ? params.defaultHeight : params.defaultHeight + "px");

            let close = params.allowClose ? this._getCloseButton(parentId) : '';
            let resize = params.allowResize ? "resize:vertical;" : "";
            footer = footer ? `<div class="position-absolute bottom-0 right-0 left-0 border-top"
style="border-color: var(--color-border-primary);">${footer}</div>` : "";

            let limits = isModal ? "style='width: 100%; height: 100vh;'" : "style='max-width:80vw; max-height: 80vh'";
            let diaClasses = isModal ? "" : "Box Box--overlay";

            return `<div id="${parentId}" data-dialog="true" ${positionStrategy}>
<details-dialog class="${diaClasses} d-flex flex-column" ${limits}>
    <div id="window-header" class="Box-header noselect d-flex flex-row" id="${parentId}-header">
      <h3 class="Box-title position-relative flex-1">${title}</h3>
      ${close}
    </div>
    <div id="window-content" class="overflow-auto position-relative" style="${resize} height: ${height}; min-height: 63px;">
      <div class="Box-body pr-2" style="padding-bottom: 45px; min-height: 100%">
	  ${content}
	  </div>
    </div>
   ${footer}
</details-dialog>
</div>`;
        },

        _getCloseButton: function (id) {
            return `<button class="Box-btn-octicon btn-octicon position-relative" type="button"
aria-label="Close help" onclick="Dialogs.closeWindow('${id}')">
<svg class="octicon octicon-x" viewBox="0 0 12 16" version="1.1" width="12" height="16" aria-hidden="true">
<path fill-rule="evenodd" d="M7.48 8l3.75 3.75-1.48 1.48L6 9.48l-3.75 3.75-1.48-1.48L4.52 8 .77
4.25l1.48-1.48L6 6.52l3.75-3.75 1.48 1.48L7.48 8z"></path></svg></button>`;
        }
    }; // end of namespace Dialogs
    Dialogs.init();

    /**
     * @typedef {{
     *  icon: string | undefined,
     * 	iconCss: string | undefined,
     * 	title: string,
     * 	action: function,
     * 	selected: boolean | undefined
     * }} DropDownItem
     */

    /**
     * @namespace DropDown
     * todo either use lib or ensure window constrrains do not affect it (too low, too right)
     */
    window.DropDown = /**@lends DropDown*/ {

        _calls: [],

        /**
         * @private
         */
        init: function () {
            document.addEventListener("click", this._toggle.bind(this, undefined, undefined));
            $("body").append(`<ul id="drop-down-menu" oncontextmenu="return false;" style="display:none;width: auto; max-width: 300px;" class="dropdown-menu dropdown-menu-se"></ul>`);

            this._body = $("#drop-down-menu");
        },

        /**
         * Open dialog from fired user input event
         * @param {Event} mouseEvent
         * @param {function|Array<DropDownItem>} optionsGetter
         */
        open: function (mouseEvent, optionsGetter) {
            this._toggle(mouseEvent, optionsGetter);
            mouseEvent.preventDefault();
        },

        /**
         * @returns {boolean} true if opened
         */
        opened: function () {
            return this._calls.length > 0;
        },

        /**
         *
         * @param context a string or html node element, where to bind the click event
         * @param optionsGetter callback that generates array of config options
         *   config object:
         *   config.title {string} title, required
         *   config.action {function} callback, argument given is 'selected' current value from config.icon
         *      - if undefined, the menu item is treated as separator - i.e. use '' title and undefined action for hr separator
         *      - you can also pass custom HTML and override the default styles and content, handler system etc...
         *   config.styles {object} custom css styles, optional
         *   config.selected {boolean} whether to mark the option as selected, optional
         *   config.icon {string} custom option icon name, optional
         *   config.iconCss {string} css for icon
         */
        bind: function (context, optionsGetter) {
            if (typeof context === "string") {
                context = document.getElementById(context);
            }
            if (!context?.nodeType) {
                console.error("Registered dropdown for non-existing or invalid element", context);
                return;
            }
            const _this = this;
            context.addEventListener("contextmenu", (e) => {
                _this._toggle(e, optionsGetter);
                e.preventDefault();
            });
        },

        hide: function () {
            this._toggle(undefined);
        },

        //TODO: allow toggle to respect the viewport, e.g. switch vertical/horizontal or switch position
        // if too close to edges
        _toggle: function (mouseEvent, optionsGetter) {
            const opened = this.opened();

            if (mouseEvent === undefined || opened) {
                if (opened) {
                    this._calls = [];
                    this._body.html("");
                    this._body.css({
                        display: "none",
                        top: 99999,
                        left: 99999,
                    });
                }
            } else {
                ((Array.isArray(optionsGetter) && optionsGetter) || optionsGetter()).forEach(this._with.bind(this));
                this._body.css({
                    display: "block",
                    top: mouseEvent.pageY + 5,
                    left: mouseEvent.pageX - 15
                });
            }
        },

        _with(opts, i) {
            const clbck = opts.action;
            if (clbck) {
                opts.selected = opts.selected || false;
                this._calls.push(() => {
                    clbck(opts.selected);
                    window.DropDown._toggle(undefined, undefined);
                });
                const icon = opts.icon ? `<span class="material-icons pl-0" 
style="width: 20px;font-size: 17px;${opts.iconCss || ''}" onclick="">${opts.icon}</span>`
                    : "<span class='d-inline-block' style='width: 20px'></span>";
                const selected = opts.selected ? "style=\"background: var(--color-state-focus-border);\"" : "";

                this._body.append(`<li ${selected}><a class="pl-1 dropdown-item pointer"
onclick="window.DropDown._calls[${i}]();">${icon}${opts.title}</a></li>`);
            } else {
                this._calls.push(null);
                this._body.append(`<li class="px-2" style="font-size: 10px;
    border-bottom: 1px solid var(--color-border-primary);">${opts.title}</li>`);
            }
        }
    };
    DropDown.init();

    let pluginsToolsBuilder, tissueMenuBuilder;

    /**
     * Definition of UI Namespaces driving menus and UI-ready utilities.
     * @namespace USER_INTERFACE
     */
    window.USER_INTERFACE = /**@lends USER_INTERFACE */ {
        /**
         * Run highlight animation on element
         * @param id id of the element in DOM
         * @param timeout highlight timeout in ms, default 2000
         * @param animated default true
         */
        highlightElementId(id, timeout = 2000, animated = true) {
            let cls = animated ? "ui-highlight-animated" : "ui-highlight";
            $(`#${id}`).addClass(cls);
            setTimeout(() => $(`#${id}`).removeClass(cls), timeout);
        },

        /**
         * Highlight element in DOM ensuring given menus are open it is
         * contained in
         * @param menuName menu type it is contained in, the name of the menu as in USER_INTERFACE
         * @param {(string|string[])} menuId id of the menu to focus, applicable for menus that can switch between
         *   different contents, AdvancedMenu can specify both string (menuId to open) or array ([menuId, submenuId])
         * @param id element ID to highlight
         * @param timeout highlight timeout in ms, default 2000
         * @param animated default true
         */
        highlight(menuName, menuId, id, timeout = 2000, animated = true) {
            this.focusMenu(menuName, menuId);
            this.highlightElementId(id, timeout, animated);
        },

        /**
         * Highlight element in DOM ensuring given menus are open it is
         * contained in
         * @param menuName menu type it is contained in, the name of the menu as in USER_INTERFACE
         * @param {(string|string[])} menuId id of the menu to focus, applicable for menus that can switch between
         *   different contents, AdvancedMenu can specify both string (menuId to open) or array ([menuId, submenuId])
         */
        focusMenu(menuName, menuId) {
            switch (menuName) {
                case "MainMenu":
                    this.MainMenu.open();
                    $("#main-panel-content").scrollTo("#" + menuId);
                    break;
                case "Tools":
                    this.AdvancedMenu.close();
                    this.Tools.open(menuId);
                    break;
                case "AdvancedMenu":
                    //todo add scroll ability?
                    if (Array.isArray(menuId) && menuId.length > 1) this.AdvancedMenu.openSubmenu(menuId[0], menuId[1]);
                    else this.AdvancedMenu.openMenu(menuId);
                    break;
                default:
                    console.warn("Invalid menu name for USER_INTERFACE::highlight!");
            }
        },

        /**
         * Workspace (canvas) margins
         * @private
         * @namespace USER_INTERFACE.Margins
         */
        Margins: {
            top: 0,
            bottom: 0,
            left: 0,
            right: 0
        },

        /**
         * Dialog System
         * @see Dialogs
         * @memberOf USER_INTERFACE
         */
        Dialogs: Dialogs,

        /**
         * DropDown Handler
         * @see DropDown
         * @memberOf USER_INTERFACE
         */
        DropDown: DropDown,

        /**
         * Full screen Errors for critical failures.
         * @namespace USER_INTERFACE.Errors
         */
        Errors: {
            active: false,
            /**
             * Show viewport-covering error
             * @param title
             * @param description
             * @param withHiddenMenu
             */
            show: function (title, description, withHiddenMenu = false) {
                USER_INTERFACE.Tutorials._hideImpl(false); //preventive
                $("#system-message-title").html(title);
                $("#system-message-details").html(description);
                $("#system-message").removeClass("d-none");
                $("#viewer-container").addClass("disabled");
                if (withHiddenMenu) USER_INTERFACE.MainMenu.close();
                USER_INTERFACE.Tools.close();
                this.active = true;
            },
            /**
             * Hide system-wide error.
             */
            hide: function () {
                $("#system-message").addClass("d-none");
                $("#viewer-container").removeClass("disabled");
                USER_INTERFACE.Tools.open();
                this.active = false;
            }
        },

        // TODO make new component for main-panel -> add methods from user-interface MainMenu
        // `<div id="${id}" -> id MENU, on components we will access through API
        // class="inner-panel ${pluginId}-plugin-root -> must be for every top level component of some plugin
        // firstly we add plugin div and in it there will be our UI component hiearchy
        // advanced menu shoudl be equiallent to our Menu, submenu -> creates menu in menu
        // we can have always submenu and only hide header
        // create one component for main menu and advanced menu

        //appCache -> remember settings for each user, remember open/close etc

        //setup component in config.json -> can be added in URL, important setting such as removed cookies, theme etc -> can be set from outside

        /**
         * Application Main Menu (right side)
         * @namespace USER_INTERFACE.MainMenu
         */
        MainMenu: {
            context: $("#main-panel"),
            navigator: $("#navigator-container"),
            opened: true,
            menu: new UI.MainPanel({
                id: "main-menu",
                orientation: UI.Menu.ORIENTATION.BOTTOM,
                extraClasses: { bg: "bg-transparent" }
            },
                { id: "copy-url", icon: "fa-link", title: "URL", body: "" },
                { id: "add-plugins", icon: "fa-puzzle-piece", title: "Plugins", body: "" },
                { id: "global-help", icon: "fa-question-circle", title: "Help", body: "" },
                { id: "settings", icon: "fa-gear", title: "Setting", body: "" }
            ),

            init: function () {
                this.menu.attachTo(this.context);
                this.menu.getBodyDomNode().display = "none";
                this.menu.getHeaderDomNode().style.pointerEvents = "auto";
                this.menu.getHeaderDomNode().classList.add("bg-transparent");
            },
            /**
             * Append to the menu
             * @param title
             * @param titleHtml
             * @param html
             * @param id
             * @param pluginId
             * @memberOf MainMenu
             */
            append: function (title, titleHtml, html, id, pluginId) {
                this.menu.append(title, titleHtml, html, id, pluginId);
            },
            /**
             * Replace in the menu
             * @param title
             * @param titleHtml
             * @param html
             * @param id
             * @param pluginId
             * @memberOf MainMenu
             */
            replace: function (title, titleHtml, html, id, pluginId) {
                this.menu.remove(`${pluginId}-plugin-root`);
                this.menu.append(title, titleHtml, html, id, pluginId);
            },
            /**
             * Append to the menu with toggle-able (hidden) content
             * @param title
             * @param titleHtml
             * @param html
             * @param hiddenHtml
             * @param id
             * @param pluginId
             */
            appendExtended: function (title, titleHtml, html, hiddenHtml, id, pluginId) {
                this.menu.appendExtended(title, titleHtml, html, hiddenHtml, id, pluginId);
            },
            /**
             * Replace in the menu with toggle-able (hidden) content
             * @param title
             * @param titleHtml
             * @param html
             * @param hiddenHtml
             * @param id
             * @param pluginId
             */
            replaceExtended: function (title, titleHtml, html, hiddenHtml, id, pluginId) {
                this.menu.remove(`${pluginId}-plugin-root`);
                this.menu.appendExtended(title, titleHtml, html, hiddenHtml, id, pluginId);
            },

            appendRaw: function (html, id, pluginId) {
                this.menu.appendRaw(html, id, pluginId);
            },
            /**
             * Open/close Main Menu Item todo: make cleaner
             * @param {jQuery} jQSelf
             * @param {jQuery} jQTargetParent
             * @private
             */
            clickHeader: function (jQSelf, jQTargetParent) {
                if (jQTargetParent.hasClass('force-visible')) {
                    jQTargetParent.removeClass('force-visible');
                    jQSelf.removeClass('opened');
                } else {
                    jQSelf.addClass('opened');
                    jQTargetParent.addClass('force-visible');
                }
            },
            /**
             * Open the menu
             */
            open() {
                if (this.opened) return;
                this.context.css("right", "0");
                this.opened = true;
                USER_INTERFACE.Margins.right = 400;
                this._sync();
            },
            /**
             * Close the menu
             */
            close() {
                if (!this.opened) return;
                this.context.css("right", "-400px");
                this.opened = false;
                USER_INTERFACE.Margins.right = 0;
                this._sync();
            },
            _sync() {
                this.navigator.css("position", this.opened ? "relative" : this.navigator.attr("data-position"));
                let width = this.opened ? "calc(100% - 400px)" : "100%";
                USER_INTERFACE.AdvancedMenu.selfContext.context.style['max-width'] = width;
                if (pluginsToolsBuilder) pluginsToolsBuilder.context.style.width = width;
                if (tissueMenuBuilder) tissueMenuBuilder.context.style.width = width;

                let status = USER_INTERFACE.Status.context;
                if (status) status.style.right = this.opened ? "408px" : "8px";
            }
        },
        /**
         * Application Vertical Menu (right side)
         * @namespace USER_INTERFACE.VerticalMenu
         */
        VerticalMenu: {
            context: $("#left-side-buttons"),
            menu: "",

            init: function () {
                bPlugins = new UI.Button({
                    id: "plugins",
                    size: UI.Button.SIZE.SMALL,
                    outline: UI.Button.OUTLINE.DISABLE,
                    TYPE: UI.Button.TYPE.PRIMARY,
                    onClick: function () {
                        console.log("Plugins clicked");
                    }
                }, "Plugins");

                bSettings = new UI.Button({
                    id: "settings",
                    size: UI.Button.SIZE.SMALL,
                    outline: UI.Button.OUTLINE.DISABLE,
                    TYPE: UI.Button.TYPE.PRIMARY,
                    onClick: function () {
                        console.log("Settings clicked");
                    }
                }, "Settings");

                this.menu = new UI.Join({ 
                    // TODO předělat na MENU, a upravit MENU tak aby se buttons otáčeli
                    // zabalit do divu a nastavit width a height naopak
                    // spíš to udělat v UI.MENU
                        id: "myJoin", 
                        rotation: UI.Join.ROTATION.ENABLE, 
                        style: UI.Join.STYLE.HORIZONTAL, 
                        rounded: UI.Join.ROUNDED.DISABLE }, 
                    bPlugins, bSettings);
                this.menu.attachTo(this.context);

                // setting up parent width to match buttons width
                var join = document.getElementById("myJoin");
                var buttons = document.getElementById("left-side-buttons");
                buttons.style.width = join.scrollHeight + "px";
            }
        },

        /**
         * Tools menu by default invisible (top)
         * @namespace USER_INTERFACE.Tools
         */
        Tools: {
            /**
             * Add menu to the Tools
             * @param {string} ownerPluginId
             * @param {string} toolsMenuId unique menu id
             * @param {string} title
             * @param {string} html
             * @param {string} icon
             */
            setMenu(ownerPluginId, toolsMenuId, title, html, icon = "") {
                if (!pluginsToolsBuilder) {
                    pluginsToolsBuilder = new UIComponents.Containers.PanelMenu("plugin-tools-menu");
                    pluginsToolsBuilder.context.classList.add("bg-opacity");
                    USER_INTERFACE.MainMenu._sync();
                }
                pluginsToolsBuilder.set(ownerPluginId, toolsMenuId, title, html, icon, `${toolsMenuId}-tools-panel`);
                if (pluginsToolsBuilder.isVisible) {
                    USER_INTERFACE.Margins.bottom = pluginsToolsBuilder.height;
                }
            },
            /**
             * Show desired toolBar menu. Also opens the toolbar if closed.
             * @param {(string|undefined)} toolsId menu id to open at
             */
            open(toolsId = undefined) {
                if (pluginsToolsBuilder) {
                    USER_INTERFACE.Margins.bottom = pluginsToolsBuilder.height;
                    pluginsToolsBuilder.show(toolsId);
                }
            },
            /**
             * Notify menu. The menu tab will receive a counter that notifies the user something has happened.
             * @param {string} menuId menu id to open at
             * @param {string} symbol a html symbol (that can be set as data- attribute) to show, shows increasing
             *  counter if undefined (e.g. 3 if called 3 times)
             */
            notify(menuId, symbol = undefined) {
                if (pluginsToolsBuilder) pluginsToolsBuilder.setNotify(menuId, symbol);
            },
            /**
             * Close the menu, so that it is not visible at all.
             */
            close() {
                USER_INTERFACE.Margins.bottom = 0;
                if (pluginsToolsBuilder) pluginsToolsBuilder.hide();
            }
        },

        /**
         * Status bar
         * @namespace USER_INTERFACE.Status
         */
        Status: {
            context: null,
            closed: false,
            /**
             * Show status bar with message
             * @param {string} message
             */
            show(message) {
                if (this.closed) return;
                if (!this.context) {
                    this._init();
                    USER_INTERFACE.MainMenu._sync();
                }
                // this.context.classList.remove("hover-dim"); not working: does not trigger animation
                this.context.firstElementChild.innerHTML = message;
                // this.context.classList.add("hover-dim");
            },
            /**
             * Close the menu, so that it is not visible at all.
             */
            setClosed(closed) {
                if (closed && this.context) {
                    document.body.removeChild(this.context);
                    delete this.context;
                }
                this.closed = closed;
            },
            _init() {
                let node = document.createElement("div");
                node.setAttribute("id", "viewer-status-bar");
                node.setAttribute("class", "position-fixed fixed-bg-opacity bg-opacity px-2 py-1 rounded-2 overflow-hidden");
                node.style.color = "var(--color-text-primary)";
                node.style.pointerEvents = 'none';
                node.style.maxWidth = 'calc(100vw - 750px)';
                node.style.bottom = '10px';
                let content = document.createElement("span");
                content.setAttribute("class", "one-liner");
                node.appendChild(content);
                document.body.appendChild(node);
                this.context = node;
            }
        },

        /**
         * Menu that covers most of the screen and hides more advanced UI elements and other features
         * @namespace USER_INTERFACE.AdvancedMenu
         */
        AdvancedMenu: {
            self: $("#fullscreen-menu"),
            selfContext: new UIComponents.Containers.PanelMenu("fullscreen-menu"),
            /**
             * Add menu
             * @param {string} ownerPluginId context ID: the ID of plugin the menu belongs to
             *  e.g. should be called once if withSubmenu=false, the last call is the only menu shown under this ID
             *  e.g. can be called many times if withSubmenu=true, then all menus are treated as submenus
             * @param {string} toolsMenuId menu ID: should be unique ID in the DOM context
             * @param {string} title menu title as shown in the menu tab
             * @param {string} html menu content
             * @param {string} icon google icon tag
             * @param {boolean} withSubmenu true if the menu allows submenus: in that case, all added menus with the
             *  same owner ID are actually submenus
             * @param {boolean} container true if a common container should be added (i.e. margins/padding)
             */
            setMenu(ownerPluginId, toolsMenuId, title, html, icon = "", withSubmenu = true, container = true) {
                let plugin = APPLICATION_CONTEXT._dangerouslyAccessPlugin(ownerPluginId);
                if (!plugin || !ownerPluginId) return;
                this._buildMenu(plugin, "__selfMenu", ownerPluginId, plugin.name, ownerPluginId, toolsMenuId, title, html,
                    icon, withSubmenu, container);
            },
            /**
             * Open the Menu UI at desired tab
             * @param {(string|undefined)} atPluginId menu tab to open
             * @param {boolean} toggle whether to close if the menu is opened
             * @return {boolean} true if the menu was opened with this call
             */
            openMenu(atPluginId = undefined, toggle = true) {
                const wasOpened = this.selfContext.isOpened(atPluginId);
                if (toggle && wasOpened) {
                    this.close();
                    return false;
                }

                if (wasOpened) return false;
                this.selfContext.show(atPluginId);
                if (window.innerWidth < 1150) {
                    this._closedMm = true;
                    USER_INTERFACE.MainMenu.close();
                }
                return true;
            },

            /**
             * Open the Menu UI at desired sub-menu tab
             * @param {string} atPluginId menu tab to open
             * @param {(string|undefined)} atSubId sub-menu tab to open
             * @param {boolean} toggle whether to close if the menu is opened
             * @return {boolean} true if the submenu was opened by this call
             */
            openSubmenu(atPluginId, atSubId = undefined, toggle = true) {
                this._openSubmenu(atPluginId, atSubId, toggle);
            },
            /**
             * Can be used to open submenu with custom builder prop name, if this._buildMenu was used manually.
             * @private
             */
            _openSubmenu(atPluginId, atSubId = undefined, toggle = true, builderId = '__selfMenu') {
                const didOpenParent = this.openMenu(atPluginId, false);

                let plugin = APPLICATION_CONTEXT._dangerouslyAccessPlugin(atPluginId);
                if (!plugin) return false;
                let builder = plugin[builderId];
                if (builder) {
                    if (toggle && !didOpenParent && builder.isOpened(atSubId)) {
                        this.close();
                        return false;
                    }
                    builder.show(atSubId);
                    return true;
                } else {
                    console.warn("Cannot open submenu: it was created with custom builder not stored as '" + builderId + "' prop.");
                }
                return false;
            },
            /**
             * Close the menu.
             */
            close() {
                this.selfContext.hide();
                if (this._closedMm) {
                    this._closedMm = false;
                    USER_INTERFACE.MainMenu.open();
                }
            },
            refreshPageWithSelectedPlugins() {
                let plugins = pluginsMenuBuilder.builder.getSelected();
                let pluginCookie = APPLICATION_CONTEXT.getOption("permaLoadPlugins") ? plugins.join(',') : "";
                APPLICATION_CONTEXT.AppCookies.set('_plugins', pluginCookie); //todo where we want to store this?
                UTILITIES.refreshPage(plugins);
            },
            /**
             * Add Separator to the menu header at current position (end) of the header labels
             */
            addSeparator() {
                $(this.selfContext.head).append('<span class="width-full" style="height: 1px; border: solid; opacity: 0.1;"></span>');
            },
            _build() {
                this.selfContext.isHorizontal = false;
                this.selfContext.menuWith1Element = true;
                this.selfContext.isFullSize = true;

                if (APPLICATION_CONTEXT.getOption("disablePluginsUi")) {
                    $("#add-plugins").attr({
                        title: $.t('messages.pluginsDisabled'),
                        disabled: true
                    });
                } else {
                    buildPluginsMenu(this);
                }
                buildSettingsMenu(this);

                $(this.selfContext.head).prepend('<span class="material-icons btn-pointer mb-2" id="advanced-menu-close-button" onclick="USER_INTERFACE.AdvancedMenu.close();">close</span>');
                this.addSeparator();
            },
            _buildMenu(context, builderId, parentMenuId, parentMenuTitle, ownerPluginId, toolsMenuId,
                title, html, icon, withSubmenu, container) {

                let builder = context[builderId];

                if (!withSubmenu && builder) {
                    builder.remove();
                    delete context[builderId];
                    builder = undefined;
                }

                let bodyId = toolsMenuId;
                if (container) {
                    html = `<div id="${toolsMenuId}" class="height-full position-relative" style="padding: 30px 45px 12px 25px; width: 650px;">${html}</div>`;
                    bodyId = toolsMenuId + "-parent-container";
                }


                if (!builder) {
                    if (withSubmenu) {
                        //body ID here different from child, we create a container!
                        this.selfContext.set(ownerPluginId, parentMenuId, parentMenuTitle,
                            `<div id='advanced-menu-${ownerPluginId}'></div>`, "", `${parentMenuId}-section-container`);
                        builder = new UIComponents.Containers.PanelMenu(`advanced-menu-${ownerPluginId}`);
                        context[builderId] = builder;
                    } else {
                        this.selfContext.set(ownerPluginId, toolsMenuId, title, html, icon, bodyId);
                        return;
                    }
                }
                builder.set(null, toolsMenuId, title, html, icon, bodyId);
            }
        },

        /**
         * UI Fullscreen Loading
         */
        Loading: {
            _visible: $("#fullscreen-loader").css('display') !== 'none',
            _allowDescription: false,
            isVisible: function () {
                return this._visible;
            },
            /**
             * Show or hide full-page loading.
             * @param loading
             */
            show: function (loading) {
                const loader = $("#fullscreen-loader");
                if (this._visible === loading) return;
                if (loading) {
                    loader.css('display', 'block');
                } else {
                    loader.css('display', 'none');
                    this.text(false);
                }
                this._visible = loading;
            },
            /**
             * Show title for loading screen. Not performed if the loading screen is not visible.
             * @param {boolean|string} titleText boolean to show/hide default text, string to show custom title
             * @param {string} descriptionText optionally details
             */
            text: function (titleText = true, descriptionText = "") {
                if (!this.isVisible()) return;

                const title = document.getElementById("fullscreen-loader-title");
                const description = document.getElementById("fullscreen-loader-description");
                titleText = titleText === true ? title.innerText || $.t('messages.loading') : titleText;
                title.innerText = titleText || "";
                description.innerText = descriptionText;
                if (this._allowDescription) {
                    if (titleText) title.classList.add('loading-text-style');
                    else title.classList.remove('loading-text-style');

                    if (descriptionText) description.classList.add('loading-text-style');
                    else description.classList.remove('loading-text-style');
                }
            }
        },

        /**
         * Tutorial system
         * @namespace USER_INTERFACE.Tutorials
         */
        Tutorials: {
            tutorials: $("#tutorials"),
            steps: [],
            prerequisites: [],
            /**
             * Open the tutorials selection screen
             * @param {string} title title to show
             * @param {string} description subtitle to show
             */
            show: function (title = undefined, description = undefined) {
                if (USER_INTERFACE.Errors.active || this.running) return;

                if (!title) title = $.t('tutorials.menu.title');
                if (!description) description = $.t('tutorials.menu.description')

                $("#tutorials-container").removeClass("d-none");
                $("#viewer-container").addClass("disabled");
                $("#tutorials-title").html(title);
                $("#tutorials-description").html(description);
                USER_INTERFACE.MainMenu.close();
                USER_INTERFACE.Tools.close();
                USER_INTERFACE.AdvancedMenu.close();
                this.running = true;
            },

            /**
             * Hide Tutorials
             */
            hide: function () {
                this._hideImpl(true);
            },

            _hideImpl: function (reflectGUIChange) {
                $("#tutorials-container").addClass("d-none");
                if (reflectGUIChange) {
                    $("#viewer-container").removeClass("disabled");
                    USER_INTERFACE.MainMenu.open();
                    USER_INTERFACE.Tools.open();
                }
                this.running = false;
                APPLICATION_CONTEXT.AppCookies.set('_shadersPin', 'false');
            },

            /**
             * Add tutorial to options
             * @param plugidId
             * @param name
             * @param description
             * @param icon
             * @param steps the tutorials object array, keys are "rule selector" strings
             *  rules are 'next', 'click', selectors define what element to highlight
             * @param prerequisites a function to execute at the beginning, default undefined
             */
            add: function (plugidId, name, description, icon, steps, prerequisites = undefined) {
                if (!icon) icon = "school";
                plugidId = plugidId ? `${plugidId}-plugin-root` : "";
                this.tutorials.append(`
<div class='d-inline-block px-2 py-2 m-1 pointer v-align-top rounded-2 tutorial-item ${plugidId}' onclick="USER_INTERFACE.Tutorials.run(${this.steps.length});">
<span class="d-block material-icons f1 text-center my-2">${icon}</span><p class='f3-light mb-0'>${name}</p><p>${description}</p></div>`);
                this.steps.push(steps);
                this.prerequisites.push(prerequisites);
            },

            /**
             * Run tutorial
             * @param {(number|Array)} ctx index to the attached tutorials list (internal use) or tutorials data
             *  see add(..) steps parameter
             */
            run: function (ctx) {
                let prereq, data;

                if (Number.isInteger(ctx)) {
                    if (ctx >= this.steps.length || ctx < 0) return;
                    prereq = this.prerequisites[ctx];
                    data = this.steps[ctx];
                } else {
                    data = ctx;
                }

                //reset plugins visibility
                $(".plugins-pin").each(function () {
                    let pin = $(this);
                    let container = pin.parents().eq(1).children().eq(2);
                    pin.removeClass('pressed');
                    container.removeClass('force-visible');
                });

                let enjoyhintInstance = new EnjoyHint({
                    onStart: function () {
                        window.addEventListener("resize", enjoyhintInstance.reRender, false);
                        window.addEventListener("click", enjoyhintInstance.rePaint, false);

                        if (typeof prereq === "function") prereq();
                    },
                    onEnd: function () {
                        window.removeEventListener("resize", enjoyhintInstance.reRender, false);
                        window.removeEventListener("click", enjoyhintInstance.rePaint, false);
                    },
                    onSkip: function () {
                        window.removeEventListener("resize", enjoyhintInstance.reRender, false);
                        window.removeEventListener("click", enjoyhintInstance.rePaint, false);
                    }
                });
                USER_INTERFACE.MainMenu.open();
                enjoyhintInstance.set(data);
                this.hide();
                enjoyhintInstance.run();
                this.running = false;
            }
        },

        /**
         * Add custom HTML to the DOM selector
         * @param {string} html to append
         * @param {string} pluginId owner plugin ID
         * @param {string} selector jquery selector where to append, default 'body'
         */
        addHtml: function (html, pluginId, selector = "body") {
            try {
                $(html).appendTo(selector).each((idx, element) => $(element).addClass(`${pluginId}-plugin-root`));
                return true;
            } catch (e) {
                console.error("Could not attach custom HTML.", e);
                return false;
            }
        },

        toggleDemoPage: function (enable) {
            const overlay = document.getElementById('viewer-demo-advertising');
            if (enable) {
                VIEWER.addOverlay(overlay, new OpenSeadragon.Rect(0, 0, 1, 1));
                overlay.style.display = 'block';
            } else {
                VIEWER.removeOverlay(overlay);
                overlay.style.display = 'none';
            }
        }
    };

    // Make loading show
    setTimeout(() => {
        const loader = USER_INTERFACE.Loading;
        // Only after some time show texts to users - taking too long time
        loader._allowDescription = true;
        if (loader.isVisible()) loader.text(true);
    }, 3000);

    /******************* ADVANCED MENUS *********************/

    function buildSettingsMenu(ctx) {
        let inputs = UIComponents.Elements;
        let notifyNeedRefresh = "$('#settings-notification').css('visibility', 'visible');";
        let updateOption = (name, cache = false) => `APPLICATION_CONTEXT.setOption('${name}', $(this).val(), ${cache});`;
        let updateBool = (name, cache = false) => `APPLICATION_CONTEXT.setOption('${name}', this.checked, ${cache});`;
        let standardBoolInput = (id, title, onChange = notifyNeedRefresh) => inputs.checkBox({
            label: title, onchange: updateBool(id) + onChange, default: APPLICATION_CONTEXT.getOption(id)
        });

        ctx._buildMenu(ctx, "__sMenu", "", "", APPLICATION_CONTEXT.settingsMenuId,
            APPLICATION_CONTEXT.settingsMenuId, "Settings", `
<div class="position-absolute top-1 left-1 right-1" style="width: inherit; visibility: hidden;" id="settings-notification">
<div class="py-1 px-2 rounded-2"
style="background: var(--color-bg-warning); max-height: 70px; text-overflow: ellipsis;">
<span class='material-icons' style='font-size: initial; color: var( --color-icon-warning)'>warning</span>
To apply changes, please <a onclick="UTILITIES.refreshPage()" class="pointer">reload the page</a>.</div>
</div>

<svg width="199" height="245" style="position: absolute; top: -10px; right: 55px;transform: scale(0.4);" xmlns="http://www.w3.org/2000/svg">
<path class="svg-bg" style="stroke:none;" d="M0 0L0 245L199 245L199 0L0 0z"/>
<path class="svg-fg" style="stroke:none;" d="M89 111C73.9124 102.634 59.1429 97.6265 42 103.699C10.6243 114.813 2.69417 155.943 24.3002 179.96C34.203 190.968 50.5908 195.588 65 193.711C70.1356 193.042 75.9957 189.366 81 189.558C85.6821 189.737 88.2317 195.201 93 196C93.6192 189.998 96.2022 186.738 102 185C101.099 181.757 97.6293 178.671 97.4406 175.424C97.0265 168.299 104.601 159.133 104.961 151C105.566 137.299 101.021 127.388 94 116C103.473 126.386 108.99 140.925 106.192 155C105.004 160.979 97.5869 171.328 100.07 177C104.64 187.436 131.355 202.006 122.296 214.956C118.441 220.467 108.201 223.195 105.353 214.981C103.302 209.066 108.098 199.867 106.772 193.044C105.706 187.562 98.7536 186.737 96.6034 192.059C95.3591 195.138 96.3032 198.787 95.6096 202C93.7875 210.441 87.5887 218.272 93.1481 226.96C100.503 238.454 121.175 235.504 129.532 226.699C134.728 221.225 136.419 213.299 137 206C148.187 205.48 157.471 186.148 144 184C149.507 175.759 148.085 167.119 146 158C165.247 156.32 202.562 125.778 177.895 106.649C169.278 99.9665 160.337 105.127 151 105C150.495 106.972 149.914 108.958 149.8 111.005C148.665 131.435 167.128 107.828 171.492 118.769C173.408 123.575 166.473 129.073 162.996 131.031C153.73 136.249 134.573 138.898 129.935 126.999C126.675 118.636 137.585 104.308 140.586 96C151.593 65.5361 152.007 31.5748 117 17.3125C83.7906 3.78271 48.8156 25.7805 54.3009 63C56.0017 74.5404 65.351 92.3288 73.5285 100.61C77.7937 104.929 84.2977 107.003 89 111z"/>
<path class="svg-bg" style="stroke:none;" d="M87 81C82.7429 86.9183 82.9719 101.042 92.9992 101.573C102.597 102.082 97.7793 90.6547 93.9707 87.3356C91.5984 85.2683 89.3865 83.0401 87 81z"/>
<path class="svg-fg" style="stroke:none;" d="M25 107C28.4168 108.639 36.7081 108.003 35.2485 102.053C32.9817 92.813 14.0022 92.0537 12.2292 102.001C10.2409 113.156 24.252 120.615 25 107z"/>
<path class="svg-bg" style="stroke:none;" d="M24 106L25 107L24 106M41 112L41 113L71 111C61.6203 105.271 50.5737 108.886 41 112M72 111C69.2728 118.884 75.1667 125.759 78 116C82.7507 118.31 82.8217 121.271 84 126C89.7642 124.306 91.6704 129.152 93.5332 134C96.6031 141.99 98.7543 158.938 90 164L90 160C85.0423 161.665 89.4999 169.66 84.544 174.661C75.5048 183.782 64.9634 184.722 53 186C66.228 191.551 84.5771 179.617 91.4522 169C104.514 148.829 96.2262 118.129 72 111M89 111L94 116L89 111M39 113L40 114L39 113M33 117L25 127C29.7771 124.795 32.8399 122.639 33 117M52.3133 120.341C50.1733 121.228 51.5478 124.545 53.6867 123.659C55.8267 122.772 54.4522 119.455 52.3133 120.341M62 120L65 122L62 120M41 121L42 122L41 121M67 125L68 126L67 125M43.1042 126.971C38.678 128.103 40.3704 135.157 44.8704 134.029C49.2486 132.932 47.4587 125.857 43.1042 126.971M24 128L25 129L24 128M23 130L24 131L23 130M22 132L21 136L22 136L22 132M28 133L28 135L30 135L30 133L28 133M58 133L58 135L60 135L60 133L58 133M77 134L77 137L80 136L80 135L77 134M34 135L35 136L34 135M20 137L20 141L21 141L20 137M65 143C70.0573 137.901 61.7582 136.163 65 143M42 139L41 142L44 140L42 139M81 140C78.2033 148.267 88.8914 143.178 81 140M49.3673 142.16C47.4628 143.252 48.6193 146.328 50.7762 145.543C53.2608 144.64 51.7806 140.778 49.3673 142.16M19 142L24 167L25 167L23 147L19 142M25 143L26 144L25 143M34.6173 144.067C32.5698 145.655 35.2824 148.445 37.1682 146.933C39.1479 145.345 36.5347 142.581 34.6173 144.067M90 146L91 147L90 146M73 148L73 149L76 150L76 147L73 148M54 150L55 151L57 148L54 150M86 149L85 152L88 152L86 149M62 153L63 154L62 153M70.3179 155.086C66.5598 157.256 69.924 163.083 73.6821 160.914C77.4401 158.744 74.076 152.917 70.3179 155.086M31.3133 156.341C29.1733 157.228 30.5478 160.545 32.6867 159.659C34.8267 158.772 33.4522 155.455 31.3133 156.341M45 159L45 161L47 161L47 159L45 159M52 164C60.0885 166.742 55.1245 156.194 52 164M39.0154 163.176C34.2531 163.787 35.2278 171.226 39.9815 170.168C44.31 169.205 43.5061 162.6 39.0154 163.176M78 164L79 165L78 164M65 166L66 167L65 166M25 168L31 175L31 167L25 168M69 169C74.0987 174.057 75.8373 165.758 69 169M58 169L58 171L60 171L60 169L58 169M79 170L82 172L79 170M114.333 171.133C108.852 174.188 119.144 185.977 123.485 183.824C130.12 180.534 120.016 167.965 114.333 171.133M43.6667 174.333L44.3333 174.667L43.6667 174.333M50 174L49 177L52 175L50 174M32 176L34 178L32 176M63 177C55.3047 179.36 63.7044 185.094 63 177M72 177L73 178L72 177M35 178L37 180L35 178M39 181L39 182L42 183L42 180L39 181M43.6667 183.333L44.3333 183.667L43.6667 183.333M46 184L47 185L46 184M48 185L48 186L52 186L48 185z"/>
<path class="svg-fg" style="stroke:none;" d="M27 186C27.1738 206.718 48.5297 212.444 66 208.251C71.6215 206.901 85.3117 202.123 84.0826 194.148C83.4123 189.799 77.5387 191.717 75 192.59C66.8687 195.388 53.4275 198.698 45 195.481C38.5131 193.004 34.1307 187.375 27 186z"/>
<path class="svg-bg" style="stroke:none;" d="M138 189L135 195C137.756 193.487 139.001 192.137 138 189z"/>
<path class="svg-fg" style="stroke:none;" d="M111 196C110.984 201.944 107.113 208.424 107.581 213.867C108.017 218.936 115.737 218.201 118.606 215.991C126.648 209.793 118.205 198.065 111 196z"/>
</svg>
<span class="f3-light text-shadow" style="position: absolute; top: 80px; right: 84px;">xOpat</span>
<span class="f3-light text-shadow" style="position: absolute; top: 97px;right: 71px;">Viewer</span>
<span class="f6" style="color: var(--color-text-tertiary);position: absolute;top: 73px;right: 70px;">v${APPLICATION_CONTEXT.env.version}</span>
<span class="f3-light header-sep">Appearance</span><br>
Theme &emsp; ${inputs.select({
                classes: "select-sm",
                onchange: `${updateOption("theme", true)} UTILITIES.updateTheme();`,
                default: APPLICATION_CONTEXT.getOption("theme"),
                options: { auto: $.t('settings.theme.auto'), light: $.t('settings.theme.light'), dark_dimmed: $.t('settings.theme.dimmed'), dark: $.t('settings.theme.dark') }
            })}
<br> ${inputs.checkBox({
                label: $.t('settings.toolBar'),
                onchange: "$('#plugin-tools-menu').toggleClass('d-none')",
                default: true
            })}
<br>${standardBoolInput("scaleBar", $.t('settings.scaleBar'))}
<br>${standardBoolInput("statusBar", $.t('settings.statusBar'), `USER_INTERFACE.Status.setClosed(!this.checked);`)}
<br><br><span class="f3-light header-sep">Behaviour</span>
<br>${standardBoolInput("bypassCookies", $.t('settings.cookies'))}
<br><br><span class="f3-light header-sep">Other</span>
<br>${standardBoolInput("debugMode", $.t('settings.debugMode'))}
<br>${standardBoolInput("webglDebugMode", $.t('settings.debugRender'))}
`, 'settings', false, true);
    }

    let pluginsMenuBuilder;
    function buildPluginsMenu(ctx) {
        ctx._buildMenu(ctx, "__pMenu", "", "", APPLICATION_CONTEXT.pluginsMenuId,
            APPLICATION_CONTEXT.pluginsMenuId, $.t('plugins.title'), `<div class="d-flex flex-column-reverse">
<button onclick="USER_INTERFACE.AdvancedMenu.refreshPageWithSelectedPlugins();" class="btn">${$.t('plugins.loadBtn')}</button>
</div><hr>
<div id='plug-list-content-inner'></div>
`, 'extension', false, true);

        pluginsMenuBuilder = new UIComponents.Containers.RowPanel("plug-list-content-inner",
            UIComponents.Components.SelectableImageRow,
            { multiselect: true, id: 'plug-list-content' });

        pluginsMenuBuilder.builder.attachHeader();

        VIEWER.addHandler('before-plugin-load', e => {
            const button = document.getElementById(`load-plugin-${e.id}`)?.firstElementChild;
            if (button) {
                button.setAttribute('disabled', true);
                button.innerHTML = $.t('common.Loading') + '<span class="AnimatedEllipsis"></span>';
            }
        });

        let pluginCount = 0;
        for (let pid of APPLICATION_CONTEXT.pluginIds()) {
            //todo maybe avoid using _dangerously* ?
            let plugin = APPLICATION_CONTEXT._dangerouslyAccessPlugin(pid),
                pluginConfig = APPLICATION_CONTEXT.config.plugins[pid];

            //permaLoad plugins are not available for interaction
            if ((plugin.hasOwnProperty("permaLoad") && plugin.permaLoad) ||
                (plugin.hasOwnProperty("hidden") && plugin.hidden) ||
                (pluginConfig?.hasOwnProperty("permaLoad") && pluginConfig?.permaLoad)) continue;

            let errMessage = plugin.error ? `<div class="p-1 rounded-2 error-container">${plugin.error}</div>` : "";
            let problematic = `<div id="error-plugin-${plugin.id}" class="mx-2 mb-3 text-small">${errMessage}</div>`;

            let actionPart = errMessage || plugin.loaded ? "" : `<div id="load-plugin-${plugin.id}">
<button onclick="UTILITIES.loadPlugin('${plugin.id}');return false;" class="btn">${$.t('common.Load')}</button></div>`;
            pluginsMenuBuilder.addRow({
                title: plugin.name,
                author: plugin.author,
                details: plugin.description,
                customContent: problematic + (plugin.html || ""),
                icon: plugin.icon,
                value: plugin.id,
                selected: plugin.loaded,
                contentAction: actionPart
            });
            pluginCount++;
        }

        if (pluginCount < 1) {
            pluginsMenuBuilder.addRow({
                title: $.t('plugins.noPluginsAvailable'),
                author: "",
                details: $.t('plugins.noPluginsDetails'),
                icon: '<span class="material-icons p-2">explore</span>',
                value: "_undefined_",
                selected: false,
                contentAction: ""
            });
        }
    }
}
