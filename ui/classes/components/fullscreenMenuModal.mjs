import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div, button, span } = van.tags;

/**
 * A BaseComponent-driven fullscreen modal shell with a left-side navigation rail
 * and a single active content panel.
 */
export class FullscreenMenuModal extends BaseComponent {
    constructor(options = undefined) {
        options = super(options).options;

        this.items = {};
        this.order = [];
        this.activeId = options.defaultActiveId || null;
        this.isOpen = false;
        this.hideBodyScroll = options.hideBodyScroll !== false;
        this.closeOnBackdrop = options.closeOnBackdrop !== false;
        this.title = options.title || "Menu";
        this.defaultNamespace = options.defaultNamespace || FullscreenMenuModal.NAMESPACE.SYSTEM;
        this.namespaceDefinitions = {};
        this.namespaceOrder = [];

        for (const namespace of (Array.isArray(options.namespaces) && options.namespaces.length ? options.namespaces : FullscreenMenuModal.DEFAULT_NAMESPACES)) {
            this.registerNamespace(namespace);
        }

        this.root = null;
        this.refs = {};
        this._escapeHandler = (event) => {
            if (event.key === "Escape" && this.isOpen) {
                this.close();
            }
        };
    }

    create() {
        if (this.root) return this.root;

        const backdrop = div({
            class: "absolute inset-0 bg-base-content/45 backdrop-blur-sm",
            onclick: (event) => {
                if (event.target === backdrop && this.closeOnBackdrop) {
                    this.close();
                }
            }
        });

        this.refs.closeButton = button({
            type: "button",
            class: "btn btn-ghost btn-sm btn-circle absolute right-4 top-4 z-10",
            onclick: () => this.close(),
            "aria-label": "Close"
        }, "✕");

        this.refs.nav = div({
            class: "flex w-full shrink-0 flex-col gap-1 overflow-y-auto border-b border-base-300 bg-base-200/70 p-3 md:w-64 md:border-b-0 md:border-r"
        });

        this.refs.headerTitle = span({ class: "text-2xl font-semibold leading-tight" }, this.title);
        this.refs.header = div({ class: "flex items-start gap-3 border-b border-base-300 px-6 py-5 pr-14" }, this.refs.headerTitle);
        this.refs.body = div({ class: "min-h-0 flex-1 overflow-y-auto px-6 py-5" });

        const shell = div({
                class: "relative flex h-[min(90vh,52rem)] w-[min(96vw,78rem)] flex-col overflow-hidden rounded-3xl border border-base-300 bg-base-100 shadow-2xl md:flex-row"
            },
            this.refs.closeButton,
            this.refs.nav,
            div({ class: "flex min-w-0 flex-1 flex-col" }, this.refs.header, this.refs.body)
        );

        this.root = div({
                id: this.id,
                class: `fixed inset-0 z-[1000] ${this.isOpen ? "" : "hidden"}`
            },
            backdrop,
            div({ class: "relative flex h-full w-full items-center justify-center p-3 md:p-6" }, shell)
        );

        document.addEventListener("keydown", this._escapeHandler);
        this._renderNav();
        if (this.activeId && this.items[this.activeId]) {
            this._renderActive();
        }
        return this.root;
    }

    registerNamespace(namespace) {
        const normalized = this._normalizeNamespaceDefinition(namespace);
        const existing = this.namespaceDefinitions[normalized.id] || {};

        this.namespaceDefinitions[normalized.id] = {
            ...existing,
            ...normalized,
            order: normalized.order ?? existing.order ?? ((this.namespaceOrder.length + 1) * 10),
        };

        if (!this.namespaceOrder.includes(normalized.id)) {
            this.namespaceOrder.push(normalized.id);
        }

        this.namespaceOrder.sort((left, right) => {
            const leftOrder = this.namespaceDefinitions[left]?.order ?? 0;
            const rightOrder = this.namespaceDefinitions[right]?.order ?? 0;
            if (leftOrder === rightOrder) {
                return left.localeCompare(right);
            }
            return leftOrder - rightOrder;
        });

        return this.namespaceDefinitions[normalized.id];
    }

    _normalizeNamespaceId(namespace) {
        if (namespace && typeof namespace === "object") {
            namespace = namespace.id;
        }

        return `${namespace || this.defaultNamespace || FullscreenMenuModal.NAMESPACE.PLUGINS}`;
    }

    _namespaceTitle(namespaceId) {
        return `${namespaceId}`
            .split(/[._-]/g)
            .filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
    }

    _normalizeNamespaceDefinition(namespace) {
        const id = this._normalizeNamespaceId(namespace);
        if (typeof namespace === "string" || namespace == null) {
            return { id, title: this._namespaceTitle(id) };
        }

        return {
            ...namespace,
            id,
            title: namespace.title || namespace.label || this._namespaceTitle(id),
        };
    }

