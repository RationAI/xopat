import van from "../../vanjs.mjs";
import {BaseComponent} from "../baseComponent.mjs";

const { div } = van.tags;

export class Modal extends BaseComponent {
    // todo this should be functional, not static string!
    static CLOSE_BUTTON_SIDE = {
        LEFT: "left",
        RIGHT: "right",
    };

    constructor(options) {
        super(options);
        this.options = options || {};
        this.isOpen = false;
        this.width = options.width || "min(400px, 80vw)";
        this.isBlocking = options.isBlocking ?? false;
        this.allowResize = options.allowResize ?? false;
        this.borderLess = options.borderLess ?? false;
        this.allowClose = options.allowClose !== undefined ? options.allowClose : true;
        this.closeButtonSide = options.closeButtonSide || Modal.CLOSE_BUTTON_SIDE.RIGHT;

        this._mouseMoving = this.__mouseMoving.bind(this);
        this._mouseUp = this.__mouseUp.bind(this);

        this._lastX = 0;
        this._lastY = 0;
        this._startWidth = 0;
        this._startHeight = 0;
    }

    create() {
        if (this.root) return this.root;

        let style = "";
        if (this.width) {
            style += `width: ${this.width}; max-width: ${this.width};`;
        } else {
            style += "max-width: 35rem;";
        }

        if (this.borderLess) {
            style += "padding: 0;";
        }

        const closeButtonPositionClass = this.closeButtonSide === Modal.CLOSE_BUTTON_SIDE.LEFT
            ? "left-2"
            : "right-2";
        const headerPaddingClass = this.closeButtonSide === Modal.CLOSE_BUTTON_SIDE.LEFT
            ? "pl-10"
            : "pr-10";

        const box = div(
            {
                class: "modal-box relative",
                style: style,
            },
            this.allowClose
                ? div(
                    {
                        class: `btn btn-sm btn-circle btn-ghost absolute ${closeButtonPositionClass} top-2`,
                        onclick: () => this.close()
                    },
                    "✕"
                )
                : null,
            this.options.header ? div({ class: `text-lg font-bold ${headerPaddingClass} mb-2` }, this.options.header) : null,
            this.options.body ? div({ class: "modal-body bg-base-100 rounded-lg" }, this.options.body) : null,
            this.options.footer ? div({ class: "modal-action" }, this.options.footer) : null,
        );

        this.root = div(
            {
                class: `modal ${this.isOpen ? "modal-open" : ""}`,
            },
            box
        );

        if (this.isBlocking === false) {
            this.root.addEventListener("click", (e) => {
                if (e.target === this.root) this.close();
            });
        }

        if (this.allowResize) {
            this._addResizeHandle();
        }

        return this.root;
    }

    mount(parent = document.body) {
        const el = this.create();
        if (!el.parentNode) {
            parent.appendChild(el);
        }
        return this;
    }

    open() {
        this.create();
        this.isOpen = true;
        this.root.classList.add("modal-open");
        return this;
    }

    close() {
        this.isOpen = false;
        if (this.root) {
            this.root.classList.remove("modal-open");
        }
        this.__mouseUp();
        return this;
    }

    _addResizeHandle() {
        const resizeHandle = div({
            class: "absolute right-2 bottom-2 w-4 h-4 cursor-se-resize opacity-60"
        });

        const box = this.root.querySelector(".modal-box");
        if (!box) return;

        box.appendChild(resizeHandle);

        resizeHandle.addEventListener("mousedown", (e) => {
            e.preventDefault();
            const modal = this.root?.querySelector(".modal-box");
            if (!modal) return;

            const rect = box.getBoundingClientRect();
            this._startWidth = rect.width;
            this._startHeight = rect.height;
            this._lastX = e.clientX;
            this._lastY = e.clientY;
            modal.style.width = rect.width;
            modal.style.maxWidth = "none";

            document.body.style.cursor = "se-resize";
            document.addEventListener("mousemove", this._mouseMoving);
            document.addEventListener("mouseup", this._mouseUp);
        });
    }

    __mouseMoving(e) {
        const box = this.root?.querySelector(".modal-box");
        if (!box) return;

        const dx = e.clientX - this._lastX;
        const dy = e.clientY - this._lastY;

        const nextWidth = Math.max(240, this._startWidth + dx);
        const nextHeight = Math.max(120, this._startHeight + dy);

        box.style.width = `${nextWidth}px`;
        box.style.height = `${nextHeight}px`;
    }

    __mouseUp() {
        document.body.style.cursor = "";
        document.removeEventListener("mousemove", this._mouseMoving);
        document.removeEventListener("mouseup", this._mouseUp);
    }
}
