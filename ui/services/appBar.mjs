import { Div } from '../classes/elements/div.mjs';
import { TabsMenu } from '../classes/components/tabsMenu.mjs';
import { MainPanel } from '../classes/components/mainPanel.mjs';
import { Dropdown } from '../classes/elements/dropdown.mjs';
import { Button } from '../classes/elements/buttons.mjs';
import { Menu } from '../classes/components/menu.mjs';
import { PhIcon } from '../classes/elements/ph-icon.mjs';
import { VisibilityManager } from '../classes/mixins/visibilityManager.mjs';

export class AppBar {

    init() {
        window.addEventListener('app:layout-change', (e) => {
            this.onLayoutChange?.(e.detail);
        });
        this.maxMobileWidth = APPLICATION_CONTEXT.getOption("maxMobileWidthPx");

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
                icon: "ph-layout",
                title: $.t('main.bar.view'),
                body: [],
                class: Dropdown,
                // MODIFIED: Use 'min-w-max' for width and 'check' style for selection
                extraClasses: { width: "min-w-max" },
                onClick: e => this.View._refreshVisualDropdown()
            }, {
                id: "edit",
                icon: "ph-list",
                title: $.t('main.bar.edit'),
                body: [],
                class: Dropdown,
                extraClasses: { width: "min-w-max" },
                onClick: e => this.Edit.refresh(true)
            }, {
                id: "plugins", icon: "ph-puzzle-piece", title: $.t('main.bar.plugins'),
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
                id: "Menu", icon: "ph-list",
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
            { id: "settings", icon: "ph-gear", title: $.t('main.bar.settings'), body: undefined, onClick: function () {UI.Services.FullscreenMenus.focus("settings-menu")} },
            { id: "tutorial", icon: "ph-graduation-cap", title: $.t('main.bar.tutorials'), body: undefined, onClick: function () {USER_INTERFACE.Tutorials.show();} },
            { id: "share", icon: "ph-share-network", title: $.t('main.bar.share'), items: [
                    {
                        id: "global-export",
                        domID: true,
                        label: $.t("main.bar.exportFile"),
                        hint: $.t("main.bar.explainExportFile"),
                        onClick: () => {
                            UTILITIES.export();
                            this.rightMenu.closeTab("share");
                        },
                        icon: "ph-download-simple"
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
                        icon: "ph-link"
                    }
                ], class: Dropdown},
            { id: "user", icon: "ph-user-circle", title: XOpatUser.instance().name || $.t('user.anonymous'), body: undefined, styleOverride: true, class: UI.MenuButton}
        );

        this.rightMenu.attachTo($("#top-side-left-user"));
        this.rightMenu.set(Menu.DESIGN.ICONONLY);
        this.rightMenuCollapsed.attachTo($("#top-side-left-user"));
        this.rightMenuCollapsed.set(Menu.DESIGN.ICONONLY);

        if (window.innerWidth < this.maxMobileWidth) {
            this.rightMenu.setClass("display", "hidden");
        } else {
            this.rightMenuCollapsed.setClass("display", "hidden");
        }

        // Keep the user tab title in sync with the user's currently assigned
        // role(s). See src/USER_ROLES.md — this is the v1 surface for the
        // "show user role in the user detail" requirement until the user tab
        // gains a proper popup body.
        const user = window.XOpatUser?.instance?.();
        if (user) {
            const renderTitle = () => {
                const name = user.name || $.t('user.anonymous');
                const roles = user.currentRoles?.() ?? [];
                if (!roles.length) return name;
                const labels = roles.map(id => window.XOpatUser?.describeRole?.(id)?.label ?? id);
                return `${name} · ${labels.join(", ")}`;
            };
            const setTitle = () => {
                try { this.rightMenu.getTab('user')?.setTitle?.(renderTitle()); }
                catch (e) { /* ignore during teardown */ }
            };
            setTitle();
            user.addHandler('roles-changed', setTitle);
            user.addHandler('login', setTitle);
            user.addHandler('logout', setTitle);
        }

