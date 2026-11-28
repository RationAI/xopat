import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { Modal } from "./modal.mjs";

const { div, p, button, i: iTag, span } = van.tags;

// One-time stylesheet for hover/focus/transition rules, tinted surfaces and
// shadows only — pseudo-classes and arbitrary values are not in the purged
// tailwind.min.css. Static layout/typography stays on DaisyUI/Tailwind
// classes in the markup. Every colour is a
// DaisyUI token (`--b1/--b2/--bc/--p/--a`), so the same rules read correctly
// in any light or dark deployment theme; no literal white/black surfaces.
if (typeof document !== "undefined" && !document.getElementById("__xopat_tutorials_modal_css")) {
    const style = document.createElement("style");
    style.id = "__xopat_tutorials_modal_css";
    style.textContent = `
        .xopat-tutorials-shell {
            background-image:
                radial-gradient(120% 90% at 0% 0%, oklch(var(--p) / 0.14), transparent 55%),
                radial-gradient(90% 80% at 100% 100%, oklch(var(--a) / 0.12), transparent 60%);
            border: 1px solid oklch(var(--bc) / 0.10);
            box-shadow: 0 24px 60px oklch(0 0 0 / 0.35);
        }
        .xopat-tutorial-card {
            outline: none;
            background: oklch(var(--b2) / 0.72);
            border: 1px solid oklch(var(--bc) / 0.12);
            transition: transform 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease, border-color 0.18s ease;
            box-shadow: 0 2px 8px oklch(0 0 0 / 0.08);
        }
        .xopat-tutorial-card:hover,
        .xopat-tutorial-card:focus-visible {
            transform: translateY(-2px);
            background: oklch(var(--b2));
            border-color: oklch(var(--p) / 0.55);
            box-shadow: 0 14px 32px oklch(0 0 0 / 0.20);
        }
        .xopat-tutorial-card:focus-visible { box-shadow: 0 0 0 2px oklch(var(--p) / 0.75), 0 14px 32px oklch(0 0 0 / 0.20); }
        .xopat-tutorial-card__accent {
            position: absolute;
            top: 0; left: 0; right: 0; height: 3px;
            background: linear-gradient(90deg, oklch(var(--p)), oklch(var(--a)));
            opacity: 0;
            transition: opacity 0.18s ease;
        }
        .xopat-tutorial-card:hover .xopat-tutorial-card__accent,
        .xopat-tutorial-card:focus-visible .xopat-tutorial-card__accent { opacity: 1; }
        .xopat-tutorial-card__icon {
            width: 3rem;   /* w-12/h-12 are purged from tailwind.min.css */
            height: 3rem;
            background: oklch(var(--p) / 0.14);
            transition: background-color 0.18s ease;
        }
        .xopat-tutorial-card:hover .xopat-tutorial-card__icon,
        .xopat-tutorial-card:focus-visible .xopat-tutorial-card__icon { background: oklch(var(--p) / 0.22); }
        .xopat-tutorial-close {
            position: absolute;
            top: 0.875rem;
            right: 0.875rem;
            width: 2rem;
            height: 2rem;
            border-radius: 9999px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            color: oklch(var(--bc) / 0.8);
            background: oklch(var(--bc) / 0.06);
            border: 1px solid oklch(var(--bc) / 0.14);
            transition: background-color 0.15s ease, color 0.15s ease;
            z-index: 5;
        }
        .xopat-tutorial-close:hover,
        .xopat-tutorial-close:focus-visible { color: oklch(var(--bc)); background: oklch(var(--bc) / 0.14); outline: none; }
    `;
    document.head.appendChild(style);
}

