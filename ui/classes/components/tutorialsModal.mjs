import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { Modal } from "./modal.mjs";

const { div, p, button, i: iTag, span } = van.tags;

// One-time stylesheet for hover/transition rules. The previous markup used
// `hover:scale-[1.02]`, which isn't in the shipped tailwind.min.css, so cards
// stayed static on hover. A scoped class with a real CSS pseudo-rule restores
// the lift without depending on the JIT bundle.
if (typeof document !== "undefined" && !document.getElementById("__xopat_tutorials_modal_css")) {
    const style = document.createElement("style");
    style.id = "__xopat_tutorials_modal_css";
    style.textContent = `
        .xopat-tutorial-card {
            position: relative;
            border-radius: 0.75rem;
            cursor: pointer;
            overflow: hidden;
            background: oklch(var(--b1) / 0.78);
            backdrop-filter: blur(18px) saturate(160%);
            -webkit-backdrop-filter: blur(18px) saturate(160%);
            border: 1px solid rgba(255,255,255,0.30);
            transition: transform 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease, border-color 0.18s ease;
            box-shadow: 0 4px 14px rgba(0,0,0,0.16);
        }
        .xopat-tutorial-card:hover {
            transform: translateY(-2px);
            background: oklch(var(--b1) / 0.88);
            border-color: rgba(255,255,255,0.55);
            box-shadow: 0 18px 38px rgba(0,0,0,0.22), 0 0 0 1px oklch(var(--p) / 0.30);
        }
        .xopat-tutorial-card .xopat-tutorial-card__accent {
            position: absolute;
            top: 0; left: 0; right: 0; height: 3px;
            background: linear-gradient(90deg, oklch(var(--p)), oklch(var(--a)));
            opacity: 0;
            transition: opacity 0.18s ease;
        }
        .xopat-tutorial-card:hover .xopat-tutorial-card__accent { opacity: 1; }
        /* Glass close button for the gradient backdrop. */
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
            color: #ffffff;
            background: rgba(0,0,0,0.22);
            border: 1px solid rgba(255,255,255,0.30);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            transition: background 0.15s ease;
            z-index: 5;
        }
        .xopat-tutorial-close:hover { background: rgba(0,0,0,0.35); }
    `;
    document.head.appendChild(style);
}

/**
 * Tutorial selection screen.
 *
 * Renders the registered tutorials as a responsive card grid that fills the
 * whole modal width. The modal sits on a vibrant gradient backdrop with
 * decorative blurred circles; the content area uses a frosted-glass overlay
 * so card text stays readable regardless of where the gradient happens to be
 * brightest. Clicking a card invokes `onSelect(index)`; title/description and
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

        // Theme-reactive pastel: full-opacity pastel stops are multiplied
        // against `oklch(var(--b1))` via `background-blend-mode: multiply`.
        // Light themes (b1 = white) leave the pastels untouched — soft, vivid
        // sherbet. Dark themes (b1 = dark slate) multiply the pastels toward
        // the dark base, producing a muted, gently tinted variant instead of
        // jarring neon. No DaisyUI brand palette involved.
        const gradient = this.options.gradient
            || "linear-gradient(135deg, #c7d2fe 0%, #ddd6fe 25%, #fbcfe8 55%, #fed7aa 85%, #fef3c7 100%)";

        // Theme-bound text — base-content flips with the active theme, so the
        // header copy stays readable on both light and dark backdrops. The
        // halo is tuned per theme via mix-blend-mode so it disappears in dark
        // mode (where it would otherwise glow oddly).
        const headerColor = "oklch(var(--bc))";
        const headerHalo  = "";

        const header = div(
            {
                style: "position: relative; z-index: 2; display: flex; flex-direction: column; gap: 0.5rem;"
                     + " padding: 1.75rem 1.875rem 0.5rem;",
            },
            div(
                {
                    style: `font-size: 1.75rem; font-weight: 400; letter-spacing: -0.015em; color: ${headerColor}; ${headerHalo}`,
                },
                this._titleState,
            ),
            div({ style: "width: 2.5rem; height: 3px; border-radius: 9999px; background: linear-gradient(90deg, oklch(var(--p)), oklch(var(--a)));" }),
            p(
                {
                    style: `margin: 0.5rem 0 0; font-size: 0.875rem; color: ${headerColor}; opacity: 0.78; line-height: 1.5; ${headerHalo}`,
                },
                this._descriptionState,
            ),
        );

        // Card grid sits directly on the gradient too — individual glass
        // cards make each entry feel like a discrete surface that floats on
        // the same backdrop, rather than a row of white blocks on a
        // disconnected glass strip.
        this._grid = div({
            id: "tutorials",
            class: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 overflow-y-auto",
            style: "position: relative; z-index: 2; padding: 1rem 1.875rem 0.75rem; max-height: 55vh;",
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

        // Custom close button — the modal-box default X has poor contrast on
        // the vibrant gradient.
        const closeButton = div(
            {
                role: "button",
                tabindex: "0",
                class: "xopat-tutorial-close",
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
                    style: "border-radius: 9999px; padding: 0 1.5rem; height: 2.25rem; min-height: 2.25rem;"
                         + " background: #ffffff; color: oklch(var(--p)); border: none; cursor: pointer;"
                         + " font-size: 0.875rem; font-weight: 600;"
                         + " box-shadow: 0 8px 20px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.04);",
                    onclick: () => this._handleExit(),
                },
                this._exitLabelState,
            ),
        );

        const circle = (s) => div({ style: `position: absolute; border-radius: 9999px; pointer-events: none; z-index: 1; ${s}` });

        const shell = div(
            {
                style: `position: relative; border-radius: 1rem; overflow: hidden;`
                     + ` background-image: ${gradient};`
                     + ` background-color: oklch(var(--b1));`
                     + ` background-blend-mode: multiply;`
                     + ` box-shadow: 0 22px 50px rgba(31,41,55,0.22), inset 0 0 0 1px rgba(255,255,255,0.45);`,
            },
            // Soft white highlights — keep the layered-light feel without
            // looking glassy/grey against the pastel base.
            circle("top: -5rem; left: -3rem; width: 18rem; height: 18rem; background: rgba(255,255,255,0.45); filter: blur(2px);"),
            circle("top: 35%; right: -5rem; width: 22rem; height: 22rem; background: rgba(255,255,255,0.30); filter: blur(3px);"),
            circle("bottom: -6rem; left: 25%; width: 20rem; height: 20rem; background: rgba(255,255,255,0.35); filter: blur(2px);"),
            circle("top: 10%; left: 38%; width: 6rem; height: 6rem; background: rgba(255,255,255,0.55);"),
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
     * @param {string} text plain-text or HTML notice copy.
     */
    setMobileNotice(text) {
        this.create();
        if (!this._mobileNotice) return;
        this._mobileNotice.innerHTML = String(text ?? "");
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
                class: `xopat-tutorial-card ${pluginRootClass}`.trim(),
                onclick: () => this.onSelect(index)
            },
            div({ class: "xopat-tutorial-card__accent" }),
            div(
                {
                    class: "card-body items-center text-center gap-1",
                    style: "padding: 1.25rem 1rem;",
                },
                ...children
            )
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