        // Hide-chrome button — toggles every component registered with AppBar.Chrome.
        // Components opt in via AppBar.Chrome.register(id, vm) (or get auto-enrolled
        // by AppBar.View.append / View.registerViewComponent). No hardcoded IDs here.
        this.button = new Button({
                id: "fullscreen-button",
                size: Button.SIZE.SMALL,
                onClick: () => {
                    this.Chrome.toggle();
                    this._fullscreen = this.Chrome.isHidden();
                }
            },
            new PhIcon("ph-arrows-out"));
        this._fullscreen = false;
        this.button.attachTo($("#top-side-left-fullscreen"));

        // Register the AppBar's own children as chrome-hideable. The hide button
        // itself lives in #top-side-left-fullscreen and is intentionally excluded.
        const makeNodeVm = (id) => {
            const node = document.getElementById(id);
            if (!node) return null;
            return new VisibilityManager(`appbar-chrome::${id}`).initOnRootNode(node, true);
        };
        for (const id of ["top-side-left", "top-side-left-user", "top-side-badges"]) {
            const vm = makeNodeVm(id);
            if (vm) this.Chrome.register(`appbar-chrome::${id}`, vm);
        }
        // Drop the bar's frosted-glass background while hidden so the viewer is
        // unobstructed; the bar itself stays in the DOM because it hosts the hide button.
        this.Chrome.register("appbar-chrome::top-side-bg", {
            is:  () =>  document.getElementById("top-side")?.classList.contains("glass") ?? false,
            on:  () => document.getElementById("top-side")?.classList.add("glass"),
            off: () => document.getElementById("top-side")?.classList.remove("glass"),
        });

        // init submenus
        this.View.init(this.menu.getTab("view"));
        this.Edit.init(this.menu.getTab("edit"));
        this.Plugins.init(this.menu.getTab("plugins"));

        // `disablePluginsUi` also hides the top-bar plugins tab. Plugins
        // remain loaded; they just have no entry point in the chrome.
        if (window.APPLICATION_CONTEXT?.getOption?.("disablePluginsUi", false)) {
            this.menu.getTab("plugins")?.setClass?.("display", "hidden");
        }
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
     * Show / replace / clear a status pill in the AppBar's badge area.
     * Multiple coexisting pills are supported by passing distinct `id`s.
     *
     * @param {Badge|null} banner Badge component to mount, or null to remove.
     * @param {string} [id="banner"] Pill identifier. Repeat calls with the
     *   same id replace the existing pill; pass null to remove it.
     * @returns {HTMLElement|null} The mounted element (or null on removal).
     */
    setBanner(banner, id = "banner") {
        this._banners = this._banners || new Map();
        const host = document.getElementById("top-side-badges");
        if (!host) {
            console.warn("AppBar.setBanner: host element #top-side-badges missing");
            return null;
        }

        const prev = this._banners.get(id);
        if (prev?.parentNode) prev.parentNode.removeChild(prev);
        this._banners.delete(id);

        if (!banner) return null;

        const el = banner.create();
        el.dataset.bannerId = id;
        host.appendChild(el);
        this._banners.set(id, el);
        return el;
    }

    // ── Badge API ─────────────────────────────────────────────────────────
    // Generic, multi-owner status badges hosted in the AppBar.
    //
    //   USER_INTERFACE.AppBar.addBadge('session', {
    //       label: 'Live',
    //       color: 'success',  // success | warning | error | info | neutral | primary | secondary | accent
    //       dot: true,         // pulsing colored dot before label
    //       icon: 'fa-users',
    //       title: 'Live collaboration session',
    //       onClick: () => { ... }
    //   });
    //   USER_INTERFACE.AppBar.updateBadge('session', { color: 'warning', label: 'Reconnecting…' });
    //   USER_INTERFACE.AppBar.removeBadge('session');
    //
    // Multiple owners coexist by using distinct `id`s.

