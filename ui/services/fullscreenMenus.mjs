import van from "../vanjs.mjs";
import { Checkbox } from "../classes/elements/checkbox.mjs";
import { Select } from "../classes/elements/select.mjs";
import { Menu } from "../classes/components/menu.mjs";
import { MainPanel } from "../classes/components/mainPanel.mjs";
import { FullscreenMenuPanel } from "../classes/components/fullscreenMenuPanel.mjs";
import { FullscreenMenuNavTab } from "../classes/components/fullscreenMenuNavTab.mjs";
import { BaseComponent } from "../classes/baseComponent.mjs";

const { div, span, a, b, button, img, input } = van.tags;

export class FullscreenMenus {
    constructor() {
        this.context = null;
        this.menu = null;
        this._initialized = false;
        this._initializing = false;
        this._pluginMenus = {};
        this._visibilityCacheKey = "v::fullscreen-menu-service";
        this._focusedCacheKey = "fullscreen-menu-service-focused";
    }

    init(context = undefined) {
        if (this._initialized || this._initializing) return this;

        this._initializing = true;
        try {
            const mount = context
                || document.getElementById("fullscreen-menu")
                || document.body;

            this.context = mount;
            this.menu = new FullscreenMenuPanel({
                id: "fullscreen-menu-service",
                orientation: Menu.ORIENTATION.LEFT,
                buttonSide: Menu.BUTTONSIDE.LEFT,
                design: Menu.DESIGN.TITLEICON,
                rounded: Menu.ROUNDED.ENABLE,
            });
            this.menu.attachTo(mount);
            this._bindStatePersistence();
            this._registerDefaults();
            this._restoreState();
            this._initialized = true;
            return this;
        } finally {
            this._initializing = false;
        }
    }

    _ensureInit() {
        if (!this._initialized && !this._initializing) {
            this.init();
        }
    }

    _registerDefaults() {
        this.register({
            id: "settings-menu",
            title: $.t?.("main.bar.settings") || "Settings",
            label: $.t?.("main.bar.settings") || "Settings",
            icon: "fa-gear",
            body: () => this.getSettingsBody
        }, FullscreenMenuPanel.NAMESPACE.SYSTEM);

        this.register({
            id: "app-plugins",
            title: $.t?.("main.bar.plugins") || "Plugins",
            label: $.t?.("main.bar.plugins") || "Plugins",
            icon: "fa-puzzle-piece",
            body: () => this.getPluginsBody
        }, FullscreenMenuPanel.NAMESPACE.SYSTEM);
    }

    _bindStatePersistence() {
        if (!this.menu?.modal || this.menu.modal.__statePersistenceBound) return;

        const modal = this.menu.modal;
        const originalOpen = modal.open.bind(modal);
        const originalClose = modal.close.bind(modal);

        modal.open = () => {
            this._setVisible(true);
            return originalOpen();
        };
        modal.close = () => {
            this._setVisible(false);
            return originalClose();
        };
        modal.__statePersistenceBound = true;
    }

    _normalizeBody(body) {
        if (typeof body === "function") {
            return body();
        }
        return body;
    }

    register(item, ns = FullscreenMenuPanel.NAMESPACE.PLUGINS) {
        this._ensureInit();
        return this.menu.addTab({
            ...item,
            body: this._normalizeBody(item.body)
        });
    }

    addTab(item, ns = FullscreenMenuPanel.NAMESPACE.PLUGINS) {
        const label = item?.title || item?.label || item?.id;
        return this.register({
            id: item.id,
            title: label,
            label,
            icon: item.icon || "fa-circle",
            body: () => item,
            namespace: ns
        });
    }

    has(id) {
        this._ensureInit();
        return this.menu.has(id);
    }

    focus(id) {
        this._ensureInit();
        const focused = this.menu.focus(id);
        if (focused) {
            this._setVisible(true);
            this._storeFocused(id);
        }
        return focused;
    }

    open(id = undefined) {
        this._ensureInit();
        if (id) {
            return this.focus(id);
        }
        this.menu.open();
        this._setVisible(true);
        return true;
    }

    close() {
        this.menu?.close();
        this._setVisible(false);
        return this;
    }

    unfocusAll() {
        this.menu?.menu?.unfocusAll?.();
        return this;
    }

    setOrientation(orientation) {
        this._ensureInit();
        this.menu.setOrientation(orientation);
        return this;
    }

    _setVisible(visible) {
        APPLICATION_CONTEXT?.AppCache?.set?.(this._visibilityCacheKey, !!visible);
    }

