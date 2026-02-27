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
        } else {
            this.rightMenuCollapsed.setClass("display", "hidden");
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
            bItem.visibilityManager.on();
            bItem.setVisuals(banner);
        } else {
            bItem.visibilityManager.off();
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
            this.otherWindows = {};
            this._visualMenuNeedsRefresh = false;

            // Allowed Groups supported by this view
            this.structure = {
                'sideViewerMenu': {
                    id: 'viewer-sidebars',
                    label: $.t('main.bar.viewerSidebars'),
                    icon: 'fa-columns',
                    section: 'global-windows',
                },
                'toolbarMenu': {
                    id: 'viewer-toolbars',
                    label: $.t('main.bar.viewerToolbars'),
                    icon: 'fa-columns',
                    section: 'global-windows',
                }
            };
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

            // 2. Custom Windows (from View.append)
            for (let id in this.otherWindows) {
                const item = this.otherWindows[id];
                const vm = item.visibilityManager;

                if (!vm) {
                    console.error(`View.append: missing visibilityManager for "${id}"`);
                    continue;
                }

                this.subMenu.addItem({
                    id,
                    icon: item.icon,
                    label: item.label,
                    // selected state comes from VisibilityManager
                    selected: vm.is(),
                    onClick: () => {
                        const next = !vm.is();
                        vm.set(next);
                        // keep menu open for multi-select behavior
                        return true;
                    },
                    section: 'global-windows',
                });
            }

            // 3. Structured groups (sidebars, toolbars, etc.)
            for (let id in this.structure) {
                const item = this.structure[id];
                const subItemSpecs = this[id];
                if (!subItemSpecs) return;

                const subChildren = [];
                for (let subItem of subItemSpecs) {
                    const vm = subItem.visibilityManager;
                    if (!vm) {
                        console.error(`View.registerViewComponent: "${subItem.id}" has no visibilityManager`);
                        continue;
                    }

                    subChildren.push({
                        id: subItem.id,
                        icon: subItem.iconName || subItem.icon, // iconName old, backward compatibility
                        label: subItem.title,
                        selected: vm.is(),
                        onClick: () => {
                            const next = !vm.is();
                            vm.set(next);
                            // Important: return true to keep the menu open for multi-select
                            return true;
                        }
                    });
                }

                // Add the parent item with children
                if (subChildren.length > 0) {
                    this.subMenu.addItem({
                        ...item,
                        children: subChildren,
                        childSelectionStyle: "check"
                    });
                }
            }
        },

        /**
         * Register a view menu item. Views are displayed inside View dropdown and should
         * show available menus in the viewer with an option to hide them. Right-side menu
         * panels are added automatically by other UI components using registerViewComponent.
         *
         * @param {string} ownerPluginId
         * @param {string} icon
         * @param {string} label
         * @param {VisibilityManager} visibilityManager required visibility manager
         */
        append(ownerPluginId, icon, label, visibilityManager) {
            if (!visibilityManager) {
                throw new Error(`View.append requires a visibilityManager for "${ownerPluginId}"`);
            }

            this.otherWindows[ownerPluginId] = {
                id: ownerPluginId,
                icon,
                label,
                visibilityManager
            };
            this._visualMenuNeedsRefresh = true;
        },

        /**
         * Set custom item programmatically selected, useful when you need to change the UI state.
         * @param {string} ownerPluginId
         * @param {boolean} selected
         */
        setSelected: function (ownerPluginId, selected) {
            const item = this.otherWindows[ownerPluginId];
            if (!item || !item.visibilityManager) {
                console.warn(`View.setSelected: unknown or unmanaged view "${ownerPluginId}"`);
                return;
            }

            item.visibilityManager.set(Boolean(selected));
            this._visualMenuNeedsRefresh = true;
        },

        /**
         * Programmatically query the selection/visibility of a custom window.
         * Delegates to the attached VisibilityManager.
         * @param {string} ownerPluginId
         * @param {boolean} [defaultValue=false] used when no manager exists
         * @returns {boolean}
         */
        isSelected: function (ownerPluginId, defaultValue = false) {
            const item = this.otherWindows[ownerPluginId];
            if (!item || !item.visibilityManager) {
                return defaultValue;
            }
            return item.visibilityManager.is();
        },

        /**
         * Register a sub-item of a View menu category - toolbars, sidebars, etc.
         * They represent a grouped core view category where users can toggle particular item.
         * This is then used internally and does not allow customizing the behavior.
         * For custom view menus, see append().
         *
         * TODO try forcing plugin ID passing
         * @param {'sideViewerMenu'|'toolbarMenu'} category
         * @param {UINamedItem & { visibilityManager: VisibilityManager }} tab
         * @param {undefined} tab.body unused value
         * @private
         */
        registerViewComponent(category, tab) {
            if (!this.structure[category]) {
                console.error(`Invalid category: ${category}`);
                return;
            }

            if (!tab.visibilityManager) {
                console.error(`View.registerViewComponent: "${tab.id}" requires tab.visibilityManager`);
                return;
            }

            let childList = this[category];
            if (!childList) {
                this[category] = childList = [];
            }

            // Prevent duplicates
            const index = childList.findIndex(item => item.id === tab.id);
            if (index < 0) {
                childList.push(tab);
            } else {
                childList.splice(index, 1, tab);
            }

            // todo support removal
            // todo support order priority
            childList.sort((a, b) => a.title.localeCompare(b.title));
            this._visualMenuNeedsRefresh = true;
        }
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
