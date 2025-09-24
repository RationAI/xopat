function initXopatUI() {

    /**
     * Window Dialogs: System Dialogs and Window Manager
     * @namespace Dialogs
     */
    window.Dialogs = {
        MSG_INFO: Toast.MSG_INFO,
        MSG_WARN: Toast.MSG_WARN,
        MSG_ERR: Toast.MSG_ERROR,
        MSG_SUCCESS: Toast.MSG_SUCCESS,

        _scheduler: null,
        _modals: {},


        /**
         * Show notification (same API)
         * @param {string} text HTML allowed
         * @param {number} delayMS >= 1000 autohides, <1000 sticks until closed
         * @param importance one of Dialogs.MSG_*
         * @param {object} props {queued?, onShow?, onHide?, buttons?}
         */
        show(text, delayMS = 5000, importance = this.MSG_INFO, props = {}) {
            this._scheduler.show(text, delayMS, importance, props);
        },

        /**
         * Hide current notification
         * @param withCallback
         */
        hide(withCallback = true) {
            this._scheduler.hide(withCallback);
        },

        /**
         * Await dialogs are hidden and no messsages are shown
         * @return {Promise}
         */
        async awaitHidden() {
            await this._scheduler.awaitHidden();
        },

        init() {
            if (this._scheduler) return; // already initialized
            const view = new UI.Toast();
            this._scheduler = new UI.Toast.Scheduler(view);

            // attach using your component system (works even if BaseComponent has helpers)
            (document.body || document.documentElement).appendChild(view.create());

            // Close all child modals if parent dies (kept from your original)
            window.addEventListener("unload", () => {
                if (this._modals) {
                    for (const key in this._modals) {
                        const ctx = this._modals[key]?.context;
                        if (ctx?.window) ctx.window.close();
                        this._destroyModalWindow?.(key, ctx);
                    }
                }
            });
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
        showCustom: function(parentId, header, content, footer, params = { allowClose: true }) {
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
        showCustomModal: function(parentId, title, header, content) {
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
        openEditor: function(parentId, title, inputText, language, onSave) {
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
        getModalContext: function(id) {
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
        closeWindow: function(id) {
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

        _showCustomModalImpl: function(id, title, html, size = 'width=450,height=250', customCall = function () { }) {
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

        _openModalWindow: function(id, title, content, size) {
            let objUrl = URL.createObjectURL(
                new Blob([`
<!DOCTYPE html>
<html lang="en">
    <head>
        <title>${title}</title>
        <!--TODO dirty hardcoded path-->
        <link rel="stylesheet" href="${APPLICATION_CONTEXT.url}src/assets/style.css">
        <link rel="stylesheet" href="${APPLICATION_CONTEXT.url}src/libs/tailwind.min.css">
        <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">
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

        _destroyModalWindow: function(id, context) {
            //important to clean up
            let body = context?.document?.getElementById("body");
            if (body) body.innerHTML = "";
            URL.revokeObjectURL(this._modals[id].objUrl);
            delete this._modals[id];
        },

        _buildComplexWindow: function(isModal, parentId, title, content, footer, positionStrategy, params) {
            //preventive close, applies to non-modals only
            if (!isModal && this.closeWindow(parentId) === undefined) return;
            params = params || {};
            let height = params.defaultHeight === undefined ? "" :
                (typeof params.defaultHeight === "string" ? params.defaultHeight : params.defaultHeight + "px");

            let close = params.allowClose ? this._getCloseButton(parentId) : '';
            let resize = params.allowResize ? "resize:vertical;" : "";
            footer = footer ? `<div class="border-top"
style="border-color: var(--color-border-primary);">${footer}</div>` : "";

            let limits = isModal ? "style='width: 100%; height: 100vh;'" : "style='max-width:80vw; max-height: 80vh'";
            let diaClasses = isModal ? "" : "card bg-base-100 shadow-xl";

            return `<div id="${parentId}" data-dialog="true" ${positionStrategy}>
<details-dialog class="${diaClasses} flex flex-col" ${limits}>
    <div id="window-header" class="card-title noselect flex flex-row" id="${parentId}-header">
      <h3 class="text-lg font-semibold position-relative flex-1">${title}</h3>
      ${close}
    </div>
    <div id="window-content" class="overflow-auto position-relative" style="${resize} height: ${height}; min-height: 63px;">
      <div class="card-body pr-2" style="padding-bottom: 5px; min-height: 100%">
	  ${content}
	  </div>
    </div>
   ${footer}
</details-dialog>
</div>`;
        },

        _getCloseButton: function(id) {
            return `<button class="btn btn-ghost btn-xs" type="button"
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
     *  containerCss: string | undefined,
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
        init: function() {
            document.addEventListener("click", this._toggle.bind(this, undefined, undefined));
            $("body").append(`<ul id="drop-down-menu" oncontextmenu="return false;" style="display:none;width: auto; max-width: 300px;" class="menu menu-sm bg-base-100 rounded-box shadow"></ul>`);

            this._body = $("#drop-down-menu");
        },

        /**
         * Open dialog from fired user input event
         * @param {Event} mouseEvent
         * @param {function|Array<DropDownItem>} optionsGetter
         */
        open: function(mouseEvent, optionsGetter) {
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
         *   config.selected {boolean} whether to mark the option as selected, optional
         *   config.icon {string} custom option icon name, optional
         *   config.containerCss {string} css for the container, optional
         *   config.iconCss {string} css for icon
         */
        bind: function(context, optionsGetter) {
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

        hide: function() {
            this._toggle(undefined);
        },

        //TODO: allow toggle to respect the viewport, e.g. switch vertical/horizontal or switch position
        // if too close to edges
        _toggle: function(mouseEvent, optionsGetter) {
            const opened = this.opened();

            if (mouseEvent === undefined) {
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
                if (opened) {
                    this._calls = [];
                    this._body.html("");
                }
                ((Array.isArray(optionsGetter) && optionsGetter) || optionsGetter()).forEach(this._with.bind(this));

                let top = mouseEvent.pageY + 5;
                let left = mouseEvent.pageX - 15;

                if ((top + this._body.height()) > window.innerHeight) {
                    top = mouseEvent.pageY - this._body.height() - 5;
                }
                if ((left + this._body.width()) > window.innerWidth) {
                    left = mouseEvent.pageX - this._body.width() + 15;
                }
                this._body.css({
                    display: "block",
                    top: top,
                    left: left
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
                const icon = opts.icon ? `<span class="fa-auto ${opts.icon} pl-0" 
style="width: 20px;font-size: 17px;${opts.iconCss || ''}" onclick=""></span>`
                    : "<span class='d-inline-block' style='width: 20px'></span>";
                const selected = opts.selected ? "style=\"background: var(--color-state-focus-border);\"" : "";

                this._body.append(`<li ${selected}><a class="pl-1 dropdown-item pointer ${opts.containerCss || ''}"
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
            show: function(title, description, withHiddenMenu = false) {
                USER_INTERFACE.Tutorials._hideImpl(); //preventive
                $("#system-message-title").html(title);
                $("#system-message-details").html(description);
                $("#system-message").removeClass("hidden");
                $("#viewer-container").addClass("disabled");
                USER_INTERFACE.Tools.close();
                this.active = true;
            },
            /**
             * Hide system-wide error.
             */
            hide: function() {
                $("#system-message").addClass("hidden");
                $("#viewer-container").removeClass("disabled");
                USER_INTERFACE.Tools.open();
                this.active = false;
            }
        },

        Tooltip: new UI.GlobalTooltip(),

        //setup component in config.json -> can be added in URL, important setting such as removed cookies, theme etc -> can be set from outside
        FullscreenMenu: {
            context: $("#fullscreen-menu"),
            menu: "",

            init: function () {
                this.menu = new UI.FullscreenMenu({
                    id: "fullscreen-menu",
                },this.getSettingsBody(), this.getPluginsBody(),
            );

                this.menu.attachTo(this.context);
            },

            getSettingsBody: function () {
                const { div, span, a, b } = van.tags;
                const logo = this.getLogo(-70, 20);

                const notification = div({ class: "", style: "width: inherit; visibility: hidden;", id: "settings-notification" },
                    div({ class: "py-1 px-2 rounded-2", style: "background: var(--color-bg-warning); max-height: 70px; text-overflow: ellipsis;" },
                      span({ class: "fa-auto fa-warning", style: "font-size: initial; color: var( --color-icon-warning)" }),
                      "To apply changes, please ",
                      a({ onclick: () => {UTILITIES.refreshPage()}, class: "pointer" },
                        b("reload the page"),
                      ),
                      ".",
                    ),
                  );

                let theme = APPLICATION_CONTEXT.getOption("theme");
                let themePretty = theme === "auto" ? "Automatic" : theme === "light" ? "Light Theme" : "Dark Theme";

                const themeSelect = new UI.Select(
                    { id: "theme-select", onchange: function () {USER_INTERFACE.Tools.changeTheme(this.value)}, title: $.t('settings.theme.title') },
                    { value: "", selected: "selected", hidden: "hidden", text: themePretty },
                    { value: "auto", text: $.t('settings.theme.auto') },
                    { value: "light", text: $.t('settings.theme.light') },
                    { value: "dark", text: $.t('settings.theme.dark') }
                );
                const settings = div(
                  div({ class: "boxed"},
                    span({ class: "f3-light header-sep" },
                    "Appearance"),
                  themeSelect.create(),
                  this.createCheckbox(
                    "toolbar-checkbox",
                    $.t('settings.toolBar'),
                    function () {
                        APPLICATION_CONTEXT.setOption('toolBar', this.checked);
                        const toolbarDivs = document.querySelectorAll('div[id^="toolbar-"]');
                        toolbarDivs.forEach(div => div.classList.toggle('hidden'));
                    },
                    APPLICATION_CONTEXT.getOption('toolBar', true)),

                  this.createCheckbox(
                    "scalebar-checkbox",
                      $.t('settings.scaleBar'),
                    function () {
                        APPLICATION_CONTEXT.setOption('scaleBar', this.checked);
                        for (let viewer of VIEWER_MANAGER.viewers) {
                            viewer.scalebar.setActive(this.checked);
                        }
                    },
                    APPLICATION_CONTEXT.getOption('scaleBar', true)),

                  this.createCheckbox(
                    "statusbar-checkbox",
                    $.t('settings.statusBar'),
                    function () {APPLICATION_CONTEXT.setOption('statusBar', this.checked);$('#viewer-status-bar').toggleClass('hidden')},
                    APPLICATION_CONTEXT.getOption('statusBar', true)),
                  ),
                  div({ class: "boxed"},
                  span({ class: "f3-light header-sep" }, "Behaviour", ),
                  this.createCheckbox(
                    "cookies-checkbox",
                    $.t('settings.cookies'),
                    function () {APPLICATION_CONTEXT.setOption('bypassCookies', this.checked);$('#settings-notification').css('visibility', 'visible');},
                    APPLICATION_CONTEXT.getOption('bypassCookies', false)),
                  ),
                  div({ class: "boxed"},
                  span({ class: "f3-light header-sep" }, "Other", ),
                  this.createCheckbox(
                    "debug-checkbox",
                    $.t('settings.debugMode'),
                    function () {APPLICATION_CONTEXT.setOption('debugMode', this.checked);$('#settings-notification').css('visibility', 'visible');},
                    APPLICATION_CONTEXT.getOption('debugMode', false)),
                  this.createCheckbox(
                    "render-checkbox",
                    $.t('settings.debugRender'),
                    function () {APPLICATION_CONTEXT.setOption('webglDebugMode', this.checked);$('#settings-notification').css('visibility', 'visible');},
                    APPLICATION_CONTEXT.getOption('webglDebugMode', false)),
                  ),
                );
                return new UI.Div({id: "settings-menu"}, settings, notification, logo);
            },
            createCheckbox: function (id, text, onchangeFunction, checked) {
                const cb = new UI.Checkbox({
                    id: id,
                    label: text,
                    checked: checked,
                    onchange: onchangeFunction
                    });
                return cb.create();
            },

            getLogo(positionBottom, positionRight) {
                const { path, svg } = van.tags("http://www.w3.org/2000/svg");
                const {span, div} = van.tags();
                const logo = div(svg({width: "199", height: "245", style: `transform: scale(0.4);position: absolute; bottom: ${positionBottom}px; right: ${positionRight}px;`},
                    path({ class: "svg-bg", style: "stroke:none;", "d": "M0 0L0 245L199 245L199 0L0 0z" }),
                    path({ class: "svg-fg", style: "stroke:none;", "d": "M89 111C73.9124 102.634 59.1429 97.6265 42 103.699C10.6243 114.813 2.69417 155.943 24.3002 179.96C34.203 190.968 50.5908 195.588 65 193.711C70.1356 193.042 75.9957 189.366 81 189.558C85.6821 189.737 88.2317 195.201 93 196C93.6192 189.998 96.2022 186.738 102 185C101.099 181.757 97.6293 178.671 97.4406 175.424C97.0265 168.299 104.601 159.133 104.961 151C105.566 137.299 101.021 127.388 94 116C103.473 126.386 108.99 140.925 106.192 155C105.004 160.979 97.5869 171.328 100.07 177C104.64 187.436 131.355 202.006 122.296 214.956C118.441 220.467 108.201 223.195 105.353 214.981C103.302 209.066 108.098 199.867 106.772 193.044C105.706 187.562 98.7536 186.737 96.6034 192.059C95.3591 195.138 96.3032 198.787 95.6096 202C93.7875 210.441 87.5887 218.272 93.1481 226.96C100.503 238.454 121.175 235.504 129.532 226.699C134.728 221.225 136.419 213.299 137 206C148.187 205.48 157.471 186.148 144 184C149.507 175.759 148.085 167.119 146 158C165.247 156.32 202.562 125.778 177.895 106.649C169.278 99.9665 160.337 105.127 151 105C150.495 106.972 149.914 108.958 149.8 111.005C148.665 131.435 167.128 107.828 171.492 118.769C173.408 123.575 166.473 129.073 162.996 131.031C153.73 136.249 134.573 138.898 129.935 126.999C126.675 118.636 137.585 104.308 140.586 96C151.593 65.5361 152.007 31.5748 117 17.3125C83.7906 3.78271 48.8156 25.7805 54.3009 63C56.0017 74.5404 65.351 92.3288 73.5285 100.61C77.7937 104.929 84.2977 107.003 89 111z" }),
                    path({ class: "svg-bg", style: "stroke:none;", "d": "M87 81C82.7429 86.9183 82.9719 101.042 92.9992 101.573C102.597 102.082 97.7793 90.6547 93.9707 87.3356C91.5984 85.2683 89.3865 83.0401 87 81z" }),
                    path({ class: "svg-fg", style: "stroke:none;", "d": "M25 107C28.4168 108.639 36.7081 108.003 35.2485 102.053C32.9817 92.813 14.0022 92.0537 12.2292 102.001C10.2409 113.156 24.252 120.615 25 107z" }),
                    path({ class: "svg-bg", style: "stroke:none;", "d": "M24 106L25 107L24 106M41 112L41 113L71 111C61.6203 105.271 50.5737 108.886 41 112M72 111C69.2728 118.884 75.1667 125.759 78 116C82.7507 118.31 82.8217 121.271 84 126C89.7642 124.306 91.6704 129.152 93.5332 134C96.6031 141.99 98.7543 158.938 90 164L90 160C85.0423 161.665 89.4999 169.66 84.544 174.661C75.5048 183.782 64.9634 184.722 53 186C66.228 191.551 84.5771 179.617 91.4522 169C104.514 148.829 96.2262 118.129 72 111M89 111L94 116L89 111M39 113L40 114L39 113M33 117L25 127C29.7771 124.795 32.8399 122.639 33 117M52.3133 120.341C50.1733 121.228 51.5478 124.545 53.6867 123.659C55.8267 122.772 54.4522 119.455 52.3133 120.341M62 120L65 122L62 120M41 121L42 122L41 121M67 125L68 126L67 125M43.1042 126.971C38.678 128.103 40.3704 135.157 44.8704 134.029C49.2486 132.932 47.4587 125.857 43.1042 126.971M24 128L25 129L24 128M23 130L24 131L23 130M22 132L21 136L22 136L22 132M28 133L28 135L30 135L30 133L28 133M58 133L58 135L60 135L60 133L58 133M77 134L77 137L80 136L80 135L77 134M34 135L35 136L34 135M20 137L20 141L21 141L20 137M65 143C70.0573 137.901 61.7582 136.163 65 143M42 139L41 142L44 140L42 139M81 140C78.2033 148.267 88.8914 143.178 81 140M49.3673 142.16C47.4628 143.252 48.6193 146.328 50.7762 145.543C53.2608 144.64 51.7806 140.778 49.3673 142.16M19 142L24 167L25 167L23 147L19 142M25 143L26 144L25 143M34.6173 144.067C32.5698 145.655 35.2824 148.445 37.1682 146.933C39.1479 145.345 36.5347 142.581 34.6173 144.067M90 146L91 147L90 146M73 148L73 149L76 150L76 147L73 148M54 150L55 151L57 148L54 150M86 149L85 152L88 152L86 149M62 153L63 154L62 153M70.3179 155.086C66.5598 157.256 69.924 163.083 73.6821 160.914C77.4401 158.744 74.076 152.917 70.3179 155.086M31.3133 156.341C29.1733 157.228 30.5478 160.545 32.6867 159.659C34.8267 158.772 33.4522 155.455 31.3133 156.341M45 159L45 161L47 161L47 159L45 159M52 164C60.0885 166.742 55.1245 156.194 52 164M39.0154 163.176C34.2531 163.787 35.2278 171.226 39.9815 170.168C44.31 169.205 43.5061 162.6 39.0154 163.176M78 164L79 165L78 164M65 166L66 167L65 166M25 168L31 175L31 167L25 168M69 169C74.0987 174.057 75.8373 165.758 69 169M58 169L58 171L60 171L60 169L58 169M79 170L82 172L79 170M114.333 171.133C108.852 174.188 119.144 185.977 123.485 183.824C130.12 180.534 120.016 167.965 114.333 171.133M43.6667 174.333L44.3333 174.667L43.6667 174.333M50 174L49 177L52 175L50 174M32 176L34 178L32 176M63 177C55.3047 179.36 63.7044 185.094 63 177M72 177L73 178L72 177M35 178L37 180L35 178M39 181L39 182L42 183L42 180L39 181M43.6667 183.333L44.3333 183.667L43.6667 183.333M46 184L47 185L46 184M48 185L48 186L52 186L48 185z" }),
                    path({ class: "svg-fg", style: "stroke:none;", "d": "M27 186C27.1738 206.718 48.5297 212.444 66 208.251C71.6215 206.901 85.3117 202.123 84.0826 194.148C83.4123 189.799 77.5387 191.717 75 192.59C66.8687 195.388 53.4275 198.698 45 195.481C38.5131 193.004 34.1307 187.375 27 186z" }),
                    path({ class: "svg-bg", style: "stroke:none;", "d": "M138 189L135 195C137.756 193.487 139.001 192.137 138 189z" }),
                    path({ class: "svg-fg", style: "stroke:none;", "d": "M111 196C110.984 201.944 107.113 208.424 107.581 213.867C108.017 218.936 115.737 218.201 118.606 215.991C126.648 209.793 118.205 198.065 111 196z" }),
                ),
            span({ class: "f3-light text-shadow", style: `position: absolute; bottom: ${positionBottom+125}px; right: ${positionRight+34}px;` }, "xOpat"),
            span({ class: "f3-light text-shadow", style: `position: absolute; bottom: ${positionBottom+108}px; right: ${positionRight+21}px;` }, "Viewer"),
            span({ class: "f6", style: `position: absolute; bottom: ${positionBottom+143}px;right: ${positionRight+20}px;` }, "v2.1.1"),
            );
            return logo;
            },
            getPluginsBody: function () {
                const { button, div, span} = van.tags;
                let pluginCount = 0;
                let pluginDivs = [];
                for (let pid of APPLICATION_CONTEXT.pluginIds()) {
                    //todo maybe avoid using _dangerously* ?
                    let plugin = APPLICATION_CONTEXT._dangerouslyAccessPlugin(pid),
                        pluginConfig = APPLICATION_CONTEXT.config.plugins[pid];

                    //permaLoad plugins are not available for interaction
                    if ((plugin.hasOwnProperty("permaLoad") && plugin.permaLoad) ||
                        (plugin.hasOwnProperty("hidden") && plugin.hidden) ||
                        (pluginConfig?.hasOwnProperty("permaLoad") && pluginConfig?.permaLoad)) continue;

                    const pluginDiv = this.createPluginDiv(plugin, pluginCount);
                    pluginDivs.push(pluginDiv);
                    pluginCount++;
                }

                if (pluginCount < 1) {
                    let emptyPlugin = {
                        id: "_undefined_",
                        name: $.t('plugins.noPluginsAvailable'),
                        description: $.t('plugins.noPluginsDetails'),
                        icon: null,
                        error: false,
                        loaded: false,
                    }
                    const pluginDiv = this.createPluginDiv(emptyPlugin, 0);
                    pluginDivs.push(pluginDiv);
                }


                const logo = this.getLogo(-70, 20);
                return new UI.Div({
                        id: "app-plugins",
                        class: "height-full position-relative",
                        style: "margin-left: 10px; margin-right: 20px; max-width: 690px; width: calc(100vw - 65px);"
                    },
                    div({class: "flex flex-col-reverse"},
                        button({
                            onclick: function () {
                                USER_INTERFACE.TopPluginsMenu.refreshPageWithSelectedPlugins()
                            }, class: "btn"
                        }, "Load with selected"),
                    ),
                    span({class: "text-xl font-semibold header-sep", style: "margin-top: 5px; margin-bottom: 5px"}, "Plugins"),
                    div({id: "plug-list-content-inner", class: "boxed"},
                        div({id: "plug-list-content-inner-content"}, ...pluginDivs),
                    ),
                    logo,
                );

            },

            createPluginDiv: function (plugin, pluginCount) {
                const { div, img, button, input } = van.tags;
                let actionPart;
                if (plugin.loaded){
                    actionPart = div({ id: `load-plugin-${plugin.id}` },
                        button({class: "btn btn-disabled" },
                            $.t('common.Loaded')
                        )
                    )
                } else{
                    actionPart = div({ id: `load-plugin-${plugin.id}` },
                        button({ onclick: function () {UTILITIES.loadPlugin(plugin.id); return false;}, class: "btn" },
                            `${$.t('common.Load')}`,
                        ),
                    );
                }

                let icon = plugin.icon || (plugin.icon !== "" ? APPLICATION_CONTEXT.url + "src/assets/image.png" : "");
                if (icon && !icon.includes('<')) {
                    icon = img({ src: `${icon}`, class: "block m-2 rounded-md", style: "height: 40px;" });
                }

                let text = div({ class: "flex flex-col", style: "flex-grow: 1;" },
                    div({ class: "text-lg font-semibold" }, plugin.name),
                    div({ class: "text-sm opacity-70" }, plugin.description),
                );

                return div({ id: `plug-list-content-inner-row-${pluginCount}`, class: `selectable-image-row-container plugin-${plugin.id}-root` },
                    input({ type: "checkbox", name: "plug-list-content", class: "hidden selectable-image-row-context", value: plugin.id }),
                    div({ class: "w-full flex selectable-image-row rounded-md cursor-pointer", onclick: function () {$(this.previousElementSibling).click()} },
                        icon,
                        text,
                        actionPart,
                    ),
                    div({ id: `error-plugin-${plugin.id}`, class: "mx-2 mb-3 text-small" }),
                );
            },
        },

        /**
         * Application TopFullscreenButton
         * @namespace USER_INTERFACE.TopFullscreenButton
         */
        TopFullscreenButton:{
            context: $("#top-fullscreen"),
            button: "",
            fullscreen: false,

            init: function () {
                this.button = new Button({
                    id: "fullscreen-button",
                    size: Button.SIZE.SMALL,
                    onClick: function () {

                        // add components which you want to be hidden on fullscreen here:
                        document.getElementById("top-user").classList.toggle("hidden");
                        document.getElementById("top-side-left").classList.toggle("hidden");

                        // cannot hide whole top-side, because it contains also fullscreen button
                        document.getElementById("top-side").classList.toggle("opaque-bg");
                        const toolbarDivs = document.querySelectorAll('div[id^="toolbar-"]');
                        if (toolbarDivs.length >= 0 && toolbarDivs[0].classList.contains("hidden")){
                            toolbarDivs.forEach((el) => el.classList.remove("hidden"));
                        } else{
                            toolbarDivs.forEach((el) => el.classList.add("hidden"));
                        }

                        USER_INTERFACE.TopFullscreenButton.fullscreen = !USER_INTERFACE.TopFullscreenButton.fullscreen;
                    }
                },
                new UI.FAIcon("fa-up-right-and-down-left-from-center"),);
                this.button.attachTo(this.context);
            }
        },
        /**
         * Application TopUserMenu
         * @namespace USER_INTERFACE.TopUserMenu
         */
        TopUserMenu:{
            context: $("#top-user"),
            menu: "",

            init: function () {
                this.menu = new UI.MainPanel({
                    id: "top-user-buttons-menu",
                    orientation: UI.Menu.ORIENTATION.TOP,
                    buttonSide: UI.Menu.BUTTONSIDE.LEFT,
                    rounded: UI.Menu.ROUNDED.ENABLE,
                    extraClasses: { bg: "bg-transparent" }
                },
                    { id: "banner", icon: "fa-warning", title: "Banner", body: undefined, class: UI.MenuTabBanner },
                    { id: "settings", icon: "fa-gear", title: $.t('main.bar.settings'), body: undefined, onClick: function () {USER_INTERFACE.FullscreenMenu.menu.focus("settings-menu")} },
                    { id: "plugins", icon: "fa-puzzle-piece", title: $.t('main.bar.plugins'), body: undefined, onClick: function () {USER_INTERFACE.FullscreenMenu.menu.focus("app-plugins")} },
                    { id: "tutorial", icon: "fa-graduation-cap", title: $.t('main.bar.tutorials'), body: undefined, onClick: function () {USER_INTERFACE.Tutorials.show();} },
                    { id: "share", icon: "fa-share-nodes", title: $.t('main.bar.share'), items: [
                            {
                                id: "global-export",
                                domID: true,
                                label: $.t("main.bar.exportFile"),
                                hint: $.t("main.bar.explainExportFile"),
                                onClick: () => {
                                    UTILITIES.export();
                                    this.menu.closeTab("share");
                                },
                                icon: "fa-download"
                            },
                            {
                                id: "copy-url-inner",
                                domID: true,
                                label: $.t("main.bar.exportUrl"),
                                hint: $.t("main.bar.explainExportUrl"),
                                onClick: () => {
                                    UTILITIES.copyUrlToClipboard();
                                    this.menu.closeTab("share");
                                },
                                icon: "fa-link"
                            }
                        ], class: UI.Dropdown},
                    { id: "user", icon: "fa-circle-user", title: XOpatUser.instance().name || $.t('user.anonymous'), body: undefined, styleOverride: true, class: UI.MenuButton}
                );

                this.menu.attachTo(this.context);
                this.menu.set(UI.Menu.DESIGN.ICONONLY);
            },

            // todo better api
            setBanner: function (banner) {
                const bItem = this.menu.getTab("banner");
                if (banner) {
                    bItem.toggleHiden();
                    bItem.setVisuals(banner);
                } else {
                    //todo might dissinc
                    bItem.toggleHiden();
                }
            }
        },

        /**
         * Application Top Middle Menu
         * @namespace USER_INTERFACE.TopVisualMenu
         */
        TopVisualMenu:{
            context: $("#top-visual"),
            menu: "",
            rightMenuTabs: {},
            otherWindows: {},
            _visualMenuNeedsRefresh: false,

            init: function () {
                this.menu = new UI.MainPanel({
                        id: "visual-menu",
                        orientation: UI.Menu.ORIENTATION.TOP,
                        buttonSide: UI.Menu.BUTTONSIDE.LEFT,
                        rounded: UI.Menu.ROUNDED.ENABLE,
                        extraClasses: { bg: "bg-transparent" },
                    }, {
                        id: "view", icon: "fa-window-restore", title: $.t('main.bar.view'), body: [], class: UI.Dropdown,
                        onClick: e => USER_INTERFACE.TopVisualMenu._refreshVisualDropdown()
                    },
                );

                this.menu.attachTo(this.context);
                this.menu.set(UI.Menu.DESIGN.TITLEICON);
            },



            _refreshVisualDropdown: function () {
                if (!this._visualMenuNeedsRefresh) return;

                const tab = this.menu.getTab('view');
                tab.clear();

                // TODO: allow custom windows here
                // tab.addItem({
                //     id: 'preview',
                //     onClick: () => USER_INTERFACE.SlidesMenu.open(),
                //     icon: "fa-rectangle-list",
                //     label: $.t('main.global.preview'),
                // });
                tab.addItem({
                    id: 'clone-viewer',
                    onClick: () => UTILITIES.clone(),
                    icon: "fa-clone",
                    label: $.t('main.global.clone'),
                });

                // todo consider sort
                for (let id in this.otherWindows) {
                    const item = this.otherWindows[id];
                    tab.addItem({
                        icon: item.icon,
                        label: item.label,
                        selected: item.selected,
                        onClick: () => {
                            item.selected = !item.selected;
                            APPLICATION_CONTEXT.setOption(`${id}-hidden`, item.selected);
                            item.onClick?.(item.selected);
                        },
                        section: 'right-menu',
                    });
                }


                for (let id in this.rightMenuTabs) {
                    const item = this.rightMenuTabs[id][0];
                    if (item) {
                        tab.addItem({
                            icon: item.iconName,
                            label: item.title,
                            selected: !APPLICATION_CONTEXT.getOption(`${id}-hidden`, false),
                            onClick: () => {
                                for (let child of this.rightMenuTabs[id]) {
                                    // todo support toggle with t/f
                                    child.toggleHiden();
                                }
                                //todo taking item.hidden value is problematic, first element controls all
                                APPLICATION_CONTEXT.setOption(`${id}-hidden`, item.hidden);
                            },
                            section: 'right-menu',
                        });
                    }
                }
            },

            /**
             * Register a window tab
             */
            registerWindowTab(id, icon, label, onClick) {
                const selected = !APPLICATION_CONTEXT.getOption(`${id}-hidden`, false);
                if (selected) {
                    onClick?.(selected);
                }
                this.otherWindows[id] = {
                    id, icon, label, onClick, selected
                };
                this._visualMenuNeedsRefresh = true;
            },

            /**
             * Register menu tab that is driven by the core right menu for each viewer.
             * Not advised to use manually, used in core UI.
             * @param tab
             */
            registerRightMenuTab(tab) {
                // todo support removal
                let parent = this.rightMenuTabs[tab.id];
                if (!parent) {
                    this.rightMenuTabs[tab.id] = parent = [tab];
                    this._visualMenuNeedsRefresh = true;
                } else {
                    parent.push(tab)
                    parent.sort((a, b) => a.title.localeCompare(b.title));
                }
            }
        },

        /**
         * Application Vertical Menu (right side)
         * @namespace USER_INTERFACE.TopPluginsMenu
         */
        TopPluginsMenu: {
            context: $("#top-plugins"),
            menu: "",

            init: function () {
                this.pluginListMenu = USER_INTERFACE.TopVisualMenu.menu.addDropdown({ id: "plugins", icon: "fa-bars", title: $.t('main.bar.plugins'), body: [], class: UI.Dropdown});
            },

            // should add submenus to plugin menu
            setMenu(ownerPluginId, toolsMenuId, title, html, icon = "fa-fw") {

                if(!this.pluginListMenu.getItem(ownerPluginId)){
                    this.pluginListMenu.addItem({
                        id: ownerPluginId,
                        icon: pluginMeta(ownerPluginId, "icon"),
                        label: pluginMeta(ownerPluginId, "name"),
                        pluginRootClass: `plugin-${ownerPluginId}-root`,
                        onClick: () => USER_INTERFACE.TopPluginsMenu.openSubmenu(`${ownerPluginId}`),
                    });

                    const InsideMenu = new UI.TabsMenu({
                        id: `${ownerPluginId}-submenu`,
                        orientation: UI.Menu.ORIENTATION.TOP,
                        buttonSide: UI.Menu.BUTTONSIDE.LEFT,
                        rounded: UI.Menu.ROUNDED.ENABLE,
                        extraClasses: { bg: "bg-transparent" }
                    },);

                    const d = new UI.Div({ id: `${ownerPluginId}-menu`, extraClasses: `flex flex-col plugin-${ownerPluginId}-root` }, InsideMenu);

                    USER_INTERFACE.FullscreenMenu.menu.addTab(d);
                }

                const insideMenu = USER_INTERFACE.FullscreenMenu.menu.tabs[`${ownerPluginId}-menu`]._children[0];
                const d = van.tags.div();
                d.innerHTML = html;
                insideMenu.addTab({id: toolsMenuId, icon: icon, title: title, body: [d]});

            },
            openSubmenu(atPluginId, atSubId=undefined, toggle=true) {
                // TODO move to mainPanel class and solve toggle
                USER_INTERFACE.FullscreenMenu.menu.focus(`${atPluginId}-menu`);

                if (USER_INTERFACE.FullscreenMenu.menu.tabs[`${atPluginId}-menu`]._children[0].focused === undefined && atSubId === undefined){
                    const stTabId = Object.keys(USER_INTERFACE.FullscreenMenu.menu.tabs[`${atPluginId}-menu`]._children[0].tabs)[0];
                    USER_INTERFACE.FullscreenMenu.menu.tabs[`${atPluginId}-menu`]._children[0].focus(stTabId);
                }

            },
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
             * @param {UIElement} html
             * @param {string} [icon=fa-wrench]
             * @param {boolean} forceHorizontal
             */
            setMenu(ownerPluginId, toolsMenuId, title, html, icon = "fa-wrench", forceHorizontal = false) {
                const menu = new UI.Toolbar(
                    {id: `toolbar-${ownerPluginId}`, horizontalOnly: forceHorizontal, pluginRootClass: `plugin-${ownerPluginId}-root`},
                    {
                        id: ownerPluginId+"-"+toolsMenuId+"-tools-panel",
                        icon: icon,
                        title: title,
                        body: [html],
                    }
                );
                menu.attachTo(document.body);
                this.makeDraggable(`toolbar-${ownerPluginId}`);
                this.stayOnScreen(`toolbar-${ownerPluginId}`);

                if (!APPLICATION_CONTEXT.getOption(`toolBar`, true)){
                    document.querySelectorAll('div[id^="toolbar-"]').forEach((el) => el.classList.add("hidden"));
                }

                // snapping  to left side if set in cookies
                if (APPLICATION_CONTEXT.getOption(`toolbar-${ownerPluginId}-PositionLeft`) == 0){
                    document.getElementById(`toolbar-${ownerPluginId}`).style["max-width"] = "100px";
                }

            },

            stayOnScreen(id){
                const myDiv = document.getElementById(id);
                function keepDivOnScreen() {
                    const rect = myDiv.getBoundingClientRect();
                    const viewportWidth = window.innerWidth;
                    const viewportHeight = window.innerHeight;

                    // Check horizontal position
                    if (rect.right > viewportWidth) {
                        myDiv.style.left = viewportWidth - rect.width + "px";
                    }

                    if (rect.left < 0) {
                        myDiv.style.left = "0px";
                    } else if (rect.left < APPLICATION_CONTEXT.getOption(`${id}-PositionLeft`)) {
                        myDiv.style.left = APPLICATION_CONTEXT.getOption(`${id}-PositionLeft`) + "px";
                    }

                    // Check vertical position
                    if (rect.bottom > viewportHeight) {
                        myDiv.style.top = viewportHeight - rect.height + "px";
                    } else if (rect.top < APPLICATION_CONTEXT.getOption(`${id}-PositionTop`)) {
                        myDiv.style.top = APPLICATION_CONTEXT.getOption(`${id}-PositionTop`) + "px";
                    }

                    if (rect.top < document.getElementById('top-side').offsetHeight) {
                        myDiv.style.top = document.getElementById('top-side').offsetHeight + "px";
                    }
                }

                window.addEventListener('scroll', keepDivOnScreen);
                window.addEventListener('resize', keepDivOnScreen);
                keepDivOnScreen();
            },
            makeDraggable(id){
                const draggableBox = document.getElementById(id);
                const handle = draggableBox.querySelector('.handle');

                let isDragging = false;
                let offsetX, offsetY;
                const SNAP_DISTANCE = 20;


                handle.addEventListener('mousedown', (e) => {
                    if (e.button === 0) {
                        isDragging = true;
                        draggableBox.classList.add('dragging');

                        offsetX = e.clientX - draggableBox.getBoundingClientRect().left;
                        offsetY = e.clientY - draggableBox.getBoundingClientRect().top;

                        e.preventDefault();
                    }
                });

                document.addEventListener('mousemove', (e) => {
                    if (!isDragging) return;

                    draggableBox.style["max-width"] = "";

                    const viewportWidth = window.innerWidth;
                    const viewportHeight = window.innerHeight;
                    const boxWidth = draggableBox.offsetWidth;
                    const boxHeight = draggableBox.offsetHeight;

                    let newX = e.clientX - offsetX;
                    let newY = e.clientY - offsetY;

                    // ----- Snappping logic -----

                    // left
                    if (newX < SNAP_DISTANCE) {
                        draggableBox.style["max-width"] = "100px";
                        newX = 0;
                    }

                    // bottom
                    else if (newY + boxHeight > viewportHeight - SNAP_DISTANCE) {
                        newY = viewportHeight - boxHeight;
                    }

                    // cannot be dragged out of viewport
                    newX = Math.max(0, Math.min(newX, viewportWidth - boxWidth));
                    newY = Math.max(document.getElementById('top-side').offsetHeight, Math.min(newY, viewportHeight - boxHeight));

                    draggableBox.style.left = `${newX}px`;
                    draggableBox.style.top = `${newY}px`;

                    APPLICATION_CONTEXT.setOption(`${id}-PositionLeft`, newX);
                    APPLICATION_CONTEXT.setOption(`${id}-PositionTop`, newY);
                });

                document.addEventListener('mouseup', () => {
                    if (isDragging) {
                        isDragging = false;
                        draggableBox.classList.remove('dragging');
                    }
                });

                document.addEventListener('mouseleave', (e) => {
                    if (isDragging && e.buttons === 1) {
                        isDragging = false;
                        draggableBox.classList.remove('dragging');
                    }
                });
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
            },
            changeTheme(theme = undefined) {
                if (theme === undefined){
                    theme = APPLICATION_CONTEXT.getOption("theme", "auto");
                }
                //["dark", "light", "auto"]
                if (theme === "dark" ||
                    (theme === "auto" && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.body.setAttribute("data-theme", "xOpat-dark");
                    APPLICATION_CONTEXT.setOption("theme", "dark");

                    if(theme === "auto"){
                        APPLICATION_CONTEXT.setOption("theme", "auto");
                    }

                } else {
                    document.body.setAttribute("data-theme", "xOpat-light");
                    APPLICATION_CONTEXT.setOption("theme", "light");
                }
            },
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
                node.style.right = '45px';
                let content = document.createElement("span");
                content.setAttribute("class", "one-liner");
                node.appendChild(content);
                document.getElementById("bottom-menu-right").appendChild(node);
                this.context = node;

                if (!APPLICATION_CONTEXT.getOption("statusBar", true)){
                    $('#viewer-status-bar').toggleClass('hidden');
                }
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
            show: function(loading) {
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
            text: function(titleText = true, descriptionText = "") {
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
            show: function(title = undefined, description = undefined) {
                if (USER_INTERFACE.Errors.active || this.running) return;

                if (!title) title = $.t('tutorials.menu.title');
                if (!description) description = $.t('tutorials.menu.description')

                $("#tutorials-container").removeClass("hidden");
                $("#tutorials-overlay").removeClass("hidden");
                $("#tutorials-title").html(title);
                $("#tutorials-description").html(description);
                this.running = true;
            },

            /**
             * Hide Tutorials
             */
            hide: function () {
                this._hideImpl();
            },

            _hideImpl: function () {
                $("#tutorials-container").addClass("hidden");
                $("#tutorials-overlay").addClass("hidden");
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
            add: function(plugidId, name, description, icon, steps, prerequisites = undefined) {
                if (!icon) icon = "fa-school";
                const pluginName = pluginMeta(plugidId, "name");
                plugidId = plugidId ? `${plugidId}-plugin-root` : "";
                const label = pluginName ? `<span class="rounded-2 px-3 py-1 position-absolute top-1 right-1 bg-opacity" style="font-size: 9px">${pluginName}</span>` : "";
                this.tutorials.append(`
<div class='d-inline-block px-2 pb-2 pt-3 m-1 pointer position-relative v-align-top rounded-2 tutorial-item ${plugidId}' onclick="USER_INTERFACE.Tutorials.run(${this.steps.length});">
${label}
<span class="d-block fa-auto ${icon} f1 text-center my-2"></span><p class='f3-light mb-0'>${name}</p><p>${description}</p></div>`);
                this.steps.push(steps);
                this.prerequisites.push(prerequisites);
            },

            /**
             * Run tutorial
             * @param {(number|Array)} ctx index to the attached tutorials list (internal use) or tutorials data
             *  see add(..) steps parameter
             */
            run: function(ctx) {
                let prereq, data;

                if (Number.isInteger(ctx)) {
                    if (ctx >= this.steps.length || ctx < 0) return;
                    prereq = this.prerequisites[ctx];
                    data = this.steps[ctx];
                } else {
                    data = ctx;
                }

                //reset plugins visibility
                $(".plugins-pin").each(function() {
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
                for (let viewerMenu of VIEWER_MANAGER.viewerMenus) {
                    viewerMenu.menu.focusAll();
                }
                enjoyhintInstance.set(data);
                this.hide();
                enjoyhintInstance.run();
                this.running = false;
            }
        },

        /**
         * Add custom HTML to the DOM selector
         * @param {string|Node|BaseComponent} html to append
         * @param {string} pluginId owner plugin ID
         * @param {string} selector jquery selector where to append, default 'body'
         */
        addHtml: function(html, pluginId, selector="body") {
            try {
                const jqNode = $(UI.BaseComponent.parseDomLikeItem(html));
                jqNode.appendTo(selector).each((idx, element) => $(element).addClass(`${pluginId}-plugin-root`));
                return true;
            } catch (e) {
                console.error("Could not attach custom HTML.", e);
                return false;
            }
        },
    };

    // Make loading show
    setTimeout(() => {
        const loader = USER_INTERFACE.Loading;
        // Only after some time show texts to users - taking too long time
        loader._allowDescription = true;
        if (loader.isVisible()) loader.text(true);
    }, 3000);
}