    _storeFocused(id) {
        if (!id) return;
        APPLICATION_CONTEXT?.AppCache?.set?.(this._focusedCacheKey, id);
    }

    _restoreState() {
        const cache = APPLICATION_CONTEXT?.AppCache;
        if (!cache || !this.menu) return;

        const wasVisible = cache.get(this._visibilityCacheKey, false);
        if (!wasVisible) {
            this.menu.close();
            return;
        }

        const focusedId = cache.get(this._focusedCacheKey, undefined);
        if (focusedId && this.menu.getTab?.(focusedId)) {
            this.menu.focus(focusedId);
            return;
        }

        this.menu.open();
    }

    _focusSubmenu(menu, id) {
        if (!menu?.tabs?.[id]) return false;
        for (const [tabId, tab] of Object.entries(menu.tabs)) {
            if (tabId === id) continue;
            tab._removeFocus?.();
        }
        menu.tabs[id]._setFocus?.();
        menu._focused = id;
        return true;
    }

    ensurePluginMenu(ownerPluginId) {
        this._ensureInit();
        const key = `${ownerPluginId}-menu`;
        if (this._pluginMenus[key]) {
            return this._pluginMenus[key];
        }

        const mount = document.createElement("div");
        mount.id = key;
        mount.className = `flex h-full min-h-0 flex-col plugin-${ownerPluginId}-root gap-3`;

        const submenu = new MainPanel({
            id: `${ownerPluginId}-submenu`,
            orientation: Menu.ORIENTATION.TOP,
            buttonSide: Menu.BUTTONSIDE.LEFT,
            rounded: Menu.ROUNDED.ENABLE,
            design: Menu.DESIGN.TITLEICON,
            extraClasses: { bg: "bg-transparent", height: "h-full", width: "w-full", gap: "gap-3", overflow: "overflow-hidden" }
        });

        submenu.body.setClass("fullscreenPluginMenuBody", "min-h-0 min-w-0 flex-1 overflow-y-auto rounded-2xl border border-base-300 bg-base-100 p-4");
        submenu.attachTo(mount);

        const label = (typeof pluginMeta === "function" && pluginMeta(ownerPluginId, "name")) || ownerPluginId;
        const icon = (typeof pluginMeta === "function" && pluginMeta(ownerPluginId, "icon")) || "fa-puzzle-piece";

        this.register({
            id: key,
            title: label,
            label,
            icon,
            pluginRootClass: `plugin-${ownerPluginId}-root`,
            body: () => mount
        }, FullscreenMenuPanel.NAMESPACE.PLUGINS);

        const state = { mount, menu: submenu, id: key };
        this._pluginMenus[key] = state;
        return state;
    }

    setMenu(ownerPluginId, toolsMenuId, title, html, icon = "fa-fw") {
        const { menu } = this.ensurePluginMenu(ownerPluginId);
        if (menu.tabs?.[toolsMenuId]) {
            return menu.tabs[toolsMenuId];
        }

        const bodyMount = document.createElement("div");
        bodyMount.className = "min-h-0 w-full";

        for (const node of this._resolveNodes(html)) {
            bodyMount.appendChild(node);
        }

        const tab = menu.addTab({
            id: toolsMenuId,
            icon,
            title,
            class: FullscreenMenuNavTab,
            body: [bodyMount]
        });

        tab.close?.();
        if (!menu._focused) {
            this._focusSubmenu(menu, toolsMenuId);
        }
        return tab;
    }

    openSubmenu(ownerPluginId, atSubId = undefined) {
        const { menu, id } = this.ensurePluginMenu(ownerPluginId);
        this.focus(id);
        this._storeFocused(id);

        if (atSubId && menu.tabs?.[atSubId]) {
            this._focusSubmenu(menu, atSubId);
            return true;
        }

        if (!menu._focused) {
            const firstId = Object.keys(menu.tabs || {})[0];
            if (firstId) {
                this._focusSubmenu(menu, firstId);
            }
        }
        return true;
    }

    _resolveNodes(content) {
        const parsed = BaseComponent.parseDomLikeItem(content);
        return this._flattenNodes(parsed);
    }

    _flattenNodes(value) {
        if (value == null) return [];
        if (Array.isArray(value)) return value.flatMap(item => this._flattenNodes(item));
        if (typeof value === "string") return [BaseComponent.toNode(value, false)];
        return [value];
    }

    createCheckbox(id, text, onchangeFunction, checked) {
        return new Checkbox({
            id,
            label: text,
            checked,
            onchange: onchangeFunction
        }).create();
    }

