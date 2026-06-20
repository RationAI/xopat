import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div, span, button, progress: vanProgress } = van.tags;

/**
 * Reusable progress dialog for long-running client-side operations
 * (bulk annotation creation, batch import / export, etc.).
 *
 * Follows the BaseComponent contract:
 *   - constructor accepts BaseUIOptions + custom fields
 *   - create() returns exactly one HTML Node
 *   - mounted via attachTo(parent) (or use the static show() shortcut)
 *
 * Usage (full-screen — default):
 *   const dlg = UI.ProgressDialog.show({
 *       title: 'Adding annotations',
 *       total: 5000,
 *       cancellable: true,
 *   });
 *
 * Usage (anchored over a viewer):
 *   const dlg = UI.ProgressDialog.show({
 *       title: 'Loading',
 *       total: 5000,
 *       cancellable: true,
 *       viewer: someOpenSeadragonViewer,    // resolves anchor automatically
 *       // or: anchor: someElement
 *   });
 *
 * Non-blocking by default so the user can still interact with the canvas while
 * the operation runs.
 *
 * @typedef {BaseUIOptions} ProgressDialogOptions
 * @property {string}  [title='Working…']
 * @property {number}  [total=100]
 * @property {boolean} [cancellable=false]
 * @property {string}  [label='']        Optional secondary label text below the bar.
 * @property {boolean} [isBlocking=false]
 * @property {number}  [autoCloseMs=400] Auto-close delay used by done().
 * @property {HTMLElement} [anchor]      Mount the dialog inside this element (overlay scoped to it).
 * @property {object}  [viewer]          Viewer-like ref (.element / .container / .canvas) used to resolve `anchor`.
 */
export class ProgressDialog extends BaseComponent {
    constructor(options = {}) {
        super(options);

        this.title = options.title ?? $.t("common.working");
        this.total = Math.max(0, options.total ?? 100);
        this.cancellable = options.cancellable === true;
        this.isBlocking = options.isBlocking === true;
        this.autoCloseMs = options.autoCloseMs ?? 400;

        // Anchor resolution: explicit `anchor` wins; else derive from `viewer`.
        // null = full-screen (default).
        this._anchorEl = ProgressDialog._resolveAnchor(options.anchor, options.viewer);
        this._isAnchored = !!(this._anchorEl && this._anchorEl !== document.body);
        this._restoreParentPosition = null; // remembers prior inline position style if we touched it

        // Base classMap drives the root element's class via BaseComponent.classState.
        // In anchored mode we use a custom positioning class instead of daisyUI's
        // fixed-viewport `modal`.
        if (this._isAnchored) {
            this.classMap.modal = "absolute inset-0 z-50 flex items-center justify-center bg-black/30";
        } else {
            this.classMap.modal = "modal";
            this.classMap.open = "modal-open";
        }

        // reactive content state
        this._value = van.state(0);
        this._labelText = van.state(options.label ?? "");
        this._statusText = van.state("");
        this._isError = van.state(false);
        this._isDone = van.state(false);

        this._cancelHandlers = [];
        this._closed = false;
        this.root = null;
    }

    /**
     * Resolves a viewer-like reference to a DOM element (or returns the
     * explicit element if given). Returns null when neither yields anything
     * usable, signalling full-screen mode.
     */
    static _resolveAnchor(anchor, viewer) {
        if (anchor instanceof Element) return anchor;
        if (viewer) {
            return (
                (viewer.element instanceof Element && viewer.element)
                || (viewer.container instanceof Element && viewer.container)
                || (viewer.canvas?.parentElement instanceof Element && viewer.canvas.parentElement)
                || null
            );
        }
        return null;
    }

    static show(options = {}) {
        const dlg = new ProgressDialog(options);
        const mount = dlg._anchorEl || document.body;
        dlg.attachTo(mount);
        return dlg;
    }

