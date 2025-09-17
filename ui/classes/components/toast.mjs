import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
const { div, span, button } = van.tags;

// compact, neutral icons (SVG as strings)
const ICONS = {
    info:    '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 18a8 8 0 110-16 8 8 0 010 16Zm1-11V5H9v2h2Zm0 8V9H9v6h2Z"/></svg>',
    success: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 18a8 8 0 110-16 8 8 0 010 16Zm3.4-9.9l-1.4-1.4L9 9.7 8 8.7 6.6 10.1 9 12.5l4.4-4.4Z"/></svg>',
    warn:    '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2 1 18h18L10 2Zm1 12H9v2h2v-2Zm0-6H9v5h2V8Z"/></svg>',
    error:   '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 18a8 8 0 110-16 8 8 0 010 16Zm3.5-11.5-1-1L10 8.5 7.5 5.9l-1 1L9 9.5l-2.5 2.6 1 1L10 10.5l2.5 2.5 1-1L11 9.5l2.5-3Z"/></svg>',
    close:   '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M6.3 5.3 10 9l3.7-3.7 1.4 1.4L11.4 10l3.7 3.7-1.4 1.4L10 11.4l-3.7 3.7-1.4-1.4L8.6 10 4.9 6.7l1.4-1.4Z"/></svg>'
};

// importance → left-accent color classes (Primer-like subtle bar)
// we keep neutral bg/border; only the thin accent bar & progress color change
const SKINS = {
    info:    { accent: "bg-info",    progress: "bg-info/70"    },
    success: { accent: "bg-success", progress: "bg-success/70" },
    warning: { accent: "bg-warning", progress: "bg-warning/70" },
    error:   { accent: "bg-error",   progress: "bg-error/70"   }
};

// map legacy Dialogs enums to our skin + default icon
function mapLegacy(imp) {
    const cls = String(imp?.class || "").toLowerCase();
    if (cls.includes("success")) return { key: "success", icon: ICONS.success };
    if (cls.includes("warn"))    return { key: "warning", icon: ICONS.warn };
    if (cls.includes("error") || cls.includes("danger")) return { key: "error", icon: ICONS.error };
    return { key: "info", icon: ICONS.info };
}

export class Toast extends BaseComponent {
    constructor() {
        super({ id: "dialogs-container" });
        this._durationMs = 5000;

        // default importance (compatible with your Dialogs enums if present)
        const def = window.Dialogs?.MSG_INFO ? mapLegacy(window.Dialogs.MSG_INFO) : { key: "info", icon: ICONS.info };
        this._importance = def; // { key, icon }
        this._buttons = [];
    }

    /**
     * @param {{html:string, importance?:{class?:string,icon?:string}|{key:string,icon?:string}, durationMs?:number, buttons?:Record<string,Function>|Array<{label:string,onClick?:Function,class?:string}>}} p
     */
    setContent({ html, importance, durationMs, buttons }) {
        if (typeof durationMs === "number") this._durationMs = durationMs;

        if (importance) {
            this._importance = importance.key
                ? { key: importance.key, icon: importance.icon || ICONS[importance.key] || ICONS.info }
                : mapLegacy(importance);
        }

        this._buttons = normalizeButtons(buttons || []);

        if (!this.root) return;
        const card     = this.root.querySelector("[data-toast-card]");
        const iconEl   = this.root.querySelector("[data-icon]");
        const msgEl    = this.root.querySelector("[data-msg]");
        const btnBar   = this.root.querySelector("[data-buttons]");
        const progress = this.root.querySelector("[data-progress]");
        const accent   = this.root.querySelector("[data-accent]");

        // neutral Primer-like surface (kept constant)
        card.className =
            "relative isolate flex items-center gap-2 " +
            "rounded-md border border-base-300 bg-base-200/95 text-base-content shadow-sm " +
            "pr-3 pl-1 py-2 min-w-[260px] max-w-[520px] w-max";

        // left accent + progress color by importance
        const skin = SKINS[this._importance.key] || SKINS.info;
        accent.className = `absolute left-0 top-0 h-full w-[3px] rounded-l-xl ${skin.accent}`;
        progress.className = `pointer-events-none absolute left-0 right-0 bottom-0 h-0.5 ${skin.progress} animate-toastbar`;

        // icon + message
        iconEl.innerHTML = this._importance.icon || ICONS.info;
        msgEl.innerHTML = html ?? "";

        // buttons
        btnBar.innerHTML = "";
        for (const b of this._buttons) {
            const el = document.createElement("button");
            el.type = "button";
            el.className = `btn btn-ghost btn-xs h-6 min-h-0 ${b.class || ""}`;
            el.textContent = b.label;
            el.addEventListener("click", (ev) => b.onClick?.(ev, window.Dialogs));
            btnBar.appendChild(el);
        }

        // progress timing
        progress.style.animationDuration = `${this._durationMs}ms`;
    }