    /**
     * Add (or replace) a status badge in the AppBar.
     * @param {string} id Unique badge id; subsequent addBadge with the same id replaces it.
     * @param {object} opts
     * @param {string} [opts.label] Visible label text.
     * @param {('success'|'warning'|'error'|'info'|'neutral'|'primary'|'secondary'|'accent')} [opts.color='neutral']
     * @param {('none'|'soft'|'outline'|'ghost')} [opts.style='none']
     * @param {('xs'|'sm'|'md'|'lg')} [opts.size='sm']
     * @param {string} [opts.icon] Icon class — Phosphor (`ph-users`) preferred; legacy `fa-users` also accepted.
     * @param {boolean} [opts.dot=false] Render a colored dot before label.
     * @param {string} [opts.dotColor] Optional explicit dot colour token (defaults to opts.color).
     * @param {boolean} [opts.pulse=false] Animate the dot for "active/connecting" states.
     * @param {string} [opts.title] Tooltip text.
     * @param {Function} [opts.onClick] Click handler; if absent the badge is non-interactive.
     * @returns {HTMLElement} The badge element (for advanced manipulation).
     */
    addBadge(id, opts = {}) {
        if (!id || typeof id !== 'string') throw new Error("AppBar.addBadge: id required");
        this._badges = this._badges || new Map();
        const host = document.getElementById('top-side-badges');
        if (!host) {
            console.warn("AppBar.addBadge: host element #top-side-badges missing");
            return null;
        }

        let entry = this._badges.get(id);
        if (!entry) {
            const el = document.createElement(opts.onClick ? 'button' : 'span');
            el.dataset.badgeId = id;
            host.appendChild(el);
            entry = { el, opts: {} };
            this._badges.set(id, entry);
        }
        entry.opts = { ...entry.opts, ...opts };
        this._renderBadge(entry);
        return entry.el;
    }

    /**
     * Update a previously-added badge. Missing keys are preserved.
     * @param {string} id
     * @param {object} opts
     */
    updateBadge(id, opts = {}) {
        if (!this._badges?.has(id)) return this.addBadge(id, opts);
        const entry = this._badges.get(id);
        entry.opts = { ...entry.opts, ...opts };
        this._renderBadge(entry);
        return entry.el;
    }

    /**
     * Remove a badge.
     * @param {string} id
     */
    removeBadge(id) {
        const entry = this._badges?.get(id);
        if (!entry) return false;
        try { entry.el.remove(); } catch { /* ignore */ }
        this._badges.delete(id);
        return true;
    }

    /**
     * Convenience for status pills: keep label/icon, swap color.
     * @param {string} id
     * @param {string} color daisyUI token (success/warning/error/info/neutral/...)
     */
    setBadgeColor(id, color) { return this.updateBadge(id, { color }); }

    /** @returns {HTMLElement|null} */
    getBadge(id) { return this._badges?.get(id)?.el || null; }

    /** @returns {boolean} */
    hasBadge(id) { return !!this._badges?.has(id); }

    /** @private */
    _renderBadge(entry) {
        const { el, opts } = entry;
        const color = opts.color || 'neutral';
        const style = opts.style || 'none';
        const size = opts.size || 'sm';

        const classes = ['badge', `badge-${size}`, `badge-${color}`];
        if (style && style !== 'none') classes.push(`badge-${style}`);
        if (opts.onClick) classes.push('cursor-pointer', 'hover:opacity-80');
        classes.push('gap-1');
        el.className = classes.join(' ');
        el.style.cssText = 'white-space:nowrap;font-weight:500;';
        if (opts.title) el.title = opts.title; else el.removeAttribute('title');

        // Replace children atomically.
        el.replaceChildren();

        if (opts.dot) {
            const dot = document.createElement('span');
            const dotColor = opts.dotColor || opts.color || 'neutral';
            // Solid 8px dot using a small inline-block; uses theme via badge-* tokens
            // by leveraging text colour inversion of the parent badge — we draw with
            // a span using an explicit currentColor circle.
            dot.style.cssText = [
                'width:8px',
                'height:8px',
                'border-radius:9999px',
                'display:inline-block',
                'background-color:currentColor',
                opts.pulse ? 'animation: appbar-badge-pulse 1.4s ease-in-out infinite' : '',
            ].filter(Boolean).join(';');
            dot.dataset.dotColor = dotColor;
            el.appendChild(dot);
        }

        if (opts.icon) {
            const i = document.createElement('i');
            i.className = `fa ${opts.icon}`;
            el.appendChild(i);
        }

        if (opts.label) {
            const span = document.createElement('span');
            span.textContent = opts.label;
            el.appendChild(span);
        }

        // (Re)bind click handler safely — replace previous via cloneNode? we own
        // the listener through the entry, so manage explicitly.
        if (entry._clickHandler) {
            el.removeEventListener('click', entry._clickHandler);
            entry._clickHandler = null;
        }
        if (typeof opts.onClick === 'function') {
            entry._clickHandler = (e) => { try { opts.onClick(e); } catch (err) { console.error(err); } };
            el.addEventListener('click', entry._clickHandler);
        }

        // Inject the keyframes once per page.
        if (!document.getElementById('appbar-badge-pulse-style')) {
            const css = document.createElement('style');
            css.id = 'appbar-badge-pulse-style';
            css.textContent = '@keyframes appbar-badge-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(1.18)}}';
            document.head.appendChild(css);
        }
    }