/**
 * Tutorial selection screen.
 *
 * Renders the registered tutorials as a responsive card grid that fills the
 * whole modal width. The shell and cards are painted from DaisyUI theme
 * tokens only (base surfaces, base-content text, primary/accent tints), so
 * contrast holds in every light and dark deployment theme. Cards are
 * keyboard-focusable (Enter/Space selects). Clicking a card invokes
 * `onSelect(index)`; title/description and
 * entries are van.js-state driven so updates after mount stay cheap.
 *
 * Previously this component delegated to `IllustratedModal` (left text pane,
 * right illustration pane), which made sense when only one or two tutorials
 * existed. Now that the launcher is the system-wide tutorial selector and
 * the entry count grows with plugins, the illustration was dead weight — the
 * whole modal is dedicated to the card grid.
 */
export class TutorialsModal extends BaseComponent {
    constructor(options = {}) {
        super(options);
        this.options = options;
        this.onSelect = typeof options.onSelect === "function" ? options.onSelect : () => {};
        this.onExit = typeof options.onExit === "function" ? options.onExit : null;
        this.onClose = typeof options.onClose === "function" ? options.onClose : null;
        this.exitLabel = options.exitLabel || $.t("common.Exit");

        this._titleState = van.state(options.title || "");
        this._descriptionState = van.state(options.description || "");
        this._exitLabelState = van.state(this.exitLabel);
        this._entries = [];
        this._grid = null;
        this._created = false;
    }