    getHeaderBrand() {
        const version = APPLICATION_CONTEXT?.env?.version || APPLICATION_CONTEXT?.env?.VERSION || "dev";
        return div({ class: "flex items-center gap-3 self-start rounded-2xl border border-base-300 bg-base-100 px-3 py-2 shadow-sm" },
            img({
                src: `${APPLICATION_CONTEXT.url}src/assets/logos/xopat-logo.png`,
                alt: "xOpat Viewer",
                class: "h-5 w-5 object-contain"
            }),
            div({ class: "flex flex-col leading-tight" },
                span({ class: "text-sm font-semibold" }, "Viewer"),
                span({ class: "text-xs opacity-70" }, `v${version}`)
            )
        );
    }

    get getSettingsBody() {
        const notification = div({ class: "mb-4 hidden", id: "settings-notification-wrap" },
            div({ class: "rounded-2xl border border-warning/20 bg-warning/10 px-4 py-3 text-sm" },
                span({ class: "fa-auto fa-warning mr-2", style: "font-size: initial;" }),
                "To apply changes, please ",
                a({ onclick: () => { UTILITIES.refreshPage(); }, class: "link link-hover cursor-pointer font-semibold" },
                    b("reload the page")
                ),
                "."
            )
        );

        let theme = APPLICATION_CONTEXT.getOption("theme");
        let themePretty = theme === "auto" ? "Automatic" : theme === "light" ? "Light Theme" : "Dark Theme";

        const themeSelect = new Select(
            { id: "theme-select", onchange: function () { USER_INTERFACE.Tools.changeTheme(this.value); }, title: $.t('settings.theme.title') },
            { value: "", selected: "selected", hidden: "hidden", text: themePretty },
            { value: "auto", text: $.t('settings.theme.auto') },
            { value: "light", text: $.t('settings.theme.light') },
            { value: "dark", text: $.t('settings.theme.dark') }
        );

        return div({ class: "relative flex min-h-full flex-col gap-4 pb-24 pt-3" },
            notification,
            div({ class: "flex flex-wrap items-start justify-between gap-3" },
                span({ class: "text-2xl font-semibold" }, $.t?.('main.bar.settings')),
                this.getHeaderBrand()
            ),
            div({ class: "grid gap-4 lg:grid-cols-2" },
                div({ class: "rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm" },
                    span({ class: "mb-3 block text-lg font-semibold" }, "Appearance"),
                    div({ class: "form-control gap-3" },
                        themeSelect.create(),
                        this.createCheckbox(
                            "toolbar-checkbox",
                            $.t('settings.toolBar'),
                            function () {
                                APPLICATION_CONTEXT.setOption('toolBar', this.checked);
                                const toolbarDivs = document.querySelectorAll('div[id^="toolbar-"]');
                                toolbarDivs.forEach(div => div.classList.toggle('hidden'));
                            },
                            APPLICATION_CONTEXT.getOption('toolBar', true)
                        ),
                        this.createCheckbox(
                            "scalebar-checkbox",
                            $.t('settings.scaleBar'),
                            function () {
                                APPLICATION_CONTEXT.setOption('scaleBar', this.checked);
                                for (let viewer of VIEWER_MANAGER.viewers) {
                                    viewer.scalebar.setActive(this.checked);
                                }
                            },
                            APPLICATION_CONTEXT.getOption('scaleBar', true)
                        ),
                        this.createCheckbox(
                            "statusbar-checkbox",
                            $.t('settings.statusBar'),
                            function () {
                                APPLICATION_CONTEXT.setOption('statusBar', this.checked);
                                $('#viewer-status-bar').toggleClass('hidden');
                            },
                            APPLICATION_CONTEXT.getOption('statusBar', true)
                        )
                    )
                ),
                div({ class: "space-y-4" },
                    div({ class: "rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm" },
                        span({ class: "mb-3 block text-lg font-semibold" }, "Behaviour"),
                        div({ class: "form-control gap-3" },
                            this.createCheckbox(
                                "cookies-checkbox",
                                $.t('settings.cookies'),
                                function () {
                                    APPLICATION_CONTEXT.setOption('bypassCookies', this.checked);
                                    $('#settings-notification-wrap').removeClass('hidden');
                                },
                                APPLICATION_CONTEXT.getOption('bypassCookies', false)
                            )
                        )
                    ),
                    div({ class: "rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm" },
                        span({ class: "mb-3 block text-lg font-semibold" }, "Other"),
                        div({ class: "form-control gap-3" },
                            this.createCheckbox(
                                "debug-checkbox",
                                $.t('settings.debugMode'),
                                function () {
                                    APPLICATION_CONTEXT.setOption('debugMode', this.checked);
                                    $('#settings-notification-wrap').removeClass('hidden');
                                },
                                APPLICATION_CONTEXT.getOption('debugMode', false)
                            ),
                            this.createCheckbox(
                                "render-checkbox",
                                $.t('settings.debugRender'),
                                function () {
                                    APPLICATION_CONTEXT.setOption('webglDebugMode', this.checked);
                                    $('#settings-notification-wrap').removeClass('hidden');
                                },
                                APPLICATION_CONTEXT.getOption('webglDebugMode', false)
                            )
                        )
                    )
                )
            ),
            this.getLogo(-80, 10)
        );
    }

