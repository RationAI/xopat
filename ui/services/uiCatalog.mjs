import { Dropdown } from '../classes/elements/dropdown.mjs';

/**
 * @typedef {Object} UiCatalogContext
 * @property {OpenSeadragon.Viewer} [viewer] target viewer for viewer-scoped nodes;
 *   defaults to `VIEWER_MANAGER.active`
 */

/**
 * @typedef {Object} UiNode
 * One reachable piece of UI. Plain values plus optional operations; the
 * operations never leave the catalog ({@link UiCatalog.serialize} drops them).
 *
 * @property {string} id         `"<providerId>:<rawId>"`, stable across reloads
 * @property {"menu"|"panel"|"tab"|"toolbar"|"item"|"action"|"shortcut"|"group"} kind
 * @property {string} label      already-translated plain text
 * @property {string} [hint]     long-form description, when the registrant gave one
 * @property {string} [owner]    owning plugin/module id, when known
 * @property {string} [parent]   id of the node that must be open for this one to be reachable
 * @property {boolean} [viewerScoped] exists once per viewer; operations act on `ctx.viewer`
 * @property {{open?: boolean, selected?: boolean, disabled?: boolean, hidden?: boolean}} state
 * @property {string} [shortcut] display combo, e.g. `"Ctrl+Z"`
 * @property {function(UiCatalogContext): (void|boolean|Promise<*>)} [open]
 * @property {function(UiCatalogContext): (void|boolean)} [close]
 * @property {function(UiCatalogContext): *} [invoke]
 * @property {function(UiCatalogContext): (Element|null)} [anchor] element to point at
 */

/**
 * @typedef {Object} UiCatalogProvider
 * @property {string} id
 * @property {function(UiCatalogContext): UiNode[]} list  fresh snapshot, never cached
 * @property {function(function(): void): function(): void} [subscribe] returns unsubscribe
 */

const SEP = "/";

function textOf(value, fallback = "") {
    return typeof value === "string" && value ? value : fallback;
}

function byId(id) {
    return id ? document.getElementById(id) : null;
}

function nextFrame() {
    return new Promise(resolve => (window.requestAnimationFrame || (fn => setTimeout(fn, 16)))(() => resolve()));
}

/**
 * Live, enumerable map of the application UI: app-bar menus and their rows,
 * fullscreen panels, per-viewer side panels, dock tabs, toolbars, actions and
 * keyboard shortcuts — as one tree of {@link UiNode}s that can be listed,
 * opened, closed, invoked and pointed at.
 *
 * It owns no UI and no registrations of its own: every built-in provider reads
 * an existing registry, so anything registered through `AppBar.Tools`,
 * `AppBar.View`, `AppBar.Actions`, `AppBar.Plugins`/`FullscreenMenus`,
 * `registerViewerMenu`, `LAYOUT` or `APPLICATION_CONTEXT.shortcuts` is
 * discoverable with no extra work. This is what the `ui` scripting namespace
 * (and therefore the chat assistant) explores instead of guessing.
 *
 * @example
 * const Catalog = USER_INTERFACE.AppBar.Catalog;
 * Catalog.list({ query: "keymap" });          // → [{id: "fullscreen:keymap-menu", ...}]
 * await Catalog.open("fullscreen:keymap-menu");
 */
export class UiCatalog {

    constructor(appBar) {
        this._appBar = appBar;
        /** @type {Map<string, UiCatalogProvider>} */
        this._providers = new Map();
        this._providerSubs = new Map();
        this._subs = new Set();
        this._raf = 0;
    }

    init() {
        this.registerProvider(this._appBarProvider());
        this.registerProvider(this._fullscreenProvider());
        this.registerProvider(this._viewerTabProvider());
        this.registerProvider(this._dockProvider());
        this.registerProvider(this._toolbarProvider());
        this.registerProvider(this._actionProvider());
        const shortcuts = window.APPLICATION_CONTEXT?.shortcuts;
        if (shortcuts) this.registerProvider(this._shortcutProvider(shortcuts));
        return this;
    }

