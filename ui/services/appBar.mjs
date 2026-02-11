import { Div } from '../classes/elements/div.mjs';
import { TabsMenu } from '../classes/components/tabsMenu.mjs';
import { MainPanel } from '../classes/components/mainPanel.mjs';
import { Dropdown } from '../classes/elements/dropdown.mjs';
import { Button } from '../classes/elements/buttons.mjs';
import { Menu } from '../classes/components/menu.mjs';
import { MenuTabBanner } from '../classes/components/menuTabBanner.mjs';
import { FAIcon } from '../classes/elements/fa-icon.mjs';

export class AppBar {

    init() {
        window.addEventListener('app:layout-change', (e) => {
            // Každá komponenta se sama rozhodne, co udělá
            this.onLayoutChange?.(e.detail);
        });
        // Left part of the app bar: modifiable and customizable menu
        this.context = $("#top-side-left");
        this.menu = new MainPanel({
                id: "visual-menu",
                orientation: Menu.ORIENTATION.TOP,
                buttonSide: Menu.BUTTONSIDE.LEFT,
                rounded: Menu.ROUNDED.ENABLE,
                extraClasses: {bg: "bg-transparent"},
            }, {
                id: "view",
                icon: "fa-window-restore",
                title: $.t('main.bar.view'),
                body: [],
                class: Dropdown,
                // MODIFIED: Use 'min-w-max' for width and 'check' style for selection
                extraClasses: { width: "min-w-max" },
                onClick: e => this.View._refreshVisualDropdown()
            }, {
                id: "plugins", icon: "fa-bars", title: $.t('main.bar.plugins'),
                body: [], class: Dropdown
            }
        );
        this.menu.attachTo(this.context);
        this.menu.set(Menu.DESIGN.TITLEICON);

        this.rightMenuCollapsed = new MainPanel({
                id: "top-user-buttons-menu-collapsed",
                orientation: Menu.ORIENTATION.TOP,
                buttonSide: Menu.BUTTONSIDE.LEFT,
                rounded: Menu.ROUNDED.ENABLE,
                extraClasses: {bg: "bg-transparent"},
            },{
                id: "Menu", icon: "fa-bars",
                body: [], class: Dropdown
            }
        );
        this.rightMenuSideCollapsed.init(this.rightMenuCollapsed.getTab("Menu"));

        // Right part: static
        this.rightMenu = new MainPanel({
                id: "top-user-buttons-menu",
                orientation: Menu.ORIENTATION.TOP,
                buttonSide: Menu.BUTTONSIDE.LEFT,
                rounded: Menu.ROUNDED.ENABLE,
                extraClasses: { bg: "bg-transparent" }
            },
            { id: "banner", icon: "fa-warning", title: "Banner", body: undefined, class: MenuTabBanner },
            { id: "settings", icon: "fa-gear", title: $.t('main.bar.settings'), body: undefined, onClick: function () {USER_INTERFACE.FullscreenMenu.menu.focus("settings-menu")} },
            { id: "tutorial", icon: "fa-graduation-cap", title: $.t('main.bar.tutorials'), body: undefined, onClick: function () {USER_INTERFACE.Tutorials.show();} },
            { id: "share", icon: "fa-share-nodes", title: $.t('main.bar.share'), items: [
                    {
                        id: "global-export",
                        domID: true,
                        label: $.t("main.bar.exportFile"),
                        hint: $.t("main.bar.explainExportFile"),
                        onClick: () => {
                            UTILITIES.export();
                            this.rightMenu.closeTab("share");
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
                            this.rightMenu.closeTab("share");
                        },
                        icon: "fa-link"
                    }
                ], class: Dropdown},
            { id: "user", icon: "fa-circle-user", title: XOpatUser.instance().name || $.t('user.anonymous'), body: undefined, styleOverride: true, class: UI.MenuButton}
        );

        this.rightMenu.attachTo($("#top-side-left-user"));
        this.rightMenu.set(Menu.DESIGN.ICONONLY);
        this.rightMenuCollapsed.attachTo($("#top-side-left-user"));
        this.rightMenuCollapsed.set(Menu.DESIGN.ICONONLY);

        if (window.innerWidth < 600) {
            this.rightMenu.setClass("display", "hidden");
            console.log("Here")
            console.log(this.rightMenu)
        } else {
            console.log("Here")
            this.rightMenuCollapsed.setClass("display", "hidden");
            console.log(this.rightMenuCollapsed)
        }

        // Fullscreen button switch
        this.button = new Button({
                id: "fullscreen-button",
                size: Button.SIZE.SMALL,
                onClick: function () {

                    // todo through API, remove usage of the IDs!
                    // add components which you want to be hidden on fullscreen here:
                    document.getElementById("top-side-left-user").classList.toggle("invisible");
                    document.getElementById("top-side-left").classList.toggle("invisible");

                    // cannot hide whole top-side, because it contains also fullscreen button
                    document.getElementById("top-side").classList.toggle("opaque-bg");
                    const toolbarDivs = document.querySelectorAll('div[id^="toolbar-"]');
                    if (toolbarDivs.length >= 0 && toolbarDivs[0].classList.contains("hidden")){
                        toolbarDivs.forEach((el) => el.classList.remove("hidden"));
                    } else {
                        toolbarDivs.forEach((el) => el.classList.add("hidden"));
                    }

                    this._fullscreen = !this._fullscreen;
                }
            },
            new FAIcon("fa-up-right-and-down-left-from-center"));
        this._fullscreen = false; // todo option
        this.button.attachTo($("#top-side-left-fullscreen"));

        // init submenus
        this.View.init(this.menu.getTab("view"));
        this.Plugins.init(this.menu.getTab("plugins"));
    }

