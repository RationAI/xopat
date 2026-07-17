import van from "../vanjs.mjs";
import { Checkbox } from "../classes/elements/checkbox.mjs";
import { Select } from "../classes/elements/select.mjs";
import { Menu } from "../classes/components/menu.mjs";
import { MainPanel } from "../classes/components/mainPanel.mjs";
import { FullscreenMenuPanel } from "../classes/components/fullscreenMenuPanel.mjs";
import { FullscreenMenuNavTab } from "../classes/components/fullscreenMenuNavTab.mjs";
import { BaseComponent } from "../classes/baseComponent.mjs";
import { KeymapPanel } from "../classes/components/keymapPanel.mjs";
import { PhIcon, componentIconNode } from "../classes/elements/ph-icon.mjs";
import { ImageIcon } from "../classes/elements/image-icon.mjs";

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
            this._registerChrome();
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
            icon: "ph-gear",
            body: () => this.getSettingsBody
        }, FullscreenMenuPanel.NAMESPACE.SYSTEM);

        // Keymap editor over the central shortcut registry
        // (APPLICATION_CONTEXT.shortcuts, see src/SHORTCUTS.md).
        this.register({
            id: "keymap-menu",
            title: $.t?.("keymap.title"),
            label: $.t?.("keymap.title"),
            icon: "ph-keyboard",
            body: () => new KeymapPanel({ id: "keymap-panel" }).create()
        }, FullscreenMenuPanel.NAMESPACE.SYSTEM);

        // Skip the plugin-management tab when the deployment hides plugin UI.
        if (!this._isPluginUiDisabled()) {
            this.register({
                id: "app-plugins",
                title: $.t?.("main.bar.plugins") || "Plugins",
                label: $.t?.("main.bar.plugins") || "Plugins",
                icon: "ph-puzzle-piece",
                body: () => this.getPluginsBody
            }, FullscreenMenuPanel.NAMESPACE.SYSTEM);
        }
    }

    _isPluginUiDisabled() {
        return !!window.APPLICATION_CONTEXT?.getOption?.("disablePluginsUi", false);
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
        // Honor `disablePluginsUi`: drop plugin-namespaced tabs (and the
        // plugin manager itself). Plugins stay loaded; only UI is hidden.
        if (this._isPluginUiDisabled() && ns === FullscreenMenuPanel.NAMESPACE.PLUGINS) {
            return null;
        }
        return this.menu.addTab({
            namespace: ns,           // item.namespace below still wins if set
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
            icon: item.icon || "ph-circle",
            body: () => item,
            namespace: ns
        });
    }

    /**
     * Outer shell for a tab body shown in the FullscreenMenu. Children render
     * in a responsive 1/2-column card grid that matches the core Settings tab.
     * Return this (or a single `card()`) from a tab `body` for visual parity.
     *
     * Overloads:
     *   - `layout(...sections)` — no title header.
     *   - `layout(title, ...sections)` — `title` (string) renders as a 2xl
     *     in-body header above the grid; pass `null`/`""` for the same as
     *     omitting the parameter. Detected by typeof first arg.
     */
    layout(...args) {
        let title = null;
        if (args.length && (typeof args[0] === "string" || args[0] == null)) {
            title = args.shift();
        }
        return div({ class: "relative flex min-h-full flex-col gap-4 pb-24 pt-3" },
            title ? div({ class: "flex flex-wrap items-start justify-between gap-3" },
                span({ class: "text-2xl font-semibold" }, title)
            ) : null,
            div({ class: "grid gap-4 lg:grid-cols-2" }, ...args)
        );
    }

    /**
     * One titled card within a `layout()`. Title row + body content. Pass an
     * empty/null title for an untitled card.
     */
    card(title, ...children) {
        return div({ class: "rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm" },
            title ? span({ class: "mb-3 block text-lg font-semibold" }, title) : null,
            div({ class: "form-control gap-3" }, ...children)
        );
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

    isVisible() {
        return !!APPLICATION_CONTEXT?.AppCache?.get?.(this._visibilityCacheKey, false);
    }

    _registerChrome() {
        const chrome = window.USER_INTERFACE?.AppBar?.Chrome;
        if (!chrome?.register) return;
        chrome.register("fullscreen-menu", {
            is:  () => this.isVisible(),
            on:  () => this.open(),
            off: () => this.close(),
        });
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

    ensurePluginMenu(ownerPluginId, opts = {}) {
        this._ensureInit();
        const key = `${ownerPluginId}-menu`;
        if (this._pluginMenus[key]) {
            // Chrome is cached on first ensure call; subsequent setMenu calls
            // for the same plugin can't flip it mid-life.
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

        // `chrome: "plain"` strips the outer rounded card; intended for plugin
        // tabs that render their own cards via `this.card(...)` and would
        // otherwise nest borders.
        const chrome = opts.chrome === "plain" ? "plain" : "card";
        const bodyClass = chrome === "plain"
            ? "min-h-0 min-w-0 flex-1 overflow-y-auto"
            : "min-h-0 min-w-0 flex-1 overflow-y-auto rounded-2xl border border-base-300 bg-base-100 p-4";
        submenu.body.setClass("fullscreenPluginMenuBody", bodyClass);
        submenu.attachTo(mount);

        // Menus may be owned by a plugin or a module (e.g. vercel-ai-chat-sdk)
        // — resolve the display name/icon from whichever registry knows the id.
        const label = (typeof pluginMeta === "function" && pluginMeta(ownerPluginId, "name"))
            || (typeof moduleMeta === "function" && moduleMeta(ownerPluginId, "name"))
            || ownerPluginId;
        const icon = componentIconNode((typeof pluginMeta === "function" && pluginMeta(ownerPluginId, "icon"))
            || (typeof moduleMeta === "function" && moduleMeta(ownerPluginId, "icon")))
            || "ph-puzzle-piece";

        this.register({
            id: key,
            title: label,
            label,
            icon,
            pluginRootClass: `plugin-${ownerPluginId}-root`,
            body: () => mount
        }, FullscreenMenuPanel.NAMESPACE.PLUGINS);

        const state = { mount, menu: submenu, id: key, chrome };
        this._pluginMenus[key] = state;
        return state;
    }

    setMenu(ownerPluginId, toolsMenuId, title, html, icon = "fa-fw", opts = {}) {
        const { menu } = this.ensurePluginMenu(ownerPluginId, opts);
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

        // Hide the sub-tab switcher when there's only one tab — a single
        // button next to nothing is just noise. Show it as soon as a second
        // tab is added.
        const tabCount = Object.keys(menu.tabs || {}).length;
        menu.header?.setClass?.("hidden", tabCount > 1 ? "" : "hidden");

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
                class: "object-contain",
                style: "height: 32px"
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
                span({ class: "ph-light ph-warning mr-2", style: "font-size: initial;" }),
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

        // Options consumed once at boot / viewer-open (scroll policy, locale,
        // render flags): flip the value and surface the "reload to apply" banner.
        const reloadOnCheck = (key, ui = false) => function () {
            if (ui) APPLICATION_CONTEXT.setUiOption(key, this.checked);
            else APPLICATION_CONTEXT.setOption(key, this.checked);
            $('#settings-notification-wrap').removeClass('hidden');
        };

        // Language: the two locale files shipped under src/locales/. Endonyms are
        // proper nouns and stay untranslated. Applied on reload.
        const languageSelect = new Select(
            {
                id: "language-select",
                title: $.t('settings.language.title'),
                selected: APPLICATION_CONTEXT.getOption("locale"),
                onchange: function () {
                    APPLICATION_CONTEXT.setOption('locale', this.value);
                    $('#settings-notification-wrap').removeClass('hidden');
                }
            },
            { value: "en", text: "English" },
            { value: "cs", text: "Čeština" }
        );

        // Background color: plain form input (not app-state chrome). Read at render
        // boot, so it needs a reload.
        const backgroundColorControl = div({ class: "flex items-center justify-between gap-2" },
            span({ class: "text-sm" }, $.t('settings.backgroundColor')),
            input({
                type: "color",
                id: "background-color-input",
                value: APPLICATION_CONTEXT.getOption("backgroundColor") || "#000000",
                class: "h-8 w-12 cursor-pointer rounded border border-base-300 bg-base-100",
                onchange: function () {
                    APPLICATION_CONTEXT.setOption('backgroundColor', this.value);
                    $('#settings-notification-wrap').removeClass('hidden');
                }
            })
        );

        // Global-menu dock mode applies live through the layout singleton, which
        // self-persists to AppCache — no banner.
        const globalMenuModeSelect = new Select(
            {
                id: "global-menu-mode-select",
                title: $.t('settings.globalMenuMode.title'),
                selected: window.LAYOUT?.dockMode || "overlay",
                onchange: function () { window.LAYOUT?.setDockMode(this.value); }
            },
            { value: "overlay", text: $.t('settings.globalMenuMode.overlay') },
            { value: "docked", text: $.t('settings.globalMenuMode.docked') }
        );

        // Notification anchor applies live via the Dialogs facade (self-persists).
        const notificationsPositionSelect = new Select(
            {
                id: "notifications-position-select",
                title: $.t('settings.notificationsPosition.title'),
                selected: APPLICATION_CONTEXT.getOption("notificationsPosition", "bottom"),
                onchange: function () { Dialogs.setPosition(this.value); }
            },
            { value: "top", text: $.t('settings.notificationsPosition.top') },
            { value: "bottom", text: $.t('settings.notificationsPosition.bottom') }
        );

        // Settings keeps its bespoke outer chrome (notification + title row +
        // logo) inline; the section cards go through `this.card()` so plugin
        // tabs and core settings share one source of truth. Plugins with no
        // bespoke chrome should just return `this.layout(this.card(...), ...)`.
        return div({ class: "relative flex min-h-full flex-col gap-4 pb-24 pt-3" },
            notification,
            div({ class: "flex flex-wrap items-start justify-between gap-3" },
                span({ class: "text-2xl font-semibold" }, $.t?.('main.bar.settings')),
                this.getHeaderBrand()
            ),
            div({ class: "grid gap-4 lg:grid-cols-2" },
                this.card("Appearance",
                    themeSelect.create(),
                    languageSelect.create(),
                    backgroundColorControl,
                    this.createCheckbox(
                        "toolbar-checkbox",
                        $.t('settings.toolBar'),
                        function () {
                            APPLICATION_CONTEXT.setUiOption('toolBar', this.checked);
                            const toolbarDivs = document.querySelectorAll('div[id^="toolbar-"]');
                            toolbarDivs.forEach(div => div.classList.toggle('hidden'));
                        },
                        APPLICATION_CONTEXT.getUiOption('toolBar')
                    ),
                    this.createCheckbox(
                        "scalebar-checkbox",
                        $.t('settings.scaleBar'),
                        function () {
                            APPLICATION_CONTEXT.setUiOption('scaleBar', this.checked);
                            for (let viewer of VIEWER_MANAGER.viewers) {
                                viewer.scalebar.setActive(this.checked);
                            }
                        },
                        APPLICATION_CONTEXT.getUiOption('scaleBar')
                    ),
                    this.createCheckbox(
                        "statusbar-checkbox",
                        $.t('settings.statusBar'),
                        function () {
                            APPLICATION_CONTEXT.setUiOption('statusBar', this.checked);
                            $('#viewer-status-bar').toggleClass('hidden');
                        },
                        APPLICATION_CONTEXT.getUiOption('statusBar')
                    ),
                    this.createCheckbox(
                        "navigator-checkbox",
                        $.t('settings.navigator'),
                        function () {
                            APPLICATION_CONTEXT.setUiOption('navigator', this.checked);
                            for (let viewer of VIEWER_MANAGER.viewers) {
                                const el = viewer.navigator?.element;
                                if (el) el.style.display = this.checked ? "" : "none";
                            }
                        },
                        APPLICATION_CONTEXT.getUiOption('navigator')
                    ),
                    this.createCheckbox(
                        "grayscale-checkbox",
                        $.t('settings.grayscale'),
                        reloadOnCheck('grayscale'),
                        APPLICATION_CONTEXT.getOption('grayscale', false)
                    ),
                    this.createCheckbox(
                        "custom-blending-checkbox",
                        $.t('settings.customBlending'),
                        reloadOnCheck('customBlending'),
                        APPLICATION_CONTEXT.getOption('customBlending', false)
                    )
                ),
                div({ class: "space-y-4" },
                    this.card($.t('settings.card.interface'),
                        globalMenuModeSelect.create(),
                        notificationsPositionSelect.create(),
                        this.createCheckbox(
                            "main-menu-checkbox",
                            $.t('settings.mainMenu'),
                            reloadOnCheck('mainMenu', true),
                            APPLICATION_CONTEXT.getUiOption('mainMenu')
                        ),
                        this.createCheckbox(
                            "app-bar-checkbox",
                            $.t('settings.appBar'),
                            reloadOnCheck('appBar', true),
                            APPLICATION_CONTEXT.getUiOption('appBar')
                        ),
                        this.createCheckbox(
                            "global-menu-checkbox",
                            $.t('settings.globalMenu'),
                            reloadOnCheck('globalMenu', true),
                            APPLICATION_CONTEXT.getUiOption('globalMenu')
                        ),
                        this.createCheckbox(
                            "disable-plugins-ui-checkbox",
                            $.t('settings.disablePluginsUi'),
                            reloadOnCheck('disablePluginsUi'),
                            APPLICATION_CONTEXT.getOption('disablePluginsUi', false)
                        )
                    ),
                    this.card($.t('settings.card.interaction'),
                        this.createCheckbox(
                            "scroll-requires-ctrl-checkbox",
                            $.t('settings.scrollRequiresCtrl'),
                            reloadOnCheck('scrollRequiresCtrl'),
                            APPLICATION_CONTEXT.getOption('scrollRequiresCtrl', false)
                        ),
                        this.createCheckbox(
                            "reverse-scroll-checkbox",
                            $.t('settings.reverseScroll'),
                            reloadOnCheck('reverseScroll'),
                            APPLICATION_CONTEXT.getOption('reverseScroll', false)
                        ),
                        this.createCheckbox(
                            "snap-zoom-checkbox",
                            $.t('settings.snapZoomToMagnification'),
                            reloadOnCheck('snapZoomToMagnification'),
                            APPLICATION_CONTEXT.getOption('snapZoomToMagnification', true)
                        ),
                        this.createCheckbox(
                            "prevent-nav-shortcuts-checkbox",
                            $.t('settings.preventNavigationShortcuts'),
                            reloadOnCheck('preventNavigationShortcuts'),
                            APPLICATION_CONTEXT.getOption('preventNavigationShortcuts', false)
                        )
                    ),
                    this.card("Behaviour",
                        this.createCheckbox(
                            "cookies-checkbox",
                            $.t('settings.cookies'),
                            function () {
                                APPLICATION_CONTEXT.setOption('bypassCookies', this.checked);
                                $('#settings-notification-wrap').removeClass('hidden');
                            },
                            APPLICATION_CONTEXT.getOption('bypassCookies', false)
                        )
                    ),
                    this.card("Other",
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

    /**
     * The plugin list entries, in include.json order, skipping what the user
     * cannot act on (always-loaded and hidden plugins). Display metadata comes
     * from `pluginMeta` so that `%key%` values resolve; lifecycle flags are read
     * off the raw record, which is the only place carrying them.
     */
    _collectPluginEntries() {
        const entries = [];
        for (let pid of APPLICATION_CONTEXT.pluginIds()) {
            const record = APPLICATION_CONTEXT._dangerouslyAccessPlugin(pid),
                pluginConfig = APPLICATION_CONTEXT.config.plugins[pid];

            if (record.permaLoad || record.hidden || pluginConfig?.permaLoad) continue;

            const raw = key => record[key];
            entries.push({
                id: pid,
                loaded: !!record.loaded,
                error: record.error,
                incompatible: window.elementIncompatibility?.("plugins", pid),
                icon: pluginMeta(pid, "icon"),
                stability: pluginMeta(pid, "stability"),
                categories: pluginMeta(pid, "categories") || [],
                keywords: pluginMeta(pid, "keywords") || [],
                links: {
                    homepage: pluginMeta(pid, "homepage"),
                    repository: pluginMeta(pid, "repository"),
                    bugs: pluginMeta(pid, "bugs"),
                    docsUrl: pluginMeta(pid, "docsUrl"),
                },
                // %key% metadata needs the plugin's locale bundle, which unloaded
                // plugins never fetched: show the fallback now, fill in on arrival
                nameState: van.state(FullscreenMenus._resolvedOr(pluginMeta(pid, "name"), pid)),
                descriptionState: van.state(FullscreenMenus._resolvedOr(pluginMeta(pid, "description"), "")),
                needsLocale: [raw("name"), raw("description"), raw("longDescription")]
                    .some(value => typeof value === "string" && value.startsWith("%")),
            });
        }
        return entries;
    }

    /**
     * A still-unresolved `%key%` reference is metadata the user must not see:
     * show the fallback until (or unless) the locale bundle arrives.
     */
    static _resolvedOr(value, fallback) {
        return (typeof value === "string" && value.startsWith("%")) || !value ? fallback : value;
    }

    /**
     * Fetch locale bundles for entries whose metadata is a `%key%` reference and
     * re-read the resolved values. Plugins without such metadata cost no request.
     */
    async _resolvePluginLocales(entries) {
        await Promise.all(entries.filter(e => e.needsLocale).map(async entry => {
            await window.loadElementLocale?.("plugins", entry.id);
            entry.nameState.val = FullscreenMenus._resolvedOr(pluginMeta(entry.id, "name"), entry.id);
            entry.descriptionState.val = FullscreenMenus._resolvedOr(pluginMeta(entry.id, "description"), "");
        }));
    }

    /** Group entries by their first category; uncategorized plugins come last. */
    _groupPluginEntries(entries) {
        const groups = new Map();
        for (const entry of entries) {
            const category = entry.categories[0] || "";
            if (!groups.has(category)) groups.set(category, []);
            groups.get(category).push(entry);
        }
        //stable: named categories alphabetically, the unnamed bucket at the end
        return [...groups.entries()].sort((a, b) =>
            !a[0] ? 1 : !b[0] ? -1 : a[0].localeCompare(b[0]));
    }

    _categoryLabel(category) {
        if (!category) return $.t('plugins.category.other');
        const key = `plugins.category.${category.toLowerCase().replace(/\s+/g, '-')}`;
        return $.i18n?.exists(key) ? $.t(key) : category;
    }

    _pluginMatchesQuery(entry, query) {
        if (!query) return true;
        return [entry.nameState.val, entry.descriptionState.val, entry.id,
            ...entry.categories, ...entry.keywords]
            .some(value => String(value ?? "").toLowerCase().includes(query));
    }

    get getPluginsBody() {
        const entries = this._collectPluginEntries();
        const query = van.state("");
        const matches = entry => this._pluginMatchesQuery(entry, query.val.trim().toLowerCase());

        this._resolvePluginLocales(entries);

        const groupNodes = this._groupPluginEntries(entries).map(([category, groupEntries]) => div(
            { class: () => groupEntries.some(matches) ? "space-y-3" : "hidden" },
            div({ class: "px-1 pt-2 text-xs font-semibold uppercase tracking-wide opacity-60" },
                this._categoryLabel(category)),
            ...groupEntries.map(entry => this.createPluginDiv(entry, matches))
        ));

        if (!entries.length) {
            groupNodes.push(this.createPluginDiv({
                id: "_undefined_",
                nameState: van.state($.t('plugins.noPluginsAvailable')),
                descriptionState: van.state($.t('plugins.noPluginsDetails')),
                categories: [], keywords: [], links: {}, loaded: false,
            }, () => true));
        }

        return div({ class: "relative flex min-h-full flex-col gap-4 pt-3 pb-24" },
            div({ class: "flex flex-wrap items-center justify-between gap-3" },
                span({ class: "text-2xl font-semibold" }, $.t('main.bar.plugins')),
                div({ class: "flex items-center gap-2" },
                    input({
                        type: "search",
                        class: "input input-sm input-bordered w-48",
                        placeholder: $.t('plugins.searchPlaceholder'),
                        "aria-label": $.t('plugins.searchPlaceholder'),
                        oninput: e => query.val = e.target.value,
                    }),
                    button({
                        onclick: function () { USER_INTERFACE.AppBar.Plugins.refreshPageWithSelectedPlugins?.(); },
                        class: "btn btn-primary btn-sm"
                    }, $.t('plugins.loadBtn'))
                )
            ),
            div({ id: "plug-list-content-inner", class: "rounded-2xl border border-base-300 bg-base-100 p-3 shadow-sm" },
                div({ id: "plug-list-content-inner-content", class: "space-y-3" }, ...groupNodes)
            ),
            this.getLogo(-80, 10)
        );
    }

    /**
     * External links declared by a plugin, as small icon anchors. Values are
     * deployment-controlled but still URLs: anything that is not an absolute
     * http(s) address is dropped rather than rendered.
     */
    _createPluginLinks(entry) {
        const definition = [
            ["homepage", "ph-house"],
            ["repository", "ph-git-branch"],
            ["docsUrl", "ph-book-open"],
            ["bugs", "ph-bug"],
        ];

        const nodes = [];
        for (const [key, icon] of definition) {
            const url = FullscreenMenus.safeExternalUrl(entry.links?.[key]);
            if (!url) continue;
            const label = $.t(`plugins.link.${key}`);
            nodes.push(a({
                    href: url,
                    target: "_blank",
                    rel: "noopener noreferrer",
                    "aria-label": label,
                    title: label,
                    class: "shrink-0 opacity-60 hover:opacity-100",
                    onclick: e => e.stopPropagation(),
                },
                BaseComponent.toNode(new PhIcon({ name: icon }))
            ));
        }
        return nodes;
    }

    /**
     * @param {*} value candidate URL
     * @return {string|undefined} the value if it is an absolute http(s) URL - other
     *   schemes (javascript:, data:, file:) and relative values are refused
     */
    static safeExternalUrl(value) {
        if (typeof value !== "string" || !value) return undefined;
        try {
            const url = new URL(value);
            return (url.protocol === "https:" || url.protocol === "http:") ? url.href : undefined;
        } catch (e) {
            return undefined;
        }
    }

    /**
     * A row of the plugin list.
     * @param {object} entry see `_collectPluginEntries`
     * @param {function} matches reactive predicate deciding whether the row is filtered out
     */
    createPluginDiv(entry, matches = () => true) {
        // an unusable plugin must not offer a Load button that is bound to fail
        const blocked = entry.incompatible || entry.error;
        let actionPart;
        if (entry.loaded) {
            actionPart = div({ id: `load-plugin-${entry.id}` },
                button({ class: "btn btn-disabled btn-sm" }, $.t('common.Loaded'))
            );
        } else if (blocked) {
            actionPart = div({ id: `load-plugin-${entry.id}` },
                button({ disabled: true, class: "btn btn-sm btn-disabled" }, $.t('common.Load'))
            );
        } else {
            actionPart = div({ id: `load-plugin-${entry.id}` },
                button({ onclick: function () { UTILITIES.loadPlugin(entry.id); return false; }, class: "btn btn-sm" }, $.t('common.Load'))
            );
        }

        const iconComponent = componentIconNode(entry.icon, { sizeClass: "h-10 w-10 rounded-xl" })
            || new ImageIcon({ name: APPLICATION_CONTEXT.url + "src/assets/image.png", sizeClass: "h-10 w-10 rounded-xl" });

        const badge = (cls, text) => span({ class: `badge badge-sm ${cls} shrink-0` }, text);
        const badges = [
            entry.stability === "experimental" && badge("badge-warning", $.t('plugins.stability.experimental')),
            entry.stability === "deprecated" && badge("badge-error", $.t('plugins.stability.deprecated')),
            entry.incompatible && badge("badge-error", $.t('plugins.incompatible')),
        ].filter(Boolean);

        let text = div({ class: "min-w-0 flex-1" },
            div({ class: "flex items-center gap-2" },
                div({ class: "truncate text-base font-semibold" }, entry.nameState),
                ...badges,
                ...this._createPluginLinks(entry)
            ),
            div({ class: "text-sm opacity-70" }, entry.descriptionState)
        );

        return div({
                id: `plug-list-content-inner-row-${entry.id}`,
                class: () => matches(entry) ? `plugin-${entry.id}-root` : "hidden"
            },
            input({ type: "checkbox", name: "plug-list-content", class: "hidden selectable-image-row-context", value: entry.id }),
            div({
                    class: "flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-base-300 bg-base-100 p-3 transition-colors hover:bg-base-200/60",
                    onclick: function () { $(this.previousElementSibling).click(); }
                },
                BaseComponent.toNode(iconComponent),
                text,
                actionPart
            ),
            // the loader writes load-time failures here; a reason known upfront
            // (bad include.json, unsatisfiable engines) is shown right away
            div({ id: `error-plugin-${entry.id}`, class: "mx-2 mb-3 text-sm" },
                blocked ? div({ class: "p-1 rounded-2 error-container" }, String(blocked)) : undefined)
        );
    }
}