    isFullScreen() {
        return this._fullscreen;
    }

    /**
     * Opt-in registry of components that should disappear when the user
     * presses the AppBar "hide chrome" button (the one that looks like a
     * fullscreen expand). It is **not** related to the browser fullscreen
     * API or to `UI.Services.FullscreenMenus`.
     *
     * Reuses the existing {@link VisibilityManager} pattern: components
     * register a manager (or any duck with `is()` + `on()/off()` or
     * `is()/set(bool)`). On hide, the snapshot of each `is()` is captured
     * and `off()` is called directly — `vm.set(false)` is intentionally
     * avoided so that `AppCache` is not polluted with the transient state.
     * On show, only the entries that were visible before are turned back
     * on, preserving any pre-hide user choices.
     *
     * Anything already going through `AppBar.View.append()` or
     * `AppBar.View.registerViewComponent()` is auto-registered.
     *
     * @example
     *   USER_INTERFACE.AppBar.Chrome.register("my-panel", myVm);
     *   USER_INTERFACE.AppBar.Chrome.unregister("my-panel");
     *   USER_INTERFACE.AppBar.Chrome.toggle();
     */
    Chrome = {
        _entries: new Map(),
        _hidden: false,

        /**
         * @param {string} id Unique key; re-registering the same id replaces the entry.
         * @param {VisibilityManager | { is: () => boolean, on?: () => void, off?: () => void, set?: (b: boolean) => void }} vm
         */
        register(id, vm) {
            if (!id || !vm) return;
            this._entries.set(id, { vm, snapshot: undefined });
            if (this._hidden) {
                const entry = this._entries.get(id);
                entry.snapshot = !!vm.is?.();
                this._off(vm);
            }
        },

        unregister(id) {
            this._entries.delete(id);
        },

        isHidden() { return this._hidden; },

        hide() {
            if (this._hidden) return;
            for (const entry of this._entries.values()) {
                entry.snapshot = !!entry.vm.is?.();
                this._off(entry.vm);
            }
            this._hidden = true;
        },

        show() {
            if (!this._hidden) return;
            for (const entry of this._entries.values()) {
                if (entry.snapshot) this._on(entry.vm);
                entry.snapshot = undefined;
            }
            this._hidden = false;
        },

        toggle() { this._hidden ? this.show() : this.hide(); },

        _off(vm) {
            if (typeof vm.off === "function") vm.off();
            else if (typeof vm.set === "function") vm.set(false);
        },
        _on(vm) {
            if (typeof vm.on === "function") vm.on();
            else if (typeof vm.set === "function") vm.set(true);
        },
    }

