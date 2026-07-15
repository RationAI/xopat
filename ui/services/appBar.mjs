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
        // `disablePluginsUi` is read once here and reused below to gate
        // both the plugins tab construction and the matching Plugins.init.
        // Constructing the tab and then trying to hide it after attach
        // (the previous approach) left a visible empty dropdown in the
        // bar; building the tabs list without the entry is reliable.
        const disablePluginsUi = !!window.APPLICATION_CONTEXT?.getOption?.("disablePluginsUi", false);

        // Left part of the app bar: modifiable and customizable menu
        this.context = $("#top-side-left");
        const leftMenuTabs = [
            {
                id: "view",
                icon: "ph-layout",
                title: $.t('main.bar.view'),
                body: [],
                class: Dropdown,
                // MODIFIED: Use 'min-w-max' for width and 'check' style for selection
                extraClasses: { width: "min-w-max" },
                onClick: e => this.View._refreshVisualDropdown()
            },
            {
                id: "edit",
                icon: "ph-list",
                title: $.t('main.bar.edit'),
                body: [],
                class: Dropdown,
                extraClasses: { width: "min-w-max" },
                onClick: e => this.Edit.refresh(true)
            },
        ];
        if (!disablePluginsUi) {
            leftMenuTabs.push({
                id: "plugins", icon: "ph-puzzle-piece", title: $.t('main.bar.plugins'),
                body: [], class: Dropdown
            });
        }
        this.menu = new MainPanel({
                id: "visual-menu",
                orientation: Menu.ORIENTATION.TOP,
                buttonSide: Menu.BUTTONSIDE.LEFT,
                rounded: Menu.ROUNDED.ENABLE,
                extraClasses: {bg: "bg-transparent"},
            },
            ...leftMenuTabs
        );
        this.menu.attachTo(this.context);
        this.menu.set(Menu.DESIGN.TITLEICON);
        this._renderBrandingLogo();

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
            // Adaptive persistence: writes through to admin-bound sinks
            // (github / dicom / http) when configured, falls back to file-
            // download Export otherwise. See `UTILITIES.save()` in src/loader.ts.
            // Distinct from the per-viewer annotation Save in viewerMenu.mjs.
            { id: "save", icon: "ph-floppy-disk", title: $.t('main.bar.save'), body: undefined, onClick: function () { UTILITIES.save(); } },
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
        // Plugins tab is only constructed when `disablePluginsUi` is unset
        // (see the conditional `leftMenuTabs.push` above). When it is set
        // the tab does not exist in the bar at all — Plugins.setMenu /
        // openSubmenu still short-circuit on the same flag for any
        // external callers that haven't been updated.
        if (!disablePluginsUi) {
            this.Plugins.init(this.menu.getTab("plugins"));
        }
        // Tools is a lazily-created category: it has no tab in the bar until
        // something registers into it (and the tab is removed when emptied).
        this.Tools.init(this);

        // Toolbar embed slot lives in the bar markup (built by MainLayout).
        // Init now that the bar DOM exists, then ask MainLayout to (re)route
        // toolbars so any default-embedded toolbar lands in the slot on boot.
        this.ToolbarSlot.init(this);
        window.LAYOUT?._syncToolbars?.();
    }

    /**
     * Render an operator-configured company logo at the left of the app bar.
     * The source is read from ENV branding (`APPLICATION_CONTEXT.defaultParams`
     * = frozen ENV.setup), NOT from `getOption`/session config, so an imported
     * peer session or URL param cannot swap the deployment's branding
     * (AGENTS.md §7). No-ops when no logo is configured.
     * @private
     */
    _renderBrandingLogo() {
        const branding = APPLICATION_CONTEXT?.defaultParams?.branding;
        const src = branding?.logo;
        if (!src || typeof src !== "string") return;

        const img = document.createElement("img");
        img.className = "app-bar-brand-logo flex-shrink-0 h-6 w-auto mr-2 self-center";
        img.src = src;
        img.alt = branding.title || "";
        img.setAttribute("aria-hidden", branding.title ? "false" : "true");
        this.context.prepend(img);
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
         * @param {VisibilityManager | { is: () => boolean, on?: () => void, off?: () => void, set?: (b: boolean) => void, isPinned?: () => boolean }} vm
         *   A vm exposing `isPinned()` is left visible by `hide()` while it
         *   reports pinned (its snapshot is still taken, so a tab hidden
         *   after un-pinning mid-hide is restored by `show()`).
         */
        register(id, vm) {
            if (!id || !vm) return;
            this._entries.set(id, { vm, snapshot: undefined });
            if (this._hidden) {
                const entry = this._entries.get(id);
                entry.snapshot = !!vm.is?.();
                if (!vm.isPinned?.()) this._off(vm);
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
                if (entry.vm.isPinned?.()) continue;
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

    /**
     * App-bar toolbar slot. Hosts an embedded toolbar host bar (switcher +
     * active toolbar) inside the top bar. MainLayout owns the host bar element
     * and only re-parents it here via `mount` / `unmount`; this object owns the
     * slot DOM, exposes the available width (room heuristic for the embed↔float
     * fallback) and a drag hit-test for drag-to-dock.
     */
    ToolbarSlot = {
        _node: null,
        _ro: null,
        _subs: new Set(),
        _raf: 0,

        init(appBar) {
            this._appBar = appBar;
            this._node = document.getElementById("top-side-toolbar-slot");
            if (!this._node) return;
            if (typeof ResizeObserver !== "undefined") {
                this._ro = new ResizeObserver(() => this._emitRoom());
                this._ro.observe(this._node);
            }
            // Register with the hide-chrome registry so the embedded toolbar
            // hides with the rest of the bar. Uses the node-VM duck pattern.
            USER_INTERFACE?.AppBar?.Chrome?.register?.("appbar-chrome::top-side-toolbar-slot", {
                is:  () => (this._node?.style.display ?? "") !== "none",
                on:  () => { if (this._node) this._node.style.display = ""; },
                off: () => { if (this._node) this._node.style.display = "none"; },
            });
        },

        getNode() { return this._node || (this._node = document.getElementById("top-side-toolbar-slot")); },

        getRect() {
            const n = this.getNode();
            return n ? n.getBoundingClientRect() : null;
        },

        getAvailableWidth() {
            const n = this.getNode();
            return n ? n.clientWidth : 0;
        },

        hitTest(x, y) {
            const r = this.getRect();
            if (!r) return false;
            return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        },

        mount(node) {
            const slot = this.getNode();
            if (!slot || !node) return false;
            if (node.parentNode !== slot) slot.appendChild(node);
            return true;
        },

        unmount(node) {
            if (node && node.parentNode === this._node) node.parentNode.removeChild(node);
        },

        /** Subscribe to slot-width changes (rAF-debounced). Returns an unsubscribe fn. */
        onRoom(cb) {
            if (typeof cb !== "function") return () => {};
            this._subs.add(cb);
            return () => this._subs.delete(cb);
        },

        _emitRoom() {
            if (this._raf) return;
            this._raf = requestAnimationFrame(() => {
                this._raf = 0;
                for (const cb of this._subs) {
                    try { cb(this.getAvailableWidth()); } catch (e) { console.error(e); }
                }
            });
        },
    }

    rightMenuSideCollapsed = {
        init(subMenu) {
            this.subMenu = subMenu;
            this.subMenu.addItem({ id: "settings", icon: "ph-gear", label: $.t('main.bar.settings'), body: undefined, onClick: function () {UI.Services.FullscreenMenus.focus("settings-menu")} })
            this.subMenu.addItem({ id: "tutorial", icon: "ph-graduation-cap", label: $.t('main.bar.tutorials'), body: undefined, onClick: function () {USER_INTERFACE.Tutorials.show();} });
            this.subMenu.addItem({ id: "save", icon: "ph-floppy-disk", label: $.t('main.bar.save'), body: undefined, onClick: function () { UTILITIES.save(); } });
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
            this._appBarKeyCounter = 0;

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

            // TODO: does not work
            // this.subMenu.addItem({
            //     id: 'clone-viewer',
            //     onClick: () => UTILITIES.clone(),
            //     icon: "ph-copy-simple",
            //     label: $.t('main.global.clone'),
            // });

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
                    },
                    section: 'global-windows',
                });
            }

            for (let id in this.structure) {
                const item = this.structure[id];
                const subItemSpecs = this[id];
                if (!subItemSpecs) continue;

                // Group registrants by tab id so multiple viewers' tabs of the
                // same kind (e.g. two viewports each contributing "navigator"
                // and "shaders") render as a single row whose click toggles
                // every registrant's VisibilityManager together.
                const groups = new Map();
                for (const subItem of subItemSpecs) {
                    if (!subItem.visibilityManager) {
                        console.error(`View.registerViewComponent: "${subItem.id}" has no visibilityManager`);
                        continue;
                    }
                    let group = groups.get(subItem.id);
                    if (!group) {
                        group = { spec: subItem, vms: [] };
                        groups.set(subItem.id, group);
                    }
                    group.vms.push(subItem.visibilityManager);
                }

                const subChildren = [];
                for (const { spec, vms } of groups.values()) {
                    const allVisible = () => vms.every(vm => vm.is());
                    const anyVisible = () => vms.some(vm => vm.is());
                    subChildren.push({
                        id: spec.id,
                        icon: spec.iconName || spec.icon,
                        label: spec.title || spec.label || spec.id,
                        selected: allVisible(),
                        onClick: () => {
                            const next = !anyVisible();
                            for (const vm of vms) this._setVisibility(vm, next);
                            this._visualMenuNeedsRefresh = true;
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

            // Dedupe by object identity, not by `tab.id`. Multiple viewers can
            // each contribute a tab under the same id (e.g. "navigator",
            // "shaders") — they must coexist in the list so the dropdown can
            // fan a single click out to every registrant. Render-time grouping
            // by id collapses them into one row.
            if (!childList.includes(tab)) {
                childList.push(tab);
            }

            childList.sort((a, b) => (a.title || a.label || a.id).localeCompare(b.title || b.label || b.id));
            this._visualMenuNeedsRefresh = true;

            // Unique Chrome key per registration — `tab.id` alone collides
            // when two viewers register a tab of the same kind.
            tab.__appBarKey = ++this._appBarKeyCounter;
            USER_INTERFACE?.AppBar?.Chrome?.register?.(`view::${category}::${tab.id}::${tab.__appBarKey}`, tab.visibilityManager);
        },

        unregisterViewComponent(category, tab) {
            const childList = this[category];
            if (!Array.isArray(childList)) return;
            const idx = childList.indexOf(tab);
            if (idx < 0) return;
            childList.splice(idx, 1);
            this._visualMenuNeedsRefresh = true;
            if (tab.__appBarKey != null) {
                USER_INTERFACE?.AppBar?.Chrome?.unregister?.(`view::${category}::${tab.id}::${tab.__appBarKey}`);
            }
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

    /**
     * App-bar "Tools" category — a generic, multi-owner registry for utility
     * actions (profilers, inspectors, dev tools …). Unlike View/Edit/Plugins,
     * the tab is **not** created at boot: it is added on the first
     * `register(...)`. The Dropdown rebuilds its rows from `tab.items` on every
     * open, so entries are added/removed incrementally; the whole tab is hidden
     * (not destroyed — Dropdown tabs have no removeTab) once it is emptied, so
     * the category only appears when something actually lives in it.
     *
     * @example
     * USER_INTERFACE.AppBar.Tools.register('profiler.run', {
     *     section: 'profile', sectionTitle: 'Profile',
     *     label: 'Profile a recording', icon: 'ph-film-strip',
     *     onClick: () => {...}
     * });
     * USER_INTERFACE.AppBar.Tools.setLabel('profiler.run', 'Stop profiling');
     * USER_INTERFACE.AppBar.Tools.unregister('profiler.run');
     */
    Tools = {
        init(appBar) {
            this._appBar = appBar;
            // Insertion order is preserved by Map and drives item/section order.
            this._entries = new Map();
            this._tab = null;
        },

        // Reuse an existing "tools" tab when present (survives plugin hot-reload
        // without an AppBar rebuild); only create it on genuine first use.
        _ensureTab() {
            if (this._tab) return this._tab;
            this._tab = this._appBar.menu.getTab('tools')
                || this._appBar.addTab('tools', $.t('main.bar.tools'), 'ph-wrench');
            return this._tab;
        },

        _ensureSection(tab, e) {
            const section = e.section || 'default';
            if (!tab.sections?.some(s => s.id === section)) {
                tab.addSection({ id: section, title: e.sectionTitle || '', order: e.order ?? 0 });
            }
            return section;
        },

        _removeItem(id) {
            const tab = this._tab;
            const item = tab?.items?.[id];
            if (item) {
                item._node?.remove?.();
                delete tab.items[id];
            }
        },

        // Hide the whole tab (its root div) when empty, without destroying it.
        _updateVisibility() {
            this._tab?.setClass?.('toolsEmpty', this._entries.size ? '' : 'hidden');
        },

        /**
         * Register (or replace) a tool entry. Missing keys on replace are kept.
         * @param {string} id unique entry id (namespace by owner, e.g. "profiler.run")
         * @param {object} opts {section, sectionTitle, label, icon, hint, kbd, disabled, children, onClick, order}
         *   `hint` renders as the row tooltip; `kbd` as the right-aligned
         *   shortcut text (keep it in sync with APPLICATION_CONTEXT.shortcuts
         *   via its `binding-changed` event when the action is also a shortcut).
         * @returns {string} the id
         */
        register(id, opts = {}) {
            if (!id || typeof id !== 'string') throw new Error('AppBar.Tools.register: id required');
            const prev = this._entries.get(id);
            const e = { ...prev, ...opts };
            this._entries.set(id, e);

            const tab = this._ensureTab();
            const section = this._ensureSection(tab, e);
            if (prev) this._removeItem(id); // replace cleanly on re-register
            tab.addItem({
                id, section,
                icon: e.icon || 'ph-wrench',
                label: e.label,
                title: e.hint,
                kbd: e.kbd,
                disabled: e.disabled,
                children: e.children,
                onClick: e.onClick,
            });
            this._updateVisibility();
            return id;
        },

        /** Remove an entry; hides the whole Tools tab when the last one goes. */
        unregister(id) {
            if (!this._entries.delete(id)) return false;
            this._removeItem(id);
            this._updateVisibility();
            return true;
        },

        /** Relabel an entry in place. */
        setLabel(id, label) {
            const e = this._entries.get(id);
            if (!e) return false;
            e.label = label;
            this._tab?.setItemLabel?.(id, label);
            return true;
        },

        /** Enable/disable an entry in place. */
        setDisabled(id, disabled) {
            const e = this._entries.get(id);
            if (!e) return false;
            e.disabled = !!disabled;
            this._tab?.setItemDisabled?.(id, disabled);
            return true;
        },

        has(id) { return this._entries.has(id); },

        /**
         * The underlying Dropdown tab, or null before the first register().
         * Owners that need richer per-item updates than setLabel/setDisabled
         * (nested children, recursive selection) operate on it directly.
         */
        getTab() { return this._tab; },
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
                    if (!history) return;

                    if (this._isBusy(history) || !history.canUndo?.()) {
                        this.refresh();
                        return;
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
                }
            });

            this.subMenu.addItem({
                id: 'history-redo',
                icon: 'ph-arrow-clockwise',
                label: $.t('main.bar.redo', { action: '' }),
                disabled: true,
                onClick: async () => {
                    const history = APPLICATION_CONTEXT.history;
                    if (!history) return;

                    if (this._isBusy(history) || !history.canRedo?.()) {
                        this.refresh();
                        return;
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
                }
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