    // ── Provider registry ───────────────────────────────────────────────────

    /**
     * Expose UI that lives in no built-in registry. Prefer registering the UI
     * itself through an existing registry — it then shows up here for free.
     * @param {UiCatalogProvider} provider
     * @returns {function(): void} unregister
     */
    registerProvider(provider) {
        if (!provider?.id || typeof provider.list !== "function") {
            console.error("AppBar.Catalog.registerProvider: {id, list} required", provider);
            return () => {};
        }
        this._providerSubs.get(provider.id)?.();
        this._providers.set(provider.id, provider);
        const off = provider.subscribe?.(() => this._emit());
        if (off) this._providerSubs.set(provider.id, off);
        this._emit();
        return () => {
            this._providerSubs.get(provider.id)?.();
            this._providerSubs.delete(provider.id);
            this._providers.delete(provider.id);
            this._emit();
        };
    }

    // ── Reading ─────────────────────────────────────────────────────────────

    /**
     * @param {UiCatalogContext} [ctx]
     * @returns {UiNode[]} every node, provider order preserved, first id wins
     */
    all(ctx = {}) {
        const out = [];
        const seen = new Set();
        for (const provider of this._providers.values()) {
            let items;
            try {
                items = provider.list(ctx) || [];
            } catch (e) {
                console.warn(`AppBar.Catalog: provider "${provider.id}" failed to list`, e);
                continue;
            }
            for (const node of items) {
                if (!node?.id || seen.has(node.id)) continue;
                seen.add(node.id);
                out.push(node);
            }
        }
        return out;
    }

    /**
     * Filtered snapshot. With no `parent`, `query` or `kind`, only root nodes
     * are returned — drill down with `parent`.
     * @param {{kind?: string, owner?: string, parent?: string, query?: string}} [filter]
     * @param {UiCatalogContext} [ctx]
     * @returns {UiNode[]}
     */
    list(filter = {}, ctx = {}) {
        const nodes = this.all(ctx);
        const byIdMap = new Map(nodes.map(n => [n.id, n]));
        const tokens = textOf(filter.query).toLowerCase().split(/\s+/).filter(Boolean);
        const browsing = !filter.parent && !tokens.length && !filter.kind && !filter.owner;

        return nodes.filter(node => {
            if (filter.kind && node.kind !== filter.kind) return false;
            if (filter.owner && node.owner !== filter.owner) return false;
            if (filter.parent && node.parent !== filter.parent) return false;
            if (browsing && node.parent && byIdMap.has(node.parent)) return false;
            if (tokens.length) {
                const hay = [node.id, node.label, node.hint, node.owner, ...this._path(node, byIdMap)]
                    .filter(Boolean).join(" ").toLowerCase();
                if (!tokens.every(t => hay.includes(t))) return false;
            }
            return true;
        });
    }

    /**
     * @param {string} id
     * @param {UiCatalogContext} [ctx]
     * @returns {UiNode|null}
     */
    get(id, ctx = {}) {
        return this.all(ctx).find(n => n.id === id) || null;
    }

    /**
     * Ancestors of a node, root first (the node itself excluded).
     * @param {string} id
     * @param {UiCatalogContext} [ctx]
     * @returns {UiNode[]}
     */
    ancestors(id, ctx = {}) {
        const nodes = new Map(this.all(ctx).map(n => [n.id, n]));
        const chain = [];
        const seen = new Set([id]);
        let parent = nodes.get(id)?.parent;
        while (parent && !seen.has(parent) && nodes.has(parent)) {
            seen.add(parent);
            chain.unshift(nodes.get(parent));
            parent = nodes.get(parent).parent;
        }
        return chain;
    }

    /**
     * Every open panel/menu/tab and every visible toolbar.
     * @param {UiCatalogContext} [ctx]
     * @returns {UiNode[]}
     */
    openNodes(ctx = {}) {
        return this.all(ctx).filter(n => n.kind !== "action" && n.kind !== "item" && n.state?.open === true);
    }

    // ── Operating ───────────────────────────────────────────────────────────