    rightMenuSideCollapsed = {
        init(subMenu) {
            this.subMenu = subMenu;
            this.subMenu.addItem({ id: "settings", icon: "ph-gear", label: $.t('main.bar.settings'), body: undefined, onClick: function () {UI.Services.FullscreenMenus.focus("settings-menu")} })
            this.subMenu.addItem({ id: "tutorial", icon: "ph-graduation-cap", label: $.t('main.bar.tutorials'), body: undefined, onClick: function () {USER_INTERFACE.Tutorials.show();} });
            this.subMenu.addItem({
                id: 'share',
                label: $.t('main.bar.share'),
                icon: 'ph-share-network',
                children: [
                    {
                        id: "global-export",
                        domID: true,
                        label: $.t("main.bar.exportFile"),
                        hint: $.t("main.bar.explainExportFile"),
                        onClick: () => {
                            UTILITIES.export();
                        },
                        icon: "ph-download-simple"
                    },
                    {
                        id: "copy-url-inner",
                        domID: true,
                        label: $.t("main.bar.exportUrl"),
                        hint: $.t("main.bar.explainExportUrl"),
                        onClick: () => {
                            UTILITIES.copyUrlToClipboard();
                        },
                        icon: "ph-link"
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
                    icon: 'ph-sidebar',
                    section: 'global-windows',
                },
                'toolbarMenu': {
                    id: 'viewer-toolbars',
                    label: $.t('main.bar.viewerToolbars'),
                    icon: 'ph-toolbox',
                    section: 'global-windows',
                },
                'globalMenuTabs': {
                    id: 'global-menu-tabs',
                    label: $.t('main.bar.globalMenus'),
                    icon: 'ph-tabs',
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
                icon: "ph-copy-simple",
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
            // Honor `disablePluginsUi`: skip plugin view panels.
            if (window.APPLICATION_CONTEXT?.getOption?.("disablePluginsUi", false)) {
                return;
            }

            this.otherWindows[ownerPluginId] = {
                id: ownerPluginId,
                icon,
                label,
                visibilityManager
            };
            this._visualMenuNeedsRefresh = true;
            USER_INTERFACE?.AppBar?.Chrome?.register?.(`view::${ownerPluginId}`, visibilityManager);
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
            USER_INTERFACE?.AppBar?.Chrome?.register?.(`view::${category}::${tab.id}`, tab.visibilityManager);
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
                icon: 'ph-arrow-counter-clockwise',
                label: $.t('main.bar.undo', { action: '' }),
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
                icon: 'ph-arrow-clockwise',
                label: $.t('main.bar.redo', { action: '' }),
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
                icon: 'ph-crosshair',
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
                icon: 'ph-eye',
                label: 'Visualization inspector',
                section: 'visualization-inspector',
                children: [
                    {
                        id: 'visualization-inspector-toggle',
                        icon: 'ph-power',
                        label: 'Toggle inspector',
                        onClick: () => {
                            UTILITIES.toggleVisualizationInspector();
                            this.refresh();
                            return true;
                        }
                    },
                    {
                        id: 'visualization-inspector-mode',
                        icon: 'ph-circle-half',
                        label: 'Reveal mode',
                        childSelectionStyle: 'check',
                        children: [
                            {
                                id: 'visualization-inspector-mode-inclusive',
                                icon: 'ph-circle',
                                label: 'Inclusive reveal',
                                onClick: () => {
                                    UTILITIES.setVisualizationInspectorMode('reveal-inside');
                                    this.refresh();
                                    return true;
                                }
                            },
                            {
                                id: 'visualization-inspector-mode-exclusive',
                                icon: 'ph-circle-notch',
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
                        icon: 'ph-minus',
                        label: 'Smaller radius',
                        onClick: () => {
                            UTILITIES.adjustVisualizationInspectorRadius(-24);
                            this.refresh();
                            return true;
                        }
                    },
                    {
                        id: 'visualization-inspector-radius-up',
                        icon: 'ph-plus',
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
            // `disablePluginsUi` hides every plugin-driven entry: skip seeding
            // the plugin-manager link and the per-plugin section. setMenu()
            // below also short-circuits, so individual plugins can't add items
            // either.
            if (window.APPLICATION_CONTEXT?.getOption?.("disablePluginsUi", false)) {
                return;
            }
            this.subMenu.addItem({
                id: 'plugins',
                icon: "ph-puzzle-piece",
                label: $.t('main.bar.plugins'),
                onClick: function () {UI.Services.FullscreenMenus.focus("app-plugins")}
            });
            this.subMenu.addSection({
                id: 'plugin-list',
            });
        },

        // should add submenus to plugin menu
        setMenu(ownerPluginId, toolsMenuId, title, html, icon = "fa-fw", opts = {}) {
            if (window.APPLICATION_CONTEXT?.getOption?.("disablePluginsUi", false)) {
                return;
            }

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

            UI.Services.FullscreenMenus.setMenu(ownerPluginId, toolsMenuId, title, html, icon, opts);
        },
        openSubmenu(atPluginId, atSubId = undefined, toggle = true) {
            return UI.Services.FullscreenMenus.openSubmenu(atPluginId, atSubId);
        }
    }
    onLayoutChange(details) {
        if (details.width < this.maxMobileWidth) {
            this.rightMenu.setClass("display", "hidden");
            this.rightMenuCollapsed.setClass("display", "");
        } else {
            this.rightMenu.setClass("display", "");
            this.rightMenuCollapsed.setClass("display", "hidden");
        }
    }
}