    /**
     * Register top menu tab item.
     * @param ownerPluginId id of the plugin that owns the tab
     * @param title title of the tab
     * @param icon icon of the tab
     * @param body body of the tab, can be added later
     * @param itemClass
     * @return {MenuTab} Menu tab of the class that was requested, default a DropDown
     */
    addTab(ownerPluginId, title, icon="", body=[], itemClass=Dropdown) {
        return this.menu.addTab({ id: ownerPluginId, icon: icon, title: title, body: body, styleOverride: true, class: itemClass})
    }

    /**
     * Top App Bar - banner message / item
     * @param banner
     */
    setBanner(banner) {
        const bItem = this.rightMenu.getTab("banner");
        if (banner) {
            bItem.toggleHiden();
            bItem.setVisuals(banner);
        } else {
            //todo might dissinc
            bItem.toggleHiden();
        }
    }

    isFullScreen() {
        return this._fullscreen;
    }

    rightMenuSideCollapsed = {
        init(subMenu) {
            this.subMenu = subMenu;
            this.subMenu.addItem({ id: "banner", icon: "fa-warning", label: "Banner", body: undefined, class: MenuTabBanner })
            this.subMenu.addItem({ id: "settings", icon: "fa-gear", label: $.t('main.bar.settings'), body: undefined, onClick: function () {USER_INTERFACE.FullscreenMenu.menu.focus("settings-menu")} })
            this.subMenu.addItem({ id: "tutorial", icon: "fa-graduation-cap", label: $.t('main.bar.tutorials'), body: undefined, onClick: function () {USER_INTERFACE.Tutorials.show();} });
            this.subMenu.addItem({
                                id: 'share',
                                label: $.t('main.bar.share'),
                                icon: 'fa-share-nodes',
                                children: [
                                            {
                                                id: "global-export",
                                                domID: true,
                                                label: $.t("main.bar.exportFile"),
                                                hint: $.t("main.bar.explainExportFile"),
                                                onClick: () => {
                                                    UTILITIES.export();
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
                                                },
                                                icon: "fa-link"
                                            }
                                        ],
                            });
        },
    }

