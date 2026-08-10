import { Div } from '../classes/elements/div.mjs';
import { Button } from '../classes/elements/buttons.mjs';
import { Dropdown } from '../classes/elements/dropdown.mjs';
import { BaseComponent } from '../classes/baseComponent.mjs';
import { PhIcon, componentIconNode } from '../classes/elements/ph-icon.mjs';

/**
 * @typedef {Object} ActionDescriptor
 * An immutable snapshot of one invocable action. Plain values only — no
 * getters, no callables except `invoke` — so the renderer can diff two
 * snapshots cheaply and never has to poll.
 *
 * @property {string} key         `"<providerId>:<rawId>"`, split on the FIRST colon
 * @property {string} providerId
 * @property {string} rawId
 * @property {string} label       already-translated plain text (never an i18n key, never HTML)
 * @property {string|BaseComponent} [icon] `ph-*`/`fa-*` class, image URL or component
 * @property {string} [hint]      long-form tooltip
 * @property {string} [kbd]       display combo, e.g. `"Ctrl+S"`
 * @property {string} [group]     translated catalogue group (Settings card sectioning)
 * @property {boolean} disabled
 * @property {boolean} [selected] PRESENT ⇒ toggle semantics ⇒ renders `aria-pressed`
 * @property {boolean} pinnable   false ⇒ listed in the catalogue but cannot be pinned
 * @property {function(Event=): (void|Promise<void>)} invoke
 */

/**
 * @typedef {Object} ActionProvider
 * @property {string} id
 * @property {function(): ActionDescriptor[]} list  cheap fresh snapshot, never cached
 * @property {function(function(): void): function(): void} subscribe returns unsubscribe
 */

/**
 * Shown whenever an action carries no usable icon. An icon-only button with no
 * glyph is an invisible control, so every icon slot must resolve to *something*
 * — a neutral outline reads as "no icon assigned" rather than as a broken one.
 */
export const PLACEHOLDER_ICON = "ph-circle-dashed";

/** Split `"<providerId>:<rawId>"` on the first colon only — raw ids contain dots and colons. */
function splitKey(key) {
    const at = typeof key === "string" ? key.indexOf(":") : -1;
    if (at < 0) return null;
    return { providerId: key.slice(0, at), rawId: key.slice(at + 1) };
}

/** Labels may legitimately be nodes in the Tools registry; icon slots need text. */
function textOf(value, fallback = "") {
    return typeof value === "string" && value ? value : fallback;
}

/**
 * Read-only, **live** catalogue of invocable actions, aggregated from pluggable
 * providers. It owns no DOM: it exists so a renderer (the app-bar quick-actions
 * bar, the Settings card, later `MobileBottomBar`) can enumerate "everything the
 * user can trigger" without each registrant having to opt into a second registry.
 *
 * Built-in providers:
 *  - `tools`    — {@link AppBar.Tools} entries (screenshot, viewport sync, inspectors, …)
 *  - `view`     — {@link AppBar.View} visibility toggles (stateful, `selected` present)
 *  - `shortcut` — `APPLICATION_CONTEXT.shortcuts` specs that opted in with `quickAction: true`
 *  - `custom`   — the {@link register} escape hatch for functionality in no registry
 *
 * @example
 * USER_INTERFACE.AppBar.Actions.register('myPlugin.doThing', {
 *     label: myTranslatedLabel, icon: 'ph-lightning',
 *     invoke: () => doThing(),
 * });   // → catalogue key "custom:myPlugin.doThing"
 * // `label` must already be translated — the catalogue never resolves i18n keys.
 */
export class AppBarActions {

    constructor(appBar) {
        this._appBar = appBar;
        /** @type {Map<string, ActionProvider>} */
        this._providers = new Map();
        /** @type {Map<string, function(): void>} */
        this._providerSubs = new Map();
        this._custom = new Map();
        this._subs = new Set();
        this._raf = 0;
    }

