(function(window) {

    window.Dialogs = {
        MSG_INFO: { class: "", icon: '<path fill-rule="evenodd"d="M6.3 5.69a.942.942 0 0 1-.28-.7c0-.28.09-.52.28-.7.19-.18.42-.28.7-.28.28 0 .52.09.7.28.18.19.28.42.28.7 0 .28-.09.52-.28.7a1 1 0 0 1-.7.3c-.28 0-.52-.11-.7-.3zM8 7.99c-.02-.25-.11-.48-.31-.69-.2-.19-.42-.3-.69-.31H6c-.27.02-.48.13-.69.31-.2.2-.3.44-.31.69h1v3c.02.27.11.5.31.69.2.2.42.31.69.31h1c.27 0 .48-.11.69-.31.2-.19.3-.42.31-.69H8V7.98v.01zM7 2.3c-3.14 0-5.7 2.54-5.7 5.68 0 3.14 2.56 5.7 5.7 5.7s5.7-2.55 5.7-5.7c0-3.15-2.56-5.69-5.7-5.69v.01zM7 .98c3.86 0 7 3.14 7 7s-3.14 7-7 7-7-3.12-7-7 3.14-7 7-7z"/>' },
        MSG_WARN: { class: "Toast--warning", icon: '<path fill-rule="evenodd" d="M8.893 1.5c-.183-.31-.52-.5-.887-.5s-.703.19-.886.5L.138 13.499a.98.98 0 0 0 0 1.001c.193.31.53.501.886.501h13.964c.367 0 .704-.19.877-.5a1.03 1.03 0 0 0 .01-1.002L8.893 1.5zm.133 11.497H6.987v-2.003h2.039v2.003zm0-3.004H6.987V5.987h2.039v4.006z" />' },
        MSG_ERR: { class: "Toast--error", icon: '<path fill-rule="evenodd" d="M10 1H4L0 5v6l4 4h6l4-4V5l-4-4zm3 9.5L9.5 14h-5L1 10.5v-5L4.5 2h5L13 5.5v5zM6 4h2v5H6V4zm0 6h2v2H6v-2z" />' },
        _timer: null,
        _modals: {},

        init: function() {
            $("body").append(`<div id="dialogs-container" class="Toast popUpHide position-fixed" style='z-index: 5050; transform: translate(calc(50vw - 50%));'>
<span class="Toast-icon"><svg width="12" height="16" id="notification-bar-icon" viewBox="0 0 12 16" class="octicon octicon-check" aria-hidden="true"></svg></span>
<span id="system-notification" class="Toast-content v-align-middle height-full position-relative" style="max-width: 350px;"></span>
<button class="Toast-dismissButton" onclick="Dialogs._hideImpl(false);">
<svg width="12" height="16" viewBox="0 0 12 16" class="octicon octicon-x" aria-hidden="true"><path fill-rule="evenodd" d="M7.48 8l3.75 3.75-1.48 1.48L6 9.48l-3.75 3.75-1.48-1.48L4.52 8 .77 4.25l1.48-1.48L6 6.52l3.75-3.75 1.48 1.48L7.48 8z"/></svg>
</button></div>`);

            this._body = $("#dialogs-container");
            this._board = $("#system-notification");
            this._icon = $("#notification-bar-icon");

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
         */
        show: function (text, delayMS=5000, importance=Dialogs.MSG_INFO) {
            this._board.html(text);
            this._icon.html(importance.icon);
            this._body.removeClass(); //all
            this._body.addClass(`Toast position-fixed ${importance.class}`);
            this._body.removeClass("popUpHide");
            this._body.addClass("popUpEnter");

            if (delayMS > 1000) {
                this._timer = setTimeout(this.hide.bind(this), delayMS);
            }
        },

        /**
         * Hide notification
         */
        hide: function () {
            this._hideImpl(true);
        },

        _hideImpl: function(timeoutCleaned) {
            this._body.removeClass("popUpEnter");
            this._body.addClass("popUpHide");

            if (!timeoutCleaned && this._timer) {
                clearTimeout(this._timer);
            }
            this._timer = null;
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
        showCustom: function(parentId, header, content, footer, params={allowClose:true}) {
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
         * @param parentId unique ID to the modals context (does not have to be unique in this DOM, it has a different one)
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
                `style="width: 100%; height: 100%"`, {defaultHeight: "100%"}));
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

            this._showCustomModalImpl(parentId, title, `
<script type="text/javascript" src="${APPLICATION_CONTEXT.rootPath}/external/monaco/loader.js"><\/script>
<script type="text/javascript">
require.config({
  paths: { vs: "${APPLICATION_CONTEXT.rootPath}/external/monaco" }
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
         Diag.warn("Could not save the code.", 3500, Diag.MSG_ERR);
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

document.addEventListener('keydown', function (e) {
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
         * TODO sometimes ctx.window valid but does not have getElementByID etc... fix
         *
         * @param id id used to create the window
         * @returns {window || undefined || null} window context or undefined
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
         * @returns {boolean} true if managed to close
         */
        closeWindow: function(id) {
            if (!id) {
                console.error("Invalid form: unique container id not defined.");
                return false;
            }

            let node = document.getElementById(id);
            if (node && node.dataset.dialog !== "true") {
                console.error("Invalid form: identifier not unique.");
                return false;
            }
            if (node) $(node).remove();

            if (this._modals[id]) {
                let ctx = this._modals[id].context;
                if (ctx && ctx.window) ctx.window.close();
                this._destroyModalWindow(id, ctx);
            }
            return true;
        },

        _showCustomModalImpl: function(id, title, html, size='width=450,height=250', customCall=function () {}) {
            //can be called recursively from message popup, that's why we cache it
            if (html) this._cachedHtml = html;
            else html = this._cachedHtml;
            if (!html) return;

            this._cachedCall = customCall;
            let result = this._openModalWindow(id, title, html, size);
            if (!result.context) {
                this.show(`An application modal window '${title}' was blocked by your browser. <a onclick="
Dialogs._showCustomModalImpl('${id}', '${title}', null, '${size}'); Dialogs.hide();" class='pointer'>Click here to open.</a>`,
                    15000, this.MSG_WARN);
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
        <link rel="stylesheet" href="${APPLICATION_CONTEXT.rootPath}/assets/style.css">
        <link rel="stylesheet" href="${APPLICATION_CONTEXT.rootPath}/external/primer_css.css">
        <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
        <script src="https://code.jquery.com/jquery-3.5.1.min.js"><\/script>
        <script type="text/javascript">
            //route to the parent context
            window.confirm = function(message) {
                window.opener.focus();
                window.opener.confirm(message);
            };
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
            let body = context ? context.document.getElementById("body") : undefined;
            if (body) body.innerHTML = "";
            URL.revokeObjectURL(this._modals[id].objUrl);
            delete this._modals[id];
        },

        _buildComplexWindow: function(isModal, parentId, title, content, footer, positionStrategy, params) {
            //preventive close, applies to non-modals only
            if (!isModal && !this.closeWindow(parentId)) return;
            params = params || {};
            let height = params.defaultHeight === undefined ? "" :
                (typeof params.defaultHeight === "string" ? params.defaultHeight : params.defaultHeight+"px");

            let close = params.allowClose ? this._getCloseButton(parentId) : '';
            let resize = params.allowResize ? "resize:vertical;" : "";
            footer = footer ? `<div class="position-absolute bottom-0 right-0 left-0 border-top"
style="border-color: var(--color-border-primary);">${footer}</div>` : "";

            let limits = isModal ? "style='width: 100%; height: 100vh;'" : "style='max-width:80vw; max-height: 80vh'";
            let diaClasses = isModal ? "" : "Box Box--overlay";

            return `<div id="${parentId}" data-dialog="true" ${positionStrategy}>
<details-dialog class="${diaClasses} d-flex flex-column" ${limits}>
    <div id="window-header" class="Box-header noselect" id="${parentId}-header">
      ${close}
      <h3 class="Box-title">${title}</h3>
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

        _getCloseButton: function(id) {
            return `<button class="Box-btn-octicon btn-octicon float-right" type="button"
aria-label="Close help" onclick="Dialogs.closeWindow('${id}')">
<svg class="octicon octicon-x" viewBox="0 0 12 16" version="1.1" width="12" height="16" aria-hidden="true">
<path fill-rule="evenodd" d="M7.48 8l3.75 3.75-1.48 1.48L6 9.48l-3.75 3.75-1.48-1.48L4.52 8 .77
4.25l1.48-1.48L6 6.52l3.75-3.75 1.48 1.48L7.48 8z"></path></svg></button>`;
        }
    }; // end of namespace Dialogs
    Dialogs.init();

    let pluginsToolsBuilder;

    window.USER_INTERFACE = {
        /**
         * Workspace (canvas) margins
         */
        Margins : {
            top: 0,
            bottom: 0,
            left: 0,
            right: 0
        },

        /**
         * Dialog System
         */
        Dialogs: Dialogs,

        /**
         * Full screen Errors
         */
        Errors: {
            active: false,
            show: function(title, description, withHiddenMenu=false) {
                USER_INTERFACE.Tutorials._hideImpl(false); //preventive
                $("#system-message-title").html(title);
                $("#system-message-details").html(description);
                $("#system-message").removeClass("d-none");
                $("#viewer-container").addClass("disabled");
                if (withHiddenMenu) USER_INTERFACE.MainMenu.close();
                USER_INTERFACE.Tools.close();
                this.active = true;
            },
            hide: function() {
                $("#system-message").addClass("d-none");
                $("#viewer-container").removeClass("disabled");
                USER_INTERFACE.Tools.open();
                this.active = false;
            }
        },

        /**
         * Application Main Menu (left-side)
         */
        MainMenu: {
            context: $("#main-panel"),
            content: $("#main-panel-content"),
            navigator: $("#navigator-container"),
            opened: true,
            append: function(title, titleHtml, html, id, pluginId) {
                this.content.append(`<div id="${id}" class="inner-panel ${pluginId}-plugin-root inner-panel-simple"><div><h3 class="d-inline-block h3" style="padding-left: 15px;">${title}&emsp;</h3>${titleHtml}</div><div>${html}</div></div>`);
            },
            replace: function(title, titleHtml, html, id, pluginId) {
                $(`.${pluginId}-plugin-root`).remove();
                this.append(title, titleHtml, html, id, pluginId);
            },
            appendExtended: function(title, titleHtml, html, hiddenHtml, id, pluginId) {
                this.content.append(`<div id="${id}" class="inner-panel ${pluginId}-plugin-root"><div>
<span class="material-icons inline-arrow plugins-pin btn-pointer" id="${id}-pin" onclick="USER_INTERFACE.clickMenuHeader($(this), $(this).parent().parent().children().eq(2));" style="padding: 0;">navigate_next</span>
<h3 class="d-inline-block h3 btn-pointer" onclick="USER_INTERFACE.clickMenuHeader($(this.previousElementSibling), $(this).parent().parent().children().eq(2));">${title}&emsp;</h3>${titleHtml}
</div><div class="inner-panel-visible">${html}</div><div class="inner-panel-hidden">${hiddenHtml}</div></div>`);
            },
            replaceExtended: function(title, titleHtml, html, hiddenHtml, id, pluginId) {
                $(`.${pluginId}-plugin-root`).remove();
                this.appendExtended(title, titleHtml, html, hiddenHtml, id, pluginId);
            },
            appendRaw: function(html, id, pluginId) {
                this.content.append(`<div id="${id}" class="inner-panel ${pluginId}-plugin-root inner-panel-visible">${html}</div>`);
            },
            open() {
                this.context.css("right", "0");
                this.opened = true;
                USER_INTERFACE.Margins.right = 400;
                this._sync();
            },
            close() {
                this.context.css("right", "-400px");
                this.opened = false;
                USER_INTERFACE.Margins.right = 0;
                this._sync();
            },
            _sync() {
                this.navigator.css("position", this.opened ? "relative" : this.navigator.attr("data-position"));
                let width = this.opened ? "calc(100% - 400px)" : "100%";
                USER_INTERFACE.AdvancedMenu.selfContext.context.style['max-width'] = width;
                if (pluginsToolsBuilder) {
                    pluginsToolsBuilder.context.style.width = width;
                }
            }
        },

        /**
         * Tools menu by default invisible (top)
         */
        Tools: {
            setMenu(ownerPluginId, toolsMenuId, title, html, icon="") {
                if (!pluginsToolsBuilder) {
                    pluginsToolsBuilder = new UIComponents.Containers.PanelMenu("plugin-tools-menu");
                    //todo set these colors manually in CSS!!! for different themes
                    pluginsToolsBuilder.context.classList.add("bg-opacity");
                    USER_INTERFACE.MainMenu._sync();
                }
                pluginsToolsBuilder.set(ownerPluginId, toolsMenuId, title, html, icon);
                if (pluginsToolsBuilder.isVisible) {
                    USER_INTERFACE.Margins.bottom = pluginsToolsBuilder.height;
                }
            },
            /**
             * Show desired toolBar menu. Also opens the toolbar if closed.
             * @param {string|undefined} toolsId menu id to open at
             */
            open(toolsId=undefined) {
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
            notify(menuId, symbol=undefined) {
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
         * Menu that covers most of the screen and hides more advanced UI elements and other features
         */
        AdvancedMenu: {
            self: $("#fullscreen-menu"),
            selfContext: new UIComponents.Containers.PanelMenu("fullscreen-menu"),
            /**
             * Add menu
             * @param {string} ownerPluginId context ID: the ID of plugin the menu belongs to
             *  e.g. should be called once if withSubmenu=false, the last call is the only menu shown under this ID
             *  e.g. can be called many times if withSubmenu=true, then all menus are treated as submenus
             * @param {string} toolsMenuId menu ID: should be unique across menus
             * @param {string} title menu title as shown in the menu tab
             * @param {string} html menu content
             * @param {string} icon google icon tag
             * @param {boolean} withSubmenu true if the menu allows submenus: in that case, all added menus with the
             *  same owner ID are actually submenus
             * @param {boolean} container true if a common container should be added (i.e. margins/padding)
             */
            setMenu(ownerPluginId, toolsMenuId, title, html, icon="", withSubmenu=true, container=true) {
                //todo allow multiple main menus for plugin?
                let plugin = PLUGINS[ownerPluginId];
                if (!plugin || !ownerPluginId) return;
                this._buildMenu(plugin, "__selfMenu", ownerPluginId, plugin.name, ownerPluginId, toolsMenuId, title, html,
                    icon, withSubmenu, container);
            },
            /**
             * Open the Menu UI at desired tab
             * @param {string|undefined} atPluginId menu tab to open
             */
            openMenu(atPluginId=undefined) {
                this.selfContext.show(atPluginId);
                if (window.innerWidth < 1150) {
                    this._closedMm = true;
                    USER_INTERFACE.MainMenu.close();
                }
            },
            /**
             * Open the Menu UI at desired sub-menu tab
             * @param {string} atPluginId menu tab to open
             * @param {string|undefined} atSubId sub-menu tab to open
             */
            openSubmenu(atPluginId, atSubId=undefined) {
                this.openMenu(atPluginId);
                let plugin = PLUGINS[atPluginId];
                if (!plugin) return;
                let builder = plugin.__selfMenu;
                if (builder) builder.show(atSubId);
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
            _build() {
                USER_INTERFACE.MainMenu._sync();
                this.selfContext.isHorizontal = false;
                this.selfContext.menuWith1Element = true;
                this.selfContext.isFullSize = true;

                buildMetaDataMenu(this);
                buildPluginsMenu(this);
                buildSettingsMenu(this);

                $(this.selfContext.head).prepend('<span class="material-icons btn-pointer mb-2" onclick="USER_INTERFACE.AdvancedMenu.close();">close</span>');
                $(this.selfContext.head).append('<span class="width-full" style="height: 1px; border: solid; opacity: 0.1;"></span>');
            },
            _buildMenu(context, builderId, parentMenuId, parentMenuTitle, ownerPluginId, toolsMenuId,
                       title, html, icon, withSubmenu, container) {

                let builder = context[builderId];

                if (!withSubmenu && builder) {
                    builder.remove();
                    delete context.__selfMenu;
                    builder = undefined;
                }
                html = container ? `<div class="height-full position-relative" style="padding: 30px 45px 12px 25px; width: 650px;">${html}</div>` : html;
                if (!builder) {
                    if (withSubmenu) {
                        this.selfContext.set(ownerPluginId, parentMenuId, parentMenuTitle,
                            `<div id='advanced-menu-${ownerPluginId}'></div>`);
                        builder = new UIComponents.Containers.PanelMenu(`advanced-menu-${ownerPluginId}`);
                        context.__selfMenu = builder;
                    } else {
                        this.selfContext.set(ownerPluginId, toolsMenuId, title, html, icon);
                        return;
                    }
                }
                builder.set(null, toolsMenuId, title, html, icon);
            }
        },

        /**
         * Tutorial system
         */
        Tutorials: {
            tutorials: $("#tutorials"),
            steps: [],
            prerequisites: [],

            show: function(title="Select a tutorial", description="The visualisation is still under development: components and features are changing. The tutorials might not work, missing or be outdated.") {
                if (USER_INTERFACE.Errors.active || this.running) return;

                $("#tutorials-container").removeClass("d-none");
                $("#viewer-container").addClass("disabled");
                $("#tutorials-title").html(title);
                $("#tutorials-description").html(description);
                USER_INTERFACE.MainMenu.close();
                USER_INTERFACE.Tools.close();
                USER_INTERFACE.AdvancedMenu.close();
                this.running = true;
            },

            hide: function() {
                this._hideImpl(true);
            },

            _hideImpl: function(reflectGUIChange) {
                $("#tutorials-container").addClass("d-none");
                if (reflectGUIChange) {
                    $("#viewer-container").removeClass("disabled");
                    USER_INTERFACE.MainMenu.open();
                    USER_INTERFACE.Tools.open();
                }
                this.running = false;
                document.cookie = '_shadersPin=false; expires=Fri, 31 Dec 9999 23:59:59 GMT; SameSite=None; Secure=false; path=/';
            },

            add: function(plugidId, name, description, icon, steps, prerequisites=undefined) {
                if (!icon) icon = "school";
                plugidId = plugidId ? `${plugidId}-plugin-root` : "";
                this.tutorials.append(`
<div class='d-inline-block px-2 py-2 m-1 pointer v-align-top rounded-2 tutorial-item ${plugidId}' onclick="USER_INTERFACE.Tutorials.run(${this.steps.length});">
<span class="d-block material-icons f1 text-center my-2">${icon}</span><p class='f3-light mb-0'>${name}</p><p>${description}</p></div>`);
                this.steps.push(steps);
                this.prerequisites.push(prerequisites);
            },

            run: function(index) {
                if (index >= this.steps.length || index < 0) return;
                USER_INTERFACE.MainMenu.open();

                //reset plugins visibility
                $(".plugins-pin").each(function() {
                    let pin = $(this);
                    let container = pin.parents().eq(1).children().eq(2);
                    pin.removeClass('pressed');
                    container.removeClass('force-visible');
                });

                let prereq = this.prerequisites[index];
                let enjoyhintInstance = new EnjoyHint({
                    onStart: function () {
                        window.addEventListener("resize", enjoyhintInstance.reRender, false);
                        window.addEventListener("click", enjoyhintInstance.rePaint, false);

                        if (prereq) prereq();
                    },
                    onEnd : function () {
                        window.removeEventListener("resize", enjoyhintInstance.reRender, false);
                        window.removeEventListener("click", enjoyhintInstance.rePaint, false);
                    },
                    onSkip: function () {
                        window.removeEventListener("resize", enjoyhintInstance.reRender, false);
                        window.removeEventListener("click", enjoyhintInstance.rePaint, false);
                    }
                });
                enjoyhintInstance.set(this.steps[index]);
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
        addHtml: function(html, pluginId, selector="body") {
            try {
                $(html).appendTo(selector).each((idx, element) => $(element).addClass(`${pluginId}-plugin-root`));
                return true;
            } catch (e) {
                console.error("Could not attach custom HTML.", e);
                return false;
            }
        },

        clickMenuHeader: function(jQSelf, jQTargetParent) {
            if (jQTargetParent.hasClass('force-visible')) {
                jQTargetParent.removeClass('force-visible');
                jQSelf.removeClass('opened');
            } else {
                jQSelf.addClass('opened');
                jQTargetParent.addClass('force-visible');
            }
        },
    };

    /******************* ADVANCED MENUS *********************/

    function buildSettingsMenu(ctx) {
        let inputs = UIComponents.Elements;
        let notifyNeedRefresh = "$('#settings-notification').css('visibility', 'visible');";
        let updateOption = (name, cookies=false) => `APPLICATION_CONTEXT.setOption('${name}', $(this).val(), ${cookies});`;
        let updateBool = (name, cookies=false) => `APPLICATION_CONTEXT.setOption('${name}', this.checked, ${cookies});`;
        let standardBoolInput = (id, title) => inputs.checkBox({
            label: title, onchange: updateBool(id) + notifyNeedRefresh, default: APPLICATION_CONTEXT.getOption(id)
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
<span class="f3-light text-shadow" style="position: absolute; top: 80px; right: 70px;">Pathopus</span>
<span class="f3-light text-shadow" style="position: absolute; top: 97px;right: 61px;">Viewer</span>
<span class="f6" style="color: var(--color-text-tertiary);    position: absolute;top: 73px;right: 59px;">v${APPLICATION_CONTEXT.version}</span>
<span class="f3-light header-sep">Appearance</span><br>
Theme &emsp; ${inputs.select({
                classes: "select-sm",
                onchange: `${updateOption("theme", true)} UTILITIES.updateTheme();`,
                default: APPLICATION_CONTEXT.getOption("theme"),
                options: {auto: "Automatic", light: "Light Theme", dark_dimmed: "Dimmed Theme", dark: "Dark Theme"}
})}
<br> ${inputs.checkBox({
                label: "Show ToolBar",
                onchange: "$('#plugin-tools-menu').toggleClass('d-none')",
                default: true
})}
<br> ${standardBoolInput("scaleBar", "Show ScaleBar")}
<br><br><span class="f3-light header-sep">Behaviour</span><br>
${standardBoolInput("bypassCookies", "Disable Cookies")}
<br><br><span class="f3-light header-sep">Other</span><br>
<br>${standardBoolInput("debugMode", "Debug Mode")}
<br>${standardBoolInput("webglDebugMode", "Debug Rendering")}
`, 'settings', false, true);
    }

    let pluginsMenuBuilder;
    function buildPluginsMenu(ctx) {
        ctx._buildMenu(ctx, "__pMenu", "", "", APPLICATION_CONTEXT.pluginsMenuId,
            APPLICATION_CONTEXT.pluginsMenuId, "Plugins",  `<div class="d-flex flex-column-reverse">
<button onclick="USER_INTERFACE.AdvancedMenu.refreshPageWithSelectedPlugins();" class="btn">Load with selected</button>
</div><hr>
<div id='plug-list-content-inner'></div>
`, 'extension', false, true);

        pluginsMenuBuilder = new UIComponents.Containers.RowPanel("plug-list-content-inner",
            UIComponents.Components.SelectableImageRow,
            {multiselect: true, id: 'plug-list-content'});

        for (let pid in PLUGINS) {
            if (!PLUGINS.hasOwnProperty(pid)) continue;
            let plugin = PLUGINS[pid];
            let errMessage = plugin.error ? `<div class="p-1 rounded-2 error-container">${plugin.error}</div>` : "";
            let problematic = `<div id="error-plugin-${plugin.id}" class="mx-2 mb-3 text-small">${errMessage}</div>`;
            let actionPart = `<div id="load-plugin-${plugin.id}"><button onclick="UTILITIES.loadPlugin('${plugin.id}');return false;" class="btn">Load</button></div>`;
            pluginsMenuBuilder.addRow({
                title: plugin.name,
                author: plugin.author,
                details: plugin.description,
                customContent: problematic + (plugin.html || ""),
                icon: plugin.icon,
                value: plugin.id,
                selected: plugin.loaded,
                contentAction:actionPart
            });
        }
    }

    USER_INTERFACE.AdvancedMenu.refreshPageWithSelectedPlugins = function() {
        let formData = [],
            plugins = pluginsMenuBuilder.builder.getSelected();

        for (let plugin of plugins) {
            formData.push("<input type='hidden' name='", plugin.id ,"' value='1'>");
        }
        let pluginCookie = APPLICATION_CONTEXT.getOption("permaLoadPlugins") ? plugins.join(',') : "";
        document.cookie = `_plugins=${pluginCookie}; ${APPLICATION_CONTEXT.cookiePolicy}`;
        UTILITIES.refreshPage(formData.join(""), plugins);
    };

    let metaContext = {};
    let vegaInit = {};

    /**
     * Allowed types of page[] are either 'vega', 'columns' or 'newline' or types of UIComponents.Elements
     * Columns
     * todo some sanitization of raw fields, e.g. 'classes'
     * @type {{}}
     */
    function buildElements(root) {
        let html = [];
        root.classes = root.classes || "m-2 px-1";
        try {
            switch (root.type) {
                case 'vega':
                    let uid = `vega-${Date.now()}`;
                    html.push(`<div class="${root.classes}" id="${uid}"></div>`);
                    vegaInit[uid] = root;
                    break;
                case 'columns':
                    html.push(`<div class="d-flex ${root.classes}">`);
                    for (let col of root.children) {
                        col.classes = (col.hasOwnProperty('classes') ? col.classes : "") + " flex-1";
                        html.push(...buildElements(col));
                    }
                    html.push('</div>');
                    break;
                default:
                    html.push(UIComponents.Elements[root.type](root));
                    break;
            }
        } catch (e) {
            console.warn("Failed to generate HTML.", root, e);
            return ["<div class=\"error-container\">Unable to show this field: invalid configuration.</div>"];
        }
        return html;
    }
    function loadVega(initialized=false) {
        for (let id in vegaInit) {
            let object = vegaInit[id];
            if (object.view) continue;
            if (!window.vega || !window.vega.View) {
                if (initialized) throw "Could not load vega: ignoring vega components.";

                UTILITIES.loadModules(function() {
                    loadVega(true);
                }, 'vega');
                return;
            }

            object.view = new vega.View(vega.parse(object.specs), {renderer: 'canvas', container: `#${id}`, hover: true});
            object.view.runAsync();
        }
    }
    function buildMetaDataMenu(ctx) {
        for (let key in APPLICATION_CONTEXT.setup.dataPage) {
            let data = APPLICATION_CONTEXT.setup.dataPage[key];
            let html = [];

            for (let element of (data.page || [])) {
                html.push(...buildElements(element));
            }

            ctx._buildMenu(metaContext, "__selfMenu", "__meta", "Data", APPLICATION_CONTEXT.metaMenuId,
                key + "-menu-data-page", data.title || key,  html.join(""), '', true, true);
        }
        loadVega();
    }
})(window);