    View = {
        init(subMenu) {
            this.subMenu = subMenu;
            this.rightMenuTabs = {};
            this.otherWindows = {};
            this._visualMenuNeedsRefresh = false;
        },

        _refreshVisualDropdown: function () {
            if (!this._visualMenuNeedsRefresh) return;
            this.subMenu.clear();

            // 1. Global Actions
            this.subMenu.addItem({
                id: 'clone-viewer',
                onClick: () => UTILITIES.clone(),
                icon: "fa-clone",
                label: $.t('main.global.clone'),
            });

            // 2. Custom Windows
            for (let id in this.otherWindows) {
                const item = this.otherWindows[id];
                this.subMenu.addItem({
                    icon: item.icon,
                    label: item.label,
                    selected: item.selected,
                    onClick: () => {
                        item.selected = APPLICATION_CONTEXT.AppCache.get(`${id}-selected`, item.selected);
                        item.onClick?.(item.selected);
                    },
                    section: 'global-windows',
                });
            }

            // 3. Viewer Sidebars (Nested Dropdown)
            // Collect sidebar items into an array
            const sidebarChildren = [];
            for (let id in this.rightMenuTabs) {
                const item = this.rightMenuTabs[id][0];
                if (item) {
                    sidebarChildren.push({
                        id: item.id,
                        icon: item.iconName,
                        label: item.title,
                        selected: APPLICATION_CONTEXT.AppCache.get(`${id}-selected`, false),
                        onClick: () => {
                            for (let child of this.rightMenuTabs[id]) {
                                child.toggleHiden();
                            }
                            item.selected = !APPLICATION_CONTEXT.AppCache.get(`${id}-selected`, item.selected);
                            APPLICATION_CONTEXT.AppCache.set(`${id}-selected`, item.selected);
                            // Important: return true to keep the menu open if you want multi-select behavior
                            return true;
                        }
                    });
                }
            }

            // Add the parent item with children
            if (sidebarChildren.length > 0) {
                this.subMenu.addItem({
                    id: 'viewer-sidebars',
                    label: $.t('main.bar.viewerSidebars'),
                    icon: 'fa-columns', // Example icon for sidebars
                    children: sidebarChildren,
                    section: 'global-windows',
                    childSelectionStyle: "check"
                });
            }
        },

        /**
         * Register a view menu item. Views are displayed inside View dropdown and should
         * show available menus in the viewer with an option to hide them. Right-side menu
         * panels are added automatically by other UI components using registerRightMenuTab.
         * @return {boolean} true if the selection is currently active.
         */
        registerViewItem(ownerPluginId, icon, label, onClick) {
            const selected = APPLICATION_CONTEXT.AppCache.get(`${ownerPluginId}-selected`, false);
            this.otherWindows[ownerPluginId] = {
                ownerPluginId, icon, label, onClick, selected
            };
            this._visualMenuNeedsRefresh = true;
            return selected;
        },

        /**
         * Register menu tab that is driven by the core right menu for each viewer.
         * Not advised to use manually, used in core UI.
         * @param tab
         * @private
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
        },

        setTabSelected: function (id, selected) {
            const item = this.otherWindows[id];
            if (!item) return;
            item.selected = !!selected;
            APPLICATION_CONTEXT.AppCache.set(`${id}-selected`, item.selected);
            this._visualMenuNeedsRefresh = true;
        },
    }


    Plugins = {
        init(subMenu) {
            this.subMenu = subMenu;
            this.subMenu.addItem({
                id: 'plugins',
                icon: "fa-puzzle-piece",
                label: $.t('main.bar.plugins'),
                onClick: function () {USER_INTERFACE.FullscreenMenu.menu.focus("app-plugins")}
            });
            this.subMenu.addSection({
                id: 'plugin-list',
            });
        },

        // should add submenus to plugin menu
        setMenu(ownerPluginId, toolsMenuId, title, html, icon = "fa-fw") {

            if (!this.subMenu.getItem(ownerPluginId)) {
                this.subMenu.addItem({
                    id: ownerPluginId,
                    icon: pluginMeta(ownerPluginId, "icon"),
                    label: pluginMeta(ownerPluginId, "name"),
                    pluginRootClass: `plugin-${ownerPluginId}-root`,
                    onClick: () => this.openSubmenu(`${ownerPluginId}`),
                    section: 'plugin-list'
                });

                const insideMenu = new TabsMenu({
                    id: `${ownerPluginId}-submenu`,
                    orientation: Menu.ORIENTATION.TOP,
                    buttonSide: Menu.BUTTONSIDE.LEFT,
                    rounded: Menu.ROUNDED.ENABLE,
                    extraClasses: {bg: "bg-transparent"}
                },);

                const d = new Div({
                    id: `${ownerPluginId}-menu`,
                    extraClasses: `flex flex-col plugin-${ownerPluginId}-root`
                }, insideMenu);

                USER_INTERFACE.FullscreenMenu.menu.addTab(d);
            }

            const insideMenu = USER_INTERFACE.FullscreenMenu.menu.tabs[`${ownerPluginId}-menu`]._children[0];
            const d = van.tags.div();
            d.innerHTML = html;
            insideMenu.addTab({id: toolsMenuId, icon: icon, title: title, body: [d]});

        },
        openSubmenu(atPluginId, atSubId = undefined, toggle = true) {
            // TODO move to mainPanel class and solve toggle
            USER_INTERFACE.FullscreenMenu.menu.focus(`${atPluginId}-menu`);

            // todo dirty toggling redesign
            if (USER_INTERFACE.FullscreenMenu.menu.tabs[`${atPluginId}-menu`]._children[0].focused === undefined && atSubId === undefined) {
                const stTabId = Object.keys(USER_INTERFACE.FullscreenMenu.menu.tabs[`${atPluginId}-menu`]._children[0].tabs)[0];
                USER_INTERFACE.FullscreenMenu.menu.tabs[`${atPluginId}-menu`]._children[0].focus(stTabId);
            }
        }
    }
    onLayoutChange(details) {
        console.log("Layout change detected in AppBar:", details);
        if (details.width < 600) {
            this.rightMenu.setClass("display", "hidden");
            this.rightMenuCollapsed.setClass("display", "");
        } else {
            this.rightMenu.setClass("display", "");
            this.rightMenuCollapsed.setClass("display", "hidden");
        }
    }
}
