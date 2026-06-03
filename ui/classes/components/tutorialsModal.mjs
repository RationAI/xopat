import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { IllustratedModal } from "./illustratedModal.mjs";

const { div, p, button, i: iTag, span } = van.tags;

/**
 * Tutorial selection screen.
 *
 * Owns an {@link IllustratedModal}: left pane carries the title/description and
 * a reactive grid of DaisyUI tutorial cards, right pane shows a themed
 * illustration. Clicking a card invokes `onSelect(index)`. Title/description
 * and entries are Van.js-state-driven so updates after mount stay cheap.
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
        this._exitLabelState = van.state(this.exitLabel);
        this._entries = [];
        this._grid = null;
        this._created = false;
    }

    create() {
        if (this._created) return this._illustrated.modal.root;

        const header = div({ class: "text-2xl font-light" }, this._titleState);

        this._grid = div({
            id: "tutorials",
            class: "grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[50vh] overflow-y-auto pr-1"
        });

        const body = [
            p({ class: "text-sm opacity-70" }, this._descriptionState),
            this._grid,
        ];

        const footer = div(
            { class: "flex justify-end" },
            button(
                { class: "btn btn-primary", onclick: () => this._handleExit() },
                this._exitLabelState,
            ),
        );

        this._illustrated = new IllustratedModal({
            id: "tutorials-modal",
            header,
            body,
            footer,
            accent: "accent",
            illustrationIcon: "ph-graduation-cap",
            width: "min(960px, 94vw)",
            isBlocking: false,
            allowClose: true,
            onClose: () => this.onClose?.(),
        });

        this._illustrated.create();
        if (this._illustrated.modal.root && !this._illustrated.modal.root.id) {
            this._illustrated.modal.root.id = "tutorials-modal";
        }

        this._renderEntries();
        this._created = true;
        return this._illustrated.modal.root;
    }

    mount(parent = document.body) {
        this.create();
        this._illustrated.mount(parent);
        return this;
    }

    open() {
        this.create();
        this._illustrated.open();
        return this;
    }

    close() {
        this._illustrated?.close();
        return this;
    }

    get isOpen() {
        return !!this._illustrated?.isOpen;
    }

    /** @deprecated Kept for legacy callers that reached into `.modal`. */
    get modal() {
        return this._illustrated?.modal;
    }

    setTitle(text) {
        this._titleState.val = text || "";
    }

    setDescription(text) {
        this._descriptionState.val = text || "";
    }

    setExitLabel(text) {
        this.exitLabel = text || "Exit";
        this._exitLabelState.val = this.exitLabel;
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