    /**
     * Make a node reachable: open every closed ancestor, root first.
     * @param {string} id
     * @param {UiCatalogContext} [ctx]
     * @returns {Promise<UiNode>} the node, re-read after its ancestors opened
     */
    async reveal(id, ctx = {}) {
        if (!this.get(id, ctx)) throw new Error(`Unknown UI element '${id}'.`);
        for (const ancestor of this.ancestors(id, ctx)) {
            if (ancestor.state?.open === true || typeof ancestor.open !== "function") continue;
            await ancestor.open(ctx);
            await nextFrame();
        }
        return this.get(id, ctx);
    }

    /**
     * Open a node (and its ancestors). Opening an already-open node is a no-op.
     * @param {string} id
     * @param {UiCatalogContext} [ctx]
     * @returns {Promise<boolean>} false when the node cannot be opened
     */
    async open(id, ctx = {}) {
        const node = await this.reveal(id, ctx);
        if (typeof node?.open !== "function") return false;
        if (node.state?.open !== true) {
            await node.open(ctx);
            await nextFrame();
        }
        return true;
    }

    /**
     * @param {string} id
     * @param {UiCatalogContext} [ctx]
     * @returns {boolean} false when the node cannot be closed
     */
    close(id, ctx = {}) {
        const node = this.get(id, ctx);
        if (typeof node?.close !== "function") return false;
        node.close(ctx);
        return true;
    }

    /**
     * Run a node's action. Disabled nodes are refused.
     * @param {string} id
     * @param {UiCatalogContext} [ctx]
     * @returns {Promise<boolean>} true when the action ran
     */
    async invoke(id, ctx = {}) {
        const node = this.get(id, ctx);
        if (typeof node?.invoke !== "function" || node.state?.disabled) return false;
        await node.invoke(ctx);
        return true;
    }

    /**
     * Reveal a node and resolve the element to point the user at. Falls back to
     * the nearest ancestor with an on-screen element (a row inside a closed
     * submenu, a toolbar button on a hidden tab).
     * @param {string} id
     * @param {UiCatalogContext} [ctx]
     * @returns {Promise<{node: UiNode, element: Element|null, target: string|null}>}
     */
    async locate(id, ctx = {}) {
        const node = await this.reveal(id, ctx);
        const chain = [node, ...this.ancestors(id, ctx).reverse()];
        for (const candidate of chain) {
            const element = candidate?.anchor?.(ctx) || null;
            if (element && element.isConnected && element.getClientRects().length) {
                return { node, element, target: candidate.id };
            }
        }
        return { node, element: null, target: null };
    }

    /**
     * Plain, structured-clone-safe view of a node.
     * @param {UiNode} node
     * @param {UiCatalogContext} [ctx]
     */
    serialize(node, ctx = {}) {
        if (!node) return null;
        const nodes = new Map(this.all(ctx).map(n => [n.id, n]));
        const children = [...nodes.values()].filter(n => n.parent === node.id).length;
        const ops = [];
        if (typeof node.open === "function") ops.push("open");
        if (typeof node.close === "function") ops.push("close");
        if (typeof node.invoke === "function") ops.push("invoke");
        if (typeof node.anchor === "function" || node.parent) ops.push("show");
        return {
            id: node.id,
            kind: node.kind,
            label: textOf(node.label, node.id),
            ...(node.hint ? { hint: textOf(node.hint) } : {}),
            ...(node.owner ? { owner: node.owner } : {}),
            ...(node.parent ? { parent: node.parent } : {}),
            path: this._path(node, nodes),
            ...(node.viewerScoped ? { viewerScoped: true } : {}),
            state: { ...(node.state || {}) },
            ...(node.shortcut ? { shortcut: node.shortcut } : {}),
            ...(children ? { children } : {}),
            ops,
        };
    }

    /** @private labels of the ancestors, root first */
    _path(node, nodes) {
        const out = [];
        const seen = new Set([node.id]);
        let parent = node.parent;
        while (parent && !seen.has(parent) && nodes.has(parent)) {
            seen.add(parent);
            const p = nodes.get(parent);
            out.unshift(textOf(p.label, p.id));
            parent = p.parent;
        }
        return out;
    }