    getLogo(positionBottom, positionRight) {
        return div(
            { class: "pointer-events-none absolute bottom-0 right-0 hidden opacity-40 lg:block" },
            div({ class: "relative h-[180px] w-[180px]" },
                img({
                    src: `${APPLICATION_CONTEXT.url}src/assets/logos/xopat-logo.png`,
                    alt: "xOpat Viewer",
                    class: "absolute object-contain",
                    style: `width: 140px; height: 140px; bottom: ${positionBottom + 80}px; right: ${positionRight + 20}px;`
                })
            )
        );
    }

    get getPluginsBody() {
        let pluginCount = 0;
        const pluginDivs = [];
        for (let pid of APPLICATION_CONTEXT.pluginIds()) {
            let plugin = APPLICATION_CONTEXT._dangerouslyAccessPlugin(pid),
                pluginConfig = APPLICATION_CONTEXT.config.plugins[pid];

            if ((plugin.hasOwnProperty("permaLoad") && plugin.permaLoad)
                || (plugin.hasOwnProperty("hidden") && plugin.hidden)
                || (pluginConfig?.hasOwnProperty("permaLoad") && pluginConfig?.permaLoad)) {
                continue;
            }

            pluginDivs.push(this.createPluginDiv(plugin, pluginCount));
            pluginCount++;
        }

        if (pluginCount < 1) {
            pluginDivs.push(this.createPluginDiv({
                id: "_undefined_",
                name: $.t('plugins.noPluginsAvailable'),
                description: $.t('plugins.noPluginsDetails'),
                icon: null,
                error: false,
                loaded: false
            }, 0));
        }

        return div({ class: "relative flex min-h-full flex-col gap-4 pt-3 pb-24" },
            div({ class: "flex items-center justify-between gap-3" },
                span({ class: "text-2xl font-semibold" }, $.t?.('main.bar.plugins')),
                button({
                    onclick: function () { USER_INTERFACE.AppBar.Plugins.refreshPageWithSelectedPlugins?.(); },
                    class: "btn btn-primary btn-sm"
                }, "Load with selected")
            ),
            div({ id: "plug-list-content-inner", class: "rounded-2xl border border-base-300 bg-base-100 p-3 shadow-sm" },
                div({ id: "plug-list-content-inner-content", class: "space-y-3" }, ...pluginDivs)
            ),
            this.getLogo(-80, 10)
        );
    }

    createPluginDiv(plugin, pluginCount) {
        let actionPart;
        if (plugin.loaded) {
            actionPart = div({ id: `load-plugin-${plugin.id}` },
                button({ class: "btn btn-disabled btn-sm" }, $.t('common.Loaded'))
            );
        } else {
            actionPart = div({ id: `load-plugin-${plugin.id}` },
                button({ onclick: function () { UTILITIES.loadPlugin(plugin.id); return false; }, class: "btn btn-sm" }, $.t('common.Load'))
            );
        }

        let icon = plugin.icon || (plugin.icon !== "" ? APPLICATION_CONTEXT.url + "src/assets/image.png" : "");
        if (icon && !icon.includes?.('<')) {
            icon = img({ src: `${icon}`, class: "h-10 w-10 rounded-xl object-cover" });
        }

        let text = div({ class: "min-w-0 flex-1" },
            div({ class: "truncate text-base font-semibold" }, plugin.name || plugin.id),
            div({ class: "text-sm opacity-70" }, plugin.description)
        );

        return div({ id: `plug-list-content-inner-row-${pluginCount}`, class: `plugin-${plugin.id}-root` },
            input({ type: "checkbox", name: "plug-list-content", class: "hidden selectable-image-row-context", value: plugin.id }),
            div({
                    class: "flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-base-300 bg-base-100 p-3 transition-colors hover:bg-base-200/60",
                    onclick: function () { $(this.previousElementSibling).click(); }
                },
                icon,
                text,
                actionPart
            ),
            div({ id: `error-plugin-${plugin.id}`, class: "mx-2 mb-3 text-sm" })
        );
    }
}
