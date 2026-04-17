import van from "../../vanjs.mjs";
import { Button } from "../elements/buttons.mjs";
import { MainPanel } from "./mainPanel.mjs";
import { Menu } from "./menu.mjs";
import { Modal } from "./modal.mjs";
import { FullscreenMenuNavTab } from "./fullscreenMenuNavTab.mjs";

const { div } = van.tags;

/**
 * Modal-backed fullscreen menu built from existing menu primitives.
 * It keeps the service logic out of the component and reuses MainPanel/Menu styling.
 */
export class FullscreenMenuPanel extends MainPanel {
    constructor(options = undefined) {
        const normalizedOptions = options || {};

        const width = normalizedOptions.width || "min(1120px, 96vw)";
        const heightClass = normalizedOptions.heightClass || "h-[min(78vh,56rem)] min-h-[28rem]";
        const defaultOrientation = normalizedOptions.orientation || Menu.ORIENTATION.LEFT;
        const defaultDesign = normalizedOptions.design || Menu.DESIGN.TITLEICON;
        const defaultButtonSide = normalizedOptions.buttonSide || Menu.BUTTONSIDE.LEFT;
        const defaultRounded = normalizedOptions.rounded || Menu.ROUNDED.ENABLE;

        super({
            ...normalizedOptions,
            namespacedTabs: normalizedOptions.namespacedTabs !== false,
            namespaces: normalizedOptions.namespaces || Menu.DEFAULT_NAMESPACES,
            defaultNamespace: normalizedOptions.defaultNamespace || Menu.NAMESPACE.SYSTEM,
            orientation: Menu.ORIENTATION.LEFT,
            buttonSide: Menu.BUTTONSIDE.LEFT,
            rounded: Menu.ROUNDED.ENABLE,
            bodyScroll: Menu.SCROLL.ENABLE,
            extraClasses: {
                ...(normalizedOptions.extraClasses || {}),
                display: "flex",
                height: "h-full",
                gap: "gap-4",
                overflow: "overflow-hidden",
            }
        });

        this.width = width;
        this.heightClass = heightClass;
        this.defaultOrientation = defaultOrientation;
        this.defaultDesign = defaultDesign;
        this.defaultButtonSide = defaultButtonSide;
        this.defaultRounded = defaultRounded;
        this.headerTopPaddingClass = normalizedOptions.headerTopPaddingClass || "pt-3";
        this.closeButtonSide = normalizedOptions.closeButtonSide || Modal.CLOSE_BUTTON_SIDE.LEFT;
        this.namespaceLabelClass = normalizedOptions.namespaceLabelClass || `px-3 text-xs font-semibold uppercase tracking-[0.16em] text-base-content/50 ${this.headerTopPaddingClass}`;
        this.namespaceSeparatorClass = normalizedOptions.namespaceSeparatorClass || "my-2 border-t border-base-300/70";

        this.bodyRoot = div({
            class: `${this.heightClass} min-h-0 w-full min-w-0 bg-base-200`
        });

        this.modal = new Modal({
            id: `${this.id}-modal`,
            body: [this.bodyRoot],
            width: this.width,
            isBlocking: true,
            allowClose: true,
            allowResize: false,
            borderLess: true,
            closeButtonSide: this.closeButtonSide,
        });

        this._mountedMenu = false;
        this._created = false;

        this.header.setClass("closeButtonPadding", "mt-7 bg-base-100");
    }

    create() {
        if (!this._mountedMenu) {
            const menuRoot = super.create();
            if (menuRoot && !this.bodyRoot.contains(menuRoot)) {
                van.add(this.bodyRoot, menuRoot);
            }
            this._mountedMenu = true;
        }

        const root = this.modal.create();
        this._decorateModal(root);
        this._applyMenuDefaults();
        this._renderNamespacedHeader(root);
        this._created = true;
        return root;
    }

    _decorateModal(root) {
        const box = root?.querySelector?.(".modal-box");
        if (box) {
            box.style.maxWidth = "none";
            box.style.width = this.width;
        }

        const body = root?.querySelector?.(".modal-body");
        if (body) {
            body.classList.add("overflow-hidden", "bg-transparent", "p-0", "rounded-none");
        }
    }