    // ── Change notification (rAF-coalesced) ─────────────────────────────────

    /**
     * @param {function(): void} cb
     * @returns {function(): void} unsubscribe
     */
    onChange(cb) {
        if (typeof cb !== "function") return () => {};
        this._subs.add(cb);
        return () => this._subs.delete(cb);
    }

    /** @private */
    _emit() {
        if (this._raf) return;
        const schedule = window.requestAnimationFrame || (fn => setTimeout(fn, 16));
        this._raf = schedule(() => {
            this._raf = 0;
            for (const cb of [...this._subs]) {
                try { cb(); } catch (e) { console.warn("AppBar.Catalog: onChange handler failed", e); }
            }
        });
    }

    // ── Built-in providers ──────────────────────────────────────────────────

    /**
     * Top app-bar menus (left: View/Edit/Plugins/Tools/plugin tabs; right:
     * Settings/Tutorials/Save/Share/User) and the rows of their dropdowns.
     * The View and Tools rows are left to the action provider, which already
     * knows their toggle state.
     * @private
     */
    _appBarProvider() {
        const appBar = this._appBar;
        const ACTION_OWNED = new Set(["view", "tools"]);

        const listItems = (tabNodeId, items, out) => {
            for (const item of Object.values(items || {})) {
                if (!item?.id) continue;
                const id = `${tabNodeId}${SEP}${item.id}`;
                const children = Array.isArray(item.children) ? item.children : [];
                out.push({
                    id,
                    kind: children.length ? "menu" : "item",
                    label: textOf(item.label, item.id),
                    hint: textOf(item.hint || item.title) || undefined,
                    parent: tabNodeId,
                    state: { disabled: !!item.disabled, ...(item.selected === undefined ? {} : { selected: !!item.selected }) },
                    invoke: !children.length && typeof item.onClick === "function" ? () => item.onClick() : undefined,
                    anchor: () => item._node || null,
                });
                if (children.length) {
                    listItems(id, Object.fromEntries(children.map(c => [c.id, c])), out);
                }
            }
        };

        const listMenu = (menu, out) => {
            for (const tab of Object.values(menu?.tabs || {})) {
                if (!tab?.id || !tab.headerButton) continue;
                const id = `appbar:${tab.id}`;
                const button = () => byId(tab.headerButton.id);
                if (tab instanceof Dropdown) {
                    // View rows are built lazily on first open and Tools rows are
                    // hidden-not-removed, so their registries decide emptiness.
                    const empty = tab.id === "view" ? false
                        : tab.id === "tools" ? !appBar.Tools.list().length
                            : !Object.keys(tab.items || {}).length;
                    if (empty) continue;
                    out.push({
                        id,
                        kind: "menu",
                        label: textOf(tab.title, tab.id),
                        state: { open: !!tab._isOpen },
                        open: () => { if (!tab._isOpen) button()?.click(); },
                        close: () => tab.close(),
                        anchor: button,
                    });
                    if (!ACTION_OWNED.has(tab.id)) listItems(id, tab.items, out);
                } else {
                    // Header buttons with no body launch something elsewhere
                    // (Settings → fullscreen panel, Save → persistence).
                    out.push({
                        id,
                        kind: "action",
                        label: textOf(tab.title, tab.id),
                        state: {},
                        invoke: () => button()?.click(),
                        anchor: button,
                    });
                }
            }
        };

        return {
            id: "appbar",
            list: () => {
                const out = [];
                listMenu(appBar.menu, out);
                listMenu(appBar.rightMenu, out);
                return out;
            },
        };
    }