    create() {
        if (this._created) return this.modal.root;

        // The shell is a theme surface (base-100) tinted by soft primary /
        // accent radial glows — all DaisyUI tokens, so it reads in light and
        // dark alike. The earlier pastel-multiply backdrop with literal-white
        // decorative circles turned into grey blobs on dark themes, one of
        // them sitting on top of the description copy.
        const header = div(
            {
                style: "position: relative; z-index: 2; display: flex; flex-direction: column; gap: 0.5rem;"
                     + " padding: 1.75rem 4rem 0.25rem 1.875rem;",
            },
            div(
                {
                    style: "font-size: 1.625rem; font-weight: 500; letter-spacing: -0.015em; line-height: 1.25; color: oklch(var(--bc));",
                },
                this._titleState,
            ),
            div({ style: "width: 2.5rem; height: 3px; border-radius: 9999px; background: linear-gradient(90deg, oklch(var(--p)), oklch(var(--a)));" }),
            p(
                {
                    style: "margin: 0.375rem 0 0; font-size: 0.875rem; line-height: 1.5; color: oklch(var(--bc) / 0.72);",
                },
                this._descriptionState,
            ),
        );

        this._grid = div({
            id: "tutorials",
            class: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto",
            style: "position: relative; z-index: 2; padding: 1.25rem 1.875rem 0.75rem; max-height: 55vh;",
        });

        // Mobile notice — rendered in place of the card grid when the
        // launcher decides tutorials shouldn't run at the current viewport
        // width. Hidden by default; toggled by setMobileNotice() /
        // clearMobileNotice().
        this._mobileNotice = div({
            style: "display: none; position: relative; z-index: 2;"
                 + " padding: 1.5rem 1.875rem 1.25rem;"
                 + " color: oklch(var(--bc)); opacity: 0.86; line-height: 1.55;"
                 + " font-size: 0.95rem; text-align: center;",
        });

        // Custom close button positioned over the shell corner.
        const closeButton = div(
            {
                role: "button",
                tabindex: "0",
                class: "xopat-tutorial-close",
                title: $.t("common.Close"),
                "aria-label": $.t("common.Close"),
                onclick: () => this._handleExit(),
                onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._handleExit(); } },
            },
            iTag({ class: "ph-light ph-x", style: "font-size: 1rem;" }),
        );

        const footer = div(
            {
                style: "position: relative; z-index: 2; display: flex; justify-content: flex-end;"
                     + " padding: 0.75rem 1.875rem 1.25rem;",
            },
            button(
                {
                    type: "button",
                    class: "btn btn-sm btn-ghost rounded-full",
                    style: "padding: 0 1.25rem;",
                    onclick: () => this._handleExit(),
                },
                this._exitLabelState,
            ),
        );

        // `options.gradient` (optional) layers a caller-supplied backdrop
        // over the themed surface; callers own its contrast.
        const shell = div(
            {
                class: "xopat-tutorials-shell relative rounded-2xl overflow-hidden bg-base-100 text-base-content",
                style: this.options.gradient ? `background-image: ${this.options.gradient};` : "",
            },
            header,
            this._grid,
            this._mobileNotice,
            footer,
            closeButton,
        );

        this.modal = new Modal({
            id: this.options.id || "tutorials-modal",
            body: shell,
            width: this.options.width || "min(960px, 94vw)",
            isBlocking: this.options.isBlocking ?? false,
            allowClose: false, // we render a custom glass X
            allowResize: false,
            borderLess: true,
        });

        this.modal.create();

        // The DaisyUI modal-box wrapper (and our own modal-body wrapper) both
        // paint a base-100 background, which shows as white corners around our
        // rounded gradient shell. Make them transparent so only the shell
        // surface is visible.
        const stripBg = (selector) => {
            const el = this.modal.root?.querySelector(selector);
            if (!el) return;
            el.style.background = "transparent";
            el.style.backgroundColor = "transparent";
            el.style.boxShadow = "none";
        };
        stripBg(".modal-box");
        stripBg(".modal-body");
        // Drop the rounded-lg on modal-body too so it doesn't fight our shell radius.
        const body = this.modal.root?.querySelector(".modal-body");
        body?.classList.remove("rounded-lg", "bg-base-100");

        if (this.modal.root && !this.modal.root.id) {
            this.modal.root.id = "tutorials-modal";
        }

        if (this.onClose) {
            const baseClose = this.modal.close.bind(this.modal);
            this.modal.close = (...args) => {
                const wasOpen = this.modal.isOpen;
                const result = baseClose(...args);
                if (wasOpen) this.onClose?.();
                return result;
            };
        }

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
        this.exitLabel = text || $.t("common.Exit");
        this._exitLabelState.val = this.exitLabel;
    }

    /**
     * Replace the card grid with an info notice. Used by
     * `USER_INTERFACE.Tutorials.show()` to explain why no tutorials can be
     * launched at mobile widths instead of opening an empty / non-functional
     * launcher.
     * @param {string} text plain-text notice copy.
     */
    setMobileNotice(text) {
        this.create();
        if (!this._mobileNotice) return;
        this._mobileNotice.textContent = String(text ?? "");
        this._mobileNotice.style.display = "block";
        if (this._grid) this._grid.style.display = "none";
    }

    /** Re-show the card grid hidden by `setMobileNotice`. */
    clearMobileNotice() {
        if (this._mobileNotice) {
            this._mobileNotice.style.display = "none";
            this._mobileNotice.replaceChildren();
        }
        if (this._grid) this._grid.style.display = "grid";
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
        const iconClass = entry.icon || "ph-compass";
        const pluginRootClass = entry.pluginRootClass || "";

        const select = () => this.onSelect(index);

        return div(
            {
                class: `xopat-tutorial-card relative flex flex-col items-center text-center gap-1 rounded-xl cursor-pointer overflow-hidden ${pluginRootClass}`.trim(),
                role: "button",
                tabindex: "0",
                // Padding inline (p-5/pt-9 are purged); extra top room for the
                // corner badge so a long plugin name never sits on the icon.
                style: `padding: ${entry.pluginName ? "2.25rem" : "1.5rem"} 1.25rem 1.375rem;`,
                onclick: select,
                onkeydown: (e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); }
                },
            },
            div({ class: "xopat-tutorial-card__accent" }),
            entry.pluginName ? span({
                class: "badge badge-sm badge-ghost absolute top-2 right-2 truncate",
                style: "max-width: calc(100% - 1rem); display: block;",
                title: entry.pluginName,
            }, entry.pluginName) : null,
            div(
                { class: "xopat-tutorial-card__icon flex items-center justify-center rounded-full text-2xl text-primary mb-1" },
                iTag({ class: `ph-light ${iconClass}` }),
            ),
            div({ class: "text-lg font-medium leading-snug" }, entry.name || ""),
            entry.description ? p({ class: "text-sm opacity-70 m-0" }, entry.description) : null,
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