    /** @override */
    create() {
        if (this.root) return this.root;

        const total = this.total;
        const counter = () => `${this._value.val} / ${total}`;
        const pct = () => total > 0 ? Math.floor(Math.min(this._value.val, total) / total * 100) : 0;
        const barClass = () => {
            if (this._isError.val) return "progress progress-error w-full";
            if (this._isDone.val) return "progress progress-success w-full";
            return "progress progress-primary w-full";
        };
        const labelHidden = () => this._labelText.val ? "" : "hidden";
        const errorHidden = () => this._isError.val ? "" : "hidden";

        const box = div(
            { class: "modal-box relative shadow-lg", style: "width: min(440px, 92vw); max-width: min(440px, 92vw);" },
            div({ class: "text-base font-semibold mb-3" }, this.title),
            div(
                { class: "flex flex-col gap-2 py-1" },
                vanProgress({
                    class: barClass,
                    value: () => Math.min(this._value.val, total),
                    max: total,
                }),
                div(
                    { class: "flex items-center justify-between text-xs opacity-70" },
                    span({}, counter),
                    span({}, () => `${pct()}%`),
                ),
                div({ class: () => `text-xs opacity-70 ${labelHidden()}` }, () => this._labelText.val),
                div({ class: () => `text-xs text-error ${errorHidden()}` }, () => this._statusText.val),
                this.cancellable
                    ? div(
                        { class: "flex justify-end mt-1" },
                        button(
                            {
                                class: "btn btn-ghost btn-sm",
                                onclick: () => this._handleCancel(),
                            },
                            $.t("common.cancel")
                        )
                    )
                    : null,
            ),
        );

        this.root = div(this.commonProperties, box);

        if (!this.isBlocking) {
            this.root.addEventListener("click", (e) => {
                if (e.target === this.root) this.close();
            });
        }
        return this.root;
    }

    /** @override — also ensures the anchor parent is positioned. */
    attachTo(parent) {
        if (this._isAnchored && parent && parent.nodeType === 1) {
            // Container mode requires the parent to participate in positioning.
            const computed = parent.ownerDocument?.defaultView?.getComputedStyle?.(parent);
            if (computed && computed.position === "static") {
                this._restoreParentPosition = parent.style.position || "";
                parent.style.position = "relative";
                this._restoreParentRef = parent;
            }
        }
        return super.attachTo(parent);
    }

    /** Update the progress bar to an absolute count (0..total). */
    tick(absoluteCount) {
        if (this._closed) return this;
        this._value.val = Math.max(0, Math.min(absoluteCount, this.total));
        return this;
    }

    /** Update the secondary label text. */
    setLabel(text) {
        if (this._closed) return this;
        this._labelText.val = text || "";
        return this;
    }

    /** Switch the dialog to error state. Bar turns red; dialog stays open. */
    error(err) {
        if (this._closed) return this;
        this._isError.val = true;
        this._statusText.val = (err && (err.message || String(err))) || $.t("common.operationFailed");
        this.setClass("state", "modal-error");
        return this;
    }

    /**
     * Switch to success state and auto-close after `autoCloseMs`. Pass 0 to
     * keep open until close() is called explicitly.
     */
    done(autoCloseMs = this.autoCloseMs) {
        if (this._closed) return this;
        this._isDone.val = true;
        this._value.val = this.total;
        this.setClass("state", "modal-done");
        if (autoCloseMs && autoCloseMs > 0) {
            setTimeout(() => this.close(), autoCloseMs);
        }
        return this;
    }

    /** Immediate close + DOM detach. Restores any temporary parent style. */
    close() {
        if (this._closed) return this;
        this._closed = true;
        this.setClass("open", "");
        this.remove();
        if (this._restoreParentRef) {
            this._restoreParentRef.style.position = this._restoreParentPosition || "";
            this._restoreParentRef = null;
            this._restoreParentPosition = null;
        }
        return this;
    }

    /** Register a cancel handler. Multiple handlers are supported. */
    onCancel(fn) {
        if (typeof fn === "function") this._cancelHandlers.push(fn);
        return this;
    }

    /** True if the dialog is in error state. */
    get isError() {
        return this._isError.val;
    }

    _handleCancel() {
        for (const fn of this._cancelHandlers) {
            try { fn(); } catch (e) { console.error(e); }
        }
        // dialog stays open; the operation is responsible for calling done()/close()
    }
}
