import van from "../../vanjs.mjs";                // adjust path if needed
import { BaseComponent } from "../baseComponent.mjs";

const { div, span, button } = van.tags;
const { svg, path } = van.tags("http://www.w3.org/2000/svg");

/**
 * Toast - messages
 */
export class Toast extends BaseComponent {
    constructor() {
        super({ id: "dialogs-container" });
        this._durationMs = 5000;
        this._importance = window.Dialogs?.MSG_INFO || { class: "", icon: "" };
        this._buttons = []; // normalized array form
    }

    /**
     *
     * @param html
     * @param importance
     * @param durationMs
     * @param {Object<string, callback>} buttons
     */
    setContent({ html, importance, durationMs, buttons }) {
        this._durationMs = durationMs;
        this._importance = importance || this._importance;
        this._buttons = normalizeButtons(buttons || []);
        // Patch DOM once mounted
        const root = document.getElementById(this.id);
        if (!root) return;
        const toast = root.querySelector(".Toast");
        const board = root.querySelector("#system-notification");
        const icon = root.querySelector("#notification-bar-icon");
        const btnBar = root.querySelector("#dialogs-buttons");

        board.innerHTML = html;
        icon.innerHTML = this._importance.icon;
        toast.className = `Toast ${this._importance.class} progress-bottom-bar`;
        toast.style.animationDuration = `${this._durationMs}ms`;

        // render buttons
        btnBar.innerHTML = "";
        for (const b of this._buttons) {
            const classes = `btn btn-xs ${b.class || "btn-ghost"}`;
            const el = document.createElement("button");
            el.type = "button";
            el.className = classes;
            el.textContent = b.label;
            el.addEventListener("click", (ev) => b.onClick?.(ev, window.Dialogs));
            btnBar.appendChild(el);
        }
    }

    show() {
        const root = document.getElementById(this.id);
        if (!root) return;
        root.classList.remove("popUpHide");
        root.classList.add("popUpEnter");
    }

    hide() {
        const root = document.getElementById(this.id);
        if (!root) return;
        root.classList.remove("popUpEnter");
        root.classList.add("popUpHide");
    }

    create() {
        // A faithful recreation of your original DOM, just built with van
        return div(
            {
                id: this.id,
                class: "popUpHide fixed",
                style: "z-index:5050; transform: translate(calc(50vw - 50%));",
            },
            div(
                { class: "Toast", style: "margin: 16px 0 0 0;" },
                span(
                    { class: "Toast-icon" },
                    svg({
                        width: 12,
                        height: 16,
                        id: "notification-bar-icon",
                        viewBox: "0 0 12 16",
                        class: "octicon octicon-check",
                        "aria-hidden": "true",
                    })
                ),
                // message
                span({
                    id: "system-notification",
                    class:
                        "Toast-content v-align-middle height-full position-relative",
                    style: "max-width: 350px;",
                }),
                // button bar (new)
                div({
                    id: "dialogs-buttons",
                    class: "inline-flex gap-2 align-middle",
                    style: "vertical-align: middle;align-self: center;",
                }),
                // close X
                button(
                    {
                        class: "Toast-dismissButton",
                        onclick: () => window.Dialogs._hideImpl(false),
                    },
                    svg(
                        { width: 12, height: 16, viewBox: "0 0 12 16", class: "octicon octicon-x", "aria-hidden": "true" },
                        path({ "fill-rule": "evenodd", d: "M7.48 8l3.75 3.75-1.48 1.48L6 9.48l-3.75 3.75-1.48-1.48L4.52 8 .77 4.25l1.48-1.48L6 6.52l3.75-3.75 1.48 1.48L7.48 8z" })
                    )
                )
            )
        );
    }
}

function normalizeButtons(buttons) {
    if (Array.isArray(buttons)) {
        // [{label,onClick,class?}]
        return buttons
            .filter(Boolean)
            .map((b) => ({
                label: String(b.label ?? ""),
                onClick: b.onClick,
                class: b.class,
            }))
            .filter((b) => b.label);
    }
    if (buttons && typeof buttons === "object") {
        // { "Label": handler, ... }
        return Object.entries(buttons).map(([label, onClick]) => ({
            label: String(label),
            onClick: typeof onClick === "function" ? onClick : undefined,
        }));
    }
    return [];
}