    /** Fullscreen panels (settings, keymap, plugin catalogue, plugin menus) and their sub-tabs. @private */
    _fullscreenProvider() {
        const menus = () => window.UI?.Services?.FullscreenMenus;
        return {
            id: "fullscreen",
            list: () => {
                const service = menus();
                if (!service) return [];
                const focused = service.getFocusedId();
                const out = [];
                for (const panel of service.list()) {
                    const id = `fullscreen:${panel.id}`;
                    out.push({
                        id,
                        kind: "panel",
                        label: textOf(panel.title, panel.id),
                        owner: panel.owner,
                        state: { open: focused === panel.id },
                        open: () => panel.owner
                            ? service.openSubmenu(panel.owner)
                            : service.focus(panel.id),
                        close: () => service.close(),
                        anchor: () => byId(panel.buttonId),
                    });
                    const focusedSub = service.getFocusedSubmenuId(panel.id);
                    for (const sub of panel.tabs) {
                        out.push({
                            id: `${id}${SEP}${sub.id}`,
                            kind: "tab",
                            label: textOf(sub.title, sub.id),
                            owner: panel.owner,
                            parent: id,
                            state: { open: focused === panel.id && focusedSub === sub.id },
                            open: () => service.openSubmenu(panel.owner, sub.id),
                            anchor: () => byId(sub.buttonId),
                        });
                    }
                }
                return out;
            },
        };
    }

    /** Side panels of the target viewer (navigator, layers, plugin panels). @private */
    _viewerTabProvider() {
        const menuOf = (ctx) => {
            const vm = window.VIEWER_MANAGER;
            const viewer = ctx?.viewer || vm?.active;
            return viewer ? vm?.getMenu?.(viewer) : null;
        };
        return {
            id: "viewer-tab",
            list: (ctx) => {
                const menu = menuOf(ctx);
                if (!menu?.listTabs) return [];
                return menu.listTabs().map(tab => ({
                    id: `viewer-tab:${tab.id}`,
                    kind: "tab",
                    label: textOf(tab.title, tab.id),
                    viewerScoped: true,
                    state: { open: tab.open, ...(tab.hidden ? { hidden: true } : {}) },
                    open: (c) => menuOf(c)?.openTab(tab.id),
                    close: (c) => menuOf(c)?.closeTab(tab.id),
                    anchor: (c) => {
                        const live = menuOf(c)?.listTabs().find(t => t.id === tab.id);
                        return (live?.open && byId(live.bodyId)) || byId(live?.anchorId);
                    },
                }));
            },
            subscribe: (notify) => USER_INTERFACE?.AppBar?.View?.onChange?.(notify) || (() => {}),
        };
    }

    /** Tabs of the global dock (`LAYOUT`). @private */
    _dockProvider() {
        return {
            id: "dock",
            list: () => {
                const layout = window.LAYOUT;
                if (!layout?.listTabs) return [];
                return layout.listTabs().map(tab => ({
                    id: `dock:${tab.id}`,
                    kind: "tab",
                    label: textOf(tab.title, tab.id),
                    state: { open: tab.focused, ...(tab.visible ? {} : { hidden: true }) },
                    open: () => layout.showTab(tab.id),
                    close: () => layout.hideTab(tab.id),
                    anchor: () => byId(tab.buttonId),
                }));
            },
        };
    }

    /** Toolbars and their buttons (annotation modes, tools, ...). @private */
    _toolbarProvider() {
        return {
            id: "toolbar",
            list: () => {
                const layout = window.LAYOUT;
                if (!layout?.listToolbars) return [];
                const out = [];
                for (const entry of layout.listToolbars()) {
                    const id = `toolbar:${entry.id}`;
                    const toolbar = entry.toolbar;
                    out.push({
                        id,
                        kind: "toolbar",
                        label: textOf(entry.title, entry.id),
                        owner: entry.id.startsWith("toolbar-") ? entry.id.slice("toolbar-".length) : undefined,
                        state: { open: entry.visible },
                        open: () => toolbar.visibility?.set?.(true),
                        close: () => toolbar.visibility?.set?.(false),
                        anchor: () => toolbar.getRootNode?.() || null,
                    });
                    // Toolbar content is a tree of arbitrary components; the
                    // rendered buttons are the one uniform, labelled surface.
                    const root = toolbar.getRootNode?.();
                    for (const button of root?.querySelectorAll?.("[data-toolbar-item]") || []) {
                        if (!button.id) continue;
                        const label = button.getAttribute("title") || button.getAttribute("aria-label");
                        if (!label) continue;
                        out.push({
                            id: `${id}${SEP}${button.id}`,
                            kind: "item",
                            label,
                            parent: id,
                            state: {
                                selected: button.classList.contains("btn-primary"),
                                disabled: button.disabled || button.getAttribute("aria-disabled") === "true",
                            },
                            invoke: () => byId(button.id)?.click(),
                            anchor: () => byId(button.id),
                        });
                    }
                }
                return out;
            },
        };
    }