    show() {
        if (!this.root) return;
        this.root.classList.remove("hidden", "opacity-0");
        this.root.classList.add("flex", "opacity-100");

        // restart progress anim
        const bar = this.root.querySelector("[data-progress]");
        bar?.classList.remove("animate-toastbar");
        void bar?.offsetWidth; // reflow
        bar?.classList.add("animate-toastbar");

        // auto-hide
        clearTimeout(this._hideT);
        if (this._durationMs > 0) {
            this._hideT = setTimeout(() => this.hide(), this._durationMs);
        }
    }

    hide() {
        if (!this.root) return;
        this.root.classList.add("opacity-0");
        this.root.classList.remove("opacity-100");
        setTimeout(() => {
            this.root.classList.add("hidden");
            this.root.classList.remove("flex");
        }, 150);
    }

    isHidden() {
        return !this.root || this.root.classList.contains("hidden");
    }

    create() {
        // bottom-centered container (like original)
        this.root = div(
            {
                id: this.id,
                class:
                    "hidden opacity-0 transition-opacity duration-150 " +
                    "fixed left-1/2 bottom-4 -translate-x-1/2 z-[5050] " +
                    "toast toast-bottom toast-center"
            },
            // single toast (can be extended to stack)
            div(
                { "data-toast-card": "", class: "relative" },
                // left accent bar
                div({ "data-accent": "", class: "absolute left-0 top-0 h-full w-[3px] rounded-l-md bg-info" }),
                // content row
                div({ class: "flex items-center gap-2 pl-[10px] w-full" }, // 10px so accent + border feel like original
                    div({ "data-icon": "", class: "shrink-0 text-base-content/80 pl-2" }),
                    span({ "data-msg": "", class: "text-[13px] leading-snug whitespace-normal break-words" }),
                    div({ "data-buttons": "", class: "ml-1 inline-flex gap-1" }),
                    button(
                        {
                            type: "button",
                            class: "btn btn-ghost btn-xs h-6 w-6 min-h-0 p-0 ml-1 text-base-content/70 hover:text-base-content",
                            onclick: () => this.hide(),
                            "aria-label": "Close"
                        },
                        span({ innerHTML: ICONS.close })
                    )
                ),
                // bottom progress
                div({ "data-progress": "", class: "pointer-events-none absolute left-0 right-0 bottom-0 h-0.5 bg-info/70 animate-toastbar" })
            )
        );
        return this.root;
    }
}

function normalizeButtons(buttons) {
    if (Array.isArray(buttons)) {
        return buttons.filter(Boolean).map(b => ({
            label: String(b.label ?? ""),
            onClick: b.onClick,
            class: b.class
        })).filter(b => b.label);
    }
    if (buttons && typeof buttons === "object") {
        return Object.entries(buttons).map(([label, onClick]) => ({
            label: String(label),
            onClick: typeof onClick === "function" ? onClick : undefined
        }));
    }
    return [];
}
