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
                id: "edit",
                icon: "fa-bars",
                title: $.t('main.bar.edit'),
                body: [],
                class: Dropdown,
                extraClasses: { width: "min-w-max" },
                onClick: e => this.Edit.refresh(true)
            }, {
                id: "plugins", icon: "fa-puzzle-piece", title: $.t('main.bar.plugins'),
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
            { id: "settings", icon: "fa-gear", title: $.t('main.bar.settings'), body: undefined, onClick: function () {UI.Services.FullscreenMenus.focus("settings-menu")} },
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
        this.Edit.init(this.menu.getTab("edit"));
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
            this.subMenu.addItem({ id: "settings", icon: "fa-gear", label: $.t('main.bar.settings'), body: undefined, onClick: function () {UI.Services.FullscreenMenus.focus("settings-menu")} })
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
                },
                'globalMenuTabs': {
                    id: 'global-menu-tabs',
                    label: $.t('main.bar.globalMenus'),
                    icon: 'fa-table-columns',
                    section: 'global-windows',
                }
            };
        },

        _refreshVisualDropdown: function () {
            if (!this._visualMenuNeedsRefresh) return;
            this.subMenu.clear();

            this.subMenu.addItem({
                id: 'clone-viewer',
                onClick: () => UTILITIES.clone(),
                icon: "fa-clone",
                label: $.t('main.global.clone'),
            });

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
                    selected: vm.is(),
                    onClick: () => {
                        const next = !vm.is();
                        this._setVisibility(vm, next);
                        this._visualMenuNeedsRefresh = true;
                        return true;
                    },
                    section: 'global-windows',
                });
            }

            for (let id in this.structure) {
                const item = this.structure[id];
                const subItemSpecs = this[id];
                if (!subItemSpecs) continue;

                if (id === 'globalMenuTabs') {
                    for (let subItem of subItemSpecs) {
                        const vm = subItem.visibilityManager;
                        if (!vm) {
                            console.error(`View.registerViewComponent: "${subItem.id}" has no visibilityManager`);
                            continue;
                        }

                        this.subMenu.addItem({
                            id: subItem.id,
                            icon: subItem.iconName || subItem.icon,
                            label: subItem.title || subItem.label || subItem.id,
                            selected: vm.is(),
                            onClick: () => {
                                const next = !vm.is();
                                this._setVisibility(vm, next);
                                this._visualMenuNeedsRefresh = true;
                                return true;
                            },
                            section: item.section || 'global-windows',
                        });
                    }
                    continue;
                }

                const subChildren = [];
                for (let subItem of subItemSpecs) {
                    const vm = subItem.visibilityManager;
                    if (!vm) {
                        console.error(`View.registerViewComponent: "${subItem.id}" has no visibilityManager`);
                        continue;
                    }

                    subChildren.push({
                        id: subItem.id,
                        icon: subItem.iconName || subItem.icon,
                        label: subItem.title || subItem.label || subItem.id,
                        selected: vm.is(),
                        onClick: () => {
                            const next = !vm.is();
                            this._setVisibility(vm, next);
                            this._visualMenuNeedsRefresh = true;
                            return true;
                        },
                    });
                }

                if (subChildren.length > 0) {
                    this.subMenu.addItem({
                        ...item,
                        children: subChildren,
                        childSelectionStyle: "check"
                    });
                }
            }
        },

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

        setSelected: function (ownerPluginId, selected) {
            const item = this._findEntry(ownerPluginId);
            if (!item || !item.visibilityManager) {
                console.warn(`View.setSelected: unknown or unmanaged view "${ownerPluginId}"`);
                return;
            }

            this._setVisibility(item.visibilityManager, Boolean(selected));
            this._visualMenuNeedsRefresh = true;
        },

        isSelected: function (ownerPluginId, defaultValue = false) {
            const item = this._findEntry(ownerPluginId);
            if (!item || !item.visibilityManager) {
                return defaultValue;
            }
            return item.visibilityManager.is();
        },

        /**
         * @param {'sideViewerMenu'|'toolbarMenu'|'globalMenuTabs'|string} category
         * @param {UINamedItem & { visibilityManager: VisibilityManager }} tab
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

            const index = childList.findIndex(item => item.id === tab.id);
            if (index < 0) {
                childList.push(tab);
            } else {
                childList.splice(index, 1, tab);
            }

            childList.sort((a, b) => (a.title || a.label || a.id).localeCompare(b.title || b.label || b.id));
            this._visualMenuNeedsRefresh = true;
        },

        _findEntry(ownerPluginId) {
            if (this.otherWindows?.[ownerPluginId]) {
                return this.otherWindows[ownerPluginId];
            }

            for (const categoryId in this.structure) {
                const list = this[categoryId];
                if (!Array.isArray(list)) continue;

                const found = list.find(item => item.id === ownerPluginId);
                if (found) return found;
            }

            return null;
        },

        _setVisibility(visibilityManager, selected) {
            if (!visibilityManager) return false;

            if (typeof visibilityManager.set === "function") {
                visibilityManager.set(Boolean(selected));
                return true;
            }

            if (selected) {
                visibilityManager.on?.();
            } else {
                visibilityManager.off?.();
            }
            return true;
        },
    }

    Edit = {
        init(subMenu) {
            this.subMenu = subMenu;
            this._localBusy = false;

            this.subMenu.addItem({
                id: 'history-undo',
                icon: 'fa-rotate-left',
                label: $.t('main.bar.undo'),
                disabled: true,
                onClick: async () => {
                    const history = APPLICATION_CONTEXT.history;
                    if (!history) return true;

                    if (this._isBusy(history) || !history.canUndo?.()) {
                        this.refresh();
                        return true;
                    }

                    this._localBusy = true;
                    this.refresh();

                    try {
                        await history.undo();
                    } catch (e) {
                        console.error("History undo failed.", e);
                    } finally {
                        this._localBusy = false;
                        this.refresh();
                    }
                    return true;
                }
            });

            this.subMenu.addItem({
                id: 'history-redo',
                icon: 'fa-rotate-right',
                label: $.t('main.bar.redo'),
                disabled: true,
                onClick: async () => {
                    const history = APPLICATION_CONTEXT.history;
                    if (!history) return true;

                    if (this._isBusy(history) || !history.canRedo?.()) {
                        this.refresh();
                        return true;
                    }

                    this._localBusy = true;
                    this.refresh();

                    try {
                        await history.redo();
                    } catch (e) {
                        console.error("History redo failed.", e);
                    } finally {
                        this._localBusy = false;
                        this.refresh();
                    }
                    return true;
                }
            });

            this.subMenu.addSection({
                id: 'visualization-inspector',
            });

            this.subMenu.addItem({
                id: 'value-inspector',
                icon: 'fa-crosshairs',
                label: 'Value inspector',
                section: 'visualization-inspector',
                onClick: () => {
                    UTILITIES.toggleValueInspector();
                    this.refresh();
                    return true;
                },
            });

            this.subMenu.addItem({
                id: 'visualization-inspector',
                icon: 'fa-eye',
                label: 'Visualization inspector',
                section: 'visualization-inspector',
                children: [
                    {
                        id: 'visualization-inspector-toggle',
                        icon: 'fa-power-off',
                        label: 'Toggle inspector',
                        onClick: () => {
                            UTILITIES.toggleVisualizationInspector();
                            this.refresh();
                            return true;
                        }
                    },
                    {
                        id: 'visualization-inspector-mode',
                        icon: 'fa-circle-half-stroke',
                        label: 'Reveal mode',
                        childSelectionStyle: 'check',
                        children: [
                            {
                                id: 'visualization-inspector-mode-inclusive',
                                icon: 'fa-circle',
                                label: 'Inclusive reveal',
                                onClick: () => {
                                    UTILITIES.setVisualizationInspectorMode('reveal-inside');
                                    this.refresh();
                                    return true;
                                }
                            },
                            {
                                id: 'visualization-inspector-mode-exclusive',
                                icon: 'fa-circle-notch',
                                label: 'Exclusive reveal',
                                onClick: () => {
                                    UTILITIES.setVisualizationInspectorMode('reveal-outside');
                                    this.refresh();
                                    return true;
                                }
                            }
                        ]
                    },
                    {
                        id: 'visualization-inspector-radius-down',
                        icon: 'fa-minus',
                        label: 'Smaller radius',
                        onClick: () => {
                            UTILITIES.adjustVisualizationInspectorRadius(-24);
                            this.refresh();
                            return true;
                        }
                    },
                    {
                        id: 'visualization-inspector-radius-up',
                        icon: 'fa-plus',
                        label: 'Larger radius',
                        onClick: () => {
                            UTILITIES.adjustVisualizationInspectorRadius(24);
                            this.refresh();
                            return true;
                        }
                    }
                ],
            });

            const history = APPLICATION_CONTEXT.history;
            if (history) {
                const deferredRefresh = () => queueMicrotask(() => this.refresh());

                history.addHandler('push', deferredRefresh);
                history.addHandler('undo', deferredRefresh);
                history.addHandler('redo', deferredRefresh);
                history.addHandler('clear', deferredRefresh);
                history.addHandler('error', deferredRefresh);
                history.addHandler('register-provider', deferredRefresh);
                history.addHandler('unregister-provider', deferredRefresh);
                history.addHandler('change-size', deferredRefresh);
                history.addHandler('history-busy-change', deferredRefresh);
            }

            this.refresh();
        },

        _isBusy(history = APPLICATION_CONTEXT.history) {
            return !!(this._localBusy || history?.isBusy?.());
        },

        refresh() {
            const history = APPLICATION_CONTEXT.history;
            if (history) {
                const busy = this._isBusy(history);
                const canUndo = !busy && !!history.canUndo?.();
                const canRedo = !busy && !!history.canRedo?.();

                this.subMenu.setItemDisabled('history-undo', !canUndo);
                this.subMenu.setItemDisabled('history-redo', !canRedo);

                const undoName = canUndo ? (history.currentUndoMeta()?.name ?? '') : '';
                const redoName = canRedo ? (history.currentRedoMeta()?.name ?? '') : '';
                console.log("History refresh:", { canUndo, canRedo, undoName, redoName, undo: history.currentUndoMeta(), redo: history.currentRedoMeta() });
                this.subMenu.setItemLabel('history-undo', $.t('main.bar.undo', { action: undoName || "" }));
                this.subMenu.setItemLabel('history-redo', $.t('main.bar.redo', { action: redoName || "" }));
            }

            const inspectorEnabled = !!APPLICATION_CONTEXT.getOption('visualizationInspectorEnabled', false, true);
            const inspectorMode = APPLICATION_CONTEXT.getOption('visualizationInspectorMode', 'reveal-inside', true);
            const inspectorRadius = Number(APPLICATION_CONTEXT.getOption('visualizationInspectorRadiusPx', 96, true)) || 96;
            const valueInspectorEnabled = !!APPLICATION_CONTEXT.getOption('valueInspectorEnabled', false, true);
            const inspectorItem = this.subMenu.getItem('visualization-inspector');

            this.subMenu.setItemLabel(
                'value-inspector',
                valueInspectorEnabled ? 'Value inspector: on' : 'Value inspector: off'
            );

            if (inspectorItem && Array.isArray(inspectorItem.children)) {
                for (const child of inspectorItem.children) {
                    child.selected = false;
                }

                const modeParent = inspectorItem.children.find(child => child.id === 'visualization-inspector-mode');
                if (modeParent && Array.isArray(modeParent.children)) {
                    for (const child of modeParent.children) {
                        child.selected = false;
                    }

                    this.subMenu.setItemSelected('visualization-inspector-mode-inclusive', false);
                    this.subMenu.setItemSelected('visualization-inspector-mode-exclusive', false);

                    const inclusiveChild = modeParent.children.find(child => child.id === 'visualization-inspector-mode-inclusive');
                    const exclusiveChild = modeParent.children.find(child => child.id === 'visualization-inspector-mode-exclusive');
                    if (inspectorMode === 'reveal-outside') {
                        if (exclusiveChild) exclusiveChild.selected = true;
                        this.subMenu.setItemSelected('visualization-inspector-mode-exclusive', true);
                    } else {
                        if (inclusiveChild) inclusiveChild.selected = true;
                        this.subMenu.setItemSelected('visualization-inspector-mode-inclusive', true);
                    }

                    modeParent.label = inspectorMode === 'reveal-outside'
                        ? 'Reveal mode: exclusive'
                        : 'Reveal mode: inclusive';
                }

                const toggleChild = inspectorItem.children.find(child => child.id === 'visualization-inspector-toggle');
                if (toggleChild) {
                    toggleChild.label = inspectorEnabled ? 'Turn inspector off' : 'Turn inspector on';
                }

                const radiusDownChild = inspectorItem.children.find(child => child.id === 'visualization-inspector-radius-down');
                if (radiusDownChild) {
                    radiusDownChild.label = `Smaller radius (${inspectorRadius}px)`;
                    radiusDownChild.disabled = inspectorRadius <= 24;
                }

                const radiusUpChild = inspectorItem.children.find(child => child.id === 'visualization-inspector-radius-up');
                if (radiusUpChild) {
                    radiusUpChild.label = `Larger radius (${inspectorRadius}px)`;
                    radiusUpChild.disabled = inspectorRadius >= 320;
                }
            }

            this.subMenu.setItemLabel(
                'visualization-inspector',
                inspectorEnabled
                    ? `Visualization inspector: ${inspectorMode === 'reveal-outside' ? 'exclusive' : 'inclusive'}`
                    : 'Visualization inspector: off'
            );
        }
    }

    Plugins = {
        init(subMenu) {
            this.subMenu = subMenu;
            this.subMenu.addItem({
                id: 'plugins',
                icon: "fa-puzzle-piece",
                label: $.t('main.bar.plugins'),
                onClick: function () {UI.Services.FullscreenMenus.focus("app-plugins")}
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
            }

            UI.Services.FullscreenMenus.setMenu(ownerPluginId, toolsMenuId, title, html, icon);
        },
        openSubmenu(atPluginId, atSubId = undefined, toggle = true) {
            return UI.Services.FullscreenMenus.openSubmenu(atPluginId, atSubId);
        }
    }
    onLayoutChange(details) {
        if (details.width < 600) {
            this.rightMenu.setClass("display", "hidden");
            this.rightMenuCollapsed.setClass("display", "");
        } else {
            this.rightMenu.setClass("display", "");
            this.rightMenuCollapsed.setClass("display", "hidden");
        }
    }
}