    _renderNamespacedHeader(root = undefined) {
        if (!this.usesNamespacedTabs?.()) return;

        const header = this._resolveHeaderElement(root);
        if (!header) return;

        const buttonNodes = this._collectHeaderButtonNodes(header);
        if (!buttonNodes.length) return;

        const buttonsByTabId = new Map(buttonNodes.map(node => [node.dataset.menuTabId, node]));
        const orderedNamespaces = this.getNamespacesWithTabs?.() || [];
        const nodes = [];
        let firstNamespace = true;

        for (const namespace of orderedNamespaces) {
            const tabs = namespace.tabs?.filter(tab => buttonsByTabId.has(tab.id)) || [];
            if (!tabs.length) continue;

            if (!firstNamespace) {
                const separator = document.createElement("div");
                separator.className = this.namespaceSeparatorClass;
                separator.dataset.menuNamespaceSeparator = namespace.id;
                nodes.push(separator);
            }

            const label = document.createElement("div");
            label.className = this.namespaceLabelClass;
            label.dataset.menuNamespaceLabel = namespace.id;
            label.textContent = namespace.title || namespace.label || namespace.id;
            nodes.push(label);

            for (const tab of tabs) {
                const buttonNode = buttonsByTabId.get(tab.id);
                if (buttonNode) {
                    nodes.push(buttonNode);
                }
            }

            firstNamespace = false;
        }

        if (nodes.length) {
            header.replaceChildren(...nodes);
        }

        this._syncHeaderButtonOrientation();
    }

    _resolveHeaderElement(root = undefined) {
        if (!this.header?.id) return null;
        return root?.querySelector?.(`#${this.header.id}`) || document.getElementById(this.header.id);
    }

    _collectHeaderButtonNodes(header) {
        const tabOrder = Object.values(this.tabs).filter(tab => tab?.headerButton);
        const taggedButtons = Array.from(header.querySelectorAll?.("[data-menu-tab-id]") || []);
        const taggedIds = new Set(taggedButtons.map(node => node.dataset.menuTabId).filter(Boolean));
        const remainingTabs = tabOrder.filter(tab => !taggedIds.has(tab.id));
        let remainingIndex = 0;

        for (const child of Array.from(header.children)) {
            if (child.dataset?.menuNamespaceLabel || child.dataset?.menuNamespaceSeparator) {
                continue;
            }
            if (child.dataset?.menuTabId) {
                continue;
            }

            const tab = remainingTabs[remainingIndex++];
            if (!tab) continue;
            child.dataset.menuTabId = tab.id;
        }

        return Array.from(header.querySelectorAll?.("[data-menu-tab-id]") || []);
    }

    _applyMenuDefaults() {
        this.set(this.defaultOrientation, this.defaultButtonSide, this.defaultDesign, this.defaultRounded);
        this._syncHeaderButtonOrientation();
    }

    _syncHeaderButtonOrientation() {
        for (const tab of Object.values(this.tabs)) {
            if (!tab?.headerButton) continue;
            tab.headerButton.set(Button.ORIENTATION.HORIZONTAL);
            tab.headerButton.setClass("fullscreenMenuButtonWidth", "justify-start");
        }
    }

    _ensureSingleOpen(id) {
        for (const [tabId, tab] of Object.entries(this.tabs)) {
            if (tabId === id) continue;
            tab._removeFocus?.();
        }

        const tab = this.getTab(id);
        if (!tab) return false;
        tab._setFocus?.();
        this._focused = id;
        return true;
    }

    addTab(item, componentId = undefined) {
        const normalized = {
            namespace: item.namespace || this.defaultNamespace || Menu.NAMESPACE.SYSTEM,
            ...item,
            class: item.class && item.class !== Menu ? item.class : undefined,
        };

        if (!normalized.class) {
            normalized.class = FullscreenMenuNavTab;
        }

        const tab = super.addTab(normalized, componentId);
        tab.close?.();
        this._syncHeaderButtonOrientation();
        if (this._mountedMenu) {
            this._renderNamespacedHeader();
        }

        if (!this._focused) {
            this._ensureSingleOpen(normalized.id);
        }
        return tab;
    }

    deleteTab(id) {
        super.deleteTab(id);
        if (this._mountedMenu) {
            this._renderNamespacedHeader();
        }
        return this;
    }

    setOrientation(orientation) {
        this.set(orientation);
        this._syncHeaderButtonOrientation();
        return this;
    }

    focus(id) {
        this.create();
        if (!this.getTab(id)) return false;
        this._ensureSingleOpen(id);
        this.open();
        return true;
    }

    open() {
        this.create();
        this.modal.open();
        return this;
    }

    close() {
        this.modal.close();
        return this;
    }
}
