function initXOpatUI() {

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

        /**
         * Show notification
         * @param {string} text HTML allowed, but be cautious about security. Use actions in props for activity.
         * @param {number} delayMS >= 1000 autohides, <1000 sticks until closed
         * @param importance one of Dialogs.MSG_*
         * @param {object} props {queued?, onShow?, onHide?, buttons?, actions?}
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
         * Await dialogs are hidden and no messages are shown
         * @return {Promise}
         */
        async awaitHidden() {
            await this._scheduler.awaitHidden();
        },

        /**
         * Place the notification toast at the top or the bottom of the viewport.
         * Persisted on the session via `APPLICATION_CONTEXT.setOption("notificationsPosition", ...)`
         * so the choice survives serialization.
         * @param {"top"|"bottom"} position
         */
        setPosition(position) {
            const pos = position === "top" ? "top" : "bottom";
            this._view?.setPosition(pos);
            APPLICATION_CONTEXT.setOption("notificationsPosition", pos);
        },

        init() {
            if (this._scheduler) return;
            const view = new UI.Toast();
            const initialPosition = APPLICATION_CONTEXT.getOption("notificationsPosition", "bottom");
            view.setPosition(initialPosition);
            this._view = view;
            this._scheduler = new UI.Toast.Scheduler(view);

            (document.body || document.documentElement).appendChild(view.create());

            view.setHoverHandlers?.(
                () => this._scheduler.pause(),
                () => this._scheduler.resume()
            );

            window.addEventListener("unload", () => UI.FloatingWindow.closeAllExternal());
        },

        /**
         * Show custom/dialog window
         * todo consider renaming
         * @param parentId the ID of the plugin or module that attached this dialog
         * @param header content to put in the header
         * @param content content
         * @param footer content to put to the footer
         * @param params
         * @param params.width custom width, can be a CSS value (string) or a number (pixels), by default it
         * @param params.isBlocking whether the dialog should block the user from interacting with the page, default true
         * @param params.allowClose whether to show 'close' button, default true
         * @param params.allowResize whether to allow user to change the window size, default false
         */
        showCustom: function(parentId, header, content, footer, params = {}) {
            let modal = new UI.Modal({
                header: header,
                body: content,
                footer: footer,
                width: params.width,
                isBlocking: params.isBlocking ?? true,
                allowClose: params.allowClose ?? true,
                allowResize: params.allowResize ?? false,
            });

            const node = modal.create();
            if (parentId) {
                node.classList.add(parentId + "-plugin-root");
            } else {
                console.warn("Dialogs.showCustom() called without parent ID.");
            }
            document.body.appendChild(node);
            modal.open();
            return modal;
        },
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
            $("body").append(`<ul id="drop-down-menu" oncontextmenu="return false;" style="display:none;width: auto; max-width: 300px; z-index: 999999999; position: fixed;" class="menu menu-sm bg-base-100 rounded-box shadow"></ul>`);

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
        isOpened: function () {
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
            const opened = this.isOpened();

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
         *   different contents
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
                $("body").addClass("disabled");
                USER_INTERFACE.Tools.close();
                this.active = true;
            },
            /**
             * Hide system-wide error.
             */
            hide: function() {
                $("#system-message").addClass("hidden");
                $("body").removeClass("disabled");
                USER_INTERFACE.Tools.open();
                this.active = false;
            }
        },

        Tooltip: UI.Services.GlobalTooltip, //alias

        MobileBottomBar: UI.Services.MobileBottomBar, //alias

        //setup component in config.json -> can be added in URL, important setting such as removed cookies, theme etc -> can be set from outside
        FullscreenMenu: {
            get context() {
                return UI.Services.FullscreenMenus.context;
            },
            get menu() {
                return UI.Services.FullscreenMenus.menu;
            },
            init: function () {
                const ctx = $("#fullscreen-menu")[0] || document.getElementById("fullscreen-menu") || document.body;
                UI.Services.FullscreenMenus.init(ctx);
                return UI.Services.FullscreenMenus.menu;
            },
            focus(id) {
                return UI.Services.FullscreenMenus.focus(id);
            },
            open(id = undefined) {
                return UI.Services.FullscreenMenus.open(id);
            },
            close() {
                return UI.Services.FullscreenMenus.close();
            },
            setOrientation(orientation) {
                return UI.Services.FullscreenMenus.setOrientation(orientation);
            },
            getSettingsBody: function () {
                return UI.Services.FullscreenMenus.getSettingsBody;
            },
            createCheckbox: function (id, text, onchangeFunction, checked) {
                return UI.Services.FullscreenMenus.createCheckbox(id, text, onchangeFunction, checked);
            },
            getLogo(positionBottom, positionRight) {
                return UI.Services.FullscreenMenus.getLogo(positionBottom, positionRight);
            },
            getPluginsBody: function () {
                return UI.Services.FullscreenMenus.getPluginsBody;
            },
            layout(...sections) {
                return UI.Services.FullscreenMenus.layout(...sections);
            },
            card(title, ...children) {
                return UI.Services.FullscreenMenus.card(title, ...children);
            }
        },

        AppBar: UI.Services.AppBar,

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
             * @param {UIElement|UIElement[]} html
             * @param {string} [icon=fa-wrench]
             * @param {boolean} forceHorizontal
             */
            setMenu(ownerPluginId, toolsMenuId, title, html, icon = "fa-wrench", forceHorizontal = false) {
                if (!Array.isArray(html)) {
                    html = [html];
                }
                const menu = new UI.Toolbar(
                    {
                        id: `toolbar-${ownerPluginId}`,
                        horizontalOnly: forceHorizontal,
                        pluginRootClass: `plugin-${ownerPluginId}-root`,
                        embeddedTitle: title,
                        embeddedIcon: icon,
                    },
                    {
                        id: ownerPluginId+"-"+toolsMenuId+"-tools-panel",
                        icon: icon,
                        title: title,
                        body: html,
                    }
                );
                const container = window.LAYOUT?._toolbarFloatingEl || document.getElementById('toolbars-container');
                if (container) {
                    menu.attachTo(container);
                }
                window.LAYOUT?.registerToolbar?.(menu);
                menu.onLayoutChange({width: window.innerWidth});

                // if (!APPLICATION_CONTEXT.getOption(`toolBar`, true)){
                //     document.querySelectorAll('div[id^="toolbar-"]').forEach((el) => el.classList.add("hidden"));
                // }
                //
                // // snapping  to left side if set in cookies
                // if (APPLICATION_CONTEXT.AppCache.get(`toolbar-${ownerPluginId}-PositionLeft`) == 0){
                //     document.getElementById(`toolbar-${ownerPluginId}`).style["max-width"] = "100px";
                // }
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
         * UI Fullscreen Loading
         */
        Loading: {
            _visible: $("#fullscreen-loader").css('display') !== 'none',
            _allowDescription: false,
            _textTimeout: null,
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
                    // Make loading show
                    this._textTimeout = setTimeout(() => {
                        this._textTimeout = null;
                        this._allowDescription = true;
                        if (this.isVisible()) loader.text(true);
                    }, 3000);
                } else {
                    if (this._textTimeout) {
                        clearTimeout(this._textTimeout);
                        this._textTimeout = null;
                    }
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
                if (!title || !description) return;
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
            steps: [],
            prerequisites: [],
            _entries: [],
            _modal: null,
            running: false,

            _ensureModal: function () {
                if (this._modal) return this._modal;
                this._modal = new UI.TutorialsModal({
                    onSelect: (index) => USER_INTERFACE.Tutorials.run(index),
                    onClose: () => {
                        USER_INTERFACE.Tutorials.running = false;
                        APPLICATION_CONTEXT.AppCookies.set('_shadersPin', 'false');
                    },
                    exitLabel: $.t('common.Exit'),
                });
                this._modal.mount(document.body);
                this._modal.setEntries(this._entries);
                return this._modal;
            },

            /**
             * Open the tutorials selection screen
             * @param {string} title title to show
             * @param {string} description subtitle to show
             */
            show: function(title = undefined, description = undefined) {
                if (USER_INTERFACE.Errors.active || this.running) return;

                if (!title) title = $.t('tutorials.menu.title');
                if (!description) description = $.t('tutorials.menu.description');

                const modal = this._ensureModal();
                modal.setTitle(title);
                modal.setDescription(description);
                modal.setExitLabel($.t('common.Exit'));
                modal.open();
                this.running = true;
            },

            /**
             * Hide Tutorials
             */
            hide: function () {
                this._hideImpl();
            },

            _hideImpl: function () {
                // running flag + cookie cleanup is handled by the modal's onClose hook,
                // so this works regardless of whether the close was triggered by the X
                // button, backdrop, Exit button, or a programmatic hide() call.
                this._modal?.close();
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
                const pluginName = pluginMeta(plugidId, "name");
                this._entries.push({
                    name,
                    description,
                    icon: icon || "fa-school",
                    pluginName,
                    pluginRootClass: plugidId ? `${plugidId}-plugin-root` : "",
                });
                this.steps.push(steps);
                this.prerequisites.push(prerequisites);
                this._modal?.setEntries(this._entries);
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
                // VIEWER_MANAGER.viewerMenus is a Record<cellId, RightSideViewerMenu>,
                // not an array — iterate values, not the object itself.
                for (let viewerMenu of Object.values(VIEWER_MANAGER.viewerMenus)) {
                    viewerMenu?.menu?.focusAll?.();
                }
                enjoyhintInstance.set(data);
                this.hide();
                enjoyhintInstance.run();
                this.running = false;
            }
        },

        /**
         * Add custom HTML to the DOM selector
         * @param {UIElement} html to append
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

        /**
         * Add custom HTML to the viewer-dependent context - it will be contained within the viewer area.
         * This HTML IS NOT GUARANTEED TO BE PRESERVED when changing viewers.
         * Plugins must listen to change in viewer events to update the UI if necessary,
         * and should not rely on this HTML being persistent - when a viewer is gone, so is the HTML.
         *
         * @param {UIElement} html
         * @param {string} pluginId
         * @param {OpenSeadragon.Viewer|string} uniqueViewerId
         * @return {boolean}
         */
        addViewerHtml: function (html, pluginId, uniqueViewerId) {
            try {
                const jqNode = $(UI.BaseComponent.parseDomLikeItem(html));
                const viewer = (uniqueViewerId instanceof OpenSeadragon.Viewer) ?
                    uniqueViewerId : VIEWER_MANAGER.getViewer(uniqueViewerId);
                const cell = VIEWER_MANAGER.layout.findCellById(viewer?.id);

                if (!cell) {
                    console.error("Could not find cell to attach to.");
                    return false;
                }

                let parent;
                for (let child of cell.children) { if (child.dataset.kind === 'custom-viewer-html') { parent = child; break; } }
                if (!parent) {
                    parent = van.tags.div({class: "absolute", style: "pointer-events: none; top: 0; left: 0; right: 0; bottom: 0; overflow: hidden;"});
                    parent.dataset.kind = 'custom-viewer-html';
                    cell.appendChild(parent);
                } else {
                    for (let ch of parent.children) {
                        if (ch.dataset.id === pluginId) {
                            ch.remove();
                        }
                    }
                }

                // todo: viewer might get re-initialized, reusing the same cell - ensure we replace
                jqNode.appendTo(parent).each((idx, element) => {
                    element.classList.add(`${pluginId}-plugin-root`);
                    element.style.pointerEvents = 'auto';
                    element.dataset.id = pluginId;
                });
                return true;
            } catch (e) {
                console.error("Could not attach custom HTML.", e);
                return false;
            }
        },
    };

    let resizeTimer;
    // resize handler to notify layout changes
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            // todo, either use window events directly, or convert to the openseadragon event system!
            window.dispatchEvent(new CustomEvent('app:layout-change', {
                detail: { width: window.innerWidth }
            }));
        }, 200);
    });
    // todo: maybe allow contextual override (based on http client)
    window.XOpatSessionRecovery = {
        isReloading: false,
        // (_reason?: { status?: number; code?: string; message?: string; source?: string })
        handle: (_reason) => {
            if (this.isReloading) return true;
            this.isReloading = true;

            try { USER_INTERFACE.Loading.show(false); } catch (_) { }

            // todo maybe do not force reload, make it optional?
            const reload = () => {
                try { window.location.reload(); } catch (_) { window.location.href = window.location.href; }
            };

            Dialogs.show($.t('error.sessionExpiredReloading'), 20000, Dialogs.MSG_ERR, {
                queued: false,
                onHide: reload,
            });

            window.setTimeout(reload, 2600);
            return true;
        }
    };
}
