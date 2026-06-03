import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { Modal } from "./modal.mjs";

const { div, i: iTag } = van.tags;

/**
 * Two-pane illustrated modal.
 *
 * Wraps a {@link Modal} with a left content column and a right "hero" pane that
 * holds a centred illustration on a tinted, theme-aware background with soft
 * decorative circles. Reused by {@link TutorialsModal} and {@link LoginModal};
 * other callers can opt in by passing their own header/body/footer/illustration.
 *
 * Right pane collapses on small screens (< md), so the content column always
 * remains usable. Theme tokens (`bg-accent`, `text-accent`, …) inherit the
 * active DaisyUI theme.
 *
 * @example
 * const modal = new IllustratedModal({
 *     header: "Sign in",
 *     body: myFormNode,
 *     footer: actionsNode,
 *     accent: "accent",
 *     illustrationIcon: "ph-laptop",
 * });
 * modal.mount(document.body).open();
 */
// Literal class palettes per accent name. Tailwind JIT scans source files for
// complete class strings, so any class returned here MUST appear verbatim in
// this source file — do not build the names via string interpolation.
const ACCENT_PALETTES = {
    accent: {
        pane: "bg-accent/10",
        circleA: "bg-accent/20",
        circleB: "bg-accent/15",
        circleC: "bg-accent/10",
        icon: "text-accent",
    },
    primary: {
        pane: "bg-primary/10",
        circleA: "bg-primary/20",
        circleB: "bg-primary/15",
        circleC: "bg-primary/10",
        icon: "text-primary",
    },
    secondary: {
        pane: "bg-secondary/10",
        circleA: "bg-secondary/20",
        circleB: "bg-secondary/15",
        circleC: "bg-secondary/10",
        icon: "text-secondary",
    },
    success: {
        pane: "bg-success/10",
        circleA: "bg-success/20",
        circleB: "bg-success/15",
        circleC: "bg-success/10",
        icon: "text-success",
    },
    info: {
        pane: "bg-info/10",
        circleA: "bg-info/20",
        circleB: "bg-info/15",
        circleC: "bg-info/10",
        icon: "text-info",
    },
};

export class IllustratedModal extends BaseComponent {
    constructor(options = {}) {
        super(options);
        this.options = options;
        this.palette = ACCENT_PALETTES[options.accent] || ACCENT_PALETTES.accent;
        this.width = options.width || "min(960px, 94vw)";
        this.onCloseCb = typeof options.onClose === "function" ? options.onClose : null;

        this._headerSlot = div({ class: "min-h-0" });
        this._bodySlot = div({ class: "flex-1 min-h-0 flex flex-col gap-3" });
        this._footerSlot = div({ class: "pt-2" });
        this._illustrationSlot = div({ class: "relative z-10 flex items-center justify-center" });

        this._created = false;
        this.setHeader(options.header);
        this.setBody(options.body);
        this.setFooter(options.footer);
        this.setIllustration(options.illustration, options.illustrationIcon);
    }

    create() {
        if (this._created) return this.modal.root;

        const palette = this.palette;
        const leftPane = div(
            { class: "flex flex-col gap-4 p-8 md:p-10 min-h-[420px]" },
            this._headerSlot,
            this._bodySlot,
            this._footerSlot,
        );

        // Right pane: decorative circles + centred illustration slot.
        // The pane is purely cosmetic on < md and is hidden to give content room.
        const rightPane = div(
            {
                class: `relative hidden md:flex overflow-hidden rounded-r-2xl ${palette.pane}`,
            },
            div({ class: `absolute -top-24 -left-20 w-72 h-72 rounded-full ${palette.circleA}` }),
            div({ class: `absolute top-1/2 -right-24 w-96 h-96 rounded-full ${palette.circleB}` }),
            div({ class: `absolute -bottom-28 left-1/3 w-80 h-80 rounded-full ${palette.circleC}` }),
            div(
                { class: "relative w-full h-full flex items-center justify-center p-8" },
                this._illustrationSlot,
            ),
        );

        const grid = div(
            { class: "grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] rounded-2xl overflow-hidden" },
            leftPane,
            rightPane,
        );

        this.modal = new Modal({
            id: this.options.id,
            body: grid,
            width: this.width,
            isBlocking: this.options.isBlocking ?? false,
            allowClose: this.options.allowClose ?? true,
            allowResize: false,
            borderLess: true,
        });

        this.modal.create();

        if (this.onCloseCb) {
            const baseClose = this.modal.close.bind(this.modal);
            this.modal.close = (...args) => {
                const wasOpen = this.modal.isOpen;
                const result = baseClose(...args);
                if (wasOpen) this.onCloseCb();
                return result;
            };
        }

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

    setHeader(content) {
        IllustratedModal._replaceSlot(this._headerSlot, content);
    }

    setBody(content) {
        IllustratedModal._replaceSlot(this._bodySlot, content);
    }

    setFooter(content) {
        IllustratedModal._replaceSlot(this._footerSlot, content);
    }

    /**
     * @param {Node|string|null} illustration - custom element, or null/undefined to use the default icon.
     * @param {string} [iconClass] - Phosphor icon class (e.g. "ph-laptop") used when no custom illustration is given.
     */
    setIllustration(illustration, iconClass) {
        if (illustration) {
            IllustratedModal._replaceSlot(this._illustrationSlot, illustration);
            return;
        }
        const cls = iconClass || "ph-graduation-cap";
        const icon = iTag({
            class: `ph-light ${cls} ${this.palette.icon}`,
            style: "font-size: 12rem; line-height: 1; filter: drop-shadow(0 12px 24px rgba(0,0,0,0.12));",
        });
        IllustratedModal._replaceSlot(this._illustrationSlot, icon);
    }

    static _replaceSlot(slot, content) {
        slot.replaceChildren();
        if (content === null || content === undefined) return;
        if (typeof content === "string") {
            slot.append(content);
        } else if (Array.isArray(content)) {
            slot.append(...content.filter(Boolean));
        } else {
            slot.append(content);
        }
    }
}
