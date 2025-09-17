// ui/components/Alert.mjs
import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div, span } = van.tags;
const { svg, path } = van.tags("http://www.w3.org/2000/svg");

const MODES = /** @type {const} */ (["neutral","info","success","warning","error"]);
const isMode = v => MODES.includes(v);

/* ---- DaisyUI class maps ---- */
const MODE_CLASS_FILLED = {
    neutral: "",                 // just .alert
    info: "alert-info",
    success: "alert-success",
    warning: "alert-warning",
    error: "alert-error",
};

const MODE_CLASS_SOFT = {
    neutral: "border border-base-300 bg-base-200 text-base-content/80",
    info:    "border border-info bg-info/10 text-info",
    success: "border border-success bg-success/10 text-success",
    warning: "border border-warning bg-warning/10 text-warning",
    error:   "border border-error bg-error/10 text-error",
};

const ICON_COLOR_FILLED = {
    neutral: "text-base-content",
    info:    "text-info-content",
    success: "text-success-content",
    warning: "text-warning-content",
    error:   "text-error-content",
};
const ICON_COLOR_SOFT = {
    neutral: "text-base-content/80",
    info:    "text-info",
    success: "text-success",
    warning: "text-warning",
    error:   "text-error",
};

export class Alert extends BaseComponent {
    /**
     * @param {{
     *  id?: string,
     *  mode?: "neutral"|"info"|"success"|"warning"|"error",
     *  title?: string|Node,
     *  description?: string|Node,
     *  closable?: boolean,
     *  compact?: boolean,
     *  soft?: boolean,
     *  onClose?: () => void,
     * }} opts
     */
    constructor(opts = undefined) {
        opts = super(opts).options;
        this.mode = isMode(opts.mode) ? opts.mode : "neutral";
        this.title = opts.title ?? "";
        this.description = opts.description ?? "";
        this.closable = !!opts.closable;
        this.compact = !!opts.compact;
        this.soft = !!opts.soft;
        this.onClose = opts.onClose;

        this._computeBaseClass();
    }

    _computeBaseClass() {
        const filled = MODE_CLASS_FILLED[this.mode] ?? "";
        const soft = MODE_CLASS_SOFT[this.mode] ?? "";
        const look = this.soft ? soft : filled;
        this.classMap.base = [
            "alert",                       // DaisyUI alert
            look,
            this.compact ? "py-1 px-2 text-sm" : "py-2 px-3",
        ].filter(Boolean).join(" ");
    }

    create() {
        const titleNode = this.title
            ? div({class:"font-semibold"}, this.title)
            : null;

        const closeBtn = this.closable
            ? div(
                {
                    role: "button",
                    class: "ml-auto btn btn-ghost btn-xs min-h-0 h-6 px-2",
                    onclick: () => { this.hide(); this.onClose?.(); },
                    title: "Close",
                },
                span({ class: "fa-auto fa-close text-base" })
            )
            : null;

        const alertNode = div(
            {
                ...this.commonProperties,
                id: this.id,
                class: this.classMap.base,
                role: "alert",
                tabindex: "0",
                onclick: (e) => {
                    if (e.target.closest?.("[data-tooltip-exempt]")) return;
                    USER_INTERFACE.Tooltip.toggle(alertNode, {
                        content: this.description,           // HTML or text
                        placement: "bottom",
                        trigger: "both",                     // hover+click support
                        interactive: true,
                        offset: 8,
                    });
                },
                onmouseenter: () => USER_INTERFACE.Tooltip.show(alertNode, {
                    content: this.description, placement: "bottom", trigger: "both", interactive: true, offset: 8
                }),
                onmouseleave: () => {
                    USER_INTERFACE.Tooltip.hide();
                }
            },
            iconSvg(this.mode, { soft: this.soft }),
            div(titleNode),
            closeBtn
        );
        return alertNode;
    }

    /* ------- minimal API for runtime updates ------- */
    setMode(mode, { soft = this.soft } = {}) {
        if (!["neutral","info","success","warning","error"].includes(mode)) return;
        this.mode = mode;
        this.soft = !!soft;
        this._computeBaseClass();
        const el = document.getElementById(this.id);
        if (!el) return;
        el.className = this.classMap.base;
        el.firstChild?.replaceWith(iconSvg(this.mode, { soft: this.soft }));
    }

    setTitle(v) {
        this.title = v ?? "";
        this._rerender();
    }
    setDescription(v) {
        this.description = v ?? "";
        this._rerender();
    }

    show() {
        const el = document.getElementById(this.id);
        if (el) el.classList.remove("hidden");
    }
    hide() {
        const el = document.getElementById(this.id);
        if (el) el.classList.add("hidden");
    }

    _rerender() {
        const el = document.getElementById(this.id);
        if (!el) return;
        // keep icon & close; re-render text block (second child)
        const textWrap = el.children[1];
        if (!textWrap) return;
        textWrap.innerHTML = "";
        const titleNode = this.title ? div({class:"font-semibold"}, this.title) : null;
        USER_INTERFACE.Tooltip.update(document.getElementById(this.id), { content: this.description });
        textWrap.appendChild(titleNode);
    }
}

function iconSvg(mode, { soft = false, hidden = false } = {}) {
    const size = "w-5 h-5 shrink-0";
    const color = soft ? (ICON_COLOR_SOFT[mode] || "text-base-content")
        : (ICON_COLOR_FILLED[mode] || "text-base-content");
    const svgCls = `${size} ${color} stroke-current ${hidden ? "invisible" : ""}`;

    const pathAttrs = {
        "stroke-width": "2",
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
    };

    switch (mode) {
        case "success":
            pathAttrs.d = "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0";
            break;
        case "warning":
            pathAttrs.d = "M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0";
            break;
        case "error":
            pathAttrs.d = "M12 8v4m0 4h.01M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07";
            break;
        case "info":
        default:
            pathAttrs.d = "M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20";
            break;
    }

    return svg({
        // width: "16px",
        viewBox: "0 0 24 24",
        'class': svgCls,
        fill: "none",
        "aria-hidden": hidden ? "true" : "false",
        xmlns: "http://www.w3.org/2000/svg"
    }, path(pathAttrs));
}
