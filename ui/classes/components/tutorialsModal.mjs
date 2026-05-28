import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { Modal } from "./modal.mjs";

const { div, p, button, i: iTag, span } = van.tags;

/**
 * Tutorial selection screen.
 *
 * Owns a {@link Modal} populated with a reactive grid of DaisyUI cards.
 * Each card represents one registered tutorial; clicking it invokes
 * `onSelect(index)`. The list and header text are driven by Van.js state
 * so calls to {@link setEntries}, {@link setTitle}, and {@link setDescription}
 * after mount cheaply update only what changed.
 */
export class TutorialsModal extends BaseComponent {
    constructor(options = {}) {
        super(options);
        this.options = options;
        this.onSelect = typeof options.onSelect === "function" ? options.onSelect : () => {};
        this.onExit = typeof options.onExit === "function" ? options.onExit : null;
        this.onClose = typeof options.onClose === "function" ? options.onClose : null;
        this.exitLabel = options.exitLabel || "Exit";

        this._titleState = van.state(options.title || "");
        this._descriptionState = van.state(options.description || "");
        this._entries = [];
        this._grid = null;
        this._created = false;
    }

    create() {
        if (this._created) return this.modal.root;

        const header = div({ class: "text-2xl font-light text-center" }, this._titleState);

        this._grid = div({
            id: "tutorials",
            class: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[50vh] overflow-y-auto p-1"
        });

        const body = div(
            { class: "flex flex-col gap-3" },
            p({ class: "text-center text-sm opacity-70" }, this._descriptionState),
            this._grid
        );

        const footer = button({
                class: "btn btn-primary",
                onclick: () => this._handleExit()
            },
            this.exitLabel
        );

        this.modal = new Modal({
            id: "tutorials-modal",
            header,
            body,
            footer,
            width: "min(880px, 92vw)",
            isBlocking: false,
            allowClose: true,
            allowResize: false,
            borderLess: false,
        });

        this.modal.create();
        if (this.modal.root && !this.modal.root.id) {
            this.modal.root.id = "tutorials-modal";
        }

        const baseClose = this.modal.close.bind(this.modal);
        this.modal.close = (...args) => {
            const wasOpen = this.modal.isOpen;
            const result = baseClose(...args);
            if (wasOpen) this.onClose?.();
            return result;
        };

        this._renderEntries();
        this._created = true;
        return this.modal.root;
    }

    mount(parent = document.body) {
        this.create();
        this.modal.mount(parent);
        return this;
    }

    open() {
        this.create();
        if (!this.modal.root.parentNode) {
            document.body.appendChild(this.modal.root);
        }
        this.modal.open();
        return this;
    }

    close() {
        this.modal?.close();
        return this;
    }

    get isOpen() {
        return !!this.modal?.isOpen;
    }

    setTitle(text) {
        this._titleState.val = text || "";
    }

    setDescription(text) {
        this._descriptionState.val = text || "";
    }

    setExitLabel(text) {
        this.exitLabel = text || "Exit";
    }

    /**
     * Replace the rendered tutorials list.
     * @param {Array<{name:string, description:string, icon:string, pluginName?:string, pluginRootClass?:string}>} entries
     */
    setEntries(entries) {
        this._entries = Array.isArray(entries) ? entries.slice() : [];
        this._renderEntries();
    }

    _renderEntries() {
        if (!this._grid) return;
        this._grid.replaceChildren();

        this._entries.forEach((entry, index) => {
            this._grid.appendChild(this._renderCard(entry, index));
        });
    }

    _renderCard(entry, index) {
        const iconClass = entry.icon || "ph-graduation-cap";
        const pluginRootClass = entry.pluginRootClass || "";

        const children = [];

        if (entry.pluginName) {
            children.push(span({
                class: "badge badge-sm badge-ghost absolute top-2 right-2"
            }, entry.pluginName));
        }

        const _isPh = String(iconClass ?? '').trim().startsWith('ph-');
        children.push(iTag({ class: `${_isPh ? 'ph-light' : 'fa-auto'} ${iconClass} text-3xl my-2 text-primary` }));
        children.push(div({ class: "card-title text-lg font-light justify-center" }, entry.name || ""));
        if (entry.description) {
            children.push(p({ class: "text-sm opacity-80" }, entry.description));
        }

        return div(
            {
                class: `card card-compact bg-base-200 hover:bg-base-300 cursor-pointer transition-transform hover:scale-[1.02] relative ${pluginRootClass}`.trim(),
                onclick: () => this.onSelect(index)
            },
            div({ class: "card-body items-center text-center gap-1" }, ...children)
        );
    }

    _handleExit() {
        if (this.onExit) {
            this.onExit();
        } else {
            this.close();
        }
    }
}