    init() {
        this.registerProvider(this._customProvider());
        this.registerProvider(this._toolsProvider());
        this.registerProvider(this._viewProvider());
        const shortcuts = window.APPLICATION_CONTEXT?.shortcuts;
        if (shortcuts) this.registerProvider(this._shortcutProvider(shortcuts));
        return this;
    }

    // ── Provider registry ───────────────────────────────────────────────────

    /**
     * @param {ActionProvider} provider
     * @returns {function(): void} unregister
     */
    registerProvider(provider) {
        if (!provider?.id || typeof provider.list !== "function") {
            console.error("AppBar.Actions.registerProvider: {id, list} required", provider);
            return () => {};
        }
        this._providers.set(provider.id, provider);
        this._providerSubs.get(provider.id)?.();
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

    /**
     * Escape hatch: expose an action that lives in no existing registry.
     * @param {string} rawId unique, namespace by owner
     * @param {Partial<ActionDescriptor> & {invoke: function}} descriptor
     * @returns {string} the catalogue key (`"custom:<rawId>"`)
     */
    register(rawId, descriptor = {}) {
        if (!rawId || typeof rawId !== "string") throw new Error("AppBar.Actions.register: rawId required");
        if (typeof descriptor.invoke !== "function") throw new Error("AppBar.Actions.register: invoke required");
        this._custom.set(rawId, { ...descriptor });
        this._emit();
        return `custom:${rawId}`;
    }

    /** @param {string} rawId */
    unregister(rawId) {
        const had = this._custom.delete(rawId);
        if (had) this._emit();
        return had;
    }

    // ── Reading ─────────────────────────────────────────────────────────────

    /**
     * Snapshot of every action, provider order preserved, first key wins on collision.
     * @returns {ActionDescriptor[]}
     */
    list() {
        const out = [];
        const seen = new Set();
        for (const provider of this._providers.values()) {
            let items;
            try {
                items = provider.list() || [];
            } catch (e) {
                console.warn(`AppBar.Actions: provider "${provider.id}" failed to list`, e);
                continue;
            }
            for (const item of items) {
                if (!item?.key || seen.has(item.key)) continue;
                seen.add(item.key);
                out.push(item);
            }
        }
        return out;
    }

    /**
     * @param {string} key
     * @returns {ActionDescriptor|null}
     */
    get(key) {
        const parsed = splitKey(key);
        if (!parsed) return null;
        const provider = this._providers.get(parsed.providerId);
        if (!provider) return null;
        try {
            return provider.list()?.find(d => d.key === key) || null;
        } catch (e) {
            console.warn(`AppBar.Actions: provider "${parsed.providerId}" failed to list`, e);
            return null;
        }
    }

    /**
     * Fire an action by catalogue key. Disabled and non-pinnable entries are refused.
     * @param {string} key
     * @param {Event} [ev]
     * @returns {boolean} true when the action ran
     */
    invoke(key, ev = undefined) {
        const desc = this.get(key);
        if (!desc || desc.disabled || desc.pinnable === false) return false;
        try {
            desc.invoke(ev);
        } catch (e) {
            console.error(`AppBar.Actions: action "${key}" threw`, e);
        }
        return true;
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

    /**
     * Coalescing is load-bearing, not cosmetic: `src/app.ts` re-`register`s every
     * Tools entry on each shortcut `binding-changed`, and `Tools.setDisabled` is
     * called synchronously from inside an action's own click handler.
     * @private
     */
    _emit() {
        if (this._raf) return;
        const schedule = window.requestAnimationFrame || (fn => setTimeout(fn, 16));
        this._raf = schedule(() => {
            this._raf = 0;
            for (const cb of [...this._subs]) {
                try { cb(); } catch (e) { console.warn("AppBar.Actions: onChange handler failed", e); }
            }
        });
    }

    dispose() {
        for (const off of this._providerSubs.values()) {
            try { off(); } catch (e) { /* teardown */ }
        }
        this._providerSubs.clear();
        this._providers.clear();
        this._subs.clear();
    }

    // ── Built-in providers ──────────────────────────────────────────────────

    /** @private */
    _customProvider() {
        return {
            id: "custom",
            list: () => [...this._custom].map(([rawId, d]) => ({
                key: `custom:${rawId}`,
                providerId: "custom",
                rawId,
                label: textOf(d.label, rawId),
                icon: d.icon || "ph-lightning",
                hint: d.hint,
                kbd: d.kbd,
                group: d.group || $.t('main.bar.plugins'),
                disabled: !!d.disabled,
                ...(d.selected === undefined ? {} : { selected: !!d.selected }),
                pinnable: d.pinnable !== false,
                invoke: (ev) => this._custom.get(rawId)?.invoke?.(ev),
            })),
            subscribe: () => () => {},
        };
    }

    /** @private */
    _toolsProvider() {
        const Tools = this._appBar.Tools;
        return {
            id: "tools",
            list: () => Tools.list().map(e => ({
                key: `tools:${e.id}`,
                providerId: "tools",
                rawId: e.id,
                label: textOf(e.label, e.id),
                icon: e.icon || "ph-wrench",
                hint: textOf(e.hint),
                kbd: textOf(e.kbd),
                group: $.t('main.bar.tools'),
                disabled: !!e.disabled,
                // Submenu rows are not one-shot actions; listed but not pinnable.
                pinnable: !(Array.isArray(e.children) && e.children.length),
                // Re-read the live entry: a re-register() swaps onClick and a
                // closure over the snapshot would fire the stale handler.
                invoke: (ev) => Tools._entries.get(e.id)?.onClick?.(ev),
            })),
            subscribe: (notify) => Tools.onChange(notify),
        };
    }

    /** @private */
    _viewProvider() {
        const View = this._appBar.View;
        /** @type {Set<function(): void>} per-VisibilityManager unsubscribes */
        let vmSubs = new Set();

        const rebindVms = (notify) => {
            for (const off of vmSubs) {
                try { off(); } catch (e) { /* teardown */ }
            }
            vmSubs = new Set();
            for (const row of View.list()) {
                for (const vm of row.vms) {
                    if (typeof vm.onChange === "function") vmSubs.add(vm.onChange(notify));
                }
            }
        };

        return {
            id: "view",
            list: () => View.list().map(row => ({
                key: `view:${row.category ? `${row.category}.` : ""}${row.id}`,
                providerId: "view",
                rawId: `${row.category ? `${row.category}.` : ""}${row.id}`,
                label: textOf(row.label, row.id),
                icon: row.icon || "ph-eye",
                hint: undefined,
                group: textOf(row.group, $.t('main.bar.view')),
                disabled: false,
                selected: row.vms.every(vm => vm.is()),
                pinnable: true,
                invoke: () => View.toggleRow(row),
            })),
            subscribe: (notify) => {
                // Viewers come and go, so the per-VM handles are rebuilt on every
                // registry change (old ones dropped first) rather than once.
                rebindVms(notify);
                const off = View.onChange(() => { rebindVms(notify); notify(); });
                return () => {
                    off();
                    for (const vmOff of vmSubs) {
                        try { vmOff(); } catch (e) { /* teardown */ }
                    }
                    vmSubs = new Set();
                };
            },
        };
    }

    /** @private */
    _shortcutProvider(shortcuts) {
        return {
            id: "shortcut",
            list: () => shortcuts.list()
                .filter(s => s.quickAction && s.type === "press" && typeof s.handler === "function")
                .map(s => ({
                    key: `shortcut:${s.id}`,
                    providerId: "shortcut",
                    rawId: s.id,
                    label: $.t(s.titleKey, s.titleArgs),
                    icon: s.icon || "ph-keyboard",
                    hint: s.descriptionKey ? $.t(s.descriptionKey) : undefined,
                    kbd: s.combos?.[0] ? shortcuts.comboDisplayParts(s.combos[0]).join("+") : undefined,
                    group: s.categoryPath?.length ? $.t(s.categoryPath[s.categoryPath.length - 1]) : $.t('keymap.title'),
                    disabled: false,
                    pinnable: true,
                    invoke: () => shortcuts.invoke(s.id),
                })),
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

/**
 * Renders the pinned subset of {@link AppBarActions} as icon-only buttons in the
 * top app bar, inside `#top-side-left` (already `AppBar.Chrome`-enrolled, and
 * unlike a new `#top-menus` sibling it does not compete with the `flex-1`
 * toolbar slot for width).
 *
 * Configuration is a two-tier trust split (AGENTS.md §7):
 *  - `ENV core.setup.quickActions` (via `APPLICATION_CONTEXT.defaultParams`) is
 *    operator-trusted and may carry `{id, icon, label}` presentation overrides;
 *  - the per-user list resolved through `getOption` may come from a URL param or
 *    an imported peer session, so it is reduced to **id strings only**.
 *  - `ENV core.setup.quickActionsUserEditable: false` freezes the bar.
 */
export class QuickActionsBar {

    static HOST_ID = "top-side-quick-actions";
    /** Defensive bound on a session-supplied list, before catalogue resolution. */
    static MAX_PINS = 24;

    constructor(appBar) {
        this._appBar = appBar;
        this._host = null;
        this._hostEl = null;
        /** @type {Map<string, {desc: ActionDescriptor, comp: BaseComponent, node: HTMLElement, iconKey: string}>} */
        this._rendered = new Map();
        this._overflow = null;
        this._disposers = new Set();
        this._warned = new Set();
        this._pinSubs = new Set();
        this._raf = 0;
        this._rendering = false;
        this._bornAt = 0;
    }

    init() {
        this._host = new Div({
            id: QuickActionsBar.HOST_ID,
            extraClasses: {
                base: "flex flex-row items-center gap-1 flex-shrink-0",
                // Only decorate once something is pinned (see _syncHostChrome).
                chrome: "",
                display: "",
            },
            extraProperties: {
                role: "toolbar",
                "aria-orientation": "horizontal",
                "aria-label": $.t('main.bar.quickActions'),
            },
        });
        this._host.attachTo(this._appBar.context);
        this._hostEl = document.getElementById(QuickActionsBar.HOST_ID);

        this._disposers.add(this._appBar.Actions.onChange(() => this._schedule()));
        this._bornAt = performance.now();
        this._render();
        this.onLayoutChange({ width: window.innerWidth });
        return this;
    }

    // ── Configuration ───────────────────────────────────────────────────────

    /**
     * Normalize a pin list. `trusted` (ENV only) keeps `icon`/`label` overrides;
     * everything else is reduced to ids, so a hostile session bundle cannot
     * relabel `core.sync.reset` as "Save" (or point `icon` at a remote URL,
     * which `componentIconNode` would happily load).
     * @param {*} raw array, JSON string (AppCache is a string store) or nullish
     * @param {boolean} trusted
     * @returns {Array<{id: string, icon?: string, label?: string}>}
     */
    static sanitizePins(raw, trusted = false) {
        let value = raw;
        if (typeof value === "string") {
            try { value = JSON.parse(value); } catch (e) { return []; }
        }
        if (!Array.isArray(value)) return [];

        const out = [];
        const seen = new Set();
        for (const entry of value) {
            if (out.length >= QuickActionsBar.MAX_PINS) break;
            let id, icon, label;
            if (typeof entry === "string") {
                id = entry;
            } else if (entry && typeof entry === "object") {
                id = entry.id;
                if (trusted) {
                    if (typeof entry.icon === "string") icon = entry.icon;
                    if (typeof entry.label === "string") label = entry.label;
                }
            }
            if (typeof id !== "string" || !id || seen.has(id)) continue;
            seen.add(id);
            out.push({ id, ...(icon ? { icon } : {}), ...(label ? { label } : {}) });
        }
        return out;
    }

    /**
     * Effective pin list. `getOption` resolves session params → AppCache →
     * `ENV.setup`, so a user override naturally shadows the deployment default
     * and an untouched deployment falls through to it. No caller default is
     * passed — the core precedence puts a caller literal last (AGENTS.md §3).
     * @returns {Array<{id: string, icon?: string, label?: string}>}
     */
    getPins() {
        const ac = window.APPLICATION_CONTEXT;
        const envRaw = ac?.defaultParams?.quickActions;
        const userRaw = ac?.getOption?.("quickActions", undefined, true, true);
        // Identity against ENV means nothing was overridden — keep the trusted form.
        const trusted = userRaw === envRaw;
        return QuickActionsBar.sanitizePins(userRaw ?? envRaw, trusted);
    }

    /** @returns {boolean} false when the operator froze the bar (ENV-only read). */
    isEditable() {
        return window.APPLICATION_CONTEXT?.defaultParams?.quickActionsUserEditable !== false;
    }

    /** @returns {number} */
    getMaxVisible() {
        const n = Number(window.APPLICATION_CONTEXT?.getOption?.("quickActionsMaxVisible"));
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
    }

    /** @param {string[]} ids catalogue keys */
    setPins(ids) {
        if (!this.isEditable()) {
            console.warn("AppBar.QuickActions: pinning is disabled by the deployment.");
            return false;
        }
        const clean = QuickActionsBar.sanitizePins(ids, false).map(e => e.id);
        window.APPLICATION_CONTEXT?.setOption?.("quickActions", clean);
        this._schedule();
        this._notifyPins();
        return true;
    }

    /**
     * Subscribe to pin-list writes. Distinct from `Actions.onChange` (which is
     * about *what exists*): this is about *what is pinned*, and the Settings
     * card needs both. Not coalesced — pin writes are user-driven and rare.
     * @param {function(): void} cb
     * @returns {function(): void} unsubscribe
     */
    onPinsChange(cb) {
        if (typeof cb !== "function") return () => {};
        this._pinSubs.add(cb);
        return () => this._pinSubs.delete(cb);
    }

    /** @private */
    _notifyPins() {
        for (const cb of [...this._pinSubs]) {
            try { cb(); } catch (e) { console.warn("AppBar.QuickActions: onPinsChange handler failed", e); }
        }
    }

    /** @param {string} key catalogue key */
    pin(key) {
        const ids = this.getPins().map(e => e.id);
        if (ids.includes(key)) return true;
        return this.setPins([...ids, key]);
    }

    /** @param {string} key catalogue key */
    unpin(key) {
        return this.setPins(this.getPins().map(e => e.id).filter(id => id !== key));
    }

    /** @param {string} key catalogue key */
    isPinned(key) {
        return this.getPins().some(e => e.id === key);
    }

    // ── Rendering ───────────────────────────────────────────────────────────

    /** @private */
    _schedule() {
        if (this._raf) return;
        const schedule = window.requestAnimationFrame || (fn => setTimeout(fn, 16));
        this._raf = schedule(() => { this._raf = 0; this._render(); });
    }

    /**
     * Key-diff reconcile. Never nuke-and-rebuild: a Dropdown portals its content
     * to `<body>` and holds a FloatingManager token that only `close()` releases,
     * and `Tools.setDisabled` fires from inside an action's own click handler.
     * @private
     */
    _render() {
        if (!this._hostEl || this._rendering) return;
        this._rendering = true;
        try {
            const catalogue = new Map(this._appBar.Actions.list().map(d => [d.key, d]));
            const pins = this.getPins();
            const resolved = [];
            for (const pin of pins) {
                const desc = catalogue.get(pin.id);
                if (!desc) { this._warnUnresolved(pin.id); continue; }
                if (desc.pinnable === false) continue;
                // Presentation overrides survive sanitization from the ENV tier only.
                resolved.push((pin.icon || pin.label)
                    ? { ...desc, ...(pin.icon ? { icon: pin.icon } : {}), ...(pin.label ? { label: pin.label } : {}) }
                    : desc);
            }

            const cap = this.getMaxVisible();
            const shown = resolved.length > cap ? resolved.slice(0, Math.max(0, cap - 1)) : resolved;
            const overflow = resolved.length > cap ? resolved.slice(Math.max(0, cap - 1)) : [];

            const shownKeys = new Set(shown.map(d => d.key));
            for (const [key, entry] of [...this._rendered]) {
                if (!shownKeys.has(key)) this._destroyEntry(key, entry);
            }

            shown.forEach((desc, index) => {
                let entry = this._rendered.get(desc.key);
                const iconKey = this._iconKey(desc);
                if (entry && entry.iconKey !== iconKey) {
                    this._destroyEntry(desc.key, entry);
                    entry = null;
                }
                if (!entry) {
                    entry = this._createEntry(desc, iconKey);
                    this._rendered.set(desc.key, entry);
                } else {
                    this._patchEntry(entry, desc);
                }
                const at = this._hostEl.children[index];
                if (at !== entry.node) this._hostEl.insertBefore(entry.node, at || null);
            });

            this._renderOverflow(overflow);
            this._syncHostChrome(shown.length + overflow.length);
        } finally {
            this._rendering = false;
        }
    }

    /** @private */
    _iconKey(desc) {
        return desc.icon instanceof BaseComponent ? `component:${desc.icon.id}` : String(desc.icon ?? "");
    }

    /** @private */
    _domIdFor(key) {
        return `quick-action-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
    }

    /**
     * Attributes are written straight onto the created node rather than through
     * van states: `setExtraProperty` throws for keys not declared at construction,
     * and `aria-pressed` must be *absent* (not `"false"`) on non-toggles.
     * @private
     */
    _createEntry(desc, iconKey) {
        let domId = this._domIdFor(desc.key);
        while (document.getElementById(domId)) domId += "_";

        const comp = new Button({
            id: domId,
            size: Button.SIZE.SMALL,
            // NB: `base` is reserved — Button's constructor overwrites it with "btn".
            extraClasses: { shape: "btn-ghost btn-square" },
            onClick: (ev) => this._appBar.Actions.invoke(desc.key, ev),
        }, componentIconNode(desc.icon) ?? new PhIcon(PLACEHOLDER_ICON));

        comp.attachTo(this._hostEl);
        const node = document.getElementById(domId);
        const entry = { desc: null, comp, node, iconKey };
        this._patchEntry(entry, desc);
        return entry;
    }

    /** @private */
    _patchEntry(entry, desc) {
        const node = entry.node;
        if (!node) { entry.desc = desc; return; }
        const prev = entry.desc;

        const label = textOf(desc.label, desc.rawId);
        const title = desc.kbd ? `${label} (${desc.kbd})` : (textOf(desc.hint) || label);
        if (!prev || prev.label !== desc.label || prev.kbd !== desc.kbd || prev.hint !== desc.hint) {
            node.setAttribute("title", title);
            node.setAttribute("aria-label", label);
            if (desc.kbd) node.setAttribute("aria-keyshortcuts", desc.kbd);
            else node.removeAttribute("aria-keyshortcuts");
        }

        if (!prev || prev.disabled !== desc.disabled) {
            // aria-disabled + a guard, not the native attribute: the control stays
            // focusable so its tooltip remains reachable (matches Dropdown rows).
            node.classList.toggle("btn-disabled", !!desc.disabled);
            node.classList.toggle("opacity-50", !!desc.disabled);
            node.setAttribute("aria-disabled", desc.disabled ? "true" : "false");
        }

        if (!prev || prev.selected !== desc.selected) {
            if (desc.selected === undefined) {
                node.removeAttribute("aria-pressed");
                node.classList.remove("btn-active");
            } else {
                node.setAttribute("aria-pressed", desc.selected ? "true" : "false");
                node.classList.toggle("btn-active", !!desc.selected);
            }
        }
        entry.desc = desc;
    }

    /** @private */
    _destroyEntry(key, entry) {
        try { entry.comp?.close?.(); } catch (e) { /* teardown */ }
        try { entry.comp?.remove?.(); } catch (e) { /* teardown */ }
        entry.node?.remove?.();
        this._rendered.delete(key);
    }

    /**
     * Static cap + one trailing menu. Deliberately NOT reactive to
     * `ToolbarSlot.onRoom`: collapsing widens the slot, which re-expands the bar,
     * which re-collapses it — the hysteresis in MainLayout would oscillate.
     * @private
     */
    _renderOverflow(overflow) {
        if (!overflow.length) {
            if (this._overflow) {
                try { this._overflow.close(); } catch (e) { /* teardown */ }
                this._overflow.remove();
                this._overflow = null;
            }
            return;
        }
        if (!this._overflow) {
            this._overflow = new Dropdown({
                id: "quick-actions-overflow",
                parentId: QuickActionsBar.HOST_ID,
                title: $.t('main.bar.quickActionsOverflow'),
                icon: "ph-dots-three",
                widthClass: "w-64",
            });
            this._overflow.attachTo(this._hostEl);
            this._overflow.iconOnly();
        }
        this._overflow.items = {};
        this._overflow.clear();
        for (const desc of overflow) {
            this._overflow.addItem({
                id: desc.key,
                // Dropdown rows resolve icons through `iconComponentFor`, which
                // only understands ph-*/fa-* classes (not URLs or components).
                icon: /^(ph|fa)[-\s]/.test(textOf(desc.icon)) ? desc.icon : PLACEHOLDER_ICON,
                label: textOf(desc.label, desc.rawId),
                title: textOf(desc.hint),
                kbd: textOf(desc.kbd),
                disabled: !!desc.disabled,
                selected: desc.selected,
                onClick: (ev) => this._appBar.Actions.invoke(desc.key, ev),
            });
        }
        // Keep the overflow trigger last in the strip.
        const root = document.getElementById(this._overflow.id);
        if (root && root.parentNode === this._hostEl) this._hostEl.appendChild(root);
    }

    /** @private */
    _syncHostChrome(count) {
        this._host?.setClass("chrome", count ? "border-l border-base-300/60 pl-1 ml-1" : "");
    }

    /** @private */
    _warnUnresolved(id) {
        // Actions register late (plugins, controllers); only complain once the
        // registration storm has settled, and only once per id.
        if (this._warned.has(id) || performance.now() - this._bornAt < 2000) return;
        this._warned.add(id);
        console.debug(`AppBar.QuickActions: pinned action "${id}" is not in the catalogue.`);
    }

    // ── Layout ──────────────────────────────────────────────────────────────

    /**
     * The 35px bar has no room for pins on phones; `MobileBottomBar` is the
     * right host there and can reuse the same catalogue.
     */
    onLayoutChange(details) {
        const width = details?.width ?? window.innerWidth;
        const max = this._appBar.maxMobileWidth;
        this._host?.setClass("display", max && width < max ? "hidden" : "");
    }

    dispose() {
        for (const off of this._disposers) {
            try { off(); } catch (e) { /* teardown */ }
        }
        this._disposers.clear();
        for (const [key, entry] of [...this._rendered]) this._destroyEntry(key, entry);
        this._renderOverflow([]);
        this._host?.remove();
        this._host = this._hostEl = null;
    }
}