    _orderedNamespacesWithItems() {
        return this.namespaceOrder
            .map(namespaceId => ({
                ...(this.namespaceDefinitions[namespaceId] || { id: namespaceId, title: this._namespaceTitle(namespaceId) }),
                items: this.order
                    .map(id => this.items[id])
                    .filter(item => item && !item.navHidden && item.namespace === namespaceId),
            }))
            .filter(namespace => namespace.items.length > 0);
    }

    destroy() {
        document.removeEventListener("keydown", this._escapeHandler);
        this.root?.remove();
        this.root = null;
    }

    has(id) {
        return !!this.items[id];
    }

    addItem(item) {
        if (!item?.id) {
            throw new Error("FullscreenMenuModal.addItem() requires an item with an id.");
        }

        const normalized = {
            id: item.id,
            title: item.title || item.label || item.id,
            label: item.label || item.title || item.id,
            icon: item.icon || "fa-circle",
            body: item.body,
            onBeforeFocus: item.onBeforeFocus,
            navHidden: Boolean(item.navHidden),
            pluginRootClass: item.pluginRootClass || "",
            namespace: this._normalizeNamespaceId(item.namespace)
        };

        this.registerNamespace(item.namespace || normalized.namespace);
        this.items[normalized.id] = normalized;
        if (!this.order.includes(normalized.id)) {
            this.order.push(normalized.id);
        }

        if (!this.activeId && !normalized.navHidden) {
            this.activeId = normalized.id;
        }

        if (this.root) {
            this._renderNav();
            if (this.activeId === normalized.id) {
                this._renderActive();
            }
        }

        return normalized;
    }

    focus(id) {
        if (!this.items[id]) return false;
        this.activeId = id;
        this.open();
        this._renderActive();
        this._syncNavState();
        return true;
    }

    open() {
        this.create();
        this.isOpen = true;
        this.root.classList.remove("hidden");
        if (this.hideBodyScroll) {
            document.body.classList.add("overflow-hidden");
        }
        if (this.activeId && this.items[this.activeId]) {
            this._renderActive();
            this._syncNavState();
        }
        return this;
    }

    close() {
        this.isOpen = false;
        this.root?.classList.add("hidden");
        if (this.hideBodyScroll) {
            document.body.classList.remove("overflow-hidden");
        }
        return this;
    }

    unfocusAll() {
        return this.close();
    }

    _renderNav() {
        if (!this.refs.nav) return;
        this.refs.nav.replaceChildren();

        let firstNamespace = true;
        for (const namespace of this._orderedNamespacesWithItems()) {
            if (!firstNamespace) {
                this.refs.nav.appendChild(div({ class: "my-2 border-t border-base-300/70" }));
            }

            this.refs.nav.appendChild(div({ class: "px-3 pt-3 text-xs font-semibold uppercase tracking-[0.16em] text-base-content/50" }, namespace.title || namespace.label || namespace.id));

            for (const item of namespace.items) {
                const icon = span({
                    class: `fa-auto ${item.icon} text-sm opacity-80`
                });

                const label = span({ class: "truncate text-sm font-medium" }, item.label);
                const navButton = button({
                        type: "button",
                        class: this._navButtonClass(item.id === this.activeId),
                        onclick: () => this.focus(item.id)
                    },
                    icon,
                    label
                );

                navButton.dataset.menuId = item.id;
                this.refs.nav.appendChild(navButton);
            }

            firstNamespace = false;
        }
    }

    _renderActive() {
        if (!this.refs.body || !this.activeId || !this.items[this.activeId]) return;

        const item = this.items[this.activeId];
        item.onBeforeFocus?.(item, this);

        this.refs.headerTitle.textContent = item.title || item.label || item.id;
        this.refs.body.replaceChildren();

        for (const node of this._resolveNodes(typeof item.body === "function" ? item.body(item, this) : item.body)) {
            if (node) this.refs.body.appendChild(node);
        }
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

    _syncNavState() {
        if (!this.refs.nav) return;
        for (const child of this.refs.nav.children) {
            const isActive = child.dataset.menuId === this.activeId;
            child.className = this._navButtonClass(isActive);
        }
    }

    _navButtonClass(isActive) {
        return [
            "btn",
            "btn-ghost",
            "justify-start",
            "rounded-2xl",
            "border",
            "gap-3",
            "px-4",
            "normal-case",
            "shadow-none",
            "transition-colors",
            "w-full",
            isActive ? "border-base-300 bg-base-100 text-base-content" : "border-transparent bg-transparent text-base-content/80 hover:border-base-300 hover:bg-base-100/70"
        ].join(" ");
    }
}


FullscreenMenuModal.NAMESPACE = {
    SYSTEM: "system",
    PLUGINS: "plugins",
};

FullscreenMenuModal.DEFAULT_NAMESPACES = [
    { id: FullscreenMenuModal.NAMESPACE.SYSTEM, title: "System", order: 10 },
    { id: FullscreenMenuModal.NAMESPACE.PLUGINS, title: "Plugins", order: 20 },
];