    /** `AppBar.Actions` (Tools rows, View toggles, custom actions). @private */
    _actionProvider() {
        const PARENT = { tools: "appbar:tools", view: "appbar:view" };
        const appBar = this._appBar;
        const actions = () => appBar.Actions;
        // The row inside the (open) parent dropdown; a categorised View toggle
        // lives in a submenu, so its category row is the closest on-screen node.
        const rowNode = (desc) => {
            if (desc.providerId === "tools") return appBar.Tools.getTab()?.items?.[desc.rawId]?._node || null;
            if (desc.providerId !== "view") return null;
            const items = appBar.View.subMenu?.items || {};
            const dot = desc.rawId.indexOf(".");
            const category = dot > 0 ? appBar.View.structure?.[desc.rawId.slice(0, dot)] : null;
            return (category ? items[category.id]?._node : items[desc.rawId]?._node) || null;
        };
        return {
            id: "action",
            list: () => (actions()?.list() || [])
                // Shortcuts are listed in full (not only quick actions) by their own provider.
                .filter(desc => desc.providerId !== "shortcut")
                .map(desc => ({
                    id: `action:${desc.key}`,
                    kind: "action",
                    label: textOf(desc.label, desc.rawId),
                    hint: textOf(desc.hint) || undefined,
                    parent: PARENT[desc.providerId],
                    shortcut: textOf(desc.kbd) || undefined,
                    state: {
                        disabled: !!desc.disabled,
                        ...(desc.selected === undefined ? {} : { selected: !!desc.selected }),
                    },
                    invoke: desc.pinnable === false ? undefined : () => actions().invoke(desc.key),
                    anchor: () => rowNode(desc)
                        || byId(`quick-action-${desc.key.replace(/[^A-Za-z0-9_-]/g, "_")}`),
                })),
            subscribe: (notify) => actions()?.onChange(notify) || (() => {}),
        };
    }

    /** Every keyboard shortcut with its current binding. @private */
    _shortcutProvider(shortcuts) {
        return {
            id: "shortcut",
            list: () => {
                const specs = shortcuts.list();
                if (!specs.length) return [];
                const out = [{
                    id: "shortcut:all",
                    kind: "group",
                    label: $.t('keymap.title'),
                    state: {},
                    open: () => window.UI?.Services?.FullscreenMenus?.focus("keymap-menu"),
                    anchor: () => null,
                }];
                for (const s of specs) {
                    const combo = s.combos?.[0];
                    const invocable = s.quickAction && s.type === "press" && typeof s.handler === "function";
                    out.push({
                        id: `shortcut:${s.id}`,
                        kind: "shortcut",
                        label: $.t(s.titleKey, s.titleArgs),
                        hint: s.descriptionKey ? $.t(s.descriptionKey) : undefined,
                        owner: s.owner,
                        parent: "shortcut:all",
                        shortcut: combo ? shortcuts.comboDisplayParts(combo).join("+") : undefined,
                        state: {},
                        invoke: invocable ? (c) => shortcuts.invoke(s.id, { viewer: c?.viewer }) : undefined,
                    });
                }
                return out;
            },
            subscribe: (notify) => {
                const events = ["shortcut-registered", "shortcut-unregistered", "binding-changed", "bindings-reset"];
                for (const e of events) shortcuts.addHandler?.(e, notify);
                return () => {
                    for (const e of events) shortcuts.removeHandler?.(e, notify);
                };
            },
        };
    }
}
